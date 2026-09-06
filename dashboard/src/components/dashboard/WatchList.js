import React, { useContext, useEffect, useState } from "react";
import { Tooltip } from "@mui/material";
import KeyboardArrowDown from "@mui/icons-material/KeyboardArrowDown";
import KeyboardArrowUp from "@mui/icons-material/KeyboardArrowUp";
import BarChartOutlined from "@mui/icons-material/BarChartOutlined";
import { Link } from "react-router-dom";

import GeneralContext from "./GeneralContext";
import { useMarketData } from "../../lib/marketdata";
import * as api from "../../lib/api";

/**
 * Watchlist, driven by the server's price feed.
 *
 * The instrument list comes from the server too, so the watchlist can only
 * contain things that are actually tradable. The old hardcoded list included
 * five OANDA forex pairs the Finnhub key had no access to; they returned an
 * error body with HTTP 200 and rendered as a permanent row of ₹0.00.
 */
const WatchListItem = ({ symbol, price, prevPrice }) => {
  const ctx = useContext(GeneralContext);
  const [hover, setHover] = useState(false);

  // Direction since the previous tick. Honest about what it measures: this is
  // not a daily change, and labelling it as one would be a lie.
  const delta = price != null && prevPrice != null ? price - prevPrice : 0;
  const down = delta < 0;

  return (
    <li onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}>
      <div className="item">
        <p className={down ? "down" : "up"}>{symbol}</p>
        <div className="item-Info">
          {price == null ? (
            <span className="price" style={{ color: "#9ca3af" }}>—</span>
          ) : (
            <>
              {delta !== 0 &&
                (down ? <KeyboardArrowDown className="down" /> : <KeyboardArrowUp className="up" />)}
              <span className="price">{price.toFixed(2)}</span>
            </>
          )}
        </div>
      </div>

      {hover && (
        <span className="actions">
          <Tooltip title="Buy" placement="top">
            <button className="buy" onClick={() => ctx.openBuyWindow(symbol)}>Buy</button>
          </Tooltip>
          <Tooltip title="Sell" placement="top">
            <button className="sell" onClick={() => ctx.openSellWindow(symbol)}>Sell</button>
          </Tooltip>
          <Tooltip title="Chart" placement="top">
            <Link to="/charts"><button className="action"><BarChartOutlined className="icon" /></button></Link>
          </Tooltip>
        </span>
      )}
    </li>
  );
};

const WatchList = () => {
  const { prices, subscribe, status } = useMarketData();
  const [symbols, setSymbols] = useState([]);
  const [prev, setPrev] = useState({});

  useEffect(() => {
    api.instruments()
      .then((list) => {
        // Only crypto for now: those are the venues with a live feed wired up.
        const tradable = list.filter((i) => i.venue === "binance").map((i) => i.symbol);
        setSymbols(tradable);
        subscribe(tradable);
      })
      .catch(() => setSymbols([]));
  }, [subscribe]);

  // Remember the previous price so the arrow reflects the last move.
  useEffect(() => {
    setPrev((old) => {
      const next = { ...old };
      for (const [sym, t] of Object.entries(prices)) {
        if (old[sym] !== t.price) next[sym] = old[sym] ?? t.price;
      }
      return next;
    });
  }, [prices]);

  return (
    <div className="watchlist-container">
      <div className="search-container">
        <span className="search" style={{ fontSize: ".8rem", color: "#6b7280" }}>
          {symbols.length} instruments · {status === "live" ? "live" : status.replace("-", " ")}
        </span>
      </div>

      <ul className="list">
        {symbols.map((symbol) => (
          <WatchListItem
            key={symbol}
            symbol={symbol}
            price={prices[symbol]?.price ?? null}
            prevPrice={prev[symbol] ?? null}
          />
        ))}
      </ul>
    </div>
  );
};

export default WatchList;
