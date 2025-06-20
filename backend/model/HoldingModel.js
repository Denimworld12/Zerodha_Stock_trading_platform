const {model, Schema}= require ('mongoose')
const { HoldingSchema } = require('../schemas/HoldingSchema')
const HoldingModel=  model ("holdings",HoldingSchema);
module.exports={HoldingModel};
