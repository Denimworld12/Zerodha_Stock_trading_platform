const {Schema} = require ('mongoose');
const WhishlistSchema = new Schema ({
    name: String,
    price: Number,
    percent:String,
    isDown: Boolean,
})
module.exports={WhishlistSchema}