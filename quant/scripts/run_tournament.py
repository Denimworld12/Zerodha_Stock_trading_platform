#!/usr/bin/env python
"""Run every registered strategy through the same harness and rank them.

The point is comparability. Each candidate gets identical treatment — the same
triple-barrier labels, the same purged walk-forward meta-model, the same costs,
the same deflated Sharpe — so the leaderboard reflects the strategies rather
than whose backtest was written most generously.

The gate is deliberately hard to clear:

    out-of-sample AUC >= 0.55   the model can actually rank setups
    expectancy > 0              it makes money before leverage
    deflated Sharpe >= 0.95     it survives the number of things we tried
    >= 100 trades               the result is not three lucky trades

`--n-trials` is what makes the DSR honest. Trying eight strategies across two
venues and several timeframes is dozens of implicit bets, and the best of dozens
of coin flips looks like skill. Passing the real count deflates the score by the
amount that search was worth.

Usage:
    PYTHONPATH=quant python quant/scripts/run_tournament.py --source fx
    PYTHONPATH=quant python quant/scripts/run_tournament.py --source binance --strategies ts_momentum vol_breakout
"""
from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from qsmc.config import CONFIG, ARTIFACT_DIR, mirror_of
from qsmc.data.loaders import load_cached, load_fx
from qsmc.features.build import build_features, feature_columns
from qsmc.features.structure import atr
from qsmc.labeling import triple_barrier, label_summary
from qsmc.model.train import train_meta_model
from qsmc.backtest.engine import run_backtest
from qsmc.backtest.metrics import summarise
from qsmc.strategies.base import StrategyContext, available, build

UNIVERSES = {
    "binance": (["BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT"], "15m"),
    "fx": (["EURUSD", "GBPUSD", "USDJPY", "AUDUSD"], "1h"),
}

# Sensible history per timeframe. Longer bars need more calendar time to yield
# a usable number of events, and Yahoo caps intraday history far below daily.
DEFAULT_PERIOD = {"15m": "60d", "1h": "730d", "4h": "730d", "1d": "10y"}

# The bar every candidate must clear to be worth paper trading.
GATE = {"auc": 0.55, "expectancy_R": 0.0, "dsr": 0.95, "min_trades": 100}


def load_universe(source: str, symbols: list[str], interval: str, period: str, bars: int):
    out = {}
    for sym in symbols:
        out[sym] = load_fx(sym, interval, period) if source == "fx" \
            else load_cached(sym, interval, limit_bars=bars)
    # Mirrors may sit outside the traded universe (USDCHF backs EURUSD) but are
    # still needed for the mirror features.
    for sym in list(symbols):
        m = mirror_of(sym)
        if m and m not in out:
            try:
                out[m] = load_fx(m, interval, period) if source == "fx" \
                    else load_cached(m, interval, limit_bars=bars)
            except Exception:
                pass
    return out


def evaluate(strategy, source, symbols, interval, universe, feats, n_trials, equity):
    """Label, walk-forward, backtest one strategy across the universe."""
    all_labels, all_feats, per_symbol_sides = [], [], {}

    for sym in symbols:
        bars = universe[sym]
        feat = feats[sym]
        ctx = StrategyContext(
            symbol=sym, interval=interval, bars=bars, features=feat,
            mirror=universe.get(mirror_of(sym) or ""),
            universe={s: universe[s] for s in symbols},
        )
        side = strategy.generate(ctx)
        per_symbol_sides[sym] = side
        if int((side != 0).sum()) == 0:
            continue

        lab = triple_barrier(bars, side, atr(bars, CONFIG.label.atr_period), CONFIG.label)
        if lab.empty:
            continue
        lab = lab.copy()
        lab["symbol"] = sym
        all_labels.append(lab.reset_index())
        all_feats.append(feat.reindex(lab.index).reset_index(drop=True))

    if not all_labels:
        return {"strategy": strategy.name, "error": "no signals generated"}

    labels = pd.concat(all_labels, ignore_index=True)
    features = pd.concat(all_feats, ignore_index=True)
    order = np.argsort(labels["entry_time"].to_numpy(), kind="stable")
    labels = labels.iloc[order].reset_index(drop=True)
    features = features.iloc[order].reset_index(drop=True)

    cols = feature_columns(features)
    summary = label_summary(labels)
    if summary["events"] < 60:
        return {"strategy": strategy.name, "error": f"only {summary['events']} events"}

    _, oof, reports, _ = train_meta_model(features, labels, cols, CONFIG, verbose=False)
    aucs = [r.auc for r in reports if r.auc == r.auc]
    auc = float(np.mean(aucs)) if aucs else float("nan")

    per_symbol = {}
    agg_trades, agg_stats = [], []
    for sym in symbols:
        rows = oof[oof["symbol"] == sym]
        if rows.empty:
            continue
        idx = universe[sym].index
        rules = run_backtest(rows, idx, equity, prob_col=None, cfg=CONFIG, n_trials=n_trials)
        gated = run_backtest(rows[rows["p_win"].notna()], idx, equity,
                             prob_col="p_win", cfg=CONFIG, n_trials=n_trials)
        per_symbol[sym] = {"rules": rules["stats"], "gated": gated["stats"]}
        if not gated["trades"].empty:
            agg_trades.append(gated["trades"])
        agg_stats.append(gated["stats"])

    trades = pd.concat(agg_trades, ignore_index=True) if agg_trades else pd.DataFrame()
    n_trades = int(len(trades))
    expectancy = float(trades["r_net"].mean()) if n_trades else 0.0
    dsr = float(np.mean([s.get("deflated_sharpe_p", 0) for s in agg_stats])) if agg_stats else 0.0
    sharpe = float(np.mean([s.get("sharpe", 0) for s in agg_stats])) if agg_stats else 0.0
    total_ret = float(np.mean([s.get("total_return", 0) for s in agg_stats])) if agg_stats else 0.0

    passes = (
        auc == auc and auc >= GATE["auc"]
        and expectancy > GATE["expectancy_R"]
        and dsr >= GATE["dsr"]
        and n_trades >= GATE["min_trades"]
    )

    return {
        "strategy": strategy.name,
        "thesis": strategy.thesis,
        "n_params": len(strategy.params),
        "events": summary["events"],
        "base_win_rate": summary["base_win_rate"],
        "base_mean_R": summary["mean_R"],
        "oof_auc": round(auc, 4) if auc == auc else None,
        "fold_aucs": [r.auc for r in reports],
        "trades": n_trades,
        "expectancy_R": round(expectancy, 4),
        "mean_sharpe": round(sharpe, 3),
        "mean_return": round(total_ret, 4),
        "deflated_sharpe_p": round(dsr, 4),
        "passes_gate": bool(passes),
        "per_symbol": per_symbol,
    }


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--source", choices=["binance", "fx"], default="fx")
    ap.add_argument("--strategies", nargs="*", default=None)
    ap.add_argument("--interval", default=None,
                    help="override the universe default (15m, 1h, 4h, 1d)")
    ap.add_argument("--period", default=None,
                    help="Yahoo range; defaults per interval")
    ap.add_argument("--bars", type=int, default=20000)
    ap.add_argument("--equity", type=float, default=10_000.0)
    ap.add_argument("--n-trials", type=int, default=None,
                    help="strategy/venue/timeframe combinations tried; deflates the Sharpe")
    args = ap.parse_args()

    symbols, interval = UNIVERSES[args.source]
    if args.interval:
        interval = args.interval
    period = args.period or DEFAULT_PERIOD.get(interval, "730d")
    registry = available()
    names = args.strategies or sorted(registry)
    names = [n for n in names if n in registry]
    if not names:
        print(f"no such strategies; available: {sorted(registry)}")
        return 1

    # Count every combination actually explored, not just this run's strategies.
    n_trials = args.n_trials or (len(names) * len(UNIVERSES))

    print(f"\nuniverse: {args.source} · {', '.join(symbols)} · {interval} · {period}")
    print(f"strategies: {len(names)} · deflating Sharpe for {n_trials} trials\n")

    print("loading data…")
    universe = load_universe(args.source, symbols, interval, period, args.bars)
    feats = {}
    for sym in symbols:
        m = mirror_of(sym)
        feats[sym] = build_features(universe[sym], universe.get(m or ""), interval, CONFIG)
    print(f"  {len(universe)} instruments, {len(feats[symbols[0]])} bars each\n")

    results = []
    for name in names:
        strat = build(name)
        if interval not in strat.timeframes:
            print(f"  {name:16s} skipped — not designed for {interval}")
            continue
        t0 = time.time()
        try:
            res = evaluate(strat, args.source, symbols, interval, universe,
                           feats, n_trials, args.equity)
        except Exception as exc:
            res = {"strategy": name, "error": f"{type(exc).__name__}: {exc}"}
        res["seconds"] = round(time.time() - t0, 1)
        results.append(res)

        if "error" in res:
            print(f"  {name:16s} {res['error']}")
        elif res.get("oof_auc") is None:
            # Too few events for any purged fold to be valid. Reporting the
            # trade count is more useful than a blank line, because "we could
            # not test this" is a different answer from "this failed".
            print(f"  {name:16s} untestable — {res['events']} events, no valid CV fold")
        else:
            mark = "PASS" if res["passes_gate"] else "    "
            print(f"  {name:16s} AUC {res['oof_auc']:.3f}  "
                  f"trades {res['trades']:4d}  expR {res['expectancy_R']:+.3f}  "
                  f"DSR {res['deflated_sharpe_p']:.3f}  {mark}")

    # ---- leaderboard ----
    scored = [r for r in results if "error" not in r and r.get("oof_auc") is not None]
    untestable = [r for r in results if "error" not in r and r.get("oof_auc") is None]
    scored.sort(key=lambda r: (r["passes_gate"], r["expectancy_R"]), reverse=True)

    print("\n" + "=" * 82)
    print(f"{'strategy':16s} {'AUC':>6s} {'trades':>7s} {'expR':>8s} {'sharpe':>7s} "
          f"{'DSR':>6s} {'params':>7s}  gate")
    print("-" * 82)
    for r in scored:
        print(f"{r['strategy']:16s} {r['oof_auc']:>6.3f} {r['trades']:>7d} "
              f"{r['expectancy_R']:>+8.3f} {r['mean_sharpe']:>7.2f} "
              f"{r['deflated_sharpe_p']:>6.3f} {r['n_params']:>7d}  "
              f"{'PASS' if r['passes_gate'] else 'fail'}")
    print("=" * 82)

    if untestable:
        print(f"\n{len(untestable)} strategy(ies) produced too few events to cross-validate "
              f"at this timeframe: {', '.join(r['strategy'] for r in untestable)}")

    winners = [r for r in scored if r["passes_gate"]]
    print(f"\ngate: AUC>={GATE['auc']}  expR>{GATE['expectancy_R']}  "
          f"DSR>={GATE['dsr']}  trades>={GATE['min_trades']}")
    if winners:
        print(f"\n{len(winners)} strategy(ies) cleared it: {', '.join(w['strategy'] for w in winners)}")
        print("Next step is PAPER trading, not live capital. Clearing a backtest gate")
        print("is necessary, not sufficient.")
    else:
        print("\nNothing cleared the gate. That is a result, not a failure: it means")
        print("no capital should be risked on any of these, and it cost a few minutes")
        print("to establish rather than a few months of losses.")

    out = ARTIFACT_DIR / f"tournament_{args.source}_{interval}.json"
    out.write_text(json.dumps({
        "source": args.source, "symbols": symbols, "interval": interval, "period": period,
        "n_trials": n_trials, "gate": GATE, "results": results,
    }, indent=2, default=str))
    print(f"\nreport -> {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
