/**
 * The safety check for the "dollars on Base -> G$ or CELO on Celo" step (the one signature a customer gives).
 *
 * The swap service returns the exact message the customer's wallet is asked to sign. We do not trust it: every
 * detail that decides where the money goes is checked here, in the app, the hosted widget and on our server, before
 * anyone is asked to sign. If one detail is off, nothing is signed.
 */

export const BASE_CHAIN_ID = 8453;
export const CELO_CHAIN_ID_NUM = 42220;
export const BASE_USDC = '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913';
/** Under 50 cents is not worth converting (the app's own floor). */
export const MIN_DOLLARS_ATOMIC = 500_000n;

/**
 * Where the swap service's permit signature may send the dollars: its own approval-proxy contracts on Base.
 * Source: the swap service's public chains list (https://api.relay.link/chains, Base, `contracts.v3.approvalProxy`
 * and `contracts.v3.2.approvalProxy`), checked 11 Nov 2026. Anything else is refused, even if the service sent it.
 */
export const RELAY_APPROVAL_PROXIES: readonly string[] = [
  '0xccc88a9d1b4ed6b0eaba998850414b24f1c315be',
  '0x5567954cd026cebfe486062cb75848e0f1c12e58',
];

/** What each asset is called in the swap service's answer (native CELO has the zero address). */
export const RELAY_OUT_TOKEN = {
  g: '0x62b8b11039fcfe5ab0c56e502b1c372a3d2a9c7a',
  celo: '0x0000000000000000000000000000000000000000',
} as const;
export type RelayAsset = keyof typeof RELAY_OUT_TOKEN;

/** The permit must be used within this long (the service gives about ten minutes). */
export const MAX_PERMIT_SECONDS = 30 * 60;

type Obj = Record<string, unknown>;

export interface RelayQuoteLike {
  requestId?: unknown;
  steps?: unknown;
  details?: unknown;
}

export interface RelaySignRequest {
  domain: Record<string, unknown>;
  types: Record<string, unknown>;
  primaryType: string;
  value: Record<string, unknown>;
}

const lower = (v: unknown) => String(v ?? '').toLowerCase();
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);

const EXPECTED_TYPES = [
  ['from', 'address'],
  ['to', 'address'],
  ['value', 'uint256'],
  ['validAfter', 'uint256'],
  ['validBefore', 'uint256'],
  ['nonce', 'bytes32'],
] as const;

/** Whole-number text or number, as a bigint; null when it is anything else. */
function wholeNumber(v: unknown): bigint | null {
  if (typeof v === 'number' && Number.isSafeInteger(v) && v >= 0) return BigInt(v);
  if (typeof v === 'string' && /^\d{1,78}$/.test(v)) return BigInt(v);
  return null;
}

/**
 * Throws (with a short reason for the team's logs, never shown to customers) unless the whole quote is exactly
 * what we asked for: one signature step for this wallet, this amount of USDC on Base, sent only to the swap
 * service's own contract, valid for a short time, paying the result to the same wallet in the right asset.
 */
export function checkRelayQuote(
  q: RelayQuoteLike,
  expect: { wallet: string; amount: bigint; asset: RelayAsset; nowSeconds?: number },
): { sign: RelaySignRequest; api?: string } {
  const now = expect.nowSeconds ?? Math.floor(Date.now() / 1000);
  const wallet = lower(expect.wallet);
  const fail = (why: string): never => {
    throw new Error(`did not match: ${why}`);
  };

  if (typeof q.requestId !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(q.requestId)) fail('request id');

  // One step, one item: a single signature, nothing else hidden alongside it
  const steps = q.steps;
  if (!Array.isArray(steps) || steps.length !== 1) fail('step count');
  const items = isObj((steps as unknown[])[0]) ? ((steps as Obj[])[0].items as unknown) : null;
  if (!Array.isArray(items) || items.length !== 1) fail('item count');
  const data = isObj((items as unknown[])[0]) ? ((items as Obj[])[0].data as unknown) : null;
  if (!isObj(data) || !isObj(data.sign)) fail('no signing request');
  const sign = (data as Obj).sign as Obj;

  // The message type is exactly the standard "receive with authorization" and nothing more
  if (sign.signatureKind !== undefined && sign.signatureKind !== 'eip712') fail('signature kind');
  if (sign.primaryType !== 'ReceiveWithAuthorization') fail('message type');
  const types = sign.types;
  if (!isObj(types) || Object.keys(types).length !== 1 || !Array.isArray(types.ReceiveWithAuthorization)) fail('types');
  const fields = (types as Obj).ReceiveWithAuthorization as Obj[];
  if (
    fields.length !== EXPECTED_TYPES.length ||
    !EXPECTED_TYPES.every(([name, type], i) => fields[i]?.name === name && fields[i]?.type === type)
  ) {
    fail('fields');
  }

  // The token and network being signed for
  const d = sign.domain;
  if (!isObj(d)) fail('domain');
  const domain = d as Obj;
  if (
    domain.name !== 'USD Coin' ||
    String(domain.version) !== '2' ||
    Number(domain.chainId) !== BASE_CHAIN_ID ||
    lower(domain.verifyingContract) !== BASE_USDC
  ) {
    fail('token or network');
  }

  // Who pays, who receives, how much, and for how long
  const v = sign.value;
  if (!isObj(v)) fail('value');
  const value = v as Obj;
  if (lower(value.from) !== wallet) fail('payer');
  if (!RELAY_APPROVAL_PROXIES.includes(lower(value.to))) fail('destination');
  if (wholeNumber(value.value) !== expect.amount) fail('amount');
  const validAfter = wholeNumber(value.validAfter);
  const validBefore = wholeNumber(value.validBefore);
  if (validAfter === null || validAfter > BigInt(now)) fail('valid-after');
  if (validBefore === null || validBefore <= BigInt(now) || validBefore > BigInt(now + MAX_PERMIT_SECONDS)) fail('valid-before');
  if (typeof value.nonce !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(value.nonce)) fail('nonce');

  // Where the signed message goes next must be the swap service's own permit endpoint for this request
  const post = isObj((data as Obj).post) ? ((data as Obj).post as Obj) : null;
  const body = post && isObj(post.body) ? post.body : null;
  if (!post || post.endpoint !== '/execute/permits' || post.method !== 'POST' || !body) fail('submit step');
  const b = body as Obj;
  if (b.kind !== 'eip3009' || b.requestId !== q.requestId) fail('submit body');
  if (b.api !== undefined && !['swap', 'bridge', 'user-swap'].includes(String(b.api))) fail('submit api');

  // The service's own summary of the swap: our wallet pays our USDC on Base and gets the right asset on Celo
  const details = q.details;
  if (!isObj(details)) fail('details');
  const dt = details as Obj;
  if (lower(dt.sender) !== wallet || lower(dt.recipient) !== wallet) fail('sender or recipient');
  const cin = isObj(dt.currencyIn) ? dt.currencyIn : null;
  const cinCur = cin && isObj(cin.currency) ? cin.currency : null;
  if (!cin || !cinCur || Number(cinCur.chainId) !== BASE_CHAIN_ID || lower(cinCur.address) !== BASE_USDC || wholeNumber(cin.amount) !== expect.amount) {
    fail('swap input');
  }
  const cout = isObj(dt.currencyOut) ? dt.currencyOut : null;
  const coutCur = cout && isObj(cout.currency) ? cout.currency : null;
  if (!cout || !coutCur || Number(coutCur.chainId) !== CELO_CHAIN_ID_NUM || lower(coutCur.address) !== RELAY_OUT_TOKEN[expect.asset]) {
    fail('swap output');
  }

  return { sign: sign as unknown as RelaySignRequest, api: b.api === undefined ? undefined : String(b.api) };
}
