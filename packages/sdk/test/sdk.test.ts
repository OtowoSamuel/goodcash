import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createWalletClient, custom } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { buildOneTapTransaction, ROUTER_V2, CASH_OUT_PAID_TOPIC } from '../src/core';
import { GoodCash, GoodCashError, type CreatedCashOut } from '../src';
import { verifyWebhook } from '../src/server';

const PK_LIVE = 'gc_pk_live_' + 'a'.repeat(32);
const PK_TEST = 'gc_pk_test_' + 'a'.repeat(32);
const SK_TEST = 'gc_sk_test_' + 'b'.repeat(32);
const WALLET = '0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef' as const;
const PAY_TO = '0x9999999999999999999999999999999999999999' as const;
const ID = '7d0c3a52-1f7e-4c55-9a51-2b7e0a1d9f00';
const HASH = `0x${'ab'.repeat(32)}`;
const RECIPIENT = { bankCode: 'GTBINGLA', accountNumber: '0123456789', accountName: 'ADA OBI' };

function created(over: Partial<{ router: `0x${string}`; payTo: `0x${string}`; payAmount: bigint; minOut: bigint; deadlineSec: number; mode: 'live' | 'test' }> = {}): CreatedCashOut {
  const validUntil = new Date(Date.now() + 30 * 60_000).toISOString();
  const payAmount = over.payAmount ?? 550_000n;
  const minOut = over.minOut ?? 567_000n;
  const tx = buildOneTapTransaction({
    router: over.router ?? ROUTER_V2,
    amountWei: 5000n * 10n ** 18n,
    route: 0,
    minOut,
    deadline: BigInt(over.deadlineSec ?? Math.floor(Date.now() / 1000) + 1200),
    payTo: over.payTo ?? PAY_TO,
    payAmount,
    orderId: ID,
  });
  return {
    id: ID, object: 'cashout', mode: over.mode ?? 'live', status: 'awaiting_signature', wallet: WALLET, amountG: '5000',
    receive: { naira: 780, minimumNaira: 770 }, feePercent: 1, partnerRef: null, txHash: null, expiresAt: validUntil,
    createdAt: '', updatedAt: '', paidAt: null, fees: [], transaction: tx,
    order: { router: ROUTER_V2, payTo: PAY_TO, payAmount: '550000', amountWei: (5000n * 10n ** 18n).toString(), minOut: minOut.toString(), validUntil },
  };
}

type Route = (method: string, url: string, body: unknown, headers: Headers) => Response | Promise<Response>;
function api(route: Route) {
  const calls: Array<{ method: string; url: string; body: unknown; headers: Headers }> = [];
  const f = vi.fn(async (url: string, init?: RequestInit) => {
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    const headers = new Headers(init?.headers);
    calls.push({ method: init?.method ?? 'GET', url: String(url), body, headers });
    return route(init?.method ?? 'GET', String(url), body, headers);
  });
  return { f: f as unknown as typeof fetch, calls };
}

function provider(opts: { send?: () => Promise<unknown>; chainId?: string } = {}) {
  const requests: Array<{ method: string; params?: unknown }> = [];
  let chain = opts.chainId ?? '0xa4ec';
  return {
    requests,
    request: vi.fn(async ({ method, params }: { method: string; params?: unknown }) => {
      requests.push({ method, params });
      if (method === 'eth_accounts') return [WALLET];
      if (method === 'eth_chainId') return chain;
      if (method === 'wallet_switchEthereumChain') {
        chain = '0xa4ec';
        return null;
      }
      if (method === 'eth_sendTransaction') return opts.send ? opts.send() : HASH;
      throw new Error(`unexpected ${method}`);
    }),
  };
}

const ok = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'GoodCash-Request-Id': 'req_1' } });

describe('keys', () => {
  it('knows test from live and refuses a secret key in a web page', () => {
    expect(new GoodCash({ publishableKey: PK_TEST }).mode).toBe('test');
    expect(new GoodCash({ publishableKey: PK_LIVE }).mode).toBe('live');
    expect(() => new GoodCash({ publishableKey: SK_TEST })).toThrow(GoodCashError);
    vi.stubGlobal('document', {});
    try {
      expect(() => new GoodCash({ secretKey: SK_TEST })).toThrow(/set up correctly/);
    } finally {
      vi.unstubAllGlobals();
    }
    expect(new GoodCash({ secretKey: SK_TEST }).mode).toBe('test');
  });

  it('server errors keep their code, plain message, detail and request id', async () => {
    const { f } = api(() => new Response(JSON.stringify({ error: { code: 'fee_mismatch', message: 'The fees have changed.', detail: 'shown 1, is 1.5' } }), { status: 409, headers: { 'GoodCash-Request-Id': 'req_9' } }));
    const gc = new GoodCash({ publishableKey: PK_LIVE, fetch: f });
    const e = (await gc.quote({ amountG: 5000 }).catch((x) => x)) as GoodCashError;
    expect(e).toBeInstanceOf(GoodCashError);
    expect(e).toMatchObject({ code: 'fee_mismatch', message: 'The fees have changed.', detail: 'shown 1, is 1.5', status: 409, requestId: 'req_9' });
  });

  it('a network failure is a network_error', async () => {
    const gc = new GoodCash({ publishableKey: PK_LIVE, fetch: (async () => { throw new TypeError('Failed to fetch'); }) as unknown as typeof fetch });
    await expect(gc.banks()).rejects.toMatchObject({ code: 'network_error' });
  });

  it('sends the app id for native apps', async () => {
    const { f, calls } = api(() => ok({ object: 'list', data: [{ code: 'B', name: 'Zed', popular: false }, { code: 'A', name: 'Opay', popular: true }] }));
    const banks = await new GoodCash({ publishableKey: PK_LIVE, appId: 'com.example.game', fetch: f }).banks();
    expect(calls[0].headers.get('X-GoodCash-App')).toBe('com.example.game');
    expect(banks.map((b) => b.code)).toEqual(['A', 'B']);
  });
});

describe('the check before signing', () => {
  const gc = new GoodCash({ publishableKey: PK_LIVE });
  it('accepts the exact transaction', () => {
    expect(() => gc.assertSafeTransaction(created(), { amountG: '5000' })).not.toThrow();
  });
  it.each([
    ['a different router', { router: '0x2222222222222222222222222222222222222222' as const }],
    ['a different pay address', { payTo: '0x3333333333333333333333333333333333333333' as const }],
    ['a different pay amount', { payAmount: 1n }],
  ])('refuses %s', (_name, over) => {
    expect(() => gc.assertSafeTransaction(created(over))).toThrow(expect.objectContaining({ code: 'unsafe_transaction' }));
  });
  it('refuses a router other than the GoodCash one, even when the server agrees with itself', () => {
    const evil = '0x2222222222222222222222222222222222222222' as const;
    const c = created({ router: evil });
    c.order.router = evil;
    expect(() => gc.assertSafeTransaction(c)).toThrow(expect.objectContaining({ code: 'unsafe_transaction', detail: expect.stringMatching(/router/) }));
  });
  it('refuses a different amount than requested and an order about to close', () => {
    expect(() => gc.assertSafeTransaction(created(), { amountG: '6000' })).toThrow(expect.objectContaining({ code: 'unsafe_transaction' }));
    const c = created();
    c.order.validUntil = new Date(Date.now() + 30_000).toISOString();
    expect(() => gc.assertSafeTransaction(c)).toThrow(expect.objectContaining({ code: 'order_expired' }));
  });
});

describe('cashOut', () => {
  let routes: Route;
  beforeEach(() => {
    routes = (method, url) => {
      if (url.includes('/v1/network-fee')) return ok({ enough: true, needCelo: 0.3, haveCelo: 1, feeCelo: 0.2, celoUsd: 0.5 });
      if (method === 'POST' && url.endsWith('/v1/cashouts')) return ok(created(), 201);
      if (url.endsWith(`/v1/cashouts/${ID}/transaction`)) return ok({ ...created(), status: 'sent', txHash: HASH });
      throw new Error(`unexpected ${method} ${url}`);
    };
  });
  afterEach(() => vi.useRealTimers());

  it('creates, checks, sends from a browser wallet (switching to Celo) and reports', async () => {
    const { f, calls } = api((...a) => routes(...a));
    const p = provider({ chainId: '0x1' });
    const steps: string[] = [];
    const out = await new GoodCash({ publishableKey: PK_LIVE, fetch: f }).cashOut({ signer: p, amountG: '5000', recipient: RECIPIENT, quote: { feePercent: 1 }, partnerRef: 'u-1', onStep: (s) => steps.push(s) });
    expect(out.txHash).toBe(HASH);
    expect(out.cashOut.status).toBe('sent');
    expect(p.requests.map((r) => r.method)).toEqual(['eth_accounts', 'eth_chainId', 'wallet_switchEthereumChain', 'eth_chainId', 'eth_sendTransaction']);
    const sent = (p.requests[4].params as Array<{ to: string; value: string }>)[0];
    expect(sent.value).toBe('0x0');
    const create = calls.find((c) => c.method === 'POST' && c.url.endsWith('/v1/cashouts'))!;
    expect(create.body).toMatchObject({ wallet: WALLET, amountG: '5000', feePercentShown: 1, partnerRef: 'u-1' });
    expect(create.headers.get('Idempotency-Key')).toMatch(/^sdk_[0-9a-f]{32}$/);
    expect(steps).toEqual(['checking', 'creating', 'confirm_in_wallet', 'confirming', 'reporting', 'done']);
  });

  it('never asks the wallet to sign a transaction that fails the check', async () => {
    routes = (method, url) => {
      if (url.includes('/v1/network-fee')) return ok({ enough: true });
      if (method === 'POST' && url.endsWith('/v1/cashouts')) return ok(created({ router: '0x2222222222222222222222222222222222222222' }), 201);
      throw new Error('should not get here');
    };
    const { f } = api((...a) => routes(...a));
    const p = provider();
    await expect(new GoodCash({ publishableKey: PK_LIVE, fetch: f }).cashOut({ signer: p, amountG: '5000', recipient: RECIPIENT, quote: { feePercent: 1 } })).rejects.toMatchObject({ code: 'unsafe_transaction' });
    expect(p.requests.some((r) => r.method === 'eth_sendTransaction')).toBe(false);
  });

  it('stops before creating anything when the wallet lacks CELO for the network fee', async () => {
    routes = (_m, url) => {
      if (url.includes('/v1/network-fee')) return ok({ enough: false, needCelo: 0.35, haveCelo: 0.1, feeCelo: 0.2, celoUsd: 0.5 });
      throw new Error('should not create');
    };
    const { f } = api((...a) => routes(...a));
    await expect(new GoodCash({ publishableKey: PK_LIVE, fetch: f }).cashOut({ signer: provider(), amountG: '5000', recipient: RECIPIENT, quote: { feePercent: 1 } })).rejects.toMatchObject({ code: 'needs_network_fee', data: { needCelo: 0.35 } });
  });

  it('a cancelled wallet request is wallet_rejected and nothing is reported', async () => {
    const { f, calls } = api((...a) => routes(...a));
    const p = provider({ send: () => Promise.reject(Object.assign(new Error('User rejected the request.'), { code: 4001 })) });
    await expect(new GoodCash({ publishableKey: PK_LIVE, fetch: f }).cashOut({ signer: p, amountG: '5000', recipient: RECIPIENT, quote: { feePercent: 1 } })).rejects.toMatchObject({ code: 'wallet_rejected', message: 'You cancelled the request in your wallet. Nothing was sent.' });
    expect(calls.some((c) => c.url.endsWith('/transaction'))).toBe(false);
  });

  it('a lost wallet reply: finds the payment on chain and carries on', async () => {
    const rpc = vi.fn(async (_m: string, url: string, body: unknown) => {
      const b = body as { method: string; params: Array<{ topics: string[] }> };
      if (b.method === 'eth_blockNumber') return ok({ result: '0x100000' });
      if (b.method === 'eth_getLogs') {
        expect(b.params[0].topics[0]).toBe(CASH_OUT_PAID_TOPIC);
        expect(b.params[0].topics[2]).toBe(`0x${PAY_TO.slice(2).padStart(64, '0')}`);
        return ok({ result: [{ transactionHash: HASH }] });
      }
      throw new Error(url);
    });
    const { f } = api((m, url, body, h) => (url.includes('forno') ? rpc(m, url, body) : routes(m, url, body, h)));
    const p = provider({ send: () => Promise.reject(new Error('Request expired. Please try again.')) });
    const out = await new GoodCash({ publishableKey: PK_LIVE, fetch: f, rpcUrl: 'https://forno.celo.org' }).cashOut({ signer: p, amountG: '5000', recipient: RECIPIENT, quote: { feePercent: 1 } });
    expect(out.txHash).toBe(HASH);
  });

  it('a lost wallet reply with no payment found is "uncertain", never "nothing was taken"', async () => {
    vi.useFakeTimers();
    const { f } = api((m, url, body, h) => {
      if (url.includes('forno')) {
        const b = body as { method: string };
        return ok({ result: b.method === 'eth_blockNumber' ? '0x100000' : [] });
      }
      return routes(m, url, body, h);
    });
    const p = provider({ send: () => Promise.reject(new Error('timeout')) });
    const run = new GoodCash({ publishableKey: PK_LIVE, fetch: f, rpcUrl: 'https://forno.celo.org' }).cashOut({ signer: p, amountG: '5000', recipient: RECIPIENT, quote: { feePercent: 1 } }).catch((e) => e);
    await vi.runAllTimersAsync();
    const e = (await run) as GoodCashError;
    expect(e.code).toBe('uncertain');
    expect(e.message).not.toMatch(/nothing was (taken|sent)/i);
    expect(e.data).toMatchObject({ cashOutId: ID });
  });

  it('waits while the transaction is still being mined', async () => {
    vi.useFakeTimers();
    let n = 0;
    routes = (method, url) => {
      if (url.includes('/v1/network-fee')) return ok({ enough: true });
      if (method === 'POST' && url.endsWith('/v1/cashouts')) return ok(created(), 201);
      if (url.endsWith('/transaction')) return ++n < 3 ? ok({ ...created(), pending: true }, 202) : ok({ ...created(), status: 'processing', txHash: HASH });
      throw new Error(url);
    };
    const { f } = api((...a) => routes(...a));
    const run = new GoodCash({ publishableKey: PK_LIVE, fetch: f }).cashOut({ signer: provider(), amountG: '5000', recipient: RECIPIENT, quote: { feePercent: 1 } });
    await vi.runAllTimersAsync();
    expect((await run).cashOut.status).toBe('processing');
    expect(n).toBe(3);
  });

  it('works with a viem server wallet (local account) and with a plain send function', async () => {
    const { f } = api((...a) => routes(...a));
    const account = privateKeyToAccount(`0x${'11'.repeat(32)}`);
    const sendTransaction = vi.fn(async () => HASH as `0x${string}`);
    const wc = Object.assign(createWalletClient({ account, transport: custom({ request: async () => null }) }), { sendTransaction });
    created().wallet;
    await new GoodCash({ secretKey: SK_TEST.replace('test', 'live'), fetch: f }).cashOut({ signer: wc, amountG: '5000', recipient: RECIPIENT, quote: { feePercent: 1 }, skipNetworkFeeCheck: true });
    expect(sendTransaction).toHaveBeenCalledWith(expect.objectContaining({ to: created().transaction.to, value: 0n }));

    const send = vi.fn(async () => HASH as `0x${string}`);
    await new GoodCash({ publishableKey: PK_LIVE, fetch: f }).cashOut({ signer: send, wallet: WALLET, amountG: '5000', recipient: RECIPIENT, quote: { feePercent: 1 } });
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ from: WALLET, value: '0x0' }));
  });

  it('test keys never ask the wallet: the cash out is simulated', async () => {
    const { f, calls } = api((method, url) => {
      if (method === 'POST' && url.endsWith('/v1/cashouts')) return ok(created({ mode: 'test', deadlineSec: 1, payTo: '0x000000000000000000000000000000000000dEaD' }) && { ...created({ mode: 'test', deadlineSec: 1 }) }, 201);
      if (url.includes('/simulate')) return ok({ ...created({ mode: 'test' }), status: 'sent', txHash: '0x7e57' });
      throw new Error(url);
    });
    const p = provider();
    const out = await new GoodCash({ publishableKey: PK_TEST, fetch: f }).cashOut({ signer: p, amountG: '5000', recipient: RECIPIENT, quote: { feePercent: 1 } });
    expect(out.cashOut.status).toBe('sent');
    expect(p.requests.some((r) => r.method === 'eth_sendTransaction')).toBe(false);
    expect(calls.some((c) => c.url.includes('network-fee'))).toBe(false);
  });
});

describe('wallets', () => {
  it('test keys work without any wallet; live keys say "Connect a wallet first"', async () => {
    const { f, calls } = api((method, url) => {
      if (method === 'POST' && url.endsWith('/v1/cashouts')) return ok({ ...created({ mode: 'test', deadlineSec: 1 }) }, 201);
      if (url.includes('/simulate')) return ok({ ...created({ mode: 'test' }), status: 'sent' });
      throw new Error(url);
    });
    await new GoodCash({ publishableKey: PK_TEST, fetch: f }).cashOut({ amountG: '5000', recipient: RECIPIENT, quote: { feePercent: 1 } });
    expect((calls[0].body as { wallet: string }).wallet).toBe('0x0000000000000000000000000000000000007e57');
    await expect(new GoodCash({ publishableKey: PK_LIVE, fetch: f }).cashOut({ amountG: '5000', recipient: RECIPIENT, quote: { feePercent: 1 } })).rejects.toMatchObject({ code: 'no_wallet', message: 'Connect a wallet first.' });
  });
});

describe('watchCashOut', () => {
  afterEach(() => vi.useRealTimers());
  it('reports each change once, slows down, and stops when paid', async () => {
    vi.useFakeTimers();
    const statuses = ['sent', 'sent', 'processing', 'processing', 'paid'];
    let i = 0;
    const { f } = api(() => ok({ ...created(), status: statuses[Math.min(i++, statuses.length - 1)] }));
    const seen: string[] = [];
    const run = new GoodCash({ publishableKey: PK_LIVE, fetch: f }).watchCashOut(ID, (c) => seen.push(c.status));
    await vi.runAllTimersAsync();
    expect((await run).status).toBe('paid');
    expect(seen).toEqual(['sent', 'processing', 'paid']);
  });
  it('can be stopped', async () => {
    vi.useFakeTimers();
    const { f } = api(() => ok({ ...created(), status: 'processing' }));
    const ac = new AbortController();
    const run = new GoodCash({ publishableKey: PK_LIVE, fetch: f }).watchCashOut(ID, () => undefined, { signal: ac.signal }).catch((e) => e);
    await vi.advanceTimersByTimeAsync(5000);
    ac.abort();
    await vi.runAllTimersAsync();
    expect(((await run) as GoodCashError).detail).toBe('Aborted');
  });
});

describe('verifyWebhook', () => {
  const secret = 'whsec_test';
  async function sign(body: string, t: number) {
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${t}.${body}`));
    return `t=${t},v1=${Array.from(new Uint8Array(sig), (b) => b.toString(16).padStart(2, '0')).join('')}`;
  }
  const body = JSON.stringify({ id: 'evt_1', object: 'event', type: 'cashout.paid', mode: 'live', createdAt: '', data: { id: ID } });
  it('accepts a fresh, correctly signed event', async () => {
    const now = 1_800_000_000;
    const ev = await verifyWebhook(body, await sign(body, now), secret, { nowSec: now + 10 });
    expect(ev.type).toBe('cashout.paid');
  });
  it('rejects a changed body, a wrong secret, a bad header and an old message', async () => {
    const now = 1_800_000_000;
    const h = await sign(body, now);
    await expect(verifyWebhook(body.replace('paid', 'failed'), h, secret, { nowSec: now })).rejects.toMatchObject({ code: 'invalid_signature' });
    await expect(verifyWebhook(body, h, 'whsec_other', { nowSec: now })).rejects.toMatchObject({ code: 'invalid_signature' });
    await expect(verifyWebhook(body, 'nonsense', secret, { nowSec: now })).rejects.toMatchObject({ code: 'invalid_signature' });
    await expect(verifyWebhook(body, h, secret, { nowSec: now + 301 })).rejects.toMatchObject({ code: 'invalid_signature' });
  });
});
