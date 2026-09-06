import React from "react";
import Menu from "./Menu";
import { useMarketData } from "../lib/marketdata";

/**
 * Top bar tickers.
 *
 * These used to render hardcoded NIFTY and SENSEX values — the same numbers
 * every time, changing never. A fake index in the chrome of a trading app is
 * worse than no index: it looks live, so people read it. These are real prices
 * from the server feed, and they say so when they have not arrived yet.
 */
const Ticker = ({ label, symbol }) => {
  const { prices } = useMarketData();
  const tick = prices[symbol];

  return (
    <div className="ticker">
      <p className="index">{label}</p>
      <p className="index-points">
        {tick ? tick.price.toLocaleString("en-IN", { maximumFractionDigits: 2 }) : "—"}
      </p>
      <p className="percent" style={{ color: "#9ca3af" }}>
        {tick ? "live" : "connecting"}
      </p>
    </div>
  );
};

const TopBar = () => (
  <div className="topbar-container">
    <div className="indices-container">
      <Ticker label="BTC/USDT" symbol="BTCUSDT" />
      <Ticker label="ETH/USDT" symbol="ETHUSDT" />
    </div>
    <Menu />
  </div>
);

export default TopBar;
