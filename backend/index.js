require('dotenv').config();
const express = require("express");
const mongoose = require('mongoose');
const bodyParser = require('body-parser');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3002;
const url = process.env.MONGO_URL;

const { HoldingModel } = require('./model/HoldingModel');
const { PositionModel } = require('./model/PositionModel');
const { OrderModel } = require('./model/OrderModel');
const { Fund } = require('./model/FundModel');
const signalRoutes = require('./routes/signals');
const v2Routes = require('./routes/v2');
const authRoutes = require('./routes/auth');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');

// helmet sets the standard security headers (nosniff, frameguard, HSTS...).
// contentSecurityPolicy is off because this process only serves JSON; the
// React apps are served separately and set their own.
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cookieParser());

// CORS was wide open (`cors()` with no options), which lets any site on the
// internet call this API with the visitor's credentials. Restricted to the
// origins we actually ship.
const ALLOWED_ORIGINS = (process.env.CORS_ORIGINS ||
  'http://localhost:3000,http://localhost:3001').split(',').map((o) => o.trim());
app.use(cors({
  origin(origin, cb) {
    // No Origin header = curl, a mobile app, or a server-to-server call.
    if (!origin) return cb(null, true);
    if (ALLOWED_ORIGINS.includes(origin)) return cb(null, true);
    cb(new Error(`origin ${origin} is not allowed`));
  },
  // Required so the browser will send the httpOnly refresh cookie.
  credentials: true,
  allowedHeaders: ['Content-Type', 'Authorization', 'Idempotency-Key', 'X-Signal-Secret'],
}));

app.use(bodyParser.json({ limit: '256kb' }));
app.use(express.urlencoded({ extended: true, limit: '256kb' }));

// ✅ Get all holdings
app.get("/",(req,res)=>{
    res.send({
        activeStatus: true,
        error:false,
    })
})
app.use('/signals', signalRoutes);

// Local email+password auth. Auth0 is accepted alongside these whenever
// AUTH0_DOMAIN and AUTH0_AUDIENCE are set — no code change needed.
app.use('/api/auth', authRoutes);

// The v2 API: authenticated, tenant-scoped, ledger-backed, server-priced.
// The legacy routes below stay mounted until the dashboard finishes moving.
app.use('/api/v2', v2Routes);

app.get('/holding', async (req, res) => {
    try {
        const allHolding = await HoldingModel.find({});
        res.json(allHolding);
    } catch (error) {
        res.status(500).send("Failed to fetch holdings");
    }
});

// ✅ Get all positions
app.get('/position', async (req, res) => {
    try {
        const allPosition = await PositionModel.find({});
        res.json(allPosition);
    } catch (error) {
        res.status(500).send("Failed to fetch positions");
    }
});

// ✅ Get all orders
app.get("/order", async (req, res) => {
    try {
        const allOrders = await OrderModel.find().sort({ createdAt: -1 });
        res.json(allOrders);
    } catch (err) {
        console.error("Order fetch error:", err);
        res.status(500).send("Failed to fetch orders");
    }
});
app.delete("/order/:id", async (req, res) => {
  try {
    const orderId = req.params.id;
    const { livePrice } = req.body;

    if (!livePrice || isNaN(livePrice)) {
      return res.status(400).send("Missing or invalid live price");
    }

    const order = await OrderModel.findById(orderId);
    if (!order) return res.status(404).send("Order not found");

    const currentValue = order.qty * livePrice;
    const originalCost = order.qty * order.price;

    const fund = await Fund.findOne();
    if (!fund) return res.status(500).send("Fund not found");

    if (order.mode === "BUY") {
      // Closing BUY: recover current market value
      fund.availableCash += currentValue;
      fund.usedMargin -= originalCost;
    } else {
      // Closing SELL: pay back the cost to repurchase at livePrice
      fund.availableCash += (originalCost - currentValue); // profit or loss
      fund.usedMargin -= originalCost;
    }

    fund.usedMargin = Math.max(0, fund.usedMargin);
    await fund.save();

    await OrderModel.findByIdAndDelete(orderId);
    res.send("Order closed and funds updated");
  } catch (err) {
    console.error("Error closing order:", err);
    res.status(500).send("Failed to close order");
  }
});

app.put("/funds", async (req, res) => {
  try {
    const { type, amount } = req.body;

    if (!type || !["add", "withdraw"].includes(type)) {
      return res.status(400).send("Invalid fund type");
    }

    const fund = await Fund.findOne();
    if (!fund) return res.status(404).send("Fund not found");

    if (type === "add") {
      fund.availableCash += amount;
      fund.payin = (fund.payin || 0) + amount;
    } else {
      if (fund.availableCash < amount) {
        return res.status(400).send("Insufficient funds to withdraw");
      }
      fund.availableCash -= amount;
      fund.payout = (fund.payout || 0) + amount;
    }

    await fund.save(); // <- don't forget this!
    res.json(fund);
  } catch (error) {
    console.error("Failed to update fund:", error);
    res.status(500).send("Failed to update fund");
  }
});


// ✅ FIXED: Use GET instead of POST
app.get("/funds", async (req, res) => {
    try {
        let fund = await Fund.findOne();
        if (!fund) {
            fund = new Fund({
                openingBalance: 50000,
                availableCash: 50000,
                usedMargin: 0
            });
            await fund.save();
        }
        res.json(fund);
    } catch (error) {
        res.status(500).send("Failed to fetch fund");
    }
});


// ✅ Post a new order (BUY / SELL)
app.post('/order', async (req, res) => {
    try {
        console.log("BODY RECEIVED:", req.body);

        const { name, qty, price, mode, stopLoss, target } = req.body;

        if (!name || !qty || !price || !mode) {
            return res.status(400).send("Missing required fields");
        }

        // 1. Save the order
        const newOrder = new OrderModel({
            name,
            qty,
            price,
            mode,
            stopLoss: stopLoss || null,
            target: target || null,
        });
        await newOrder.save();

        // 2. Update positions
        const existing = await PositionModel.findOne({ name });

        if (mode === "BUY") {
            if (existing) {
                const totalQty = existing.qty + qty;
                const totalCost = (existing.avg * existing.qty) + (price * qty);
                existing.qty = totalQty;
                existing.avg = totalCost / totalQty;
                existing.price = price;
                await existing.save();
            } else {
                const newPosition = new PositionModel({
                    name,
                    qty,
                    avg: price,
                    price,
                    product: "NSE",
                    day: "+0.00%",
                    isLoss: false
                });
                await newPosition.save();
            }
        }

        if (mode === "SELL") {
            if (!existing) {
                return res.status(404).send("No holdings found for sell.");
            }

            if (existing.qty < qty) {
                return res.status(400).send("Not enough quantity to sell.");
            }

            const newQty = existing.qty - qty;
            if (newQty === 0) {
                await PositionModel.deleteOne({ name });
            } else {
                existing.qty = newQty;
                existing.price = price;
                await existing.save();
            }
        }

        // 3. Update Fund (used margin, available cash)
        const fund = await Fund.findOne();
        const transactionValue = qty * price;

        if (fund) {
            if (mode === "BUY") {
                fund.usedMargin += transactionValue;
                fund.availableCash -= transactionValue;
            } else if (mode === "SELL") {
                fund.usedMargin -= transactionValue;
                fund.availableCash += transactionValue;
            }
            await fund.save();
        }

        res.status(200).send("Order processed successfully!");
    } catch (error) {
        console.error("Order error:", error);
        res.status(500).send("Failed to process order");
    }
});

// ---------------------------------------------------------------------------
// Database connection.
//
// This used to sit INSIDE the app.listen callback. On Vercel (see versel.json,
// which deploys this file with @vercel/node) app.listen never runs, so mongoose
// never connected and every route hung until it timed out. Connecting at module
// load fixes serverless; caching the promise stops each warm invocation from
// opening another pool.
// ---------------------------------------------------------------------------
let dbPromise = null;

function connectDB() {
    if (!url) {
        return Promise.reject(new Error("MONGO_URL is not set (see backend/.env.example)"));
    }
    if (!dbPromise) {
        dbPromise = mongoose
            .connect(url, { serverSelectionTimeoutMS: 10000 })
            .then((conn) => {
                console.log("✅ MongoDB connected");
                return conn;
            })
            .catch((err) => {
                dbPromise = null;   // let the next request retry instead of caching the failure
                console.error("❌ DB connection failed:", err.message);
                throw err;
            });
    }
    return dbPromise;
}

connectDB().catch(() => { /* logged above; routes surface it per-request */ });

// ---------------------------------------------------------------------------
// Error handler. Must be registered AFTER every route, and must take four
// arguments or Express treats it as ordinary middleware and never calls it.
// ---------------------------------------------------------------------------
app.use((err, req, res, _next) => {
    // A blocked cross-origin request is a rejected request, not a server fault.
    // Returning 500 for it misreports our own health and hides the real cause
    // from whoever is debugging their integration.
    if (err && /not allowed/.test(err.message || '')) {
        return res.status(403).json({ error: err.message, code: 'CORS_ORIGIN_DENIED' });
    }
    if (err && err.type === 'entity.too.large') {
        return res.status(413).json({ error: 'request body too large', code: 'PAYLOAD_TOO_LARGE' });
    }
    console.error('unhandled:', err);
    res.status(500).json({ error: 'internal error', code: 'INTERNAL' });
});

// Only listen when run directly. Under @vercel/node the export is what matters.
if (require.main === module) {
    const http = require('http');
    const server = http.createServer(app);

    // The browser-facing socket shares the HTTP server, so there is one port to
    // expose and CORS/proxy configuration applies to both.
    const { attach } = require('./lib/wsserver');
    const ws = attach(server, { path: '/ws' });

    // Start the upstream market feed once, at boot, rather than lazily on the
    // first request - a cold feed means the first order hits STALE_PRICE.
    require('./lib/prices').getFeed();

    server.listen(PORT, () => {
        console.log('✅ API      http://localhost:' + PORT);
        console.log('✅ WebSocket ws://localhost:' + PORT + '/ws');
        const auth = require('./lib/auth').describeConfig();
        console.log('   auth:', auth.mode + (auth.warning ? ' — ' + auth.warning : ''));
    });

    // Close sockets and the feed before exiting, or nodemon restarts leak both.
    const shutdown = (signal) => {
        console.log(`\n${signal} received, shutting down`);
        ws.close();
        require('./lib/prices').getFeed().stop();
        server.close(() => mongoose.disconnect().finally(() => process.exit(0)));
        setTimeout(() => process.exit(1), 5000).unref();
    };
    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));
}

module.exports = app;
