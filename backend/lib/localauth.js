"use strict";

/**
 * Local email + password authentication.
 *
 * This is the provider we run on until Auth0 is available. Adding Auth0 later
 * is ADDITIVE, not a migration: its identity becomes a second entry in the same
 * `users.identities[]` array. Because nothing else in the system references a
 * provider id — orders, positions and ledger entries all key off our own
 * `users._id` — no other collection changes, and a user can end up with both a
 * password and an Auth0 login on one account.
 *
 * Two behaviours here are deliberate and easy to get wrong:
 *
 *   ENUMERATION. Login and password-reset return the same answer whether or not
 *   the email exists. An API that says "no such user" is a free membership
 *   oracle, and users reuse emails across sites.
 *
 *   TIMING. A missing user still pays the cost of a password verification
 *   against a dummy hash. Skipping it makes "unknown email" measurably faster
 *   than "wrong password", which leaks the same information the message above
 *   was careful not to.
 */

const crypto = require("node:crypto");
const { User, Account } = require("../models");
const passwords = require("./passwords");
const tokens = require("./tokens");
const accounts = require("./accounts");

const MAX_FAILED_LOGINS = Number(process.env.MAX_FAILED_LOGINS || 8);
const LOCKOUT_MINUTES = Number(process.env.LOCKOUT_MINUTES || 15);

/** A real hash of a random value, so the dummy verify costs what a real one does. */
let DUMMY_HASH = null;
async function dummyHash() {
  if (!DUMMY_HASH) {
    DUMMY_HASH = await passwords.hashPassword(crypto.randomBytes(32).toString("hex"));
  }
  return DUMMY_HASH;
}

class AuthError extends Error {
  constructor(code, message, status = 400, details = {}) {
    super(message);
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

function normaliseEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) && email.length <= 254;
}

// ---------------------------------------------------------------------------
async function register({ email, password, name, userAgent, ip }) {
  const addr = normaliseEmail(email);
  if (!isValidEmail(addr)) throw new AuthError("INVALID_EMAIL", "that does not look like an email address");

  const problems = passwords.validatePassword(password, { email: addr });
  if (problems.length) {
    throw new AuthError("WEAK_PASSWORD", `password ${problems.join("; ")}`, 400, { problems });
  }

  const existing = await User.findOne({ email: addr, deletedAt: null });
  if (existing) {
    // Registration cannot hide that an email is taken — the unique index makes
    // it observable anyway — but it can avoid confirming a password.
    throw new AuthError("EMAIL_TAKEN", "an account with that email already exists", 409);
  }

  const passwordHash = await passwords.hashPassword(password);
  const user = await User.create({
    email: addr,
    name: (name || addr.split("@")[0]).trim().slice(0, 100),
    identities: [{
      provider: "local",
      subject: addr,
      email: addr,
      emailVerified: false,
      passwordHash,
      passwordUpdatedAt: new Date(),
      lastLoginAt: new Date(),
    }],
  });

  await accounts.createAccount({ userId: user._id, name: "Paper", kind: "paper" });

  const session = await tokens.issueSession(user, { userAgent, ip });
  return { user, session };
}

// ---------------------------------------------------------------------------
async function login({ email, password, userAgent, ip }) {
  const addr = normaliseEmail(email);

  // `passwordHash` is `select: false`, so it must be asked for explicitly.
  const user = await User.findOne({ email: addr, deletedAt: null })
    .select("+identities.passwordHash");

  if (user?.lockedUntil && user.lockedUntil > new Date()) {
    const mins = Math.ceil((user.lockedUntil - Date.now()) / 60000);
    throw new AuthError("ACCOUNT_LOCKED",
      `too many failed attempts; try again in ${mins} minute${mins === 1 ? "" : "s"}`, 429);
  }

  const identity = user?.identities?.find((i) => i.provider === "local" && i.passwordHash);
  const stored = identity?.passwordHash || (await dummyHash());
  const ok = await passwords.verifyPassword(password ?? "", stored);

  if (!user || !identity || !ok) {
    if (user) await recordFailure(user);
    // One message for every failure mode: wrong password, unknown email, or an
    // account that only has a social login.
    throw new AuthError("INVALID_CREDENTIALS", "email or password is incorrect", 401);
  }

  if (user.status !== "active") {
    throw new AuthError("ACCOUNT_INACTIVE", `this account is ${user.status}`, 403);
  }

  // Opportunistically upgrade a hash made with older parameters.
  if (passwords.needsRehash(stored)) {
    const fresh = await passwords.hashPassword(password);
    await User.updateOne(
      { _id: user._id, "identities.provider": "local" },
      { $set: { "identities.$.passwordHash": fresh } }
    );
  }

  await User.updateOne(
    { _id: user._id },
    {
      $set: {
        failedLoginCount: 0, lockedUntil: null, lastLoginAt: new Date(),
        "identities.$[local].lastLoginAt": new Date(),
      },
    },
    { arrayFilters: [{ "local.provider": "local" }] }
  );

  // A user created before accounts existed, or whose account creation failed
  // halfway, should not be permanently unable to trade.
  const hasAccount = await Account.exists({ userId: user._id });
  if (!hasAccount) {
    await accounts.createAccount({ userId: user._id, name: "Paper", kind: "paper" });
  }

  const session = await tokens.issueSession(user, { userAgent, ip });
  return { user, session };
}

async function recordFailure(user) {
  const count = (user.failedLoginCount || 0) + 1;
  const update = { failedLoginCount: count };
  if (count >= MAX_FAILED_LOGINS) {
    update.lockedUntil = new Date(Date.now() + LOCKOUT_MINUTES * 60_000);
    update.failedLoginCount = 0;   // start the next window clean
  }
  await User.updateOne({ _id: user._id }, { $set: update });
}

// ---------------------------------------------------------------------------
async function changePassword({ userId, currentPassword, newPassword }) {
  const user = await User.findById(userId).select("+identities.passwordHash");
  if (!user) throw new AuthError("NOT_FOUND", "user not found", 404);

  const identity = user.identities.find((i) => i.provider === "local" && i.passwordHash);
  if (!identity) {
    throw new AuthError("NO_PASSWORD_SET",
      "this account signs in with a social provider and has no password", 400);
  }

  const ok = await passwords.verifyPassword(currentPassword ?? "", identity.passwordHash);
  if (!ok) throw new AuthError("INVALID_CREDENTIALS", "current password is incorrect", 401);

  const problems = passwords.validatePassword(newPassword, { email: user.email });
  if (problems.length) {
    throw new AuthError("WEAK_PASSWORD", `password ${problems.join("; ")}`, 400, { problems });
  }
  if (await passwords.verifyPassword(newPassword, identity.passwordHash)) {
    throw new AuthError("PASSWORD_UNCHANGED", "the new password must differ from the old one", 400);
  }

  const hash = await passwords.hashPassword(newPassword);
  await User.updateOne(
    { _id: user._id, "identities.provider": "local" },
    { $set: { "identities.$.passwordHash": hash, "identities.$.passwordUpdatedAt": new Date() } }
  );

  // Changing a password is how someone responds to a suspected compromise, so
  // it has to end every other session — otherwise the attacker keeps theirs.
  const revoked = await tokens.revokeAllForUser(user._id, "password_changed");
  return { revokedSessions: revoked };
}

/**
 * Attach an external identity (Auth0, Google, ...) to an existing user.
 *
 * This is the whole migration path. When Auth0 becomes available, its `sub`
 * arrives here and joins the array; the user keeps the same `_id`, so every
 * order, position and ledger entry they already own still belongs to them.
 */
async function linkIdentity({ userId, provider, subject, email, emailVerified = false }) {
  const clash = await User.findOne({
    "identities.provider": provider,
    "identities.subject": subject,
    _id: { $ne: userId },
  });
  if (clash) {
    throw new AuthError("IDENTITY_LINKED_ELSEWHERE",
      "that login is already attached to a different account", 409);
  }
  await User.updateOne(
    { _id: userId },
    { $addToSet: { identities: { provider, subject, email, emailVerified, lastLoginAt: new Date() } } }
  );
  return User.findById(userId);
}

module.exports = {
  register, login, changePassword, linkIdentity,
  AuthError, normaliseEmail, isValidEmail,
  MAX_FAILED_LOGINS, LOCKOUT_MINUTES,
};
