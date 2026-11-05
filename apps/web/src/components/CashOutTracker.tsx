import React, { useState, useEffect } from 'react';
import type { Language } from '../lib/i18n';

import {
  useOffRamp,
  paycrestOrderAmount,
  type OffRampOrder,
  type OffRampStatus,
} from '../lib/useOffRamp';

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
}) => {
  const {
    order: hookOrder,
    status: hookStatus,
    createOrder,
    pollOnce,
  } = useOffRamp();

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
                  Back to Dashboard
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

          {/* STEP 4: Done */}
          {currentStep === 4 && (
            <div className="space-y-5">
              <div className="bg-[#1B122E]/80 border border-emerald-500/40 rounded-2xl p-6 text-center">
                <div className="w-16 h-16 rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-400/40 flex items-center justify-center text-3xl mx-auto mb-4">
                  ✓
                </div>
                <h3 className="text-2xl font-bold font-manrope text-white mb-1">Naira Delivered!</h3>
                <p className="text-xs text-emerald-300 font-sans mb-5">
                  The payout has been settled and delivered directly to your bank account.
                </p>

                {/* Bank Reference */}
                <div className="bg-[#120D1D] rounded-xl p-4 border border-emerald-500/20 text-left text-xs space-y-2 mb-6">
                  <div className="flex justify-between items-center pb-2 border-b border-white/5">
                    <span className="text-white/50">Bank Reference:</span>
                    <span className="font-mono font-bold text-emerald-400 select-all">{bankReference}</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-white/50">Account:</span>
                    <span className="text-white">{bankName} ({accountNumber})</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-white/50">Account Holder:</span>
                    <span className="text-white">{accountHolderName}</span>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={onDone}
                  className="w-full py-3.5 px-6 rounded-2xl bg-emerald-500 hover:bg-emerald-400 text-black font-cabin font-bold text-sm shadow-lg shadow-emerald-500/20 transition"
                >
                  Done
                </button>
              </div>
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
