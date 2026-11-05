import React, { useState, useEffect } from 'react';
import type { Language } from '../lib/i18n';
import { getTranslations } from '../lib/i18n';
import { getNetQuote, type QuoteResult, MAX_PRICE_IMPACT_BPS } from '../lib/quote';
import { fetchPaycrestRate, getCashoutRate, formatNaira, MIN_NET_USDT_REQUIRED } from '../lib/rate';
import { useBankAccountVerification } from '../lib/useOffRamp';

import {
  useOffRamp,
  paycrestOrderAmount,
  type OffRampOrder,
  type OffRampStatus,
} from '../lib/useOffRamp';

interface CashOutCardProps {
  balanceG: number;
  onInitiateCashOut: (
    quote: QuoteResult,
    amountG: number,
    slippageBps: number,
    bankName?: string,
    accountNumber?: string,
    accountHolderName?: string,
    ngnPerUsdt?: number | null,
    bankCode?: string
  ) => void;
  language: Language;
  ngnPerUsdt?: number | null;
}

export const CashOutCard: React.FC<CashOutCardProps> = ({
  balanceG,
  onInitiateCashOut,
  language,
  ngnPerUsdt: initialNgnRate = null,
}) => {
  const t = getTranslations(language);

  const [inputAmountG, setInputAmountG] = useState<string>('1000');
  const [slippagePercent, setSlippagePercent] = useState<number>(1);
  const [quote, setQuote] = useState<QuoteResult | null>(null);
  const [secondsRemaining, setSecondsRemaining] = useState<number>(30);
  const [ngnPerUsdt, setNgnPerUsdt] = useState<number | null>(initialNgnRate);
  const [rateError, setRateError] = useState<string | null>(null);

  const {
    institutions,
    institutionsLoading,
    institutionsError,
    institutionCode,
    setInstitutionCode,
    selectedInstitution,
    accountIdentifier,
    setAccountIdentifier,
    accountName,
    verificationStatus,
    verificationError,
    confirmed,
    setConfirmed,
  } = useBankAccountVerification('NGN');

  // Fetch NGN rate on mount
  useEffect(() => {
    let isMounted = true;

    fetchPaycrestRate()
      .then((rate) => {
        if (isMounted) {
          setNgnPerUsdt(rate);
          setRateError(null);
        }
      })
      .catch(() => {
        if (isMounted) {
          setNgnPerUsdt(null);
          setRateError(t.rateUnavailableTryAgain);
        }
      });

    return () => {
      isMounted = false;
    };
  }, [t.rateUnavailableTryAgain]);

  // Update quote when input changes
  useEffect(() => {
    const rawAmount = parseFloat(inputAmountG);
    if (!isNaN(rawAmount) && rawAmount > 0) {
      try {
        const amountWei = BigInt(Math.floor(rawAmount)) * 10n ** 18n;
        setQuote(getNetQuote({ amountIn: amountWei }));
        setSecondsRemaining(30);
      } catch (err) {
        console.error('Quote calculation error:', err);
      }
    } else {
      setQuote(null);
    }
  }, [inputAmountG]);

  // Quote refresh timer
  useEffect(() => {
    const timer = setInterval(() => {
      setSecondsRemaining((prev) => {
        if (prev <= 1) {
          const rawAmount = parseFloat(inputAmountG);
          if (!isNaN(rawAmount) && rawAmount > 0) {
            try {
              const amountWei = BigInt(Math.floor(rawAmount)) * 10n ** 18n;
              setQuote(getNetQuote({ amountIn: amountWei }));
            } catch {}
          }
          return 30;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [inputAmountG]);

  const handleQuickPercent = (pct: number) => {
    const calculated = Math.floor((balanceG * pct) / 100);
    setInputAmountG(calculated.toString());
    setSlippagePercent(pct);
  };

  const amountNumber = parseFloat(inputAmountG) || 0;
  const rate = getCashoutRate(amountNumber, 123.48, ngnPerUsdt);
  const exitContributionG = rate.exitContributionG;
  const isHighImpact = quote ? quote.priceImpactBps > MAX_PRICE_IMPACT_BPS : false;
  const isOverBalance = amountNumber > balanceG;
  const isBelowMinimum = !rate.minimumReached;
  const isRateUnavailable = rate.rateUnavailable || Boolean(rateError);
  const isValidAmount = amountNumber > 0 && !isOverBalance && !isHighImpact && !isBelowMinimum && !isRateUnavailable;

  const bankName = selectedInstitution?.name ?? '';
  const isBankValid = institutionCode.trim().length > 0;
  const isAccountNumberValid = /^\d{10}$/.test(accountIdentifier);
  const isAccountHolderValid = verificationStatus === 'verified' && Boolean(accountName);
  const isBankDetailsValid = isBankValid && isAccountNumberValid && isAccountHolderValid && confirmed;

  const slippageBps = slippagePercent * 100;
  const canReview = isValidAmount && quote !== null && !isRateUnavailable && isBankDetailsValid;

  return (
    <>
      {/* YOU GIVE Card */}
      <div className="gc-card">
        <div className="flex justify-between items-center mb-4">
          <span className="text-[#111] font-black uppercase text-xs">{t.youGiveG}</span>
          <div className="border-2 border-[#111] rounded-full px-3 py-1 font-medium">
            Balance {balanceG.toLocaleString()} G$
          </div>
        </div>
        <div className="flex justify-between items-center w-full overflow-hidden mb-6 gap-4">
          <input
            type="number"
            min="1"
            value={inputAmountG}
            onChange={(e) => setInputAmountG(e.target.value)}
            placeholder="0"
            className="w-full min-w-0 flex-1 bg-transparent border-none outline-none focus:outline-none focus:ring-0 p-0 text-5xl font-black text-[#111] appearance-none [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
          />
          <div className="bg-[#ffd23f] border-2 border-[#111] rounded-full px-3 py-1 font-bold text-sm shrink-0">
            G$
          </div>
        </div>
        <div className="flex gap-2 justify-between">
          {[25, 50, 75, 100].map((pct) => (
            <button
              key={pct}
              type="button"
              className={`border-2 border-[#111] rounded-full px-4 py-1 font-medium transition-colors ${slippagePercent === pct ? 'bg-[#7b39fc] text-white' : 'bg-white text-[#111] hover:bg-gray-100'}`}
              onClick={() => handleQuickPercent(pct)}
            >
              {pct === 100 ? t.maxButton : `${pct}%`}
            </button>
          ))}
        </div>
      </div>

      {/* YOU RECEIVE ABOUT Card */}
      <div className="gc-card gc-card--mint">
        <span className="text-[#111] font-black uppercase text-xs">{t.youReceiveAbout}</span>
        <div className="flex justify-between items-center">
          <div className="gc-big text-[#111]">
            {Number.isFinite(rate.netNaira) ? formatNaira(rate.netNaira) : t.nairaUnavailable}
          </div>
          <div className="bg-[#fff] border-2 border-[#111] rounded-full px-3 py-1 font-bold">
            NGN
          </div>
        </div>
        <div className="text-[#111] text-sm mt-2">{t.estimateFinalAmountNote}</div>
        {rateError && <div className="text-[#FCA5A5] text-xs mt-2">{rateError}</div>}
      </div>

      {/* PRICE PROTECTION Card */}
      <div className="gc-card">
        <div className="flex justify-between items-center">
          <span className="text-[#111] font-black uppercase text-xs">{t.priceProtection}</span>
          <div className="flex gap-2">
          {[1, 2, 3].map((val) => (
            <button
              key={val}
              type="button"
              className={`border-2 border-[#111] rounded-full px-4 py-1 font-medium transition-colors ${slippagePercent === val ? 'bg-[#7b39fc] text-white' : 'bg-white text-[#111] hover:bg-gray-100'}`}
              onClick={() => setSlippagePercent(val)}
            >
              {val}%
            </button>
          ))}
          </div>
        </div>
      </div>

      {/* Bank Details Card */}
      <div className="gc-card">
        <p className="mb-3 text-[11px] uppercase tracking-[0.12em] text-[#111]">{t.bankDetails}</p>

        {/* Bank Select */}
        <div className="mb-3">
          <label className="block text-[11px] uppercase tracking-[0.12em] text-[#666]">{t.bankLabel}</label>
          <select
            aria-label={t.bankLabel}
            value={institutionCode}
            onChange={(e) => setInstitutionCode(e.target.value)}
            disabled={institutionsLoading}
            className="mt-1 w-full rounded-xl border border-[#2D204A] bg-[#fff] px-3 py-3 text-sm text-[#111] outline-none"
          >
            <option value="">{institutionsLoading ? t.loadingBanks : t.selectBank}</option>
            {institutions.map((bank) => (
              <option key={bank.code} value={bank.code}>
                {bank.name}
              </option>
            ))}
          </select>
        </div>

        {/* Account Number */}
        <div className="mb-3">
          <label className="block text-[11px] uppercase tracking-[0.12em] text-[#666]">
            {t.accountNumberLabel}
          </label>
          <input
            type="text"
            inputMode="numeric"
            value={accountIdentifier}
            onChange={(e) => setAccountIdentifier(e.target.value)}
            placeholder={t.accountNumberPlaceholder}
            className="mt-1 w-full rounded-xl border border-[#2D204A] bg-[#fff] px-3 py-3 text-base text-[#111] outline-none placeholder:text-[#666]"
          />
        </div>

        {/* Account Name */}
        <div className="mb-3">
          <label className="block text-[11px] uppercase tracking-[0.12em] text-[#666]">
            {t.accountNameLabel}
          </label>
          <div className="mt-1 min-h-[48px] rounded-xl border border-[#2D204A] bg-[#fff] px-3 py-3 text-base text-[#111]">
            {verificationStatus === 'loading' && <span className="text-[#666]">{t.verifyingWithPaycrest}</span>}
            {verificationStatus === 'idle' && <span className="text-[#666]">{t.enterTenDigitAccount}</span>}
            {verificationStatus === 'error' && <span className="text-[#FCA5A5]">{verificationError}</span>}
            {verificationStatus === 'verified' && accountName && <span className="font-semibold">{accountName}</span>}
          </div>
          {verificationStatus === 'verified' && accountName && (
            <label className="mt-2 flex items-start gap-2 text-xs text-[#666]">
              <input
                type="checkbox"
                checked={confirmed}
                onChange={(e) => setConfirmed(e.target.checked)}
                className="mt-0.5 h-4 w-4 accent-[#7C3AED]"
              />
              {t.confirmAccountName}
            </label>
          )}
          {institutionsError && <p className="mt-2 text-xs text-[#FCA5A5]">{institutionsError}</p>}
        </div>

        {/* Exit Contribution */}
        <div className="flex items-center justify-between border-t border-[#2D204A] pt-3 text-sm text-[#666]">
          <span>{t.exitContribution}</span>
          <div className="flex items-center gap-2">
            <span className="font-semibold text-[#FCA5A5]">−{exitContributionG.toFixed(0)} G$</span>
            <button type="button" className="text-xs font-medium text-[#7C3AED] underline underline-offset-4">
              {t.whyTheTenPercent}
            </button>
          </div>
        </div>
      </div>

      {/* Review Button */}
      <button
        type="button"
        onClick={() => {
          if (!quote || !canReview) return;
          onInitiateCashOut(
            quote,
            amountNumber,
            slippageBps,
            bankName,
            accountIdentifier,
            accountName ?? '',
            ngnPerUsdt,
            institutionCode
          );
        }}
        disabled={!canReview}
        className={`gc-btn gc-btn--primary w-full mt-4 py-4 text-xl font-bold opacity-100 disabled:opacity-50 disabled:cursor-not-allowed`}
      >
        Review
      </button>
    </>
  );
};

export interface CashOutTrackerProps {
  // Swap execution info
  txHash: string;
  usdtReceived: number;
  amountGSwapped: number;
  residualBalanceG?: number;
  residualBalanceUsdt?: number;

  // Bank recipient info (from Cash out screen)
  bankName: string;
  accountNumber: string;
  accountHolderName: string;

  // Rate & currency estimates
  ngnPerUsdt?: number | null;
  estimatedNaira?: number;

  // Wallet
  walletAddress: string;

  // Testing & state overrides
  initialOrder?: Partial<OffRampOrder> | null;
  initialStep?: 1 | 2 | 3 | 4;
  initialFailureState?: 'expired' | 'refunded' | 'delayed' | null;
  delayedTimeoutMinutes?: number;

  // Callbacks
  onDone: () => void;
  language?: Language;
}

export const CashOutTracker: React.FC<CashOutTrackerProps> = ({
  txHash,
  usdtReceived,
  amountGSwapped,
  residualBalanceG = 0,
  residualBalanceUsdt = 0,
  bankName,
  accountNumber,
  accountHolderName,
  ngnPerUsdt = null,
  estimatedNaira: customEstimatedNaira,
  walletAddress,
  initialOrder = null,
  initialStep,
  initialFailureState = null,
  delayedTimeoutMinutes = 5,
  onDone,
  language,
}) => {
  const {
    order: hookOrder,
    status: hookStatus,
    createOrder,
    pollOnce,
  } = useOffRamp();

  // Translations
  const t = language ? getTranslations(language) : undefined;

  // Internal state
  const [copied, setCopied] = useState(false);
  const [userSent, setUserSent] = useState(false);
  const [sentAt, setSentAt] = useState<number | null>(null);
  const [secondsRemaining, setSecondsRemaining] = useState<number>(900); // 15 mins default
  const [activeFailure, setActiveFailure] = useState<'expired' | 'refunded' | 'delayed' | null>(
    initialFailureState
  );

  // Active order object (falls back to synthetic or initial order)
  const defaultOrderId = `ord-${txHash.slice(2, 10)}`;
  const [localOrder, setLocalOrder] = useState<OffRampOrder>(() => {
    if (initialOrder) {
      return {
        orderId: initialOrder.orderId ?? defaultOrderId,
        receiveAddress: initialOrder.receiveAddress ?? '0x3841D6A1F3E92B710c0e5a953eB684B24B35fC75',
        amountToSend: initialOrder.amountToSend ?? usdtReceived.toFixed(4),
        currency: initialOrder.currency ?? 'USDT',
        network: initialOrder.network ?? 'celo',
        memo: initialOrder.memo,
        amount: initialOrder.amount,
        rate: initialOrder.rate,
        expectedNaira: initialOrder.expectedNaira,
        senderFee: initialOrder.senderFee ?? '0.00',
        transactionFee: initialOrder.transactionFee ?? '0.00',
        validUntil:
          initialOrder.validUntil ?? new Date(Date.now() + 15 * 60 * 1000).toISOString(),
        status: (initialOrder.status as OffRampStatus) ?? 'initiated',
        paymentReference: initialOrder.paymentReference ?? `PAY-NGN-${txHash.slice(2, 8).toUpperCase()}`,
      };
    }
    return {
      orderId: defaultOrderId,
      receiveAddress: '0x3841D6A1F3E92B710c0e5a953eB684B24B35fC75',
      amountToSend: usdtReceived.toFixed(4),
      currency: 'USDT',
      network: 'celo',
      memo: undefined,
      amount: undefined,
      rate: undefined,
      expectedNaira: undefined,
      senderFee: '0.00',
      transactionFee: '0.00',
      validUntil: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
      status: 'initiated',
      paymentReference: `PAY-NGN-${txHash.slice(2, 8).toUpperCase()}`,
    };
  });

  // Calculate Naira estimate from actual swap output — never a hardcoded rate.
  // usdtReceived is the real amount from the on-chain swap, so multiply directly
  // by the live NGN/USDT rate rather than re-deriving through getCashoutRate.
  const swapNairaEstimate: number | null = (() => {
    if (customEstimatedNaira && customEstimatedNaira > 0) return customEstimatedNaira;
    if (ngnPerUsdt && ngnPerUsdt > 0 && usdtReceived > 0) {
      return usdtReceived * ngnPerUsdt;
    }
    return null;
  })();

  // The order response is authoritative when available. amountToSend and fees
  // come from Paycrest; expected NGN is amount × rate from that response.
  const orderNairaEstimate: number | null = (() => {
    if (localOrder.expectedNaira !== undefined) {
      const value = Number(localOrder.expectedNaira);
      return Number.isFinite(value) ? value : null;
    }
    if (localOrder.amount && localOrder.rate) {
      const value = Number(localOrder.amount) * Number(localOrder.rate);
      return Number.isFinite(value) ? value : null;
    }
    return null;
  })();

  const nairaEstimate = orderNairaEstimate ?? swapNairaEstimate;

  // Auto-initiate Paycrest order creation on mount if not provided
  useEffect(() => {
    if (initialOrder) return;

    createOrder({
      amountUsdt: paycrestOrderAmount(usdtReceived),
      usdtReceived,
      swapTxHash: txHash,
      refundAddress: walletAddress,
      recipient: {
        institution: bankName,
        accountIdentifier: accountNumber,
        accountName: accountHolderName,
        memo: 'GoodCash payout',
      },
    }).catch(() => {
      // If backend worker is unreachable, keep localOrder fallback
    });
  }, [initialOrder, createOrder, usdtReceived, txHash, walletAddress, bankName, accountNumber, accountHolderName]);

  // Sync hookOrder updates
  useEffect(() => {
    if (hookOrder) {
      setLocalOrder(hookOrder);
    }
  }, [hookOrder]);

  // Sync failure state from hook status or props
  useEffect(() => {
    if (initialFailureState) {
      setActiveFailure(initialFailureState);
      return;
    }

    const currentStatus = hookOrder?.status ?? localOrder.status ?? hookStatus;
    if (currentStatus === 'expired') {
      setActiveFailure('expired');
    } else if (currentStatus === 'refunded' || currentStatus === 'refunding') {
      setActiveFailure('refunded');
    }
  }, [initialFailureState, hookOrder?.status, localOrder.status, hookStatus]);

  // If order status updates to deposited/pending, auto-set userSent and record sentAt
  useEffect(() => {
    const s = hookOrder?.status ?? localOrder.status;
    if (s === 'deposited' || s === 'pending' || s === 'fulfilling' || s === 'validated' || s === 'settling') {
      if (!userSent) setUserSent(true);
      if (!sentAt) setSentAt(Date.now());
    }
  }, [hookOrder?.status, localOrder.status, userSent, sentAt]);

  // Check delayed payout timer if deposit initiated or user marked sent
  useEffect(() => {
    if (activeFailure || !sentAt) return;

    const interval = setInterval(() => {
      const elapsedMs = Date.now() - sentAt;
      const elapsedMinutes = elapsedMs / (1000 * 60);
      const isSettled = localOrder.status === 'settled';

      if (!isSettled && elapsedMinutes >= delayedTimeoutMinutes) {
        setActiveFailure('delayed');
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [sentAt, activeFailure, delayedTimeoutMinutes, localOrder.status]);

  // Countdown timer for validUntil
  useEffect(() => {
    if (!localOrder.validUntil) return;
    const expiryTime = new Date(localOrder.validUntil).getTime();

    const updateTimer = () => {
      const remainingSecs = Math.max(0, Math.floor((expiryTime - Date.now()) / 1000));
      setSecondsRemaining(remainingSecs);

      if (remainingSecs <= 0 && !userSent && localOrder.status !== 'settled') {
        setActiveFailure('expired');
      }
    };

    updateTimer();
    const interval = setInterval(updateTimer, 1000);
    return () => clearInterval(interval);
  }, [localOrder.validUntil, userSent, localOrder.status]);

  // Poll status on load and on an interval regardless of tapping "I've sent it"
  useEffect(() => {
    if (localOrder.status === 'settled' || localOrder.status === 'refunded' || localOrder.status === 'error' || activeFailure) return;

    // Check on load
    pollOnce().catch(() => {});

    // Recurring poll
    const interval = setInterval(() => {
      pollOnce().catch(() => {});
    }, 8000);

    return () => clearInterval(interval);
  }, [localOrder.status, activeFailure, pollOnce]);

  // Format countdown string MM:SS
  const formatCountdown = (totalSecs: number) => {
    const mins = Math.floor(totalSecs / 60);
    const secs = totalSecs % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  // Format validUntil target time
  const formatTargetTime = (isoString?: string) => {
    if (!isoString) return '15 minutes';
    try {
      const d = new Date(isoString);
      return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    } catch {
      return '15 minutes';
    }
  };

  // Determine current Step (1, 2, 3, or 4)
  const currentStep = (() => {
    if (userSent && (!initialStep || initialStep <= 2)) return 3;
    if (initialStep !== undefined) return initialStep;
    if (localOrder.status === 'settled') return 4;
    if (userSent || localOrder.status === 'deposited' || localOrder.status === 'pending' || localOrder.status === 'fulfilling') {
      return 3;
    }
    return 2; // Step 1 is completed instantly upon swap; default to Step 2 action
  })();

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(localOrder.receiveAddress);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard fallback
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleUserSent = () => {
    setUserSent(true);
    setSentAt(Date.now());
    pollOnce().catch(() => {});
  };

  const explorerUrl = `https://celo.blockscout.com/tx/${txHash}`;
  const orderId = localOrder.orderId;
  const bankReference = localOrder.paymentReference || `PAY-NGN-${txHash.slice(2, 8).toUpperCase()}`;

  return (
    <div className="w-full max-w-xl mx-auto rounded-3xl border border-[#2D204A] bg-[#120D1D]/95 p-6 sm:p-8 shadow-2xl backdrop-blur-md text-white animate-fade-in relative" aria-live="polite">
      {/* Top of the Screen: Headline & Subtitle */}
      <div className="text-center mb-6">
        <div className="text-3xl sm:text-4xl font-extrabold font-manrope text-white tracking-tight">
          ≈ ₦{nairaEstimate !== null ? nairaEstimate.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—'}
        </div>
        <p className="text-xs sm:text-sm text-[#A39BBE] font-sans mt-1">
          {orderNairaEstimate !== null ? 'Set by your Paycrest payout order' : 'Final amount is set when the payout completes'}
        </p>
      </div>

      {/* 4-Step Stepper Header */}
      <div className="grid grid-cols-4 gap-2 mb-8 border-b border-[#2D204A] pb-5 text-center text-xs">
        {/* Step 1 */}
        <div className="flex flex-col items-center">
          <div className="w-7 h-7 rounded-full flex items-center justify-center font-bold text-xs mb-1.5 bg-emerald-500/20 text-emerald-400 border border-emerald-400/40">
            ✓
          </div>
          <span className="font-medium text-emerald-400">1 Swapped to USDT</span>
        </div>

        {/* Step 2 */}
        <div className="flex flex-col items-center">
          <div
            className={`w-7 h-7 rounded-full flex items-center justify-center font-bold text-xs mb-1.5 transition ${
              currentStep > 2
                ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-400/40'
                : currentStep === 2
                ? 'bg-[#7C3AED] text-white shadow-lg shadow-purple-500/30'
                : 'bg-[#1B122E] text-[#A39BBE] border border-[#2D204A]'
            }`}
          >
            {currentStep > 2 ? '✓' : '2'}
          </div>
          <span className={currentStep >= 2 ? 'font-medium text-white' : 'text-[#A39BBE]'}>
            2 Send to partner
          </span>
        </div>

        {/* Step 3 */}
        <div className="flex flex-col items-center">
          <div
            className={`w-7 h-7 rounded-full flex items-center justify-center font-bold text-xs mb-1.5 transition ${
              currentStep > 3
                ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-400/40'
                : currentStep === 3
                ? 'bg-[#7C3AED] text-white shadow-lg shadow-purple-500/30'
                : 'bg-[#1B122E] text-[#A39BBE] border border-[#2D204A]'
            }`}
          >
            {currentStep > 3 ? '✓' : '3'}
          </div>
          <span className={currentStep >= 3 ? 'font-medium text-white' : 'text-[#A39BBE]'}>
            3 Paying to your bank
          </span>
        </div>

        {/* Step 4 */}
        <div className="flex flex-col items-center">
          <div
            className={`w-7 h-7 rounded-full flex items-center justify-center font-bold text-xs mb-1.5 transition ${
              currentStep === 4
                ? 'bg-emerald-500 text-black font-extrabold shadow-lg shadow-emerald-500/30'
                : 'bg-[#1B122E] text-[#A39BBE] border border-[#2D204A]'
            }`}
          >
            {currentStep === 4 ? '✓' : '4'}
          </div>
          <span className={currentStep === 4 ? 'font-medium text-emerald-400' : 'text-[#A39BBE]'}>
            4 Done
          </span>
        </div>
      </div>

      {/* FAILURE STATES (If any failure condition is triggered) */}
      {activeFailure ? (
        <div className="space-y-4 mb-6">
          {activeFailure === 'expired' && (
            <div className="rounded-2xl border border-amber-500/40 bg-amber-500/10 p-5 text-amber-200">
              <div className="flex items-center gap-2 mb-2 font-bold text-base text-amber-300">
                <span className="text-xl">⚠️</span> order expired before USDT arrived
              </div>
              <p className="text-xs text-amber-200/80 mb-3">
                The order deposit window closed before funds were received. Please do not send USDT to this address.
              </p>
              <div className="bg-[#120D1D] rounded-xl p-3 border border-amber-500/20 mb-4 text-xs font-mono text-white/90">
                Order ID: <span className="text-amber-400 font-bold">{orderId}</span>
              </div>
              <div className="flex items-center gap-3">
                <a
                  href={`mailto:support@goodcash.io?subject=Expired%20Order%20${orderId}`}
                  className="flex-1 text-center py-2.5 px-4 rounded-xl bg-amber-500 hover:bg-amber-400 text-black font-cabin font-bold text-xs transition"
                >
                  Contact support
                </a>
                <button
                  type="button"
                  onClick={onDone}
                  className="py-2.5 px-4 rounded-xl border border-amber-500/40 text-amber-200 hover:bg-amber-500/20 text-xs font-cabin"
                >
                  Back to Dashboard
                </button>
              </div>
            </div>
          )}


          {activeFailure === 'refunded' && (
            <div className="rounded-2xl border border-red-500/40 bg-red-500/10 p-5 text-red-200">
              <div className="flex items-center gap-2 mb-2 font-bold text-base text-red-300">
                <span className="text-xl">↩️</span> order refunded
              </div>
              <p className="text-xs text-red-200/80 mb-3">
                This order was refunded to your Celo wallet. Any deposited funds have been returned.
              </p>
              <div className="bg-[#120D1D] rounded-xl p-3 border border-red-500/20 mb-4 text-xs font-mono text-white/90">
                Order ID: <span className="text-red-400 font-bold">{orderId}</span>
              </div>
              <div className="flex items-center gap-3">
                <a
                  href={`mailto:support@goodcash.io?subject=Refunded%20Order%20${orderId}`}
                  className="flex-1 text-center py-2.5 px-4 rounded-xl bg-red-500 hover:bg-red-400 text-white font-cabin font-bold text-xs transition"
                >
                  Contact support
                </a>
                <button
                  type="button"
                  onClick={onDone}
                  className="py-2.5 px-4 rounded-xl border border-red-500/40 text-red-200 hover:bg-red-500/20 text-xs font-cabin"
                >
  );
                </button>
              </div>
            </div>
          )}

          {activeFailure === 'delayed' && (
            <div className="rounded-2xl border border-amber-500/40 bg-amber-500/10 p-5 text-amber-200">
              <div className="flex items-center gap-2 mb-2 font-bold text-base text-amber-300">
                <span className="text-xl">⏳</span> USDT sent but naira not received after {delayedTimeoutMinutes} minutes
              </div>
              <p className="text-xs text-amber-200/80 mb-3">
                Your deposit was confirmed, but the bank payout is taking longer than usual. Our support team can inspect the payment rail.
              </p>
              <div className="bg-[#120D1D] rounded-xl p-3 border border-amber-500/20 mb-4 text-xs font-mono text-white/90">
                Order ID: <span className="text-amber-400 font-bold">{orderId}</span>
              </div>
              <div className="flex items-center gap-3">
                <a
                  href={`mailto:support@goodcash.io?subject=Delayed%20Payout%20Order%20${orderId}`}
                  className="flex-1 text-center py-2.5 px-4 rounded-xl bg-amber-500 hover:bg-amber-400 text-black font-cabin font-bold text-xs transition"
                >
                  Contact support
                </a>
                <button
                  type="button"
                  onClick={() => pollOnce().catch(() => {})}
                  className="py-2.5 px-4 rounded-xl border border-amber-500/40 text-amber-200 hover:bg-amber-500/20 text-xs font-cabin"
                >
                  Check again
                </button>
              </div>
            </div>
          )}
        </div>
      ) : null}

      {/* STEP CONTENT */}
      {!activeFailure && (
        <div className="space-y-6">
          {/* STEP 1: Swapped to USDT summary */}
          {currentStep === 1 && (
            <div className="rounded-2xl border border-[#2D204A] bg-[#1B122E]/60 p-5 text-center">
              <div className="text-emerald-400 font-bold text-lg mb-1">
                ✓ Swapped {amountGSwapped.toLocaleString()} G$ to {usdtReceived.toFixed(4)} USDT
              </div>
              <p className="text-xs text-white/60">Preparing off-ramp transfer...</p>
            </div>
          )}

          {/* STEP 2: Send to partner */}
          {currentStep === 2 && (
            <div className="space-y-5">
              <div className="bg-[#1B122E]/80 border border-[#2D204A] rounded-2xl p-5">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-sm font-bold text-white uppercase tracking-wider">
                    Deposit Instructions
                  </h3>
                  <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-purple-500/20 border border-purple-400/30 text-purple-300 text-xs font-mono font-medium">
                    <span>⏱</span>
                    <span>Expires in {formatCountdown(secondsRemaining)}</span>
                  </div>
                </div>

                {/* Instruction Sentence */}
                <p className="text-sm text-purple-200 mb-4 font-medium">
                  Send exactly <span className="font-extrabold text-white">{localOrder.amountToSend} USDT</span> to this address before{' '}
                  <span className="font-semibold text-white">{formatTargetTime(localOrder.validUntil)}</span>:
                </p>

                {/* Amount Box */}
                <div className="bg-[#120D1D] rounded-xl p-3 border border-white/5 mb-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <span className="text-[11px] text-white/50 block">Amount to send (from Paycrest)</span>
                      <span className="text-lg font-bold font-mono text-emerald-400">
                        {localOrder.amountToSend} USDT
                      </span>
                    </div>
                    <span className="text-xs text-white/40 font-mono">Celo Network</span>
                  </div>
                  <div className="mt-3 grid grid-cols-2 gap-2 border-t border-white/5 pt-3 text-[11px]">
                    <div>
                      <span className="block text-white/40">Sender fee</span>
                      <span className="font-mono text-white">{localOrder.senderFee} USDT</span>
                    </div>
                    <div>
                      <span className="block text-white/40">Transaction fee</span>
                      <span className="font-mono text-white">{localOrder.transactionFee} USDT</span>
                    </div>
                    <div className="col-span-2">
                      <span className="block text-white/40">Expected naira (Paycrest order)</span>
                      <span className="font-mono text-emerald-400">
                        {orderNairaEstimate !== null
                          ? `₦${orderNairaEstimate.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                          : '—'}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Address Box + Copy Button */}
                <div className="bg-[#120D1D] rounded-xl p-3 border border-white/5 mb-3">
                  <span className="text-[11px] text-white/50 block mb-1">Paycrest Deposit Address</span>
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-xs text-white break-all select-all">
                      {localOrder.receiveAddress}
                    </span>
                    <button
                      type="button"
                      onClick={handleCopy}
                      className="shrink-0 px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-xs font-cabin font-medium text-white transition border border-white/10"
                    >
                      {copied ? 'Copied!' : 'Copy'}
                    </button>
                  </div>
                </div>

                {/* Memo (if required) */}
                {localOrder.memo && (
                  <div className="bg-[#120D1D] rounded-xl p-3 border border-white/5 mb-3">
                    <span className="text-[11px] text-white/50 block">Deposit Memo / Reference</span>
                    <span className="font-mono text-xs text-purple-300">{localOrder.memo}</span>
                  </div>
                )}

                {/* Warning note */}
                <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-200">
                  <span className="font-semibold">Warning:</span> A smaller amount is refunded. Please send the exact amount specified.
                </div>
              </div>

              {/* Primary User Action Button */}
              <button
                type="button"
                onClick={handleUserSent}
                className="w-full py-4 px-6 rounded-2xl bg-[#7C3AED] hover:bg-[#8B5CF6] active:scale-98 text-white font-cabin font-bold text-base shadow-[0_20px_34px_rgba(124,58,237,0.25)] transition flex items-center justify-center gap-2"
              >
                <span>I've sent it</span>
                <span className="text-lg">→</span>
              </button>
            </div>
          )}

          {/* STEP 3: Paying to your bank */}
          {currentStep === 3 && (
            <div className="space-y-5">
              <div className="bg-[#1B122E]/80 border border-[#2D204A] rounded-2xl p-6 text-center">
                <div className="w-12 h-12 rounded-full border-2 border-[#7C3AED] border-t-transparent animate-spin mx-auto mb-4" />
                <h3 className="text-lg font-bold text-white mb-1">Paying to your bank</h3>
                <p className="text-xs text-white/60 mb-5">
                  Deposit received by Paycrest. The local fiat transfer is in progress to your account.
                </p>

                {/* Bank Target Details */}
                <div className="bg-[#120D1D] rounded-xl p-4 border border-white/5 text-left text-xs space-y-2 mb-4">
                  <div className="flex justify-between">
                    <span className="text-white/50">Destination Bank:</span>
                    <span className="font-medium text-white">{bankName}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-white/50">Account Number:</span>
                    <span className="font-mono text-white">{accountNumber}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-white/50">Beneficiary:</span>
                    <span className="font-medium text-white">{accountHolderName}</span>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => pollOnce().catch(() => {})}
                  className="py-2 px-4 rounded-xl border border-white/15 bg-white/5 hover:bg-white/10 text-white text-xs font-cabin transition inline-flex items-center gap-1.5"
                >
                  <span>🔄</span> Refresh status
                </button>
              </div>
            </div>
          )}
          {currentStep === 4 && (
            <div className="gc-card--mint p-6 sm:p-8 bg-[#120D1D] rounded-2xl border border-[#2D204A]">
              <div className="text-center mb-6">
                <div className="gc-big text-4xl sm:text-5xl font-extrabold font-manrope text-white mb-2">
                  {t?.nairaDelivered || 'Naira Delivered!'}
                </div>
                <p className="text-white/60 mb-3">{t?.paidToYourBank || 'paid to your bank'}</p>
              </div>
              <div className="bg-[#1B122E]/80 rounded-xl p-4 border border-white/5 mb-6">
                <div className="flex justify-between items-center mb-2">
                  <span className="text-white/50">Bank Reference:</span>
                  <span className="font-mono text-white">{bankReference || 'PAY-NGN-' + txHash.slice(2, 8).toUpperCase()}</span>
                </div>
                <p className="text-xs text-white/60">Transaction receipt</p>
              </div>
              <div className="flex justify-center mb-6">
                <a
                  href={explorerUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="bg-[#7C3AED] hover:bg-[#8B5CF6] text-white font-cabin font-bold text-sm py-2.5 px-6 rounded-xl transition focus-visible:outline focus-visible:outline-3 focus-visible:outline-black focus-visible:outline-offset-2"
                >
                  View on Explorer
                </a>
              </div>
              <button
                type="button"
                onClick={onDone}
                className="gc-hit w-full py-3.5 px-6 rounded-xl bg-black hover:bg-black/90 text-white font-cabin font-bold text-sm shadow-lg transition focus-visible:outline focus-visible:outline-3 focus-visible:outline-black focus-visible:outline-offset-2"
              >
                {t?.doneButton || 'Done'}
              </button>
            </div>
          )}


        </div>
      )}

      {/* DETAILS CARD (Always present at the bottom) */}
      <div className="mt-6 pt-5 border-t border-[#2D204A]">
        <h4 className="text-xs font-bold uppercase tracking-wider text-white/50 mb-3">
          Details
        </h4>
        <div className="bg-[#1B122E]/50 rounded-2xl p-4 border border-white/5 text-xs font-sans space-y-2.5">
          {/* Swap Hash */}
          <div className="flex justify-between items-center">
            <span className="text-white/50">Swap Hash:</span>
            <span className="font-mono text-white text-[11px] truncate max-w-[200px]">
              {txHash}
            </span>
          </div>

          {/* Explorer Link */}
          <div className="flex justify-between items-center">
            <span className="text-white/50">Explorer Link:</span>
            <a
              href={explorerUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[#8B5CF6] hover:text-white underline font-mono text-[11px] flex items-center gap-1"
            >
              <span>View on Celo Explorer</span>
              <span>↗</span>
            </a>
          </div>

          {/* Residual Balance */}
          <div className="flex justify-between items-center">
            <span className="text-white/50">Residual Balance:</span>
            <span className="font-mono text-emerald-400 font-medium text-[11px]">
              {residualBalanceG} G$ / {residualBalanceUsdt} USDT (Zero-dust design)
            </span>
          </div>

          {/* Order ID */}
          <div className="flex justify-between items-center pt-1 border-t border-white/5">
            <span className="text-white/50">Order ID:</span>
            <span className="font-mono text-purple-300 font-medium text-[11px] select-all">
              {orderId}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};
