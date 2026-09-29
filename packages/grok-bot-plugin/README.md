# Axiru payment gate for Grok Bot

Set the rules once, stop tapping approve.

Grok Bot can buy things with Link. Today every purchase asks you to tap approve. This plugin puts a policy in front of that: a per-purchase ceiling, a daily cap, an optional merchant allowlist, and a hold threshold above which you still get asked. Below the line, the bot proceeds. Above it, it stops. Every decision has a receipt.

## What is in the plugin

- `.mcp.json` starts the Axiru gate MCP server with four tools: `axiru_check_payment`, `axiru_report_outcome`, `axiru_show_policy`, `axiru_show_ledger`.
- `skills/axiru-gate/SKILL.md` tells the bot to call the gate before any checkout and what to do with allow, hold, and deny.
- `hooks/hooks.json` is the enforcement: a PreToolUse hook on Link and Stripe tools that blocks the call unless the gate said allow for a matching amount. The skill asks; the hook makes.
- `policy.json` is your limits. Edit the numbers. Cents, not dollars.

## Install

Until it is in the xAI marketplace, add it from this repo:

    grok plugin add https://github.com/AxiruAI/axiru-gate --path packages/grok-bot-plugin

Then edit `policy.json`. The hook matcher assumes the Link and Stripe tool names contain `link` or `stripe`; adjust the regex in `hooks/hooks.json` to the exact tool names your Grok Bot exposes.

## Hosted mode

Set `AXIRU_API_KEY` in `.mcp.json` env to send decisions to the Axiru console instead of evaluating locally. Same tools, same verdicts, plus a shared ledger and approvals in Slack or email.

## Check against the xAI docs before submitting

The hook event name and stdin shape follow the Claude Code plugin convention that the marketplace README describes. Verify `PreToolUse` and the `tool_input` field names against the current Grok Build hooks documentation, and verify the exact Link tool names, before opening the marketplace PR.
