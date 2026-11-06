import React from 'react';

interface MobileSuccessViewProps {
  nairaEstimate: number;
  onClose: () => void;
  onViewTransaction: () => void;
}

export const MobileSuccessView: React.FC<MobileSuccessViewProps> = ({
  nairaEstimate,
  onClose,
  onViewTransaction,
}) => {
  return (
    <div className="fixed inset-0 z-50 flex flex-col md:hidden w-full h-full">
      {/* Top Section (Purple) - 45% */}
      <div className="h-[45%] bg-[#7b39fc] relative flex items-center justify-center overflow-hidden">
        {/* Floating Coins */}
        <div className="absolute top-16 left-[18%] w-10 h-10 bg-[#ffd23f] border-4 border-[#111] rounded-full shadow-[2px_2px_0px_#111] z-0" />
        <div className="absolute top-8 left-1/2 -translate-x-1/2 w-24 h-24 bg-[#ffd23f] border-4 border-[#111] rounded-full shadow-[3px_3px_0px_#111] z-0" />
        <div className="absolute top-16 right-[18%] w-14 h-14 bg-[#ffd23f] border-4 border-[#111] rounded-full shadow-[2px_2px_0px_#111] z-0" />
      </div>

      {/* Bottom Section (Light Purple) - 55% */}
      <div className="h-[55%] bg-[#d4c5fb] relative" />

      {/* Centered Success Card */}
      <div className="absolute top-[45%] left-4 right-4 -translate-y-1/2 z-20">
        <div className="bg-white border-2 border-[#111] rounded-3xl px-6 pt-10 pb-6 text-center shadow-[4px_4px_0px_#111] relative">
          {/* Overlapping Badge */}
          <div className="w-14 h-14 bg-[#63f2b4] border-2 border-[#111] rounded-full flex items-center justify-center absolute -top-7 left-1/2 -translate-x-1/2 shadow-[2px_2px_0px_#111] z-30">
            <svg className="w-7 h-7 text-[#111]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="3.5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          </div>

          {/* Content */}
          <span className="text-xs font-bold uppercase tracking-wider text-[#111] block mb-1">
            CASH OUT COMPLETE
          </span>
          <div className="text-5xl font-black text-[#111] mb-1">
            ₦{Math.round(nairaEstimate).toLocaleString()}
          </div>
          <p className="text-sm font-semibold text-[#111]">
            on its way to your bank
          </p>
        </div>
      </div>

      {/* Action Buttons (Bottom Fixed Container) */}
      <div className="fixed bottom-8 left-4 right-4 z-30 flex flex-col gap-3">
        <button
          onClick={onClose}
          className="w-full bg-[#7b39fc] text-white border-2 border-[#111] rounded-2xl py-4 text-xl font-bold shadow-[4px_4px_0px_#111] active:translate-x-0.5 active:translate-y-0.5 active:shadow-none"
        >
          Close
        </button>
        <button
          onClick={onViewTransaction}
          className="w-full bg-white text-[#111] border-2 border-[#111] rounded-2xl py-4 text-xl font-bold shadow-[4px_4px_0px_#111] active:translate-x-0.5 active:translate-y-0.5 active:shadow-none"
        >
          View transaction
        </button>
      </div>
    </div>
  );
};

export default MobileSuccessView;
