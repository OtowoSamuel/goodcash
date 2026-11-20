import { describe, expect, it } from 'vitest';
import { countActivePartners, markPartnerActive } from './partnerActive';
import { notifyChange } from './v1/cashouts';
import { notifyTopUp } from './v1/topups';
import type { CashOutRecord, Env, TopUpRecord } from './v1/types';

class MockKV {
  store = new Map<string, string>();
  puts: string[] = [];
  async get(k: string) {
    return this.store.get(k) ?? null;
  }
  async put(k: string, v: string) {
    this.puts.push(k);
    this.store.set(k, v);
  }
  async delete(k: string) {
    this.store.delete(k);
  }
  async list(opts: { prefix?: string; limit?: number } = {}) {
    const all = [...this.store.keys()].filter((k) => k.startsWith(opts.prefix ?? '')).sort();
    return { keys: all.slice(0, opts.limit ?? 1000).map((name) => ({ name })), list_complete: true };
  }
}
const asStore = (kv: MockKV) => kv as unknown as KVNamespace;

describe('partners with a real transaction', () => {
  it('marks a partner once, however often it happens', async () => {
    const kv = new MockKV();
    await markPartnerActive(asStore(kv), 'p_abc123');
    await markPartnerActive(asStore(kv), 'p_abc123');
    await markPartnerActive(asStore(kv), 'p_abc123');
    expect(kv.puts).toEqual(['partneractive:p_abc123']);
    expect(await countActivePartners(asStore(kv))).toBe(1);
  });

  it('ignores an id that is not a partner id, and a storage failure never throws', async () => {
    const kv = new MockKV();
    await markPartnerActive(asStore(kv), '../etc');
    expect(kv.puts).toEqual([]);
    const broken = { get: async () => { throw new Error('KV down'); }, put: async () => undefined } as unknown as KVNamespace;
    await expect(markPartnerActive(broken, 'p_abc123')).resolves.toBeUndefined();
  });

  const env = (kv: MockKV) => ({ ORDER_STORE: asStore(kv) }) as unknown as Env;
  const cashOut = (mode: 'live' | 'test', status: string) => ({ id: 'c1', partnerId: 'p_live01', mode, status, wallet: '0x' + '1'.repeat(40), amountG: '5000', createdAt: Date.now(), updatedAt: Date.now(), sentAt: Date.now() }) as unknown as CashOutRecord;
  const topUp = (mode: 'live' | 'test', status: string) => ({ id: 't1', partnerId: 'p_live01', mode, status, wallet: '0x' + '1'.repeat(40), naira: 5000, asset: 'g', createdAt: Date.now(), updatedAt: Date.now() }) as unknown as TopUpRecord;

  it('a live cash out that is paid counts; a test one, or one still open, does not', async () => {
    const kv = new MockKV();
    await notifyChange(env(kv), cashOut('test', 'paid'), true, false);
    await notifyChange(env(kv), cashOut('live', 'processing'), true, false);
    await notifyChange(env(kv), cashOut('live', 'failed'), true, false);
    expect(await countActivePartners(asStore(kv))).toBe(0);
    await notifyChange(env(kv), cashOut('live', 'paid'), true, false);
    expect(await countActivePartners(asStore(kv))).toBe(1);
  });

  it('a live top-up that is delivered counts; a test one, or one not delivered, does not', async () => {
    const kv = new MockKV();
    await notifyTopUp(env(kv), topUp('test', 'delivered'), true);
    await notifyTopUp(env(kv), topUp('live', 'paid_in'), true);
    await notifyTopUp(env(kv), topUp('live', 'expired'), true);
    expect(await countActivePartners(asStore(kv))).toBe(0);
    await notifyTopUp(env(kv), topUp('live', 'delivered'), true);
    expect(await countActivePartners(asStore(kv))).toBe(1);
  });

  it('only counts when the status has just changed (a re-check of an old one writes nothing)', async () => {
    const kv = new MockKV();
    await notifyChange(env(kv), cashOut('live', 'paid'), false, false);
    expect(kv.puts).toEqual([]);
  });
});
