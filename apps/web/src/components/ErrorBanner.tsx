import React from 'react';
import type { Language } from '../lib/i18n';
import { getTranslations } from '../lib/i18n';

interface ErrorBannerProps {
  message: string;
  onRetry?: () => void;
  language?: Language;
  ariaLabel?: string;
}

export const ErrorBanner: React.FC<ErrorBannerProps> = ({ message, onRetry, language, ariaLabel }) => {
  const t = language ? getTranslations(language) : undefined;

  return (
    <div
      className="rounded-xl border border-red-500/40 bg-red-500/10 p-3 mt-3"
      aria-live="polite"
      aria-label={ariaLabel || 'Error'}
    >
      <div className="flex items-start gap-2">
        <span className="font-semibold text-red-100 text-xs">
          {t?.errorSwapFailed || 'Swap failed.'}:{' '}
        </span>
        <span className="text-xs text-red-200">{message}</span>
      </div>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="gc-hit mt-2 inline-flex items-center justify-center rounded-xl bg-[#7b39fc] px-3 py-1.5 text-xs font-semibold text-white shadow-lg shadow-[#7b39fc]/30 transition hover:bg-[#8c4eff] focus-visible:outline focus-visible:outline-3 focus-visible:outline-black focus-visible:outline-offset-2"
        >
          {t?.retryAction || 'Retry'}
        </button>
      )}
    </div>
  );
};
