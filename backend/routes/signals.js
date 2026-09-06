const express = require("express");
const { SignalModel } = require("../model/SignalModel");

const router = express.Router();

const SERVICE_URL = process.env.SIGNAL_SERVICE_URL || "http://localhost:8000";
const SECRET = process.env.SIGNAL_WEBHOOK_SECRET || "";

/**
 * Any endpoint that writes signals or reaches the execution path needs the
 * shared secret. Reads stay open so the dashboard can render without one.
 */
function requireSecret(req, res, next) {
  if (!SECRET) {
    return res.status(503).json({ error: "SIGNAL_WEBHOOK_SECRET not configured" });
  }
  if (req.get("x-signal-secret") !== SECRET) {
    return res.status(401).json({ error: "bad or missing x-signal-secret" });
  }
  next();
}

// --- read stored signals ---------------------------------------------------
router.get("/", async (req, res) => {
  try {
    const { symbol, status, limit = 50 } = req.query;
    const q = {};
    if (symbol) q.symbol = symbol.toUpperCase();
    if (status) q.status = status;
    const rows = await SignalModel.find(q)
      .sort({ barTime: -1 })
      .limit(Math.min(Number(limit) || 50, 200));
    res.json(rows);
  } catch (err) {
    console.error("signals fetch failed:", err);
    res.status(500).json({ error: "failed to fetch signals" });
  }
});

// --- live pass-through to the Python service -------------------------------
// Proxied rather than called from the browser so the dashboard needs exactly
// one origin, and so the service can stay on a private network.
router.get("/live", async (req, res) => {
  const symbols = req.query.symbols || "BTCUSDT,ETHUSDT,SOLUSDT,BNBUSDT";
  const interval = req.query.interval || "15m";
  const url = `${SERVICE_URL}/signals?symbols=${encodeURIComponent(symbols)}&interval=${encodeURIComponent(interval)}`;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 20000);
    const r = await fetch(url, { signal: ctrl.signal });
    clearTimeout(timer);
    if (!r.ok) {
      return res.status(502).json({ error: `signal service returned ${r.status}` });
    }
    res.json(await r.json());
  } catch (err) {
    // A dead quant service must not take the dashboard down with it.
    res.status(503).json({
      error: "signal service unreachable",
      detail: String(err.message || err),
      hint: `is uvicorn running at ${SERVICE_URL}?`,
    });
  }
});

// --- persist a signal (called by the engine) -------------------------------
router.post("/", requireSecret, async (req, res) => {
  try {
    const { symbol, timeframe, barTime, side, entry, stop, target, rr,
            confidence, reason, blockedBy, status } = req.body;

    if (!symbol || barTime === undefined || side === undefined) {
      return res.status(400).json({ error: "symbol, barTime and side are required" });
    }

    const doc = await SignalModel.findOneAndUpdate(
      { symbol: symbol.toUpperCase(), timeframe: timeframe || "15m", barTime: new Date(barTime) },
      {
        $set: {
          side, entry, stop, target, rr, confidence, reason, blockedBy,
          status: status || (side === 0 ? "blocked" : "generated"),
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    res.status(201).json(doc);
  } catch (err) {
    console.error("signal upsert failed:", err);
    res.status(500).json({ error: "failed to store signal" });
  }
});

// --- research results for the dashboard ------------------------------------
router.get("/research", async (_req, res) => {
  try {
    const r = await fetch(`${SERVICE_URL}/research/summary`);
    if (!r.ok) return res.status(502).json({ error: `service returned ${r.status}` });
    res.json(await r.json());
  } catch (err) {
    res.status(503).json({ error: "signal service unreachable", detail: String(err.message || err) });
  }
});

module.exports = router;
