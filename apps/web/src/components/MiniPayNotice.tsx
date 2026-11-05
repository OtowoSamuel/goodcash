import React, { useState } from 'react';
import { copyCurrentUrl } from '../lib/mobile';

export const MiniPayNotice: React.FC = () => {
  const [copied, setCopied] = useState(false);

  const handleCopyLink = async () => {
    const succeeded = await copyCurrentUrl();
    setCopied(succeeded);
    if (succeeded) {
      window.setTimeout(() => setCopied(false), 2200);
    }
  };

  return (
    <div className="w-full max-w-2xl rounded-2xl border border-amber-400/40 bg-amber-500/10 p-6 shadow-xl shadow-amber-900/20">
      <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-amber-300/40 bg-amber-500/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.14em] text-amber-200">
        Browser required
      </div>

      <h2 className="text-2xl font-bold text-white">MiniPay does not support G$</h2>
      <p className="mt-3 text-sm leading-6 text-white/75">
        GoodCash needs a wallet that can hold G$ and complete the claim flow. MiniPay does not support G$ and cannot be used for this product.
      </p>
      <p className="mt-3 text-sm leading-6 text-white/75">
        We do not connect the MiniPay wallet, do not show your address, and we do not run any claim or swap flow inside MiniPay.
      </p>

      <div className="mt-5 flex flex-col gap-3 sm:flex-row">
        <button
          type="button"
          onClick={handleCopyLink}
          className="inline-flex items-center justify-center rounded-xl bg-[#7b39fc] px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-[#7b39fc]/30 transition hover:bg-[#8c4eff]"
        >
          {copied ? 'Link copied' : 'Copy GoodCash link'}
        </button>
        <a
          href={typeof window !== 'undefined' ? window.location.href : '/'}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center justify-center rounded-xl border border-white/15 bg-white/5 px-4 py-2.5 text-sm font-semibold text-white/80 transition hover:border-white/25 hover:text-white"
        >
          Open in browser
        </a>
      </div>

      <div className="mt-5 rounded-xl border border-white/10 bg-[#120e20]/50 p-3 text-xs text-white/60">
        No wallet address is displayed or copied here. If you want to continue, open this page in a regular browser with a Celo wallet that supports G$.
      </div>
    </div>
  );
};
