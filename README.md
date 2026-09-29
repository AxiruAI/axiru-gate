# axiru-gate

One payment gate for every agent platform.

Paperclip caps tokens. AgentCore caps a session. OpenShell decides whether the agent may reach Stripe at all. Grok Bot and Muse ask you to tap approve. None of them decide whether a specific payment should happen under your rules, and none of them keep a receipt you can replay. This repo does that once, and plugs it into each of them.

## What is here

| Package | What it is | Status |
|---|---|---|
| `packages/core` | `@axiru/gate-core`: the evaluator (pure function, no I/O, no clock, no model) plus a `Gate` class with a session ledger, idempotency, and an optional hosted-API client that fails closed. | Built, 13 tests |
| `packages/mcp-server` | `@axiru/gate-mcp`: MCP server with `axiru_check_payment`, `axiru_report_outcome`, `axiru_show_policy`, `axiru_show_ledger`. Works with Grok Bot, Claude, Cursor, and any MCP host. | Built, 3 tests, smoke-tested over stdio |
| `packages/paperclip-plugin` | `@axiru/paperclip-plugin-gate`: registers the two tools inside a Paperclip company, opens a board task on hold, pauses an agent after repeated denials, writes every decision to the activity log and company state. | Typechecks against `@paperclipai/plugin-sdk` 2026.916.1 |
| `packages/grok-bot-plugin` | xAI marketplace bundle: `.mcp.json`, skill, `policy.json`, and a PreToolUse hook that blocks the Link or Stripe tool unless the gate said allow for that exact amount. | JSON valid, hook tested end to end |
| `packages/agentcore` | OpenAPI spec to register as an AgentCore Gateway target, plus a Python `check_and_pay()` wrapper for agents that call x402 directly. | Wrapper tested; fails closed when the API is unreachable |
| `packages/muse` | Why there is no Muse integration yet and the three options. | Notes |
| `packages/openshell` | `@axiru/openshell-middleware`: NVIDIA OpenShell supervisor middleware (gRPC) that evaluates every Stripe money-moving call inside the sandbox, pins the Idempotency-Key to the decision, and emits a quarantine signal after repeated denials. Plus the reference `policy.yaml`. | Built, 7 tests, gRPC smoke-tested |

## The rules (core policy)

per-transfer ceiling, hold threshold, daily cap per agent (rolling 24h), counterparty allowlist, duplicate window (same customer, same charge), cumulative refund never exceeds the charge, per-customer velocity, actions that always need a person (dispute, payout, transfer by default), business hours. Deny beats hold beats allow. Every applicable reason code is returned. The agent's `reason` text is stored and never evaluated.

Every decision carries policy id and version, evaluated_at, a SHA-256 fingerprint over the canonical record, and the previous fingerprint. Same inputs, same fingerprint.

## Run it

    npm install
    npm run build
    npm test

Start the MCP server for any host:

    AXIRU_POLICY_FILE=packages/grok-bot-plugin/policy.json node packages/mcp-server/dist/cli.js

Set `AXIRU_API_KEY` to use the hosted Axiru console instead of the local evaluator. Same tools, same verdicts, plus shared ledger, Slack and email approvals, and the kill switch.

## Docs

`docs/nvidia-openshell-playbook.md`: the OpenShell example PR text, the Open Secure AI Alliance application text, the kill switch mapping, and positioning lines.

## Before publishing

- Publish `@axiru/gate-core` and `@axiru/gate-mcp` to npm so `npx -y @axiru/gate-mcp` in `.mcp.json` resolves.
- Confirm the hosted API field names in `packages/core/src/gate.ts` and `packages/agentcore/openapi-axiru-gate.yaml` against the current Axiru endpoint.
- Grok Bot: verify the hook event name and the Link tool names against the current Grok Build hooks docs, then open the PR to `xai-org/plugin-marketplace` with a remote source entry pinned to a commit SHA.
- Paperclip: build with their repo's tsconfig (`pnpm --filter @paperclipai/plugin-sdk ensure-build-deps`), test in a local company, then submit to their plugin catalog and Discord.
- AgentCore: register the OpenAPI target in a test gateway and run `agent_with_gate.py` with a real key.
- OpenShell: run the middleware against a local OpenShell gateway with `policy.yaml` before opening the example PR; the supervisor middleware contract is a research preview.

No em dashes anywhere in this repo. Keep it that way in the marketplace listings.
