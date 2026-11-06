import React from 'react';
import type { SwapHistoryItem } from './HistoryCard';

export interface MobileHistoryViewProps {
  history: SwapHistoryItem[];
  onClose: () => void;
}

function formatDisplayDate(timestamp: number): string {
  const date = new Date(timestamp);
  const day = date.getDate();
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${day} ${months[date.getMonth()]} ${date.getFullYear()}`;
}

function getStatus(item: SwapHistoryItem): { label: string; className: string } {
  if (item.steps?.paidInNaira === 'completed') {
    return { label: 'Paid', className: 'bg-[#86EFAC]' };
  }
  return { label: 'On its way', className: 'bg-[#ffd23f]' };
}

export const MobileHistoryView: React.FC<MobileHistoryViewProps> = ({ history, onClose }) => {
  return (
    <div className="flex flex-col min-h-screen bg-[#D6C5F3] px-5 pt-8 pb-32 gap-6">
      {/* Header */}
      <header className="flex items-center justify-between w-full mb-4 relative">
        <button
          type="button"
          onClick={onClose}
          aria-label="Close history"
          className="border-2 border-[#111] bg-white rounded-xl w-10 h-10 flex items-center justify-center shadow-[2px_2px_0px_#111] font-black text-lg z-10"
        >
          ✕
        </button>
        <span className="text-[32px] font-black text-black tracking-tight absolute left-1/2 -translate-x-1/2">
          History
        </span>
        <div className="w-10" />
      </header>

      {/* Transaction Cards or Empty State */}
      {history.length > 0 ? (
        <div>
          {history.map((item) => {
            const status = getStatus(item);
            return (
              <div
                key={item.id}
                className="w-full bg-white border-[4px] border-black rounded-[32px] p-7 shadow-[8px_8px_0px_0px_rgba(0,0,0,1)] flex flex-col mb-4"
              >
                {/* Top Row: Date & Status */}
                <div className="flex justify-between items-center mb-4">
                  <span className="text-[16px] font-bold text-gray-600 uppercase tracking-widest">
                    {formatDisplayDate(item.timestamp)}
                  </span>
                  <span
                    className={`${status.className} border-[3px] border-black rounded-[12px] px-3 py-1 text-[14px] font-black text-black shadow-[3px_3px_0px_0px_rgba(0,0,0,1)]`}
                  >
                    {status.label}
                  </span>
                </div>

                {/* Middle Row: Amount Details */}
                <div className="flex flex-col gap-1 mb-4">
                  <span className="text-[14px] font-bold text-black">Sent</span>
                  <span className="text-[32px] font-black text-black leading-none">
                    {item.amountInG.toLocaleString()} G$
                  </span>
                  <span className="text-[18px] font-bold text-[#7C3AED]">
                    {item.nairaAmount != null ? `₦${item.nairaAmount.toLocaleString()}` : '—'}
                  </span>
                </div>

                {/* Bottom Row: Hash/Link */}
                <div className="flex justify-between items-center pt-4 border-t-[3px] border-black">
                  <a
                    href={`https://celo.blockscout.com/tx/${item.txHash}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[15px] font-bold text-black bg-gray-100 px-3 py-1 border-[2px] border-black rounded-lg"
                  >
                    {item.txHash.slice(0, 6)}…{item.txHash.slice(-4)} ↗
                  </a>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div
          className="w-full bg-white border-[4px] border-black rounded-[32px] p-10 shadow-[8px_8px_0px_0px_rgba(0,0,0,1)] flex flex-col items-center justify-center text-center mt-10"
        >
          <span className="text-[24px] font-black text-black mb-2">No cash outs yet</span>
          <span className="text-[16px] font-bold text-gray-600">Your transaction history will appear here.</span>
        </div>
      )}
    </div>
  );
};

export default MobileHistoryView;
