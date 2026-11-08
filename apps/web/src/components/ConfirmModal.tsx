import { celoText, networkFeeMessage, type NetworkFeeInfo } from '../lib/router';
import { Modal } from './Modal';
import { GOODCASH_FEE_PERCENT } from '../lib/units';
import { StepBar, CASH_OUT_STEPS } from './StepBar';
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
  /** The network fee and whether the wallet can pay it (null while unknown). */
  networkFee?: NetworkFeeInfo | null;
}

type StepId = 'review' | 'swap' | 'order' | 'done';

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
  networkFee = null,
}) => {
  const feeShort = !!networkFee && !networkFee.enough;
  const feeNaira = networkFee?.celoUsd && ngnPerUsdt ? Math.max(1, Math.ceil(networkFee.feeCelo * networkFee.celoUsd * ngnPerUsdt)) : null;
  const t = getTranslations(language);
  const [isSwapping, setIsSwapping] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(() => Math.max(0, Math.ceil((quote.expiresAt - Date.now()) / 1000)));
  const [currentStep, setCurrentStep] = useState<StepId>('review');

  // Where we are in Amount > Review > Confirm > Done (the amount was chosen before this pop-up opened)
  const stepAt = currentStep === 'done' ? 3 : currentStep === 'review' ? 1 : 2;

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

  const finishButton = result ? (
    <button
      type="button"
      onClick={onFinish}
      className="w-full py-3.5 text-lg font-bold bg-[#7b39fc] text-white border-2 border-[#111] rounded-xl shadow-[4px_4px_0px_#111] hover:translate-x-0.5 hover:translate-y-0.5 hover:shadow-[2px_2px_0px_#111] transition-all"
    >
      {result.settled ? (t.doneButton || 'Done') : result.paid ? 'Track payout' : 'Continue'}
    </button>
  ) : null;

  const confirmButton = (
    <button
      type="button"
      disabled={isExpired || isSwapping || hasConfirmedSwap || feeShort}
      onClick={handleExecute}
      className="w-full py-3.5 text-lg font-bold bg-[#7b39fc] text-white border-2 border-[#111] rounded-xl shadow-[4px_4px_0px_#111] hover:translate-x-0.5 hover:translate-y-0.5 hover:shadow-[2px_2px_0px_#111] active:translate-x-1 active:translate-y-1 active:shadow-none transition-all disabled:opacity-50 disabled:cursor-not-allowed"
    >
      {isSwapping
        ? t.confirming || 'Confirming...'
        : hasConfirmedSwap
        ? t.swapAlreadyConfirmed || 'Swap confirmed'
        : feeShort
        ? 'Top up CELO first'
        : t.confirmButton || 'Confirm'}
    </button>
  );

  return (
    <Modal
      label="Cash out"
      title={result ? 'Done' : 'Review cash out'}
      closeLabel="Close review sheet"
      onClose={onClose}
      z={50}
      footer={result ? finishButton : confirmButton}
    >
      <StepBar steps={CASH_OUT_STEPS} at={stepAt} />
        {result ? (
          <>
            <div className="bg-[#8cf0c0] border-2 border-[#111] rounded-2xl p-5 shadow-[4px_4px_0px_#111] mb-4 text-center">
              <div className="mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-full border-2 border-[#111] bg-white text-2xl font-black shadow-[3px_3px_0px_#111]">✓</div>
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
            <div className="bg-white border-2 border-[#111] rounded-2xl p-4 shadow-[4px_4px_0px_#111] mb-4">
              <div className="flex items-center justify-between py-2.5 border-b-2 border-dashed border-gray-300">
                <span className="font-medium text-[#111]">{t.gAmountLabel || 'G$ amount'}</span>
                <span className="font-bold text-[#111]">{amountG.toLocaleString(undefined, { maximumFractionDigits: 2 })} G$</span>
              </div>
              <div className="flex items-center justify-between pt-2.5">
                <span className="font-medium text-[#111]">{result.settled ? 'Bank reference' : 'Status'}</span>
                <span className="font-bold text-[#111] font-mono text-sm">{result.settled ? result.reference ?? '—' : result.paid ? 'Paying your bank' : 'Waiting for your payment'}</span>
              </div>
            </div>
          </>
        ) : (
          <>
        {/* Details Panel */}
        <div className="bg-white border-2 border-[#111] rounded-2xl p-4 shadow-[4px_4px_0px_#111] mb-4">
          <div className="flex items-center justify-between py-2.5 border-b-2 border-dashed border-gray-300">
            <span className="font-medium text-[#111]">{t.gAmountLabel || 'G$ amount'}</span>
            <span className="font-bold text-[#111]">
              {amountG.toLocaleString(undefined, { maximumFractionDigits: 2 })} G$
            </span>
          </div>

          <div className="flex items-center justify-between py-2.5 border-b-2 border-dashed border-gray-300">
            <span className="font-medium text-[#111]">{t.exitContribution}</span>
            <span className="font-bold text-[#111]">−{exitContributionG.toFixed(0)} G$</span>
          </div>

          {GOODCASH_FEE_PERCENT > 0 && Number.isFinite(cashoutRate.netNaira) && (
            <div className="flex items-center justify-between py-2.5 border-b-2 border-dashed border-gray-300">
              <span className="font-medium text-[#111]">GoodCash fee ({GOODCASH_FEE_PERCENT}%)</span>
              <span className="font-bold text-[#111]">about {formatNaira(Math.max(1, (cashoutRate.netNaira * GOODCASH_FEE_PERCENT) / 100))}</span>
            </div>
          )}

          <div className="flex items-center justify-between py-2.5 border-b-2 border-dashed border-gray-300">
            <span className="font-medium text-[#111]">{t.youReceiveAbout}</span>
            <span className="font-bold text-[#111]">
              {Number.isFinite(cashoutRate.netNaira) ? formatNaira(cashoutRate.netNaira) : t.nairaUnavailable}
            </span>
          </div>

          <div className="flex items-center justify-between py-2.5 border-b-2 border-dashed border-gray-300">
            <span className="font-medium text-[#111]">{t.bankLabel}</span>
            <span className="font-bold text-[#111]">
              {bankName ?? 'Bank'} •••• {bankLastFour}
            </span>
          </div>

          <div className="flex items-center justify-between py-2.5 border-b-2 border-dashed border-gray-300">
            <span className="font-medium text-[#111]">{t.accountNameLabel}</span>
            <span className="font-bold text-[#111]">{accountHolderName ?? '—'}</span>
          </div>

          <div className="flex items-center justify-between pt-2.5">
            <span className="font-medium text-[#111]">{t.quoteRefreshesIn.replace('{seconds}s', '').trim()}</span>
            <span className={`font-mono font-bold ${isExpired ? 'text-[#ff6b6b]' : 'text-[#7b39fc]'}`}>
              {secondsLeft}s
            </span>
          </div>
        </div>

        {networkFee && (
          <div className="mb-3 flex items-center justify-between font-medium text-[#111]">
            <span>Network fee (paid in CELO, not G$)</span>
            <span className="font-bold">
              {feeNaira ? `about ₦${feeNaira.toLocaleString('en-US')} (${celoText(networkFee.feeCelo)} CELO)` : `about ${celoText(networkFee.feeCelo)} CELO`}
            </span>
          </div>
        )}

        {feeShort && !hasConfirmedSwap && (
          <div className="mb-4 bg-[#fff3c4] text-[#111] border-2 border-[#111] p-3 rounded-xl font-bold shadow-[2px_2px_0px_#111]" role="alert">
            You can't send this yet. {networkFeeMessage(networkFee, ngnPerUsdt)}
          </div>
        )}

        {errorMessage && (
          <div className="mb-4 bg-[#ff6b6b] text-white border-2 border-[#111] p-3 rounded-xl font-bold shadow-[2px_2px_0px_#111] break-words" style={{ overflowWrap: "anywhere" }}>
            <span className="font-black">{hasConfirmedSwap ? 'Almost there' : /couldn't confirm/i.test(errorMessage) ? 'Please check' : 'Not sent'}: </span>
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
            className="mb-3 w-full bg-[#ffd23f] border-2 border-[#111] rounded-xl py-3 font-bold text-[#111] shadow-[2px_2px_0px_#111] hover:translate-x-0.5 hover:translate-y-0.5 hover:shadow-none transition-all disabled:opacity-50"
          >
            {isSwapping ? t.retryingPayout || 'Retrying payout…' : t.retryPayout || 'Retry payout'}
          </button>
        )}

        {isExpired && (
          <button
            type="button"
            onClick={onRefresh}
            className="mb-3 w-full bg-white border-2 border-[#111] rounded-xl py-3 font-bold text-[#111] shadow-[2px_2px_0px_#111] hover:translate-x-0.5 hover:translate-y-0.5 hover:shadow-none transition-all"
          >
            {t.refreshQuote || 'Refresh quote'}
          </button>
        )}

          </>
        )}
    </Modal>
  );
};
