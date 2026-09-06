#!/usr/bin/env python
"""Is the negative result an artefact of ONE exit rule?

Every strategy in the tournament shares the same exit: a 2:1 ATR barrier with a
48-bar cap. If that exit is simply wrong, all eight entries would look bad no
matter how good they were, and the conclusion "nothing works" would really mean
"this exit does not work".

So: hold the ENTRY fixed and sweep the exit. If nothing turns positive anywhere
in the grid, the conclusion is robust. If something does, that is a lead — but a
lead found by search, which is exactly what inflates a backtest, so it would
need its own out-of-sample validation before being believed.

This is a DIAGNOSTIC, not an optimiser. It reports the whole grid rather than
the best cell, because the shape of the surface is the answer and the maximum of
a noisy surface is not.

Usage:
    PYTHONPATH=quant python quant/scripts/exit_sensitivity.py --source fx
"""
from __future__ import annotations

import argparse
import dataclasses
import itertools
import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from qsmc.config import CONFIG, ARTIFACT_DIR, mirror_of
from qsmc.data.loaders import load_cached, load_fx
from qsmc.features.build import build_features
from qsmc.features.structure import atr
from qsmc.labeling import triple_barrier
from qsmc.strategies.base import StrategyContext, build

UNIVERSES = {
    "binance": (["BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT"], "15m"),
    "fx": (["EURUSD", "GBPUSD", "USDJPY", "AUDUSD"], "1h"),
}

PROFIT_ATR = [1.0, 1.5, 2.0, 3.0]
STOP_ATR = [0.5, 1.0, 1.5, 2.0]
MAX_HOLD = [12, 48, 192]


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--source", choices=["binance", "fx"], default="fx")
    ap.add_argument("--strategies", nargs="*",
                    default=["mean_reversion", "vol_breakout", "smc_mirror"])
    ap.add_argument("--period", default="730d")
    ap.add_argument("--bars", type=int, default=20000)
    ap.add_argument("--cost-bps", type=float, default=None,
                    help="round-trip cost in bps; defaults to the configured value")
    args = ap.parse_args()

    symbols, interval = UNIVERSES[args.source]
    cost_bps = args.cost_bps if args.cost_bps is not None else CONFIG.cost.round_trip_bps

    print(f"\nexit sensitivity · {args.source} · {interval}")
    print(f"grid: {len(PROFIT_ATR)}x{len(STOP_ATR)}x{len(MAX_HOLD)} = "
          f"{len(PROFIT_ATR)*len(STOP_ATR)*len(MAX_HOLD)} exits per strategy")
    print(f"cost: {cost_bps:.1f} bps round trip\n")

    universe, feats = {}, {}
    for sym in symbols:
        universe[sym] = load_fx(sym, interval, args.period) if args.source == "fx" \
            else load_cached(sym, interval, limit_bars=args.bars)
    for sym in symbols:
        m = mirror_of(sym)
        if m and m not in universe:
            try:
                universe[m] = load_fx(m, interval, args.period) if args.source == "fx" \
                    else load_cached(m, interval, limit_bars=args.bars)
            except Exception:
                pass
        feats[sym] = build_features(universe[sym], universe.get(m or ""), interval, CONFIG)

    all_rows = []
    for name in args.strategies:
        strat = build(name)
        if interval not in strat.timeframes:
            print(f"{name}: skipped (not designed for {interval})")
            continue

        sides = {}
        for sym in symbols:
            ctx = StrategyContext(
                symbol=sym, interval=interval, bars=universe[sym], features=feats[sym],
                mirror=universe.get(mirror_of(sym) or ""),
                universe={s: universe[s] for s in symbols},
            )
            sides[sym] = strat.generate(ctx)

        print(f"\n{name}")
        print(f"  {'tp/sl':>10s} {'hold':>5s} {'trades':>7s} {'win%':>6s} "
              f"{'meanR':>8s} {'net edge':>9s}")

        best = None
        for tp, sl, hold in itertools.product(PROFIT_ATR, STOP_ATR, MAX_HOLD):
            cfg = dataclasses.replace(CONFIG.label, profit_atr=tp, stop_atr=sl, max_holding=hold)

            frames = []
            for sym in symbols:
                if int((sides[sym] != 0).sum()) == 0:
                    continue
                lab = triple_barrier(universe[sym], sides[sym],
                                     atr(universe[sym], cfg.atr_period), cfg)
                if not lab.empty:
                    frames.append(lab)
            if not frames:
                continue
            lab = pd.concat(frames)
            if len(lab) < 50:
                continue

            # Costs charged in R, so results are comparable across exits: a
            # tighter stop means a smaller R, so the SAME bps costs more of it.
            cost_R = (cost_bps / 10_000.0) / lab["risk_frac"].replace(0, np.nan)
            net_R = (lab["r_multiple"] - cost_R).dropna()

            row = {
                "strategy": name, "profit_atr": tp, "stop_atr": sl, "max_hold": hold,
                "trades": int(len(lab)),
                "win_rate": round(float(lab["meta_label"].mean()), 4),
                "gross_R": round(float(lab["r_multiple"].mean()), 4),
                "net_R": round(float(net_R.mean()), 4),
            }
            all_rows.append(row)
            if best is None or row["net_R"] > best["net_R"]:
                best = row

            flag = "  <-- positive" if row["net_R"] > 0 else ""
            print(f"  {tp:>4.1f}/{sl:<5.1f} {hold:>5d} {row['trades']:>7d} "
                  f"{row['win_rate']*100:>5.1f}% {row['gross_R']:>+8.3f} "
                  f"{row['net_R']:>+9.3f}{flag}")

    # ---- verdict ----
    df = pd.DataFrame(all_rows)
    print("\n" + "=" * 74)
    if df.empty:
        print("no usable cells")
        return 1

    positive = df[df["net_R"] > 0]
    print(f"cells evaluated : {len(df)}")
    print(f"net-positive    : {len(positive)}  ({len(positive)/len(df)*100:.1f}%)")
    print(f"best net R      : {df['net_R'].max():+.4f}  "
          f"({df.loc[df['net_R'].idxmax(), 'strategy']} "
          f"{df.loc[df['net_R'].idxmax(), 'profit_atr']}/{df.loc[df['net_R'].idxmax(), 'stop_atr']} "
          f"hold {df.loc[df['net_R'].idxmax(), 'max_hold']})")
    print(f"median net R    : {df['net_R'].median():+.4f}")
    print("=" * 74)

    if positive.empty:
        print("\nEvery exit in the grid loses. The negative result is NOT an artefact")
        print("of the 2:1 barrier — no combination of target, stop and holding period")
        print("rescues any of these entries.")
    else:
        print(f"\n{len(positive)} cell(s) came out positive. Treat this as a LEAD, not a")
        print("finding: it was located by searching a grid, which is precisely how a")
        print("backtest gets inflated. Before believing it, re-run that single exit")
        print("on data this sweep never touched.")
        print(positive.sort_values("net_R", ascending=False).head(8).to_string(index=False))

    out = ARTIFACT_DIR / f"exit_sensitivity_{args.source}.json"
    out.write_text(json.dumps(all_rows, indent=2))
    print(f"\nreport -> {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
