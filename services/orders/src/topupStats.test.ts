import { describe, expect, it } from 'vitest';
import type { Store } from './referral';
import { countTopUp, excludedWallets, readTopUpTotals, summariseTopUps, weekStart } from './topupStats';

class MockKV {
  store = new Map<string, string>();
  puts: string[] = [];
  async get(k: string) {
    return this.store.get(k) ?? null;
  }
  meta = new Map<string, unknown>();
  async put(k: string, v: string, o?: { metadata?: unknown }) {
    this.puts.push(k);
    this.store.set(k, v);
    if (o?.metadata !== undefined) this.meta.set(k, o.metadata);
  }
  async list() {
    return { keys: [], list_complete: true };
  }
}

const A = '0xAAAAaaaaAAAAaaaaAAAAaaaaAAAAaaaaAAAAaaaa';
const B = '0xBBBBbbbbBBBBbbbbBBBBbbbbBBBBbbbbBBBBbbbb';
const at = (iso: string) => new Date(iso).getTime();
const order = (kv: MockKV, id: string, wallet: string, naira: number, createdAt: number) =>
  kv.store.set(`onramp:${id}`, JSON.stringify({ wallet, naira, createdAt }));

describe('top-up totals', () => {
  it('counts each order once however often it settles', async () => {
    const kv = new MockKV();
    order(kv, 'o1', A, 5000, at('2026-11-18T10:00:00Z'));
    expect(await countTopUp(kv as unknown as Store, 'o1')).toBe(true);
    expect(await countTopUp(kv as unknown as Store, 'o1')).toBe(false);
    expect(await countTopUp(kv as unknown as Store, 'o1')).toBe(false);
    expect(await readTopUpTotals(kv as unknown as Store)).toMatchObject({ topUps: 1, wallets: 1, naira: 5000 });
  });

  it('counts a wallet once but every top-up, and groups by Monday week', async () => {
    const kv = new MockKV();
    order(kv, 'o1', A, 5000, at('2026-11-16T09:00:00Z')); // Monday
    order(kv, 'o2', A.toLowerCase(), 2500, at('2026-11-22T09:00:00Z')); // Sunday, same week
    order(kv, 'o3', B, 10000, at('2026-11-23T09:00:00Z')); // next Monday
    for (const id of ['o1', 'o2', 'o3']) await countTopUp(kv as unknown as Store, id);
    const t = await readTopUpTotals(kv as unknown as Store);
    expect(t).toMatchObject({ topUps: 3, wallets: 2, naira: 17500, firstAt: '2026-11-16T09:00:00.000Z' });
    expect(t.weeks['2026-11-16']).toEqual({ topUps: 2, naira: 7500 });
    expect(t.weeks['2026-11-23']).toEqual({ topUps: 1, naira: 10000 });
  });

  it('keeps no wallet, bank or name in the public totals', async () => {
    const kv = new MockKV();
    order(kv, 'o1', A, 5000, at('2026-11-18T10:00:00Z'));
    await countTopUp(kv as unknown as Store, 'o1');
    expect(kv.store.get('stats:topups')!.toLowerCase()).not.toContain('aaaaaaaa');
  });

  it('ignores an order it does not know or one with no amount', async () => {
    const kv = new MockKV();
    expect(await countTopUp(kv as unknown as Store, 'missing')).toBe(false);
    kv.store.set('onramp:o9', JSON.stringify({ wallet: A }));
    expect(await countTopUp(kv as unknown as Store, 'o9')).toBe(false);
    expect(kv.puts).toEqual([]);
  });

  it('writes three values per top-up (marker, wallet count, totals)', async () => {
    const kv = new MockKV();
    order(kv, 'o1', A, 5000, at('2026-11-18T10:00:00Z'));
    order(kv, 'o2', A, 5000, at('2026-11-18T11:00:00Z'));
    await countTopUp(kv as unknown as Store, 'o1');
    expect(kv.puts).toHaveLength(3);
    kv.puts.length = 0;
    await countTopUp(kv as unknown as Store, 'o2');
    expect(kv.puts).toHaveLength(3);
  });

  it('gives 12 weeks ending this week, zeros included, and drops older weeks from storage', async () => {
    const kv = new MockKV();
    for (let i = 0; i < 15; i++) {
      order(kv, `o${i}`, A, 1000, at('2026-08-03T10:00:00Z') + i * 7 * 86400000);
      await countTopUp(kv as unknown as Store, `o${i}`);
    }
    const t = await readTopUpTotals(kv as unknown as Store);
    expect(Object.keys(t.weeks)).toHaveLength(12);
    expect(t.topUps).toBe(15);
    const s = summariseTopUps(t, new Date('2026-11-20T12:00:00Z'));
    expect(s.weekly).toHaveLength(12);
    expect(s.weekly.at(-1)).toMatchObject({ date: '2026-11-16' });
    expect(s.thisWeek).toEqual({ topUps: s.weekly.at(-1)!.topUps, naira: s.weekly.at(-1)!.naira });
  });

  it('weekStart is the Monday', () => {
    expect(weekStart(at('2026-11-22T23:59:00Z'))).toBe('2026-11-16');
    expect(weekStart(at('2026-11-16T00:00:00Z'))).toBe('2026-11-16');
  });
});

describe('the team\'s own wallets', () => {
  it('are not counted, and nothing is written for them', async () => {
    const kv = new MockKV();
    order(kv, 'o1', A, 5000, at('2026-11-18T10:00:00Z'));
    order(kv, 'o2', B, 2000, at('2026-11-18T11:00:00Z'));
    const exclude = excludedWallets(` ${A.toUpperCase().replace('0X', '0x')} , not-a-wallet `);
    expect(await countTopUp(kv as unknown as Store, 'o1', Date.now(), exclude)).toBe(false);
    expect(kv.puts).toEqual([]);
    expect(await countTopUp(kv as unknown as Store, 'o2', Date.now(), exclude)).toBe(true);
    expect(await readTopUpTotals(kv as unknown as Store)).toMatchObject({ topUps: 1, wallets: 1, naira: 2000 });
  });
  it('excludedWallets keeps only real addresses, lower-cased', () => {
    expect([...excludedWallets(`${A}, junk,,${B.toUpperCase().replace('0X', '0x')}`)]).toEqual([A.toLowerCase(), B.toLowerCase()]);
    expect(excludedWallets(undefined).size).toBe(0);
  });
});

describe('per-wallet top-up count', () => {
  it('keeps each wallet\'s number of top-ups and first date, as value and metadata', async () => {
    const kv = new MockKV();
    order(kv, 'o1', A, 5000, at('2026-11-16T09:00:00Z'));
    order(kv, 'o2', A, 2500, at('2026-11-20T09:00:00Z'));
    await countTopUp(kv as unknown as Store, 'o1');
    await countTopUp(kv as unknown as Store, 'o2');
    const key = `topupwallet:${A.toLowerCase()}`;
    const want = { n: 2, first: at('2026-11-16T09:00:00Z') };
    expect(JSON.parse(kv.store.get(key)!)).toEqual(want);
    expect(kv.meta.get(key)).toEqual(want);
  });

  it('treats an old "1" marker as one earlier top-up with no date', async () => {
    const kv = new MockKV();
    kv.store.set(`topupwallet:${A.toLowerCase()}`, '1');
    order(kv, 'o1', A, 5000, at('2026-11-20T09:00:00Z'));
    await countTopUp(kv as unknown as Store, 'o1');
    expect(kv.meta.get(`topupwallet:${A.toLowerCase()}`)).toEqual({ n: 2, first: null });
    expect((await readTopUpTotals(kv as unknown as Store)).wallets).toBe(0); // not a new wallet: it was counted before
  });
});
