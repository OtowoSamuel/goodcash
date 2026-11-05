/**
 * OffRampCard — Paycrest USDT → NGN off-ramp UI.
 *
 * Shows:
 *   Step 1 — Bank details form (institution, account number, account name)
 *   Step 2 — Deposit instruction (send exact amount to the receive address)
 *   Step 3 — Live status tracker
 *
 * Rules enforced:
 *   - Never stores or logs bank details client-side.
 *   - Never reuses an expired order address.
 *   - Shows USDT amount from Paycrest response (includes fees), not from input.
 *   - Renders expiry countdown and renew button.
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  useOffRamp,
  useBankAccountVerification,
  paycrestOrderAmount,
  offRampStatusLabel,
  isTerminalStatus,
  isExpiredStatus,
  type BankRecipient,
  type OffRampStatus,
} from '../lib/useOffRamp';
import { MIN_NET_USDT_REQUIRED } from '../lib/rate';
import type { Language } from '../lib/i18n';

// Status colour helpers
function statusColor(s: OffRampStatus): string {
  if (s === 'settled') return 'emerald';
  if (s === 'error' || s === 'refunded' || s === 'refunding') return 'red';
  if (s === 'expired') return 'amber';
  return 'purple';
}

interface OffRampCardProps {
  /** USDT amount received from the swap (e.g. 0.114107) */
  usdtAmount: number;
  /** Confirmed swap that produced the USDT */
  swapTxHash: string;
  /** User's Celo wallet (used as refund address) */
  walletAddress: string;
  language: Language;
  onDone: () => void;
}

type Step = 'form' | 'deposit' | 'tracking';

export const OffRampCard: React.FC<OffRampCardProps> = ({
  usdtAmount,
  swapTxHash,
  walletAddress,
  onDone,
}) => {
  const { order, status, error, createOrder, pollOnce, renewOrder, reset } = useOffRamp();

  const [step, setStep] = useState<Step>('form');
  const {
    institutions,
    institutionsLoading,
    institutionsError,
    institutionCode,
    setInstitutionCode,
    accountIdentifier,
    setAccountIdentifier,
    accountName,
    verificationStatus,
    verificationError,
    confirmed,
    setConfirmed,
  } = useBankAccountVerification('NGN');
  const [copied, setCopied] = useState(false);
  const [timeLeft, setTimeLeft] = useState<number | null>(null);

  // Poll order status every 10s once on the tracking step
  useEffect(() => {
    if (step !== 'tracking') return;
    if (isTerminalStatus(status)) return;

    const interval = setInterval(pollOnce, 10_000);
    return () => clearInterval(interval);
  }, [step, status, pollOnce]);

  // Expiry countdown
  useEffect(() => {
    if (!order?.validUntil) return;
    const expiry = new Date(order.validUntil).getTime();

    const tick = () => {
      const remaining = Math.max(0, Math.floor((expiry - Date.now()) / 1000));
      setTimeLeft(remaining);
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [order?.validUntil]);

  const handleSubmit = useCallback(async () => {
    if (!institutionCode || accountIdentifier.length !== 10 || !accountName || !confirmed) return;

    const recipient: BankRecipient = {
      institution: institutionCode,
      accountIdentifier,
      accountName,
      memo: 'GoodCash',
    };

    try {
      await createOrder({
        amountUsdt: paycrestOrderAmount(usdtAmount),
        usdtReceived: usdtAmount,
        swapTxHash,
        refundAddress: walletAddress,
        recipient,
      });
      setStep('deposit');
    } catch {
      // createPaycrestOrder already set the error state; stay on the form.
    }
  }, [institutionCode, accountIdentifier, accountName, confirmed, usdtAmount, swapTxHash, walletAddress, createOrder]);

  const handleConfirmDeposit = () => setStep('tracking');

  const handleCopyAddress = async () => {
    if (!order?.receiveAddress) return;
    await navigator.clipboard.writeText(order.receiveAddress);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleRenew = async () => {
    if (!institutionCode || !accountIdentifier || !accountName || !confirmed) {
      setStep('form');
      return;
    }
    try {
      await renewOrder({
        amountUsdt: paycrestOrderAmount(usdtAmount),
        usdtReceived: usdtAmount,
        swapTxHash,
        refundAddress: walletAddress,
        recipient: {
          institution: institutionCode,
          accountIdentifier,
          accountName,
          memo: 'GoodCash',
        },
      });
      setStep('deposit');
    } catch {
      // createPaycrestOrder already set the error state; stay on the form.
    }
  };

  const color = statusColor(status);
  const colorClasses: Record<string, string> = {
    emerald: 'bg-emerald-500/20 border-emerald-400/40 text-emerald-300',
    red: 'bg-red-500/15 border-red-500/40 text-red-300',
    amber: 'bg-amber-500/15 border-amber-500/40 text-amber-300',
    purple: 'bg-purple-500/15 border-purple-400/30 text-purple-300',
  };
  const badgeClass = colorClasses[color] ?? colorClasses.purple;

  // -------------------------------------------------------------------------
  // Render step: bank details form
  // -------------------------------------------------------------------------
  if (step === 'form') {
    return (
      <div className="glass-panel rounded-2xl p-6 sm:p-8 w-full max-w-xl mx-auto shadow-2xl animate-fade-in">
        {/* Header */}
        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 rounded-full bg-purple-500/20 border border-purple-400/40 flex items-center justify-center text-lg">
            🏦
          </div>
          <div>
            <h2 className="text-lg font-manrope font-bold text-white">Cash Out to Naira</h2>
            <p className="text-xs text-white/60 font-sans">
              Your USDT will be converted to NGN by Paycrest and deposited to your bank.
            </p>
          </div>
        </div>

        {/* Amount summary */}
        <div className="bg-[#120e22] border border-purple-500/20 rounded-xl p-4 mb-6 flex justify-between items-center">
          <span className="text-xs text-white/60 font-sans">USDT to convert</span>
          <span className="font-mono font-bold text-emerald-400 text-lg">{usdtAmount.toFixed(4)} USDT</span>
        </div>

        {/* Legal / KYC notice */}
        <div className="bg-amber-500/10 border border-amber-400/30 rounded-xl px-4 py-3 mb-6 text-xs text-amber-200 font-sans leading-relaxed">
          <strong>Privacy note:</strong> Your bank details are sent securely to Paycrest (the licensed off-ramp provider) and are <strong>not stored</strong> by GoodCash. Wallet addresses and bank details are personal data under NDPA 2023.
        </div>

        {/* Bank form */}
        <div className="space-y-4">
          {/* Bank selection */}
          <div>
            <label className="block text-xs font-manrope text-white/70 mb-1.5">Bank / Institution</label>
            <select
              id="offramp-bank"
              value={institutionCode}
              onChange={(e) => setInstitutionCode(e.target.value)}
              disabled={institutionsLoading}
              className="w-full bg-[#18122c] border border-purple-400/20 rounded-xl px-4 py-2.5 text-white text-sm font-sans focus:outline-none focus:ring-1 focus:ring-purple-500 appearance-none"
            >
              <option value="">{institutionsLoading ? 'Loading banks…' : 'Select your bank…'}</option>
              {institutions.map((b) => (
                <option key={b.code} value={b.code}>{b.name}</option>
              ))}
            </select>
          </div>

          {/* Account number */}
          <div>
            <label className="block text-xs font-manrope text-white/70 mb-1.5">Account Number / Phone</label>
            <input
              id="offramp-account-number"
              type="text"
              inputMode="numeric"
              maxLength={20}
              placeholder="e.g. 0123456789"
              value={accountIdentifier}
              onChange={(e) => setAccountIdentifier(e.target.value)}
              className="w-full bg-[#18122c] border border-purple-400/20 rounded-xl px-4 py-2.5 text-white text-sm font-mono focus:outline-none focus:ring-1 focus:ring-purple-500 placeholder-white/20"
            />
          </div>

          {/* Account name from Paycrest */}
          <div>
            <label className="block text-xs font-manrope text-white/70 mb-1.5">Account Name</label>
            <div
              id="offramp-account-name"
              aria-live="polite"
              className="w-full min-h-[42px] bg-[#18122c] border border-purple-400/20 rounded-xl px-4 py-2.5 text-white text-sm font-sans"
            >
              {verificationStatus === 'loading' && <span className="text-white/40">Verifying with Paycrest…</span>}
              {verificationStatus === 'idle' && <span className="text-white/30">Enter a 10-digit account number</span>}
              {verificationStatus === 'error' && <span className="text-red-300">{verificationError}</span>}
              {verificationStatus === 'verified' && accountName && <span className="font-semibold">{accountName}</span>}
            </div>
            {verificationStatus === 'verified' && accountName && (
              <label className="mt-2 flex items-start gap-2 text-xs text-white/70">
                <input
                  type="checkbox"
                  checked={confirmed}
                  onChange={(e) => setConfirmed(e.target.checked)}
                  className="mt-0.5 h-4 w-4 accent-[#7b39fc]"
                />
                I confirm this is my account name
              </label>
            )}
            {institutionsError && <p className="mt-1 text-xs text-red-300">{institutionsError}</p>}
          </div>
        </div>

        {/* Error display */}
        {error && (
          <div className="mt-4 bg-red-500/15 border border-red-500/40 rounded-xl px-4 py-3 text-xs text-red-300 font-sans">
            {error}
          </div>
        )}

        {/* Actions */}
        <div className="mt-6 flex flex-col sm:flex-row gap-3">
          <button
            onClick={onDone}
            className="flex-1 py-3 px-4 rounded-xl bg-white/5 hover:bg-white/10 text-white/70 font-cabin text-sm border border-white/10 transition-all"
          >
            Skip for Now
          </button>
          <button
            id="offramp-submit-btn"
            onClick={handleSubmit}
            disabled={!institutionCode || accountIdentifier.length !== 10 || verificationStatus !== 'verified' || !accountName || !confirmed || status === 'creating'}
            className="flex-1 py-3 px-4 rounded-xl font-cabin font-semibold text-sm transition-all disabled:opacity-40 disabled:cursor-not-allowed bg-[#7b39fc] hover:bg-[#8c4eff] active:scale-98 text-white shadow-lg shadow-[#7b39fc]/30"
          >
            {status === 'creating' ? 'Creating order…' : 'Request Payout ₦'}
          </button>
        </div>

        {/* Partner notice */}
        <p className="mt-4 text-center text-[11px] text-white/35 font-sans">
          Payout powered by Paycrest — a licensed stablecoin off-ramp. Minimum payout $
          {MIN_NET_USDT_REQUIRED.toFixed(2)} USDT.
        </p>
      </div>
    );
  }

  // -------------------------------------------------------------------------
  // Render step: deposit instruction
  // -------------------------------------------------------------------------
  if (step === 'deposit' && order) {
    const isExpired = isExpiredStatus(status);
    const expiryFormatted = new Date(order.validUntil).toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
    });

    return (
      <div className="glass-panel rounded-2xl p-6 sm:p-8 w-full max-w-xl mx-auto shadow-2xl animate-fade-in">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 rounded-full bg-purple-500/20 border border-purple-400/40 flex items-center justify-center text-lg">
            📤
          </div>
          <div>
            <h2 className="text-lg font-manrope font-bold text-white">Send Your USDT</h2>
            <p className="text-xs text-white/60 font-sans">
              Send exactly the amount shown below to the deposit address before the deadline.
            </p>
          </div>
        </div>

        {isExpired ? (
          <div className="bg-amber-500/15 border border-amber-500/40 rounded-xl p-4 mb-5 text-sm text-amber-200 font-sans">
            <strong>⏰ Order expired.</strong> This deposit address is no longer valid.
            <br />Please create a fresh order — do not send to the old address.
            <button
              onClick={handleRenew}
              className="mt-3 w-full py-2.5 rounded-xl bg-[#7b39fc] text-white font-cabin font-semibold text-sm"
            >
              Create New Order
            </button>
          </div>
        ) : (
          <>
            {/* Amount to send */}
            <div className="bg-[#120e22] border border-emerald-500/30 rounded-xl p-5 mb-5 text-center">
              <span className="text-xs text-white/60 font-manrope uppercase tracking-wider block mb-1">
                Send Exactly
              </span>
              <div className="flex items-baseline justify-center gap-2">
                <span className="text-3xl font-extrabold font-mono text-emerald-400">
                  {order.amountToSend}
                </span>
                <span className="font-cabin font-bold text-white text-base">{order.currency}</span>
              </div>
              <p className="text-[11px] text-white/40 mt-1 font-sans">
                Includes {order.transactionFee} {order.currency} transaction fee
              </p>
            </div>

            {/* Deposit address */}
            <div className="bg-[#18122c] border border-purple-400/20 rounded-xl p-4 mb-4">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-xs text-white/60 font-manrope">Deposit address (Celo network)</span>
                <button
                  onClick={handleCopyAddress}
                  className="text-[11px] font-cabin font-semibold text-purple-300 hover:text-white transition-colors"
                >
                  {copied ? '✓ Copied' : 'Copy'}
                </button>
              </div>
              <code className="text-sm font-mono text-white break-all leading-relaxed block">
                {order.receiveAddress}
              </code>
              {order.memo && (
                <p className="text-[11px] text-amber-200 mt-2 font-sans">
                  ⚠️ Memo required: <strong>{order.memo}</strong> — include this or your deposit may not be credited.
                </p>
              )}
            </div>

            {/* Expiry countdown */}
            <div className="flex items-center justify-between bg-white/5 rounded-xl px-4 py-2.5 mb-5 text-xs font-mono">
              <span className="text-white/60">Order expires at</span>
              <span className={`font-bold ${timeLeft !== null && timeLeft < 300 ? 'text-amber-400' : 'text-white'}`}>
                {expiryFormatted}
                {timeLeft !== null && timeLeft > 0 && ` (${Math.floor(timeLeft / 60)}m ${timeLeft % 60}s left)`}
                {timeLeft === 0 && ' — expired'}
              </span>
            </div>

            {/* Warning */}
            <div className="bg-red-500/10 border border-red-400/20 rounded-xl px-4 py-3 mb-5 text-xs text-red-200 font-sans leading-relaxed">
              <strong>⚠️ Important:</strong> Send exactly <strong>{order.amountToSend} {order.currency}</strong>. A smaller amount will be refunded to your wallet. A larger amount requires manual support. Only send on the <strong>Celo</strong> network.
            </div>

            <button
              id="offramp-sent-btn"
              onClick={handleConfirmDeposit}
              className="w-full py-3.5 px-4 rounded-xl bg-[#7b39fc] hover:bg-[#8c4eff] active:scale-98 text-white font-cabin font-semibold text-sm shadow-lg shadow-[#7b39fc]/30 transition-all"
            >
              I've Sent the USDT — Track My Order →
            </button>
          </>
        )}
      </div>
    );
  }

  // -------------------------------------------------------------------------
  // Render step: status tracker
  // -------------------------------------------------------------------------
  if (step === 'tracking') {
    const steps: { key: OffRampStatus[]; label: string }[] = [
      { key: ['initiated'], label: 'Order created' },
      { key: ['deposited'], label: 'Deposit received' },
      { key: ['pending', 'fulfilling', 'validated', 'settling'], label: 'Processing payout' },
      { key: ['settled'], label: 'Naira delivered' },
    ];

    const currentStepIndex = steps.findIndex((s) =>
      s.key.some((k) => k === status),
    );

    return (
      <div className="glass-panel rounded-2xl p-6 sm:p-8 w-full max-w-xl mx-auto shadow-2xl animate-fade-in">
        <div className="flex items-center gap-3 mb-6">
          <div className={`w-10 h-10 rounded-full border flex items-center justify-center text-lg ${badgeClass}`}>
            {status === 'settled' ? '✓' : status === 'expired' ? '⏰' : '⟳'}
          </div>
          <div>
            <h2 className="text-lg font-manrope font-bold text-white">Off-Ramp Status</h2>
            <p className="text-xs text-white/60 font-sans">Order ID: {order?.orderId?.slice(0, 8)}…</p>
          </div>
          <div className={`ml-auto px-3 py-1 rounded-full text-[11px] font-cabin font-semibold border ${badgeClass}`}>
            {status}
          </div>
        </div>

        {/* Progress stepper */}
        <div className="mb-6 space-y-0">
          {steps.map((s, i) => {
            const done = currentStepIndex > i || status === 'settled';
            const active = currentStepIndex === i && !isTerminalStatus(status);
            return (
              <div key={i} className="flex items-start gap-3">
                <div className="flex flex-col items-center">
                  <div className={`w-6 h-6 rounded-full border-2 flex items-center justify-center text-xs font-bold flex-shrink-0 ${
                    done ? 'bg-emerald-500 border-emerald-500 text-white' :
                    active ? 'border-purple-400 text-purple-300 bg-purple-500/20' :
                    'border-white/20 text-white/30'
                  }`}>
                    {done ? '✓' : i + 1}
                  </div>
                  {i < steps.length - 1 && (
                    <div className={`w-0.5 h-6 mt-0.5 ${done ? 'bg-emerald-500/50' : 'bg-white/10'}`} />
                  )}
                </div>
                <p className={`text-sm font-sans pt-0.5 ${
                  done ? 'text-emerald-300' : active ? 'text-white font-medium' : 'text-white/40'
                }`}>
                  {s.label}
                  {active && !isTerminalStatus(status) && (
                    <span className="ml-2 inline-block w-1.5 h-1.5 rounded-full bg-purple-400 animate-pulse" />
                  )}
                </p>
              </div>
            );
          })}
        </div>

        {/* Status message */}
        <div className={`rounded-xl px-4 py-3 mb-6 text-sm font-sans border ${badgeClass}`}>
          {offRampStatusLabel(status)}
        </div>

        {/* Payment reference on success */}
        {order?.paymentReference && status === 'settled' && (
          <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-xl px-4 py-3 mb-6 text-xs font-sans text-emerald-200">
            Bank reference: <span className="font-mono font-bold">{order.paymentReference}</span>
          </div>
        )}

        {/* Expired — renew */}
        {isExpiredStatus(status) && (
          <div className="mb-4">
            <p className="text-xs text-amber-200 font-sans mb-3">
              The deposit window expired. Create a new order — the old address is now invalid.
            </p>
            <button
              onClick={() => { reset(); setStep('form'); }}
              className="w-full py-3 rounded-xl bg-amber-500/20 border border-amber-500/40 text-amber-200 font-cabin font-semibold text-sm hover:bg-amber-500/30 transition-all"
            >
              Start New Off-Ramp Order
            </button>
          </div>
        )}

        {/* Error state */}
        {status === 'error' && error && (
          <div className="bg-red-500/15 border border-red-500/40 rounded-xl px-4 py-3 mb-5 text-xs text-red-300 font-sans">
            {error}
          </div>
        )}

        {/* Actions */}
        <div className="flex flex-col sm:flex-row gap-3">
          {!isTerminalStatus(status) && !isExpiredStatus(status) && (
            <button
              onClick={pollOnce}
              className="flex-1 py-2.5 px-4 rounded-xl bg-purple-500/15 border border-purple-400/30 text-purple-200 font-cabin font-semibold text-sm hover:bg-purple-500/25 transition-all"
            >
              Refresh Status
            </button>
          )}
          <button
            onClick={onDone}
            className="flex-1 py-2.5 px-4 rounded-xl bg-white/5 hover:bg-white/10 text-white/70 font-cabin text-sm border border-white/10 transition-all"
          >
            {status === 'settled' ? 'Done ✓' : 'Back to Dashboard'}
          </button>
        </div>

        <p className="mt-4 text-center text-[11px] text-white/35 font-sans">
          Powered by Paycrest · Funds held by Paycrest until delivery · GoodCash is non-custodial
        </p>
      </div>
    );
  }

  // Fallback / loading
  return (
    <div className="glass-panel rounded-2xl p-8 text-center text-white/60 font-sans">
      Loading…
    </div>
  );
};
