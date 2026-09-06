import { API_URL } from "../config";

/**
 * API client.
 *
 * TOKEN STORAGE
 * -------------
 * The access token lives in a module variable — in memory only, never in
 * localStorage. A token in localStorage is readable by any script the page
 * loads, so one XSS bug or one compromised npm package hands over the session.
 * In memory it dies with the tab, which is exactly what we want.
 *
 * Surviving a page reload is the refresh token's job, and that lives in an
 * httpOnly cookie the browser sends automatically and JavaScript cannot read.
 * So: `restoreSession()` on boot silently exchanges that cookie for a fresh
 * access token.
 *
 * CONCURRENT REFRESH
 * ------------------
 * When several requests hit a 401 at once, they must not each start their own
 * refresh — the second one would replay an already-rotated token, which the
 * server correctly treats as theft and revokes the whole session. So the first
 * refresh is shared and everyone else awaits it.
 */

let accessToken = null;
let refreshPromise = null;
const listeners = new Set();

export function getToken() {
  return accessToken;
}

export function setToken(token) {
  accessToken = token || null;
  listeners.forEach((fn) => fn(accessToken));
}

/** Notified whenever the session appears or disappears. */
export function onAuthChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export class ApiError extends Error {
  constructor(message, { status, code, issues, body } = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.issues = issues;
    this.body = body;
  }
}

async function parse(res) {
  const text = await res.text();
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return { error: text };
  }
}

async function raw(path, { method = "GET", body, headers = {}, auth = true } = {}) {
  const res = await fetch(`${API_URL}${path}`, {
    method,
    // Sends the httpOnly refresh cookie. Without this the browser withholds it
    // cross-origin and every reload logs the user out.
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(auth && accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { res, data: await parse(res) };
}

/** Exchange the refresh cookie for a new access token. Shared across callers. */
export function refresh() {
  if (!refreshPromise) {
    refreshPromise = raw("/api/auth/refresh", { method: "POST", body: {}, auth: false })
      .then(({ res, data }) => {
        if (!res.ok) throw new ApiError(data?.error || "session expired", {
          status: res.status, code: data?.code,
        });
        setToken(data.accessToken);
        return data;
      })
      .finally(() => { refreshPromise = null; });
  }
  return refreshPromise;
}

/**
 * The main entry point. Retries ONCE after refreshing on a 401.
 *
 * Only once: if the retry also fails the session is genuinely gone, and looping
 * would spin forever against a dead session.
 */
export async function request(path, options = {}) {
  let { res, data } = await raw(path, options);

  if (res.status === 401 && options.auth !== false && !options._retried) {
    try {
      await refresh();
      ({ res, data } = await raw(path, { ...options, _retried: true }));
    } catch {
      setToken(null);
      throw new ApiError("your session expired; please sign in again", {
        status: 401, code: "SESSION_EXPIRED",
      });
    }
  }

  if (!res.ok) {
    throw new ApiError(data?.error || `request failed (${res.status})`, {
      status: res.status, code: data?.code, issues: data?.issues, body: data,
    });
  }
  return data;
}

export const get = (path) => request(path);
export const post = (path, body, headers) => request(path, { method: "POST", body, headers });

/**
 * Restore a session on page load.
 *
 * Returns null rather than throwing when there is no cookie — "not signed in"
 * is an ordinary state, not an error.
 */
export async function restoreSession() {
  try {
    const data = await refresh();
    return data.user;
  } catch {
    setToken(null);
    return null;
  }
}

// ---------------------------------------------------------------------------
// auth
// ---------------------------------------------------------------------------
export async function login(email, password) {
  const data = await request("/api/auth/login", {
    method: "POST", body: { email, password }, auth: false,
  });
  setToken(data.accessToken);
  return data.user;
}

export async function register(email, password, name) {
  const data = await request("/api/auth/register", {
    method: "POST", body: { email, password, name }, auth: false,
  });
  setToken(data.accessToken);
  return data.user;
}

export async function logout() {
  try {
    await request("/api/auth/logout", { method: "POST", body: {} });
  } catch {
    // A failed logout must still clear the client. The server-side token may
    // already be gone, and leaving the UI signed in would be worse.
  }
  setToken(null);
}

export const authConfig = () => request("/api/auth/config", { auth: false });

// ---------------------------------------------------------------------------
// trading
// ---------------------------------------------------------------------------
export const me = () => get("/api/v2/me");
export const summary = () => get("/api/v2/summary");
export const balances = () => get("/api/v2/balances");
export const positions = (status = "open") => get(`/api/v2/positions?status=${status}`);
export const orders = (limit = 50) => get(`/api/v2/orders?limit=${limit}`);
export const ledger = (limit = 100) => get(`/api/v2/ledger?limit=${limit}`);
export const audit = () => get("/api/v2/audit");
export const instruments = () => get("/api/v2/instruments");
export const prices = (symbols) =>
  get(`/api/v2/prices${symbols ? `?symbols=${encodeURIComponent(symbols.join(","))}` : ""}`);

/**
 * Place an order.
 *
 * The idempotency key is generated HERE, per intent, so that a retry after a
 * dropped connection reuses it and the server replays rather than placing a
 * second order. Generating it server-side would defeat the purpose: only the
 * client knows two requests are the same intent.
 *
 * Note there is no `price` parameter. The server decides the fill price; a
 * price sent from here would be ignored.
 */
export function placeOrder({ symbol, side, quantity, orderType = "market",
                             limitPrice, stopLoss, takeProfit, idempotencyKey }) {
  const key = idempotencyKey ||
    (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`);
  return post("/api/v2/orders",
    { symbol, side, quantity, orderType, limitPrice, stopLoss, takeProfit },
    { "Idempotency-Key": key });
}

export function closePosition({ symbol, quantity, idempotencyKey }) {
  const key = idempotencyKey ||
    (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`);
  return post("/api/v2/positions/close", { symbol, quantity }, { "Idempotency-Key": key });
}

export const deposit = (amount) => post("/api/v2/deposit", { amount });
export const resetAccount = () => post("/api/v2/reset", {});
