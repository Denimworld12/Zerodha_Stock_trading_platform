"use strict";

/**
 * Order placement and closing.
 *
 * What the old `POST /order` did, and why none of it survives:
 *
 *   - It took `price` from the request body. Anyone could buy at any number.
 *     Here the SERVER resolves the price from its own feed, and the client's
 *     price is only ever used as a limit to check against.
 *   - It wrote the order, the position and the fund in three separate,
 *     non-atomic steps. A crash in the middle left the books permanently wrong.
 *     Here everything happens in one transaction.
 *   - It let a SELL with no holding create a phantom short and double-counted
 *     margin. Here a sell either closes a long or opens an explicit short, and
 *     the ledger has to balance either way.
 *   - It had no idempotency, so a double-click was two orders. Here a unique
 *     index on (accountId, idempotencyKey) makes a retry a no-op.
 */

const mongoose = require("mongoose");
const { Money, ROUND } = require("./money");
const ledger = require("./ledger");
// Referenced through the module object, not destructured: destructuring binds
// the function at load time, which makes the feed impossible to substitute in
// tests and would leave every test opening a real socket to Binance.
const prices = require("./prices");
const { Instrument, Order2, Position2, Account } = require("../models");

/** Round-trip cost assumption. Pessimistic on purpose. */
const FEE_BPS = Number(process.env.FEE_BPS || 10);
/** A price older than this may not fill an order. */
const MAX_PRICE_AGE_MS = Number(process.env.MAX_PRICE_AGE_MS || 5000);

class OrderError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.code = code;
    this.status = details.status || 400;
    this.details = details;
  }
}

// ---------------------------------------------------------------------------
// validation
// ---------------------------------------------------------------------------

/** Exact decimal remainder test — `%` on floats lies about lot steps. */
function isMultipleOf(valueStr, stepStr, scale) {
  const toInt = (s) => {
    const [w, f = ""] = String(s).split(".");
    return BigInt(w + (f + "0".repeat(scale)).slice(0, scale));
  };
  const step = toInt(stepStr);
  if (step === 0n) return true;
  return toInt(valueStr) % step === 0n;
}

async function validateQuantity(instrument, quantity) {
  const qty = String(quantity);
  if (!/^\d+(\.\d+)?$/.test(qty)) {
    throw new OrderError("BAD_QUANTITY", `quantity must be a positive decimal, got ${qty}`);
  }
  const scale = instrument.qtyScale ?? 8;
  const num = Number(qty);
  if (!(num > 0)) throw new OrderError("BAD_QUANTITY", "quantity must be greater than zero");

  if (Number(qty) < Number(instrument.minQty)) {
    throw new OrderError("BELOW_MIN_QTY",
      `quantity ${qty} is below the ${instrument.symbol} minimum of ${instrument.minQty}`);
  }
  if (instrument.maxQty && Number(qty) > Number(instrument.maxQty)) {
    throw new OrderError("ABOVE_MAX_QTY",
      `quantity ${qty} exceeds the ${instrument.symbol} maximum of ${instrument.maxQty}`);
  }
  if (!isMultipleOf(qty, instrument.lotStep, scale)) {
    throw new OrderError("BAD_LOT_STEP",
      `quantity ${qty} is not a multiple of the ${instrument.symbol} lot step ${instrument.lotStep}`);
  }
  return qty;
}

/**
 * Resolve the fill price on the SERVER.
 *
 * For a limit order the client's price is a constraint, never the fill: we
 * still fill at the market price and only reject if it is worse than the limit.
 */
async function resolvePrice({ instrument, side, orderType, limitPrice }) {
  const feed = prices.getFeed();
  const quote = await feed.getPrice(instrument.symbol, { maxAgeMs: MAX_PRICE_AGE_MS });

  if (!quote) {
    throw new OrderError("NO_PRICE",
      `no market price available for ${instrument.symbol}`, { status: 503 });
  }
  if (quote.stale) {
    throw new OrderError("STALE_PRICE",
      `last ${instrument.symbol} price is ${Math.round(quote.ageMs / 1000)}s old; refusing to fill`,
      { status: 503, ageMs: quote.ageMs });
  }

  const market = Money.parse(quote.price.toFixed(instrument.priceScale ?? 2), "INR");

  if (orderType === "limit") {
    if (limitPrice == null) throw new OrderError("MISSING_LIMIT", "limit orders need a limitPrice");
    const limit = Money.parse(String(limitPrice), "INR");
    const acceptable = side === "buy" ? market.lte(limit) : market.gte(limit);
    if (!acceptable) {
      throw new OrderError("LIMIT_NOT_MET",
        `market ${market} is outside the ${side} limit of ${limit}`,
        { market: market.toString(), limit: limit.toString() });
    }
  }
  return { price: market, quote };
}

function feeOn(notional) {
  // Round fees UP: rounding a charge in our own favour is how a ledger quietly
  // accumulates a surplus that nobody can explain.
  return notional.times(String(FEE_BPS / 10000), { qtyScale: 8, rounding: ROUND.UP });
}

// ---------------------------------------------------------------------------
// place
// ---------------------------------------------------------------------------
async function placeOrder({
  user, account, symbol, side, quantity,
  orderType = "market", limitPrice = null,
  stopLoss = null, takeProfit = null,
  idempotencyKey, source = "manual", strategyId, confidence, reason,
}) {
  if (!["buy", "sell"].includes(side)) {
    throw new OrderError("BAD_SIDE", `side must be buy or sell, got ${side}`);
  }
  if (!idempotencyKey) {
    throw new OrderError("MISSING_IDEMPOTENCY_KEY",
      "an Idempotency-Key is required so a retry cannot place a second order");
  }
  if (account.tradingHaltedAt) {
    throw new OrderError("TRADING_HALTED",
      `trading halted: ${account.haltReason || "risk limit breached"}`, { status: 423 });
  }

  // A retry returns the original order rather than erroring — that is what
  // makes the client's retry loop safe.
  const existing = await Order2.findOne({ accountId: account._id, idempotencyKey });
  if (existing) return { order: existing, replayed: true };

  const instrument = await Instrument.findOne({
    symbol: String(symbol).toUpperCase(), active: true,
  });
  if (!instrument) {
    throw new OrderError("UNKNOWN_INSTRUMENT", `${symbol} is not a tradable instrument`, { status: 404 });
  }

  const qty = await validateQuantity(instrument, quantity);
  const { price, quote } = await resolvePrice({ instrument, side, orderType, limitPrice });

  const currency = account.baseCurrency;
  const notional = Money.parse(price.toString(), currency)
    .times(qty, { qtyScale: instrument.qtyScale ?? 8 });
  const fee = feeOn(notional);

  const openPosition = await Position2.findOne({
    accountId: account._id, symbol: instrument.symbol, status: "open",
  });

  // A sell against an open long CLOSES it. Only a sell with no long opens a
  // short — the old code conflated the two and charged margin twice.
  const closing =
    openPosition &&
    ((openPosition.side === "long" && side === "sell") ||
     (openPosition.side === "short" && side === "buy"));

  if (closing) {
    return closePosition({
      user, account, symbol: instrument.symbol, quantity: qty,
      idempotencyKey, instrument, price, source, reason,
    });
  }

  if (!openPosition) {
    const openCount = await Position2.countDocuments({ accountId: account._id, status: "open" });
    if (openCount >= account.limits.maxConcurrentPositions) {
      throw new OrderError("TOO_MANY_POSITIONS",
        `already holding ${openCount} positions; limit is ${account.limits.maxConcurrentPositions}`,
        { status: 409 });
    }
  }

  const order = await ledger.withTransaction(async (session) => {
    const [doc] = await Order2.create([{
      userId: user._id, accountId: account._id, idempotencyKey,
      symbol: instrument.symbol, venue: instrument.venue, side, orderType,
      quantity: qty, requestedPrice: limitPrice ? String(limitPrice) : null,
      filledPrice: price.toString(), filledQuantity: qty,
      stopLoss: stopLoss != null ? String(stopLoss) : null,
      takeProfit: takeProfit != null ? String(takeProfit) : null,
      status: "filled", source, strategyId, confidence, reason,
      filledAt: new Date(),
    }], { session });

    // Throws INSUFFICIENT_FUNDS, which aborts the whole transaction — the
    // order row does not survive a failed funding step.
    await ledger.commitMargin({
      userId: user._id, accountId: account._id, orderId: doc._id,
      symbol: instrument.symbol, notional, fee,
    }, { session });

    if (openPosition) {
      // Adding to a position: recompute the weighted average entry.
      const oldQty = openPosition.quantity;
      const newQty = (Number(oldQty) + Number(qty)).toFixed(instrument.qtyScale ?? 8);
      const oldCost = Money.parse(openPosition.averagePrice, currency)
        .times(oldQty, { qtyScale: instrument.qtyScale ?? 8 });
      const avg = oldCost.plus(notional)
        .dividedBy(newQty, { rounding: ROUND.HALF_UP });

      await Position2.updateOne(
        { _id: openPosition._id, version: openPosition.version },
        {
          $set: { quantity: newQty, averagePrice: avg.toString() },
          $inc: { version: 1 },
        },
        { session }
      );
    } else {
      await Position2.create([{
        userId: user._id, accountId: account._id,
        symbol: instrument.symbol, venue: instrument.venue,
        side: side === "buy" ? "long" : "short",
        quantity: qty, averagePrice: price.toString(),
        realizedPnl: { amount: Money.zero(currency).toDecimal128(), currency },
        stopLoss: stopLoss != null ? String(stopLoss) : null,
        takeProfit: takeProfit != null ? String(takeProfit) : null,
      }], { session });
    }

    return doc;
  });

  // Snapshotting is derived-data maintenance, deliberately outside the
  // transaction: it must never be able to fail an order.
  ledger.maybeSnapshot(account._id, currency).catch(() => {});

  return { order, replayed: false, price: price.toString(), notional: notional.toString(),
           fee: fee.toString(), quoteAgeMs: quote.ageMs };
}

// ---------------------------------------------------------------------------
// close
// ---------------------------------------------------------------------------
async function closePosition({
  user, account, symbol, quantity = null,
  idempotencyKey, instrument = null, price = null, source = "manual", reason,
}) {
  const sym = String(symbol).toUpperCase();
  instrument = instrument || (await Instrument.findOne({ symbol: sym, active: true }));
  if (!instrument) throw new OrderError("UNKNOWN_INSTRUMENT", `${sym} is not tradable`, { status: 404 });

  const position = await Position2.findOne({
    accountId: account._id, symbol: sym, status: "open",
  });
  if (!position) {
    throw new OrderError("NO_POSITION", `no open position in ${sym}`, { status: 404 });
  }

  const qty = quantity ? String(quantity) : position.quantity;
  if (Number(qty) > Number(position.quantity)) {
    throw new OrderError("QUANTITY_EXCEEDS_POSITION",
      `cannot close ${qty}; position holds ${position.quantity}`);
  }

  if (!price) {
    const resolved = await resolvePrice({
      instrument, side: position.side === "long" ? "sell" : "buy", orderType: "market",
    });
    price = resolved.price;
  }

  const currency = account.baseCurrency;
  const qtyScale = instrument.qtyScale ?? 8;
  const entry = Money.parse(position.averagePrice, currency);
  const exit = Money.parse(price.toString(), currency);

  // The portion of margin being released, at the ORIGINAL entry price.
  const releasedNotional = entry.times(qty, { qtyScale });
  const exitNotional = exit.times(qty, { qtyScale });

  // long: gain when the exit is higher. short: gain when it is lower.
  const pnl = position.side === "long"
    ? exitNotional.minus(releasedNotional)
    : releasedNotional.minus(exitNotional);

  const fee = feeOn(exitNotional);
  const remaining = (Number(position.quantity) - Number(qty)).toFixed(qtyScale);
  const fullyClosed = Number(remaining) === 0;

  const order = await ledger.withTransaction(async (session) => {
    const [doc] = await Order2.create([{
      userId: user._id, accountId: account._id,
      idempotencyKey: idempotencyKey || `close-${position._id}-${Date.now()}`,
      symbol: sym, venue: instrument.venue,
      side: position.side === "long" ? "sell" : "buy",
      orderType: "market", quantity: qty,
      filledPrice: exit.toString(), filledQuantity: qty,
      status: "closed", source, reason,
      filledAt: new Date(), closedAt: new Date(),
    }], { session });

    await ledger.releaseMargin({
      userId: user._id, accountId: account._id, orderId: doc._id,
      symbol: sym, notional: releasedNotional, pnl, fee,
    }, { session });

    const prevPnl = Money.parse(position.realizedPnl.amount.toString(), currency);
    const update = {
      $set: {
        realizedPnl: { amount: prevPnl.plus(pnl).toDecimal128(), currency },
        ...(fullyClosed
          ? { status: "closed", closedAt: new Date(), quantity: "0" }
          : { quantity: remaining }),
      },
      $inc: { version: 1 },
    };

    // Guard on `version`: if a concurrent fill changed the position since we
    // read it, this matches nothing and the transaction aborts rather than
    // overwriting the other write.
    const res = await Position2.updateOne(
      { _id: position._id, version: position.version },
      update,
      { session }
    );
    if (res.matchedCount === 0) {
      throw new OrderError("CONCURRENT_MODIFICATION",
        "the position changed while this close was being processed; retry", { status: 409 });
    }

    return doc;
  });

  ledger.maybeSnapshot(account._id, currency).catch(() => {});

  return {
    order, replayed: false, closed: fullyClosed,
    price: exit.toString(), pnl: pnl.toString(), fee: fee.toString(),
    remaining,
  };
}

// ---------------------------------------------------------------------------
async function accountSummary(account) {
  const currency = account.baseCurrency;
  const [bal, positions] = await Promise.all([
    ledger.balances(account._id, currency),
    Position2.find({ accountId: account._id, status: "open" }).lean(),
  ]);

  const feed = prices.getFeed();
  let unrealised = Money.zero(currency);
  const marked = [];

  for (const p of positions) {
    const tick = feed.peek(p.symbol);
    const entry = Money.parse(p.averagePrice, currency);
    let pnl = Money.zero(currency);
    let last = null;

    if (tick) {
      last = tick.price;
      const inst = await Instrument.findOne({ symbol: p.symbol }).lean();
      const scale = inst?.qtyScale ?? 8;
      const now = Money.parse(tick.price.toFixed(inst?.priceScale ?? 2), currency);
      pnl = p.side === "long"
        ? now.times(p.quantity, { qtyScale: scale }).minus(entry.times(p.quantity, { qtyScale: scale }))
        : entry.times(p.quantity, { qtyScale: scale }).minus(now.times(p.quantity, { qtyScale: scale }));
      unrealised = unrealised.plus(pnl);
    }

    marked.push({
      symbol: p.symbol, side: p.side, quantity: p.quantity,
      averagePrice: p.averagePrice, lastPrice: last,
      unrealisedPnl: pnl.toString(),
      realisedPnl: Money.parse(p.realizedPnl.amount.toString(), currency).toString(),
      stale: !tick,
    });
  }

  return {
    currency,
    balances: Object.fromEntries(
      Object.entries(bal).map(([k, v]) => [k, v.toString()])
    ),
    unrealisedPnl: unrealised.toString(),
    equityMarked: bal.equity.plus(unrealised).toString(),
    positions: marked,
  };
}

module.exports = { placeOrder, closePosition, accountSummary, OrderError, FEE_BPS, isMultipleOf };
