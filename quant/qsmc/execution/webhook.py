"""Outbound HMAC-signed webhook broker.

TradingView is often described as an execution venue; it is not. TradingView
*emits* alerts and cannot accept orders from an external program. So the
integration runs in two directions and this module owns the outbound half:

    qsmc engine --(signed JSON)--> relay / broker bridge --> venue

Anything that accepts a JSON webhook works here: a broker bridge, an n8n/Zapier
relay, a self-hosted MT5 EA listener, or a Discord/Slack channel for a human to
approve manually before it becomes real money.

The payload is signed with HMAC-SHA256 over the exact bytes sent, and carries a
timestamp and a unique id. Without those, anyone who learns the URL can place
trades in your account, and a captured request can be replayed forever.
"""
from __future__ import annotations

import hashlib
import hmac
import json
import os
import time
import uuid

import requests

from .base import Broker, Fill, Signal


def sign_payload(secret: str, body: bytes) -> str:
    return hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()


def verify_signature(secret: str, body: bytes, signature: str, ts: str,
                     max_age: int = 300) -> tuple[bool, str]:
    """Constant-time signature check plus a replay window."""
    try:
        age = abs(time.time() - float(ts))
    except (TypeError, ValueError):
        return False, "missing or malformed timestamp"
    if age > max_age:
        return False, f"stale request ({age:.0f}s old, max {max_age}s)"
    expected = sign_payload(secret, body)
    if not hmac.compare_digest(expected, signature or ""):
        return False, "signature mismatch"
    return True, "ok"


class WebhookBroker(Broker):
    name = "webhook"

    def __init__(
        self,
        url: str | None = None,
        secret: str | None = None,
        timeout: float = 10.0,
        dry_run: bool = True,
    ):
        self.url = url or os.getenv("QSMC_WEBHOOK_URL", "")
        self.secret = secret or os.getenv("QSMC_WEBHOOK_SECRET", "")
        self.timeout = timeout
        self.dry_run = dry_run
        self.sent: list[dict] = []

    def equity(self) -> float:
        # A fire-and-forget relay has no account to query; the caller supplies
        # equity from wherever the money actually lives.
        raise NotImplementedError("WebhookBroker has no account; pass equity explicitly")

    def positions(self) -> list[dict]:
        return []

    def submit(self, signal: Signal, qty: float) -> Fill:
        signal.validate()
        payload = {
            "id": str(uuid.uuid4()),
            "ts": time.time(),
            "action": "open",
            "qty": float(qty),
            **signal.to_dict(),
        }
        body = json.dumps(payload, separators=(",", ":"), sort_keys=True).encode()
        headers = {
            "Content-Type": "application/json",
            "X-QSMC-Timestamp": str(payload["ts"]),
            "X-QSMC-Signature": sign_payload(self.secret, body) if self.secret else "",
        }
        self.sent.append(payload)

        if self.dry_run or not self.url:
            return Fill(True, self.name, order_id=payload["id"], filled_qty=float(qty),
                        message="dry_run: payload built and signed but not sent",
                        raw=payload)
        try:
            r = requests.post(self.url, data=body, headers=headers, timeout=self.timeout)
        except requests.RequestException as exc:
            return Fill(False, self.name, message=f"transport error: {exc}", raw=payload)
        return Fill(r.status_code < 400, self.name, order_id=payload["id"],
                    filled_qty=float(qty), message=f"HTTP {r.status_code}: {r.text[:200]}",
                    raw=payload)
