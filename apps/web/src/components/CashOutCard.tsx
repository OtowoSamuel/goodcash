import { BankPicker } from './BankPicker';
import React, { useState, useEffect } from 'react';
import type { Language } from '../lib/i18n';
import { getTranslations } from '../lib/i18n';
import { getNetQuote, type QuoteResult, MAX_PRICE_IMPACT_BPS } from '../lib/quote';
import { LIVE_QUOTES, getLiveNetQuote } from '../lib/liveQuote';
import { fetchPaycrestRate, getCashoutRate, formatNaira, getMinimumCashOutG, MIN_NET_USDT_REQUIRED } from '../lib/rate';
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
  onPreviewUsdtChange?: (usdt: number | null) => void;
  /** False when no wallet is connected: Review then asks the user to connect first. */
  walletConnected?: boolean;
  onConnectWallet?: () => void;
  savedBankDetails?: BankDetailsState | null;
  setSavedBankDetails?: (details: BankDetailsState | null) => void;
}

export const CashOutCard: React.FC<CashOutCardProps> = ({
  balanceG,
  onInitiateCashOut,
  language,
  ngnPerUsdt: initialNgnRate = null,
  onPreviewUsdtChange,
  walletConnected = true,
  onConnectWallet,
}) => {
  const t = getTranslations(language);

  const [inputAmountG, setInputAmountG] = useState<string>(import.meta.env.PROD ? '' : '1,000');
  const [quickPercent, setQuickPercent] = useState<number | null>(null);
  const [slippagePercent, setSlippagePercent] = useState<number>(1);
  const [quote, setQuote] = useState<QuoteResult | null>(null);
  const [secondsRemaining, setSecondsRemaining] = useState<number>(30);
  const [ngnPerUsdt, setNgnPerUsdt] = useState<number | null>(initialNgnRate);
  useEffect(() => {
    onPreviewUsdtChange?.(quote ? Number(quote.usdtOut) / 1e6 : null);
  }, [quote, onPreviewUsdtChange]);
  const [rateError, setRateError] = useState<string | null>(null);
  const [quoteTick, setQuoteTick] = useState(0);
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
          if (IS_DEMO_MODE) {
            setNgnPerUsdt(1452.6);
            setRateError(null);
          } else {
            setNgnPerUsdt(null);
            setRateError(t.rateUnavailableTryAgain);
          }
        }
      });

    return () => {
      isMounted = false;
    };
  }, [t.rateUnavailableTryAgain]);

  // Update quote when input changes (live on-chain prices in production)
  useEffect(() => {
    const rawAmount = parseFloat(inputAmountG.replace(/,/g, ''));
    if (isNaN(rawAmount) || rawAmount <= 0) {
      setQuote(null);
      return;
    }
    const amountWei = BigInt(Math.floor(rawAmount)) * 10n ** 18n;
    setSecondsRemaining(30);
    if (!LIVE_QUOTES) {
      try {
        setQuote(getNetQuote({ amountIn: amountWei }));
      } catch (err) {
        console.error('Quote calculation error:', err);
      }
      return;
    }
    let cancelled = false;
    setQuote(null);
    const debounce = setTimeout(() => {
      getLiveNetQuote(amountWei)
        .then((q) => {
          if (cancelled) return;
          setQuote(q);
          setRateError(null);
        })
        .catch(() => {
          if (cancelled) return;
          setQuote(null);
          setRateError(t.rateUnavailableTryAgain);
        });
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(debounce);
    };
  }, [inputAmountG, quoteTick, t.rateUnavailableTryAgain]);

  // Quote refresh timer: re-reads live prices every 30 seconds
  useEffect(() => {
    const timer = setInterval(() => {
      setSecondsRemaining((prev) => {
        if (prev <= 1) {
          setQuoteTick((n) => n + 1);
          return 30;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  const handleQuickPercent = (pct: number) => {
    const calculated = Math.floor((balanceG * pct) / 100);
    setInputAmountG(calculated.toLocaleString('en-US'));
    setQuickPercent(pct);
  };

  const amountNumber = parseFloat(inputAmountG.replace(/,/g, '')) || 0;
  const rate = getCashoutRate(amountNumber, 123.48, ngnPerUsdt);
  const isHighImpact = quote ? quote.priceImpactBps > MAX_PRICE_IMPACT_BPS : false;
  const isOverBalance = amountNumber > balanceG;
  const minG = getMinimumCashOutG();
  const isBelowMinimum =
    !IS_DEMO_MODE && (!rate.minimumReached || (quote !== null && Number(quote.usdtOut) / 1e6 < MIN_NET_USDT_REQUIRED));
  const isRateUnavailable = rate.rateUnavailable || Boolean(rateError);
  // Still working out the naira amount: the rate or the live price has not come back yet
  const isCalculating = amountNumber > 0 && !rateError && (ngnPerUsdt === null || (LIVE_QUOTES && quote === null));
  const isValidAmount = amountNumber > 0 && !isOverBalance && !isHighImpact && !isBelowMinimum && !isRateUnavailable;

  const isBankValid = institutionCode.trim().length > 0;
  const isAccountNumberValid = /^\d{10}$/.test(accountIdentifier);
  const isAccountHolderValid = verificationStatus === 'verified' && Boolean(accountName);
  const isBankDetailsValid = isBankValid && isAccountNumberValid && isAccountHolderValid && confirmed;
  const slippageBps = slippagePercent * 100;
  const canReview = isBankDetailsValid && quote !== null && (IS_DEMO_MODE || isValidAmount);

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
            className="gc-big relative z-10"
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
        {!IS_DEMO_MODE && (
          <div className="gc-sm" role={isBelowMinimum && amountNumber > 0 ? 'alert' : undefined} style={{ marginTop: 8, fontWeight: 700, color: isBelowMinimum && amountNumber > 0 ? '#b00020' : '#444' }}>
            Minimum cash out is about {minG.toLocaleString()} G$
          </div>
        )}
      </div>

      {/* YOU RECEIVE ABOUT Card */}
      <div className="gc-card gc-card--mint">
        <span className="gc-lab">{t.youReceiveAbout}</span>
        <div className="gc-row">
          <div className="gc-big" role="status" aria-live="polite">
            {isCalculating ? (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10, fontSize: 18 }}>
                <span className="w-5 h-5 shrink-0 rounded-full border-4 border-[#111] border-t-transparent animate-spin" aria-hidden="true" />
                Working it out…
              </span>
            ) : Number.isFinite(rate.netNaira) ? (
              formatNaira(rate.netNaira)
            ) : (
              t.nairaUnavailable
            )}
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
          onClick={() => (walletConnected ? setShowBankDetails(true) : onConnectWallet?.())}
          className="gc-btn gc-hit w-full"
        >
          {walletConnected ? 'Review' : 'Connect wallet to continue'}
        </button>
      )}

      {/* Bank Details — revealed by the Review CTA */}
      <div className={`gc-card ${showBankDetails ? '' : 'hidden'}`}>
        <div className="gc-row" style={{ marginBottom: '8px', gap: '12px' }}>
          <span className="gc-lab" style={{ whiteSpace: 'nowrap', flex: 'none' }}>Bank details</span>
          <div style={{ flex: '1 1 0', minWidth: 0 }}>
            <BankPicker banks={institutions} loading={institutionsLoading} value={institutionCode} onChange={setInstitutionCode} label="Bank" z={95} />
          </div>
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
            className="w-full rounded-xl border-2 border-[#111] bg-white px-3 py-3 text-base text-[#111] outline-none placeholder:text-[#666] relative z-10"
            style={{ marginTop: '4px' }}
          />
        </div>
        <div style={{ marginTop: '12px' }}>
          <label className="gc-lab">Account name</label>
          <div
            className="min-h-[48px] rounded-xl border-2 border-[#111] bg-white px-3 py-3 text-base text-[#111]"
            style={{ marginTop: '4px' }}
          >
            {verificationStatus === 'loading' && <span className="text-[#666]">Checking your account…</span>}
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

      {showBankDetails && !canReview && (
        <div className="gc-sm" style={{ textAlign: 'center', color: '#b91c1c' }}>
          {!isBankDetailsValid
            ? 'Complete and confirm your bank details'
            : isRateUnavailable
            ? t.rateUnavailableTryAgain
            : isOverBalance
            ? 'Amount exceeds your balance'
            : isBelowMinimum
            ? `Minimum cash out is ${minG.toLocaleString()} G$`
            : isHighImpact
            ? 'Price impact is too high'
            : 'Enter a valid amount'}
        </div>
      )}
    </>
  );
};