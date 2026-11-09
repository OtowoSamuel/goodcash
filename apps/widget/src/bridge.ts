/** Talking to the partner page: events out, and (optionally) signing requests to the host's own wallet. */
import type { SendFunction } from '@goodcash/sdk';

export type HostMessage =
  | { source: 'goodcash'; type: 'ready' }
  | { source: 'goodcash'; type: 'cashout.created' | 'cashout.sent' | 'cashout.paid' | 'cashout.failed'; cashOut: unknown }
  | { source: 'goodcash'; type: 'closed' }
  | { source: 'goodcash'; type: 'sign_request'; id: string; tx: unknown };

export function hostWindow(): Window | null {
  if (typeof window === 'undefined') return null;
  if (window.opener && window.opener !== window) return window.opener as Window;
  if (window.parent && window.parent !== window) return window.parent;
  return null;
}

/** Post to the host, only ever to the one allowed origin (never "*"). */
export function postToHost(origin: string | null, msg: HostMessage): void {
  const w = hostWindow();
  if (!w || !origin) return;
  w.postMessage(msg, origin);
}

/** A signer that asks the host page to send the transaction with its own wallet, and waits for the hash. */
export function hostSigner(origin: string, timeoutMs = 10 * 60_000): SendFunction {
  return (tx) =>
    new Promise((resolve, reject) => {
      const id = `sig_${Math.random().toString(36).slice(2)}`;
      const timer = setTimeout(() => {
        window.removeEventListener('message', onMsg);
        reject(new Error('The app did not answer the signing request in time.'));
      }, timeoutMs);
      function onMsg(e: MessageEvent) {
        if (e.origin !== origin || e.source !== hostWindow()) return;
        const d = e.data as { source?: string; type?: string; id?: string; hash?: string; error?: { code?: number; message?: string } };
        if (d?.source !== 'goodcash-host' || d.type !== 'sign_result' || d.id !== id) return;
        clearTimeout(timer);
        window.removeEventListener('message', onMsg);
        if (d.hash && /^0x[0-9a-fA-F]{64}$/.test(d.hash)) resolve(d.hash as `0x${string}`);
        else reject(Object.assign(new Error(d.error?.message ?? 'The app could not sign.'), { code: d.error?.code }));
      }
      window.addEventListener('message', onMsg);
      postToHost(origin, { source: 'goodcash', type: 'sign_request', id, tx });
    });
}
