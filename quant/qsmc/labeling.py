"""Triple-barrier labelling and meta-labels (Lopez de Prado, AFML ch. 3).

Each primary SMC signal becomes an event.  The event is entered at the OPEN of
the following bar and then raced against three barriers:

    upper  entry + profit_atr * ATR   (in the direction of the trade)
    lower  entry - stop_atr   * ATR
    time   max_holding bars

The meta-label is 1 only if the profit barrier is reached first.  The model then
learns ``P(win | setup)`` and never has to guess direction - the SMC rules
already did that.

Pessimism rule
--------------
Bar data cannot say whether the high or the low came first within a bar.  When
both barriers fall inside one bar's range this module assumes the STOP hit
first.  That is the assumption that makes a backtest survive contact with a
broker; the optimistic version manufactures free money out of ambiguity.
"""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import pandas as pd

from .config import LabelConfig


@dataclass(frozen=True)
class BarrierResult:
    labels: pd.DataFrame

    def __len__(self) -> int:
        return len(self.labels)


def triple_barrier(
    df: pd.DataFrame,
    side: pd.Series,
    atr_series: pd.Series,
    cfg: LabelConfig | None = None,
) -> pd.DataFrame:
    """Race every non-zero ``side`` event against the three barriers.

    Returns one row per event with the entry/exit prices, the realised gross
    return in the direction of the trade, the R-multiple, the bars held, why it
    exited, and the binary meta-label.
    """
    cfg = cfg or LabelConfig()

    o = df["open"].to_numpy("float64")
    h = df["high"].to_numpy("float64")
    l = df["low"].to_numpy("float64")
    c = df["close"].to_numpy("float64")
    a = atr_series.to_numpy("float64")
    s = side.to_numpy("int8")
    size = len(df)

    rows = []
    for i in range(size - 1):
        d = int(s[i])
        if d == 0 or not np.isfinite(a[i]) or a[i] <= 0:
            continue

        entry_idx = i + 1                 # signalled at close of i, filled at open of i+1
        entry = o[entry_idx]
        if not np.isfinite(entry) or entry <= 0:
            continue

        risk = cfg.stop_atr * a[i]
        reward = cfg.profit_atr * a[i]
        tp = entry + d * reward
        sl = entry - d * risk

        last = min(entry_idx + cfg.max_holding, size - 1)
        exit_idx, exit_px, reason = last, c[last], "time"

        for j in range(entry_idx, last + 1):
            hit_tp = (h[j] >= tp) if d == 1 else (l[j] <= tp)
            hit_sl = (l[j] <= sl) if d == 1 else (h[j] >= sl)
            if hit_sl:                    # stop checked first, on purpose
                exit_idx, exit_px, reason = j, sl, "stop"
                break
            if hit_tp:
                exit_idx, exit_px, reason = j, tp, "target"
                break

        gross = d * (exit_px - entry) / entry
        rows.append({
            "signal_time": df.index[i],
            "entry_time": df.index[entry_idx],
            "exit_time": df.index[exit_idx],
            "side": d,
            "entry": entry,
            "exit": exit_px,
            "stop": sl,
            "target": tp,
            "atr": a[i],
            "risk_frac": risk / entry,
            "bars_held": exit_idx - entry_idx,
            "reason": reason,
            "ret_gross": gross,
            "r_multiple": d * (exit_px - entry) / risk,
            "meta_label": int(reason == "target"),
        })

    out = pd.DataFrame(rows)
    if out.empty:
        return out
    return out.set_index("signal_time")


def label_summary(labels: pd.DataFrame) -> dict:
    """Base rates - the number every model must beat before it is worth anything."""
    if labels.empty:
        return {"events": 0}
    wins = labels["meta_label"].mean()
    exp_r = labels["r_multiple"].mean()
    return {
        "events": int(len(labels)),
        "base_win_rate": round(float(wins), 4),
        "mean_R": round(float(exp_r), 4),
        "median_bars_held": int(labels["bars_held"].median()),
        "longs": int((labels["side"] == 1).sum()),
        "shorts": int((labels["side"] == -1).sum()),
        "exit_mix": {k: int(v) for k, v in labels["reason"].value_counts().items()},
    }


def limit_entry_barrier(
    df: pd.DataFrame,
    side: pd.Series,
    levels: pd.DataFrame,
    atr_series: pd.Series,
    cfg: LabelConfig | None = None,
    entry_window: int = 12,
    stop_buffer_atr: float = 0.25,
    rr: float = 2.0,
    max_risk_atr: float = 2.5,
    min_risk_atr: float = 0.20,
) -> pd.DataFrame:
    """The way SMC is actually traded: a resting limit order at the POI.

    :func:`triple_barrier` enters at market on the bar after the signal, which
    means buying immediately after a displacement candle - the worst price in
    the leg.  In the reference run that put 39% of stops inside one bar: the
    stop was sitting in the noise, not beyond structure.

    Here instead:

    * a LIMIT order rests at the proximal edge of the order block / FVG and
      expires unfilled after ``entry_window`` bars;
    * the STOP sits beyond the distal edge of that zone, so it is invalidation
      by structure rather than by noise;
    * the TARGET is a fixed ``rr`` multiple of that structural risk.

    Unfilled signals produce no row - a limit that never traded is not a trade,
    and counting it as a scratch would flatter the hit rate.
    """
    cfg = cfg or LabelConfig()

    o = df["open"].to_numpy("float64")
    h = df["high"].to_numpy("float64")
    l = df["low"].to_numpy("float64")
    c = df["close"].to_numpy("float64")
    a = atr_series.to_numpy("float64")
    s = side.to_numpy("int8")
    size = len(df)

    bull_top = levels["poi_bull_top"].to_numpy("float64")
    bull_bot = levels["poi_bull_bot"].to_numpy("float64")
    bear_top = levels["poi_bear_top"].to_numpy("float64")
    bear_bot = levels["poi_bear_bot"].to_numpy("float64")

    rows = []
    for i in range(size - 2):
        d = int(s[i])
        if d == 0 or not np.isfinite(a[i]) or a[i] <= 0:
            continue

        if d == 1:
            limit, far = bull_top[i], bull_bot[i]
        else:
            limit, far = bear_bot[i], bear_top[i]
        if not (np.isfinite(limit) and np.isfinite(far)):
            continue

        stop = far - d * stop_buffer_atr * a[i]
        risk = d * (limit - stop)
        if not np.isfinite(risk) or risk <= 0:
            continue
        risk_atr = risk / a[i]
        if not (min_risk_atr <= risk_atr <= max_risk_atr):
            continue          # zone too thin to be structure, or too wide to size

        # --- wait for the fill --------------------------------------------
        fill_idx = -1
        last_try = min(i + entry_window, size - 2)
        for j in range(i + 1, last_try + 1):
            if (d == 1 and l[j] <= limit) or (d == -1 and h[j] >= limit):
                fill_idx = j
                break
            # If price runs to the stop before ever filling, the setup is dead.
            if (d == 1 and l[j] <= stop) or (d == -1 and h[j] >= stop):
                break
        if fill_idx < 0:
            continue

        entry = limit
        target = entry + d * rr * risk

        last = min(fill_idx + cfg.max_holding, size - 1)
        exit_idx, exit_px, reason = last, c[last], "time"
        for j in range(fill_idx, last + 1):
            hit_sl = (l[j] <= stop) if d == 1 else (h[j] >= stop)
            hit_tp = (h[j] >= target) if d == 1 else (l[j] <= target)
            if hit_sl:                       # stop-first on ambiguity, as always
                exit_idx, exit_px, reason = j, stop, "stop"
                break
            if hit_tp:
                exit_idx, exit_px, reason = j, target, "target"
                break

        rows.append({
            "signal_time": df.index[i],
            "entry_time": df.index[fill_idx],
            "exit_time": df.index[exit_idx],
            "side": d,
            "entry": entry,
            "exit": exit_px,
            "stop": stop,
            "target": target,
            "atr": a[i],
            "risk_frac": risk / entry,
            "risk_atr": risk_atr,
            "bars_to_fill": fill_idx - i,
            "bars_held": exit_idx - fill_idx,
            "reason": reason,
            "ret_gross": d * (exit_px - entry) / entry,
            "r_multiple": d * (exit_px - entry) / risk,
            "meta_label": int(reason == "target"),
        })

    out = pd.DataFrame(rows)
    return out if out.empty else out.set_index("signal_time")
