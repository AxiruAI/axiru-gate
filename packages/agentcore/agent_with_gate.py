"""
Amazon Bedrock AgentCore agent with the Axiru gate in front of every x402 payment.

AgentCore Payments enforces a session budget (max spend, expiry) on one wallet.
Axiru enforces company policy (ceiling, daily cap, allowlist, hold threshold) across every
agent and rail, and records a receipt. Use both: AgentCore caps the session, Axiru decides
the payment.

Two ways to wire it:
  A. Gateway target: register openapi-axiru-gate.yaml as an OpenAPI target on your
     AgentCore Gateway. Every agent then sees axiru_check_payment as a tool. No code.
  B. Code: the check_and_pay() helper below, for agents that call the x402 client directly.

This file shows B. It uses only the standard library so it runs anywhere.
"""
from __future__ import annotations

import json
import os
import urllib.request
import uuid

AXIRU_BASE = os.environ.get("AXIRU_BASE_URL", "https://www.axiru.com/api/v1")
AXIRU_KEY = os.environ.get("AXIRU_API_KEY", "")


def axiru_check(action: str, amount_cents: int, currency: str, counterparty: str, *,
                agent_id: str, rail: str = "x402", session_id: str | None = None,
                reason: str | None = None, intent_id: str | None = None) -> dict:
    """POST an intent to Axiru. Fails closed: any error becomes a hold."""
    body = {
        "intent_id": intent_id or f"ac_{uuid.uuid4().hex[:16]}",
        "agent_id": agent_id,
        "action": action,
        "amount_cents": amount_cents,
        "currency": currency.lower(),
        "counterparty": counterparty,
        "rail": rail,
        "reason": reason,
        "context": {"platform": "agentcore", "session_id": session_id},
    }
    req = urllib.request.Request(
        f"{AXIRU_BASE}/decisions",
        data=json.dumps(body).encode(),
        headers={"content-type": "application/json", "authorization": f"Bearer {AXIRU_KEY}"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=10) as r:
            return json.load(r)
    except Exception as exc:  # network, 5xx, bad JSON: never say yes on a failure
        return {"verdict": "hold", "reason_codes": ["ACTION_REQUIRES_HUMAN"],
                "rationale": f"Held for a person: policy service unreachable ({exc}).", "decision_id": None}


def check_and_pay(pay_fn, *, agent_id: str, endpoint_url: str, amount_cents: int,
                  currency: str = "USD", session_id: str | None = None, reason: str | None = None):
    """
    pay_fn: your existing x402 payment call, e.g. a closure over the AgentCore payments client.
    Returns (decision, payment_result_or_None).
    """
    decision = axiru_check("purchase", amount_cents, currency, endpoint_url,
                           agent_id=agent_id, session_id=session_id, reason=reason)
    if decision["verdict"] != "allow":
        return decision, None
    result = pay_fn()
    # Report the outcome so the receipt shows execution, not just the decision.
    if decision.get("decision_id"):
        req = urllib.request.Request(
            f"{AXIRU_BASE}/decisions/{decision['decision_id']}/outcome",
            data=json.dumps({"status": "succeeded", "provider_ref": str(result)[:200]}).encode(),
            headers={"content-type": "application/json", "authorization": f"Bearer {AXIRU_KEY}"},
            method="POST",
        )
        try:
            urllib.request.urlopen(req, timeout=10).read()
        except Exception:
            pass
    return decision, result


if __name__ == "__main__":
    # Example: an agent about to pay a paid API endpoint 0.40 USD inside an AgentCore PaymentSession.
    def fake_x402_payment():
        return {"receipt": "x402_demo_receipt"}

    decision, result = check_and_pay(
        fake_x402_payment,
        agent_id="research-agent-01",
        endpoint_url="https://api.example.com/v1/search",
        amount_cents=40,
        session_id="ps_demo",
        reason="fetching market data for task 1234",
    )
    print(json.dumps({"decision": decision, "result": result}, indent=2))
