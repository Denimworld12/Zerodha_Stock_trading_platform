"use strict";

/**
 * Password hashing and verification.
 *
 * Uses scrypt from Node's own crypto module. Three reasons over the usual
 * bcrypt dependency:
 *
 *   - It is MEMORY-hard, not just CPU-hard. bcrypt is cheap to attack with
 *     GPUs and FPGAs because it needs almost no RAM; scrypt's cost parameter
 *     forces an attacker to buy memory per guess.
 *   - Zero dependencies. `bcrypt` needs a native build (breaks on deploy),
 *     and `bcryptjs` is pure JS and correspondingly slow.
 *   - It ships with Node, so it cannot be supply-chain compromised separately.
 *
 * The stored format carries its own parameters, so the cost can be raised later
 * without invalidating existing passwords: an old hash still verifies against
 * its own recorded settings, and `needsRehash` says when to upgrade it.
 */

const crypto = require("node:crypto");
const { promisify } = require("node:util");

const scrypt = promisify(crypto.scrypt);

// N=2^15 costs roughly 64 MB and ~100ms per hash on modest hardware. That is
// slow enough to make offline cracking expensive and fast enough that a login
// still feels instant.
const PARAMS = { N: 32768, r: 8, p: 1, keylen: 64 };
const MAX_PASSWORD_BYTES = 1024;

async function hashPassword(password) {
  assertUsable(password);
  const salt = crypto.randomBytes(16);
  const derived = await scrypt(password.normalize("NFKC"), salt, PARAMS.keylen, {
    N: PARAMS.N, r: PARAMS.r, p: PARAMS.p,
    // scrypt refuses to allocate past maxmem; the default is below what N
    // demands, so it must be raised explicitly or every hash throws.
    maxmem: 256 * 1024 * 1024,
  });
  return [
    "scrypt", PARAMS.N, PARAMS.r, PARAMS.p,
    salt.toString("base64"), derived.toString("base64"),
  ].join("$");
}

async function verifyPassword(password, stored) {
  if (typeof password !== "string" || typeof stored !== "string") return false;
  if (Buffer.byteLength(password, "utf8") > MAX_PASSWORD_BYTES) return false;

  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;

  const [, N, r, p, saltB64, hashB64] = parts;
  let derived;
  try {
    derived = await scrypt(password.normalize("NFKC"), Buffer.from(saltB64, "base64"),
      Buffer.from(hashB64, "base64").length,
      { N: Number(N), r: Number(r), p: Number(p), maxmem: 256 * 1024 * 1024 });
  } catch {
    return false;
  }

  const expected = Buffer.from(hashB64, "base64");
  // Lengths must match before timingSafeEqual, which throws on a mismatch —
  // and that throw would itself be an observable timing signal.
  if (expected.length !== derived.length) return false;
  return crypto.timingSafeEqual(expected, derived);
}

/** True when a hash was made with weaker parameters than we now use. */
function needsRehash(stored) {
  const parts = String(stored || "").split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return true;
  return Number(parts[1]) < PARAMS.N || Number(parts[2]) < PARAMS.r;
}

/**
 * Password policy.
 *
 * Length is the requirement that actually matters. Mandatory symbol classes
 * mostly produce `Password1!` — predictable to a cracker, annoying to a human —
 * so the rule here is a 10-character minimum plus a block list of the specific
 * strings attackers try first.
 */
const COMMON = new Set([
  "password", "password1", "password123", "12345678", "123456789", "1234567890",
  "qwertyuiop", "letmein123", "iloveyou1", "admin123", "welcome123", "trading123",
  "changeme", "secret123", "passw0rd", "qwerty123", "abc12345", "zerodha123",
]);

function validatePassword(password, { email } = {}) {
  const errors = [];
  if (typeof password !== "string") return ["password is required"];

  const pw = password.normalize("NFKC");
  if (pw.length < 10) errors.push("must be at least 10 characters");
  if (pw.length > 200) errors.push("must be under 200 characters");
  if (COMMON.has(pw.toLowerCase())) errors.push("is too common; pick something less guessable");
  if (/^(.)\1+$/.test(pw)) errors.push("cannot be a single repeated character");

  if (email) {
    const local = String(email).split("@")[0].toLowerCase();
    if (local.length > 2 && pw.toLowerCase().includes(local)) {
      errors.push("cannot contain your email address");
    }
  }
  return errors;
}

function assertUsable(password) {
  if (typeof password !== "string" || !password.length) {
    throw new Error("password must be a non-empty string");
  }
  if (Buffer.byteLength(password, "utf8") > MAX_PASSWORD_BYTES) {
    // An unbounded password is a denial-of-service vector: hashing is
    // deliberately expensive, so a megabyte-long one ties up the event loop.
    throw new Error(`password must be under ${MAX_PASSWORD_BYTES} bytes`);
  }
}

module.exports = {
  hashPassword,
  verifyPassword,
  needsRehash,
  validatePassword,
  PARAMS,
};
