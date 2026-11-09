import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { GoodCash, type Signer } from '@goodcash/sdk';
import { CashOutFlow, GoodCashProvider, type CashOutEvent } from '@goodcash/react';
import { checkHost, readParams, type WidgetParams } from './params';
import { hostSigner, postToHost } from './bridge';

const API_BASE = (import.meta.env.VITE_API_BASE as string | undefined) ?? 'https://api.goodcash.xyz';

function originOf(u: string | null | undefined): string | null {
  try {
    return u ? new URL(u).origin : null;
  } catch {
    return null;
  }
}

function Problem({ text }: { text: string }) {
  return (
    <div style={{ font: '600 15px system-ui, sans-serif', background: '#fff', border: '2.5px solid #111', borderRadius: 18, padding: 16, maxWidth: 420 }} role="alert">
      <b>Cash out can't open here.</b>
      <p style={{ margin: '6px 0 0' }}>{text}</p>
    </div>
  );
}

function Widget({ p }: { p: WidgetParams }) {
  const [state, setState] = useState<{ ready: boolean; problem?: string; client?: GoodCash; name?: string }>({ ready: false });

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

  if (state.problem) return <Problem text={state.problem} />;
  if (!state.ready || !state.client) return <div aria-busy="true" style={{ font: '600 15px system-ui', padding: 20 }}>Loading…</div>;

  const signer: Signer | undefined = p.bridge && p.wallet && p.hostOrigin ? hostSigner(p.hostOrigin) : ((window as unknown as { ethereum?: Signer }).ethereum ?? undefined);

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

  const close = () => {
    postToHost(p.hostOrigin, { source: 'goodcash', type: 'closed' });
    if (p.mode === 'popup') window.close();
    if (p.mode === 'redirect' && p.returnUrl) window.location.assign(p.returnUrl);
  };

  return (
    <GoodCashProvider publishableKey={p.key} client={state.client} theme={{ accent: p.accent, mode: p.theme ?? 'light' }}>
      <CashOutFlow signer={signer} wallet={p.wallet} defaultAmountG={p.amountG} partnerRef={p.partnerRef} onEvent={onEvent} onClose={close} />
    </GoodCashProvider>
  );
}

const parsed = readParams(window.location.search);
createRoot(document.getElementById('root')!).render(
  'error' in parsed ? <Problem text="This link is missing its app key. Please open cash out from the app again." /> : <Widget p={parsed} />
);
