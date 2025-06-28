const mongoose = require("mongoose");
const FundSchema = require("../schemas/FundSchema");

const Fund = mongoose.model("funds", FundSchema);

module.exports = { Fund };
