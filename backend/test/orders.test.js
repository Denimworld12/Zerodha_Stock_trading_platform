/**
 * Order lifecycle tests.
 *
 * Several of these exist specifically to prove that a defect present in the
 * original `POST /order` is now impossible, rather than merely unlikely.
 */
const assert = require("node:assert/strict");
const { test, before, after, beforeEach } = require("node:test");
const mongoose = require("mongoose");

const { Money } = require("../lib/money");
const ledger = require("../lib/ledger");
const orders = require("../lib/orders");
const prices = require("../lib/prices");
const { User, Account, Instrument, Order2, Position2, LedgerEntry } = require("../models");

const URL = process.env.TEST_MONGO_URL
  || "mongodb://localhost:27017/tradingmitra_orders_test?replicaSet=rs0";

let user, account, fakeFeed;
const inr = (v) => Money.parse(v, "INR");

/** A deterministic feed: real prices would make assertions untestable. */
function installFakeFeed() {
  fakeFeed = new prices.PriceFeed({ symbols: [] });
  fakeFeed.start = () => fakeFeed;
  fakeFeed._connect = () => {};
  fakeFeed.setPrice = (symbol, price, ageMs = 0) =>
    fakeFeed.last.set(symbol, { price, ts: Date.now() - ageMs, source: "test" });
  // Never let the test reach the network.
  fakeFeed._fetchRest = async () => null;
  const mod = require("../lib/prices");
  mod.getFeed = () => fakeFeed;
  return fakeFeed;
}

before(async () => {
  await mongoose.connect(URL, { serverSelectionTimeoutMS: 8000 });
  await mongoose.connection.db.dropDatabase();
  await Promise.all(Object.values(mongoose.models).map((m) => m.syncIndexes()));
  installFakeFeed();

  await Instrument.create({
    symbol: "BTCUSDT", venue: "binance", assetClass: "crypto",
    baseCurrency: "BTC", quoteCurrency: "USDT",
    tickSize: "0.01", lotStep: "0.001", minQty: "0.001",
    priceScale: 2, qtyScale: 8,
  });
});

after(async () => {
  await mongoose.connection.db.dropDatabase();
  await mongoose.disconnect();
});

beforeEach(async () => {
  const db = mongoose.connection.db;
  await Promise.all([
    db.collection("ledgerentries").deleteMany({}),
    db.collection("balancesnapshots").deleteMany({}),
    Order2.deleteMany({}), Position2.deleteMany({}),
    Account.deleteMany({}), User.deleteMany({}),
  ]);
  user = await User.create({ email: `o${Date.now()}@x.com` });
  account = await Account.create({
    userId: user._id, name: "paper", kind: "paper", baseCurrency: "INR",
  });
  await ledger.deposit({ userId: user._id, accountId: account._id, money: inr("100000") });
  fakeFeed.setPrice("BTCUSDT", 80000);
  account = await Account.findById(account._id);
});

const buy = (over = {}) => orders.placeOrder({
  user, account, symbol: "BTCUSDT", side: "buy", quantity: "0.01",
  idempotencyKey: "k-" + Math.random(), ...over,
});

// ---------------------------------------------------------------------------
test("the client cannot dictate the fill price", async () => {
  // The old route trusted `price` from the body. Pass an absurd one and check
  // the server prices it from its own feed instead.
  const res = await orders.placeOrder({
    user, account, symbol: "BTCUSDT", side: "buy", quantity: "0.01",
    idempotencyKey: "px", price: 1, requestedPrice: 1, limitPrice: null,
  });
  assert.equal(res.price, "80000.00");
  assert.equal(res.order.filledPrice, "80000.00");
});

test("a stale price refuses to fill rather than guessing", async () => {
  fakeFeed.setPrice("BTCUSDT", 80000, 120_000);   // two minutes old
  await assert.rejects(buy({ idempotencyKey: "stale" }), (e) => e.code === "STALE_PRICE");
  assert.equal(await Order2.countDocuments({}), 0);
});

test("a retry with the same key replays instead of double-ordering", async () => {
  const a = await orders.placeOrder({
    user, account, symbol: "BTCUSDT", side: "buy", quantity: "0.01", idempotencyKey: "dup",
  });
  const b = await orders.placeOrder({
    user, account, symbol: "BTCUSDT", side: "buy", quantity: "0.01", idempotencyKey: "dup",
  });
  assert.equal(b.replayed, true);
  assert.equal(String(a.order._id), String(b.order._id));
  assert.equal(await Order2.countDocuments({}), 1);
});

test("lot step and minimum quantity are enforced exactly", async () => {
  await assert.rejects(buy({ quantity: "0.0001" }), (e) => e.code === "BELOW_MIN_QTY");
  await assert.rejects(buy({ quantity: "0.0015" }), (e) => e.code === "BAD_LOT_STEP");
  await assert.rejects(buy({ quantity: "-1" }), (e) => e.code === "BAD_QUANTITY");
  await assert.rejects(buy({ quantity: "abc" }), (e) => e.code === "BAD_QUANTITY");
  await buy({ quantity: "0.002" });   // a valid multiple
});

test("an order beyond the balance leaves nothing behind", async () => {
  fakeFeed.setPrice("BTCUSDT", 80000);
  await assert.rejects(
    buy({ quantity: "100" }),                       // 80 lakh on a 1 lakh account
    (e) => e.code === "INSUFFICIENT_FUNDS"
  );
  // The transaction must have rolled the order row back with the funding.
  assert.equal(await Order2.countDocuments({}), 0);
  assert.equal(await Position2.countDocuments({}), 0);
  const b = await ledger.balances(account._id, "INR");
  assert.equal(b.cash.toString(), "100000.00");
  assert.equal((await ledger.audit(account._id)).ok, true);
});

test("a buy commits margin and the books stay balanced", async () => {
  const r = await buy();
  assert.equal(r.notional, "800.00");        // 0.01 x 80,000
  assert.equal(r.fee, "0.80");               // 10 bps

  const b = await ledger.balances(account._id, "INR");
  assert.equal(b.margin.toString(), "800.00");
  assert.equal(b.cash.toString(), "99199.20");
  assert.equal((await ledger.audit(account._id)).ok, true);

  const pos = await Position2.findOne({ accountId: account._id });
  assert.equal(pos.side, "long");
  assert.equal(pos.quantity, "0.01");
  assert.equal(pos.averagePrice, "80000.00");
});

test("a sell against an open long CLOSES it rather than opening a short", async () => {
  await buy();
  fakeFeed.setPrice("BTCUSDT", 82000);

  const r = await orders.placeOrder({
    user, account, symbol: "BTCUSDT", side: "sell", quantity: "0.01", idempotencyKey: "close1",
  });
  assert.equal(r.closed, true);
  assert.equal(r.pnl, "20.00");              // (82000-80000) x 0.01

  const positions = await Position2.find({ accountId: account._id });
  assert.equal(positions.length, 1);
  assert.equal(positions[0].status, "closed");
  // Exactly one open position must never coexist with its own short.
  assert.equal(await Position2.countDocuments({ status: "open" }), 0);

  const b = await ledger.balances(account._id, "INR");
  assert.equal(b.margin.toString(), "0.00");
  assert.equal((await ledger.audit(account._id)).ok, true);
});

test("a losing trade debits the account correctly", async () => {
  await buy();
  fakeFeed.setPrice("BTCUSDT", 78000);
  const r = await orders.closePosition({
    user, account, symbol: "BTCUSDT", idempotencyKey: "loss",
  });
  assert.equal(r.pnl, "-20.00");

  const b = await ledger.balances(account._id, "INR");
  // 100000 - 0.80 (open fee) - 0.78 (close fee) - 20.00 (loss)
  assert.equal(b.cash.toString(), "99978.42");
  assert.equal((await ledger.audit(account._id)).ok, true);
});

test("a partial close leaves the rest of the position open", async () => {
  await buy({ quantity: "0.01" });
  fakeFeed.setPrice("BTCUSDT", 81000);

  const r = await orders.closePosition({
    user, account, symbol: "BTCUSDT", quantity: "0.004", idempotencyKey: "partial",
  });
  assert.equal(r.closed, false);
  assert.equal(r.pnl, "4.00");               // (81000-80000) x 0.004

  const pos = await Position2.findOne({ accountId: account._id, status: "open" });
  assert.equal(Number(pos.quantity).toFixed(3), "0.006");
  assert.equal((await ledger.audit(account._id)).ok, true);
});

test("closing more than is held is refused", async () => {
  await buy({ quantity: "0.01" });
  await assert.rejects(
    orders.closePosition({ user, account, symbol: "BTCUSDT", quantity: "0.05", idempotencyKey: "over" }),
    (e) => e.code === "QUANTITY_EXCEEDS_POSITION"
  );
});

test("adding to a position averages the entry exactly", async () => {
  await buy({ quantity: "0.01", idempotencyKey: "add1" });   // at 80,000
  fakeFeed.setPrice("BTCUSDT", 90000);
  await buy({ quantity: "0.01", idempotencyKey: "add2" });   // at 90,000

  const pos = await Position2.findOne({ accountId: account._id, status: "open" });
  assert.equal(Number(pos.quantity).toFixed(3), "0.020");
  assert.equal(pos.averagePrice, "85000.00");                // exact, not 84999.99
  assert.equal((await ledger.audit(account._id)).ok, true);
});

test("the concurrent-position limit is enforced server-side", async () => {
  for (const s of ["ETHUSDT", "SOLUSDT", "BNBUSDT"]) {
    await Instrument.updateOne(
      { symbol: s, venue: "binance" },
      { $setOnInsert: {
          symbol: s, venue: "binance", assetClass: "crypto",
          baseCurrency: s.replace("USDT", ""), quoteCurrency: "USDT",
          tickSize: "0.01", lotStep: "0.001", minQty: "0.001", priceScale: 2, qtyScale: 8,
      } },
      { upsert: true }
    );
    fakeFeed.setPrice(s, 1000);
  }
  await buy({ idempotencyKey: "p1" });
  await orders.placeOrder({ user, account, symbol: "ETHUSDT", side: "buy", quantity: "0.01", idempotencyKey: "p2" });
  await orders.placeOrder({ user, account, symbol: "SOLUSDT", side: "buy", quantity: "0.01", idempotencyKey: "p3" });

  await assert.rejects(
    orders.placeOrder({ user, account, symbol: "BNBUSDT", side: "buy", quantity: "0.01", idempotencyKey: "p4" }),
    (e) => e.code === "TOO_MANY_POSITIONS"
  );
});

test("a halted account cannot trade", async () => {
  account.tradingHaltedAt = new Date();
  account.haltReason = "daily loss limit";
  await assert.rejects(buy({ idempotencyKey: "halted" }), (e) => e.code === "TRADING_HALTED");
});

test("an unknown instrument is refused", async () => {
  await assert.rejects(
    orders.placeOrder({ user, account, symbol: "DOGECOIN", side: "buy", quantity: "1", idempotencyKey: "x" }),
    (e) => e.code === "UNKNOWN_INSTRUMENT"
  );
});

test("a limit order rejects a market price outside the limit", async () => {
  fakeFeed.setPrice("BTCUSDT", 80000);
  await assert.rejects(
    buy({ orderType: "limit", limitPrice: "79000", idempotencyKey: "lim1" }),
    (e) => e.code === "LIMIT_NOT_MET"
  );
  // ...and accepts one inside it, still filling at the market price
  const ok = await buy({ orderType: "limit", limitPrice: "81000", idempotencyKey: "lim2" });
  assert.equal(ok.price, "80000.00");
});

test("account summary marks open positions to market", async () => {
  await buy();
  fakeFeed.setPrice("BTCUSDT", 85000);
  const s = await orders.accountSummary(account);
  assert.equal(s.positions.length, 1);
  assert.equal(s.positions[0].unrealisedPnl, "50.00");   // (85000-80000) x 0.01
  assert.equal(s.unrealisedPnl, "50.00");
});

test("a full round trip conserves money exactly", async () => {
  const before = await ledger.balances(account._id, "INR");

  await buy({ quantity: "0.005", idempotencyKey: "rt1" });
  fakeFeed.setPrice("BTCUSDT", 80000);                    // flat: no P&L
  await orders.closePosition({ user, account, symbol: "BTCUSDT", idempotencyKey: "rt2" });

  const after = await ledger.balances(account._id, "INR");
  // The only thing that may have changed is fees.
  const lost = before.cash.minus(after.cash);
  assert.equal(lost.toString(), after.fees.toString(),
    "cash should only have fallen by the fees charged");
  assert.equal((await ledger.audit(account._id)).ok, true);
});
