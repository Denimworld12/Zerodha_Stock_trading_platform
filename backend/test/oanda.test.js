/**
 * OANDA adapter tests.
 *
 * No credentials are needed: these cover the parts that are wrong or right
 * regardless of whether a token exists — symbol translation, the signed-units
 * convention, and the failure modes that would otherwise only show up against a
 * live account.
 */
const assert = require("node:assert/strict");
const { test } = require("node:test");
const { OandaClient, OandaError, toOanda, fromOanda } = require("../lib/brokers/oanda");

test("symbol translation both ways", () => {
  assert.equal(toOanda("EURUSD"), "EUR_USD");
  assert.equal(toOanda("eurusd"), "EUR_USD");
  assert.equal(toOanda("EUR_USD"), "EUR_USD");
  assert.equal(fromOanda("EUR_USD"), "EURUSD");
  assert.equal(fromOanda("XAU_USD"), "XAUUSD");
});

test("an unconfigured client explains what is missing", async () => {
  const c = new OandaClient({ token: null, accountId: null });
  assert.equal(c.configured, false);
  assert.throws(() => c.assertConfigured(), /OANDA_API_TOKEN is not set/);

  const withToken = new OandaClient({ token: "x", accountId: null });
  assert.throws(() => withToken.assertConfigured(), /OANDA_ACCOUNT_ID is not set/);

  const h = await c.health();
  assert.equal(h.ok, false);
  assert.equal(h.configured, false);
  assert.match(h.hint, /OANDA_API_TOKEN/);
});

test("practice and live use different hosts", () => {
  const practice = new OandaClient({ token: "x", accountId: "y", environment: "practice" });
  const live = new OandaClient({ token: "x", accountId: "y", environment: "live" });
  assert.match(practice.hosts.rest, /fxpractice/);
  assert.match(live.hosts.rest, /fxtrade/);
  // Anything but "live" must land on practice — a typo in the env var must not
  // silently point at real money.
  assert.match(new OandaClient({ token: "x", accountId: "y", environment: "prod" }).hosts.rest,
    /fxpractice/);
});

test("zero or non-numeric units are refused before they reach the network", async () => {
  const c = new OandaClient({ token: "x", accountId: "y" });
  for (const units of [0, "0", NaN, "abc", null, undefined]) {
    await assert.rejects(
      c.marketOrder({ symbol: "EUR_USD", units }),
      (e) => e instanceof OandaError && /non-zero number/.test(e.message),
      `units=${units} should have been refused`
    );
  }
});

test("bad credentials surface as a clear error, not a hang", async () => {
  const c = new OandaClient({ token: "definitely-not-a-real-token", accountId: "001-000-0000000-000" });
  const h = await c.health();
  assert.equal(h.ok, false);
  assert.equal(h.configured, true);
  // OANDA validates the accountID FORMAT before it checks the token, so a fake
  // pair comes back 400 rather than 401. Either way health() must report a
  // readable reason instead of throwing or hanging.
  assert.ok(h.error, "health() returned no error message");
  assert.match(h.error, /OANDA \d{3}:/);
});

test("a request that stalls times out instead of hanging forever", async () => {
  const c = new OandaClient({ token: "x", accountId: "y" });
  // Point at a host that accepts the connection and never replies.
  c.hosts = { rest: "http://10.255.255.1", stream: "http://10.255.255.1" };
  await assert.rejects(
    c.request("/accounts", { timeoutMs: 1500 }),
    (e) => /timed out/.test(e.message)
  );
});
