import React, { useEffect, useRef } from 'react';
// import WatchListAction from "./WatchListAction"; // Optional tooltip actions

const TradingViewChart = () => {
  const container = useRef();

  useEffect(
    () => {
      const script = document.createElement("script");
      script.src = "https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js";
      script.type = "text/javascript";
      script.async = true;
      script.innerHTML = `
        {
          "allow_symbol_change": true,
          "calendar": false,
          "details": false,
          "hide_side_toolbar": false,
          "hide_top_toolbar": false,
          "hide_legend": false,
          "hide_volume": false,
          "hotlist": false,
          "interval": "30",
          "locale": "en",
          "save_image": true,
          "style": "1",
          "symbol":"USDJPY" ,
          "theme": "light",
          "timezone": "Asia/Kolkata",
          "backgroundColor": "rgba(255, 255, 255, 1)",
          "gridColor": "rgba(46, 46, 46, 0.06)",
          "watchlist": [],
          "withdateranges": true,
          "compareSymbols": [],
          "show_popup_button": true,
          "popup_height": "650",
          "popup_width": "1000",
          "studies": [],
          "autosize": true
        }`;
      container.current.appendChild(script);
      return () => {
      if (container.current) {
        container.current.innerHTML = "";
      }
    };
  }, []);


  return (
    <div className="tradingview-widget-container overflow-hidden" ref={container} style={{ height: "100%", width: "100%" }}>
      <div className="tradingview-widget-container__widget" style={{ height: "calc(100% - 32px)", width: "100%" }}></div>
      <div className="tradingview-widget-copyright pb-5"><a href="https://www.tradingview.com/" rel="noopener nofollow" target="_blank"><span className="blue-text">Track all markets on TradingView</span></a></div>
    </div>
  );
}


export default TradingViewChart;
