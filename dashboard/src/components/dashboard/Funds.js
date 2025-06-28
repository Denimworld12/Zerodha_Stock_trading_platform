import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import axios from "axios";

const Funds = () => {
    const [fund, setFund] = useState(null);

  // Fetch initial fund
  useEffect(() => {
    axios.get("http://localhost:3002/funds")
      .then((res) => setFund(res.data))
      .catch((err) => console.error("Failed to fetch fund:", err));
  }, []);

  const updateFund = async (type) => {
    const amount = parseFloat(prompt(`Enter amount to ${type}`));
    if (isNaN(amount) || amount <= 0) return alert("Invalid amount");

    try {
      const res = await axios.put(`http://localhost:3002/funds`, {
        type,
        amount,
      });
      setFund(res.data); // Update with new data
    } catch (err) {
      console.error("Fund update failed:", err);
      alert("Transaction failed");
    }
  };

  if (!fund) return <p>Loading fund data...</p>;
  return (
    <>
      <div className="funds">
        <p className="my-auto">Instant, zero-cost fund transfers with <img className="" style={{ width: "5%" }} src="media/images/UPI.svg" /></p>
        <button className="btn btn-green my-auto" onClick={() => updateFund("add")}>Add funds</button>
        <button className="btn btn-blue my-auto" onClick={() => updateFund("withdraw")}>Withdraw</button>
      </div>
      <div className="section mt-5">
        <div className="row">
          <div className="data-card">
            <div className="card-head">
              <span><i className="fa-solid fa-chart-pie px-2" />Equity</span>
              <div className="links">
                <a href="#"><i className="fa-solid fa-chart-pie fa-2xs" style={{ color: "#3a5af8" }} /> View statement</a>
                <a href="#"><i className="fa-solid fa-circle-info fa-2xs" style={{ color: "#5d67f9" }} /> Help</a>
              </div>
            </div>

            <div className="value-row"><p>Available margin</p><h3 className="blue">{(fund.availableCash).toFixed(2)}</h3></div>
            <div className="value-row"><p>Used margin</p><h3 className="blue-2">{(fund.usedMargin).toFixed(2)}</h3></div>
            <div className="value-row"><p>Available cash</p><h3 className="blue-2">{(fund.availableCash).toFixed(2)}</h3></div>
            <hr />
            <div className="value-row"><p>Opening balance</p><h3>{(fund.openingBalance).toFixed(2)}</h3></div>
            <div className="value-row"><p>Payin</p><h3>{(fund.payin || 0).toFixed(2)}</h3></div>
            <div className="value-row"><p>Payout</p><h3>{(fund.payout || 0).toFixed(2)}</h3></div>
            <div className="value-row"><p>SPAN</p><h3>0.00</h3></div>
            <div className="value-row"><p>Delivery margin</p><h3>0.00</h3></div>
            <div className="value-row"><p>Exposure</p><h3>0.00</h3></div>
            <div className="value-row"><p>Options premium</p><h3>0.00</h3></div>
            <div className="value-row"><p>Collateral (Liquid funds)</p><h3>0.00</h3></div>
            <div className="value-row"><p>Collateral (Equity)</p><h3>0.00</h3></div>
            <div className="value-row"><p>Total collateral</p><h3>0.00</h3></div>
          </div>

          <div className="data-card">
            <div className="card-head">
              <span><i className="fa-solid fa-droplet fa-sm px-2"></i> Commodity</span>
              <div className="links">
                <a href="#"><i className="fa-solid fa-chart-pie fa-2xs" style={{ color: " #3a5af8" }}></i> View statement</a>
                <a href="#"><i className="fa-solid fa-circle-info fa-2xs" style={{ color: " #5d67f9" }}></i> Help</a>
              </div>
            </div>
            <div className="value-row">
              <p>Available margin</p>
              <h3 className="blue">50,000.00</h3>
            </div>
            <div className="value-row">
              <p>Used margin</p>
              <h3 className="blue-2">0.00</h3>
            </div>
            <div className="value-row">
              <p>Available cash</p>
              <h3 className="blue-2">50,000.00</h3>
            </div>
            <hr />
            <div className="value-row"><p>Opening balance</p><h3>50,000.00</h3></div>
            <div className="value-row"><p>Payin</p><h3>0.00</h3></div>
            <div className="value-row"><p>Payout</p><h3>0.00</h3></div>
            <div className="value-row"><p>SPAN</p><h3>0.00</h3></div>
            <div className="value-row"><p>Delivery margin</p><h3>0.00</h3></div>
            <div className="value-row"><p>Exposure</p><h3>0.00</h3></div>
            <div className="value-row"><p>Options premium</p><h3>0.00</h3></div>
          </div>
        </div>
      </div>

    </>
  );
};

export default Funds;
