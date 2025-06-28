import React from "react";

import Dashboard from "./dashboard/HomeDashboard";
import TopBar from "./TopBar";
import { FinnhubProvider } from "./data/FinnhubContext";
const Home = () => {
  return (
    <>
      <TopBar />
      <FinnhubProvider>
        <Dashboard />
      </FinnhubProvider>
    </>
  );
};

export default Home;
