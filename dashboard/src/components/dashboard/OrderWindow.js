import React, { useContext, useEffect, useMemo, useState } from "react";
import GeneralContext from "./GeneralContext";
import { useMarketData } from "../../lib/marketdata";
import * as api from "../../lib/api";
import "./OrderWindow.css";

/**
 * One order ticket for both buy and sell.
 *
 * BuyWindow and SellWindow were near-identical files, which meant every fix had
 * to be made twice — and in practice was not.
 *
 * There is deliberately NO price input. The old ticket let you type a price and
 * sent it to the server, which trusted it; anyone could buy at ₹1. The server
 * now prices the order itself, so this shows the live price as information and
 * lets you set an optional limit that acts as a ceiling (buy) or floor (sell).
 */
const OrderWindow = ({ uid, side }) => {
  const ctx = useContext(GeneralContext);
  const { prices, subscribe } = useMarketData();
  const [quantity, setQuantity] = useState("0.001");
  const [orderType, setOrderType] = useState("market");
  const [limitPrice, setLimitPrice] = useState("");
  const [stopLoss, setStopLoss] = useState("");
  const [takeProfit, setTakeProfit] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => { if (uid) subscribe(uid); }, [uid, subscribe]);

  const last = prices[uid]?.price ?? null;
  const estimate = useMemo(() => {
    const q = Number(quantity);
    if (!last || !Number.isFinite(q) || q <= 0) return null;
    return last * q;
  }, [last, quantity]);

  const close = () => (side === "buy" ? ctx.closeBuyWindow?.() : ctx.closeSellWindow?.());

  const submit = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api.placeOrder({
        symbol: uid,
        side,
        quantity: quantity.trim(),
        orderType,
        limitPrice: orderType === "limit" ? limitPrice.trim() : null,
        stopLoss: stopLoss.trim() || null,
        takeProfit: takeProfit.trim() || null,
      });
      ctx.refreshPositions?.();
      close();
      window.alert(
        res.closed
          ? `Closed ${uid} at ${res.filledPrice} — P&L ${res.pnl}`
          : `${side === "buy" ? "Bought" : "Sold"} ${res.quantity} ${uid} at ${res.filledPrice}`
      );
    } catch (err) {
      // Server errors here are specific and actionable (lot step, minimum
      // quantity, insufficient funds, stale price), so show them verbatim
      // rather than replacing them with "order failed".
      setError(err.issues?.length ? err.issues.join("; ") : err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="order-window" role="dialog" aria-label={`${side} ${uid}`}>
      <div className={`order-head ${side}`}>
        <span>{side === "buy" ? "Buy" : "Sell"} {uid}</span>
        <button className="order-x" onClick={close} aria-label="Close">×</button>
      </div>

      <div className="order-body">
        <div className="order-live">
          <span>Live price</span>
          <strong>{last == null ? "waiting…" : last.toFixed(2)}</strong>
        </div>

        <div className="order-types">
          {["market", "limit"].map((t) => (
            <button key={t} type="button"
              className={orderType === t ? "active" : ""}
              onClick={() => setOrderType(t)}>
              {t}
            </button>
          ))}
        </div>

        <label>
          <span>Quantity</span>
          <input type="text" inputMode="decimal" value={quantity}
                 onChange={(e) => setQuantity(e.target.value)} disabled={busy} />
        </label>

        {orderType === "limit" && (
          <label>
            <span>{side === "buy" ? "Maximum price" : "Minimum price"}</span>
            <input type="text" inputMode="decimal" value={limitPrice}
                   onChange={(e) => setLimitPrice(e.target.value)}
                   placeholder={last ? last.toFixed(2) : ""} disabled={busy} />
            <small>
              The order is rejected if the market is worse than this. It still
              fills at the market price, never at your number.
            </small>
          </label>
        )}

        <div className="order-row">
          <label>
            <span>Stop loss</span>
            <input type="text" inputMode="decimal" value={stopLoss}
                   onChange={(e) => setStopLoss(e.target.value)}
                   placeholder="optional" disabled={busy} />
          </label>
          <label>
            <span>Target</span>
            <input type="text" inputMode="decimal" value={takeProfit}
                   onChange={(e) => setTakeProfit(e.target.value)}
                   placeholder="optional" disabled={busy} />
          </label>
        </div>

        {error && <div className="order-error">{error}</div>}
      </div>

      <div className="order-foot">
        <span className="order-est">
          {estimate == null ? "—" : `≈ ₹${estimate.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`}
        </span>
        <div>
          <button className={`btn-${side}`} onClick={submit} disabled={busy || !last}>
            {busy ? "Placing…" : side === "buy" ? "Buy" : "Sell"}
          </button>
          <button className="btn-cancel" onClick={close} disabled={busy}>Cancel</button>
        </div>
      </div>
    </div>
  );
};

export const BuyWindow = ({ uid }) => <OrderWindow uid={uid} side="buy" />;
export const SellWindow = ({ uid }) => <OrderWindow uid={uid} side="sell" />;
export default OrderWindow;
