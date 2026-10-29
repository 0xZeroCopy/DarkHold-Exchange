import React, { useState, useCallback, useEffect, useRef } from 'react';
import { useWebSocket } from './hooks/useWebSocket.js';
import OrderBookLadder from './components/OrderBookLadder.jsx';
import DepthChart from './components/DepthChart.jsx';

const WS_URL =
  import.meta.env.VITE_WS_URL ||
  (window.location.host.includes('github.dev')
    ? `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}/ws`
    : `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.hostname}:5000`);

const OPEN_STATUSES = ['ESCROWED', 'PARTIALLY_FILLED'];
const STATUS_STYLES = {
  FILLED: 'bg-emerald-950/50 text-emerald-300 border-emerald-500/40',
  PARTIALLY_FILLED: 'bg-amber-950/50 text-amber-300 border-amber-500/40',
  CANCELLED: 'bg-rose-950/50 text-rose-300 border-rose-500/40',
  EXPIRED: 'bg-[#430605] text-[#ebd2b5]/50 border-[#ebd2b5]/20',
  ESCROWED: 'bg-[#430605] text-[#ebd2b5] border-[#ebd2b5]/30'
};

const TICKERS = [
  { id: 1, symbol: 'TICK-1', name: 'VIP Pass' },
  { id: 2, symbol: 'TICK-2', name: 'General Admission' },
  { id: 3, symbol: 'TICK-3', name: 'Early Bird' },
  { id: 4, symbol: 'TICK-4', name: 'Backstage Access' },
  { id: 5, symbol: 'TICK-5', name: 'Balcony Tier' }
];

// Anti-scalping collar configuration tied to original face value (default 2.0x max ceiling)
const DEFAULT_COLLARS = {
  1: { tickerId: 1, symbol: 'TICK-1', name: 'VIP Pass', faceValue: 100, collarMultiplier: 2.0, maxPrice: 200 },
  2: { tickerId: 2, symbol: 'TICK-2', name: 'General Admission', faceValue: 50, collarMultiplier: 2.0, maxPrice: 100 },
  3: { tickerId: 3, symbol: 'TICK-3', name: 'Early Bird', faceValue: 40, collarMultiplier: 2.0, maxPrice: 80 },
  4: { tickerId: 4, symbol: 'TICK-4', name: 'Backstage Access', faceValue: 80, collarMultiplier: 2.0, maxPrice: 160 },
  5: { tickerId: 5, symbol: 'TICK-5', name: 'Balcony Tier', faceValue: 30, collarMultiplier: 2.0, maxPrice: 60 },
};

const money = (n) => `$${Number(n ?? 0).toLocaleString()}`;
const timeOf = (d) => (d ? new Date(d).toLocaleTimeString() : '--');

export default function App({ auth = {} }) {
  const [userId] = useState(String(auth?.user?.accountId || '1001'));
  const [balances, setBalances] = useState(null);
  const [orders, setOrders] = useState([]);
  const [trades, setTrades] = useState([]);
  const [config, setConfig] = useState({ maxPrice: 200, maxQuantity: 1000 });
  const [collars, setCollars] = useState(DEFAULT_COLLARS);
  const [engineOnline, setEngineOnline] = useState(true);
  const [notice, setNotice] = useState(null);
  const [price, setPrice] = useState('100');
  const [quantity, setQuantity] = useState('1');
  const [isBuy, setIsBuy] = useState(true);
  const [tickerId, setTickerId] = useState(1);

  const userIdRef = useRef(userId);
  userIdRef.current = userId;
  const noticeTimer = useRef(null);

  const currentCollar = collars[tickerId] || DEFAULT_COLLARS[tickerId] || { faceValue: 100, maxPrice: 200, collarMultiplier: 2.0 };
  const currentTicker = TICKERS.find((t) => t.id === tickerId) || TICKERS[0];

  const showNotice = useCallback((kind, text) => {
    setNotice({ kind, text });
    clearTimeout(noticeTimer.current);
    noticeTimer.current = setTimeout(() => setNotice(null), 5000);
  }, []);

  const upsertOrder = (order) =>
    setOrders((prev) => {
      const targetId = Number(order.orderId);
      const i = prev.findIndex((o) => Number(o.orderId) === targetId);
      if (i === -1) return [order, ...prev];
      const next = [...prev];
      next[i] = { ...next[i], ...order };
      return next;
    });

  const handleMessage = useCallback((data) => {
    switch (data.type) {
      case 'INIT_USER_DATA':
        setBalances(data.balances);
        setOrders(data.orders || []);
        setTrades(data.trades || []);
        if (data.config) {
          setConfig(data.config);
          if (data.config.collars) {
            setCollars((prev) => ({ ...prev, ...data.config.collars }));
          }
        }
        break;
      case 'COLLAR_CONFIG':
      case 'COLLAR_UPDATE':
        if (data.collar) {
          setCollars((prev) => ({ ...prev, [data.tickerId]: data.collar }));
        }
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
      case 'AUTH_ERROR':
        auth.logout();
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
  }, [showNotice, auth]);

  const register = useCallback((send) => send({ action: 'REGISTER_USER', userId: userIdRef.current, token: auth?.token }), [auth?.token]);
  const { depthData, isConnected, lastPrice, send } = useWebSocket(WS_URL, { onOpen: register, onMessage: handleMessage });

  const handleSelectTicker = (id) => {
    setTickerId(id);
    const targetCollar = collars[id] || DEFAULT_COLLARS[id];
    if (targetCollar && Number(price) > targetCollar.maxPrice) {
      setPrice(String(targetCollar.faceValue));
    }
    send({ action: 'GET_BALANCE', tickerId: id });
  };

  // Register the signed-in trader on the socket (the gateway takes the account from the token)
  useEffect(() => {
    setBalances(null);
    setOrders([]);
    send({ action: 'REGISTER_USER', userId, token: auth.token });
  }, [userId, send, auth.token]);

  const handleSubmitOrder = (e) => {
    e.preventDefault();
    const p = Number(price);
    const q = Number(quantity);
    if (!Number.isInteger(p) || p < 1) return showNotice('error', 'Price must be a whole number of at least $1.');
    if (p > currentCollar.maxPrice) {
      return showNotice(
        'error',
        `Anti-scalping price collar: ${currentTicker.symbol} cannot exceed $${currentCollar.maxPrice} (${currentCollar.collarMultiplier || 2}x face value $${currentCollar.faceValue}).`
      );
    }
    if (!Number.isInteger(q) || q < 1 || q > config.maxQuantity) return showNotice('error', `Quantity must be between 1 and ${config.maxQuantity}.`);
    if (!send({ action: 'SUBMIT_ORDER', isBuy, price: p, quantity: q, tickerId })) showNotice('error', 'Not connected to the gateway.');
  };

  const handleCancelOrder = (orderId) => send({ action: 'CANCEL_ORDER', orderID: orderId });

  const canTrade = isConnected && engineOnline && balances;
  const estimate = Number(price) * Number(quantity);

  return (
    <div className="min-h-screen bg-[#a5a79b] text-white p-4 md:p-8 font-sans">
      <div className="max-w-6xl mx-auto space-y-6">

        <header className="flex flex-wrap gap-4 justify-between items-center bg-[#590907] p-6 rounded-xl border border-[#590907] shadow-md text-white">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-white">THE DARKHOLD EXCHANGE</h1>
            <p className="text-sm text-[#ebd2b5]/80 mt-1">C++ TCP Matching Engine + Node Gateway</p>
          </div>
          <div className="flex items-center gap-4 flex-wrap">
            <div className="text-right">
              <p className="text-xs font-semibold text-[#ebd2b5]/70 uppercase">Last Price</p>
              <p className="text-lg font-bold text-[#ebd2b5]">{lastPrice != null ? money(lastPrice) : '—'}</p>
            </div>
            <div className="flex items-center gap-2 text-xs font-semibold">
              <span className={`inline-block w-2.5 h-2.5 rounded-full ${isConnected ? 'bg-emerald-400' : 'bg-rose-500'}`} />
              <span className="text-[#ebd2b5]/80">Gateway {isConnected ? 'online' : 'offline'}</span>
              <span className={`inline-block w-2.5 h-2.5 rounded-full ${isConnected && engineOnline ? 'bg-emerald-400' : 'bg-rose-500'}`} />
              <span className="text-[#ebd2b5]/80">Engine {isConnected && engineOnline ? 'online' : 'offline'}</span>
            </div>
            <div className="flex items-center space-x-3">
              <span className="text-sm font-medium text-white/90">
                Signed in as <span className="font-bold text-[#ebd2b5]">{auth?.user?.username || 'Trader'}</span>{' '}
                <span className="text-[#ebd2b5]/60">#{auth?.user?.accountId || userId}</span>
              </span>
              {auth?.logout && (
                <button
                  onClick={auth.logout}
                  className="bg-[#430605] border border-[#ebd2b5]/40 text-[#ebd2b5] hover:bg-[#320403] rounded-lg px-3 py-2 text-sm font-semibold transition-colors"
                >
                  Log out
                </button>
              )}
            </div>
          </div>
        </header>

        {/* 5-Ticker Type Selector */}
        <div className="flex gap-2 overflow-x-auto pb-1">
          {TICKERS.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => handleSelectTicker(t.id)}
              className={`px-4 py-2 rounded-xl font-semibold text-xs transition-all border ${
                tickerId === t.id
                  ? 'bg-[#ebd2b5] text-[#590907] border-[#ebd2b5] shadow-sm font-bold'
                  : 'bg-[#590907] text-[#ebd2b5]/80 border-[#590907] hover:bg-[#430605]'
              }`}
            >
              <span className="font-bold">{t.symbol}</span> — {t.name}
            </button>
          ))}
        </div>

        {notice && (
          <div
            role="alert"
            className={`px-4 py-3 rounded-lg text-sm font-medium border ${
              notice.kind === 'error'
                ? 'bg-rose-950/70 text-rose-200 border-rose-500/50'
                : 'bg-amber-950/70 text-amber-200 border-amber-500/50'
            }`}
          >
            {notice.text}
          </div>
        )}

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            ['Available Cash', balances && money(balances.availableCash)],
            ['Escrowed Cash', balances && money(balances.heldCash)],
            [`Available ${currentTicker.symbol}`, balances && balances.availableTickets],
            [`Escrowed ${currentTicker.symbol}`, balances && balances.heldTickets]
          ].map(([label, value]) => (
            <div key={label} className="bg-[#590907] p-4 rounded-xl border border-[#590907] shadow-md">
              <p className="text-xs font-semibold text-[#ebd2b5]/70 uppercase tracking-wider">{label}</p>
              <p className="text-xl font-bold text-white mt-1">{value ?? '…'}</p>
            </div>
          ))}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="bg-[#590907] p-6 rounded-xl border border-[#590907] shadow-md h-fit text-white">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-lg font-bold text-white uppercase">Place Order</h2>
              <span className="text-xs font-bold px-2 py-0.5 rounded bg-[#ebd2b5]/15 text-[#ebd2b5] border border-[#ebd2b5]/30">
                {currentTicker.symbol}
              </span>
            </div>
            <form onSubmit={handleSubmitOrder} className="space-y-4">
              <div className="flex bg-[#430605] rounded-lg p-1 border border-[#430605]">
                <button type="button" onClick={() => setIsBuy(true)}
                  className={`flex-1 py-2 rounded-md font-semibold text-sm transition-all ${isBuy ? 'bg-emerald-600 text-white shadow-sm' : 'text-[#ebd2b5]/70 hover:text-white'}`}>
                  BUY
                </button>
                <button type="button" onClick={() => setIsBuy(false)}
                  className={`flex-1 py-2 rounded-md font-semibold text-sm transition-all ${!isBuy ? 'bg-rose-600 text-white shadow-sm' : 'text-[#ebd2b5]/70 hover:text-white'}`}>
                  SELL
                </button>
              </div>

              <div>
                <label className="text-xs font-semibold text-[#ebd2b5] block mb-1">TICKER / ASSET</label>
                <select
                  value={tickerId}
                  onChange={(e) => handleSelectTicker(Number(e.target.value))}
                  className="w-full bg-[#430605] border border-[#ebd2b5]/30 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-[#ebd2b5]"
                >
                  {TICKERS.map((t) => (
                    <option key={t.id} value={t.id} className="bg-[#430605] text-white">
                      {t.symbol} — {t.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-xs font-semibold text-[#ebd2b5] block mb-1">PRICE ($)</label>
                <input
                  type="number"
                  min="1"
                  max={currentCollar.maxPrice}
                  step="1"
                  value={price}
                  onChange={(e) => setPrice(e.target.value)}
                  required
                  className="w-full bg-[#430605] border border-[#ebd2b5]/30 rounded-lg px-3 py-2 text-white focus:outline-none focus:ring-2 focus:ring-[#ebd2b5]"
                />
                <span className="text-[11px] text-[#ebd2b5]/70 mt-1 block">
                  Anti-scalping collar cap: ${currentCollar.maxPrice} ({currentCollar.collarMultiplier || 2}x face value ${currentCollar.faceValue})
                </span>
              </div>

              <div>
                <label className="text-xs font-semibold text-[#ebd2b5] block mb-1">QUANTITY</label>
                <input
                  type="number"
                  min="1"
                  max={config.maxQuantity}
                  step="1"
                  value={quantity}
                  onChange={(e) => setQuantity(e.target.value)}
                  required
                  className="w-full bg-[#430605] border border-[#ebd2b5]/30 rounded-lg px-3 py-2 text-white focus:outline-none focus:ring-2 focus:ring-[#ebd2b5]"
                />
                {Number.isFinite(estimate) && estimate > 0 && (
                  <span className="text-[11px] text-[#ebd2b5]/70 mt-1 block">
                    {isBuy ? 'Cash escrowed' : 'Order value'}: {money(estimate)}
                  </span>
                )}
              </div>

              <button
                type="submit"
                disabled={!canTrade}
                className={`w-full py-3 rounded-lg font-bold transition-all shadow-sm mt-2 text-white disabled:opacity-50 disabled:cursor-not-allowed ${
                  isBuy ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-rose-600 hover:bg-rose-700'
                }`}
              >
                {!isConnected ? 'Connecting…' : !engineOnline ? 'Engine offline' : `Submit ${isBuy ? 'Buy' : 'Sell'} Order (${currentTicker.symbol})`}
              </button>
              <p className="text-[11px] text-[#ebd2b5]/60">Open orders expire after 10 minutes.</p>
            </form>
          </div>

          <div className="md:col-span-2 space-y-6">
            <OrderBookLadder depthData={depthData} />
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <DepthChart depthData={depthData} />
              <div className="bg-[#590907] text-white p-4 rounded-xl border border-[#590907] shadow-md">
                <h2 className="text-sm font-semibold tracking-wider uppercase text-[#ebd2b5] mb-3">Recent Trades</h2>
                <div className="space-y-1 max-h-32 overflow-y-auto font-mono text-sm">
                  {trades.length === 0 && <div className="text-xs text-[#ebd2b5]/50">No trades yet</div>}
                  {trades.map((t, i) => (
                    <div key={`${t.tradeID}-${i}`} className="flex justify-between text-white/90">
                      <span className="text-[#ebd2b5] font-bold">{money(t.price)}</span>
                      <span>{t.quantity} tix</span>
                      <span className="text-[#ebd2b5]/50">{timeOf(t.timestamp)}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="bg-[#590907] p-6 rounded-xl border border-[#590907] shadow-md text-white">
          <div className="flex justify-between items-center mb-6">
            <h2 className="text-lg font-bold text-white uppercase tracking-wide">ORDER LEDGER</h2>
            <span className="text-sm font-medium text-[#ebd2b5]/70">{orders.length} Order(s) Recorded</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm text-white/80">
              <thead className="text-xs text-[#ebd2b5]/70 uppercase font-semibold border-b border-[#ebd2b5]/20">
                <tr>
                  <th className="pb-3 px-2">ORDER ID</th>
                  <th className="pb-3 px-2">TICKER</th>
                  <th className="pb-3 px-2">TYPE</th>
                  <th className="pb-3 px-2">PRICE</th>
                  <th className="pb-3 px-2">FILLED / QTY</th>
                  <th className="pb-3 px-2">STATUS</th>
                  <th className="pb-3 px-2 text-right">TIME / ACTION</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#590907]/40">
                {orders.length === 0 ? (
                  <tr><td colSpan="7" className="py-8 text-center text-[#ebd2b5]/50 font-medium">No orders recorded yet.</td></tr>
                ) : (
                  orders.map((order) => (
                    <tr key={order.orderId} className="hover:bg-[#430605] transition-colors border-b border-[#ebd2b5]/10">
                      <td className="py-4 px-2 font-bold text-white">#{order.orderId}</td>
                      <td className="py-4 px-2">
                        <span className="font-mono text-xs font-bold px-2 py-0.5 rounded bg-[#ebd2b5]/15 text-[#ebd2b5] border border-[#ebd2b5]/30">
                          {TICKERS.find((t) => t.id === order.tickerId)?.symbol || `TICK-${order.tickerId || 1}`}
                        </span>
                      </td>
                      <td className="py-4 px-2">
                        <span className={`px-2.5 py-1 rounded text-xs font-bold tracking-wide border ${order.isBuy ? 'bg-emerald-950/60 text-emerald-300 border-emerald-500/40' : 'bg-rose-950/60 text-rose-300 border-rose-500/40'}`}>
                          {order.isBuy ? 'BUY' : 'SELL'}
                        </span>
                      </td>
                      <td className="py-4 px-2 font-bold text-[#ebd2b5]">${Number(order.price).toFixed(2)}</td>
                      <td className="py-4 px-2 font-medium">{order.quantity - order.quantityRemaining} / {order.quantity}</td>
                      <td className="py-4 px-2">
                        <span className={`px-2 py-1 rounded text-xs font-bold border tracking-wide ${STATUS_STYLES[order.status] || STATUS_STYLES.ESCROWED}`}>
                          {order.status}
                        </span>
                      </td>
                      <td className="py-4 px-2 text-right">
                        {OPEN_STATUSES.includes(order.status) ? (
                          <button onClick={() => handleCancelOrder(order.orderId)} className="text-xs font-semibold text-rose-400 hover:text-rose-300 underline">
                            Cancel
                          </button>
                        ) : (
                          <span className="text-xs text-[#ebd2b5]/60">{timeOf(order.createdAt)}</span>
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
