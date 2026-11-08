import React, { useState } from 'react';
import { getHistoryNaira, getSavedHistoryStatus, type SwapHistoryItem } from './HistoryCard';
import { formatNaira } from '../lib/rate';
import { MobileBottomNav, type MobileTab } from './MobileBottomNav';
import { HistoryDetailModal } from './HistoryDetailModal';

export interface MobileHistoryViewProps {
  history: SwapHistoryItem[];
  onClose: () => void;
  ngnPerUsdt?: number | null;
  onNavigate?: (tab: MobileTab) => void;
  walletAddress?: string | null;
}

type Filter = 'all' | 'onItsWay' | 'paid';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function formatDisplayDate(timestamp: number): string {
  const d = new Date(timestamp);
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

const isPaid = (item: SwapHistoryItem) => getSavedHistoryStatus(item) === 'paid';

export const MobileHistoryView: React.FC<MobileHistoryViewProps> = ({ history, onClose, ngnPerUsdt = null, onNavigate, walletAddress = null }) => {
  const [filter, setFilter] = useState<Filter>('all');
  const [openId, setOpenId] = useState<string | null>(null);

  const visible = history.filter((h) =>
    filter === 'all' ? true : filter === 'paid' ? isPaid(h) : !isPaid(h)
  );
  const totalG = history.reduce((sum, h) => sum + h.amountInG, 0);
  const totalNaira = history.reduce((sum, h) => sum + (h.nairaAmount ?? (isPaid(h) ? getHistoryNaira(h, ngnPerUsdt) ?? 0 : 0)), 0);

  const pill = (id: Filter, label: string) => (
    <button
      key={id}
      type="button"
      onClick={() => setFilter(id)}
      className={`gc-pill gc-hit ${filter === id ? 'gc-pill--on' : ''}`}
    >
      {label}
    </button>
  );

  return (
    <div className="gc fixed inset-0 z-40 flex flex-col overflow-y-auto">
      <div className="gc-col" style={{ padding: '14px 14px 110px', gap: '10px' }}>
        <header className="gc-top relative">
          <button type="button" onClick={onClose} aria-label="Close history" className="gc-back relative z-10">
            ✕
          </button>
          <span className="gc-title" style={{ position: 'absolute', left: '50%', transform: 'translateX(-50%)' }}>
            History
          </span>
          <div style={{ width: 34 }} />
        </header>

        <div className="flex gap-2">
          {pill('all', 'All')}
          {pill('onItsWay', 'On its way')}
          {pill('paid', 'Paid')}
        </div>

        {visible.length === 0 ? (
          <div className="gc-card gc-card--dashed" style={{ textAlign: 'center' }}>
            <div className="gc-title" style={{ fontSize: 18 }}>
              {history.length === 0 ? 'No cash outs yet' : 'Nothing here'}
            </div>
            <div className="gc-sm" style={{ marginTop: 4 }}>
              {history.length === 0 ? 'Your cash outs will show up here.' : 'No cash outs match this filter.'}
            </div>
          </div>
        ) : (
          visible.map((item) => {
            const status = getSavedHistoryStatus(item);
            const paid = status === 'paid';
            const naira = getHistoryNaira(item, ngnPerUsdt);
            return (
              <div
                key={item.id}
                className="gc-card"
                role="button"
                tabIndex={0}
                aria-label={`Open details for ${item.amountInG.toLocaleString()} G$ cash out`}
                style={{ cursor: 'pointer' }}
                onClick={() => setOpenId(item.id)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    setOpenId(item.id);
                  }
                }}
              >
                <div className="gc-row" style={{ alignItems: 'flex-start' }}>
                  <div className="gc-big" style={{ fontSize: 22 }}>
                    {item.amountInG.toLocaleString()} G$ → {naira != null ? formatNaira(naira) : '—'}
                  </div>
                  <span className={`gc-pill ${paid ? 'gc-pill--mint' : status === 'onItsWay' ? 'gc-pill--yellow' : ''}`} style={{ whiteSpace: 'nowrap', flex: 'none' }}>
                    {paid ? 'Paid' : status === 'onItsWay' ? 'On its way' : 'Checking status'}
                  </span>
                </div>
                <div className="gc-sm" style={{ color: '#444', marginTop: 4 }}>
                  {formatDisplayDate(item.timestamp)} · ${item.amountOutUsdt.toFixed(2)}
                </div>
                <a
                  href={`https://celo.blockscout.com/tx/${item.txHash}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(e) => e.stopPropagation()}
                  className="gc-sm"
                  style={{ display: 'inline-block', marginTop: 6, textDecoration: 'underline' }}
                >
                  Receipt {item.txHash.slice(0, 6)}…{item.txHash.slice(-4)} ↗
                </a>
              </div>
            );
          })
        )}

        <div className="gc-card gc-cost">
          <div className="gc-lab" style={{ marginBottom: 2 }}>Your totals</div>
          <div className="gc-row"><span>Cash outs</span><span>{history.length}</span></div>
          <div className="gc-row"><span>G$ cashed out</span><span>{totalG.toLocaleString()} G$</span></div>
          <div className="gc-row">
            <span>Naira received so far</span>
            <span>{totalNaira > 0 ? formatNaira(totalNaira) : '—'}</span>
          </div>
        </div>

        <div className="gc-card">
          <div className="gc-lab">What the statuses mean</div>
          <div className="gc-st">
            <span className="gc-st__num">1</span>
            <span className="gc-sm"><u>On its way</u>: your G$ was converted and your bank is being paid.</span>
          </div>
          <div className="gc-st">
            <span className="gc-st__num">2</span>
            <span className="gc-sm"><u>Paid</u>: naira sent to your bank account.</span>
          </div>
        </div>
      </div>
      {openId && (() => {
        const item = history.find((h) => h.id === openId);
        if (!item) return null;
        return (
          <HistoryDetailModal
            item={item}
            naira={getHistoryNaira(item, ngnPerUsdt)}
            savedStage={getSavedHistoryStatus(item)}
            wallet={walletAddress}
            onClose={() => setOpenId(null)}
          />
        );
      })()}
      {onNavigate && <MobileBottomNav active="history" onNavigate={onNavigate} />}
    </div>
  );
};

export default MobileHistoryView;
