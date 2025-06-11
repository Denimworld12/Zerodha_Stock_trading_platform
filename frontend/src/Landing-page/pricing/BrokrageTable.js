import React, { useState } from 'react';
import './BrokerageTable.css';

function BrokrageTable() {
  const [activeTab, setActiveTab] = useState('equity');

  const renderContent = () => {
    switch (activeTab) {
      case 'equity':
        return (
          <table className="  table-striped  mt-4 border" >
            <thead className="table">
              <tr>
                < td></ td>
                < td>Equity Delivery</ td>
                < td>Equity Intraday</td>
                < td>F&O - Futures</ td>
                < td>F&O - Options</ td>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>< >Brokerage</ ></td>
                <td>Zero Brokerage</td>
                <td>0.03% or ₹20/executed order</td>
                <td>0.03% or ₹20/executed order</td>
                <td>Flat ₹20 per executed order</td>
              </tr>
              <tr>
                <td>< >STT/CTT</ ></td>
                <td>0.1% on buy & sell</td>
                <td>0.025% on sell side</td>
                <td>0.02% on sell side</td>
                <td>0.125% on exercise, 0.1% on premium</td>
              </tr>
              <tr>
                <td>< >Transaction Charges</ ></td>
                <td>NSE: 0.00297%<br />BSE: 0.00375%</td>
                <td>NSE: 0.00297%<br />BSE: 0.00375%</td>
                <td>NSE: 0.00173%<br />BSE: 0%</td>
                <td>NSE: 0.03503%<br />BSE: 0.0325%</td>
              </tr>
              <tr>
                <td>< >GST</ ></td>
                <td colSpan="4">18% on (brokerage + SEBI charges + transaction charges)</td>
              </tr>
              <tr>
                <td>< >SEBI Charges</ ></td>
                <td colSpan="4">₹10 per crore</td>
              </tr>
              <tr>
                <td>< >Stamp Charges</ ></td>
                <td>0.015% or ₹1500/crore</td>
                <td>0.003% or ₹300/crore</td>
                <td>0.002% or ₹200/crore</td>
                <td>0.003% or ₹300/crore</td>
              </tr>
            </tbody>
          </table>
        );
      case 'currency':
        return (
           <table className="table-striped mt-4 border" style={{width:"100%"}}>
            <thead className="table">
              <tr>
                <td></td>
                <td>Currency Futures</td>
                <td>Currency Options</td>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Brokerage</td>
                <td>0.03% or ₹20/executed order whichever is lower</td>
                <td>₹20/executed order</td>
              </tr>
              <tr>
                <td>STT/CTT</td>
                <td>No STT</td>
                <td>No STT</td>
              </tr>
              <tr>
                <td>Transaction Charges</td>
                <td>NSE: 0.00035%<br />BSE: 0.00045%</td>
                <td>NSE: 0.0311%<br />BSE: 0.001%</td>
              </tr>
              <tr>
                <td>GST</td>
                <td colSpan="2">18% on (brokerage + SEBI charges + transaction charges)</td>
              </tr>
              <tr>
                <td>SEBI Charges</td>
                <td colSpan="2">₹10 / crore</td>
              </tr>
              <tr>
                <td>Stamp Charges</td>
                <td colSpan="2">0.0001% or ₹10 / crore on buy side</td>
              </tr>
            </tbody>
          </table>
        );
      case 'commodity':
        return (
         <table className="table-striped mt-4 border" style={{width:"100%"}}>
            <thead className="table">
              <tr>
                <td></td>
                <td>Commodity Futures</td>
                <td>Commodity Options</td>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Brokerage</td>
                <td>0.03% or ₹20/executed order whichever is lower</td>
                <td>₹20/executed order</td>
              </tr>
              <tr>
                <td>STT/CTT</td>
                <td>0.01% on sell side (Non-Agri)</td>
                <td>0.05% on sell side</td>
              </tr>
              <tr>
                <td>Transaction Charges</td>
                <td>MCX: 0.0021%<br />NSE: 0.0001%</td>
                <td>MCX: 0.0418%<br />NSE: 0.001%</td>
              </tr>
              <tr>
                <td>GST</td>
                <td colSpan="2">18% on (brokerage + SEBI charges + transaction charges)</td>
              </tr>
              <tr>
                <td>SEBI Charges</td>
                <td>Agri: ₹1 / crore<br />Non-agri: ₹10 / crore</td>
                <td>₹10 / crore</td>
              </tr>
              <tr>
                <td>Stamp Charges</td>
                <td>0.002% or ₹200 / crore on buy side</td>
                <td>0.003% or ₹300 / crore on buy side</td>
              </tr>
            </tbody>
          </table>
        );
      default:
        return null;
    }
  };

  return (
    <div className="container "  style={{width:"1100px",padding:"0px ", fontSize:"14.4px"}}>

      <ul className="nav justify-content p-3 fs-4 mb-3 border-bottom" >
        <li className="">
          <a
            className={`bt p-3 ${activeTab === 'equity' ? 'active' : ''}`}
            onClick={() => setActiveTab('equity')}
          >
            Equity
          </a>
        </li>
        <li className="">
          <a
            className={`p-3 bt ${activeTab === 'currency' ? 'active' : ''}`}
            onClick={() => setActiveTab('currency')}
          >
            Currency
          </a>
        </li>
        <li className="">
          <a
            className={`bt p-3 ${activeTab === 'commodity' ? 'active' : ''}`}
            onClick={() => setActiveTab('commodity')}
          >
            Commodity
          </a>
        </li>
      </ul>

      {renderContent()}
    </div>
  );
}

export default BrokrageTable;
