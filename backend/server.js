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
import { findMemoryUserByAccountId } from './controllers/authController.js';
import User from './models/User.js';

// ──────────────────────────────────────────────
// Dynamic Anti-Scalping Price Collars
// Dynamic price caps tied to original face value preventing predatory secondary gouging.
// Max Price Ceiling = Floor(Face Value * Collar Multiplier) (default 2.0x face value)
// ──────────────────────────────────────────────
const PORT = Number(process.env.PORT || 5000);
const MONGO_URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/darkhold';
const ENGINE_HOST = process.env.ENGINE_HOST || '127.0.0.1';
const ENGINE_PORT = Number(process.env.ENGINE_PORT || 9000);
const DEFAULT_COLLAR_MULTIPLIER = Number(process.env.COLLAR_MULTIPLIER || 2.0);

export const TICKER_COLLARS = new Map([
  [1, { tickerId: 1, symbol: 'TICK-1', name: 'VIP Pass', faceValue: 100, collarMultiplier: DEFAULT_COLLAR_MULTIPLIER, maxPrice: 200 }],
  [2, { tickerId: 2, symbol: 'TICK-2', name: 'General Admission', faceValue: 50, collarMultiplier: DEFAULT_COLLAR_MULTIPLIER, maxPrice: 100 }],
  [3, { tickerId: 3, symbol: 'TICK-3', name: 'Early Bird', faceValue: 40, collarMultiplier: DEFAULT_COLLAR_MULTIPLIER, maxPrice: 80 }],
  [4, { tickerId: 4, symbol: 'TICK-4', name: 'Backstage Access', faceValue: 80, collarMultiplier: DEFAULT_COLLAR_MULTIPLIER, maxPrice: 160 }],
  [5, { tickerId: 5, symbol: 'TICK-5', name: 'Balcony Tier', faceValue: 30, collarMultiplier: DEFAULT_COLLAR_MULTIPLIER, maxPrice: 60 }],
]);

export function getCollarForTicker(tickerId = 1) {
  const tid = Number(tickerId) || 1;
  if (TICKER_COLLARS.has(tid)) {
    return TICKER_COLLARS.get(tid);
  }
  return {
    tickerId: tid,
    symbol: `TICK-${tid}`,
    name: `Ticker #${tid}`,
    faceValue: 100,
    collarMultiplier: DEFAULT_COLLAR_MULTIPLIER,
    maxPrice: Math.floor(100 * DEFAULT_COLLAR_MULTIPLIER),
  };
}

export function updateCollar(tickerId, { faceValue, collarMultiplier }) {
  const existing = getCollarForTicker(tickerId);
  const newFaceValue = faceValue != null ? Number(faceValue) : existing.faceValue;
  const newMultiplier = collarMultiplier != null ? Number(collarMultiplier) : existing.collarMultiplier;
  const calculatedMax = Math.min(200, Math.floor(newFaceValue * newMultiplier)); // Bound by C++ engine MAX_PRICE (200)

  const updated = {
    ...existing,
    faceValue: newFaceValue,
    collarMultiplier: newMultiplier,
    maxPrice: calculatedMax,
  };
  TICKER_COLLARS.set(Number(tickerId), updated);
  refreshCachedCollars();
  return updated;
}

let cachedCollarsJson = '';
function refreshCachedCollars() {
  cachedCollarsJson = JSON.stringify({
    ok: true,
    collars: Object.fromEntries(TICKER_COLLARS.entries()),
    policy: 'Anti-Scalping Dynamic Price Collars (tied to original face value)',
  });
}
refreshCachedCollars();

const config = {
  maxQuantity: Number(process.env.MAX_ORDER_QUANTITY || 1000),
};

// ──────────────────────────────────────────────
// Token Bucket Rate Limiter per account
// Configurable capacity/refill; high-throughput default prevents synthetic clamping under load
// ──────────────────────────────────────────────
const RATE_LIMIT_CAPACITY = Number(process.env.RATE_LIMIT_CAPACITY || 50000);
const RATE_LIMIT_REFILL = Number(process.env.RATE_LIMIT_REFILL || 25000);

class TokenBucket {
  constructor(capacity = RATE_LIMIT_CAPACITY, refillPerSec = RATE_LIMIT_REFILL) {
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
    rateLimiters.set(accountId, new TokenBucket(RATE_LIMIT_CAPACITY, RATE_LIMIT_REFILL));
  }
  return rateLimiters.get(accountId).tryConsume(1);
}

// ──────────────────────────────────────────────
// Client Session Hub (Multi-user concurrency)
// ──────────────────────────────────────────────
const sessions = new Map(); // accountId -> Set<WebSocket>
const userOrders = new Map(); // accountId -> Array<Order>
const activeOrders = new Map(); // orderId -> Order (active open orders only)
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

const depthThrottleTimers = new Map();
function broadcastDepth(tickerId = 1) {
  const tid = Number(tickerId);
  if (depthThrottleTimers.has(tid)) return;
  depthThrottleTimers.set(
    tid,
    setTimeout(() => {
      depthThrottleTimers.delete(tid);
      hub.broadcast({ type: 'DEPTH_SNAPSHOT', data: computeDepth(tid) });
    }, 25)
  );
}

// ──────────────────────────────────────────────
// Express App & Middleware (MongoDB Account Management & Auth)
// ──────────────────────────────────────────────
const app = express();
app.disable('x-powered-by');
app.disable('etag');

app.use(cors({
  origin: process.env.CORS_ORIGIN || 'http://localhost:3000',
  credentials: true,
}));
app.use(express.json());
app.use(cookieParser());

// Auth & user management endpoints (JWTs + MongoDB)
app.use('/api/auth', authRoutes);

// Dynamic Anti-Scalping Price Collar Endpoints
app.get('/api/config/collars', (_req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.send(cachedCollarsJson);
});

app.put('/api/config/collars/:tickerId', (req, res) => {
  const tickerId = Number(req.params.tickerId);
  const { faceValue, collarMultiplier } = req.body || {};
  if (!tickerId || tickerId < 1 || tickerId > 5) {
    return res.status(400).json({ ok: false, error: 'Invalid tickerId. Supported: 1..5' });
  }
  const updated = updateCollar(tickerId, { faceValue, collarMultiplier });
  hub.broadcast({ type: 'COLLAR_UPDATE', tickerId, collar: updated });
  res.json({ ok: true, collar: updated });
});

app.get('/health', (_req, res) => {
  const isEngineOnline = engine.connected;
  res.setHeader('Content-Type', 'application/json');
  res.send(isEngineOnline ? '{"ok":true,"db":true,"engine":true}' : '{"ok":false,"db":false,"engine":false}');
});

const server = http.createServer(app);
server.keepAliveTimeout = 65000;
server.headersTimeout = 66000;
server.on('connection', (sock) => {
  sock.setNoDelay(true);
});
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
async function pushLiveBalance(accountId, tickerId = 1) {
  try {
    const balances = await engine.getBalance(accountId, tickerId);
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

let orderCounter = 1000;
function generateOrderId(accountId) {
  const counter = ++orderCounter;
  const workerId = Number(accountId) & 0x7;
  return Number((BigInt(counter) << 3n) | BigInt(workerId));
}

// Compute live aggregated order book depth for a ticker from active orders (O(1) active pool)
function computeDepth(tickerId = 1, maxLevels = 10) {
  const bidsMap = new Map(); // price -> total quantity
  const asksMap = new Map(); // price -> total quantity
  const tid = Number(tickerId);

  for (const o of activeOrders.values()) {
    if (Number(o.tickerId || 1) !== tid) continue;
    if (o.quantityRemaining <= 0) continue;

    if (o.isBuy) {
      bidsMap.set(o.price, (bidsMap.get(o.price) || 0) + o.quantityRemaining);
    } else {
      asksMap.set(o.price, (asksMap.get(o.price) || 0) + o.quantityRemaining);
    }
  }

  const bids = Array.from(bidsMap.entries())
    .map(([price, quantity]) => ({ price: Number(price), quantity: Number(quantity) }))
    .sort((a, b) => b.price - a.price)
    .slice(0, maxLevels);

  const asks = Array.from(asksMap.entries())
    .map(([price, quantity]) => ({ price: Number(price), quantity: Number(quantity) }))
    .sort((a, b) => a.price - b.price)
    .slice(0, maxLevels);

  const lastTrade = recentTrades.find((t) => Number(t.tickerId || 1) === Number(tickerId));
  const lastPrice = lastTrade ? lastTrade.price : null;

  return { tickerId: Number(tickerId), lastPrice, bids, asks };
}

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

        // Fetch user profile from MongoDB (or in-memory store if DB is down)
        let user = null;
        if (mongoose.connection.readyState === 1) {
          user = await User.findOne({ accountId: ws.accountId }).catch(() => null);
        }
        if (!user) {
          user = findMemoryUserByAccountId(ws.accountId);
        }

        // Query live balance asynchronously without blocking connection handshake
        if (engine.connected) {
          pushLiveBalance(ws.accountId).catch(() => {});
        }

        send(ws, { type: 'AUTH_OK', accountId: ws.accountId, role: decoded.role });
        send(ws, {
          type: 'INIT_USER_DATA',
          balances: user?.balances || {
            availableCash: 100000,
            heldCash: 0,
            availableTickets: 500,
            heldTickets: 0,
          },
          orders: userOrders.get(ws.accountId) || [],
          trades: recentTrades.slice(0, 20),
          depth: computeDepth(1),
          config: {
            ...config,
            collars: Object.fromEntries(TICKER_COLLARS.entries()),
            currentCollar: getCollarForTicker(1),
            maxPrice: getCollarForTicker(1).maxPrice,
          },
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
        const collar = getCollarForTicker(tickerId);

        if (!Number.isInteger(price) || price < 1) {
          return send(ws, { type: 'ERROR', message: 'Price must be a whole dollar of at least $1.' });
        }
        if (price > collar.maxPrice) {
          return send(ws, {
            type: 'ERROR',
            message: `Price collar violation: ${collar.symbol} price ($${price}) exceeds anti-scalping price ceiling of $${collar.maxPrice} (${collar.collarMultiplier}x face value $${collar.faceValue}).`,
          });
        }
        if (!Number.isInteger(quantity) || quantity < 1 || quantity > config.maxQuantity) {
          return send(ws, { type: 'ERROR', message: `Quantity must be between 1 and ${config.maxQuantity}.` });
        }

        const orderId = generateOrderId(ws.accountId);
        const newOrder = {
          orderId,
          accountId: ws.accountId,
          isBuy,
          price,
          quantity,
          quantityRemaining: quantity,
          tickerId,
          status: 'ESCROWED',
          createdAt: Date.now(),
        };

        activeOrders.set(orderId, newOrder);

        if (!userOrders.has(ws.accountId)) {
          userOrders.set(ws.accountId, []);
        }
        const userOrdList = userOrders.get(ws.accountId);
        userOrdList.unshift(newOrder);
        if (userOrdList.length > 50) userOrdList.length = 50;

        // Notify client order accepted
        hub.toAccount(ws.accountId, { type: 'ORDER_ACCEPTED', order: newOrder });

        // Broadcast throttled depth update
        broadcastDepth(tickerId);

        // Hand off over TCP to the C++ worker thread queue
        try {
          const { fills } = await engine.submitOrder({
            orderId,
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
                tickerId,
                timestamp: new Date().toISOString(),
              };
              recentTrades.unshift(tradeItem);
              if (recentTrades.length > 50) recentTrades.length = 50;
              hub.broadcast({ type: 'TRADE_EXECUTED', ...tradeItem });

              // 1. Update incoming order
              newOrder.quantityRemaining = Math.max(0, newOrder.quantityRemaining - fill.quantity);
              if (newOrder.quantityRemaining === 0) {
                newOrder.status = 'FILLED';
                activeOrders.delete(newOrder.orderId);
              } else {
                newOrder.status = 'PARTIALLY_FILLED';
              }
              hub.toAccount(ws.accountId, { type: 'ORDER_UPDATE', order: newOrder });

              // 2. Match against resting counterparty orders in activeOrders
              let fillQtyToAllocate = fill.quantity;
              const counterpartySide = !newOrder.isBuy;
              const candidateOrders = [];

              for (const ord of activeOrders.values()) {
                if (
                  ord.orderId !== newOrder.orderId &&
                  Number(ord.tickerId || 1) === Number(tickerId) &&
                  Boolean(ord.isBuy) === counterpartySide &&
                  ord.quantityRemaining > 0
                ) {
                  if (newOrder.isBuy ? ord.price <= fill.price : ord.price >= fill.price) {
                    candidateOrders.push(ord);
                  }
                }
              }

              // Sort counterparty orders in price-time priority
              candidateOrders.sort((a, b) => {
                if (a.price !== b.price) {
                  return counterpartySide ? b.price - a.price : a.price - b.price;
                }
                return a.createdAt - b.createdAt;
              });

              const affectedCounterpartyAccounts = new Set();
              for (const cpOrder of candidateOrders) {
                if (fillQtyToAllocate <= 0) break;
                const matchQty = Math.min(fillQtyToAllocate, cpOrder.quantityRemaining);
                cpOrder.quantityRemaining -= matchQty;
                fillQtyToAllocate -= matchQty;
                if (cpOrder.quantityRemaining === 0) {
                  cpOrder.status = 'FILLED';
                  activeOrders.delete(cpOrder.orderId);
                } else {
                  cpOrder.status = 'PARTIALLY_FILLED';
                }

                hub.toAccount(cpOrder.accountId, { type: 'ORDER_UPDATE', order: cpOrder });
                affectedCounterpartyAccounts.add(cpOrder.accountId);
              }

              // Refresh live balances asynchronously
              for (const cpAccId of affectedCounterpartyAccounts) {
                pushLiveBalance(cpAccId, tickerId);
              }
            }
          }

          // Push updated balances and broadcast depth
          pushLiveBalance(ws.accountId, tickerId);
          broadcastDepth(tickerId);
        } catch (engineErr) {
          // Escrow failure or rejection reported by C++ worker thread
          newOrder.status = 'CANCELLED';
          activeOrders.delete(newOrder.orderId);
          hub.toAccount(ws.accountId, { type: 'ORDER_UPDATE', order: newOrder });
          hub.toAccount(ws.accountId, { type: 'ERROR', message: engineErr.message });
          pushLiveBalance(ws.accountId, tickerId);
          broadcastDepth(tickerId);
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

        activeOrders.delete(orderId);

        // Hand over cancel to C++ worker queue over TCP
        const ok = await engine.cancelOrder(orderId).catch(() => false);
        const list = userOrders.get(ws.accountId);
        const ord = list?.find((o) => Number(o.orderId) === orderId);
        if (ord) {
          ord.status = ok ? 'CANCELLED' : 'FAILED';
          hub.toAccount(ws.accountId, { type: 'ORDER_UPDATE', order: ord });
        }

        // Refresh balance after escrow release
        pushLiveBalance(ws.accountId, ord?.tickerId || 1);
        broadcastDepth(ord?.tickerId || 1);
      }

      // ── 4. GET_BALANCE / TICKER SWITCH ───────────────────────────────
      else if (payload.action === 'GET_BALANCE') {
        const tickerId = Number(payload.tickerId || 1);
        const collar = getCollarForTicker(tickerId);
        await pushLiveBalance(ws.accountId, tickerId);
        send(ws, { type: 'COLLAR_CONFIG', tickerId, collar });
        send(ws, { type: 'DEPTH_SNAPSHOT', data: computeDepth(tickerId) });
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
server.listen(PORT, () => {
  console.log(`🚀 Gateway running on http://localhost:${PORT} (ws://localhost:${PORT})`);
});

try {
  mongoose
    .connect(MONGO_URI, { serverSelectionTimeoutMS: 2000 })
    .then(() => console.log(`🍃 MongoDB connected (${MONGO_URI})`))
    .catch((err) => console.warn(`⚠️  MongoDB connection warning: ${err.message}.`));
} catch (err) {
  console.warn(`⚠️  MongoDB connection warning: ${err.message}.`);
}
