import React from "react";
import { Route, Routes } from "react-router-dom";

import Apps from "./Apps";
import Funds from "./Funds";
import Holdings from "./Holdings";
import Orders from "./Orders";
import Positions from "./Positions";
import Signals from "./Signals";
import Summary from "./Summary";
import WatchList from "./WatchList";
import { GeneralContextProvider } from "./GeneralContext";

const HomeDashboard = () => (
  <div className="dashboard-container">
    <GeneralContextProvider>
      <WatchList />

      <div className="content">
        <Routes>
          <Route path="/" element={<Summary />} />
          <Route path="/orders" element={<Orders />} />
          {/* Holdings now shows CLOSED trades; Positions shows open ones.
              They used to render the same collection twice. */}
          <Route path="/holdings" element={<Holdings />} />
          <Route path="/positions" element={<Positions />} />
          <Route path="/funds" element={<Funds />} />
          <Route path="/charts" element={<Apps />} />
          <Route path="/signals" element={<Signals />} />
        </Routes>
      </div>
    </GeneralContextProvider>
  </div>
);

export default HomeDashboard;
