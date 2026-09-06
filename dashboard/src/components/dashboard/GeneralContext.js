import React, { useCallback, useEffect, useState } from "react";
import * as api from "../../lib/api";
import BuyWindow from "./BuyWindow";
import SellWindow from "./SellWindow";

/**
 * Shared UI state: which order ticket is open, and the current positions.
 *
 * Positions live here so that placing an order can refresh every screen that
 * shows them without each one polling on its own timer.
 */
const GeneralContext = React.createContext({
  openBuyWindow: () => {},
  closeBuyWindow: () => {},
  openSellWindow: () => {},
  closeSellWindow: () => {},
  positions: [],
  refreshPositions: () => {},
});

export const GeneralContextProvider = ({ children }) => {
  const [buyFor, setBuyFor] = useState(null);
  const [sellFor, setSellFor] = useState(null);
  const [positions, setPositions] = useState([]);

  const refreshPositions = useCallback(async () => {
    try {
      setPositions(await api.positions("open"));
    } catch {
      // A failed refresh must not break the ticket that triggered it; the
      // Positions screen surfaces its own errors.
    }
  }, []);

  useEffect(() => { refreshPositions(); }, [refreshPositions]);

  return (
    <GeneralContext.Provider
      value={{
        openBuyWindow: (uid) => { setSellFor(null); setBuyFor(uid); },
        closeBuyWindow: () => setBuyFor(null),
        openSellWindow: (uid) => { setBuyFor(null); setSellFor(uid); },
        closeSellWindow: () => setSellFor(null),
        positions,
        refreshPositions,
      }}
    >
      {children}
      {buyFor && <BuyWindow uid={buyFor} />}
      {sellFor && <SellWindow uid={sellFor} />}
    </GeneralContext.Provider>
  );
};

export default GeneralContext;
