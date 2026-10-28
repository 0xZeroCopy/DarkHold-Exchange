import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import http from 'http';
import mongoose from 'mongoose';
import { WebSocketServer, WebSocket } from 'ws';
import { EngineClient } from './services/engineClient.js';
import { verifyWsToken } from './middleware/authMiddleware.js';
import authRoutes from './routes/authRoutes.js';
import User from './models/User.js';

// ──────────────────────────────────────────────
// Configuration
// ──────────────────────────────────────────────
const PORT = Number(process.env.PORT || 5000);
const MONGO_URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/darkhold';
const ENGINE_HOST = process.env.ENGINE_HOST || '127.0.0.1';
const ENGINE_PORT = Number(process.env.ENGINE_PORT || 9000);
const FACE_VALUE = Number(process.env.FACE_VALUE || 100);

const config = {
  faceValue: FACE_VALUE,
  maxPrice: FACE_VALUE * 2, // anti-scalping collar: 2x face value
  maxQuantity: Number(process.env.MAX_ORDER_QUANTITY || 1000),
};

// ──────────────────────────────────────────────
// Token Bucket Rate Limiter per account
// ──────────────────────────────────────────────
class TokenBucket {
  constructor(capacity = 30, refillPerSec = 20) {
    this.capacity = capacity;
    this.tokens = capacity;
    this.refillPerSec = refillPerSec;
    this.lastRefill = Date.now();
  }

  tryConsume(count = 1) {
    const now = Date.now();
    const elapsed = (now - this.lastRefill) / 1000;
    this.tokens = Math.min(this.capacity, this.tokens + elapsed * this.refillPerSec);
    this.lastRefill = now;

    if (this.tokens >= count) {
      this.tokens -= count;
      return true;
    }
    return false;
  }
}

const rateLimiters = new Map();
function checkRateLimit(accountId) {
  if (!rateLimiters.has(accountId)) {
    rateLimiters.set(accountId, new TokenBucket(30, 20));
  }
  return rateLimiters.get(accountId).tryConsume(1);
}

// ──────────────────────────────────────────────
// Client Session Hub (Multi-user concurrency)
// ──────────────────────────────────────────────
const sessions = new Map(); // accountId -> Set<WebSocket>
const userOrders = new Map(); // accountId -> Array<Order>
const recentTrades = []; // Circular buffer of latest trades

const send = (ws, data) => {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(data));
  }
};

const hub = {
  toAccount(accountId, data) {
    sessions.get(Number(accountId))?.forEach((ws) => send(ws, data));
  },
  broadcast(data) {
    wss.clients.forEach((ws) => send(ws, data));
  },
};

// ──────────────────────────────────────────────
// Express App & Middleware (MongoDB Account Management & Auth)
// ──────────────────────────────────────────────
const app = express();
app.use(cors({
  origin: process.env.CORS_ORIGIN || 'http://localhost:3000',
  credentials: true,
}));
app.use(express.json());
app.use(cookieParser());

// Auth & user management endpoints (JWTs + MongoDB)
app.use('/api/auth', authRoutes);

app.get('/health', (_req, res) => {
  res.json({
    ok: mongoose.connection.readyState === 1 && engine.connected,
    db: mongoose.connection.readyState === 1,
    engine: engine.connected,
  });
});

const server = http.createServer(app);
const wss = new WebSocketServer({ server, maxPayload: 16 * 1024 });

// ──────────────────────────────────────────────
// TCP Connection to C++ Engine Worker Thread Queues
// ──────────────────────────────────────────────
const engine = new EngineClient(ENGINE_HOST, ENGINE_PORT);

engine.on('connected', () => {
  hub.broadcast({ type: 'ENGINE_STATUS', online: true });
});

engine.on('disconnected', () => {
  hub.broadcast({ type: 'ENGINE_STATUS', online: false });
});

// Helper: refresh user balance from the C++ worker thread managing that account
async function pushLiveBalance(accountId) {
  try {
    const balances = await engine.getBalance(accountId);
    if (balances) {
      hub.toAccount(accountId, { type: 'BALANCE_UPDATE', balances });
    }
  } catch (_) {}
}

// ──────────────────────────────────────────────
// WebSocket Protocol & JSON Handlers
// ──────────────────────────────────────────────
const unregister = (ws) => {
  if (ws.accountId != null) {
    const set = sessions.get(ws.accountId);
    set?.delete(ws);
    if (set && set.size === 0) sessions.delete(ws.accountId);
    ws.accountId = null;
    ws.authenticated = false;
  }
};

let clientOrderCounter = 1000;

wss.on('connection', (ws) => {
  ws.accountId = null;
  ws.authenticated = false;
  ws.isAlive = true;

  ws.on('pong', () => { ws.isAlive = true; });

  // Send engine online status immediately
  send(ws, { type: 'ENGINE_STATUS', online: engine.connected });

  ws.on('message', async (raw) => {
    let payload;
    try {
      payload = JSON.parse(raw);
    } catch {
      return send(ws, { type: 'ERROR', message: 'Invalid JSON payload.' });
    }

    try {
      // ── 1. AUTH / REGISTER_USER with JWT ───────────────────────────
      if (payload.action === 'AUTH' || payload.action === 'REGISTER_USER') {
        const token = String(payload.token || '');
        let decoded = null;

        if (token) {
          try {
            decoded = verifyWsToken(token);
          } catch (err) {
            return send(ws, { type: 'AUTH_ERROR', message: 'Invalid or expired token. Please sign in again.' });
          }
        } else if (payload.userId) {
          // Fallback support for demo trader ID
          decoded = { accountId: Number(payload.userId), username: `Trader #${payload.userId}` };
        } else {
          return send(ws, { type: 'AUTH_ERROR', message: 'Authentication token required.' });
        }

        unregister(ws);
        ws.accountId = Number(decoded.accountId);
        ws.authenticated = true;

        if (!sessions.has(ws.accountId)) {
          sessions.set(ws.accountId, new Set());
        }
        sessions.get(ws.accountId).add(ws);

        // Fetch user from MongoDB for account profile
        const user = await User.findOne({ accountId: ws.accountId });

        // Query live balance directly from C++ engine worker thread
        let liveBalances = null;
        if (engine.connected) {
          liveBalances = await engine.getBalance(ws.accountId).catch(() => null);
        }

        send(ws, { type: 'AUTH_OK', accountId: ws.accountId, role: decoded.role });
        send(ws, {
          type: 'INIT_USER_DATA',
          balances: liveBalances || user?.balances || {
            availableCash: 100000,
            heldCash: 0,
            availableTickets: 500,
            heldTickets: 0,
          },
          orders: userOrders.get(ws.accountId) || [],
          trades: recentTrades.slice(0, 20),
          depth: { bids: [], asks: [], lastPrice: null },
          config,
        });
        return;
      }

      // ── Require Auth for all trading actions ─────────────────────────
      if (!ws.authenticated || ws.accountId == null) {
        return send(ws, { type: 'AUTH_ERROR', message: 'Not authenticated. Send AUTH first.' });
      }

      // ── Rate Limiting (Token Bucket per Account) ─────────────────────
      if (!checkRateLimit(ws.accountId)) {
        return send(ws, { type: 'ERROR', message: 'Rate limit exceeded. Please slow down.' });
      }

      // ── 2. SUBMIT_ORDER (Hand off to C++ worker queue over TCP) ───────
      if (payload.action === 'SUBMIT_ORDER') {
        if (!engine.connected) {
          return send(ws, { type: 'ERROR', message: 'Matching engine is offline.' });
        }

        const price = Number(payload.price);
        const quantity = Number(payload.quantity);
        const isBuy = Boolean(payload.isBuy);
        const tickerId = Number(payload.tickerId || 1);

        if (!Number.isInteger(price) || price < 1) {
          return send(ws, { type: 'ERROR', message: 'Price must be a whole dollar of at least $1.' });
        }
        if (price > config.maxPrice) {
          return send(ws, { type: 'ERROR', message: `Price collar: price cannot exceed $${config.maxPrice}.` });
        }
        if (!Number.isInteger(quantity) || quantity < 1 || quantity > config.maxQuantity) {
          return send(ws, { type: 'ERROR', message: `Quantity must be between 1 and ${config.maxQuantity}.` });
        }

        const localOrderId = ++clientOrderCounter;
        const newOrder = {
          orderId: localOrderId,
          accountId: ws.accountId,
          isBuy,
          price,
          quantity,
          quantityRemaining: quantity,
          status: 'ESCROWED',
          createdAt: new Date().toISOString(),
        };

        if (!userOrders.has(ws.accountId)) {
          userOrders.set(ws.accountId, []);
        }
        userOrders.get(ws.accountId).unshift(newOrder);

        // Notify client order accepted
        hub.toAccount(ws.accountId, { type: 'ORDER_ACCEPTED', order: newOrder });

        // Hand off over TCP to the C++ worker thread queue
        try {
          const { fills } = await engine.submitOrder({
            isBuy,
            price,
            quantity,
            accountId: ws.accountId,
            tickerId,
          });

          // Process fills reported by the matching engine
          if (fills && fills.length > 0) {
            for (const fill of fills) {
              const tradeItem = {
                tradeID: fill.tradeId,
                price: fill.price,
                quantity: fill.quantity,
                timestamp: new Date().toISOString(),
              };
              recentTrades.unshift(tradeItem);
              hub.broadcast({ type: 'TRADE_EXECUTED', ...tradeItem });

              newOrder.quantityRemaining = Math.max(0, newOrder.quantityRemaining - fill.quantity);
              newOrder.status = newOrder.quantityRemaining === 0 ? 'FILLED' : 'PARTIALLY_FILLED';
              hub.toAccount(ws.accountId, { type: 'ORDER_UPDATE', order: newOrder });
            }
          }

          // Push updated balances from C++ engine worker thread
          await pushLiveBalance(ws.accountId);
        } catch (engineErr) {
          // Escrow failure or rejection reported by C++ worker thread
          newOrder.status = 'CANCELLED';
          hub.toAccount(ws.accountId, { type: 'ORDER_UPDATE', order: newOrder });
          hub.toAccount(ws.accountId, { type: 'ERROR', message: engineErr.message });
          await pushLiveBalance(ws.accountId);
        }
      }

      // ── 3. CANCEL_ORDER ──────────────────────────────────────────────
      else if (payload.action === 'CANCEL_ORDER') {
        if (!engine.connected) {
          return send(ws, { type: 'ERROR', message: 'Matching engine is offline.' });
        }

        const orderId = Number(payload.orderID);
        if (!orderId) {
          return send(ws, { type: 'ERROR', message: 'Invalid order ID.' });
        }

        // Hand over cancel to C++ worker queue over TCP
        const ok = await engine.cancelOrder(orderId).catch(() => false);
        const list = userOrders.get(ws.accountId);
        const ord = list?.find((o) => o.orderId === orderId);
        if (ord) {
          ord.status = ok ? 'CANCELLED' : 'FAILED';
          hub.toAccount(ws.accountId, { type: 'ORDER_UPDATE', order: ord });
        }

        // Refresh balance after escrow release
        await pushLiveBalance(ws.accountId);
      }
    } catch (err) {
      console.error('WebSocket handler error:', err);
      send(ws, { type: 'ERROR', message: 'Internal server error.' });
    }
  });

  ws.on('close', () => unregister(ws));
});

// Periodic heartbeat to drop stale sockets (every 30s)
setInterval(() => {
  wss.clients.forEach((ws) => {
    if (!ws.isAlive) return ws.terminate();
    ws.isAlive = false;
    ws.ping();
  });
}, 30000);

// ──────────────────────────────────────────────
// Bootstrap Database & Server
// ──────────────────────────────────────────────
try {
  await mongoose.connect(MONGO_URI, { serverSelectionTimeoutMS: 5000 });
  console.log(`🍃 MongoDB connected (${MONGO_URI})`);
} catch (err) {
  console.warn(`⚠️  MongoDB connection warning: ${err.message}.`);
}

server.listen(PORT, () => {
  console.log(`🚀 Gateway running on http://localhost:${PORT} (ws://localhost:${PORT})`);
});
