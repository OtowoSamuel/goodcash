import { ONE_TAP_ENABLED, celoText, networkFeeMessage, type NetworkFeeInfo } from '../lib/router';
import React, { useState } from 'react';
import type { BankDetailsState } from '../lib/useBankDetails';
import { BankDetailsModal, type SavedBank } from '../components/BankDetailsModal';
import { formatNaira, getCashoutRate } from '../lib/rate';
import { StepBar, CASH_OUT_STEPS } from './StepBar';

export interface MobileReviewViewProps {
  amountG: number | null;
  nairaEstimate: number | null;
  usdtEstimate: number | null;
  /** True when one tap does everything (the one-tap router is on and open). */
  oneTap?: boolean;
  /** The network fee for this cash out and whether the wallet can pay it (null while unknown). */
  networkFee?: NetworkFeeInfo | null;
  /** Naira per dollar, to show the fee in naira. */
  ngnPerUsd?: number | null;
  onBack: () => void;
  onConfirm: () => void | Promise<void>;
  errorMessage?: string | null;
  activeCashOutAmount?: string;
  setActiveCashOutAmount?: (amount: string) => void;
  savedBankDetails?: BankDetailsState | null;
  setSavedBankDetails?: (details: BankDetailsState | null) => void;
  onBankSaved?: (bank: SavedBank | null) => void;
}

export const MobileReviewView: React.FC<MobileReviewViewProps> = ({
  amountG,
  nairaEstimate,
  usdtEstimate,
  oneTap,
  networkFee,
  ngnPerUsd,
  onBack,
  onConfirm,
  onBankSaved,
  errorMessage,
}) => {
  const [busy, setBusy] = useState(false);
  const feeShort = !!networkFee && !networkFee.enough;
  const feeNaira = networkFee?.celoUsd && ngnPerUsd ? Math.max(1, Math.ceil(networkFee.feeCelo * networkFee.celoUsd * ngnPerUsd)) : null;
  const feeText = !networkFee ? 'checking…' : feeNaira ? `about ₦${feeNaira.toLocaleString('en-US')} (${celoText(networkFee.feeCelo)} CELO)` : `about ${celoText(networkFee.feeCelo)} CELO`;
  const exitContributionG = amountG != null ? getCashoutRate(amountG).exitContributionG : 0;
  const [bank, setBank] = useState<SavedBank | null>(null);
  const [isBankModalOpen, setIsBankModalOpen] = useState(false);

  const displayBankName = bank
    ? `${bank.bankName} •••• ${bank.accountNumber.slice(-4)}`
    : 'Your bank account';

  const handleBankSaved = (b: SavedBank) => {
    setBank(b);
    onBankSaved?.(b);
  };

  const nairaStr = nairaEstimate != null ? formatNaira(nairaEstimate) : '₦ -';
  const usdtStr = usdtEstimate != null ? `$${usdtEstimate.toFixed(2)}` : '—';
  const amountStr = amountG != null ? `${amountG.toLocaleString()} G$` : '— G$';

  return (
    <div className="gc fixed inset-0 z-40 flex flex-col overflow-y-auto">
      <div className="gc-col" style={{ padding: '14px 14px 96px', gap: '10px' }}>
        {/* Header */}
        <header className="gc-top relative">
          <button
            type="button"
            onClick={onBack}
            aria-label="Back"
            className="gc-back"
          >
            ‹
          </button>
          <span
            className="gc-title"
            style={{ position: 'absolute', left: '50%', transform: 'translateX(-50%)' }}
          >
            Review
          </span>
          <div style={{ width: '34px' }} />
        </header>

        <StepBar steps={CASH_OUT_STEPS} at={1} />

        {/* Top Card: YOU GET ABOUT */}
        <div className="gc-card">
          <div className="gc-lab">You get about</div>
          <div className="gc-big">{nairaStr}</div>
          <div className="gc-sm">
            for {amountStr} · at least {usdtStr}
          </div>
        </div>

        {/* Second Card: PAID TO */}
        <div className="gc-card gc-row">
          <div>
            <div className="gc-lab">Paid to</div>
            <div className="gc-sm">{displayBankName}</div>
            {bank && <div className="gc-sm" style={{ color: '#333' }}>{bank.accountName}</div>}
          </div>
          {bank ? (
            <button
              type="button"
              className="gc-pill gc-pill--white gc-hit"
              onClick={() => setIsBankModalOpen(true)}
            >
              Edit
            </button>
          ) : (
            <button
              type="button"
              className="gc-pill gc-hit"
              onClick={() => setIsBankModalOpen(true)}
            >
              Add ›
            </button>
          )}
        </div>

        {/* Third Card: Breakdown */}
        <div className="gc-card gc-cost">
          <div className="gc-row">
            <span>GoodDollar contribution (10%)</span>
            <span className="gc-mark">−{Math.floor(exitContributionG)} G$</span>
          </div>
          <div className="gc-row">
            <span>Network fee (paid in CELO, not G$)</span>
            <span>{feeText}</span>
          </div>
          <div className="gc-row">
            <span>Price protection</span>
            <span>1%</span>
          </div>
        </div>

        {errorMessage && (
          <div className="gc-note" role="alert" style={{ background: '#ff9b9b', overflowWrap: 'anywhere' }}>
            {errorMessage}
          </div>
        )}
      </div>

      {/* Bottom Action Button */}
      <div
        className="fixed left-0 right-0 bottom-0 px-[14px] pb-[14px]"
        style={{ paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 14px)' }}
      >
        {feeShort && (
          <div className="gc-note" style={{ marginBottom: 10, background: '#fff3c4' }} role="alert">
            <b>You can't send this yet.</b> {networkFeeMessage(networkFee ?? null, ngnPerUsd)}
          </div>
        )}
        <div className="gc-note" style={{ marginBottom: 10 }}>
          {(oneTap ?? ONE_TAP_ENABLED) ? (
            <><b>You'll confirm once in your wallet.</b> Open your wallet app, tap Confirm, then come back here.</>
          ) : (
            <><b>You'll confirm in your wallet up to 3 times.</b> Each time, open your wallet app, tap Confirm, then come back here.</>
          )}{' '}
          The price refreshes while you review. Arrival time depends on the payout partner.
        </div>
        <button
          type="button"
          onClick={async () => {
            setBusy(true);
            try {
              await onConfirm();
            } finally {
              setBusy(false);
            }
          }}
          disabled={!bank || busy || feeShort}
          className={`gc-btn gc-hit ${bank && !busy && !feeShort ? '' : 'gc-btn--dis'}`}
        >
          {!bank ? 'Add bank to continue' : feeShort ? 'Top up CELO first' : busy ? 'Working on it…' : 'Confirm cash out'}
        </button>
      </div>

      {/* Bank Details Modal */}
      {isBankModalOpen && (
        <BankDetailsModal
          isOpen={isBankModalOpen}
          onClose={() => setIsBankModalOpen(false)}
          onSave={handleBankSaved}
        />
      )}
    </div>
  );
};

export default MobileReviewView;
