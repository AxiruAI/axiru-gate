/** A request to move money, submitted by an agent before the payment tool runs. */
export interface PaymentIntent {
  /** Stable id supplied by the caller. Used for idempotency and receipts. */
  intent_id: string;
  /** Which agent is asking. */
  agent_id: string;
  /** refund | credit | payout | transfer | purchase | dispute */
  action: PaymentAction;
  /** Minor units (cents). Integers only. */
  amount_minor: number;
  /** ISO 4217, upper case. */
  currency: string;
  /** Who receives the money: a merchant, vendor id, wallet, or customer id. */
  counterparty: string;
  /** stripe | x402 | usdc | card | link | other */
  rail: string;
  /** Free text from the agent. Never an input to the decision. Stored on the receipt. */
  reason?: string;
  /** For refunds: the original charge id and its amount, so the gate can enforce refund <= charge. */
  original_charge?: { id: string; amount_minor: number };
  /** For refunds and credits: the customer the money goes back to. */
  customer_id?: string;
  /** Platform context. Not an input to the decision. */
  context?: Record<string, unknown>;
}

export type PaymentAction = "refund" | "credit" | "payout" | "transfer" | "purchase" | "dispute";

export interface Policy {
  policy_id: string;
  version: string;
  /** Deny any single intent above this amount (minor units). */
  per_transfer_ceiling_minor?: number;
  /** Hold for a human above this amount (minor units). */
  hold_above_minor?: number;
  /** Deny once an agent's allowed total in a rolling 24h window would exceed this (minor units). */
  daily_cap_per_agent_minor?: number;
  /** If set, counterparties not in this list are denied. Case-insensitive exact match. */
  counterparty_allowlist?: string[];
  /** Deny a second refund or credit to the same customer for the same charge inside this window. */
  duplicate_window_days?: number;
  /** Hold once a customer has received this many refunds or credits inside velocity_window_days. */
  velocity_max_per_customer?: number;
  velocity_window_days?: number;
  /** Refunds may never exceed the original charge, cumulatively. Default true. */
  refund_cannot_exceed_charge?: boolean;
  /** Actions that always hold for a person, regardless of amount. Default: dispute. */
  always_hold_actions?: PaymentAction[];
  /** Optional business hours in UTC. Outside them, hold. */
  business_hours_utc?: { start_hour: number; end_hour: number };
}

export type Verdict = "allow" | "hold" | "deny";

export type ReasonCode =
  | "AMOUNT_EXCEEDS_TRANSFER_CEILING"
  | "AMOUNT_EXCEEDS_DAILY_CAP"
  | "COUNTERPARTY_NOT_ALLOWLISTED"
  | "DUPLICATE_WITHIN_WINDOW"
  | "REFUND_EXCEEDS_CHARGE"
  | "VELOCITY_EXCEEDED"
  | "HOLD_ABOVE_THRESHOLD"
  | "ACTION_REQUIRES_HUMAN"
  | "OUTSIDE_BUSINESS_HOURS"
  | "INVALID_INTENT"
  | "WITHIN_POLICY";

/** What the gate already knows: prior decisions the rules need to count. */
export interface LedgerContext {
  /** Prior allowed intents. The gate only needs amount, agent, customer, charge, and time. */
  prior: PriorDecision[];
}

export interface PriorDecision {
  intent_id: string;
  agent_id: string;
  action: PaymentAction;
  amount_minor: number;
  currency: string;
  customer_id?: string;
  original_charge_id?: string;
  verdict: Verdict;
  /** ISO timestamp. */
  at: string;
}

export interface Decision {
  decision_id: string;
  intent_id: string;
  verdict: Verdict;
  reason_codes: ReasonCode[];
  /** One sentence a person can read. Built from the codes, not from the agent's text. */
  rationale: string;
  policy_id: string;
  policy_version: string;
  /** ISO timestamp handed in by the caller. The evaluator never reads the wall clock. */
  evaluated_at: string;
  /** SHA-256 over the canonical decision record. */
  fingerprint: string;
  /** Fingerprint of the previous decision in this session, or 64 zeros. */
  prev_fingerprint: string;
}
