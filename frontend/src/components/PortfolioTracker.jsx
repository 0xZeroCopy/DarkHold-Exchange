import React from 'react';

export default function PortfolioTracker({ userBalances }) {
  return (
    <div className="bg-slate-900 text-slate-100 p-5 rounded-xl border border-slate-800 shadow-xl">
      <h2 className="text-sm font-semibold tracking-wider uppercase text-slate-400 mb-4">Portfolio & Escrow Balances</h2>
      <div className="grid grid-cols-2 gap-3">
        <div className="bg-slate-800/60 p-3 rounded-lg border border-slate-700/50">
          <span className="text-xs text-slate-400 block">Available Cash</span>
          <span className="text-lg font-bold text-emerald-400">${userBalances?.availableCash || 0}</span>
        </div>
        <div className="bg-slate-800/60 p-3 rounded-lg border border-slate-700/50">
          <span className="text-xs text-slate-400 block">Escrowed Cash</span>
          <span className="text-lg font-bold text-amber-400">${userBalances?.heldCash || 0}</span>
        </div>
        <div className="bg-slate-800/60 p-3 rounded-lg border border-slate-700/50">
          <span className="text-xs text-slate-400 block">Available Tickets</span>
          <span className="text-lg font-bold text-cyan-400">{userBalances?.availableTickets || 0}</span>
        </div>
        <div className="bg-slate-800/60 p-3 rounded-lg border border-slate-700/50">
          <span className="text-xs text-slate-400 block">Escrowed Tickets</span>
          <span className="text-lg font-bold text-indigo-400">{userBalances?.heldTickets || 0}</span>
        </div>
      </div>
    </div>
  );
}