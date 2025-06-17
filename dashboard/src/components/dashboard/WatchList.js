import React from "react";
import { useState } from "react";
import { Tooltip, Grow } from "@mui/material"
import { watchlist } from "../../data/data";
import KeyboardArrowDown from "@mui/icons-material/KeyboardArrowDown";
import KeyboardArrowUp from "@mui/icons-material/KeyboardArrowUp";
import BarChartOutlined from "@mui/icons-material/BarChartOutlined";
import MoreHoriz from "@mui/icons-material/MoreHoriz";
const WatchlistItem = ({ stock, idx }) => {
  const [showWatchListEnter, setShowItem] = useState(false);
  const handleMouseHover = (e) => {
    setShowItem(true);
  }
  const handleMouseLeave = (e) => {
    setShowItem(false)
      ;
  }
  return (
    <li onMouseEnter={handleMouseHover} onMouseLeave={handleMouseLeave}>
      <div className="item">
        <p className={stock.isDown ? "down" : "up"}> {stock.name} </p>
        <div className="item-Info">
          <span className="percent"> {stock.percent} </span>
          {
            stock.isDown ? (
              <KeyboardArrowDown className="down" />) : (
              <KeyboardArrowUp className="  up" />)

          }
          <span className="price"> {stock.price} </span>

        </div>
      </div>
      {showWatchListEnter && <WatchListAction uid={stock.name}/>}

    </li>
  )
}

const WatchListAction=({uid}  )=>{
  return(
    <span className="actions ">
      <span >
        <Tooltip title="buy (B)" placement="top"
         arrow
          TransitionComponent={Grow}>
          <button className="buy">Buy</button>

        </Tooltip> 
        <Tooltip title="sell (S)" placement="top"
         arrow
          TransitionComponent={Grow}>
          <button className="sell">Buy</button>

        </Tooltip>
        <Tooltip title="Analytics (A)" placement="top"
         arrow
          TransitionComponent={Grow}>
          <button className="action"><BarChartOutlined className="icon"/></button>

        </Tooltip>
        <Tooltip title="More (M)" placement="top"
         arrow
          TransitionComponent={Grow}>
          <button className="action"><MoreHoriz className="icon" /> </button>

        </Tooltip>
      </span>
      

    </span>
  )
}


// pure code for the watchlist 
const WatchList = () => {
  return (
    <div className="watchlist-container " style={{ width: "440px" }}>
      <div className="search-container" >
        <input
          type="text"
          name="search"
          id="search"
          placeholder="Search eg:infy, bse, nifty fut weekly, gold mcx"
          className="search"
        />
        <span className="counts"> {watchlist.length}/ 50</span>
      </div>

      <ul className="list">
        {
          watchlist.map((stock, idx) => {
            return <WatchlistItem stock={stock} key={idx} />
          })
        }
      </ul>
     
    </div>
  );
};

export default WatchList;

