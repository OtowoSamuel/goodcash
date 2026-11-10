/**
 * The schedule must not spend storage list calls (1,000 a day on the free plan) when nothing is open, and must never
 * miss work that is open.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import type { Env } from '../index';
import { sweepOpenCashOuts } from './cashouts';
import { sweepOpenTopUps } from './topups';
import { clearWorkIfIdle, markWork, shouldList } from './work';
import { processWebhookQueue } from './webhooks';
import type { V1Deps } from './types';

class MockKV {
  store = new Map<string, string>();
  lists = 0;
  async get(k: string) {
    return this.store.get(k) ?? null;
  }
  async put(k: string, v: string) {
    this.store.set(k, v);
  }
  async delete(k: string) {
    this.store.delete(k);
  }
  async list(opts: { prefix?: string } = {}) {
    this.lists++;
    return { keys: [...this.store.keys()].filter((k) => k.startsWith(opts.prefix ?? '')).sort().map((name) => ({ name })), list_complete: true };
  }
}

// 10-minute slots; slot number % 6 === 0 is the hourly safety run
const QUIET = 10 * 60_000 * 7; // slot 7: not a safety run
const SAFETY = 10 * 60_000 * 12; // slot 12: a safety run

let kv: MockKV;
let env: Env;
beforeEach(() => {
  kv = new MockKV();
  env = { ORDER_STORE: kv as unknown as KVNamespace, PARTNER_ONRAMP_ENABLED: 'true' } as Env;
});

describe('work markers', () => {
  it('skip the list on a quiet run when no marker is set, and list on the hourly safety run', async () => {
    expect(await shouldList(env, 'x', QUIET)).toBe(false);
    expect(await shouldList(env, 'x', SAFETY)).toBe(true);
  });

  it('list on every run while the marker is set', async () => {
    await markWork(env, 'x', QUIET - 1);
    expect(await shouldList(env, 'x', QUIET)).toBe(true);
  });

  it('are cleared only when the list began after the marker was set', async () => {
    await markWork(env, 'x', 1000);
    await clearWorkIfIdle(env, 'x', 500); // marker is newer than the list: someone added work meanwhile
    expect(kv.store.has('work:x')).toBe(true);
    await clearWorkIfIdle(env, 'x', 1500);
    expect(kv.store.has('work:x')).toBe(false);
  });
});

describe('the schedule uses no list calls when idle', () => {
  const deps = {} as V1Deps;

  it('webhook retries: zero lists with no marker on a quiet run, one on the hourly run, and the marker clears when empty', async () => {
    await processWebhookQueue(env, QUIET);
    expect(kv.lists).toBe(0);
    await markWork(env, 'whq', QUIET - 1);
    await processWebhookQueue(env, QUIET); // lists once, finds nothing, clears the marker
    expect(kv.lists).toBe(1);
    expect(kv.store.has('work:whq')).toBe(false);
    await processWebhookQueue(env, QUIET);
    expect(kv.lists).toBe(1);
    await processWebhookQueue(env, SAFETY);
    expect(kv.lists).toBe(2);
  });

  it('keeps the marker while a retry is still waiting', async () => {
    await markWork(env, 'whq', 1);
    await kv.put(`whq:${String(Date.now() + 3_600_000).padStart(13, '0')}:evt`, '{}');
    await processWebhookQueue(env, Date.now());
    expect(kv.store.has('work:whq')).toBe(true);
  });

  it('open cash outs and top-ups: no list when nothing is marked', async () => {
    // outside the safety slot, so only a marker can trigger a list
    const realNow = Date.now;
    Date.now = () => QUIET;
    try {
      await sweepOpenCashOuts(env, deps);
      await sweepOpenTopUps(env, deps);
      expect(kv.lists).toBe(0);
      await markWork(env, 'pcopen', QUIET - 1);
      await sweepOpenCashOuts(env, deps);
      expect(kv.lists).toBe(1);
      expect(kv.store.has('work:pcopen')).toBe(false);
    } finally {
      Date.now = realNow;
    }
  });
});
