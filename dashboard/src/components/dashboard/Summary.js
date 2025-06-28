import React from "react";
import { LineChart } from "../chart/LineChart";
import { useState, useEffect } from "react";
import axios from 'axios';

const Summary = () => {
  const [allHoldings, setHolding] = useState([]);

  useEffect(() => {
    axios.get("http://localhost:3002/holding").then((res) => {
      setHolding(res.data);
    });
  }, []);

  // Calculate min & max price for gradient
  const prices = allHoldings.map(stock => stock.price);
  const minPrice = Math.min(...prices, 0); // fallback 0 if empty
  const maxPrice = Math.max(...prices, 1); // fallback 1 if empty

  function colorFromRaw(ctx) {
    if (ctx.type !== 'data') {
      return 'transparent';
    }
    const value = ctx.raw.v;

    // Normalize value between 0 and 1
    const percent = (value - minPrice) / (maxPrice - minPrice);
    const hue = 120 - (120 * percent); // 120 (green) → 0 (red)

    return `hsl(${hue}, 70%, 50%)`;
  }

  const data = {
    datasets: [
      {
        tree: allHoldings.map(stock => ({
          name: stock.name,
          v: stock.price
        })),
        key: 'v',
        groups: ['name'],
        backgroundColor: colorFromRaw,
        borderRadius: 4,
        borderWidth: 1,
        spacing: 1
      }
    ]
  };
  return (
    <>
      <div className="username">
        <h6>Hi, User!</h6>
        <hr className="divider" />
      </div>

      <div className="section">
        <span>
          <p>Equity</p>
        </span>

        <div className="data">
          <div className="first">
            <h3>3.74k</h3>
            <p>Margin available</p>
          </div>
          <hr />

          <div className="second">
            <p>
              Margins used <span>0</span>{" "}
            </p>
            <p>
              Opening balance <span>3.74k</span>{" "}
            </p>
          </div>
        </div>
        <hr className="divider" />
      </div>

      <div className="section">
        <span>
          <p>Holdings (13)</p>
        </span>

        <div className="data">
          <div className="first">
            <h3 className="profit">
              1.55k <small>+5.20%</small>{" "}
            </h3>
            <p>P&L</p>
          </div>
          <hr />

          <div className="second">
            <p>
              Current Value <span>31.43k</span>{" "}
            </p>
            <p>
              Investment <span>29.88k</span>{" "}
            </p>
          </div>
        </div>
        <LineChart data={data} />
        <hr className="divider" />
      </div>
    </>
  );
};

export default Summary;
