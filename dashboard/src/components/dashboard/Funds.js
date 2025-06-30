import React, { useEffect, useState } from "react";
import axios from "axios";

const Funds = () => {
  const [fund, setFund] = useState(null);
  const [modalType, setModalType] = useState(null); // 'add' or 'withdraw'
  const [amount, setAmount] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  // Fetch funds initially
  useEffect(() => {
    axios
      .get("http://localhost:3002/funds")
      .then((res) => setFund(res.data))
      .catch((err) => console.error("Failed to fetch fund:", err));
  }, []);

  const handleUpdateFund = async () => {
    const amt = parseFloat(amount);
    if (isNaN(amt) || amt <= 0) {
      alert("Enter a valid amount");
      return;
    }

    setIsLoading(true);
    try {
      const res = await axios.put("http://localhost:3002/funds", {
        type: modalType,
        amount: amt,
      });
      setFund(res.data);
      setAmount("");
      setModalType(null);
    } catch (err) {
      console.error("Fund update failed:", err);
      alert("Transaction failed");
    } finally {
      setIsLoading(false);
    }
  };

  if (!fund) return <p>Loading fund data...</p>;

  return (
    <>
      {/* Top Funds Bar */}
      <div className="funds d-flex gap-3 align-items-center">
        <p className="my-auto">
          Instant, zero-cost fund transfers with{" "}
          <img
            src="media/images/UPI.svg"
            alt="UPI"
            style={{ width: "5%", verticalAlign: "middle" }}
          />
        </p>
        <button
          className="btn btn-green"
          onClick={() => setModalType("add")}
        >
          Add funds
        </button>
        <button
          className="btn btn-blue"
          onClick={() => setModalType("withdraw")}
        >
          Withdraw
        </button>
      </div>

      {/* Modal */}
      {modalType && (
        <div className="modal d-block" tabIndex="-1" style={{ backgroundColor: "#00000066" }}>
          <div className="modal-dialog modal-dialog-centered">
            <div className="modal-content p-3">
              <div className="modal-header">
                <h5 className="modal-title">
                  {modalType === "add" ? "Add Funds" : "Withdraw Funds"}
                </h5>
                <button
                  type="button"
                  className="btn-close"
                  onClick={() => setModalType(null)}
                ></button>
              </div>
              <div className="modal-body">
                <input
                  type="number"
                  placeholder="Enter amount"
                  className="form-control"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                />
              </div>
              <div className="modal-footer">
                <button
                  className="btn btn-secondary"
                  onClick={() => setModalType(null)}
                >
                  Cancel
                </button>
                <button
                  className={`btn ${modalType === "add" ? "btn-success" : "btn-primary"}`}
                  onClick={handleUpdateFund}
                  disabled={isLoading}
                >
                  {isLoading ? "Processing..." : modalType === "add" ? "Add" : "Withdraw"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Funds Section */}
      <div className="section mt-5">
        <div className="row">
          {/* Equity Card */}
          <div className="data-card">
            <div className="card-head">
              <span>
                <i className="fa-solid fa-chart-pie px-2" />
                Equity
              </span>
              <div className="links">
                <a href="#">
                  <i className="fa-solid fa-chart-pie fa-2xs" style={{ color: "#3a5af8" }} /> View
                  statement
                </a>
                <a href="#">
                  <i className="fa-solid fa-circle-info fa-2xs" style={{ color: "#5d67f9" }} /> Help
                </a>
              </div>
            </div>

            <div className="value-row">
              <p>Available margin</p>
              <h3 className="blue">{(fund.availableCash).toFixed(2)}</h3>
            </div>
            <div className="value-row">
              <p>Used margin</p>
              <h3 className="blue-2">{(fund.usedMargin).toFixed(2)}</h3>
            </div>
            <div className="value-row">
              <p>Available cash</p>
              <h3 className="blue-2">{(fund.availableCash).toFixed(2)}</h3>
            </div>
            <hr />
            <div className="value-row">
              <p>Opening balance</p>
              <h3>{(fund.openingBalance).toFixed(2)}</h3>
            </div>
            <div className="value-row">
              <p>Payin</p>
              <h3>{(fund.payin || 0).toFixed(2)}</h3>
            </div>
            <div className="value-row">
              <p>Payout</p>
              <h3>{(fund.payout || 0).toFixed(2)}</h3>
            </div>
            <div className="value-row"><p>SPAN</p><h3>0.00</h3></div>
            <div className="value-row"><p>Delivery margin</p><h3>0.00</h3></div>
            <div className="value-row"><p>Exposure</p><h3>0.00</h3></div>
            <div className="value-row"><p>Options premium</p><h3>0.00</h3></div>
            <div className="value-row"><p>Collateral (Liquid funds)</p><h3>0.00</h3></div>
            <div className="value-row"><p>Collateral (Equity)</p><h3>0.00</h3></div>
            <div className="value-row"><p>Total collateral</p><h3>0.00</h3></div>
          </div>

          {/* Commodity Card */}
          <div className="data-card">
            <div className="card-head">
              <span><i className="fa-solid fa-droplet fa-sm px-2"></i> Commodity</span>
              <div className="links">
                <a href="#"><i className="fa-solid fa-chart-pie fa-2xs" style={{ color: "#3a5af8" }} /> View statement</a>
                <a href="#"><i className="fa-solid fa-circle-info fa-2xs" style={{ color: "#5d67f9" }} /> Help</a>
              </div>
            </div>
            <div className="value-row"><p>Available margin</p><h3 className="blue">50,000.00</h3></div>
            <div className="value-row"><p>Used margin</p><h3 className="blue-2">0.00</h3></div>
            <div className="value-row"><p>Available cash</p><h3 className="blue-2">50,000.00</h3></div>
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
