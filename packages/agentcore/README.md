# Axiru gate for Amazon Bedrock AgentCore

AgentCore Payments caps a session on one wallet. Axiru decides each payment against company policy and keeps the receipt. Both, not either.

Two integration paths:

1. Gateway target (no code). Register `openapi-axiru-gate.yaml` as an OpenAPI target on your AgentCore Gateway with your Axiru API key as the outbound credential. Every agent behind the gateway gets `axiru_check_payment` and `axiru_report_outcome` as tools. Add one line to the agent's instructions: "Before any payment, call axiru_check_payment and follow the verdict."

2. Code. `agent_with_gate.py` wraps any x402 payment call in `check_and_pay()`. Allow proceeds and reports the outcome. Hold and deny return without paying. Any error from the policy service becomes a hold, never an allow.

Belt and braces: keep the AgentCore PaymentSession budget as the outer limit. Axiru is the inner policy. If the session budget and the policy ever disagree, the stricter one wins because both have to say yes.

Where this adds what AgentCore lacks: counterparty allowlists, per-agent daily caps across sessions, hold-for-a-person and dual approval, org-wide kill switch, and a hash-chained decision ledger a compliance team can export.

Note: the request and response field names in the OpenAPI spec match the Axiru API as documented on axiru.com. If your account uses a different endpoint version, edit the `servers` block and the two paths; the shape is the same.
