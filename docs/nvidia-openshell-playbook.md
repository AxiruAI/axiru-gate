# Nvidia Open Agent Safety Platform: what to do, in order

Dated 29 Sep 2026. Nothing here is signed with Marcos's name; everything goes out as Axiru until 19 Oct.

## 1. Community example PR to NVIDIA/OpenShell (this week)

Repo: github.com/NVIDIA/OpenShell. Examples live in `examples/`, each a folder with a README, `policy.yaml`, and source. The supervisor middleware example is `examples/supervisor-middleware-content-guard`; ours follows the same shape. Contributions need a DCO sign-off (`git commit -s`) from the committing identity; use the Axiru GitHub account.

Folder to add: `examples/supervisor-middleware-payment-gate/` containing `README.md`, `policy.yaml`, `gateway.toml.snippet`, and a pointer to the `@axiru/openshell-middleware` package (or vendor `src/` if they prefer self-contained examples; the content-guard example is self-contained, so offer both).

PR title: Add supervisor middleware example: payment gate for agents that move money

PR description:

> This example shows a supervisor middleware for agents that hold Stripe credentials. OpenShell already controls whether the sandbox may reach api.stripe.com. This middleware decides whether a specific money-moving call should happen: it parses refunds, credits, transfers, and payouts from the request body, evaluates a deterministic policy (per-transfer ceiling, hold threshold, daily cap per sandbox, duplicate window, counterparty allowlist), and returns DECISION_ALLOW or DECISION_DENY in the PRE_CREDENTIALS phase. On allow it writes a Stripe Idempotency-Key tied to the decision so a retry cannot become a second refund. On repeated denials it emits a `quarantine_recommended` finding. It fails closed.
>
> It is included because payment tools are where an agent mistake becomes a loss with no attacker involved (a parsing error that refunds the whole balance, a duplicate refund after a retry), and the sandbox boundary alone does not see the amount. The evaluator is a pure function with no model in the decision path, so decisions replay bit for bit.
>
> Tests cover the parser, pass-through, allow with idempotency pinning, duplicate denial, unspecified amount, and the quarantine signal. The proto contract is vendored from main as of this PR.

Before opening: run their `mise` toolchain and `cargo fmt` if you vendor Rust; for a Node example, check whether maintainers accept non-Rust examples (the content-guard upstream is Python, so a Node service should be fine). Read `CONTRIBUTING.md` and `STYLEGUIDE.md` first.

## 2. Open Secure AI Alliance membership (this week, Axiru entity)

The alliance is governed by the Linux Foundation and lists 120+ organizations. Membership is by application on the alliance site (search "Open Secure AI Alliance join"). Apply as Axiru, Inc. with the Axiru contact address, not Marcos's. Text for the "what you contribute" field:

> Axiru contributes a deterministic authorization layer for agent payments: a pure-function policy evaluator (no model in the decision path), an MCP server, an OpenShell supervisor middleware, and adapters for Paperclip, Amazon Bedrock AgentCore, and Grok Bot. We are interested in the working groups on agent identity (KYA), runtime policy enforcement, and incident data sharing, and in contributing a reference schema for money-moving actions and their receipts.

Do not put a person's name in the application. If the form requires a named representative, wait until 19 Oct.

## 3. Kill switch mapping (already built, wire it in the console)

Outbound: the middleware emits `axiru.quarantine_recommended` (finding, severity critical, plus metadata) after N denials in 24h. OpenShell writes findings to the gateway audit log; Sentry consumes gateway telemetry. Nothing else needed on our side for the signal to exist.

Inbound: when OpenShell or Sentry quarantines a sandbox, the console should freeze that agent's payment authority. Implementation: an inbound webhook `/api/v1/agents/{agent_id}/freeze` accepting `{ "source": "openshell", "sandbox_id": "...", "reason": "..." }`, which sets the agent to quarantined in Axiru and records the event in the ledger. Map `sandbox_id` to `agent_id` at connector setup. This is a console change, not a plugin change.

Line for the docs: two kill switches that agree beat one.

## 4. Positioning lines (use from today)

Nvidia's own words, from the launch: enterprises need an enforceable boundary outside of the model and agent harness. Quote it, cite the Nvidia newsroom, 28 Sep 2026.

Ours:
- Containment stops the agent leaving the box. The gate stops the money leaving the company. Both, not either.
- Nvidia governs the box. Axiru governs the money inside it.
- OpenShell decides whether the agent may talk to Stripe. Axiru decides whether this refund should happen.
- Give agents the gate, not the keys, is now a network rule, not a prompt.

Where each goes: the first on the homepage how-it-works section under a new "Works with" row (OpenShell, AgentCore, Paperclip, Grok Bot); the second in the deck after the Cyera slide; the third in the OpenShell example README (already there); the fourth in the X thread.

## 5. X posts from @AxiruAI (bot drafts, Marcos approves)

Thread opener: "Nvidia shipped a hardware watchdog that quarantines a rogue agent in milliseconds. Good. It cannot tell a 45 dollar refund from a 250,000 dollar one. We built the middleware that can, and it runs inside OpenShell. [link to example]"

Reply to the Nvidia announcement post: "Containment stops the agent leaving the box. A policy on the Stripe call stops the money leaving the company. We shipped an OpenShell supervisor middleware for exactly that: parses the refund, checks the ceiling and the duplicate window, denies before credentials attach. Fails closed."

## 6. Who it is for and who it is not

For: enterprises already running agents in OpenShell (the launch names Scale AI, SpaceXAI with Cursor and Grok, financial services orgs). Those teams have security engineers who will read a policy.yaml.

Not for: the refund-wedge buyer at a DTC brand running Sierra or Decagon. They will never see OpenShell. For them the story is the same product, different door (the MCP server and the Stripe OAuth connector). Do not let the Nvidia news pull the homepage toward datacenter language.
