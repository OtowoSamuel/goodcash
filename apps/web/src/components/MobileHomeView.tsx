import React from 'react';

export const MobileHomeView: React.FC = () => {
  return (
    <div className="flex flex-col min-h-screen bg-[#D6C5F3] px-5 pt-8 pb-32 gap-6">
      {/* Header */}
      <header className="flex justify-between items-center w-full mb-2">
        <span className="text-[32px] font-black text-black tracking-tight">GoodCash</span>
        <div className="flex items-center justify-center px-5 py-2 bg-white border-[4px] border-black rounded-full text-[15px] font-black text-black shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
          <span />
          <span className="w-2 h-2 rounded-full bg-green-500" />
          <span>Connected</span>
        </div>
      </header>

      {/* YOUR BALANCE Card */}
      <div className="relative w-full bg-white border-[4px] border-black rounded-[32px] p-7 shadow-[8px_8px_0px_0px_rgba(0,0,0,1)] flex flex-col">
        <span className="text-[12px] font-black tracking-[0.05em] uppercase text-black mb-3">YOUR BALANCE</span>
        <div className="flex justify-between items-start w-full mb-2">
          <div>
            <div className="text-[64px] font-black text-black leading-[0.9] tracking-tighter">1,297.5</div>
            <div className="w-[64px] h-[64px] bg-[#FFD700] rounded-full border-[4px] border-black flex items-center justify-center text-[24px] font-black text-black shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] shrink-0">
              ₡
            </div>
          </div>
          <div className="text-[18px] font-bold text-black mt-2 mb-6">about ₦203 after fees</div>
        </div>

        {/* Progress Bar & 29% Badge */}
        <div className="w-full h-[22px] bg-white border-[4px] border-black rounded-full overflow-hidden relative">
          <div className="h-full bg-[#7C3AED] rounded-l-full"></div>
          <span className="text-[16px] font-bold text-black mt-3">3,177 G$ to go</span>
          <div className="absolute -bottom-[20px] -right-[10px] bg-[#FFD700] border-[4px] border-black rounded-[14px] px-3 py-1 text-[16px] font-black text-black shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] z-10">
            29%
          </div>
        </div>
      </div>

      {/* Secondary Cards Row */}
      <div className="grid grid-cols-2 gap-6">
        {/* FIRST PAYOUT Card */}
        <div className="w-full bg-white border-[4px] border-black rounded-[32px] p-7 shadow-[8px_8px_0px_0px_rgba(0,0,0,1)] flex flex-col justify-center min-h-[130px]">
          <span className="text-[12px] font-black tracking-[0.05em] uppercase text-black mb-2">FIRST PAYOUT</span>
          <div className="text-[18px] font-bold text-black leading-snug">Minimum cash out of 1,000 G$ to any Celo wallet</div>
        </div>

        {/* LAST CASH OUT Card */}
        <div className="w-full bg-white border-[4px] border-black rounded-[32px] p-7 shadow-[8px_8px_0px_0px_rgba(0,0,0,1)] flex flex-col justify-center min-h-[130px]">
          <span className="text-[12px] font-black tracking-[0.05em] uppercase text-black mb-2">LAST CASH OUT</span>
          <div className="text-[18px] font-bold text-black leading-snug">1,000 G$ → ₦156</div>
          <div className="text-[18px] font-bold text-black">4 Nov ›</div>
        </div>
      </div>

      {/* Disabled Action Button */}
      <div className="w-full bg-[#E5DDF5] border-[4px] border-black rounded-[32px] p-6 flex items-center justify-center shadow-[8px_8px_0px_0px_rgba(0,0,0,1)] mt-2 opacity-90">
        <span className="text-[20px] font-black text-[#7C3AED]">Cash out opens at 9am daily</span>
      </div>

      {/* Bottom Navigation Bar */}
      <div className="fixed bottom-8 left-5 right-5 bg-white border-[4px] border-black rounded-[40px] p-3 flex justify-between items-center shadow-[8px_8px_0px_0px_rgba(0,0,0,1)] z-50">
        <div className="bg-[#7C3AED] text-white rounded-[28px] px-8 py-4 text-[16px] font-black flex-1 text-center">
          Home
        </div>
        <div className="text-black px-8 py-4 text-[16px] font-black flex-1 text-center">Cash out</div>
        <div className="text-black px-8 py-4 text-[16px] font-black flex-1 text-center">History</div>
      </div>
    </div>
  );
};