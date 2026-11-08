import { describe, it, expect } from 'vitest';
import { gToWei } from './units';

describe('gToWei', () => {
  it('is exact for round amounts', () => {
    expect(gToWei(5000)).toBe(5000n * 10n ** 18n);
  });
  it('never carries float noise and never rounds up', () => {
    expect(gToWei(1234.567)).toBe(1234567000000000000000n);
    expect(gToWei(0.1 + 0.2)).toBe(300000000000000000n);
  });
  it('treats junk as zero', () => {
    expect(gToWei(NaN)).toBe(0n);
    expect(gToWei(-5)).toBe(0n);
  });
});

import { nairaFromUsdt } from './units';
describe('nairaFromUsdt', () => {
  it('subtracts the payout fee, so the estimate matches what reaches the bank', () => {
    // 0.574 USDT is what a 5,000 G$ cash out produced; the fee is 0.02
    expect(nairaFromUsdt(0.574, 1370)).toBeCloseTo(0.554 * 1370, 6);
    expect(nairaFromUsdt(0.574, 1370)).toBeLessThan(0.574 * 1370 - 27);
  });
  it('never goes below zero', () => {
    expect(nairaFromUsdt(0.01, 1370)).toBe(0);
  });
});
