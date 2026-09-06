import React, { useCallback, useEffect, useState } from "react";
import * as api from "../../lib/api";
import { useMarketData } from "../../lib/marketdata";
import "./Tables.css";

/**
 * Open positions, marked to live prices.
 *
 * Unrealised P&L is computed here from the live tick because it changes many
 * times a second and asking the server for it would be pointless traffic.
 * REALISED P&L is never computed here — that comes from the ledger, because a
 * booked number must not depend on what a browser happened to calculate.
 */
const n = (v) => (v == null || v === "" ? 0 : Number(v));
const money = (v) =>
  n(v).toLocaleString("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 });

const Positions = () => {
  const [positions, setPositions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [closing, setClosing] = useState(null);
  const { prices, subscribe, status } = useMarketData();

  const load = useCallback(async () => {
    try {
      const rows = await api.positions("open");
      setPositions(rows);
      subscribe(rows.map((p) => p.symbol));
      setError(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [subscribe]);

  useEffect(() => { load(); }, [load]);

  const close = async (symbol) => {
    setClosing(symbol);
    try {
      const res = await api.closePosition({ symbol });
      await load();
      window.alert(`Closed ${symbol} at ${res.price} — P&L ${money(res.pnl)}`);
    } catch (err) {
      window.alert(`Could not close ${symbol}: ${err.message}`);
    } finally {
      setClosing(null);
    }
  };

  if (loading) return <p className="table-loading">Loading positions…</p>;
  if (error) return <div className="table-error">{error}</div>;

  if (!positions.length) {
    return (
      <div className="table-empty">
        <p>No open positions.</p>
        <p className="muted">Buy something from the watchlist to open one.</p>
      </div>
    );
  }

  let totalUnrealised = 0;

  const rows = positions.map((p) => {
    const last = prices[p.symbol]?.price ?? null;
    const qty = n(p.quantity);
    const avg = n(p.averagePrice);
    // long gains when price rises; short gains when it falls
    const pnl = last == null ? null
      : (p.side === "long" ? (last - avg) : (avg - last)) * qty;
    if (pnl != null) totalUnrealised += pnl;
    return { ...p, last, qty, avg, pnl };
  });

  return (
    <div className="table-page">
      <div className="table-head">
        <h3>Positions ({positions.length})</h3>
        <span className={`feed-badge ${status}`}>
          {status === "live" ? "live prices" : status.replace("-", " ")}
        </span>
      </div>

      <div className="table-scroll">
        <table className="data-table">
          <thead>
            <tr>
              <th>Instrument</th><th>Side</th>
              <th className="num">Qty</th><th className="num">Avg</th>
              <th className="num">Last</th><th className="num">Unrealised</th>
              <th className="num">Realised</th><th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => (
              <tr key={p._id}>
                <td className="sym">{p.symbol}</td>
                <td><span className={`pill ${p.side}`}>{p.side}</span></td>
                <td className="num">{p.quantity}</td>
                <td className="num">{p.avg.toFixed(2)}</td>
                <td className="num">{p.last == null ? "—" : p.last.toFixed(2)}</td>
                <td className={`num ${p.pnl == null ? "" : p.pnl >= 0 ? "gain" : "loss"}`}>
                  {p.pnl == null ? "waiting for price" : money(p.pnl)}
                </td>
                <td className="num">{money(p.realizedPnl?.amount ?? 0)}</td>
                <td className="num">
                  <button className="btn-close" disabled={closing === p.symbol}
                          onClick={() => close(p.symbol)}>
                    {closing === p.symbol ? "…" : "Close"}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="table-total">
        <span>Total unrealised</span>
        <strong className={totalUnrealised >= 0 ? "gain" : "loss"}>{money(totalUnrealised)}</strong>
      </div>
    </div>
  );
};

export default Positions;
