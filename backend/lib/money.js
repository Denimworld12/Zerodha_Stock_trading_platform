"use strict";

/**
 * Exact money arithmetic.
 *
 * WHY THIS EXISTS
 * ---------------
 * The app currently stores balances as JavaScript numbers, which are IEEE-754
 * doubles. Doubles cannot represent 0.1, so:
 *
 *     0.1 + 0.2            === 0.30000000000000004
 *     0.1 added ten times  === 0.9999999999999999
 *
 * Every add and subtract on a balance compounds that error. It is invisible for
 * a week and then your ledger disagrees with the broker by a few paise and you
 * cannot prove which side is right. Worse, it is the single hardest thing to fix
 * later: changing the representation means migrating every stored document AND
 * re-deriving every historical balance.
 *
 * So: all amounts are held as BigInt counts of MINOR UNITS (paise, cents,
 * satoshi). BigInt is exact and unbounded, so no amount can overflow and no
 * addition can drift. Persistence uses MongoDB's Decimal128, which is an exact
 * decimal type that Mongo can also $sum and sort correctly - unlike a string.
 *
 * Rounding is never implicit. Any operation that cannot be exact (dividing,
 * multiplying by a fractional quantity) demands an explicit rounding mode, so a
 * rounding decision is always something someone chose rather than something the
 * language did.
 */

const { Decimal128 } = require("mongodb");

/**
 * Minor-unit exponent per currency. Crypto uses 8 because exchanges quote and
 * settle to 8 decimals; quoting BTC in 2 decimals would silently truncate real
 * balances.
 */
const CURRENCIES = {
  INR: { scale: 2, symbol: "₹" },
  USD: { scale: 2, symbol: "$" },
  EUR: { scale: 2, symbol: "€" },
  USDT: { scale: 8, symbol: "₮" },
  BTC: { scale: 8, symbol: "₿" },
  ETH: { scale: 8, symbol: "Ξ" },
};

const ROUND = Object.freeze({
  HALF_UP: "HALF_UP",     // 2.5 -> 3, -2.5 -> -3   (what humans expect)
  HALF_EVEN: "HALF_EVEN", // banker's; unbiased across many roundings
  DOWN: "DOWN",           // toward zero — use when charging OURSELVES
  UP: "UP",               // away from zero
  FLOOR: "FLOOR",
  CEIL: "CEIL",
});

function scaleOf(currency) {
  const c = CURRENCIES[currency];
  if (!c) {
    throw new Error(
      `unknown currency ${currency}; add it to CURRENCIES with an explicit scale`
    );
  }
  return c.scale;
}

function pow10(n) {
  return 10n ** BigInt(n);
}

/**
 * Divide two BigInts with an explicit rounding mode. All rounding in this
 * module funnels through here so there is exactly one place to audit.
 */
function divRound(numerator, denominator, mode) {
  if (denominator === 0n) throw new Error("division by zero");

  const negative = (numerator < 0n) !== (denominator < 0n);
  const n = numerator < 0n ? -numerator : numerator;
  const d = denominator < 0n ? -denominator : denominator;

  const q = n / d;
  const r = n % d;
  if (r === 0n) return negative ? -q : q;

  let roundAway;
  switch (mode) {
    case ROUND.DOWN:
      roundAway = false;
      break;
    case ROUND.UP:
      roundAway = true;
      break;
    case ROUND.FLOOR:
      roundAway = negative;
      break;
    case ROUND.CEIL:
      roundAway = !negative;
      break;
    case ROUND.HALF_EVEN: {
      const twice = r * 2n;
      if (twice > d) roundAway = true;
      else if (twice < d) roundAway = false;
      else roundAway = q % 2n !== 0n; // tie -> make the result even
      break;
    }
    case ROUND.HALF_UP: {
      const twice = r * 2n;
      roundAway = twice >= d;
      break;
    }
    default:
      throw new Error(`rounding mode required (got ${mode})`);
  }

  const result = roundAway ? q + 1n : q;
  return negative ? -result : result;
}

class Money {
  /** @param {bigint} minor  @param {string} currency */
  constructor(minor, currency) {
    if (typeof minor !== "bigint") {
      throw new TypeError("Money takes BigInt minor units; use Money.parse()");
    }
    scaleOf(currency); // validate
    this.minor = minor;
    this.currency = currency;
    Object.freeze(this);
  }

  static zero(currency) {
    return new Money(0n, currency);
  }

  /**
   * Build from a decimal value. Strings are exact; numbers are accepted for
   * ergonomics but rejected when they carry more precision than a double can
   * actually hold, because that is precisely where silent corruption starts.
   */
  static parse(value, currency) {
    const scale = scaleOf(currency);

    if (value instanceof Money) {
      if (value.currency !== currency) {
        throw new Error(`cannot reinterpret ${value.currency} as ${currency}`);
      }
      return value;
    }
    if (typeof value === "bigint") return new Money(value * pow10(scale), currency);

    let str;
    if (typeof value === "number") {
      if (!Number.isFinite(value)) throw new Error(`not a finite amount: ${value}`);
      if (!Number.isSafeInteger(Math.round(value * 10 ** scale))) {
        throw new Error(
          `${value} cannot be represented exactly at scale ${scale}; pass a string`
        );
      }
      str = value.toFixed(scale);
    } else if (typeof value === "string") {
      str = value.trim();
    } else if (value instanceof Decimal128) {
      str = value.toString();
    } else {
      throw new TypeError(`cannot parse ${typeof value} as Money`);
    }

    const m = /^(-)?(\d+)(?:\.(\d+))?$/.exec(str);
    if (!m) throw new Error(`malformed amount: ${JSON.stringify(str)}`);
    const [, sign, whole, frac = ""] = m;

    // Reject rather than silently truncate: losing a digit is a real loss.
    if (frac.length > scale) {
      const significant = frac.slice(scale).replace(/0+$/, "");
      if (significant.length) {
        throw new Error(
          `${str} has more precision than ${currency} supports (scale ${scale}); ` +
            `round it explicitly first`
        );
      }
    }
    const padded = (frac + "0".repeat(scale)).slice(0, scale);
    const minor = BigInt(whole + padded);
    return new Money(sign ? -minor : minor, currency);
  }

  // -- guards ------------------------------------------------------------
  #same(other) {
    if (!(other instanceof Money)) throw new TypeError("expected a Money");
    if (other.currency !== this.currency) {
      throw new Error(
        `currency mismatch: ${this.currency} vs ${other.currency}. ` +
          `Convert explicitly with an FX rate; there is no implicit conversion.`
      );
    }
    return other;
  }

  // -- arithmetic --------------------------------------------------------
  plus(other) {
    return new Money(this.minor + this.#same(other).minor, this.currency);
  }
  minus(other) {
    return new Money(this.minor - this.#same(other).minor, this.currency);
  }
  negated() {
    return new Money(-this.minor, this.currency);
  }
  abs() {
    return new Money(this.minor < 0n ? -this.minor : this.minor, this.currency);
  }

  /**
   * Multiply by a quantity that may itself be fractional (e.g. 0.015 BTC).
   * `qty` is given as a decimal string/number plus the scale it is quoted at,
   * so the whole computation stays in integers.
   */
  times(qty, { qtyScale = 8, rounding = ROUND.HALF_UP } = {}) {
    const q = Money.#toScaledBigInt(qty, qtyScale);
    return new Money(divRound(this.minor * q, pow10(qtyScale), rounding), this.currency);
  }

  dividedBy(divisor, { rounding = ROUND.HALF_UP } = {}) {
    const d = Money.#toScaledBigInt(divisor, 8);
    return new Money(divRound(this.minor * pow10(8), d, rounding), this.currency);
  }

  /**
   * Split into n parts that sum EXACTLY back to the original. The remainder is
   * spread one minor unit at a time rather than dropped — dropping it is how
   * ledgers stop balancing.
   */
  allocate(n) {
    if (!Number.isInteger(n) || n <= 0) throw new Error("allocate needs a positive integer");
    const each = this.minor / BigInt(n);
    let remainder = this.minor - each * BigInt(n);
    const step = remainder < 0n ? -1n : 1n;
    const parts = [];
    for (let i = 0; i < n; i++) {
      let v = each;
      if (remainder !== 0n) {
        v += step;
        remainder -= step;
      }
      parts.push(new Money(v, this.currency));
    }
    return parts;
  }

  static #toScaledBigInt(value, scale) {
    if (typeof value === "bigint") return value * pow10(scale);
    const str = typeof value === "number" ? value.toFixed(scale) : String(value).trim();
    const m = /^(-)?(\d+)(?:\.(\d+))?$/.exec(str);
    if (!m) throw new Error(`malformed quantity: ${JSON.stringify(str)}`);
    const [, sign, whole, frac = ""] = m;
    if (frac.length > scale) {
      throw new Error(`quantity ${str} exceeds scale ${scale}; round it first`);
    }
    const padded = (frac + "0".repeat(scale)).slice(0, scale);
    const v = BigInt(whole + padded);
    return sign ? -v : v;
  }

  // -- comparison --------------------------------------------------------
  compare(other) {
    const o = this.#same(other);
    return this.minor < o.minor ? -1 : this.minor > o.minor ? 1 : 0;
  }
  equals(other) { return this.compare(other) === 0; }
  lt(other)  { return this.compare(other) < 0; }
  lte(other) { return this.compare(other) <= 0; }
  gt(other)  { return this.compare(other) > 0; }
  gte(other) { return this.compare(other) >= 0; }
  isZero()     { return this.minor === 0n; }
  isNegative() { return this.minor < 0n; }
  isPositive() { return this.minor > 0n; }

  static sum(items, currency) {
    return items.reduce((acc, m) => acc.plus(m), Money.zero(currency));
  }

  // -- representation ----------------------------------------------------
  toString() {
    const scale = scaleOf(this.currency);
    const neg = this.minor < 0n;
    const abs = (neg ? -this.minor : this.minor).toString().padStart(scale + 1, "0");
    const whole = abs.slice(0, abs.length - scale) || "0";
    const frac = scale ? "." + abs.slice(abs.length - scale) : "";
    return `${neg ? "-" : ""}${whole}${frac}`;
  }

  /** Exact decimal for MongoDB. Sortable and $sum-able, unlike a string. */
  toDecimal128() {
    return Decimal128.fromString(this.toString());
  }

  /** Lossy on purpose — display only. Never feed this back into arithmetic. */
  toNumber() {
    return Number(this.toString());
  }

  format({ locale = "en-IN", withSymbol = true } = {}) {
    const scale = scaleOf(this.currency);
    const n = this.toNumber();
    const body = n.toLocaleString(locale, {
      minimumFractionDigits: scale > 2 ? 2 : scale,
      maximumFractionDigits: scale,
    });
    return withSymbol ? `${CURRENCIES[this.currency].symbol}${body}` : body;
  }

  toJSON() {
    return { amount: this.toString(), currency: this.currency };
  }
}

/** Mongoose sub-schema for an embedded money value. */
const moneySchemaDefinition = {
  amount: { type: Decimal128, required: true },
  currency: { type: String, required: true, enum: Object.keys(CURRENCIES) },
};

function moneyFromDoc(doc) {
  if (!doc) return null;
  return Money.parse(doc.amount.toString(), doc.currency);
}

function moneyToDoc(money) {
  return { amount: money.toDecimal128(), currency: money.currency };
}

module.exports = {
  Money,
  ROUND,
  CURRENCIES,
  scaleOf,
  divRound,
  moneySchemaDefinition,
  moneyFromDoc,
  moneyToDoc,
};
