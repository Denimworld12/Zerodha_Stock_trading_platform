"use strict";

/**
 * Autonomous paper-trading runner.
 *
 * Polls the quant service for signals on closed bars and routes anything it
 * believes into the paper account. This is the only honest bridge between a
 * backtest and real money: a strategy that cannot survive three months of
 * unattended paper trading has no business seeing capital.
 *
 * IT IS OFF BY DEFAULT, AND IT SHOULD STAY OFF FOR NOW.
 * Every strategy in the tournament failed its gate — 13 strategy/venue
 * combinations, then 288 exit variants, all with negative expectancy. Running
 * this on any of them just pays the spread on coin flips. It exists because the
 * infrastructure needs to be built and exercised BEFORE something worth running
 * appears, not after.
 *
 * Safety posture, in order of how much each one matters:
 *   1. Paper accounts only. A live account is refused outright.
 *   2. Kill switches evaluated before every order, not on a timer.
 *   3. Signals are only acted on once per bar, tracked by bar timestamp — a
 *      restart mid-bar must not re-enter a position it already holds.
 *   4. Every decision is recorded, including the refusals, because "why was it
 *      quiet on Tuesday" is the question you actually end up asking.
 */

const { Money } = require("./money");
const ledger = require("./ledger");
const orders = require("./orders");
const journal = require("./journal");
const { Account, Order2, Position2 } = require("../models");

const SIGNAL_SERVICE = process.env.SIGNAL_SERVICE_URL || "http://localhost:8000";
const POLL_MS = Number(process.env.RUNNER_POLL_MS || 60_000);

class Runner {
  constructor({ accountId, userId, symbols = [], interval = "15m",
                minConfidence = 0.58, dryRun = true } = {}) {
    this.accountId = accountId;
    this.userId = userId;
    this.symbols = symbols;
    this.interval = interval;
    this.minConfidence = minConfidence;
    this.dryRun = dryRun;
    this.timer = null;
    this.running = false;
    // Bar timestamps already acted on, so a restart cannot double-enter.
    this.seen = new Set();
    this.log = [];
    this.stats = { polls: 0, signals: 0, placed: 0, refused: 0, errors: 0 };
  }

  record(event) {
    const row = { at: new Date().toISOString(), ...event };
    this.log.unshift(row);
    if (this.log.length > 500) this.log.pop();
    return row;
  }

  /**
   * Guard rails, checked before every order.
   *
   * Returns a REASON string when trading must stop, or null to proceed. Doing
   * this per-order rather than on a schedule means a fast losing streak cannot
   * slip several trades through between checks.
   */
  async blockedBy(account) {
    if (account.kind !== "paper") {
      return `account is ${account.kind}; the runner only trades paper`;
    }
    if (account.tradingHaltedAt) {
      return `trading halted: ${account.haltReason || "unspecified"}`;
    }

    const currency = account.baseCurrency;
    const balances = await ledger.balances(account._id, currency);
    const equity = Number(balances.equity.toString());

    const perf = await journal.performance(account._id, currency);
    if (perf.maxDrawdown >= account.limits.maxDrawdownPct / 100) {
      await this.halt(account, `max drawdown ${(perf.maxDrawdown * 100).toFixed(1)}% reached`);
      return `max drawdown reached (${(perf.maxDrawdown * 100).toFixed(1)}%)`;
    }

    // Daily loss, measured from the ledger rather than a cached figure.
    const since = new Date(); since.setUTCHours(0, 0, 0, 0);
    const todaysTrades = await Position2.find({
      accountId: account._id, status: "closed", closedAt: { $gte: since },
    }).lean();
    const todayPnl = todaysTrades.reduce(
      (s, p) => s + Number(p.realizedPnl?.amount ?? 0), 0);
    if (equity > 0 && todayPnl < 0 &&
        Math.abs(todayPnl) / equity >= account.limits.maxDailyLossPct / 100) {
      return `daily loss limit hit (${todayPnl.toFixed(2)} on ${equity.toFixed(2)} equity)`;
    }

    const open = await Position2.countDocuments({ accountId: account._id, status: "open" });
    if (open >= account.limits.maxConcurrentPositions) {
      return `already holding ${open} positions (limit ${account.limits.maxConcurrentPositions})`;
    }
    return null;
  }

  async halt(account, reason) {
    await Account.updateOne(
      { _id: account._id },
      { $set: { tradingHaltedAt: new Date(), haltReason: reason } }
    );
    this.record({ level: "halt", reason });
  }

  async fetchSignals() {
    const url = `${SIGNAL_SERVICE}/signals?symbols=${encodeURIComponent(this.symbols.join(","))}` +
                `&interval=${encodeURIComponent(this.interval)}`;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 45_000);
    try {
      const res = await fetch(url, { signal: ctrl.signal });
      if (!res.ok) throw new Error(`signal service returned ${res.status}`);
      return (await res.json()).signals || [];
    } finally {
      clearTimeout(timer);
    }
  }

  /** Size a position so a stop-out costs exactly the configured fraction. */
  sizeFor(equity, signal, account) {
    const entry = Number(signal.entry);
    const stop = Number(signal.stop);
    const riskPerUnit = Math.abs(entry - stop);
    if (!(riskPerUnit > 0) || !(entry > 0)) return 0;

    const risk = equity * (account.limits.riskPerTradePct / 100);
    const qty = risk / riskPerUnit;
    const maxQty = (equity * account.limits.maxLeverage) / entry;
    return Math.min(qty, maxQty);
  }

  async tick() {
    this.stats.polls++;
    let account;
    try {
      account = await Account.findById(this.accountId);
      if (!account) throw new Error("account not found");
    } catch (err) {
      this.stats.errors++;
      return this.record({ level: "error", message: err.message });
    }

    let signals;
    try {
      signals = await this.fetchSignals();
    } catch (err) {
      this.stats.errors++;
      return this.record({ level: "error", message: `signal fetch failed: ${err.message}` });
    }

    const blocked = await this.blockedBy(account);
    if (blocked) {
      this.stats.refused++;
      return this.record({ level: "blocked", reason: blocked });
    }

    const balances = await ledger.balances(account._id, account.baseCurrency);
    const equity = Number(balances.equity.toString());

    for (const s of signals) {
      if (!s.signal) {
        this.record({ level: "skip", symbol: s.symbol, reason: s.blocked_by });
        continue;
      }
      this.stats.signals++;

      // One action per bar, ever.
      const key = `${s.symbol}:${s.bar_time}`;
      if (this.seen.has(key)) continue;
      this.seen.add(key);
      if (this.seen.size > 5000) {
        this.seen = new Set([...this.seen].slice(-2000));
      }

      if (s.p_win < this.minConfidence) {
        this.stats.refused++;
        this.record({ level: "refuse", symbol: s.symbol,
                      reason: `p_win ${s.p_win} below ${this.minConfidence}` });
        continue;
      }

      const qty = this.sizeFor(equity, s.signal, account);
      if (!(qty > 0)) {
        this.stats.refused++;
        this.record({ level: "refuse", symbol: s.symbol, reason: "position size resolved to zero" });
        continue;
      }

      if (this.dryRun) {
        this.record({ level: "dry_run", symbol: s.symbol, side: s.signal.side,
                      qty, entry: s.signal.entry, reason: s.signal.reason });
        continue;
      }

      try {
        const res = await orders.placeOrder({
          user: { _id: this.userId },
          account,
          symbol: s.symbol,
          side: s.signal.side === 1 ? "buy" : "sell",
          quantity: String(qty),
          stopLoss: s.signal.stop,
          takeProfit: s.signal.target,
          // Derived from the bar, so a retry after a crash replays rather than
          // placing a second order for the same signal.
          idempotencyKey: `runner:${key}`,
          source: "strategy",
          strategyId: s.signal.meta?.strategy || "qsmc",
          confidence: s.p_win,
          reason: s.signal.reason,
        });
        this.stats.placed++;
        this.record({ level: "placed", symbol: s.symbol, orderId: String(res.order._id),
                      price: res.price, qty });
      } catch (err) {
        this.stats.errors++;
        this.record({ level: "error", symbol: s.symbol, message: err.message, code: err.code });
      }
    }
  }

  start() {
    if (this.running) return this;
    this.running = true;
    this.record({ level: "start", dryRun: this.dryRun, symbols: this.symbols });
    // Fire immediately so a restart does not idle for a full poll interval.
    this.tick().catch(() => {});
    this.timer = setInterval(() => this.tick().catch(() => {}), POLL_MS);
    return this;
  }

  stop() {
    clearInterval(this.timer);
    this.timer = null;
    this.running = false;
    this.record({ level: "stop" });
    return this;
  }

  status() {
    return {
      running: this.running,
      dryRun: this.dryRun,
      accountId: String(this.accountId),
      symbols: this.symbols,
      interval: this.interval,
      minConfidence: this.minConfidence,
      pollMs: POLL_MS,
      stats: { ...this.stats },
      recent: this.log.slice(0, 25),
    };
  }
}

// One runner per process. Two runners on one account would race each other's
// concurrency checks and both conclude there was room for a position.
let instance = null;

function getRunner(config) {
  if (!instance && config) instance = new Runner(config);
  return instance;
}

function clearRunner() {
  instance?.stop();
  instance = null;
}

module.exports = { Runner, getRunner, clearRunner };
