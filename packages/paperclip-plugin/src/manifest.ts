import type { PaperclipPluginManifestV1 } from "@paperclipai/plugin-sdk";

export const PLUGIN_ID = "axiru.payment-gate";
export const TOOL_CHECK = "axiru_check_payment";
export const TOOL_REPORT = "axiru_report_outcome";

/** Tool declarations. Paperclip catalogs tools from the manifest; the worker registers handlers for these same names. */
export const CHECK_TOOL = {
  name: TOOL_CHECK,
  displayName: "Axiru: check payment",
  description:
    "Call BEFORE any action that moves money (refund, credit, payout, transfer, purchase, dispute). Returns allow, hold, or deny with reason codes and a receipt. On hold, a task is opened for the board; stop and wait. On deny, do not retry with different numbers.",
  parametersSchema: {
    type: "object",
    properties: {
      action: { type: "string", enum: ["refund", "credit", "payout", "transfer", "purchase", "dispute"] },
      amount_minor: { type: "integer", description: "Cents. 1250 = 12.50" },
      currency: { type: "string", description: "ISO 4217, e.g. USD" },
      counterparty: { type: "string", description: "Vendor id, merchant domain, wallet, or customer id" },
      rail: { type: "string" },
      reason: { type: "string", description: "Recorded, never evaluated" },
      customer_id: { type: "string" },
      original_charge_id: { type: "string" },
      original_charge_amount_minor: { type: "integer" },
      intent_id: { type: "string", description: "Reuse on retry; idempotent" },
    },
    required: ["action", "amount_minor", "currency", "counterparty"],
  },
};

export const REPORT_TOOL = {
  name: TOOL_REPORT,
  displayName: "Axiru: report outcome",
  description: "Call AFTER the payment tool returns, with the same intent_id, so the receipt records what the rail actually did.",
  parametersSchema: {
    type: "object",
    properties: { intent_id: { type: "string" }, status: { type: "string" }, provider_ref: { type: "string" } },
    required: ["intent_id", "status"],
  },
};

const manifest: PaperclipPluginManifestV1 = {
  id: PLUGIN_ID,
  apiVersion: 1,
  version: "0.1.3",
  displayName: "Axiru payment gate",
  description:
    "Paperclip caps tokens. Axiru gates dollars. Every refund, credit, payout, transfer, or purchase an agent wants to make is checked against company policy first: ceiling, daily cap, duplicate window, allowlist, hold threshold. Holds open a task for the board. Every decision gets a hash-chained receipt.",
  author: "Axiru",
  categories: ["automation", "connector"],
  capabilities: [
    "agent.tools.register",
    "issues.create",
    "issue.comments.create",
    "agents.read",
    "agents.pause",
    "activity.log.write",
    "plugin.state.read",
    "plugin.state.write",
    "http.outbound",
    "secrets.read-ref",
  ],
  entrypoints: { worker: "./dist/worker.js" },
  tools: [CHECK_TOOL, REPORT_TOOL],
  instanceConfigSchema: {
    type: "object",
    properties: {
      mode: { type: "string", title: "Mode", enum: ["local", "hosted"], default: "local", description: "local runs the open-source evaluator inside the plugin. hosted sends intents to the Axiru API." },
      apiKeyRef: { type: "string", title: "Axiru API key (secret ref)", description: "Only used in hosted mode." },
      perTransferCeilingMinor: { type: "integer", title: "Per-transfer ceiling (cents)", default: 50000 },
      holdAboveMinor: { type: "integer", title: "Hold for a person above (cents)", default: 10000 },
      dailyCapPerAgentMinor: { type: "integer", title: "Daily cap per agent (cents)", default: 100000 },
      duplicateWindowDays: { type: "integer", title: "Duplicate refund window (days)", default: 30 },
      counterpartyAllowlist: { type: "array", title: "Allowed counterparties", items: { type: "string" }, default: [] },
      pauseAgentAfterDenials: { type: "integer", title: "Pause an agent after this many denials in 24h", default: 3 },
    },
  },
};

export default manifest;
