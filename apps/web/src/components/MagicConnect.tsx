import React, { useEffect, useState } from 'react';
import { MagicWidget } from '@magic-ext/wallet-kit';
import { getMagic, browserHasWallet, walletsForBrowser, type MagicLoginResult } from '../lib/magicWallet';
import { Modal } from './Modal';
import { connectWithWalletConnect, WALLETCONNECT_ENABLED } from '../lib/walletConnect';

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
  const [choice, setChoice] = useState<'ask' | 'magic'>(() => (browserHasWallet() ? 'magic' : 'ask'));
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
        {WALLETCONNECT_ENABLED && (
          <button type="button" className="gc-btn" disabled={busy} onClick={useWalletApp}>
            {busy ? 'Opening your wallet…' : 'Use my wallet app'}
          </button>
        )}
        <button type="button" className="gc-btn gc-btn--white" disabled={busy} onClick={() => setChoice('magic')}>
          Sign in with email or passkey
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
