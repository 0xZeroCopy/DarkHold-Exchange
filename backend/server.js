import express from 'express';
import http from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import net from 'net';
import mongoose from 'mongoose';
import User from './models/User.js';
import Order from './models/Order.js';

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

const CPP_TCP_PORT = 9000;
const CPP_TCP_HOST = '127.0.0.1';

mongoose.connect('mongodb://127.0.0.1:27017/darkhold')
  .then(() => console.log('🍃 MongoDB Connected'))
  .catch(err => console.error('MongoDB Connection Error:', err));

let engineSocket = new net.Socket();
let isConnecting = false;
const activeSockets = new Map();

const broadcast = (data, targetAccountId = null) => {
  const payload = JSON.stringify(data);
  if (targetAccountId && activeSockets.has(targetAccountId)) {
    const socket = activeSockets.get(targetAccountId);
    if (socket.readyState === WebSocket.OPEN) socket.send(payload);
  } else {
    wss.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) client.send(payload);
    });
  }
};

function connectToEngine() {
  if (isConnecting) return;
  isConnecting = true;

  engineSocket = new net.Socket();

  engineSocket.connect(CPP_TCP_PORT, CPP_TCP_HOST, () => {
    isConnecting = false;
    console.log('🟢 Connected to C++ TCP Matching Engine on 127.0.0.1:9000');
  });

  engineSocket.on('error', (err) => console.error('⚠️ Engine Socket Error:', err.message));

  engineSocket.on('close', () => {
    isConnecting = false;
    console.log('🔴 C++ Engine TCP Connection Closed. Reconnecting in 2s...');
    setTimeout(connectToEngine, 2000);
  });

  engineSocket.on('data', async (data) => {
    const responses = data.toString().split('\n');

    for (const resp of responses) {
      if (!resp.trim()) continue;
      const parts = resp.trim().split(' ');

      if (parts[0] === 'F') {
        const tradeID = Number(parts[1]);
        const price = Number(parts[2]);
        const quantity = Number(parts[3]);
        const totalCost = price * quantity;

        try {
          // Identify matching orders in DB
          const buyOrder = await Order.findOne({ price: price, isBuy: true, status: { $in: ['ESCROWED', 'PARTIALLY_FILLED'] } }).sort({ createdAt: 1 });
          const sellOrder = await Order.findOne({ price: price, isBuy: false, status: { $in: ['ESCROWED', 'PARTIALLY_FILLED'] } }).sort({ createdAt: 1 });

          if (buyOrder && sellOrder) {
            const buyer = await User.findOne({ accountId: buyOrder.accountId });
            if (buyer && buyer.balances) {
              buyer.balances.heldCash = Math.max(0, buyer.balances.heldCash - totalCost);
              buyer.balances.availableTickets += quantity;
              await buyer.save();
              broadcast({ type: 'BALANCE_UPDATE', balances: buyer.balances }, buyer.accountId);
            }

            const seller = await User.findOne({ accountId: sellOrder.accountId });
            if (seller && seller.balances) {
              seller.balances.heldTickets = Math.max(0, seller.balances.heldTickets - quantity);
              seller.balances.availableCash += totalCost;
              await seller.save();
              broadcast({ type: 'BALANCE_UPDATE', balances: seller.balances }, seller.accountId);
            }

            buyOrder.quantityRemaining -= quantity;
            buyOrder.status = buyOrder.quantityRemaining <= 0 ? 'FILLED' : 'PARTIALLY_FILLED';
            await buyOrder.save();

            sellOrder.quantityRemaining -= quantity;
            sellOrder.status = sellOrder.quantityRemaining <= 0 ? 'FILLED' : 'PARTIALLY_FILLED';
            await sellOrder.save();
          } else {
            await Order.updateMany(
              { price: price, status: 'ESCROWED' },
              { $set: { status: 'FILLED', quantityRemaining: 0 } }
            );
          }

          broadcast({ type: 'TRADE_EXECUTED', tradeID, price, quantity });
        } catch (dbErr) {
          console.error('Error settling trade in MongoDB:', dbErr.message);
        }
      }
      else if (parts[0] === 'X') {
        broadcast({ type: 'ORDER_CANCELLED', success: parts[1] === 'ok' });
      }
    }
  });
}

connectToEngine();

function packCommand(type, cancelOrderID, orderPayload, nowMs) {
  const buffer = Buffer.alloc(51);
  let offset = 0;
  const currentNow = BigInt(nowMs || Date.now());

  buffer.writeBigUInt64LE(currentNow, offset);
  offset += 8;
  buffer.writeUInt8(type, offset);
  offset += 1;

  if (type === 2) { 
    buffer.writeBigUInt64LE(BigInt(cancelOrderID || 0), offset);
    offset += 34; 
  } else if (type === 1 && orderPayload) { 
    buffer.writeBigUInt64LE(BigInt(orderPayload.orderID), offset); offset += 8;
    buffer.writeUInt32LE(orderPayload.quantityRemaining, offset); offset += 4;
    buffer.writeUInt32LE(orderPayload.price, offset); offset += 4;
    buffer.writeUInt8(orderPayload.isBuy ? 1 : 0, offset); offset += 1;
    buffer.writeBigUInt64LE(BigInt(orderPayload.accountID), offset); offset += 8;
    buffer.writeBigUInt64LE(BigInt((nowMs || Date.now()) + 600000), offset); offset += 8;
    buffer.writeUInt8(orderPayload.isMarket ? 1 : 0, offset); offset += 1;
  } else {
    offset += 34; 
  }
  buffer.writeBigUInt64LE(currentNow, offset);
  
  return buffer;
}

wss.on('connection', (ws) => {
  let userAccountId = null;

  ws.on('message', async (message) => {
    try {
      const payload = JSON.parse(message);
      const now = Date.now();

      if (payload.action === 'REGISTER_USER') {
        userAccountId = Number(payload.userId) || 1001;
        activeSockets.set(userAccountId, ws);

        let user = await User.findOne({ accountId: userAccountId });
        if (!user) {
          // Explicitly grant massive default balances so new users never hit escrow blocks
          user = await User.create({ 
            accountId: userAccountId, 
            name: `Trader #${userAccountId}`,
            balances: { availableCash: 100000, heldCash: 0, availableTickets: 500, heldTickets: 0 }
          });
        } else if (!user.balances) {
          user.balances = { availableCash: 100000, heldCash: 0, availableTickets: 500, heldTickets: 0 };
          await user.save();
        }

        const userOrders = await Order.find({ accountId: userAccountId }).sort({ createdAt: -1 }).limit(20);
        ws.send(JSON.stringify({ type: 'INIT_USER_DATA', balances: user.balances, orders: userOrders }));
        return;
      }

      if (payload.action === 'SUBMIT_ORDER') {
        const accountId = Number(payload.userId) || userAccountId || 1001;
        const isBuy = Boolean(payload.isBuy);
        const price = Math.round(Number(payload.price));
        const quantity = Math.round(Number(payload.quantity));
        const totalCost = price * quantity;

        const user = await User.findOne({ accountId });
        if (user && user.balances) {
          if (isBuy) {
            if (user.balances.availableCash < totalCost) {
              ws.send(JSON.stringify({ type: 'ERROR', message: 'Insufficient cash.' }));
              return; // STOP execution here
            }
            user.balances.availableCash -= totalCost;
            user.balances.heldCash += totalCost;
          } else {
            if (user.balances.availableTickets < quantity) {
              ws.send(JSON.stringify({ type: 'ERROR', message: 'Insufficient tickets.' }));
              return; // STOP execution here
            }
            user.balances.availableTickets -= quantity;
            user.balances.heldTickets += quantity;
          }
          await user.save();
          ws.send(JSON.stringify({ type: 'BALANCE_UPDATE', balances: user.balances }));
        }

        const generatedOrderId = Math.floor(100000 + Math.random() * 900000);
        const orderData = { orderID: generatedOrderId, quantityRemaining: quantity, price, isBuy, accountID: accountId, isMarket: false };
        const binaryCmd = packCommand(1, 0, orderData, now);

        if (engineSocket.writable) engineSocket.write(binaryCmd);

        await Order.create({
          orderId: generatedOrderId, accountId, isBuy, price, quantity, quantityRemaining: quantity, status: 'ESCROWED'
        });

        ws.send(JSON.stringify({
          type: 'ORDER_ACCEPTED', orderID: generatedOrderId, accountID: accountId, isBuy, price, quantity
        }));
      }
    } catch (err) {
      ws.send(JSON.stringify({ type: 'ERROR', message: err.message }));
    }
  });

  ws.on('close', () => {
    if (userAccountId) activeSockets.delete(userAccountId);
  });
});

server.listen(5000, () => console.log('🚀 Gateway running on ws://localhost:5000'));