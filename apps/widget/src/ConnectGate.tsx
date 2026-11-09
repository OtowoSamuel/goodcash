import React, { Suspense, useEffect, useState } from 'react';
import { GOODCASH_CSS, themeVars, type GoodCashTheme } from '@goodcash/react';
import { connectInjected, finishMagicLogin, friendlyConnectError, injectedProvider, MAGIC_ENABLED, restoreMagic, type ConnectedWallet, type MagicLoginResult } from './wallet';

const MagicPanel = React.lazy(() => import('./MagicPanel'));

function ensureStyles() {
  if (typeof document === 'undefined' || document.querySelector('style[data-goodcash]')) return;
  const el = document.createElement('style');
  el.setAttribute('data-goodcash', '');
  el.textContent = GOODCASH_CSS;
  document.head.appendChild(el);
}

interface Props {
  theme: GoodCashTheme;
  onConnected: (w: ConnectedWallet) => void;
  onClose?: () => void;
}

/** "Connect your wallet": shown before the cash-out flow when a live cash out needs a wallet. */
export function ConnectGate({ theme, onConnected, onClose }: Props) {
  ensureStyles();
  const [panel, setPanel] = useState(false);
  const [busy, setBusy] = useState(false);
  const [restoring, setRestoring] = useState(MAGIC_ENABLED);
  const [error, setError] = useState<string | null>(null);
  const injected = injectedProvider();

  // A returning customer: reconnect silently
  useEffect(() => {
    if (!MAGIC_ENABLED) return;
    let alive = true;
    restoreMagic().then((w) => {
      if (!alive) return;
      if (w) onConnected(w);
      else setRestoring(false);
    });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function useBrowserWallet() {
    if (!injected) return;
    setBusy(true);
    setError(null);
    try {
      onConnected(await connectInjected(injected));
    } catch (e) {
      setError(friendlyConnectError(e));
    } finally {
      setBusy(false);
    }
  }

  async function panelConnected(result: MagicLoginResult) {
    setPanel(false);
    setBusy(true);
    setError(null);
    try {
      onConnected(await finishMagicLogin(result));
    } catch (e) {
      setError(friendlyConnectError(e));
    } finally {
      setBusy(false);
    }
  }

  const dark = theme.mode === 'dark' || (theme.mode === 'auto' && typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-color-scheme: dark)').matches);
  const vars = themeVars(theme, dark) as React.CSSProperties;
  return (
    <div className="gcw" style={vars} data-goodcash-connect="">
      <div className="gcw-top">
        <h2 className="gcw-h">Connect your wallet</h2>
        {onClose && (
          <button type="button" className="gcw-x" aria-label="Close" onClick={onClose}>
            ✕
          </button>
        )}
      </div>
      <p className="gcw-sub">Your G$ stays in your wallet until you confirm the cash out.</p>
      {restoring ? (
        <div className="gcw-card" role="status" aria-live="polite">
          <div className="gcw-spin" aria-hidden />
          <p className="gcw-sub" style={{ textAlign: 'center' }}>
            Checking for your wallet…
          </p>
        </div>
      ) : (
        <>
          {error && (
            <p className="gcw-err" role="alert">
              {error}
            </p>
          )}
          {injected && (
            <button type="button" className="gcw-btn" disabled={busy} onClick={useBrowserWallet}>
              Use this browser's wallet
            </button>
          )}
          {MAGIC_ENABLED && (
            <button type="button" className={injected ? 'gcw-btn gcw-btn--ghost' : 'gcw-btn'} disabled={busy} onClick={() => setPanel(true)}>
              {injected ? 'Other wallets or email' : 'Choose a wallet'}
            </button>
          )}
          {!injected && !MAGIC_ENABLED && (
            <p className="gcw-note">No wallet was found. Open cash out inside your wallet app's browser (for example MiniPay), or on a device with a wallet.</p>
          )}
        </>
      )}
      {panel && (
        <Suspense fallback={<p role="status">Opening your wallet options…</p>}>
          <MagicPanel
            onConnected={panelConnected}
            onError={(e) => {
              setPanel(false);
              setError(friendlyConnectError(e));
            }}
            onClose={() => setPanel(false)}
          />
        </Suspense>
      )}
      <p className="gcw-foot">Powered by GoodCash</p>
    </div>
  );
}
