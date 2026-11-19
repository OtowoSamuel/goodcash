import { describe, expect, it } from 'vitest';
import worker from './index.js';
import type { Env } from './index.js';
import { inviterFrom, qualifyReferral, REFERRAL, referralSummary } from './referral';

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

const FRIEND = '0x1111111111111111111111111111111111111111';
const INVITER = '0x2222222222222222222222222222222222222222';
const ID = '660e8400-e29b-41d4-a716-446655440001';
const ID2 = '660e8400-e29b-41d4-a716-446655440002';

function setup(order: Record<string, unknown> = {}) {
  const kv = new MockKV();
  kv.store.set(`onramp:${ID}`, JSON.stringify({ wallet: FRIEND, naira: 5000, asset: 'g', ref: INVITER, ...order }));
  kv.store.set(`onramp-wallet:${FRIEND}:${ID}`, JSON.stringify({ naira: 5000, stage: 'done' }));
  return kv;
}

describe('inviterFrom', () => {
  it('accepts an address in any case and lowers it', () => {
    expect(inviterFrom(INVITER.toUpperCase().replace('0X', '0x'))).toBe(INVITER);
  });
  it('ignores anything that is not an address', () => {
    for (const bad of [undefined, null, '', 'hello', '0x123', 42, `${INVITER}00`]) expect(inviterFrom(bad)).toBeNull();
  });
});

describe('qualifyReferral', () => {
  it('records a pending reward for a first top-up that came from a link', async () => {
    const kv = setup();
    const r = await qualifyReferral(kv as unknown as KVNamespace, ID, 1000);
    expect(r).toMatchObject({ ok: true, reward: { inviter: INVITER, orderId: ID, naira: 5000, newG: REFERRAL.newG, inviterG: REFERRAL.inviterG, status: 'pending' } });
    expect(kv.store.has(`refq:${FRIEND}`)).toBe(true);
    expect(kv.store.has(`refin:${INVITER}:${FRIEND}`)).toBe(true);
  });

  it('does nothing for a top-up with no link', async () => {
    const kv = setup({ ref: undefined });
    expect(await qualifyReferral(kv as unknown as KVNamespace, ID)).toEqual({ ok: false, reason: 'no_referral' });
    expect(kv.puts).toEqual([]);
  });

  it('refuses to reward someone for inviting themselves', async () => {
    const kv = setup({ ref: FRIEND });
    expect(await qualifyReferral(kv as unknown as KVNamespace, ID)).toEqual({ ok: false, reason: 'self' });
    expect(kv.puts).toEqual([]);
  });

  it('needs the minimum amount, and counts exactly the minimum', async () => {
    const small = setup({ naira: REFERRAL.minNaira - 1 });
    expect(await qualifyReferral(small as unknown as KVNamespace, ID)).toEqual({ ok: false, reason: 'too_small' });
    const exact = setup({ naira: REFERRAL.minNaira });
    expect((await qualifyReferral(exact as unknown as KVNamespace, ID)).ok).toBe(true);
  });

  it('only counts the first finished top-up, not a later one', async () => {
    const kv = setup();
    kv.store.set(`onramp:${ID2}`, JSON.stringify({ wallet: FRIEND, naira: 9000, ref: INVITER }));
    kv.store.set(`onramp-wallet:${FRIEND}:${ID2}`, JSON.stringify({ naira: 9000, stage: 'waiting' }));
    expect((await qualifyReferral(kv as unknown as KVNamespace, ID)).ok).toBe(true);
    // the second one finishes later
    kv.store.set(`onramp-wallet:${FRIEND}:${ID2}`, JSON.stringify({ naira: 9000, stage: 'done' }));
    expect(await qualifyReferral(kv as unknown as KVNamespace, ID2)).toEqual({ ok: false, reason: 'already' });
  });

  it('does not count a top-up when an earlier one already finished without a link', async () => {
    const kv = setup();
    kv.store.set(`onramp-wallet:${FRIEND}:${ID2}`, JSON.stringify({ naira: 3000, stage: 'done' }));
    expect(await qualifyReferral(kv as unknown as KVNamespace, ID)).toEqual({ ok: false, reason: 'not_first' });
  });

  it('ignores an earlier order that never finished', async () => {
    const kv = setup();
    kv.store.set(`onramp-wallet:${FRIEND}:${ID2}`, JSON.stringify({ naira: 3000, stage: 'expired' }));
    expect((await qualifyReferral(kv as unknown as KVNamespace, ID)).ok).toBe(true);
  });

  it('running twice for the same order records once', async () => {
    const kv = setup();
    await qualifyReferral(kv as unknown as KVNamespace, ID);
    const putsAfterFirst = kv.puts.length;
    expect(await qualifyReferral(kv as unknown as KVNamespace, ID)).toEqual({ ok: false, reason: 'already' });
    expect(kv.puts.length).toBe(putsAfterFirst);
  });

  it('after the cap, the friend still gets their bonus but the inviter is not paid again', async () => {
    const kv = setup();
    for (let i = 0; i < REFERRAL.maxPerInviter; i++) kv.store.set(`refin:${INVITER}:0x${String(i).padStart(40, '0')}`, '1');
    const r = await qualifyReferral(kv as unknown as KVNamespace, ID);
    expect(r).toMatchObject({ ok: true, reward: { newG: REFERRAL.newG, inviterG: 0 } });
    expect(kv.store.has(`refin:${INVITER}:${FRIEND}`)).toBe(false);
  });

  it('reports an unknown order without throwing', async () => {
    expect(await qualifyReferral(new MockKV() as unknown as KVNamespace, ID)).toEqual({ ok: false, reason: 'no_order' });
  });
});

describe('referralSummary and GET /referral/me', () => {
  it('adds up what an inviter earned and what a friend got', async () => {
    const kv = setup();
    await qualifyReferral(kv as unknown as KVNamespace, ID);
    const inviter = await referralSummary(kv as unknown as KVNamespace, INVITER);
    expect(inviter).toMatchObject({ friends: 1, earnedG: REFERRAL.inviterG, bonusG: 0, minNaira: REFERRAL.minNaira });
    const friend = await referralSummary(kv as unknown as KVNamespace, FRIEND);
    expect(friend).toMatchObject({ friends: 0, earnedG: 0, bonusG: REFERRAL.newG });
  });

  it('answers over HTTP, and refuses a bad wallet', async () => {
    const kv = setup();
    await qualifyReferral(kv as unknown as KVNamespace, ID);
    const env = { ORDER_STORE: kv } as unknown as Env;
    const ok = await worker.fetch(new Request(`https://api.test/referral/me?wallet=${INVITER}`), env);
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ friends: 1, earnedG: REFERRAL.inviterG });
    const bad = await worker.fetch(new Request('https://api.test/referral/me?wallet=nope'), env);
    expect(bad.status).toBe(400);
  });
});
