#!/usr/bin/env node
"use strict";

/**
 * Where should each kind of market data actually live?
 *
 * Three questions, measured rather than assumed:
 *   A. raw ticks       — can Mongo take them, and what do they cost to keep?
 *   B. OHLCV bars      — regular collection vs native time-series collection
 *   C. derived balance — how long does summing the ledger take as it grows?
 */
const { MongoClient } = require("mongodb");
const { Decimal128, ObjectId } = require("mongodb");

const URL = process.env.MONGO_URL || "mongodb://localhost:27017/?replicaSet=rs0";
const ms = (ns) => Number(ns / 1000n) / 1000;
const mb = (b) => (b / 1024 / 1024).toFixed(1);

function quantiles(samples) {
  const s = [...samples].sort((a, b) => a - b);
  const q = (p) => s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
  return { p50: q(50), p95: q(95), max: s[s.length - 1] };
}

(async () => {
  const client = new MongoClient(URL, { serverSelectionTimeoutMS: 8000 });
  await client.connect();
  const db = client.db("probe_storage");
  await db.dropDatabase();

  // ---- A. raw ticks ----------------------------------------------------
  console.log("A. RAW TICKS");
  const ticks = db.collection("ticks");
  const mkTick = (i) => ({ s: "BTCUSDT", p: 79900 + (i % 100) / 100, q: 0.013, t: new Date() });

  let t0 = process.hrtime.bigint();
  for (let i = 0; i < 1000; i++) await ticks.insertOne(mkTick(i));
  const single = ms(process.hrtime.bigint() - t0);
  console.log(`   insertOne x1000        ${single.toFixed(0)}ms  => ${Math.round(1000 / (single / 1000)).toLocaleString()}/sec`);

  t0 = process.hrtime.bigint();
  for (let b = 0; b < 40; b++) {
    await ticks.insertMany(Array.from({ length: 500 }, (_, i) => mkTick(i)), { ordered: false });
  }
  const batch = ms(process.hrtime.bigint() - t0);
  const perSec = Math.round(20000 / (batch / 1000));
  console.log(`   insertMany(500) x40    ${batch.toFixed(0)}ms  => ${perSec.toLocaleString()}/sec`);

  // WiredTiger reports storageSize 0 until it checkpoints, so force one.
  await client.db("admin").command({ fsync: 1 });
  const ts = await db.command({ collStats: "ticks" });
  const bytesPerTick = (ts.storageSize || ts.size) / ts.count;
  console.log(`   storage                ${mb(ts.storageSize)} MB on disk / ${mb(ts.size)} MB logical for ${ts.count.toLocaleString()} ticks = ${bytesPerTick.toFixed(0)} B/tick on disk`);
  // BTCUSDT alone prints on the order of 10-40 trades/sec on Binance.
  const dailyGb = (bytesPerTick * 20 * 86400) / 1024 ** 3;
  console.log(`   => at 20 ticks/sec, ONE symbol costs ~${dailyGb.toFixed(2)} GB/day`);

  // ---- B. OHLCV bars ---------------------------------------------------
  console.log("\nB. OHLCV BARS (100,000 x 1m)");
  const N = 100_000;
  const bars = Array.from({ length: N }, (_, i) => ({
    ts: new Date(Date.UTC(2026, 0, 1) + i * 60_000),
    meta: { symbol: "BTCUSDT", venue: "binance", tf: "1m" },
    o: 79000 + (i % 500), h: 79100 + (i % 500), l: 78900 + (i % 500), c: 79050 + (i % 500), v: 12.5,
  }));

  await db.createCollection("bars_regular");
  t0 = process.hrtime.bigint();
  for (let i = 0; i < N; i += 5000) await db.collection("bars_regular").insertMany(bars.slice(i, i + 5000), { ordered: false });
  const regW = ms(process.hrtime.bigint() - t0);
  await db.collection("bars_regular").createIndex({ "meta.symbol": 1, ts: -1 });

  await db.createCollection("bars_ts", {
    timeseries: { timeField: "ts", metaField: "meta", granularity: "minutes" },
  });
  t0 = process.hrtime.bigint();
  for (let i = 0; i < N; i += 5000) await db.collection("bars_ts").insertMany(bars.slice(i, i + 5000), { ordered: false });
  const tsW = ms(process.hrtime.bigint() - t0);

  await client.db("admin").command({ fsync: 1 });
  const rs = await db.command({ collStats: "bars_regular" });
  const tss = await db.command({ collStats: "bars_ts" });
  const regTotal = rs.storageSize + (rs.totalIndexSize || 0);
  const tsTotal = tss.storageSize + (tss.totalIndexSize || 0);

  console.log(`   regular      write ${regW.toFixed(0)}ms   on-disk ${mb(rs.storageSize)} + idx ${mb(rs.totalIndexSize || 0)} = ${mb(regTotal)} MB  (logical ${mb(rs.size)} MB)`);
  console.log(`   time series  write ${tsW.toFixed(0)}ms   on-disk ${mb(tss.storageSize)} + idx ${mb(tss.totalIndexSize || 0)} = ${mb(tsTotal)} MB  (logical ${mb(tss.size)} MB)`);
  console.log(`   => time series is ${(regTotal / Math.max(tsTotal, 0.0001)).toFixed(1)}x smaller on disk`);

  const qr = [], qt = [];
  for (let i = 0; i < 30; i++) {
    let a = process.hrtime.bigint();
    await db.collection("bars_regular").find({ "meta.symbol": "BTCUSDT" }).sort({ ts: -1 }).limit(1000).toArray();
    qr.push(ms(process.hrtime.bigint() - a));
    a = process.hrtime.bigint();
    await db.collection("bars_ts").find({ "meta.symbol": "BTCUSDT" }).sort({ ts: -1 }).limit(1000).toArray();
    qt.push(ms(process.hrtime.bigint() - a));
  }
  const QR = quantiles(qr), QT = quantiles(qt);
  console.log(`   last 1000 bars: regular p50 ${QR.p50.toFixed(1)}ms p95 ${QR.p95.toFixed(1)}ms | timeseries p50 ${QT.p50.toFixed(1)}ms p95 ${QT.p95.toFixed(1)}ms`);

  // ---- C. derived balances --------------------------------------------
  console.log("\nC. DERIVED BALANCE (sum the ledger)");
  const ledger = db.collection("ledger");
  const accountId = new ObjectId();
  for (const size of [10_000, 50_000, 200_000]) {
    await ledger.deleteMany({});
    const rows = [];
    for (let i = 0; i < size; i++) {
      rows.push({
        accountId, bucket: ["cash", "margin", "pnl", "fees"][i % 4],
        direction: i % 2 ? "debit" : "credit",
        amount: { amount: Decimal128.fromString("12.34"), currency: "INR" },
        createdAt: new Date(),
      });
    }
    for (let i = 0; i < rows.length; i += 5000) await ledger.insertMany(rows.slice(i, i + 5000), { ordered: false });
    await ledger.createIndex({ accountId: 1, bucket: 1 });

    const times = [];
    for (let i = 0; i < 15; i++) {
      const a = process.hrtime.bigint();
      await ledger.aggregate([
        { $match: { accountId } },
        { $group: {
            _id: "$bucket",
            debit: { $sum: { $cond: [{ $eq: ["$direction", "debit"] }, "$amount.amount", 0] } },
            credit: { $sum: { $cond: [{ $eq: ["$direction", "credit"] }, "$amount.amount", 0] } },
        } },
      ]).toArray();
      times.push(ms(process.hrtime.bigint() - a));
    }
    const Q = quantiles(times);
    console.log(`   ${String(size).padStart(7)} entries   p50 ${Q.p50.toFixed(0)}ms  p95 ${Q.p95.toFixed(0)}ms`);
  }

  await db.dropDatabase();
  await client.close();
  process.exit(0);
})().catch((e) => { console.error("FAILED:", e.message); process.exit(1); });
