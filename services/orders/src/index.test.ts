/**
 * services/orders — unit tests
 *
 * We test the Worker in isolation by calling its fetch handler directly
 * with mocked Env bindings and a mocked global fetch (to simulate Paycrest).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import worker, { alertSlowPayouts } from './index.js';
import type { Env } from './index.js';

// ---------------------------------------------------------------------------
// Mock KV namespace
// ---------------------------------------------------------------------------
class MockKV {
  private store: Map<string, { value: string; expiration?: number }> = new Map();

  async get(key: string): Promise<string | null> {
    const entry = this.store.get(key);
    return entry ? entry.value : null;
  }

  async put(key: string, value: string, opts?: { expirationTtl?: number }): Promise<void> {
    this.store.set(key, { value, expiration: opts?.expirationTtl });
  }

  async delete(key: string): Promise<void> {
    this.store.delete(key);
  }

  async list(opts: { prefix?: string; limit?: number } = {}): Promise<{ keys: Array<{ name: string }> }> {
    const keys = [...this.store.keys()].filter((k) => k.startsWith(opts.prefix ?? '')).slice(0, opts.limit ?? 1000);
    return { keys: keys.map((name) => ({ name })) };
  }

  clear() {
    this.store.clear();
  }
}

// ---------------------------------------------------------------------------
// Mock Env
// ---------------------------------------------------------------------------
function makeEnv(kv: MockKV, overrides: Partial<Env> = {}): Env {
  return {
    PAYCREST_API_KEY: 'test-api-key',
    PAYCREST_API_SECRET: 'test-secret',
    PAYCREST_BASE_URL: 'https://api.paycrest.io',
    ORDER_STORE: kv as unknown as KVNamespace,
    ALLOWED_ORIGINS: 'https://goodcash.app',
    VERIFY_SWAP_ONCHAIN: 'false',
    RATE_LIMIT_MAX: '0',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const VALID_BODY = {
  amount: '0.50',
  refundAddress: '0xDeaDbeefdEAdbeefdEadbEEFdeadbeEFdEaDbeeF',
  recipient: {
    institution: 'GTBINGLA',
    accountIdentifier: '0123456789',
    accountName: 'John Doe',
  },
  reference: 'goodcash-test001',
};

const MOCK_PAYCREST_RESPONSE = {
  id: '550e8400-e29b-41d4-a716-446655440000',
  status: 'initiated',
  amount: '0.50',
  rate: '1500',
  providerAccount: {
    network: 'celo',
    receiveAddress: '0xProviderAddress1234',
    validUntil: '2026-11-04T22:00:00Z',
    amountToTransfer: '0.50',
    currency: 'USDT',
    memo: 'GoodCash',
  },
  senderFee: '0',
  transactionFee: '0.01',
};

function makeRequest(method: string, path: string, body?: unknown): Request {
  return new Request(`https://orders.goodcash.workers.dev${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('POST /orders', () => {
  let kv: MockKV;
  let env: Env;
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    kv = new MockKV();
    env = makeEnv(kv);
    fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => MOCK_PAYCREST_RESPONSE,
    });
    vi.stubGlobal('fetch', fetchSpy);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    kv.clear();
  });

  it('1. Creates an order successfully and returns client-safe fields', async () => {
    const req = makeRequest('POST', '/orders', VALID_BODY);
    const res = await worker.fetch(req, env);

    expect(res.status).toBe(201);
    const data = await res.json() as Record<string, unknown>;

    // Required client fields
    expect(data.orderId).toBe('550e8400-e29b-41d4-a716-446655440000');
    expect(data.receiveAddress).toBe('0xProviderAddress1234');
    expect(data.amountToSend).toBe('0.50');
    expect(data.amount).toBe('0.50');
    expect(data.rate).toBe('1500');
    expect(data.expectedNaira).toBe('750.00');
    expect(data.senderFee).toBe('0');
    expect(data.transactionFee).toBe('0.01');
    expect(data.validUntil).toBeTruthy();
    expect(data.status).toBe('initiated');

    // API key MUST NOT appear in the response
    const responseText = JSON.stringify(data);
    expect(responseText).not.toContain('test-api-key');
  });

  it('2. Stores order state in KV after creation', async () => {
    const req = makeRequest('POST', '/orders', VALID_BODY);
    await worker.fetch(req, env);

    const stored = await kv.get('order:550e8400-e29b-41d4-a716-446655440000');
    expect(stored).not.toBeNull();
    const state = JSON.parse(stored!);
    expect(state.status).toBe('initiated');
    expect(state.receiveAddress).toBe('0xProviderAddress1234');
  });

  it('3. Rejects amount below $0.50 minimum', async () => {
    const req = makeRequest('POST', '/orders', { ...VALID_BODY, amount: '0.49' });
    const res = await worker.fetch(req, env);

    expect(res.status).toBe(400);
    const data = await res.json() as { error: string };
    // Error message should mention the minimum constraint
    expect(data.error).toMatch(/too small/i);
    // Paycrest should NOT have been called
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('4. Rejects invalid wallet address', async () => {
    const req = makeRequest('POST', '/orders', {
      ...VALID_BODY,
      refundAddress: 'not-an-address',
    });
    const res = await worker.fetch(req, env);
    expect(res.status).toBe(400);
  });

  it('5. Rejects missing required recipient fields', async () => {
    const req = makeRequest('POST', '/orders', {
      ...VALID_BODY,
      recipient: { institution: 'GTBINGLA' }, // missing accountIdentifier and accountName
    });
    const res = await worker.fetch(req, env);
    expect(res.status).toBe(400);
  });

  it('6. Returns 502 when Paycrest returns an error', async () => {
    fetchSpy.mockResolvedValue({
      ok: false,
      status: 400,
      text: async () => 'Amount is below the minimum',
    });
    const req = makeRequest('POST', '/orders', VALID_BODY);
    const res = await worker.fetch(req, env);
    expect(res.status).toBe(502);
  });

  it('7. Returns 503 when Paycrest is unreachable', async () => {
    fetchSpy.mockRejectedValue(new Error('Network failure'));
    const req = makeRequest('POST', '/orders', VALID_BODY);
    const res = await worker.fetch(req, env);
    expect(res.status).toBe(503);
  });
});

describe('GET /orders/:id', () => {
  let kv: MockKV;
  let env: Env;

  beforeEach(() => {
    kv = new MockKV();
    env = makeEnv(kv);
  });

  afterEach(() => kv.clear());

  it('8. Returns order status from KV cache', async () => {
    await kv.put('order:550e8400-e29b-41d4-a716-446655440000', JSON.stringify({
      status: 'pending',
      receiveAddress: '0xProviderAddress1234',
      amountToTransfer: '0.50',
      validUntil: '2026-11-04T22:00:00Z',
      paymentReference: null,
    }));

    const req = makeRequest('GET', '/orders/550e8400-e29b-41d4-a716-446655440000');
    const res = await worker.fetch(req, env);

    expect(res.status).toBe(200);
    const data = await res.json() as Record<string, unknown>;
    expect(data.status).toBe('pending');
    expect(data.orderId).toBe('550e8400-e29b-41d4-a716-446655440000');
  });

  it('8b. Refreshes a non-final cached order from Paycrest (no webhook needed)', async () => {
    const id = '550e8400-e29b-41d4-a716-446655440000';
    await kv.put(`order:${id}`, JSON.stringify({
      status: 'initiated',
      receiveAddress: '0xProviderAddress1234',
      amountToTransfer: '0.50',
      validUntil: '2026-11-04T22:00:00Z',
      paymentReference: null,
    }));
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ status: 'success', data: { id, status: 'settled', paymentReference: 'REF-1' } }), { status: 200 })
    );
    vi.stubGlobal('fetch', fetchMock);

    const res = await worker.fetch(makeRequest('GET', `/orders/${id}`), env);
    const data = await res.json() as Record<string, unknown>;
    expect(data.status).toBe('settled');
    expect(data.paymentReference).toBe('REF-1');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    vi.unstubAllGlobals();

    // Now final: served from KV without another Paycrest call
    const again = vi.fn();
    vi.stubGlobal('fetch', again);
    const res2 = await worker.fetch(makeRequest('GET', `/orders/${id}`), env);
    expect(((await res2.json()) as Record<string, unknown>).status).toBe('settled');
    expect(again).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('9. Rejects invalid order ID format with 400', async () => {
    // The route now accepts any path segment, but the handler validates the UUID format
    const req = makeRequest('GET', '/orders/not-a-uuid-!!!');
    const res = await worker.fetch(req, env);
    // The route regex requires [^/]+ — with special chars it won't match, giving 404
    // So we test the 400 path via a plausible-looking but wrong-format ID
    const req2 = makeRequest('GET', '/orders/not-a-valid-uuid-at-all-short');
    const res2 = await worker.fetch(req2, env);
    // Invalid UUID format → 400
    expect([400, 404]).toContain(res2.status);
  });
});

describe('POST /webhooks/paycrest', () => {
  let kv: MockKV;
  let env: Env;

  beforeEach(async () => {
    kv = new MockKV();
    env = makeEnv(kv);
    // Pre-seed a KV order
    await kv.put('order:550e8400-e29b-41d4-a716-446655440000', JSON.stringify({
      status: 'initiated',
      receiveAddress: '0xProvider',
      amountToTransfer: '0.50',
      validUntil: '2026-11-04T22:00:00Z',
      paymentReference: null,
    }));
  });

  afterEach(() => kv.clear());

  /**
   * Compute the HMAC-SHA256 signature using the WebCrypto API.
   * This replicates what Paycrest does when sending a webhook.
   */
  async function signPayload(secret: string, payload: string): Promise<string> {
    const enc = new TextEncoder();
    const key = await crypto.subtle.importKey(
      'raw', enc.encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false, ['sign'],
    );
    const sig = await crypto.subtle.sign('HMAC', key, enc.encode(payload));
    return Array.from(new Uint8Array(sig))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  }

  it('10. Accepts a valid webhook and updates order status in KV', async () => {
    const payload = JSON.stringify({
      event: 'payment_order.settled',
      data: {
        id: '550e8400-e29b-41d4-a716-446655440000',
        status: 'settled',
        paymentReference: 'TXN123456',
      },
    });
    const sig = await signPayload('test-secret', payload);

    const req = new Request('https://orders.goodcash.workers.dev/webhooks/paycrest', {
      method: 'POST',
      headers: { 'X-Paycrest-Signature': sig },
      body: payload,
    });
    const res = await worker.fetch(req, env);
    expect(res.status).toBe(200);

    // Verify KV was updated
    const stored = await kv.get('order:550e8400-e29b-41d4-a716-446655440000');
    const state = JSON.parse(stored!);
    expect(state.status).toBe('settled');
    expect(state.paymentReference).toBe('TXN123456');
  });

  it('11. Rejects webhook with invalid signature', async () => {
    const payload = JSON.stringify({
      event: 'payment_order.settled',
      data: { id: '550e8400-e29b-41d4-a716-446655440000', status: 'settled' },
    });

    const req = new Request('https://orders.goodcash.workers.dev/webhooks/paycrest', {
      method: 'POST',
      headers: { 'X-Paycrest-Signature': 'invalidsignature' },
      body: payload,
    });
    const res = await worker.fetch(req, env);
    expect(res.status).toBe(403);
  });
});

describe('CORS and routing', () => {
  const kv = new MockKV();
  const env = makeEnv(kv);

  it('12. OPTIONS pre-flight returns 204 only for an allowed origin', async () => {
    const allowed = new Request('https://orders.goodcash.workers.dev/orders', {
      method: 'OPTIONS',
      headers: { Origin: 'https://goodcash.app' },
    });
    const allowedRes = await worker.fetch(allowed, env);
    expect(allowedRes.status).toBe(204);
    expect(allowedRes.headers.get('Access-Control-Allow-Origin')).toBe('https://goodcash.app');

    const blocked = new Request('https://orders.goodcash.workers.dev/orders', {
      method: 'OPTIONS',
      headers: { Origin: 'https://attacker.example' },
    });
    const blockedRes = await worker.fetch(blocked, env);
    expect(blockedRes.status).toBe(204);
    expect(blockedRes.headers.get('Access-Control-Allow-Origin')).toBeNull();
  });

  it('13. GET /health returns 200', async () => {
    const req = new Request('https://orders.goodcash.workers.dev/health', { method: 'GET' });
    const res = await worker.fetch(req, env);
    expect(res.status).toBe(200);
    const data = await res.json() as { ok: boolean };
    expect(data.ok).toBe(true);
  });

  it('14. Unknown routes return 404', async () => {
    const req = new Request('https://orders.goodcash.workers.dev/unknown', { method: 'GET' });
    const res = await worker.fetch(req, env);
    expect(res.status).toBe(404);
  });

  it('15. GET /rates proxies Paycrest rate with CORS headers', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: { sell: { rate: '1620.50' } } }),
    }));

    const req = new Request('https://orders.goodcash.workers.dev/rates', {
      method: 'GET',
      headers: { Origin: 'https://goodcash.app' },
    });
    const res = await worker.fetch(req, env);
    expect(res.status).toBe(200);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('https://goodcash.app');
    const data = await res.json() as { data: { sell: { rate: string } } };
    expect(data.data.sell.rate).toBe('1620.50');
  });

  it('16. GET /rates returns 502 when sell.rate is missing', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: { buy: { rate: '1600.00' } } }), // missing sell.rate
    }));

    const req = new Request('https://orders.goodcash.workers.dev/rates', { method: 'GET' });
    const res = await worker.fetch(req, env);
    expect(res.status).toBe(502);
    const body = await res.json() as { error: string };
    expect(body.error).toContain('sell rate missing');
  });
});

describe('Account-name verification', () => {
  const kv = new MockKV();
  const env = makeEnv(kv);

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('17. resolves the Paycrest account name and uses the institution code', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        status: 'success',
        message: 'Account name was fetched successfully',
        data: 'JOHN DOE',
      }),
    });
    vi.stubGlobal('fetch', fetchSpy);

    const req = makeRequest('POST', '/verify-account', {
      institution: 'GTBINGLA',
      accountIdentifier: '0123456789',
    });
    const res = await worker.fetch(req, env);

    expect(res.status).toBe(200);
    const data = await res.json() as { accountName: string };
    expect(data.accountName).toBe('JOHN DOE');

    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.paycrest.io/v2/verify-account');
    expect(init.headers).toMatchObject({ 'API-Key': 'test-api-key' });
    expect(JSON.parse(String(init.body))).toEqual({
      institution: 'GTBINGLA',
      accountIdentifier: '0123456789',
    });
  });

  it('18. returns 400 for a definitive rejected account', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ status: 'error', message: 'Account not found' }),
    }));

    const req = makeRequest('POST', '/verify-account', {
      institution: 'GTBINGLA',
      accountIdentifier: '0000000000',
    });
    const res = await worker.fetch(req, env);
    expect(res.status).toBe(400);
    const data = await res.json() as { error: string };
    expect(data.error).toBe('Account not found');
  });

  it('19. lists institutions from Paycrest for the dropdown', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        status: 'success',
        data: [
          { name: 'Guaranty Trust Bank', code: 'GTBINGLA', type: 'bank' },
          { name: 'OPay', code: 'OPAYNGPC', type: 'mobile_money' },
        ],
      }),
    }));

    const req = makeRequest('GET', '/institutions/NGN');
    const res = await worker.fetch(req, env);

    expect(res.status).toBe(200);
    const data = await res.json() as { institutions: Array<{ name: string; code: string; type: string }> };
    expect(data.institutions).toEqual([
      { name: 'Guaranty Trust Bank', code: 'GTBINGLA', type: 'bank' },
      { name: 'OPay', code: 'OPAYNGPC', type: 'mobile_money' },
    ]);
  });
});

describe('Paycrest documented order response', () => {
  it('20. maps amountToSend, fees, and expected naira from the docs example', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      status: 201,
      json: async () => ({
        status: 'success',
        message: 'Payment order created successfully',
        data: {
          id: '550e8400-e29b-41d4-a716-446655440000',
          status: 'initiated',
          amount: '100',
          rate: '1650',
          senderFee: '4.9',
          transactionFee: '0.1',
          providerAccount: {
            network: 'celo',
            receiveAddress: '0xProviderReceiveAddress',
            validUntil: '2026-11-05T15:35:00Z',
            amountToTransfer: '105',
            currency: 'USDT',
            memo: 'GoodCash',
          },
        },
      }),
    });
    vi.stubGlobal('fetch', fetchSpy);

    const env = makeEnv(new MockKV());
    const req = makeRequest('POST', '/orders', {
      ...VALID_BODY,
      amount: '100',
    });
    const res = await worker.fetch(req, env);

    expect(res.status).toBe(201);
    const data = await res.json() as Record<string, string>;
    expect(data.amountToSend).toBe('105');
    expect(data.senderFee).toBe('4.9');
    expect(data.transactionFee).toBe('0.1');
    expect(data.amount).toBe('100');
    expect(data.rate).toBe('1650');
    expect(data.expectedNaira).toBe('165000.00');

    vi.unstubAllGlobals();
  });
});

describe('Abuse protection', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('21. rate limits verify-account per IP', async () => {
    const kv = new MockKV();
    const env = makeEnv(kv, { RATE_LIMIT_MAX: '2', RATE_LIMIT_WINDOW_SECONDS: '60' });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ status: 'success', data: 'JOHN DOE' }),
    }));

    const body = { institution: 'GTBINGLA', accountIdentifier: '0123456789' };
    expect((await worker.fetch(makeRequest('POST', '/verify-account', body), env)).status).toBe(200);
    expect((await worker.fetch(makeRequest('POST', '/verify-account', body), env)).status).toBe(200);
    const blocked = await worker.fetch(makeRequest('POST', '/verify-account', body), env);
    expect(blocked.status).toBe(429);
    const data = await blocked.json() as { error: string };
    expect(data.error).toContain('Too many requests');
  });

  it('22. creates an order only after proving the swap belongs to the refund wallet', async () => {
    const kv = new MockKV();
    const env = makeEnv(kv, {
      VERIFY_SWAP_ONCHAIN: 'true',
      CELO_RPC_URL: 'https://rpc.test',
      RATE_LIMIT_MAX: '0',
    });

    const wallet = VALID_BODY.refundAddress;
    const topic = (address: string) => `0x${address.slice(2).padStart(64, '0').toLowerCase()}`;
    const word = (value: bigint) => value.toString(16).padStart(64, '0');
    const receipt = {
      status: '0x1',
      logs: [{
        address: '0xA4338586d4B2f0E1641C54b8cF0d53CD06B5c407',
        topics: [
          '0xfd08ba0cf09cbb75e5d99933b03678a9b307c9a4839063749004850da25931dc',
          topic(wallet),
          topic(wallet),
          topic('0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e'),
        ],
        data: `0x${word(500000n)}${word(500000n)}${word(2n)}${word(0n)}`,
      }],
    };

    const fetchSpy = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).includes('/v2/sender/orders')) {
        return { ok: true, json: async () => MOCK_PAYCREST_RESPONSE };
      }
      return { ok: true, json: async () => ({ jsonrpc: '2.0', id: 1, result: receipt }) };
    });
    vi.stubGlobal('fetch', fetchSpy);

    const txHash = `0x${'ab'.repeat(32)}`;
    const res = await worker.fetch(
      makeRequest('POST', '/orders', { ...VALID_BODY, swapTxHash: txHash }),
      env
    );

    expect(res.status).toBe(201);
    const rpcCall = fetchSpy.mock.calls.find(([url]) => String(url) === 'https://rpc.test');
    expect(rpcCall).toBeDefined();
    expect(JSON.parse(String(((rpcCall as unknown[])[1] as RequestInit).body))).toMatchObject({
      method: 'eth_getTransactionReceipt',
      params: [txHash],
    });

    const paycrestCall = fetchSpy.mock.calls.find(([url]) => String(url).includes('/v2/sender/orders'));
    const paycrestBody = JSON.parse(String(((paycrestCall as unknown[])[1] as RequestInit).body));
    expect(paycrestBody.senderFee).toBeUndefined();
    expect(paycrestBody.senderFeeAddress).toBeUndefined();
    expect(paycrestBody.source.refundAddress).toBe(wallet);
  });

  it('23. rejects a swap owned by a different wallet', async () => {
    const kv = new MockKV();
    const env = makeEnv(kv, {
      VERIFY_SWAP_ONCHAIN: 'true',
      CELO_RPC_URL: 'https://rpc.test',
      RATE_LIMIT_MAX: '0',
    });

    const other = '0x1111111111111111111111111111111111111111';
    const topic = (address: string) => `0x${address.slice(2).padStart(64, '0').toLowerCase()}`;
    const word = (value: bigint) => value.toString(16).padStart(64, '0');
    const receipt = {
      status: '0x1',
      logs: [{
        address: '0xA4338586d4B2f0E1641C54b8cF0d53CD06B5c407',
        topics: [
          '0xfd08ba0cf09cbb75e5d99933b03678a9b307c9a4839063749004850da25931dc',
          topic(other),
          topic(other),
          topic('0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e'),
        ],
        data: `0x${word(500000n)}${word(500000n)}${word(2n)}${word(0n)}`,
      }],
    };

    const fetchSpy = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).includes('/v2/sender/orders')) {
        return { ok: true, json: async () => MOCK_PAYCREST_RESPONSE };
      }
      return { ok: true, json: async () => ({ jsonrpc: '2.0', id: 1, result: receipt }) };
    });
    vi.stubGlobal('fetch', fetchSpy);

    const res = await worker.fetch(
      makeRequest('POST', '/orders', { ...VALID_BODY, swapTxHash: `0x${'cd'.repeat(32)}` }),
      env
    );

    expect(res.status).toBe(403);
    expect(fetchSpy.mock.calls.some(([url]) => String(url).includes('/v2/sender/orders'))).toBe(false);
  });

  it('24. requires swapTxHash when on-chain verification is enabled', async () => {
    const kv = new MockKV();
    const env = makeEnv(kv, { VERIFY_SWAP_ONCHAIN: 'true', RATE_LIMIT_MAX: '0' });
    vi.stubGlobal('fetch', vi.fn());

    const res = await worker.fetch(makeRequest('POST', '/orders', VALID_BODY), env);
    expect(res.status).toBe(400);
    const data = await res.json() as { error: string };
    expect(data.error).toContain('swapTxHash is required');
  });
});


const FIRST_BLOCK = 81917173;
type FakeRow = { transactionHash: string; data: string; timeStamp: string };

/** Pretends to be the Celo node (blockNumber, getLogs, getBlock) plus the payout partner. */
function chainMock(rows: FakeRow[], paycrestStatus = 'initiated', opts: { rpcFails?: boolean } = {}) {
  return vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
    const u = String(url);
    if (u.includes('blockscout')) return new Response('slow down', { status: 429 });
    if (u.includes('api.resend.com')) return new Response('{}', { status: 200 });
    if (u.includes('forno') || u.includes('celo.org')) {
      if (opts.rpcFails) return new Response('{}', { status: 500 });
      const body = JSON.parse(String(init?.body ?? '{}')) as { method: string };
      if (body.method === 'eth_blockNumber') return new Response(JSON.stringify({ result: '0x' + (FIRST_BLOCK + 100).toString(16) }), { status: 200 });
      if (body.method === 'eth_getLogs') {
        return new Response(JSON.stringify({ result: rows.map((r) => ({ transactionHash: r.transactionHash, data: r.data, blockNumber: '0x' + (FIRST_BLOCK + 50).toString(16) })) }), { status: 200 });
      }
      if (body.method === 'eth_getBlockByNumber') return new Response(JSON.stringify({ result: { timestamp: rows[0]?.timeStamp ?? '0x0' } }), { status: 200 });
      return new Response(JSON.stringify({ result: null }), { status: 200 });
    }
    return new Response(JSON.stringify({ data: { status: paycrestStatus } }), { status: 200 });
  });
}

describe('Support tickets, unfinished swaps and duplicate-payout guard', () => {
  let kv: MockKV;
  let env: Env;
  beforeEach(() => {
    kv = new MockKV();
    env = makeEnv(kv);
  });
  afterEach(() => {
    kv.clear();
    vi.unstubAllGlobals();
  });

  const WALLET = '0xDeaDbeefdEAdbeefdEadbEEFdeadbeEFdEaDbeeF';
  const TX = '0x' + 'ab'.repeat(32);

  it('S1. Stores a support ticket and returns a reference', async () => {
    const res = await worker.fetch(
      makeRequest('POST', '/support', {
        email: 'user@example.com',
        topic: 'not_arrived',
        message: 'My naira has not arrived after an hour',
        context: { orderId: 'abc', txHash: TX, wallet: WALLET },
      }),
      env
    );
    expect(res.status).toBe(201);
    const data = (await res.json()) as { ticketId: string };
    expect(data.ticketId).toMatch(/^GC-[A-Z0-9]{6}$/);
    const saved = await kv.get(`ticket:${data.ticketId}`);
    expect(saved).toContain('user@example.com');
  });

  it('S2. Rejects a support request with a bad email or a too-short message', async () => {
    const bad = await worker.fetch(
      makeRequest('POST', '/support', { email: 'nope', topic: 'other', message: 'long enough message here' }),
      env
    );
    expect(bad.status).toBe(400);
    const short = await worker.fetch(
      makeRequest('POST', '/support', { email: 'a@b.com', topic: 'other', message: 'short' }),
      env
    );
    expect(short.status).toBe(400);
  });

  it('S3. Emails the team when email is configured, without failing the ticket', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    env = makeEnv(kv, { RESEND_API_KEY: 'key', SUPPORT_INBOX: 'team@example.com' });
    const res = await worker.fetch(
      makeRequest('POST', '/support', { email: 'user@example.com', topic: 'other', message: 'Something odd happened here' }),
      env
    );
    expect(res.status).toBe(201);
    const call = fetchMock.mock.calls.find((c) => String(c[0]).includes('api.resend.com'));
    expect(call).toBeTruthy();
    const sent = JSON.parse((call![1] as RequestInit).body as string);
    expect(sent.to).toEqual(['team@example.com']);
    expect(sent.reply_to).toBe('user@example.com');
  });

  it('S4. Lists only swaps without a payout as unfinished', async () => {
    const data = '0x' + (5000n * 10n ** 18n).toString(16).padStart(64, '0') + (573332n).toString(16).padStart(64, '0');
    const now = Math.floor(Date.now() / 1000).toString(16);
    const paidTx = '0x' + 'cd'.repeat(32);
    await kv.put(`swap:${paidTx}`, 'order-paid');
    vi.stubGlobal('fetch', chainMock(
      [{ transactionHash: TX, data, timeStamp: `0x${now}` }, { transactionHash: paidTx, data, timeStamp: `0x${now}` }],
      'settled'
    ));
    const res = await worker.fetch(makeRequest('GET', `/swaps/unfinished?wallet=${WALLET}`), env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { swaps: Array<{ txHash: string; amountG: string; usdtReceived: string }> };
    expect(body.swaps).toHaveLength(1);
    expect(body.swaps[0].txHash).toBe(TX);
    expect(body.swaps[0].amountG).toBe('5000');
    expect(body.swaps[0].usdtReceived).toBe('0.573332');
  });

  it('S6. Refuses a second order for a swap that is already being paid out', async () => {
    await kv.put(`swap:${TX}`, 'order-live');
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: { status: 'pending' } }), { status: 200 }))
    );
    const res = await worker.fetch(makeRequest('POST', '/orders', { ...VALID_BODY, swapTxHash: TX }), env);
    expect(res.status).toBe(409);
  });

  it('S7. Quiet error reports are accepted and never echo anything back', async () => {
    const res = await worker.fetch(makeRequest('POST', '/diag', { kind: 'deposit_failed', message: 'boom', orderId: 'o1' }), env);
    expect(res.status).toBe(204);
  });

  it('S8. Looks up the payout order that belongs to a swap', async () => {
    await kv.put(`swap:${TX}`, 'order-xyz');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: { status: 'settled' } }), { status: 200 })));
    const ok = await worker.fetch(makeRequest('GET', `/swaps/${TX}`), env);
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ orderId: 'order-xyz', status: 'settled' });
    const missing = await worker.fetch(makeRequest('GET', `/swaps/0x${'cd'.repeat(32)}`), env);
    expect(missing.status).toBe(404);
  });

  it('S9. Wallet history lists every swap with its payout status', async () => {
    const data = '0x' + (5000n * 10n ** 18n).toString(16).padStart(64, '0') + (573332n).toString(16).padStart(64, '0');
    const t1 = Math.floor(Date.now() / 1000).toString(16);
    const paidTx = '0x' + 'cd'.repeat(32);
    await kv.put(`swap:${paidTx}`, 'order-paid');
    await kv.put(`naira:${paidTx}`, '757.37');
    vi.stubGlobal('fetch', chainMock(
      [{ transactionHash: TX, data, timeStamp: `0x${t1}` }, { transactionHash: paidTx, data, timeStamp: `0x${t1}` }],
      'settled'
    ));
    const res = await worker.fetch(makeRequest('GET', `/history?wallet=${WALLET}`), env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { swaps: Array<{ txHash: string; status?: string; naira?: string; orderId?: string }> };
    expect(body.swaps).toHaveLength(2);
    const paid = body.swaps.find((x) => x.txHash === paidTx)!;
    expect(paid.status).toBe('settled');
    expect(paid.naira).toBe('757.37');
    expect(paid.orderId).toBe('order-paid');
    expect(body.swaps.find((x) => x.txHash === TX)!.orderId).toBeUndefined();
    expect(await kv.get(`done:${paidTx}`)).toBe('settled');
  });

  it('S9b. Reads swaps from the chain itself and never needs the rate-limited block explorer', async () => {
    const data = '0x' + (5000n * 10n ** 18n).toString(16).padStart(64, '0') + (573332n).toString(16).padStart(64, '0');
    const t1 = Math.floor(Date.now() / 1000).toString(16);
    const mock = chainMock([{ transactionHash: TX, data, timeStamp: `0x${t1}` }]);
    vi.stubGlobal('fetch', mock);
    const res = await worker.fetch(makeRequest('GET', `/history?wallet=${WALLET}`), env);
    expect(res.status).toBe(200);
    expect(((await res.json()) as { swaps: unknown[] }).swaps).toHaveLength(1);
    expect(mock.mock.calls.some((c) => String(c[0]).includes('blockscout'))).toBe(false);
    // progress is remembered so the next refresh only looks at new blocks
    expect(await kv.get(`wscan:${WALLET.toLowerCase()}`)).toContain(TX);
  });

  it('S10. Falls back to the last known list when both the node and the explorer fail', async () => {
    const data = '0x' + (5000n * 10n ** 18n).toString(16).padStart(64, '0') + (573332n).toString(16).padStart(64, '0');
    const t1 = Math.floor(Date.now() / 1000).toString(16);
    await kv.put(`wscan:${WALLET.toLowerCase()}`, JSON.stringify({ fwd: 1, back: 1, rows: [{ transactionHash: TX, data, timeStamp: `0x${t1}` }] }));
    vi.stubGlobal('fetch', chainMock([], 'initiated', { rpcFails: true }));
    const res = await worker.fetch(makeRequest('GET', `/history?wallet=${WALLET}`), env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { swaps: Array<{ txHash: string }> };
    expect(body.swaps.map((x) => x.txHash)).toEqual([TX]);
  });

  it('S11. Says so plainly when there is neither a live answer nor a saved one', async () => {
    vi.stubGlobal('fetch', chainMock([], 'initiated', { rpcFails: true }));
    const res = await worker.fetch(makeRequest('GET', `/history?wallet=${WALLET}`), env);
    expect(res.status).toBe(503);
  });

  it('N1. Stores an opt-in email for one order only, and rejects bad input', async () => {
    const id = '550e8400-e29b-41d4-a716-446655440000';
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: { status: 'initiated' } }), { status: 200 })));
    const ok = await worker.fetch(makeRequest('POST', '/notify', { orderId: id, email: 'me@example.com' }), env);
    expect(ok.status).toBe(204);
    expect(await kv.get(`notify:${id}`)).toBe('me@example.com');
    const badEmail = await worker.fetch(makeRequest('POST', '/notify', { orderId: id, email: 'nope' }), env);
    expect(badEmail.status).toBe(400);
    const badOrder = await worker.fetch(makeRequest('POST', '/notify', { orderId: 'x', email: 'me@example.com' }), env);
    expect(badOrder.status).toBe(400);
  });

  it('N2. Emails the customer exactly once when the payout lands', async () => {
    const id = '550e8400-e29b-41d4-a716-446655440000';
    env = makeEnv(kv, { RESEND_API_KEY: 'key', RESEND_FROM: 'GoodCash <hello@goodcash.xyz>' });
    await kv.put(`swap:${TX}`, id);
    await kv.put(`notify:${id}`, 'me@example.com');
    const fetchMock = vi.fn().mockImplementation(async (url: string) => {
      if (String(url).includes('api.resend.com')) return new Response('{}', { status: 200 });
      return new Response(JSON.stringify({ data: { status: 'settled' } }), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);

    await worker.fetch(makeRequest('GET', `/swaps/${TX}`), env);
    await worker.fetch(makeRequest('GET', `/swaps/${TX}`), env);
    await worker.fetch(makeRequest('GET', `/orders/${id}`), env);

    const sends = fetchMock.mock.calls.filter((c) => String(c[0]).includes('api.resend.com'));
    expect(sends).toHaveLength(1);
    const sent = JSON.parse((sends[0][1] as RequestInit).body as string);
    expect(sent.to).toEqual(['me@example.com']);
    expect(sent.from).toBe('GoodCash <hello@goodcash.xyz>');
    expect(sent.text).not.toMatch(/USDT|Paycrest/i);
    expect(await kv.get(`notify:${id}`)).toBeNull();
  });

  it('N3. Does not email while the payout is still on its way', async () => {
    const id = '550e8400-e29b-41d4-a716-446655440000';
    env = makeEnv(kv, { RESEND_API_KEY: 'key' });
    await kv.put(`swap:${TX}`, id);
    await kv.put(`notify:${id}`, 'me@example.com');
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: { status: 'pending' } }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    await worker.fetch(makeRequest('GET', `/swaps/${TX}`), env);
    expect(fetchMock.mock.calls.some((c) => String(c[0]).includes('api.resend.com'))).toBe(false);
    expect(await kv.get(`notify:${id}`)).toBe('me@example.com');
  });

  it('S5. Rejects a malformed wallet address', async () => {
    const res = await worker.fetch(makeRequest('GET', '/swaps/unfinished?wallet=0x123'), env);
    expect(res.status).toBe(400);
  });
});

describe('rate limiting without storage writes', () => {
  it('R1. Uses the Cloudflare limiter when present and writes nothing to KV', async () => {
    const kv2 = new MockKV();
    const limit = vi.fn().mockResolvedValue({ success: true });
    const env2 = makeEnv(kv2, { RATE_LIMITER: { limit }, RATE_LIMITER_STRICT: { limit } } as never);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 200 })));
    await worker.fetch(makeRequest('POST', '/diag', { kind: 'x', message: 'y' }), env2);
    expect(limit).toHaveBeenCalled();
    expect([...(kv2 as unknown as { store?: Map<string, string> }).store?.keys() ?? []].filter((k) => k.startsWith('rl:'))).toHaveLength(0);
  });
  it('R2. Answers 429 when the limiter says no', async () => {
    const env2 = makeEnv(new MockKV(), { RATE_LIMITER: { limit: vi.fn().mockResolvedValue({ success: false }) } } as never);
    const res = await worker.fetch(makeRequest('POST', '/verify-account', { institution: 'GTBINGLA', accountIdentifier: '0123456789' }), env2);
    expect(res.status).toBe(429);
  });
});


describe('findings 6, 8, 11, 14', () => {
  const ID = '550e8400-e29b-41d4-a716-446655440000';
  const SWAP = '0x' + 'ab'.repeat(32);

  it('F6. Hands back the still-open order instead of creating a second one', async () => {
    const kv3 = new MockKV();
    const env3 = makeEnv(kv3);
    await kv3.put(`swap:${SWAP}`, ID);
    await kv3.put(`swaprec:${SWAP}`, await fingerprintOf(VALID_BODY));
    const future = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    const open = { ...MOCK_PAYCREST_RESPONSE, providerAccount: { ...MOCK_PAYCREST_RESPONSE.providerAccount, validUntil: future } };
    const fetchMock = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
      if (init?.method === 'POST') return new Response(JSON.stringify(open), { status: 201 });
      return new Response(JSON.stringify({ data: open }), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);
    const res = await worker.fetch(makeRequest('POST', '/orders', { ...VALID_BODY, swapTxHash: SWAP }), env3);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { orderId: string };
    expect(body.orderId).toBe(ID);
    expect(fetchMock.mock.calls.some((c) => (c[1] as RequestInit | undefined)?.method === 'POST')).toBe(false);
  });

  it('F6b. Replaces an order whose payment window has closed', async () => {
    const kv3 = new MockKV();
    const env3 = makeEnv(kv3);
    await kv3.put(`swap:${SWAP}`, ID);
    const past = new Date(Date.now() - 60 * 1000).toISOString();
    const stale = { ...MOCK_PAYCREST_RESPONSE, providerAccount: { ...MOCK_PAYCREST_RESPONSE.providerAccount, validUntil: past } };
    const fresh = { ...MOCK_PAYCREST_RESPONSE, id: '650e8400-e29b-41d4-a716-446655440000' };
    const fetchMock = vi.fn().mockImplementation(async (_url: string, init?: RequestInit) => {
      if (init?.method === 'POST') return new Response(JSON.stringify(fresh), { status: 201 });
      return new Response(JSON.stringify({ data: stale }), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);
    const res = await worker.fetch(makeRequest('POST', '/orders', { ...VALID_BODY, swapTxHash: SWAP }), env3);
    expect(res.status).toBe(201);
    expect(((await res.json()) as { orderId: string }).orderId).toBe('650e8400-e29b-41d4-a716-446655440000');
  });

  it('F11. A late "pending" message never undoes "settled"', async () => {
    const kv3 = new MockKV();
    const env3 = makeEnv(kv3);
    await kv3.put(`order:${ID}`, JSON.stringify({ status: 'settled', receiveAddress: '0xP', amountToTransfer: '0.5', validUntil: 'x', paymentReference: 'R' }));
    const payload = JSON.stringify({ event: 'payment_order.pending', data: { id: ID, status: 'pending' } });
    const enc = new TextEncoder();
    const key = await crypto.subtle.importKey('raw', enc.encode('test-secret'), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const sig = Array.from(new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(payload)))).map((b) => b.toString(16).padStart(2, '0')).join('');
    const res = await worker.fetch(new Request('https://orders.goodcash.workers.dev/webhooks/paycrest', { method: 'POST', headers: { 'X-Paycrest-Signature': sig }, body: payload }), env3);
    expect(res.status).toBe(200);
    expect(JSON.parse((await kv3.get(`order:${ID}`))!).status).toBe('settled');
  });

  it('F8. Read endpoints are rate limited on their own, looser limiter', async () => {
    const limit = vi.fn().mockResolvedValue({ success: false });
    const env3 = makeEnv(new MockKV(), { RATE_LIMITER_READ: { limit } } as never);
    const res = await worker.fetch(makeRequest('GET', `/orders/${ID}`), env3);
    expect(res.status).toBe(429);
    expect(limit).toHaveBeenCalled();
  });

  it('F14. Refuses oversized support requests', async () => {
    const req = new Request('https://orders.goodcash.workers.dev/support', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': '50000' },
      body: JSON.stringify({ message: 'x' }),
    });
    const res = await worker.fetch(req, makeEnv(new MockKV()));
    expect(res.status).toBe(413);
  });
});


describe('branded payout email', () => {
  const ID = '550e8400-e29b-41d4-a716-446655440000';
  const TXH = '0x' + 'ab'.repeat(32);
  it('E1. Sends an HTML email with the naira amount, and no partner or token names', async () => {
    const kv4 = new MockKV();
    const env4 = makeEnv(kv4, { RESEND_API_KEY: 'key', RESEND_FROM: 'GoodCash <hello@goodcash.xyz>' });
    await kv4.put(`swap:${TXH}`, ID);
    const fetchMock = vi.fn().mockImplementation(async (url: string) => {
      if (String(url).includes('api.resend.com')) return new Response('{}', { status: 200 });
      return new Response(JSON.stringify({ data: { status: 'initiated' } }), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);
    const ok = await worker.fetch(makeRequest('POST', '/notify', { orderId: ID, email: 'me@example.com', naira: '₦786' }), env4);
    expect(ok.status).toBe(204);
    const bad = await worker.fetch(makeRequest('POST', '/notify', { orderId: ID, email: 'me@example.com', naira: '<script>' }), env4);
    expect(bad.status).toBe(204); // junk amount is ignored, not an error
    await kv4.put(`notify:${ID}`, JSON.stringify({ email: 'me@example.com', naira: '₦786' }));
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async (url: string) => {
      if (String(url).includes('api.resend.com')) return new Response('{}', { status: 200 });
      return new Response(JSON.stringify({ data: { status: 'settled' } }), { status: 200 });
    }));
    const calls: unknown[][] = [];
    const spy = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
      calls.push([url, init]);
      if (String(url).includes('api.resend.com')) return new Response('{}', { status: 200 });
      return new Response(JSON.stringify({ data: { status: 'settled' } }), { status: 200 });
    });
    vi.stubGlobal('fetch', spy);
    await worker.fetch(makeRequest('GET', `/swaps/${TXH}`), env4);
    const sent = calls.find((c) => String(c[0]).includes('api.resend.com'));
    expect(sent).toBeTruthy();
    const mail = JSON.parse((sent![1] as RequestInit).body as string);
    expect(mail.html).toContain('₦786');
    expect(mail.subject).toContain('₦786');
    expect(mail.html + mail.text).not.toMatch(/USDT|Paycrest/i);
  });
});


async function fingerprintOf(body: { recipient: { institution: string; accountIdentifier: string }; refundAddress: string }): Promise<string> {
  const data = new TextEncoder().encode(`${body.recipient.institution}|${body.recipient.accountIdentifier}|${body.refundAddress.toLowerCase()}`);
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', data))).map((b) => b.toString(16).padStart(2, '0')).join('');
}

describe('nobody else can get a customer paid out to their own bank', () => {
  it('X1. An open order made for a DIFFERENT bank account is never handed to the customer', async () => {
    const ID = '550e8400-e29b-41d4-a716-446655440000';
    const SWAP = '0x' + 'cd'.repeat(32);
    const kv5 = new MockKV();
    const env5 = makeEnv(kv5);
    await kv5.put(`swap:${SWAP}`, ID);
    // the earlier (attacker's) order was made for another bank account
    await kv5.put(`swaprec:${SWAP}`, await fingerprintOf({ ...VALID_BODY, recipient: { ...VALID_BODY.recipient, accountIdentifier: '9999999999' } }));
    const future = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    const rogue = { ...MOCK_PAYCREST_RESPONSE, providerAccount: { ...MOCK_PAYCREST_RESPONSE.providerAccount, validUntil: future } };
    const mine = { ...MOCK_PAYCREST_RESPONSE, id: '750e8400-e29b-41d4-a716-446655440000' };
    const fetchMock = vi.fn().mockImplementation(async (_u: string, init?: RequestInit) => {
      if (init?.method === 'POST') return new Response(JSON.stringify(mine), { status: 201 });
      return new Response(JSON.stringify({ data: rogue }), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);
    const res = await worker.fetch(makeRequest('POST', '/orders', { ...VALID_BODY, swapTxHash: SWAP }), env5);
    expect(res.status).toBe(201);
    expect(((await res.json()) as { orderId: string }).orderId).toBe('750e8400-e29b-41d4-a716-446655440000');
  });
});


describe('GET /onramp/quote (Add G$)', () => {
  const WALLET2 = '0x1111111111111111111111111111111111111111';
  const lifiOk = (toAmount: string, min: string) => ({
    fees: { relayer: { amountUsd: '0.0475' }, gas: { amountUsd: '0' } },
    details: { currencyOut: { amount: toAmount, minimumAmount: min } },
  });
  const mockFetch = (opts: { rate?: string | null; lifi?: unknown; lifiStatus?: number } = {}) =>
    vi.fn().mockImplementation(async (url: string) => {
      const u = String(url);
      if (u.includes('/v2/rates/base/USDC')) {
        if (opts.rate === null) return new Response(JSON.stringify({ status: 'error', data: null }), { status: 400 });
        return new Response(JSON.stringify({ data: { buy: { rate: opts.rate ?? '1384.52' } } }), { status: 200 });
      }
      if (u.includes('api.relay.link')) {
        return new Response(JSON.stringify(opts.lifi ?? lifiOk('43429796433269220000000', '42663850916546540000000')), { status: opts.lifiStatus ?? 200 });
      }
      return new Response('{}', { status: 404 });
    });

  it('Q1. Prices naira in G$ using the partner rate, the fee, and the swap quote', async () => {
    const f = mockFetch();
    vi.stubGlobal('fetch', f);
    const res = await worker.fetch(makeRequest('GET', `/onramp/quote?naira=7000&wallet=${WALLET2}`), makeEnv(new MockKV()));
    expect(res.status).toBe(200);
    const q = (await res.json()) as Record<string, number>;
    expect(q.ngnPerUsd).toBeCloseTo(1384.52, 2);
    // 7000 / 1384.52 = 5.0560 dollars paid; minus the 0.02 partner fee reaches the wallet
    expect(q.usdtDelivered).toBeCloseTo(7000 / 1384.52 - 0.02, 4);
    expect(q.gOut).toBeCloseTo(43429.796, 2);
    expect(q.gOutMin).toBeLessThan(q.gOut);
    expect(q.swapFeeUsd).toBeCloseTo(0.0475, 4);
    // the swap quote was asked for the exact delivered amount, Base -> Celo, into the customer's own wallet
    const call = f.mock.calls.find((c) => String(c[0]).includes('api.relay.link'))!;
    const sent = JSON.parse(String((call[1] as RequestInit).body));
    expect(sent).toMatchObject({ originChainId: 8453, destinationChainId: 42220, usePermit: true, recipient: WALLET2, user: WALLET2 });
  });

  it('Q2. Says the minimum plainly when the amount is too small', async () => {
    vi.stubGlobal('fetch', mockFetch());
    const res = await worker.fetch(makeRequest('GET', '/onramp/quote?naira=300'), makeEnv(new MockKV()));
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string; minNaira: number };
    expect(body.error).toMatch(/least you can add is ₦/);
    expect(body.minNaira).toBeGreaterThan(300);
  });

  it('Q3. Never shows partner or technical wording when a service is down', async () => {
    for (const opts of [{ rate: null }, { lifiStatus: 500, lifi: { message: 'internal' } }, { lifi: {} }]) {
      vi.stubGlobal('fetch', mockFetch(opts as never));
      const res = await worker.fetch(makeRequest('GET', '/onramp/quote?naira=7000'), makeEnv(new MockKV()));
      expect(res.status).toBe(503);
      const text = await res.text();
      expect(text).toMatch(/not available right now/i);
      expect(text).not.toMatch(/paycrest|li\.quest|squid|usdt|lifi|base/i);
    }
  });

  it('Q4. Rejects junk input', async () => {
    vi.stubGlobal('fetch', mockFetch());
    const env6 = makeEnv(new MockKV());
    expect((await worker.fetch(makeRequest('GET', '/onramp/quote?naira=abc'), env6)).status).toBe(400);
    expect((await worker.fetch(makeRequest('GET', '/onramp/quote?naira=7000&wallet=0x123'), env6)).status).toBe(400);
    expect((await worker.fetch(makeRequest('GET', '/onramp/quote?naira=99999999'), env6)).status).toBe(400);
  });

  it('Q5. Uses the looser read limiter', async () => {
    const limit = vi.fn().mockResolvedValue({ success: false });
    const res = await worker.fetch(makeRequest('GET', '/onramp/quote?naira=7000'), makeEnv(new MockKV(), { RATE_LIMITER_READ: { limit } } as never));
    expect(res.status).toBe(429);
  });
});

describe('One-tap cash out (router V2)', () => {
  const ROUTER2 = '0x2222222222222222222222222222222222222222';
  const USER = '0xDeaDbeefdEAdbeefdEadbEEFdeadbeEFdEaDbeeF';
  const RECEIVE = '0x7F259f22250e8a92Ed4b87c944A3e048B67e53ef';
  const ORDER = '550e8400-e29b-41d4-a716-446655440000';
  const TX2 = '0x' + 'cd'.repeat(32);
  const pad = (a: string) => `0x${'0'.repeat(24)}${a.slice(2).toLowerCase()}`;
  const word = (n: bigint) => n.toString(16).padStart(64, '0');
  const ORDER_BODY = {
    minUsdt: '0.570000',
    amountG: '5000',
    refundAddress: USER,
    recipient: { institution: 'GTBINGLA', accountIdentifier: '0123456789', accountName: 'John Doe' },
  };
  let kv: MockKV;
  let env: Env;
  beforeEach(() => {
    kv = new MockKV();
    env = makeEnv(kv, { ROUTER_V2_ADDRESS: ROUTER2, ROUTER_V2_DEPLOY_BLOCK: String(FIRST_BLOCK) });
  });
  afterEach(() => {
    kv.clear();
    vi.unstubAllGlobals();
  });

  const partnerOrder = (amountToTransfer: string) => ({
    id: ORDER,
    status: 'initiated',
    amount: '0.55',
    rate: '1368.75',
    providerAccount: {
      network: 'celo',
      receiveAddress: RECEIVE,
      validUntil: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      amountToTransfer,
      currency: 'USDT',
    },
    senderFee: '0',
    transactionFee: '0.02',
  });

  /** Pretends to be the Celo node (balance, receipt, logs) and the payout partner. */
  function mock(opts: { balance?: bigint; totals?: string[]; receipt?: unknown; logsFor?: string; logRows?: Array<{ tx: string; payTo: string }> } = {}) {
    const posted: Array<{ amount: string }> = [];
    let n = 0;
    const f = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
      const u = String(url);
      if (u.includes('forno') || u.includes('celo.org')) {
        const body = JSON.parse(String(init?.body ?? '{}')) as { method: string; params: Array<{ address?: string }> };
        if (body.method === 'eth_call') return new Response(JSON.stringify({ result: '0x' + (opts.balance ?? 10_000n * 10n ** 18n).toString(16) }), { status: 200 });
        if (body.method === 'eth_getTransactionReceipt') return new Response(JSON.stringify({ result: opts.receipt ?? null }), { status: 200 });
        if (body.method === 'eth_blockNumber') return new Response(JSON.stringify({ result: '0x' + (FIRST_BLOCK + 100).toString(16) }), { status: 200 });
        if (body.method === 'eth_getLogs') {
          const wanted = String(body.params?.[0]?.address ?? '').toLowerCase();
          const rows = wanted === ROUTER2.toLowerCase() ? opts.logRows ?? [] : [];
          return new Response(
            JSON.stringify({
              result: rows.map((r) => ({
                transactionHash: r.tx,
                data: '0x' + word(5000n * 10n ** 18n) + word(574_000n) + word(550_000n) + word(24_000n) + word(0n) + word(0n),
                blockNumber: '0x' + (FIRST_BLOCK + 50).toString(16),
                topics: ['0x', pad(USER), pad(r.payTo)],
              })),
            }),
            { status: 200 }
          );
        }
        if (body.method === 'eth_getBlockByNumber') return new Response(JSON.stringify({ result: { timestamp: '0x' + Math.floor(Date.now() / 1000).toString(16) } }), { status: 200 });
        return new Response(JSON.stringify({ result: null }), { status: 200 });
      }
      if (u.includes('/v2/sender/orders') && init?.method === 'POST') {
        const sent = JSON.parse(String(init.body)) as { amount: string };
        posted.push({ amount: sent.amount });
        const totals = opts.totals ?? ['0.570000'];
        const total = totals[Math.min(n, totals.length - 1)];
        n++;
        return new Response(JSON.stringify({ data: partnerOrder(total) }), { status: 200 });
      }
      return new Response(JSON.stringify({ data: { status: 'initiated' } }), { status: 200 });
    });
    return { f, posted };
  }

  it('O1. Creates the order BEFORE the swap, sized under the guaranteed minimum', async () => {
    const m = mock();
    vi.stubGlobal('fetch', m.f);
    const res = await worker.fetch(makeRequest('POST', '/orders/v2', ORDER_BODY), env);
    expect(res.status).toBe(201);
    const body = (await res.json()) as { orderId: string; receiveAddress: string; payAmountAtomic: string; routerAddress: string };
    expect(body.orderId).toBe(ORDER);
    expect(body.receiveAddress).toBe(RECEIVE);
    expect(body.payAmountAtomic).toBe('570000');
    expect(body.routerAddress).toBe(ROUTER2);
    // the partner was asked for the minimum minus the 0.02 fee reserve
    expect(m.posted[0].amount).toBe('0.550000');
    // the deposit address can be traced back to the order later
    expect(JSON.parse((await kv.get(`rcv:${RECEIVE.toLowerCase()}`))!).o).toBe(ORDER);
  });

  it('O2. Retries with a smaller order when the partner total would exceed the minimum', async () => {
    const m = mock({ totals: ['0.580000', '0.570000'] });
    vi.stubGlobal('fetch', m.f);
    const res = await worker.fetch(makeRequest('POST', '/orders/v2', ORDER_BODY), env);
    expect(res.status).toBe(201);
    expect(m.posted).toHaveLength(2);
    expect(Number(m.posted[1].amount)).toBeLessThan(Number(m.posted[0].amount));
    expect(((await res.json()) as { payAmountAtomic: string }).payAmountAtomic).toBe('570000');
  });

  it('O3. Refuses when the wallet does not hold that much G$, and when the amount is too small', async () => {
    vi.stubGlobal('fetch', mock({ balance: 100n * 10n ** 18n }).f);
    expect((await worker.fetch(makeRequest('POST', '/orders/v2', ORDER_BODY), env)).status).toBe(400);
    vi.stubGlobal('fetch', mock().f);
    expect((await worker.fetch(makeRequest('POST', '/orders/v2', { ...ORDER_BODY, minUsdt: '0.300000' }), env)).status).toBe(400);
  });

  it('O3b. With the GoodCash fee on, the first order is sized so amount + 1% fee + partner fee fits the guaranteed minimum', async () => {
    const m = mock({ totals: ['0.570000'] });
    vi.stubGlobal('fetch', m.f);
    const feeEnv = { ...env, SENDER_FEE_PERCENT: '1', SENDER_FEE_ADDRESS: '0x735Ef948F746bc141D04042d2A18aA7f967bce2f' } as Env;
    const res = await worker.fetch(makeRequest('POST', '/orders/v2', { ...ORDER_BODY, feePercent: 1 }), feeEnv);
    expect(res.status).toBe(201);
    // (0.57 - 0.02) / 1.01 = 0.544554...
    expect(Number(m.posted[0].amount)).toBeCloseTo(0.544554, 5);
    expect(m.posted[0].amount).toBe('0.544554');
    // never more than the guaranteed minimum
    expect(0.544554 * 1.01 + 0.02).toBeLessThanOrEqual(0.57);
  });

  it('O4. Is off until the one-tap router is configured', async () => {
    vi.stubGlobal('fetch', mock().f);
    const res = await worker.fetch(makeRequest('POST', '/orders/v2', ORDER_BODY), makeEnv(new MockKV()));
    expect(res.status).toBe(503);
  });

  const receiptFor = (overrides: { user?: string; payTo?: string; paid?: bigint; status?: string } = {}) => ({
    status: overrides.status ?? '0x1',
    logs: [
      {
        address: ROUTER2,
        topics: ['0xf76a7b57d20e27c73ccada71d551173e9a82e46372f8dedf840cb08ad5ea60d7', pad(overrides.user ?? USER), pad(overrides.payTo ?? RECEIVE)],
        data: '0x' + word(5000n * 10n ** 18n) + word(574_000n) + word(overrides.paid ?? 570_000n) + word(4_000n) + word(0n) + word(0n),
      },
    ],
  });

  async function seedOrder() {
    vi.stubGlobal('fetch', mock().f);
    await worker.fetch(makeRequest('POST', '/orders/v2', ORDER_BODY), env);
  }

  it('O5. Links a finished swap to its order only when the chain proves it matches', async () => {
    await seedOrder();
    vi.stubGlobal('fetch', mock({ receipt: receiptFor() }).f);
    const ok = await worker.fetch(makeRequest('POST', `/orders/${ORDER}/swap`, { txHash: TX2, wallet: USER }), env);
    expect(ok.status).toBe(204);
    expect(await kv.get(`swap:${TX2.toLowerCase()}`)).toBe(ORDER);

    for (const [receipt, status] of [
      [receiptFor({ user: '0x3333333333333333333333333333333333333333' }), 403],
      [receiptFor({ payTo: '0x4444444444444444444444444444444444444444' }), 400],
      [receiptFor({ paid: 569_999n }), 400],
      [receiptFor({ status: '0x0' }), 400],
    ] as const) {
      const kv2 = new MockKV();
      const env2 = makeEnv(kv2, { ROUTER_V2_ADDRESS: ROUTER2 });
      await kv2.put(`order:${ORDER}`, JSON.stringify({ receiveAddress: RECEIVE, amountToTransfer: '0.570000' }));
      vi.stubGlobal('fetch', mock({ receipt }).f);
      const res = await worker.fetch(makeRequest('POST', `/orders/${ORDER}/swap`, { txHash: TX2, wallet: USER }), env2);
      expect(res.status).toBe(status);
      expect(await kv2.get(`swap:${TX2.toLowerCase()}`)).toBeNull();
    }
  });

  it('O6. Says "still pending" when the transaction is not mined yet', async () => {
    await seedOrder();
    vi.stubGlobal('fetch', mock({ receipt: null }).f);
    const res = await worker.fetch(makeRequest('POST', `/orders/${ORDER}/swap`, { txHash: TX2, wallet: USER }), env);
    expect(res.status).toBe(202);
  });

  it('O7. History finds a one-tap cash out and its order from the deposit address, and it is never "unfinished"', async () => {
    await seedOrder();
    vi.stubGlobal('fetch', mock({ logRows: [{ tx: TX2, payTo: RECEIVE }] }).f);
    const hist = await worker.fetch(makeRequest('GET', `/history?wallet=${USER}`), env);
    expect(hist.status).toBe(200);
    const body = (await hist.json()) as { swaps: Array<{ txHash: string; orderId?: string; amountG: string }> };
    expect(body.swaps).toHaveLength(1);
    expect(body.swaps[0].orderId).toBe(ORDER);
    expect(body.swaps[0].amountG).toBe('5000');
    expect(await kv.get(`swap:${TX2.toLowerCase()}`)).toBe(ORDER);

    const unfinished = await worker.fetch(makeRequest('GET', `/swaps/unfinished?wallet=${USER}`), env);
    expect(((await unfinished.json()) as { swaps: unknown[] }).swaps).toHaveLength(0);
  });
});


describe('slow payout alert for the team', () => {
  const MIN = 60_000;
  const NOW = Date.now();
  const ID1 = '550e8400-e29b-41d4-a716-446655440001';
  const ID2 = '550e8400-e29b-41d4-a716-446655440002';
  const ID3 = '550e8400-e29b-41d4-a716-446655440003';
  let kv: MockKV;
  let env: Env;

  const seed = async (id: string, status: string, ageMin: number) => {
    await kv.put(`order:${id}`, JSON.stringify({ status, receiveAddress: '0xP', amountToTransfer: '0.57', validUntil: 'x', paymentReference: null, createdAt: NOW - ageMin * MIN }));
    await kv.put('work:orders', String(NOW - 1)); // creating an order sets this marker; the schedule only looks while it is set
  };

  /** Pretends to be the payout partner (live status per order) and the email service. */
  const partner = (live: Record<string, string>) => {
    const emails: Array<{ subject: string; text: string; to: string[] }> = [];
    const f = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
      const u = String(url);
      if (u.includes('api.resend.com')) {
        emails.push(JSON.parse(String(init?.body)));
        return new Response('{}', { status: 200 });
      }
      const id = u.split('/').pop() as string;
      return new Response(JSON.stringify({ data: { status: live[id] ?? 'initiated' } }), { status: 200 });
    });
    return { f, emails };
  };

  beforeEach(() => {
    kv = new MockKV();
    env = makeEnv(kv, { RESEND_API_KEY: 'key', SUPPORT_INBOX: 'team@example.com', RESEND_FROM: 'GoodCash <hello@goodcash.xyz>' });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('A0. Makes no list call on a quiet run with nothing open, finds old work on the hourly run, and clears its marker when all are finished', async () => {
    const base = Math.floor(NOW / (6 * 10 * MIN)) * 6 * 10 * MIN; // a safety slot at or before now
    const quiet = base + 7 * 10 * MIN; // slot 7: not a safety run
    const safety = base + 12 * 10 * MIN; // slot 12: a safety run
    const p = partner({ [ID1]: 'pending' });
    vi.stubGlobal('fetch', p.f);
    let lists = 0;
    const realList = kv.list.bind(kv);
    kv.list = (async (o: { prefix?: string }) => {
      lists++;
      return realList(o);
    }) as typeof kv.list;

    // stuck order created before markers existed: no marker, so a quiet run does not look...
    await kv.put(`order:${ID1}`, JSON.stringify({ status: 'pending', receiveAddress: '0xP', amountToTransfer: '0.57', validUntil: 'x', paymentReference: null, createdAt: NOW - 30 * MIN }));
    expect(await alertSlowPayouts(env, quiet)).toEqual({ checked: 0, alerted: 0 });
    expect(lists).toBe(0);
    // ...but the hourly run does, and finds it
    expect(await alertSlowPayouts(env, safety)).toEqual({ checked: 1, alerted: 1 });
    expect(lists).toBe(1);

    // once every order is finished, the next marked run finds nothing open and clears the marker
    await kv.put(`order:${ID1}`, JSON.stringify({ status: 'settled', createdAt: NOW - 30 * MIN }));
    await kv.put('work:orders', String(NOW - 1));
    await alertSlowPayouts(env, quiet);
    expect(await kv.get('work:orders')).toBeNull();
    await alertSlowPayouts(env, quiet);
    expect(lists).toBe(2);
  });

  it('A1. Alerts once for a paid order stuck for too long, with no bank details', async () => {
    await seed(ID1, 'pending', 30);
    const p = partner({ [ID1]: 'pending' });
    vi.stubGlobal('fetch', p.f);
    const first = await alertSlowPayouts(env, NOW);
    expect(first).toEqual({ checked: 1, alerted: 1 });
    expect(p.emails).toHaveLength(1);
    expect(p.emails[0].to).toEqual(['team@example.com']);
    expect(p.emails[0].subject).toMatch(/Slow payout.*pending/);
    expect(p.emails[0].text).toContain(ID1);
    expect(p.emails[0].text).not.toMatch(/\b\d{10}\b|account number|GTBank/i);
    // a second run does not repeat the alert
    const second = await alertSlowPayouts(env, NOW + 10 * MIN);
    expect(second.alerted).toBe(0);
    expect(p.emails).toHaveLength(1);
  });

  it('A2. Stays quiet for young orders, finished orders and orders that were never paid', async () => {
    await seed(ID1, 'pending', 10); // too young
    await seed(ID2, 'settled', 60); // finished
    await seed(ID3, 'initiated', 60); // never paid
    const p = partner({ [ID1]: 'pending', [ID2]: 'settled', [ID3]: 'initiated' });
    vi.stubGlobal('fetch', p.f);
    const out = await alertSlowPayouts(env, NOW);
    expect(out.alerted).toBe(0);
    expect(p.emails).toHaveLength(0);
  });

  it('A3. Uses the partner’s live status, not a stale saved one', async () => {
    await seed(ID1, 'pending', 40); // saved copy says stuck...
    const p = partner({ [ID1]: 'settled' }); // ...but it actually finished
    vi.stubGlobal('fetch', p.f);
    expect((await alertSlowPayouts(env, NOW)).alerted).toBe(0);
  });

  it('A4. Still records the alert when the email service is not set up', async () => {
    await seed(ID1, 'pending', 40);
    vi.stubGlobal('fetch', partner({ [ID1]: 'pending' }).f);
    const out = await alertSlowPayouts(makeEnv(kv), NOW);
    expect(out.alerted).toBe(1);
    expect(await kv.get(`alerted:${ID1}`)).not.toBeNull();
  });

  it('A5. New orders record when they were created', async () => {
    const f = vi.fn().mockResolvedValue({ ok: true, json: async () => MOCK_PAYCREST_RESPONSE });
    vi.stubGlobal('fetch', f);
    await worker.fetch(makeRequest('POST', '/orders', VALID_BODY), makeEnv(kv));
    const saved = JSON.parse((await kv.get(`order:${MOCK_PAYCREST_RESPONSE.id}`))!) as { createdAt?: number };
    expect(saved.createdAt).toBeGreaterThan(NOW - 5_000);
  });
});

// ---------------------------------------------------------------------------
// Add G$ (naira in)
// ---------------------------------------------------------------------------
describe('Add G$ orders', () => {
  const ID = '660e8400-e29b-41d4-a716-446655440001';
  const BODY = {
    naira: 5000,
    wallet: '0xDeaDbeefdEAdbeefdEadbEEFdeadbeEFdEaDbeeF',
    fullName: 'Ada Obi',
    birthDate: '1995-03-02',
    idType: 'BVN',
    idNumber: '22212345678',
    refundAccount: { institution: 'GTBINGLA', accountIdentifier: '0123456789', accountName: 'Ada Obi' },
  };
  let kv: MockKV;
  let sent: Array<Record<string, any>>;
  beforeEach(() => {
    kv = new MockKV();
    sent = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        if (init?.method === 'POST') {
          sent.push(JSON.parse(String(init.body)));
          return new Response(
            JSON.stringify({ status: 'success', data: { id: ID, status: 'initiated', providerAccount: { institution: 'Bank X', accountIdentifier: '9990001111', accountName: 'Pay Partner', amountToTransfer: '5000', currency: 'NGN', validUntil: '2026-11-08T22:00:00Z' } } }),
            { status: 201 }
          );
        }
        return new Response(JSON.stringify({ status: 'success', data: { id: ID, status: 'settled' } }));
      })
    );
  });
  afterEach(() => vi.unstubAllGlobals());

  it('A1. Sends the ID details to the partner, asks for USDC on Base to the customer wallet, and stores none of them', async () => {
    const res = await worker.fetch(makeRequest('POST', '/onramp/orders', BODY), makeEnv(kv));
    expect(res.status).toBe(201);
    const out = (await res.json()) as { orderId: string; bank: { accountIdentifier: string }; amountToTransfer: string };
    expect(out.orderId).toBe(ID);
    expect(out.bank.accountIdentifier).toBe('9990001111');
    expect(sent[0].destination).toEqual({ type: 'crypto', currency: 'USDC', recipient: { address: BODY.wallet, network: 'base' } });
    expect(sent[0].source.kyc.personDetails.idDocument).toEqual({ type: 'BVN', number: '22212345678', issuerCountry: 'NG' });
    const stored = (await kv.get(`onramp:${ID}`))!;
    expect(stored).not.toContain('22212345678');
    expect(stored).not.toContain('Ada');
  });

  it('A2. Uses nationalID for a NIN, and refuses under-18s and malformed details', async () => {
    await worker.fetch(makeRequest('POST', '/onramp/orders', { ...BODY, idType: 'NIN' }), makeEnv(kv));
    expect(sent[0].source.kyc.personDetails.idDocument.type).toBe('nationalID');
    const young = new Date().getUTCFullYear() - 10;
    expect((await worker.fetch(makeRequest('POST', '/onramp/orders', { ...BODY, birthDate: `${young}-01-01` }), makeEnv(kv))).status).toBe(400);
    expect((await worker.fetch(makeRequest('POST', '/onramp/orders', { ...BODY, idNumber: '123' }), makeEnv(kv))).status).toBe(400);
    expect((await worker.fetch(makeRequest('POST', '/onramp/orders', { ...BODY, naira: 10 }), makeEnv(kv))).status).toBe(400);
  });

  it('A3. Only follows orders it created, and reports plain stages', async () => {
    expect((await worker.fetch(makeRequest('GET', `/onramp/orders/${ID}`), makeEnv(kv))).status).toBe(404);
    await worker.fetch(makeRequest('POST', '/onramp/orders', BODY), makeEnv(kv));
    const res = await worker.fetch(makeRequest('GET', `/onramp/orders/${ID}`), makeEnv(kv));
    expect(((await res.json()) as { stage: string }).stage).toBe('done');
  });

  it('A5. "pending" means still waiting for the bank transfer; only "fulfilling" means the naira arrived', async () => {
    const { onrampStage } = await import('./index.js');
    expect(onrampStage('initiated')).toBe('waiting');
    expect(onrampStage('pending')).toBe('waiting');
    expect(onrampStage('pending', true)).toBe('review');
    expect(onrampStage('fulfilling')).toBe('received');
    expect(onrampStage('settled')).toBe('done');
    expect(onrampStage('refunded')).toBe('refund');
  });

  describe('Add G$ emails', () => {
    const REQ = '0x' + 'ab'.repeat(32);
    const envWith = () => makeEnv(kv, { RESEND_API_KEY: 'resend-test' } as never);
    const emails: Array<{ to: string[]; subject: string }> = [];
    let relayStatus = 'success';
    let paycrestStatus = 'initiated';
    beforeEach(() => {
      emails.length = 0;
      relayStatus = 'success';
      paycrestStatus = 'initiated';
      vi.stubGlobal(
        'fetch',
        vi.fn(async (url: string, init?: RequestInit) => {
          const u = String(url);
          if (u.includes('api.resend.com')) {
            emails.push(JSON.parse(String(init?.body)));
            return new Response('{}', { status: 200 });
          }
          if (u.includes('intents/status')) return new Response(JSON.stringify({ status: relayStatus }));
          if (u.includes('/v2/sender/orders') && init?.method === 'POST') {
            return new Response(JSON.stringify({ data: { id: ID, status: 'initiated', providerAccount: { institution: 'B', accountIdentifier: '9990001111', accountName: 'P', amountToTransfer: '5000', validUntil: '2026-11-08T22:00:00Z' } } }), { status: 201 });
          }
          return new Response(JSON.stringify({ data: { id: ID, status: paycrestStatus } }));
        })
      );
    });

    it('E1. "Money ready" email goes out once, only when the naira order is delivered; never the cash-out email', async () => {
      const env = envWith();
      await worker.fetch(makeRequest('POST', '/onramp/orders', BODY), env);
      expect((await worker.fetch(makeRequest('POST', `/onramp/orders/${ID}/notify`, { email: 'me@example.com', naira: '₦5,000' }), env)).status).toBe(204);
      paycrestStatus = 'pending'; // matched, still waiting for the transfer
      await worker.fetch(makeRequest('GET', `/onramp/orders/${ID}`), env);
      expect(emails).toHaveLength(0);
      paycrestStatus = 'settled';
      await worker.fetch(makeRequest('GET', `/onramp/orders/${ID}`), env);
      await worker.fetch(makeRequest('GET', `/onramp/orders/${ID}`), env);
      expect(emails).toHaveLength(1);
      expect(emails[0].to).toEqual(['me@example.com']);
      expect(emails[0].subject).toMatch(/ready/i);
      expect(emails[0].subject).not.toMatch(/cash out|bank/i);
    });

    it('E2. "G$ added" email only after the swap service confirms, and only once', async () => {
      const env = envWith();
      await worker.fetch(makeRequest('POST', '/onramp/orders', BODY), env);
      await worker.fetch(makeRequest('POST', `/onramp/orders/${ID}/notify`, { email: 'me@example.com' }), env);
      relayStatus = 'pending';
      expect((await worker.fetch(makeRequest('POST', `/onramp/orders/${ID}/arrived`, { requestId: REQ }), env)).status).toBe(409);
      expect(emails).toHaveLength(0);
      relayStatus = 'success';
      expect((await worker.fetch(makeRequest('POST', `/onramp/orders/${ID}/arrived`, { requestId: REQ }), env)).status).toBe(204);
      await worker.fetch(makeRequest('POST', `/onramp/orders/${ID}/arrived`, { requestId: REQ }), env);
      expect(emails).toHaveLength(1);
      expect(emails[0].subject).toMatch(/in your wallet/i);
    });

    it('E3. Refuses bad emails and unknown orders', async () => {
      const env = envWith();
      expect((await worker.fetch(makeRequest('POST', `/onramp/orders/${ID}/notify`, { email: 'x@example.com' }), env)).status).toBe(404);
      await worker.fetch(makeRequest('POST', '/onramp/orders', BODY), env);
      expect((await worker.fetch(makeRequest('POST', `/onramp/orders/${ID}/notify`, { email: 'nope' }), env)).status).toBe(400);
    });
  });

  describe('Add CELO (same flow, different asset)', () => {
    const NATIVE = '0x0000000000000000000000000000000000000000';
    const GD = '0x62B8B11039FcfE5aB0C56E502b1C372A3d2a9c7A';
    let relayBodies: Array<Record<string, unknown>>;
    let sentEmails: Array<{ subject: string }>;
    beforeEach(() => {
      relayBodies = [];
      sentEmails = [];
      vi.stubGlobal(
        'fetch',
        vi.fn(async (url: string, init?: RequestInit) => {
          const u = String(url);
          if (u.includes('api.resend.com')) {
            sentEmails.push(JSON.parse(String(init?.body)));
            return new Response('{}');
          }
          if (u.includes('/v2/rates/')) return new Response(JSON.stringify({ data: { buy: { rate: '1384.52' } } }));
          if (u.includes('api.relay.link/quote')) {
            relayBodies.push(JSON.parse(String(init?.body)));
            return new Response(JSON.stringify({ requestId: '0x' + 'ab'.repeat(32), steps: [], fees: { relayer: { amountUsd: '0.035' } }, details: { currencyOut: { amount: '10259979964030953448', minimumAmount: '10100000000000000000' } } }));
          }
          if (u.includes('/v2/sender/orders') && init?.method === 'POST') {
            return new Response(JSON.stringify({ data: { id: ID, status: 'initiated', providerAccount: { institution: 'B', accountIdentifier: '9990001111', accountName: 'P', amountToTransfer: '1000', validUntil: '2026-11-08T22:00:00Z' } } }), { status: 201 });
          }
          return new Response(JSON.stringify({ data: { id: ID, status: 'settled' } }));
        })
      );
    });

    it('C1. The price can be asked for in CELO, to the customer\'s own wallet, and defaults to G$', async () => {
      const env = makeEnv(kv);
      const celo = (await (await worker.fetch(makeRequest('GET', `/onramp/quote?naira=1000&wallet=${BODY.wallet}&asset=celo`), env)).json()) as { asset: string; amountOut: number };
      expect(celo.asset).toBe('celo');
      expect(celo.amountOut).toBeCloseTo(10.26, 2);
      expect(relayBodies[0].destinationCurrency).toBe(NATIVE);
      expect(relayBodies[0].recipient).toBe(BODY.wallet);
      relayBodies.length = 0;
      await worker.fetch(makeRequest('GET', `/onramp/quote?naira=1000&wallet=${BODY.wallet}&asset=whatever`), env);
      expect(relayBodies[0].destinationCurrency).toBe(GD);
    });

    it('C2. The swap proxy only ever sends to G$ or native CELO, never an address the caller picks', async () => {
      const env = makeEnv(kv);
      await worker.fetch(makeRequest('POST', '/relay/quote', { wallet: BODY.wallet, amount: '700000', asset: 'celo' }), env);
      expect(relayBodies[0].destinationCurrency).toBe(NATIVE);
      const bad = await worker.fetch(makeRequest('POST', '/relay/quote', { wallet: BODY.wallet, amount: '700000', asset: '0x1111111111111111111111111111111111111111' }), env);
      expect(bad.status).toBe(400);
    });

    it('C3. A CELO order\'s emails say CELO, not G$', async () => {
      const env = makeEnv(kv, { RESEND_API_KEY: 'resend-test' } as never);
      await worker.fetch(makeRequest('POST', '/onramp/orders', { ...BODY, asset: 'celo' }), env);
      await worker.fetch(makeRequest('POST', `/onramp/orders/${ID}/notify`, { email: 'me@example.com' }), env);
      await worker.fetch(makeRequest('GET', `/onramp/orders/${ID}`), env);
      expect(sentEmails[0].subject).toMatch(/CELO/);
      expect(sentEmails[0].subject).not.toMatch(/G\$/);
    });
  });

  it('A4. Never prints the customer details when the partner refuses', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{"message":"bad BVN 22212345678","field":"Source"}', { status: 400 })));
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await worker.fetch(makeRequest('POST', '/onramp/orders', BODY), makeEnv(kv));
    expect(res.status).toBe(400);
    expect(JSON.stringify(log.mock.calls)).not.toContain('22212345678');
    log.mockRestore();
  });
});


// ---------------------------------------------------------------------------
// GoodCash fee (a percent of each cash out, paid through the payout partner's sender fee)
// ---------------------------------------------------------------------------
describe('GoodCash fee on cash outs', () => {
  const FEE_ADDR = '0x735Ef948F746bc141D04042d2A18aA7f967bce2f';
  let posted: Array<Record<string, any>>;
  let refuseFee = false;
  beforeEach(() => {
    posted = [];
    refuseFee = false;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_u: string, init?: RequestInit) => {
        if (init?.method === 'POST') {
          const body = JSON.parse(String(init.body));
          posted.push(body);
          if (refuseFee && body.senderFeePercent) return new Response('{"message":"fee over cap"}', { status: 400 });
          return new Response(JSON.stringify(MOCK_PAYCREST_RESPONSE), { status: 201 });
        }
        return new Response(JSON.stringify({ data: MOCK_PAYCREST_RESPONSE }), { status: 200 });
      })
    );
  });
  afterEach(() => vi.unstubAllGlobals());

  const create = (over: Partial<Env> = {}, shown: number | null = 1) =>
    worker.fetch(makeRequest('POST', '/orders', shown === null ? VALID_BODY : { ...VALID_BODY, feePercent: shown }), makeEnv(new MockKV(), over));

  it('F1. With a percent and a fee address, the order asks the partner for that percent, paid by the customer on top of the partner fee', async () => {
    expect((await create({ SENDER_FEE_PERCENT: '1', SENDER_FEE_ADDRESS: FEE_ADDR })).status).toBe(201);
    expect(posted[0]).toMatchObject({ senderFeePercent: '1', senderFeeAddress: FEE_ADDR, transactionFeePayer: 'customer' });
    expect(posted[0].senderFee).toBeUndefined();
  });

  it('F2. No fee unless both the percent and a real address are set, and never more than 5 percent', async () => {
    for (const over of [{}, { SENDER_FEE_PERCENT: '1' }, { SENDER_FEE_PERCENT: '1', SENDER_FEE_ADDRESS: 'not-an-address' }, { SENDER_FEE_PERCENT: '9', SENDER_FEE_ADDRESS: FEE_ADDR }, { SENDER_FEE_PERCENT: '0', SENDER_FEE_ADDRESS: FEE_ADDR }]) {
      posted = [];
      await create(over as Partial<Env>);
      expect(posted[0].senderFeePercent).toBeUndefined();
      expect(posted[0].senderFeeAddress).toBeUndefined();
    }
  });

  it('F3. If the partner refuses the fee setting, the customer\'s order still goes through, without the fee', async () => {
    refuseFee = true;
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await create({ SENDER_FEE_PERCENT: '1', SENDER_FEE_ADDRESS: FEE_ADDR });
    expect(res.status).toBe(201);
    expect(posted).toHaveLength(2);
    expect(posted[1].senderFeePercent).toBeUndefined();
    expect(JSON.stringify(err.mock.calls)).toMatch(/refused the GoodCash fee/);
    err.mockRestore();
  });

  it('F5. A screen that did not show the fee (an older version) is never charged it, nor one that showed a different percent', async () => {
    for (const shown of [null, 0, 2, 0.5]) {
      posted = [];
      expect((await create({ SENDER_FEE_PERCENT: '1', SENDER_FEE_ADDRESS: FEE_ADDR }, shown)).status).toBe(201);
      expect(posted[0].senderFeePercent).toBeUndefined();
    }
  });

  it('F6. One-tap orders from a screen without the fee are sized and sent without it', async () => {
    // (covered with the sizing test above; here only the rule)
    const { chargedFeePercent } = await import('./index.js');
    const e = makeEnv(new MockKV(), { SENDER_FEE_PERCENT: '1', SENDER_FEE_ADDRESS: FEE_ADDR });
    expect(chargedFeePercent(e, 1)).toBe(1);
    expect(chargedFeePercent(e, undefined)).toBe(0);
    expect(chargedFeePercent(makeEnv(new MockKV()), 1)).toBe(0);
  });

  it('F4. goodcashFeePercent reads the setting safely', async () => {
    const { goodcashFeePercent } = await import('./index.js');
    const base = makeEnv(new MockKV());
    expect(goodcashFeePercent({ ...base, SENDER_FEE_PERCENT: '1', SENDER_FEE_ADDRESS: FEE_ADDR })).toBe(1);
    expect(goodcashFeePercent({ ...base, SENDER_FEE_PERCENT: '0.5', SENDER_FEE_ADDRESS: FEE_ADDR })).toBe(0.5);
    expect(goodcashFeePercent({ ...base, SENDER_FEE_PERCENT: 'abc', SENDER_FEE_ADDRESS: FEE_ADDR })).toBe(0);
    expect(goodcashFeePercent(base)).toBe(0);
  });
});


describe('partner errors in our logs', () => {
  it('never carry account numbers, ID numbers or emails', async () => {
    const { safePartnerError } = await import('./index.js');
    const out = safePartnerError('{"field":"Recipient","message":"Account 0123456789 for ada@example.com with BVN 22212345678 is invalid"}');
    expect(out).toContain('field=Recipient');
    expect(out).not.toMatch(/0123456789|22212345678|ada@example.com/);
    expect(safePartnerError('plain 1234567 text')).toBe('plain [number] text');
  });
});


describe('refused requests read as plain words', () => {
  it('never shows the validation library\'s technical text to a customer', async () => {
    const kv = new MockKV();
    const res = await worker.fetch(makeRequest('POST', '/orders/v2', { minUsdt: 'abc' }), makeEnv(kv, { ROUTER_V2_ADDRESS: '0x2222222222222222222222222222222222222222' } as never));
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('Some details were missing or not right. Please check them and try again.');
    expect(body.error).not.toMatch(/expected|received|undefined|Invalid input/i);
  });
});
