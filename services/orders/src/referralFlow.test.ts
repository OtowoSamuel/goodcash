/**
 * The referral campaign through the real Worker: an order created with a friend's link, settled by the payout
 * partner (by polling and by the signed webhook), and read back from the public endpoint.
 */
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

describe('an order that came from a friend\'s link', () => {
  it('R1. keeps the link with the order (lower case) and still works when the link is rubbish', async () => {
    expect((await call('POST', '/onramp/orders', orderBody({ ref: INVITER.toUpperCase().replace('0X', '0x') }))).status).toBe(201);
    expect(JSON.parse((await kv.get(`onramp:${ID1}`))!).ref).toBe(INVITER);

    kv.store.clear();
    expect((await call('POST', '/onramp/orders', orderBody({ ref: 'not-an-address' }))).status).toBe(201);
    expect(JSON.parse((await kv.get(`onramp:${ID1}`))!).ref).toBeUndefined();

    kv.store.clear();
    expect((await call('POST', '/onramp/orders', orderBody())).status).toBe(201);
    expect(JSON.parse((await kv.get(`onramp:${ID1}`))!).ref).toBeUndefined();
  });

  it('R2. a settled top-up no longer creates any referral reward (rewards now come from friends who verify and claim)', async () => {
    await call('POST', '/onramp/orders', orderBody({ ref: INVITER }));
    partnerStatus = 'settled';
    expect((await call('GET', `/onramp/orders/${ID1}`)).status).toBe(200);
    expect((await signedWebhook(ID1, 'settled')).status).toBe(200);
    expect(kv.puts.filter((k) => k.startsWith('ref'))).toHaveLength(0);
  });
});
