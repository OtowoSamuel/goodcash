import React, { useState } from 'react';
import { useBankDetails } from '../lib/useBankDetails';
import type { BankDetailsState } from '../lib/useBankDetails';
import { BankDetailsModal } from '../components/BankDetailsModal';

export interface MobileReviewViewProps {
  amountG: number;
  nairaEstimate: number;
  usdtEstimate: number;
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
  const exitContributionG = Math.floor(amountG * 0.1);
  const {
    bankDetails,
    setBankDetails,
    clearBankDetails,
    isValid,
  } = useBankDetails();

  const [isBankModalOpen, setIsBankModalOpen] = useState(false);

  const displayBankName = bankDetails.bankName
    ? bankDetails.bankName
    : 'Your bank account';

  return (
    <div className="fixed inset-0 bg-[#d4c5fb] z-40 flex flex-col pt-6 px-4">
      {/* Header */}
      <header className="flex items-center justify-between mb-6 relative">
        <button
          type="button"
          onClick={onBack}
          aria-label="Back"
          className="bg-white border-2 border-[#111] rounded-xl w-10 h-10 flex items-center justify-center shadow-[2px_2px_0px_#111] font-black text-2xl pb-0.5 z-10"
        >
          ‹
        </button>
        <span className="text-2xl font-black absolute left-1/2 -translate-x-1/2 text-[#111]">
          Review
        </span>
        <div className="w-10" />
      </header>

      {/* Content */}
      <div className="flex-1 flex flex-col gap-3 pb-24 overflow-y-auto">
        {/* Top Card: YOU GET ABOUT */}
        <div className="bg-white border-2 border-[#111] rounded-2xl p-5 shadow-[4px_4px_0px_#111]">
          <div className="font-extrabold text-xs tracking-wide text-[#111] mb-2">
            YOU GET ABOUT
          </div>
          <div className="gc-big text-[#111] mb-2">
            ₦{Math.round(nairaEstimate).toLocaleString()}
          </div>
          <div className="text-sm font-medium text-[#666]">
            for {amountG.toLocaleString()} G$ · at least {usdtEstimate.toFixed(4)} USDT
          </div>
        </div>

        {/* Second Card: PAID TO */}
        <div className="bg-white border-2 border-[#111] rounded-2xl p-5 shadow-[4px_4px_0px_#111] flex items-center justify-between">
          <div>
            <div className="font-extrabold text-xs tracking-wide text-[#111] mb-1">
              PAID TO
            </div>
            <div className="text-sm font-medium text-[#111]">
              {displayBankName}
            </div>
          </div>
          {bankDetails.bankName ? (
            <>
              <button
                type="button"
                className="bg-white border-2 border-[#111] rounded-full px-4 py-1.5 font-bold text-sm text-[#111] shadow-[2px_2px_0px_#111] hover:translate-x-0.5 hover:translate-y-0.5 hover:shadow-none transition-all"
                onClick={clearBankDetails}
              >
                Edit
              </button>
            </>
          ) : (
            <button
              type="button"
              className="bg-white border-2 border-[#111] rounded-full px-4 py-1.5 font-bold text-sm text-[#111] shadow-[2px_2px_0px_#111] hover:translate-x-0.5 hover:translate-y-0.5 hover:shadow-none transition-all"
              onClick={() => setIsBankModalOpen(true)}
            >
              Add ›
            </button>
          )}
        </div>

        {/* Third Card: Breakdown */}
        <div className="bg-white border-2 border-[#111] rounded-2xl p-5 shadow-[4px_4px_0px_#111] flex flex-col">
          {/* Row 1: GoodDollar contribution */}
          <div className="flex justify-between items-center py-2.5 border-b-2 border-dashed border-gray-300">
            <span className="text-sm font-medium text-[#111]">
              GoodDollar contribution (10%)
            </span>
            <div className="bg-[#ffd23f] border-2 border-[#111] rounded-lg px-2.5 py-1 text-center font-bold text-xs leading-tight flex flex-col justify-center">
              <span>−{exitContributionG}</span>
              <span>G$</span>
            </div>
          </div>

          {/* Row 2: Network fee */}
          <div className="flex justify-between items-center py-2.5 border-b-2 border-dashed border-gray-300">
            <span className="text-sm font-medium text-[#111]">Network fee</span>
            <span className="text-sm font-medium text-[#111]">under $0.001</span>
          </div>

          {/* Row 3: Price protection */}
          <div className="flex justify-between items-center pt-2.5">
            <span className="text-sm font-medium text-[#111]">Price protection</span>
            <span className="text-sm font-medium text-[#111]">1%</span>
          </div>
        </div>

        {/* Fourth Card: Notice Box */}
        <div className="bg-white border-2 border-[#111] rounded-2xl p-5 shadow-[4px_4px_0px_#111]">
          <p className="text-sm font-medium text-[#111]">
            Quote refreshes in 18s. Arrival time depends on the payout partner.
          </p>
        </div>
      </div>

      {/* Bottom Action Button */}
      <div className="fixed bottom-6 left-4 right-4">
        <button
          type="button"
          onClick={onConfirm}
          className="gc-btn gc-btn--primary w-full py-4 text-xl font-black text-white bg-[#7b39fc] hover:bg-[#8b4aff] border-2 border-[#111] rounded-2xl shadow-[4px_4px_0px_#111] active:translate-x-0.5 active:translate-y-0.5 active:shadow-none transition-all"
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