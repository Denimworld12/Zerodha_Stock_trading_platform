import React, { useState } from "react";

import BuyWindow from "./BuyWindow";
import SellWindow from './SellWindow'


const GeneralContext = React.createContext({
  openBuyWindow: (uid) => { },
  closeBuyWindow: () => { },
  openSellWindow: (uid) => { },
  closeSellWindow: () => { },
});

export const GeneralContextProvider = (props) => {
  const [isBuyWindowOpen, setIsBuyWindowOpen] = useState(false);
  const [selectedStockUID, setSelectedStockUID] = useState("");
  const [isSellWindowOpen, setSellWindowOpen] = useState(false)
  const [SellStockUid, setSelectedSellStock] = useState("")

  const handleOpenBuyWindow = (uid) => {
    setIsBuyWindowOpen(true);
    setSelectedStockUID(uid);
  };
  const handleCloseBuyWindow = () => {
    setIsBuyWindowOpen(false);
    setSelectedStockUID("");
  };
  const handleSellOpen = (uid) => {
    setSellWindowOpen(true);
    setSelectedSellStock(uid);
  }
  const handleCloseSell = () => {
    setSellWindowOpen(false);
    setSelectedSellStock("");
  }

  return (
    <GeneralContext.Provider
      value={{
        openBuyWindow: handleOpenBuyWindow,
        closeBuyWindow: handleCloseBuyWindow,
        openSellWindow: handleSellOpen,
        closeSellWindow: handleCloseSell,
      }}
    >
      {props.children}
      {isBuyWindowOpen && <BuyWindow uid={selectedStockUID} />}
      {isSellWindowOpen && <SellWindow uid={SellStockUid} />}
    </GeneralContext.Provider>
  );
};

export default GeneralContext;