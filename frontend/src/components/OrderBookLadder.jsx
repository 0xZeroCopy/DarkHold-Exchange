import React, { useMemo } from 'react';

export default function OrderBookLadder({ depthData }) {
  // Memoize top-10 levels to optimize rendering performance[cite: 1]
  const topBids = useMemo(() => (depthData.bids || []).slice(0, 10), [depthData.bids]);
  const topAsks = useMemo(() => (depthData.asks || []).slice(0, 10), [depthData.asks]);

  return (
    <div className="bg-slate-900 text-slate-100 p-4 rounded-xl border border-slate-800 shadow-2xl font-mono">
      <h2 className="text-sm font-semibold tracking-wider uppercase text-slate-400 mb-3">Live Order Book Ladder</h2>
      <div className="grid grid-cols-2 gap-4">
        {/* Asks Section (Sellers) */}
        <div>
          <span className="text-xs text-rose-400 font-semibold uppercase">Asks (Sell Orders)</span>
          <div className="mt-2 space-y-1">
            {topAsks.map((ask, idx) => (
              <div key={idx} className="flex justify-between items-center text-sm bg-rose-950/30 px-2 py-1 rounded border-l-2 border-rose-500">
                <span className="text-rose-400 font-bold">${ask.price}</span>
                <span className="text-slate-300">{ask.quantity} tix</span>
              </div>
            ))}
          </div>
        </div>

        {/* Bids Section (Buyers) */}
        <div>
          <span className="text-xs text-emerald-400 font-semibold uppercase">Bids (Buy Orders)</span>
          <div className="mt-2 space-y-1">
            {topBids.map((bid, idx) => (
              <div key={idx} className="flex justify-between items-center text-sm bg-emerald-950/30 px-2 py-1 rounded border-r-2 border-emerald-500">
                <span className="text-emerald-400 font-bold">${bid.price}</span>
                <span className="text-slate-300">{bid.quantity} tix</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}