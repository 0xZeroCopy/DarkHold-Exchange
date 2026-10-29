import React, { useMemo } from 'react';

export default function OrderBookLadder({ depthData }) {
  // Memoize top-10 levels to optimize rendering performance[cite: 1]
  const topBids = useMemo(() => (depthData.bids || []).slice(0, 10), [depthData.bids]);
  const topAsks = useMemo(() => (depthData.asks || []).slice(0, 10), [depthData.asks]);

  return (
    <div className="bg-[#590907] text-white p-4 rounded-xl border border-[#590907] shadow-md font-mono">
      <h2 className="text-sm font-semibold tracking-wider uppercase text-[#ebd2b5] mb-3">Live Order Book Ladder</h2>
      <div className="grid grid-cols-2 gap-4">
        {/* Asks Section (Sellers) */}
        <div>
          <span className="text-xs text-rose-300 font-semibold uppercase">Asks (Sell Orders)</span>
          <div className="mt-2 space-y-1">
            {topAsks.length === 0 && <div className="text-xs text-[#ebd2b5]/50 px-2 py-1">No asks</div>}
            {topAsks.map((ask, idx) => (
              <div key={idx} className="flex justify-between items-center text-sm bg-rose-950/40 px-2 py-1 rounded border-l-2 border-rose-500">
                <span className="text-rose-300 font-bold">${ask.price}</span>
                <span className="text-white/90">{ask.quantity} tix</span>
              </div>
            ))}
          </div>
        </div>

        {/* Bids Section (Buyers) */}
        <div>
          <span className="text-xs text-emerald-300 font-semibold uppercase">Bids (Buy Orders)</span>
          <div className="mt-2 space-y-1">
            {topBids.length === 0 && <div className="text-xs text-[#ebd2b5]/50 px-2 py-1">No bids</div>}
            {topBids.map((bid, idx) => (
              <div key={idx} className="flex justify-between items-center text-sm bg-emerald-950/40 px-2 py-1 rounded border-r-2 border-emerald-500">
                <span className="text-emerald-300 font-bold">${bid.price}</span>
                <span className="text-white/90">{bid.quantity} tix</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}