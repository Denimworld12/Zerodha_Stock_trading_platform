"""Mirror-Market Concept features.

"Mirror market" is used loosely by traders, so rather than guess at one meaning
this module implements the three defensible readings and lets the model decide
which carries signal:

1. INVERSE PAIR  - an instrument tied to this one by a stable hedge ratio.
   The textbook mirror is anti-correlated (EURUSD/USDCHF sits near rho = -0.9),
   but empirically BTC/ETH run at rho = +0.85, and a positively correlated leg
   is the same relationship seen from the other side - you mirror it by
   shorting rather than buying. So the regime test is |rho| >= min_abs_corr and
   beta carries the sign. Either way the tradable object is the beta-hedged
   spread: when it dislocates, one of the two legs is lying.

2. FOLDBACK      - fractal time symmetry around a pivot.  Two competing
   hypotheses are scored against each other every bar:
      vertical mirror   B[k] ~=  A[-1-k]         (path retraces -> mean reversion)
      point reflection  B[k] ~= 2p - A[-1-k]     (path extends  -> continuation)
   Correlation cannot separate these (they are exact negatives), so they are
   scored by normalised RMSE instead.

3. LEAD-LAG      - which leg moves first, from lagged cross-correlation.  If the
   mirror leads, its move is information about where this leg is going.

Everything is computed on a trailing window, so every value at bar ``i`` uses
only bars <= ``i``.
"""
from __future__ import annotations

import numpy as np
import pandas as pd
from numpy.lib.stride_tricks import sliding_window_view

from ..config import MirrorConfig


def _log_close(df: pd.DataFrame) -> pd.Series:
    return np.log(df["close"].astype("float64"))


def _zwin(s: pd.Series, window: int) -> pd.Series:
    m = s.rolling(window, min_periods=window // 2).mean()
    sd = s.rolling(window, min_periods=window // 2).std(ddof=0)
    return (s - m) / sd.replace(0.0, np.nan)


# ---------------------------------------------------------------------------
# 1. Inverse-pair dislocation
# ---------------------------------------------------------------------------
def inverse_pair_features(
    base: pd.DataFrame,
    mirror: pd.DataFrame,
    cfg: MirrorConfig | None = None,
) -> pd.DataFrame:
    """Spread / correlation / beta features against the mirror instrument.

    The two series are aligned on the base index and the mirror is forward
    filled, so a mirror that trades on a different calendar (FX vs crypto)
    never leaks a future print backwards.
    """
    cfg = cfg or MirrorConfig()
    w = cfg.corr_window

    lb = _log_close(base)
    lm = _log_close(mirror).reindex(lb.index).ffill()

    rb = lb.diff()
    rm = lm.diff()

    corr = rb.rolling(w, min_periods=w // 2).corr(rm)
    cov = rb.rolling(w, min_periods=w // 2).cov(rm)
    var_m = rm.rolling(w, min_periods=w // 2).var(ddof=0)
    beta = cov / var_m.replace(0.0, np.nan)

    # Mirror-adjusted spread: for a true mirror the cumulative moves cancel.
    # Using beta rather than a raw sum keeps the spread stationary when the
    # legs have different volatilities.
    cum_b = rb.rolling(w, min_periods=w // 2).sum()
    cum_m = rm.rolling(w, min_periods=w // 2).sum()
    spread = cum_b - beta * cum_m
    spread_z = _zwin(spread, cfg.spread_z_window)

    # Is a stable mirror relationship on right now? Sign-agnostic: what makes
    # the spread tradable is that the hedge holds, not which way it points.
    regime = (corr.abs() >= cfg.min_abs_corr).astype("float64")
    # A correlation that snaps toward zero is itself a warning: the hedge that
    # was containing this move has stopped working.
    corr_break = corr.diff(w // 4).abs()

    out = pd.DataFrame({
        "mir_corr": corr,
        "mir_beta": beta.clip(-10, 10),
        "mir_spread_z": spread_z.clip(-6, 6),
        "mir_regime": regime,
        "mir_corr_break": corr_break,
        "mir_ret": rm,
        "mir_ret_z": _zwin(rm, w).clip(-6, 6),
        # -1 = classic anti-correlated mirror, +1 = mirror via the short leg
        "mir_is_inverse": np.sign(corr).fillna(0.0),
        # Signed conviction: a dislocation only counts while the mirror regime
        # is live, and it points against the stretched leg.
        "mir_divergence": np.where(
            regime.to_numpy() > 0,
            -np.sign(spread_z.fillna(0.0).to_numpy())
            * (spread_z.abs().fillna(0.0).to_numpy() >= cfg.divergence_z),
            0.0,
        ),
    }, index=lb.index)
    return out


# ---------------------------------------------------------------------------
# 2. Fractal foldback symmetry
# ---------------------------------------------------------------------------
def foldback_features(
    df: pd.DataFrame,
    window: int = 48,
) -> pd.DataFrame:
    """Score vertical-mirror vs point-reflection symmetry around a rolling pivot.

    For bar ``i`` the pivot sits ``window`` bars back.  ``A`` is the leg into the
    pivot, ``B`` the leg out of it.  Both hypotheses are compared by RMSE
    normalised by the window's own dispersion, so the scores are unit free and
    comparable across instruments.
    """
    x = _log_close(df).to_numpy("float64")
    size = len(x)
    sym = np.full(size, np.nan)
    inv = np.full(size, np.nan)
    proj = np.full(size, np.nan)

    span = 2 * window + 1
    if size >= span:
        wins = sliding_window_view(x, span)          # (size-span+1, span)
        A = wins[:, :window]                          # into the pivot
        p = wins[:, window][:, None]                  # the pivot itself
        B = wins[:, window + 1:]                      # out of the pivot
        revA = A[:, ::-1]

        scale = wins.std(axis=1, ddof=0)[:, None]
        scale = np.where(scale <= 0, np.nan, scale)

        sym_err = np.sqrt(np.mean(((B - revA) / scale) ** 2, axis=1))
        inv_err = np.sqrt(np.mean(((B - (2 * p - revA)) / scale) ** 2, axis=1))

        sym_s = np.exp(-sym_err)
        inv_s = np.exp(-inv_err)
        sym[span - 1:] = sym_s
        inv[span - 1:] = inv_s

    dx = np.diff(x, prepend=np.nan)
    tot = np.nan_to_num(sym) + np.nan_to_num(inv)
    with np.errstate(invalid="ignore", divide="ignore"):
        wgt = np.where(tot > 0, (inv - sym) / tot, 0.0)
    # inv (point reflection) predicts the last move extends; sym (vertical
    # mirror) predicts it retraces.  wgt in [-1, 1] blends the two.
    proj = wgt * dx

    return pd.DataFrame({
        "fold_sym": sym,
        "fold_inv": inv,
        "fold_edge": np.nan_to_num(inv) - np.nan_to_num(sym),
        "fold_proj": proj,
        "fold_conf": np.maximum(np.nan_to_num(sym), np.nan_to_num(inv)),
    }, index=df.index)


# ---------------------------------------------------------------------------
# 3. Lead-lag
# ---------------------------------------------------------------------------
def lead_lag_features(
    base: pd.DataFrame,
    mirror: pd.DataFrame,
    window: int = 240,
    max_lag: int = 12,
    step: int = 8,
) -> pd.DataFrame:
    """Rolling lagged cross-correlation between the two legs.

    For lag ``L`` the base return at ``t`` is correlated against the mirror
    return at ``t - L``.  ``lead_bars > 0`` therefore means the mirror moves
    first and its past explains this leg's present - the only direction that is
    tradable.  Recomputed every ``step`` bars and held flat in between: the
    statistic moves far more slowly than the bar clock, and the full rolling
    version costs 25x more for no extra information.
    """
    rb = _log_close(base).diff()
    rm = _log_close(mirror).reindex(rb.index).ffill().diff()

    b = rb.to_numpy("float64")
    m = rm.to_numpy("float64")
    size = len(b)
    lead = np.full(size, np.nan)
    strength = np.full(size, np.nan)

    for i in range(window, size, step):
        seg_b = b[i - window + 1:i + 1]
        best_c, best_l = 0.0, 0
        for lag in range(-max_lag, max_lag + 1):
            lo, hi = i - window + 1 - lag, i + 1 - lag
            if lo < 0 or hi > size:
                continue
            seg_m = m[lo:hi]
            mask = np.isfinite(seg_b) & np.isfinite(seg_m)
            if int(mask.sum()) < window // 2:
                continue
            xs, ys = seg_b[mask], seg_m[mask]
            sx, sy = xs.std(), ys.std()
            if sx <= 0 or sy <= 0:
                continue
            c = float(np.mean((xs - xs.mean()) * (ys - ys.mean())) / (sx * sy))
            if abs(c) > abs(best_c):
                best_c, best_l = c, lag
        lead[i:i + step] = best_l
        strength[i:i + step] = best_c

    return pd.DataFrame(
        {"mir_lead_bars": lead, "mir_lead_strength": strength},
        index=base.index,
    )


def mirror_features(
    base: pd.DataFrame,
    mirror: pd.DataFrame | None,
    cfg: MirrorConfig | None = None,
) -> pd.DataFrame:
    """All three mirror readings, aligned to ``base``.

    When no mirror instrument is available the inverse-pair and lead-lag blocks
    are emitted as neutral zeros so the feature matrix keeps a stable shape
    across instruments.
    """
    cfg = cfg or MirrorConfig()
    fold = foldback_features(base, cfg.foldback_window)

    if mirror is None or mirror.empty:
        neutral = pd.DataFrame(0.0, index=base.index, columns=[
            "mir_corr", "mir_beta", "mir_spread_z", "mir_regime", "mir_corr_break",
            "mir_ret", "mir_ret_z", "mir_is_inverse", "mir_divergence",
            "mir_lead_bars", "mir_lead_strength",
        ])
        return pd.concat([neutral, fold], axis=1)

    inv = inverse_pair_features(base, mirror, cfg)
    ll = lead_lag_features(base, mirror, cfg.corr_window, cfg.max_lead_lag)
    return pd.concat([inv, ll, fold], axis=1)
