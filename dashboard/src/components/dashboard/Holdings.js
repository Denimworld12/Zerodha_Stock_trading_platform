import React, { useState, useEffect } from "react";
import axios from "axios";
import { LineChart } from "../chart/LineChart";
import { useFinnhub } from "../data/FinnhubContext"; // 👈 Import context hook

const Holdings = () => {
  const [holdings, setHoldings] = useState([]);
  const { prices, subscribe } = useFinnhub(); // 👈 Use context

  // 1. Load Holdings from backend
  useEffect(() => {
    axios.get(`${process.env.REACT_APP_DATABASE_LINK}/holding`).then((res) => {
      setHoldings(res.data);
    });
  }, []);

  // 2. Subscribe to all symbols from holdings
  useEffect(() => {
    holdings.forEach((stock) => {
      subscribe(stock.name);
    });
  }, [holdings, subscribe]);

  // 3. Merge holdings with latest price
  const mergedHoldings = holdings.map((stock) => {
    const price = prices[stock.name] ?? 0;
    return {
      ...stock,
      price,
      curValue: price * stock.qty,
      pnl: price * stock.qty - stock.avg * stock.qty,
    };
  });

  // 4. Summary Calculations
  const totalInvestment = mergedHoldings.reduce((sum, s) => sum + s.avg * s.qty, 0);
  const currentValue = mergedHoldings.reduce((sum, s) => sum + s.curValue, 0);
  const netPL = currentValue - totalInvestment;
  const plPercent = totalInvestment ? ((netPL / totalInvestment) * 100).toFixed(2) : 0;

  const isNetProfit = netPL >= 0;

  // 5. Chart Data
  const pricesArray = mergedHoldings.map((s) => s.price);
  const min = Math.min(...pricesArray);
  const max = Math.max(...pricesArray);

  function colorFromRaw(ctx) {
    if (ctx.type !== "data") return "transparent";
    const value = ctx.raw.v;
    const percent = (value - min) / (max - min || 1); // prevent division by 0
    const hue = 120 - 120 * percent;
    return `hsl(${hue}, 70%, 50%)`;
  }

  const chartData = {
    datasets: [
      {
        tree: mergedHoldings.map((stock) => ({ name: stock.name, v: stock.price })),
        key: "v",
        groups: ["name"],
        backgroundColor: colorFromRaw,
        borderRadius: 4,
        borderWidth: 1,
        spacing: 1,
      },
    ],
  };

  return (
    <>
      <h3 className="title">Holdings ({mergedHoldings.length})</h3>

      <div className="order-table">
        <table>
          <thead>
            <tr>
              <th>Instrument</th>
              <th>Qty.</th>
              <th>Avg. cost</th>
              <th>LTP</th>
              <th>Cur. val</th>
              <th>P&L</th>
              <th>Net chg.</th>
              <th>Day chg.</th>
            </tr>
          </thead>
          <tbody>
            {mergedHoldings.map((stock, idx) => {
              const profitClass = stock.pnl >= 0 ? "profit" : "loss";
              const dayClass = stock.day < 0 ? "loss" : "profit";

              return (
                <tr key={idx}>
                  <td>{stock.name}</td>
                  <td>{stock.qty}</td>
                  <td>{stock.avg.toFixed(2)}</td>
                  <td>{stock.price.toFixed(2)}</td>
                  <td>{stock.curValue.toFixed(2)}</td>
                  <td className={profitClass}>{stock.pnl.toFixed(2)}</td>
                  <td className={profitClass}>{stock.net}</td>
                  <td className={dayClass}>{stock.day}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="row">
        <div className="col">
          <h5>{totalInvestment.toLocaleString(undefined, { minimumFractionDigits: 2 })}</h5>
          <p>Total investment</p>
        </div>
        <div className="col">
          <h5>{currentValue.toLocaleString(undefined, { minimumFractionDigits: 2 })}</h5>
          <p>Current value</p>
        </div>
        <div className="col">
          <h5 className={isNetProfit ? "profit" : "loss"}>
            {netPL.toFixed(2)} ({plPercent}%)
          </h5>
          <p>P&L</p>
        </div>
      </div>

      <div style={{ height: "50px" }}>
        <LineChart data={chartData} />
      </div>
    </>
  );
};

export default Holdings;
