"""Performance statistics, including the ones that push back.

Sharpe alone is not evidence.  When you try N strategy variants and keep the
best, the winner's Sharpe is inflated by selection.  The Deflated Sharpe Ratio
(Bailey & Lopez de Prado, 2014) asks the only question that matters: given how
many things I tried and how skewed/fat-tailed the returns are, what is the
probability this Sharpe is greater than zero for real?
"""
from __future__ import annotations

import numpy as np
import pandas as pd
from scipy import stats


def _ann_factor(index: pd.DatetimeIndex) -> float:
    """Periods per year, inferred from the actual bar spacing.

    Do NOT compute this as ``np.diff(index.astype("int64")) / 1e9``. That assumes
    nanosecond resolution, but pandas preserves whatever unit the index was
    built with — microseconds here — so the result came out 1000x too small and
    every annualised Sharpe was inflated by sqrt(1000) ~= 31.6x. Going through
    Timedelta makes the arithmetic unit-agnostic.

    The bar spacing is also measured by MEDIAN rather than mean so that FX
    weekend gaps, which are ~65x a normal bar, do not drag the estimate.
    """
    if len(index) < 3:
        return 252.0
    gaps = pd.Series(index).diff().dropna()
    if gaps.empty:
        return 252.0
    dt = gaps.median().total_seconds()
    if not np.isfinite(dt) or dt <= 0:
        return 252.0

    seconds_per_year = 365.25 * 24 * 3600
    periods = seconds_per_year / dt

    # An instrument that only trades part of the week cannot have as many bars
    # per year as the clock allows. Scale by the fraction of wall-clock time the
    # series actually covers, or FX and equities are credited with sessions that
    # never happened.
    span = (index[-1] - index[0]).total_seconds()
    if span > 0:
        coverage = min(1.0, (len(index) * dt) / span)
        periods *= coverage
    return max(1.0, periods)


def sharpe(returns: pd.Series, periods: float | None = None) -> float:
    r = returns.dropna()
    if len(r) < 3 or r.std(ddof=1) == 0:
        return 0.0
    p = periods or _ann_factor(r.index)
    return float(r.mean() / r.std(ddof=1) * np.sqrt(p))


def sortino(returns: pd.Series, periods: float | None = None) -> float:
    r = returns.dropna()
    downside = r[r < 0]
    if len(r) < 3 or len(downside) == 0 or downside.std(ddof=1) == 0:
        return 0.0
    p = periods or _ann_factor(r.index)
    return float(r.mean() / downside.std(ddof=1) * np.sqrt(p))


def max_drawdown(equity: pd.Series) -> tuple[float, int]:
    peak = equity.cummax()
    dd = equity / peak - 1.0
    trough = int(dd.values.argmin()) if len(dd) else 0
    # longest underwater stretch, in bars
    underwater = (equity < peak).astype(int)
    longest = cur = 0
    for u in underwater.to_numpy():
        cur = cur + 1 if u else 0
        longest = max(longest, cur)
    return float(dd.min()) if len(dd) else 0.0, longest


def deflated_sharpe(returns: pd.Series, n_trials: int = 1, periods: float | None = None) -> float:
    """P(true Sharpe > 0) after correcting for multiple testing and non-normality."""
    r = returns.dropna()
    n = len(r)
    if n < 20 or r.std(ddof=1) == 0:
        return 0.0
    p = periods or _ann_factor(r.index)
    sr = float(r.mean() / r.std(ddof=1))            # per-period, not annualised
    g3 = float(stats.skew(r))
    g4 = float(stats.kurtosis(r, fisher=False))

    # Expected maximum Sharpe from n_trials pure-noise strategies.
    if n_trials > 1:
        e = 0.5772156649
        z1 = stats.norm.ppf(1 - 1.0 / n_trials)
        z2 = stats.norm.ppf(1 - 1.0 / (n_trials * np.e))
        sr0 = (1 - e) * z1 + e * z2
    else:
        sr0 = 0.0
    sr0 = sr0 / np.sqrt(n)                           # scale to per-period units

    denom = np.sqrt(max(1e-12, 1 - g3 * sr + 0.25 * (g4 - 1) * sr ** 2))
    z = (sr - sr0) * np.sqrt(n - 1) / denom
    return float(stats.norm.cdf(z))


def trade_stats(trades: pd.DataFrame) -> dict:
    if trades.empty:
        return {"trades": 0}
    pnl = trades["pnl"]
    wins, losses = pnl[pnl > 0], pnl[pnl < 0]
    gross_win = float(wins.sum())
    gross_loss = float(-losses.sum())
    return {
        "trades": int(len(trades)),
        "win_rate": round(float((pnl > 0).mean()), 4),
        "profit_factor": round(gross_win / gross_loss, 3) if gross_loss > 0 else float("inf"),
        "expectancy_R": round(float(trades["r_net"].mean()), 4),
        "avg_win_R": round(float(trades.loc[pnl > 0, "r_net"].mean()), 3) if len(wins) else 0.0,
        "avg_loss_R": round(float(trades.loc[pnl < 0, "r_net"].mean()), 3) if len(losses) else 0.0,
        "best_R": round(float(trades["r_net"].max()), 3),
        "worst_R": round(float(trades["r_net"].min()), 3),
        "longs": int((trades["side"] == 1).sum()),
        "shorts": int((trades["side"] == -1).sum()),
        "avg_bars_held": round(float(trades["bars_held"].mean()), 1),
    }


def summarise(equity: pd.Series, trades: pd.DataFrame, n_trials: int = 1) -> dict:
    rets = equity.pct_change().dropna()
    dd, uw = max_drawdown(equity)
    total = float(equity.iloc[-1] / equity.iloc[0] - 1.0) if len(equity) > 1 else 0.0
    days = max(1e-9, (equity.index[-1] - equity.index[0]).total_seconds() / 86400) if len(equity) > 1 else 1.0
    cagr = (1 + total) ** (365.25 / days) - 1 if total > -1 else -1.0

    out = {
        "total_return": round(total, 4),
        "CAGR": round(float(cagr), 4),
        "sharpe": round(sharpe(rets), 3),
        "sortino": round(sortino(rets), 3),
        "max_drawdown": round(dd, 4),
        "longest_underwater_bars": int(uw),
        "calmar": round(float(cagr / abs(dd)), 3) if dd < 0 else float("inf"),
        "deflated_sharpe_p": round(deflated_sharpe(rets, n_trials), 4),
        "n_trials_assumed": n_trials,
    }
    out.update(trade_stats(trades))
    return out
