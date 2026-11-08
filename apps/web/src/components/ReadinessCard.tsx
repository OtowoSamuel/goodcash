import { nairaFromUsdt } from '../lib/units';
import React from 'react';
import type { Language } from '../lib/i18n';
import { getTranslations } from '../lib/i18n';
import { getBalanceProgressPercent, getCashoutRate, MIN_NET_USDT_REQUIRED, getMinimumCashOutG } from '../lib/rate';
import type { SwapHistoryItem } from './HistoryCard';

interface ReadinessCardProps {
  balanceG: number;
  dailyClaimG?: number;
  onCashOutClick: () => void;
  /** Opens the naira-to-G$ screen. The button shows only when this is given. */
  onAddClick?: () => void;
  language: Language;
  isLoading?: boolean;
  isStale?: boolean;
  ngnPerUsdt?: number | null;
  /** Most recent history items for the "Last cash out" card (mobile). */
  history?: SwapHistoryItem[];
  /** Called when the user taps the Last cash out card. */
  onLastCashOutClick?: () => void;
}

function formatG(amount: number): string {
  return amount.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}

function formatNaira(naira: number): string {
  return '₦' + Math.round(naira).toLocaleString();
}

function formatDateShort(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) + ' ›';
}

export const ReadinessCard: React.FC<ReadinessCardProps> = ({
  balanceG,
  dailyClaimG = 0,
  onCashOutClick,
  onAddClick,
  isStale = false,
  ngnPerUsdt = null,
  history = [],
  onLastCashOutClick,
}) => {
  const t = getTranslations('en');
  const rate = getCashoutRate(balanceG, dailyClaimG, ngnPerUsdt);
  const percent = getBalanceProgressPercent(balanceG);
  const minimumReached = rate.minimumReached;

  // Naira display helpers
  const nairaStr = rate.rateUnavailable
    ? t.nairaUnavailable
    : formatNaira(rate.netNaira);

  const minNaira = ngnPerUsdt != null && Number.isFinite(ngnPerUsdt)
    ? formatNaira(nairaFromUsdt(MIN_NET_USDT_REQUIRED, ngnPerUsdt))
    : t.nairaUnavailable;

  // Last cash out from history
  const lastCashOut = history.length > 0 ? history[0] : null;

  return (
    <>
      {/* ── Balance card ────────────────────────────────────────────── */}
      <div className="gc-card">
        <div className="gc-coin">G$</div>
        <div className="gc-lab">{t.yourBalance}</div>
        <div className="gc-big gc-big--home-desktop">{formatG(balanceG)}</div>
        <div className="gc-sm">
          {t.aboutNairaAfterFees.replace('{naira}', nairaStr)}
        </div>
        <div className="gc-bar">
          <div className="gc-bar__fill" style={{ width: `${percent}%` }} />
        </div>
        <div className="gc-sm">
          {minimumReached
            ? t.readyToCashOutShort
            : t.gToGo.replace('{n}', Math.ceil(rate.remainingG).toLocaleString())}
        </div>
        <div className="gc-sticker">{percent}%</div>
      </div>

      {/* ── First payout card ───────────────────────────────────────── */}
      <div className="gc-card">
        <div className="gc-lab">{t.firstPayout}</div>
        <div className="gc-sm" style={{ marginTop: '2px' }}>
          {t.minimumCashOutAbout.replace('{g}', getMinimumCashOutG().toLocaleString()).replace('{naira}', minNaira)}
        </div>
      </div>

      {/* ── Last cash out (mobile only) ─────────────────────────────── */}
      {lastCashOut && (
        <div
          className="gc-card gc-mobile-only"
          onClick={onLastCashOutClick}
          style={{ cursor: onLastCashOutClick ? 'pointer' : 'default' }}
        >
          <div className="gc-row">
            <div>
              <div className="gc-lab">{t.lastCashOut}</div>
              <div className="gc-sm" style={{ marginTop: '2px' }}>
                {lastCashOut.amountInG.toLocaleString()} G$ → ₦{Math.round(nairaFromUsdt(lastCashOut.amountOutUsdt || 0, ngnPerUsdt || 0)).toLocaleString()}
              </div>
            </div>
            <span className="gc-sm">{formatDateShort(lastCashOut.timestamp)}</span>
          </div>
        </div>
      )}

      {/* ── Main button ─────────────────────────────────────────────── */}
      {minimumReached ? (
        <button type="button" onClick={onCashOutClick} className="gc-btn gc-hit w-full">
          {t.cashOut}
        </button>
      ) : (
        <button type="button" disabled className="gc-btn gc-btn--dis gc-hit w-full">
          {t.cashOutOpensAt.replace('{n}', Math.ceil(rate.remainingG).toLocaleString())}
        </button>
      )}

      {onAddClick && (
        <button type="button" onClick={onAddClick} className="gc-btn gc-btn--white gc-hit w-full" style={{ marginTop: 10 }}>
          Add G$ with naira
        </button>
      )}

      {isStale && (
        <div className="gc-sm" style={{ textAlign: 'center', marginTop: '8px', color: 'var(--gc-mute, #6b6585)' }}>
          Balance refresh pending
        </div>
      )}
    </>
  );
};
