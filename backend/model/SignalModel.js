const { model } = require("mongoose");
const { SignalSchema } = require("../schemas/SignalSchema");

const SignalModel = model("signal", SignalSchema);

module.exports = { SignalModel };
