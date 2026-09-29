import { describe, expect, it } from "vitest";
import { Gate, DEFAULT_REFUND_POLICY } from "@axiru/gate-core";
import { checkPayment, reportOutcome } from "../src/handlers.js";

const ctx = () => ({ gate: new Gate({ policy: { ...DEFAULT_REFUND_POLICY, counterparty_allowlist: ["cus_1"] } }), outcomes: new Map() });

describe("mcp handlers", () => {
  it("returns an instruction the model can follow", async () => {
    const c = ctx();
    const d = await checkPayment(c, { action: "refund", amount_minor: 8000, currency: "usd", counterparty: "cus_1", customer_id: "cus_1", original_charge_id: "ch_1", original_charge_amount_minor: 12000 });
    expect(d.verdict).toBe("allow");
    expect(d.instruction).toMatch(/Proceed/);
    const r = reportOutcome(c, { intent_id: d.intent_id, status: "succeeded", provider_ref: "re_1" });
    expect(r.ok).toBe(true);
  });
  it("flags an execution that had no decision in front of it", () => {
    const r = reportOutcome(ctx(), { intent_id: "ghost", status: "succeeded" });
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/NEVER_AUTHORIZED/);
  });
  it("flags an execution after a deny", async () => {
    const c = ctx();
    const d = await checkPayment(c, { action: "purchase", amount_minor: 500, currency: "USD", counterparty: "evil.example" });
    expect(d.verdict).toBe("deny");
    const r = reportOutcome(c, { intent_id: d.intent_id, status: "succeeded" });
    expect(r.message).toMatch(/EXECUTED_WITHOUT_ALLOW/);
  });
});
