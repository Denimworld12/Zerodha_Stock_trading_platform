"use strict";

/**
 * The v2 API.
 *
 * Every route is authenticated and scoped to an account the caller owns —
 * ownership is proven once in `resolveAccount` rather than re-remembered in
 * each handler, because "every route filtered by userId" is not a property
 * anyone can maintain by discipline. A missed filter is a cross-tenant leak.
 *
 * The old routes stay mounted at their original paths so the existing dashboard
 * keeps working while it is ported. New work targets /api/v2.
 */

const express = require("express");
const rateLimit = require("express-rate-limit");
const { z } = require("zod");

const { requireAuth, resolveAccount, describeConfig } = require("../lib/auth");
const orders = require("../lib/orders");
const ledger = require("../lib/ledger");
const prices = require("../lib/prices");
const { Order2, Position2, Instrument, Account, LedgerEntry } = require("../models");

const router = express.Router();

/** Writes are rate limited far harder than reads — they cost money. */
const writeLimiter = rateLimit({
  windowMs: 60_000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "too many orders; slow down" },
});
const readLimiter = rateLimit({ windowMs: 60_000, max: 300, standardHeaders: true, legacyHeaders: false });

/** Turn a thrown OrderError into an honest HTTP response. */
function handle(res, err) {
  if (err instanceof orders.OrderError || err.code) {
    const status = err.status || 400;
    return res.status(status).json({
      error: err.message,
      code: err.code || "ERROR",
      ...(err.details || {}),
    });
  }
  console.error("v2 unexpected:", err);
  // Never leak internals; they help an attacker map the system.
  return res.status(500).json({ error: "internal error", code: "INTERNAL" });
}

const asyncRoute = (fn) => (req, res) => Promise.resolve(fn(req, res)).catch((e) => handle(res, e));

// ---------------------------------------------------------------------------
const placeSchema = z.object({
  symbol: z.string().min(1).max(24),
  side: z.enum(["buy", "sell"]),
  quantity: z.union([z.string(), z.number()]).transform(String),
  orderType: z.enum(["market", "limit"]).default("market"),
  limitPrice: z.union([z.string(), z.number()]).nullish().transform((v) => (v == null ? null : String(v))),
  stopLoss: z.union([z.string(), z.number()]).nullish().transform((v) => (v == null ? null : String(v))),
  takeProfit: z.union([z.string(), z.number()]).nullish().transform((v) => (v == null ? null : String(v))),
  accountId: z.string().optional(),
  // NOTE: there is deliberately no `price` field. The server prices the order.
});

const closeSchema = z.object({
  symbol: z.string().min(1).max(24),
  quantity: z.union([z.string(), z.number()]).nullish().transform((v) => (v == null ? null : String(v))),
  accountId: z.string().optional(),
});

router.use(requireAuth());

// ---------------------------------------------------------------------------
// account
// ---------------------------------------------------------------------------
router.get("/me", readLimiter, asyncRoute(async (req, res) => {
  const accounts = await Account.find({ userId: req.user._id, status: "active" }).lean();
  res.json({
    user: {
      id: req.user._id, email: req.user.email, name: req.user.name,
      roles: req.user.roles,
      // Which providers this identity is linked to — useful when we add a
      // second one, and proof that we are not keying off the provider's id.
      identities: req.user.identities.map((i) => ({ provider: i.provider })),
    },
    accounts: accounts.map((a) => ({
      id: a._id, name: a.name, kind: a.kind, venue: a.venue,
      baseCurrency: a.baseCurrency, limits: a.limits,
      halted: Boolean(a.tradingHaltedAt), haltReason: a.haltReason,
    })),
    auth: describeConfig(),
  });
}));

router.get("/summary", readLimiter, resolveAccount, asyncRoute(async (req, res) => {
  res.json(await orders.accountSummary(req.account));
}));

router.get("/balances", readLimiter, resolveAccount, asyncRoute(async (req, res) => {
  const b = await ledger.balances(req.account._id, req.account.baseCurrency);
  res.json({
    currency: req.account.baseCurrency,
    balances: Object.fromEntries(Object.entries(b).map(([k, v]) => [k, v.toString()])),
  });
}));

/** Proof the books balance. Cheap to run, and the only real safety net. */
router.get("/audit", readLimiter, resolveAccount, asyncRoute(async (req, res) => {
  res.json(await ledger.audit(req.account._id));
}));

router.get("/ledger", readLimiter, resolveAccount, asyncRoute(async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 100, 500);
  const rows = await LedgerEntry.find({ accountId: req.account._id })
    .sort({ seq: -1 }).limit(limit).lean();
  res.json(rows.map((r) => ({
    seq: r.seq, at: r.createdAt, bucket: r.bucket, direction: r.direction,
    amount: r.amount.amount.toString(), currency: r.amount.currency,
    reason: r.reason, symbol: r.symbol, transactionId: r.transactionId,
  })));
}));

/** Top up a paper account. Refused on demo/live — those are funded at the broker. */
router.post("/deposit", writeLimiter, resolveAccount, asyncRoute(async (req, res) => {
  const schema = z.object({
    amount: z.union([z.string(), z.number()]).transform(String),
    accountId: z.string().optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "amount is required", code: "VALIDATION" });

  const accounts = require("../lib/accounts");
  const balances = await accounts.deposit({
    account: req.account, userId: req.user._id, amount: parsed.data.amount,
  });
  res.json({
    currency: req.account.baseCurrency,
    balances: Object.fromEntries(Object.entries(balances).map(([k, v]) => [k, v.toString()])),
  });
}));

/** Reset a paper account to its opening balance, by corrective posting. */
router.post("/reset", writeLimiter, resolveAccount, asyncRoute(async (req, res) => {
  const accounts = require("../lib/accounts");
  const balances = await accounts.resetPaperAccount({
    account: req.account, userId: req.user._id,
  });
  res.json({
    reset: true,
    balances: Object.fromEntries(Object.entries(balances).map(([k, v]) => [k, v.toString()])),
  });
}));

// ---------------------------------------------------------------------------
// trading
// ---------------------------------------------------------------------------
router.post("/orders", writeLimiter, resolveAccount, asyncRoute(async (req, res) => {
  const parsed = placeSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: "invalid request",
      code: "VALIDATION",
      issues: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
    });
  }

  // The header is the idempotency key. Requiring the CLIENT to supply it is the
  // point: only the client knows that two requests are the same intent.
  const idempotencyKey = req.get("idempotency-key");
  if (!idempotencyKey) {
    return res.status(400).json({
      error: "an Idempotency-Key header is required so a retry cannot place a second order",
      code: "MISSING_IDEMPOTENCY_KEY",
    });
  }

  const result = await orders.placeOrder({
    user: req.user, account: req.account, idempotencyKey,
    source: "manual", ...parsed.data,
  });

  res.status(result.replayed ? 200 : 201).json({
    id: result.order._id,
    replayed: Boolean(result.replayed),
    symbol: result.order.symbol,
    side: result.order.side,
    quantity: result.order.quantity,
    filledPrice: result.order.filledPrice,
    status: result.order.status,
    notional: result.notional,
    fee: result.fee,
    pnl: result.pnl,
    closed: result.closed,
  });
}));

router.post("/positions/close", writeLimiter, resolveAccount, asyncRoute(async (req, res) => {
  const parsed = closeSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "invalid request", code: "VALIDATION" });
  }
  const result = await orders.closePosition({
    user: req.user, account: req.account,
    idempotencyKey: req.get("idempotency-key"),
    ...parsed.data,
  });
  res.json({
    id: result.order._id, closed: result.closed,
    price: result.price, pnl: result.pnl, fee: result.fee, remaining: result.remaining,
  });
}));

router.get("/orders", readLimiter, resolveAccount, asyncRoute(async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 50, 200);
  const q = { accountId: req.account._id };
  if (req.query.symbol) q.symbol = String(req.query.symbol).toUpperCase();
  if (req.query.status) q.status = String(req.query.status);
  res.json(await Order2.find(q).sort({ createdAt: -1 }).limit(limit).lean());
}));

router.get("/positions", readLimiter, resolveAccount, asyncRoute(async (req, res) => {
  const q = { accountId: req.account._id };
  if (req.query.status) q.status = String(req.query.status);
  else q.status = "open";
  res.json(await Position2.find(q).sort({ updatedAt: -1 }).lean());
}));

// ---------------------------------------------------------------------------
// journal and analytics — the part that is useful with or without an edge
// ---------------------------------------------------------------------------
router.get("/journal/trades", readLimiter, resolveAccount, asyncRoute(async (req, res) => {
  const journal = require("../lib/journal");
  res.json(await journal.trades(req.account._id, {
    limit: Math.min(Number(req.query.limit) || 200, 500),
    symbol: req.query.symbol,
  }));
}));

router.get("/journal/performance", readLimiter, resolveAccount, asyncRoute(async (req, res) => {
  const journal = require("../lib/journal");
  const days = req.query.days ? Number(req.query.days) : null;
  res.json(await journal.performance(req.account._id, req.account.baseCurrency, { days }));
}));

router.get("/journal/breakdown", readLimiter, resolveAccount, asyncRoute(async (req, res) => {
  const journal = require("../lib/journal");
  res.json(await journal.breakdown(req.account._id));
}));

// ---------------------------------------------------------------------------
// autonomous runner
//
// Gated behind the same three locks as live execution, and additionally
// refuses any account that is not paper. Nothing in the tournament cleared its
// gate, so this should stay in dry-run until something does.
// ---------------------------------------------------------------------------
router.get("/runner", readLimiter, asyncRoute(async (_req, res) => {
  const { getRunner } = require("../lib/runner");
  const r = getRunner();
  res.json(r ? r.status() : { running: false, configured: false });
}));

router.post("/runner", writeLimiter, resolveAccount, asyncRoute(async (req, res) => {
  if (!process.env.QSMC_EXECUTION_ENABLED || process.env.QSMC_EXECUTION_ENABLED !== "true") {
    return res.status(403).json({
      error: "set QSMC_EXECUTION_ENABLED=true to arm the runner",
      code: "EXECUTION_DISABLED",
    });
  }
  const { getRunner, clearRunner } = require("../lib/runner");
  const schema = z.object({
    action: z.enum(["start", "stop"]),
    symbols: z.array(z.string()).optional(),
    interval: z.string().optional(),
    minConfidence: z.number().min(0).max(1).optional(),
    // Defaults to a dry run: arming a live loop must be a deliberate act.
    dryRun: z.boolean().default(true),
    accountId: z.string().optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid request", code: "VALIDATION" });

  if (parsed.data.action === "stop") {
    clearRunner();
    return res.json({ running: false, stopped: true });
  }

  clearRunner();
  const r = getRunner({
    accountId: req.account._id,
    userId: req.user._id,
    symbols: parsed.data.symbols || ["BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT"],
    interval: parsed.data.interval || "15m",
    minConfidence: parsed.data.minConfidence ?? 0.58,
    dryRun: parsed.data.dryRun,
  }).start();
  res.json(r.status());
}));

// ---------------------------------------------------------------------------
// market data
// ---------------------------------------------------------------------------
router.get("/instruments", readLimiter, asyncRoute(async (req, res) => {
  const q = { active: true };
  if (req.query.venue) q.venue = String(req.query.venue);
  res.json(await Instrument.find(q).sort({ venue: 1, symbol: 1 }).lean());
}));

/**
 * Snapshot prices from the SERVER's feed.
 *
 * The dashboard used to fetch these from Finnhub directly, which put the API
 * key in the browser bundle and left the server with no idea what anything was
 * worth. Now the key never leaves the server.
 */
router.get("/prices", readLimiter, asyncRoute(async (req, res) => {
  const feed = prices.getFeed();
  if (req.query.symbols) {
    const wanted = String(req.query.symbols).split(",").map((s) => s.trim().toUpperCase());
    const out = {};
    for (const s of wanted) {
      const q = await feed.getPrice(s, { maxAgeMs: 10_000 });
      if (q) out[s] = { price: q.price, ageMs: q.ageMs, stale: q.stale, source: q.source };
    }
    return res.json(out);
  }
  res.json(feed.snapshot());
}));

router.get("/feed/health", readLimiter, asyncRoute(async (_req, res) => {
  res.json(prices.getFeed().health());
}));

module.exports = router;
