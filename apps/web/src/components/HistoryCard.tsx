import React, { useState } from 'react';
import type { Language } from '../lib/i18n';
import { getTranslations } from '../lib/i18n';
import { ORDERS_API_BASE, getCashoutRate, formatNaira } from '../lib/rate';

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

type FilterType = 'all' | 'onItsWay' | 'paid';

function formatDisplayDate(timestamp: number): string {
  const date = new Date(timestamp);
  const day = date.getDate();
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const month = months[date.getMonth()];
  const year = date.getFullYear();
  return `${day} ${month} ${year}`;
}

export const HistoryCard: React.FC<HistoryCardProps> = ({ history, onCashOutClick, language, ngnPerUsdt = null }) => {
  const t = getTranslations(language);
  const [currentFilter, setCurrentFilter] = useState<FilterType>('all');
  const [orderStatuses, setOrderStatuses] = React.useState<
    Record<string, { status: string; paymentReference?: string | null }>
  >({});

  // Fetch live order status
  React.useEffect(() => {
    const orderIds = history.map((h) => h.orderId).filter((id): id is string => Boolean(id));
    if (orderIds.length === 0) return;

    let cancelled = false;
    orderIds.forEach(async (id) => {
      try {
        const res = await fetch(`${ORDERS_API_BASE}/orders/${id}`);
        if (res.ok && !cancelled) {
          const data = (await res.json()) as { status: string; paymentReference?: string | null };
          setOrderStatuses((prev) => ({ ...prev, [id]: data }));
        }
      } catch {
        // Keep status unknown on lookup failure
      }
    });

    return () => {
      cancelled = true;
    };
  }, [history]);

  // Derive overall status for each item
  const getItemStatus = (item: SwapHistoryItem): 'paid' | 'onItsWay' | 'unknown' => {
    const liveOrder = item.orderId ? orderStatuses[item.orderId] : undefined;
    const liveStatus = liveOrder?.status;

    if (liveStatus === 'settled' || item.steps?.paidInNaira === 'completed') {
      return 'paid';
    }
    if (liveStatus && ['initiated', 'deposited', 'pending', 'fulfilling', 'validated', 'settling'].includes(liveStatus)) {
      return 'onItsWay';
    }
    if (item.steps?.paidInNaira === 'processing' || item.steps?.sentToPartner === 'completed') {
      return 'onItsWay';
    }
    return 'unknown';
  };

  // Filter history
  const filteredHistory = history.filter((item) => {
    if (currentFilter === 'all') return true;
    const status = getItemStatus(item);
    if (currentFilter === 'paid') return status === 'paid';
    if (currentFilter === 'onItsWay') return status === 'onItsWay';
    return true;
  });

  return (
    <>
      {/* Header & Filter Pills Row — sits directly on page background */}
      <div className="flex justify-between items-center gap-2">
        <span className="text-xl font-bold text-[#111]">{t.navHistory}</span>
        <div className="flex gap-1.5">
          <button
            type="button"
            onClick={() => setCurrentFilter('all')}
            className={`gc-pill gc-hit ${currentFilter === 'all' ? 'gc-pill--on' : 'gc-pill--white'} focus-visible:outline focus-visible:outline-3 focus-visible:outline-black focus-visible:outline-offset-2`}
          >
            {t.filterAll || 'All'}
          </button>
          <button
            type="button"
            onClick={() => setCurrentFilter('onItsWay')}
            className={`gc-pill gc-hit ${currentFilter === 'onItsWay' ? 'gc-pill--on' : 'gc-pill--white'} focus-visible:outline focus-visible:outline-3 focus-visible:outline-black focus-visible:outline-offset-2`}
          >
            {t.filterOnItsWay || 'On its way'}
          </button>
          <button
            type="button"
            onClick={() => setCurrentFilter('paid')}
            className={`gc-pill gc-hit ${currentFilter === 'paid' ? 'gc-pill--on' : 'gc-pill--white'} focus-visible:outline focus-visible:outline-3 focus-visible:outline-black focus-visible:outline-offset-2`}
          >
            {t.filterPaid || 'Paid'}
          </button>
        </div>
      </div>

      {/* History List */}
      {filteredHistory.length === 0 ? (
        <div className="gc-card border-dashed border-[2.5px] border-[#111] shadow-none bg-transparent">
          <div className="text-xs font-semibold text-[#111]">
            Empty state: "{t.noCashOutsYet || 'No cash outs yet. Your first one will show up here.'}"
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          {filteredHistory.map((item) => {
            const liveOrder = item.orderId ? orderStatuses[item.orderId] : undefined;
            const estimatedNaira =
              item.nairaAmount ?? (ngnPerUsdt && ngnPerUsdt > 0 ? getCashoutRate(item.amountInG, 123.48, ngnPerUsdt).netNaira : null);
            const status = getItemStatus(item);

            return (
              <div key={item.id} className="gc-card">
                {/* Top Row: Conversion text left, Status pill right */}
                <div className="flex justify-between items-start gap-2">
                  <div>
                    <div className="gc-big gc-big--history text-[#111]">
                      {item.amountInG.toLocaleString()} G$ →{' '}
                      {Number.isFinite(estimatedNaira) && estimatedNaira !== null
                        ? formatNaira(estimatedNaira)
                        : '—'}
                    </div>
                    <div className="text-xs font-semibold text-[#666] mt-2">
                      {formatDisplayDate(item.timestamp)} · {item.amountOutUsdt.toFixed(4)} USDT
                    </div>
                  </div>
                  <span
                    className={`gc-pill gc-hit ${status === 'paid' ? 'gc-pill--mint' : status === 'onItsWay' ? 'gc-pill--yellow' : 'gc-pill'} focus-visible:outline focus-visible:outline-3 focus-visible:outline-black focus-visible:outline-offset-2`}
                  >
                    {status === 'paid' ? t.statusPaid || 'Paid' : status === 'onItsWay' ? t.statusOnItsWay || 'On its way' : t.statusUnknown || 'Status unknown'}
                  </span>
                </div>

                {/* Bottom: Receipt link under conversion text — black text */}
                <a
                  href={`https://celo.blockscout.com/tx/${item.txHash}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs font-mono text-[#111] mt-8 gc-hit focus-visible:outline focus-visible:outline-3 focus-visible:outline-black focus-visible:outline-offset-2"
                >
                  {t.receipt || 'Receipt'} {item.txHash.slice(0, 6)}…{item.txHash.slice(-4)} ↗
                </a>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
};
