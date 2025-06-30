import React from "react";
import TradingViewChart from "./TradingViewChart";

const Apps = () => {
  return (
    <div className="container">
      <h2>Trading-Mitra Charts </h2>
      <div style={{ height: "80vh"}}>
          <TradingViewChart  />
      </div>
    </div>
  );
};

export default Apps;
