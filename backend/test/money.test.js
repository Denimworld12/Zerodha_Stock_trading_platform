/**
 * Money tests. These are the tests that matter most in the whole codebase:
 * every one of them fails under the float arithmetic the app used to use.
 */
const assert = require("node:assert/strict");
const { test } = require("node:test");
const { Money, ROUND } = require("../lib/money");

const inr = (v) => Money.parse(v, "INR");

test("the float bugs this module exists to prevent", () => {
  // 0.1 + 0.2 !== 0.3 in doubles
  assert.equal(inr("0.1").plus(inr("0.2")).toString(), "0.30");

  // 0.1 added ten times drifts to 0.9999999999999999 in doubles
  let acc = inr("0");
  for (let i = 0; i < 10; i++) acc = acc.plus(inr("0.1"));
  assert.equal(acc.toString(), "1.00");
  assert.ok(acc.equals(inr("1")));

  // A long run of adds and subtracts must return exactly to zero
  let bal = inr("0");
  for (let i = 0; i < 1000; i++) bal = bal.plus(inr("0.07")).minus(inr("0.07"));
  assert.ok(bal.isZero(), `drifted to ${bal}`);
});

test("parsing rejects silent precision loss", () => {
  assert.throws(() => inr("1.005"), /more precision/);   // paise has 2 dp
  assert.equal(inr("1.0000").toString(), "1.00");        // trailing zeros are fine
  assert.equal(Money.parse("0.00000001", "BTC").toString(), "0.00000001");
  assert.throws(() => Money.parse("1.234567891", "BTC"), /more precision/);
  assert.throws(() => inr("abc"), /malformed/);
  assert.throws(() => inr(Infinity), /finite/);
});

test("currency mixing is refused, not coerced", () => {
  assert.throws(() => inr("10").plus(Money.parse("10", "USD")), /currency mismatch/);
  assert.throws(() => Money.parse("1", "XYZ"), /unknown currency/);
});

test("negative amounts round symmetrically", () => {
  assert.equal(inr("-1").minus(inr("0.5")).toString(), "-1.50");
  assert.equal(inr("-2.5").times("1", { qtyScale: 0 }).toString(), "-2.50");
});

test("rounding modes are explicit and correct", () => {
  const half = Money.parse("0.125", "BTC");   // BTC scale 8, so this is exact
  assert.equal(half.times("1", { qtyScale: 0 }).toString(), "0.12500000");

  // 1.005 at 2dp: HALF_UP -> 1.01, HALF_EVEN -> 1.00
  const a = Money.parse("1.00", "INR");
  assert.equal(a.times("1.005", { qtyScale: 3, rounding: ROUND.HALF_UP }).toString(), "1.01");
  assert.equal(a.times("1.005", { qtyScale: 3, rounding: ROUND.HALF_EVEN }).toString(), "1.00");
  assert.equal(a.times("1.009", { qtyScale: 3, rounding: ROUND.DOWN }).toString(), "1.00");
  assert.equal(a.times("1.001", { qtyScale: 3, rounding: ROUND.UP }).toString(), "1.01");
});

test("order notional: price x fractional quantity", () => {
  // 0.01 BTC at 79,900.00 -> 799.00 exactly
  const px = Money.parse("79900.00", "USD");
  assert.equal(px.times("0.01", { qtyScale: 8 }).toString(), "799.00");

  // A price that does not divide evenly must still be exact to the paise
  const p2 = Money.parse("1555.45", "INR");
  assert.equal(p2.times("3", { qtyScale: 0 }).toString(), "4666.35");
});

test("allocate never loses or invents a minor unit", () => {
  const parts = inr("100").allocate(3);
  assert.equal(parts.length, 3);
  assert.equal(Money.sum(parts, "INR").toString(), "100.00");
  assert.deepEqual(parts.map(String), ["33.34", "33.33", "33.33"]);

  const neg = inr("-0.05").allocate(3);
  assert.equal(Money.sum(neg, "INR").toString(), "-0.05");

  for (const n of [1, 2, 7, 13, 99]) {
    const p = inr("12345.67").allocate(n);
    assert.equal(Money.sum(p, "INR").toString(), "12345.67", `allocate(${n}) lost money`);
  }
});

test("no overflow at any realistic scale", () => {
  // ~92 lakh crore. A double loses integer precision above 9.007e15 minor units.
  const huge = inr("92233720368547.75");
  assert.equal(huge.plus(inr("0.01")).toString(), "92233720368547.76");
});

test("Decimal128 round-trips exactly", () => {
  for (const v of ["0.01", "-0.01", "123456.78", "0.00"]) {
    const m = inr(v);
    assert.equal(Money.parse(m.toDecimal128().toString(), "INR").toString(), m.toString());
  }
});

test("comparisons", () => {
  assert.ok(inr("10").gt(inr("9.99")));
  assert.ok(inr("-1").lt(inr("0")));
  assert.ok(inr("5").equals(inr("5.00")));
  assert.equal(Money.sum([inr("1.10"), inr("2.20"), inr("3.30")], "INR").toString(), "6.60");
});
