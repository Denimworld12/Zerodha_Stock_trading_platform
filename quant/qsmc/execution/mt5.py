"""MetaTrader 5 adapter - the live venue.

Requires ``pip install MetaTrader5`` and a running, logged-in MT5 terminal on the
same host (Windows, or Linux under Wine). The import is deferred so the rest of
the package installs and tests anywhere.

Safety posture: this class refuses to trade unless ``live=True`` is passed
explicitly. A demo account and a funded account differ by one login, and the
default must never be the one that spends money.
"""
from __future__ import annotations

from .base import Broker, Fill, Signal


class MT5Broker(Broker):
    name = "mt5"

    def __init__(
        self,
        live: bool = False,
        deviation: int = 20,
        magic: int = 990101,
        filling: str | None = None,
    ):
        self.live = live
        self.deviation = deviation
        self.magic = magic          # tags our orders so they can be told apart
        self.filling = filling
        self._mt5 = None

    # -- terminal ----------------------------------------------------------
    @property
    def mt5(self):
        if self._mt5 is None:
            try:
                import MetaTrader5 as mt5
            except ImportError as exc:                       # pragma: no cover
                raise RuntimeError(
                    "MetaTrader5 not installed. `pip install MetaTrader5` on a "
                    "Windows host running the terminal."
                ) from exc
            if not mt5.initialize():
                raise RuntimeError(f"mt5.initialize() failed: {mt5.last_error()}")
            self._mt5 = mt5
        return self._mt5

    def account(self) -> dict:
        info = self.mt5.account_info()
        if info is None:
            raise RuntimeError(f"account_info failed: {self.mt5.last_error()}")
        d = info._asdict()
        # trade_mode 0 = demo, 1 = contest, 2 = real. Worth surfacing loudly.
        d["is_real"] = int(d.get("trade_mode", 0)) == 2
        return d

    def equity(self) -> float:
        return float(self.account()["equity"])

    def positions(self) -> list[dict]:
        pos = self.mt5.positions_get()
        return [p._asdict() for p in pos] if pos else []

    # -- trading -----------------------------------------------------------
    def _normalise_volume(self, symbol: str, qty: float) -> float:
        """Clamp to the symbol's min/max/step, or the broker rejects the order."""
        info = self.mt5.symbol_info(symbol)
        if info is None:
            raise RuntimeError(f"unknown symbol {symbol}")
        if not info.visible:
            self.mt5.symbol_select(symbol, True)
            info = self.mt5.symbol_info(symbol)
        step = info.volume_step or 0.01
        vol = max(info.volume_min, min(info.volume_max, qty))
        vol = round(round(vol / step) * step, 8)
        return vol if vol >= info.volume_min else 0.0

    def submit(self, signal: Signal, qty: float) -> Fill:
        signal.validate()
        if not self.live:
            return Fill(False, self.name,
                        message="MT5Broker constructed with live=False; refusing to send")

        mt5 = self.mt5
        vol = self._normalise_volume(signal.symbol, qty)
        if vol <= 0:
            return Fill(False, self.name, message=f"qty {qty} below broker minimum")

        tick = mt5.symbol_info_tick(signal.symbol)
        if tick is None:
            return Fill(False, self.name, message=f"no tick for {signal.symbol}")
        price = tick.ask if signal.side == 1 else tick.bid

        req = {
            "action": mt5.TRADE_ACTION_DEAL,
            "symbol": signal.symbol,
            "volume": vol,
            "type": mt5.ORDER_TYPE_BUY if signal.side == 1 else mt5.ORDER_TYPE_SELL,
            "price": price,
            "sl": float(signal.stop),
            "tp": float(signal.target),
            "deviation": self.deviation,
            "magic": self.magic,
            "comment": f"qsmc {signal.reason}"[:31],   # MT5 truncates at 31 chars
            "type_time": mt5.ORDER_TIME_GTC,
            "type_filling": getattr(mt5, self.filling) if self.filling
                            else mt5.ORDER_FILLING_IOC,
        }
        res = mt5.order_send(req)
        if res is None:
            return Fill(False, self.name, message=f"order_send returned None: {mt5.last_error()}")
        ok = res.retcode == mt5.TRADE_RETCODE_DONE
        return Fill(
            ok=ok, broker=self.name, order_id=str(res.order),
            filled_qty=float(res.volume), filled_price=float(res.price),
            message=f"retcode={res.retcode} {res.comment}", raw=res._asdict(),
        )

    def close(self, symbol: str) -> Fill:
        mt5 = self.mt5
        if not self.live:
            return Fill(False, self.name, message="live=False; refusing to close")
        pos = mt5.positions_get(symbol=symbol) or []
        closed = 0
        for p in pos:
            if p.magic != self.magic:
                continue                     # never touch a human's manual trade
            tick = mt5.symbol_info_tick(symbol)
            is_long = p.type == mt5.POSITION_TYPE_BUY
            res = mt5.order_send({
                "action": mt5.TRADE_ACTION_DEAL,
                "symbol": symbol,
                "volume": p.volume,
                "type": mt5.ORDER_TYPE_SELL if is_long else mt5.ORDER_TYPE_BUY,
                "position": p.ticket,
                "price": tick.bid if is_long else tick.ask,
                "deviation": self.deviation,
                "magic": self.magic,
                "type_filling": mt5.ORDER_FILLING_IOC,
            })
            closed += int(res is not None and res.retcode == mt5.TRADE_RETCODE_DONE)
        return Fill(closed > 0, self.name, filled_qty=float(closed),
                    message=f"closed {closed} position(s) on {symbol}")

    def shutdown(self) -> None:
        if self._mt5 is not None:
            self._mt5.shutdown()
            self._mt5 = None
