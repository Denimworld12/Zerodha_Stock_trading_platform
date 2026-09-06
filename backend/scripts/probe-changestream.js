#!/usr/bin/env node
"use strict";

/**
 * Does MongoDB push changes, and how fast?
 *
 * This is the mechanism that decides whether the dashboard can stop polling.
 * Today the Signals panel refetches every 60 seconds and the Orders table only
 * updates on reload; with change streams the server learns about a fill the
 * moment it is written and can forward it to the browser.
 *
 * Change streams require a replica set, which is why docker-compose runs one.
 */
const { MongoClient } = require("mongodb");

const URL = process.env.MONGO_URL || "mongodb://localhost:27017/?replicaSet=rs0";
const N = 100;

(async () => {
  const client = new MongoClient(URL, { serverSelectionTimeoutMS: 8000 });
  await client.connect();
  const col = client.db("csprobe").collection("orders");
  await col.insertOne({ warmup: 1 });

  const latencies = [];
  const stream = col.watch();
  stream.on("change", (ev) => {
    if (ev.fullDocument && ev.fullDocument.t) {
      latencies.push(Number(process.hrtime.bigint() - BigInt(ev.fullDocument.t)) / 1e6);
    }
  });

  // No reliable "cursor ready" event exists on ChangeStream; give it a moment.
  await new Promise((r) => setTimeout(r, 1500));

  for (let i = 0; i < N; i++) {
    await col.insertOne({ i, t: String(process.hrtime.bigint()) });
    await new Promise((r) => setTimeout(r, 5));
  }
  await new Promise((r) => setTimeout(r, 2500)); // drain in-flight events

  const s = latencies.sort((a, b) => a - b);
  const q = (p) => (s.length ? s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))] : NaN);

  console.log(`  events received : ${s.length}/${N}`);
  if (s.length) {
    console.log(
      `  push latency    : p50 ${q(50).toFixed(1)}ms  p95 ${q(95).toFixed(1)}ms  ` +
        `p99 ${q(99).toFixed(1)}ms  max ${s[s.length - 1].toFixed(1)}ms`
    );
  }

  await stream.close();
  await client.db("csprobe").dropDatabase();
  await client.close();
  process.exit(0);
})().catch((e) => {
  console.error("FAILED:", e.message);
  process.exit(1);
});
