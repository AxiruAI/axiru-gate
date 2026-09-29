import type { PaperclipPluginManifestV1 } from "@paperclipai/plugin-sdk";

export const PLUGIN_ID = "axiru.payment-gate";
export const TOOL_CHECK = "axiru_check_payment";
export const TOOL_REPORT = "axiru_report_outcome";

const manifest: PaperclipPluginManifestV1 = {
  id: PLUGIN_ID,
  apiVersion: 1,
  version: "0.1.0",
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
