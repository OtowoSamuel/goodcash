import React, { useEffect, useState } from 'react';
import type { QuoteResult } from '../lib/quote';
import type { Language } from '../lib/i18n';
import { getTranslations } from '../lib/i18n';
import { getCashoutRate, formatNaira } from '../lib/rate';

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

type StepId = 'review' | 'swap' | 'order' | 'done';
type StepStatus = 'pending' | 'active' | 'completed' | 'error';

interface Step {
  id: StepId;
  label: string;
  status: StepStatus;
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
  language,
}) => {
  const t = getTranslations(language);
  const [isSwapping, setIsSwapping] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(() => Math.max(0, Math.ceil((quote.expiresAt - Date.now()) / 1000)));
  const [currentStep, setCurrentStep] = useState<StepId>('review');

  // Update steps based on current state
  const getSteps = (): Step[] => {
    const baseSteps: Step[] = [
      { id: 'review', label: t.stepReview || 'Review', status: 'pending' },
      { id: 'swap', label: t.stepSwap || 'Swap', status: 'pending' },
      { id: 'order', label: t.stepOrder || 'Create Order', status: 'pending' },
      { id: 'done', label: t.stepDone || 'Done', status: 'pending' },
    ];

    let foundCurrent = false;
    return baseSteps.map((step) => {
      if (step.id === currentStep) {
        foundCurrent = true;
        return {
          ...step,
          status: (errorMessage ? 'error' : isSwapping ? 'active' : 'active') as StepStatus,
        };
      }
      if (!foundCurrent) {
        return { ...step, status: 'completed' as StepStatus };
      }
      return step;
    });
  };

  const steps = getSteps();

  useEffect(() => {
    if (!isOpen) return;

    const updateTimer = () => {
      setSecondsLeft(Math.max(0, Math.ceil((quote.expiresAt - Date.now()) / 1000)));
    };

    updateTimer();
    const interval = window.setInterval(updateTimer, 1000);
    return () => window.clearInterval(interval);
  }, [isOpen, quote.expiresAt]);

  useEffect(() => {
    // Update step based on state
    if (hasConfirmedSwap) {
      setCurrentStep('order');
    } else if (isSwapping) {
      setCurrentStep('swap');
    } else {
      setCurrentStep('review');
    }
  }, [hasConfirmedSwap, isSwapping]);

  if (!isOpen) return null;

  const cashoutRate = getCashoutRate(amountG, 123.48, ngnPerUsdt ?? null);
  const exitContributionG = cashoutRate.exitContributionG;
  const isExpired = secondsLeft === 0;
  const bankLastFour = (accountNumber ?? '').replace(/\D/g, '').slice(-4) || '0000';

  const handleExecute = async () => {
    if (isExpired || isSwapping) return;
    setIsSwapping(true);
    setCurrentStep('swap');
    try {
      await onConfirm();
      setCurrentStep('done');
    } catch {
      // Error is handled by parent
    } finally {
      setIsSwapping(false);
    }
  };

  return (
    <div className="fixed inset-x-0 bottom-0 z-50 flex justify-center bg-black/50 px-4 pb-[max(16px,env(safe-area-inset-bottom))] pt-4 backdrop-blur-sm">
      <div className="w-full max-w-[420px] rounded-t-[28px] border border-[#2D204A] bg-[#120D1D] p-4 shadow-[0_-18px_40px_rgba(0,0,0,0.45)]">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <p className="text-[11px] uppercase tracking-[0.14em] text-[#A39BBE]">{t.reviewLabel || 'Review'}</p>
            <h3 className="mt-1 text-xl font-semibold text-white">{t.cashOut}</h3>
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

        {/* Transaction Stepper */}
        <div className="mb-4 rounded-2xl border border-[#2D204A] bg-[#1B122E] p-4">
          <div className="flex items-center justify-between">
            {steps.map((step, idx) => (
              <React.Fragment key={step.id}>
                {/* Step Circle */}
                <div className="flex flex-col items-center gap-1.5">
                  <div
                    className={`flex h-8 w-8 items-center justify-center rounded-full text-xs font-semibold transition ${
                      step.status === 'completed'
                        ? 'bg-[#10B981]/20 text-[#6EE7B7] ring-1 ring-[#10B981]/40'
                        : step.status === 'active'
                        ? 'bg-[#7C3AED]/20 text-[#C4B5FD] ring-2 ring-[#7C3AED] shadow-[0_0_12px_rgba(124,58,237,0.4)]'
                        : step.status === 'error'
                        ? 'bg-[#EF4444]/20 text-[#FCA5A5] ring-1 ring-[#EF4444]/40'
                        : 'bg-[#2D204A] text-[#A39BBE]'
                    }`}
                  >
                    {step.status === 'completed' ? '✓' : step.status === 'error' ? '!' : idx + 1}
                  </div>
                  <span
                    className={`text-[10px] font-medium ${
                      step.status === 'active' || step.status === 'completed' ? 'text-[#E5E7EB]' : 'text-[#A39BBE]'
                    }`}
                  >
                    {step.label}
                  </span>
                </div>

                {/* Connector Line */}
                {idx < steps.length - 1 && (
                  <div
                    className={`h-0.5 flex-1 transition ${
                      steps[idx + 1].status === 'completed' || steps[idx + 1].status === 'active'
                        ? 'bg-[#10B981]/40'
                        : 'bg-[#2D204A]'
                    }`}
                    style={{ margin: '0 8px', marginBottom: '24px' }}
                  />
                )}
              </React.Fragment>
            ))}
          </div>
        </div>

        {/* Details Panel */}
        <div className="space-y-3 rounded-2xl border border-[#2D204A] bg-[#1B122E] p-3 text-sm text-[#E5E7EB]">
          <div className="flex items-center justify-between">
            <span className="text-[#A39BBE]">{t.gAmountLabel || 'G$ amount'}</span>
            <span className="font-semibold text-white">
              {amountG.toLocaleString(undefined, { maximumFractionDigits: 2 })} G$
            </span>
          </div>

          <div className="flex items-center justify-between">
            <span className="text-[#A39BBE]">{t.exitContribution}</span>
            <span className="font-semibold text-[#FCA5A5]">−{exitContributionG.toFixed(0)} G$</span>
          </div>

          <div className="flex items-center justify-between">
            <span className="text-[#A39BBE]">{t.youReceiveAbout}</span>
            <span className="font-semibold text-[#10B981]">
              {Number.isFinite(cashoutRate.netNaira) ? formatNaira(cashoutRate.netNaira) : t.nairaUnavailable}
            </span>
          </div>

          <div className="flex items-center justify-between">
            <span className="text-[#A39BBE]">{t.bankLabel}</span>
            <span className="font-medium text-white">
              {bankName ?? 'Bank'} •••• {bankLastFour}
            </span>
          </div>

          <div className="flex items-center justify-between">
            <span className="text-[#A39BBE]">{t.accountNameLabel}</span>
            <span className="font-medium text-white">{accountHolderName ?? '—'}</span>
          </div>

          <div className="flex items-center justify-between border-t border-[#2D204A] pt-3">
            <span className="text-[#A39BBE]">{t.quoteRefreshesIn.replace('{seconds}', '')}</span>
            <span className={`font-mono font-semibold ${isExpired ? 'text-[#FCA5A5]' : 'text-[#C4B5FD]'}`}>
              {secondsLeft}s
            </span>
          </div>
        </div>

        {errorMessage && (
          <div className="mt-3 rounded-xl border border-red-500/40 bg-red-500/10 p-3 text-xs text-red-200">
            <span className="font-semibold text-red-100">{t.swapFailed || 'Swap failed'}: </span>
            {errorMessage}
          </div>
        )}

        {hasConfirmedSwap && onRetryPayout && (
          <button
            type="button"
            onClick={async () => {
              setIsSwapping(true);
              setCurrentStep('order');
              try {
                await onRetryPayout();
              } finally {
                setIsSwapping(false);
              }
            }}
            disabled={isSwapping}
            className={`mt-3 w-full rounded-2xl px-4 py-3 text-sm font-semibold transition ${
              isSwapping
                ? 'cursor-not-allowed border border-amber-500/40 bg-amber-500/10 text-amber-200'
                : 'border border-amber-500/50 bg-amber-500/20 text-amber-100 hover:bg-amber-500/30'
            }`}
          >
            {isSwapping ? t.retryingPayout || 'Retrying payout…' : t.retryPayout || 'Retry payout (swap already confirmed)'}
          </button>
        )}

        {isExpired && (
          <button
            type="button"
            onClick={onRefresh}
            className="mt-4 w-full rounded-2xl border border-[#2D204A] bg-[#1B122E] px-4 py-3 text-sm font-semibold text-[#F4EFFF]"
          >
            {t.refreshQuote || 'Refresh quote'}
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
          {isSwapping
            ? t.confirming || 'Confirming...'
            : hasConfirmedSwap
            ? t.swapAlreadyConfirmed || 'Swap already confirmed'
            : t.confirmButton || 'Confirm'}
        </button>
      </div>
    </div>
  );
};
