import { createHash } from "node:crypto";
import type { Decision, LedgerContext, PaymentIntent, Policy, ReasonCode, Verdict } from "./types.js";

const ZERO = "0".repeat(64);
const DAY_MS = 86_400_000;

/** Canonical JSON: sorted keys, no whitespace. Same input, same bytes, same hash. */
export function canonical(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}
function sortKeys(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === "object") {
    return Object.keys(v as Record<string, unknown>)
      .sort()
      .reduce<Record<string, unknown>>((acc, k) => {
        acc[k] = sortKeys((v as Record<string, unknown>)[k]);
        return acc;
      }, {});
  }
  return v;
}
export function sha256Hex(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

function validate(intent: PaymentIntent): ReasonCode | null {
  if (!intent.intent_id || !intent.agent_id || !intent.counterparty) return "INVALID_INTENT";
  if (!Number.isInteger(intent.amount_minor) || intent.amount_minor <= 0) return "INVALID_INTENT";
  if (!/^[A-Z]{3,5}$/.test(intent.currency)) return "INVALID_INTENT";
  return null;
}

/**
 * The gate. A pure function: policy, intent, prior decisions, and a timestamp in;
 * a verdict, reason codes, and a fingerprint out. No I/O, no clock, no model.
 * Deny beats hold beats allow. Every applicable code is returned, not just the first.
 */
export function evaluate(
  policy: Policy,
  intent: PaymentIntent,
  ledger: LedgerContext,
  nowIso: string,
  prevFingerprint: string = ZERO,
): Decision {
  const codes: ReasonCode[] = [];
  const invalid = validate(intent);
  if (invalid) codes.push(invalid);

  const now = Date.parse(nowIso);
  const sameCurrency = (p: { currency: string }) => p.currency === intent.currency;
  const within = (at: string, days: number) => now - Date.parse(at) <= days * DAY_MS && Date.parse(at) <= now;

  if (!invalid) {
    // 1. Ceiling
    if (policy.per_transfer_ceiling_minor !== undefined && intent.amount_minor > policy.per_transfer_ceiling_minor) {
      codes.push("AMOUNT_EXCEEDS_TRANSFER_CEILING");
    }

    // 2. Counterparty allowlist
    if (policy.counterparty_allowlist && policy.counterparty_allowlist.length > 0) {
      const ok = policy.counterparty_allowlist.some((c) => c.toLowerCase() === intent.counterparty.toLowerCase());
      if (!ok) codes.push("COUNTERPARTY_NOT_ALLOWLISTED");
    }

    // 3. Daily cap per agent (allowed intents in the last 24h plus this one)
    if (policy.daily_cap_per_agent_minor !== undefined) {
      const spent = ledger.prior
        .filter((p) => p.agent_id === intent.agent_id && p.verdict === "allow" && sameCurrency(p) && within(p.at, 1))
        .reduce((s, p) => s + p.amount_minor, 0);
      if (spent + intent.amount_minor > policy.daily_cap_per_agent_minor) codes.push("AMOUNT_EXCEEDS_DAILY_CAP");
    }

    const isReturnOfMoney = intent.action === "refund" || intent.action === "credit";

    // 4. Duplicate window: same customer, same charge, already refunded inside the window
    if (isReturnOfMoney && policy.duplicate_window_days !== undefined && intent.original_charge && intent.customer_id) {
      const chargeId = intent.original_charge.id;
      const dup = ledger.prior.some(
        (p) =>
          p.verdict === "allow" &&
          (p.action === "refund" || p.action === "credit") &&
          p.customer_id === intent.customer_id &&
          p.original_charge_id === chargeId &&
          within(p.at, policy.duplicate_window_days!),
      );
      if (dup) codes.push("DUPLICATE_WITHIN_WINDOW");
    }

    // 5. Cumulative refunds never exceed the charge
    if (isReturnOfMoney && intent.original_charge && (policy.refund_cannot_exceed_charge ?? true)) {
      const already = ledger.prior
        .filter((p) => p.verdict === "allow" && p.original_charge_id === intent.original_charge!.id && sameCurrency(p))
        .reduce((s, p) => s + p.amount_minor, 0);
      if (already + intent.amount_minor > intent.original_charge.amount_minor) codes.push("REFUND_EXCEEDS_CHARGE");
    }

    // 6. Per-customer velocity
    if (isReturnOfMoney && policy.velocity_max_per_customer !== undefined && intent.customer_id) {
      const days = policy.velocity_window_days ?? 30;
      const count = ledger.prior.filter(
        (p) => p.verdict === "allow" && (p.action === "refund" || p.action === "credit") && p.customer_id === intent.customer_id && within(p.at, days),
      ).length;
      if (count + 1 > policy.velocity_max_per_customer) codes.push("VELOCITY_EXCEEDED");
    }

    // 7. Actions that always need a person
    const alwaysHold = policy.always_hold_actions ?? ["dispute"];
    if (alwaysHold.includes(intent.action)) codes.push("ACTION_REQUIRES_HUMAN");

    // 8. Hold threshold
    if (policy.hold_above_minor !== undefined && intent.amount_minor > policy.hold_above_minor) {
      codes.push("HOLD_ABOVE_THRESHOLD");
    }

    // 9. Business hours (UTC)
    if (policy.business_hours_utc) {
      const h = new Date(now).getUTCHours();
      const { start_hour, end_hour } = policy.business_hours_utc;
      const inside = start_hour <= end_hour ? h >= start_hour && h < end_hour : h >= start_hour || h < end_hour;
      if (!inside) codes.push("OUTSIDE_BUSINESS_HOURS");
    }
  }

  const DENY: ReasonCode[] = [
    "INVALID_INTENT",
    "AMOUNT_EXCEEDS_TRANSFER_CEILING",
    "AMOUNT_EXCEEDS_DAILY_CAP",
    "COUNTERPARTY_NOT_ALLOWLISTED",
    "DUPLICATE_WITHIN_WINDOW",
    "REFUND_EXCEEDS_CHARGE",
  ];
  let verdict: Verdict = "allow";
  if (codes.some((c) => DENY.includes(c))) verdict = "deny";
  else if (codes.length > 0) verdict = "hold";
  if (codes.length === 0) codes.push("WITHIN_POLICY");

  const rationale = buildRationale(verdict, codes, intent, policy);
  const record = {
    intent_id: intent.intent_id,
    verdict,
    reason_codes: codes,
    policy_id: policy.policy_id,
    policy_version: policy.version,
    evaluated_at: nowIso,
    prev_fingerprint: prevFingerprint,
    intent: { agent_id: intent.agent_id, action: intent.action, amount_minor: intent.amount_minor, currency: intent.currency, counterparty: intent.counterparty, rail: intent.rail },
  };
  const fingerprint = sha256Hex(canonical(record));
  return {
    decision_id: `dec_${fingerprint.slice(0, 16)}`,
    intent_id: intent.intent_id,
    verdict,
    reason_codes: codes,
    rationale,
    policy_id: policy.policy_id,
    policy_version: policy.version,
    evaluated_at: nowIso,
    fingerprint,
    prev_fingerprint: prevFingerprint,
  };
}

function money(minor: number, ccy: string): string {
  return `${(minor / 100).toFixed(2)} ${ccy}`;
}

function buildRationale(verdict: Verdict, codes: ReasonCode[], i: PaymentIntent, p: Policy): string {
  const parts: string[] = [];
  for (const c of codes) {
    switch (c) {
      case "AMOUNT_EXCEEDS_TRANSFER_CEILING":
        parts.push(`amount ${money(i.amount_minor, i.currency)} exceeds per-transfer ceiling ${money(p.per_transfer_ceiling_minor!, i.currency)}`);
        break;
      case "AMOUNT_EXCEEDS_DAILY_CAP":
        parts.push(`agent ${i.agent_id} would exceed daily cap ${money(p.daily_cap_per_agent_minor!, i.currency)}`);
        break;
      case "COUNTERPARTY_NOT_ALLOWLISTED":
        parts.push(`counterparty ${i.counterparty} is not on the allowlist`);
        break;
      case "DUPLICATE_WITHIN_WINDOW":
        parts.push(`a ${i.action} to customer ${i.customer_id} for charge ${i.original_charge?.id} already ran inside ${p.duplicate_window_days} days`);
        break;
      case "REFUND_EXCEEDS_CHARGE":
        parts.push(`total refunds on charge ${i.original_charge?.id} would exceed the original ${money(i.original_charge!.amount_minor, i.currency)}`);
        break;
      case "VELOCITY_EXCEEDED":
        parts.push(`customer ${i.customer_id} has reached ${p.velocity_max_per_customer} refunds in ${p.velocity_window_days ?? 30} days`);
        break;
      case "ACTION_REQUIRES_HUMAN":
        parts.push(`${i.action} always requires a person`);
        break;
      case "HOLD_ABOVE_THRESHOLD":
        parts.push(`amount ${money(i.amount_minor, i.currency)} is above the hold threshold ${money(p.hold_above_minor!, i.currency)}`);
        break;
      case "OUTSIDE_BUSINESS_HOURS":
        parts.push(`outside business hours`);
        break;
      case "INVALID_INTENT":
        parts.push(`intent is missing required fields or has a non-positive amount`);
        break;
      case "WITHIN_POLICY":
        parts.push(`within policy ${p.policy_id} v${p.version}`);
        break;
    }
  }
  const head = verdict === "allow" ? "Allowed" : verdict === "hold" ? "Held for a person" : "Denied";
  return `${head}: ${parts.join("; ")}.`;
}
