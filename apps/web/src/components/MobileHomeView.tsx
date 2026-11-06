import React from 'react';

export const MobileHomeView: React.FC = () => {
  return (
    <div className="bg-[#D6C5F3] flex flex-col min-h-screen px-4 py-6 space-y-4">
      {/* Top Header */}
      <header className="flex justify-between items-center w-full mb-2">
        <span className="text-2xl font-black text-black tracking-tight">GoodCash</span>
        <div className="flex items-center gap-2 px-4 py-2 bg-white border-[3px] border-black rounded-full shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] text-sm font-bold text-black">
          <span />
          <span className="w-2 h-2 rounded-full bg-green-500" />
          <span>Connected</span>
        </div>
      </header>

      {/* Main Balance Card */}
      <div className="relative w-full bg-white border-[3px] border-black rounded-[20px] shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] p-5 flex flex-col gap-3">
        <span className="text-[10px] font-black uppercase tracking-wider text-black">YOUR BALANCE</span>
        <div className="flex justify-between items-start">
          <div>
            <div className="text-6xl font-black text-black leading-none tracking-tighter">1,297.5</div>
            <div className="w-14 h-14 bg-[#FFD700] rounded-full border-[3px] border-black flex items-center justify-center text-xl font-black shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]">
              ₡
            </div>
          </div>
          <div className="text-base font-bold text-black">about ₦203 after fees</div>
        </div>

        {/* Progress Bar */}
        <div className="w-full h-4 bg-white border-2 border-black rounded-full overflow-hidden mt-1">
          <div className="h-full bg-[#7C3AED]"></div>
        </div>
        <div className="flex justify-between items-center w-full">
          <span className="text-sm font-bold text-black mt-1">2,000 G$ to go</span>
          <div className="bg-[#FFD700] border-2 border-black rounded-full px-3 py-1 text-xs font-black shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] transform translate-y-2">29%</div>
        </div>
      </div>

      {/* Secondary Cards Row */}
      <div className="grid grid-cols-2 gap-4">
        {/* FIRST PAYOUT Card */}
        <div className="w-full bg-white border-[3px] border-black rounded-[20px] shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] p-5 flex flex-col justify-center min-h-[90px]">
          <span className="text-[10px] font-black uppercase tracking-wider text-black mb-1">FIRST PAYOUT</span>
          <div className="text-base font-bold text-black">Minimum cash out of 1,000 G$ to any Celo wallet</div>
        </div>

        {/* LAST CASH OUT Card */}
        <div className="w-full bg-white border-[3px] border-black rounded-[20px] shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] p-5 flex flex-col justify-center min-h-[90px]">
          <span className="text-[10px] font-black uppercase tracking-wider text-black mb-1">LAST CASH OUT</span>
          <div className="flex justify-between items-center">
            <div className="text-base font-bold text-black">1,000 G$ → ₦156</div>
            <div className="text-sm font-bold text-black">4 Nov ›</div>
          </div>
        </div>
      </div>

      {/* Disabled Bottom Action Button */}
      <div className="w-full bg-[#E5DDF5] border-[3px] border-black rounded-[20px] shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] p-5 text-center mt-2 opacity-80">
        <span className="text-lg font-black text-[#7C3AED]">Cash out opens at 9am daily</span>
      </div>

      {/* Bottom Navigation Bar */}
      <div className="fixed bottom-6 left-4 right-4 bg-white border-[3px] border-black rounded-[30px] shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] p-2 flex justify-between items-center z-50">
        <div
          className="bg-[#7C3AED] text-white rounded-full px-6 py-3 text-base font-black flex-1 text-center"
        >
          Home
        </div>
        <div className="text-black px-6 py-3 text-base font-black flex-1 text-center">Cash out</div>
        <div className="text-black px-6 py-3 text-base font-black flex-1 text-center">History</div>
      </div>
    </div>
  );
};