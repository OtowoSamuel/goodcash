import { describe, it, expect } from 'vitest';
import { BASE_USDC, checkRelaySigning, isAdultDate } from './addGs';

const W = '0xafDeEbB89Cda1669361117eA2EAe3411F1228cb6';
const quote = (over: { from?: string; value?: string; contract?: string; chainId?: number; type?: string } = {}) => ({
  requestId: '0x' + 'ab'.repeat(32),
  steps: [
    {
      items: [
        {
          data: {
            sign: {
              domain: { name: 'USD Coin', version: '2', chainId: over.chainId ?? 8453, verifyingContract: over.contract ?? BASE_USDC },
              types: { ReceiveWithAuthorization: [] },
              primaryType: over.type ?? 'ReceiveWithAuthorization',
              value: { from: over.from ?? W, to: '0xccc', value: over.value ?? '3000000' },
            },
            post: { body: { kind: 'eip3009', api: 'swap' } },
          },
        },
      ],
    },
  ],
});

describe('Add G$ swap safety', () => {
  it('accepts the expected signing request', () => {
    expect(checkRelaySigning(quote(), W, 3_000_000n).api).toBe('swap');
  });
  it('refuses anything that is not exactly the customer dollars on Base', () => {
    for (const bad of [{ from: '0x1111111111111111111111111111111111111111' }, { value: '3000001' }, { contract: '0x2222222222222222222222222222222222222222' }, { chainId: 1 }, { type: 'TransferWithAuthorization' }]) {
      expect(() => checkRelaySigning(quote(bad), W, 3_000_000n)).toThrow();
    }
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
