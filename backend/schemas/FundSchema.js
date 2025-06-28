const mongoose = require("mongoose");

const FundSchema = new mongoose.Schema({
  openingBalance: {
    type: Number,
    required: true,
    default: 50000
  },
  availableCash: {
    type: Number,
    required: true,
    default: 50000
  },
  usedMargin: {
    type: Number,
    default: 0
  }
}, { timestamps: true });

module.exports = FundSchema;
