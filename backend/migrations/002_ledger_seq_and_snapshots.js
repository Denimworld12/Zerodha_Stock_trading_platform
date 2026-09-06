"use strict";

/**
 * Add the per-account ledger sequence and balance snapshots.
 *
 * Balances were derived by summing an account's entire ledger, which is linear
 * in history: measured at 30ms for 10k entries, 174ms for 50k and 681ms for
 * 200k. This backfills a total ordering (`seq`) onto existing entries so
 * snapshots have a watermark to hang off, then cuts a first snapshot per
 * account.
 *
 * Not transactional: index builds cannot run inside a transaction.
 */
module.exports.transactional = false;

module.exports.up = async ({ mongoose }) => {
  const { LedgerEntry, Account, BalanceSnapshot } = require("../models");

  await Account.syncIndexes();
  await LedgerEntry.syncIndexes();
  await BalanceSnapshot.syncIndexes();

  // Backfill seq in insertion order per account. _id is monotonic enough for a
  // one-off backfill of history that is no longer being written to.
  const accountIds = await LedgerEntry.distinct("accountId", { seq: { $exists: false } });
  for (const accountId of accountIds) {
    const cursor = LedgerEntry.find({ accountId, seq: { $exists: false } })
      .sort({ _id: 1 })
      .cursor();
    let n = 0;
    const ops = [];
    for await (const doc of cursor) {
      ops.push({ updateOne: { filter: { _id: doc._id }, update: { $set: { seq: ++n } } } });
      if (ops.length === 1000) {
        await LedgerEntry.bulkWrite(ops, { ordered: false });
        ops.length = 0;
      }
    }
    if (ops.length) await LedgerEntry.bulkWrite(ops, { ordered: false });
    await Account.updateOne({ _id: accountId }, { $set: { ledgerSeq: n } });
    console.log(`    backfilled ${n} entries for account ${accountId}`);
  }

  // First snapshot per (account, currency).
  const ledger = require("../lib/ledger");
  const pairs = await LedgerEntry.aggregate([
    { $group: { _id: { a: "$accountId", c: "$amount.currency" } } },
  ]);
  for (const p of pairs) {
    await ledger.rebuildSnapshot(p._id.a, p._id.c);
  }
  if (pairs.length) console.log(`    snapshotted ${pairs.length} account/currency pair(s)`);
};

module.exports.down = async ({ db }) => {
  await db.collection("balancesnapshots").drop().catch(() => {});
  await db.collection("ledgerentries").updateMany({}, { $unset: { seq: "" } });
  await db.collection("accounts").updateMany({}, { $unset: { ledgerSeq: "" } });
};
