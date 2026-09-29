import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { checkPayment, makeContext, reportOutcome, showLedger, type ToolContext } from "./handlers.js";

export function buildServer(ctx: ToolContext = makeContext()): McpServer {
  const server = new McpServer({ name: "axiru-gate", version: "0.1.0" });

  server.tool(
    "axiru_check_payment",
    "Call this BEFORE any tool that moves money (refund, credit, payout, transfer, purchase, dispute). Returns allow, hold, or deny with reason codes and a receipt. The decision is deterministic and does not read the reason text. Follow the returned instruction exactly.",
    {
      action: z.enum(["refund", "credit", "payout", "transfer", "purchase", "dispute"]),
      amount_minor: z.number().int().positive().describe("Amount in minor units (cents). 1250 = 12.50"),
      currency: z.string().length(3).describe("ISO 4217 code, e.g. USD"),
      counterparty: z.string().describe("Who receives the money: merchant domain, vendor id, wallet, or customer id"),
      rail: z.string().optional().describe("stripe | link | x402 | usdc | card"),
      agent_id: z.string().optional(),
      intent_id: z.string().optional().describe("Reuse the same id when retrying; the gate is idempotent per id"),
      reason: z.string().optional().describe("Why the agent wants to pay. Recorded, never evaluated."),
      customer_id: z.string().optional().describe("For refunds and credits"),
      original_charge_id: z.string().optional().describe("For refunds: the charge being refunded"),
      original_charge_amount_minor: z.number().int().positive().optional(),
      platform: z.string().optional().describe("grok-bot | muse | paperclip | agentcore | other"),
    },
    async (input) => {
      const d = await checkPayment(ctx, input);
      return { content: [{ type: "text", text: JSON.stringify(d, null, 2) }] };
    },
  );

  server.tool(
    "axiru_report_outcome",
    "Call this AFTER the payment tool returns, with the same intent_id. Links the provider result to the decision so the ledger can show decision, execution, and any gap between them.",
    {
      intent_id: z.string(),
      status: z.string().describe("succeeded | failed | pending | not_executed"),
      provider_ref: z.string().optional().describe("Refund id, transaction hash, or order id"),
    },
    async (input) => ({ content: [{ type: "text", text: JSON.stringify(reportOutcome(ctx, input)) }] }),
  );

  server.tool("axiru_show_policy", "Show the active policy so the user can see the limits before the agent acts.", {}, async () => ({
    content: [{ type: "text", text: JSON.stringify(ctx.gate.policy ?? { mode: "hosted", note: "Policy is managed in the Axiru console." }, null, 2) }],
  }));

  server.tool("axiru_show_ledger", "List this session's decisions with fingerprints and reported outcomes.", {}, async () => ({
    content: [{ type: "text", text: JSON.stringify(showLedger(ctx), null, 2) }],
  }));

  return server;
}
