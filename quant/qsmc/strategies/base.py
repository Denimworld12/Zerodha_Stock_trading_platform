"""Strategy interface.

A strategy answers exactly one question: at the close of each bar, do I want to
be long, short, or flat? It returns a Series of -1 / 0 / +1 and nothing else.

Everything downstream is shared and already built — triple-barrier labelling,
purged walk-forward meta-labelling, the portfolio backtester, the deflated
Sharpe, the causality tests. That is the whole point of the split: adding a
candidate costs about a hundred lines and it is judged by the SAME harness that
found SMC wanting, rather than by a bespoke backtest written by whoever was
hoping it would work.

THE ONE RULE
------------
`generate` must be causal. Row ``t`` may use bars up to and including ``t`` and
nothing after. `quant/tests/test_causality.py` truncation-tests every column and
will catch a violation, so run it after adding a strategy.
"""
from __future__ import annotations

import abc
from dataclasses import dataclass, field

import numpy as np
import pandas as pd


@dataclass
class StrategyContext:
    """Everything a strategy is allowed to look at."""

    symbol: str
    interval: str
    bars: pd.DataFrame                     # OHLCV, open-time indexed
    features: pd.DataFrame                 # the shared causal feature matrix
    mirror: pd.DataFrame | None = None     # the correlated leg, when one exists
    universe: dict[str, pd.DataFrame] = field(default_factory=dict)  # cross-sectional


class Strategy(abc.ABC):
    """Base class. Subclasses implement :meth:`generate`."""

    name: str = "unnamed"
    # A one-line statement of what the strategy believes. Written down because a
    # strategy whose thesis cannot be stated in a sentence is usually a curve fit.
    thesis: str = ""
    # Strategies whose edge (if any) needs many bars are wasted on 15m crypto and
    # vice versa; the tournament uses this to skip nonsensical pairings.
    timeframes: tuple[str, ...] = ("15m", "1h", "4h", "1d")

    #: Free parameters. Kept explicit so the tournament can report how many
    #: knobs each candidate had — a strategy with twelve tunables that beats one
    #: with two has not necessarily found more.
    params: dict = field(default_factory=dict)

    def __init__(self, **params):
        self.params = {**getattr(self, "defaults", {}), **params}

    @abc.abstractmethod
    def generate(self, ctx: StrategyContext) -> pd.Series:
        """Return -1 / 0 / +1 per bar, indexed like ``ctx.bars``."""

    # -- helpers available to every strategy -------------------------------
    @staticmethod
    def _flat(index) -> pd.Series:
        return pd.Series(0, index=index, dtype="int8")

    @staticmethod
    def _clean(signal: pd.Series, index) -> pd.Series:
        """Coerce to the contract: aligned, integer, in {-1, 0, 1}, no NaN."""
        s = pd.Series(signal, index=index).reindex(index)
        s = s.fillna(0)
        s = np.sign(s).astype("int8")
        return s

    @staticmethod
    def debounce(signal: pd.Series, min_bars: int) -> pd.Series:
        """Suppress a new entry within ``min_bars`` of the previous one.

        Without this a condition that stays true for thirty bars produces thirty
        "signals", the labeller races thirty overlapping trades against the same
        barriers, and the backtest reports a conviction the strategy never had.
        """
        if min_bars <= 1:
            return signal
        out = signal.to_numpy(copy=True)
        last = -10**9
        for i in range(len(out)):
            if out[i] == 0:
                continue
            if i - last < min_bars:
                out[i] = 0
            else:
                last = i
        return pd.Series(out, index=signal.index, dtype="int8")

    def describe(self) -> dict:
        return {
            "name": self.name,
            "thesis": self.thesis,
            "params": dict(self.params),
            "n_params": len(self.params),
            "timeframes": list(self.timeframes),
        }


class SignalFromColumn(Strategy):
    """Wraps a precomputed column, so the existing SMC rules join the tournament
    without being reimplemented."""

    def __init__(self, column: str, name: str, thesis: str = "", **params):
        super().__init__(**params)
        self.column = column
        self.name = name
        self.thesis = thesis

    def generate(self, ctx: StrategyContext) -> pd.Series:
        if self.column not in ctx.features.columns:
            return self._flat(ctx.bars.index)
        return self._clean(ctx.features[self.column], ctx.bars.index)


# ---------------------------------------------------------------------------
_REGISTRY: dict[str, type[Strategy]] = {}


def register(cls: type[Strategy]) -> type[Strategy]:
    """Decorator. Registering by name is what lets the tournament enumerate
    candidates without importing each one explicitly."""
    if not cls.name or cls.name == "unnamed":
        raise ValueError(f"{cls.__name__} must set a name")
    if cls.name in _REGISTRY:
        raise ValueError(f"duplicate strategy name {cls.name!r}")
    _REGISTRY[cls.name] = cls
    return cls


def available() -> dict[str, type[Strategy]]:
    from . import library  # noqa: F401  (import registers the built-ins)
    return dict(_REGISTRY)


def build(name: str, **params) -> Strategy:
    cls = available().get(name)
    if cls is None:
        raise KeyError(f"unknown strategy {name!r}; have {sorted(available())}")
    return cls(**params)
