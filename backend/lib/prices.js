"use strict";

/**
 * Server-side market data.
 *
 * WHY THIS MOVED OFF THE BROWSER
 * ------------------------------
 * The dashboard connected to Finnhub's WebSocket directly from the client. Two
 * consequences, both bad:
 *
 *   1. The API key shipped inside the JavaScript bundle. Verified: the key is
 *      readable in `build/static/js/main.*.js`. Any visitor can take it and
 *      burn your quota.
 *   2. The SERVER never saw a price. So it had to accept whatever price the
 *      client claimed when placing an order — which means anyone could buy at
 *      any number they liked. You cannot fix that on the client.
 *
 * One upstream connection per process now feeds every browser through our own
 * socket. The key stays on the server, and the server can price orders itself.
 *
 * STALENESS IS A FIRST-CLASS CONCERN
 * ----------------------------------
 * A cached price is a claim about the past. Filling an order against a tick
 * from two minutes ago is worse than refusing, so `getPrice` reports how old
 * its answer is and callers that move money must demand a fresh one.
 */

const EventEmitter = require("node:events");
const WebSocket = require("ws");

const BINANCE_WS = "wss://stream.binance.com:9443/stream";
const BINANCE_REST = "https://api.binance.com/api/v3";

/** Beyond this, a cached tick may not be used to fill an order. */
const DEFAULT_MAX_AGE_MS = 5_000;

class PriceFeed extends EventEmitter {
  constructor({ symbols = [], maxAgeMs = DEFAULT_MAX_AGE_MS } = {}) {
    super();
    this.symbols = new Set(symbols.map((s) => s.toUpperCase()));
    this.maxAgeMs = maxAgeMs;
    this.last = new Map();          // SYMBOL -> { price, ts, source }
    this.ws = null;
    this.connected = false;
    this.reconnectAttempts = 0;
    this.reconnectTimer = null;
    this.stopped = false;
    this.stats = { messages: 0, reconnects: 0, restFallbacks: 0, lastError: null };
  }

  // -- lifecycle ---------------------------------------------------------
  start() {
    this.stopped = false;
    this._connect();
    return this;
  }

  stop() {
    this.stopped = true;
    clearTimeout(this.reconnectTimer);
    if (this.ws) {
      this.ws.removeAllListeners();
      this.ws.close();
      this.ws = null;
    }
    this.connected = false;
  }

  _streamUrl() {
    const streams = [...this.symbols].map((s) => `${s.toLowerCase()}@trade`).join("/");
    return `${BINANCE_WS}?streams=${streams}`;
  }

  _connect() {
    if (this.stopped || this.symbols.size === 0) return;

    const url = this._streamUrl();
    this.ws = new WebSocket(url, { handshakeTimeout: 15_000 });

    this.ws.on("open", () => {
      this.connected = true;
      this.reconnectAttempts = 0;
      this.emit("status", { connected: true, symbols: [...this.symbols] });
    });

    this.ws.on("message", (raw) => {
      this.stats.messages++;
      let msg;
      try {
        msg = JSON.parse(raw);
      } catch {
        return;                       // a malformed frame must not kill the feed
      }
      const d = msg.data;
      if (!d || d.e !== "trade") return;

      const symbol = String(d.s).toUpperCase();
      const price = Number(d.p);
      if (!Number.isFinite(price) || price <= 0) return;

      const tick = { price, ts: Date.now(), source: "binance_ws" };
      this.last.set(symbol, tick);
      this.emit("tick", { symbol, ...tick });
    });

    this.ws.on("error", (err) => {
      this.stats.lastError = err.message;
      this.emit("status", { connected: false, error: err.message });
    });

    this.ws.on("close", () => {
      this.connected = false;
      if (!this.stopped) this._scheduleReconnect();
    });
  }

  /**
   * Exponential backoff with jitter. A fixed retry interval turns one upstream
   * blip into a synchronised stampede from every instance you run.
   */
  _scheduleReconnect() {
    this.stats.reconnects++;
    const attempt = Math.min(++this.reconnectAttempts, 8);
    const base = Math.min(30_000, 500 * 2 ** attempt);
    const delay = base / 2 + Math.random() * (base / 2);
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = setTimeout(() => this._connect(), delay);
  }

  subscribe(symbol) {
    const s = String(symbol).toUpperCase();
    if (this.symbols.has(s)) return;
    this.symbols.add(s);
    // The combined-stream URL is fixed at connect time, so re-open to pick it
    // up. Cheap, and it happens once per new instrument rather than per client.
    if (this.ws) this.ws.close();
    else this._connect();
  }

  // -- reads -------------------------------------------------------------
  peek(symbol) {
    return this.last.get(String(symbol).toUpperCase()) || null;
  }

  /**
   * A price fit to act on.
   *
   * @param {object} opts.maxAgeMs   how stale is tolerable
   * @param {boolean} opts.allowRest fall back to a REST fetch when the cached
   *                                 tick is too old (adds latency, gains truth)
   */
  async getPrice(symbol, { maxAgeMs = this.maxAgeMs, allowRest = true } = {}) {
    const s = String(symbol).toUpperCase();
    const cached = this.last.get(s);
    const age = cached ? Date.now() - cached.ts : Infinity;

    if (cached && age <= maxAgeMs) {
      return { symbol: s, price: cached.price, ts: cached.ts, ageMs: age, source: cached.source, stale: false };
    }

    if (!allowRest) {
      return cached
        ? { symbol: s, price: cached.price, ts: cached.ts, ageMs: age, source: cached.source, stale: true }
        : null;
    }

    const fresh = await this._fetchRest(s);
    if (fresh) return fresh;

    // Report the stale value rather than inventing one; the caller decides.
    return cached
      ? { symbol: s, price: cached.price, ts: cached.ts, ageMs: age, source: cached.source, stale: true }
      : null;
  }

  async _fetchRest(symbol) {
    this.stats.restFallbacks++;
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 5000);
      const res = await fetch(`${BINANCE_REST}/ticker/price?symbol=${encodeURIComponent(symbol)}`, {
        signal: ctrl.signal,
      });
      clearTimeout(timer);
      if (!res.ok) return null;
      const body = await res.json();
      const price = Number(body.price);
      if (!Number.isFinite(price) || price <= 0) return null;

      const tick = { price, ts: Date.now(), source: "binance_rest" };
      this.last.set(symbol, tick);
      return { symbol, ...tick, ageMs: 0, stale: false };
    } catch {
      return null;
    }
  }

  snapshot() {
    const out = {};
    const now = Date.now();
    for (const [symbol, t] of this.last) {
      out[symbol] = { price: t.price, ts: t.ts, ageMs: now - t.ts, source: t.source };
    }
    return out;
  }

  health() {
    return {
      connected: this.connected,
      symbols: [...this.symbols],
      tracked: this.last.size,
      ...this.stats,
    };
  }
}

// A single feed per process. Multiple upstream connections for the same
// symbols would be wasted quota and would let two parts of the app disagree
// about the current price.
let singleton = null;

function getFeed() {
  if (!singleton) {
    const symbols = (process.env.FEED_SYMBOLS || "BTCUSDT,ETHUSDT,SOLUSDT,BNBUSDT")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    singleton = new PriceFeed({ symbols }).start();
  }
  return singleton;
}

module.exports = { PriceFeed, getFeed, DEFAULT_MAX_AGE_MS };
