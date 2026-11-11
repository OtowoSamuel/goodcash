import { checkRelayQuote } from '@goodcash/core';

/**
 * The wallet side of a top-up: the dollars that arrived on Base are turned into G$ (or CELO) on Celo with ONE signed
 * authorization (no fee to pay in the wallet). The safety check is the same one the GoodCash app and server use (it lives
 * in @goodcash/core): nothing is signed unless every detail is exactly what we expect (the USDC contract on Base, this
 * customer's wallet, the exact amount, the swap service's own destination contract, a short time limit, and the result
 * going to the same wallet in the right asset). Only this order's own dollars are ever converted.
 */
export const BASE_USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
export const BASE_CHAIN_ID = 8453;
const BASE_CHAIN_HEX = '0x2105';
export const BASE_RPCS = ['https://mainnet.base.org', 'https://base-rpc.publicnode.com'];
/** Under 50 cents is not worth converting (the app's own floor). */
export const MIN_DOLLARS_ATOMIC = 500_000n;

export type Eip1193 = { request: (args: { method: string; params?: unknown[] }) => Promise<unknown> };

const BASE_ADD = {
  chainId: BASE_CHAIN_HEX,
  chainName: 'Base',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: [BASE_RPCS[0]],
  blockExplorerUrls: ['https://basescan.org'],
};

/** A wallet's chain id as a number: browser wallets answer in hex text, WalletConnect wallets with a number. */
export function chainIdNumber(v: unknown): number {
  if (typeof v === 'number') return v;
  if (typeof v === 'bigint') return Number(v);
  if (typeof v === 'string') return /^0x/i.test(v) ? parseInt(v, 16) : parseInt(v, 10);
  return NaN;
}

async function switchToBase(p: Eip1193): Promise<void> {
  if (chainIdNumber(await p.request({ method: 'eth_chainId' })) === BASE_CHAIN_ID) return;
  try {
    await p.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: BASE_CHAIN_HEX }] });
  } catch {
    await p.request({ method: 'wallet_addEthereumChain', params: [BASE_ADD] });
  }
}

/** Dollars (6 decimals) waiting in the wallet on Base. Read from a Base node, never through the wallet. */
export async function readDollarsOnBase(wallet: string, fetchImpl: typeof fetch = fetch): Promise<bigint> {
  const data = `0x70a08231${'0'.repeat(24)}${wallet.slice(2).toLowerCase()}`;
  let last: unknown = new Error('Base is not reachable.');
  for (const url of BASE_RPCS) {
    try {
      const res = await fetchImpl(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_call', params: [{ to: BASE_USDC, data }, 'latest'] }),
      });
      const body = (await res.json()) as { result?: string; error?: { message?: string } };
      if (body.error || typeof body.result !== 'string') throw new Error(body.error?.message ?? 'No answer from Base.');
      return body.result === '0x' ? 0n : BigInt(body.result);
    } catch (e) {
      last = e;
    }
  }
  throw last;
}

interface RelaySignRequest {
  domain: Record<string, unknown>;
  types: Record<string, unknown>;
  primaryType: string;
  value: Record<string, unknown>;
}
export interface RelayQuoteResponse {
  requestId: string;
  steps: unknown;
  details?: ({ currencyOut?: { amount?: string; minimumAmount?: string; currency?: unknown } } & Record<string, unknown>) | undefined;
}

/** The signing details must be exactly what we expect before the wallet is asked to sign. */
export function checkRelaySigning(q: RelayQuoteResponse, wallet: string, amount: bigint, asset: 'g' | 'celo' = 'g'): { sign: RelaySignRequest; api?: string } {
  try {
    return checkRelayQuote(q, { wallet, amount, asset });
  } catch (e) {
    const why = String((e as Error)?.message ?? '').replace(/^did not match: /, '');
    throw new Error(`The details did not match, so nothing was signed. Please try again. (${why})`);
  }
}

function domainType(domain: Record<string, unknown>) {
  const all = [
    { name: 'name', type: 'string' },
    { name: 'version', type: 'string' },
    { name: 'chainId', type: 'uint256' },
    { name: 'verifyingContract', type: 'address' },
  ];
  return all.filter((f) => f.name in domain);
}

/**
 * The dollars this order may convert: what is in the wallet, but never more than the order itself delivers.
 * Other dollars in the wallet, or from another order still in progress, are left alone.
 */
export async function convertibleDollars(wallet: string, orderLimit: () => Promise<string | undefined>, fetchImpl: typeof fetch = fetch): Promise<bigint> {
  const [have, limit] = await Promise.all([readDollarsOnBase(wallet, fetchImpl), orderLimit()]);
  const cap = limit && /^\d{1,12}$/.test(limit) ? BigInt(limit) : 0n;
  if (cap === 0n) throw new Error('The price was not ready. Please try again.');
  return have < cap ? have : cap;
}

export interface Post {
  <T>(path: string, body: unknown): Promise<T>;
}

/** Ask for the price, get the customer's one signature, and hand it to GoodCash. Returns the request id to follow. */
export async function signAndStart(p: Eip1193, wallet: string, amount: bigint, asset: 'g' | 'celo', post: Post, orderId: string): Promise<{ requestId: string }> {
  const quote = await post<RelayQuoteResponse>('/relay/quote', { wallet, amount: amount.toString(), asset, orderId });
  const { sign, api } = checkRelaySigning(quote, wallet, amount, asset);
  await switchToBase(p); // a wallet must be on Base to sign for Base
  const typed = { types: { EIP712Domain: domainType(sign.domain), ...sign.types }, primaryType: sign.primaryType, domain: sign.domain, message: sign.value };
  const signature = (await p.request({ method: 'eth_signTypedData_v4', params: [wallet, JSON.stringify(typed)] })) as string;
  await post('/relay/execute', { signature, requestId: quote.requestId, kind: 'eip3009', api: api ?? 'swap', orderId });
  return { requestId: quote.requestId };
}

/** Plain words for anything that goes wrong in the wallet step. Details never reach the customer. */
export function walletStepMessage(err: unknown): string {
  const e = err as { message?: string; shortMessage?: string; code?: number } | null;
  const raw = `${e?.shortMessage ?? ''} ${e?.message ?? ''}`;
  if (e?.code === 4001 || /user rejected|user denied|rejected the request|cancel/i.test(raw)) return 'You cancelled in your wallet. Nothing was taken. Tap to try again.';
  if (/insufficient funds|not enough/i.test(raw)) return 'Your wallet needs a small top-up to cover the network fee. Your money is safe.';
  if (/did not match/i.test(raw)) return 'The details did not match, so nothing was signed. Please try again.';
  if (/not ready|price/i.test(raw)) return 'The price changed. Nothing was taken. Please try again.';
  if (/chain|network|switch/i.test(raw)) return 'Your wallet did not approve this step. Please tap Approve when it asks, then try again. Nothing was taken.';
  return 'Something went wrong. Nothing was taken and your money is safe. Please try again.';
}
