#!/usr/bin/env node
// PreToolUse hook: refuses to let a payment tool run unless the agent has called
// axiru_check_payment for this session and the last verdict was allow.
// The agent cannot skip the gate by not calling it. The hook reads stdin (the tool call)
// and the session ledger file the MCP server writes; exits 2 to block.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

let input = "";
process.stdin.setEncoding("utf8");
for await (const chunk of process.stdin) input += chunk;
let call = {};
try { call = JSON.parse(input); } catch {}

const ledgerPath = process.env.AXIRU_LEDGER_FILE ?? join(tmpdir(), "axiru-gate-ledger.json");
const amount = Number(call?.tool_input?.amount_minor ?? call?.tool_input?.amount ?? NaN);

if (!existsSync(ledgerPath)) {
  process.stderr.write("Blocked: no Axiru decision exists in this session. Call axiru_check_payment first.\n");
  process.exit(2);
}
const ledger = JSON.parse(readFileSync(ledgerPath, "utf8"));
const last = ledger[ledger.length - 1];
if (!last || last.verdict !== "allow") {
  process.stderr.write(`Blocked: last Axiru decision was ${last?.verdict ?? "missing"} (${last?.reason_codes?.join(", ") ?? ""}).\n`);
  process.exit(2);
}
if (Number.isFinite(amount) && last.amount_minor !== undefined && amount !== last.amount_minor) {
  process.stderr.write(`Blocked: tool amount ${amount} does not match the allowed intent ${last.amount_minor}.\n`);
  process.exit(2);
}
process.exit(0);
