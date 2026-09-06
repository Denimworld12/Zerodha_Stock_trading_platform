import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { API_URL } from "../config";
import { getToken } from "./api";

/**
 * Live prices from OUR server.
 *
 * Replaces FinnhubContext, which opened a WebSocket to Finnhub directly from
 * the browser using an API key inlined in the bundle. Two problems that were
 * really one: the key was public, and the server had no idea what anything was
 * worth — which is why it had to accept whatever price the client claimed when
 * placing an order.
 *
 * Now there is one upstream connection per server process and the browser talks
 * only to us.
 *
 * The old version also had a reconnect bug worth not repeating: its effect ran
 * once with an empty dependency array, so when the socket dropped it stayed
 * dropped until a full page reload.
 */

const MarketDataContext = createContext(null);

export const useMarketData = () => {
  const ctx = useContext(MarketDataContext);
  if (!ctx) throw new Error("useMarketData must be used inside <MarketDataProvider>");
  return ctx;
};

const WS_URL = API_URL.replace(/^http/, "ws") + "/ws";
const MAX_BACKOFF_MS = 30_000;

export const MarketDataProvider = ({ children, symbols = [] }) => {
  const [prices, setPrices] = useState({});
  const [status, setStatus] = useState("connecting");

  const socketRef = useRef(null);
  const wantedRef = useRef(new Set(symbols));
  const attemptRef = useRef(0);
  const timerRef = useRef(null);
  const closedRef = useRef(false);

  // Prices arrive far faster than React should re-render. Ticks are buffered
  // and flushed on a timer, so a hundred ticks a second become a handful of
  // renders instead of a hundred.
  const bufferRef = useRef({});
  const flushRef = useRef(null);

  useEffect(() => {
    closedRef.current = false;

    const scheduleFlush = () => {
      if (flushRef.current) return;
      flushRef.current = setTimeout(() => {
        flushRef.current = null;
        const batch = bufferRef.current;
        bufferRef.current = {};
        if (Object.keys(batch).length) setPrices((prev) => ({ ...prev, ...batch }));
      }, 200);
    };

    const connect = () => {
      if (closedRef.current) return;
      const ws = new WebSocket(WS_URL);
      socketRef.current = ws;

      ws.onopen = () => {
        attemptRef.current = 0;
        setStatus("live");
        // A browser cannot set an Authorization header on a WebSocket
        // handshake, so the token is sent as the first message. Prices work
        // without it; only account streams require it.
        const token = getToken();
        if (token) ws.send(JSON.stringify({ type: "auth", token }));
        const list = [...wantedRef.current];
        if (list.length) ws.send(JSON.stringify({ type: "subscribe", symbols: list }));
      };

      ws.onmessage = (event) => {
        let msg;
        try {
          msg = JSON.parse(event.data);
        } catch {
          return;
        }

        if (msg.type === "hello") {
          // A snapshot on connect, so a fresh tab renders immediately instead
          // of waiting for the next tick — which on a quiet symbol is seconds.
          const seed = {};
          for (const [sym, t] of Object.entries(msg.data.prices || {})) {
            seed[sym] = { price: t.price, ts: t.ts };
          }
          if (Object.keys(seed).length) setPrices((prev) => ({ ...seed, ...prev }));
        } else if (msg.type === "tick") {
          bufferRef.current[msg.data.symbol] = { price: msg.data.price, ts: msg.data.ts };
          scheduleFlush();
        } else if (msg.type === "feed_status" && msg.data.connected === false) {
          setStatus("upstream-down");
        }
      };

      ws.onerror = () => setStatus("error");

      ws.onclose = () => {
        if (closedRef.current) return;
        setStatus("reconnecting");
        // Exponential backoff with jitter. A fixed retry means every open tab
        // reconnects in lockstep and hammers the server the moment it restarts.
        const attempt = Math.min(++attemptRef.current, 6);
        const base = Math.min(MAX_BACKOFF_MS, 500 * 2 ** attempt);
        timerRef.current = setTimeout(connect, base / 2 + Math.random() * (base / 2));
      };
    };

    connect();

    return () => {
      closedRef.current = true;
      clearTimeout(timerRef.current);
      clearTimeout(flushRef.current);
      flushRef.current = null;
      socketRef.current?.close();
      socketRef.current = null;
    };
  }, []);

  const subscribe = useMemo(() => (symbolOrList) => {
    const list = (Array.isArray(symbolOrList) ? symbolOrList : [symbolOrList])
      .filter(Boolean)
      .map((s) => String(s).toUpperCase())
      .filter((s) => !wantedRef.current.has(s));
    if (!list.length) return;

    list.forEach((s) => wantedRef.current.add(s));
    const ws = socketRef.current;
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "subscribe", symbols: list }));
    }
    // If the socket is not open yet, onopen replays the whole wanted set.
  }, []);

  const value = useMemo(
    () => ({
      prices,
      status,
      subscribe,
      priceOf: (symbol) => prices[String(symbol || "").toUpperCase()]?.price ?? null,
    }),
    [prices, status, subscribe]
  );

  return <MarketDataContext.Provider value={value}>{children}</MarketDataContext.Provider>;
};

export default MarketDataContext;
