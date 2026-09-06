import React, { useCallback, useEffect, useState } from "react";
import axios from "axios";
import "./Signals.css";

import { API_URL as API } from "../../config";
const SYMBOLS = "BTCUSDT,ETHUSDT,SOLUSDT,BNBUSDT";
const POLL_MS = 60000;

const fmt = (n, d = 2) =>
  n === null || n === undefined || Number.isNaN(n) ? "—" : Number(n).toFixed(d);

/**
 * Live SMC + Mirror-Market signals from the quant engine.
 *
 * Deliberately shows BLOCKED setups alongside live ones. A panel that renders
 * only fires cannot distinguish "the market set nothing up" from "the service
 * died an hour ago", and that ambiguity is exactly when a trader starts
 * guessing.
 */
const Signals = () => {
  const [data, setData] = useState(null);
  const [research, setResearch] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [updatedAt, setUpdatedAt] = useState(null);

  const load = useCallback(async () => {
    try {
      const res = await axios.get(`${API}/signals/live`, {
        params: { symbols: SYMBOLS, interval: "15m" },
        timeout: 30000,
      });
      setData(res.data);
      setError(null);
      setUpdatedAt(new Date());
    } catch (err) {
      setError(
        err.response?.data?.hint ||
          err.response?.data?.error ||
          "Signal service unreachable"
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, POLL_MS);
    return () => clearInterval(id);
  }, [load]);

  useEffect(() => {
    axios
      .get(`${API}/signals/research`, { timeout: 15000 })
      .then((r) => setResearch(r.data))
      .catch(() => setResearch(null));
  }, []);

  const rows = data?.signals || [];
  const live = rows.filter((r) => r.signal);

  return (
    <div className="signals">
      <div className="signals-header">
        <h3>SMC + Mirror Market signals</h3>
        <span className="signals-meta">
          {updatedAt ? `updated ${updatedAt.toLocaleTimeString()}` : ""}
          {" · "}15m · auto-refresh 60s
        </span>
      </div>

      {/* The validation result travels with the signals on purpose. A number
          this weak must not be discoverable only by reading a report. */}
      {research && (
        <div className="signals-verdict">
          <strong>Walk-forward validation:</strong> mean out-of-sample AUC{" "}
          <code>{fmt(research.mean_oof_auc, 3)}</code>
          {research.mean_oof_auc !== null &&
            research.mean_oof_auc !== undefined &&
            research.mean_oof_auc < 0.55 && (
              <span className="warn">
                {" "}
                — at or below 0.5 this model has no demonstrated predictive edge.
                Paper trading only.
              </span>
            )}
        </div>
      )}

      {loading && <p className="signals-empty">Loading…</p>}
      {error && (
        <div className="signals-error">
          <strong>Signal service unavailable.</strong> {error}
        </div>
      )}

      {!loading && !error && (
        <>
          <div className="signals-count">
            {live.length} actionable · {rows.length - live.length} blocked
          </div>
          <table className="signals-table">
            <thead>
              <tr>
                <th>Symbol</th>
                <th>Bias</th>
                <th>Price</th>
                <th>Entry</th>
                <th>Stop</th>
                <th>Target</th>
                <th>R:R</th>
                <th>P(win)</th>
                <th>Confluence / reason</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const s = r.signal;
                const dir = s ? (s.side === 1 ? "LONG" : "SHORT") : "FLAT";
                return (
                  <tr key={r.symbol} className={s ? "active" : "muted"}>
                    <td className="sym">{r.symbol}</td>
                    <td>
                      <span className={`badge ${dir.toLowerCase()}`}>{dir}</span>
                    </td>
                    <td>{fmt(r.close)}</td>
                    <td>{s ? fmt(s.entry) : "—"}</td>
                    <td className="stop">{s ? fmt(s.stop) : "—"}</td>
                    <td className="target">{s ? fmt(s.target) : "—"}</td>
                    <td>{s ? `${fmt(s.rr, 2)}:1` : "—"}</td>
                    <td>{s ? `${(r.p_win * 100).toFixed(1)}%` : "—"}</td>
                    <td className="reason">
                      {s ? s.reason : r.blocked_by || r.error || "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </>
      )}

      <p className="signals-footnote">
        Signals are generated on closed bars only and are never executed
        automatically. Execution requires the shared secret, the
        <code> QSMC_EXECUTION_ENABLED</code> flag and an explicit non-dry-run
        call — three separate locks.
      </p>
    </div>
  );
};

export default Signals;
