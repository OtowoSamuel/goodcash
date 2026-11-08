import { nairaFromUsdt } from '../lib/units';
import { getNetQuote } from '../lib/quote';
import { getMinimumCashOutG } from '../lib/rate';
import { IS_DEMO_MODE } from '../lib/router';
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
  const [rawInput, setRawInput] = useState(import.meta.env.PROD ? '' : '1000');

  const maxG = Math.max(0, Math.floor(balanceG * 10) / 10);
  const amountG = Math.min(parseFloat(rawInput || '0') || 0, maxG);

  const usdtEstimate = (() => {
    if (amountG <= 0) return 0;
    try {
      return Number(getNetQuote({ amountIn: BigInt(Math.floor(amountG)) * 10n ** 18n }).usdtOut) / 1e6;
    } catch {
      return amountG * USDT_PER_G;
    }
  })();
  const nairaEstimate =
    ngnPerUsdt && ngnPerUsdt > 0 && usdtEstimate > 0
      ? Math.round(nairaFromUsdt(usdtEstimate, ngnPerUsdt))
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

  const minG = getMinimumCashOutG();
  const belowMinimum = !IS_DEMO_MODE && amountG > 0 && amountG < minG;
  const canReview = amountG > 0 && amountG <= maxG && !belowMinimum;

  return (
    <div className="gc--mobile-shell fixed inset-0 bg-[color:var(--gc-bg)] z-40 overflow-y-auto">
      {/* Header */}
      <header className="gc-top relative">
        <button
          type="button"
          onClick={onClose}
          aria-label="Close cash out"
          className="gc-back relative z-10"
        >
          ✕
        </button>
        <span className="gc-title absolute left-1/2 -translate-x-1/2 text-[color:var(--gc-ink)]">
          Cash out
        </span>
        <div className="w-10" />
      </header>

      {/* YOU GIVE card */}
      <div className="gc-card">
        <div className="gc-row mb-2">
          <span className="gc-lab">
            YOU GIVE
          </span>
          <button
            type="button"
            onClick={handleMax}
            className="gc-pill gc-hit"
          >
            MAX {maxG.toLocaleString('en-US', { maximumFractionDigits: 1 })}
          </button>
        </div>
        <div className="gc-row">
          <span className="gc-big tabular-nums">
            {amountG.toLocaleString('en-US', { maximumFractionDigits: 4 })}
          </span>
          <span className="gc-pill gc-pill--yellow">
            G$
          </span>
        </div>
      </div>

      <p
        className="gc-sm"
        role={belowMinimum ? 'alert' : undefined}
        style={{ margin: '0 4px', textAlign: 'center', fontWeight: 800, color: belowMinimum ? 'var(--gc-danger)' : 'var(--gc-mute)' }}
      >
        {belowMinimum
          ? `Minimum cash out is ${minG.toLocaleString()} G$. Enter a bit more to continue.`
          : `Minimum cash out is about ${minG.toLocaleString()} G$`}
      </p>

      <div className="gc-card gc-card--mint">
        <div className="gc-lab mb-1">
          YOU RECEIVE ABOUT
        </div>
        <div className="gc-row">
          <span className="gc-big">
            {nairaEstimate !== null ? `₦${nairaEstimate.toLocaleString()}` : '₦—'}
          </span>
          <span className="gc-pill gc-pill--white">
            NGN
          </span>
        </div>
        <div className="gc-sm mt-1">
          at least ${usdtEstimate > 0 ? usdtEstimate.toFixed(2) : '0.00'}
        </div>
      </div>

      {/* Number pad */}
      <div className="gc-keys mt-auto">
        {KEYS.map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => handleKey(k)}
            aria-label={k === '⌫' ? 'Backspace' : k}
            className="gc-keys__key"
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
          className={`gc-btn ${canReview ? '' : 'gc-btn--dis'}`}
        >
          Review
        </button>
      </div>
    </div>
  );
};

export default MobileCashOut;