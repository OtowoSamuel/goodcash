import React, { useState, useEffect } from 'react';
import type { Language } from '../lib/i18n';
import { getTranslations } from '../lib/i18n';
import { getNetQuote, type QuoteResult, MAX_PRICE_IMPACT_BPS } from '../lib/quote';
import { fetchPaycrestRate, getCashoutRate, formatNaira, MIN_NET_USDT_REQUIRED } from '../lib/rate';
import { useBankDetails } from '../lib/useBankDetails';
import type { BankDetailsState } from '../lib/useBankDetails';
import { useBankAccountVerification } from '../lib/useOffRamp';
import { BankDetailsModal } from './BankDetailsModal';

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
  const [slippagePercent, setSlippagePercent] = useState<number>(1);
  const [quote, setQuote] = useState<QuoteResult | null>(null);
  const [secondsRemaining, setSecondsRemaining] = useState<number>(30);
  const [ngnPerUsdt, setNgnPerUsdt] = useState<number | null>(initialNgnRate);
  const [rateError, setRateError] = useState<string | null>(null);

  const {
    bankDetails,
    setBankDetails,
    clearBankDetails,
  } = useBankDetails();

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

  const [openBankDetailsModal, setOpenBankDetailsModal] = useState(false);

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

  const amountNumber = parseFloat(inputAmountG.replace(/,/g, '')) || 0;
  const rate = getCashoutRate(amountNumber, 123.48, ngnPerUsdt);
  const isHighImpact = quote ? quote.priceImpactBps > MAX_PRICE_IMPACT_BPS : false;
  const isOverBalance = amountNumber > balanceG;
  const isBelowMinimum = !rate.minimumReached;
  const isRateUnavailable = rate.rateUnavailable || Boolean(rateError);
  const isValidAmount = amountNumber > 0 && !isOverBalance && !isHighImpact && !isBelowMinimum && !isRateUnavailable;

  const slippageBps = slippagePercent * 100;
  const canReview = isValidAmount && quote !== null && !isRateUnavailable;

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
            type="text"
            inputMode="decimal"
            min="1"
            value={inputAmountG}
            onChange={(e) => {
              const rawValue = e.target.value.replace(/[^0-9]/g, '');
              const numericValue = parseInt(rawValue, 10) || 0;
              setInputAmountG(numericValue.toLocaleString('en-US'));
            }}
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

      {/* Bank Details Section */}
      <div className="gc-card mt-4">
        <div className="flex justify-between items-center mb-3">
          <span className="text-sm font-bold text-[#111] uppercase tracking-wider">Bank Details</span>
          <label className="hidden sm:block text-sm text-[#A39BBE]" htmlFor="bank-select">
            Bank
          </label>
          <select
            id="bank-select"
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
        {verificationStatus === 'idle' && (
          <p className="text-sm text-[#666]">
            Enter a 10-digit account number
          </p>
        )}
        {bankDetails.bankName ? (
          <div className="flex items-center gap-3">
            <span className="text-sm text-[#666] font-medium">{bankDetails.bankName}</span>
            <span className="text-sm text-[#666] font-medium">••••••••</span>
          </div>
        ) : (
          <p className="text-sm text-[#666]">
            Add your bank details to receive Naira payouts
          </p>
        )}
        {accountName && verificationStatus === 'verified' && (
          <div className="mt-3">
            <label className="flex items-center gap-2 text-sm text-[#666]">
              <input
                type="checkbox"
                name="confirmAccountName"
                value="yes"
                checked={confirmed}
                onChange={() => setConfirmed(true)}
                className="rounded border-[#2D204A] p-1"
              />
              Confirm this is my account name
            </label>
          </div>
        )}
      </div>

      {/* Review Button */}
      <button
        type="button"
        onClick={() => {
          if (!quote || !canReview) return;
          if (!bankDetails.bankName) {
            setOpenBankDetailsModal(true);
            return;
          }
          onInitiateCashOut(
            quote,
            amountNumber,
            slippageBps,
            undefined,  // bankName - will be collected in next step
            undefined,  // accountNumber
            undefined,  // accountHolderName
            ngnPerUsdt,
            undefined   // bankCode
          );
        }}
        disabled={!isValidAmount || !confirmed}
        aria-label="Review cash out"
        className={`gc-btn gc-btn--primary w-full mt-4 py-4 text-xl font-bold opacity-100 disabled:opacity-50 disabled:cursor-not-allowed`}
      >
        Review
      </button>

      {/* Bank Details Modal */}
      <BankDetailsModal
        isOpen={openBankDetailsModal}
        onClose={() => setOpenBankDetailsModal(false)}
        onSave={setBankDetails}
        initialBank={bankDetails.bankName}
        initialAccountNumber={bankDetails.accountNumber}
      />
    </>
  );
};