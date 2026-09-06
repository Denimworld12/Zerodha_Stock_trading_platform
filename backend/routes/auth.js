"use strict";

/**
 * Authentication routes.
 *
 * Mounted at /api/auth. These serve the local email+password provider; if Auth0
 * is enabled later its tokens are accepted by `requireAuth` alongside these
 * without any change here.
 *
 * Rate limits are per-route rather than global because the routes have very
 * different risk. Login is the brute-force target; refresh is called routinely
 * by every open tab and must not be throttled into breaking the app.
 */

const express = require("express");
const rateLimit = require("express-rate-limit");
const { z } = require("zod");

const localauth = require("../lib/localauth");
const tokens = require("../lib/tokens");
const { requireAuth, describeConfig } = require("../lib/auth");
const { RefreshToken } = require("../models");

const router = express.Router();

/**
 * Refresh tokens travel in an httpOnly cookie, not in the response body.
 *
 * A token in localStorage is readable by any script on the page, so a single
 * XSS bug hands over a 30-day session. httpOnly puts it out of JavaScript's
 * reach entirely. SameSite=Strict then stops another site from causing the
 * browser to send it.
 *
 * The body copy is kept for non-browser clients (the e2e suite, scripts, a
 * future mobile app) which have no cookie jar and are not XSS targets.
 */
const REFRESH_COOKIE = "rt";
const isProd = process.env.NODE_ENV === "production";

function setRefreshCookie(res, token) {
  res.cookie(REFRESH_COOKIE, token, {
    httpOnly: true,
    secure: isProd,          // localhost is http, so only force TLS in production
    sameSite: "strict",
    path: "/api/auth",       // never sent to any other route
    maxAge: tokens.REFRESH_TTL_SECONDS * 1000,
  });
}

function clearRefreshCookie(res) {
  res.clearCookie(REFRESH_COOKIE, { httpOnly: true, secure: isProd, sameSite: "strict", path: "/api/auth" });
}

/** Cookie first; body is the fallback for clients without one. */
function readRefreshToken(req) {
  return req.cookies?.[REFRESH_COOKIE] || req.body?.refreshToken || null;
}

/**
 * Keyed on IP + email so one attacker cannot lock out every user from a shared
 * NAT, and cannot spread an attack on one account across many IPs unnoticed.
 */
const loginLimiter = rateLimit({
  windowMs: 15 * 60_000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => `${req.ip}:${String(req.body?.email || "").toLowerCase()}`,
  message: { error: "too many attempts; wait a few minutes", code: "RATE_LIMITED" },
});

const registerLimiter = rateLimit({
  windowMs: 60 * 60_000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "too many accounts created from this address", code: "RATE_LIMITED" },
});

const refreshLimiter = rateLimit({ windowMs: 60_000, max: 60, standardHeaders: true, legacyHeaders: false });

const credentials = z.object({
  email: z.string().min(3).max(254),
  password: z.string().min(1).max(200),
  name: z.string().max(100).optional(),
});

function handle(res, err) {
  if (err instanceof localauth.AuthError || err.code) {
    return res.status(err.status || 400).json({
      error: err.message,
      code: err.code || "ERROR",
      ...(err.details || {}),
    });
  }
  console.error("auth error:", err);
  return res.status(500).json({ error: "internal error", code: "INTERNAL" });
}

const route = (fn) => (req, res) => Promise.resolve(fn(req, res)).catch((e) => handle(res, e));

const publicUser = (u) => ({
  id: u._id,
  email: u.email,
  name: u.name,
  roles: u.roles,
  providers: u.identities.map((i) => i.provider),
});

const context = (req) => ({ userAgent: req.get("user-agent"), ip: req.ip });

// ---------------------------------------------------------------------------
router.get("/config", (_req, res) => {
  // Lets the frontend render the right login UI without hardcoding which
  // providers are on.
  res.json(describeConfig());
});

router.post("/register", registerLimiter, route(async (req, res) => {
  const parsed = credentials.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: "email and password are required", code: "VALIDATION",
      issues: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
    });
  }
  const { user, session } = await localauth.register({ ...parsed.data, ...context(req) });
  setRefreshCookie(res, session.refreshToken);
  res.status(201).json({ user: publicUser(user), ...session });
}));

router.post("/login", loginLimiter, route(async (req, res) => {
  const parsed = credentials.safeParse(req.body);
  if (!parsed.success) {
    // Deliberately the same message the wrong-password path returns, so a
    // malformed request cannot be used to probe for valid emails either.
    return res.status(401).json({ error: "email or password is incorrect", code: "INVALID_CREDENTIALS" });
  }
  const { user, session } = await localauth.login({ ...parsed.data, ...context(req) });
  setRefreshCookie(res, session.refreshToken);
  res.json({ user: publicUser(user), ...session });
}));

router.post("/refresh", refreshLimiter, route(async (req, res) => {
  const raw = readRefreshToken(req);
  if (!raw) return res.status(400).json({ error: "refreshToken is required", code: "NO_REFRESH_TOKEN" });

  const result = await tokens.rotateRefreshToken(raw, context(req));
  setRefreshCookie(res, result.refreshToken);
  res.json({
    user: publicUser(result.user),
    accessToken: result.accessToken,
    refreshToken: result.refreshToken,
    expiresIn: result.expiresIn,
    tokenType: "Bearer",
  });
}));

router.post("/logout", route(async (req, res) => {
  const raw = readRefreshToken(req);
  if (raw) await tokens.revokeRefreshToken(raw, "logout");
  clearRefreshCookie(res);
  // Always 200: a logout that fails because the token was already invalid has
  // still achieved what the caller wanted.
  res.json({ ok: true });
}));

router.post("/logout-all", requireAuth(), route(async (req, res) => {
  const revoked = await tokens.revokeAllForUser(req.user._id, "logout_all");
  clearRefreshCookie(res);
  res.json({ ok: true, revokedSessions: revoked });
}));

router.get("/me", requireAuth(), route(async (req, res) => {
  res.json({ user: publicUser(req.user), provider: req.authProvider || "dev" });
}));

router.post("/change-password", requireAuth(), loginLimiter, route(async (req, res) => {
  const schema = z.object({
    currentPassword: z.string().min(1).max(200),
    newPassword: z.string().min(1).max(200),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "currentPassword and newPassword are required", code: "VALIDATION" });
  }
  const result = await localauth.changePassword({ userId: req.user._id, ...parsed.data });
  res.json({ ok: true, ...result, note: "all other sessions were signed out" });
}));

/** Active sessions, so a user can see and revoke their own logins. */
router.get("/sessions", requireAuth(), route(async (req, res) => {
  const rows = await RefreshToken.find({
    userId: req.user._id, revokedAt: null, expiresAt: { $gt: new Date() },
  }).sort({ createdAt: -1 }).limit(50).lean();

  res.json(rows.map((r) => ({
    id: r._id, createdAt: r.createdAt, expiresAt: r.expiresAt,
    userAgent: r.userAgent, ip: r.ip, used: Boolean(r.usedAt),
  })));
}));

module.exports = router;
