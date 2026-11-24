import { nairaFromUsdt } from '../lib/units';
import React from 'react';
import type { Language } from '../lib/i18n';
import { getTranslations } from '../lib/i18n';
import { getCashoutRate, getMinimumCashOutG } from '../lib/rate';
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
  /**
   * The wallet is short of CELO for the network fee (G$ cannot pay it). The cash-out button then helps them add it,
   * instead of looking ready and failing later.
   */
  celoShort?: { needCelo: number; haveCelo: number; celoUsd: number | null } | null;
  /** Opens adding CELO with naira */
  onAddCelo?: () => void;
  /** Opens "What it costs" */
  onSeeCosts?: () => void;
}

function formatG(amount: number): string {
  return amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
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
  celoShort = null,
  onAddCelo,
  onSeeCosts,
}) => {
  const t = getTranslations('en');
  const rate = getCashoutRate(balanceG, dailyClaimG, ngnPerUsdt);
  // With an empty wallet the per-G$ price is unknown, so count down from the minimum itself
  const gToGo = Math.max(rate.remainingG, getMinimumCashOutG() - balanceG, 0);
  const minimumReached = rate.minimumReached;

  // Naira display helpers
  const nairaStr = rate.rateUnavailable
    ? t.nairaUnavailable
    : formatNaira(rate.netNaira);


  // Last cash out from history
  const lastCashOut = history.length > 0 ? history[0] : null;

  // Enough G$ but not enough CELO for the network fee: say so on the card and the button, not only in a banner
  const needsCelo = minimumReached && !!celoShort;
  const missingCelo = celoShort ? Math.max(0, celoShort.needCelo - celoShort.haveCelo) : 0;
  const feeNaira =
    celoShort?.celoUsd && ngnPerUsdt ? Math.max(10, Math.ceil((missingCelo * celoShort.celoUsd * ngnPerUsdt) / 10) * 10) : null;

  return (
    <>
      {/* ── Balance card ────────────────────────────────────────────── */}
      <div className="gc-card">
        <div className="gc-coin">G$</div>
        <div className="gc-lab">{t.yourBalance}</div>
        {/* Long balances get a smaller size so they never run into the G$ coin */}
        <div className={`gc-big gc-big--home-desktop gc-big--balance${formatG(balanceG).length >= 12 ? ' gc-big--xlong' : formatG(balanceG).length >= 9 ? ' gc-big--long' : ''}`}>{formatG(balanceG)}</div>
        <div className="gc-naira">
          {t.aboutNairaAfterFees.replace('{naira}', nairaStr)}
        </div>
        {onSeeCosts && (
          <button type="button" className="gc-linkbtn gc-hit gc-see" onClick={onSeeCosts}>
            See breakdown
          </button>
        )}
        <div className="gc-divider" />
        {/* One status row with a dot (no progress bar or percent badge: they repeated this and could contradict it) */}
        <div className="gc-status">
          <span className={`gc-status__dot gc-status__dot--${needsCelo ? 'warn' : minimumReached ? 'ok' : 'wait'}`} aria-hidden="true" />
          <span>
            {needsCelo
              ? `Almost there. You need a small CELO fee${feeNaira ? ` (about ₦${feeNaira.toLocaleString('en-US')})` : ''}.`
              : minimumReached
                ? t.readyToCashOutShort
                : t.gToGo.replace('{n}', Math.ceil(gToGo).toLocaleString())}
          </span>
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
      {needsCelo ? (
        <>
          <button type="button" onClick={onAddCelo} disabled={!onAddCelo} className={`gc-btn gc-hit w-full${onAddCelo ? '' : ' gc-btn--dis'}`}>
            Add CELO to cash out
          </button>
          <div className="gc-help">Smallest top-up is ₦1,000. What's left stays in your wallet for next time.</div>
        </>
      ) : minimumReached ? (
        <button type="button" onClick={onCashOutClick} className="gc-btn gc-hit w-full">
          {t.cashOut}
        </button>
      ) : (
        <button type="button" disabled className="gc-btn gc-btn--dis gc-hit w-full">
          {t.cashOutOpensAt.replace('{n}', getMinimumCashOutG().toLocaleString())}
        </button>
      )}
      {onAddClick && !needsCelo && (
        <div style={{ textAlign: 'center' }}>
          <button type="button" onClick={onAddClick} className="gc-linkbtn gc-hit gc-buy">
            Need more G$? Buy with naira
          </button>
        </div>
      )}

      {isStale && (
        <div className="gc-sm" style={{ textAlign: 'center', marginTop: '8px', color: 'var(--gc-mute, #6b6585)' }}>
          Balance refresh pending
        </div>
      )}
    </>
  );
};
