"use strict";

/**
 * The data model, designed once so it does not have to be redesigned.
 *
 * Five decisions here are the ones that are painful-to-impossible to change
 * after real data exists, which is why they are made now rather than in a later
 * phase:
 *
 * 1. OWN USER IDS, NOT THE IDENTITY PROVIDER'S.
 *    Auth0's `sub` lives in `users.identities[]`, never as a primary key and
 *    never as a foreign key on another collection. Moving to Clerk, Supabase or
 *    self-hosted auth later is then one array push and a backfill, instead of
 *    rewriting every document that referenced an auth0| string.
 *
 * 2. MONEY AS Decimal128, NEVER Number.
 *    See lib/money.js. Doubles drift; Decimal128 is exact and Mongo can still
 *    $sum and sort it.
 *
 * 3. AN IMMUTABLE LEDGER, WITH BALANCES DERIVED.
 *    The old code did `fund.availableCash += amount` — a destructive update with
 *    no history. If it is ever wrong you cannot tell when it went wrong or by
 *    how much. Here, money only ever moves by appending balanced double-entry
 *    rows; a balance is the sum of its entries. That makes every balance
 *    reconstructible and every discrepancy attributable to a specific entry.
 *
 * 4. TENANCY ON EVERY DOCUMENT, FROM THE FIRST ROW.
 *    `userId` and `accountId` are required and lead every compound index.
 *    Retrofitting tenancy means backfilling every document and auditing every
 *    query for leaks; doing it now costs nothing.
 *
 * 5. IDEMPOTENCY KEYS ON ANYTHING THAT MOVES MONEY.
 *    A retried request must not place a second order. The unique index does the
 *    enforcing, because application-level checks lose the race.
 */

const mongoose = require("mongoose");
const { Schema, Types } = mongoose;
const Decimal128Type = mongoose.Schema.Types.Decimal128;
const { moneySchemaDefinition, CURRENCIES } = require("../lib/money");

const money = () => ({ type: moneySchemaDefinition, required: true });

/** Schema version stamped on every document so migrations can find stragglers. */
const SCHEMA_VERSION = 1;
const versioned = { _v: { type: Number, default: SCHEMA_VERSION, index: true } };

// ---------------------------------------------------------------------------
// users
// ---------------------------------------------------------------------------
const IdentitySchema = new Schema(
  {
    // "auth0" today; "clerk" / "supabase" / "local" tomorrow without a migration
    provider: { type: String, required: true },
    // The provider's opaque id — for "local" this is our own user id as a
    // string; for Auth0 it will be the `sub`, e.g. "auth0|65f...".
    subject: { type: String, required: true },
    email: String,
    emailVerified: { type: Boolean, default: false },
    lastLoginAt: Date,
    // Only ever set on the "local" provider. When Auth0 is added it becomes a
    // second identity in this same array with no passwordHash, and nothing
    // else in the schema changes.
    passwordHash: { type: String, default: null, select: false },
    passwordUpdatedAt: Date,
  },
  { _id: false }
);

const UserSchema = new Schema(
  {
    email: { type: String, required: true, lowercase: true, trim: true },
    name: String,
    picture: String,
    identities: { type: [IdentitySchema], default: [] },
    roles: { type: [String], default: ["user"], enum: ["user", "admin"] },
    status: { type: String, enum: ["active", "suspended", "deleted"], default: "active", index: true },

    // Throttling state for password login. Stored on the user rather than in
    // memory so it survives a restart and applies across every instance —
    // an in-process counter is defeated by simply reconnecting.
    failedLoginCount: { type: Number, default: 0 },
    lockedUntil: { type: Date, default: null },
    lastLoginAt: Date,
    // Soft delete: financial records must survive account closure for audit.
    deletedAt: { type: Date, default: null },
    ...versioned,
  },
  { timestamps: true }
);

UserSchema.index({ email: 1 }, { unique: true, partialFilterExpression: { deletedAt: null } });
// The lookup every authenticated request performs.
UserSchema.index({ "identities.provider": 1, "identities.subject": 1 }, { unique: true, sparse: true });

// ---------------------------------------------------------------------------
// accounts — a user may hold several (paper, OANDA practice, live)
// ---------------------------------------------------------------------------
const AccountSchema = new Schema(
  {
    userId: { type: Types.ObjectId, ref: "user", required: true, index: true },
    name: { type: String, required: true },
    kind: { type: String, enum: ["paper", "demo", "live"], required: true, default: "paper" },
    venue: { type: String, enum: ["internal", "binance", "binance_testnet", "oanda_practice", "oanda_live", "mt5"], default: "internal" },
    baseCurrency: { type: String, required: true, enum: Object.keys(CURRENCIES), default: "INR" },

    // Risk limits enforced server-side. A client-side limit is a suggestion.
    limits: {
      riskPerTradePct: { type: Number, default: 0.75, min: 0, max: 100 },
      maxDailyLossPct: { type: Number, default: 3, min: 0, max: 100 },
      maxDrawdownPct: { type: Number, default: 20, min: 0, max: 100 },
      maxConcurrentPositions: { type: Number, default: 3, min: 0 },
      maxLeverage: { type: Number, default: 5, min: 0 },
    },
    // Monotonic per-account counter stamped on every ledger entry. It is what
    // makes a balance snapshot safe: "everything up to seq N is already summed"
    // is only a sound statement if N is a total order. Timestamps and ObjectIds
    // are not — two writers can interleave within the same millisecond.
    ledgerSeq: { type: Number, default: 0 },

    // Set when a kill switch fires; cleared only by an explicit human action.
    tradingHaltedAt: { type: Date, default: null },
    haltReason: String,

    status: { type: String, enum: ["active", "closed"], default: "active" },
    ...versioned,
  },
  { timestamps: true }
);

AccountSchema.index({ userId: 1, status: 1 });
AccountSchema.index({ userId: 1, name: 1 }, { unique: true });

// ---------------------------------------------------------------------------
// instruments — venue-specific trading rules
// ---------------------------------------------------------------------------
const InstrumentSchema = new Schema(
  {
    symbol: { type: String, required: true, uppercase: true, trim: true },
    venue: { type: String, required: true },
    assetClass: { type: String, enum: ["crypto", "fx", "equity", "index", "commodity"], required: true },
    baseCurrency: { type: String, required: true },
    quoteCurrency: { type: String, required: true },

    // Order rejection is cheaper than a rejected fill: validate against these.
    tickSize: { type: String, required: true },   // decimal string, exact
    lotStep: { type: String, required: true },
    minQty: { type: String, required: true },
    maxQty: { type: String, default: null },
    priceScale: { type: Number, default: 2 },
    qtyScale: { type: Number, default: 8 },

    active: { type: Boolean, default: true, index: true },
    ...versioned,
  },
  { timestamps: true }
);

InstrumentSchema.index({ venue: 1, symbol: 1 }, { unique: true });

// ---------------------------------------------------------------------------
// ledger — append-only double entry. Balances are DERIVED from this.
// ---------------------------------------------------------------------------
const LedgerEntrySchema = new Schema(
  {
    userId: { type: Types.ObjectId, ref: "user", required: true },
    accountId: { type: Types.ObjectId, ref: "account", required: true },

    // Every write shares a transactionId; the rows under one id must sum to
    // zero per currency. That invariant is what makes the ledger checkable.
    transactionId: { type: Types.ObjectId, required: true, index: true },

    // Position in this account's total ordering of postings.
    seq: { type: Number, required: true },

    bucket: {
      type: String,
      required: true,
      enum: ["cash", "margin", "position", "pnl", "fees", "external"],
    },
    direction: { type: String, required: true, enum: ["debit", "credit"] },
    amount: money(),

    reason: {
      type: String,
      required: true,
      enum: ["deposit", "withdrawal", "order_fill", "order_close", "fee", "funding", "adjustment", "realized_pnl"],
    },
    orderId: { type: Types.ObjectId, ref: "order", default: null },
    symbol: String,
    memo: String,

    // Correction happens by POSTING A REVERSAL, never by editing history.
    reversesEntryId: { type: Types.ObjectId, default: null },
    ...versioned,
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

// The index balance derivation rides: everything after the snapshot watermark.
LedgerEntrySchema.index({ accountId: 1, seq: 1 });
LedgerEntrySchema.index({ accountId: 1, bucket: 1, seq: 1 });
LedgerEntrySchema.index({ userId: 1, createdAt: -1 });
LedgerEntrySchema.index({ orderId: 1 });

// History is immutable. Blocking the mutating methods here means a careless
// `updateOne` in some future route cannot quietly rewrite the past.
function refuseMutation(next) {
  next(new Error("ledger entries are immutable; post a reversing entry instead"));
}
LedgerEntrySchema.pre("updateOne", refuseMutation);
LedgerEntrySchema.pre("updateMany", refuseMutation);
LedgerEntrySchema.pre("findOneAndUpdate", refuseMutation);
LedgerEntrySchema.pre("deleteOne", refuseMutation);
LedgerEntrySchema.pre("deleteMany", refuseMutation);

// ---------------------------------------------------------------------------
// orders
// ---------------------------------------------------------------------------
const OrderSchema = new Schema(
  {
    userId: { type: Types.ObjectId, ref: "user", required: true },
    accountId: { type: Types.ObjectId, ref: "account", required: true },

    // Supplied by the client; the unique index is what actually prevents a
    // double submit, because a find-then-insert check loses the race.
    idempotencyKey: { type: String, required: true },

    symbol: { type: String, required: true, uppercase: true },
    venue: { type: String, required: true, default: "internal" },
    side: { type: String, required: true, enum: ["buy", "sell"] },
    orderType: { type: String, required: true, enum: ["market", "limit"], default: "market" },
    quantity: { type: String, required: true },      // exact decimal string

    // Never trusted from the client — the server resolves the market price.
    requestedPrice: { type: String, default: null },
    filledPrice: { type: String, default: null },
    filledQuantity: { type: String, default: "0" },

    stopLoss: { type: String, default: null },
    takeProfit: { type: String, default: null },

    status: {
      type: String,
      required: true,
      enum: ["pending", "open", "partially_filled", "filled", "cancelled", "rejected", "closed"],
      default: "pending",
      index: true,
    },
    rejectReason: String,

    source: { type: String, enum: ["manual", "strategy", "webhook"], default: "manual" },
    strategyId: String,
    confidence: Number,
    reason: String,

    brokerOrderId: { type: String, default: null },
    filledAt: Date,
    closedAt: Date,
    ...versioned,
  },
  { timestamps: true }
);

OrderSchema.index({ accountId: 1, idempotencyKey: 1 }, { unique: true });
OrderSchema.index({ userId: 1, createdAt: -1 });
OrderSchema.index({ accountId: 1, status: 1, createdAt: -1 });
OrderSchema.index({ accountId: 1, symbol: 1, status: 1 });
OrderSchema.index({ brokerOrderId: 1 }, { sparse: true });

// ---------------------------------------------------------------------------
// positions
// ---------------------------------------------------------------------------
const PositionSchema = new Schema(
  {
    userId: { type: Types.ObjectId, ref: "user", required: true },
    accountId: { type: Types.ObjectId, ref: "account", required: true },
    symbol: { type: String, required: true, uppercase: true },
    venue: { type: String, required: true, default: "internal" },

    side: { type: String, required: true, enum: ["long", "short"] },
    quantity: { type: String, required: true },
    averagePrice: { type: String, required: true },
    realizedPnl: money(),

    stopLoss: { type: String, default: null },
    takeProfit: { type: String, default: null },

    status: { type: String, enum: ["open", "closed"], default: "open", index: true },
    openedAt: { type: Date, default: Date.now },
    closedAt: Date,

    // Optimistic concurrency: two concurrent fills against the same position
    // must not silently overwrite one another.
    version: { type: Number, default: 0 },
    ...versioned,
  },
  { timestamps: true }
);

// One OPEN position per symbol per account; closed ones accumulate as history.
PositionSchema.index(
  { accountId: 1, symbol: 1 },
  { unique: true, partialFilterExpression: { status: "open" } }
);
PositionSchema.index({ userId: 1, status: 1, updatedAt: -1 });

// ---------------------------------------------------------------------------
// refresh tokens — hashed, rotating, revocable
//
// Stored as SHA-256 hashes so a database dump does not hand over live sessions.
// `familyId` links every token descended from one login, so detecting a replay
// lets us revoke the whole chain rather than just the one token.
// ---------------------------------------------------------------------------
const RefreshTokenSchema = new Schema(
  {
    userId: { type: Types.ObjectId, ref: "user", required: true, index: true },
    tokenHash: { type: String, required: true, unique: true },
    familyId: { type: String, required: true, index: true },
    expiresAt: { type: Date, required: true },
    usedAt: { type: Date, default: null },
    revokedAt: { type: Date, default: null },
    revokedReason: String,
    userAgent: String,
    ip: String,
  },
  { timestamps: true }
);

// Mongo removes expired tokens on its own; a session table that only grows is
// a slow leak nobody remembers to clean up.
RefreshTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
RefreshTokenSchema.index({ userId: 1, revokedAt: 1 });

// ---------------------------------------------------------------------------
// balance snapshots — a materialised checkpoint so balances stay O(recent)
//
// Summing the whole ledger on every dashboard refresh is linear in account
// history. Measured: 30ms at 10k entries, 174ms at 50k, 681ms at 200k. An
// active account crosses 200k in months, and a 681ms balance is a broken UI.
//
// A snapshot records every bucket balance as of sequence N. Reading a balance
// then means: snapshot + sum(entries where seq > N), which is bounded by the
// snapshot interval rather than by total history. The snapshot is derived data
// and can always be rebuilt from the entries, so it can never be the source of
// a discrepancy - only of a stale read, which the watermark makes impossible.
// ---------------------------------------------------------------------------
const BalanceSnapshotSchema = new Schema(
  {
    accountId: { type: Types.ObjectId, ref: "account", required: true },
    currency: { type: String, required: true },
    throughSeq: { type: Number, required: true },
    balances: { type: Map, of: Decimal128Type, required: true },
    entryCount: { type: Number, default: 0 },
  },
  { timestamps: true }
);

BalanceSnapshotSchema.index({ accountId: 1, currency: 1, throughSeq: -1 });

// ---------------------------------------------------------------------------
// idempotency — a durable record of completed mutating requests
// ---------------------------------------------------------------------------
const IdempotencyRecordSchema = new Schema(
  {
    key: { type: String, required: true },
    userId: { type: Types.ObjectId, required: true },
    endpoint: { type: String, required: true },
    requestHash: { type: String, required: true },
    responseStatus: Number,
    responseBody: Schema.Types.Mixed,
    // Keys expire so the collection cannot grow without bound.
    expiresAt: { type: Date, required: true },
  },
  { timestamps: true }
);

IdempotencyRecordSchema.index({ userId: 1, key: 1, endpoint: 1 }, { unique: true });
IdempotencyRecordSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

// ---------------------------------------------------------------------------
const models = {
  User: mongoose.model("user", UserSchema),
  Account: mongoose.model("account", AccountSchema),
  Instrument: mongoose.model("instrument", InstrumentSchema),
  LedgerEntry: mongoose.model("ledgerEntry", LedgerEntrySchema),
  BalanceSnapshot: mongoose.model("balanceSnapshot", BalanceSnapshotSchema),
  RefreshToken: mongoose.model("refreshToken", RefreshTokenSchema),
  Order2: mongoose.model("order2", OrderSchema),
  Position2: mongoose.model("position2", PositionSchema),
  IdempotencyRecord: mongoose.model("idempotencyRecord", IdempotencyRecordSchema),
};

module.exports = { ...models, SCHEMA_VERSION };
