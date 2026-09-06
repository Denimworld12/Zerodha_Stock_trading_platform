import React, { useCallback, useEffect, useState } from "react";
import * as api from "../../lib/api";
import { useAuth } from "../../lib/AuthContext";
import { useMarketData } from "../../lib/marketdata";
import "./Tables.css";
import "./Funds.css";

/**
 * Account overview.
 *
 * `equityMarked` is equity from the ledger PLUS unrealised P&L on open
 * positions at the current price. Those are two different kinds of number —
 * one settled and auditable, one an estimate that moves every second — so they
 * are shown separately rather than merged into a single figure that hides
 * which part is real.
 */
const money = (v) =>
  Number(v || 0).toLocaleString("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 });

const Summary = () => {
  const { user } = useAuth();
  const { status } = useMarketData();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    try {
      setData(await api.summary());
      setError(null);
    } catch (err) {
      setError(err.message);
    }
  }, []);

  useEffect(() => {
    load();
    // The summary is a server-side mark, so it is polled rather than pushed.
    // 15s is often enough to feel current without hammering the API; live
    // per-tick movement is on the Positions screen.
    const id = setInterval(load, 15000);
    return () => clearInterval(id);
  }, [load]);

  if (error) return <div className="table-error">{error}</div>;
  if (!data) return <p className="table-loading">Loading…</p>;

  const b = data.balances;
  const unrealised = Number(data.unrealisedPnl || 0);
  const realised = -Number(b.pnl || 0);   // pnl is a credit bucket; gains are negative

  return (
    <div className="funds-page">
      <div className="funds-header">
        <div>
          <h3>Hi, {user?.name || user?.email?.split("@")[0] || "there"}</h3>
          <p className="funds-sub">
            Paper account · prices {status === "live" ? "live" : status.replace("-", " ")}
          </p>
        </div>
        <div className="funds-equity">
          <span className="label">Equity (marked)</span>
          <span className="value">{money(data.equityMarked)}</span>
        </div>
      </div>

      <div className="funds-grid">
        <div className="funds-tile">
          <span className="tile-label">Available cash</span>
          <span className="tile-value">{money(b.cash)}</span>
          <span className="tile-hint">Free to trade</span>
        </div>
        <div className="funds-tile">
          <span className="tile-label">Used margin</span>
          <span className="tile-value">{money(b.margin)}</span>
          <span className="tile-hint">{data.positions.length} open position(s)</span>
        </div>
        <div className="funds-tile">
          <span className="tile-label">Unrealised P&amp;L</span>
          <span className={`tile-value ${unrealised >= 0 ? "gain" : "loss"}`}>{money(unrealised)}</span>
          <span className="tile-hint">Moves with the market</span>
        </div>
        <div className="funds-tile">
          <span className="tile-label">Realised P&amp;L</span>
          <span className={`tile-value ${realised >= 0 ? "gain" : "loss"}`}>{money(realised)}</span>
          <span className="tile-hint">Booked, from the ledger</span>
        </div>
      </div>

      {data.positions.length > 0 && (
        <>
          <div className="table-head" style={{ marginTop: "1.75rem" }}>
            <h3>Open positions</h3>
          </div>
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Instrument</th><th>Side</th>
                  <th className="num">Qty</th><th className="num">Avg</th>
                  <th className="num">Last</th><th className="num">Unrealised</th>
                </tr>
              </thead>
              <tbody>
                {data.positions.map((p) => (
                  <tr key={p.symbol}>
                    <td className="sym">{p.symbol}</td>
                    <td><span className={`pill ${p.side}`}>{p.side}</span></td>
                    <td className="num">{p.quantity}</td>
                    <td className="num">{Number(p.averagePrice).toFixed(2)}</td>
                    <td className="num">
                      {p.lastPrice == null
                        ? <span className="dim">no price</span>
                        : Number(p.lastPrice).toFixed(2)}
                    </td>
                    <td className={`num ${Number(p.unrealisedPnl) >= 0 ? "gain" : "loss"}`}>
                      {p.stale ? <span className="dim">stale</span> : money(p.unrealisedPnl)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      <p className="funds-footnote">
        Equity (marked) is settled equity from the ledger plus unrealised P&amp;L
        at the latest price. The settled part is auditable; the unrealised part
        is an estimate that changes with every tick.
      </p>
    </div>
  );
};

export default Summary;
