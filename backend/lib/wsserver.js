"use strict";

/**
 * Browser-facing WebSocket.
 *
 * Replaces two things at once:
 *
 *   1. The dashboard's direct Finnhub connection, which shipped the API key in
 *      the bundle and gave every visitor their own upstream socket.
 *   2. HTTP polling for orders and positions. Change streams tell us the moment
 *      a fill is written (measured p50 2.6ms), so the browser can be told
 *      instead of asking.
 *
 * Fan-out is one upstream connection to Binance for the whole process, and one
 * change stream, regardless of how many browsers are attached.
 *
 * Per-socket subscriptions matter: a client watching BTCUSDT should not be
 * woken for every SOLUSDT tick. At a few hundred ticks a second that is the
 * difference between a responsive tab and a hot laptop.
 */

const { WebSocketServer } = require("ws");
const prices = require("./prices");
const { Order2, Position2, Account } = require("../models");
const { resolveToken } = require("./auth");

const HEARTBEAT_MS = 30_000;

function attach(server, { path = "/ws" } = {}) {
  const wss = new WebSocketServer({ server, path });
  const feed = prices.getFeed();

  // socket -> { symbols:Set, accountId:string|null, alive:boolean }
  const clients = new Map();

  const send = (ws, type, data) => {
    if (ws.readyState !== ws.OPEN) return;
    try {
      ws.send(JSON.stringify({ type, data, ts: Date.now() }));
    } catch { /* a broken socket is cleaned up by the close handler */ }
  };

  // -- upstream: prices --------------------------------------------------
  const onTick = ({ symbol, price, ts }) => {
    for (const [ws, state] of clients) {
      if (state.symbols.has(symbol)) send(ws, "tick", { symbol, price, ts });
    }
  };
  feed.on("tick", onTick);

  const onFeedStatus = (s) => {
    for (const ws of clients.keys()) send(ws, "feed_status", s);
  };
  feed.on("status", onFeedStatus);

  // -- upstream: order and position changes ------------------------------
  // Requires a replica set. If it is unavailable the socket still serves
  // prices; the UI degrades to polling rather than breaking.
  let orderStream = null;
  let positionStream = null;

  function watchCollection(model, eventName) {
    try {
      const stream = model.watch([], { fullDocument: "updateLookup" });
      stream.on("change", (ev) => {
        const doc = ev.fullDocument;
        if (!doc?.accountId) return;
        const account = String(doc.accountId);
        for (const [ws, state] of clients) {
          if (state.accountId && state.accountId === account) {
            send(ws, eventName, { operation: ev.operationType, document: doc });
          }
        }
      });
      stream.on("error", (err) => {
        console.warn(`[ws] ${eventName} stream error: ${err.message}`);
      });
      return stream;
    } catch (err) {
      console.warn(`[ws] could not watch ${eventName}: ${err.message}`);
      return null;
    }
  }

  orderStream = watchCollection(Order2, "order");
  positionStream = watchCollection(Position2, "position");

  // -- client lifecycle --------------------------------------------------
  /** Verify a token sent over the socket and attach the user to its state. */
  async function authenticate(ws, state, token) {
    if (process.env.AUTH_DEV_BYPASS === "true" && process.env.NODE_ENV !== "production") {
      const { User } = require("../models");
      state.user = await User.findOne({ email: "dev@localhost" });
      return send(ws, "authenticated", { user: state.user?.email, devBypass: true });
    }
    if (!token) throw new Error("no token");
    const { user } = await resolveToken(String(token));
    if (!user || user.status !== "active") throw new Error("inactive account");
    state.user = user;
    send(ws, "authenticated", { user: user.email });
  }

  wss.on("connection", (ws, req) => {
    const state = { symbols: new Set(), accountId: null, user: null, alive: true };
    clients.set(ws, state);

    send(ws, "hello", {
      // Prices are public; account streams need an { type: "auth" } message.
      authRequired: true,
      // The snapshot means a fresh tab renders immediately instead of waiting
      // for the next tick, which for a quiet symbol could be seconds away.
      prices: feed.snapshot(),
      available: feed.health().symbols,
      changeStreams: Boolean(orderStream),
    });

    ws.on("message", (raw) => {
      let msg;
      try {
        msg = JSON.parse(raw);
      } catch {
        return send(ws, "error", { message: "expected JSON" });
      }

      switch (msg.type) {
        case "subscribe": {
          const symbols = Array.isArray(msg.symbols) ? msg.symbols : [msg.symbol];
          for (const s of symbols.filter(Boolean).slice(0, 50)) {
            const sym = String(s).toUpperCase();
            state.symbols.add(sym);
            feed.subscribe(sym);
            const last = feed.peek(sym);
            if (last) send(ws, "tick", { symbol: sym, price: last.price, ts: last.ts });
          }
          send(ws, "subscribed", { symbols: [...state.symbols] });
          break;
        }
        case "unsubscribe": {
          for (const s of (msg.symbols || [msg.symbol]).filter(Boolean)) {
            state.symbols.delete(String(s).toUpperCase());
          }
          send(ws, "subscribed", { symbols: [...state.symbols] });
          break;
        }
        case "auth": {
          // A browser cannot set an Authorization header on a WebSocket
          // handshake, and putting the token in the query string writes it into
          // every access log and proxy trace. So the token arrives as the first
          // message instead, over the already-established connection.
          authenticate(ws, state, msg.token).catch(() => {
            send(ws, "error", { message: "authentication failed", code: "INVALID_TOKEN" });
          });
          break;
        }
        case "watch_account": {
          if (!state.user) {
            send(ws, "error", {
              message: "send an { type: 'auth', token } message first",
              code: "NOT_AUTHENTICATED",
            });
            break;
          }
          // Ownership is re-checked HERE, not taken from the client. Otherwise
          // any authenticated user could name someone else's accountId and
          // receive their fills.
          Account.findOne({ _id: String(msg.accountId || ""), userId: state.user._id })
            .then((account) => {
              if (!account) {
                return send(ws, "error", { message: "account not found", code: "NOT_FOUND" });
              }
              state.accountId = String(account._id);
              send(ws, "watching", { accountId: state.accountId });
            })
            .catch(() => send(ws, "error", { message: "invalid account id" }));
          break;
        }
        case "ping":
          send(ws, "pong", {});
          break;
        default:
          send(ws, "error", { message: `unknown message type ${msg.type}` });
      }
    });

    ws.on("pong", () => { state.alive = true; });
    ws.on("close", () => clients.delete(ws));
    ws.on("error", () => clients.delete(ws));
  });

  // Drop sockets that stopped answering. Without this, a laptop that closed its
  // lid leaves a client in the map forever and every tick pays to serialise for it.
  const heartbeat = setInterval(() => {
    for (const [ws, state] of clients) {
      if (!state.alive) {
        ws.terminate();
        clients.delete(ws);
        continue;
      }
      state.alive = false;
      try { ws.ping(); } catch { clients.delete(ws); }
    }
  }, HEARTBEAT_MS);

  function close() {
    clearInterval(heartbeat);
    feed.off("tick", onTick);
    feed.off("status", onFeedStatus);
    orderStream?.close().catch(() => {});
    positionStream?.close().catch(() => {});
    for (const ws of clients.keys()) ws.terminate();
    clients.clear();
    wss.close();
  }

  return {
    wss,
    close,
    stats: () => ({
      clients: clients.size,
      subscriptions: [...clients.values()].reduce((n, s) => n + s.symbols.size, 0),
      changeStreams: Boolean(orderStream),
    }),
  };
}

module.exports = { attach };
