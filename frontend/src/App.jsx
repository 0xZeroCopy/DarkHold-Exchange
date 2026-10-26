import React, { useState, useCallback, useEffect, useRef } from 'react';
import { useWebSocket } from './hooks/useWebSocket.js';
import OrderBookLadder from './components/OrderBookLadder.jsx';
import DepthChart from './components/DepthChart.jsx';

const WS_URL =
  import.meta.env.VITE_WS_URL ||
  `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.hostname}:5000`;

const OPEN_STATUSES = ['ESCROWED', 'PARTIALLY_FILLED'];
const STATUS_STYLES = {
  FILLED: 'bg-green-50 text-green-600 border-green-200',
  PARTIALLY_FILLED: 'bg-yellow-50 text-yellow-600 border-yellow-200',
  CANCELLED: 'bg-red-50 text-red-600 border-red-200',
  EXPIRED: 'bg-gray-100 text-gray-500 border-gray-200',
  ESCROWED: 'bg-blue-50 text-blue-500 border-blue-200'
};

const money = (n) => `$${Number(n ?? 0).toLocaleString()}`;
const timeOf = (d) => (d ? new Date(d).toLocaleTimeString() : '--');

export default function App() {
  const [userId, setUserId] = useState('1001');
  const [balances, setBalances] = useState(null);
  const [orders, setOrders] = useState([]);
  const [trades, setTrades] = useState([]);
  const [config, setConfig] = useState({ maxPrice: 200, maxQuantity: 1000 });
  const [engineOnline, setEngineOnline] = useState(true);
  const [notice, setNotice] = useState(null);
  const [price, setPrice] = useState('150');
  const [quantity, setQuantity] = useState('1');
  const [isBuy, setIsBuy] = useState(true);

  const userIdRef = useRef(userId);
  userIdRef.current = userId;
  const noticeTimer = useRef(null);

  const showNotice = useCallback((kind, text) => {
    setNotice({ kind, text });
    clearTimeout(noticeTimer.current);
    noticeTimer.current = setTimeout(() => setNotice(null), 5000);
  }, []);

  const upsertOrder = (order) =>
    setOrders((prev) => {
      const i = prev.findIndex((o) => o.orderId === order.orderId);
      if (i === -1) return [order, ...prev];
      const next = [...prev];
      next[i] = order;
      return next;
    });

  const handleMessage = useCallback((data) => {
    switch (data.type) {
      case 'INIT_USER_DATA':
        setBalances(data.balances);
        setOrders(data.orders || []);
        setTrades(data.trades || []);
        if (data.config) setConfig(data.config);
        break;
      case 'ORDER_ACCEPTED':
      case 'ORDER_UPDATE':
        upsertOrder(data.order);
        break;
      case 'BALANCE_UPDATE':
        setBalances(data.balances);
        break;
      case 'TRADE_EXECUTED':
        setTrades((prev) => [data, ...prev].slice(0, 20));
        break;
      case 'ENGINE_STATUS':
        setEngineOnline(data.online);
        break;
      case 'ERROR':
        showNotice('error', data.message);
        break;
      case 'WARNING':
        showNotice('warn', data.message);
        break;
      default:
        break;
    }
  }, [showNotice]);

  const register = useCallback((send) => send({ action: 'REGISTER_USER', userId: userIdRef.current }), []);
  const { depthData, isConnected, lastPrice, send } = useWebSocket(WS_URL, { onOpen: register, onMessage: handleMessage });

  // Switching trader re-registers on the same socket
  useEffect(() => {
    setBalances(null);
    setOrders([]);
    send({ action: 'REGISTER_USER', userId });
  }, [userId, send]);

  const handleSubmitOrder = (e) => {
    e.preventDefault();
    const p = Number(price);
    const q = Number(quantity);
    if (!Number.isInteger(p) || p < 1) return showNotice('error', 'Price must be a whole number of at least $1.');
    if (p > config.maxPrice) return showNotice('error', `Price collar: price cannot exceed $${config.maxPrice} (2x face value).`);
    if (!Number.isInteger(q) || q < 1 || q > config.maxQuantity) return showNotice('error', `Quantity must be between 1 and ${config.maxQuantity}.`);
    if (!send({ action: 'SUBMIT_ORDER', isBuy, price: p, quantity: q })) showNotice('error', 'Not connected to the gateway.');
  };

  const handleCancelOrder = (orderId) => send({ action: 'CANCEL_ORDER', orderID: orderId });

  const canTrade = isConnected && engineOnline && balances;
  const estimate = Number(price) * Number(quantity);

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900 p-4 md:p-8 font-sans">
      <div className="max-w-6xl mx-auto space-y-6">

        <header className="flex flex-wrap gap-4 justify-between items-center bg-white p-6 rounded-xl border border-gray-200 shadow-sm">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-gray-800">THE DARKHOLD EXCHANGE</h1>
            <p className="text-sm text-gray-500 mt-1">C++ TCP Matching Engine + Node Gateway</p>
          </div>
          <div className="flex items-center gap-4 flex-wrap">
            <div className="text-right">
              <p className="text-xs font-semibold text-gray-400 uppercase">Last Price</p>
              <p className="text-lg font-bold text-gray-800">{lastPrice != null ? money(lastPrice) : '—'}</p>
            </div>
            <div className="flex items-center gap-2 text-xs font-semibold">
              <span className={`inline-block w-2.5 h-2.5 rounded-full ${isConnected ? 'bg-green-500' : 'bg-red-500'}`} />
              <span className="text-gray-500">Gateway {isConnected ? 'online' : 'offline'}</span>
              <span className={`inline-block w-2.5 h-2.5 rounded-full ${isConnected && engineOnline ? 'bg-green-500' : 'bg-red-500'}`} />
              <span className="text-gray-500">Engine {isConnected && engineOnline ? 'online' : 'offline'}</span>
            </div>
            <div className="flex items-center space-x-3">
              <label className="text-sm font-medium text-gray-600">Switch User:</label>
              <select
                value={userId}
                onChange={(e) => setUserId(e.target.value)}
                className="bg-white border border-gray-300 text-gray-700 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="1001">Trader #1001</option>
                <option value="1002">Trader #1002</option>
              </select>
            </div>
          </div>
        </header>

        {notice && (
          <div
            role="alert"
            className={`px-4 py-3 rounded-lg text-sm font-medium border ${
              notice.kind === 'error' ? 'bg-red-50 text-red-700 border-red-200' : 'bg-yellow-50 text-yellow-700 border-yellow-200'
            }`}
          >
            {notice.text}
          </div>
        )}

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            ['Available Cash', balances && money(balances.availableCash)],
            ['Escrowed Cash', balances && money(balances.heldCash)],
            ['Available Tickets', balances && balances.availableTickets],
            ['Escrowed Tickets', balances && balances.heldTickets]
          ].map(([label, value]) => (
            <div key={label} className="bg-white p-4 rounded-xl border border-gray-200 shadow-sm">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">{label}</p>
              <p className="text-xl font-bold text-gray-800 mt-1">{value ?? '…'}</p>
            </div>
          ))}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="bg-white p-6 rounded-xl border border-gray-200 shadow-sm h-fit">
            <h2 className="text-lg font-bold text-gray-800 mb-4 uppercase">Place Order</h2>
            <form onSubmit={handleSubmitOrder} className="space-y-4">
              <div className="flex bg-gray-100 rounded-lg p-1 border border-gray-200">
                <button type="button" onClick={() => setIsBuy(true)}
                  className={`flex-1 py-2 rounded-md font-semibold text-sm transition-all ${isBuy ? 'bg-green-100 text-green-700 shadow-sm border border-green-200' : 'text-gray-500 hover:text-gray-700'}`}>
                  BUY
                </button>
                <button type="button" onClick={() => setIsBuy(false)}
                  className={`flex-1 py-2 rounded-md font-semibold text-sm transition-all ${!isBuy ? 'bg-pink-100 text-pink-700 shadow-sm border border-pink-200' : 'text-gray-500 hover:text-gray-700'}`}>
                  SELL
                </button>
              </div>

              <div>
                <label className="text-xs font-semibold text-gray-600 block mb-1">PRICE ($)</label>
                <input type="number" min="1" max={config.maxPrice} step="1" value={price} onChange={(e) => setPrice(e.target.value)} required
                  className="w-full bg-white border border-gray-300 rounded-lg px-3 py-2 text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500" />
                <span className="text-[11px] text-gray-400 mt-1 block">Anti-scalping collar cap: ${config.maxPrice}</span>
              </div>

              <div>
                <label className="text-xs font-semibold text-gray-600 block mb-1">QUANTITY</label>
                <input type="number" min="1" max={config.maxQuantity} step="1" value={quantity} onChange={(e) => setQuantity(e.target.value)} required
                  className="w-full bg-white border border-gray-300 rounded-lg px-3 py-2 text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500" />
                {Number.isFinite(estimate) && estimate > 0 && (
                  <span className="text-[11px] text-gray-400 mt-1 block">
                    {isBuy ? 'Cash escrowed' : 'Order value'}: {money(estimate)}
                  </span>
                )}
              </div>

              <button type="submit" disabled={!canTrade}
                className={`w-full py-3 rounded-lg font-bold transition-all shadow-sm mt-2 text-white disabled:opacity-50 disabled:cursor-not-allowed ${isBuy ? 'bg-green-600 hover:bg-green-700' : 'bg-red-500 hover:bg-red-600'}`}>
                {!isConnected ? 'Connecting…' : !engineOnline ? 'Engine offline' : `Submit ${isBuy ? 'Buy' : 'Sell'} Order`}
              </button>
              <p className="text-[11px] text-gray-400">Open orders expire after 10 minutes.</p>
            </form>
          </div>

          <div className="md:col-span-2 space-y-6">
            <OrderBookLadder depthData={depthData} />
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <DepthChart depthData={depthData} />
              <div className="bg-slate-900 text-slate-100 p-4 rounded-xl border border-slate-800 shadow-xl">
                <h2 className="text-sm font-semibold tracking-wider uppercase text-slate-400 mb-3">Recent Trades</h2>
                <div className="space-y-1 max-h-32 overflow-y-auto font-mono text-sm">
                  {trades.length === 0 && <div className="text-xs text-slate-500">No trades yet</div>}
                  {trades.map((t, i) => (
                    <div key={`${t.tradeID}-${i}`} className="flex justify-between text-slate-300">
                      <span className="text-cyan-400 font-bold">{money(t.price)}</span>
                      <span>{t.quantity} tix</span>
                      <span className="text-slate-500">{timeOf(t.timestamp)}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="bg-white p-6 rounded-xl border border-gray-200 shadow-sm">
          <div className="flex justify-between items-center mb-6">
            <h2 className="text-lg font-bold text-gray-800 uppercase tracking-wide">ORDER LEDGER</h2>
            <span className="text-sm font-medium text-gray-400">{orders.length} Order(s) Recorded</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm text-gray-600">
              <thead className="text-xs text-gray-400 uppercase font-semibold border-b border-gray-100">
                <tr>
                  <th className="pb-3 px-2">ORDER ID</th>
                  <th className="pb-3 px-2">TYPE</th>
                  <th className="pb-3 px-2">PRICE</th>
                  <th className="pb-3 px-2">FILLED / QTY</th>
                  <th className="pb-3 px-2">STATUS</th>
                  <th className="pb-3 px-2 text-right">TIME / ACTION</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {orders.length === 0 ? (
                  <tr><td colSpan="6" className="py-8 text-center text-gray-400 font-medium">No orders recorded yet.</td></tr>
                ) : (
                  orders.map((order) => (
                    <tr key={order.orderId} className="hover:bg-gray-50 transition-colors">
                      <td className="py-4 px-2 font-bold text-gray-800">#{order.orderId}</td>
                      <td className="py-4 px-2">
                        <span className={`px-2.5 py-1 rounded text-xs font-bold tracking-wide ${order.isBuy ? 'bg-green-100 text-green-700' : 'bg-pink-100 text-pink-700'}`}>
                          {order.isBuy ? 'BUY' : 'SELL'}
                        </span>
                      </td>
                      <td className="py-4 px-2 font-bold text-gray-800">${Number(order.price).toFixed(2)}</td>
                      <td className="py-4 px-2 font-medium">{order.quantity - order.quantityRemaining} / {order.quantity}</td>
                      <td className="py-4 px-2">
                        <span className={`px-2 py-1 rounded text-xs font-bold border tracking-wide ${STATUS_STYLES[order.status] || STATUS_STYLES.ESCROWED}`}>
                          {order.status}
                        </span>
                      </td>
                      <td className="py-4 px-2 text-right">
                        {OPEN_STATUSES.includes(order.status) ? (
                          <button onClick={() => handleCancelOrder(order.orderId)} className="text-xs font-semibold text-red-500 hover:text-red-700 underline">
                            Cancel
                          </button>
                        ) : (
                          <span className="text-xs text-gray-400">{timeOf(order.createdAt)}</span>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
