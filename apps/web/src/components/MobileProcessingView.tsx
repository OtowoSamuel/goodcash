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
  const usdtAmount = (amountG * 0.0001129).toFixed(4);

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
      <div className="flex-1 overflow-y-auto px-4 flex flex-col gap-4 pb-28">
        {/* Title Area */}
        <div>
          <h1 className="text-4xl font-black text-[#111] mt-4 mb-1">On its way</h1>
          <p className="text-sm font-semibold text-[#111]">
            We'll update this page as each step finishes.
          </p>
        </div>

        {/* Vertical Stepper Card */}
        <div className="bg-white border-2 border-[#111] rounded-2xl p-5 shadow-[4px_4px_0px_#111]">
          <div className="flex flex-col gap-6 relative">
            {/* Step 1: Done */}
            <div className="relative flex items-start gap-4 pb-1">
              <div className="relative flex flex-col items-center">
                <div className="w-5 h-5 rounded-full bg-[#7b39fc] border-2 border-[#111] z-10 shrink-0" />
                {/* Connecting line from Step 1 to Step 2 (solid black) */}
                <div className="absolute left-[9px] top-5 bottom-[-24px] w-[2px] bg-[#111] z-0" />
              </div>
              <div className="flex-1 pt-0.5">
                <div className="font-bold text-base text-[#111]">Swapped to USDT</div>
                <div className="text-xs font-semibold text-gray-600">
                  Done · {amountG.toLocaleString()} G$ → {usdtAmount} USDT
                </div>
              </div>
            </div>

            {/* Step 2: In progress */}
            <div className="relative flex items-start gap-4 pb-1">
              <div className="relative flex flex-col items-center">
                <div className="w-5 h-5 rounded-full bg-[#ffd23f] border-2 border-[#111] z-10 shrink-0" />
                {/* Connecting line from Step 2 to Step 3 (light purple) */}
                <div className="absolute left-[9px] top-5 bottom-[-24px] w-[2px] bg-[#c4b5fd] z-0" />
              </div>
              <div className="flex-1 pt-0.5">
                <div className="font-bold text-base text-[#111]">Sent to payout partner</div>
                <div className="text-xs font-semibold text-gray-600">In progress</div>
              </div>
            </div>

            {/* Step 3: Waiting */}
            <div className="relative flex items-start gap-4">
              <div className="relative flex flex-col items-center">
                <div className="w-5 h-5 rounded-full bg-white border-2 border-[#111] z-10 shrink-0" />
              </div>
              <div className="flex-1 pt-0.5">
                <div className="font-bold text-base text-[#111]">Naira in your bank</div>
                <div className="text-xs font-semibold text-gray-600">Waiting</div>
              </div>
            </div>
          </div>
        </div>

        {/* Details Breakdown Card */}
        <div className="bg-white border-2 border-[#111] rounded-2xl p-5 shadow-[4px_4px_0px_#111]">
          <span className="text-xs font-bold uppercase text-[#111] tracking-wider block mb-3">
            DETAILS
          </span>
          
          {/* Row 1: You gave */}
          <div className="border-b-2 border-dashed border-[#d4c5fb] py-3 flex justify-between items-center">
            <span className="font-bold text-sm text-[#111]">You gave</span>
            <span className="font-bold text-sm text-[#111]">{amountG.toLocaleString()} G$</span>
          </div>

          {/* Row 2: You get about */}
          <div className="border-b-2 border-dashed border-[#d4c5fb] py-3 flex justify-between items-center">
            <span className="font-bold text-sm text-[#111]">You get about</span>
            <span className="font-bold text-sm text-[#111]">₦{Math.round(nairaEstimate).toLocaleString()}</span>
          </div>

          {/* Row 3: Receipt */}
          <div className="pt-3 flex justify-between items-center">
            <span className="font-bold text-sm text-[#111]">Receipt</span>
            <a
              href={`https://celoscan.io/tx/${txHash}`}
              target="_blank"
              rel="noopener noreferrer"
              className="font-bold text-sm text-[#111] flex items-center gap-1 hover:text-[#7b39fc] transition-colors"
            >
              {txHash} ↗
            </a>
          </div>
        </div>
      </div>

      {/* Sticky Bottom Action */}
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
