/**
 * Partner top-ups (naira in): the switch, test mode, live mode against a mocked payout partner, the rule that an order
 * can only be attached by the wallet it belongs to, webhooks, and that nothing sensitive is ever stored.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import worker from '../index';
import type { Env } from '../index';
import { sha256Hex } from './auth';
import { encryptSecret, hmacHex } from './webhooks';
import { statusFromStage, testStatus, TEST_DELIVERED_AFTER_MS, TEST_PAID_AFTER_MS } from './topups';
import type { Partner, TopUpRecord } from './types';

class MockKV {
  store = new Map<string, string>();
  async get(k: string) {
    return this.store.get(k) ?? null;
  }
  async put(k: string, v: string) {
    this.store.set(k, v);
  }
  async delete(k: string) {
    this.store.delete(k);
  }
  async list(opts: { prefix?: string; limit?: number; cursor?: string } = {}) {
    const all = [...this.store.keys()].filter((k) => k.startsWith(opts.prefix ?? '')).sort();
    const start = opts.cursor ? Number(opts.cursor) : 0;
    const limit = opts.limit ?? 1000;
    const keys = all.slice(start, start + limit).map((name) => ({ name }));
    const done = start + limit >= all.length;
    return { keys, list_complete: done, ...(done ? {} : { cursor: String(start + limit) }) };
  }
}

const SITE = 'https://game.example';
const WALLET = '0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef';
const OTHER_WALLET = '0x1111111111111111111111111111111111111111';
const ORDER = '11111111-2222-3333-4444-555555555555';
const KEYS = {
  pkTest: 'gc_pk_test_' + 'a'.repeat(32),
  skTest: 'gc_sk_test_' + 'b'.repeat(32),
  pkLive: 'gc_pk_live_' + 'c'.repeat(32),
  skLive: 'gc_sk_live_' + 'd'.repeat(32),
  skOther: 'gc_sk_test_' + 'e'.repeat(32),
};

let kv: MockKV;
let env: Env;
let paycrestStatus = 'initiated';
let paycrestDown = false;
const hooks: Array<{ url: string; body: string; sig: string }> = [];

async function addPartner(id: string, patch: Partial<Partner>, keys: Array<[string, 'pk' | 'sk', 'live' | 'test']>) {
  const p: Partner = { id, name: 'Test Game', enabled: true, allowedOrigins: [SITE], appIds: [], feePercent: 0.5, createdAt: 1, ...patch };
  await kv.put(`partner:${id}`, JSON.stringify(p));
  for (const [key, kind, mode] of keys) await kv.put(`key:${await sha256Hex(key)}`, JSON.stringify({ partnerId: id, kind, mode, createdAt: 1 }));
}

function req(method: string, path: string, o: { key?: string; origin?: string | null; body?: unknown } = {}) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (o.key) headers.Authorization = `Bearer ${o.key}`;
  if (o.origin) headers.Origin = o.origin;
  return new Request(`https://api.goodcash.xyz${path}`, { method, headers, body: o.body === undefined ? undefined : JSON.stringify(o.body) });
}
const browser = (method: string, path: string, body?: unknown, key = KEYS.pkTest) => worker.fetch(req(method, path, { key, origin: SITE, body }), env);
const server = (method: string, path: string, body?: unknown, key = KEYS.skTest) => worker.fetch(req(method, path, { key, body }), env);
const json = async (r: Response) => (await r.json()) as Record<string, any>;

beforeEach(async () => {
  kv = new MockKV();
  paycrestStatus = 'initiated';
  paycrestDown = false;
  hooks.length = 0;
  env = {
    PAYCREST_API_KEY: 'k',
    PAYCREST_API_SECRET: 's',
    PAYCREST_BASE_URL: 'https://api.paycrest.io',
    ORDER_STORE: kv as unknown as KVNamespace,
    ALLOWED_ORIGINS: 'https://goodcash.xyz',
    RATE_LIMIT_MAX: '0',
    PARTNER_API_ENABLED: 'true',
    PARTNER_ONRAMP_ENABLED: 'true',
    PARTNER_SECRETS_KEY: btoa('0123456789abcdef0123456789abcdef'),
  } as Env;
  await addPartner('p_1', { topupEnabled: true }, [
    [KEYS.pkTest, 'pk', 'test'],
    [KEYS.skTest, 'sk', 'test'],
    [KEYS.pkLive, 'pk', 'live'],
    [KEYS.skLive, 'sk', 'live'],
  ]);
  await addPartner('p_2', { name: 'Other' }, [[KEYS.skOther, 'sk', 'test']]);
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const u = String(url);
      if (u.startsWith('https://hooks.example')) {
        hooks.push({ url: u, body: String(init?.body), sig: String((init?.headers as Record<string, string>)['GoodCash-Signature']) });
        return new Response('ok', { status: 200 });
      }
      if (paycrestDown && u.includes('/v2/sender/orders/')) throw new Error('down');
      if (u.includes('/v2/sender/orders/')) return new Response(JSON.stringify({ data: { id: ORDER, status: paycrestStatus } }), { status: 200 });
      if (u.includes('/v2/rates/')) return new Response(JSON.stringify({ data: { buy: { rate: '1500' } } }), { status: 200 });
      if (u.includes('relay.link/quote')) {
        return new Response(
          JSON.stringify({ details: { currencyOut: { amount: String(5_000n * 10n ** 18n), minimumAmount: String(4_950n * 10n ** 18n) } }, fees: { relayer: { amountUsd: '0.01' } } }),
          { status: 200 }
        );
      }
      return new Response('{}', { status: 404 });
    })
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('the switch', () => {
  it('is off unless PARTNER_ONRAMP_ENABLED is "true", and says "not found"', async () => {
    env.PARTNER_ONRAMP_ENABLED = undefined;
    expect((await browser('GET', '/v1/topup/quote?amountNaira=5000')).status).toBe(404);
    expect((await browser('POST', '/v1/topups', { wallet: WALLET, amountNaira: 5000 })).status).toBe(404);
    expect((await server('GET', '/v1/topups')).status).toBe(404);
  });

  it('live mode also needs the partner switched on; test mode does not', async () => {
    await addPartner('p_3', {}, [['gc_pk_live_' + 'f'.repeat(32), 'pk', 'live'], ['gc_pk_test_' + 'f'.repeat(32), 'pk', 'test']]);
    const live = await browser('GET', '/v1/topup/quote?amountNaira=5000', undefined, 'gc_pk_live_' + 'f'.repeat(32));
    expect(live.status).toBe(403);
    expect((await json(live)).error.code).toBe('topups_not_enabled');
    const test = await browser('GET', '/v1/topup/quote?amountNaira=5000', undefined, 'gc_pk_test_' + 'f'.repeat(32));
    expect(test.status).toBe(200);
  });
});

describe('quote', () => {
  it('test mode: what the customer gets, with every fee on its own line', async () => {
    const res = await browser('GET', '/v1/topup/quote?amountNaira=5000&asset=g');
    expect(res.status).toBe(200);
    const q = await json(res);
    expect(q).toMatchObject({ object: 'topup_quote', mode: 'test', amountNaira: 5000, asset: 'g', minimumNaira: 1000 });
    expect(q.youGet.amount).toBeGreaterThan(0);
    expect(q.youGet.minimum).toBeLessThanOrEqual(q.youGet.amount);
    expect(q.fees.map((f: { label: string }) => f.label)).toEqual(['Payment partner fee', 'Network and exchange fee']);
    expect(JSON.stringify(q)).not.toMatch(/relay|paycrest|usdc|swap|slippage/i);
  });

  it('live mode: the same price the GoodCash app shows', async () => {
    const res = await browser('GET', '/v1/topup/quote?amountNaira=5000&asset=g', undefined, KEYS.pkLive);
    expect(res.status).toBe(200);
    const q = await json(res);
    expect(q.mode).toBe('live');
    expect(q.youGet).toEqual({ amount: 5000, minimum: 4950 });
    expect(q.fees).toHaveLength(2);
  });

  it('refuses amounts that are too small, too large, fractional, or an unknown asset', async () => {
    expect((await browser('GET', '/v1/topup/quote?amountNaira=999')).status).toBe(400);
    expect((await browser('GET', '/v1/topup/quote?amountNaira=2000001')).status).toBe(400);
    expect((await browser('GET', '/v1/topup/quote?amountNaira=1500.5')).status).toBe(400);
    expect((await browser('GET', '/v1/topup/quote?amountNaira=5000&asset=btc')).status).toBe(400);
    expect((await browser('GET', '/v1/topup/quote?amountNaira=5000&wallet=nope')).status).toBe(400);
  });
});

describe('test mode top-ups', () => {
  const create = (body: Record<string, unknown> = {}) => browser('POST', '/v1/topups', { wallet: WALLET, amountNaira: 5000, asset: 'g', partnerRef: 'player-1', ...body });

  it('creates a simulated top-up and moves it through paid in to delivered by time', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-10T10:00:00Z'));
    const res = await create();
    expect(res.status).toBe(201);
    const t = await json(res);
    expect(t).toMatchObject({ object: 'topup', mode: 'test', status: 'awaiting_payment', amountNaira: 5000, asset: 'g', wallet: WALLET, partnerRef: 'player-1' });
    expect(t.id).toMatch(/^tu_[0-9a-f]{24}$/);
    expect((await json(await browser('GET', `/v1/topups/${t.id}`))).status).toBe('awaiting_payment');
    vi.setSystemTime(Date.now() + TEST_PAID_AFTER_MS + 100);
    expect((await json(await browser('GET', `/v1/topups/${t.id}`))).status).toBe('paid_in');
    vi.setSystemTime(Date.now() + TEST_DELIVERED_AFTER_MS);
    const done = await json(await browser('GET', `/v1/topups/${t.id}`));
    expect(done.status).toBe('delivered');
    expect(done.deliveredAt).toBeTruthy();
  });

  it('an amount ending in 13 fails (so partners can test the failure path)', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-10T10:00:00Z'));
    const t = await json(await create({ amountNaira: 5013 }));
    vi.setSystemTime(Date.now() + TEST_PAID_AFTER_MS + 100);
    expect((await json(await browser('GET', `/v1/topups/${t.id}`))).status).toBe('failed');
  });

  it('checks the wallet, amount and asset', async () => {
    expect((await create({ wallet: 'nope' })).status).toBe(400);
    expect((await create({ amountNaira: 500 })).status).toBe(400);
    expect((await create({ asset: 'btc' })).status).toBe(400);
  });

  it('only the partner that made a top-up can read it', async () => {
    const t = await json(await create());
    expect((await server('GET', `/v1/topups/${t.id}`, undefined, KEYS.skOther)).status).toBe(404);
    expect((await server('GET', `/v1/topups/${t.id}`)).status).toBe(200);
    expect((await browser('GET', '/v1/topups/tu_000000000000000000000000')).status).toBe(404);
  });

  it('test and live never mix: a test top-up is not visible with the live key', async () => {
    const t = await json(await create());
    expect((await browser('GET', `/v1/topups/${t.id}`, undefined, KEYS.pkLive)).status).toBe(404);
  });

  it('listing needs the secret key, and shows this partner only', async () => {
    await create();
    await create({ amountNaira: 6000 });
    expect((await browser('GET', '/v1/topups')).status).toBe(403);
    const list = await json(await server('GET', '/v1/topups'));
    expect(list.data).toHaveLength(2);
    expect((await json(await server('GET', '/v1/topups', undefined, KEYS.skOther))).data).toHaveLength(0);
  });

  it('timing helper agrees', () => {
    const rec = { createdAt: 0, naira: 5000 } as TopUpRecord;
    expect(testStatus(rec, 1)).toBe('awaiting_payment');
    expect(testStatus(rec, TEST_PAID_AFTER_MS)).toBe('paid_in');
    expect(testStatus(rec, TEST_DELIVERED_AFTER_MS)).toBe('delivered');
  });
});

describe('live mode top-ups', () => {
  async function orderExists(wallet = WALLET, naira = 5000, asset = 'g') {
    await kv.put(`onramp:${ORDER}`, JSON.stringify({ wallet, naira, asset, createdAt: Date.now() }));
  }
  const register = (body: Record<string, unknown> = {}) => browser('POST', '/v1/topups', { wallet: WALLET, amountNaira: 5000, asset: 'g', orderId: ORDER, ...body }, KEYS.pkLive);

  it('registers an order that belongs to this wallet, amount and asset', async () => {
    await orderExists();
    const res = await register();
    expect(res.status).toBe(201);
    expect(await json(res)).toMatchObject({ mode: 'live', status: 'awaiting_payment', wallet: WALLET });
  });

  it('refuses an order id that does not exist, or belongs to another wallet, amount or asset', async () => {
    expect((await register()).status).toBe(400);
    await orderExists(OTHER_WALLET);
    expect((await register()).status).toBe(400);
    await orderExists(WALLET, 6000);
    expect((await register()).status).toBe(400);
    await orderExists(WALLET, 5000, 'celo');
    expect((await register()).status).toBe(400);
  });

  it('needs the order id in live mode and a well-formed one', async () => {
    await orderExists();
    expect((await register({ orderId: undefined })).status).toBe(400);
    expect((await register({ orderId: 'not-an-id' })).status).toBe(400);
  });

  it('registering the same order twice returns the same top-up; another partner cannot take it', async () => {
    await orderExists();
    const a = await json(await register());
    const b = await json(await register());
    expect(b.id).toBe(a.id);
    await addPartner('p_9', { topupEnabled: true }, [['gc_pk_live_' + '9'.repeat(32), 'pk', 'live']]);
    const stolen = await browser('POST', '/v1/topups', { wallet: WALLET, amountNaira: 5000, asset: 'g', orderId: ORDER }, 'gc_pk_live_' + '9'.repeat(32));
    expect(stolen.status).toBe(400);
  });

  it('follows the payout partner: paid in when the naira lands, delivered when the G$ has arrived', async () => {
    await orderExists();
    const t = await json(await register());
    paycrestStatus = 'settling';
    expect((await json(await browser('GET', `/v1/topups/${t.id}`, undefined, KEYS.pkLive))).status).toBe('paid_in');
    paycrestStatus = 'settled';
    // settled but the customer has not tapped "get" yet: still paid in
    expect((await json(await browser('GET', `/v1/topups/${t.id}`, undefined, KEYS.pkLive))).status).toBe('paid_in');
    await kv.put(`onramp-wallet:${WALLET}:${ORDER}`, JSON.stringify({ naira: 5000, asset: 'g', at: 1, stage: 'done', arrived: true, txHash: '0x' + 'ab'.repeat(32) }));
    const done = await json(await browser('GET', `/v1/topups/${t.id}`, undefined, KEYS.pkLive));
    expect(done.status).toBe('delivered');
    expect(done.txHash).toBe('0x' + 'ab'.repeat(32));
  });

  it('an expired or refunded order is a failed/expired top-up', async () => {
    await orderExists();
    const t = await json(await register());
    paycrestStatus = 'expired';
    expect((await json(await browser('GET', `/v1/topups/${t.id}`, undefined, KEYS.pkLive))).status).toBe('expired');
  });

  it('when the payout partner cannot be reached the status stays as it was', async () => {
    await orderExists();
    const t = await json(await register());
    paycrestDown = true;
    expect((await json(await browser('GET', `/v1/topups/${t.id}`, undefined, KEYS.pkLive))).status).toBe('awaiting_payment');
  });

  it('never stores ID details or bank details', async () => {
    await orderExists();
    const res = await browser(
      'POST',
      '/v1/topups',
      { wallet: WALLET, amountNaira: 5000, asset: 'g', orderId: ORDER, idNumber: '12345678901', bvn: '12345678901', fullName: 'Ada Obi', accountNumber: '0123456789', birthDate: '1990-01-01' },
      KEYS.pkLive
    );
    expect(res.status).toBe(201);
    const stored = [...kv.store.values()].join('\n');
    for (const secret of ['12345678901', 'Ada Obi', '0123456789', '1990-01-01']) expect(stored).not.toContain(secret);
    expect(JSON.stringify(await res.json())).not.toContain('12345678901');
  });
});

describe('statuses', () => {
  it('maps the payout partner stages to plain top-up statuses', () => {
    expect(statusFromStage('waiting', false)).toBe('awaiting_payment');
    expect(statusFromStage('review', false)).toBe('awaiting_payment');
    expect(statusFromStage('received', false)).toBe('paid_in');
    expect(statusFromStage('done', false)).toBe('paid_in');
    expect(statusFromStage('done', true)).toBe('delivered');
    expect(statusFromStage('expired', false)).toBe('expired');
    expect(statusFromStage('refund', false)).toBe('failed');
  });
});

describe('webhooks', () => {
  async function withWebhook() {
    const p = JSON.parse(kv.store.get('partner:p_1') as string) as Partner;
    p.webhookUrl = { test: 'https://hooks.example/test', live: 'https://hooks.example/live' };
    p.webhookSecretEnc = { test: await encryptSecret(env, 'whsec_test'), live: await encryptSecret(env, 'whsec_live') };
    await kv.put('partner:p_1', JSON.stringify(p));
  }

  it('sends signed topup.paid_in then topup.delivered, once each', async () => {
    await withWebhook();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-10T10:00:00Z'));
    const t = await json(await browser('POST', '/v1/topups', { wallet: WALLET, amountNaira: 5000 }));
    vi.setSystemTime(Date.now() + TEST_PAID_AFTER_MS + 100);
    await browser('GET', `/v1/topups/${t.id}`);
    await browser('GET', `/v1/topups/${t.id}`);
    expect(hooks.map((h) => JSON.parse(h.body).type)).toEqual(['topup.paid_in']);
    vi.setSystemTime(Date.now() + TEST_DELIVERED_AFTER_MS);
    await browser('GET', `/v1/topups/${t.id}`);
    await browser('GET', `/v1/topups/${t.id}`);
    expect(hooks.map((h) => JSON.parse(h.body).type)).toEqual(['topup.paid_in', 'topup.delivered']);
    const last = hooks[hooks.length - 1];
    const ev = JSON.parse(last.body);
    expect(ev).toMatchObject({ object: 'event', mode: 'test', data: { id: t.id, status: 'delivered', amountNaira: 5000 } });
    const m = /^t=(\d+),v1=([0-9a-f]{64})$/.exec(last.sig);
    expect(m).toBeTruthy();
    expect(m![2]).toBe(await hmacHex('whsec_test', `${m![1]}.${last.body}`));
  });

  it('a top-up first seen as delivered still tells the partner the naira arrived', async () => {
    await withWebhook();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-10T10:00:00Z'));
    const t = await json(await browser('POST', '/v1/topups', { wallet: WALLET, amountNaira: 5000 }));
    vi.setSystemTime(Date.now() + TEST_DELIVERED_AFTER_MS + 1000);
    await browser('GET', `/v1/topups/${t.id}`);
    expect(hooks.map((h) => JSON.parse(h.body).type)).toEqual(['topup.paid_in', 'topup.delivered']);
  });

  it('a failed top-up sends topup.failed', async () => {
    await withWebhook();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-10T10:00:00Z'));
    const t = await json(await browser('POST', '/v1/topups', { wallet: WALLET, amountNaira: 5013 }));
    vi.setSystemTime(Date.now() + TEST_PAID_AFTER_MS + 100);
    await browser('GET', `/v1/topups/${t.id}`);
    expect(hooks.map((h) => JSON.parse(h.body).type)).toEqual(['topup.failed']);
  });

  it('the schedule moves open top-ups along even when nobody asks', async () => {
    await withWebhook();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-10T10:00:00Z'));
    const t = await json(await browser('POST', '/v1/topups', { wallet: WALLET, amountNaira: 5000 }));
    vi.setSystemTime(Date.now() + TEST_DELIVERED_AFTER_MS + 1000);
    await worker.scheduled({}, env);
    expect(hooks.map((h) => JSON.parse(h.body).type)).toEqual(['topup.paid_in', 'topup.delivered']);
    expect(kv.store.has(`ptopen:${t.id}`)).toBe(false);
    expect(JSON.parse(kv.store.get(`pt:${t.id}`) as string).status).toBe('delivered');
  });
});

describe('storage use', () => {
  it('a test top-up writes four small records, and a finished one is no longer swept', async () => {
    await browser('POST', '/v1/topups', { wallet: WALLET, amountNaira: 5000 });
    const keys = [...kv.store.keys()].filter((k) => /^(pt|pta|ptopen|ptorder):/.test(k));
    expect(keys.map((k) => k.split(':')[0]).sort()).toEqual(['pt', 'pta', 'ptopen']);
  });
});
