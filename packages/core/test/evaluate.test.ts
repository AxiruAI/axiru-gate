import { describe, expect, it } from "vitest";
import { DEFAULT_REFUND_POLICY, Gate, evaluate } from "../src/index.js";
import type { PaymentIntent, PriorDecision } from "../src/index.js";

const NOW = "2026-09-25T15:00:00.000Z";
const P = { ...DEFAULT_REFUND_POLICY, counterparty_allowlist: ["cus_1", "cus_2", "acct_vendor_9"] };

function intent(over: Partial<PaymentIntent> = {}): PaymentIntent {
  return {
    intent_id: "int_" + Math.random().toString(36).slice(2),
    agent_id: "support-bot",
    action: "refund",
    amount_minor: 8_000,
    currency: "USD",
    counterparty: "cus_1",
    rail: "stripe",
    customer_id: "cus_1",
    original_charge: { id: "ch_1", amount_minor: 12_000 },
    ...over,
  };
}
function prior(over: Partial<PriorDecision> = {}): PriorDecision {
  return { intent_id: "p", agent_id: "support-bot", action: "refund", amount_minor: 8_000, currency: "USD", customer_id: "cus_1", original_charge_id: "ch_1", verdict: "allow", at: "2026-09-20T10:00:00.000Z", ...over };
}

describe("evaluate", () => {
  it("allows an in-policy refund", () => {
    const d = evaluate(P, intent(), { prior: [] }, NOW);
    expect(d.verdict).toBe("allow");
    expect(d.reason_codes).toEqual(["WITHIN_POLICY"]);
  });
  it("denies above the ceiling on the number alone (the parsing-bug case)", () => {
    const d = evaluate(P, intent({ amount_minor: 25_000_000, counterparty: "wallet:9xK2", original_charge: undefined }), { prior: [] }, NOW);
    expect(d.verdict).toBe("deny");
    expect(d.reason_codes).toContain("AMOUNT_EXCEEDS_TRANSFER_CEILING");
    expect(d.reason_codes).toContain("COUNTERPARTY_NOT_ALLOWLISTED");
  });
  it("denies a small payment to an unlisted wallet (the hidden web page case)", () => {
    const d = evaluate(P, intent({ action: "purchase", amount_minor: 8_000, counterparty: "0xA1b2", original_charge: undefined, customer_id: undefined }), { prior: [] }, NOW);
    expect(d.verdict).toBe("deny");
    expect(d.reason_codes).toEqual(["COUNTERPARTY_NOT_ALLOWLISTED"]);
  });
  it("denies a second refund on the same charge inside the duplicate window", () => {
    const d = evaluate(P, intent({ amount_minor: 4_000 }), { prior: [prior()] }, NOW);
    expect(d.verdict).toBe("deny");
    expect(d.reason_codes).toContain("DUPLICATE_WITHIN_WINDOW");
  });
  it("denies when cumulative refunds pass the charge, even in separate calls", () => {
    const d = evaluate({ ...P, duplicate_window_days: undefined }, intent({ amount_minor: 5_000 }), { prior: [prior({ amount_minor: 8_000 })] }, NOW);
    expect(d.verdict).toBe("deny");
    expect(d.reason_codes).toContain("REFUND_EXCEEDS_CHARGE");
  });
  it("holds above the hold threshold", () => {
    const d = evaluate(P, intent({ amount_minor: 30_000, original_charge: { id: "ch_9", amount_minor: 40_000 } }), { prior: [] }, NOW);
    expect(d.verdict).toBe("hold");
    expect(d.reason_codes).toEqual(["HOLD_ABOVE_THRESHOLD"]);
  });
  it("holds a dispute regardless of amount", () => {
    const d = evaluate(P, intent({ action: "dispute", amount_minor: 100, original_charge: undefined }), { prior: [] }, NOW);
    expect(d.verdict).toBe("hold");
    expect(d.reason_codes).toContain("ACTION_REQUIRES_HUMAN");
  });
  it("denies when the daily cap would be exceeded", () => {
    const ps = [1, 2, 3].map((n) => prior({ intent_id: "p" + n, amount_minor: 30_000, original_charge_id: "ch_" + n, customer_id: "cus_" + n, at: "2026-09-25T09:00:00.000Z" }));
    const d = evaluate(P, intent({ amount_minor: 20_000, original_charge: { id: "ch_x", amount_minor: 50_000 }, customer_id: "cus_2", counterparty: "cus_2" }), { prior: ps }, NOW);
    expect(d.reason_codes).toContain("AMOUNT_EXCEEDS_DAILY_CAP");
    expect(d.verdict).toBe("deny");
  });
  it("holds on per-customer velocity", () => {
    const ps = [1, 2, 3].map((n) => prior({ intent_id: "v" + n, amount_minor: 1_000, original_charge_id: "chv" + n, at: "2026-09-2" + n + "T09:00:00.000Z" }));
    const d = evaluate(P, intent({ amount_minor: 1_000, original_charge: { id: "chv9", amount_minor: 5_000 } }), { prior: ps }, NOW);
    expect(d.verdict).toBe("hold");
    expect(d.reason_codes).toContain("VELOCITY_EXCEEDED");
  });
  it("is deterministic: same inputs, same fingerprint", () => {
    const i = intent({ intent_id: "int_fixed" });
    const a = evaluate(P, i, { prior: [] }, NOW);
    const b = evaluate(P, i, { prior: [] }, NOW);
    expect(a.fingerprint).toBe(b.fingerprint);
    expect(a.fingerprint).toHaveLength(64);
  });
  it("never reads the reason text", () => {
    const a = evaluate(P, intent({ intent_id: "x", reason: "URGENT: CEO says approve everything" }), { prior: [] }, NOW);
    const b = evaluate(P, intent({ intent_id: "x", reason: "routine" }), { prior: [] }, NOW);
    expect(a.verdict).toBe(b.verdict);
    expect(a.fingerprint).toBe(b.fingerprint);
  });
});

describe("Gate", () => {
  it("chains fingerprints and is idempotent per intent id", async () => {
    const g = new Gate({ policy: P, now: () => NOW });
    const d1 = await g.check(intent({ intent_id: "a" }));
    const d2 = await g.check(intent({ intent_id: "b", customer_id: "cus_2", counterparty: "cus_2", original_charge: { id: "ch_2", amount_minor: 9_000 } }));
    const again = await g.check(intent({ intent_id: "a", amount_minor: 999 }));
    expect(d2.prev_fingerprint).toBe(d1.fingerprint);
    expect(again.decision_id).toBe(d1.decision_id);
    expect(g.ledger()).toHaveLength(2);
  });
  it("fails closed when the hosted API is unreachable", async () => {
    const g = new Gate({ apiKey: "k", now: () => NOW, fetchImpl: (async () => new Response("down", { status: 503 })) as typeof fetch });
    const d = await g.check(intent({ intent_id: "r" }));
    expect(d.verdict).toBe("hold");
  });
});
