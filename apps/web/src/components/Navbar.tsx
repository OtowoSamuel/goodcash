import React, { useState } from 'react';
import type { Language } from '../lib/i18n';
import { ROUTER_ADDRESS, BLOCKSCOUT_URL } from './SafetyBanner';

export interface NavbarProps {
  currentTab: 'home' | 'cashout' | 'history' | 'claim' | 'offramp';
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
  isMiniPayBlocked = false,
  isDemoMode = false,
}) => {
  const [walletMenuOpen, setWalletMenuOpen] = useState(false);

  const shortenAddress = (addr: string) => `${addr.slice(0, 6)}…${addr.slice(-4)}`;

  const tabs: Array<{ key: 'home' | 'cashout' | 'history'; label: string }> = [
    { key: 'home', label: 'Home' },
    { key: 'cashout', label: 'Cash out' },
    { key: 'history', label: 'History' },
  ];

  const handleWalletClick = () => {
    if (walletAddress) {
      setWalletMenuOpen((open) => !open);
    } else {
      onConnectWallet();
    }
  };

  return (
    <>
      {/* ── Desktop Top Bar (900px and up) ── */}
      <header className="gc-desktop-only gc-bar-top" style={{ position: 'relative', zIndex: 30 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <button
            type="button"
            onClick={() => onSelectTab('home')}
            className="gc-logo"
            style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: 0 }}
          >
            GoodCash
          </button>
          {isDemoMode && (
            <span className="gc-pill gc-pill--yellow" aria-label="Demo mode active">
              Demo
            </span>
          )}
        </div>

        {/* Desktop centre pill nav with exactly 3 items */}
        <nav className="gc-nav-desktop" aria-label="Main Navigation Desktop">
          {tabs.map((tab) => {
            const isActive = currentTab === tab.key;
            return (
              <button
                key={tab.key}
                type="button"
                onClick={() => onSelectTab(tab.key)}
                className={`gc-nav-desktop__item gc-hit ${isActive ? 'gc-nav-desktop__item--on' : ''}`}
                aria-current={isActive ? 'page' : undefined}
              >
                {tab.label}
              </button>
            );
          })}
        </nav>

        {/* Right wallet chip */}
        <div style={{ position: 'relative' }}>
          <button
            type="button"
            onClick={handleWalletClick}
            className="gc-chip gc-hit"
            style={{ cursor: 'pointer' }}
          >
            {isMiniPayBlocked
              ? 'Browser only'
              : walletAddress
              ? shortenAddress(walletAddress)
              : 'Connect wallet'}
          </button>

          {walletMenuOpen && walletAddress && (
            <div
              className="gc-card"
              style={{
                position: 'absolute',
                right: 0,
                top: 'calc(100% + 8px)',
                width: '240px',
                zIndex: 50,
                padding: '10px 12px',
                textAlign: 'left',
              }}
            >
              <div className="gc-lab" style={{ color: '#666', marginBottom: '4px' }}>
                Connected wallet
              </div>
              <div
                className="gc-inter"
                style={{ fontSize: '11px', wordBreak: 'break-all', marginBottom: '10px' }}
              >
                {walletAddress}
              </div>
              <a
                href={`https://celo.blockscout.com/address/${walletAddress}`}
                target="_blank"
                rel="noopener noreferrer"
                className="gc-sm"
                style={{ display: 'block', color: 'var(--gc-pu)', marginBottom: '8px' }}
              >
                View on Blockscout ↗
              </a>
              <button
                type="button"
                onClick={() => {
                  onDisconnectWallet();
                  setWalletMenuOpen(false);
                }}
                className="gc-btn gc-btn--white gc-hit"
                style={{ height: '36px', fontSize: '13px' }}
              >
                Disconnect
              </button>
            </div>
          )}
        </div>
      </header>

      {/* ── Mobile Top Row (below 900px) ── */}
      <header className="gc-mobile-only gc-top" style={{ position: 'relative', zIndex: 30 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <button
            type="button"
            onClick={() => onSelectTab('home')}
            className="gc-logo"
            style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: 0 }}
          >
            GoodCash
          </button>
          {isDemoMode && (
            <span className="gc-pill gc-pill--yellow" aria-label="Demo mode active">
              Demo
            </span>
          )}
        </div>

        <div style={{ position: 'relative' }}>
          <button
            type="button"
            onClick={handleWalletClick}
            className="gc-chip gc-hit"
            style={{ cursor: 'pointer' }}
          >
            {isMiniPayBlocked
              ? 'Browser only'
              : walletAddress
              ? shortenAddress(walletAddress)
              : 'Connect'}
          </button>

          {walletMenuOpen && walletAddress && (
            <div
              className="gc-card"
              style={{
                position: 'absolute',
                right: 0,
                top: 'calc(100% + 8px)',
                width: '220px',
                zIndex: 50,
                padding: '10px 12px',
                textAlign: 'left',
              }}
            >
              <div className="gc-lab" style={{ color: '#666', marginBottom: '4px' }}>
                Connected
              </div>
              <div
                className="gc-inter"
                style={{ fontSize: '11px', wordBreak: 'break-all', marginBottom: '8px' }}
              >
                {walletAddress}
              </div>
              <button
                type="button"
                onClick={() => {
                  onDisconnectWallet();
                  setWalletMenuOpen(false);
                }}
                className="gc-btn gc-btn--white gc-hit"
                style={{ height: '34px', fontSize: '12px' }}
              >
                Disconnect
              </button>
            </div>
          )}
        </div>
      </header>

      {/* ── Mobile Bottom Pill Nav (below 900px) ── */}
      <nav
        className="gc-mobile-only gc-nav"
        aria-label="Main Navigation Mobile"
        style={{
          position: 'sticky',
          bottom: '10px',
          zIndex: 40,
          marginTop: 'auto',
        }}
      >
        {tabs.map((tab) => {
          const isActive = currentTab === tab.key;
          return (
            <button
              key={tab.key}
              type="button"
              onClick={() => onSelectTab(tab.key)}
              className={`gc-nav__item gc-hit ${isActive ? 'gc-nav__item--on' : ''}`}
              aria-current={isActive ? 'page' : undefined}
            >
              {tab.label}
            </button>
          );
        })}
      </nav>
    </>
  );
};
export { ROUTER_ADDRESS, BLOCKSCOUT_URL };
