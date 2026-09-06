"use strict";

/**
 * Trade journal and performance analytics.
 *
 * This is the part of the product that is worth something whether or not any
 * strategy works — and after 13 strategy/venue combinations and 288 exit
 * variants all came back negative, that distinction matters. A trader who can
 * see their own hit rate, expectancy and drawdown honestly is better off than
 * one running a system nobody has measured.
 *
 * Every figure here is derived from the ledger and the closed positions, never
 * from a stored running total. A P&L number that cannot be reconstructed from
 * its postings is a number nobody should act on.
 */

const mongoose = require("mongoose");
const { Money } = require("./money");
const ledger = require("./ledger");
const { Order2, Position2, LedgerEntry } = require("../models");

/** Mean, and the standard error so a small sample cannot masquerade as skill. */
function meanWithError(values) {
  const n = values.length;
  if (!n) return { mean: 0, stderr: 0, n: 0 };
  const mean = values.reduce((a, b) => a + b, 0) / n;
  if (n < 2) return { mean, stderr: 0, n };
  const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / (n - 1);
  return { mean, stderr: Math.sqrt(variance / n), n };
}

/**
 * Closed trades, reconstructed by pairing each closing order with the ledger
 * postings it produced.
 */
async function trades(accountId, { limit = 500, symbol = null } = {}) {
  const accId = new mongoose.Types.ObjectId(String(accountId));
  const q = { accountId: accId, status: "closed" };
  if (symbol) q.symbol = String(symbol).toUpperCase();

  const closed = await Order2.find(q).sort({ closedAt: -1 }).limit(limit).lean();
  if (!closed.length) return [];

  // One query for every relevant posting rather than one per trade.
  const orderIds = closed.map((o) => o._id);
  const entries = await LedgerEntry.find({
    accountId: accId, orderId: { $in: orderIds },
  }).lean();

  const byOrder = new Map();
  for (const e of entries) {
    const key = String(e.orderId);
    if (!byOrder.has(key)) byOrder.set(key, []);
    byOrder.get(key).push(e);
  }

  return closed.map((o) => {
    const rows = byOrder.get(String(o._id)) || [];
    const currency = rows[0]?.amount?.currency || "INR";

    let pnl = Money.zero(currency);
    let fees = Money.zero(currency);
    for (const e of rows) {
      const amt = Money.parse(e.amount.amount.toString(), currency);
      // pnl is a credit bucket: a gain is posted as a credit, so it reads
      // negative in raw bucket terms and is flipped back here.
      if (e.bucket === "pnl") pnl = e.direction === "credit" ? pnl.plus(amt) : pnl.minus(amt);
      if (e.bucket === "fees") fees = fees.plus(amt);
    }

    return {
      id: o._id,
      symbol: o.symbol,
      side: o.side === "sell" ? "long" : "short",   // the CLOSING side is opposite
      quantity: o.quantity,
      exitPrice: o.filledPrice,
      closedAt: o.closedAt || o.createdAt,
      pnl: pnl.toString(),
      fees: fees.toString(),
      net: pnl.minus(fees).toString(),
      currency,
      source: o.source,
      strategyId: o.strategyId || null,
      reason: o.reason || null,
    };
  });
}

/**
 * Performance statistics.
 *
 * Deliberately reports the STANDARD ERROR on expectancy and refuses to call a
 * result meaningful below 30 trades. Most retail trading journals show a hit
 * rate over eleven trades as though it meant something; it does not, and saying
 * so is more useful than a confident number.
 */
async function performance(accountId, currency, { days = null } = {}) {
  const accId = new mongoose.Types.ObjectId(String(accountId));

  const match = { accountId: accId, status: "closed" };
  if (days) {
    match.closedAt = { $gte: new Date(Date.now() - days * 86400_000) };
  }

  const positions = await Position2.find(match).lean();
  const balances = await ledger.balances(accId, currency);

  const nets = positions.map((p) => Number(p.realizedPnl?.amount ?? 0));
  const wins = nets.filter((v) => v > 0);
  const losses = nets.filter((v) => v < 0);

  const grossWin = wins.reduce((a, b) => a + b, 0);
  const grossLoss = -losses.reduce((a, b) => a + b, 0);
  const { mean, stderr, n } = meanWithError(nets);

  // Equity curve from the ledger, so drawdown is measured on settled money.
  const entries = await LedgerEntry.find({
    accountId: accId, "amount.currency": currency,
    bucket: { $in: ["cash", "margin", "pnl", "fees"] },
  }).sort({ seq: 1 }).lean();

  let running = 0, peak = 0, maxDD = 0;
  const curve = [];
  for (const e of entries) {
    const v = Number(e.amount.amount.toString());
    const signed = e.direction === "debit" ? v : -v;
    // Equity moves with cash, margin and pnl; fees always reduce it.
    running += e.bucket === "fees" ? -Math.abs(v) : signed;
    peak = Math.max(peak, running);
    if (peak > 0) maxDD = Math.max(maxDD, (peak - running) / peak);
    if (curve.length < 500) curve.push({ seq: e.seq, at: e.createdAt, equity: running });
  }

  return {
    currency,
    windowDays: days,
    trades: n,
    // Below ~30 samples the hit rate is dominated by luck. Saying so beats
    // printing 73% over eleven trades as though it were a property.
    significant: n >= 30,
    winRate: n ? Number((wins.length / n).toFixed(4)) : 0,
    profitFactor: grossLoss > 0 ? Number((grossWin / grossLoss).toFixed(3)) : null,
    expectancy: Number(mean.toFixed(2)),
    expectancyStdErr: Number(stderr.toFixed(2)),
    // The honest read: if this interval straddles zero, the edge is unproven.
    expectancy95: [
      Number((mean - 1.96 * stderr).toFixed(2)),
      Number((mean + 1.96 * stderr).toFixed(2)),
    ],
    avgWin: wins.length ? Number((grossWin / wins.length).toFixed(2)) : 0,
    avgLoss: losses.length ? Number((-grossLoss / losses.length).toFixed(2)) : 0,
    largestWin: wins.length ? Number(Math.max(...wins).toFixed(2)) : 0,
    largestLoss: losses.length ? Number(Math.min(...losses).toFixed(2)) : 0,
    maxDrawdown: Number(maxDD.toFixed(4)),
    realisedPnl: Number(nets.reduce((a, b) => a + b, 0).toFixed(2)),
    equity: balances.equity.toString(),
    cash: balances.cash.toString(),
    feesPaid: balances.fees.toString(),
    equityCurve: curve,
  };
}

/** Per-symbol and per-strategy breakdown — where the money actually goes. */
async function breakdown(accountId) {
  const accId = new mongoose.Types.ObjectId(String(accountId));
  const rows = await Position2.aggregate([
    { $match: { accountId: accId, status: "closed" } },
    {
      $group: {
        _id: "$symbol",
        trades: { $sum: 1 },
        net: { $sum: { $toDouble: "$realizedPnl.amount" } },
        wins: { $sum: { $cond: [{ $gt: [{ $toDouble: "$realizedPnl.amount" }, 0] }, 1, 0] } },
      },
    },
    { $sort: { net: -1 } },
  ]);

  return rows.map((r) => ({
    symbol: r._id,
    trades: r.trades,
    net: Number(r.net.toFixed(2)),
    winRate: Number((r.wins / r.trades).toFixed(4)),
  }));
}

module.exports = { trades, performance, breakdown, meanWithError };
