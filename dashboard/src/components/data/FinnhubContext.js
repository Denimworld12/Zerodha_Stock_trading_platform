// src/context/FinnhubContext.js
import React, { createContext, useContext, useEffect, useRef, useState } from "react";

const FinnhubContext = createContext();

export const useFinnhub = () => useContext(FinnhubContext);

const API_KEY = process.env.REACT_APP_FINNHUB_API_KEY;

export const FinnhubProvider = ({ children }) => {
    const socketRef = useRef(null);
    const symbolsRef = useRef(new Set()); // does NOT trigger re-renders
    const [prices, setPrices] = useState({}); // Triggers re-renders in consumers

    // Connect and handle socket
    useEffect(() => {
        if (!API_KEY) {
            console.error("Missing FINNHUB API key.");
            return;
        }

        socketRef.current = new WebSocket(`wss://ws.finnhub.io?token=${API_KEY}`);

        const socket = socketRef.current;

        socket.addEventListener("open", () => {
            symbolsRef.current.forEach((symbol) => {
                socket.send(JSON.stringify({ type: "subscribe", symbol }));
            });
        });

        socket.addEventListener("message", (event) => {
            const msg = JSON.parse(event.data);
            if (msg.type === "trade") {
                msg.data.forEach(({ s: symbol, p: price }) => {
                    setPrices((prev) => ({
                        ...prev,
                        [symbol]: price,
                    }));
                });
            }
        });

        socket.addEventListener("error", (err) => {
            console.error("WebSocket error:", err);
        });

        return () => {
            if (socket.readyState === WebSocket.OPEN) {
                symbolsRef.current.forEach((symbol) => {
                    socket.send(JSON.stringify({ type: "unsubscribe", symbol }));
                });
            }
            socket.close();
        };
    }, []);

    // Subscribe to a symbol only once
    const subscribe = (symbol) => {
        if (!symbol || symbolsRef.current.has(symbol)) return;

        symbolsRef.current.add(symbol);

        if (socketRef.current?.readyState === WebSocket.OPEN) {
            socketRef.current.send(JSON.stringify({ type: "subscribe", symbol }));
        }
    };

    const value = {
        prices,    // Live price map: { AAPL: 190.2, TSLA: 202.3, ... }
        subscribe, // Call this to subscribe to a new symbol
    };

    return (
        <FinnhubContext.Provider value={value}>
            {children}
        </FinnhubContext.Provider>
    );
};
