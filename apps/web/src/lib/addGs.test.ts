import { describe, it, expect, vi, afterEach } from 'vitest';
import { BASE_USDC, checkRelaySigning, convertibleDollars, isAdultDate } from './addGs';

const W = '0xafDeEbB89Cda1669361117eA2EAe3411F1228cb6';
const REQ = '0x' + 'ab'.repeat(32);
const PROXY = '0xccc88a9d1b4ed6b0eaba998850414b24f1c315be';
/** The shape of a real answer from the swap service, so a loose check cannot pass by accident. */
const quote = (over: { from?: string; to?: string; value?: string; contract?: string; chainId?: number; type?: string; validBefore?: number; recipient?: string } = {}) => ({
  requestId: REQ,
  steps: [
    {
      items: [
        {
          data: {
            sign: {
              signatureKind: 'eip712',
              domain: { name: 'USD Coin', version: '2', chainId: over.chainId ?? 8453, verifyingContract: over.contract ?? BASE_USDC },
              types: { ReceiveWithAuthorization: [{ name: 'from', type: 'address' }, { name: 'to', type: 'address' }, { name: 'value', type: 'uint256' }, { name: 'validAfter', type: 'uint256' }, { name: 'validBefore', type: 'uint256' }, { name: 'nonce', type: 'bytes32' }] },
              primaryType: over.type ?? 'ReceiveWithAuthorization',
              value: { from: over.from ?? W, to: over.to ?? PROXY, value: over.value ?? '3000000', validAfter: 0, validBefore: over.validBefore ?? Math.floor(Date.now() / 1000) + 600, nonce: '0x' + '12'.repeat(32) },
            },
            post: { endpoint: '/execute/permits', method: 'POST', body: { kind: 'eip3009', requestId: REQ, api: 'swap' } },
          },
        },
      ],
    },
  ],
  details: {
    sender: W,
    recipient: over.recipient ?? W,
    currencyIn: { currency: { chainId: 8453, address: BASE_USDC }, amount: over.value ?? '3000000' },
    currencyOut: { currency: { chainId: 42220, address: '0x62B8B11039FcfE5aB0C56E502b1C372A3d2a9c7A' } },
  },
});

describe('Add G$ swap safety', () => {
  it('accepts the expected signing request', () => {
    expect(checkRelaySigning(quote(), W, 3_000_000n).api).toBe('swap');
  });
  it('refuses anything that is not exactly the customer dollars on Base, sent only to the swap service', () => {
    for (const bad of [
      { from: '0x1111111111111111111111111111111111111111' },
      { to: '0x1111111111111111111111111111111111111111' },
      { to: W },
      { value: '3000001' },
      { contract: '0x2222222222222222222222222222222222222222' },
      { chainId: 1 },
      { type: 'TransferWithAuthorization' },
      { validBefore: 1 },
      { validBefore: Math.floor(Date.now() / 1000) + 86_400 },
      { recipient: '0x3333333333333333333333333333333333333333' },
    ]) {
      expect(() => checkRelaySigning(quote(bad), W, 3_000_000n)).toThrow(/did not match/);
    }
  });
});

describe('Add G$ converts only the order\'s own dollars', () => {
  const ORDER = '660e8400-e29b-41d4-a716-446655440001';
  const orig = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = orig;
    vi.restoreAllMocks();
  });
  /** A wallet holding `balance` dollars on Base, and an order that delivers up to `max`. */
  const stub = (balance: bigint, max: string | undefined) => {
    globalThis.fetch = vi.fn(async (url: string) => {
      if (String(url).includes('/onramp/orders/')) return new Response(JSON.stringify({ orderId: ORDER, status: 'settled', stage: 'done', ...(max ? { maxUsdc: max } : {}) }));
      return new Response(JSON.stringify({ result: `0x${balance.toString(16)}` }));
    }) as typeof fetch;
  };

  it('uses the whole balance when it is no more than the order delivers', async () => {
    stub(3_000_000n, '3551428');
    expect(await convertibleDollars(W, ORDER)).toBe(3_000_000n);
  });
  it('stops at what the order delivers when the wallet holds more, such as other dollars or another order', async () => {
    stub(12_000_000n, '3551428');
    expect(await convertibleDollars(W, ORDER)).toBe(3_551_428n);
  });
  it('does nothing when the server cannot say what the order delivers', async () => {
    stub(12_000_000n, undefined);
    await expect(convertibleDollars(W, ORDER)).rejects.toThrow(/not ready/);
  });
});

describe('isAdultDate', () => {
  const now = new Date(Date.UTC(2026, 10, 8));
  it('checks 18+ and real dates', () => {
    expect(isAdultDate('2008-11-08', now)).toBe(true);
    expect(isAdultDate('2008-11-09', now)).toBe(false);
    expect(isAdultDate('2026-02-30', now)).toBe(false);
    expect(isAdultDate('nope', now)).toBe(false);
  });
});

import { friendlyAddError } from './addGs';
describe('friendlyAddError', () => {
  it('never shows technical text, and asks for a top-up when fees cannot be paid', () => {
    expect(friendlyAddError({ code: 4001, message: 'User rejected the request.' })).toMatch(/cancelled/);
    expect(friendlyAddError(new Error('insufficient funds for gas * price + value'))).toMatch(/top-up/);
    expect(friendlyAddError(new Error('RPC 0xdeadbeef execution reverted: Error(swap)'))).toBe('Something went wrong. Nothing was taken and your money is safe. Please try again.');
  });
});

describe('Add G$ network errors', () => {
  it('never shows the browser\'s "Failed to fetch" to a customer', async () => {
    const { fetchOnrampQuote } = await import('./addGs');
    const orig = globalThis.fetch;
    globalThis.fetch = (async () => { throw new TypeError('Failed to fetch'); }) as typeof fetch;
    try {
      await expect(fetchOnrampQuote(5000)).rejects.toThrow(/couldn't reach GoodCash/);
    } finally {
      globalThis.fetch = orig;
    }
  });
});
