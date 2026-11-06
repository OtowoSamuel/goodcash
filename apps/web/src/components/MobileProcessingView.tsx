import React from 'react';

interface MobileProcessingViewProps {
  amountG?: number;
  nairaEstimate?: number;
  txHash?: string;
  onClose: () => void;
  onBackToHome: () => void;
}

export const MobileProcessingView: React.FC<MobileProcessingViewProps> = ({
  amountG = 1000,
  nairaEstimate = 164,
  txHash = '0x1f73...e705',
  onClose,
  onBackToHome,
}) => {
  const displayNaira = nairaEstimate && nairaEstimate > 0 ? nairaEstimate : 164;
  const usdtEstimate = (amountG * 0.0001129).toFixed(4);

  return (
    <div className="fixed inset-0 bg-[#d4c5fb] z-40 flex flex-col md:hidden w-full h-full">
      {/* Header */}
      <header className="px-4 pt-6 pb-2 flex items-center justify-between">
        <button
          onClick={onClose}
          aria-label="Close"
          className="bg-white border-2 border-[#111] rounded-xl w-10 h-10 flex items-center justify-center shadow-[2px_2px_0px_#111] font-bold text-xl active:translate-x-0.5 active:translate-y-0.5 active:shadow-none"
        >
          ✕
        </button>
      </header>

      {/* Main Scrollable Area */}
      <div className="flex-1 overflow-y-auto px-4 flex flex-col gap-4 pb-28 pt-2">
        <div>
          <h1 className="text-4xl font-black text-[#111] mb-1">On its way</h1>
          <p className="text-sm font-semibold text-[#111]">
            We'll update this page as each step finishes.
          </p>
        </div>

        {/* Vertical Stepper Card */}
        <div className="gc-card bg-white border-2 border-[#111] rounded-2xl p-5 shadow-[4px_4px_0px_#111]">
          <div className="flex flex-col">
            
            {/* Step 1: Swapped to USDT */}
            <div className="relative flex items-start gap-3.5 pb-6">
              {/* Solid Black Line from Node 1 to Node 2 */}
              <div className="absolute left-[9px] top-[10px] bottom-[-10px] w-[2px] bg-[#111] z-0" />
              {/* Step 1 Circle */}
              <div className="w-5 h-5 rounded-full bg-[#7b39fc] border-2 border-[#111] z-10 shrink-0 mt-0.5" />
              <div className="flex-1">
                <div className="font-bold text-base text-[#111] leading-snug">Swapped to USDT</div>
                <div className="text-xs font-semibold text-gray-600 mt-0.5">
                  Done · {amountG.toLocaleString()} G$ → {usdtEstimate} USDT
                </div>
              </div>
            </div>

            {/* Step 2: Sent to payout partner */}
            <div className="relative flex items-start gap-3.5 pb-6">
              {/* Light Purple Line from Node 2 to Node 3 */}
              <div className="absolute left-[9px] top-[10px] bottom-[-10px] w-[2px] bg-[#c4b5fd] z-0" />
              {/* Step 2 Circle */}
              <div className="w-5 h-5 rounded-full bg-[#ffd23f] border-2 border-[#111] z-10 shrink-0 mt-0.5" />
              <div className="flex-1">
                <div className="font-bold text-base text-[#111] leading-snug">Sent to payout partner</div>
                <div className="text-xs font-semibold text-gray-600 mt-0.5">In progress</div>
              </div>
            </div>

            {/* Step 3: Naira in your bank */}
            <div className="relative flex items-start gap-3.5">
              {/* Step 3 Circle (No line underneath) */}
              <div className="w-5 h-5 rounded-full bg-white border-2 border-[#111] z-10 shrink-0 mt-0.5" />
              <div className="flex-1">
                <div className="font-bold text-base text-[#111] leading-snug">Naira in your bank</div>
                <div className="text-xs font-semibold text-gray-600 mt-0.5">Waiting</div>
              </div>
            </div>

          </div>
        </div>

        {/* Transaction Details Card */}
        <div className="gc-card bg-white border-2 border-[#111] rounded-2xl p-5 shadow-[4px_4px_0px_#111] flex flex-col">
          <span className="text-xs font-bold uppercase text-[#111] tracking-wider block mb-2">
            DETAILS
          </span>
          <div className="flex justify-between items-center py-3 border-b-2 border-dashed border-[#d4c5fb]">
            <span className="font-bold text-sm text-[#111]">You gave</span>
            <span className="font-bold text-sm text-[#111]">{amountG.toLocaleString()} G$</span>
          </div>
          <div className="flex justify-between items-center py-3 border-b-2 border-dashed border-[#d4c5fb]">
            <span className="font-bold text-sm text-[#111]">You get about</span>
            <span className="font-bold text-sm text-[#111]">₦{displayNaira.toLocaleString()}</span>
          </div>
          <div className="flex justify-between items-center pt-3">
            <span className="font-bold text-sm text-[#111]">Receipt</span>
            <span className="font-bold text-sm text-[#111] flex items-center gap-1">
              {txHash} ↗
            </span>
          </div>
        </div>
      </div>

      {/* Fixed Bottom Action */}
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
