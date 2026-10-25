import React, { useState } from 'react';

export default function OrderEntryPanel({ onOrderSubmit, faceValue = 100 }) {
  const [side, setSide] = useState('BUY');
  const [price, setPrice] = useState(150);
  const [quantity, setQuantity] = useState(1);
  const [error, setError] = useState('');

  const maxCollarPrice = faceValue * 2; // Anti-scalping collar cap = 2x face value[cite: 1]

  const handleSubmit = (e) => {
    e.preventDefault();
    setError('');

    // Pre-validation guard against price-collar bounds[cite: 1]
    if (price > maxCollarPrice) {
      setError(`Price collar violation: Price cannot exceed $${maxCollarPrice} (2x face value).`);
      return;
    }

    if (quantity <= 0) {
      setError('Quantity must be greater than zero.');
      return;
    }

    onOrderSubmit({
      isBuy: side === 'BUY',
      price: Number(price),
      quantity: Number(quantity)
    });
  };

  return (
    <div className="bg-slate-900 text-slate-100 p-5 rounded-xl border border-slate-800 shadow-xl">
      <h2 className="text-sm font-semibold tracking-wider uppercase text-slate-400 mb-4">Place Limit Order</h2>
      
      {error && (
        <div className="bg-rose-500/10 border border-rose-500/50 text-rose-400 text-xs p-2.5 rounded mb-4">
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="flex bg-slate-800 p-1 rounded-lg">
          <button
            type="button"
            className={`flex-1 py-1.5 text-xs font-bold rounded-md transition ${side === 'BUY' ? 'bg-emerald-600 text-white' : 'text-slate-400'}`}
            onClick={() => setSide('BUY')}
          >
            BUY
          </button>
          <button
            type="button"
            className={`flex-1 py-1.5 text-xs font-bold rounded-md transition ${side === 'SELL' ? 'bg-rose-600 text-white' : 'text-slate-400'}`}
            onClick={() => setSide('SELL')}
          >
            SELL
          </button>
        </div>

        <div>
          <label className="block text-xs text-slate-400 mb-1">Limit Price ($)</label>
          <input
            type="number"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            className="w-full bg-slate-800 border border-slate-700 rounded px-3 py-2 text-sm text-slate-100 focus:outline-none focus:border-cyan-500"
          />
          <span className="text-[10px] text-slate-500 mt-1 block">Anti-Scalping Collar Cap: ${maxCollarPrice}</span>
        </div>

        <div>
          <label className="block text-xs text-slate-400 mb-1">Ticket Quantity</label>
          <input
            type="number"
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
            className="w-full bg-slate-800 border border-slate-700 rounded px-3 py-2 text-sm text-slate-100 focus:outline-none focus:border-cyan-500"
          />
        </div>

        <button
          type="submit"
          className={`w-full py-2.5 rounded-lg font-bold text-sm transition ${
            side === 'BUY' ? 'bg-emerald-500 hover:bg-emerald-400 text-slate-950' : 'bg-rose-500 hover:bg-rose-400 text-slate-950'
          }`}
        >
          Submit {side} Order
        </button>
      </form>
    </div>
  );
}