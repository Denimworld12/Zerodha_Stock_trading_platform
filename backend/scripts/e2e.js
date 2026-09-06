#!/usr/bin/env node
"use strict";

/**
 * End-to-end check against a RUNNING server.
 *
 * The unit tests prove the logic; this proves the wiring — routes mounted,
 * middleware ordered, auth attached, WebSocket serving, change streams pushing.
 * Those are exactly the things that pass in isolation and break in assembly.
 *
 * Usage:  node scripts/e2e.js            (expects the API on :3002)
 */
const WebSocket = require("ws");

const BASE = process.env.API_URL || "http://localhost:3002";
const results = [];

function check(name, ok, detail = "") {
  results.push({ name, ok, detail });
  console.log(`  ${ok ? "✓" : "✖"} ${name}${detail ? "  — " + detail : ""}`);
  return ok;
}

// Set once we log in; every later call carries it.
let ACCESS_TOKEN = null;

async function req(path, { method = "GET", body, headers = {} } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(ACCESS_TOKEN ? { Authorization: `Bearer ${ACCESS_TOKEN}` } : {}),
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* leave null */ }
  return { status: res.status, json, text };
}

(async () => {
  console.log(`\ne2e against ${BASE}\n`);

  // -- authentication ----------------------------------------------------
  const cfg = await req("/api/auth/config");
  check("GET /api/auth/config", cfg.status === 200, `providers: ${cfg.json?.providers?.join("+")}`);

  const devBypass = cfg.json?.mode === "DEV BYPASS";
  if (!devBypass) {
    // Anonymous access must be refused before we prove anything else works.
    const anon = await req("/api/v2/me");
    check("an unauthenticated request is refused", anon.status === 401, anon.json?.code);

    const forged = await req("/api/v2/me", { headers: { Authorization: "Bearer not.a.token" } });
    check("a forged token is refused", forged.status === 401, forged.json?.code);

    const email = `e2e-${Date.now()}@example.com`;
    const password = "correct-horse-battery-e2e";

    const reg = await req("/api/auth/register", { method: "POST", body: { email, password } });
    check("POST /api/auth/register", reg.status === 201, `user ${reg.json?.user?.email}`);
    ACCESS_TOKEN = reg.json?.accessToken;

    const weak = await req("/api/auth/register", {
      method: "POST", body: { email: `w${Date.now()}@x.com`, password: "password123" },
    });
    check("a weak password is refused", weak.status === 400, weak.json?.code);

    const badLogin = await req("/api/auth/login", { method: "POST", body: { email, password: "wrong" } });
    const noUser = await req("/api/auth/login", { method: "POST", body: { email: "nobody@x.com", password } });
    check("wrong password and unknown email are indistinguishable",
      badLogin.status === noUser.status && badLogin.json?.code === noUser.json?.code,
      `both ${badLogin.status} ${badLogin.json?.code}`);

    const login = await req("/api/auth/login", { method: "POST", body: { email, password } });
    check("POST /api/auth/login", login.status === 200 && Boolean(login.json?.accessToken));
    ACCESS_TOKEN = login.json.accessToken;
    const refreshToken = login.json.refreshToken;

    const refreshed = await req("/api/auth/refresh", { method: "POST", body: { refreshToken } });
    check("refresh returns a NEW refresh token (rotation)",
      refreshed.status === 200 && refreshed.json?.refreshToken !== refreshToken);

    const replay = await req("/api/auth/refresh", { method: "POST", body: { refreshToken } });
    check("replaying a used refresh token is refused",
      replay.status === 401, replay.json?.code);

    ACCESS_TOKEN = refreshed.json.accessToken;
  }

  // -- identity ----------------------------------------------------------
  const me = await req("/api/v2/me");
  check("GET /api/v2/me", me.status === 200, `auth mode: ${me.json?.auth?.mode}`);
  const account = me.json?.accounts?.[0];
  check("an account exists", Boolean(account), account ? `${account.name} (${account.baseCurrency})` : "none");
  if (!account) process.exit(1);

  // -- market data comes from the SERVER ---------------------------------
  const prices = await req("/api/v2/prices?symbols=BTCUSDT,ETHUSDT");
  const btc = prices.json?.BTCUSDT;
  check("GET /api/v2/prices", prices.status === 200 && btc?.price > 0,
    btc ? `BTCUSDT ${btc.price} (${btc.ageMs}ms old, ${btc.source})` : "no price");

  const health = await req("/api/v2/feed/health");
  check("upstream feed connected", health.json?.connected === true,
    `${health.json?.messages} msgs, ${health.json?.tracked} symbols`);

  // -- funding -----------------------------------------------------------
  // A brand new paper account is funded at creation, but this run may follow a
  // previous one that spent it, so top up rather than assume.
  const bal0 = await req("/api/v2/balances");
  if (Number(bal0.json?.balances?.cash ?? 0) < 10000) {
    const dep = await req("/api/v2/deposit", { method: "POST", body: { amount: "100000" } });
    check("POST /api/v2/deposit funds a paper account", dep.status === 200,
      `cash now ${dep.json?.balances?.cash}`);
  }

  const before = await req("/api/v2/balances");
  const startCash = Number(before.json?.balances?.cash ?? 0);
  check("GET /api/v2/balances", before.status === 200, `cash ${before.json?.balances?.cash}`);

  // -- the vulnerability that mattered most ------------------------------
  const forged = await req("/api/v2/orders", {
    method: "POST",
    headers: { "Idempotency-Key": "e2e-forged-" + Date.now() },
    body: { symbol: "BTCUSDT", side: "buy", quantity: "0.001", price: 1, filledPrice: 1 },
  });
  const filled = Number(forged.json?.filledPrice ?? 0);
  check("a forged price in the body is ignored",
    forged.status === 201 && filled > 1000,
    `client said 1, server filled at ${forged.json?.filledPrice}`);

  // -- idempotency -------------------------------------------------------
  const key = "e2e-idem-" + Date.now();
  const first = await req("/api/v2/orders", {
    method: "POST", headers: { "Idempotency-Key": key },
    body: { symbol: "BTCUSDT", side: "buy", quantity: "0.001" },
  });
  const replay = await req("/api/v2/orders", {
    method: "POST", headers: { "Idempotency-Key": key },
    body: { symbol: "BTCUSDT", side: "buy", quantity: "0.001" },
  });
  check("a repeated Idempotency-Key replays",
    first.json?.id && replay.json?.id === first.json?.id && replay.json?.replayed === true,
    `same order id, replayed=${replay.json?.replayed}`);

  const noKey = await req("/api/v2/orders", {
    method: "POST",
    body: { symbol: "BTCUSDT", side: "buy", quantity: "0.001" },
  });
  check("a missing Idempotency-Key is refused", noKey.status === 400, noKey.json?.code);

  // -- validation --------------------------------------------------------
  const badQty = await req("/api/v2/orders", {
    method: "POST", headers: { "Idempotency-Key": "e2e-bad-" + Date.now() },
    body: { symbol: "BTCUSDT", side: "buy", quantity: "0.0000001" },
  });
  check("below-minimum quantity is refused", badQty.status === 400, badQty.json?.code);

  const badSymbol = await req("/api/v2/orders", {
    method: "POST", headers: { "Idempotency-Key": "e2e-sym-" + Date.now() },
    body: { symbol: "NOTREAL", side: "buy", quantity: "1" },
  });
  check("an unknown instrument is refused", badSymbol.status === 404, badSymbol.json?.code);

  // -- the books ---------------------------------------------------------
  const audit = await req("/api/v2/audit");
  check("ledger audit passes", audit.json?.ok === true,
    audit.json?.perCurrency?.map((c) => `${c.currency} net ${c.net}`).join(", "));

  const summary = await req("/api/v2/summary");
  check("GET /api/v2/summary marks positions",
    summary.status === 200 && Array.isArray(summary.json?.positions),
    `${summary.json?.positions?.length} open, unrealised ${summary.json?.unrealisedPnl}`);

  const ledgerRows = await req("/api/v2/ledger?limit=5");
  check("ledger history is readable",
    Array.isArray(ledgerRows.json) && ledgerRows.json.length > 0,
    `${ledgerRows.json?.length} recent entries`);

  // -- close it out ------------------------------------------------------
  const closed = await req("/api/v2/positions/close", {
    method: "POST", headers: { "Idempotency-Key": "e2e-close-" + Date.now() },
    body: { symbol: "BTCUSDT" },
  });
  check("position closes", closed.status === 200, `pnl ${closed.json?.pnl}, fee ${closed.json?.fee}`);

  const after = await req("/api/v2/audit");
  check("books still balance after the round trip", after.json?.ok === true);

  // -- websocket ---------------------------------------------------------
  const wsUrl = BASE.replace(/^http/, "ws") + "/ws";
  const wsOk = await new Promise((resolve) => {
    const ws = new WebSocket(wsUrl);
    let gotHello = false, gotTick = false;
    const done = setTimeout(() => { ws.close(); resolve({ gotHello, gotTick }); }, 12_000);

    ws.on("open", () => ws.send(JSON.stringify({ type: "subscribe", symbols: ["BTCUSDT"] })));
    ws.on("message", (raw) => {
      const msg = JSON.parse(raw);
      if (msg.type === "hello") gotHello = true;
      if (msg.type === "tick" && msg.data.symbol === "BTCUSDT") {
        gotTick = true;
        clearTimeout(done);
        ws.close();
        resolve({ gotHello, gotTick });
      }
    });
    ws.on("error", () => { clearTimeout(done); resolve({ gotHello, gotTick }); });
  });
  check("WebSocket handshake", wsOk.gotHello);
  check("WebSocket streams live ticks", wsOk.gotTick);

  // -- CORS --------------------------------------------------------------
  const evil = await fetch(BASE + "/api/v2/me", { headers: { Origin: "https://evil.example" } });
  check("CORS rejects an unknown origin", evil.status >= 400 || !evil.headers.get("access-control-allow-origin"),
    `status ${evil.status}`);

  // ----------------------------------------------------------------------
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  if (failed.length) {
    console.log("failed:", failed.map((f) => f.name).join(", "));
    process.exit(1);
  }
  process.exit(0);
})().catch((e) => { console.error("e2e crashed:", e); process.exit(1); });
