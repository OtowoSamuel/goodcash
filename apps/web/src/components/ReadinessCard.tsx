import React from 'react';
import type { Language } from '../lib/i18n';
import { getTranslations } from '../lib/i18n';
import { getCashoutRate, MIN_NET_USDT_REQUIRED } from '../lib/rate';
import type { SwapHistoryItem } from './HistoryCard';

/** Subset of the useClaim hook state needed by the Home claim card. */
export interface HomeClaimState {
  status: 'idle' | 'loading' | 'can_claim' | 'already_claimed' | 'not_verified' | 'error';
  entitlement: bigint;
  nextClaimTime: Date | null;
  verificationUrl: string | null;
  error: string | null;
  isLoading: boolean;
}

interface ReadinessCardProps {
  balanceG: number;
  dailyClaimG?: number;
  onCashOutClick: () => void;
  onClaimClick: () => void;
  language: Language;
  isLoading?: boolean;
  isStale?: boolean;
  ngnPerUsdt?: number | null;
  /** Most recent history items for the "Last cash out" card (mobile). */
  history?: SwapHistoryItem[];
  /** Called when the user taps the Last cash out card. */
  onLastCashOutClick?: () => void;
  /** Claim hook state from useClaim (wired in App.tsx). */
  claimState?: HomeClaimState;
  /** Refresh the claim state (for the error retry pill). */
  onClaimRefresh?: () => void;
}

function formatG(amount: number): string {
  return amount.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}

function formatNaira(naira: number): string {
  return '₦' + Math.round(naira).toLocaleString();
}

function formatCountdown(date: Date): string {
  const diff = date.getTime() - Date.now();
  if (diff <= 0) return 'soon';
  const h = Math.floor(diff / 3_600_000);
  const m = Math.floor((diff % 3_600_000) / 60_000);
  return `${h}h ${m}m`;
}

function formatDateShort(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) + ' ›';
}

export const ReadinessCard: React.FC<ReadinessCardProps> = ({
  balanceG,
  dailyClaimG = 0,
  onCashOutClick,
  onClaimClick,
  isStale = false,
  ngnPerUsdt = null,
  history = [],
  onLastCashOutClick,
  claimState,
  onClaimRefresh,
}) => {
  const t = getTranslations('en');
  const rate = getCashoutRate(balanceG, dailyClaimG, ngnPerUsdt);
  const percent = Math.min(100, Math.round((rate.netUsdt / MIN_NET_USDT_REQUIRED) * 100));
  const minimumReached = rate.minimumReached;

  // Naira display helpers
  const nairaStr = rate.rateUnavailable
    ? t.nairaUnavailable
    : formatNaira(rate.netNaira);

  const minNaira = ngnPerUsdt != null && Number.isFinite(ngnPerUsdt)
    ? formatNaira(MIN_NET_USDT_REQUIRED * ngnPerUsdt)
    : t.nairaUnavailable;

  // Last cash out from history
  const lastCashOut = history.length > 0 ? history[0] : null;

  // Claim card helpers
  const cs = claimState;
  const entitlementG = cs ? Number(cs.entitlement) / 1e18 : 0;

  // Single purple button rule: claim button is purple when cash-out button is NOT purple
  const claimBtnClass = minimumReached ? 'gc-btn gc-btn--white' : 'gc-btn';

  return (
    <>
      {/* ── Balance card ────────────────────────────────────────────── */}
      <div className="gc-card px-4 flex flex-col gap-4">
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
      <div className="gc-card px-4 flex flex-col gap-4">
        <div className="gc-lab">{t.firstPayout}</div>
        <div className="gc-sm" style={{ marginTop: '2px' }}>
          {t.minimumCashOutAbout.replace('{naira}', minNaira)}
        </div>
      </div>

      {/* ── Claim card ──────────────────────────────────────────────── */}
      <div className="gc-card px-4 flex flex-col gap-4">
        <div className="gc-lab">{t.todayClaim}</div>
        {cs?.isLoading ? (
          <div style={{ height: '42px', background: '#ede6ff', borderRadius: '8px', marginTop: '4px' }} />
        ) : (
          <div className="gc-big">{cs ? formatG(entitlementG) : '0.0'}</div>
        )}
        {/* Status line */}
        {cs?.status === 'can_claim' && (
          <div className="gc-sm" style={{ marginTop: '2px' }}>{t.availableToClaimNow}</div>
        )}
        {cs?.status === 'already_claimed' && cs.nextClaimTime && (
          <div className="gc-sm" style={{ marginTop: '2px' }}>
            {t.nextClaimIn.replace('{time}', formatCountdown(cs.nextClaimTime))}
          </div>
        )}
        {cs?.status === 'not_verified' && (
          <>
            <div className="gc-sm" style={{ marginTop: '2px' }}>{t.verificationNeeded}</div>
            {cs.verificationUrl && (
              <a
                href={cs.verificationUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="gc-sm"
                style={{ display: 'block', marginTop: '2px', color: 'var(--gc-pu)', textDecoration: 'underline' }}
              >
                {t.verifyAtGoodDollar}
              </a>
            )}
          </>
        )}
        {cs?.status === 'error' && (
          <div className="gc-note" style={{ marginTop: '4px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
            <span>{t.couldNotLoadClaim}</span>
            {onClaimRefresh && (
              <button type="button" onClick={onClaimRefresh} className="gc-pill gc-hit" style={{ cursor: 'pointer' }}>
                {t.retry}
              </button>
            )}
          </div>
        )}
        {cs?.status === 'idle' && !cs?.isLoading && (
          <div className="gc-sm" style={{ marginTop: '2px' }}>—</div>
        )}
        {/* Claim button — opens Claim screen, does NOT claim directly */}
        {cs?.status === 'can_claim' && (
          <button
            type="button"
            onClick={onClaimClick}
            className={`${claimBtnClass} gc-hit`}
            style={{ marginTop: '10px' }}
          >
            {t.claimTodayG}
          </button>
        )}
        {cs?.status === 'already_claimed' && (
          <button type="button" disabled className="gc-btn gc-btn--dis gc-hit" style={{ marginTop: '10px' }}>
            {t.comeBackLater}
          </button>
        )}
        {cs?.status === 'not_verified' && (
          <button type="button" disabled className="gc-btn gc-btn--dis gc-hit" style={{ marginTop: '10px' }}>
            {t.claimTodayG}
          </button>
        )}
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
                {lastCashOut.amountInG.toLocaleString()} G$ → ₦{Math.round((lastCashOut.amountOutUsdt || 0) * (ngnPerUsdt || 0)).toLocaleString()}
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

      {isStale && (
        <div className="gc-sm" style={{ textAlign: 'center', marginTop: '8px', color: 'var(--gc-mute, #6b6585)' }}>
          Balance refresh pending
        </div>
      )}
    </>
  );
};
