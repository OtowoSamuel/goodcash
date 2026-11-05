import React, { useState } from 'react';
import type { Language } from '../lib/i18n';
import { getCashoutRate } from '../lib/rate';

interface ClaimCardProps {
  isVerified: boolean;
  entitlementG: number;
  onClaimSuccess: (amountG: number) => void;
  language: Language;
}

export const ClaimCard: React.FC<ClaimCardProps> = ({
  isVerified,
  entitlementG,
  onClaimSuccess,
}) => {
  const [claiming, setClaiming] = useState(false);
  const [claimedToday, setClaimedToday] = useState(false);
  const rate = getCashoutRate(entitlementG);

  const handleClaim = async () => {
    if (!isVerified || entitlementG <= 0 || claimedToday) return;
    setClaiming(true);
    // Simulate claim execution delay
    setTimeout(() => {
      setClaiming(false);
      setClaimedToday(true);
      onClaimSuccess(entitlementG);
    }, 1200);
  };

  return (
    <div className="glass-panel rounded-2xl p-6 sm:p-8 w-full max-w-xl mx-auto shadow-2xl relative">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-xl font-manrope font-bold text-white flex items-center gap-2">
            Daily GoodDollar Claim
            <span className="text-xs font-cabin bg-[#7b39fc]/30 text-purple-200 px-2 py-0.5 rounded border border-purple-400/30">
              UBI
            </span>
          </h2>
          <p className="text-xs text-white/60 font-sans mt-0.5">
            Claim your basic income daily directly to your Celo wallet.
          </p>
        </div>

        {/* Verification Status */}
        <div>
          {isVerified ? (
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 text-xs font-cabin font-semibold">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
              Verified Citizen
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/40 text-xs font-cabin font-semibold">
              <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
              Unverified
            </span>
          )}
        </div>
      </div>

      {/* Claim Info Box */}
      <div className="bg-[#19132e]/80 border border-purple-400/20 rounded-xl p-5 mb-6 flex flex-col sm:flex-row items-center justify-between gap-4">
        <div>
          <span className="text-xs text-white/60 font-manrope block uppercase tracking-wider">
            Today's Entitlement
          </span>
          <div className="flex items-baseline gap-1.5 mt-1">
            <span className="text-3xl font-extrabold font-sans text-white">
              {claimedToday ? '0.00' : entitlementG.toFixed(2)}
            </span>
            <span className="font-cabin font-bold text-purple-300">G$</span>
          </div>
          <span className="text-xs text-white/50 font-sans">
            {claimedToday ? 'Next claim unlocks in ~21h' : 'Available to claim right now'}
          </span>
        </div>

        <div className="text-right sm:border-l sm:border-white/10 sm:pl-6 w-full sm:w-auto">
          <span className="text-xs text-white/60 font-manrope block">Estimated Net Value</span>
          <span className="text-lg font-bold font-sans text-emerald-400 mt-1 block">
            ≈ ${rate.netUsdt.toFixed(4)} USDT
          </span>
          <span className="text-[11px] text-white/40 block">Net after 10% exit contribution</span>
        </div>
      </div>

      {/* Verification Notice if not verified */}
      {!isVerified ? (
        <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-4 mb-6 text-left">
          <p className="text-xs font-manrope font-semibold text-amber-300 mb-1">
            GoodDollar Identity Verification Required
          </p>
          <p className="text-xs text-white/70 font-sans leading-relaxed mb-3">
            To prevent Sybil attacks and claim daily G$, GoodDollar requires a one-time 3D face verification scan.
          </p>
          <a
            href="https://wallet.gooddollar.org"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-xs text-[#a484d7] hover:text-white font-cabin font-semibold underline underline-offset-4"
          >
            Complete verification at wallet.gooddollar.org ↗
          </a>
        </div>
      ) : null}

      {/* Claim Action Button */}
      <button
        onClick={handleClaim}
        disabled={!isVerified || entitlementG <= 0 || claimedToday || claiming}
        className={`w-full py-3.5 px-6 rounded-xl font-cabin font-medium text-base transition-all duration-200 flex items-center justify-center gap-2 ${
          claimedToday
            ? 'bg-white/10 text-white/50 cursor-not-allowed border border-white/10'
            : isVerified && entitlementG > 0
            ? 'bg-[#7b39fc] hover:bg-[#8c4eff] active:scale-98 text-white shadow-lg shadow-[#7b39fc]/30 cursor-pointer'
            : 'bg-white/10 text-white/40 cursor-not-allowed border border-white/10'
        }`}
      >
        {claiming ? (
          <>
            <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-white" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
            </svg>
            <span>Claiming G$ from Celo UBI Scheme...</span>
          </>
        ) : claimedToday ? (
          <span>✓ Claimed Today (Come back tomorrow)</span>
        ) : isVerified ? (
          <span>Claim {entitlementG.toFixed(0)} G$ to Wallet</span>
        ) : (
          <span>Verify Wallet to Claim</span>
        )}
      </button>
    </div>
  );
};
