/** Partner webhooks: signing, one event per change, retries, and the payout partner's webhook fanning out. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import worker from '../index';
import type { Env } from '../index';
import { sha256Hex } from './auth';
import { hmacHex, processWebhookQueue, RETRY_MINUTES } from './webhooks';
import type { Partner } from './types';

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
  async list(opts: { prefix?: string; limit?: number } = {}) {
    const keys = [...this.store.keys()].filter((k) => k.startsWith(opts.prefix ?? '')).sort().slice(0, opts.limit ?? 1000);
    return { keys: keys.map((name) => ({ name })), list_complete: true };
  }
}

const SK = 'gc_sk_test_' + 'b'.repeat(32);
const PK = 'gc_pk_test_' + 'a'.repeat(32);
const HOOK = 'https://partner.example/goodcash-webhook';
const SECRETS_KEY = btoa(String.fromCharCode(...new Uint8Array(32).map((_, i) => i + 1)));
const WALLET = '0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef';

let kv: MockKV;
let env: Env;
const fetchMock = vi.fn();
let hookStatus = 200;
const received: Array<{ headers: Headers; body: string }> = [];

const call = (method: string, path: string, opts: { key?: string; body?: unknown; idem?: string; origin?: string } = {}) =>
  worker.fetch(
    new Request(`https://api.goodcash.xyz${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${opts.key ?? SK}`,
        ...(opts.idem ? { 'Idempotency-Key': opts.idem } : {}),
        ...(opts.origin ? { Origin: opts.origin } : {}),
      },
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    }),
    env
  );

beforeEach(async () => {
  kv = new MockKV();
  env = {
    PAYCREST_API_KEY: 'k',
    PAYCREST_API_SECRET: 'paycrest-secret',
    PAYCREST_BASE_URL: 'https://api.paycrest.io',
    ORDER_STORE: kv as unknown as KVNamespace,
    PARTNER_API_ENABLED: 'true',
    PARTNER_SECRETS_KEY: SECRETS_KEY,
    ROUTER_V2_ADDRESS: '0x546698368a246539Df5e641EdC2b79c5782ea359',
    RATE_LIMIT_MAX: '0',
  } as Env;
  const p: Partner = { id: 'p_1', name: 'Game', enabled: true, allowedOrigins: ['https://game.example'], appIds: [], feePercent: 0, createdAt: 1 };
  await kv.put('partner:p_1', JSON.stringify(p));
  await kv.put(`key:${await sha256Hex(SK)}`, JSON.stringify({ partnerId: 'p_1', kind: 'sk', mode: 'test', createdAt: 1 }));
  await kv.put(`key:${await sha256Hex(PK)}`, JSON.stringify({ partnerId: 'p_1', kind: 'pk', mode: 'test', createdAt: 1 }));
  received.length = 0;
  hookStatus = 200;
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    if (String(url) === HOOK) {
      received.push({ headers: new Headers(init?.headers), body: String(init?.body) });
      return new Response('ok', { status: hookStatus });
    }
    throw new Error(`unexpected fetch ${url}`);
  });
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

async function setHook(): Promise<string> {
  const res = await call('PUT', '/v1/webhooks', { body: { url: HOOK } });
  expect(res.status).toBe(200);
  return ((await res.json()) as { secret: string }).secret;
}

function parseSig(h: string | null) {
  const m = /^t=(\d+),v1=([0-9a-f]{64})$/.exec(h ?? '');
  expect(m).not.toBeNull();
  return { t: m![1], v1: m![2] };
}

describe('webhook settings', () => {
  it('shows the signing secret once, never again unless rotated', async () => {
    const secret = await setHook();
    expect(secret).toMatch(/^whsec_/);
    const again = (await (await call('PUT', '/v1/webhooks', { body: { url: HOOK } })).json()) as { secret?: string };
    expect(again.secret).toBeUndefined();
    const rotated = (await (await call('PUT', '/v1/webhooks', { body: { url: HOOK, rotateSecret: true } })).json()) as { secret?: string };
    expect(rotated.secret).toMatch(/^whsec_/);
    expect(rotated.secret).not.toBe(secret);
    // stored encrypted, never in plain text
    expect(await kv.get('partner:p_1')).not.toContain(rotated.secret);
    const info = (await (await call('GET', '/v1/webhooks')).json()) as { url: string; hasSecret: boolean };
    expect(info).toMatchObject({ url: HOOK, hasSecret: true });
  });

  it('needs the secret key, a public https URL, and the server secret', async () => {
    const pk = await call('PUT', '/v1/webhooks', { key: PK, origin: 'https://game.example', body: { url: HOOK } });
    expect(((await pk.json()) as { error: { code: string } }).error.code).toBe('secret_key_required');
    for (const url of ['http://partner.example/x', 'https://localhost/x', 'https://192.168.1.2/x', 'nope']) {
      expect((await call('PUT', '/v1/webhooks', { body: { url } })).status).toBe(400);
    }
    env.PARTNER_SECRETS_KEY = undefined;
    expect((await call('PUT', '/v1/webhooks', { body: { url: HOOK } })).status).toBe(503);
  });

  it('test send is signed over "t.body" with the shown secret', async () => {
    const secret = await setHook();
    const out = (await (await call('POST', '/v1/webhooks/test')).json()) as { delivered: boolean; eventId: string };
    expect(out.delivered).toBe(true);
    expect(received).toHaveLength(1);
    const { t, v1 } = parseSig(received[0].headers.get('GoodCash-Signature'));
    expect(v1).toBe(await hmacHex(secret, `${t}.${received[0].body}`));
    expect(Math.abs(Number(t) - Date.now() / 1000)).toBeLessThan(5);
    const event = JSON.parse(received[0].body) as { id: string; type: string };
    expect(event).toMatchObject({ id: out.eventId, type: 'cashout.test' });
    expect(received[0].headers.get('GoodCash-Event-Id')).toBe(out.eventId);
  });
});

describe('cash out events', () => {
  const create = (idem: string, accountNumber = '0123456789') =>
    call('POST', '/v1/cashouts', {
      idem,
      body: { wallet: WALLET, amountG: '5000', recipient: { bankCode: 'TESTBANKA', accountNumber, accountName: 'TEST ACCOUNT' }, feePercentShown: 0 },
    });

  it('sends cashout.paid once, even when the status is read many times', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-10T10:00:00Z'));
    await setHook();
    const c = (await (await create('idem-hook-0001')).json()) as { id: string; partnerRef: null };
    await call('POST', `/v1/test/cashouts/${c.id}/simulate`);
    vi.setSystemTime(new Date('2026-11-10T10:01:00Z'));
    await call('GET', `/v1/cashouts/${c.id}`);
    await call('GET', `/v1/cashouts/${c.id}`);
    const paid = received.map((r) => JSON.parse(r.body) as { type: string; data: { id: string; status: string } });
    expect(paid).toHaveLength(1);
    expect(paid[0]).toMatchObject({ type: 'cashout.paid', data: { id: c.id, status: 'paid' } });
  });

  it('the schedule finds finished cash outs nobody is polling, including late and refunded ones', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-10T10:00:00Z'));
    await setHook();
    const refunded = (await (await create('idem-hook-0002', '0000000002')).json()) as { id: string };
    const late = (await (await create('idem-hook-0003', '0000000003')).json()) as { id: string };
    await call('POST', `/v1/test/cashouts/${refunded.id}/simulate`);
    await call('POST', `/v1/test/cashouts/${late.id}/simulate`);
    vi.setSystemTime(new Date('2026-11-10T10:05:00Z'));
    await worker.scheduled({}, env);
    const types = received.map((r) => (JSON.parse(r.body) as { type: string; data: { id: string } })).map((e) => `${e.type}:${e.data.id === refunded.id ? 'r' : 'l'}`);
    expect(types.sort()).toEqual(['cashout.delayed:l', 'cashout.refunded:r']);
    // refunded is finished, so it is no longer watched; the late one still is
    expect(await kv.get(`pcopen:${refunded.id}`)).toBeNull();
    expect(await kv.get(`pcopen:${late.id}`)).not.toBeNull();
  });

  it('a failed delivery is retried with back-off, then given up', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const t0 = new Date('2026-11-10T10:00:00Z').getTime();
    vi.setSystemTime(t0);
    await setHook();
    hookStatus = 500;
    const c = (await (await create('idem-hook-0004')).json()) as { id: string };
    await call('POST', `/v1/test/cashouts/${c.id}/simulate`);
    vi.setSystemTime(t0 + 60_000);
    await call('GET', `/v1/cashouts/${c.id}`);
    expect(received).toHaveLength(1);
    expect([...kv.store.keys()].filter((k) => k.startsWith('whq:'))).toHaveLength(1);

    // not due yet
    expect(await processWebhookQueue(env, t0 + 60_000 + 30_000)).toEqual({ delivered: 0, retried: 0, dropped: 0 });
    let now = t0 + 60_000;
    for (let i = 0; i < RETRY_MINUTES.length - 1; i++) {
      now += RETRY_MINUTES[i] * 60_000 + 1;
      vi.setSystemTime(now);
      expect((await processWebhookQueue(env, now)).retried).toBe(1);
    }
    now += RETRY_MINUTES[RETRY_MINUTES.length - 1] * 60_000 + 1;
    vi.setSystemTime(now);
    expect((await processWebhookQueue(env, now)).dropped).toBe(1);
    expect([...kv.store.keys()].filter((k) => k.startsWith('whq:'))).toHaveLength(0);
    // every try carried the same event id, so the partner can ignore duplicates
    expect(new Set(received.map((r) => (JSON.parse(r.body) as { id: string }).id)).size).toBe(1);

    // and a recovered endpoint gets a queued event
    hookStatus = 200;
  });

  it('an event is already in the queue when delivery is tried, and leaves it once delivered', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-10T10:00:00Z'));
    await setHook();
    let queuedDuringDelivery = 0;
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (String(url) === HOOK) {
        queuedDuringDelivery = [...kv.store.keys()].filter((k) => k.startsWith('whq:')).length;
        received.push({ headers: new Headers(init?.headers), body: String(init?.body) });
        return new Response('ok', { status: 200 });
      }
      throw new Error(`unexpected fetch ${url}`);
    });
    const c = (await (await create('idem-hook-0006')).json()) as { id: string };
    await call('POST', `/v1/test/cashouts/${c.id}/simulate`);
    vi.setSystemTime(new Date('2026-11-10T10:01:00Z'));
    await call('GET', `/v1/cashouts/${c.id}`);
    expect(received).toHaveLength(1);
    // a stop in the middle of delivery would have left this for the schedule to send
    expect(queuedDuringDelivery).toBe(1);
    expect([...kv.store.keys()].filter((k) => k.startsWith('whq:'))).toHaveLength(0);
  });

  it('a queued event is kept until its delivery outcome is known, so a stop in the middle loses nothing', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const t0 = new Date('2026-11-10T10:00:00Z').getTime();
    vi.setSystemTime(t0);
    await setHook();
    hookStatus = 500;
    const c = (await (await create('idem-hook-0007')).json()) as { id: string };
    await call('POST', `/v1/test/cashouts/${c.id}/simulate`);
    vi.setSystemTime(t0 + 60_000);
    await call('GET', `/v1/cashouts/${c.id}`);
    const due = t0 + 60_000 + RETRY_MINUTES[0] * 60_000 + 1;
    vi.setSystemTime(due);
    let keysDuringDelivery: string[] = [];
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (String(url) === HOOK) {
        keysDuringDelivery = [...kv.store.keys()].filter((k) => k.startsWith('whq:'));
        received.push({ headers: new Headers(init?.headers), body: String(init?.body) });
        throw new Error('the worker stopped here');
      }
      throw new Error(`unexpected fetch ${url}`);
    });
    await processWebhookQueue(env, due);
    // while the attempt was being made, the item was still in the queue
    expect(keysDuringDelivery).toHaveLength(1);
    // and a later schedule run still has something to deliver
    expect([...kv.store.keys()].filter((k) => k.startsWith('whq:')).length).toBeGreaterThanOrEqual(1);
  });

  it('a partner without a webhook is simply skipped (they poll instead)', async () => {
    const c = (await (await create('idem-hook-0005')).json()) as { id: string };
    await call('POST', `/v1/test/cashouts/${c.id}/simulate`);
    await call('GET', `/v1/cashouts/${c.id}`);
    expect(received).toHaveLength(0);
  });
});

describe("the payout partner's webhook reaches the partner", () => {
  it('a settled live order sends cashout.paid to the partner that created it', async () => {
    const SK_LIVE = 'gc_sk_live_' + 'd'.repeat(32);
    await kv.put(`key:${await sha256Hex(SK_LIVE)}`, JSON.stringify({ partnerId: 'p_1', kind: 'sk', mode: 'live', createdAt: 1 }));
    expect((await call('PUT', '/v1/webhooks', { key: SK_LIVE, body: { url: HOOK } })).status).toBe(200);

    const id = '7d0c3a52-1f7e-4c55-9a51-2b7e0a1d9f00';
    const now = Date.now();
    await kv.put(
      `pc:${id}`,
      JSON.stringify({
        id, partnerId: 'p_1', mode: 'live', wallet: WALLET, amountG: '5000', amountWei: '1', router: '0x1', payTo: '0x2', payAmount: '1', minOut: '1',
        validUntil: new Date(now + 600_000).toISOString(), naira: 780, minimumNaira: 770, feePercent: 1, goodcashFeePercent: 1, partnerFeePercent: 0,
        txHash: `0x${'ab'.repeat(32)}`, sentAt: now, status: 'processing', createdAt: now, updatedAt: now,
      })
    );
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (String(url) === HOOK) {
        received.push({ headers: new Headers(init?.headers), body: String(init?.body) });
        return new Response('ok');
      }
      if (String(url).includes(`/v2/sender/orders/${id}`)) return Response.json({ data: { id, status: 'settled' } });
      throw new Error(`unexpected fetch ${url}`);
    });

    const body = JSON.stringify({ event: 'payment_order.settled', data: { id, status: 'settled' } });
    const sig = await hmacHex('paycrest-secret', body);
    const res = await worker.fetch(new Request('https://api.goodcash.xyz/webhooks/paycrest', { method: 'POST', headers: { 'X-Paycrest-Signature': sig }, body }), env);
    expect(res.status).toBe(200);
    expect(received).toHaveLength(1);
    expect(JSON.parse(received[0].body)).toMatchObject({ type: 'cashout.paid', mode: 'live', data: { id, status: 'paid' } });
  });
});
