import React from 'react';

export default function DepthChart({ depthData }) {
  return (
    <div className="bg-slate-900 text-slate-100 p-4 rounded-xl border border-slate-800 shadow-xl">
      <h2 className="text-sm font-semibold tracking-wider uppercase text-slate-400 mb-3">Cumulative Market Depth</h2>
      <div className="h-32 flex items-center justify-center border border-dashed border-slate-800 rounded text-slate-500 text-xs font-mono">
        [ SVG Market Depth Visualization Overlay ]
      </div>
    </div>
  );
}