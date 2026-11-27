import { describe, expect, it } from 'vitest';
import { MIN_NET_USDT_REQUIRED } from '@goodcash/core';
import { minimumG, type Priced } from './pricing';

const priced = (feePercent: number): Priced =>
  ({ amountG: '10000', usdtOut: 1_140_000n, feePercent } as unknown as Priced);

describe('minimumG', () => {
  it('matches the main app floor when only the GoodCash fee applies', () => {
    const perG = 1.14 / 10000;
    expect(minimumG(priced(1))).toBe(Math.ceil(((MIN_NET_USDT_REQUIRED / perG) * 1.01) / 10) * 10);
    expect(minimumG(priced(1))).toBeGreaterThan(5000);
  });
  it('goes up with a partner fee on top, never down', () => {
    expect(minimumG(priced(2.5))).toBeGreaterThan(minimumG(priced(1)));
    expect(minimumG(priced(0))).toBe(minimumG(priced(1)));
  });
});
