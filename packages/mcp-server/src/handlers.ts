import { Gate } from "@axiru/gate-core";
import type { Decision, PaymentAction, PaymentIntent, Policy } from "@axiru/gate-core";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

export interface ToolContext {
  gate: Gate;
  /** Reported outcomes from the payment rail, keyed by intent id. */
  outcomes: Map<string, { status: string; provider_ref?: string; at: string }>;
}

export function loadPolicy(path?: string): Policy | undefined {
  if (!path) return undefined;
  return JSON.parse(readFileSync(path, "utf8")) as Policy;
}

export function makeContext(env: NodeJS.ProcessEnv = process.env): ToolContext {
  const policy = loadPolicy(env.AXIRU_POLICY_FILE);
  const gate = new Gate({ apiKey: env.AXIRU_API_KEY, baseUrl: env.AXIRU_BASE_URL, policy });
  return { gate, outcomes: new Map() };
}

export interface CheckInput {
  intent_id?: string;
  agent_id?: string;
  action: PaymentAction;
  amount_minor: number;
  currency: string;
  counterparty: string;
  rail?: string;
  reason?: string;
  customer_id?: string;
  original_charge_id?: string;
  original_charge_amount_minor?: number;
  platform?: string;
}

export async function checkPayment(ctx: ToolContext, input: CheckInput): Promise<Decision & { instruction: string }> {
  const intent: PaymentIntent = {
    intent_id: input.intent_id ?? `int_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    agent_id: input.agent_id ?? "agent",
    action: input.action,
    amount_minor: input.amount_minor,
    currency: input.currency.toUpperCase(),
    counterparty: input.counterparty,
    rail: input.rail ?? "stripe",
    reason: input.reason,
    customer_id: input.customer_id,
    original_charge: input.original_charge_id
      ? { id: input.original_charge_id, amount_minor: input.original_charge_amount_minor ?? Number.MAX_SAFE_INTEGER }
      : undefined,
    context: input.platform ? { platform: input.platform } : undefined,
  };
  const d = await ctx.gate.check(intent);
  writeLedgerFile(ctx, intent);
  return { ...d, instruction: instructionFor(d) };
}

/** Mirror of the session ledger on disk, so enforcement hooks (Grok Bot, Claude Code) can check the last verdict without an RPC. */
const amounts = new Map<string, number>();
function writeLedgerFile(ctx: ToolContext, intent: PaymentIntent): void {
  amounts.set(intent.intent_id, intent.amount_minor);
  const path = process.env.AXIRU_LEDGER_FILE ?? join(tmpdir(), "axiru-gate-ledger.json");
  const rows = ctx.gate.ledger().map((d) => ({ ...d, amount_minor: amounts.get(d.intent_id) }));
  try {
    writeFileSync(path, JSON.stringify(rows));
  } catch {
    // Best effort. The MCP tool result is still the source of truth for the agent.
  }
}

/** Plain instruction the agent must follow. Written for the model, so it is short and unambiguous. */
export function instructionFor(d: Decision): string {
  switch (d.verdict) {
    case "allow":
      return `Proceed with the payment. Then call axiru_report_outcome with intent_id ${d.intent_id} and the provider's result.`;
    case "hold":
      return `Do not execute. A person must approve intent ${d.intent_id}. Tell the user what was requested and why: ${d.rationale} Stop and wait.`;
    case "deny":
      return `Do not execute and do not retry with different values. ${d.rationale} Report this to the user as a policy denial.`;
  }
}

export function reportOutcome(ctx: ToolContext, input: { intent_id: string; status: string; provider_ref?: string }): { ok: boolean; message: string } {
  const decision = ctx.gate.ledger().find((d) => d.intent_id === input.intent_id);
  if (!decision) return { ok: false, message: `No decision exists for ${input.intent_id}. A payment ran without a decision in front of it. Flag as NEVER_AUTHORIZED.` };
  if (decision.verdict !== "allow" && input.status !== "not_executed") {
    return { ok: false, message: `Decision ${decision.decision_id} was ${decision.verdict} but the rail reports ${input.status}. Flag as EXECUTED_WITHOUT_ALLOW.` };
  }
  ctx.outcomes.set(input.intent_id, { status: input.status, provider_ref: input.provider_ref, at: new Date().toISOString() });
  return { ok: true, message: `Recorded ${input.status} for ${input.intent_id} against decision ${decision.decision_id}.` };
}

export function showLedger(ctx: ToolContext): Array<Decision & { outcome?: string }> {
  return ctx.gate.ledger().map((d) => ({ ...d, outcome: ctx.outcomes.get(d.intent_id)?.status }));
}
