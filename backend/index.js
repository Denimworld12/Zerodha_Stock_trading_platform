require('dotenv').config();
const express = require("express");
const mongoose = require('mongoose');
const bodyParser = require('body-parser');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3002;
const url = process.env.MONGO_URL;

const { HoldingModel } = require('./model/HoldingModel');
const { PositionModel } = require('./model/PositionModel');
const { OrderModel } = require('./model/OrderModel');
const { Fund } = require('./model/FundModel');

app.use(cors());
app.use(bodyParser.json());
app.use(express.urlencoded({ extended: true }));

// ✅ Get all holdings
app.get("/",(req,res)=>{
    res.send({
        activeStatus: true,
        error:false,
    })
})
app.get('/holding', async (req, res) => {
    try {
        const allHolding = await HoldingModel.find({});
        res.json(allHolding);
    } catch (error) {
        res.status(500).send("Failed to fetch holdings");
    }
});

// ✅ Get all positions
app.get('/position', async (req, res) => {
    try {
        const allPosition = await PositionModel.find({});
        res.json(allPosition);
    } catch (error) {
        res.status(500).send("Failed to fetch positions");
    }
});

// ✅ Get all orders
app.get("/order", async (req, res) => {
    try {
        const allOrders = await OrderModel.find().sort({ createdAt: -1 });
        res.json(allOrders);
    } catch (err) {
        console.error("Order fetch error:", err);
        res.status(500).send("Failed to fetch orders");
    }
});
app.delete("/order/:id", async (req, res) => {
  try {
    const orderId = req.params.id;
    const { livePrice } = req.body;

    if (!livePrice || isNaN(livePrice)) {
      return res.status(400).send("Missing or invalid live price");
    }

    const order = await OrderModel.findById(orderId);
    if (!order) return res.status(404).send("Order not found");

    const currentValue = order.qty * livePrice;
    const originalCost = order.qty * order.price;

    const fund = await Fund.findOne();
    if (!fund) return res.status(500).send("Fund not found");

    if (order.mode === "BUY") {
      // Closing BUY: recover current market value
      fund.availableCash += currentValue;
      fund.usedMargin -= originalCost;
    } else {
      // Closing SELL: pay back the cost to repurchase at livePrice
      fund.availableCash += (originalCost - currentValue); // profit or loss
      fund.usedMargin -= originalCost;
    }

    fund.usedMargin = Math.max(0, fund.usedMargin);
    await fund.save();

    await OrderModel.findByIdAndDelete(orderId);
    res.send("Order closed and funds updated");
  } catch (err) {
    console.error("Error closing order:", err);
    res.status(500).send("Failed to close order");
  }
});

app.put("/funds", async (req, res) => {
  try {
    const { type, amount } = req.body;

    if (!type || !["add", "withdraw"].includes(type)) {
      return res.status(400).send("Invalid fund type");
    }

    const fund = await Fund.findOne();
    if (!fund) return res.status(404).send("Fund not found");

    if (type === "add") {
      fund.availableCash += amount;
      fund.payin = (fund.payin || 0) + amount;
    } else {
      if (fund.availableCash < amount) {
        return res.status(400).send("Insufficient funds to withdraw");
      }
      fund.availableCash -= amount;
      fund.payout = (fund.payout || 0) + amount;
    }

    await fund.save(); // <- don't forget this!
    res.json(fund);
  } catch (error) {
    console.error("Failed to update fund:", error);
    res.status(500).send("Failed to update fund");
  }
});


// ✅ FIXED: Use GET instead of POST
app.get("/funds", async (req, res) => {
    try {
        let fund = await Fund.findOne();
        if (!fund) {
            fund = new Fund({
                openingBalance: 50000,
                availableCash: 50000,
                usedMargin: 0
            });
            await fund.save();
        }
        res.json(fund);
    } catch (error) {
        res.status(500).send("Failed to fetch fund");
    }
});


// ✅ Post a new order (BUY / SELL)
app.post('/order', async (req, res) => {
    try {
        console.log("BODY RECEIVED:", req.body);

        const { name, qty, price, mode, stopLoss, target } = req.body;

        if (!name || !qty || !price || !mode) {
            return res.status(400).send("Missing required fields");
        }

        // 1. Save the order
        const newOrder = new OrderModel({
            name,
            qty,
            price,
            mode,
            stopLoss: stopLoss || null,
            target: target || null,
        });
        await newOrder.save();

        // 2. Update positions
        const existing = await PositionModel.findOne({ name });

        if (mode === "BUY") {
            if (existing) {
                const totalQty = existing.qty + qty;
                const totalCost = (existing.avg * existing.qty) + (price * qty);
                existing.qty = totalQty;
                existing.avg = totalCost / totalQty;
                existing.price = price;
                await existing.save();
            } else {
                const newPosition = new PositionModel({
                    name,
                    qty,
                    avg: price,
                    price,
                    product: "NSE",
                    day: "+0.00%",
                    isLoss: false
                });
                await newPosition.save();
            }
        }

        if (mode === "SELL") {
            if (!existing) {
                return res.status(404).send("No holdings found for sell.");
            }

            if (existing.qty < qty) {
                return res.status(400).send("Not enough quantity to sell.");
            }

            const newQty = existing.qty - qty;
            if (newQty === 0) {
                await PositionModel.deleteOne({ name });
            } else {
                existing.qty = newQty;
                existing.price = price;
                await existing.save();
            }
        }

        // 3. Update Fund (used margin, available cash)
        const fund = await Fund.findOne();
        const transactionValue = qty * price;

        if (fund) {
            if (mode === "BUY") {
                fund.usedMargin += transactionValue;
                fund.availableCash -= transactionValue;
            } else if (mode === "SELL") {
                fund.usedMargin -= transactionValue;
                fund.availableCash += transactionValue;
            }
            await fund.save();
        }

        res.status(200).send("Order processed successfully!");
    } catch (error) {
        console.error("Order error:", error);
        res.status(500).send("Failed to process order");
    }
});

// ✅ Start server
// app.listen(PORT, () => {
//     console.log('✅ Server running on PORT', PORT);
//     mongoose.connect(url)
//         .then(() => console.log("✅ DB is working Nikhil"))
//         .catch((err) => console.error("❌ DB connection failed:", err));
// });
