"use strict";

/**
 * Token issuance and verification for local (non-Auth0) sessions.
 *
 * Two token types, because they answer different questions:
 *
 *   ACCESS   short-lived (15 min), signed, stateless. Checked on every request
 *            without touching the database. If it leaks, it expires quickly.
 *   REFRESH  long-lived (30 days), opaque, stored HASHED in the database and
 *            ROTATED on every use. Revocable, because "log out everywhere"
 *            has to actually mean something.
 *
 * Refresh tokens are stored as SHA-256 hashes rather than plaintext for the
 * same reason passwords are: a database dump should not hand over live
 * sessions. They are not run through scrypt because they are already 256 bits
 * of entropy — there is no dictionary to attack, so the slow hash would only
 * cost us latency.
 *
 * REUSE DETECTION
 * ---------------
 * A rotated token that shows up a second time means either a replay or a
 * stolen token racing the real user. Either way the whole family is revoked,
 * which turns a silent compromise into a visible logout.
 */

const crypto = require("node:crypto");
const { SignJWT, jwtVerify } = require("jose");
const { RefreshToken } = require("../models");

const ACCESS_TTL_SECONDS = Number(process.env.ACCESS_TOKEN_TTL || 900);          // 15 min
const REFRESH_TTL_SECONDS = Number(process.env.REFRESH_TOKEN_TTL || 2592000);   // 30 days
const ISSUER = process.env.TOKEN_ISSUER || "tradingmitra";
const AUDIENCE = process.env.TOKEN_AUDIENCE || "tradingmitra-api";

/**
 * The signing secret.
 *
 * In production a missing secret is fatal. Falling back to a generated one
 * would "work" until the second instance started and rejected the first
 * instance's tokens, producing random logouts nobody can reproduce.
 */
function secret() {
  const raw = process.env.JWT_SECRET;
  if (!raw || raw.length < 32) {
    if (process.env.NODE_ENV === "production") {
      throw new Error(
        "JWT_SECRET must be set to at least 32 characters in production. " +
          "Generate one with: openssl rand -base64 48"
      );
    }
    // Development only, and stable across restarts of this process so a token
    // issued a minute ago still works after a nodemon reload.
    if (!secret._dev) {
      secret._dev = crypto.createHash("sha256").update("dev-only-insecure-secret").digest();
      console.warn(
        "  ⚠  JWT_SECRET is not set — using a fixed development key.\n" +
        "     Tokens signed with it are trivially forgeable. Set JWT_SECRET before deploying."
      );
    }
    return secret._dev;
  }
  return crypto.createHash("sha256").update(raw).digest();
}

// ---------------------------------------------------------------------------
// access tokens
// ---------------------------------------------------------------------------
async function issueAccessToken(user) {
  // Every claim must be a PLAIN value. jose structuredClone()s the payload, and
  // a Mongoose document array is not cloneable — it throws DataCloneError at
  // sign time, which surfaces as "login is broken" rather than as a type error.
  return new SignJWT({
    email: String(user.email),
    name: user.name ? String(user.name) : undefined,
    roles: Array.from(user.roles || []).map(String),
    provider: "local",
  })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setSubject(String(user._id))
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(`${ACCESS_TTL_SECONDS}s`)
    .sign(secret());
}

async function verifyAccessToken(token) {
  const { payload } = await jwtVerify(token, secret(), {
    issuer: ISSUER,
    audience: AUDIENCE,
    algorithms: ["HS256"],   // pinned: never let the token choose its own algorithm
    clockTolerance: "5s",
  });
  return payload;
}

// ---------------------------------------------------------------------------
// refresh tokens
// ---------------------------------------------------------------------------
function hashToken(raw) {
  return crypto.createHash("sha256").update(raw).digest("hex");
}

async function issueRefreshToken(user, { familyId = null, userAgent, ip } = {}) {
  const raw = crypto.randomBytes(48).toString("base64url");
  const family = familyId || crypto.randomBytes(16).toString("hex");

  await RefreshToken.create({
    userId: user._id,
    tokenHash: hashToken(raw),
    familyId: family,
    expiresAt: new Date(Date.now() + REFRESH_TTL_SECONDS * 1000),
    userAgent: userAgent ? String(userAgent).slice(0, 200) : undefined,
    ip,
  });

  return { token: raw, familyId: family, expiresIn: REFRESH_TTL_SECONDS };
}

/**
 * Exchange a refresh token for a new pair.
 *
 * The old token is consumed. Presenting an already-consumed token revokes the
 * entire family — see REUSE DETECTION above.
 */
async function rotateRefreshToken(rawToken, { userAgent, ip } = {}) {
  const tokenHash = hashToken(rawToken);
  const record = await RefreshToken.findOne({ tokenHash });

  if (!record) {
    const err = new Error("invalid refresh token");
    err.code = "INVALID_REFRESH_TOKEN";
    err.status = 401;
    throw err;
  }

  if (record.usedAt || record.revokedAt) {
    // This token was already spent. Someone is replaying it, so kill every
    // session descended from the same original login.
    await RefreshToken.updateMany(
      { familyId: record.familyId, revokedAt: null },
      { $set: { revokedAt: new Date(), revokedReason: "reuse_detected" } }
    );
    const err = new Error("refresh token was already used; all sessions revoked");
    err.code = "REFRESH_TOKEN_REUSED";
    err.status = 401;
    throw err;
  }

  if (record.expiresAt < new Date()) {
    const err = new Error("refresh token expired");
    err.code = "REFRESH_TOKEN_EXPIRED";
    err.status = 401;
    throw err;
  }

  const { User } = require("../models");
  const user = await User.findById(record.userId);
  if (!user || user.status !== "active" || user.deletedAt) {
    const err = new Error("account is not active");
    err.code = "ACCOUNT_INACTIVE";
    err.status = 403;
    throw err;
  }

  record.usedAt = new Date();
  await record.save();

  const [accessToken, refresh] = await Promise.all([
    issueAccessToken(user),
    issueRefreshToken(user, { familyId: record.familyId, userAgent, ip }),
  ]);

  return { user, accessToken, refreshToken: refresh.token, expiresIn: ACCESS_TTL_SECONDS };
}

async function revokeRefreshToken(rawToken, reason = "logout") {
  const res = await RefreshToken.updateOne(
    { tokenHash: hashToken(rawToken), revokedAt: null },
    { $set: { revokedAt: new Date(), revokedReason: reason } }
  );
  return res.modifiedCount > 0;
}

/** Log out everywhere. */
async function revokeAllForUser(userId, reason = "logout_all") {
  const res = await RefreshToken.updateMany(
    { userId, revokedAt: null },
    { $set: { revokedAt: new Date(), revokedReason: reason } }
  );
  return res.modifiedCount;
}

async function issueSession(user, { userAgent, ip } = {}) {
  const [accessToken, refresh] = await Promise.all([
    issueAccessToken(user),
    issueRefreshToken(user, { userAgent, ip }),
  ]);
  return {
    accessToken,
    refreshToken: refresh.token,
    expiresIn: ACCESS_TTL_SECONDS,
    tokenType: "Bearer",
  };
}

module.exports = {
  issueAccessToken,
  verifyAccessToken,
  issueRefreshToken,
  rotateRefreshToken,
  revokeRefreshToken,
  revokeAllForUser,
  issueSession,
  hashToken,
  ACCESS_TTL_SECONDS,
  REFRESH_TTL_SECONDS,
};
