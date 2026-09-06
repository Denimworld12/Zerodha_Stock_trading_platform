"""Smart-Money-Concepts points of interest: order blocks, fair-value gaps,
displacement and mitigation.

A "zone" here is a price band born on a specific bar and carried forward until
it is mitigated or expires.  Every zone is created only from information
available at its birth bar, and features describe the *current* bar's relation
to the zones alive at that moment - so the whole module is causal.
"""
from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np
import pandas as pd

from .structure import atr, market_structure

BIG = 99.0          # sentinel "no zone anywhere near", in ATR units


@dataclass
class Zone:
    kind: int            # +1 bullish (demand), -1 bearish (supply)
    top: float
    bottom: float
    created: int
    strength: float      # displacement that created it, in ATR
    touches: int = 0
    mitigated: bool = False

    def contains(self, price: float) -> bool:
        return self.bottom <= price <= self.top

    @property
    def mid(self) -> float:
        return 0.5 * (self.top + self.bottom)


@dataclass
class _ZoneBook:
    """Live set of zones, pruned every bar."""

    max_age: int
    zones: list[Zone] = field(default_factory=list)

    def add(self, z: Zone) -> None:
        self.zones.append(z)

    def update(self, i: int, high: float, low: float, close: float) -> None:
        alive: list[Zone] = []
        for z in self.zones:
            if i - z.created > self.max_age:
                continue
            # Mitigation: a bullish zone dies when price closes fully below it,
            # a bearish zone when price closes fully above it. Trading *through*
            # a zone is what invalidates it; merely tapping it is a touch.
            if z.kind == 1 and close < z.bottom:
                continue
            if z.kind == -1 and close > z.top:
                continue
            if low <= z.top and high >= z.bottom:
                z.touches += 1
                z.mitigated = True
            alive.append(z)
        self.zones = alive

    def nearest_zone(self, kind: int, price: float) -> Zone | None:
        best, best_d = None, np.inf
        for z in self.zones:
            if z.kind != kind:
                continue
            d = 0.0 if z.contains(price) else (price - z.top if price > z.top else z.bottom - price)
            if abs(d) < best_d:
                best_d, best = abs(d), z
        return best

    def nearest(self, kind: int, price: float, atr_val: float) -> tuple[float, float, float, int]:
        """(distance in ATR, strength, touch count, inside flag).

        The sentinel ``BIG`` for distance and touches means "no zone of this
        kind is alive" - a distinct value a tree can split on, rather than a
        zero that would read as "we are standing right on one".
        """
        best = None
        best_d = np.inf
        for z in self.zones:
            if z.kind != kind:
                continue
            if z.contains(price):
                d = 0.0
            elif price > z.top:
                d = price - z.top
            else:
                d = z.bottom - price
            if abs(d) < best_d:
                best_d, best = abs(d), z
        if best is None or not np.isfinite(atr_val) or atr_val <= 0:
            return BIG, 0.0, BIG, 0
        return (
            min(best_d / atr_val, BIG),
            best.strength,
            float(best.touches),
            int(best.contains(price)),
        )

    def count(self, kind: int) -> int:
        return sum(1 for z in self.zones if z.kind == kind)


def smc_zones(
    df: pd.DataFrame,
    structure: pd.DataFrame | None = None,
    swing_n: int = 3,
    atr_period: int = 14,
    max_age: int = 200,
    ob_lookback: int = 12,
    min_displacement_atr: float = 1.0,
) -> pd.DataFrame:
    """Build order-block / FVG zones and emit per-bar relational features.

    Order block
        The last opposing-close candle before the displacement leg that broke
        structure.  It is *discovered* on the break bar, which is exactly when a
        live trader could mark it, so the zone is published from that bar on.

    Fair value gap
        Three-candle imbalance: bar ``i`` prints a low above bar ``i-2``'s high
        (bullish) or a high below bar ``i-2``'s low (bearish).  Known at bar
        ``i``.
    """
    if structure is None:
        structure = market_structure(df, swing_n)

    size = len(df)
    o = df["open"].to_numpy("float64")
    h = df["high"].to_numpy("float64")
    l = df["low"].to_numpy("float64")
    c = df["close"].to_numpy("float64")
    a = atr(df, atr_period).to_numpy("float64")
    shift = (structure["bos"].to_numpy("int8") + structure["choch"].to_numpy("int8"))

    obs = _ZoneBook(max_age)
    fvgs = _ZoneBook(max_age)

    cols = {k: np.zeros(size) for k in (
        "ob_bull_dist", "ob_bear_dist", "ob_bull_strength", "ob_bear_strength",
        "ob_bull_touches", "ob_bear_touches", "in_bull_ob", "in_bear_ob",
        "fvg_bull_dist", "fvg_bear_dist", "fvg_bull_strength", "fvg_bear_strength",
        "in_bull_fvg", "in_bear_fvg", "n_bull_ob", "n_bear_ob",
        "n_bull_fvg", "n_bear_fvg", "displacement", "body_frac", "wick_up", "wick_down",
    )}
    # Absolute zone boundaries. These are NOT model features - a raw price level
    # cannot generalise past the training range. They exist so the execution
    # layer can place a limit order at the zone edge and a stop beyond it.
    levels = {k: np.full(size, np.nan) for k in (
        "poi_bull_top", "poi_bull_bot", "poi_bear_top", "poi_bear_bot",
    )}

    for i in range(size):
        av = a[i]
        # --- new fair value gap (needs i-2) ------------------------------
        if i >= 2 and np.isfinite(av) and av > 0:
            gap_up = l[i] - h[i - 2]
            gap_dn = l[i - 2] - h[i]
            if gap_up > 0:
                fvgs.add(Zone(1, l[i], h[i - 2], i, min(gap_up / av, BIG)))
            if gap_dn > 0:
                fvgs.add(Zone(-1, l[i - 2], h[i], i, min(gap_dn / av, BIG)))

        # --- new order block, discovered on the structure-break bar -------
        if shift[i] != 0 and np.isfinite(av) and av > 0:
            direction = int(np.sign(shift[i]))
            start = max(0, i - ob_lookback)
            leg = (c[i] - l[start:i + 1].min()) if direction == 1 else (h[start:i + 1].max() - c[i])
            if leg / av >= min_displacement_atr:
                # walk back to the last candle that closed against the break
                for j in range(i - 1, start - 1, -1):
                    opposing = (c[j] < o[j]) if direction == 1 else (c[j] > o[j])
                    if opposing:
                        obs.add(Zone(direction, h[j], l[j], i, min(leg / av, BIG)))
                        break

        # --- age out / mitigate, then measure ----------------------------
        obs.update(i, h[i], l[i], c[i])
        fvgs.update(i, h[i], l[i], c[i])

        d, s, t, inside = obs.nearest(1, c[i], av)
        cols["ob_bull_dist"][i], cols["ob_bull_strength"][i] = d, s
        cols["ob_bull_touches"][i], cols["in_bull_ob"][i] = t, inside
        d, s, t, inside = obs.nearest(-1, c[i], av)
        cols["ob_bear_dist"][i], cols["ob_bear_strength"][i] = d, s
        cols["ob_bear_touches"][i], cols["in_bear_ob"][i] = t, inside

        d, s, _, inside = fvgs.nearest(1, c[i], av)
        cols["fvg_bull_dist"][i], cols["fvg_bull_strength"][i], cols["in_bull_fvg"][i] = d, s, inside
        d, s, _, inside = fvgs.nearest(-1, c[i], av)
        cols["fvg_bear_dist"][i], cols["fvg_bear_strength"][i], cols["in_bear_fvg"][i] = d, s, inside

        # Nearest actionable POI: prefer an order block, fall back to an FVG.
        for kind, tag in ((1, "bull"), (-1, "bear")):
            z = obs.nearest_zone(kind, c[i]) or fvgs.nearest_zone(kind, c[i])
            if z is not None:
                levels[f"poi_{tag}_top"][i] = z.top
                levels[f"poi_{tag}_bot"][i] = z.bottom

        cols["n_bull_ob"][i] = obs.count(1)
        cols["n_bear_ob"][i] = obs.count(-1)
        cols["n_bull_fvg"][i] = fvgs.count(1)
        cols["n_bear_fvg"][i] = fvgs.count(-1)

        rng = h[i] - l[i]
        if np.isfinite(av) and av > 0:
            cols["displacement"][i] = (c[i] - o[i]) / av
            cols["wick_up"][i] = (h[i] - max(o[i], c[i])) / av
            cols["wick_down"][i] = (min(o[i], c[i]) - l[i]) / av
        cols["body_frac"][i] = abs(c[i] - o[i]) / rng if rng > 0 else 0.0

    return pd.DataFrame({**cols, **levels}, index=df.index)
