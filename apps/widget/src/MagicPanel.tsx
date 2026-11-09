import React, { useEffect, useState } from 'react';
import { MagicWidget } from '@magic-ext/wallet-kit';
import { getMagic, walletsForBrowser, type MagicLoginResult } from './wallet';

interface Props {
  onConnected: (result: MagicLoginResult) => void;
  onError: (error: unknown) => void;
  onClose: () => void;
}

/** Magic's "Connect wallet" panel (loaded on demand: the Magic SDK must exist first, it carries the Wallet Kit). */
export default function MagicPanel({ onConnected, onError, onClose }: Props) {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let alive = true;
    getMagic()
      .then(() => alive && setReady(true))
      .catch((e) => alive && onError(e));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  if (!ready) return <p role="status">Opening your wallet options…</p>;
  return (
    <MagicWidget
      displayMode="modal"
      isOpen
      wallets={[...walletsForBrowser()]}
      closeOnSuccess
      closeOnClickOutside
      onClose={onClose}
      onSuccess={(result) => onConnected(result as unknown as MagicLoginResult)}
      onError={(e) => onError(e)}
    />
  );
}
