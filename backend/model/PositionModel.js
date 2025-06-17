const { model } = require('mongoose')
const { PositionSchema } = require('../schemas/PositionSchema')
const PositionModel = model('position', PositionSchema)
module.exports = { PositionModel }