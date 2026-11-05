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
    <div className="fixed inset-0 z-50 flex flex-col md:hidden">
      {/* Top Half (Purple) */}
      <div className="h-1/2 bg-[#7b39fc] relative flex items-center justify-center overflow-hidden">
        {/* Floating Coins */}
        <div className="absolute top-12 left-[15%] w-10 h-10 bg-[#ffd23f] border-4 border-[#111] rounded-full shadow-[2px_2px_0px_#111]" />
        <div className="absolute top-6 left-1/2 -translate-x-1/2 w-20 h-20 bg-[#ffd23f] border-4 border-[#111] rounded-full shadow-[3px_3px_0px_#111]" />
        <div className="absolute top-16 right-[15%] w-12 h-12 bg-[#ffd23f] border-4 border-[#111] rounded-full shadow-[2px_2px_0px_#111]" />
      </div>

      {/* Bottom Half (Light Purple) */}
      <div className="h-1/2 bg-[#d4c5fb] relative" />

      {/* Center Overlapping Success Card */}
      <div className="absolute top-1/2 left-4 right-4 -translate-y-1/2 z-10">
        <div className="bg-white border-2 border-[#111] rounded-3xl p-6 pt-10 text-center shadow-[4px_4px_0px_#111] relative">
          {/* Circular Checkmark Badge */}
          <div className="w-14 h-14 bg-[#63f2b4] border-2 border-[#111] rounded-full flex items-center justify-center absolute -top-7 left-1/2 -translate-x-1/2 shadow-[2px_2px_0px_#111] text-2xl font-black text-[#111]">
            ✓
          </div>

          {/* Content */}
          <span className="text-xs font-bold uppercase tracking-wider text-[#111] block mb-2">
            CASH OUT COMPLETE
          </span>
          <div className="text-5xl font-black text-[#111] mb-2">
            ₦{Math.round(nairaEstimate).toLocaleString()}
          </div>
          <p className="text-sm font-semibold text-[#111]">
            on its way to your bank
          </p>
        </div>
      </div>

      {/* Bottom Actions */}
      <div className="absolute bottom-8 left-4 right-4 z-20 flex flex-col gap-3">
        <button
          onClick={onClose}
          className="gc-btn gc-btn--primary w-full py-4 text-xl font-black text-white bg-[#7b39fc] hover:bg-[#8b4aff] border-2 border-[#111] rounded-2xl shadow-[4px_4px_0px_#111] active:translate-x-0.5 active:translate-y-0.5 active:shadow-none transition-all"
        >
          Close
        </button>
        <button
          onClick={onViewTransaction}
          className="w-full bg-white border-2 border-[#111] rounded-2xl py-4 text-xl font-bold text-[#111] shadow-[4px_4px_0px_#111] active:translate-x-0.5 active:translate-y-0.5 active:shadow-none transition-all"
        >
          View transaction
        </button>
      </div>
    </div>
  );
};

export default MobileSuccessView;
