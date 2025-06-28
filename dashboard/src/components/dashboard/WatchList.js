import React, { useEffect, useState, useContext } from "react";
import { Tooltip } from "@mui/material";
import KeyboardArrowDown from "@mui/icons-material/KeyboardArrowDown";
import KeyboardArrowUp from "@mui/icons-material/KeyboardArrowUp";
import BarChartOutlined from "@mui/icons-material/BarChartOutlined";
import MoreHoriz from "@mui/icons-material/MoreHoriz";
import GeneralContext from "./GeneralContext";
import { DonoutChart } from "../chart/DonoutChart";
import { useFinnhub } from "../data/FinnhubContext"; // 👈 Import context hook

const SYMBOLS = [
  'OANDA:EUR_USD', 'OANDA:USD_JPY', 'OANDA:GBP_USD', 'OANDA:USD_CHF', 'OANDA:AUD_USD',
  'BINANCE:BTCUSDT', 'BINANCE:ETHUSDT', 'BINANCE:XRPUSDT', 'BINANCE:BNBUSDT', 'BINANCE:ADAUSDT'
];

const WatchListItem = ({ stock }) => {
  const [showWatchListEnter, setShowItem] = useState(false);

  return (
    <li onMouseEnter={() => setShowItem(true)} onMouseLeave={() => setShowItem(false)}>
      <div className="item fs-6" style={{ fontWeight: "bold" }}>
        <p className={stock.percent < 0 ? "down" : "up"}>{stock.name}</p>
        <div className="item-Info">
          <span className="percent">{stock.percent.toFixed(2)}%</span>
          {stock.percent < 0
            ? <KeyboardArrowDown className="down" />
            : <KeyboardArrowUp className="up" />}
          <span className="price">${stock.price.toFixed(2)}</span>
        </div>
      </div>
      {showWatchListEnter && <WatchListAction uid={stock.name} />}
    </li>
  );
};

const WatchListAction = ({ uid }) => {
  const generalContext = useContext(GeneralContext);

  return (
    <span className="actions">
      <Tooltip title="Buy (B)" placement="top">
        <button className="buy" onClick={() => generalContext.openBuyWindow(uid)}>Buy</button>
      </Tooltip>
      <Tooltip title="Sell (S)" placement="top">
        <button className="sell" onClick={() => generalContext.openSellWindow(uid)}>Sell</button>
      </Tooltip>
      <Tooltip title="Analytics (A)" placement="top">
        <button className="action"><BarChartOutlined className="icon" /></button>
      </Tooltip>
      <Tooltip title="More (M)" placement="top">
        <button className="action"><MoreHoriz className="icon" /></button>
      </Tooltip>
    </span>
  );
};

const WatchList = () => {
  const { prices, subscribe } = useFinnhub();
  const [stocks, setStocks] = useState([]);

  // Initial stock structure
  useEffect(() => {
    const initial = SYMBOLS.map((sym) => ({
      name: sym,
      price: 0,
      prevClose: 0, // You can replace with real prevClose if available
      percent: 0
    }));
    setStocks(initial);
  }, []);

  // Subscribe to symbols and update price/percent
  useEffect(() => {
    SYMBOLS.forEach((symbol) => subscribe(symbol));
  }, [subscribe]);

  // Live update
  useEffect(() => {
    setStocks((prev) =>
      prev.map((s) => {
        const livePrice = prices[s.name] ?? s.price;
        const percent = s.prevClose
          ? ((livePrice - s.prevClose) / s.prevClose) * 100
          : s.percent;

        return {
          ...s,
          price: livePrice,
          percent,
        };
      })
    );
  }, [prices]);

  const labels = stocks.map((s) => s.name);
  const data = {
    labels,
    datasets: [
      {
        label: "Price",
        data: stocks.map((s) => s.price),
        backgroundColor: [
          'rgba(255,99,132,0.8)', 'rgba(54,162,235,0.8)', 'rgba(255,206,86,0.8)',
          'rgba(75,192,192,0.8)', 'rgba(153,102,255,0.8)', 'rgba(255,159,64,0.8)',
          'rgba(199,199,199,0.8)', 'rgba(83,102,255,0.8)', 'rgba(255,102,204,0.8)',
          'rgba(102,255,204,0.8)'
        ],
        borderWidth: 1
      }
    ]
  };

  return (
    <div className="watchlist-container" style={{ width: "440px" }}>
      <div className="search-container">
        <input type="text" placeholder="Search eg: infy, btcusdt" className="search" />
        <span className="counts">{stocks.length}/10</span>
      </div>
      <ul className="list">
        {stocks.map((stock, idx) => (
          <WatchListItem stock={stock} key={idx} />
        ))}
      </ul>
      <DonoutChart data={data} />
    </div>
  );
};

export default WatchList;
