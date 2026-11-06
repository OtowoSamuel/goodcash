import React, { useState, useEffect } from 'react';
import type { Language } from '../lib/i18n';
import { getTranslations } from '../lib/i18n';
import { getNetQuote, type QuoteResult, MAX_PRICE_IMPACT_BPS } from '../lib/quote';
import { fetchPaycrestRate, getCashoutRate, formatNaira } from '../lib/rate';
import { IS_DEMO_MODE } from '../lib/router';
import type { BankDetailsState } from '../lib/useBankDetails';
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
  activeCashOutAmount?: string;
  setActiveCashOutAmount?: (amount: string) => void;
  savedBankDetails?: BankDetailsState | null;
  setSavedBankDetails?: (details: BankDetailsState | null) => void;
}

export const CashOutCard: React.FC<CashOutCardProps> = ({
  balanceG,
  onInitiateCashOut,
  language,
  ngnPerUsdt: initialNgnRate = null,
}) => {
  const t = getTranslations(language);

  const [inputAmountG, setInputAmountG] = useState<string>('1000');
  const [quickPercent, setQuickPercent] = useState<number | null>(null);
  const [slippagePercent, setSlippagePercent] = useState<number>(1);
  const [quote, setQuote] = useState<QuoteResult | null>(null);
  const [secondsRemaining, setSecondsRemaining] = useState<number>(30);
  const [ngnPerUsdt, setNgnPerUsdt] = useState<number | null>(initialNgnRate);
  const [rateError, setRateError] = useState<string | null>(null);
  const [showBankDetails, setShowBankDetails] = useState<boolean>(false);

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
    setQuickPercent(pct);
  };

  const amountNumber = parseFloat(inputAmountG.replace(/,/g, '')) || 0;
  const rate = getCashoutRate(amountNumber, 123.48, ngnPerUsdt);
  const isHighImpact = quote ? quote.priceImpactBps > MAX_PRICE_IMPACT_BPS : false;
  const isOverBalance = amountNumber > balanceG;
  const isBelowMinimum = !rate.minimumReached && !IS_DEMO_MODE;
  const isRateUnavailable = rate.rateUnavailable || Boolean(rateError);
  const isValidAmount = amountNumber > 0 && !isOverBalance && !isHighImpact && !isBelowMinimum && !isRateUnavailable;

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
        <div className="gc-row">
          <span className="gc-lab">{t.youGiveG}</span>
          <span className="gc-pill gc-pill--white">
            Balance {balanceG.toLocaleString()} G$
          </span>
        </div>
        <div className="gc-row" style={{ marginTop: '4px' }}>
          <input
            type="text"
            inputMode="decimal"
            min="1"
            value={inputAmountG}
            onChange={(e) => {
              const rawValue = e.target.value.replace(/[^0-9]/g, '');
              const numericValue = parseInt(rawValue, 10) || 0;
              setQuickPercent(null);
              setInputAmountG(numericValue.toLocaleString('en-US'));
            }}
            placeholder="0"
            className="gc-big"
            style={{
              width: '100%',
              minWidth: 0,
              flex: 1,
              background: 'transparent',
              border: 'none',
              outline: 'none',
              padding: 0,
            }}
          />
          <span className="gc-pill gc-pill--yellow">G$</span>
        </div>
        <div className="gc-chips">
          {[25, 50, 75, 100].map((pct) => (
            <button
              key={pct}
              type="button"
              className={`gc-pill gc-hit ${quickPercent === pct ? 'gc-pill--on' : 'gc-pill--white'}`}
              onClick={() => handleQuickPercent(pct)}
            >
              {pct === 100 ? t.maxButton : `${pct}%`}
            </button>
          ))}
        </div>
      </div>

      {/* YOU RECEIVE ABOUT Card */}
      <div className="gc-card gc-card--mint">
        <span className="gc-lab">{t.youReceiveAbout}</span>
        <div className="gc-row">
          <div className="gc-big">
            {Number.isFinite(rate.netNaira) ? formatNaira(rate.netNaira) : t.nairaUnavailable}
          </div>
          <span className="gc-pill gc-pill--white">NGN</span>
        </div>
        <div className="gc-sm" style={{ marginTop: '2px' }}>{t.estimateFinalAmountNote}</div>
        {rateError && (
          <div className="gc-sm" style={{ color: '#b91c1c', marginTop: '2px' }}>
            {rateError}
          </div>
        )}
      </div>

      {/* PRICE PROTECTION Card */}
      <div className="gc-card">
        <div className="gc-row">
          <span className="gc-lab">{t.priceProtection}</span>
          <div style={{ display: 'flex', gap: '6px' }}>
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
        <div className="gc-sm" style={{ marginTop: '6px', color: '#333' }}>
          Quote refreshes in {secondsRemaining}s
        </div>
      </div>

      {/* Review CTA — opens bank details */}
      {!showBankDetails && (
        <button
          type="button"
          onClick={() => setShowBankDetails(true)}
          className="gc-btn gc-hit w-full"
        >
          Review
        </button>
      )}

      {/* Bank Details — revealed by the Review CTA */}
      <div className={`gc-card ${showBankDetails ? '' : 'hidden'}`}>
        <div className="gc-row" style={{ marginBottom: '8px' }}>
          <span className="gc-lab">Bank details</span>
          <label className="gc-sm" htmlFor="bank-select">
            Bank
          </label>
          <select
            id="bank-select"
            aria-label="Bank name"
            value={institutionCode}
            onChange={(e) => setInstitutionCode(e.target.value)}
            disabled={institutionsLoading}
            className="rounded-xl border-2 border-[#111] bg-white px-3 py-2 text-sm text-[#111] outline-none"
          >
            <option value="">{institutionsLoading ? 'Loading banks…' : 'Select bank'}</option>
            {institutions.map((bank) => (
              <option key={bank.code} value={bank.code}>{bank.name}</option>
            ))}
          </select>
        </div>
        <div style={{ marginTop: '12px' }}>
          <label className="gc-lab" htmlFor="account-number">Account number</label>
          <input
            id="account-number"
            type="text"
            inputMode="numeric"
            value={accountIdentifier}
            onChange={(e) => setAccountIdentifier(e.target.value)}
            placeholder="10-digit account number"
            className="w-full rounded-xl border-2 border-[#111] bg-white px-3 py-3 text-base text-[#111] outline-none placeholder:text-[#666]"
            style={{ marginTop: '4px' }}
          />
        </div>
        <div style={{ marginTop: '12px' }}>
          <label className="gc-lab">Account name</label>
          <div
            className="min-h-[48px] rounded-xl border-2 border-[#111] bg-white px-3 py-3 text-base text-[#111]"
            style={{ marginTop: '4px' }}
          >
            {verificationStatus === 'loading' && <span className="text-[#666]">Verifying with Paycrest…</span>}
            {verificationStatus === 'idle' && <span className="text-[#666]">Enter a 10-digit account number</span>}
            {verificationStatus === 'error' && <span className="text-[#b91c1c]">{verificationError}</span>}
            {verificationStatus === 'verified' && accountName && <span className="font-semibold">{accountName}</span>}
          </div>
          {verificationStatus === 'verified' && accountName && (
            <label className="gc-sm" style={{ display: 'flex', alignItems: 'flex-start', gap: '8px', marginTop: '8px' }}>
              <input
                type="checkbox"
                name="confirmAccountName"
                value="yes"
                checked={confirmed}
                onChange={(e) => setConfirmed(e.target.checked)}
                className="mt-0.5 h-4 w-4 accent-[#7b39fc]"
              />
              I confirm this is my account name
            </label>
          )}
          {institutionsError && <p className="gc-sm" style={{ color: '#b91c1c' }}>{institutionsError}</p>}
        </div>
        <div className="gc-row" style={{ marginTop: '12px', borderTop: '2px dashed #cfc3ee', paddingTop: '10px' }}>
          <span className="gc-sm">Exit contribution</span>
          <span className="gc-pill gc-pill--yellow">−{rate.exitContributionG.toFixed(0)} G$</span>
        </div>
      </div>

      {/* Final action — submits the cash out for review */}
      <button
        type="button"
        onClick={() => {
          if (!quote || !canReview) return;
          onInitiateCashOut(
            quote,
            amountNumber,
            slippageBps,
            selectedInstitution?.name ?? '',
            accountIdentifier,
            accountName ?? undefined,
            ngnPerUsdt,
            institutionCode
          );
        }}
        disabled={!canReview}
        aria-label="Review cash out"
        className={showBankDetails ? `gc-btn gc-hit w-full ${!canReview ? 'gc-btn--dis' : ''}` : 'hidden'}
      >
        Review cash out
      </button>
    </>
  );
};