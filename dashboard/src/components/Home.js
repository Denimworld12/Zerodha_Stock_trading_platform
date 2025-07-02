import React from "react";

import HomeDashboard from "./dashboard/HomeDashboard";
import TopBar from "./TopBar";
// import { FinnhubProvider } from "./data/FinnhubContext";
const Home = () => {
  return (
    <>
    
      {/* <FinnhubProvider> */}
     <div className="container-fluid p-0">
        <TopBar />
        <HomeDashboard />
      </div>
      {/* </FinnhubProvider> */}
    </>
  );
};

export default Home;
