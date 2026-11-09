import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { GoodCash, type Signer } from '@goodcash/sdk';
import { CashOutFlow, GoodCashProvider, type CashOutEvent } from '@goodcash/react';
import { checkHost, readParams, type WidgetParams } from './params';
import { hostSigner, postToHost } from './bridge';
import { ConnectGate } from './ConnectGate';
import type { ConnectedWallet } from './wallet';
import { TopUpFlow, type TopUpEventType } from './topup/TopUpFlow';

const API_BASE = (import.meta.env.VITE_API_BASE as string | undefined) ?? 'https://api.goodcash.xyz';

function originOf(u: string | null | undefined): string | null {
  try {
    return u ? new URL(u).origin : null;
  } catch {
    return null;
  }
}

function Problem({ text, flow = 'cashout' }: { text: string; flow?: 'cashout' | 'topup' }) {
  return (
    <div style={{ font: '600 15px system-ui, sans-serif', background: '#fff', border: '2.5px solid #111', borderRadius: 18, padding: 16, maxWidth: 420 }} role="alert">
      <b>{flow === 'topup' ? "Adding money can't open here." : "Cash out can't open here."}</b>
      <p style={{ margin: '6px 0 0' }}>{text}</p>
    </div>
  );
}

function Widget({ p }: { p: WidgetParams }) {
  const [state, setState] = useState<{ ready: boolean; problem?: string; client?: GoodCash; name?: string }>({ ready: false });
  const [conn, setConn] = useState<ConnectedWallet | null>(null);

  useEffect(() => {
    if (p.mode === 'embed') document.body.classList.add('gc-embedded');
    const client = new GoodCash({ publishableKey: p.key, baseUrl: API_BASE, appId: p.appId });
    client
      .partner()
      .then((partner) => {
        const framed = window.parent !== window;
        const ancestor = (window.location as Location & { ancestorOrigins?: DOMStringList }).ancestorOrigins?.[0] ?? null;
        const problem = checkHost(p, (partner as { allowedOrigins?: string[] }).allowedOrigins ?? [], {
          ancestorOrigin: ancestor,
          referrerOrigin: originOf(document.referrer),
          framed,
        });
        if (problem) {
          console.warn(`[goodcash widget] ${problem}`);
          return setState({ ready: false, problem: "This app isn't set up correctly for cash out. Please contact the app's support." });
        }
        setState({ ready: true, client, name: partner.name });
        postToHost(p.hostOrigin, { source: 'goodcash', type: 'ready' });
      })
      .catch((e) => setState({ ready: false, problem: (e as Error).message }));
  }, [p]);

  // Escape closes (the key goes to this frame, not to the partner's page)
  useEffect(() => {
    if (p.mode === 'redirect') return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      postToHost(p.hostOrigin, { source: 'goodcash', type: 'closed' });
      if (p.mode === 'popup') window.close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [p]);

  if (state.problem) return <Problem text={state.problem} flow={p.flow} />;
  if (!state.ready || !state.client) return <div aria-busy="true" style={{ font: '600 15px system-ui', padding: 20 }}>Loading…</div>;

  const viaHost = p.bridge && !!p.wallet && !!p.hostOrigin;
  const theme = { accent: p.accent, mode: p.theme ?? ('light' as const) };

  const close = () => {
    postToHost(p.hostOrigin, { source: 'goodcash', type: 'closed' });
    if (p.mode === 'popup') window.close();
    if (p.mode === 'redirect' && p.returnUrl) window.location.assign(p.returnUrl);
  };

  // Adding G$/CELO: the customer pays naira, then signs once in THEIR OWN wallet (a host's embedded wallet is not supported yet)
  if (p.flow === 'topup') {
    if (state.client.mode === 'live' && !conn) {
      return <ConnectGate theme={theme} intro="Your G$ or CELO is sent straight to your own wallet." onConnected={setConn} onClose={close} />;
    }
    const onTopUp = (type: TopUpEventType, topUp: unknown) => {
      postToHost(p.hostOrigin, { source: 'goodcash', type, topUp });
      if (p.mode === 'redirect' && p.returnUrl && (type === 'topup.delivered' || type === 'topup.failed')) {
        const back = new URL(p.returnUrl);
        back.searchParams.set('goodcash_topup', (topUp as { id: string }).id);
        back.searchParams.set('status', (topUp as { status: string }).status);
        setTimeout(() => window.location.assign(back.toString()), 1500);
      }
    };
    return (
      <TopUpFlow
        client={state.client}
        theme={theme}
        wallet={conn?.address}
        provider={conn?.provider as never}
        apiBase={API_BASE}
        defaultNaira={p.amountNaira}
        defaultAsset={p.asset}
        partnerRef={p.partnerRef}
        onEvent={onTopUp}
        onClose={close}
      />
    );
  }

  // A live cash out needs a wallet: the host's (bridge), or one the customer connects here. Test keys never sign.
  if (state.client.mode === 'live' && !viaHost && !conn) return <ConnectGate theme={theme} onConnected={setConn} onClose={close} />;

  const signer: Signer | undefined = viaHost ? hostSigner(p.hostOrigin as string) : (conn?.provider as Signer | undefined);

  const onEvent = (e: CashOutEvent) => {
    if (e.type === 'closed') return;
    postToHost(p.hostOrigin, { source: 'goodcash', type: e.type, cashOut: e.cashOut });
    if (p.mode === 'redirect' && p.returnUrl && (e.type === 'cashout.sent' || e.type === 'cashout.failed')) {
      const back = new URL(p.returnUrl);
      back.searchParams.set('goodcash_cashout', e.cashOut.id);
      back.searchParams.set('status', e.cashOut.status);
      setTimeout(() => window.location.assign(back.toString()), 1500);
    }
  };

  return (
    <GoodCashProvider publishableKey={p.key} client={state.client} theme={theme}>
      <CashOutFlow signer={signer} wallet={conn?.address ?? p.wallet} defaultAmountG={p.amountG} partnerRef={p.partnerRef} onEvent={onEvent} onClose={close} />
    </GoodCashProvider>
  );
}

const parsed = readParams(window.location.search);
createRoot(document.getElementById('root')!).render(
  'error' in parsed ? <Problem text="This link is missing its app key. Please open cash out from the app again." /> : <Widget p={parsed} />
);
