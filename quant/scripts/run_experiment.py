"""End-to-end research run: data -> features -> labels -> meta-model -> backtest.

Reports three equity curves so the model's contribution is isolated:

  A. buy & hold          the benchmark you must beat to justify existing
  B. SMC rules only      every primary signal taken, no ML
  C. SMC + meta-model    only the signals the walk-forward model believes in

If C does not beat B out-of-sample, the model is decoration and should be
deleted rather than deployed.

Usage:
    PYTHONPATH=quant python quant/scripts/run_experiment.py \
        --symbols BTCUSDT ETHUSDT SOLUSDT --interval 15m --bars 20000
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from qsmc.config import CONFIG, ARTIFACT_DIR, mirror_of
from qsmc.data.loaders import load_cached, load_fx
from qsmc.features.build import build_features, feature_columns
from qsmc.features.structure import atr
from qsmc.labeling import triple_barrier, label_summary
from qsmc.model.train import train_meta_model, save_bundle
from qsmc.backtest.engine import run_backtest
from qsmc.backtest.metrics import summarise


def _load(symbol: str, interval: str, bars: int, source: str, period: str):
    if source == "fx":
        return load_fx(symbol, interval, period)
    return load_cached(symbol, interval, limit_bars=bars)


def build_symbol(symbol: str, interval: str, bars: int, source: str = "binance",
                 period: str = "730d"):
    base = _load(symbol, interval, bars, source, period)
    mname = mirror_of(symbol)
    mirror = None
    if mname and mname != symbol:
        try:
            mirror = _load(mname, interval, bars, source, period)
        except Exception as exc:
            print(f"  ! mirror {mname} unavailable ({exc}); running without it")
    feat = build_features(base, mirror, interval, CONFIG)
    labels = triple_barrier(base, feat["primary"], atr(base, CONFIG.label.atr_period), CONFIG.label)
    return base, feat, labels


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--symbols", nargs="+", default=["BTCUSDT", "ETHUSDT", "SOLUSDT"])
    ap.add_argument("--interval", default="15m")
    ap.add_argument("--bars", type=int, default=20000)
    ap.add_argument("--source", choices=["binance", "fx"], default="binance",
                    help="fx = free Yahoo FX history (real mirror pairs)")
    ap.add_argument("--period", default="730d", help="Yahoo range, fx source only")
    ap.add_argument("--equity", type=float, default=10_000.0)
    ap.add_argument("--n-trials", type=int, default=12,
                    help="parameter sets explored, for the deflated Sharpe penalty")
    args = ap.parse_args()

    frames, feats, labs, prices = {}, {}, {}, {}
    print(f"== data ==")
    for sym in args.symbols:
        base, feat, lab = build_symbol(sym, args.interval, args.bars,
                                       args.source, args.period)
        frames[sym], feats[sym], labs[sym] = base, feat, lab
        prices[sym] = base["close"]
        print(f"  {sym:9s} bars={len(base):6d} "
              f"{base.index[0].date()} -> {base.index[-1].date()}  "
              f"events={len(lab)}")

    # Pool symbols: one model that learns what a good setup looks like in
    # general beats three models each starved of data.
    # NOTE: signal timestamps repeat across symbols, so labels and features are
    # kept aligned POSITIONALLY. Joining them on the timestamp index would
    # cross-multiply every shared bar into a silently corrupted training set.
    all_labels, all_feats = [], []
    for sym in args.symbols:
        lab, feat = labs[sym], feats[sym]
        if lab.empty:
            continue
        lab = lab.copy()
        lab["symbol"] = sym
        f = feat.reindex(lab.index)
        all_labels.append(lab.reset_index())          # signal_time -> column
        all_feats.append(f.reset_index(drop=True))

    labels = pd.concat(all_labels, ignore_index=True)
    features = pd.concat(all_feats, ignore_index=True)
    assert len(labels) == len(features), "label/feature misalignment"

    order = np.argsort(labels["entry_time"].to_numpy(), kind="stable")
    labels = labels.iloc[order].reset_index(drop=True)
    features = features.iloc[order].reset_index(drop=True)

    cols = [c for c in feature_columns(features)]
    print(f"\n== labels ==\n{json.dumps(label_summary(labels), indent=2)}")
    print(f"\nfeatures: {len(cols)}  events: {len(labels)}")

    print("\n== walk-forward meta-model ==")
    model, oof, reports, importance = train_meta_model(features, labels, cols, CONFIG)
    aucs = [r.auc for r in reports if r.auc == r.auc]
    print(f"  mean OOF AUC: {np.mean(aucs):.4f}" if aucs else "  no valid folds")

    print("\n== top features ==")
    for name, val in importance.head(18).items():
        print(f"  {name:22s} {val:8.1f}")

    results = {}
    print("\n== backtests ==")
    for sym in args.symbols:
        idx = frames[sym].index
        sym_oof = oof[oof["symbol"] == sym]
        if sym_oof.empty:
            continue

        bh = frames[sym]["close"] / frames[sym]["close"].iloc[0] * args.equity
        rules = run_backtest(sym_oof, idx, args.equity, prob_col=None,
                             cfg=CONFIG, n_trials=args.n_trials)
        gated = run_backtest(sym_oof[sym_oof["p_win"].notna()], idx, args.equity,
                             prob_col="p_win", cfg=CONFIG, n_trials=args.n_trials)

        results[sym] = {
            "buy_hold": summarise(bh, pd.DataFrame(), 1),
            "smc_rules_only": rules["stats"],
            "smc_plus_model": gated["stats"],
            "rejections": gated["rejections"],
        }
        print(f"\n  --- {sym} ---")
        for name, st in (("buy&hold", results[sym]["buy_hold"]),
                         ("rules", rules["stats"]), ("rules+model", gated["stats"])):
            print(f"   {name:12s} ret={st.get('total_return',0):+.2%} "
                  f"sharpe={st.get('sharpe',0):+.2f} "
                  f"maxDD={st.get('max_drawdown',0):+.2%} "
                  f"trades={st.get('trades',0):4d} "
                  f"win={st.get('win_rate',0):.2%} "
                  f"expR={st.get('expectancy_R',0):+.3f} "
                  f"DSR={st.get('deflated_sharpe_p',0):.3f}")

    path = save_bundle(model, cols, CONFIG, importance, reports)
    out = ARTIFACT_DIR / "experiment_results.json"
    out.write_text(json.dumps({
        "config": CONFIG.to_dict(),
        "symbols": args.symbols,
        "interval": args.interval,
        "labels": label_summary(labels),
        "folds": [r.__dict__ for r in reports],
        "mean_oof_auc": float(np.mean(aucs)) if aucs else None,
        "top_features": importance.head(25).to_dict(),
        "results": results,
    }, indent=2, default=str))
    print(f"\nmodel  -> {path}\nreport -> {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
