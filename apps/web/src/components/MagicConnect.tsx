import React, { useEffect, useState } from 'react';
import { MagicWidget } from '@magic-ext/wallet-kit';
import { getMagic, browserHasWallet, walletsForBrowser, type MagicLoginResult } from '../lib/magicWallet';
import { Modal } from './Modal';
import { connectWithWalletConnect, WALLETCONNECT_ENABLED } from '../lib/walletConnect';
import { connectOkx, isPhoneBrowser, okxAppLink, okxProvider } from '../lib/okxWallet';

interface Props {
  onConnected: (result: MagicLoginResult) => void;
  onError: (error: unknown, stage?: 'panel' | 'after-login') => void;
  onClose: () => void;
  /** A wallet app on the customer's phone connected (straight to Celo, outside Magic's panel). */
  onWalletApp: (address: string) => void;
}

/**
 * The "Connect wallet" panel from Magic's Wallet Kit, shown as a pop-up. It is loaded on demand: the Magic SDK
 * must be created first (it carries the Wallet Kit extension the panel needs).
 */
export default function MagicConnect({ onConnected, onError, onClose, onWalletApp }: Props) {
  const [ready, setReady] = useState(false);
  // A browser with no wallet in it (a phone browser, or a computer without a wallet extension) first asks how to
  // connect. Magic's own wallet list only knows Ethereum, not Celo, so wallet apps connect through our own link
  // that asks for Celo. Email and passkey sign-in stay with Magic.
  // A browser with OKX Wallet in it also asks first, so OKX can be picked (Magic's own list has no OKX).
  const hasOkx = okxProvider() !== null;
  const [choice, setChoice] = useState<'ask' | 'magic'>(() => (browserHasWallet() && !hasOkx ? 'magic' : 'ask'));
  const [busy, setBusy] = useState(false);

  const useWalletApp = async () => {
    if (busy) return;
    setBusy(true);
    try {
      onWalletApp(await connectWithWalletConnect());
    } catch (e) {
      onError(e);
    }
  };

  const useOkx = async () => {
    if (busy) return;
    setBusy(true);
    try {
      onWalletApp(await connectOkx());
    } catch (e) {
      setBusy(false);
      onError(e);
    }
  };

  useEffect(() => {
    if (choice !== 'magic') return;
    let alive = true;
    getMagic()
      .then(() => alive && setReady(true))
      .catch((e) => {
        if (alive) onError(e);
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [choice]);

  if (choice === 'ask') {
    return (
      <Modal label="Connect" title="Connect" onClose={onClose} z={220} tone="white">
        {hasOkx && (
          <button type="button" className="gc-btn" disabled={busy} onClick={useOkx}>
            {busy ? 'Opening your wallet…' : 'OKX Wallet'}
          </button>
        )}
        {WALLETCONNECT_ENABLED && (
          <button type="button" className={hasOkx ? 'gc-btn gc-btn--white' : 'gc-btn'} disabled={busy} onClick={useWalletApp}>
            {busy ? 'Opening your wallet…' : 'Use my wallet app'}
          </button>
        )}
        {!hasOkx && !browserHasWallet() && isPhoneBrowser() && (
          <a className="gc-btn gc-btn--white" style={{ textAlign: 'center', textDecoration: 'none' }} href={okxAppLink(window.location.href)}>
            Open in OKX Wallet
          </a>
        )}
        <button type="button" className="gc-btn gc-btn--white" disabled={busy} onClick={() => setChoice('magic')}>
          {browserHasWallet() ? 'Other wallets, email or passkey' : 'Sign in with email or passkey'}
        </button>
      </Modal>
    );
  }

  if (!ready) {
    return (
      <div className="gc fixed inset-0 z-[220] flex items-center justify-center p-3" style={{ background: 'rgba(17, 17, 17, 0.55)', minHeight: 0 }} role="status">
        <div className="gc-card">Opening your wallet options…</div>
      </div>
    );
  }

  return (
    <MagicWidget
      displayMode="modal"
      isOpen
      // Only a browser with a wallet inside it lists wallets here; everyone else uses the choice above
      wallets={browserHasWallet() ? [...walletsForBrowser(true)] : []}
      closeOnSuccess
      closeOnClickOutside
      onClose={onClose}
      onSuccess={(result) => onConnected(result as unknown as MagicLoginResult)}
      onError={(e) => onError(e)}
    />
  );
}
