/**
 * Seed the local database so the dashboard opens with something in it.
 *
 * Safe by design: refuses to run against anything that is not localhost, so a
 * stray `npm run seed` with a production MONGO_URL exported cannot wipe real
 * accounts.
 *
 *   npm run seed          insert only if the collections are empty
 *   npm run seed -- --force   wipe and reinsert
 */
require("dotenv").config();
const mongoose = require("mongoose");

const { Fund } = require("../model/FundModel");
const { HoldingModel } = require("../model/HoldingModel");
const { PositionModel } = require("../model/PositionModel");
const { OrderModel } = require("../model/OrderModel");

const url = process.env.MONGO_URL || "mongodb://localhost:27017/tradingmitra";
const force = process.argv.includes("--force");

const isLocal = /(localhost|127\.0\.0\.1|mongo:)/.test(url);
if (!isLocal) {
  console.error("✖ Refusing to seed a non-local database.");
  console.error("  MONGO_URL points at:", url.replace(/\/\/[^@]*@/, "//***:***@"));
  process.exit(1);
}

const HOLDINGS = [
  { name: "BINANCE:BTCUSDT", qty: 0.15, avg: 71250.0, price: 79905.88, net: "+12.15%", day: "+0.40%" },
  { name: "BINANCE:ETHUSDT", qty: 2.5,  avg: 2740.5,  price: 2502.36,  net: "-8.69%",  day: "-1.12%" },
  { name: "AAPL",            qty: 12,   avg: 291.4,   price: 319.97,   net: "+9.80%",  day: "-2.51%" },
  { name: "NVDA",            qty: 8,    avg: 168.2,   price: 182.44,   net: "+8.47%",  day: "+1.03%" },
];

const POSITIONS = [
  { product: "CNC", name: "BINANCE:SOLUSDT", qty: 20, avg: 128.4, price: 134.9, net: "+5.06%", day: "+2.11%", isLoss: false },
  { product: "MIS", name: "MSFT",            qty: 5,  avg: 512.0, price: 505.3, net: "-1.31%", day: "-0.62%", isLoss: true  },
];

async function main() {
  await mongoose.connect(url, { serverSelectionTimeoutMS: 8000 });
  console.log("✓ connected to", url);

  const counts = {
    funds: await Fund.countDocuments(),
    holdings: await HoldingModel.countDocuments(),
    positions: await PositionModel.countDocuments(),
    orders: await OrderModel.countDocuments(),
  };
  const hasData = Object.values(counts).some((c) => c > 0);

  if (hasData && !force) {
    console.log("• database already has data:", counts);
    console.log("  nothing changed. Use `npm run seed -- --force` to reset.");
    return;
  }

  if (force) {
    await Promise.all([
      Fund.deleteMany({}), HoldingModel.deleteMany({}),
      PositionModel.deleteMany({}), OrderModel.deleteMany({}),
    ]);
    console.log("• wiped existing collections");
  }

  await Fund.create({
    openingBalance: 100000, availableCash: 100000, usedMargin: 0, payin: 100000, payout: 0,
  });
  await HoldingModel.insertMany(HOLDINGS);
  await PositionModel.insertMany(POSITIONS);

  console.log("✓ seeded:", {
    funds: 1, holdings: HOLDINGS.length, positions: POSITIONS.length, orders: 0,
  });
  console.log("  opening balance ₹1,00,000 · 4 holdings · 2 open positions");
}

main()
  .catch((err) => { console.error("✖ seed failed:", err.message); process.exitCode = 1; })
  .finally(() => mongoose.disconnect());
