"""Feature matrix assembly and the rule-based SMC primary signal.

Timing convention (the thing that makes or breaks a backtest)
-------------------------------------------------------------
Bars are indexed by OPEN time.  The row stamped ``t`` therefore describes the
bar spanning ``[t, t+dt)`` and is only fully known at ``t+dt``.  Consequently:

* every feature at ``t`` uses bars ``<= t`` only;
* a signal at ``t`` is executed at the OPEN of bar ``t+1``;
* higher-timeframe blocks are shifted by one HTF bar before being merged down,
  because an unfinished HTF bar is not information.

Break any of those three and the equity curve becomes fiction.
"""
from __future__ import annotations

import numpy as np
import pandas as pd

from ..config import Config, CONFIG
from ..data.loaders import resample
from .mirror import mirror_features
from .smc import smc_zones
from .structure import atr, equal_levels, market_structure

# ICT "killzone" hours in UTC. Session structure is a first-class SMC input:
# liquidity is engineered at session opens and taken at session highs/lows.
SESSIONS = {
    "asia": (0, 7),
    "london": (7, 12),
    "ny_am": (12, 16),
    "ny_pm": (16, 21),
}

_HTF_RULES = {
    "1m": "15min", "3m": "30min", "5m": "1h", "15m": "4h",
    "30m": "4h", "1h": "1D", "4h": "1D", "1d": "1W",
}


def _recent(flag: pd.Series, k: int) -> pd.Series:
    """1 if the event fired at any of the last ``k`` bars (inclusive)."""
    return (flag.abs().rolling(k, min_periods=1).max() > 0).astype("float64")


def _signed_recent(flag: pd.Series, k: int) -> pd.Series:
    """Direction of the most recent event within ``k`` bars, else 0."""
    return flag.replace(0, np.nan).ffill(limit=k).fillna(0.0)


def time_block(index: pd.DatetimeIndex) -> pd.DataFrame:
    hour = index.hour + index.minute / 60.0
    out = pd.DataFrame(index=index)
    out["tod_sin"] = np.sin(2 * np.pi * hour / 24.0)
    out["tod_cos"] = np.cos(2 * np.pi * hour / 24.0)
    out["dow"] = index.dayofweek.astype("float64")
    for name, (lo, hi) in SESSIONS.items():
        out[f"sess_{name}"] = ((index.hour >= lo) & (index.hour < hi)).astype("float64")
    return out


def volatility_block(df: pd.DataFrame, cfg: Config) -> pd.DataFrame:
    a = atr(df, cfg.label.atr_period)
    close = df["close"]
    ret = np.log(close).diff()
    out = pd.DataFrame(index=df.index)
    out["atr"] = a
    out["atr_pct"] = a / close
    out["atr_rank"] = a.rolling(500, min_periods=100).rank(pct=True)
    out["ret_1"] = ret
    out["ret_z"] = (ret - ret.rolling(240, min_periods=60).mean()) / ret.rolling(
        240, min_periods=60).std(ddof=0).replace(0.0, np.nan)
    out["rv_fast"] = ret.rolling(24, min_periods=12).std(ddof=0)
    out["rv_slow"] = ret.rolling(120, min_periods=60).std(ddof=0)
    out["rv_ratio"] = out["rv_fast"] / out["rv_slow"].replace(0.0, np.nan)
    # FX bars carry no real volume — Yahoo reports zero, and even a broker's
    # "volume" is a tick count, not size. A z-score of a constant is 0/0, so the
    # feature is emitted as NaN rather than as a fabricated number the model
    # would happily learn from.
    if df["volume"].abs().sum() > 0:
        out["vol_z"] = (df["volume"] - df["volume"].rolling(240, min_periods=60).mean()) / \
            df["volume"].rolling(240, min_periods=60).std(ddof=0).replace(0.0, np.nan)
    else:
        out["vol_z"] = np.nan
    out["ret_5"] = np.log(close).diff(5)
    out["ret_20"] = np.log(close).diff(20)
    return out.replace([np.inf, -np.inf], np.nan)


def htf_block(df: pd.DataFrame, interval: str, cfg: Config) -> pd.DataFrame:
    """Higher-timeframe structure, lag-shifted so no unfinished bar leaks down."""
    rule = _HTF_RULES.get(interval, "4h")
    htf = resample(df, rule)
    if len(htf) < 4 * cfg.structure.swing_lookback + 2:
        return pd.DataFrame(0.0, index=df.index,
                            columns=["htf_bias", "htf_eq_pos", "htf_shift", "htf_bars_since"])

    ms = market_structure(htf, cfg.structure.swing_lookback)
    block = pd.DataFrame({
        "htf_bias": ms["bias"].astype("float64"),
        "htf_eq_pos": ms["eq_pos"],
        "htf_shift": (ms["bos"] + ms["choch"]).astype("float64"),
        "htf_bars_since": ms["bars_since_shift"],
    })
    # An HTF bar stamped t only completes at t + rule, so publish it from there.
    block.index = block.index + pd.tseries.frequencies.to_offset(rule)
    return block.reindex(df.index, method="ffill")


def primary_signal(feat: pd.DataFrame, cfg: Config) -> pd.Series:
    """Rule-based SMC entry - the *side*, before any machine learning.

    This is deliberately a transparent checklist rather than a learned
    direction.  Meta-labelling (Lopez de Prado, AFML ch. 3.6) then learns only
    ``P(this setup wins)``, which is a far easier and far more stable problem
    than learning direction from scratch, and it keeps the reason for every
    trade auditable.

    Long checklist (short is the exact mirror):
      1. structure shifted UP recently          (CHoCH/BOS bullish) [MANDATORY]
      2. sell-side liquidity was taken          (swing low swept)
      3. price is in DISCOUNT of the range      (eq_pos < 0.5)  [MANDATORY]
      4. price is at a bullish POI              (order block or FVG)
      5. HTF bias is not fighting the trade
      6. the mirror leg agrees
    """
    s = cfg.structure
    k = max(6, s.swing_lookback * 3)

    shift_dir = _signed_recent(feat["bos"] + feat["choch"], k)
    swept_lo = _recent(feat["swept_low"], k)
    swept_hi = _recent(feat["swept_high"], k)

    at_bull_poi = ((feat["in_bull_ob"] > 0) | (feat["in_bull_fvg"] > 0) |
                   (feat["ob_bull_dist"] < 0.5) | (feat["fvg_bull_dist"] < 0.5))
    at_bear_poi = ((feat["in_bear_ob"] > 0) | (feat["in_bear_fvg"] > 0) |
                   (feat["ob_bear_dist"] < 0.5) | (feat["fvg_bear_dist"] < 0.5))

    discount = feat["eq_pos"] < 0.5
    premium = feat["eq_pos"] > 0.5

    long_score = (
        swept_lo.astype(int)
        + at_bull_poi.astype(int)
        + (feat["htf_bias"] >= 0).astype(int)
        + (feat["mir_divergence"] > 0).astype(int)
        + (feat["fold_proj"] > 0).astype(int)
    )
    short_score = (
        swept_hi.astype(int)
        + at_bear_poi.astype(int)
        + (feat["htf_bias"] <= 0).astype(int)
        + (feat["mir_divergence"] < 0).astype(int)
        + (feat["fold_proj"] < 0).astype(int)
    )

    # MANDATORY conditions - not scored, gated.
    #
    # Making premium/discount merely one confluence among six was a real bug in
    # the first version of this function: 4-of-6 let it be skipped, and the
    # system ended up buying at eq_pos 0.58, i.e. in premium. Buying premium and
    # selling discount is the exact inverse of the concept being tested, so a
    # backtest of it says nothing about SMC. Same for the structure shift: a
    # long without a bullish shift is a falling-knife fade wearing SMC
    # vocabulary.
    long_ok = (shift_dir > 0) & (feat["eq_pos"] < 0.5).fillna(False)
    short_ok = (shift_dir < 0) & (feat["eq_pos"] > 0.5).fillna(False)

    sig = np.where(
        long_ok & (long_score >= 3) & (long_score > short_score), 1,
        np.where(short_ok & (short_score >= 3) & (short_score > long_score), -1, 0),
    )
    return pd.Series(sig, index=feat.index, dtype="int8", name="primary")


def build_features(
    df: pd.DataFrame,
    mirror_df: pd.DataFrame | None = None,
    interval: str = "15m",
    cfg: Config | None = None,
) -> pd.DataFrame:
    """Assemble the full causal feature matrix plus the primary SMC signal."""
    cfg = cfg or CONFIG
    s = cfg.structure

    ms = market_structure(df, s.swing_lookback)
    eq = equal_levels(df, s.swing_lookback, s.equal_level_atr_frac, cfg.label.atr_period)
    zones = smc_zones(df, ms, s.swing_lookback, cfg.label.atr_period, s.max_zone_age)
    mir = mirror_features(df, mirror_df, cfg.mirror)
    vol = volatility_block(df, cfg)
    htf = htf_block(df, interval, cfg)
    tim = time_block(df.index)

    feat = pd.concat([ms, eq, zones, mir, vol, htf, tim], axis=1)
    feat = feat.loc[:, ~feat.columns.duplicated()]

    a = feat["atr"].replace(0.0, np.nan)
    close = df["close"]
    # Distances to structural levels, in ATR - the scale a trader actually uses.
    feat["dist_range_high"] = (feat["range_high"] - close) / a
    feat["dist_range_low"] = (close - feat["range_low"]) / a
    feat["dist_eqh"] = (feat["eqh_level"] - close) / a
    feat["dist_eql"] = (close - feat["eql_level"]) / a
    feat["range_atr"] = feat["range_span"] / a

    for k in (3, 6, 12, 24):
        feat[f"bos_{k}"] = _recent(feat["bos"], k)
        feat[f"choch_{k}"] = _recent(feat["choch"], k)
        feat[f"sweep_hi_{k}"] = _recent(feat["swept_high"], k)
        feat[f"sweep_lo_{k}"] = _recent(feat["swept_low"], k)

    feat["primary"] = primary_signal(feat, cfg)
    return feat.replace([np.inf, -np.inf], np.nan)


# Absolute price levels. Kept in the frame because the execution layer needs
# them to place limit and stop orders, but never fed to the model: a raw price
# guarantees failure the moment the market leaves the training range.
LEVEL_COLUMNS = {
    "range_high", "range_low", "range_span", "protected_high", "protected_low",
    "eqh_level", "eql_level",
    "poi_bull_top", "poi_bull_bot", "poi_bear_top", "poi_bear_bot",
}
FEATURE_BLOCKLIST = {"primary", "atr"} | LEVEL_COLUMNS


def feature_columns(feat: pd.DataFrame) -> list[str]:
    return [c for c in feat.columns
            if c not in FEATURE_BLOCKLIST and pd.api.types.is_numeric_dtype(feat[c])]
