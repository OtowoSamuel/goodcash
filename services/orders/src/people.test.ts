import { afterEach, describe, expect, it, vi } from 'vitest';
import { summarisePeople } from './people';
import { rootsOf } from './verified';

const A = '0x' + 'a'.repeat(40);
const B = '0x' + 'b'.repeat(40);
const C = '0x' + 'c'.repeat(40);
const D = '0x' + 'd'.repeat(40);
const ROOT_AB = '0x' + '1'.repeat(40); // A and B belong to one verified person
const ROOT_C = '0x' + '2'.repeat(40);
const word = (a: string) => `0x${'0'.repeat(24)}${a.slice(2)}`;
const E = '0x' + 'e'.repeat(40); // verified once, 3 days ran out
const F = '0x' + 'f'.repeat(40); // blacklisted
const rootFor: Record<string, string> = { [A]: ROOT_AB, [B]: ROOT_AB, [C]: ROOT_C, [D]: '0x' + '0'.repeat(40), [E]: '0x' + '0'.repeat(40), [F]: '0x' + '0'.repeat(40) };
const statusFor: Record<string, number> = { [A]: 1, [B]: 0, [C]: 1, [D]: 0, [E]: 1, [F]: 255 };
const identity = (w: string) => '0x' + [1, 1, 192, 42220, statusFor[w] ?? 0, 0, 0].map((n) => n.toString(16).padStart(64, '0')).join('');

function chain(opts: { shuffle?: boolean; fail?: boolean } = {}) {
  const calls: number[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, init?: RequestInit) => {
      if (opts.fail) return Response.json({}, { status: 500 });
      const batch = JSON.parse(String(init?.body)) as Array<{ id: number; params: Array<{ data: string }> }>;
      calls.push(batch.length);
      const answers = batch.map((c) => {
        const w = `0x${c.params[0].data.slice(-40)}`;
        return { jsonrpc: '2.0', id: c.id, result: c.params[0].data.startsWith('0xf653b81e') ? identity(w) : word(rootFor[w] ?? '0x' + '0'.repeat(40)) };
      });
      return Response.json(opts.shuffle ? answers.reverse() : answers);
    }),
  );
  return calls;
}
afterEach(() => vi.unstubAllGlobals());

describe('verified people', () => {
  it('counts wallets, verified wallets, and each person once however many wallets they have', async () => {
    chain();
    expect(await summarisePeople({}, [A, B, C, D])).toEqual({ wallets: 4, verifiedWallets: 3, verifiedPeople: 2, verifiedNow: 3 });
  });
  it('keeps counting a person whose first 3-day verification ran out, but never a blacklisted wallet', async () => {
    chain();
    expect(await summarisePeople({}, [A, B, C, D, E, F])).toEqual({ wallets: 6, verifiedWallets: 4, verifiedPeople: 3, verifiedNow: 3 });
  });
  it('matches answers to wallets even when the node answers out of order', async () => {
    chain({ shuffle: true });
    expect(await summarisePeople({}, [A, C, D])).toEqual({ wallets: 3, verifiedWallets: 2, verifiedPeople: 2, verifiedNow: 2 });
  });
  it('counts a repeated wallet, in any letter case, once', async () => {
    chain();
    expect(await summarisePeople({}, [A, A.toUpperCase().replace('0X', '0x'), A])).toMatchObject({ wallets: 1, verifiedPeople: 1 });
  });
  it('no number rather than a wrong one when the chain cannot be read', async () => {
    chain({ fail: true });
    expect(await summarisePeople({}, [A, B])).toBeNull();
  });
  it('asks in batches of 100, and does not try more than 500 wallets', async () => {
    const calls = chain();
    const wallets = Array.from({ length: 250 }, (_, i) => `0x${i.toString(16).padStart(40, '0')}`);
    vi.stubGlobal('fetch', vi.fn(async (_u: string, init?: RequestInit) => {
      const batch = JSON.parse(String(init?.body)) as Array<{ id: number; params: Array<{ data: string }> }>;
      calls.push(batch.length);
      return Response.json(batch.map((c) => ({ jsonrpc: '2.0', id: c.id, result: c.params[0].data.startsWith('0xf653b81e') ? identity(A) : word(ROOT_C) })));
    }));
    calls.length = 0;
    expect((await summarisePeople({}, wallets))?.verifiedPeople).toBe(1);
    expect([...calls].sort()).toEqual([100, 100, 100, 100, 50, 50]); // roots and identity records, 100 at a time
    expect(await rootsOf({}, Array.from({ length: 501 }, (_, i) => `0x${i.toString(16).padStart(40, '0')}`))).toBeNull();
  });
  it('carries no wallet address in its answer', async () => {
    chain();
    expect(JSON.stringify(await summarisePeople({}, [A, B, C]))).not.toMatch(/0x/);
  });
});
