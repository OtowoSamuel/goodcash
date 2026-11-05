import React, { useState, useEffect } from 'react';
import type { Language } from '../lib/i18n';
import { getNetQuote, type QuoteResult, MAX_PRICE_IMPACT_BPS } from '../lib/quote';
import { fetchPaycrestRate, getCashoutRate } from '../lib/rate';
import { useBankAccountVerification } from '../lib/useOffRamp';

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

export const CashOutCard: React.FC<CashOutCardProps> = ({ balanceG, onInitiateCashOut, language: _language, ngnPerUsdt: initialNgnRate = null }) => {

  const [inputAmountG, setInputAmountG] = useState<string>('1000');
  const [slippagePercent, setSlippagePercent] = useState<number>(1);
  const [showDetails, setShowDetails] = useState<boolean>(false);
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
          setRateError('Rate unavailable, try again');
        }
      });

    return () => {
      isMounted = false;
    };
  }, []);

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
  const receiveNaira = Number.isFinite(rate.netNaira) ? rate.netNaira.toFixed(2) : '—';
  const canReview = isValidAmount && quote !== null && !isRateUnavailable && isBankDetailsValid;

  return (
    <div className="panel-card w-full rounded-[28px] p-5 pb-28 sm:p-6">
      <div className="mb-5 flex items-center justify-between gap-3">
        <div>
          <p className="text-[11px] uppercase tracking-[0.14em] text-[#A39BBE]">Cash Out</p>
          <h2 className="mt-1 text-2xl font-semibold text-white">G$ to NGN</h2>
        </div>
        <div className="inline-flex items-center gap-2 rounded-full border border-[#2D204A] bg-[#120D1D] px-2.5 py-1 text-[11px] font-medium text-[#C4B5FD]">
          <span className="h-2 w-2 rounded-full bg-[#10B981]" />
          Quote refreshes in {secondsRemaining}s
        </div>
      </div>

      <div className="rounded-2xl border border-[#2D204A] bg-[#120D1D] p-4">
        <div className="mb-3 flex items-center justify-between text-[11px] uppercase tracking-[0.12em] text-[#A39BBE]">
          <span>G$ amount</span>
          <span>Balance {balanceG.toLocaleString()} G$</span>
        </div>

        <div className="flex items-center gap-3">
          <input
            type="number"
            min="1"
            value={inputAmountG}
            onChange={(e) => setInputAmountG(e.target.value)}
            placeholder="0"
            className="w-full bg-transparent text-4xl font-semibold tracking-[-0.05em] text-white outline-none placeholder:text-[#A39BBE]"
          />
          <div className="rounded-xl border border-[#2D204A] bg-[#1B122E] px-3 py-2 text-base font-semibold text-[#E5E7EB]">G$</div>
        </div>

        <div className="mt-4 grid grid-cols-4 gap-2">
          {[25, 50, 75, 100].map((pct) => (
            <button
              key={pct}
              type="button"
              onClick={() => handleQuickPercent(pct)}
              className="rounded-xl border border-[#2D204A] bg-[#1B122E] px-2 py-2 text-xs font-medium text-[#E5E7EB] transition hover:border-[#7C3AED]/60"
            >
              {pct}%
            </button>
          ))}
        </div>
      </div>

      <div className="mt-5 rounded-2xl border border-[#2D204A] bg-gradient-to-br from-[#1B122E] to-[#120D1D] p-5">
        <p className="text-[11px] uppercase tracking-[0.14em] text-[#A39BBE]">You receive about</p>
        <div className="mt-3 text-[42px] font-bold tracking-[-0.06em] text-[#10B981]">{Number.isFinite(rate.netNaira) ? `₦${receiveNaira}` : '—'}</div>
        <p className="mt-2 text-xs text-[#A39BBE]">
          {rateError ?? 'Estimate. Final amount is set by our payout partner when the order is created.'}
        </p>
      </div>

      <div className="mt-5 rounded-2xl border border-[#2D204A] bg-[#120D1D] p-4">
        <div className="flex items-center justify-between gap-3 border-b border-[#2D204A] pb-3 text-sm text-[#E5E7EB]">
          <span>Bank</span>
          <select
            aria-label="Bank name"
            value={institutionCode}
            onChange={(e) => setInstitutionCode(e.target.value)}
            disabled={institutionsLoading}
            className="rounded-xl border border-[#2D204A] bg-[#1B122E] px-3 py-2 text-sm text-[#E5E7EB] outline-none"
          >
            <option value="">{institutionsLoading ? 'Loading banks…' : 'Select bank'}</option>
            {institutions.map((bank) => (
              <option key={bank.code} value={bank.code}>{bank.name}</option>
            ))}
          </select>
        </div>

        <div className="mt-3 space-y-2">
          <label className="block text-[11px] uppercase tracking-[0.12em] text-[#A39BBE]">Account number</label>
          <input
            type="text"
            inputMode="numeric"
            value={accountIdentifier}
            onChange={(e) => setAccountIdentifier(e.target.value)}
            placeholder="10-digit account number"
            className="w-full rounded-xl border border-[#2D204A] bg-[#1B122E] px-3 py-3 text-base text-white outline-none placeholder:text-[#A39BBE]"
          />
        </div>

        <div className="mt-3 space-y-2">
          <label className="block text-[11px] uppercase tracking-[0.12em] text-[#A39BBE]">Account name</label>
          <div className="min-h-[48px] rounded-xl border border-[#2D204A] bg-[#1B122E] px-3 py-3 text-base text-white">
            {verificationStatus === 'loading' && <span className="text-[#A39BBE]">Verifying with Paycrest…</span>}
            {verificationStatus === 'idle' && <span className="text-[#A39BBE]">Enter a 10-digit account number</span>}
            {verificationStatus === 'error' && <span className="text-[#FCA5A5]">{verificationError}</span>}
            {verificationStatus === 'verified' && accountName && <span className="font-semibold">{accountName}</span>}
          </div>
          {verificationStatus === 'verified' && accountName && (
            <label className="flex items-start gap-2 text-xs text-[#D9D0F4]">
              <input
                type="checkbox"
                checked={confirmed}
                onChange={(e) => setConfirmed(e.target.checked)}
                className="mt-0.5 h-4 w-4 accent-[#7C3AED]"
              />
              I confirm this is my account name
            </label>
          )}
          {institutionsError && <p className="text-xs text-[#FCA5A5]">{institutionsError}</p>}
        </div>

        <div className="mt-4 flex items-center justify-between border-t border-[#2D204A] pt-3 text-sm text-[#E5E7EB]">
          <span>Exit contribution</span>
          <div className="flex items-center gap-2">
            <span className="font-semibold text-[#FCA5A5]">−{exitContributionG.toFixed(0)} G$</span>
            <button type="button" className="text-xs font-medium text-[#C4B5FD] underline underline-offset-4">
              Why the 10%?
            </button>
          </div>
        </div>

        <div className="mt-3 flex items-center justify-between text-sm text-[#E5E7EB]">
          <span>Price protection</span>
          <button
            type="button"
            onClick={() => setShowDetails((prev) => !prev)}
            className="font-semibold text-[#C4B5FD] underline underline-offset-4"
          >
            {showDetails ? 'Hide details' : 'Details'}
          </button>
        </div>

        {showDetails && (
          <div className="mt-3 space-y-2 rounded-xl border border-[#2D204A] bg-[#1B122E] p-3 text-xs text-[#D9D0F4]">
            <div className="flex items-center justify-between">
              <span>Slippage</span>
              <span className="font-mono text-white">{slippagePercent}%</span>
            </div>
            <div className="flex items-center justify-between">
              <span>Route</span>
              <span className="font-mono text-white">Reserve → USDT</span>
            </div>
            <div className="flex items-center justify-between">
              <span>Deadline</span>
              <span className="font-mono text-white">300s</span>
            </div>
            <div className="flex items-center gap-2 pt-2">
              {[1, 2, 3].map((val) => (
                <button
                  key={val}
                  type="button"
                  onClick={() => setSlippagePercent(val)}
                  className={`rounded-lg px-2 py-1 text-[10px] font-semibold ${
                    slippagePercent === val ? 'bg-[#7C3AED] text-white' : 'bg-[#1B122E] text-[#A39BBE]'
                  }`}
                >
                  {val}%
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {isHighImpact && (
        <div className="mt-5 rounded-2xl border border-[#F87171]/40 bg-[#7F1D1D]/20 p-3 text-sm text-[#FECACA]">
          Price impact is too high for this trade. Please lower the amount or wait for better liquidity.
        </div>
      )}

      {isOverBalance && (
        <div className="mt-5 rounded-2xl border border-[#FBBF24]/40 bg-[#78350F]/20 p-3 text-sm text-[#FDE68A]">
          Amount exceeds your available G$ balance.
        </div>
      )}

      {isBelowMinimum && amountNumber > 0 && (
        <div className="mt-5 rounded-2xl border border-[#FBBF24]/40 bg-[#4A3410]/20 p-3 text-sm text-[#FDE68A]">
          Need about {rate.remainingG.toFixed(0)} more G$ ({rate.daysToMinimum || 1} days of claiming).
        </div>
      )}

      <div className="pointer-events-none fixed inset-x-0 bottom-[72px] z-20 flex justify-center px-4">
        <div className="pointer-events-auto w-full max-w-[420px] rounded-t-3xl border border-[#2D204A] bg-[#120D1D]/95 px-4 pb-4 pt-3 shadow-[0_-16px_32px_rgba(8,3,17,0.55)] backdrop-blur-md">
          <button
            type="button"
            onClick={() =>
              quote &&
              onInitiateCashOut(quote, amountNumber, slippageBps, bankName, accountIdentifier, accountName ?? '', ngnPerUsdt, institutionCode)
            }
            disabled={!canReview}
            className={`w-full rounded-2xl px-4 py-3.5 text-base font-semibold transition ${
              canReview ? 'bg-[#7C3AED] text-white shadow-[0_20px_34px_rgba(124,58,237,0.22)] hover:bg-[#8B5CF6]' : 'cursor-not-allowed border border-[#2D204A] bg-[#1B122E] text-[#A39BBE]'
            }`}
          >
            {rateError ? 'Rate unavailable, try again' : 'Review cash out'}
          </button>
        </div>
      </div>
    </div>
  );
};
