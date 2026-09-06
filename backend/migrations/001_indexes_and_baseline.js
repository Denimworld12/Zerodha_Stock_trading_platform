"use strict";

/**
 * Baseline: build every index the models declare, and register the instruments
 * we can already trade.
 *
 * Index creation cannot run inside a transaction, hence transactional: false.
 */
module.exports.transactional = false;

module.exports.up = async ({ mongoose }) => {
  require("../models"); // register schemas

  for (const [name, model] of Object.entries(mongoose.models)) {
    await model.syncIndexes();
    console.log(`    indexes: ${name}`);
  }

  const { Instrument } = require("../models");
  const instruments = [
    // Binance spot — free data, free testnet
    { symbol: "BTCUSDT", venue: "binance", assetClass: "crypto", baseCurrency: "BTC", quoteCurrency: "USDT", tickSize: "0.01", lotStep: "0.00001", minQty: "0.00001", priceScale: 2, qtyScale: 8 },
    { symbol: "ETHUSDT", venue: "binance", assetClass: "crypto", baseCurrency: "ETH", quoteCurrency: "USDT", tickSize: "0.01", lotStep: "0.0001", minQty: "0.0001", priceScale: 2, qtyScale: 8 },
    { symbol: "SOLUSDT", venue: "binance", assetClass: "crypto", baseCurrency: "SOL", quoteCurrency: "USDT", tickSize: "0.01", lotStep: "0.001", minQty: "0.001", priceScale: 2, qtyScale: 8 },
    { symbol: "BNBUSDT", venue: "binance", assetClass: "crypto", baseCurrency: "BNB", quoteCurrency: "USDT", tickSize: "0.01", lotStep: "0.001", minQty: "0.001", priceScale: 2, qtyScale: 8 },
    // OANDA practice — the free source of REAL FX, and the mirror pairs SMC
    // was never actually tested on
    { symbol: "EUR_USD", venue: "oanda_practice", assetClass: "fx", baseCurrency: "EUR", quoteCurrency: "USD", tickSize: "0.00001", lotStep: "1", minQty: "1", priceScale: 5, qtyScale: 0 },
    { symbol: "USD_CHF", venue: "oanda_practice", assetClass: "fx", baseCurrency: "USD", quoteCurrency: "CHF", tickSize: "0.00001", lotStep: "1", minQty: "1", priceScale: 5, qtyScale: 0 },
    { symbol: "GBP_USD", venue: "oanda_practice", assetClass: "fx", baseCurrency: "GBP", quoteCurrency: "USD", tickSize: "0.00001", lotStep: "1", minQty: "1", priceScale: 5, qtyScale: 0 },
    { symbol: "USD_JPY", venue: "oanda_practice", assetClass: "fx", baseCurrency: "USD", quoteCurrency: "JPY", tickSize: "0.001", lotStep: "1", minQty: "1", priceScale: 3, qtyScale: 0 },
  ];

  for (const i of instruments) {
    await Instrument.updateOne(
      { venue: i.venue, symbol: i.symbol },
      { $setOnInsert: i },
      { upsert: true }
    );
  }
  console.log(`    instruments: ${instruments.length} registered`);
};

module.exports.down = async ({ db }) => {
  await db.collection("instruments").deleteMany({});
};
