import User, { DEFAULT_BALANCES } from '../models/User.js';
import Order, { OPEN_STATUSES } from '../models/Order.js';
import Trade from '../models/Trade.js';
import { packPlace, packCancel, EXPIRY_MS } from './engineClient.js';

export class ExchangeError extends Error {}

export const serializeOrder = (o) => ({
  orderId: o.orderId,
  accountId: o.accountId,
  isBuy: o.isBuy,
  price: o.price,
  quantity: o.quantity,
  quantityRemaining: o.quantityRemaining,
  status: o.status,
  createdAt: o.createdAt,
  expiresAt: o.expiresAt
});

export function createExchange({ engine, hub, config }) {
  let idCounter = 100000;
  let chain = Promise.resolve();

  // All state changes run one at a time: the engine protocol is request/response over one socket
  // and escrow math must not interleave.
  const locked = (fn) => {
    const run = chain.then(fn);
    chain = run.catch(() => {});
    return run;
  };

  async function init() {
    const last = await Order.findOne().sort({ orderId: -1 }).lean();
    if (last) idCounter = Math.max(idCounter, last.orderId);
  }

  const pushBalances = async (accountId) => {
    const user = await User.findOne({ accountId }).lean();
    if (user) hub.toAccount(accountId, { type: 'BALANCE_UPDATE', balances: user.balances });
  };

  async function getDepth() {
    const open = await Order.find({ status: { $in: OPEN_STATUSES }, quantityRemaining: { $gt: 0 } }).lean();
    const levels = (isBuy) => {
      const m = new Map();
      for (const o of open) if (o.isBuy === isBuy) m.set(o.price, (m.get(o.price) || 0) + o.quantityRemaining);
      return [...m].map(([price, quantity]) => ({ price, quantity })).sort((a, b) => (isBuy ? b.price - a.price : a.price - b.price));
    };
    const lastTrade = await Trade.findOne().sort({ timestamp: -1 }).lean();
    return { lastPrice: lastTrade ? lastTrade.price : null, bids: levels(true), asks: levels(false) };
  }

  const broadcastDepth = async () => hub.broadcast({ type: 'DEPTH_SNAPSHOT', data: await getDepth() });

  async function getUserSnapshot(accountId) {
    let user = await User.findOne({ accountId });
    if (!user) user = await User.create({ accountId, name: `Trader #${accountId}`, balances: { ...DEFAULT_BALANCES } });
    const orders = await Order.find({ accountId }).sort({ createdAt: -1, orderId: -1 }).limit(50).lean();
    const trades = await Trade.find().sort({ timestamp: -1 }).limit(20).lean();
    return {
      balances: user.balances,
      orders: orders.map(serializeOrder),
      trades: trades.map((t) => ({ tradeID: t.tradeId, price: t.price, quantity: t.quantity, timestamp: t.timestamp })),
      depth: await getDepth(),
      config
    };
  }

  // Return an order's unfilled escrow to the owner and close it.
  async function release(order, status) {
    const rem = order.quantityRemaining;
    const inc = order.isBuy
      ? { 'balances.heldCash': -order.price * rem, 'balances.availableCash': order.price * rem }
      : { 'balances.heldTickets': -rem, 'balances.availableTickets': rem };
    await User.updateOne({ accountId: order.accountId }, { $inc: inc });
    order.status = status;
    await order.save();
    hub.toAccount(order.accountId, { type: 'ORDER_UPDATE', order: serializeOrder(order) });
    await pushBalances(order.accountId);
  }

  // Settle the fills the engine reported for `incoming`. The engine matches price-time priority and
  // trades at the resting order's price, so the counterparty is the oldest open opposite order at that price.
  async function settle(incoming, fills) {
    const touched = new Map([[incoming.orderId, incoming]]);
    const trades = [];

    for (const f of fills) {
      const cp = await Order.findOne({
        isBuy: !incoming.isBuy,
        price: f.price,
        status: { $in: OPEN_STATUSES },
        quantityRemaining: { $gte: f.quantity },
        orderId: { $ne: incoming.orderId }
      }).sort({ createdAt: 1, orderId: 1 });

      if (!cp) {
        console.error(`❌ Engine fill (trade #${f.tradeId} ${f.quantity}@${f.price}) has no matching resting order in the DB; skipped. Restart the engine to clear a stale book.`);
        continue;
      }

      const buy = incoming.isBuy ? incoming : cp;
      const sell = incoming.isBuy ? cp : incoming;
      const cost = f.price * f.quantity;
      const escrowed = buy.price * f.quantity; // buyer escrowed at their own limit; improvement is refunded

      await User.updateOne({ accountId: buy.accountId }, {
        $inc: { 'balances.heldCash': -escrowed, 'balances.availableCash': escrowed - cost, 'balances.availableTickets': f.quantity }
      });
      await User.updateOne({ accountId: sell.accountId }, {
        $inc: { 'balances.heldTickets': -f.quantity, 'balances.availableCash': cost }
      });

      for (const o of [incoming, cp]) {
        o.quantityRemaining -= f.quantity;
        o.status = o.quantityRemaining === 0 ? 'FILLED' : 'PARTIALLY_FILLED';
        await o.save();
        touched.set(o.orderId, o);
      }

      await Trade.create({
        tradeId: f.tradeId, buyOrderId: buy.orderId, sellOrderId: sell.orderId,
        buyerId: buy.accountId, sellerId: sell.accountId, price: f.price, quantity: f.quantity
      });
      trades.push({ type: 'TRADE_EXECUTED', tradeID: f.tradeId, price: f.price, quantity: f.quantity, timestamp: new Date() });
    }

    const accounts = new Set();
    for (const o of touched.values()) {
      accounts.add(o.accountId);
      hub.toAccount(o.accountId, { type: 'ORDER_UPDATE', order: serializeOrder(o) });
    }
    for (const id of accounts) await pushBalances(id);
    for (const t of trades) hub.broadcast(t);
  }

  async function matchAndSettle(order) {
    const now = Date.now();
    const lines = await engine.request([
      packPlace({ seq: engine.nextSeq(), now, orderId: order.orderId, quantity: order.quantityRemaining, price: order.price, isBuy: order.isBuy, accountId: order.accountId, expiresAt: order.expiresAt.getTime() }),
      packCancel({ seq: engine.nextSeq(), now, orderId: 0 }) // sentinel: replies "X none" after the fills
    ], 1);
    const fills = lines.filter((l) => l[0] === 'F').map((l) => {
      const [, tradeId, price, quantity] = l.split(' ').map(Number);
      return { tradeId, price, quantity };
    });
    await settle(order, fills);
  }

  const engineCancel = (orderId) =>
    engine.request([packCancel({ seq: engine.nextSeq(), now: Date.now(), orderId })], 1);

  async function expireStale() {
    const stale = await Order.find({ status: { $in: OPEN_STATUSES }, expiresAt: { $lt: new Date() } }).sort({ createdAt: 1 });
    for (const o of stale) {
      await engineCancel(o.orderId);
      await release(o, 'EXPIRED');
    }
    return stale.length;
  }

  // The engine keeps its book in memory only, so after (re)connecting we rebuild its view of our open orders.
  const resync = () => locked(async () => {
    try {
      await expireStale();
      const open = await Order.find({ status: { $in: OPEN_STATUSES }, quantityRemaining: { $gt: 0 } }).sort({ createdAt: 1, orderId: 1 });
      for (const o of open) {
        await engineCancel(o.orderId);
        await matchAndSettle(o);
      }
      if (open.length) console.log(`🔁 Re-synced ${open.length} open order(s) to the engine`);
      await broadcastDepth();
    } catch (err) {
      console.error('Resync failed (will retry on next reconnect):', err.message);
    }
  });

  const placeOrder = (accountId, { isBuy, price, quantity }) => locked(async () => {
    if (!engine.connected) throw new ExchangeError('Matching engine is offline. Please try again in a moment.');
    if (!Number.isInteger(price) || price < 1) throw new ExchangeError('Price must be a whole number of at least $1.');
    if (price > config.maxPrice) throw new ExchangeError(`Price collar: price cannot exceed $${config.maxPrice} (2x face value).`);
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > config.maxQuantity) {
      throw new ExchangeError(`Quantity must be a whole number between 1 and ${config.maxQuantity}.`);
    }

    const cost = price * quantity;
    const user = await User.findOneAndUpdate(
      isBuy ? { accountId, 'balances.availableCash': { $gte: cost } } : { accountId, 'balances.availableTickets': { $gte: quantity } },
      { $inc: isBuy ? { 'balances.availableCash': -cost, 'balances.heldCash': cost } : { 'balances.availableTickets': -quantity, 'balances.heldTickets': quantity } },
      { new: true }
    );
    if (!user) throw new ExchangeError(isBuy ? 'Insufficient cash.' : 'Insufficient tickets.');

    const now = Date.now();
    const order = await Order.create({
      orderId: ++idCounter, accountId, isBuy, price, quantity, quantityRemaining: quantity,
      status: 'ESCROWED', createdAt: new Date(now), expiresAt: new Date(now + EXPIRY_MS)
    });
    hub.toAccount(accountId, { type: 'ORDER_ACCEPTED', order: serializeOrder(order) });
    hub.toAccount(accountId, { type: 'BALANCE_UPDATE', balances: user.balances });

    try {
      await matchAndSettle(order);
    } catch (err) {
      // Order and escrow are safely recorded; resync() re-submits it once the engine is back.
      console.error('Engine failure while matching:', err.message);
      hub.toAccount(accountId, { type: 'WARNING', message: 'Engine hiccup: your order is saved and will be re-submitted automatically.' });
    }
    await broadcastDepth();
  });

  const cancelOrder = (accountId, orderId) => locked(async () => {
    const order = await Order.findOne({ orderId, accountId });
    if (!order) throw new ExchangeError('Order not found.');
    if (!OPEN_STATUSES.includes(order.status)) throw new ExchangeError(`Order #${orderId} is already ${order.status}.`);
    if (!engine.connected) throw new ExchangeError('Matching engine is offline. Please try again in a moment.');
    await engineCancel(orderId);
    await release(order, 'CANCELLED');
    await broadcastDepth();
  });

  const sweepExpired = () => locked(async () => {
    if (!engine.connected) return;
    try {
      if (await expireStale()) await broadcastDepth();
    } catch (err) {
      console.error('Expiry sweep failed:', err.message);
    }
  });

  return { init, resync, sweepExpired, placeOrder, cancelOrder, getUserSnapshot, getDepth };
}
