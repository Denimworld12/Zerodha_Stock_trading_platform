const { model } = require('mongoose')
const { OrderSchema } = require('../schemas/OrderSchema')
const OrderModel = model("order", OrderSchema)
module.exports = { OrderModel }