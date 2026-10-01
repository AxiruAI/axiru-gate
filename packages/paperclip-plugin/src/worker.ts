import { definePlugin, runWorker } from "@paperclipai/plugin-sdk";
import type { PluginContext, ToolResult, ToolRunContext } from "@paperclipai/plugin-sdk";
import { Gate, DEFAULT_REFUND_POLICY } from "@axiru/gate-core";
import type { Decision, PaymentAction, PaymentIntent, Policy, PriorDecision } from "@axiru/gate-core";
import { CHECK_TOOL, PLUGIN_ID, REPORT_TOOL, TOOL_CHECK, TOOL_REPORT } from "./manifest.js";

interface Config {
  mode: "local" | "hosted";
  apiKeyRef?: string;
  perTransferCeilingMinor: number;
  holdAboveMinor: number;
  dailyCapPerAgentMinor: number;
  duplicateWindowDays: number;
  counterpartyAllowlist: string[];
  pauseAgentAfterDenials: number;
}

const DEFAULTS: Config = {
  mode: "local",
  perTransferCeilingMinor: 50_000,
  holdAboveMinor: 10_000,
  dailyCapPerAgentMinor: 100_000,
  duplicateWindowDays: 30,
  counterpartyAllowlist: [],
  pauseAgentAfterDenials: 3,
};

function policyFrom(c: Config): Policy {
  return {
    ...DEFAULT_REFUND_POLICY,
    policy_id: "paperclip-company",
    per_transfer_ceiling_minor: c.perTransferCeilingMinor,
    hold_above_minor: c.holdAboveMinor,
    daily_cap_per_agent_minor: c.dailyCapPerAgentMinor,
    duplicate_window_days: c.duplicateWindowDays,
    counterparty_allowlist: c.counterpartyAllowlist.length ? c.counterpartyAllowlist : undefined,
  };
}

/** One gate per company. Prior decisions persist in plugin state so windows survive restarts. */
const gates = new Map<string, Gate>();

async function gateFor(ctx: PluginContext, companyId: string, config: Config): Promise<Gate> {
  const existing = gates.get(companyId);
  if (existing) return existing;
  const apiKey = config.mode === "hosted" && config.apiKeyRef ? await ctx.secrets.resolve(config.apiKeyRef).catch(() => undefined) : undefined;
  const gate = new Gate({ apiKey, policy: policyFrom(config) });
  const prior = (await ctx.state.get({ scopeKind: "company", scopeId: companyId, stateKey: "prior" })) as PriorDecision[] | null;
  if (prior) gate.seed(prior);
  gates.set(companyId, gate);
  return gate;
}

/** Store the session ledger in company state so the board can read receipts after a restart. */
async function persist(ctx: PluginContext, companyId: string, gate: Gate): Promise<void> {
  await ctx.state.set({ scopeKind: "company", scopeId: companyId, stateKey: "ledger" }, gate.ledger());
}

async function countDenials(ctx: PluginContext, companyId: string, agentId: string): Promise<number> {
  const key = { scopeKind: "agent" as const, scopeId: agentId, stateKey: "denials" };
  const v = ((await ctx.state.get(key)) as string[] | null) ?? [];
  const cutoff = Date.now() - 86_400_000;
  const recent = v.filter((iso) => Date.parse(iso) > cutoff);
  recent.push(new Date().toISOString());
  await ctx.state.set(key, recent);
  return recent.length;
}

function money(minor: number, ccy: string): string {
  return `${(minor / 100).toFixed(2)} ${ccy}`;
}

const plugin = definePlugin({
  async setup(ctx) {
    const config: Config = { ...DEFAULTS, ...((ctx.config as Partial<Config>) ?? {}) };

    ctx.tools.register(
      TOOL_CHECK,
      { displayName: CHECK_TOOL.displayName, description: CHECK_TOOL.description, parametersSchema: CHECK_TOOL.parametersSchema },
      async (params, runCtx: ToolRunContext): Promise<ToolResult> => {
        const p = params as Record<string, unknown>;
        const gate = await gateFor(ctx, runCtx.companyId, config);
        const intent: PaymentIntent = {
          intent_id: (p.intent_id as string) ?? `pc_${runCtx.runId}_${Date.now()}`,
          agent_id: runCtx.agentId,
          action: p.action as PaymentAction,
          amount_minor: Number(p.amount_minor),
          currency: String(p.currency).toUpperCase(),
          counterparty: String(p.counterparty),
          rail: (p.rail as string) ?? "stripe",
          reason: p.reason as string | undefined,
          customer_id: p.customer_id as string | undefined,
          original_charge: p.original_charge_id
            ? { id: String(p.original_charge_id), amount_minor: Number(p.original_charge_amount_minor ?? Number.MAX_SAFE_INTEGER) }
            : undefined,
          context: { platform: "paperclip", companyId: runCtx.companyId, projectId: runCtx.projectId, runId: runCtx.runId },
        };
        const d: Decision = await gate.check(intent);
        await persist(ctx, runCtx.companyId, gate);
        await ctx.activity.log({
          companyId: runCtx.companyId,
          message: `Axiru ${d.verdict}: ${intent.action} ${money(intent.amount_minor, intent.currency)} to ${intent.counterparty} (${d.reason_codes.join(", ")})`,
          entityType: "agent",
          entityId: runCtx.agentId,
          metadata: { decision_id: d.decision_id, fingerprint: d.fingerprint, policy: `${d.policy_id}@${d.policy_version}` },
        });

        let instruction: string;
        if (d.verdict === "allow") {
          instruction = `Proceed. Then call ${TOOL_REPORT} with intent_id ${d.intent_id} and the provider result.`;
        } else if (d.verdict === "hold") {
          const issue = await ctx.issues.create({
            companyId: runCtx.companyId,
            projectId: runCtx.projectId,
            title: `Approval needed: ${intent.action} ${money(intent.amount_minor, intent.currency)} to ${intent.counterparty}`,
            description:
              `Requested by agent ${runCtx.agentId} in run ${runCtx.runId}.\n\n` +
              `Reason given by the agent (not evaluated): ${intent.reason ?? "none"}\n\n` +
              `Held because: ${d.rationale}\n\n` +
              `Decision ${d.decision_id}, policy ${d.policy_id} v${d.policy_version}, fingerprint ${d.fingerprint}.\n\n` +
              `To approve, a board member adds a comment "approved" and the agent may re-call ${TOOL_CHECK} with intent_id ${d.intent_id} and approval_issue_id set.`,
            priority: "high",
            originKind: `plugin:${PLUGIN_ID}`,
            originId: PLUGIN_ID,
            originRunId: runCtx.runId,
          });
          instruction = `Do not execute. Task ${issue.id} was opened for the board. Stop this action and wait for a person.`;
        } else {
          const n = await countDenials(ctx, runCtx.companyId, runCtx.agentId);
          instruction = `Do not execute and do not retry with different values. ${d.rationale}`;
          if (n >= config.pauseAgentAfterDenials) {
            await ctx.agents.pause(runCtx.agentId, runCtx.companyId);
            instruction += ` This agent has been paused after ${n} denials in 24h.`;
          }
        }
        return { content: `${d.verdict.toUpperCase()}: ${d.rationale} ${instruction}`, data: { ...d, instruction } };
      },
    );

    ctx.tools.register(
      TOOL_REPORT,
      { displayName: REPORT_TOOL.displayName, description: REPORT_TOOL.description, parametersSchema: REPORT_TOOL.parametersSchema },
      async (params, runCtx): Promise<ToolResult> => {
        const p = params as { intent_id: string; status: string; provider_ref?: string };
        const gate = await gateFor(ctx, runCtx.companyId, config);
        const decision = gate.ledger().find((d) => d.intent_id === p.intent_id);
        const flag = !decision ? "NEVER_AUTHORIZED" : decision.verdict !== "allow" && p.status !== "not_executed" ? "EXECUTED_WITHOUT_ALLOW" : null;
        await ctx.activity.log({
          companyId: runCtx.companyId,
          message: flag ? `Axiru reconciliation flag ${flag} for ${p.intent_id} (${p.status})` : `Axiru outcome ${p.status} for ${p.intent_id}`,
          entityType: "agent",
          entityId: runCtx.agentId,
          metadata: { intent_id: p.intent_id, status: p.status, provider_ref: p.provider_ref, decision_id: decision?.decision_id, flag },
        });
        return { content: flag ? `Recorded with flag ${flag}.` : `Recorded ${p.status}.`, data: { flag, decision_id: decision?.decision_id } };
      },
    );

    ctx.logger.info("Axiru payment gate ready");
  },
  async onHealth() {
    return { status: "ok", message: `Axiru payment gate active for ${gates.size} companies` };
  },
});

export default plugin;
runWorker(plugin, import.meta.url);
