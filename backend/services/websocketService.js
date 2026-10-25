import { WebSocketServer, WebSocket } from 'ws';
import Event from '../models/Event.js';
import Order from '../models/Order.js';
import { EscrowService } from './escrowService.js';

const orderBook = { lastPrice: 180.00, bids: [], asks: [] };
const clientsMap = new Map();

export const initWebSocketServer = (server) => {
  const wss = new WebSocketServer({ server });

  setInterval(() => {
    const payload = JSON.stringify({
      type: 'DEPTH_SNAPSHOT',
      timestamp: Date.now(),
      data: {
        lastPrice: orderBook.lastPrice,
        bids: orderBook.bids.map(b => ({ price: b.price, quantity: b.quantityRemaining })),
        asks: orderBook.asks.map(a => ({ price: a.price, quantity: a.quantityRemaining }))
      }
    });
    wss.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) client.send(payload);
    });
  }, 100);

  wss.on('connection', (ws) => {
    console.log("🟢 WebSocket Client Connected");

    ws.on('message', async (message) => {
      try {
        const payload = JSON.parse(message);
        console.log(`📩 Received Action: ${payload.action}`);

        if (payload.action === 'SUBMIT_ORDER') {
          const userId = payload.userId?.trim();
          const eventId = payload.eventId?.trim() || '60d5ecb8b5c9c22b1c8e1002';
          const price = Number(payload.price);
          const quantity = Number(payload.quantity);
          const isBuy = Boolean(payload.isBuy);

          clientsMap.set(userId, ws);

          console.log(`🔍 Verifying Event ID: ${eventId}`);
          const event = await Event.findById(eventId);
          if (!event) throw new Error('Event not found. Run node seed.js first.');
          if (price > event.maxCollarPrice) throw new Error(`Exceeds max collar price $${event.maxCollarPrice}`);

          console.log(`🔒 Locking Escrow for User: ${userId} (${isBuy ? 'BUY' : 'SELL'})`);
          const newBalances = await EscrowService.lockEscrow(userId, isBuy, price, quantity);
          ws.send(JSON.stringify({ type: 'BALANCE_UPDATE', balances: newBalances }));

          const generatedOrderId = Math.floor(100000 + Math.random() * 900000);
          let remainingQty = quantity;
          const oppositeBook = isBuy ? orderBook.asks : orderBook.bids;

          console.log(`⚙️ Running Matching Engine for Order #${generatedOrderId}`);
          while (oppositeBook.length > 0 && remainingQty > 0) {
            const bestOpposite = oppositeBook[0];
            const isMatch = isBuy ? price >= bestOpposite.price : price <= bestOpposite.price;
            if (!isMatch) break;

            console.log(`⚡ MATCH FOUND! Trading @ $${bestOpposite.price}`);
            const matchPrice = bestOpposite.price;
            const matchQty = Math.min(remainingQty, bestOpposite.quantityRemaining);

            remainingQty -= matchQty;
            bestOpposite.quantityRemaining -= matchQty;
            orderBook.lastPrice = matchPrice;

            const buyerId = isBuy ? userId : bestOpposite.accountID;
            const sellerId = isBuy ? bestOpposite.accountID : userId;

            const settlement = await EscrowService.settleTrade(buyerId, sellerId, matchPrice, matchQty);
            if (settlement) {
              const buyerWs = clientsMap.get(buyerId);
              if (buyerWs?.readyState === WebSocket.OPEN) buyerWs.send(JSON.stringify({ type: 'BALANCE_UPDATE', balances: settlement.buyerBalances }));
              const sellerWs = clientsMap.get(sellerId);
              if (sellerWs?.readyState === WebSocket.OPEN) sellerWs.send(JSON.stringify({ type: 'BALANCE_UPDATE', balances: settlement.sellerBalances }));
            }

            await Order.findOneAndUpdate(
              { orderID: bestOpposite.orderID },
              { quantityRemaining: bestOpposite.quantityRemaining, status: bestOpposite.quantityRemaining === 0 ? 'FILLED' : 'PARTIAL' }
            );

            const tradePayload = JSON.stringify({ type: 'TRADE_EXECUTED', orderID: bestOpposite.orderID, matchedPrice: matchPrice, quantity: matchQty });
            wss.clients.forEach((c) => { if (c.readyState === WebSocket.OPEN) c.send(tradePayload); });

            if (bestOpposite.quantityRemaining === 0) oppositeBook.shift();
          }

          const initialStatus = remainingQty === 0 ? 'FILLED' : 'ESCROWED';

          await Order.create({
            orderID: generatedOrderId, accountID: userId, eventID: eventId, price, quantity, quantityRemaining: remainingQty, isBuy, status: initialStatus
          });

          ws.send(JSON.stringify({
            type: 'ORDER_ACCEPTED', order: { orderID: generatedOrderId, isBuy, price, quantity, status: initialStatus }
          }));

          if (remainingQty === 0) {
            const currentTradePayload = JSON.stringify({ type: 'TRADE_EXECUTED', orderID: generatedOrderId, matchedPrice: orderBook.lastPrice, quantity });
            wss.clients.forEach((c) => { if (c.readyState === WebSocket.OPEN) c.send(currentTradePayload); });
          } else {
            const currentBook = isBuy ? orderBook.bids : orderBook.asks;
            currentBook.push({ orderID: generatedOrderId, accountID: userId, price, quantityRemaining: remainingQty });
            currentBook.sort((a, b) => isBuy ? b.price - a.price : a.price - b.price);
          }
        }
      } catch (err) {
        console.error('❌ Socket Processing Error:', err.message);
        ws.send(JSON.stringify({ type: 'ERROR', message: err.message }));
      }
    });
  });
};