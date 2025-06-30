const mongoose = require("mongoose");

const OrderSchema = new mongoose.Schema({
  name: String,
  qty: Number,
  price: Number,
  mode: String, // BUY or SELL
  stopLoss: Number, // Optional
  target: Number, // Optional
}, { timestamps: true });

const OrderModel = mongoose.model("order", OrderSchema);
module.exports = { OrderModel };
