import React from 'react';
import type { Language } from '../lib/i18n';
import { translations } from '../lib/i18n';

interface SuccessCardProps {
  txHash: string;
  usdtReceived: number;
  amountGSwapped: number;
  onDone: () => void;
  onContinueToOffRamp: () => void;
  language: Language;
}

export const SuccessCard: React.FC<SuccessCardProps> = ({
  txHash,
  usdtReceived,
  amountGSwapped,
  onDone,
  onContinueToOffRamp,
  language,
}) => {
  const t = translations[language] || translations.en;
  const explorerUrl = `https://celo.blockscout.com/tx/${txHash}`;
  const effectiveRate = usdtReceived / (amountGSwapped || 1);

  return (
    <div className="glass-panel rounded-2xl p-6 sm:p-8 w-full max-w-xl mx-auto shadow-2xl relative text-center animate-fade-in">
      {/* Success Badge */}
      <div className="w-16 h-16 rounded-full bg-emerald-500/20 border border-emerald-400/40 text-emerald-400 flex items-center justify-center mx-auto mb-5 text-2xl shadow-lg shadow-emerald-500/20">
        ✓
      </div>

      <h2 className="text-2xl font-serif text-white font-normal mb-1">
        Cash-Out Swap Successful!
      </h2>
      <p className="text-xs text-white/60 font-sans mb-6">
        Your GoodDollar tokens have been routed on Celo to liquid USDT.
      </p>

      {/* Received Amount Card */}
      <div className="bg-[#150f26] border border-emerald-500/30 rounded-xl p-5 mb-6 text-center">
        <span className="text-xs text-white/60 font-manrope uppercase tracking-wider block mb-1">
          Total USDT Received in Wallet
        </span>
        <div className="flex items-baseline justify-center gap-1.5">
          <span className="text-4xl font-extrabold font-sans text-emerald-400">
            {usdtReceived.toFixed(4)}
          </span>
          <span className="font-cabin font-bold text-white text-lg">USDT</span>
        </div>
        <span className="text-xs text-white/50 font-sans block mt-1">
          Effective Rate: ${effectiveRate.toFixed(8)} / G$
        </span>
      </div>

      {/* Verification & Audit Details */}
      <div className="bg-[#1a1430]/60 rounded-xl p-4 mb-6 text-left space-y-2 text-xs font-sans border border-white/5">
        <div className="flex justify-between items-center">
          <span className="text-white/60">G$ Swapped:</span>
          <span className="font-mono text-white font-medium">{amountGSwapped.toLocaleString()} G$</span>
        </div>
        <div className="flex justify-between items-center">
          <span className="text-white/60">Router Residual Balance:</span>
          <span className="font-mono text-emerald-400 font-medium">0 G$ / 0 USDT (Zero-dust verified)</span>
        </div>
        <div className="flex justify-between items-center pt-2 border-t border-white/5">
          <span className="text-white/60">On-Chain Explorer:</span>
          <a
            href={explorerUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-purple-300 hover:text-white underline font-mono text-[11px]"
          >
            {txHash.slice(0, 10)}...{txHash.slice(-8)} ↗
          </a>
        </div>
      </div>

      {/* Action Buttons */}
      <div className="flex flex-col sm:flex-row items-center gap-3">
        <button
          onClick={onDone}
          className="w-full sm:flex-1 py-3 px-4 rounded-xl bg-white/5 hover:bg-white/10 text-white/80 font-cabin font-medium text-sm border border-white/10"
        >
          Back to Dashboard
        </button>

        <button
          onClick={onContinueToOffRamp}
          className="w-full sm:flex-1 py-3 px-4 rounded-xl bg-[#7b39fc] hover:bg-[#8c4eff] active:scale-98 text-white font-cabin font-medium text-sm shadow-lg shadow-[#7b39fc]/30 flex items-center justify-center gap-1.5"
        >
          <span>{t.continueToNaira}</span>
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" />
          </svg>
        </button>
      </div>
    </div>
  );
};
