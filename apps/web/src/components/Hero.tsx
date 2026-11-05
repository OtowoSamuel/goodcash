import React from 'react';
import type { Language } from '../lib/i18n';
import { translations } from '../lib/i18n';

interface HeroProps {
  onCashOutClick: () => void;
  onClaimClick: () => void;
  language: Language;
}

export const Hero: React.FC<HeroProps> = ({ onCashOutClick, onClaimClick, language }) => {
  const t = translations[language] || translations.en;

  return (
    <div className="relative w-full flex flex-col items-center text-center pt-8 pb-12 px-6 z-10">
      {/* Tagline Pill */}
      <div className="inline-flex items-center gap-2.5 h-[38px] px-3.5 rounded-[10px] bg-[rgba(85,80,110,0.4)] backdrop-blur-md border border-[rgba(164,132,215,0.5)] shadow-lg shadow-purple-950/40 mb-6">
        <span className="bg-[#7b39fc] text-white text-[11px] font-cabin font-bold px-2 py-0.5 rounded-[6px] tracking-wide uppercase">
          New
        </span>
        <span className="font-cabin font-medium text-[14px] text-white tracking-tight">
          Say Hello to GoodCash Router v1.0
        </span>
      </div>

      {/* Headline (Instrument Serif) */}
      <h1 className="font-serif text-white text-5xl md:text-[84px] lg:text-[96px] leading-[1.08] tracking-tight max-w-5xl mb-6 font-normal">
        {t.heroHeadlinePre}{' '}
        <span className="italic font-normal tracking-wide px-1 text-purple-200">
          {t.heroHeadlineItalic}
        </span>{' '}
        {t.heroHeadlinePost}
      </h1>

      {/* Subtext (Inter) */}
      <p className="font-sans font-normal text-white/70 text-base md:text-[18px] leading-relaxed max-w-[662px] mb-8">
        {t.heroSubtext}
      </p>

      {/* Call to Action Buttons (Row) */}
      <div className="flex flex-col sm:flex-row items-center gap-4 w-full sm:w-auto">
        <button
          onClick={onCashOutClick}
          className="w-full sm:w-auto bg-[#7b39fc] hover:bg-[#8c4eff] active:scale-95 transition-all duration-200 text-white font-cabin font-medium text-[16px] px-8 py-3.5 rounded-[10px] shadow-lg shadow-[#7b39fc]/30 flex items-center justify-center gap-2"
        >
          <span>{t.cashOutNow}</span>
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" />
          </svg>
        </button>

        <button
          onClick={onClaimClick}
          className="w-full sm:w-auto bg-[#2b2344] hover:bg-[#382e58] active:scale-95 transition-all duration-200 text-[#f6f7f9] font-cabin font-medium text-[16px] px-8 py-3.5 rounded-[10px] border border-purple-400/30 flex items-center justify-center gap-2"
        >
          <span>{t.claimUbi}</span>
          <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
        </button>
      </div>
    </div>
  );
};
