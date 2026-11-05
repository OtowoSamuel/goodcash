import React, { useState } from 'react';
import type { Language } from '../lib/i18n';
import { translations } from '../lib/i18n';

interface SafetyBannerProps {
  language: Language;
}

export const ROUTER_ADDRESS = '0xA4338586d4B2f0E1641C54b8cF0d53CD06B5c407';
export const BLOCKSCOUT_URL = `https://celo.blockscout.com/address/${ROUTER_ADDRESS}`;

export const SafetyBanner: React.FC<SafetyBannerProps> = ({ language }) => {
  const t = translations[language] || translations.en;
  const [isDismissed, setIsDismissed] = useState(false);

  if (isDismissed) return null;

  return (
    <aside aria-label="Security Notice" className="w-full max-w-4xl mx-auto px-4 my-2">
      <div className="bg-[#1f1738]/90 border border-purple-500/30 rounded-xl p-3 sm:px-5 flex flex-col sm:flex-row items-center justify-between gap-3 shadow-md backdrop-blur-md">
        <div className="flex items-center gap-2.5 text-xs sm:text-sm text-purple-200 font-manrope">
          <span className="text-amber-400 text-base">🛡️</span>
          <span>
            <strong className="text-white font-semibold">Security Guard:</strong> {t.safetyBanner}
          </span>
        </div>

        <div className="flex items-center gap-2 text-xs">
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 font-manrope text-[11px] font-medium">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping" />
            Verified
          </span>
          <a
            href={BLOCKSCOUT_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="text-purple-300 hover:text-white underline underline-offset-2 font-mono text-[11px] transition-colors"
          >
            0xA433...c407 ↗
          </a>
          <button
            type="button"
            onClick={() => setIsDismissed(true)}
            aria-label="Dismiss safety notice"
            className="rounded-full border border-white/10 bg-white/5 px-2 py-1 text-[10px] uppercase tracking-[0.12em] text-[#C4B5FD]"
          >
            Dismiss
          </button>
        </div>
      </div>
    </aside>
  );
};
