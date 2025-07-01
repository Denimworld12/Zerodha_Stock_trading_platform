import React, { useState, useEffect } from "react";
import axios from "axios";
import { LineChart } from "../chart/LineChart";

const Summary = () => {
  const [holdings, setHoldings] = useState([]);
  const [funds, setFunds] = useState(null);

  useEffect(() => {
    // Fetch holdings
    axios.get(`${process.env.DATABASE_LINK}/holding`).then((res) => {
      setHoldings(res.data);
    });

    // Fetch fund data
    axios.get(`${process.env.REACT_APP_DATABASE_LINK}/funds`).then((res) => {
      setFunds(res.data);
    });
  }, []);

  // Compute P&L, Investment, Current Value
  const investment = holdings.reduce((acc, item) => acc + item.avg * item.qty, 0);
  const currentValue = holdings.reduce((acc, item) => acc + item.price * item.qty, 0);
  const pnl = currentValue - investment;
  const pnlPercentage = investment > 0 ? ((pnl / investment) * 100).toFixed(2) : 0;

  // Min/Max for coloring chart
  const prices = holdings.map(stock => stock.price);
  const minPrice = Math.min(...prices, 0);
  const maxPrice = Math.max(...prices, 1);

  function colorFromRaw(ctx) {
    if (ctx.type !== 'data') return 'transparent';
    const value = ctx.raw.v;
    const percent = (value - minPrice) / (maxPrice - minPrice);
    const hue = 120 - (120 * percent); // green to red
    return `hsl(${hue}, 70%, 50%)`;
  }

  const data = {
    datasets: [
      {
        tree: holdings.map(stock => ({
          name: stock.name,
          v: stock.price,
        })),
        key: 'v',
        groups: ['name'],
        backgroundColor: colorFromRaw,
        borderRadius: 4,
        borderWidth: 1,
        spacing: 1,
      },
    ],
  };

  return (
    <>
      <div className="username">
        <h6>Hi, User!</h6>
        <hr className="divider" />
      </div>

      <div className="section">
        <span><p>Equity</p></span>

        <div className="data">
          <div className="first">
            <h3>{funds ? `₹${(funds.availableCash / 1000).toFixed(2)}k` : '—'}</h3>
            <p>Margin available</p>
          </div>
          <hr />

          <div className="second">
            <p>Margins used <span>{funds ? `₹${(funds.usedMargin / 1000).toFixed(2)}k` : '—'}</span></p>
            <p>Opening balance <span>{funds ? `₹${(funds.openingBalance / 1000).toFixed(2)}k` : '—'}</span></p>
          </div>
        </div>
        <hr className="divider" />
      </div>

      <div className="section">
        <span><p>Holdings ({holdings.length})</p></span>

        <div className="data">
          <div className="first">
            <h3 className={pnl >= 0 ? "profit" : "loss"}>
              ₹{(pnl / 1000).toFixed(2)}k <small>{pnl >= 0 ? "+" : "-"}{Math.abs(pnlPercentage)}%</small>
            </h3>
            <p>P&L</p>
          </div>
          <hr />

          <div className="second">
            <p>Current Value <span>₹{(currentValue / 1000).toFixed(2)}k</span></p>
            <p>Investment <span>₹{(investment / 1000).toFixed(2)}k</span></p>
          </div>
        </div>

        <LineChart data={data} />
        <hr className="divider" />
      </div>
    </>
  );
};

export default Summary;
