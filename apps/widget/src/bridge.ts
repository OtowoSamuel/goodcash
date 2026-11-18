/** Talking to the partner page: events out, and (optionally) signing requests to the host's own wallet. */
import type { SendFunction } from '@goodcash/sdk';

export type HostMessage =
  | { source: 'goodcash'; type: 'ready' }
  | { source: 'goodcash'; type: 'cashout.created' | 'cashout.sent' | 'cashout.paid' | 'cashout.failed'; cashOut: unknown }
  | { source: 'goodcash'; type: 'topup.created' | 'topup.paid_in' | 'topup.delivered' | 'topup.failed'; topUp: unknown }
  | { source: 'goodcash'; type: 'closed' }
  | { source: 'goodcash'; type: 'sign_request'; id: string; tx: unknown }
  | { source: 'goodcash'; type: 'sign_typed_data_request'; id: string; wallet: string; orderId: string; maxUsdc: string; typedData: unknown };

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

// ---------------------------------------------------------------------------------------------------------------
// Adding G$/CELO from a partner app that already has the customer's wallet (e.g. an email sign-in wallet).
// The one permit is signed by the HOST page with the wallet the customer is already using, so no connect step is shown.
// ---------------------------------------------------------------------------------------------------------------

type Obj = Record<string, unknown>;

/** The signed permit must have been made by exactly the wallet the host named. Nothing is sent on unless it was. */
export async function verifyHostSignature(typedJson: string, wallet: string, signature: string): Promise<void> {
  if (!/^0x[0-9a-fA-F]{130}$/.test(signature)) throw new Error('The app returned a signature in a form we do not accept.');
  let typed: Obj;
  try {
    typed = JSON.parse(typedJson) as Obj;
  } catch {
    throw new Error('The signing details were not readable.');
  }
  const { EIP712Domain: _domain, ...types } = (typed.types ?? {}) as Record<string, Array<{ name: string; type: string }>>;
  const primaryType = String(typed.primaryType);
  const raw = (typed.message ?? {}) as Obj;
  // viem wants whole numbers as bigint
  const message: Obj = { ...raw };
  for (const f of types[primaryType] ?? []) {
    if (/^u?int\d*$/.test(f.type) && raw[f.name] !== undefined) message[f.name] = BigInt(raw[f.name] as string | number);
  }
  const domain = { ...((typed.domain ?? {}) as Obj) };
  if (domain.chainId !== undefined) domain.chainId = BigInt(domain.chainId as string | number);
  let ok = false;
  try {
    // Loaded only when an app signs for the customer, so the page itself stays small
    const { verifyTypedData } = await import('viem');
    ok = await verifyTypedData({ address: wallet as `0x${string}`, domain, types, primaryType, message, signature: signature as `0x${string}` } as never);
  } catch {
    ok = false;
  }
  if (!ok) throw new Error('The signature did not come from your wallet, so nothing was sent.');
}

/**
 * A wallet that lives on the partner's page. It only ever answers the one request the top-up needs (the signed permit),
 * by asking the host over postMessage (never to "*"), and it checks who answered, which request, and who signed.
 */
export interface HostWalletProvider {
  request: (a: { method: string; params?: unknown[] }) => Promise<unknown>;
  /** The order being collected and the most it may convert (6-decimal USDC units), sent with every signing request */
  setOrder: (o: { orderId: string; maxUsdc: string }) => void;
}

export function hostWalletProvider(origin: string, wallet: string, timeoutMs = 10 * 60_000): HostWalletProvider {
  let order: { orderId: string; maxUsdc: string } | null = null;
  return {
    setOrder: (o) => {
      order = o;
    },
    request: async ({ method, params }) => {
      // The host's page moves its own wallet to Base for this one signature, so there is nothing to switch here.
      if (method === 'eth_chainId') return '0x2105';
      if (method !== 'eth_signTypedData_v4') throw new Error('The app cannot do that step here.');
      const [who, typedJson] = (params ?? []) as [string, string];
      if (String(who).toLowerCase() !== wallet.toLowerCase()) throw new Error('The signing details did not match, so nothing was signed.');
      // The app is always told which order this is and the most it may convert, so it can check the amount exactly
      if (!order || !/^\d{1,12}$/.test(order.maxUsdc)) throw new Error('The price was not ready. Please try again.');
      const { orderId, maxUsdc } = order;
      const typedData = JSON.parse(typedJson) as unknown;
      if (BigInt(String((typedData as { message?: { value?: string } }).message?.value ?? '0')) > BigInt(maxUsdc)) throw new Error('The signing details did not match, so nothing was signed.');
      const signature = await new Promise<string>((resolve, reject) => {
        const id = `sig_${Math.random().toString(36).slice(2)}`;
        const timer = setTimeout(() => {
          window.removeEventListener('message', onMsg);
          reject(new Error('The app did not answer the signing request in time.'));
        }, timeoutMs);
        function onMsg(e: MessageEvent) {
          if (e.origin !== origin || e.source !== hostWindow()) return;
          const d = e.data as { source?: string; type?: string; id?: string; signature?: string; error?: { code?: number; message?: string } };
          if (d?.source !== 'goodcash-host' || d.type !== 'sign_result' || d.id !== id) return;
          clearTimeout(timer);
          window.removeEventListener('message', onMsg);
          if (typeof d.signature === 'string') resolve(d.signature);
          else reject(Object.assign(new Error(d.error?.message ?? 'The app could not sign.'), { code: d.error?.code }));
        }
        window.addEventListener('message', onMsg);
        postToHost(origin, { source: 'goodcash', type: 'sign_typed_data_request', id, wallet, orderId, maxUsdc, typedData });
      });
      await verifyHostSignature(typedJson, wallet, signature);
      return signature;
    },
  };
}
