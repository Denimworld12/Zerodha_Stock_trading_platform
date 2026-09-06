"""Does the evaluation harness actually work?

Reporting "OOF AUC = 0.47, therefore no edge" is only honest if the harness
would have SHOWN an edge that was really there. A broken pipeline also returns
0.5, and the two look identical from the outside.

So two controls:

  NULL   shuffle the labels -> AUC must collapse to ~0.5.
         Catches leakage and any accidental target encoding.

  ORACLE plant a feature that genuinely (but noisily) knows the answer ->
         AUC must rise well above 0.5.
         Catches a harness so over-purged or mis-aligned that nothing could
         ever score, which would make every negative result meaningless.

Only if NULL fails low AND ORACLE passes high does a real 0.47 mean "no edge".
"""
from __future__ import annotations

import numpy as np
import pandas as pd

from qsmc.config import CONFIG, mirror_of
from qsmc.data.loaders import load_cached, load_fx
from qsmc.features.build import build_features, feature_columns
from qsmc.features.structure import atr
from qsmc.labeling import triple_barrier
from qsmc.model.train import train_meta_model

import os

# `SOURCE=fx` runs the same controls on real FX mirror pairs, which is the case
# the crypto sample could not test: Binance quotes everything in USDT, so
# BTC/ETH measured rho = +0.85 rather than the negative correlation the
# Mirror-Market concept assumes. EURUSD/USDCHF measures -0.74.
SOURCE = os.getenv("SOURCE", "crypto")
if SOURCE == "fx":
    SYMBOLS = ["EURUSD", "GBPUSD", "USDJPY", "AUDUSD"]
    INTERVAL = "1h"
else:
    SYMBOLS = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT"]
    INTERVAL = "15m"
BARS = 20000


def _load(sym):
    if SOURCE == "fx":
        return load_fx(sym, INTERVAL, "730d")
    return load_cached(sym, INTERVAL, limit_bars=BARS)


def assemble():
    labs, feats = [], []
    for sym in SYMBOLS:
        base = _load(sym)
        mir = _load(mirror_of(sym))
        f = build_features(base, mir, INTERVAL, CONFIG)
        lab = triple_barrier(base, f["primary"], atr(base, CONFIG.label.atr_period), CONFIG.label)
        if lab.empty:
            continue
        lab = lab.copy()
        lab["symbol"] = sym
        labs.append(lab.reset_index())
        feats.append(f.reindex(lab.index).reset_index(drop=True))

    labels = pd.concat(labs, ignore_index=True)
    features = pd.concat(feats, ignore_index=True)
    order = np.argsort(labels["entry_time"].to_numpy(), kind="stable")
    return (labels.iloc[order].reset_index(drop=True),
            features.iloc[order].reset_index(drop=True))


def mean_auc(features, labels, cols):
    _, _, reports, _ = train_meta_model(features, labels, cols, CONFIG, verbose=False)
    aucs = [r.auc for r in reports if r.auc == r.auc]
    return float(np.mean(aucs)) if aucs else float("nan")


def main() -> int:
    labels, features = assemble()
    cols = feature_columns(features)
    rng = np.random.default_rng(CONFIG.seed)
    print(f"events={len(labels)}  features={len(cols)}\n")

    real = mean_auc(features, labels, cols)
    print(f"REAL    mean OOF AUC = {real:.4f}")

    null_labels = labels.copy()
    null_labels["meta_label"] = rng.permutation(null_labels["meta_label"].to_numpy())
    null = mean_auc(features, null_labels, cols)
    print(f"NULL    mean OOF AUC = {null:.4f}   (shuffled labels; must be ~0.50)")

    orc_features = features.copy()
    y = labels["meta_label"].to_numpy()
    noise = rng.random(len(y)) < 0.25          # 25% of the time the oracle lies
    orc_features["ORACLE"] = np.where(noise, 1 - y, y) + rng.normal(0, 0.1, len(y))
    oracle = mean_auc(orc_features, labels, cols + ["ORACLE"])
    print(f"ORACLE  mean OOF AUC = {oracle:.4f}   (planted 75%-accurate feature; must be >>0.50)")

    print()
    ok_null = abs(null - 0.5) < 0.08
    ok_oracle = oracle > 0.70
    print(f"  NULL   collapses to chance : {'PASS' if ok_null else 'FAIL'}")
    print(f"  ORACLE detected            : {'PASS' if ok_oracle else 'FAIL'}")
    print()
    if ok_null and ok_oracle:
        print("Harness is sound. Therefore the REAL score is a genuine measurement:")
        print(f"  {real:.4f} vs 0.50 chance -> the SMC + Mirror features carry no")
        print("  usable information about whether a setup reaches its target.")
    else:
        print("Harness is NOT trustworthy; the real score means nothing yet.")
    return 0 if (ok_null and ok_oracle) else 1


if __name__ == "__main__":
    raise SystemExit(main())
