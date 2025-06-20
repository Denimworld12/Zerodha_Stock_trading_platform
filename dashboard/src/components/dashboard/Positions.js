import React, { use } from "react";
// import { positions } from "../../data/data";
import { useState, useEffect } from "react";
import axios from "axios";

const Positions = () => {
  const [addPosition, setPosition] = useState([])

  useEffect(() => {
    axios.get('http://localhost:3002/position').then((res) => {
      console.log(res.data)
      setPosition(res.data);
    })
  }, [])


  return (
    <>
      <h3 className="title">Positions ({addPosition.length})</h3>

      <div className="order-table">
        <table>
          <tr>
            <th>Product</th>
            <th>Instrument</th>
            <th>Qty.</th>
            <th>Avg.</th>
            <th>LTP</th>
            <th>P&L</th>
            <th>Chg.</th>
          </tr>

          {
            addPosition.map((stock, idx) => {
              const curValue = stock.price * stock.qty;
              const isProfit = curValue - stock.price * stock.avg.qty >= 0.0;
              const profitClass = isProfit ? "profit" : "loss";
              const dayClass = stock.isLoss ? "loss" : "profit "
              return (
                <tr key={idx} >
                  <td>{stock.product}</td>
                  <td>{stock.name}</td>
                  <td>{stock.qty}</td>
                  <td>{stock.avg.toFixed(2)}</td>
                  <td>{stock.price.toFixed(2)}</td>
                  {/* <td>{curValue.toFixed(2)}</td> */}
                  <td className={profitClass}>
                    {(curValue - stock.avg * stock.qty).toFixed(2)}
                  </td>
                  {/* <td className={profitClass}>{stock.net}</td> */}
                  <td className={dayClass}>{stock.day}</td>
                </tr>
              )
            })
          }
        </table>
      </div>
    </>
  );
};

export default Positions;
