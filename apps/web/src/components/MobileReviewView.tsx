import React from 'react';

export interface MobileReviewViewProps {
  amountG: number;
  nairaEstimate: number;
  usdtEstimate: number;
  onBack: () => void;
  onConfirm: () => void;
}

export const MobileReviewView: React.FC<MobileReviewViewProps> = ({
  amountG,
  nairaEstimate,
  usdtEstimate,
  onBack,
  onConfirm,
}) => {
  return (
    <div className="fixed inset-0 bg-[#d4c5fb] z-40 flex flex-col pt-6 px-4">
      {/* Header */}
      <header className="flex items-center justify-between mb-6 relative">
        <button
          type="button"
          onClick={onBack}
          aria-label="Back to cash out"
          className="border-2 border-[#111] bg-white rounded-xl w-10 h-10 flex items-center justify-center shadow-[2px_2px_0px_#111] font-black text-lg z-10"
        >
          ←
        </button>
        <span className="text-2xl font-black absolute left-1/2 -translate-x-1/2 text-[#111]">
          Review
        </span>
        <div className="w-10" />
      </header>

      {/* Content */}
      <div className="flex-1 flex flex-col gap-3 mb-24">
        {/* YOU GIVE card */}
        <div className="bg-white border-2 border-[#111] rounded-2xl shadow-[4px_4px_0px_#111] p-4">
          <div className="font-extrabold text-xs tracking-wide text-[#111] mb-2">
            YOU GIVE
          </div>
          <div className="flex justify-between items-center">
            <span className="text-4xl font-black text-[#111] tabular-nums">
              {amountG.toLocaleString('en-US', { maximumFractionDigits: 2 })}
            </span>
            <span className="border-2 border-[#111] bg-[#ffd23f] rounded-full px-4 py-1.5 font-extrabold text-base text-[#111]">
              G$
            </span>
          </div>
        </div>

        {/* YOU RECEIVE ABOUT card */}
        <div className="bg-[#63f2b4] border-2 border-[#111] rounded-2xl shadow-[4px_4px_0px_#111] p-4">
          <div className="font-extrabold text-xs tracking-wide text-[#111] mb-1">
            YOU RECEIVE ABOUT
          </div>
          <div className="flex justify-between items-center">
            <span className="text-4xl font-black text-[#111]">
              ₦{Math.round(nairaEstimate).toLocaleString()}
            </span>
            <span className="border-2 border-[#111] bg-white rounded-full px-4 py-1.5 font-extrabold text-base text-[#111]">
              NGN
            </span>
          </div>
          <div className="font-bold text-sm text-[#111] mt-1">
            at least {usdtEstimate.toFixed(4)} USDT
          </div>
        </div>

        {/* What you'll pay breakdown */}
        <div className="bg-white border-2 border-[#111] rounded-2xl shadow-[4px_4px_0px_#111] p-4">
          <div className="font-extrabold text-xs tracking-wide text-[#111] mb-3">
            WHAT YOU'LL PAY
          </div>
          
          <div className="flex justify-between items-center py-2 border-b-2 border-dashed border-[#d4c5fb]">
            <span className="text-sm font-medium text-[#111]">GoodDollar contribution (10%)</span>
            <span className="bg-[#ffd23f] border-2 border-[#111] rounded-full px-3 py-0.5 font-extrabold text-sm text-[#111]">
              −{Math.floor(amountG * 0.1)} G$
            </span>
          </div>

          <div className="flex justify-between items-center py-2 border-b-2 border-dashed border-[#d4c5fb]">
            <span className="text-sm font-medium text-[#111]">Network fee</span>
            <span className="text-sm font-bold text-[#111]">under $0.001</span>
          </div>

          <div className="flex justify-between items-center pt-2">
            <span className="text-sm font-bold text-[#111]">You get at least</span>
            <span className="text-sm font-black text-[#111]">{usdtEstimate.toFixed(4)} USDT</span>
          </div>
        </div>

        {/* Route info card */}
        <div className="bg-[#eae2ff] border-2 border-[#111] rounded-2xl shadow-[4px_4px_0px_#111] p-4">
          <div className="font-extrabold text-xs tracking-wide text-[#111] mb-1">
            ROUTE
          </div>
          <div className="text-sm font-medium text-[#111]">
            GoodDollar Reserve → Uniswap V3 → Paycrest
          </div>
        </div>
      </div>

      {/* Sticky Confirm button */}
      <div className="fixed bottom-6 left-4 right-4">
        <button
          type="button"
          onClick={onConfirm}
          className="w-full py-4 text-xl font-black rounded-2xl border-2 border-[#111] shadow-[4px_4px_0px_#111] text-white bg-[#7b39fc] hover:bg-[#8b4aff] active:scale-[0.98] transition-transform"
        >
          Confirm cash out
        </button>
      </div>
    </div>
  );
};

export default MobileReviewView;
