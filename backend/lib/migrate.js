"use strict";

/**
 * Migration runner.
 *
 * Schema change without migrations means someone SSHing into production and
 * running a script from memory. This makes every change ordered, recorded, and
 * repeatable across every environment.
 *
 * Design notes:
 * - A distributed LOCK, so two app instances booting at once cannot run the
 *   same migration twice.
 * - Each migration records a checksum of its own source. If a file that has
 *   already run is later edited, the runner refuses to continue rather than
 *   leaving environments silently divergent.
 * - Migrations run inside a transaction where the operations allow it. Index
 *   builds cannot run in a transaction, so those declare `transactional: false`.
 */

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const mongoose = require("mongoose");

const DIR = path.join(__dirname, "..", "migrations");
const LOCK_ID = "migration-lock";
const LOCK_TTL_MS = 5 * 60 * 1000;

function collection(name) {
  return mongoose.connection.db.collection(name);
}

function loadMigrations() {
  if (!fs.existsSync(DIR)) return [];
  return fs
    .readdirSync(DIR)
    .filter((f) => /^\d+.*\.js$/.test(f))
    .sort()
    .map((file) => {
      const full = path.join(DIR, file);
      const mod = require(full);
      const checksum = crypto
        .createHash("sha256")
        .update(fs.readFileSync(full))
        .digest("hex")
        .slice(0, 16);
      if (typeof mod.up !== "function") {
        throw new Error(`${file} does not export an up() function`);
      }
      return {
        name: file.replace(/\.js$/, ""),
        checksum,
        transactional: mod.transactional !== false,
        up: mod.up,
        down: mod.down,
      };
    });
}

async function acquireLock() {
  const now = Date.now();
  const locks = collection("_migration_locks");
  // Steal a lock whose holder died mid-run, rather than deadlocking forever.
  await locks.deleteOne({ _id: LOCK_ID, expiresAt: { $lt: new Date(now) } });
  try {
    await locks.insertOne({
      _id: LOCK_ID,
      acquiredAt: new Date(now),
      expiresAt: new Date(now + LOCK_TTL_MS),
      host: process.env.HOSTNAME || "local",
      pid: process.pid,
    });
    return true;
  } catch (err) {
    if (err.code === 11000) return false;
    throw err;
  }
}

async function releaseLock() {
  await collection("_migration_locks").deleteOne({ _id: LOCK_ID });
}

async function applied() {
  return collection("_migrations").find({}).sort({ name: 1 }).toArray();
}

async function status() {
  const done = new Map((await applied()).map((d) => [d.name, d]));
  return loadMigrations().map((m) => {
    const rec = done.get(m.name);
    return {
      name: m.name,
      applied: Boolean(rec),
      appliedAt: rec?.appliedAt ?? null,
      drifted: Boolean(rec && rec.checksum !== m.checksum),
    };
  });
}

async function up({ quiet = false } = {}) {
  const log = quiet ? () => {} : (...a) => console.log(...a);

  if (!(await acquireLock())) {
    log("• another process holds the migration lock; skipping");
    return { ran: [], skipped: true };
  }

  const ran = [];
  try {
    const done = new Map((await applied()).map((d) => [d.name, d]));

    // Refuse to proceed if an already-applied file has changed on disk.
    for (const m of loadMigrations()) {
      const rec = done.get(m.name);
      if (rec && rec.checksum !== m.checksum) {
        throw new Error(
          `migration ${m.name} was modified after it ran ` +
            `(recorded ${rec.checksum}, file ${m.checksum}). ` +
            `Add a NEW migration instead of editing history.`
        );
      }
    }

    for (const m of loadMigrations()) {
      if (done.has(m.name)) continue;
      const started = Date.now();
      log(`→ ${m.name}`);

      if (m.transactional) {
        const session = await mongoose.startSession();
        try {
          await session.withTransaction(async () => {
            await m.up({ db: mongoose.connection.db, mongoose, session });
            await collection("_migrations").insertOne(
              { name: m.name, checksum: m.checksum, appliedAt: new Date(), ms: Date.now() - started },
              { session }
            );
          });
        } finally {
          await session.endSession();
        }
      } else {
        await m.up({ db: mongoose.connection.db, mongoose, session: null });
        await collection("_migrations").insertOne({
          name: m.name, checksum: m.checksum, appliedAt: new Date(), ms: Date.now() - started,
        });
      }

      log(`  ✓ ${m.name} (${Date.now() - started}ms)`);
      ran.push(m.name);
    }

    if (!ran.length) log("• database is up to date");
    return { ran, skipped: false };
  } finally {
    await releaseLock();
  }
}

async function down(steps = 1) {
  if (!(await acquireLock())) throw new Error("migration lock is held");
  try {
    const done = (await applied()).reverse().slice(0, steps);
    const byName = new Map(loadMigrations().map((m) => [m.name, m]));
    for (const rec of done) {
      const m = byName.get(rec.name);
      if (!m?.down) throw new Error(`${rec.name} has no down(); cannot roll back`);
      console.log(`← ${rec.name}`);
      await m.down({ db: mongoose.connection.db, mongoose, session: null });
      await collection("_migrations").deleteOne({ name: rec.name });
    }
  } finally {
    await releaseLock();
  }
}

module.exports = { up, down, status, loadMigrations };
