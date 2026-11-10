import { describe, expect, it } from 'vitest';
import { findStuckOrder, type AppApi } from './api';

const ID1 = '550e8400-e29b-41d4-a716-446655440001';
const ID2 = '550e8400-e29b-41d4-a716-446655440002';
const NOW_MS = Date.UTC(2026, 10, 10, 12);
const sec = (daysAgo: number) => Math.floor(NOW_MS / 1000) - daysAgo * 86400;
const apiWith = (onramps: unknown[]): AppApi & { last?: string } => {
  const a: AppApi & { last?: string } = {
    get: async <T,>(p: string) => {
      a.last = p;
      return { onramps } as T;
    },
    post: async <T,>() => ({}) as T,
  };
  return a;
};

describe('finding a top-up whose last step never ran', () => {
  it('asks History for this wallet', async () => {
    const api = apiWith([]);
    await findStuckOrder(api, '0xAbC', NOW_MS);
    expect(api.last).toBe('/history?wallet=0xAbC');
  });

  it('finds a paid order that has not arrived, newest first, with its amount and asset', async () => {
    const api = apiWith([
      { orderId: ID1, naira: 2028, asset: 'g', at: sec(3), stage: 'done', arrived: false },
      { orderId: ID2, naira: 5000, asset: 'celo', at: sec(1), stage: 'done' },
    ]);
    expect(await findStuckOrder(api, '0x1', NOW_MS)).toEqual({ orderId: ID2, naira: 5000, asset: 'celo' });
  });

  it('ignores orders that arrived, are still waiting or expired, are too old, or have a bad id', async () => {
    const api = apiWith([
      { orderId: ID1, naira: 2028, at: sec(1), stage: 'done', arrived: true },
      { orderId: ID1, naira: 2028, at: sec(1), stage: 'waiting' },
      { orderId: ID1, naira: 2028, at: sec(1), stage: 'expired' },
      { orderId: ID1, naira: 2028, at: sec(20), stage: 'done' },
      { orderId: 'not-an-id', naira: 2028, at: sec(1), stage: 'done' },
      { orderId: ID2, naira: 0, at: sec(1), stage: 'done' },
    ]);
    expect(await findStuckOrder(api, '0x1', NOW_MS)).toBeNull();
  });

  it('finds nothing when History has no naira orders at all', async () => {
    expect(await findStuckOrder({ get: async <T,>() => ({}) as T, post: async <T,>() => ({}) as T }, '0x1', NOW_MS)).toBeNull();
  });
});
