"""Paper broker that trades into the existing Express + Mongo app.

Routing paper fills through the same `/order` endpoint the dashboard's Buy/Sell
windows use means the bot's positions appear in Holdings, Positions, Orders and
Funds with no extra UI: the account you watch while paper trading is the same
account object you watch when live. That is deliberate - most paper-to-live
failures are not strategy failures, they are "the live path was never exercised".
"""
from __future__ import annotations

import os

import requests

from .base import Broker, Fill, Signal


class PaperBroker(Broker):
    name = "paper"

    def __init__(
        self,
        base_url: str | None = None,
        timeout: float = 10.0,
        session: requests.Session | None = None,
    ):
        self.base_url = (base_url or os.getenv("QSMC_API_URL", "http://localhost:3002")).rstrip("/")
        self.timeout = timeout
        self.http = session or requests.Session()

    # -- account -----------------------------------------------------------
    def equity(self) -> float:
        r = self.http.get(f"{self.base_url}/funds", timeout=self.timeout)
        r.raise_for_status()
        f = r.json()
        return float(f.get("availableCash", 0.0)) + float(f.get("usedMargin", 0.0))

    def positions(self) -> list[dict]:
        r = self.http.get(f"{self.base_url}/position", timeout=self.timeout)
        r.raise_for_status()
        return r.json()

    def orders(self) -> list[dict]:
        r = self.http.get(f"{self.base_url}/order", timeout=self.timeout)
        r.raise_for_status()
        return r.json()

    # -- trading -----------------------------------------------------------
    def submit(self, signal: Signal, qty: float) -> Fill:
        signal.validate()
        if qty <= 0:
            return Fill(False, self.name, message="qty must be > 0")

        payload = {
            "name": signal.symbol,
            "qty": float(qty),
            "price": float(signal.entry),
            "mode": "BUY" if signal.side == 1 else "SELL",
            "stopLoss": float(signal.stop),
            "target": float(signal.target),
        }
        try:
            r = self.http.post(f"{self.base_url}/order", json=payload, timeout=self.timeout)
        except requests.RequestException as exc:
            return Fill(False, self.name, message=f"transport error: {exc}")

        if r.status_code >= 400:
            return Fill(False, self.name, message=f"HTTP {r.status_code}: {r.text[:200]}")
        return Fill(
            ok=True, broker=self.name, filled_qty=float(qty),
            filled_price=float(signal.entry),
            message=r.text[:200], raw=payload,
        )

    def close(self, symbol: str, live_price: float | None = None) -> Fill:
        """Close every open order for ``symbol``.

        The backend's DELETE /order/:id requires a livePrice in the body to mark
        the P&L, so one must be supplied or discovered from the open order.
        """
        try:
            open_orders = [o for o in self.orders() if o.get("name") == symbol]
        except requests.RequestException as exc:
            return Fill(False, self.name, message=f"could not list orders: {exc}")
        if not open_orders:
            return Fill(False, self.name, message=f"no open orders for {symbol}")

        closed = 0
        for o in open_orders:
            px = live_price if live_price is not None else float(o.get("price", 0.0))
            r = self.http.delete(
                f"{self.base_url}/order/{o['_id']}",
                json={"livePrice": px}, timeout=self.timeout,
            )
            closed += int(r.status_code < 400)
        return Fill(closed > 0, self.name, filled_qty=float(closed),
                    message=f"closed {closed}/{len(open_orders)} orders for {symbol}")
