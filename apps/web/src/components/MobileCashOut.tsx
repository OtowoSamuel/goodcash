import React, { useState } from 'react';

export interface MobileCashOutProps {
  balanceG: number;
  ngnPerUsdt?: number | null;
  onClose: () => void;
  onReview: (amountG: number, nairaEstimate: number | null, usdtEstimate: number) => void;
}

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '0', '⌫'];

// Matches the live rate used elsewhere: ~0.0001129 USDT per G$ after the
// 10% exit contribution, at the reserve→Uniswap route.
const USDT_PER_G = 0.0001129;

export const MobileCashOut: React.FC<MobileCashOutProps> = ({
  balanceG,
  ngnPerUsdt,
  onClose,
  onReview,
}) => {
  const [rawInput, setRawInput] = useState('1000');

  const maxG = Math.max(0, Math.floor(balanceG * 10) / 10);
  const amountG = Math.min(parseFloat(rawInput || '0') || 0, maxG);

  const usdtEstimate = amountG * USDT_PER_G;
  const nairaEstimate =
    ngnPerUsdt && ngnPerUsdt > 0 && usdtEstimate > 0
      ? Math.round(usdtEstimate * ngnPerUsdt)
      : null;

  const handleKey = (key: string) => {
    if (key === '⌫') {
      setRawInput((prev) => (prev.length > 1 ? prev.slice(0, -1) : '0'));
      return;
    }
    if (key === '.') {
      if (rawInput.includes('.')) return;
      setRawInput((prev) => prev + '.');
      return;
    }
    setRawInput((prev) => {
      const next = prev === '0' ? key : prev + key;
      const nextVal = parseFloat(next);
      if (Number.isFinite(nextVal) && nextVal > maxG) return String(maxG);
      return next;
    });
  };

  const handleMax = () => setRawInput(String(maxG));

  const canReview = amountG > 0 && amountG <= maxG;

  return (
    <div className="fixed inset-0 bg-[#d4c5fb] z-40 flex flex-col overflow-y-auto pt-6 px-4">
      {/* Header */}
      <header className="flex items-center justify-between mb-6 relative">
        <button
          type="button"
          onClick={onClose}
          aria-label="Close cash out"
          className="border-2 border-[#111] bg-white rounded-xl w-10 h-10 flex items-center justify-center shadow-[2px_2px_0px_#111] font-black text-lg z-10"
        >
          ✕
        </button>
        <span className="text-2xl font-black absolute left-1/2 -translate-x-1/2 text-[#111]">
          Cash out
        </span>
        <div className="w-10" />
      </header>

      {/* YOU GIVE card */}
      <div className="bg-white border-2 border-[#111] rounded-2xl shadow-[4px_4px_0px_#111] p-4 mb-3">
        <div className="flex justify-between items-center mb-2">
          <span className="font-extrabold text-xs tracking-wide text-[#111]">
            YOU GIVE
          </span>
          <button
            type="button"
            onClick={handleMax}
            className="border-2 border-[#111] bg-[#eae2ff] rounded-full px-3 py-1 font-extrabold text-sm text-[#111]"
          >
            MAX {maxG.toLocaleString('en-US', { maximumFractionDigits: 1 })}
          </button>
        </div>
        <div className="flex justify-between items-center">
          <span className="text-5xl font-black text-[#111] tabular-nums">
            {amountG.toLocaleString('en-US', { maximumFractionDigits: 4 })}
          </span>
          <span className="border-2 border-[#111] bg-[#ffd23f] rounded-full px-4 py-1.5 font-extrabold text-base text-[#111]">
            G$
          </span>
        </div>
      </div>

      {/* YOU RECEIVE ABOUT card */}
      <div className="bg-[#63f2b4] border-2 border-[#111] rounded-2xl shadow-[4px_4px_0px_#111] p-4 mb-3">
        <div className="font-extrabold text-xs tracking-wide text-[#111] mb-1">
          YOU RECEIVE ABOUT
        </div>
        <div className="flex justify-between items-center">
          <span className="text-5xl font-black text-[#111]">
            {nairaEstimate !== null ? `₦${nairaEstimate.toLocaleString()}` : '₦—'}
          </span>
          <span className="border-2 border-[#111] bg-white rounded-full px-4 py-1.5 font-extrabold text-base text-[#111]">
            NGN
          </span>
        </div>
        <div className="font-bold text-sm text-[#111] mt-1">
          at least {usdtEstimate > 0 ? usdtEstimate.toFixed(4) : '0.0000'} USDT
        </div>
      </div>

      {/* Number pad */}
      <div className="grid grid-cols-3 gap-y-6 text-2xl font-black text-center mt-auto mb-24 text-[#111]">
        {KEYS.map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => handleKey(k)}
            aria-label={k === '⌫' ? 'Backspace' : k}
            className="py-2"
          >
            {k}
          </button>
        ))}
      </div>

      {/* Sticky Review button */}
      <div className="fixed bottom-6 left-4 right-4">
        <button
          type="button"
          disabled={!canReview}
          onClick={() => onReview(amountG, nairaEstimate, usdtEstimate)}
          className="w-full py-4 text-xl font-black rounded-2xl border-2 border-[#111] shadow-[4px_4px_0px_#111] text-white disabled:opacity-50"
          style={{ background: canReview ? '#7b39fc' : '#b9a6e6' }}
        >
          Review
        </button>
      </div>
    </div>
  );
};

export default MobileCashOut;