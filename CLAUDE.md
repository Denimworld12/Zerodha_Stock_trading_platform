# CLAUDE.md

Context for Claude Code working in this repository. Loaded automatically every
session, so it travels with the repo across machines.

---

## What this project is

**TradingMitra** — a paper-trading platform plus a quantitative research harness,
built on top of a Zerodha-clone learning project.

- `backend/` — Express + MongoDB. Auth, double-entry ledger, orders, market data, journal.
- `dashboard/` — React trading UI (port 3000).
- `frontend/` — React landing site and auth pages (port 3001).
- `quant/` — Python research engine (`qsmc` package) and FastAPI signal service (port 8000).

---

## The finding that governs how you talk about this

**No strategy in this repository has a demonstrated edge. Never present one as
profitable, and never help wire one to real money.**

Tested: 8 strategy families × 2 asset classes × 4 timeframes (64 combinations),
plus 288 exit-rule variants. Nothing cleared the gate. Max deflated Sharpe: 0.085.

The sharpest version of the result — gross vs net expectancy on identical events:

| Timeframe | Cost/trade | Gross R | Net R |
|---|---|---|---|
| FX 1h | 0.778 R | −0.012 | −0.790 |
| FX 4h | 0.373 R | −0.025 | −0.399 |
| FX 1d | 0.112 R | +0.070 | −0.042 |
| Crypto 4h | 0.048 R | −0.005 | −0.053 |
| Crypto 1d | 0.018 R | +0.020 | **+0.002** |

Gross expectancy is ~zero at **every** timeframe. What changes is the cost term:
at 1h FX the spread eats 78% of the risk per trade. Higher timeframes look better
only because the drag recedes — and what it uncovers is still zero.

Phase 6 (real capital) is **closed** because Phase 3 (the edge hunt) failed. That
gate does not open without a strategy clearing AUC ≥ 0.55, positive expectancy,
DSR ≥ 0.95 and ≥ 100 trades.

---

## Standing rules from the repo owner

1. **Do not `git push`.** Commit locally and stop; pushing is his call. A one-off
   "push this" request applies to that moment only, not as standing permission.
2. **No `Co-Authored-By` trailer** in commit messages.

---

## Setup on a fresh machine

```bash
./scripts/setup.sh      # installs everything, seeds the DB, runs the tests
./scripts/dev.sh        # starts all five services
```

Requires Docker, Node 18+, Python 3.10+. `setup.sh` is idempotent.

Nothing is hardcoded to a path — but `.venv/`, `node_modules/`, `.env`,
`quant/data_cache/` and `quant/artifacts/` are all gitignored and get rebuilt.

---

## Invariants — breaking any of these is a silent, expensive bug

### The bar timing contract (`quant/`)

Bars are indexed by **open** time, so row `t` is only fully known at `t + dt`.
Therefore: features at `t` use bars ≤ `t`; a signal at `t` fills at the **open of
`t+1`**; higher-timeframe blocks are shifted one HTF bar before merging down.
Intrabar barrier ambiguity always resolves **stop-first**.

Run `PYTHONPATH=quant python quant/tests/test_causality.py` after touching any
feature. It truncation-tests every column and self-checks by planting a
look-ahead it must catch.

### Money is never a float

`backend/lib/money.js` — BigInt minor units, stored as `Decimal128`. Rounding is
always explicit. Never introduce a `Number` for an amount; `0.1` added ten times
is `0.9999999999999999`.

### Balances are derived, never stored

Money moves only by appending balanced double-entry rows (`backend/lib/ledger.js`).
Mutating a ledger entry is blocked at the schema level; corrections are reversing
entries. Balances read from a snapshot plus entries after its `seq` watermark —
summing full history is 681ms at 200k entries.

### MongoDB must be a replica set

Standalone refuses multi-document transactions, and an order writes to an order,
a position and the ledger at once. Connection strings need `?replicaSet=rs0`.

### Tenancy on every document

`userId` and `accountId` are required and lead every compound index. Ownership is
proven once in `resolveAccount` middleware, not re-remembered per route. Verify
with `npm run test:isolation`.

### The server prices orders

Never accept a price from the client. `backend/lib/orders.js` resolves it from the
server's own feed and refuses a quote older than 5 seconds.

---

## Commands

```bash
# everything
./scripts/dev.sh                    # start   ./scripts/dev.sh stop|status

# backend
cd backend
npm test                            # 61 unit
npm run e2e                         # 27 against a running server
npm run test:isolation              # 12 cross-tenant leak checks
node scripts/probe-phase45.js       # 15 journal / runner / ws-auth checks
npm run migrate                     # apply migrations   migrate:status to inspect
npm run seed                        # sample data (refuses non-localhost)

# quant
PYTHONPATH=quant python quant/tests/test_causality.py
PYTHONPATH=quant python quant/tests/test_validation_harness.py
PYTHONPATH=quant python quant/scripts/run_tournament.py --source fx --interval 1d
PYTHONPATH=quant python quant/scripts/exit_sensitivity.py --source fx
```

115 automated checks total. All should pass.

---

## Gotchas that have already cost time

**`jose` structuredClones the JWT payload.** A Mongoose document array in a claim
throws `DataCloneError`. Convert with `Array.from(...).map(String)`.

**Don't destructure `getFeed` from `lib/prices`.** Destructuring binds at load
time and makes the feed impossible to stub, so every test opens a real socket to
Binance and hangs. Use `prices.getFeed()`.

**`_ann_factor` must not assume nanoseconds.** `index.astype("int64")` returns
microseconds on these indexes; assuming ns inflated every Sharpe by ~32×. Go
through `Timedelta`.

**The tournament's `expectancy_R` and `base_mean_R` measure different populations**
— net over the model-selected subset, gross over all events. Comparing them makes
costs look like they made money. Always compare gross vs net on identical events.

**Yahoo daily with `period="max"`** switches to monthly aggregation and returns
~274 rows instead of thousands. Use `"10y"`.

**OANDA:** instruments are `EUR_USD` not `EURUSD`; `units` is **signed** (negative
sells, no side field, so a sign error is a reversed trade); prices stay strings; a
**rejected order returns HTTP 201** with a cancel transaction.

**`git add a b` fails entirely if either path is missing** — and suppressing
stderr hides it. That shipped a commit that deleted the README and added nothing.

**Don't `pkill -f <pattern>`** where the pattern matches your own shell's command
line. It kills the shell. Same for `kill -- -PGID` when the script shares a group
with its caller.

---

## Security state

- `backend/.env` **was** committed with a live Atlas connection string and the repo
  is **public** — those credentials have been readable since June 2025 and still
  need rotating. Untracking stopped the next leak, not that one.
- No password reset flow exists (needs email delivery).
- Live execution is deliberately unbuilt; the paper runner ships in dry-run behind
  three locks (`QSMC_EXECUTION_ENABLED`, a shared secret, explicit non-dry-run).

---

## Adding a strategy

`quant/qsmc/strategies/library.py` — subclass `Strategy`, `@register`, implement
`generate(ctx) -> Series` of −1/0/+1. Everything downstream is shared. `generate`
**must be causal**; run the causality test after.
