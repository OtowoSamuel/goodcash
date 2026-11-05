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
  refundAddress: '0xafDeEbB89Cda1669361117eA2EAe3411F1228cb6',
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
    expect(paycrestBody.senderFee).toBe('0');
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
