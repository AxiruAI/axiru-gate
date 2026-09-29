# Axiru payment gate for NVIDIA OpenShell

Nvidia governs the box. Axiru governs the money inside it.

OpenShell decides whether an agent may reach api.stripe.com at all. This middleware decides whether a specific call should happen: it reads the amount, the charge, and the counterparty from the Stripe request, evaluates the company's policy (ceiling, hold threshold, daily cap, duplicate window, allowlist), and returns allow or deny before the request leaves the sandbox. The agent cannot skip it because the sandbox routes the call through it.

## What it does

- Implements the `openshell.middleware.v1.SupervisorMiddleware` gRPC service (Describe, ValidateConfig, EvaluateHttpRequest) in the PRE_CREDENTIALS phase, so the decision happens before Stripe credentials are attached.
- Parses Stripe's form-encoded API for money-moving endpoints: refunds, charge refunds, customer balance credits, transfers, payouts, dispute updates, issuing approvals. Reads and other endpoints pass through.
- On allow, writes `Idempotency-Key: <decision_id>` onto the request, so a retry of the same decision cannot become a second refund.
- On deny or hold, returns DECISION_DENY with a reason code (`AXIRU_DENY`, `AXIRU_HOLD`, `AMOUNT_UNSPECIFIED`) and the Axiru rationale. A refund with no amount is a full refund in Stripe's API; the middleware denies it and asks for an explicit amount.
- Every result carries metadata (`axiru.decision_id`, `axiru.verdict`, `axiru.policy`, `axiru.fingerprint`, `axiru.reason_codes`) and findings that land in the gateway audit log.
- After three denials from one sandbox in 24h it adds a `axiru.quarantine_recommended` finding with severity critical. That is the signal an operator, or Sentry, can act on.
- Fails closed: any middleware error is a deny, and `policy.yaml` also sets `on_error: fail_closed`.

## Run it

    npm install && npm run build
    AXIRU_MW_BIND=0.0.0.0:50052 node dist/cli.js

Register it in the gateway (see `gateway.toml.snippet`), then create a sandbox with `policy.yaml`. Set `AXIRU_API_KEY` to send decisions to the hosted Axiru console instead of the local evaluator; the middleware behaves the same and the console adds Slack or email approvals for holds, shared ledger, and the kill switch.

## Limits

- OpenShell supervisor middleware is a research preview; the proto contract may change. The vendored protos match the OpenShell main branch as of 29 Sep 2026.
- The local evaluator cannot see the original charge amount from a refund request, so the "cumulative refunds never exceed the charge" rule needs the hosted API (which looks the charge up) or a Stripe read in front of it. Duplicate window, ceiling, cap, and allowlist all work locally.
- Only Stripe is mapped today. Adding another rail is one entry in `src/stripe.ts` style: a path regex and a field mapping.
- The `binaries` list in `policy.yaml` is an example. List the binaries your agent actually uses.

## Tests

`npm test` covers the parser, pass-through, allow with idempotency pinning, duplicate denial, unspecified amount, and the quarantine signal. A gRPC smoke test against the real service is in the repo history.
