# QSMC — Smart Money Concepts + Mirror Market engine

A research and execution stack for the SMC + Mirror-Market idea, built to sit
alongside the existing Express/Mongo/React app in this repo.

**Read the result before the runbook: the strategy as specified has no measured
edge.** See [Findings](#findings). What is production-ready here is the
*infrastructure and the falsification harness*, not a money-printer.

---

## Layout

```
quant/
  qsmc/
    config.py            every tunable, in one place, shared by backtest and live
    labeling.py          triple-barrier + limit-entry labelling
    live.py              bars in -> validated Signal out
    data/loaders.py      Binance public REST · MT5 terminal · MT/generic CSV
    features/
      structure.py       fractal swings, BOS/CHoCH, dealing range, premium/discount
      smc.py             order blocks, fair value gaps, mitigation, POI levels
      mirror.py          inverse-pair spread · foldback symmetry · lead-lag
      build.py           feature matrix + the rule-based primary signal
    model/train.py       purged, embargoed walk-forward meta-labelling
    backtest/            portfolio engine + metrics (incl. deflated Sharpe)
    execution/           Broker interface · paper · MetaTrader 5 · signed webhook
    service/api.py       FastAPI: /signals /research/summary /webhook /execute
  pine/                  TradingView indicator implementing the same rules
  scripts/               run_experiment.py
  tests/                 causality + validation-harness controls
```

## Install

```bash
python3 -m venv .venv
.venv/bin/pip install -r quant/requirements.txt
# live MT5 execution, Windows only:
#   .venv/bin/pip install MetaTrader5
```

## Run

```bash
# 1. Prove the features do not look into the future (run this after ANY change)
cd quant && PYTHONPATH=. ../.venv/bin/python tests/test_causality.py

# 2. Prove the evaluation harness can detect an edge that exists
PYTHONPATH=. ../.venv/bin/python tests/test_validation_harness.py

# 3. Full research run: data -> features -> labels -> walk-forward -> backtest
PYTHONPATH=. ../.venv/bin/python scripts/run_experiment.py \
    --symbols BTCUSDT ETHUSDT SOLUSDT BNBUSDT --interval 15m --bars 20000

# 4. Signal service
PYTHONPATH=. SIGNAL_WEBHOOK_SECRET=<secret> \
    ../.venv/bin/uvicorn qsmc.service.api:app --port 8000
```

Then `cd backend && npm start` and `cd dashboard && npm start`; the **Signals**
tab renders the live engine output.

## Findings

Measured on BTC/ETH/SOL/BNB-USDT, 20 000 × 15m bars (Feb–Sep 2026), walk-forward
with purging and embargo:

| Control | Mean OOF AUC | Reading |
|---|---|---|
| Real features | **0.4535** | — |
| Shuffled labels (null) | 0.4659 | real is *indistinguishable from noise* |
| Planted 75%-accurate feature | 0.7212 | harness detects edge when present |

Raw SMC rules win 25–33% at 2:1 R (break-even needs 33.3%), so expectancy is
negative before costs. Every backtested variant lost 7–20% while buy & hold
returned +15–24% over the same window; deflated-Sharpe p-values were ~0.00.

Two hypotheses were tested and rejected rather than tuned around:

1. *"Stops are too tight."* Moving from market entry to a structural limit entry
   at the POI made results **worse** (−0.21R vs −0.10R).
2. *"The rules were misimplemented."* A real bug was found and fixed — the
   premium/discount filter was optional, so the system was buying at eq_pos 0.58
   (in premium). After making it mandatory the signal is SMC-compliant
   (longs 0.30, shorts 0.72) and still has no edge.

### What this does and does not mean

It does **not** prove SMC never works. It measures *this* rule set, on *these*
four correlated crypto pairs, at *this* timeframe, over *seven months*. Untested
and plausible: FX majors on MT5 (where the mirror pairs are genuinely
anti-correlated at ρ ≈ −0.9, unlike BTC/ETH at +0.85), higher timeframes, and
discretionary POI selection that a fractal rule cannot capture.

It does mean **nothing here should trade real money today.**

## Safety model

Three independent locks before anything reaches a live venue, all of which must
be open: the shared secret, `QSMC_EXECUTION_ENABLED=true`, and an explicit
`dry_run=false`. `MT5Broker` additionally refuses to send unless constructed
with `live=True`. Inbound TradingView alerts are recorded, never auto-executed.

## Timing contract

Bars are indexed by **open** time, so row `t` is only fully known at `t+dt`.
Therefore: features at `t` use bars ≤ `t`; a signal at `t` fills at the **open of
`t+1`**; HTF blocks are shifted one HTF bar before merging down. Intrabar
barrier ambiguity always resolves **stop-first**.

Break any of those and the equity curve becomes fiction — which is what
`tests/test_causality.py` exists to prevent. It truncation-tests every column and
self-checks by planting a deliberate leak it must catch.
