/**
 * Naira-in History (Naira -> G$ / CELO rows in a wallet's History): a row per order, kept in step with the order,
 * without wearing out storage, without ever breaking an order, plus the one-time catch-up for earlier orders.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import worker, { backfillOnrampHistory } from './index.js';
import type { Env } from './index.js';

class MockKV {
  store = new Map<string, string>();
  puts: string[] = [];
  failPutsFor: string | null = null;
  async get(k: string) {
    return this.store.get(k) ?? null;
  }
  async put(k: string, v: string) {
    if (this.failPutsFor && k.startsWith(this.failPutsFor)) throw new Error('KV put failed');
    this.puts.push(k);
    this.store.set(k, v);
  }
  async delete(k: string) {
    this.store.delete(k);
  }
  async list(opts: { prefix?: string; limit?: number; cursor?: string } = {}) {
    const all = [...this.store.keys()].filter((k) => k.startsWith(opts.prefix ?? '')).sort();
    const start = opts.cursor ? Number(opts.cursor) : 0;
    const limit = opts.limit ?? 1000;
    const done = start + limit >= all.length;
    return { keys: all.slice(start, start + limit).map((name) => ({ name })), list_complete: done, ...(done ? {} : { cursor: String(start + limit) }) };
  }
}

const WALLET = '0xDeaDbeefdEAdbeefdEadbEEFdeadbeEFdEaDbeeF';
const ID = '660e8400-e29b-41d4-a716-446655440001';
const ID2 = '660e8400-e29b-41d4-a716-446655440002';

let kv: MockKV;
let env: Env;
let partnerStatus = 'pending';
let partnerCalls = 0;

const call = (method: string, path: string, body?: unknown) =>
  worker.fetch(
    new Request(`https://api.goodcash.xyz${path}`, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }),
    env
  );

const ORDER_BODY = {
  naira: 5000,
  wallet: WALLET,
  fullName: 'Ada Obi',
  birthDate: '1995-03-02',
  idType: 'BVN',
  idNumber: '22212345678',
  refundAccount: { institution: 'GTBINGLA', accountIdentifier: '0123456789', accountName: 'Ada Obi' },
};

beforeEach(() => {
  kv = new MockKV();
  partnerStatus = 'pending';
  partnerCalls = 0;
  env = {
    PAYCREST_API_KEY: 'k',
    PAYCREST_API_SECRET: 's',
    PAYCREST_BASE_URL: 'https://api.paycrest.io',
    ORDER_STORE: kv as unknown as KVNamespace,
    ALLOWED_ORIGINS: 'https://goodcash.xyz',
    VERIFY_SWAP_ONCHAIN: 'false',
    RATE_LIMIT_MAX: '0',
  } as Env;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const u = String(url);
      if (u.includes('forno.celo.org')) {
        const { method } = JSON.parse(String(init?.body)) as { method: string };
        return Response.json({ result: method === 'eth_blockNumber' ? '0x100000' : [] });
      }
      if (u.endsWith('/v2/sender/orders') && init?.method === 'POST') {
        return Response.json(
          { status: 'success', data: { id: ID, status: 'initiated', providerAccount: { institution: 'Bank X', accountIdentifier: '9990001111', accountName: 'Pay Partner', amountToTransfer: '5000', currency: 'NGN', validUntil: '2026-11-08T22:00:00Z' } } },
          { status: 201 }
        );
      }
      if (u.includes('/v2/sender/orders/')) {
        partnerCalls++;
        return Response.json({ data: { id: u.split('/').pop(), status: partnerStatus } });
      }
      throw new Error(`unexpected fetch ${u}`);
    })
  );
});

afterEach(() => vi.unstubAllGlobals());

const history = async (wallet = WALLET) =>
  (await (await call('GET', `/history?wallet=${wallet}`)).json()) as { onramps: Array<{ orderId: string; naira: number; asset: string; stage: string; arrived: boolean; out?: number; usd?: number }> };

describe('a History row per naira order', () => {
  it('H1. starts when the order is created, with the amounts the app showed (labels only), and holds no personal details', async () => {
    const res = await call('POST', '/onramp/orders', { ...ORDER_BODY, asset: 'celo', expectedOut: 3.21, expectedUsd: 3.3 });
    expect(res.status).toBe(201);
    const row = (await kv.get(`onramp-wallet:${WALLET.toLowerCase()}:${ID}`))!;
    expect(JSON.parse(row)).toMatchObject({ naira: 5000, asset: 'celo', stage: 'waiting', out: 3.21, usd: 3.3 });
    expect(row).not.toMatch(/Ada|22212345678|0123456789/);
    const h = await history();
    expect(h.onramps).toHaveLength(1);
    expect(h.onramps[0]).toMatchObject({ orderId: ID, naira: 5000, asset: 'celo', stage: 'waiting', arrived: false });
  });

  it('H2. an order is still created when History cannot save its row', async () => {
    kv.failPutsFor = 'onramp-wallet:';
    const res = await call('POST', '/onramp/orders', ORDER_BODY);
    expect(res.status).toBe(201);
    expect(((await res.json()) as { orderId: string }).orderId).toBe(ID);
    expect(await kv.get(`onramp:${ID}`)).not.toBeNull();
  });

  it('H3. History follows the payout partner (asked together, not one by one) and keeps the answer', async () => {
    await call('POST', '/onramp/orders', ORDER_BODY);
    partnerStatus = 'fulfilling';
    const h = await history();
    expect(h.onramps[0].stage).toBe('received');
    const again = await history();
    expect(again.onramps[0].stage).toBe('received');
    expect(partnerCalls).toBe(1); // asked once, then trusted for ten minutes
  });

  it('H4. only that wallet sees its rows', async () => {
    await call('POST', '/onramp/orders', ORDER_BODY);
    expect((await history('0x1111111111111111111111111111111111111111')).onramps).toEqual([]);
  });
});

describe('asking for an order status does not wear out storage', () => {
  it('H5. many status checks with no change write nothing; a real change writes once', async () => {
    await call('POST', '/onramp/orders', ORDER_BODY);
    partnerStatus = 'pending';
    kv.puts.length = 0;
    for (let i = 0; i < 10; i++) expect((await call('GET', `/onramp/orders/${ID}`)).status).toBe(200);
    expect(kv.puts.filter((k) => k.startsWith('onramp-wallet:'))).toHaveLength(0);
    partnerStatus = 'fulfilling';
    for (let i = 0; i < 10; i++) await call('GET', `/onramp/orders/${ID}`);
    expect(kv.puts.filter((k) => k.startsWith('onramp-wallet:'))).toHaveLength(1);
    expect(JSON.parse((await kv.get(`onramp-wallet:${WALLET.toLowerCase()}:${ID}`))!).stage).toBe('received');
  });

  it('H6. "arrived" is recorded once the swap is confirmed, and a late message never undoes a finished order', async () => {
    await call('POST', '/onramp/orders', ORDER_BODY);
    const key = `onramp-wallet:${WALLET.toLowerCase()}:${ID}`;
    await kv.put(key, JSON.stringify({ ...JSON.parse((await kv.get(key))!), arrived: true, stage: 'done' }));
    partnerStatus = 'pending'; // an old answer
    const res = (await (await call('GET', `/onramp/orders/${ID}`)).json()) as { arrived: boolean };
    expect(res.arrived).toBe(true);
    expect((await history()).onramps[0]).toMatchObject({ arrived: true, stage: 'done' });
  });
});

describe('catching up orders made before History existed', () => {
  const old = (id: string, wallet: string, naira: number, asset: string, ageDays: number) =>
    kv.put(`onramp:${id}`, JSON.stringify({ wallet: wallet.toLowerCase(), naira, asset, createdAt: Date.now() - ageDays * 86400_000 }));

  it('H7. gives each earlier order its row (naira, asset, original time), skips ones that already have one, and finishes', async () => {
    await old(ID, WALLET, 5000, 'celo', 3);
    await old(ID2, WALLET, 2000, 'g', 6);
    await kv.put(`onramp-wallet:${WALLET.toLowerCase()}:${ID2}`, JSON.stringify({ naira: 2000, asset: 'g', at: 1, stage: 'done', arrived: true }));
    const out = await backfillOnrampHistory(env);
    expect(out).toEqual({ scanned: 2, added: 1, done: true });
    const added = JSON.parse((await kv.get(`onramp-wallet:${WALLET.toLowerCase()}:${ID}`))!);
    expect(added).toMatchObject({ naira: 5000, asset: 'celo' });
    expect(Math.abs(added.at - (Date.now() / 1000 - 3 * 86400))).toBeLessThan(5);
    expect(added.stage).toBeUndefined(); // History asks the payout partner the first time
    // an existing row is never overwritten
    expect(JSON.parse((await kv.get(`onramp-wallet:${WALLET.toLowerCase()}:${ID2}`))!)).toMatchObject({ arrived: true, stage: 'done', at: 1 });
    // done for good: nothing more is read
    expect(await backfillOnrampHistory(env)).toEqual({ scanned: 0, added: 0, done: true });
  });

  it('H8. the earlier order then shows in History with its real stage from the partner', async () => {
    await old(ID, WALLET, 5000, 'g', 2);
    await backfillOnrampHistory(env);
    partnerStatus = 'settled';
    const h = await history();
    expect(h.onramps[0]).toMatchObject({ orderId: ID, naira: 5000, asset: 'g', stage: 'done', arrived: false });
  });

  it('H9. works through a long list a few at a time, without losing its place', async () => {
    for (let i = 0; i < 45; i++) await old(`660e8400-e29b-41d4-a716-4466554400${String(i).padStart(2, '0')}`, WALLET, 1000 + i, 'g', 1);
    const runs = [await backfillOnrampHistory(env), await backfillOnrampHistory(env), await backfillOnrampHistory(env)];
    expect(runs.map((r) => r.scanned)).toEqual([20, 20, 5]);
    expect(runs.map((r) => r.done)).toEqual([false, false, true]);
    expect(runs.reduce((n, r) => n + r.added, 0)).toBe(45);
  });

  it('H10. skips records it cannot use, and never touches other order keys', async () => {
    await kv.put(`onramp:${ID}`, 'not json');
    await kv.put(`onramp:${ID2}`, JSON.stringify({ wallet: 'nope', naira: 5, asset: 'g', createdAt: 1 }));
    await kv.put(`onramphold:${ID}`, '1');
    await kv.put(`onrampnotify:${ID}`, JSON.stringify({ to: 'a@b.c' }));
    const out = await backfillOnrampHistory(env);
    expect(out.added).toBe(0);
    expect([...kv.store.keys()].some((k) => k.startsWith('onramp-wallet:'))).toBe(false);
  });

  it('H11. runs on the worker schedule', async () => {
    await old(ID, WALLET, 5000, 'g', 1);
    await worker.scheduled({}, env);
    expect(await kv.get(`onramp-wallet:${WALLET.toLowerCase()}:${ID}`)).not.toBeNull();
  });
});
