"""Leakage tests.

The premise: if a feature at bar ``t`` only uses bars ``<= t``, then computing
the matrix on the first ``N`` bars and on the first ``N + k`` bars must give
IDENTICAL values for every row up to ``N``.  Any feature that peeks forward
changes when you show it more future - which is exactly what this catches.

This is the only test that stands between a beautiful backtest and a real one.
"""
from __future__ import annotations

import numpy as np
import pandas as pd

from qsmc.data.loaders import load_cached
from qsmc.features.build import build_features, feature_columns
from qsmc.features.smc import smc_zones
from qsmc.features.structure import market_structure


def _truncation_invariance(fn, df, mirror=None, cut=400, tol=1e-9):
    """Return the columns whose past values change when the future is revealed."""
    full = fn(df, mirror) if mirror is not None else fn(df)
    part = fn(df.iloc[:-cut], mirror.iloc[:-cut]) if mirror is not None else fn(df.iloc[:-cut])

    n = len(part)
    # Ignore the warm-up head, where rolling windows are still filling.
    head = min(600, n // 2)
    offenders = {}
    for col in part.columns:
        if not pd.api.types.is_numeric_dtype(part[col]):
            continue
        a = full[col].to_numpy("float64")[head:n]
        b = part[col].to_numpy("float64")[head:n]
        both_nan = np.isnan(a) & np.isnan(b)
        diff = np.abs(np.where(both_nan, 0.0, np.nan_to_num(a - b, nan=np.inf)))
        bad = int(np.sum(diff > tol))
        if bad:
            finite = diff[np.isfinite(diff)]
            worst = float(finite.max()) if finite.size else float("inf")
            offenders[col] = (bad, worst)
    return offenders, n


def main() -> int:
    base = load_cached("BTCUSDT", "15m", limit_bars=3000)
    mirror = load_cached("ETHUSDT", "15m", limit_bars=3000)

    failures = 0

    print("1. market_structure ...", end=" ")
    off, n = _truncation_invariance(lambda d, *_: market_structure(d, 3), base)
    print("OK" if not off else f"LEAK {off}")
    failures += bool(off)

    print("2. smc_zones ...", end=" ")
    off, n = _truncation_invariance(lambda d, *_: smc_zones(d), base)
    print("OK" if not off else f"LEAK {off}")
    failures += bool(off)

    print("3. build_features (full matrix) ...", end=" ")
    off, n = _truncation_invariance(
        lambda d, m: build_features(d, m, "15m"), base, mirror)
    print("OK" if not off else f"LEAK {off}")
    failures += bool(off)

    # 4. A deliberately leaky feature must be CAUGHT, otherwise the test above
    #    proves nothing about the test itself.
    print("4. self-check (planted leak must be detected) ...", end=" ")
    def leaky(d, *_):
        f = build_features(d, None, "15m")
        f["PLANTED_LEAK"] = d["close"].shift(-1)
        return f
    off, _ = _truncation_invariance(leaky, base)
    caught = "PLANTED_LEAK" in off
    print("OK (caught)" if caught else "BROKEN - test cannot detect leaks")
    failures += (not caught)

    print()
    print("RESULT:", "ALL PASS" if failures == 0 else f"{failures} FAILURE(S)")
    return failures


if __name__ == "__main__":
    raise SystemExit(main())
