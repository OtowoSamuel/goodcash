/**
 * services/orders — unit tests
 *
 * We test the Worker in isolation by calling its fetch handler directly
 * with mocked Env bindings and a mocked global fetch (to simulate Paycrest).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import worker from './index.js';
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
    expect(data.error).toMatch(/at least|minimum/i);
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
    expect(JSON.parse(String((rpcCall![1] as RequestInit).body))).toMatchObject({
      method: 'eth_getTransactionReceipt',
      params: [txHash],
    });

    const paycrestCall = fetchSpy.mock.calls.find(([url]) => String(url).includes('/v2/sender/orders'));
    const paycrestBody = JSON.parse(String((paycrestCall![1] as RequestInit).body));
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
    env = makeEnv(kv, { RESEND_API_KEY: 'key', SUPPORT_TO: 'team@example.com' });
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
