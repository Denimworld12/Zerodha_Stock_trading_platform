import React from "react";

import Dashboard from "./dashboard/HomeDashboard";
import TopBar from "./TopBar";
import Gate from "./auth/Gate";
import { AuthProvider } from "../lib/AuthContext";
import { MarketDataProvider } from "../lib/marketdata";

/**
 * Provider order matters.
 *
 * AuthProvider must wrap Gate (Gate reads the session), and the market feed is
 * mounted INSIDE Gate so a signed-out visitor never opens a WebSocket. The old
 * version connected to Finnhub before anyone had signed in.
 */
const Home = () => (
  <AuthProvider>
    <Gate>
      <MarketDataProvider>
        <TopBar />
        <Dashboard />
      </MarketDataProvider>
    </Gate>
  </AuthProvider>
);

export default Home;
