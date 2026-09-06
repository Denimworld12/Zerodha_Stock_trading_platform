"""Broker abstraction.

One interface, three venues (paper / MetaTrader 5 / TradingView webhook), so the
identical signal object can be routed anywhere without the strategy knowing
which. That property is what makes "paper first, then live" a config change
rather than a rewrite - and it is the only safe way to graduate a strategy.
"""
from __future__ import annotations

import abc
from dataclasses import dataclass, field, asdict
from datetime import datetime, timezone
from typing import Any


@dataclass
class Signal:
    """A fully specified trade intent. Every field a broker needs, nothing else."""

    symbol: str
    side: int                      # +1 long, -1 short
    entry: float
    stop: float
    target: float
    confidence: float              # model P(win); 0.5 when unmodelled
    reason: str = ""               # human-readable SMC confluence list
    timestamp: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    timeframe: str = "15m"
    order_type: str = "market"     # market | limit
    meta: dict[str, Any] = field(default_factory=dict)

    @property
    def risk_per_unit(self) -> float:
        return abs(self.entry - self.stop)

    @property
    def rr(self) -> float:
        r = self.risk_per_unit
        return abs(self.target - self.entry) / r if r > 0 else 0.0

    def validate(self) -> None:
        """Reject structurally impossible orders before they reach a venue.

        A broker will happily accept a long whose stop sits above entry and then
        fill the stop instantly. Catching it here costs nothing; catching it in
        production costs the account.
        """
        if self.side not in (1, -1):
            raise ValueError(f"side must be +1/-1, got {self.side}")
        for name in ("entry", "stop", "target"):
            v = getattr(self, name)
            if not isinstance(v, (int, float)) or v <= 0 or v != v:
                raise ValueError(f"{name} must be a positive number, got {v!r}")
        if self.side == 1 and not (self.stop < self.entry < self.target):
            raise ValueError(f"long requires stop < entry < target, got {self.stop}/{self.entry}/{self.target}")
        if self.side == -1 and not (self.target < self.entry < self.stop):
            raise ValueError(f"short requires target < entry < stop, got {self.target}/{self.entry}/{self.stop}")

    def to_dict(self) -> dict:
        d = asdict(self)
        d["timestamp"] = self.timestamp.isoformat()
        d["rr"] = round(self.rr, 3)
        return d


@dataclass
class Fill:
    ok: bool
    broker: str
    order_id: str | None = None
    filled_qty: float = 0.0
    filled_price: float = 0.0
    message: str = ""
    raw: dict = field(default_factory=dict)


def position_size(
    equity: float,
    signal: Signal,
    risk_per_trade: float,
    max_leverage: float = 5.0,
    lot_step: float = 0.0,
) -> float:
    """Units such that a stop-out loses exactly ``risk_per_trade`` of equity.

    Fixed-fractional risk, not fixed notional: it is the only sizing rule that
    keeps the loss constant when volatility (and therefore stop distance)
    changes, which is the whole point of an ATR-derived stop.
    """
    risk_per_unit = signal.risk_per_unit
    if risk_per_unit <= 0 or equity <= 0:
        return 0.0
    qty = (equity * risk_per_trade) / risk_per_unit
    max_qty = (equity * max_leverage) / signal.entry
    qty = min(qty, max_qty)
    if lot_step > 0:
        qty = (qty // lot_step) * lot_step
    return max(0.0, qty)


class Broker(abc.ABC):
    """Minimum surface a venue must provide."""

    name = "abstract"

    @abc.abstractmethod
    def equity(self) -> float: ...

    @abc.abstractmethod
    def submit(self, signal: Signal, qty: float) -> Fill: ...

    @abc.abstractmethod
    def positions(self) -> list[dict]: ...

    def close(self, symbol: str) -> Fill:
        return Fill(False, self.name, message="close() not implemented")

    def health(self) -> dict:
        try:
            return {"broker": self.name, "ok": True, "equity": self.equity()}
        except Exception as exc:
            return {"broker": self.name, "ok": False, "error": str(exc)}
