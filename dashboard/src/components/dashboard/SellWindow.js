import React, { useState, useContext } from "react";
import { Link } from "react-router-dom";
import axios from "axios";

import GeneralContext from "./GeneralContext";
import "./SellWindow.css";

const SellWindow = ({ uid }) => {
  const [stockQuantity, setStockQuantity] = useState(1);
  const [stockPrice, setStockPrice] = useState(0.0);
  const [stopLoss, setStopLoss] = useState("");
  const [target, setTarget] = useState("");

  const [position, setPosition] = useState({ x: 100, y: 100 });
  const [dragging, setDragging] = useState(false);
  const [offset, setOffset] = useState({ x: 0, y: 0 });

  const generalContext = useContext(GeneralContext);

  const handleMouseDown = (e) => {
    setDragging(true);
    setOffset({
      x: e.clientX - position.x,
      y: e.clientY - position.y
    });
  };

  const handleMouseMove = (e) => {
    if (dragging) {
      let newX = e.clientX - offset.x;
      let newY = e.clientY - offset.y;

      const windowWidth = window.innerWidth;
      const windowHeight = window.innerHeight;
      const popupWidth = 300;
      const popupHeight = 250;

      newX = Math.max(0, Math.min(newX, windowWidth - popupWidth));
      newY = Math.max(0, Math.min(newY, windowHeight - popupHeight));

      setPosition({ x: newX, y: newY });
    }
  };

  const handleMouseUp = () => {
    setDragging(false);
  };

  const handleSellClick = async () => {
    try {
      await axios.post("http://localhost:3002/order", {
        name: uid,
        qty: Number(stockQuantity),
        price: Number(stockPrice),
        stopLoss: stopLoss ? Number(stopLoss) : null,
        target: target ? Number(target) : null,
        mode: "SELL"
      });

      generalContext.refreshPositions?.();
      generalContext.closeSellWindow?.();
    } catch (error) {
      console.error("Error placing sell order:", error);
    }
  };

  const handleCancelClick = () => {
    generalContext.closeSellWindow?.();
  };

  return (
    <div
      className="sell-popup"
      style={{
        top: position.y,
        left: position.x,
        position: "absolute",
        width: "320px"
      }}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
    >
      <div
        className="popup-header-sell"
        onMouseDown={handleMouseDown}
        onMouseUp={handleMouseUp}
      >
        <span>Sell Order</span>
        <button className="close-btn" onClick={handleCancelClick}>×</button>
      </div>

      <div className="regular-order">
        <div className="inputs">
          <fieldset>
            <legend>Qty.</legend>
            <input
              type="number"
              name="qty"
              min="1"
              onChange={(e) => setStockQuantity(e.target.value)}
              value={stockQuantity}
            />
          </fieldset>
          <fieldset>
            <legend>Price</legend>
            <input
              type="number"
              step="0.05"
              onChange={(e) => setStockPrice(e.target.value)}
              value={stockPrice}
            />
          </fieldset>
          <fieldset>
            <legend>Stop Loss</legend>
            <input
              type="number"
              step="0.05"
              placeholder="-"
              value={stopLoss}
              onChange={(e) => setStopLoss(e.target.value)}
            />
          </fieldset>
          <fieldset>
            <legend>Target</legend>
            <input
              type="number"
              step="0.05"
              placeholder="-"
              value={target}
              onChange={(e) => setTarget(e.target.value)}
            />
          </fieldset>
        </div>
      </div>

      <div className="buttons">
        <span>Est. margin ₹{(stockQuantity * stockPrice).toFixed(2)}</span>
        <div>
          <Link className="btn btn-red" onClick={handleSellClick}>
            Sell
          </Link>
          <Link to="" className="btn btn-grey" onClick={handleCancelClick}>
            Cancel
          </Link>
        </div>
      </div>
    </div>
  );
};

export default SellWindow;
