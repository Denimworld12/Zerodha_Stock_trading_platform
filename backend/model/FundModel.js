const mongoose = require("mongoose");
// FundSchema.js exports { FundSchema }, so the old default-style require here
// handed mongoose the WRAPPER OBJECT instead of the schema. Mongoose then
// compiled a model whose only path was a subdocument called "FundSchema",
// so openingBalance / availableCash / usedMargin silently did not exist.
const { FundSchema } = require("../schemas/FundSchema");

const Fund = mongoose.model("funds", FundSchema);

module.exports = { Fund };
