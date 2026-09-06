/**
 * Ledger integration tests. These run against the real replica-set Mongo,
 * because the properties being tested (atomicity, immutability, unique
 * indexes) are enforced by the database, not by JavaScript.
 */
const assert = require("node:assert/strict");
const { test, before, after, beforeEach } = require("node:test");
const mongoose = require("mongoose");

const { Money } = require("../lib/money");
const ledger = require("../lib/ledger");
const { User, Account, LedgerEntry, Order2 } = require("../models");

const URL = process.env.TEST_MONGO_URL
  || "mongodb://localhost:27017/tradingmitra_test?replicaSet=rs0";

let user, account;

before(async () => {
  await mongoose.connect(URL, { serverSelectionTimeoutMS: 8000 });
  await mongoose.connection.db.dropDatabase();
  await Promise.all(Object.values(mongoose.models).map((m) => m.syncIndexes()));
});

after(async () => {
  await mongoose.connection.db.dropDatabase();
  await mongoose.disconnect();
});

beforeEach(async () => {
  await Promise.all([
    LedgerEntry.deleteMany({}).setOptions({ bypassDocumentValidation: true }),
    Order2.deleteMany({}), Account.deleteMany({}), User.deleteMany({}),
  ]).catch(() => {});
  // deleteMany is blocked on LedgerEntry by design, so drop the collection.
  await mongoose.connection.db.collection("ledgerentries").deleteMany({});
  user = await User.create({ email: `t${Date.now()}@x.com`, identities: [] });
  account = await Account.create({
    userId: user._id, name: "paper-" + Date.now(), kind: "paper", baseCurrency: "INR",
  });
});

const inr = (v) => Money.parse(v, "INR");

test("deposit moves money and balances derive from history", async () => {
  await ledger.deposit({ userId: user._id, accountId: account._id, money: inr("100000") });
  const b = await ledger.balances(account._id, "INR");
  assert.equal(b.cash.toString(), "100000.00");
  assert.equal(b.external.toString(), "-100000.00"); // contra side
  assert.equal((await ledger.audit(account._id)).ok, true);
});

test("an unbalanced posting is refused before it is written", async () => {
  await assert.rejects(
    ledger.post([
      { userId: user._id, accountId: account._id, bucket: "cash", direction: "debit", money: inr("100"), reason: "deposit" },
      { userId: user._id, accountId: account._id, bucket: "external", direction: "credit", money: inr("99"), reason: "deposit" },
    ]),
    /does not balance/
  );
  assert.equal(await LedgerEntry.countDocuments({}), 0, "nothing should have been written");
});

test("history is immutable", async () => {
  await ledger.deposit({ userId: user._id, accountId: account._id, money: inr("500") });
  const e = await LedgerEntry.findOne({ bucket: "cash" });
  await assert.rejects(
    LedgerEntry.updateOne({ _id: e._id }, { $set: { "amount.amount": "999" } }),
    /immutable/
  );
  await assert.rejects(LedgerEntry.deleteOne({ _id: e._id }), /immutable/);
});

test("withdrawal beyond the balance is refused", async () => {
  await ledger.deposit({ userId: user._id, accountId: account._id, money: inr("1000") });
  await assert.rejects(
    ledger.withdraw({ userId: user._id, accountId: account._id, money: inr("1000.01") }),
    (e) => e.code === "INSUFFICIENT_FUNDS"
  );
  assert.equal((await ledger.balances(account._id, "INR")).cash.toString(), "1000.00");
});

test("a full trade round trip leaves the books balanced", async () => {
  await ledger.deposit({ userId: user._id, accountId: account._id, money: inr("100000") });

  // buy: notional 799.00, fee 0.72
  await ledger.commitMargin({
    userId: user._id, accountId: account._id, symbol: "BTCUSDT",
    notional: inr("799.00"), fee: inr("0.72"),
  });
  let b = await ledger.balances(account._id, "INR");
  assert.equal(b.cash.toString(), "99200.28");
  assert.equal(b.margin.toString(), "799.00");

  // close at a 55.10 profit, fee 0.75
  await ledger.releaseMargin({
    userId: user._id, accountId: account._id, symbol: "BTCUSDT",
    notional: inr("799.00"), pnl: inr("55.10"), fee: inr("0.75"),
  });
  b = await ledger.balances(account._id, "INR");
  assert.equal(b.margin.toString(), "0.00");
  assert.equal(b.cash.toString(), "100053.63");   // 99200.28 + 799 + 55.10 - 0.75
  assert.equal(b.pnl.toString(), "-55.10");       // credit bucket: gains show negative
  assert.equal(b.fees.toString(), "1.47");
  assert.equal((await ledger.audit(account._id)).ok, true);
});

test("a failed transaction rolls the ledger back completely", async () => {
  await ledger.deposit({ userId: user._id, accountId: account._id, money: inr("10000") });
  const before = await LedgerEntry.countDocuments({});

  await assert.rejects(
    ledger.withTransaction(async (session) => {
      await ledger.commitMargin({
        userId: user._id, accountId: account._id, symbol: "X",
        notional: inr("500"), fee: inr("1"),
      }, { session });
      throw new Error("broker rejected the order");   // simulate a late failure
    }),
    /broker rejected/
  );

  assert.equal(await LedgerEntry.countDocuments({}), before, "entries leaked past the rollback");
  assert.equal((await ledger.balances(account._id, "INR")).cash.toString(), "10000.00");
});

test("the idempotency index blocks a duplicate order", async () => {
  const base = {
    userId: user._id, accountId: account._id, idempotencyKey: "same-key",
    symbol: "BTCUSDT", side: "buy", quantity: "0.01", venue: "internal",
  };
  await Order2.create(base);
  await assert.rejects(Order2.create(base), (e) => e.code === 11000);
  assert.equal(await Order2.countDocuments({}), 1);
});

test("only one open position per symbol per account", async () => {
  const { Position2 } = require("../models");
  const base = {
    userId: user._id, accountId: account._id, symbol: "BTCUSDT", side: "long",
    quantity: "0.01", averagePrice: "79900", realizedPnl: { amount: "0", currency: "INR" },
  };
  await Position2.create(base);
  await assert.rejects(Position2.create(base), (e) => e.code === 11000);
  // ...but a CLOSED one may coexist, so history accumulates
  await Position2.updateOne({ accountId: account._id, symbol: "BTCUSDT" }, { $set: { status: "closed" } });
  await Position2.create(base);
  assert.equal(await Position2.countDocuments({ symbol: "BTCUSDT" }), 2);
});

test("audit detects a hand-corrupted ledger", async () => {
  await ledger.deposit({ userId: user._id, accountId: account._id, money: inr("100") });
  // Bypass the model guards the way a rogue script or a bad migration would.
  await mongoose.connection.db.collection("ledgerentries").insertOne({
    userId: user._id, accountId: account._id,
    transactionId: new mongoose.Types.ObjectId(),
    bucket: "cash", direction: "debit",
    amount: { amount: mongoose.Types.Decimal128.fromString("1000000"), currency: "INR" },
    reason: "adjustment", createdAt: new Date(), _v: 1,
  });
  const a = await ledger.audit(account._id);
  assert.equal(a.ok, false, "audit failed to notice free money appearing");
  assert.ok(a.unbalancedTransactions.length > 0);
});

test("snapshots never change the answer, and keep reads flat as history grows", async () => {
  const ledger2 = require("../lib/ledger");
  const { BalanceSnapshot } = require("../models");

  await ledger2.deposit({ userId: user._id, accountId: account._id, money: inr("100000") });

  // Build real history: 3000 postings = 6000+ entries.
  for (let i = 0; i < 1500; i++) {
    await ledger2.commitMargin({
      userId: user._id, accountId: account._id, symbol: "X",
      notional: inr("10.00"), fee: inr("0.01"),
    });
    await ledger2.releaseMargin({
      userId: user._id, accountId: account._id, symbol: "X",
      notional: inr("10.00"), pnl: inr("0.02"), fee: inr("0.01"),
    });
  }

  const noSnapshot = await ledger2.balances(account._id, "INR");
  assert.equal(await BalanceSnapshot.countDocuments({}), 0, "no snapshot should exist yet");

  const t0 = Date.now();
  await ledger2.balances(account._id, "INR");
  const coldMs = Date.now() - t0;

  // Cut a snapshot, then read again. Same numbers, less work.
  await ledger2.rebuildSnapshot(account._id, "INR");
  assert.equal(await BalanceSnapshot.countDocuments({}), 1);

  const withSnapshot = await ledger2.balances(account._id, "INR");
  const t1 = Date.now();
  await ledger2.balances(account._id, "INR");
  const warmMs = Date.now() - t1;

  // The property that matters: identical results either way.
  for (const bucket of [...ledger2.BUCKETS, "equity"]) {
    assert.equal(
      withSnapshot[bucket].toString(),
      noSnapshot[bucket].toString(),
      `snapshot changed the ${bucket} balance`
    );
  }
  assert.equal((await ledger2.audit(account._id)).ok, true);

  // And postings after the snapshot still land.
  await ledger2.deposit({ userId: user._id, accountId: account._id, money: inr("500") });
  const after = await ledger2.balances(account._id, "INR");
  assert.equal(after.cash.minus(withSnapshot.cash).toString(), "500.00");

  console.log(`      full scan ${coldMs}ms -> snapshot read ${warmMs}ms ` +
              `over ${await require("../models").LedgerEntry.countDocuments({})} entries`);
});

test("a corrupted snapshot is repaired from the entries", async () => {
  const ledger2 = require("../lib/ledger");
  const { BalanceSnapshot } = require("../models");

  await ledger2.deposit({ userId: user._id, accountId: account._id, money: inr("1000") });
  await ledger2.rebuildSnapshot(account._id, "INR");
  const truth = await ledger2.balances(account._id, "INR");

  // Corrupt it the way a bad deploy might.
  await BalanceSnapshot.updateOne(
    { accountId: account._id },
    { $set: { "balances.cash": mongoose.Types.Decimal128.fromString("999999") } }
  );
  const lying = await ledger2.balances(account._id, "INR");
  assert.notEqual(lying.cash.toString(), truth.cash.toString(), "corruption should be visible");

  await ledger2.rebuildSnapshot(account._id, "INR");
  const repaired = await ledger2.balances(account._id, "INR");
  assert.equal(repaired.cash.toString(), truth.cash.toString(), "rebuild did not repair");
});
