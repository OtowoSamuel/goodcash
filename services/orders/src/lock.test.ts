import { afterEach, describe, expect, it, vi } from 'vitest';
import { claimLock } from './lock';
import { fakeLockNamespace } from './lock.fake';

afterEach(() => vi.useRealTimers());

describe('KeyLock', () => {
  it('lets only one caller hold a name, and frees it when the holder releases', async () => {
    const env = { KEY_LOCK: fakeLockNamespace() };
    const a = await claimLock(env, 'order:1', 10_000);
    const b = await claimLock(env, 'order:1', 10_000);
    expect(a.ok).toBe(true);
    expect(b.ok).toBe(false);
    if (a.ok) await a.release();
    expect((await claimLock(env, 'order:1', 10_000)).ok).toBe(true);
  });

  it('keeps different names apart', async () => {
    const env = { KEY_LOCK: fakeLockNamespace() };
    expect((await claimLock(env, 'order:1', 10_000)).ok).toBe(true);
    expect((await claimLock(env, 'order:2', 10_000)).ok).toBe(true);
  });

  it('of many callers at the same moment, exactly one gets the claim', async () => {
    const env = { KEY_LOCK: fakeLockNamespace() };
    const results = await Promise.all(Array.from({ length: 12 }, () => claimLock(env, 'idem:x', 10_000)));
    expect(results.filter((r) => r.ok)).toHaveLength(1);
  });

  it('a claim runs out on its own, so a caller that dies cannot block a name for ever', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const env = { KEY_LOCK: fakeLockNamespace() };
    expect((await claimLock(env, 'order:1', 5_000)).ok).toBe(true);
    expect((await claimLock(env, 'order:1', 5_000)).ok).toBe(false);
    vi.setSystemTime(Date.now() + 6_000);
    expect((await claimLock(env, 'order:1', 5_000)).ok).toBe(true);
  });

  it('a late release from an expired holder does not free someone else\'s claim', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const env = { KEY_LOCK: fakeLockNamespace() };
    const first = await claimLock(env, 'order:1', 5_000);
    vi.setSystemTime(Date.now() + 6_000);
    const second = await claimLock(env, 'order:1', 5_000);
    expect(second.ok).toBe(true);
    if (first.ok) await first.release(); // the old holder wakes up late
    expect((await claimLock(env, 'order:1', 5_000)).ok).toBe(false); // the new holder still has it
  });

  it('without a lock service there is nothing to lock with, so the claim always succeeds', async () => {
    expect((await claimLock({}, 'order:1', 10_000)).ok).toBe(true);
  });

  it('if the lock service itself fails, it throws: callers stop instead of going on unprotected', async () => {
    const broken = { idFromName: (n: string) => n, get: () => ({ fetch: async () => new Response('no', { status: 500 }) }) } as unknown as DurableObjectNamespace;
    await expect(claimLock({ KEY_LOCK: broken }, 'order:1', 10_000)).rejects.toThrow(/lock service/);
  });
});
