import React, { useEffect, useState } from 'react';
import type { QuoteResult } from '../lib/quote';
import type { Language } from '../lib/i18n';
import { getCashoutRate } from '../lib/rate';

interface ConfirmModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => Promise<void>;
  onRefresh: () => void;
  quote: QuoteResult;
  amountG: number;
  slippageBps: number;
  language: Language;
  bankName?: string;
  accountNumber?: string;
  accountHolderName?: string;
  ngnPerUsdt?: number | null;
  errorMessage?: string | null;
  onRetryPayout?: () => Promise<void>;
  hasConfirmedSwap?: boolean;
}

export const ConfirmModal: React.FC<ConfirmModalProps> = ({
  isOpen,
  onClose,
  onConfirm,
  onRefresh,
  quote,
  amountG,
  bankName,
  accountNumber,
  accountHolderName,
  ngnPerUsdt,
  errorMessage,
  onRetryPayout,
  hasConfirmedSwap = false,
}) => {
  const [isSwapping, setIsSwapping] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(() => Math.max(0, Math.ceil((quote.expiresAt - Date.now()) / 1000)));

  useEffect(() => {
    if (!isOpen) return;

    const updateTimer = () => {
      setSecondsLeft(Math.max(0, Math.ceil((quote.expiresAt - Date.now()) / 1000)));
    };

    updateTimer();
    const interval = window.setInterval(updateTimer, 1000);
    return () => window.clearInterval(interval);
  }, [isOpen, quote.expiresAt]);

  if (!isOpen) return null;

  const cashoutRate = getCashoutRate(amountG, 123.48, ngnPerUsdt ?? null);
  const exitContributionG = cashoutRate.exitContributionG;
  const isExpired = secondsLeft === 0;
  const bankLastFour = (accountNumber ?? '').replace(/\D/g, '').slice(-4) || '0000';
  const nairaValue = Number.isFinite(cashoutRate.netNaira) ? cashoutRate.netNaira : 0;

  const handleExecute = async () => {
    if (isExpired || isSwapping) return;
    setIsSwapping(true);
    try {
      await onConfirm();
    } finally {
      setIsSwapping(false);
    }
  };

  return (
    <div className="fixed inset-x-0 bottom-0 z-50 flex justify-center bg-black/50 px-4 pb-[max(16px,env(safe-area-inset-bottom))] pt-4 backdrop-blur-sm">
      <div className="w-full max-w-[420px] rounded-t-[28px] border border-[#2D204A] bg-[#120D1D] p-4 shadow-[0_-18px_40px_rgba(0,0,0,0.45)]">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <p className="text-[11px] uppercase tracking-[0.14em] text-[#A39BBE]">Review</p>
            <h3 className="mt-1 text-xl font-semibold text-white">Cash out</h3>
          </div>
          <button
            type="button"
            aria-label="Close review sheet"
            onClick={onClose}
            className="flex h-9 w-9 items-center justify-center rounded-full bg-[#1B122E] text-lg text-[#D9D0F4]"
          >
            ×
          </button>
        </div>

        <div className="space-y-3 rounded-2xl border border-[#2D204A] bg-[#1B122E] p-3 text-sm text-[#E5E7EB]">
          <div className="flex items-center justify-between">
            <span className="text-[#A39BBE]">G$ amount</span>
            <span className="font-semibold text-white">{amountG.toLocaleString(undefined, { maximumFractionDigits: 2 })} G$</span>
          </div>

          <div className="flex items-center justify-between">
            <span className="text-[#A39BBE]">Exit contribution</span>
            <span className="font-semibold text-[#FCA5A5]">−{exitContributionG.toFixed(0)} G$</span>
          </div>

          <div className="flex items-center justify-between">
            <span className="text-[#A39BBE]">Naira estimate</span>
            <span className="font-semibold text-[#10B981]">about ₦{nairaValue.toLocaleString(undefined, { maximumFractionDigits: 2 })}</span>
          </div>

          <div className="flex items-center justify-between">
            <span className="text-[#A39BBE]">Bank</span>
            <span className="font-medium text-white">{bankName ?? 'Bank'} •••• {bankLastFour}</span>
          </div>

          <div className="flex items-center justify-between">
            <span className="text-[#A39BBE]">Account name</span>
            <span className="font-medium text-white">{accountHolderName ?? '—'}</span>
          </div>

          <div className="flex items-center justify-between border-t border-[#2D204A] pt-3">
            <span className="text-[#A39BBE]">Quote refreshes in</span>
            <span className={`font-mono font-semibold ${isExpired ? 'text-[#FCA5A5]' : 'text-[#C4B5FD]'}`}>
              {secondsLeft}s
            </span>
          </div>
        </div>

        {errorMessage && (
          <div className="mt-3 rounded-xl border border-red-500/40 bg-red-500/10 p-3 text-xs text-red-200">
            <span className="font-semibold text-red-100">Swap failed: </span>
            {errorMessage}
          </div>
        )}

        {hasConfirmedSwap && onRetryPayout && (
          <button
            type="button"
            onClick={async () => {
              setIsSwapping(true);
              try { await onRetryPayout(); } finally { setIsSwapping(false); }
            }}
            disabled={isSwapping}
            className={`mt-3 w-full rounded-2xl px-4 py-3 text-sm font-semibold transition ${
              isSwapping
                ? 'cursor-not-allowed border border-amber-500/40 bg-amber-500/10 text-amber-200'
                : 'border border-amber-500/50 bg-amber-500/20 text-amber-100 hover:bg-amber-500/30'
            }`}
          >
            {isSwapping ? 'Retrying payout…' : 'Retry payout (swap already confirmed)'}
          </button>
        )}

        {isExpired && (
          <button
            type="button"
            onClick={onRefresh}
            className="mt-4 w-full rounded-2xl border border-[#2D204A] bg-[#1B122E] px-4 py-3 text-sm font-semibold text-[#F4EFFF]"
          >
            Refresh quote
          </button>
        )}

        <button
          type="button"
          disabled={isExpired || isSwapping || hasConfirmedSwap}
          onClick={handleExecute}
          className={`mt-4 w-full rounded-2xl px-4 py-3.5 text-base font-semibold transition ${
            isExpired || isSwapping || hasConfirmedSwap
              ? 'cursor-not-allowed border border-[#2D204A] bg-[#1B122E] text-[#A39BBE]'
              : 'bg-[#7C3AED] text-white shadow-[0_18px_32px_rgba(124,58,237,0.25)] hover:bg-[#8B5CF6]'
          }`}
        >
          {isSwapping ? 'Confirming...' : hasConfirmedSwap ? 'Swap already confirmed' : 'Confirm'}
        </button>
      </div>
    </div>
  );
};
