import React, { useState } from 'react';
import { useBankDetails } from '../lib/useBankDetails';
import type { BankDetailsState } from '../lib/useBankDetails';
import { BankDetailsModal } from '../components/BankDetailsModal';
import { formatNaira, getCashoutRate } from '../lib/rate';

export interface MobileReviewViewProps {
  amountG: number | null;
  nairaEstimate: number | null;
  usdtEstimate: number | null;
  onBack: () => void;
  onConfirm: () => void;
  activeCashOutAmount?: string;
  setActiveCashOutAmount?: (amount: string) => void;
  savedBankDetails?: BankDetailsState | null;
  setSavedBankDetails?: (details: BankDetailsState | null) => void;
}

export const MobileReviewView: React.FC<MobileReviewViewProps> = ({
  amountG,
  nairaEstimate,
  usdtEstimate,
  onBack,
  onConfirm,
}) => {
  const exitContributionG = amountG != null ? getCashoutRate(amountG).exitContributionG : 0;
  const {
    bankDetails,
    setBankDetails,
    clearBankDetails,
  } = useBankDetails();

  const [isBankModalOpen, setIsBankModalOpen] = useState(false);

  const displayBankName = bankDetails.bankName
    ? bankDetails.bankName
    : 'Your bank account';

  const nairaStr = nairaEstimate != null ? formatNaira(nairaEstimate) : '₦ -';
  const usdtStr = usdtEstimate != null ? `${usdtEstimate.toFixed(4)} USDT` : '— USDT';
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
          </div>
          {bankDetails.bankName ? (
            <button
              type="button"
              className="gc-pill gc-pill--white gc-hit"
              onClick={clearBankDetails}
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
            <span>Network fee</span>
            <span>under $0.001</span>
          </div>
          <div className="gc-row">
            <span>Price protection</span>
            <span>1%</span>
          </div>
        </div>

        {/* Fourth Card: Notice Box */}
        <div className="gc-note">
          Quote refreshes while you review. Arrival time depends on the payout partner.
        </div>
      </div>

      {/* Bottom Action Button */}
      <div
        className="fixed left-0 right-0 bottom-0 px-[14px] pb-[14px]"
        style={{ paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 14px)' }}
      >
        <button
          type="button"
          onClick={onConfirm}
          className="gc-btn gc-hit"
        >
          Confirm cash out
        </button>
      </div>

      {/* Bank Details Modal */}
      {isBankModalOpen && (
        <BankDetailsModal
          isOpen={isBankModalOpen}
          onClose={() => setIsBankModalOpen(false)}
          onSave={setBankDetails}
        />
      )}
    </div>
  );
};

export default MobileReviewView;
