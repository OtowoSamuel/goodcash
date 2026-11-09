/**
 * Self-serve TEST keys: the email-confirmed sign-up, its protections, and that it can never hand out live keys.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import worker from '../index';
import type { Env } from '../index';
import { sha256Hex } from './auth';
import { checkOrigins } from './signup';
import type { Partner } from './types';

class MockKV {
  store = new Map<string, string>();
  ttl = new Map<string, number | undefined>();
  puts = 0;
  async get(k: string) {
    return this.store.get(k) ?? null;
  }
  async put(k: string, v: string, o?: { expirationTtl?: number }) {
    this.puts++;
    this.store.set(k, v);
    this.ttl.set(k, o?.expirationTtl);
  }
  async delete(k: string) {
    this.store.delete(k);
  }
  async list(opts: { prefix?: string } = {}) {
    return { keys: [...this.store.keys()].filter((k) => k.startsWith(opts.prefix ?? '')).map((name) => ({ name })), list_complete: true };
  }
}

const DOCS = 'https://pay.goodcash.xyz';
const FORM = { name: 'Acme Games', email: 'Dev@Acme.example', origins: ['https://acme.example'] };

let kv: MockKV;
let env: Env;
let mails: Array<{ to: string[]; subject: string; text: string; html: string }>;
let mailOk: boolean;
let limited: boolean;

function post(path: string, body: unknown, origin: string | null = DOCS, ip = '1.2.3.4') {
  const headers: Record<string, string> = { 'Content-Type': 'application/json', 'CF-Connecting-IP': ip };
  if (origin) headers.Origin = origin;
  return worker.fetch(new Request(`https://api.goodcash.xyz${path}`, { method: 'POST', headers, body: JSON.stringify(body) }), env);
}

function lastToken(): string {
  const m = /#([A-Za-z0-9]{40})/.exec(mails[mails.length - 1].text);
  if (!m) throw new Error('no confirmation link in the email');
  return m[1];
}

beforeEach(() => {
  kv = new MockKV();
  mails = [];
  mailOk = true;
  limited = false;
  env = {
    PAYCREST_API_KEY: 'k',
    PAYCREST_API_SECRET: 's',
    PAYCREST_BASE_URL: 'https://api.paycrest.io',
    ORDER_STORE: kv as unknown as KVNamespace,
    ALLOWED_ORIGINS: 'https://goodcash.xyz',
    RATE_LIMIT_MAX: '0',
    PARTNER_API_ENABLED: 'true',
    PARTNER_SIGNUP_ENABLED: 'true',
    RESEND_API_KEY: 'resend',
    RESEND_FROM: 'GoodCash <hello@goodcash.xyz>',
    SUPPORT_INBOX: 'team@goodcash.example',
    RATE_LIMITER_STRICT: { limit: async () => ({ success: !limited }) },
  } as Env;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      if (String(url).includes('api.resend.com')) {
        mails.push(JSON.parse(String(init?.body)));
        return new Response('{}', { status: mailOk ? 200 : 500 });
      }
      return new Response('{}', { status: 404 });
    })
  );
});
afterEach(() => vi.unstubAllGlobals());

describe('asking for test keys', () => {
  it('is off unless PARTNER_SIGNUP_ENABLED is "true"', async () => {
    env.PARTNER_SIGNUP_ENABLED = undefined;
    expect((await post('/v1/signup', FORM)).status).toBe(404);
    expect(mails).toHaveLength(0);
  });

  it('emails a confirmation link and creates nothing yet', async () => {
    const res = await post('/v1/signup', FORM);
    expect(res.status).toBe(200);
    expect(((await res.json()) as { status: string }).status).toBe('check_your_email');
    expect(mails).toHaveLength(1);
    expect(mails[0].to).toEqual(['dev@acme.example']);
    expect(mails[0].text).toContain(`${DOCS}/docs/get-test-keys/confirm/#`);
    expect([...kv.store.keys()].filter((k) => k.startsWith('partner:') || k.startsWith('key:'))).toEqual([]);
  });

  it('keeps the confirmation for one hour and stores only the token hash', async () => {
    await post('/v1/signup', FORM);
    const token = lastToken();
    const key = `signup:${await sha256Hex(token)}`;
    expect(kv.store.has(key)).toBe(true);
    expect(kv.ttl.get(key)).toBe(3600);
    expect([...kv.store.keys()].some((k) => k.includes(token))).toBe(false);
  });

  it('only answers the GoodCash docs site', async () => {
    expect((await post('/v1/signup', FORM, 'https://evil.example')).status).toBe(403);
    expect((await post('/v1/signup', FORM, null)).status).toBe(403);
    expect(mails).toHaveLength(0);
  });

  it('refuses bad names, emails and website addresses with a plain reason', async () => {
    for (const bad of [
      { ...FORM, name: 'A' },
      { ...FORM, email: 'not-an-email' },
      { ...FORM, origins: [] },
      { ...FORM, origins: ['http://acme.example'] },
      { ...FORM, origins: ['https://acme.example/path'] },
      { ...FORM, origins: ['https://a.example', 'https://b.example', 'https://c.example', 'https://d.example', 'https://e.example', 'https://f.example'] },
    ]) {
      const res = await post('/v1/signup', bad);
      expect(res.status).toBe(400);
    }
    expect(mails).toHaveLength(0);
  });

  it('allows http://localhost for development', () => {
    expect(checkOrigins(['http://localhost'])).toEqual(['http://localhost']);
    expect(() => checkOrigins(['http://example.com'])).toThrow();
  });

  it('sends one email per address per day, and answers the same either way', async () => {
    const a = await post('/v1/signup', FORM);
    const b = await post('/v1/signup', { ...FORM, email: 'DEV@acme.example' });
    expect(await a.json()).toEqual(await b.json());
    expect(mails).toHaveLength(1);
  });

  it('stops at the daily cap', async () => {
    env.PARTNER_SIGNUP_DAILY_CAP = '2';
    expect((await post('/v1/signup', { ...FORM, email: 'a@x.example' })).status).toBe(200);
    expect((await post('/v1/signup', { ...FORM, email: 'b@x.example' })).status).toBe(200);
    const third = await post('/v1/signup', { ...FORM, email: 'c@x.example' });
    expect(third.status).toBe(503);
    expect(JSON.stringify(await third.json())).toMatch(/full for today/);
    expect(mails).toHaveLength(2);
  });

  it('is rate limited per address', async () => {
    limited = true;
    expect((await post('/v1/signup', FORM)).status).toBe(429);
    expect(mails).toHaveLength(0);
  });

  it('forgets the request when the email cannot be sent, and does not use up the cap', async () => {
    mailOk = false;
    const res = await post('/v1/signup', FORM);
    expect(res.status).toBe(503);
    expect([...kv.store.keys()].filter((k) => k.startsWith('signup:'))).toEqual([]);
  });

  it('keeps writes small: three per request', async () => {
    await post('/v1/signup', FORM);
    expect(kv.puts).toBe(3);
  });
});

describe('confirming', () => {
  async function signedUp() {
    await post('/v1/signup', FORM);
    return lastToken();
  }

  it('creates the partner and returns TEST keys once', async () => {
    const token = await signedUp();
    const res = await post('/v1/signup/confirm', { token });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { partnerId: string; publishableKey: string; secretKey: string; mode: string; allowedOrigins: string[] };
    expect(body.mode).toBe('test');
    expect(body.publishableKey).toMatch(/^gc_pk_test_[A-Za-z0-9]{40}$/);
    expect(body.secretKey).toMatch(/^gc_sk_test_[A-Za-z0-9]{40}$/);
    expect(body.allowedOrigins).toEqual(['https://acme.example']);

    const partner = JSON.parse(kv.store.get(`partner:${body.partnerId}`) as string) as Partner;
    expect(partner).toMatchObject({ name: 'Acme Games', enabled: true, selfServe: true, contactEmail: 'dev@acme.example', feePercent: 0, appIds: [] });
  });

  it('never creates a live key', async () => {
    const token = await signedUp();
    const body = (await (await post('/v1/signup/confirm', { token })).json()) as { partnerId: string };
    const records = [...kv.store.entries()].filter(([k]) => k.startsWith('key:')).map(([, v]) => JSON.parse(v) as { mode: string; partnerId: string });
    expect(records).toHaveLength(2);
    expect(records.every((r) => r.mode === 'test' && r.partnerId === body.partnerId)).toBe(true);
    expect(JSON.parse(kv.store.get(`partnerkeys:${body.partnerId}`) as string)).not.toHaveProperty('pk_live');
  });

  it('stores only the key hashes, never the keys', async () => {
    const token = await signedUp();
    const body = (await (await post('/v1/signup/confirm', { token })).json()) as { publishableKey: string; secretKey: string };
    const everything = [...kv.store.values()].join('\n');
    expect(everything).not.toContain(body.publishableKey);
    expect(everything).not.toContain(body.secretKey);
    expect(kv.store.has(`key:${await sha256Hex(body.publishableKey)}`)).toBe(true);
  });

  it('works once: the same link cannot make a second partner', async () => {
    const token = await signedUp();
    expect((await post('/v1/signup/confirm', { token })).status).toBe(200);
    const again = await post('/v1/signup/confirm', { token });
    expect(again.status).toBe(400);
    expect([...kv.store.keys()].filter((k) => k.startsWith('partner:'))).toHaveLength(1);
  });

  it('refuses a link older than an hour', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-10T10:00:00Z'));
    const token = await signedUp();
    vi.setSystemTime(new Date('2026-11-10T11:01:00Z'));
    const res = await post('/v1/signup/confirm', { token });
    vi.useRealTimers();
    expect(res.status).toBe(400);
    expect([...kv.store.keys()].filter((k) => k.startsWith('partner:'))).toHaveLength(0);
  });

  it('refuses made-up tokens and other sites', async () => {
    expect((await post('/v1/signup/confirm', { token: 'x'.repeat(40) })).status).toBe(400);
    expect((await post('/v1/signup/confirm', { token: 'short' })).status).toBe(400);
    const token = await signedUp();
    expect((await post('/v1/signup/confirm', { token }, 'https://evil.example')).status).toBe(403);
  });

  it('the new test keys really work against the API, and the secret key stays out of browsers', async () => {
    const token = await signedUp();
    const keys = (await (await post('/v1/signup/confirm', { token })).json()) as { publishableKey: string; secretKey: string };
    const asBrowser = await worker.fetch(
      new Request('https://api.goodcash.xyz/v1/partner', { headers: { Authorization: `Bearer ${keys.publishableKey}`, Origin: 'https://acme.example' } }),
      env
    );
    expect(asBrowser.status).toBe(200);
    expect(((await asBrowser.json()) as { name: string }).name).toBe('Acme Games');
    const fromOtherSite = await worker.fetch(
      new Request('https://api.goodcash.xyz/v1/partner', { headers: { Authorization: `Bearer ${keys.publishableKey}`, Origin: 'https://other.example' } }),
      env
    );
    expect(fromOtherSite.status).toBe(403);
    const secretInBrowser = await worker.fetch(
      new Request('https://api.goodcash.xyz/v1/partner', { headers: { Authorization: `Bearer ${keys.secretKey}`, Origin: 'https://acme.example' } }),
      env
    );
    expect(secretInBrowser.status).toBe(403);
  });
});

describe('asking for live access', () => {
  async function partnerKeys() {
    await post('/v1/signup', FORM);
    const token = lastToken();
    mails.length = 0;
    return (await (await post('/v1/signup/confirm', { token })).json()) as { partnerId: string; secretKey: string; publishableKey: string };
  }
  const live = (key: string, origin: string | null = null) =>
    worker.fetch(new Request('https://api.goodcash.xyz/v1/live-access', { method: 'POST', headers: { Authorization: `Bearer ${key}`, ...(origin ? { Origin: origin } : {}) } }), env);

  it('emails GoodCash and records the request, once a day', async () => {
    const k = await partnerKeys();
    const a = await live(k.secretKey);
    expect(a.status).toBe(200);
    expect(((await a.json()) as { status: string }).status).toBe('requested');
    expect(mails).toHaveLength(1);
    expect(mails[0].to).toEqual(['team@goodcash.example']);
    expect(mails[0].text).toContain(`approve-live ${k.partnerId}`);
    const b = await live(k.secretKey);
    expect(((await b.json()) as { status: string }).status).toBe('already_requested');
    expect(mails).toHaveLength(1);
  });

  it('needs the secret key, and a self-serve account', async () => {
    const k = await partnerKeys();
    expect((await live(k.publishableKey, 'https://acme.example')).status).toBe(403);
    // a partner GoodCash created by hand is told to contact GoodCash instead
    const id = 'p_manual';
    await kv.put(`partner:${id}`, JSON.stringify({ id, name: 'Manual', enabled: true, allowedOrigins: [], appIds: [], feePercent: 0, createdAt: 1 }));
    const key = 'gc_sk_test_' + 'm'.repeat(32);
    await kv.put(`key:${await sha256Hex(key)}`, JSON.stringify({ partnerId: id, kind: 'sk', mode: 'test', createdAt: 1 }));
    expect((await live(key)).status).toBe(400);
  });
});
