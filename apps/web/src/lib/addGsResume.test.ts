// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { findStuckOnramp, savedFromStuckOnramp } from './addGsSaved';

const NOW = Date.UTC(2026, 10, 10);
const row = (o: Record<string, unknown>) => ({ kind: 'onramp', orderId: 'o1', onrampStage: 'done', arrived: false, timestamp: NOW - 3_600_000, asset: 'g' as const, nairaIn: 1000, ...o });

describe('bringing back "Get my G$" on another device', () => {
  it('finds a paid order whose G$ never arrived', () => {
    expect(findStuckOnramp([row({})], NOW)?.orderId).toBe('o1');
  });
  it('ignores orders that arrived, are unpaid, are cash outs, or are old', () => {
    expect(findStuckOnramp([row({ arrived: true })], NOW)).toBeUndefined();
    expect(findStuckOnramp([row({ onrampStage: 'waiting' })], NOW)).toBeUndefined();
    expect(findStuckOnramp([row({ kind: 'cashout' })], NOW)).toBeUndefined();
    expect(findStuckOnramp([row({ timestamp: NOW - 20 * 86_400_000 })], NOW)).toBeUndefined();
  });
  it('takes the newest when there are several', () => {
    expect(findStuckOnramp([row({ orderId: 'old', timestamp: NOW - 5_000_000 }), row({ orderId: 'new' })], NOW)?.orderId).toBe('new');
  });
  it('builds a saved record that the watcher turns into the "money is here" step', () => {
    const s = savedFromStuckOnramp(row({ asset: 'celo' }), '0xabc');
    expect(s).toMatchObject({ wallet: '0xabc', asset: 'celo', sent: true, order: { orderId: 'o1', amountToTransfer: '1000' } });
    expect(s.swapRequestId).toBeUndefined();
  });
});
