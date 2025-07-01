import React, { useState, useEffect } from "react";
import axios from "axios";
import BuyWindow from "./BuyWindow";
import SellWindow from "./SellWindow";

const GeneralContext = React.createContext({
  openBuyWindow: (uid) => {},
  closeBuyWindow: () => {},
  openSellWindow: (uid) => {},
  closeSellWindow: () => {},
  positions: [],
  refreshPositions: () => {}
});

export const GeneralContextProvider = (props) => {
  const [isBuyWindowOpen, setIsBuyWindowOpen] = useState(false);
  const [selectedStockUID, setSelectedStockUID] = useState("");
  const [isSellWindowOpen, setIsSellWindowOpen] = useState(false);
  const [selectedSellStockUID, setSelectedSellStockUID] = useState("");
  const [positions, setPositions] = useState([]);

  // Fetch latest positions from backend
  const refreshPositions = async () => {
    try {
      const res = await axios.get(`${process.env.REACT_APP_DATABASE_LINK}/position`);
      setPositions(res.data);
    } catch (error) {
      console.error("Error fetching positions:", error);
    }
  };

  // Load positions on first render
  useEffect(() => {
    refreshPositions();
  }, []);

  // Buy handlers
  const handleOpenBuyWindow = (uid) => {
    setIsBuyWindowOpen(true);
    setSelectedStockUID(uid);
  };
  const handleCloseBuyWindow = () => {
    setIsBuyWindowOpen(false);
    setSelectedStockUID("");
  };

  // Sell handlers
  const handleOpenSellWindow = (uid) => {
    setIsSellWindowOpen(true);
    setSelectedSellStockUID(uid);
  };
  const handleCloseSellWindow = () => {
    setIsSellWindowOpen(false);
    setSelectedSellStockUID("");
  };

  return (
    <GeneralContext.Provider
      value={{
        openBuyWindow: handleOpenBuyWindow,
        closeBuyWindow: handleCloseBuyWindow,
        openSellWindow: handleOpenSellWindow,
        closeSellWindow: handleCloseSellWindow,
        positions,
        refreshPositions
      }}
    >
      {props.children}
      {isBuyWindowOpen && <BuyWindow uid={selectedStockUID} />}
      {isSellWindowOpen && <SellWindow uid={selectedSellStockUID} />}
    </GeneralContext.Provider>
  );
};

export default GeneralContext;
