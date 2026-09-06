"use strict";

/**
 * OANDA v20 adapter — real FX, free practice account, native on Linux.
 *
 * Chosen after testing what is actually free and reachable. MetaTrader 5 was
 * ruled out on one fact: its Python API is Windows-only, and this stack runs on
 * Linux. OANDA is REST + a streaming endpoint, so it needs nothing but a token.
 *
 * FX is the case that matters for the Mirror-Market research: Binance quotes
 * everything in USDT, so BTC/ETH measured rho = +0.85 — a hedge pair, not a
 * mirror. EURUSD/USDCHF measures -0.74 on hourly bars, which is the negative
 * correlation the concept actually assumes.
 *
 * THINGS THAT WILL BITE IF FORGOTTEN
 * ---------------------------------
 *  - Instruments are named EUR_USD, not EURUSD. The underscore is not optional.
 *  - Units carry the direction: 1000 is a buy, -1000 is a sell. There is no
 *    separate side field, so a sign error is a reversed trade, not an error.
 *  - Prices are STRINGS in the API and must stay strings. Parsing a JPY quote
 *    into a float and back loses the pip.
 *  - A "practice" token cannot touch a live account and vice versa; the host
 *    differs, so pointing at the wrong one fails as 401, not as a wrong trade.
 */

const PRACTICE = {
  rest: "https://api-fxpractice.oanda.com/v3",
  stream: "https://stream-fxpractice.oanda.com/v3",
};
const LIVE = {
  rest: "https://api-fxtrade.oanda.com/v3",
  stream: "https://stream-fxtrade.oanda.com/v3",
};

class OandaError extends Error {
  constructor(message, { status, body } = {}) {
    super(message);
    this.code = "OANDA_ERROR";
    this.status = status;
    this.body = body;
  }
}

class OandaClient {
  constructor({
    token = process.env.OANDA_API_TOKEN,
    accountId = process.env.OANDA_ACCOUNT_ID,
    environment = process.env.OANDA_ENV || "practice",
  } = {}) {
    this.token = token;
    this.accountId = accountId;
    this.environment = environment;
    this.hosts = environment === "live" ? LIVE : PRACTICE;
  }

  get configured() {
    return Boolean(this.token && this.accountId);
  }

  /** Explains what is missing rather than failing with a bare 401 later. */
  assertConfigured() {
    if (!this.token) {
      throw new OandaError(
        "OANDA_API_TOKEN is not set. Create a practice account at " +
          "oanda.com, then Manage API Access to generate a token."
      );
    }
    if (!this.accountId) {
      throw new OandaError(
        "OANDA_ACCOUNT_ID is not set. Call listAccounts() with just a token to find it."
      );
    }
  }

  async request(path, { method = "GET", body, host = "rest", timeoutMs = 15000 } = {}) {
    if (!this.token) throw new OandaError("OANDA_API_TOKEN is not set");

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(`${this.hosts[host]}${path}`, {
        method,
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${this.token}`,
          "Content-Type": "application/json",
          // Without this OANDA returns times as floating-point seconds, which
          // silently loses sub-second precision on fills.
          "Accept-Datetime-Format": "RFC3339",
        },
        body: body ? JSON.stringify(body) : undefined,
      });

      const text = await res.text();
      let json = null;
      try { json = text ? JSON.parse(text) : null; } catch { /* keep raw */ }

      if (!res.ok) {
        const msg = json?.errorMessage || json?.message || text.slice(0, 200);
        throw new OandaError(`OANDA ${res.status}: ${msg}`, { status: res.status, body: json });
      }
      return json;
    } catch (err) {
      if (err.name === "AbortError") {
        throw new OandaError(`OANDA request timed out after ${timeoutMs}ms`);
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  // -- discovery ---------------------------------------------------------
  listAccounts() {
    return this.request("/accounts");
  }

  async account() {
    this.assertConfigured();
    const { account } = await this.request(`/accounts/${this.accountId}`);
    return account;
  }

  async summary() {
    this.assertConfigured();
    const { account } = await this.request(`/accounts/${this.accountId}/summary`);
    return account;
  }

  /** Tradable instruments with their pip size and precision. */
  async instruments() {
    this.assertConfigured();
    const { instruments } = await this.request(`/accounts/${this.accountId}/instruments`);
    return instruments.map((i) => ({
      symbol: i.name,                       // EUR_USD
      displayName: i.displayName,
      type: i.type,                         // CURRENCY, CFD, METAL
      pipLocation: i.pipLocation,           // -4 => a pip is 0.0001
      displayPrecision: i.displayPrecision,
      minimumTradeSize: i.minimumTradeSize,
      maximumTradeSize: i.maximumOrderUnits,
      marginRate: i.marginRate,
    }));
  }

  // -- prices ------------------------------------------------------------
  /**
   * Current bid/ask. FX has no single "price": you buy at the ask and sell at
   * the bid, and the gap is most of the cost of trading. Anything that collapses
   * them to a mid will understate its own costs.
   */
  async pricing(symbols) {
    this.assertConfigured();
    const list = (Array.isArray(symbols) ? symbols : [symbols]).join(",");
    const { prices } = await this.request(
      `/accounts/${this.accountId}/pricing?instruments=${encodeURIComponent(list)}`
    );
    return prices.map((p) => ({
      symbol: p.instrument,
      bid: p.bids?.[0]?.price ?? null,
      ask: p.asks?.[0]?.price ?? null,
      time: p.time,
      tradeable: p.tradeable,
      spread: p.bids?.[0] && p.asks?.[0]
        ? Number(p.asks[0].price) - Number(p.bids[0].price)
        : null,
    }));
  }

  /**
   * Historical candles.
   *
   * `price: "M"` gives mid candles, which is what a backtest should model on;
   * "BA" gives bid and ask separately when you want to measure the spread.
   * Note `count` maxes out at 5000 per request.
   */
  async candles(symbol, { granularity = "H1", count = 500, from, to, price = "M" } = {}) {
    this.assertConfigured();
    const params = new URLSearchParams({ granularity, price });
    if (from) params.set("from", from);
    if (to) params.set("to", to);
    if (!from && !to) params.set("count", String(Math.min(count, 5000)));

    const data = await this.request(`/instruments/${symbol}/candles?${params}`);
    return data.candles
      // An incomplete candle is the bar currently forming. Including it makes a
      // backtest read a partial bar as a finished one - a look-ahead leak.
      .filter((c) => c.complete)
      .map((c) => ({
        time: c.time,
        open: c.mid?.o ?? c.bid?.o,
        high: c.mid?.h ?? c.bid?.h,
        low: c.mid?.l ?? c.bid?.l,
        close: c.mid?.c ?? c.bid?.c,
        volume: c.volume,           // tick count, not traded size
      }));
  }

  // -- trading -----------------------------------------------------------
  /**
   * Place a market order.
   *
   * `units` is signed: positive buys, negative sells. Stops and targets ride on
   * the order rather than being placed afterwards, so a disconnect between
   * submitting the entry and submitting the stop cannot leave a naked position.
   */
  async marketOrder({ symbol, units, stopLoss = null, takeProfit = null, clientTag }) {
    this.assertConfigured();
    if (!Number.isFinite(Number(units)) || Number(units) === 0) {
      throw new OandaError("units must be a non-zero number (negative sells)");
    }

    const order = {
      type: "MARKET",
      instrument: symbol,
      units: String(units),
      timeInForce: "FOK",
      positionFill: "DEFAULT",
    };
    if (stopLoss) order.stopLossOnFill = { price: String(stopLoss), timeInForce: "GTC" };
    if (takeProfit) order.takeProfitOnFill = { price: String(takeProfit), timeInForce: "GTC" };
    if (clientTag) {
      // Tags our fills so they can be told apart from anything placed by hand
      // in OANDA's own UI.
      order.clientExtensions = { id: String(clientTag).slice(0, 128), tag: "qsmc" };
    }

    const res = await this.request(`/accounts/${this.accountId}/orders`, {
      method: "POST",
      body: { order },
    });

    // A rejection comes back as HTTP 201 with a cancel transaction. Treating
    // "the request succeeded" as "the order filled" is how a strategy ends up
    // believing it has a position it does not have.
    if (res.orderCancelTransaction) {
      throw new OandaError(
        `order rejected: ${res.orderCancelTransaction.reason}`,
        { body: res }
      );
    }
    const fill = res.orderFillTransaction;
    return {
      ok: Boolean(fill),
      orderId: res.orderCreateTransaction?.id,
      tradeId: fill?.tradeOpened?.tradeID ?? null,
      filledUnits: fill?.units ?? "0",
      filledPrice: fill?.price ?? null,
      // OANDA charges the spread plus financing; commission is usually zero.
      financing: fill?.financing ?? "0",
      commission: fill?.commission ?? "0",
      raw: res,
    };
  }

  async openPositions() {
    this.assertConfigured();
    const { positions } = await this.request(`/accounts/${this.accountId}/openPositions`);
    return positions.map((p) => ({
      symbol: p.instrument,
      longUnits: p.long?.units ?? "0",
      longAvg: p.long?.averagePrice ?? null,
      shortUnits: p.short?.units ?? "0",
      shortAvg: p.short?.averagePrice ?? null,
      unrealizedPL: p.unrealizedPL,
      realizedPL: p.pl,
    }));
  }

  async closePosition(symbol, { longUnits = "ALL", shortUnits = "ALL" } = {}) {
    this.assertConfigured();
    return this.request(`/accounts/${this.accountId}/positions/${symbol}/close`, {
      method: "PUT",
      body: { longUnits, shortUnits },
    });
  }

  async openTrades() {
    this.assertConfigured();
    const { trades } = await this.request(`/accounts/${this.accountId}/openTrades`);
    return trades;
  }

  // -- health ------------------------------------------------------------
  async health() {
    if (!this.configured) {
      return {
        ok: false,
        configured: false,
        environment: this.environment,
        hint: "set OANDA_API_TOKEN and OANDA_ACCOUNT_ID in backend/.env",
      };
    }
    try {
      const s = await this.summary();
      return {
        ok: true,
        configured: true,
        environment: this.environment,
        accountId: s.id,
        currency: s.currency,
        balance: s.balance,
        nav: s.NAV,
        openTrades: s.openTradeCount,
        marginAvailable: s.marginAvailable,
        // Surfaced loudly: a live account behaves identically to a practice one
        // right up until it spends real money.
        isLive: this.environment === "live",
      };
    } catch (err) {
      return { ok: false, configured: true, environment: this.environment, error: err.message };
    }
  }
}

/** OANDA names instruments EUR_USD; ours are EURUSD. */
function toOanda(symbol) {
  const s = String(symbol).toUpperCase().replace(/[^A-Z]/g, "");
  return s.length === 6 ? `${s.slice(0, 3)}_${s.slice(3)}` : s;
}

function fromOanda(symbol) {
  return String(symbol).replace("_", "").toUpperCase();
}

module.exports = { OandaClient, OandaError, toOanda, fromOanda, PRACTICE, LIVE };
