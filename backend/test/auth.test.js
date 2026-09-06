const assert = require("node:assert/strict");
const { test, before, after, beforeEach } = require("node:test");
const mongoose = require("mongoose");

const passwords = require("../lib/passwords");
const localauth = require("../lib/localauth");
const tokens = require("../lib/tokens");
const { User, Account, RefreshToken } = require("../models");

const URL = process.env.TEST_MONGO_URL
  || "mongodb://localhost:27017/tradingmitra_auth_test?replicaSet=rs0";

before(async () => {
  process.env.JWT_SECRET = "test-secret-that-is-definitely-long-enough-1234";
  await mongoose.connect(URL, { serverSelectionTimeoutMS: 8000 });
  await mongoose.connection.db.dropDatabase();
  await Promise.all(Object.values(mongoose.models).map((m) => m.syncIndexes()));
});

after(async () => {
  await mongoose.connection.db.dropDatabase();
  await mongoose.disconnect();
});

beforeEach(async () => {
  const db = mongoose.connection.db;
  await Promise.all([
    User.deleteMany({}), Account.deleteMany({}), RefreshToken.deleteMany({}),
    db.collection("ledgerentries").deleteMany({}),
    db.collection("balancesnapshots").deleteMany({}),
  ]);
});

const GOOD = "correct-horse-battery";

// ---------------------------------------------------------------------------
test("password hashing is salted, slow and verifiable", async () => {
  const a = await passwords.hashPassword(GOOD);
  const b = await passwords.hashPassword(GOOD);
  assert.notEqual(a, b, "same password must not produce the same hash (no salt?)");
  assert.match(a, /^scrypt\$32768\$8\$1\$/);

  assert.equal(await passwords.verifyPassword(GOOD, a), true);
  assert.equal(await passwords.verifyPassword("wrong", a), false);
  assert.equal(await passwords.verifyPassword("", a), false);

  // Garbage must be rejected, not throw.
  for (const junk of ["", "notahash", "scrypt$1$2$3", null, undefined, 42]) {
    assert.equal(await passwords.verifyPassword(GOOD, junk), false);
  }
});

test("password policy rejects the passwords attackers actually try", async () => {
  assert.ok(passwords.validatePassword("short").length);
  assert.ok(passwords.validatePassword("password123").length, "common password accepted");
  assert.ok(passwords.validatePassword("aaaaaaaaaaaa").length, "repeated character accepted");
  assert.ok(passwords.validatePassword("nikhil12345", { email: "nikhil@x.com" }).length,
    "password containing the email accepted");
  assert.equal(passwords.validatePassword(GOOD).length, 0);
});

test("an oversized password is refused rather than hashed", async () => {
  // Hashing is deliberately expensive, so an unbounded input is a DoS vector.
  await assert.rejects(passwords.hashPassword("x".repeat(2000)), /under 1024 bytes/);
});

test("register creates a funded account and a session", async () => {
  const { user, session } = await localauth.register({ email: "A@Example.COM ", password: GOOD });
  assert.equal(user.email, "a@example.com", "email should be normalised");
  assert.ok(session.accessToken && session.refreshToken);

  const account = await Account.findOne({ userId: user._id });
  assert.ok(account, "no paper account created");

  const ledger = require("../lib/ledger");
  const b = await ledger.balances(account._id, account.baseCurrency);
  assert.equal(b.cash.toString(), "100000.00", "paper account was not funded");
});

test("the password hash never leaves the database by default", async () => {
  await localauth.register({ email: "h@x.com", password: GOOD });
  const plain = await User.findOne({ email: "h@x.com" });
  assert.equal(plain.identities[0].passwordHash, undefined,
    "passwordHash must be select:false");

  const explicit = await User.findOne({ email: "h@x.com" }).select("+identities.passwordHash");
  assert.ok(explicit.identities[0].passwordHash, "should be fetchable when asked for");
});

test("login succeeds, and failures are indistinguishable", async () => {
  await localauth.register({ email: "u@x.com", password: GOOD });

  const { session } = await localauth.login({ email: "u@x.com", password: GOOD });
  assert.ok(session.accessToken);

  // Wrong password and unknown email must return the SAME code and message,
  // or the API becomes a membership oracle.
  const wrong = await localauth.login({ email: "u@x.com", password: "nope" }).catch((e) => e);
  const missing = await localauth.login({ email: "nobody@x.com", password: GOOD }).catch((e) => e);
  assert.equal(wrong.code, "INVALID_CREDENTIALS");
  assert.equal(missing.code, "INVALID_CREDENTIALS");
  assert.equal(wrong.message, missing.message);
  assert.equal(wrong.status, missing.status);
});

test("duplicate registration is refused", async () => {
  await localauth.register({ email: "dup@x.com", password: GOOD });
  await assert.rejects(
    localauth.register({ email: "DUP@x.com", password: GOOD }),
    (e) => e.code === "EMAIL_TAKEN"
  );
  assert.equal(await User.countDocuments({}), 1);
});

test("repeated failures lock the account", async () => {
  await localauth.register({ email: "lock@x.com", password: GOOD });
  for (let i = 0; i < localauth.MAX_FAILED_LOGINS; i++) {
    await localauth.login({ email: "lock@x.com", password: "wrong" }).catch(() => {});
  }
  // Even the CORRECT password is refused while locked.
  await assert.rejects(
    localauth.login({ email: "lock@x.com", password: GOOD }),
    (e) => e.code === "ACCOUNT_LOCKED"
  );
});

test("a successful login clears the failure counter", async () => {
  await localauth.register({ email: "reset@x.com", password: GOOD });
  await localauth.login({ email: "reset@x.com", password: "wrong" }).catch(() => {});
  await localauth.login({ email: "reset@x.com", password: "wrong" }).catch(() => {});
  await localauth.login({ email: "reset@x.com", password: GOOD });
  const u = await User.findOne({ email: "reset@x.com" });
  assert.equal(u.failedLoginCount, 0);
});

// ---------------------------------------------------------------------------
test("access tokens verify, and a tampered one does not", async () => {
  const { user, session } = await localauth.register({ email: "t@x.com", password: GOOD });
  const payload = await tokens.verifyAccessToken(session.accessToken);
  assert.equal(payload.sub, String(user._id));
  assert.equal(payload.email, "t@x.com");

  const [h, b, sig] = session.accessToken.split(".");
  await assert.rejects(tokens.verifyAccessToken(`${h}.${b}.${sig.slice(0, -3)}abc`));

  // The classic "alg: none" downgrade must fail — algorithms are pinned.
  const none = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url");
  await assert.rejects(tokens.verifyAccessToken(`${none}.${b}.`));
});

test("refresh tokens are stored hashed, never in plaintext", async () => {
  const { session } = await localauth.register({ email: "r@x.com", password: GOOD });
  const found = await RefreshToken.findOne({});
  assert.notEqual(found.tokenHash, session.refreshToken);
  assert.equal(found.tokenHash, tokens.hashToken(session.refreshToken));
  const anyPlain = await RefreshToken.findOne({ tokenHash: session.refreshToken });
  assert.equal(anyPlain, null);
});

test("refresh rotates, and replaying a used token kills the family", async () => {
  const { session } = await localauth.register({ email: "rot@x.com", password: GOOD });

  const first = await tokens.rotateRefreshToken(session.refreshToken, {});
  assert.notEqual(first.refreshToken, session.refreshToken, "token was not rotated");
  assert.ok(first.accessToken);

  // Replaying the consumed token is treated as theft.
  await assert.rejects(
    tokens.rotateRefreshToken(session.refreshToken, {}),
    (e) => e.code === "REFRESH_TOKEN_REUSED"
  );

  // ...and the legitimate newer token is revoked too, forcing a real re-login.
  await assert.rejects(tokens.rotateRefreshToken(first.refreshToken, {}));

  const live = await RefreshToken.countDocuments({ revokedAt: null, usedAt: null });
  assert.equal(live, 0, "family should be fully revoked");
});

test("logout revokes only that session; logout-all revokes every one", async () => {
  const { user } = await localauth.register({ email: "s@x.com", password: GOOD });
  const a = await localauth.login({ email: "s@x.com", password: GOOD });
  const b = await localauth.login({ email: "s@x.com", password: GOOD });

  await tokens.revokeRefreshToken(a.session.refreshToken);
  await assert.rejects(tokens.rotateRefreshToken(a.session.refreshToken, {}));
  const stillWorks = await tokens.rotateRefreshToken(b.session.refreshToken, {});
  assert.ok(stillWorks.accessToken, "the other session should survive");

  await tokens.revokeAllForUser(user._id);
  await assert.rejects(tokens.rotateRefreshToken(stillWorks.refreshToken, {}));
});

test("changing a password signs out every other session", async () => {
  const { user } = await localauth.register({ email: "cp@x.com", password: GOOD });
  const other = await localauth.login({ email: "cp@x.com", password: GOOD });

  const NEW = "a-different-good-passphrase";
  const res = await localauth.changePassword({
    userId: user._id, currentPassword: GOOD, newPassword: NEW,
  });
  assert.ok(res.revokedSessions >= 1);
  await assert.rejects(tokens.rotateRefreshToken(other.session.refreshToken, {}));

  await assert.rejects(localauth.login({ email: "cp@x.com", password: GOOD }),
    (e) => e.code === "INVALID_CREDENTIALS");
  const ok = await localauth.login({ email: "cp@x.com", password: NEW });
  assert.ok(ok.session.accessToken);
});

test("change-password rejects a wrong current password and a weak new one", async () => {
  const { user } = await localauth.register({ email: "cp2@x.com", password: GOOD });
  await assert.rejects(
    localauth.changePassword({ userId: user._id, currentPassword: "wrong", newPassword: "another-good-one" }),
    (e) => e.code === "INVALID_CREDENTIALS"
  );
  await assert.rejects(
    localauth.changePassword({ userId: user._id, currentPassword: GOOD, newPassword: "password123" }),
    (e) => e.code === "WEAK_PASSWORD"
  );
  await assert.rejects(
    localauth.changePassword({ userId: user._id, currentPassword: GOOD, newPassword: GOOD }),
    (e) => e.code === "PASSWORD_UNCHANGED"
  );
});

// ---------------------------------------------------------------------------
// The property that makes today's decision safe to reverse later.
// ---------------------------------------------------------------------------
test("an Auth0 identity can be added later without disturbing anything", async () => {
  const { user } = await localauth.register({ email: "future@x.com", password: GOOD });
  const account = await Account.findOne({ userId: user._id });

  // Trade first, so there is real history keyed to this user id.
  const ledger = require("../lib/ledger");
  const beforeBalances = await ledger.balances(account._id, account.baseCurrency);

  // Now Auth0 becomes available and its identity is attached.
  const linked = await localauth.linkIdentity({
    userId: user._id, provider: "auth0", subject: "auth0|abc123",
    email: "future@x.com", emailVerified: true,
  });

  assert.equal(linked.identities.length, 2);
  assert.deepEqual(linked.identities.map((i) => i.provider).sort(), ["auth0", "local"]);

  // The user id is unchanged, so every account, order and ledger entry still
  // belongs to them. This is the whole point of not keying off the provider.
  assert.equal(String(linked._id), String(user._id));
  const afterBalances = await ledger.balances(account._id, account.baseCurrency);
  assert.equal(afterBalances.cash.toString(), beforeBalances.cash.toString());

  // And the password still works — adding a provider is additive, not a swap.
  const stillWorks = await localauth.login({ email: "future@x.com", password: GOOD });
  assert.ok(stillWorks.session.accessToken);
});

test("an identity already attached elsewhere cannot be stolen", async () => {
  const { user: a } = await localauth.register({ email: "a1@x.com", password: GOOD });
  const { user: b } = await localauth.register({ email: "b1@x.com", password: GOOD });

  await localauth.linkIdentity({ userId: a._id, provider: "auth0", subject: "auth0|shared" });
  await assert.rejects(
    localauth.linkIdentity({ userId: b._id, provider: "auth0", subject: "auth0|shared" }),
    (e) => e.code === "IDENTITY_LINKED_ELSEWHERE"
  );
});
