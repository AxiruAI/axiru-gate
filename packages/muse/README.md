# Axiru gate and Meta Muse

Status as of 25 Sep 2026: no third-party path yet.

What Muse does today: purchases go through Stripe Link, the user taps approve on every transaction total in chat, Link issues a single-use card scoped to that purchase, and a separate Meta system called Sentinel sits between Muse and the internet, allowing low-risk actions and stopping to ask before anything consequential. Connectors are chosen by the user from Meta's list (Gmail, Google Calendar, OpenTable, Plaid, and others). Meta has not published a developer program, an MCP connector path, or a policy hook for Sentinel.

So there are three honest options:

1. Wait for connectors. If Meta opens Muse to third-party MCP servers, `@axiru/gate-mcp` works unchanged: same four tools, same skill text as the Grok Bot plugin (`packages/grok-bot-plugin/skills/axiru-gate/SKILL.md`), `platform: "muse"`. The only Muse-specific work is the connector listing.

2. Sit on the merchant side. Muse buys from businesses through Link. A business that sells to agents can run the gate on its own refund and payout side, which is where the money actually leaves. That is the Stripe integration Axiru already has; Muse changes nothing there.

3. Talk to Meta about Sentinel. Sentinel is described as distinguishing read from write access with time-limited permissions and asking before consequential actions. That is the same shape as the gate: a policy layer outside the model. If Meta ever exposes Sentinel policies to users or enterprises, a deterministic spend policy is the obvious first plug-in. There is no public contact for this today; the Stripe Link team is the nearest door, since Link is the rail Muse uses and Stripe has already said spending limits set once are coming.

What not to do: build anything Muse-specific now. The MCP server is the asset. Keep it ready and keep the skill text platform-neutral.
