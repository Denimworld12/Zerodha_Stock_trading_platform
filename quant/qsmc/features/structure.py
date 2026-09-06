"""Market structure: fractal swings, BOS / CHoCH, dealing range, premium-discount.

CAUSALITY IS THE WHOLE GAME HERE.  A fractal pivot at bar ``i`` needs ``n`` bars
to its right before anyone can know it is a pivot, so it only becomes actionable
at bar ``i + n``.  Every function in this module walks the series forward and
publishes a value at bar ``i`` using information available at the close of bar
``i`` and no later.  Anything else backtests beautifully and loses money live.
"""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import pandas as pd


# ---------------------------------------------------------------------------
# Volatility
# ---------------------------------------------------------------------------
def true_range(df: pd.DataFrame) -> pd.Series:
    prev_close = df["close"].shift(1)
    tr = pd.concat([
        df["high"] - df["low"],
        (df["high"] - prev_close).abs(),
        (df["low"] - prev_close).abs(),
    ], axis=1).max(axis=1)
    return tr


def atr(df: pd.DataFrame, period: int = 14) -> pd.Series:
    """Wilder's ATR (RMA of true range)."""
    return true_range(df).ewm(alpha=1.0 / period, adjust=False, min_periods=period).mean()


# ---------------------------------------------------------------------------
# Fractal swings
# ---------------------------------------------------------------------------
def fractal_pivots(df: pd.DataFrame, n: int = 3) -> tuple[np.ndarray, np.ndarray]:
    """Mark bars that are fractal pivots.

    Returns two boolean arrays aligned to ``df`` marking the *pivot bar itself*.
    They are NOT tradable at that bar - see :func:`market_structure`, which
    delays consumption by ``n`` bars.
    """
    high = df["high"].to_numpy(dtype="float64")
    low = df["low"].to_numpy(dtype="float64")
    size = len(df)
    is_high = np.zeros(size, dtype=bool)
    is_low = np.zeros(size, dtype=bool)

    if size < 2 * n + 1:
        return is_high, is_low

    # Strict on the left, non-strict on the right: this is the standard
    # Williams fractal tie-break and stops flat shelves emitting two pivots.
    for i in range(n, size - n):
        h, lo = high[i], low[i]
        left_h = high[i - n:i]
        right_h = high[i + 1:i + n + 1]
        if h > left_h.max() and h >= right_h.max():
            is_high[i] = True
        left_l = low[i - n:i]
        right_l = low[i + 1:i + n + 1]
        if lo < left_l.min() and lo <= right_l.min():
            is_low[i] = True
    return is_high, is_low


@dataclass
class _Swing:
    idx: int
    price: float


def market_structure(df: pd.DataFrame, n: int = 3) -> pd.DataFrame:
    """Causal BOS / CHoCH state machine.

    Columns produced
    ----------------
    bias            +1 bullish, -1 bearish, 0 undecided (structural trend)
    bos             +1/-1 on the bar that closes through structure *with* trend
    choch           +1/-1 on the bar that closes through structure *against* it
    bars_since_shift  bars since the last bos/choch event
    range_high/low  the live dealing range (last confirmed opposing swings)
    eq_pos          0 = range low, 1 = range high; >0.5 is premium
    protected_high/low  structural invalidation levels for a live position
    swept_high/low  the wick took liquidity beyond a confirmed swing but the
                    body closed back inside - a stop hunt, not a break
    """
    size = len(df)
    high = df["high"].to_numpy(dtype="float64")
    low = df["low"].to_numpy(dtype="float64")
    close = df["close"].to_numpy(dtype="float64")
    is_ph, is_pl = fractal_pivots(df, n)

    bias = np.zeros(size, dtype="int8")
    bos = np.zeros(size, dtype="int8")
    choch = np.zeros(size, dtype="int8")
    swept_high = np.zeros(size, dtype="int8")
    swept_low = np.zeros(size, dtype="int8")
    range_high = np.full(size, np.nan)
    range_low = np.full(size, np.nan)
    prot_high = np.full(size, np.nan)
    prot_low = np.full(size, np.nan)
    bars_since = np.full(size, np.nan)

    cur_bias = 0
    last_shift = -1
    # active_* is the level currently being watched for a break; it is consumed
    # (set to None) once broken so a single swing cannot fire twice.
    active_high: _Swing | None = None
    active_low: _Swing | None = None
    # confirmed_* keep the most recent levels for range / invalidation purposes
    # even after they have been consumed by a break.
    conf_high: _Swing | None = None
    conf_low: _Swing | None = None

    for i in range(size):
        # --- 1. absorb the pivot that becomes knowable at this bar -----------
        p = i - n
        if p >= 0:
            if is_ph[p]:
                sw = _Swing(p, high[p])
                active_high, conf_high = sw, sw
            if is_pl[p]:
                sw = _Swing(p, low[p])
                active_low, conf_low = sw, sw

        # --- 2. liquidity sweep: wick through, body back inside -------------
        if active_high is not None and high[i] > active_high.price and close[i] <= active_high.price:
            swept_high[i] = 1
        if active_low is not None and low[i] < active_low.price and close[i] >= active_low.price:
            swept_low[i] = 1

        # --- 3. displacement: a CLOSE through structure ---------------------
        if active_high is not None and close[i] > active_high.price:
            if cur_bias == 1:
                bos[i] = 1
            else:
                choch[i] = 1          # bearish/neutral -> bullish
            cur_bias = 1
            last_shift = i
            active_high = None

        if active_low is not None and close[i] < active_low.price:
            if cur_bias == -1:
                bos[i] = -1
            else:
                choch[i] = -1
            cur_bias = -1
            last_shift = i
            active_low = None

        # --- 4. publish state ----------------------------------------------
        bias[i] = cur_bias
        if conf_high is not None:
            range_high[i] = conf_high.price
            prot_high[i] = conf_high.price
        if conf_low is not None:
            range_low[i] = conf_low.price
            prot_low[i] = conf_low.price
        if last_shift >= 0:
            bars_since[i] = i - last_shift

    span = range_high - range_low
    with np.errstate(invalid="ignore", divide="ignore"):
        eq_pos = np.where(span > 0, (close - range_low) / span, np.nan)

    return pd.DataFrame({
        "bias": bias,
        "bos": bos,
        "choch": choch,
        "swept_high": swept_high,
        "swept_low": swept_low,
        "bars_since_shift": bars_since,
        "range_high": range_high,
        "range_low": range_low,
        "range_span": span,
        "eq_pos": np.clip(eq_pos, -1.0, 2.0),
        "protected_high": prot_high,
        "protected_low": prot_low,
    }, index=df.index)


def equal_levels(
    df: pd.DataFrame,
    n: int = 3,
    tol_atr: float = 0.15,
    atr_period: int = 14,
) -> pd.DataFrame:
    """Equal highs / equal lows - the resting liquidity pools SMC targets.

    Two consecutive confirmed pivots within ``tol_atr`` ATR of each other form
    an EQH/EQL. The level is published from the bar it becomes knowable.
    """
    size = len(df)
    high = df["high"].to_numpy(dtype="float64")
    low = df["low"].to_numpy(dtype="float64")
    a = atr(df, atr_period).to_numpy(dtype="float64")
    is_ph, is_pl = fractal_pivots(df, n)

    eqh = np.zeros(size, dtype="int8")
    eql = np.zeros(size, dtype="int8")
    eqh_level = np.full(size, np.nan)
    eql_level = np.full(size, np.nan)

    prev_h: float | None = None
    prev_l: float | None = None
    cur_eqh = np.nan
    cur_eql = np.nan

    for i in range(size):
        p = i - n
        if p >= 0 and np.isfinite(a[i]) and a[i] > 0:
            tol = tol_atr * a[i]
            if is_ph[p]:
                if prev_h is not None and abs(high[p] - prev_h) <= tol:
                    eqh[i] = 1
                    cur_eqh = max(high[p], prev_h)
                prev_h = high[p]
            if is_pl[p]:
                if prev_l is not None and abs(low[p] - prev_l) <= tol:
                    eql[i] = 1
                    cur_eql = min(low[p], prev_l)
                prev_l = low[p]
        eqh_level[i] = cur_eqh
        eql_level[i] = cur_eql

    return pd.DataFrame(
        {"eqh": eqh, "eql": eql, "eqh_level": eqh_level, "eql_level": eql_level},
        index=df.index,
    )
