const { model } = require('mongoose')
const { WhishListSchema } = require('../schemas/WhishlistSchema')
const WhishlistModel = model("whishlist", WhishListSchema)
module.exports = { WhishlistModel }