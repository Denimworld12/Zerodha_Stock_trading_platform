import React, { useCallback, useEffect, useState } from "react";
import * as api from "../../lib/api";
import "./Tables.css";

/**
 * Order history.
 *
 * These are FILLED records, not live intents — an order in this system is
 * resolved the moment it is accepted, so there is nothing to cancel. The old
 * screen showed open orders with a Close button that actually closed the
 * position; closing now lives on the Positions screen where it belongs.
 */
const money = (v) =>
  Number(v || 0).toLocaleString("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 });

const Orders = () => {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    try {
      setOrders(await api.orders(100));
      setError(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  if (loading) return <p className="table-loading">Loading orders…</p>;
  if (error) return <div className="table-error">{error}</div>;

  if (!orders.length) {
    return (
      <div className="table-empty">
        <p>You haven't placed any orders yet.</p>
        <p className="muted">Orders appear here the moment they fill.</p>
      </div>
    );
  }

  return (
    <div className="table-page">
      <div className="table-head"><h3>Orders ({orders.length})</h3></div>
      <div className="table-scroll">
        <table className="data-table">
          <thead>
            <tr>
              <th>Time</th><th>Instrument</th><th>Side</th>
              <th className="num">Qty</th><th className="num">Fill price</th>
              <th>Type</th><th>Status</th><th>Source</th>
            </tr>
          </thead>
          <tbody>
            {orders.map((o) => (
              <tr key={o._id}>
                <td className="dim">{new Date(o.createdAt).toLocaleString()}</td>
                <td className="sym">{o.symbol}</td>
                <td><span className={`pill ${o.side === "buy" ? "long" : "short"}`}>{o.side}</span></td>
                <td className="num">{o.quantity}</td>
                <td className="num">{o.filledPrice ? Number(o.filledPrice).toFixed(2) : "—"}</td>
                <td className="dim">{o.orderType}</td>
                <td><span className={`status ${o.status}`}>{o.status}</span></td>
                <td className="dim">{o.source}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default Orders;
