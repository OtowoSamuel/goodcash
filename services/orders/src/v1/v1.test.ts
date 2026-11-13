/**
 * Partner API (/v1) tests: keys and CORS, test mode (never touches the payout partner), cash outs end to end with
 * mocked chain and payout partner, idempotency and fee checks.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { checkCashOutTransaction, decodeOneTapData, decodeTransferAndCall, G_DOLLAR, ROUTER_V2, SELECTORS, CASH_OUT_PAID_TOPIC, BROKER, QUOTER_V2 } from '@goodcash/core';
import worker from '../index';
import type { Env } from '../index';
import { sha256Hex } from './auth';
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
  async list(opts: { prefix?: string; limit?: number; cursor?: string } = {}) {
    const all = [...this.store.keys()].filter((k) => k.startsWith(opts.prefix ?? '')).sort();
    const start = opts.cursor ? Number(opts.cursor) : 0;
    const limit = opts.limit ?? 1000;
    const keys = all.slice(start, start + limit).map((name) => ({ name }));
    const done = start + limit >= all.length;
    return { keys, list_complete: done, ...(done ? {} : { cursor: String(start + limit) }) };
  }
}

const WALLET = '0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef';
const SAFE = '0x735Ef948F746bc141D04042d2A18aA7f967bce2f';
const SITE = 'https://game.example';
const KEYS = {
  pkTest: 'gc_pk_test_' + 'a'.repeat(32),
  skTest: 'gc_sk_test_' + 'b'.repeat(32),
  pkLive: 'gc_pk_live_' + 'c'.repeat(32),
  skLive: 'gc_sk_live_' + 'd'.repeat(32),
  otherPkTest: 'gc_pk_test_' + 'e'.repeat(32),
};

let kv: MockKV;
let env: Env;
const fetchMock = vi.fn();

async function addPartner(id: string, patch: Partial<Partner> = {}, keys: Array<[string, 'pk' | 'sk', 'live' | 'test']> = []) {
  const p: Partner = { id, name: 'Test Game', enabled: true, allowedOrigins: [SITE], appIds: ['com.example.game'], feePercent: 0.5, createdAt: 1, ...patch };
  await kv.put(`partner:${id}`, JSON.stringify(p));
  for (const [key, kind, mode] of keys) await kv.put(`key:${await sha256Hex(key)}`, JSON.stringify({ partnerId: id, kind, mode, createdAt: 1 }));
}

function req(method: string, path: string, opts: { key?: string; origin?: string | null; app?: string; body?: unknown; idem?: string } = {}) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (opts.key) headers.Authorization = `Bearer ${opts.key}`;
  if (opts.origin) headers.Origin = opts.origin;
  if (opts.app) headers['X-GoodCash-App'] = opts.app;
  if (opts.idem) headers['Idempotency-Key'] = opts.idem;
  return new Request(`https://api.goodcash.xyz${path}`, { method, headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body) });
}

const call = (r: Request) => worker.fetch(r, env);
const browser = (method: string, path: string, body?: unknown, key = KEYS.pkTest, idem?: string) => call(req(method, path, { key, origin: SITE, body, idem }));
const server = (method: string, path: string, body?: unknown, key = KEYS.skTest, idem?: string) => call(req(method, path, { key, body, idem }));

const CREATE = {
  wallet: WALLET,
  amountG: '5000',
  recipient: { bankCode: 'TESTBANKA', accountNumber: '0123456789', accountName: 'TEST ACCOUNT' },
  partnerRef: 'player-42',
  feePercentShown: 1.5,
};

beforeEach(async () => {
  kv = new MockKV();
  env = {
    PAYCREST_API_KEY: 'k',
    PAYCREST_API_SECRET: 's',
    PAYCREST_BASE_URL: 'https://api.paycrest.io',
    ORDER_STORE: kv as unknown as KVNamespace,
    ALLOWED_ORIGINS: 'https://goodcash.xyz',
    RATE_LIMIT_MAX: '0',
    PARTNER_API_ENABLED: 'true',
    ROUTER_V2_ADDRESS: ROUTER_V2,
    SENDER_FEE_PERCENT: '1',
    SENDER_FEE_ADDRESS: SAFE,
  } as Env;
  await addPartner('p_1', {}, [
    [KEYS.pkTest, 'pk', 'test'],
    [KEYS.skTest, 'sk', 'test'],
    [KEYS.pkLive, 'pk', 'live'],
    [KEYS.skLive, 'sk', 'live'],
  ]);
  await addPartner('p_2', { name: 'Other' }, [[KEYS.otherPkTest, 'pk', 'test']]);
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('switch and keys', () => {
  it('is off unless PARTNER_API_ENABLED is "true"', async () => {
    env.PARTNER_API_ENABLED = undefined;
    const res = await browser('GET', '/v1/banks');
    expect(res.status).toBe(404);
  });

  it('refuses a missing or unknown key with a plain message and a developer detail', async () => {
    const a = await call(req('GET', '/v1/banks', { origin: SITE }));
    expect(a.status).toBe(401);
    const body = (await a.json()) as { error: { code: string; message: string; detail: string } };
    expect(body.error.code).toBe('unauthorized');
    expect(body.error.message).not.toMatch(/key|api/i);
    expect(body.error.detail).toMatch(/Bearer/);
    const b = await browser('GET', '/v1/banks', undefined, 'gc_pk_test_' + 'z'.repeat(32));
    expect(b.status).toBe(401);
  });

  it('publishable key works only from an allowed site or a registered app', async () => {
    const ok = await browser('GET', '/v1/banks');
    expect(ok.status).toBe(200);
    expect(ok.headers.get('Access-Control-Allow-Origin')).toBe(SITE);
    expect(ok.headers.get('GoodCash-Request-Id')).toMatch(/^req_/);

    const wrong = await call(req('GET', '/v1/banks', { key: KEYS.pkTest, origin: 'https://evil.example' }));
    expect(wrong.status).toBe(403);
    expect(((await wrong.json()) as { error: { code: string } }).error.code).toBe('forbidden_origin');
    expect(wrong.headers.get('Access-Control-Allow-Origin')).toBeNull();

    const noOrigin = await call(req('GET', '/v1/banks', { key: KEYS.pkTest }));
    expect(noOrigin.status).toBe(403);
    const app = await call(req('GET', '/v1/banks', { key: KEYS.pkTest, app: 'com.example.game' }));
    expect(app.status).toBe(200);
    const widget = await call(req('GET', '/v1/banks', { key: KEYS.pkTest, origin: 'https://pay.goodcash.xyz' }));
    expect(widget.status).toBe(200);
  });

  it('a secret key is refused from a browser', async () => {
    const res = await call(req('GET', '/v1/banks', { key: KEYS.skTest, origin: SITE }));
    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('secret_key_in_browser');
    expect((await server('GET', '/v1/banks')).status).toBe(200);
  });

  it('a switched-off partner is refused at once', async () => {
    const p = JSON.parse((await kv.get('partner:p_1'))!) as Partner;
    await kv.put('partner:p_1', JSON.stringify({ ...p, enabled: false }));
    const res = await browser('GET', '/v1/banks');
    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('partner_disabled');
  });

  it('answers pre-flight for any site; the real request is what is checked', async () => {
    const res = await call(new Request('https://api.goodcash.xyz/v1/cashouts', { method: 'OPTIONS', headers: { Origin: SITE } }));
    expect(res.status).toBe(204);
    expect(res.headers.get('Access-Control-Allow-Headers')).toMatch(/Idempotency-Key/);
  });

  it('the partner rate limit answers 429', async () => {
    env.RATE_LIMITER_PARTNER = { limit: async () => ({ success: false }) };
    const res = await browser('GET', '/v1/banks');
    expect(res.status).toBe(429);
  });

  it('tells the widget the partner name and allowed sites', async () => {
    const p = (await (await browser('GET', '/v1/partner')).json()) as { name: string; allowedOrigins: string[]; mode: string };
    expect(p).toMatchObject({ name: 'Test Game', mode: 'test', allowedOrigins: [SITE] });
    expect(JSON.stringify(p)).not.toMatch(/webhook|secret/i);
  });

  it('leaves the app endpoints alone', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ ok: true })));
    const res = await call(new Request('https://api.goodcash.xyz/health'));
    expect(res.status).toBe(200);
  });
});

describe('test mode never touches the payout partner or the chain', () => {
  afterEach(() => expect(fetchMock).not.toHaveBeenCalled());

  it('fake banks and account names', async () => {
    const banks = (await (await browser('GET', '/v1/banks')).json()) as { data: Array<{ code: string }> };
    expect(banks.data.map((b) => b.code)).toEqual(['TESTBANKA', 'TESTBANKB']);
    const ok = (await (await browser('POST', '/v1/banks/verify', { bankCode: 'TESTBANKA', accountNumber: '0123456789' })).json()) as { accountName: string };
    expect(ok.accountName).toBe('TEST ACCOUNT');
    const bad = await browser('POST', '/v1/banks/verify', { bankCode: 'TESTBANKA', accountNumber: '0000000009' });
    expect(((await bad.json()) as { error: { code: string } }).error.code).toBe('bank_account_not_found');
  });

  it('quote has every fee as its own plain line', async () => {
    const q = (await (await browser('GET', '/v1/quote?amountG=6000')).json()) as {
      feePercent: number;
      fees: Array<{ type: string; label: string }>;
      receive: { naira: number; minimumNaira: number };
      minimumG: number;
    };
    expect(q.feePercent).toBe(1.5);
    expect(q.fees.map((f) => f.type)).toEqual(['gooddollar_contribution', 'goodcash_fee', 'partner_fee', 'payout_fee']);
    expect(q.fees[2].label).toBe('Test Game fee (0.5%)');
    expect(q.receive.naira).toBeGreaterThan(q.receive.minimumNaira);
    expect(q.minimumG).toBeGreaterThan(0);
    const words = JSON.stringify(q.fees.map((f) => f.label));
    expect(words).not.toMatch(/swap|slippage|gas|usdt|celo|paycrest|relay/i);
  });

  it('creates a cash out whose transaction can never move money', async () => {
    const res = await browser('POST', '/v1/cashouts', CREATE, KEYS.pkTest, 'idem-test-0001');
    expect(res.status).toBe(201);
    const c = (await res.json()) as { id: string; status: string; transaction: { to: string; data: string; value: string; chainId: number }; partnerRef: string; test: unknown };
    expect(c.status).toBe('awaiting_signature');
    expect(c.partnerRef).toBe('player-42');
    expect(c.test).toBeTruthy();
    expect(c.transaction.to).toBe(G_DOLLAR);
    expect(c.transaction.value).toBe('0x0');
    const outer = decodeTransferAndCall(c.transaction.data);
    expect(outer.to.toLowerCase()).toBe(ROUTER_V2.toLowerCase());
    const inner = decodeOneTapData(outer.data);
    expect(inner.deadline).toBe(1n);
    expect(inner.payTo.toLowerCase()).toBe('0x000000000000000000000000000000000000dead');
  });

  it('the same Idempotency-Key never makes a second cash out', async () => {
    const a = (await (await browser('POST', '/v1/cashouts', CREATE, KEYS.pkTest, 'idem-test-0002')).json()) as { id: string };
    const b = (await (await browser('POST', '/v1/cashouts', CREATE, KEYS.pkTest, 'idem-test-0002')).json()) as { id: string };
    expect(b.id).toBe(a.id);
    const c = await browser('POST', '/v1/cashouts', { ...CREATE, amountG: '6000' }, KEYS.pkTest, 'idem-test-0002');
    expect(c.status).toBe(409);
    expect(((await c.json()) as { error: { code: string } }).error.code).toBe('idempotency_conflict');
    const none = await browser('POST', '/v1/cashouts', CREATE);
    expect(none.status).toBe(400);
  });

  it('a repeat of a request that is still being set up is refused, so it cannot make a second order', async () => {
    const text = JSON.stringify(CREATE);
    const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    const hash = Array.from(new Uint8Array(d), (b) => b.toString(16).padStart(2, '0')).join('').slice(0, 32);
    const key = `idem:p_1:test:idem-test-0010`;
    await kv.put(key, JSON.stringify({ hash, pending: true, at: Date.now() }));
    const res = await browser('POST', '/v1/cashouts', CREATE, KEYS.pkTest, 'idem-test-0010');
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('idempotency_in_progress');
    // a reservation left behind by a crash does not block for ever
    await kv.put(key, JSON.stringify({ hash, pending: true, at: Date.now() - 5 * 60_000 }));
    expect((await browser('POST', '/v1/cashouts', CREATE, KEYS.pkTest, 'idem-test-0010')).status).toBe(201);
  });

  it('a request that is refused frees its key, so the same key can be used again', async () => {
    const bad = await browser('POST', '/v1/cashouts', { ...CREATE, feePercentShown: 1 }, KEYS.pkTest, 'idem-test-0011');
    expect(bad.status).toBe(409);
    expect(await kv.get('idem:p_1:test:idem-test-0011')).toBeNull();
    const good = await browser('POST', '/v1/cashouts', { ...CREATE, feePercentShown: 1.5 }, KEYS.pkTest, 'idem-test-0011');
    expect(good.status).toBe(201);
  });

  it('refuses when the customer was shown a different fee', async () => {
    const res = await browser('POST', '/v1/cashouts', { ...CREATE, feePercentShown: 1 }, KEYS.pkTest, 'idem-test-0003');
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('fee_mismatch');
  });

  it('simulated timeline: sent -> processing -> paid, and magic accounts', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-10T10:00:00Z'));
    const c = (await (await browser('POST', '/v1/cashouts', CREATE, KEYS.pkTest, 'idem-test-0004')).json()) as { id: string };
    const failing = (await (
      await browser('POST', '/v1/cashouts', { ...CREATE, recipient: { ...CREATE.recipient, accountNumber: '0000000001' } }, KEYS.pkTest, 'idem-test-0005')
    ).json()) as { id: string };

    const status = async (id: string) => ((await (await browser('GET', `/v1/cashouts/${id}`)).json()) as { status: string }).status;
    expect(await status(c.id)).toBe('awaiting_signature');
    await browser('POST', `/v1/test/cashouts/${c.id}/simulate`);
    await browser('POST', `/v1/test/cashouts/${failing.id}/simulate`);
    expect(await status(c.id)).toBe('sent');
    vi.setSystemTime(new Date('2026-11-10T10:00:10Z'));
    expect(await status(c.id)).toBe('processing');
    vi.setSystemTime(new Date('2026-11-10T10:00:40Z'));
    expect(await status(c.id)).toBe('paid');
    expect(await status(failing.id)).toBe('failed');
  });

  it("another partner cannot see a partner's cash out", async () => {
    const c = (await (await browser('POST', '/v1/cashouts', CREATE, KEYS.pkTest, 'idem-test-0006')).json()) as { id: string };
    const res = await browser('GET', `/v1/cashouts/${c.id}`, undefined, KEYS.otherPkTest);
    expect(res.status).toBe(404);
  });

  it('lists by wallet with a publishable key, everything only with the secret key', async () => {
    // newest first is by the clock, so give the two cash outs different times (same-millisecond order is not defined)
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-10T10:00:00Z'));
    await browser('POST', '/v1/cashouts', CREATE, KEYS.pkTest, 'idem-test-0007');
    vi.setSystemTime(new Date('2026-11-10T10:00:05Z'));
    await browser('POST', '/v1/cashouts', { ...CREATE, amountG: '7000' }, KEYS.pkTest, 'idem-test-0008');
    const mine = (await (await browser('GET', `/v1/cashouts?wallet=${WALLET}`)).json()) as { data: Array<{ amountG: string }> };
    expect(mine.data.map((d) => d.amountG)).toEqual(['7000', '5000']);
    expect((await browser('GET', '/v1/cashouts')).status).toBe(403);
    const all = (await (await server('GET', '/v1/cashouts?limit=1')).json()) as { data: unknown[]; nextCursor: string | null };
    expect(all.data).toHaveLength(1);
    expect(all.nextCursor).not.toBeNull();
  });

  it('simulation is refused for live keys', async () => {
    const res = await browser('POST', `/v1/test/cashouts/00000000-0000-0000-0000-000000000000/simulate`, undefined, KEYS.pkLive);
    expect(res.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// Live mode with a mocked chain and payout partner
// ---------------------------------------------------------------------------
const word = (v: bigint) => v.toString(16).padStart(64, '0');
const ORDER_ID = '7d0c3a52-1f7e-4c55-9a51-2b7e0a1d9f00';
const RECEIVE = '0x9999999999999999999999999999999999999999';

function liveChain(opts: { paused?: boolean; balance?: bigint; orderBody?: (b: Record<string, unknown>) => void; partnerStatus?: string } = {}) {
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    const u = String(url);
    if (u.includes('forno.celo.org')) {
      const { method, params } = JSON.parse(String(init?.body)) as { method: string; params: Array<{ to: string; data: string }> };
      if (method === 'eth_call') {
        const { to, data } = params[0];
        if (data.startsWith(SELECTORS.paused)) return Response.json({ result: `0x${word(opts.paused ? 1n : 0n)}` });
        if (data.startsWith(SELECTORS.balanceOf)) return Response.json({ result: `0x${word(opts.balance ?? 10n ** 24n)}` });
        if (to === BROKER) return Response.json({ result: `0x${word(570n * 10n ** 15n)}` });
        if (to === QUOTER_V2) return Response.json({ result: `0x${word(569_900n)}${'0'.repeat(192)}` });
      }
      if (method === 'eth_getTransactionReceipt') {
        const paid = 550_000n;
        return Response.json({
          result: {
            status: '0x1',
            logs: [
              {
                address: ROUTER_V2.toLowerCase(),
                topics: [CASH_OUT_PAID_TOPIC, `0x${word(BigInt(WALLET))}`, `0x${word(BigInt(RECEIVE))}`],
                data: `0x${word(5000n * 10n ** 18n)}${word(569_000n)}${word(paid)}${word(19_000n)}${word(0n)}${word(0n)}`,
              },
            ],
          },
        });
      }
      throw new Error(`unexpected rpc ${method}`);
    }
    if (u.includes('/v2/rates/')) return Response.json({ data: { sell: { rate: '1500' } } });
    if (u.endsWith('/v2/sender/orders') && init?.method === 'POST') {
      opts.orderBody?.(JSON.parse(String(init.body)));
      return Response.json({
        data: {
          id: ORDER_ID,
          status: 'initiated',
          amount: '0.52',
          rate: '1500',
          senderFee: '0.0078',
          providerAccount: { network: 'celo', receiveAddress: RECEIVE, validUntil: new Date(Date.now() + 30 * 60_000).toISOString(), amountToTransfer: '0.55', currency: 'USDT' },
        },
      });
    }
    if (u.includes(`/v2/sender/orders/${ORDER_ID}`)) return Response.json({ data: { id: ORDER_ID, status: opts.partnerStatus ?? 'pending' } });
    throw new Error(`unexpected fetch ${u}`);
  });
}

describe('live cash out', () => {
  it('prices from the chain, charges exactly the fee shown, and returns a transaction that passes the safety check', async () => {
    let sent: Record<string, unknown> = {};
    liveChain({ orderBody: (b) => (sent = b) });
    const res = await browser('POST', '/v1/cashouts', CREATE, KEYS.pkLive, 'idem-live-0001');
    expect(res.status).toBe(201);
    const c = (await res.json()) as {
      id: string;
      transaction: Parameters<typeof checkCashOutTransaction>[0];
      order: { router: `0x${string}`; payTo: `0x${string}`; payAmount: string; amountWei: string; validUntil: string };
      receive: { naira: number };
    };
    expect(c.id).toBe(ORDER_ID);
    expect(sent.senderFeePercent).toBe('1.5');
    expect(sent.senderFeeAddress).toBe(SAFE);
    expect(c.receive.naira).toBe(780);
    const problem = checkCashOutTransaction(c.transaction, {
      router: c.order.router,
      payTo: c.order.payTo,
      payAmount: BigInt(c.order.payAmount),
      amountWei: BigInt(c.order.amountWei),
      validUntilMs: new Date(c.order.validUntil).getTime(),
      orderId: c.id,
    });
    expect(problem).toBeNull();
    expect(c.order.payTo).toBe(RECEIVE);
    expect(c.order.payAmount).toBe('550000');
    expect(JSON.stringify(c)).not.toMatch(/0123456789|TEST ACCOUNT/); // bank details are never echoed back
  });

  it('a reported transaction is checked on chain, then the status follows the payout partner', async () => {
    liveChain({ partnerStatus: 'settled' });
    const c = (await (await browser('POST', '/v1/cashouts', CREATE, KEYS.pkLive, 'idem-live-0002')).json()) as { id: string };
    const res = await browser('POST', `/v1/cashouts/${c.id}/transaction`, { txHash: `0x${'ab'.repeat(32)}` }, KEYS.pkLive);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string; txHash: string; paidAt: string | null };
    expect(body.status).toBe('paid');
    expect(body.paidAt).not.toBeNull();
    // the partner's share is recorded for the monthly payout
    const ledgerKey = [...kv.store.keys()].find((k) => k.startsWith(`ledger:p_1:`));
    expect(ledgerKey).toBeTruthy();
    const entry = JSON.parse(kv.store.get(ledgerKey!)!) as { partnerFeeUsdt: number; goodcashFeeUsdt: number; feeCharged: boolean };
    expect(entry).toMatchObject({ feeCharged: true, partnerFeeUsdt: 0.0026, goodcashFeeUsdt: 0.0052 });
  });

  it('refuses more G$ than the wallet holds, and a paused router, before any order exists', async () => {
    const orders = vi.fn();
    liveChain({ balance: 1n, orderBody: orders });
    const a = await browser('POST', '/v1/cashouts', CREATE, KEYS.pkLive, 'idem-live-0003');
    expect(((await a.json()) as { error: { code: string } }).error.code).toBe('insufficient_balance');
    liveChain({ paused: true, orderBody: orders });
    const b = await browser('POST', '/v1/cashouts', CREATE, KEYS.pkLive, 'idem-live-0004');
    expect(b.status).toBe(503);
    expect(((await b.json()) as { error: { code: string } }).error.code).toBe('cashout_paused');
    expect(orders).not.toHaveBeenCalled();
  });

  it('a partner without our fee address configured is charged only what it showed', async () => {
    env.SENDER_FEE_ADDRESS = undefined;
    liveChain();
    const q = (await (await browser('GET', '/v1/quote?amountG=5000', undefined, KEYS.pkLive)).json()) as { feePercent: number; fees: Array<{ type: string }> };
    expect(q.feePercent).toBe(0);
    expect(q.fees.map((f) => f.type)).toEqual(['gooddollar_contribution', 'payout_fee']);
  });
});
