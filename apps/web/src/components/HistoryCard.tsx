import React from 'react';
import type { Language } from '../lib/i18n';
import { ORDERS_API_BASE, getCashoutRate } from '../lib/rate';

export interface SwapHistoryItem {
  id: string;
  txHash: string;
  timestamp: number;
  amountInG: number;
  amountOutUsdt: number;
  route: string;
  orderId?: string;
  nairaAmount?: number;
  steps?: {
    swapped: 'completed' | 'pending' | 'failed' | 'unknown';
    sentToPartner: 'completed' | 'pending' | 'waiting' | 'failed' | 'unknown';
    paidInNaira: 'completed' | 'processing' | 'pending' | 'failed' | 'unknown';
  };
  bankReference?: string;
}

interface HistoryCardProps {
  history: SwapHistoryItem[];
  onCashOutClick: () => void;
  language: Language;
  ngnPerUsdt?: number | null;
}

function formatDisplayDate(timestamp: number): string {
  const date = new Date(timestamp);
  const day = date.getDate();
  const months = [
    'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
  ];
  const month = months[date.getMonth()];
  const year = date.getFullYear();
  return `${day} ${month} ${year}`;
}

export const HistoryCard: React.FC<HistoryCardProps> = ({
  history,
  onCashOutClick,
  ngnPerUsdt = null,
}) => {
  const [orderStatuses, setOrderStatuses] = React.useState<
    Record<string, { status: string; paymentReference?: string | null }>
  >({});

  // Fetch live order status from orders service by order ID (GET /orders/:id)
  React.useEffect(() => {
    const orderIds = history.map((h) => h.orderId).filter((id): id is string => Boolean(id));
    if (orderIds.length === 0) return;

    let cancelled = false;
    orderIds.forEach(async (id) => {
      try {
        const res = await fetch(`${ORDERS_API_BASE}/orders/${id}`);
        if (res.ok && !cancelled) {
          const data = (await res.json()) as { status: string; paymentReference?: string | null };
          setOrderStatuses((prev) => ({
            ...prev,
            [id]: data,
          }));
        }
      } catch {
        // Keep Status unknown on lookup failure
      }
    });

    return () => {
      cancelled = true;
    };
  }, [history]);
  return (
    <div className="glass-panel rounded-2xl p-6 sm:p-8 w-full max-w-xl mx-auto shadow-2xl relative">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-xl font-manrope font-bold text-white">Cash-Out History</h2>
          <p className="text-xs text-[#A39BBE] font-sans mt-0.5">
            Verified on-chain CashOut events and off-ramp payout tracking.
          </p>
        </div>

        <button
          onClick={onCashOutClick}
          className="bg-[#7b39fc] hover:bg-[#8c4eff] text-white text-xs font-cabin font-medium px-3 py-1.5 rounded-lg shadow-sm"
        >
          New Cash-Out
        </button>
      </div>

      {history.length === 0 ? (
        <div className="bg-[#18122c]/60 border border-white/5 rounded-xl p-8 text-center">
          <p className="text-sm font-sans text-white/60">No cash-out swaps found yet.</p>
          <p className="text-xs text-white/40 mt-1">
            When you swap your G$ for USDT, your transactions will appear here.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {history.map((item) => {
            const liveOrder = item.orderId ? orderStatuses[item.orderId] : undefined;
            const liveStatus = liveOrder?.status;

            // "swapped" comes from the on-chain event, not a default
            const swappedStatus = item.steps?.swapped ?? (item.txHash ? 'completed' : 'unknown');

            // sentToPartner & paidInNaira statuses derived from live orders service lookup; Status unknown if lookup fails
            let partnerStatus: 'completed' | 'pending' | 'failed' | 'unknown' =
              item.steps?.sentToPartner === 'waiting'
                ? 'pending'
                : (item.steps?.sentToPartner ?? 'unknown');
            let nairaStatus: 'completed' | 'processing' | 'pending' | 'failed' | 'unknown' = item.steps?.paidInNaira ?? 'unknown';

            if (liveStatus) {
              if (liveStatus === 'initiated') {
                partnerStatus = 'pending';
                nairaStatus = 'pending';
              } else if (liveStatus === 'deposited') {
                partnerStatus = 'completed';
                nairaStatus = 'processing';
              } else if (['pending', 'fulfilling', 'validated', 'settling'].includes(liveStatus)) {
                partnerStatus = 'completed';
                nairaStatus = 'processing';
              } else if (liveStatus === 'settled') {
                partnerStatus = 'completed';
                nairaStatus = 'completed';
              } else if (liveStatus === 'expired') {
                partnerStatus = 'failed';
                nairaStatus = 'failed';
              } else if (['refunded', 'refunding', 'error'].includes(liveStatus)) {
                partnerStatus = 'completed';
                nairaStatus = 'failed';
              }
            }

            const bankRef = liveOrder?.paymentReference ?? item.bankReference;

            // Use getCashoutRate or stored nairaAmount — never a hardcoded rate
            const estimatedNaira =
              item.nairaAmount ??
              (ngnPerUsdt && ngnPerUsdt > 0
                ? getCashoutRate(item.amountInG, 123.48, ngnPerUsdt).netNaira
                : null);

            return (
              <div
                key={item.id}
                className="bg-[#17112c]/90 border border-[#2D204A] rounded-2xl p-4 sm:p-5 hover:border-purple-400/40 transition-colors shadow-lg"
              >
                {/* Header: Amounts, Date, Explorer Link */}
                <div className="flex items-start justify-between gap-3 mb-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-sans font-bold text-white text-base">
                        {item.amountInG.toLocaleString()} G$
                      </span>
                      <span className="text-[#A39BBE] text-xs">→</span>
                      <span className="font-sans font-bold text-emerald-400 text-base">
                        {item.amountOutUsdt.toFixed(4)} USDT
                      </span>
                      {Number.isFinite(estimatedNaira) && estimatedNaira !== null && (
                        <span className="text-xs font-semibold text-purple-200 bg-purple-500/20 px-2 py-0.5 rounded-md border border-purple-400/20">
                          ≈ ₦{Math.round(estimatedNaira).toLocaleString()}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2 mt-1 text-[11px] text-[#A39BBE]">
                      <span>{formatDisplayDate(item.timestamp)}</span>
                      <span>•</span>
                      <span className="text-purple-300 font-medium truncate max-w-[220px]">
                        {item.route}
                      </span>
                    </div>
                  </div>

                  <a
                    href={`https://celo.blockscout.com/tx/${item.txHash}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-xs text-[#8B5CF6] hover:text-white font-mono underline underline-offset-2 shrink-0"
                  >
                    <span>{item.txHash.slice(0, 6)}...{item.txHash.slice(-4)}</span>
                    <span>↗</span>
                  </a>
                </div>

                {/* Sub-steps Indicator (Swapped, Sent to partner, Paid in naira) */}
                <div className="mt-3 pt-3 border-t border-white/5 grid grid-cols-3 gap-2 text-center text-[11px]">
                  {/* Step 1: Swapped */}
                  <div className="bg-[#120D1D] rounded-xl p-2 border border-white/5 flex flex-col items-center">
                    <span
                      className={`font-bold mb-0.5 ${
                        swappedStatus === 'completed'
                          ? 'text-emerald-400'
                          : swappedStatus === 'pending'
                          ? 'text-purple-300'
                          : 'text-[#A39BBE]'
                      }`}
                    >
                      {swappedStatus === 'completed'
                        ? '✓ Swapped'
                        : swappedStatus === 'pending'
                        ? '⏳ Swapping'
                        : swappedStatus === 'failed'
                        ? '✗ Failed'
                        : 'Status unknown'}
                    </span>
                    <span className="text-[10px] text-white/50">Celo on-chain</span>
                  </div>

                  {/* Step 2: Sent to partner */}
                  <div className="bg-[#120D1D] rounded-xl p-2 border border-white/5 flex flex-col items-center">
                    <span
                      className={`font-bold mb-0.5 ${
                        partnerStatus === 'completed'
                          ? 'text-emerald-400'
                          : partnerStatus === 'pending'
                          ? 'text-purple-300'
                          : 'text-[#A39BBE]'
                      }`}
                    >
                      {partnerStatus === 'completed'
                        ? '✓ Sent'
                        : partnerStatus === 'pending'
                        ? '⏳ Sending'
                        : partnerStatus === 'failed'
                        ? '✗ Expired'
                        : 'Status unknown'}
                    </span>
                    <span className="text-[10px] text-white/50">To Paycrest</span>
                  </div>

                  {/* Step 3: Paid in naira */}
                  <div className="bg-[#120D1D] rounded-xl p-2 border border-white/5 flex flex-col items-center">
                    <span
                      className={`font-bold mb-0.5 ${
                        nairaStatus === 'completed'
                          ? 'text-emerald-400'
                          : nairaStatus === 'processing'
                          ? 'text-purple-300'
                          : 'text-[#A39BBE]'
                      }`}
                    >
                      {nairaStatus === 'completed'
                        ? '✓ Paid NGN'
                        : nairaStatus === 'processing'
                        ? '⏳ Paying'
                        : nairaStatus === 'pending'
                        ? '⏳ Pending'
                        : nairaStatus === 'failed'
                        ? '✗ Refunded'
                        : 'Status unknown'}
                    </span>
                    <span className="text-[10px] text-white/50">
                      {bankRef ? bankRef.slice(0, 8) : 'Bank payout'}
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
