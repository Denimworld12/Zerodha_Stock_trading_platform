const mongoose = require("mongoose");

const OrderSchema = new mongoose.Schema({
  name: String,
  qty: Number,
  price: Number,
  mode: String, // BUY or SELL
  stopLoss: Number, // Optional
  target: Number, // Optional
  // Set when the order came from the quant engine rather than a human click,
  // so bot fills can be told apart from manual ones in Orders/Positions.
  source: { type: String, default: "manual" },
  confidence: Number,
  reason: String,
}, { timestamps: true });

// Schema files must only DEFINE. This file used to also call
// mongoose.model("order", ...), while model/OrderModel.js registered the same
// name again - it only avoided an OverwriteModelError because the destructured
// import was undefined, which made the second call a lookup by accident.
module.exports = { OrderSchema };
