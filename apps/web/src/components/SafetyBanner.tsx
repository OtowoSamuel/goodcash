import React, { useState } from 'react';
import type { Language } from '../lib/i18n';

interface SafetyBannerProps {
  language: Language;
}

export const ROUTER_ADDRESS = '0xA4338586d4B2f0E1641C54b8cF0d53CD06B5c407';
export const BLOCKSCOUT_URL = `https://celo.blockscout.com/address/${ROUTER_ADDRESS}`;

export const SafetyBanner: React.FC<SafetyBannerProps> = () => {
  const [isDismissed, setIsDismissed] = useState(false);

  if (isDismissed) return null;

  return (
    <aside aria-label="Security Notice" style={{ width: '100%' }}>
      <div
        className="gc-note"
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '10px',
        }}
      >
        <span>
          Never share your seed phrase. GoodCash will never message you first.{' '}
          <a
            href={BLOCKSCOUT_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="gc-inter"
            style={{ color: 'var(--gc-pu)', textDecoration: 'underline' }}
          >
            Contract 0xA433…c407 ↗
          </a>
        </span>
        <button
          type="button"
          onClick={() => setIsDismissed(true)}
          aria-label="Dismiss safety notice"
          className="gc-hit"
          style={{
            background: 'transparent',
            border: 'none',
            font: '800 13px Inter',
            cursor: 'pointer',
            padding: '2px 6px',
            color: '#111',
            flex: 'none',
          }}
        >
          ✕
        </button>
      </div>
    </aside>
  );
};
