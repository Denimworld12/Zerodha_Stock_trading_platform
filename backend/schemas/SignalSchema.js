const mongoose = require("mongoose");

// One row per signal the quant engine produced, INCLUDING the ones it refused
// to trade. A log of only the fires cannot answer "why was it quiet on Tuesday",
// which is the question you actually ask when a live strategy underperforms.
const SignalSchema = new mongoose.Schema({
  symbol: { type: String, required: true, index: true },
  timeframe: { type: String, default: "15m" },
  barTime: { type: Date, required: true },
  side: { type: Number, enum: [-1, 0, 1], required: true },
  entry: Number,
  stop: Number,
  target: Number,
  rr: Number,
  confidence: Number,
  reason: String,
  blockedBy: String,
  status: {
    type: String,
    enum: ["generated", "blocked", "submitted", "rejected"],
    default: "generated",
    index: true,
  },
  source: { type: String, default: "qsmc" },
}, { timestamps: true });

// The engine is stateless and recomputes on every poll, so the same bar can be
// offered repeatedly. This makes a re-post idempotent instead of duplicating.
SignalSchema.index({ symbol: 1, timeframe: 1, barTime: 1 }, { unique: true });

module.exports = { SignalSchema };
