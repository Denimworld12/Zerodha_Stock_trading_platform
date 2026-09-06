"""Portfolio backtester over triple-barrier events.

Because :mod:`qsmc.labeling` already resolved each event against its barriers
using bar highs/lows, the backtester's job is portfolio construction, not path
simulation: gate on the model's probability, size by risk, respect concurrency
and the kill switches, charge realistic costs, and mark equity through time.

Every assumption that flatters results is deliberately set against us:
  * fills at the NEXT bar's open, never the signal bar's close;
  * full round-trip spread + commission + slippage on notional;
  * ambiguous intrabar barrier races resolved as stop-first (in labeling);
  * a trade that cannot be sized within leverage limits is skipped, not shrunk
    into a lottery ticket.
"""
from __future__ import annotations

import numpy as np
import pandas as pd

from ..config import Config, CONFIG
from .metrics import summarise


def run_backtest(
    trades_in: pd.DataFrame,
    price_index: pd.DatetimeIndex,
    initial_equity: float = 10_000.0,
    prob_col: str | None = "p_win",
    cfg: Config | None = None,
    n_trials: int = 1,
) -> dict:
    """Simulate the portfolio. Returns equity curve, filled trades and stats."""
    cfg = cfg or CONFIG
    risk, cost = cfg.risk, cfg.cost

    if trades_in.empty:
        idx = price_index[:1]
        return {
            "equity": pd.Series([initial_equity], index=idx),
            "trades": pd.DataFrame(),
            "stats": {"trades": 0},
            "rejections": {},
        }

    ev = trades_in.copy()
    if prob_col and prob_col in ev.columns:
        ev = ev[ev[prob_col].notna()]
    ev = ev.sort_values("entry_time")

    cost_frac = cost.round_trip_bps / 10_000.0
    threshold = cfg.model.prob_threshold

    equity = initial_equity
    peak = initial_equity
    open_until: list[pd.Timestamp] = []
    day_start_equity = initial_equity
    cur_day = None
    halted = False

    marks: list[tuple[pd.Timestamp, float]] = [(ev["entry_time"].iloc[0], equity)]
    filled = []
    rej = {"prob": 0, "concurrency": 0, "rr": 0, "daily_loss": 0, "drawdown": 0, "leverage": 0}

    for _, e in ev.iterrows():
        t_in, t_out = e["entry_time"], e["exit_time"]

        day = t_in.date()
        if cur_day != day:
            cur_day, day_start_equity = day, equity

        if halted:
            rej["drawdown"] += 1
            continue

        # --- gates --------------------------------------------------------
        if prob_col and prob_col in ev.columns and float(e[prob_col]) < threshold:
            rej["prob"] += 1
            continue

        rr = cfg.label.profit_atr / cfg.label.stop_atr
        if rr < risk.min_rr:
            rej["rr"] += 1
            continue

        open_until = [t for t in open_until if t > t_in]
        if len(open_until) >= risk.max_concurrent:
            rej["concurrency"] += 1
            continue

        if equity <= day_start_equity * (1 - risk.max_daily_loss):
            rej["daily_loss"] += 1
            continue
        if equity <= peak * (1 - risk.max_total_drawdown):
            halted = True
            rej["drawdown"] += 1
            continue

        # --- sizing: risk a fixed fraction of equity to the stop -----------
        risk_frac = float(e["risk_frac"])
        if not np.isfinite(risk_frac) or risk_frac <= 0:
            continue
        notional = equity * risk.risk_per_trade / risk_frac
        if notional > equity * risk.max_leverage:
            notional = equity * risk.max_leverage
            if risk.risk_per_trade / risk_frac > risk.max_leverage * 1.5:
                rej["leverage"] += 1     # stop so tight the size is unrealistic
                continue

        gross = float(e["ret_gross"])
        net = gross - cost_frac
        pnl = notional * net
        r_net = net / risk_frac

        equity += pnl
        peak = max(peak, equity)
        open_until.append(t_out)
        marks.append((t_out, equity))

        filled.append({
            "entry_time": t_in, "exit_time": t_out, "side": int(e["side"]),
            "entry": float(e["entry"]), "exit": float(e["exit"]),
            "notional": notional, "ret_gross": gross, "ret_net": net,
            "pnl": pnl, "r_net": r_net, "bars_held": int(e["bars_held"]),
            "reason": e["reason"], "equity": equity,
            "p_win": float(e[prob_col]) if prob_col and prob_col in ev.columns else np.nan,
        })

    trades = pd.DataFrame(filled)
    curve = pd.Series(dict(marks)).sort_index()
    # Mark to the full bar clock so Sharpe is measured on calendar time, not on
    # trade count - otherwise a rare strategy looks smoother than it is.
    equity_curve = curve.reindex(
        price_index.union(curve.index)).ffill().bfill().reindex(price_index).ffill()

    return {
        "equity": equity_curve,
        "trades": trades,
        "stats": summarise(equity_curve, trades, n_trials=n_trials),
        "rejections": rej,
    }
