import React from 'react';
import type { Language } from '../lib/i18n';
import { getCashoutRate, MIN_NET_USDT_REQUIRED } from '../lib/rate';

interface ReadinessCardProps {
  balanceG: number;
  dailyClaimG?: number;
  onCashOutClick: () => void;
  onClaimClick: () => void;
  language: Language;
  isLoading?: boolean;
  isStale?: boolean;
  ngnPerUsdt?: number | null;
}

export const ReadinessCard: React.FC<ReadinessCardProps> = ({
  balanceG,
  dailyClaimG = 123.48,
  onCashOutClick,
  onClaimClick,
  isStale = false,
  ngnPerUsdt,
}) => {
  const rate = getCashoutRate(balanceG, dailyClaimG, ngnPerUsdt);
  const progress = Math.min(100, Math.max(0, (rate.netUsdt / MIN_NET_USDT_REQUIRED) * 100));
  const minimumReached = rate.minimumReached;
  const remainingText = minimumReached
    ? 'Ready to cash out'
    : `About ${rate.daysToMinimum || 1} more days of claiming to cash out`;
  const buttonText = minimumReached ? 'Cash out' : "Claim today's G$";
  const buttonAction = minimumReached ? onCashOutClick : onClaimClick;

  return (
    <div className="panel-card w-full rounded-[28px] p-5 sm:p-6">
      <div className="mb-5">
        <p className="text-[11px] uppercase tracking-[0.14em] text-[#A39BBE]">G$ balance</p>
        <div className="mt-2 flex items-baseline gap-2">
          <span className="text-4xl font-bold tracking-[-0.06em] text-white sm:text-5xl">
            {balanceG.toLocaleString(undefined, { maximumFractionDigits: 2 })} G$
          </span>
        </div>
        <p className="mt-2 text-sm text-[#A39BBE]">
          {Number.isFinite(rate.netNaira) ? `₦${rate.netNaira.toLocaleString(undefined, { maximumFractionDigits: 2 })}` : 'Rate unavailable, try again'}
        </p>
      </div>

      <div className="rounded-2xl border border-[#2D204A] bg-[#120D1D] p-4">
        <div className="mb-3 flex items-center justify-between gap-3 text-[12px] text-[#A39BBE]">
          <span>
            {minimumReached
              ? `$${MIN_NET_USDT_REQUIRED.toFixed(2)} of $${MIN_NET_USDT_REQUIRED.toFixed(2)} reached`
              : `$${rate.remainingUsdt.toFixed(2)} of $${MIN_NET_USDT_REQUIRED.toFixed(2)} needed`}
          </span>
          <span className="font-semibold text-[#10B981]">{Math.round(progress)}%</span>
        </div>
        <div className="h-3 w-full overflow-hidden rounded-full bg-[#1B122E]">
          <div
            className="h-full rounded-full bg-gradient-to-r from-[#7C3AED] to-[#A78BFA]"
            style={{ width: `${Math.min(100, Math.max(0, progress))}%` }}
          />
        </div>
      </div>

      <div className="mt-5 rounded-2xl border border-[#2D204A] bg-[#1B122E] p-4 text-sm text-[#D9D0F4]">
        {remainingText}
      </div>

      <button
        type="button"
        onClick={buttonAction}
        className="mt-5 w-full rounded-2xl bg-[#7C3AED] px-4 py-3 text-sm font-semibold text-white shadow-[0_18px_32px_rgba(124,58,237,0.25)] transition hover:bg-[#8B5CF6]"
      >
        {buttonText}
      </button>

      {isStale && (
        <p className="mt-4 text-center text-[10px] uppercase tracking-[0.14em] text-[#A39BBE]">Balance refresh pending</p>
      )}
    </div>
  );
};
