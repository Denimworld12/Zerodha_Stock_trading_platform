import React, { useState, useContext } from "react";
import { Link } from "react-router-dom";
import axios from "axios";

import GeneralContext from "./GeneralContext";
import "./SellWindow.css";

const BuyWindow = ({ uid }) => {
    const [stockQuantity, setStockQuantity] = useState(1);
    const [stockPrice, setStockPrice] = useState(0.0);
    const [position, setPosition] = useState({ x: 100, y: 100 });
    const [dragging, setDragging] = useState(false);
    const [offset, setOffset] = useState({ x: 0, y: 0 });


    const generalContext = useContext(GeneralContext);

    const handleMouseDown = (e) => {
        setDragging(true);
        setOffset({
            x: e.clientX - position.x,
            y: e.clientY - position.y
        });
    };

    const handleMouseMove = (e) => {
        if (dragging) {
            let newX = e.clientX - offset.x;
            let newY = e.clientY - offset.y;
            // Optional: Limit popup within window bounds
            const windowWidth = window.innerWidth;
            const windowHeight = window.innerHeight;
            const popupWidth = 300;  // approximate width
            const popupHeight = 200; // approximate height

            newX = Math.max(0, Math.min(newX, windowWidth - popupWidth));
            newY = Math.max(0, Math.min(newY, windowHeight - popupHeight));

            setPosition({ x: newX, y: newY });
        }
    };

    const handleMouseUp = () => {
        setDragging(false);
    };

    const handleSellClick = () => {
        axios.post("http://localhost:3002/order", {
            name: uid,
            qty: stockQuantity,
            price: stockPrice,
            mode: "Sell",
        });
        if (generalContext?.closeSellWindow) {
            generalContext.closeSellWindow();
        } else {
            console.warn("closeSellWindow not available");
        }
    };

    const handleCancelClick = () => {
        if (generalContext?.closeSellWindow) {
            generalContext.closeSellWindow();
        } else {
            console.warn("closeSellWindow not available");
        }
    };


    return (
        <div
            className="buy-popup"
            style={{
                top: position.y,
                left: position.x,
                position: "absolute",
                width: "300px"
            }}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
        >
            <div
                className="popup-header-sell"
                onMouseDown={handleMouseDown}
                onMouseUp={handleMouseUp}
            >
                Sell Order
            </div>

            <div className="regular-order">
                <div className="inputs">
                    <fieldset>
                        <legend>Qty.</legend>
                        <input
                            type="number"
                            name="qty"
                            id="qty"
                            onChange={(e) => setStockQuantity(e.target.value)}
                            value={stockQuantity}
                        />
                    </fieldset>
                    <fieldset>
                        <legend>Price</legend>
                        <input
                            type="number"
                            name="price"
                            id="price"
                            step="0.05"
                            onChange={(e) => setStockPrice(e.target.value)}
                            value={stockPrice}
                        />
                    </fieldset>
                </div>
            </div>

            <div className="buttons">
                <span>Margin required ₹140.65</span>
                <div>
                    <Link className="btn btn-red" onClick={handleSellClick}>
                        Sell
                    </Link>
                    <Link to="" className="btn btn-grey" onClick={handleCancelClick}>
                        Cancel
                    </Link>
                </div>
            </div>
        </div>
    );
};

export default BuyWindow;
