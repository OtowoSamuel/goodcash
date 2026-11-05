import React from 'react';

interface MobileProcessingViewProps {
  amountG: number;
  nairaEstimate: number;
  txHash?: string;
  onClose: () => void;
  onBackToHome: () => void;
}

export const MobileProcessingView: React.FC<MobileProcessingViewProps> = ({
  amountG,
  nairaEstimate,
  txHash = '0x1f73...e705',
  onClose,
  onBackToHome,
}) => {
  return (
    <div className="fixed inset-0 bg-[#d4c5fb] z-40 flex flex-col md:hidden">
      {/* Header */}
      <header className="px-4 pt-6 pb-2">
        <button
          onClick={onClose}
          aria-label="Close"
          className="bg-white border-2 border-[#111] rounded-xl w-10 h-10 flex items-center justify-center shadow-[2px_2px_0px_#111] font-bold text-xl active:translate-x-0.5 active:translate-y-0.5 active:shadow-none"
        >
          ✕
        </button>
      </header>

      {/* Main Content */}
      <div className="flex-1 overflow-y-auto px-4 flex flex-col gap-4 pb-28 pt-2">
        <div>
          <h1 className="text-4xl font-black text-[#111] mb-1">On its way</h1>
          <p className="text-sm font-semibold text-[#111]">
            We'll update this page as each step finishes.
          </p>
        </div>

        {/* Stepper Card */}
        <div className="gc-card bg-white border-2 border-[#111] rounded-2xl p-5 shadow-[4px_4px_0px_#111]">
          <div className="relative pl-6 flex flex-col gap-6 before:content-[''] before:absolute before:left-[7px] before:top-2 before:bottom-2 before:w-[2px] before:bg-[#111]">
            {/* Step 1 */}
            <div className="relative">
              <span className="absolute -left-[23px] top-1 w-4 h-4 rounded-full bg-[#7b39fc] border-2 border-[#111] z-10" />
              <div className="font-bold text-base text-[#111]">Swapped to USDT</div>
              <div className="text-xs font-semibold text-gray-600">
                Done · {amountG.toLocaleString()} G$ → {(amountG * 0.0001129).toFixed(4)} USDT
              </div>
            </div>

            {/* Step 2 */}
            <div className="relative">
              <span className="absolute -left-[23px] top-1 w-4 h-4 rounded-full bg-[#ffd23f] border-2 border-[#111] z-10" />
              <div className="font-bold text-base text-[#111]">Sent to payout partner</div>
              <div className="text-xs font-semibold text-gray-600">In progress</div>
            </div>

            {/* Step 3 */}
            <div className="relative">
              <span className="absolute -left-[23px] top-1 w-4 h-4 rounded-full bg-white border-2 border-[#111] z-10" />
              <div className="font-bold text-base text-[#111]">Naira in your bank</div>
              <div className="text-xs font-semibold text-gray-600">Waiting</div>
            </div>
          </div>
        </div>

        {/* Details Card */}
        <div className="gc-card bg-white border-2 border-[#111] rounded-2xl p-5 shadow-[4px_4px_0px_#111] flex flex-col">
          <span className="text-xs font-bold uppercase text-[#111] tracking-wider block mb-2">
            DETAILS
          </span>
          <div className="flex justify-between items-center py-2.5 border-b-2 border-dashed border-gray-300">
            <span className="font-bold text-sm text-[#111]">You gave</span>
            <span className="font-bold text-sm text-[#111]">{amountG.toLocaleString()} G$</span>
          </div>
          <div className="flex justify-between items-center py-2.5 border-b-2 border-dashed border-gray-300">
            <span className="font-bold text-sm text-[#111]">You get about</span>
            <span className="font-bold text-sm text-[#111]">₦{nairaEstimate.toLocaleString()}</span>
          </div>
          <div className="flex justify-between items-center pt-2.5">
            <span className="font-bold text-sm text-[#111]">Receipt</span>
            <span className="font-bold text-sm text-[#111] flex items-center gap-1">
              {txHash} ↗
            </span>
          </div>
        </div>
      </div>

      {/* Sticky Action Button */}
      <div className="fixed bottom-6 left-4 right-4 z-50">
        <button
          onClick={onBackToHome}
          className="w-full bg-white border-2 border-[#111] rounded-2xl py-4 text-xl font-bold text-[#111] shadow-[4px_4px_0px_#111] active:translate-x-0.5 active:translate-y-0.5 active:shadow-none"
        >
          Back to home
        </button>
      </div>
    </div>
  );
};

export default MobileProcessingView;
