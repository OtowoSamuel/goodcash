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
  /** Which stage the confirm is in once Confirm is pressed */
  stage?: 'swap' | 'order' | 'pay' | null;
  /** Set once the swap and payout order are done: the modal then shows the result */
  result?: { settled: boolean; paid?: boolean; nairaText: string; reference: string | null } | null;
  /** Called from the result screen ("Done" / "Track payout") */
  onFinish?: () => void;
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
  stage = null,
  result = null,
  onFinish,
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
        if (result && step.id === 'done') return { ...step, status: 'completed' as StepStatus };
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
    if (result) {
      setCurrentStep('done');
    } else if (hasConfirmedSwap || stage === 'order' || stage === 'pay') {
      setCurrentStep('order');
    } else if (isSwapping) {
      setCurrentStep('swap');
    } else {
      setCurrentStep('review');
    }
  }, [hasConfirmedSwap, isSwapping, stage, result]);

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
    <div className="fixed inset-0 z-50 overflow-y-auto bg-black/70 backdrop-blur-sm">
      <div className="flex min-h-full items-center justify-center px-4 py-6">
        <div className="bg-[color:var(--gc-bg)] border border-[color:var(--gc-line-strong)] rounded-3xl p-6 shadow-none max-w-lg w-full text-[color:var(--gc-ink)]">
        {/* Header */}
        <div className="mb-6 flex items-center justify-between">
          <div>
            <p className="text-xs uppercase tracking-wider font-bold text-[color:var(--gc-ink)]">{result ? 'DONE' : t.reviewLabel || 'REVIEW'}</p>
            <h3 className="mt-1 text-2xl font-black text-[color:var(--gc-ink)]">{t.cashOut}</h3>
          </div>
          <button
            type="button"
            aria-label="Close review sheet"
            onClick={onClose}
            className="bg-[color:var(--gc-surface-2)] border border-[color:var(--gc-line-strong)] rounded-xl w-9 h-9 flex items-center justify-center font-bold shadow-none hover:translate-x-0.5 hover:translate-y-0.5 hover:shadow-none transition-all text-xl"
          >
            ×
          </button>
        </div>

        {/* Transaction Stepper */}
        <div className="mb-4 bg-[color:var(--gc-surface-2)] border border-[color:var(--gc-line-strong)] rounded-2xl p-4 shadow-none">
          <div className="flex items-center justify-between">
            {steps.map((step, idx) => (
              <React.Fragment key={step.id}>
                {/* Step Badge */}
                <div className="flex flex-col items-center gap-1.5">
                  <div
                    className={`flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold border border-[color:var(--gc-line-strong)] transition ${
                      step.status === 'completed'
                        ? 'bg-[color:var(--gc-ok-bg)] text-[color:var(--gc-ink)]'
                        : step.status === 'active'
                        ? 'bg-[color:var(--gc-pu)] text-white'
                        : step.status === 'error'
                        ? 'bg-[color:var(--gc-danger-bg)] text-white'
                        : 'bg-[color:var(--gc-surface-2)] text-[color:var(--gc-ink)]'
                    }`}
                  >
                    {step.status === 'completed' ? '✓' : step.status === 'error' ? '!' : idx + 1}
                  </div>
                  <span className={`text-[10px] font-bold ${step.status === 'active' || step.status === 'completed' ? 'text-[color:var(--gc-ink)]' : 'text-[color:var(--gc-mute)]'}`}>
                    {step.label}
                  </span>
                </div>

                {/* Connector Line */}
                {idx < steps.length - 1 && (
                  <div
                    className={`h-0.5 flex-1 transition ${
                      steps[idx + 1].status === 'completed' || steps[idx + 1].status === 'active'
                        ? 'bg-[color:var(--gc-pu)]'
                        : 'bg-[color:var(--gc-line-strong)]'
                    }`}
                    style={{ margin: '0 8px', marginBottom: '24px' }}
                  />
                )}
              </React.Fragment>
            ))}
          </div>
        </div>

        {result ? (
          <>
            <div className="bg-[color:var(--gc-ok-bg)] border border-[color:var(--gc-line-strong)] rounded-2xl p-5 shadow-none mb-4 text-center">
              <div className="mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-full border border-[color:var(--gc-line-strong)] bg-[color:var(--gc-surface-2)] text-2xl font-black shadow-none">✓</div>
              <div className="text-xs font-bold uppercase tracking-wider">
                {result.settled ? 'Cash out complete' : result.paid ? 'Payment sent' : 'One more step'}
              </div>
              <div className="mt-1 text-4xl font-black">
                {result.settled ? (t.nairaDelivered || 'Naira Delivered!') : result.paid ? 'On its way!' : result.nairaText}
              </div>
              <div className="mt-1 text-sm font-semibold">
                {result.settled ? `${result.nairaText} ${t.paidToYourBank || 'paid to your bank'}` : result.paid ? `${result.nairaText} is on its way to your bank` : 'Confirm the payment in your wallet to finish'}
              </div>
            </div>
            <div className="bg-[color:var(--gc-surface-2)] border border-[color:var(--gc-line-strong)] rounded-2xl p-4 shadow-none mb-4">
              <div className="flex items-center justify-between py-2.5 border-b border-solid border-[color:var(--gc-line)]">
                <span className="font-medium text-[color:var(--gc-ink)]">{t.gAmountLabel || 'G$ amount'}</span>
                <span className="font-bold text-[color:var(--gc-ink)]">{amountG.toLocaleString(undefined, { maximumFractionDigits: 2 })} G$</span>
              </div>
              <div className="flex items-center justify-between pt-2.5">
                <span className="font-medium text-[color:var(--gc-ink)]">{result.settled ? 'Bank reference' : 'Status'}</span>
                <span className="font-bold text-[color:var(--gc-ink)] font-mono text-sm">{result.settled ? result.reference ?? '—' : result.paid ? 'Paying your bank' : 'Waiting for your payment'}</span>
              </div>
            </div>
            <button
              type="button"
              onClick={onFinish}
              className="w-full py-3.5 text-lg font-bold bg-[color:var(--gc-pu)] text-white border border-[color:var(--gc-line-strong)] rounded-xl shadow-none hover:translate-x-0.5 hover:translate-y-0.5 shadow-none transition-all"
            >
              {result.settled ? (t.doneButton || 'Done') : result.paid ? 'Track payout' : 'Continue'}
            </button>
          </>
        ) : (
          <>
        {/* Details Panel */}
        <div className="bg-[color:var(--gc-surface-2)] border border-[color:var(--gc-line-strong)] rounded-2xl p-4 shadow-none mb-4">
          <div className="flex items-center justify-between py-2.5 border-b border-solid border-[color:var(--gc-line)]">
            <span className="font-medium text-[color:var(--gc-ink)]">{t.gAmountLabel || 'G$ amount'}</span>
            <span className="font-bold text-[color:var(--gc-ink)]">
              {amountG.toLocaleString(undefined, { maximumFractionDigits: 2 })} G$
            </span>
          </div>

          <div className="flex items-center justify-between py-2.5 border-b border-solid border-[color:var(--gc-line)]">
            <span className="font-medium text-[color:var(--gc-ink)]">{t.exitContribution}</span>
            <span className="font-bold text-[color:var(--gc-ink)]">−{exitContributionG.toFixed(0)} G$</span>
          </div>

          <div className="flex items-center justify-between py-2.5 border-b border-solid border-[color:var(--gc-line)]">
            <span className="font-medium text-[color:var(--gc-ink)]">{t.youReceiveAbout}</span>
            <span className="font-bold text-[color:var(--gc-ink)]">
              {Number.isFinite(cashoutRate.netNaira) ? formatNaira(cashoutRate.netNaira) : t.nairaUnavailable}
            </span>
          </div>

          <div className="flex items-center justify-between py-2.5 border-b border-solid border-[color:var(--gc-line)]">
            <span className="font-medium text-[color:var(--gc-ink)]">{t.bankLabel}</span>
            <span className="font-bold text-[color:var(--gc-ink)]">
              {bankName ?? 'Bank'} •••• {bankLastFour}
            </span>
          </div>

          <div className="flex items-center justify-between py-2.5 border-b border-solid border-[color:var(--gc-line)]">
            <span className="font-medium text-[color:var(--gc-ink)]">{t.accountNameLabel}</span>
            <span className="font-bold text-[color:var(--gc-ink)]">{accountHolderName ?? '—'}</span>
          </div>

          <div className="flex items-center justify-between pt-2.5">
            <span className="font-medium text-[color:var(--gc-ink)]">{t.quoteRefreshesIn.replace('{seconds}s', '').trim()}</span>
            <span className={`font-mono font-bold ${isExpired ? 'text-[color:var(--gc-danger)]' : 'text-[color:var(--gc-pu-text)]'}`}>
              {secondsLeft}s
            </span>
          </div>
        </div>

        {errorMessage && (
          <div className="mb-4 bg-[color:var(--gc-danger-bg)] text-white border border-[color:var(--gc-line-strong)] p-3 rounded-xl font-bold shadow-none break-words" style={{ overflowWrap: "anywhere" }}>
            <span className="font-black">{hasConfirmedSwap ? 'Almost there' : t.swapFailed || 'Swap failed'}: </span>
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
            className="mb-3 w-full bg-[color:var(--gc-warn-bg)] border border-[color:var(--gc-line-strong)] rounded-xl py-3 font-bold text-[color:var(--gc-ink)] shadow-none hover:translate-x-0.5 hover:translate-y-0.5 hover:shadow-none transition-all disabled:opacity-50"
          >
            {isSwapping ? t.retryingPayout || 'Retrying payout…' : t.retryPayout || 'Retry payout'}
          </button>
        )}

        {isExpired && (
          <button
            type="button"
            onClick={onRefresh}
            className="mb-3 w-full bg-[color:var(--gc-surface-2)] border border-[color:var(--gc-line-strong)] rounded-xl py-3 font-bold text-[color:var(--gc-ink)] shadow-none hover:translate-x-0.5 hover:translate-y-0.5 hover:shadow-none transition-all"
          >
            {t.refreshQuote || 'Refresh quote'}
          </button>
        )}

        <button
          type="button"
          disabled={isExpired || isSwapping || hasConfirmedSwap}
          onClick={handleExecute}
          className="w-full py-3.5 text-lg font-bold bg-[color:var(--gc-pu)] text-white border border-[color:var(--gc-line-strong)] rounded-xl shadow-none hover:translate-x-0.5 hover:translate-y-0.5 shadow-none active:translate-x-1 active:translate-y-1 active:shadow-none transition-all disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isSwapping
            ? t.confirming || 'Confirming...'
            : hasConfirmedSwap
            ? t.swapAlreadyConfirmed || 'Swap confirmed'
            : t.confirmButton || 'Confirm'}
        </button>
          </>
        )}
        </div>
      </div>
    </div>
  );
};
