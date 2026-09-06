#!/usr/bin/env node
"use strict";
/**
 * Can one user reach another user's data?
 *
 * Multi-tenancy is a claim that is easy to make and easy to get wrong: one
 * forgotten `userId` filter is a silent cross-account leak, and it will not
 * show up in any single-user test. This registers two real users and has each
 * try, directly, to read and to trade the other's account.
 */
const BASE = process.env.API_URL || "http://localhost:3002";
let failures = 0;

function check(name, ok, detail = "") {
  if (!ok) failures++;
  console.log(`  ${ok ? "✓" : "✖"} ${name}${detail ? "  — " + detail : ""}`);
}

async function call(path, token, { method = "GET", body, headers = {} } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch {}
  return { status: res.status, json };
}

async function makeUser(tag) {
  const email = `iso-${tag}-${Date.now()}@example.com`;
  const r = await call("/api/auth/register", null, {
    method: "POST",
    body: { email, password: "correct-horse-battery-iso" },
  });
  if (r.status !== 201) throw new Error(`register failed: ${JSON.stringify(r.json)}`);
  const me = await call("/api/v2/me", r.json.accessToken);
  return { email, token: r.json.accessToken, accountId: me.json.accounts[0].id };
}

(async () => {
  console.log("\ntenant isolation\n");
  const alice = await makeUser("alice");
  const bob = await makeUser("bob");
  check("two distinct users registered", alice.accountId !== bob.accountId,
    `alice ${alice.accountId} / bob ${bob.accountId}`);

  // Give Alice something worth stealing.
  await call("/api/v2/orders", alice.token, {
    method: "POST", headers: { "Idempotency-Key": "iso-a-" + Date.now() },
    body: { symbol: "BTCUSDT", side: "buy", quantity: "0.001" },
  });

  // Bob names Alice's account explicitly on every read path.
  for (const path of ["/api/v2/balances", "/api/v2/summary", "/api/v2/orders",
                      "/api/v2/positions", "/api/v2/ledger", "/api/v2/audit"]) {
    const r = await call(`${path}?accountId=${alice.accountId}`, bob.token);
    const leaked = r.status === 200 &&
      JSON.stringify(r.json).includes(String(alice.accountId));
    check(`bob cannot read alice via ${path}`, !leaked, `HTTP ${r.status}`);
  }

  // ...and on the write paths.
  const order = await call("/api/v2/orders", bob.token, {
    method: "POST", headers: { "Idempotency-Key": "iso-b-" + Date.now() },
    body: { symbol: "BTCUSDT", side: "buy", quantity: "0.001", accountId: alice.accountId },
  });
  check("bob cannot trade on alice's account", order.status === 404, `HTTP ${order.status}`);

  const close = await call("/api/v2/positions/close", bob.token, {
    method: "POST", headers: { "Idempotency-Key": "iso-c-" + Date.now() },
    body: { symbol: "BTCUSDT", accountId: alice.accountId },
  });
  check("bob cannot close alice's position", close.status === 404, `HTTP ${close.status}`);

  const deposit = await call("/api/v2/deposit", bob.token, {
    method: "POST", body: { amount: "999999", accountId: alice.accountId },
  });
  check("bob cannot fund alice's account", deposit.status === 404, `HTTP ${deposit.status}`);

  // Alice's own view must be untouched by all of that.
  const aliceOrders = await call("/api/v2/orders", alice.token);
  check("alice still sees exactly her own orders",
    Array.isArray(aliceOrders.json) && aliceOrders.json.length === 1,
    `${aliceOrders.json?.length} order(s)`);

  const bobOrders = await call("/api/v2/orders", bob.token);
  check("bob sees none of alice's orders",
    Array.isArray(bobOrders.json) && bobOrders.json.length === 0,
    `${bobOrders.json?.length} order(s)`);

  console.log(`\n${failures === 0 ? "no leaks" : failures + " LEAK(S)"}\n`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.error("probe crashed:", e.message); process.exit(1); });
