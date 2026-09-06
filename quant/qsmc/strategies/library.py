"""Candidate strategies.

Deliberately drawn from different families, because testing six variations of
one idea only tells you about that idea. Each states its thesis in a sentence:
a strategy whose premise cannot be written down is usually a curve fit wearing
a name.

Every one of these is judged by the same harness that found SMC wanting — same
labelling, same purged walk-forward, same deflated Sharpe, same null and oracle
controls. That is the point. None of them is expected to work; the value is in
finding out cheaply and honestly which, if any, do.
"""
from __future__ import annotations

import numpy as np
import pandas as pd

from .base import Strategy, StrategyContext, register


# ---------------------------------------------------------------------------
@register
class SmcMirror(Strategy):
    name = "smc_mirror"
    thesis = ("Price returns to an institutional order block in the discounted "
              "half of its range after taking liquidity, in the direction of a "
              "structure break.")
    timeframes = ("15m", "1h", "4h")
    defaults = {}

    def generate(self, ctx: StrategyContext) -> pd.Series:
        # Already computed by features.build.primary_signal.
        return self._clean(ctx.features.get("primary", 0), ctx.bars.index)


# ---------------------------------------------------------------------------
@register
class TimeSeriesMomentum(Strategy):
    name = "ts_momentum"
    thesis = ("What has gone up over the last N bars keeps going up. The single "
              "most replicated anomaly in the literature, and the honest "
              "benchmark any discretionary system should have to beat.")
    timeframes = ("1h", "4h", "1d")
    defaults = {"lookback": 96, "vol_window": 96, "min_z": 0.5, "debounce": 12}

    def generate(self, ctx: StrategyContext) -> pd.Series:
        p = self.params
        close = ctx.bars["close"]
        ret = np.log(close).diff(p["lookback"])
        vol = np.log(close).diff().rolling(p["vol_window"], min_periods=p["vol_window"] // 2).std(ddof=0)

        # Volatility-scale the signal, or the strategy simply trades whichever
        # instrument happens to be moving most rather than whichever is trending.
        z = ret / (vol * np.sqrt(p["lookback"])).replace(0.0, np.nan)
        raw = np.where(z > p["min_z"], 1, np.where(z < -p["min_z"], -1, 0))
        return self.debounce(self._clean(pd.Series(raw, index=close.index), close.index),
                             p["debounce"])


# ---------------------------------------------------------------------------
@register
class MeanReversion(Strategy):
    name = "mean_reversion"
    thesis = ("A move far enough from its own recent mean, without a trend to "
              "justify it, reverts. The natural opposite of momentum, included "
              "so the two can be compared on the same sample.")
    timeframes = ("15m", "1h", "4h")
    defaults = {"window": 48, "entry_z": 2.0, "trend_window": 240, "debounce": 8}

    def generate(self, ctx: StrategyContext) -> pd.Series:
        p = self.params
        close = ctx.bars["close"]
        mean = close.rolling(p["window"], min_periods=p["window"] // 2).mean()
        std = close.rolling(p["window"], min_periods=p["window"] // 2).std(ddof=0)
        z = (close - mean) / std.replace(0.0, np.nan)

        # Fading a strong trend is how mean reversion dies. Only fade when the
        # longer-horizon drift is not against us.
        trend = np.log(close).diff(p["trend_window"])
        calm = trend.abs() < trend.abs().rolling(500, min_periods=100).quantile(0.7)

        raw = np.where((z < -p["entry_z"]) & calm, 1,
                       np.where((z > p["entry_z"]) & calm, -1, 0))
        return self.debounce(self._clean(pd.Series(raw, index=close.index), close.index),
                             p["debounce"])


# ---------------------------------------------------------------------------
@register
class MirrorPairsSpread(Strategy):
    name = "mirror_pairs"
    thesis = ("Two instruments locked by a stable hedge ratio cannot both be "
              "right when their beta-hedged spread dislocates; the cheap leg "
              "converges. This is the Mirror-Market idea stated as statistical "
              "arbitrage rather than as chart geometry.")
    timeframes = ("15m", "1h", "4h")
    defaults = {"entry_z": 2.0, "exit_z": 0.5, "min_abs_corr": 0.5, "debounce": 6}

    def generate(self, ctx: StrategyContext) -> pd.Series:
        p = self.params
        f = ctx.features
        if "mir_spread_z" not in f.columns:
            return self._flat(ctx.bars.index)

        z = f["mir_spread_z"]
        live = f.get("mir_regime", pd.Series(0, index=f.index)) > 0
        strong = f.get("mir_corr", pd.Series(0.0, index=f.index)).abs() >= p["min_abs_corr"]

        # Buy this leg when the spread says it is cheap relative to its hedge.
        raw = np.where(live & strong & (z <= -p["entry_z"]), 1,
                       np.where(live & strong & (z >= p["entry_z"]), -1, 0))
        return self.debounce(self._clean(pd.Series(raw, index=f.index), ctx.bars.index),
                             p["debounce"])


# ---------------------------------------------------------------------------
@register
class VolatilityBreakout(Strategy):
    name = "vol_breakout"
    thesis = ("A range that has compressed is storing energy; the first close "
              "outside it continues. Squeeze-then-break, which is what most "
              "discretionary breakout trading is trying to formalise.")
    timeframes = ("15m", "1h", "4h", "1d")
    defaults = {"channel": 48, "squeeze_window": 240, "squeeze_pct": 0.3, "debounce": 12}

    def generate(self, ctx: StrategyContext) -> pd.Series:
        p = self.params
        bars = ctx.bars
        # shift(1): the channel must exclude the bar doing the breaking, or the
        # high that defines the level is the same high that clears it.
        upper = bars["high"].rolling(p["channel"], min_periods=p["channel"] // 2).max().shift(1)
        lower = bars["low"].rolling(p["channel"], min_periods=p["channel"] // 2).min().shift(1)

        width = (upper - lower) / bars["close"]
        squeezed = width <= width.rolling(
            p["squeeze_window"], min_periods=p["squeeze_window"] // 2
        ).quantile(p["squeeze_pct"])

        close = bars["close"]
        raw = np.where(squeezed & (close > upper), 1,
                       np.where(squeezed & (close < lower), -1, 0))
        return self.debounce(self._clean(pd.Series(raw, index=bars.index), bars.index),
                             p["debounce"])


# ---------------------------------------------------------------------------
@register
class VolatilityRegime(Strategy):
    name = "vol_regime"
    thesis = ("Trend-follow when realised volatility is expanding and fade when "
              "it is contracting. Not a signal so much as a claim that WHICH "
              "strategy works depends on the regime — the cheapest way to test "
              "that claim directly.")
    timeframes = ("1h", "4h", "1d")
    defaults = {"fast": 24, "slow": 120, "expand": 1.2, "contract": 0.8,
                "mom_lookback": 48, "debounce": 12}

    def generate(self, ctx: StrategyContext) -> pd.Series:
        p = self.params
        close = ctx.bars["close"]
        ret = np.log(close).diff()

        rv_fast = ret.rolling(p["fast"], min_periods=p["fast"] // 2).std(ddof=0)
        rv_slow = ret.rolling(p["slow"], min_periods=p["slow"] // 2).std(ddof=0)
        ratio = rv_fast / rv_slow.replace(0.0, np.nan)

        mom = np.sign(np.log(close).diff(p["mom_lookback"]).fillna(0))
        raw = np.where(ratio >= p["expand"], mom,
                       np.where(ratio <= p["contract"], -mom, 0))
        return self.debounce(self._clean(pd.Series(raw, index=close.index), close.index),
                             p["debounce"])


# ---------------------------------------------------------------------------
@register
class CrossSectionalRank(Strategy):
    name = "xs_rank"
    thesis = ("Within a universe, buy the strongest and sell the weakest. "
              "Relative strength survives market-wide moves that swamp any "
              "single-instrument signal — the reason it needs the universe, not "
              "just this symbol.")
    timeframes = ("1h", "4h", "1d")
    defaults = {"lookback": 96, "top_frac": 0.25, "debounce": 12}

    def generate(self, ctx: StrategyContext) -> pd.Series:
        p = self.params
        index = ctx.bars.index
        peers = ctx.universe
        if len(peers) < 3:
            # With too few instruments a "rank" is noise dressed as a cross
            # section. Refusing is more honest than emitting something.
            return self._flat(index)

        scores = {}
        for sym, df in peers.items():
            r = np.log(df["close"]).diff(p["lookback"])
            scores[sym] = r.reindex(index).ffill()
        panel = pd.DataFrame(scores)

        # Rank within each bar; the ranks are what matter, not the raw returns.
        ranks = panel.rank(axis=1, pct=True)
        me = ranks.get(ctx.symbol)
        if me is None:
            return self._flat(index)

        hi, lo = 1 - p["top_frac"], p["top_frac"]
        raw = np.where(me >= hi, 1, np.where(me <= lo, -1, 0))
        return self.debounce(self._clean(pd.Series(raw, index=index), index), p["debounce"])


# ---------------------------------------------------------------------------
@register
class SessionOpenRange(Strategy):
    name = "session_open"
    thesis = ("The first hours of the London and New York sessions set a range; "
              "breaking it carries. The one genuinely SMC-adjacent idea here, "
              "and the one place session structure should matter most.")
    timeframes = ("15m", "1h")
    defaults = {"range_bars": 4, "session_start_utc": 7, "debounce": 24}

    def generate(self, ctx: StrategyContext) -> pd.Series:
        p = self.params
        bars = ctx.bars
        idx = bars.index

        # Mark the opening window of each session day.
        hour = idx.hour
        start = p["session_start_utc"]
        # Approximate bars-per-hour from the median spacing.
        gaps = pd.Series(idx).diff().dropna()
        per_hour = max(1, int(round(3600 / max(1.0, gaps.median().total_seconds()))))
        window = p["range_bars"] * per_hour

        opening = (hour >= start) & (hour < start + p["range_bars"])
        day = pd.Series(idx.date, index=idx)

        hi = bars["high"].where(opening).groupby(day).transform(
            lambda s: s.expanding().max()).ffill()
        lo = bars["low"].where(opening).groupby(day).transform(
            lambda s: s.expanding().min()).ffill()

        # Only trade AFTER the opening window closes; inside it the range is
        # still forming and "breaking" it is meaningless.
        after = ~opening
        close = bars["close"]
        raw = np.where(after & (close > hi), 1, np.where(after & (close < lo), -1, 0))
        return self.debounce(self._clean(pd.Series(raw, index=idx), idx), p["debounce"])
