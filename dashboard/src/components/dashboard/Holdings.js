import React, { useCallback, useEffect, useState } from "react";
import * as api from "../../lib/api";
import "./Tables.css";

/**
 * Closed positions — the trade history.
 *
 * In the original app Holdings and Positions were two screens showing the same
 * mutable collection. There is one position model now, so this screen takes the
 * half that was missing: what has already been closed, and what it earned.
 * Realised P&L comes from the ledger, so these numbers are auditable.
 */
const money = (v) =>
  Number(v || 0).toLocaleString("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 });

const Holdings = () => {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    try {
      setRows(await api.positions("closed"));
      setError(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  if (loading) return <p className="table-loading">Loading history…</p>;
  if (error) return <div className="table-error">{error}</div>;

  if (!rows.length) {
    return (
      <div className="table-empty">
        <p>No closed trades yet.</p>
        <p className="muted">Once you close a position it appears here with its realised P&amp;L.</p>
      </div>
    );
  }

  const total = rows.reduce((sum, r) => sum + Number(r.realizedPnl?.amount ?? 0), 0);
  const wins = rows.filter((r) => Number(r.realizedPnl?.amount ?? 0) > 0).length;

  return (
    <div className="table-page">
      <div className="table-head">
        <h3>Closed trades ({rows.length})</h3>
        <span className="dim">
          {wins} winners · {rows.length - wins} losers ·{" "}
          {rows.length ? Math.round((wins / rows.length) * 100) : 0}% hit rate
        </span>
      </div>

      <div className="table-scroll">
        <table className="data-table">
          <thead>
            <tr>
              <th>Instrument</th><th>Side</th>
              <th className="num">Avg entry</th><th className="num">Realised P&amp;L</th>
              <th>Opened</th><th>Closed</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const pnl = Number(r.realizedPnl?.amount ?? 0);
              return (
                <tr key={r._id}>
                  <td className="sym">{r.symbol}</td>
                  <td><span className={`pill ${r.side}`}>{r.side}</span></td>
                  <td className="num">{Number(r.averagePrice).toFixed(2)}</td>
                  <td className={`num ${pnl >= 0 ? "gain" : "loss"}`}>{money(pnl)}</td>
                  <td className="dim">{new Date(r.openedAt).toLocaleDateString()}</td>
                  <td className="dim">{r.closedAt ? new Date(r.closedAt).toLocaleDateString() : "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="table-total">
        <span>Total realised</span>
        <strong className={total >= 0 ? "gain" : "loss"}>{money(total)}</strong>
      </div>
    </div>
  );
};

export default Holdings;
