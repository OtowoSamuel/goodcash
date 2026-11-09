import { ORDERS_API_BASE } from './rate';
import { getWalletProvider, chainIdNumber, activeProviderKind } from './router';

/**
 * Add G$ (naira in): the customer pays naira by bank transfer, dollars arrive in their own wallet on Base,
 * then one signed message (no fee to pay in the wallet) turns those dollars into G$ on Celo.
 * All calls go through our own server; customer ID details are sent once and never kept.
 */

export const BASE_USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const BASE_CHAIN_HEX = '0x2105';
const CELO_CHAIN_HEX = '0xa4ec';

/** What the customer is adding: G$, or CELO (the coin that pays the small network fee when cashing out). */
export type AddAsset = 'g' | 'celo';
export const ASSET_LABEL: Record<AddAsset, string> = { g: 'G$', celo: 'CELO' };

export interface OnrampQuote {
  naira: number;
  ngnPerUsd: number;
  gOut: number;
  gOutMin: number;
  /** The amount of whichever asset was asked for (same numbers as gOut / gOutMin) */
  amountOut?: number;
  amountOutMin?: number;
  /** Dollars that reach the wallet before the G$ / CELO step (History label only) */
  usdtDelivered?: number;
  asset?: AddAsset;
  swapFeeUsd: number;
  minNaira: number;
  validForSeconds: number;
}

export interface OnrampOrder {
  orderId: string;
  status: string;
  bank: { institution: string; accountIdentifier: string; accountName: string };
  amountToTransfer: string;
  validUntil: string;
}

export type OnrampStage = 'waiting' | 'received' | 'done' | 'expired' | 'refund' | 'review';

export interface OnrampInput {
  asset?: AddAsset;
  naira: number;
  wallet: string;
  fullName: string;
  birthDate: string;
  idType: 'BVN' | 'NIN';
  idNumber: string;
  /** What the app showed the customer. Used only to label History. */
  expectedOut?: number;
  /** Dollars the app said would reach the wallet. Used only to label History. */
  expectedUsd?: number;
  refundAccount: { institution: string; accountIdentifier: string; accountName: string };
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${ORDERS_API_BASE}${path}`, {
      ...init,
      headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    });
  } catch {
    // The browser's own text here ("Failed to fetch", "Load failed") means nothing to a customer
    throw new Error("We couldn't reach GoodCash. Check your internet connection and try again.");
  }
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new Error(data.error || 'Something went wrong. Please try again.');
  return data as T;
}

export const fetchOnrampQuote = (naira: number, wallet?: string, asset: AddAsset = 'g') =>
  api<OnrampQuote>(`/onramp/quote?naira=${naira}&asset=${asset}${wallet ? `&wallet=${wallet}` : ''}`);

export const createOnrampOrder = (input: OnrampInput) =>
  api<OnrampOrder>('/onramp/orders', { method: 'POST', body: JSON.stringify(input) });

/** Ask to be emailed when the naira arrives and when the G$ lands. The email is only used for those two messages. */
export const saveOnrampEmail = (orderId: string, email: string, naira: string) =>
  api<unknown>(`/onramp/orders/${orderId}/notify`, { method: 'POST', body: JSON.stringify({ email, naira }) });

/** Tell the server the swap finished; it checks for itself before it sends the "G$ added" email. */
export const reportOnrampArrived = (orderId: string, requestId: string) =>
  api<unknown>(`/onramp/orders/${orderId}/arrived`, { method: 'POST', body: JSON.stringify({ requestId }) });

export const fetchOnrampStatus = (orderId: string) =>
  api<{ orderId: string; status: string; stage: OnrampStage; arrived?: boolean; txHash?: string }>(`/onramp/orders/${orderId}`);

/** Whole-day check used by the form (the server checks again). */
export function isAdultDate(birthDate: string, now = new Date()): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(birthDate);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const born = new Date(Date.UTC(y, mo - 1, d));
  if (born.getUTCMonth() !== mo - 1 || y < 1900) return false;
  let age = now.getUTCFullYear() - y;
  if (now.getUTCMonth() < mo - 1 || (now.getUTCMonth() === mo - 1 && now.getUTCDate() < d)) age -= 1;
  return age >= 18;
}

/** 4,50,000 style is avoided; plain thousands separators. */
export const formatNaira = (n: number) => `₦${Math.round(n).toLocaleString('en-US')}`;

// ---------------------------------------------------------------------------
// The swap: dollars on Base -> G$ on Celo
// ---------------------------------------------------------------------------

type Eip1193 = { request: (args: { method: string; params?: unknown[] }) => Promise<unknown> };

async function switchChain(p: Eip1193, hex: string, add?: Record<string, unknown>): Promise<void> {
  const current = await p.request({ method: 'eth_chainId' });
  if (chainIdNumber(current) === parseInt(hex, 16)) return;
  try {
    await p.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: hex }] });
  } catch (e) {
    if (!add) throw e;
    await p.request({ method: 'wallet_addEthereumChain', params: [add] });
  }
}

const BASE_ADD = {
  chainId: BASE_CHAIN_HEX,
  chainName: 'Base',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: ['https://mainnet.base.org'],
  blockExplorerUrls: ['https://basescan.org'],
};

const BASE_RPCS = ['https://mainnet.base.org', 'https://base-rpc.publicnode.com'];

/**
 * How many dollars (6 decimals, as a whole number of millionths) are waiting in the wallet on Base.
 * Read straight from a Base node, not through the wallet: an email wallet lives on one network and cannot see Base,
 * and a wallet app should not be asked to change network just so we can look at a balance.
 */
export async function readDollarsOnBase(wallet: string): Promise<bigint> {
  const data = `0x70a08231${'0'.repeat(24)}${wallet.slice(2).toLowerCase()}`;
  let lastError: unknown = new Error('Base is not reachable.');
  for (const url of BASE_RPCS) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_call', params: [{ to: BASE_USDC, data }, 'latest'] }),
      });
      const body = (await res.json()) as { result?: string; error?: { message?: string } };
      if (body.error || typeof body.result !== 'string') throw new Error(body.error?.message ?? 'No answer from Base.');
      // some nodes answer an empty balance read with "0x", which BigInt rejects
      return body.result === '0x' ? 0n : BigInt(body.result);
    } catch (e) {
      lastError = e;
    }
  }
  throw lastError;
}

interface RelayStep {
  items?: Array<{ data?: { sign?: { domain: Record<string, unknown>; types: Record<string, unknown>; primaryType: string; value: Record<string, unknown> }; post?: { body?: { kind?: string; api?: string } } } }>;
}
interface RelayQuoteResponse {
  requestId: string;
  steps: RelayStep[];
  details?: { currencyOut?: { amount?: string; minimumAmount?: string } };
}

/** The signing details Relay returned must be exactly what we expect before the wallet is asked to sign. */
export function checkRelaySigning(q: RelayQuoteResponse, wallet: string, amount: bigint): {
  sign: NonNullable<NonNullable<NonNullable<RelayStep['items']>[number]['data']>['sign']>;
  api?: string;
} {
  const item = q.steps?.[0]?.items?.[0]?.data;
  const sign = item?.sign;
  if (!sign || !q.requestId) throw new Error('The swap price was not ready. Please try again.');
  const v = sign.value as Record<string, string | number>;
  const d = sign.domain as Record<string, string | number>;
  const ok =
    sign.primaryType === 'ReceiveWithAuthorization' &&
    String(d.verifyingContract).toLowerCase() === BASE_USDC.toLowerCase() &&
    Number(d.chainId) === 8453 &&
    String(v.from).toLowerCase() === wallet.toLowerCase() &&
    BigInt(String(v.value)) === amount;
  if (!ok) throw new Error('The swap details did not match, so nothing was signed. Please try again.');
  return { sign, api: item?.post?.body?.api };
}

export interface SwapResult {
  requestId: string;
  gMinimum: number;
}

/** Ask for the price, get the customer's one signature, and hand it to the swap service. */
export async function startGasFreeSwap(wallet: string, amount: bigint, asset: AddAsset = 'g'): Promise<SwapResult> {
  const p = getWalletProvider();
  if (!p) throw new Error('Connect your wallet first.');
  const quote = await api<RelayQuoteResponse>('/relay/quote', { method: 'POST', body: JSON.stringify({ wallet, amount: amount.toString(), asset }) });
  const { sign, api: apiKind } = checkRelaySigning(quote, wallet, amount);
  // A wallet the customer brought must be on Base to sign for Base. An email wallet signs for any network.
  try {
    await switchChain(p, BASE_CHAIN_HEX, BASE_ADD);
  } catch (e) {
    if (activeProviderKind() !== 'magic') throw e;
  }
  const typed = {
    types: { EIP712Domain: eip712DomainType(sign.domain), ...sign.types },
    primaryType: sign.primaryType,
    domain: sign.domain,
    message: sign.value,
  };
  const signature = (await p.request({ method: 'eth_signTypedData_v4', params: [wallet, JSON.stringify(typed)] })) as string;
  await api('/relay/execute', { method: 'POST', body: JSON.stringify({ signature, requestId: quote.requestId, kind: 'eip3009', api: apiKind ?? 'swap' }) });
  const min = quote.details?.currencyOut?.minimumAmount;
  return { requestId: quote.requestId, gMinimum: min ? Number(BigInt(min)) / 1e18 : 0 };
}

function eip712DomainType(domain: Record<string, unknown>) {
  const all: Array<{ name: string; type: string }> = [
    { name: 'name', type: 'string' },
    { name: 'version', type: 'string' },
    { name: 'chainId', type: 'uint256' },
    { name: 'verifyingContract', type: 'address' },
  ];
  return all.filter((f) => f.name in domain);
}

export type SwapStatus = 'waiting' | 'pending' | 'success' | 'failure' | 'refund' | 'unknown';

export async function fetchSwapStatus(requestId: string): Promise<SwapStatus> {
  const { status } = await api<{ status: string }>(`/relay/status?requestId=${requestId}`);
  return (['waiting', 'pending', 'success', 'failure', 'refund'] as const).includes(status as never) ? (status as SwapStatus) : 'unknown';
}

/** Put the wallet back on Celo, where GoodCash works. */
export async function returnToCelo(): Promise<void> {
  const p = getWalletProvider();
  if (!p) return;
  try {
    await switchChain(p, CELO_CHAIN_HEX);
  } catch {
    // the customer can switch back themselves
  }
}

/**
 * Plain wording for anything that goes wrong in Add G$. Customers never see technical text:
 * only these sentences. Details go to the team through reportIssue.
 */
export function friendlyAddError(err: unknown): string {
  const e = err as { message?: string; shortMessage?: string; code?: number } | null;
  const raw = `${e?.shortMessage ?? ''} ${e?.message ?? ''}`;
  if (e?.code === 4001 || /user rejected|user denied|rejected the request|cancel/i.test(raw)) {
    return 'You cancelled in your wallet. Nothing was taken. Tap to try again.';
  }
  if (/insufficient funds|gas required exceeds|not enough/i.test(raw)) {
    return 'Your wallet needs a small top-up to cover the network fee. Add a little more and try again. Your money is safe.';
  }
  if (/chain|network|switch/i.test(raw)) {
    return 'Your wallet did not approve this step. Please tap Approve when it asks, then try again. Nothing was taken.';
  }
  if (/did not match|not ready|price/i.test(raw)) return 'The price changed. Nothing was taken. Please try again.';
  if (/connect your wallet/i.test(raw)) return 'Connect your wallet first.';
  if (/has not shown up/i.test(raw)) return 'Your money has not shown up in your wallet yet. Please wait a minute and try again.';
  return 'Something went wrong. Nothing was taken and your money is safe. Please try again.';
}
