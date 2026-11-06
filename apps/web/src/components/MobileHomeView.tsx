import React from 'react';
import type { SwapHistoryItem } from './HistoryCard';
import {
  formatNaira,
  getBalanceProgressPercent,
  getCashoutRate,
  MIN_NET_USDT_REQUIRED,
} from '../lib/rate';

export interface MobileHomeViewProps {
  balanceG?: number;
  dailyClaimG?: number;
  ngnPerUsdt?: number | null;
  walletAddress?: string | null;
  history?: SwapHistoryItem[];
  onCashOut?: () => void;
  onHome?: () => void;
  onHistory?: () => void;
}

function formatG(amount: number): string {
  return amount.toLocaleString(undefined, {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });
}

function formatDateShort(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) + ' ›';
}

export const MobileHomeView: React.FC<MobileHomeViewProps> = ({
  balanceG = 0,
  dailyClaimG = 0,
  ngnPerUsdt = null,
  walletAddress = null,
  history = [],
  onCashOut,
  onHome,
  onHistory,
}) => {
  const rate = getCashoutRate(balanceG, dailyClaimG, ngnPerUsdt);
  const percent = getBalanceProgressPercent(balanceG);
  const perG = rate.netUsdtPerG > 0 ? rate.netUsdtPerG : getCashoutRate(1000).netUsdtPerG;
  const remainingG = rate.minimumReached || perG <= 0 ? 0 : Math.ceil(rate.remainingUsdt / perG);
  const nairaStr = rate.rateUnavailable ? '₦ -' : formatNaira(rate.netNaira);
  const minNaira =
    ngnPerUsdt != null && Number.isFinite(ngnPerUsdt)
      ? formatNaira(MIN_NET_USDT_REQUIRED * ngnPerUsdt)
      : '₦ -';
  const lastCashOut = history.length > 0 ? history[0] : null;
  const lastCashOutNaira = lastCashOut
    ? getCashoutRate(lastCashOut.amountInG, dailyClaimG, ngnPerUsdt).netNaira
    : null;

  return (
    <div className="gc flex flex-col gap-[10px] px-[14px] pt-[14px] pb-[12px] min-h-[100dvh]">
      {/* Header */}
      <header className="gc-top">
        <span className="gc-logo">GoodCash</span>
        <span className="gc-chip">
          {walletAddress ? walletAddress.slice(0, 6) + '…' + walletAddress.slice(-4) : 'Connect Wallet'}
        </span>
      </header>

      {/* YOUR BALANCE Card */}
      <div className="gc-card">
        <div className="gc-coin">G$</div>
        <div className="gc-lab">Your balance</div>
        <div className="gc-big">{formatG(balanceG)}</div>
        <div className="gc-sm">about {nairaStr} after fees</div>
        <div className="gc-bar">
          <div className="gc-bar__fill" style={{ width: `${percent}%` }} />
        </div>
        <div className="gc-sm">
          {rate.minimumReached
            ? 'Ready to cash out!'
            : `${remainingG.toLocaleString()} G$ to go`}
        </div>
        <div className="gc-sticker">{percent}%</div>
      </div>

      {/* FIRST PAYOUT Card */}
      <div className="gc-card">
        <div className="gc-lab">First payout</div>
        <div className="gc-sm" style={{ marginTop: '2px' }}>
          Minimum cash out is about {minNaira}.
        </div>
      </div>

      {/* LAST CASH OUT Card */}
      {lastCashOut && (
        <div className="gc-card gc-row">
          <div>
            <div className="gc-lab">Last cash out</div>
            <div className="gc-sm">
              {lastCashOut.amountInG.toLocaleString()} G$ →{' '}
              {lastCashOutNaira != null && Number.isFinite(lastCashOutNaira)
                ? formatNaira(lastCashOutNaira)
                : '₦ -'}
            </div>
          </div>
          <span className="gc-sm">{formatDateShort(lastCashOut.timestamp)}</span>
        </div>
      )}

      <div className="gc-sp" />

      {/* Main action */}
      {rate.minimumReached ? (
        <button type="button" onClick={onCashOut} className="gc-btn gc-hit">
          Cash out
        </button>
      ) : (
        <button type="button" disabled className="gc-btn gc-btn--dis gc-hit">
          Cash out opens at {remainingG.toLocaleString()} G$
        </button>
      )}

      {/* Bottom Navigation */}
      <nav className="gc-nav">
        <button type="button" onClick={onHome} className="gc-nav__item gc-nav__item--on">
          Home
        </button>
        <button type="button" onClick={onCashOut} className="gc-nav__item">
          Cash out
        </button>
        <button type="button" onClick={onHistory} className="gc-nav__item">
          History
        </button>
      </nav>
    </div>
  );
};

export default MobileHomeView;
