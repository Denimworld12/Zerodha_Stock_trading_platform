"""Live signal generation: bars in, a validated Signal out.

Deliberately stateless. Every call refetches, recomputes the full causal feature
matrix and reads only the LAST row. Recomputing is a few milliseconds and it
guarantees the live path and the backtest path run identical code - the usual
way live results diverge from a backtest is a hand-optimised "incremental"
feature update that quietly disagrees with the vectorised one.
"""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import pandas as pd

from .config import CONFIG, Config, mirror_of
from .data.loaders import load_cached
from .execution.base import Signal
from .features.build import build_features, feature_columns
from .features.structure import atr


@dataclass
class SignalContext:
    """Everything behind a decision, so any trade can be explained after the fact."""
    symbol: str
    timeframe: str
    bar_time: pd.Timestamp
    close: float
    atr: float
    primary: int
    p_win: float
    features: dict
    signal: Signal | None
    blocked_by: str | None = None


def explain(row: pd.Series) -> str:
    """Human-readable confluence list for the audit trail and the UI."""
    bits = []
    if row.get("choch", 0):
        bits.append("CHoCH")
    elif row.get("bos", 0):
        bits.append("BOS")
    if row.get("sweep_lo_12", 0) or row.get("sweep_hi_12", 0):
        bits.append("liquidity sweep")
    eq = row.get("eq_pos", np.nan)
    if eq == eq:
        bits.append("discount" if eq < 0.5 else "premium")
    if row.get("in_bull_ob", 0) or row.get("in_bear_ob", 0):
        bits.append("order block")
    if row.get("in_bull_fvg", 0) or row.get("in_bear_fvg", 0):
        bits.append("FVG")
    if row.get("mir_divergence", 0):
        bits.append(f"mirror div z={row.get('mir_spread_z', 0):.1f}")
    if abs(row.get("fold_edge", 0)) > 0.1:
        bits.append("foldback")
    htf = row.get("htf_bias", 0)
    bits.append(f"HTF {'bull' if htf > 0 else 'bear' if htf < 0 else 'flat'}")
    return " + ".join(bits) if bits else "no confluence"


def generate_signal(
    symbol: str,
    interval: str = "15m",
    bars: int = 3000,
    model_bundle: dict | None = None,
    cfg: Config | None = None,
    refresh: bool = True,
) -> SignalContext:
    """Compute the current signal for ``symbol``.

    Returns a context even when there is no trade - ``blocked_by`` says which
    gate stopped it, which is far more useful when debugging a quiet strategy
    than a bare ``None``.
    """
    cfg = cfg or CONFIG
    base = load_cached(symbol, interval, limit_bars=bars, refresh=refresh)
    mname = mirror_of(symbol)
    mirror = None
    if mname and mname != symbol:
        try:
            mirror = load_cached(mname, interval, limit_bars=bars, refresh=refresh)
        except Exception:
            mirror = None

    feat = build_features(base, mirror, interval, cfg)
    a = atr(base, cfg.label.atr_period)

    row = feat.iloc[-1]
    bar_time = feat.index[-1]
    close = float(base["close"].iloc[-1])
    atr_now = float(a.iloc[-1])
    side = int(row["primary"])

    ctx = SignalContext(
        symbol=symbol, timeframe=interval, bar_time=bar_time, close=close,
        atr=atr_now, primary=side, p_win=0.5,
        features={k: (None if pd.isna(v) else float(v))
                  for k, v in row.items() if isinstance(v, (int, float, np.floating))},
        signal=None,
    )

    if side == 0:
        ctx.blocked_by = "no primary SMC setup"
        return ctx
    if not np.isfinite(atr_now) or atr_now <= 0:
        ctx.blocked_by = "ATR unavailable"
        return ctx

    # Meta-model gate. Absent a model we do NOT default to "take it" - an
    # ungated primary signal is the variant that was measured to lose money.
    if model_bundle:
        cols = model_bundle["feature_cols"]
        X = feat.iloc[[-1]].reindex(columns=cols).astype("float64")
        ctx.p_win = float(model_bundle["model"].predict_proba(X)[0, 1])
        if ctx.p_win < cfg.model.prob_threshold:
            ctx.blocked_by = f"p_win {ctx.p_win:.3f} < threshold {cfg.model.prob_threshold}"
            return ctx
    else:
        ctx.blocked_by = "no model bundle loaded (refusing to trade ungated rules)"
        return ctx

    entry = close
    stop = entry - side * cfg.label.stop_atr * atr_now
    target = entry + side * cfg.label.profit_atr * atr_now

    sig = Signal(
        symbol=symbol, side=side, entry=entry, stop=stop, target=target,
        confidence=ctx.p_win, reason=explain(row),
        timestamp=bar_time.to_pydatetime(), timeframe=interval,
        meta={"atr": atr_now, "eq_pos": float(row.get("eq_pos", np.nan)),
              "htf_bias": float(row.get("htf_bias", 0))},
    )
    try:
        sig.validate()
    except ValueError as exc:
        ctx.blocked_by = f"invalid signal: {exc}"
        return ctx

    if sig.rr < cfg.risk.min_rr:
        ctx.blocked_by = f"RR {sig.rr:.2f} below minimum {cfg.risk.min_rr}"
        return ctx

    ctx.signal = sig
    return ctx
