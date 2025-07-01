import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import axios from "axios";
import { useFinnhub } from "../data/FinnhubContext";

const Orders = () => {
  const [orders, setOrders] = useState([]);
  const { prices, subscribe } = useFinnhub();

  // Load orders and subscribe to symbols
  useEffect(() => {
    axios
      .get(`${process.env.REACT_APP_DATABASE_LINK}/order`)
      .then((res) => {
        setOrders(res.data);
        res.data.forEach((order) => {
          if (order.name) subscribe(order.name);
        });
      })
      .catch((err) => console.error("Failed to fetch orders:", err));
  }, [subscribe]);

  // Handle close (delete) order
  const handleCloseOrder = async (id, livePrice) => {
    try {
      await axios.delete(`${process.env.REACT_APP_DATABASE_LINK}/order/${id}`, {
        data: { livePrice } // ✅ Send live price in DELETE body
      });
      setOrders((prev) => prev.filter((order) => order._id !== id));
    } catch (err) {
      console.error("Failed to delete order:", err);
      alert("Failed to close order.");
    }
  };

  // Compute total investment and P&L
  const mergedOrders = orders.map((order) => {
    const livePrice = prices[order.name] || 0;
    const curValue = livePrice * order.qty;
    const cost = order.price * order.qty;
    const pnl = order.mode === "BUY" ? curValue - cost : cost - curValue; // BUY: (live - buy), SELL: (sell - live)
    return {
      ...order,
      livePrice,
      curValue,
      pnl,
    };
  });

  const totalPL = mergedOrders.reduce((sum, o) => sum + o.pnl, 0);
  // const isNetProfit = totalPL >= 0;

  return (
    <div className="orders">
      {orders.length === 0 ? (
        <div className="no-orders">
          <p>You haven't placed any orders today</p>
          <Link to={"/"} className="btn">Get started</Link>
        </div>
      ) : (
        <>
          <h3 className="title">Your Orders ({orders.length})</h3>
          <div className="order-table">
            <table>
              <thead>
                <tr>
                  <th>Stock</th>
                  <th>Qty</th>
                  <th>Order Price</th>
                  <th>Live Price</th>
                  <th>Current Value</th>
                  <th>P&L</th>
                  <th>Type</th>
                  <th>Stop Loss</th>
                  <th>Target</th>
                  <th>Time</th>
                  <th>Close</th>
                </tr>
              </thead>
              <tbody>
                {mergedOrders.map((order, idx) => {
                  const orderTime = new Date(order.createdAt).toLocaleString();
                  // const typeClass = order.mode === "BUY" ? "buy" : "sell";
                  const profitClass = order.pnl >= 0 ? "profit" : "loss";
                  const stopLoss = order.stopLoss || "-";
                  const target = order.target || "-";

                  return (
                    <tr key={idx}>
                      <td>{order.name}</td>
                      <td>{order.qty}</td>
                      <td>{order.price?.toFixed(2)}</td>
                      <td>{order.livePrice.toFixed(2)}</td>
                      <td>{order.curValue.toFixed(2)}</td>
                      <td className={profitClass}>{order.pnl.toFixed(2)}</td>
                      <td className="">{order.mode}</td>
                      <td>{stopLoss}</td>
                      <td>{target}</td>
                      <td>{orderTime}</td>
                      <td>
                        <button
                          className="btn"
                          onClick={() => handleCloseOrder(order._id, order.livePrice)} // ✅ Send livePrice
                        >
                          Close
                        </button>

                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="row mt-3">
            <div className="col"> Total P&L:
              <h5 className={totalPL >= 0 ? "text-success" : "text-danger"}>
                {totalPL.toFixed(2)}
              </h5>

              <p>Real-time Profit or Loss from open orders</p>
            </div>
          </div>
        </>
      )}
    </div>
  );
};

export default Orders;
