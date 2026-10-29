import React from 'react';

const W = 400, H = 130, PAD = 4, BASE = H - 14;

const cumulative = (levels) => {
  let total = 0;
  return levels.map((l) => ({ price: l.price, total: (total += l.quantity) }));
};

export default function DepthChart({ depthData }) {
  const bids = cumulative(depthData.bids || []); // best (highest) price first
  const asks = cumulative(depthData.asks || []); // best (lowest) price first
  const all = [...bids, ...asks];

  let body = (
    <div className="h-32 flex items-center justify-center border border-dashed border-[#ebd2b5]/30 rounded text-[#ebd2b5]/60 text-xs font-mono">
      No resting orders yet
    </div>
  );

  if (all.length) {
    let lo = Math.min(...all.map((p) => p.price));
    let hi = Math.max(...all.map((p) => p.price));
    if (lo === hi) { lo -= 1; hi += 1; }
    const maxTotal = Math.max(...all.map((p) => p.total));
    const x = (p) => PAD + ((p - lo) / (hi - lo)) * (W - 2 * PAD);
    const y = (t) => BASE - (t / maxTotal) * (BASE - 10);

    const area = (pts, edgeX) => {
      let d = `M${x(pts[0].price)},${BASE} L${x(pts[0].price)},${y(pts[0].total)}`;
      for (let i = 1; i < pts.length; i++) {
        d += ` L${x(pts[i].price)},${y(pts[i - 1].total)} L${x(pts[i].price)},${y(pts[i].total)}`;
      }
      return `${d} L${edgeX},${y(pts[pts.length - 1].total)} L${edgeX},${BASE} Z`;
    };

    body = (
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-32" role="img" aria-label="Cumulative market depth">
        {bids.length > 0 && <path d={area(bids, PAD)} fill="rgba(16,185,129,0.3)" stroke="#10b981" strokeWidth="1.5" />}
        {asks.length > 0 && <path d={area(asks, W - PAD)} fill="rgba(244,63,94,0.3)" stroke="#f43f5e" strokeWidth="1.5" />}
        <line x1={PAD} x2={W - PAD} y1={BASE} y2={BASE} stroke="#ebd2b5" strokeOpacity="0.3" />
        <text x={PAD} y={H - 2} fontSize="10" fill="#ebd2b5">${lo}</text>
        <text x={W - PAD} y={H - 2} fontSize="10" fill="#ebd2b5" textAnchor="end">${hi}</text>
      </svg>
    );
  }

  return (
    <div className="bg-[#590907] text-white p-4 rounded-xl border border-[#590907] shadow-md">
      <h2 className="text-sm font-semibold tracking-wider uppercase text-[#ebd2b5] mb-3">Cumulative Market Depth</h2>
      {body}
    </div>
  );
}
