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

  // Calculate totals
  const totalCashOuts = history.length;
  const totalGSwapped = history.reduce((sum, item) => sum + item.amountInG, 0);
  const totalNairaReceived = history.reduce((sum, item) => {
    const naira =
      item.nairaAmount ?? (ngnPerUsdt && ngnPerUsdt > 0 ? getCashoutRate(item.amountInG, 123.48, ngnPerUsdt).netNaira : 0);
    return sum + (Number.isFinite(naira) ? naira : 0);
  }, 0);

  return (
    <div className="gc-card">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-semibold text-white">{t.navHistory}</h2>
          <p className="mt-1 text-xs text-[#A39BBE]">{t.receiptsExplanation}</p>
        </div>
      </div>

      {/* Filter Pills */}
      <div className="mb-4 flex items-center gap-2">
        <button
          type="button"
          onClick={() => setCurrentFilter('all')}
          className={`gc-pill ${currentFilter === 'all' ? 'gc-pill--on' : ''}`}
        >
          {t.filterAll || 'All'}
        </button>
        <button
          type="button"
          onClick={() => setCurrentFilter('onItsWay')}
          className={`gc-pill gc-pill--ye ${currentFilter === 'onItsWay' ? 'gc-pill--on' : ''}`}
        >
          {t.filterOnItsWay || 'On its way'}
        </button>
        <button
          type="button"
          onClick={() => setCurrentFilter('paid')}
          className={`gc-pill gc-pill--mint ${currentFilter === 'paid' ? 'gc-pill--on' : ''}`}
        >
          {t.filterPaid || 'Paid'}
        </button>
      </div>

      {/* History List */}
      {filteredHistory.length === 0 ? (
        <div className="rounded-2xl border-2 border-dashed border-[#2D204A] bg-[#120D1D] p-8 text-center">
          <p className="text-sm text-[#A39BBE]">
            {history.length === 0
              ? t.noCashOutsYet || 'No cash outs yet. Your first one will show up here.'
              : t.noMatchingTransactions || 'No transactions match this filter.'}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {filteredHistory.map((item) => {
            const liveOrder = item.orderId ? orderStatuses[item.orderId] : undefined;
            const estimatedNaira =
              item.nairaAmount ?? (ngnPerUsdt && ngnPerUsdt > 0 ? getCashoutRate(item.amountInG, 123.48, ngnPerUsdt).netNaira : null);
            const status = getItemStatus(item);

            return (
              <div key={item.id} className="gc-card p-4">
                {/* Amount and Status */}
                <div className="mb-3 flex items-start justify-between gap-3">
                  <div>
                    <div className="gc-big flex items-center gap-2">
                      <span className="text-white">{item.amountInG.toLocaleString()} G$</span>
                      <span className="text-[#A39BBE]">→</span>
                      <span className="text-[#10B981]">
                        {Number.isFinite(estimatedNaira) && estimatedNaira !== null ? formatNaira(estimatedNaira) : '—'}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-[#A39BBE]">
                      {formatDisplayDate(item.timestamp)} · {item.amountOutUsdt.toFixed(4)} USDT
                    </p>
                  </div>

                  {/* Status Pill */}
                  <div>
                    {status === 'paid' ? (
                      <span className="gc-pill gc-pill--mint">{t.statusPaid || 'Paid'}</span>
                    ) : status === 'onItsWay' ? (
                      <span className="gc-pill gc-pill--ye">{t.statusOnItsWay || 'On its way'}</span>
                    ) : (
                      <span className="gc-pill">{t.statusUnknown || 'Unknown'}</span>
                    )}
                  </div>
                </div>

                {/* Receipt Link */}
                <a
                  href={`https://celo.blockscout.com/tx/${item.txHash}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-xs font-mono text-[#8B5CF6] hover:text-[#C4B5FD] hover:underline"
                >
                  {t.receipt || 'Receipt'} {item.txHash.slice(0, 6)}…{item.txHash.slice(-4)} ↗
                </a>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
