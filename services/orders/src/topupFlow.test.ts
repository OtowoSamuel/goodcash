/** Top-up numbers on the public stats page, through the real Worker: counted when a top-up settles, once. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import worker from './index.js';
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
  async list(opts: { prefix?: string; limit?: number } = {}) {
    const all = [...this.store.keys()].filter((k) => k.startsWith(opts.prefix ?? '')).sort();
    return { keys: all.slice(0, opts.limit ?? 1000).map((name) => ({ name })), list_complete: true };
  }
}

const FRIEND = '0xDeaDbeefdEAdbeefdEadbEEFdeadbeEFdEaDbeeF';
const INVITER = '0x2222222222222222222222222222222222222222';
const ID1 = '660e8400-e29b-41d4-a716-446655440001';
const ID2 = '660e8400-e29b-41d4-a716-446655440002';
const SECRET = 'test-secret';

let kv: MockKV;
let env: Env;
let partnerStatus = 'pending';
let nextId = ID1;

const call = (method: string, path: string, body?: unknown) =>
  worker.fetch(new Request(`https://api.goodcash.xyz${path}`, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }), env);

const orderBody = (extra: Record<string, unknown> = {}) => ({
  naira: 5000,
  wallet: FRIEND,
  fullName: 'Ada Obi',
  birthDate: '1995-03-02',
  idType: 'BVN',
  idNumber: '22212345678',
  refundAccount: { institution: 'GTBINGLA', accountIdentifier: '0123456789', accountName: 'Ada Obi' },
  ...extra,
});

async function signedWebhook(id: string, status: string): Promise<Response> {
  const payload = JSON.stringify({ event: `payment_order.${status}`, data: { id, status } });
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = [...new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload)))].map((b) => b.toString(16).padStart(2, '0')).join('');
  return worker.fetch(new Request('https://api.goodcash.xyz/webhooks/paycrest', { method: 'POST', headers: { 'X-Paycrest-Signature': sig }, body: payload }), env);
}

const topUps = async () => ((await (await call('GET', '/stats')).json()) as { topUps: { topUps: number; wallets: number; naira: number } }).topUps;

beforeEach(() => {
  kv = new MockKV();
  partnerStatus = 'pending';
  nextId = ID1;
  env = {
    PAYCREST_API_KEY: 'k',
    PAYCREST_API_SECRET: SECRET,
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
      if (u.includes('/api?module=logs')) return Response.json({ message: 'No logs found', result: [] });
      if (u.includes('/v2/rates/')) return Response.json({ data: { buy: { rate: '1400' } } });
      if (u.endsWith('/v2/sender/orders') && init?.method === 'POST') {
        return Response.json(
          { status: 'success', data: { id: nextId, status: 'initiated', providerAccount: { institution: 'Bank X', accountIdentifier: '9990001111', accountName: 'Pay Partner', amountToTransfer: '5000', currency: 'NGN', validUntil: '2026-12-08T22:00:00Z' } } },
          { status: 201 },
        );
      }
      if (u.includes('/v2/sender/orders/')) return Response.json({ data: { id: u.split('/').pop(), status: partnerStatus } });
      throw new Error(`unexpected fetch ${u}`);
    }),
  );
});

afterEach(() => vi.unstubAllGlobals());

describe('top-up numbers on the stats page', () => {
  it('T1. nothing before the money arrives, then one top-up counted from polling', async () => {
    await call('POST', '/onramp/orders', orderBody());
    expect(await topUps()).toMatchObject({ topUps: 0, wallets: 0, naira: 0 });
    partnerStatus = 'settled';
    await call('GET', `/onramp/orders/${ID1}`);
    expect(await topUps()).toMatchObject({ topUps: 1, wallets: 1, naira: 5000 });
  });

  it('T2. counts from the signed webhook when the app is closed, and a forged one counts nothing', async () => {
    await call('POST', '/onramp/orders', orderBody());
    const forged = await worker.fetch(new Request('https://api.goodcash.xyz/webhooks/paycrest', { method: 'POST', headers: { 'X-Paycrest-Signature': 'deadbeef' }, body: JSON.stringify({ event: 'payment_order.settled', data: { id: ID1, status: 'settled' } }) }), env);
    expect(forged.status).toBe(403);
    expect(await topUps()).toMatchObject({ topUps: 0 });
    expect((await signedWebhook(ID1, 'settled')).status).toBe(200);
    expect(await topUps()).toMatchObject({ topUps: 1, naira: 5000 });
  });

  it('T3. polling and the webhook together, over and over, count it once', async () => {
    await call('POST', '/onramp/orders', orderBody());
    partnerStatus = 'settled';
    await call('GET', `/onramp/orders/${ID1}`);
    await signedWebhook(ID1, 'settled');
    await call('GET', `/onramp/orders/${ID1}`);
    await signedWebhook(ID1, 'settled');
    expect(await topUps()).toMatchObject({ topUps: 1, wallets: 1, naira: 5000 });
  });

  it('T4. a returning wallet adds a top-up but not a new wallet', async () => {
    await call('POST', '/onramp/orders', orderBody());
    partnerStatus = 'settled';
    await call('GET', `/onramp/orders/${ID1}`);
    nextId = ID2;
    await call('POST', '/onramp/orders', orderBody({ naira: 3000 }));
    await call('GET', `/onramp/orders/${ID2}`);
    expect(await topUps()).toMatchObject({ topUps: 2, wallets: 1 });
  });

  it('T5. a counting failure never breaks the order', async () => {
    await call('POST', '/onramp/orders', orderBody());
    partnerStatus = 'settled';
    kv.failPutsFor = 'topupcounted:';
    const res = await call('GET', `/onramp/orders/${ID1}`);
    expect(res.status).toBe(200);
    expect(((await res.json()) as { stage: string }).stage).toBe('done');
  });

  it('T6. the public numbers carry no wallet, bank or name', async () => {
    await call('POST', '/onramp/orders', orderBody());
    partnerStatus = 'settled';
    await call('GET', `/onramp/orders/${ID1}`);
    const text = JSON.stringify(await topUps()).toLowerCase();
    for (const secret of [FRIEND.toLowerCase().slice(2, 12), 'ada', '0123456789', '22212345678']) expect(text).not.toContain(secret);
  });
});
