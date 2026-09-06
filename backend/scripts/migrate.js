#!/usr/bin/env node
"use strict";
require("dotenv").config();
const mongoose = require("mongoose");
const migrate = require("../lib/migrate");

const url = process.env.MONGO_URL || "mongodb://localhost:27017/tradingmitra?replicaSet=rs0";
const cmd = process.argv[2] || "up";

(async () => {
  await mongoose.connect(url, { serverSelectionTimeoutMS: 10000 });
  if (cmd === "status") {
    for (const s of await migrate.status()) {
      const mark = s.drifted ? "!" : s.applied ? "✓" : " ";
      console.log(` ${mark} ${s.name}${s.applied ? "  " + s.appliedAt.toISOString() : "  (pending)"}${s.drifted ? "  MODIFIED AFTER RUNNING" : ""}`);
    }
  } else if (cmd === "down") {
    await migrate.down(Number(process.argv[3] || 1));
  } else {
    await migrate.up();
  }
})()
  .catch((e) => { console.error("✖", e.message); process.exitCode = 1; })
  .finally(() => mongoose.disconnect());
