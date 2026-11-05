import React, { useState, useEffect } from 'react';
import type { Language } from '../lib/i18n';
import { getTranslations } from '../lib/i18n';
import { getNetQuote, type QuoteResult, MAX_PRICE_IMPACT_BPS } from '../lib/quote';
import { fetchPaycrestRate, getCashoutRate, formatNaira, MIN_NET_USDT_REQUIRED } from '../lib/rate';
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

export const CashOutCard: React.FC<CashOutCardProps> = ({
  balanceG,
  onInitiateCashOut,
  language,
  ngnPerUsdt: initialNgnRate = null,
}) => {
  const t = getTranslations(language);

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
        <div className="row">
          <span className="lab">{t.youGiveG}</span>
          <span className="pill gc-hit gc-pill--white focus-visible:outline focus-visible:outline-3 focus-visible:outline-black focus-visible:outline-offset-2">
            Balance {balanceG.toLocaleString()} G$
          </span>
        </div>
        <div className="row" style={{ marginTop: '4px' }}>
          <input
            type="number"
            min="1"
            value={inputAmountG}
            onChange={(e) => setInputAmountG(e.target.value)}
            placeholder="0"
            className="big font-semibold tracking-[-0.05em] text-[#111] bg-transparent outline-none w-auto"
          />
          <span className="pill gc-hit gc-pill--yellow focus-visible:outline focus-visible:outline-3 focus-visible:outline-black focus-visible:outline-offset-2">
            G$
          </span>
        </div>
        <div className="chips">
          {[25, 50, 75, 100].map((pct) => (
            <span
              key={pct}
              className={`pill gc-hit ${slippagePercent === pct ? 'pill--on' : 'pill--white'} focus-visible:outline focus-visible:outline-3 focus-visible:outline-black focus-visible:outline-offset-2`}
              onClick={() => handleQuickPercent(pct)}
            >
              {pct === 100 ? t.maxButton : `${pct}%`}
            </span>
          ))}
        </div>
      </div>

      {/* YOU RECEIVE ABOUT Card */}
      <div className="gc-card gc-card--mint">
        <div className="lab">{t.youReceiveAbout}</div>
        <div className="row">
          <div className="big">
            {Number.isFinite(rate.netNaira) ? formatNaira(rate.netNaira) : t.nairaUnavailable}
          </div>
          <span className="pill gc-hit gc-pill--white focus-visible:outline focus-visible:outline-3 focus-visible:outline-black focus-visible:outline-offset-2">
            NGN
          </span>
        </div>
        <div className="sm" style={{ marginTop: '2px' }}>
          {t.estimateFinalAmountNote}
        </div>
        {rateError && <div className="sm mt-2 text-[#FCA5A5]">{rateError}</div>}
      </div>

      {/* PRICE PROTECTION Card */}
      <div className="gc-card">
        <span className="lab">{t.priceProtection}</span>
        <div style={{ display: 'flex', gap: 6 }}>
          {[1, 2, 3].map((val) => (
            <button
              key={val}
              type="button"
              className={`pill gc-hit ${slippagePercent === val ? 'pill--on border-[#7C3AED]' : 'pill--white'} focus-visible:outline focus-visible:outline-3 focus-visible:outline-black focus-visible:outline-offset-2`}
              onClick={() => setSlippagePercent(val)}
            >
              {val}%
            </button>
          ))}
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
        className={`gc-btn gc-btn--primary w-full mt-4 ${canReview ? '' : 'opacity-50 cursor-not-allowed'}`}
      >
        {rateError ? t.rateUnavailableTryAgain : t.reviewCashOut}
      </button>
    </>
  );
};
