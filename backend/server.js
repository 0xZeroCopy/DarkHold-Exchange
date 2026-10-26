import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import http from 'http';
import mongoose from 'mongoose';
import { WebSocketServer, WebSocket } from 'ws';
import { EngineClient } from './services/engineClient.js';
import { createExchange, ExchangeError } from './services/exchange.js';
import accessRoutes from './routes/accessRoutes.js';
import { verifyToken } from './services/authService.js';

const PORT = Number(process.env.PORT || 5000);
const MONGO_URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/darkhold';
const FACE_VALUE = Number(process.env.FACE_VALUE || 100);
const config = {
  faceValue: FACE_VALUE,
  maxPrice: FACE_VALUE * 2, // anti-scalping collar: 2x face value
  maxQuantity: Number(process.env.MAX_ORDER_QUANTITY || 1000)
};

// accountId -> set of open sockets (a trader may have several tabs)
const sessions = new Map();
const send = (ws, data) => { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(data)); };
const hub = {
  toAccount(accountId, data) { sessions.get(accountId)?.forEach((ws) => send(ws, data)); },
  broadcast(data) { wss.clients.forEach((ws) => { if (ws.accountId != null) send(ws, data); }); } // signed-in sockets only
};

const app = express();
app.use(cors());
app.use(express.json({ limit: '10kb' }));
app.use('/api/auth', accessRoutes);
const server = http.createServer(app);
const wss = new WebSocketServer({ server, maxPayload: 16 * 1024 });

const engine = new EngineClient(process.env.ENGINE_HOST || '127.0.0.1', Number(process.env.ENGINE_PORT || 9000));
const exchange = createExchange({ engine, hub, config });

app.get('/health', (req, res) => {
  res.json({ ok: mongoose.connection.readyState === 1, db: mongoose.connection.readyState === 1, engine: engine.connected });
});

const unregister = (ws) => {
  if (ws.accountId == null) return;
  const set = sessions.get(ws.accountId);
  set?.delete(ws);
  if (set && set.size === 0) sessions.delete(ws.accountId);
  ws.accountId = null;
};

wss.on('connection', (ws) => {
  ws.accountId = null;
  ws.isAlive = true;
  ws.windowStart = Date.now();
  ws.windowCount = 0;
  ws.on('pong', () => { ws.isAlive = true; });
  send(ws, { type: 'ENGINE_STATUS', online: engine.connected });

  ws.on('message', async (raw) => {
    // Basic flood protection: at most 20 messages per second per socket
    const now = Date.now();
    if (now - ws.windowStart > 1000) { ws.windowStart = now; ws.windowCount = 0; }
    if (++ws.windowCount > 20) return send(ws, { type: 'ERROR', message: 'Rate limit exceeded. Please slow down.' });

    try {
      const payload = JSON.parse(raw);

      if (payload.action === 'REGISTER_USER') {
        // The account comes from the signed token, never from the client-supplied userId.
        const session = verifyToken(payload.token);
        if (!session) return send(ws, { type: 'AUTH_ERROR', message: 'Session expired. Please sign in again.' });
        const accountId = session.accountId;
        unregister(ws);
        ws.accountId = accountId;
        if (!sessions.has(accountId)) sessions.set(accountId, new Set());
        sessions.get(accountId).add(ws);
        send(ws, { type: 'INIT_USER_DATA', ...(await exchange.getUserSnapshot(accountId)) });
        return;
      }

      if (ws.accountId == null) throw new ExchangeError('Not signed in.');

      if (payload.action === 'SUBMIT_ORDER') {
        await exchange.placeOrder(ws.accountId, {
          isBuy: Boolean(payload.isBuy),
          price: Number(payload.price),
          quantity: Number(payload.quantity)
        });
      } else if (payload.action === 'CANCEL_ORDER') {
        await exchange.cancelOrder(ws.accountId, Number(payload.orderID));
      }
    } catch (err) {
      if (!(err instanceof ExchangeError) && !(err instanceof SyntaxError)) console.error('Unhandled error:', err);
      send(ws, { type: 'ERROR', message: err instanceof ExchangeError ? err.message : 'Request failed.' });
    }
  });

  ws.on('close', () => unregister(ws));
});

// Drop dead connections
setInterval(() => {
  wss.clients.forEach((ws) => {
    if (!ws.isAlive) return ws.terminate();
    ws.isAlive = false;
    ws.ping();
  });
}, 30000);

engine.on('connected', () => {
  hub.broadcast({ type: 'ENGINE_STATUS', online: true });
  exchange.resync();
});
setInterval(() => {
  if (!engine.connected) hub.broadcast({ type: 'ENGINE_STATUS', online: false });
}, 5000);
setInterval(() => exchange.sweepExpired(), 5000);

try {
  await mongoose.connect(MONGO_URI, { serverSelectionTimeoutMS: 5000 });
  console.log(`🍃 MongoDB connected (${MONGO_URI})`);
  await exchange.init();
} catch (err) {
  console.error(`❌ Could not connect to MongoDB at ${MONGO_URI}: ${err.message}`);
  process.exit(1);
}

server.listen(PORT, () => console.log(`🚀 Gateway running on http://localhost:${PORT} (ws://localhost:${PORT})`));
