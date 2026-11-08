import React, { useEffect, useState } from 'react';
import { MagicWidget } from '@magic-ext/wallet-kit';
import { getMagic, MAGIC_WALLETS, type MagicLoginResult } from '../lib/magicWallet';

interface Props {
  onConnected: (result: MagicLoginResult) => void;
  onError: (error: unknown) => void;
  onClose: () => void;
}

/**
 * The "Connect wallet" panel from Magic's Wallet Kit, shown as a pop-up. It is loaded on demand: the Magic SDK
 * must be created first (it carries the Wallet Kit extension the panel needs).
 */
export default function MagicConnect({ onConnected, onError, onClose }: Props) {
  const [ready, setReady] = useState(false);

  useEffect(() => {
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
  }, []);

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
      wallets={[...MAGIC_WALLETS]}
      closeOnSuccess
      closeOnClickOutside
      onClose={onClose}
      onSuccess={(result) => onConnected(result as unknown as MagicLoginResult)}
      onError={(e) => onError(e)}
    />
  );
}
