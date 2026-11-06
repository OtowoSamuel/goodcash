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
    return { label: 'Paid', className: 'gc-pill gc-pill--mint' };
  }
  return { label: 'On its way', className: 'gc-pill gc-pill--yellow' };
}

export const MobileHistoryView: React.FC<MobileHistoryViewProps> = ({ history, onClose }) => {
  return (
    <div className="gc-col flex-1 bg-[#D6C5F3]">
      {/* Header */}
      <header className="gc-top relative">
        <button
          type="button"
          onClick={onClose}
          aria-label="Close history"
          className="gc-back relative z-10"
        >
          ✕
        </button>
        <span className="gc-title absolute left-1/2 -translate-x-1/2 text-black">
          History
        </span>
        <div className="w-10" />
      </header>

      {/* Transaction Cards or Empty State */}
      {history.length > 0 ? (
        <div className="gc-col">
          {history.map((item) => {
            const status = getStatus(item);
            return (
              <div
                key={item.id}
                className="gc-card"
              >
                {/* Top Row: Date & Status */}
                <div className="flex justify-between items-center mb-4">
                  <span className="gc-lab text-gray-600">
                    {formatDisplayDate(item.timestamp)}
                  </span>
                  <span
                    className={status.className}
                  >
                    {status.label}
                  </span>
                </div>

                {/* Middle Row: Amount Details */}
                <div className="flex flex-col gap-1 mb-4">
                  <span className="gc-lab">Sent</span>
                  <span className="gc-big gc-big--history">
                    {item.amountInG.toLocaleString()} G$
                  </span>
                  <span className="gc-sm text-[#7C3AED]">
                    {item.nairaAmount != null ? `₦${item.nairaAmount.toLocaleString()}` : '—'}
                  </span>
                </div>

                {/* Bottom Row: Hash/Link */}
                <div className="flex justify-between items-center pt-4 border-t-[2.5px] border-black">
                  <a
                    href={`https://celo.blockscout.com/tx/${item.txHash}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="gc-pill gc-pill--white"
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
          className="gc-card flex flex-col items-center justify-center text-center"
        >
          <span className="gc-title mb-2">No cash outs yet</span>
          <span className="gc-sm text-gray-600">Your transaction history will appear here.</span>
        </div>
      )}
    </div>
  );
};

export default MobileHistoryView;
