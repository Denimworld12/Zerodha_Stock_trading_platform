"use strict";

/**
 * Authentication — Auth0 today, replaceable tomorrow.
 *
 * THE LOCK-IN RULE
 * ----------------
 * Auth0's `sub` never becomes a primary key and never appears as a foreign key
 * on another collection. It is stored as one row in `users.identities[]`, and
 * everything else in the system references our own `users._id`.
 *
 * The cost of that discipline is one extra lookup per request (cached). The
 * payoff is that switching to Clerk, Supabase or self-hosted auth is a backfill
 * of one array — instead of rewriting every order, position and ledger entry
 * that had an `auth0|...` string baked into it. Identity providers get acquired,
 * reprice, or change terms; the user table should outlive all of that.
 *
 * Verification uses the JWKS endpoint and checks issuer, audience, expiry and
 * signature. Tokens are never decoded-without-verifying, and the secret is
 * never shared with the frontend.
 */

const { createRemoteJWKSet, jwtVerify } = require("jose");
const { User, Account } = require("../models");
const tokens = require("./tokens");

const DOMAIN = process.env.AUTH0_DOMAIN || "";
const AUDIENCE = process.env.AUTH0_AUDIENCE || "";
const ISSUER = DOMAIN ? `https://${DOMAIN}/` : "";

/**
 * Local development without an Auth0 tenant.
 *
 * Gated on NODE_ENV !== "production" as well as the flag, so setting the env
 * var on a production host cannot open the door. It logs loudly on every start
 * because an auth bypass that runs quietly is how one ends up shipped.
 */
const DEV_BYPASS =
  process.env.AUTH_DEV_BYPASS === "true" && process.env.NODE_ENV !== "production";

let jwks = null;
function keyStore() {
  if (!DOMAIN) throw new Error("AUTH0_DOMAIN is not configured");
  if (!jwks) {
    jwks = createRemoteJWKSet(new URL(`https://${DOMAIN}/.well-known/jwks.json`), {
      cooldownDuration: 30_000,
      cacheMaxAge: 600_000,
    });
  }
  return jwks;
}

/** Verify an Auth0 access token. Throws on anything suspicious. */
async function verifyToken(token) {
  const { payload } = await jwtVerify(token, keyStore(), {
    issuer: ISSUER,
    audience: AUDIENCE,
    clockTolerance: "5s",
  });
  if (!payload.sub) throw new Error("token has no subject");
  return payload;
}

/**
 * Find or create the local user for a verified token.
 *
 * Matching is on (provider, subject) — not on email. Email is mutable and
 * re-assignable; treating it as identity is how one account gets merged into
 * another's by accident.
 */
async function provisionUser(payload, { provider = "auth0" } = {}) {
  const subject = payload.sub;
  const email = (payload.email || payload[`${AUDIENCE}/email`] || "").toLowerCase() || null;

  let user = await User.findOne({
    "identities.provider": provider,
    "identities.subject": subject,
  });

  if (user) {
    await User.updateOne(
      { _id: user._id, "identities.subject": subject },
      { $set: { "identities.$.lastLoginAt": new Date() } }
    );
    return user;
  }

  // An existing local user with this email — link the identity rather than
  // creating a duplicate. This is what makes adding Google login later
  // non-destructive for people who signed up with a password.
  if (email) {
    user = await User.findOne({ email, deletedAt: null });
    if (user) {
      user.identities.push({
        provider, subject, email,
        emailVerified: !!payload.email_verified,
        lastLoginAt: new Date(),
      });
      await user.save();
      return user;
    }
  }

  if (!email) {
    throw Object.assign(new Error("token carries no email; cannot provision"), { status: 403 });
  }

  user = await User.create({
    email,
    name: payload.name || payload.nickname || email.split("@")[0],
    picture: payload.picture,
    identities: [{
      provider, subject, email,
      emailVerified: !!payload.email_verified,
      lastLoginAt: new Date(),
    }],
  });

  // Every user gets a FUNDED paper account immediately. Creating it empty
  // means their first order is rejected for insufficient funds, which reads as
  // a broken app rather than as an empty account.
  await require("./accounts").createAccount({ userId: user._id, name: "Paper", kind: "paper" });

  return user;
}

/**
 * Resolve a bearer token to a user, trying each configured provider.
 *
 * LOCAL tokens are tried first because they are the common case and verify
 * without a network call. Auth0 is attempted only when it is configured, so
 * enabling it later is a matter of setting two environment variables — no code
 * change, and existing password sessions keep working throughout.
 */
async function resolveToken(token) {
  // 1. our own signed access token
  try {
    const payload = await tokens.verifyAccessToken(token);
    const user = await User.findById(payload.sub);
    if (user) return { user, payload, provider: "local" };
  } catch { /* not a local token; fall through */ }

  // 2. Auth0, when configured
  if (DOMAIN && AUDIENCE) {
    const payload = await verifyToken(token);      // throws if invalid
    const user = await provisionUser(payload);
    return { user, payload, provider: "auth0" };
  }

  const err = new Error("invalid token");
  err.status = 401;
  throw err;
}

/** Express middleware: require a valid token, attach req.user. */
function requireAuth({ optional = false } = {}) {
  return async function authMiddleware(req, res, next) {
    try {
      if (DEV_BYPASS) {
        req.user = await devUser();
        req.auth = { sub: "dev|local", devBypass: true };
        return next();
      }

      const header = req.get("authorization") || "";
      const [scheme, token] = header.split(" ");
      if (!token || scheme.toLowerCase() !== "bearer") {
        if (optional) return next();
        return res.status(401).json({ error: "missing bearer token", code: "NO_TOKEN" });
      }

      const { user, payload, provider } = await resolveToken(token);
      if (user.status !== "active" || user.deletedAt) {
        return res.status(403).json({ error: `account is ${user.status}`, code: "ACCOUNT_INACTIVE" });
      }

      req.auth = payload;
      req.authProvider = provider;
      req.user = user;
      next();
    } catch (err) {
      if (optional) return next();
      const status = err.status || 401;
      // Never echo the verification internals back — the difference between
      // "bad signature" and "wrong audience" is useful to an attacker.
      res.status(status).json({
        error: status === 403 ? err.message : "invalid or expired token",
        code: status === 403 ? "ACCOUNT_INACTIVE" : "INVALID_TOKEN",
      });
    }
  };
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: "not authenticated" });
    if (!roles.some((r) => req.user.roles.includes(r))) {
      return res.status(403).json({ error: "insufficient role" });
    }
    next();
  };
}

/**
 * Resolve the account named by the request and PROVE it belongs to the caller.
 *
 * The ownership check lives here rather than in each route, because "every
 * route remembered to filter by userId" is not a property anyone can maintain.
 * A missing filter is a cross-tenant data leak, not a bug you notice in QA.
 */
async function resolveAccount(req, res, next) {
  try {
    const id = req.params.accountId || req.body?.accountId || req.query?.accountId;
    const query = id
      ? { _id: id, userId: req.user._id }
      : { userId: req.user._id, status: "active" };

    const account = await Account.findOne(query).sort({ createdAt: 1 });
    if (!account) return res.status(404).json({ error: "account not found" });
    if (account.tradingHaltedAt) {
      req.accountHalted = { at: account.tradingHaltedAt, reason: account.haltReason };
    }
    req.account = account;
    next();
  } catch {
    res.status(400).json({ error: "invalid account id" });
  }
}

let devUserCache = null;
async function devUser() {
  if (devUserCache) return devUserCache;
  let user = await User.findOne({ email: "dev@localhost" });
  if (!user) {
    user = await User.create({
      email: "dev@localhost", name: "Local Dev",
      identities: [{ provider: "local", subject: "dev|local" }],
      roles: ["user", "admin"],
    });
    await require("./accounts").createAccount({ userId: user._id, name: "Paper", kind: "paper" });
  }
  devUserCache = user;
  return user;
}

function describeConfig() {
  if (DEV_BYPASS) {
    return {
      mode: "DEV BYPASS",
      warning: "authentication is disabled; every request runs as dev@localhost",
    };
  }
  const providers = ["local"];
  if (DOMAIN && AUDIENCE) providers.push("auth0");
  return {
    mode: providers.join("+"),
    providers,
    // Auth0 is optional. When these are set it is accepted ALONGSIDE local
    // logins rather than replacing them, so nobody is locked out on the day
    // it is switched on.
    auth0: {
      configured: Boolean(DOMAIN && AUDIENCE),
      domain: DOMAIN || null,
      audience: AUDIENCE || null,
    },
  };
}

if (DEV_BYPASS) {
  console.warn(
    "\n  ⚠  AUTH_DEV_BYPASS is on — every request is authenticated as dev@localhost." +
    "\n     This is refused when NODE_ENV=production, but never deploy with it set.\n"
  );
}

module.exports = {
  requireAuth,
  resolveToken,
  requireRole,
  resolveAccount,
  verifyToken,
  provisionUser,
  describeConfig,
  DEV_BYPASS,
};
