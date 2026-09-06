#!/usr/bin/env node
"use strict";
/**
 * Phase 4 and 5 verification against a running server.
 *
 * Covers what unit tests cannot: the WebSocket auth handshake, the journal's
 * refusal to call a small sample meaningful, and the runner's safety locks.
 */
const WebSocket = require("ws");
const BASE = process.env.API_URL || "http://localhost:3002";
let failures = 0, token = null;

const check = (name, ok, detail = "") => {
  if (!ok) failures++;
  console.log(`  ${ok ? "✓" : "✖"} ${name}${detail ? "  — " + detail : ""}`);
};

async function call(path, { method = "GET", body, headers = {}, auth = true } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: { "Content-Type": "application/json",
               ...(auth && token ? { Authorization: `Bearer ${token}` } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null; try { json = JSON.parse(text); } catch {}
  return { status: res.status, json };
}

(async () => {
  console.log("\nphase 4 + 5 verification\n");

  const email = `p45-${Date.now()}@example.com`;
  const reg = await call("/api/auth/register", { method: "POST", auth: false,
    body: { email, password: "correct-horse-battery-p45" } });
  token = reg.json?.accessToken;
  check("registered a user", reg.status === 201, email);

  const me = await call("/api/v2/me");
  const accountId = me.json?.accounts?.[0]?.id;

  // ---- journal ----
  const perf = await call("/api/v2/journal/performance");
  check("GET /journal/performance", perf.status === 200,
    `${perf.json?.trades} trades, significant=${perf.json?.significant}`);
  check("a zero-trade sample is NOT called significant", perf.json?.significant === false);
  check("expectancy carries a confidence interval",
    Array.isArray(perf.json?.expectancy95), JSON.stringify(perf.json?.expectancy95));

  check("GET /journal/trades", (await call("/api/v2/journal/trades")).status === 200);
  check("GET /journal/breakdown", (await call("/api/v2/journal/breakdown")).status === 200);

  // Make a real round trip so the journal has something to analyse.
  const buy = await call("/api/v2/orders", { method: "POST",
    headers: { "Idempotency-Key": "p45-" + Date.now() },
    body: { symbol: "BTCUSDT", side: "buy", quantity: "0.001" } });
  if (buy.status === 201) {
    await call("/api/v2/positions/close", { method: "POST",
      headers: { "Idempotency-Key": "p45c-" + Date.now() },
      body: { symbol: "BTCUSDT" } });
    const after = await call("/api/v2/journal/performance");
    check("journal picks up a closed trade", after.json?.trades === 1,
      `net ${after.json?.realisedPnl}, fees ${after.json?.feesPaid}`);
    check("one trade is still not significant", after.json?.significant === false);
  }

  // ---- runner safety ----
  const armed = await call("/api/v2/runner", { method: "POST",
    body: { action: "start", dryRun: true } });
  check("runner refuses without QSMC_EXECUTION_ENABLED",
    armed.status === 403, armed.json?.code);
  check("GET /runner reports not running",
    (await call("/api/v2/runner")).json?.running === false);

  // ---- websocket auth ----
  const wsUrl = BASE.replace(/^http/, "ws") + "/ws";
  const wsResult = await new Promise((resolve) => {
    const ws = new WebSocket(wsUrl);
    const out = { hello: false, authRequired: false, deniedBeforeAuth: false,
                  authed: false, watching: false, deniedOther: false };
    let phase = 0;
    const done = setTimeout(() => { ws.close(); resolve(out); }, 15000);

    ws.on("open", () => ws.send(JSON.stringify({ type: "watch_account", accountId })));
    ws.on("message", (raw) => {
      const m = JSON.parse(raw);
      if (m.type === "hello") { out.hello = true; out.authRequired = m.data.authRequired === true; }
      if (m.type === "error" && m.data.code === "NOT_AUTHENTICATED" && phase === 0) {
        out.deniedBeforeAuth = true; phase = 1;
        ws.send(JSON.stringify({ type: "auth", token }));
      }
      if (m.type === "authenticated") {
        out.authed = true;
        ws.send(JSON.stringify({ type: "watch_account", accountId }));
      }
      if (m.type === "watching") {
        out.watching = true;
        // Now try someone else's account id.
        ws.send(JSON.stringify({ type: "watch_account", accountId: "6a9d0000000000000000dead" }));
      }
      if (m.type === "error" && m.data.code === "NOT_FOUND") {
        out.deniedOther = true; clearTimeout(done); ws.close(); resolve(out);
      }
    });
    ws.on("error", () => { clearTimeout(done); resolve(out); });
  });

  check("ws announces that auth is required", wsResult.authRequired);
  check("ws refuses watch_account before auth", wsResult.deniedBeforeAuth);
  check("ws accepts a valid token", wsResult.authed);
  check("ws allows watching your OWN account", wsResult.watching);
  check("ws refuses someone else's account", wsResult.deniedOther);

  console.log(`\n${failures === 0 ? "all passed" : failures + " FAILED"}\n`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.error("crashed:", e.message); process.exit(1); });
