import { evaluate } from "./evaluate.js";
import type { Decision, LedgerContext, PaymentIntent, Policy, PriorDecision } from "./types.js";

export interface GateOptions {
  /** If set, decisions are requested from the hosted Axiru API. Otherwise the local evaluator runs. */
  apiKey?: string;
  /** Defaults to https://www.axiru.com/api/v1 */
  baseUrl?: string;
  /** Policy used by the local evaluator. Required when there is no API key. */
  policy?: Policy;
  /** Clock injection for tests. */
  now?: () => string;
  /** fetch injection for tests. */
  fetchImpl?: typeof fetch;
}

/** Sensible defaults for a support agent with refund authority. Override per deployment. */
export const DEFAULT_REFUND_POLICY: Policy = {
  policy_id: "refund-default",
  version: "1.0.0",
  per_transfer_ceiling_minor: 50_000,
  hold_above_minor: 10_000,
  daily_cap_per_agent_minor: 100_000,
  duplicate_window_days: 30,
  velocity_max_per_customer: 3,
  velocity_window_days: 30,
  refund_cannot_exceed_charge: true,
  always_hold_actions: ["dispute", "payout", "transfer"],
};

/**
 * Gate = evaluator + session ledger + optional hosted API.
 * Every platform adapter in this repo talks to this one class.
 */
export class Gate {
  private readonly prior: PriorDecision[] = [];
  private readonly decisions: Decision[] = [];
  private lastFingerprint = "0".repeat(64);
  private readonly opts: Required<Pick<GateOptions, "baseUrl" | "now" | "fetchImpl">> & GateOptions;

  constructor(opts: GateOptions = {}) {
    this.opts = {
      ...opts,
      baseUrl: opts.baseUrl ?? "https://www.axiru.com/api/v1",
      now: opts.now ?? (() => new Date().toISOString()),
      fetchImpl: opts.fetchImpl ?? fetch,
    };
    if (!opts.apiKey && !opts.policy) this.opts.policy = DEFAULT_REFUND_POLICY;
  }

  get policy(): Policy | undefined {
    return this.opts.policy;
  }

  /** Feed prior decisions from your own store so windows and caps count correctly across restarts. */
  seed(prior: PriorDecision[]): void {
    this.prior.push(...prior);
  }

  ledger(): readonly Decision[] {
    return this.decisions;
  }

  async check(intent: PaymentIntent): Promise<Decision> {
    const existing = this.decisions.find((d) => d.intent_id === intent.intent_id);
    if (existing) return existing; // idempotent: same intent id, same decision

    const decision = this.opts.apiKey ? await this.remote(intent) : this.local(intent);
    this.decisions.push(decision);
    this.lastFingerprint = decision.fingerprint;
    this.prior.push({
      intent_id: intent.intent_id,
      agent_id: intent.agent_id,
      action: intent.action,
      amount_minor: intent.amount_minor,
      currency: intent.currency,
      customer_id: intent.customer_id,
      original_charge_id: intent.original_charge?.id,
      verdict: decision.verdict,
      at: decision.evaluated_at,
    });
    return decision;
  }

  private local(intent: PaymentIntent): Decision {
    const ctx: LedgerContext = { prior: this.prior };
    return evaluate(this.opts.policy!, intent, ctx, this.opts.now(), this.lastFingerprint);
  }

  private async remote(intent: PaymentIntent): Promise<Decision> {
    const res = await this.opts.fetchImpl(`${this.opts.baseUrl}/decisions`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${this.opts.apiKey}` },
      body: JSON.stringify({
        intent_id: intent.intent_id,
        agent_id: intent.agent_id,
        action: intent.action,
        amount_cents: intent.amount_minor,
        currency: intent.currency.toLowerCase(),
        counterparty: intent.counterparty,
        rail: intent.rail,
        customer_id: intent.customer_id,
        stripe_charge_id: intent.original_charge?.id,
        original_amount_cents: intent.original_charge?.amount_minor,
        reason: intent.reason,
        context: intent.context,
      }),
    });
    if (!res.ok) {
      // Fail closed. A gate that cannot reach its policy does not say yes.
      const now = this.opts.now();
      return {
        decision_id: `dec_unavailable_${Date.parse(now)}`,
        intent_id: intent.intent_id,
        verdict: "hold",
        reason_codes: ["ACTION_REQUIRES_HUMAN"],
        rationale: `Held for a person: policy service returned HTTP ${res.status}; the gate fails closed.`,
        policy_id: "remote",
        policy_version: "unknown",
        evaluated_at: now,
        fingerprint: "",
        prev_fingerprint: this.lastFingerprint,
      };
    }
    const body = (await res.json()) as Partial<Decision> & { status?: string; decision_id?: string };
    const verdict = (body.verdict ?? mapStatus(body.status)) as Decision["verdict"];
    return {
      decision_id: body.decision_id ?? `dec_${Date.parse(this.opts.now())}`,
      intent_id: intent.intent_id,
      verdict,
      reason_codes: body.reason_codes ?? ["WITHIN_POLICY"],
      rationale: body.rationale ?? "",
      policy_id: body.policy_id ?? "remote",
      policy_version: body.policy_version ?? "unknown",
      evaluated_at: body.evaluated_at ?? this.opts.now(),
      fingerprint: body.fingerprint ?? "",
      prev_fingerprint: body.prev_fingerprint ?? this.lastFingerprint,
    };
  }
}

function mapStatus(s?: string): Decision["verdict"] {
  if (s === "allowed" || s === "allow") return "allow";
  if (s === "blocked" || s === "deny" || s === "denied") return "deny";
  return "hold";
}
