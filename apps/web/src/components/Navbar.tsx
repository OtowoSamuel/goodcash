import React, { useState } from 'react';
import type { Language } from '../lib/i18n';

interface NavbarProps {
  currentTab: 'home' | 'cashout' | 'claim' | 'history' | 'offramp';
  onSelectTab: (tab: 'home' | 'cashout' | 'claim' | 'history' | 'offramp') => void;
  walletAddress: string | null;
  onConnectWallet: () => void;
  onDisconnectWallet: () => void;
  language: Language;
  onSelectLanguage: (lang: Language) => void;
  isMiniPayBlocked?: boolean;
  isDemoMode?: boolean;
}

export const Navbar: React.FC<NavbarProps> = ({
  currentTab,
  onSelectTab,
  walletAddress,
  onConnectWallet,
  onDisconnectWallet,
  language,
  onSelectLanguage,
  isMiniPayBlocked = false,
  isDemoMode = false,
}) => {
  const [walletMenuOpen, setWalletMenuOpen] = useState(false);

  const shortenAddress = (addr: string) => `${addr.slice(0, 6)}...${addr.slice(-4)}`;

  const tabItems: Array<{ key: 'home' | 'cashout' | 'claim' | 'history'; label: string }> = [
    { key: 'home', label: 'Home' },
    { key: 'claim', label: 'Claim UBI' },
    { key: 'cashout', label: 'Cash Out' },
    { key: 'history', label: 'History' },
  ];

  return (
    <>
      <nav className="relative z-20 w-full border-b border-[#2D204A]/80 bg-[#0F0A1C]/80 px-4 py-3 backdrop-blur-md sm:px-6">
        <div className="mx-auto flex max-w-4xl items-center justify-between gap-3">
          <button type="button" onClick={() => onSelectTab('home')} className="flex items-center gap-3 text-left">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-[#7C3AED] to-[#4C1D95] shadow-[0_0_20px_rgba(124,58,237,0.35)]">
              <svg viewBox="0 0 24 24" className="h-5 w-5 text-white" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M6 6.5C6 5.67157 6.67157 5 7.5 5H16.5C17.3284 5 18 5.67157 18 6.5V17.5C18 18.3284 17.3284 19 16.5 19H7.5C6.67157 19 6 18.3284 6 17.5V6.5Z" stroke="currentColor" strokeWidth="1.5"/>
                <path d="M10 9.5H15M10 12.5H15M10 15.5H13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
              </svg>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-lg font-semibold text-white">GoodCash</span>
              <span className="rounded-md border border-[#7C3AED]/50 bg-[#7C3AED]/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-[0.14em] text-[#C4B5FD]">
                Celo
              </span>
              {isDemoMode && (
                <span className="rounded-md border border-amber-500/50 bg-amber-500/20 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-[0.14em] text-amber-300">
                  Demo
                </span>
              )}
            </div>
          </button>

          <div className="flex items-center gap-2 sm:gap-3">
            <span className="hidden rounded-full border border-[#10B981]/30 bg-[#10B981]/10 px-2.5 py-1 text-[10px] font-medium uppercase tracking-[0.14em] text-[#A7F3D0] sm:inline-flex">
              Security verified
            </span>

            {isMiniPayBlocked ? (
              <span className="rounded-full border border-[#FBBF24]/40 bg-[#FBBF24]/10 px-2.5 py-1 text-[10px] font-medium uppercase tracking-[0.14em] text-[#FDE68A]">
                Browser only
              </span>
            ) : walletAddress ? (
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setWalletMenuOpen((open) => !open)}
                  className="rounded-full border border-[#2D204A] bg-[#1B122E] px-3 py-2 text-sm font-medium text-white shadow-[0_8px_24px_rgba(10,6,22,0.4)]"
                >
                  {shortenAddress(walletAddress)}
                </button>

                {walletMenuOpen && (
                  <div className="absolute right-0 top-[calc(100%+0.75rem)] w-56 rounded-2xl border border-[#2D204A] bg-[#1B122E] p-3 shadow-[0_18px_48px_rgba(10,6,22,0.7)]">
                    <div className="mb-3 border-b border-[#2D204A] pb-3">
                      <p className="text-[10px] uppercase tracking-[0.12em] text-[#A39BBE]">Connected wallet</p>
                      <p className="mt-1 break-all font-mono text-xs text-white">{walletAddress}</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        onDisconnectWallet();
                        setWalletMenuOpen(false);
                      }}
                      className="w-full rounded-xl border border-[#2D204A] bg-[#120d1b] px-3 py-2 text-left text-sm text-white transition hover:border-[#7C3AED]/50"
                    >
                      Disconnect
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <button
                type="button"
                onClick={onConnectWallet}
                className="rounded-full bg-[#7C3AED] px-3 py-2 text-sm font-semibold text-white shadow-[0_10px_25px_rgba(124,58,237,0.35)] transition hover:bg-[#8B5CF6]"
              >
                Connect
              </button>
            )}

            <select
              value={language}
              onChange={(e) => onSelectLanguage(e.target.value as Language)}
              aria-label="Select language"
              className="hidden rounded-full border border-[#2D204A] bg-[#1B122E] px-2.5 py-2 text-[10px] font-medium text-[#E5E7EB] outline-none sm:block"
            >
              <option value="en">EN</option>
              <option value="pcm">PCM</option>
              <option value="ha">HA</option>
              <option value="yo">YO</option>
              <option value="ig">IG</option>
            </select>
          </div>
        </div>
      </nav>

      <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-[#2D204A]/80 bg-[#0F0A1C]/95 px-2 py-2 backdrop-blur-md sm:hidden">
        <div className="mx-auto flex max-w-md items-center justify-between gap-1">
          {tabItems.map((item) => (
            <button
              key={item.key}
              type="button"
              onClick={() => onSelectTab(item.key)}
              className={`flex flex-1 flex-col items-center justify-center rounded-xl px-2 py-2 text-[10px] font-medium transition ${
                currentTab === item.key ? 'bg-[#7C3AED]/15 text-white' : 'text-[#A39BBE] hover:text-white'
              }`}
            >
              <span className="mb-1 h-1.5 w-1.5 rounded-full bg-current opacity-80" />
              {item.label}
            </button>
          ))}
        </div>
      </nav>
    </>
  );
};
