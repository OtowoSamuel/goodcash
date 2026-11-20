/** Only GoodDollar-verified wallets can add G$ or cash out: the app's own order paths, through the real Worker. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import worker from './index.js';
import type { Env } from './index.js';
import { isVerified } from './verified';

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
    const all = [...this.store.keys()].filter((k) => k.startsWith(opts.prefix ?? '')).sort();
    return { keys: all.slice(0, opts.limit ?? 1000).map((name) => ({ name })), list_complete: true };
  }
}

const GOOD = '0x1111111111111111111111111111111111111111';
const BAD = '0x2222222222222222222222222222222222222222';
const ROUTER2 = '0x546698368a246539df5e641edc2b79c5782ea359';
const ORDER_ID = '660e8400-e29b-41d4-a716-446655440001';
const word = (n: bigint) => n.toString(16).padStart(64, '0');

let kv: MockKV;
let env: Env;
let chainDown = false;
let partnerCalls = 0;
let identityCalls = 0;

const call = (method: string, path: string, body?: unknown) =>
  worker.fetch(new Request(`https://api.goodcash.xyz${path}`, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }), env);

const topUp = (wallet: string) => ({
  naira: 5000,
  wallet,
  fullName: 'Ada Obi',
  birthDate: '1995-03-02',
  idType: 'BVN',
  idNumber: '22212345678',
  refundAccount: { institution: 'GTBINGLA', accountIdentifier: '0123456789', accountName: 'Ada Obi' },
});
const recipient = { institution: 'GTBINGLA', accountIdentifier: '0123456789', accountName: 'Ada Obi' };
const oneTap = (wallet: string) => ({ minUsdt: '2.000000', amountG: '5000', refundAddress: wallet, recipient });
const legacy = (wallet: string) => ({ amount: '1.000000', refundAddress: wallet, recipient });

beforeEach(() => {
  kv = new MockKV();
  chainDown = false;
  partnerCalls = 0;
  identityCalls = 0;
  env = {
    PAYCREST_API_KEY: 'k',
    PAYCREST_API_SECRET: 's',
    PAYCREST_BASE_URL: 'https://api.paycrest.io',
    ORDER_STORE: kv as unknown as KVNamespace,
    ALLOWED_ORIGINS: 'https://goodcash.xyz',
    VERIFY_SWAP_ONCHAIN: 'false',
    RATE_LIMIT_MAX: '0',
    ROUTER_V2_ADDRESS: ROUTER2,
    REQUIRE_VERIFIED: 'true',
  } as Env;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const u = String(url);
      if (u.includes('forno.celo.org')) {
        const { method, params } = JSON.parse(String(init?.body)) as { method: string; params: Array<{ to: string; data: string }> };
        if (method === 'eth_call' && params[0].data.startsWith('0x2d0e9b46')) {
          identityCalls++;
          if (chainDown) return Response.json({ error: { message: 'down' } }, { status: 500 });
          const who = `0x${params[0].data.slice(-40)}`;
          return Response.json({ result: `0x${word(who === GOOD ? BigInt(GOOD) : 0n)}` });
        }
        if (method === 'eth_call') return Response.json({ result: `0x${word(10n ** 24n)}` }); // balance
        throw new Error(`unexpected rpc ${method}`);
      }
      if (u.includes('/v2/rates/')) return Response.json({ data: { buy: { rate: '1400' }, sell: { rate: '1500' } } });
      if (u.endsWith('/v2/sender/orders') && init?.method === 'POST') {
        partnerCalls++;
        return Response.json(
          { status: 'success', data: { id: ORDER_ID, status: 'initiated', amount: '1', rate: '1500', providerAccount: { institution: 'Bank X', accountIdentifier: '9990001111', accountName: 'Pay Partner', amountToTransfer: '1.02', currency: 'USDT', receiveAddress: '0x3333333333333333333333333333333333333333', validUntil: '2026-12-08T22:00:00Z' } } },
          { status: 201 },
        );
      }
      throw new Error(`unexpected fetch ${u}`);
    }),
  );
});

afterEach(() => vi.unstubAllGlobals());

const refused = async (res: Response) => {
  expect(res.status).toBe(403);
  const body = (await res.json()) as { error: string; code: string; verifyUrl?: string };
  expect(body.code).toBe('not_verified');
  expect(body.error).toMatch(/verify with GoodDollar/i);
  expect(body.verifyUrl).toBe('https://wallet.gooddollar.org');
};

describe('adding G$ with naira', () => {
  it('E1. a wallet that is not verified is refused before anything is created', async () => {
    await refused(await call('POST', '/onramp/orders', topUp(BAD)));
    expect(partnerCalls).toBe(0);
    expect([...kv.store.keys()].some((k) => k.startsWith('onramp'))).toBe(false);
  });
  it('E2. a verified wallet goes ahead', async () => {
    expect((await call('POST', '/onramp/orders', topUp(GOOD))).status).toBe(201);
    expect(partnerCalls).toBe(1);
  });
});

describe('cashing out', () => {
  it('E3. one-tap: not verified is refused, verified goes ahead', async () => {
    await refused(await call('POST', '/orders/v2', oneTap(BAD)));
    expect(partnerCalls).toBe(0);
    expect((await call('POST', '/orders/v2', oneTap(GOOD))).status).toBe(201);
  });
  it('E4. the older cash-out route is held to the same rule', async () => {
    await refused(await call('POST', '/orders', legacy(BAD)));
    expect(partnerCalls).toBe(0);
    expect((await call('POST', '/orders', legacy(GOOD))).status).toBe(201);
  });
});

describe('when the check cannot be made, and the switch', () => {
  it('E5. an unreadable chain says try again and creates nothing, for every path', async () => {
    chainDown = true;
    for (const [path, body] of [['/onramp/orders', topUp(GOOD)], ['/orders/v2', oneTap(GOOD)], ['/orders', legacy(GOOD)]] as const) {
      const res = await call('POST', path, body);
      expect(res.status).toBe(503);
      expect(((await res.json()) as { code: string }).code).toBe('verification_unavailable');
    }
    expect(partnerCalls).toBe(0);
  });
  it('E6. with the rule switched off nobody is checked', async () => {
    env.REQUIRE_VERIFIED = 'false';
    expect((await call('POST', '/onramp/orders', topUp(BAD))).status).toBe(201);
    expect(identityCalls).toBe(0);
  });
  it('E7. the rule is not satisfied by a different wallet in the body (cash out checks the wallet that is paid from)', async () => {
    await refused(await call('POST', '/orders/v2', { ...oneTap(BAD), recipient }));
  });
});

describe('GET /verified', () => {
  it('E8. says yes, no, or try again, and rejects a malformed address', async () => {
    expect(await (await call('GET', `/verified?wallet=${GOOD}`)).json()).toMatchObject({ required: true, verified: true });
    expect(await (await call('GET', `/verified?wallet=${BAD}`)).json()).toMatchObject({ verified: false });
    expect((await call('GET', '/verified?wallet=nope')).status).toBe(400);
    chainDown = true;
    expect((await call('GET', `/verified?wallet=${GOOD}`)).status).toBe(503);
  });
});

describe('isVerified', () => {
  it('E9. a wallet whose verified root is another address counts, and a garbage answer is "could not tell"', async () => {
    const env2 = { CELO_RPC_URL: 'https://forno.celo.org' };
    expect(await isVerified(env2, GOOD)).toBe(true);
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ result: `0x${word(BigInt(BAD))}` })));
    expect(await isVerified(env2, GOOD.replace('1111', '4444'))).toBe(true); // root differs from the wallet itself
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ result: '0x12' })));
    expect(await isVerified(env2, BAD)).toBeNull();
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ result: `0x${word(0n)}` })));
    expect(await isVerified(env2, BAD)).toBe(false);
  });
});
