/**
 * Live keys by email link: the queue, the one-time page, and that the keys are never kept in the clear.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import worker from '../index';
import type { Env } from '../index';
import { sha256Hex } from './auth';
import { LIVE_QUEUE_KEY, processLiveApprovals } from './liveKeys';
import type { Partner } from './types';

class MockKV {
  store = new Map<string, string>();
  ttl = new Map<string, number | undefined>();
  async get(k: string) {
    return this.store.get(k) ?? null;
  }
  async put(k: string, v: string, o?: { expirationTtl?: number }) {
    this.store.set(k, v);
    this.ttl.set(k, o?.expirationTtl);
  }
  async delete(k: string) {
    this.store.delete(k);
  }
}

const DOCS = 'https://pay.goodcash.xyz';
const PARTNER: Partner = {
  id: 'p_abc',
  name: 'Acme Games',
  enabled: true,
  allowedOrigins: ['https://acme.example'],
  appIds: [],
  feePercent: 0,
  contactEmail: 'dev@acme.example',
  selfServe: true,
  createdAt: 1,
};

let kv: MockKV;
let env: Env;
let mails: Array<{ to: string[]; subject: string; text: string }>;
let mailOk: boolean;

const queue = (...ids: string[]) => kv.put(LIVE_QUEUE_KEY, JSON.stringify(ids.map((id) => ({ id, at: 1, tries: 0 }))));
const confirm = (token: string, origin: string | null = DOCS) => {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (origin) headers.Origin = origin;
  return worker.fetch(new Request('https://api.goodcash.xyz/v1/live-keys/confirm', { method: 'POST', headers, body: JSON.stringify({ token }) }), env);
};
const linkToken = () => /#([A-Za-z0-9]{40})/.exec(mails.find((m) => m.to[0] === 'dev@acme.example')!.text)![1];

beforeEach(async () => {
  kv = new MockKV();
  mails = [];
  mailOk = true;
  env = {
    PAYCREST_API_KEY: 'k',
    PAYCREST_API_SECRET: 's',
    PAYCREST_BASE_URL: 'https://api.paycrest.io',
    ORDER_STORE: kv as unknown as KVNamespace,
    ALLOWED_ORIGINS: 'https://goodcash.xyz',
    RATE_LIMIT_MAX: '0',
    PARTNER_API_ENABLED: 'true',
    PARTNER_SECRETS_KEY: btoa(String.fromCharCode(...new Uint8Array(32).fill(7))),
    RESEND_API_KEY: 'resend',
    SUPPORT_INBOX: 'team@goodcash.example',
  } as Env;
  await kv.put('partner:p_abc', JSON.stringify(PARTNER));
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

describe('live keys by email link', () => {
  it('does nothing and reads one key when nobody is waiting', async () => {
    expect(await processLiveApprovals(env)).toEqual({ issued: 0, waiting: 0 });
    expect(mails).toHaveLength(0);
  });

  it('emails the partner a one-time link, and the link shows the live keys once', async () => {
    await queue('p_abc');
    expect(await processLiveApprovals(env)).toEqual({ issued: 1, waiting: 0 });
    const toPartner = mails.find((m) => m.to[0] === 'dev@acme.example')!;
    expect(toPartner.text).toContain(`${DOCS}/docs/get-live-keys/confirm/#`);
    expect(kv.store.has(LIVE_QUEUE_KEY)).toBe(false);

    const token = /#([A-Za-z0-9]{40})/.exec(toPartner.text)![1];
    const res = await confirm(token);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { mode: string; publishableKey: string; secretKey: string; allowedOrigins: string[] };
    expect(body.mode).toBe('live');
    expect(body.publishableKey).toMatch(/^gc_pk_live_[A-Za-z0-9]{40}$/);
    expect(body.secretKey).toMatch(/^gc_sk_live_[A-Za-z0-9]{40}$/);
    expect(body.allowedOrigins).toEqual(['https://acme.example']);

    // a second tap shows nothing
    expect((await confirm(token)).status).toBe(400);
  });

  it('stores only hashes: the keys and the link token are not in the store as text', async () => {
    await queue('p_abc');
    await processLiveApprovals(env);
    const token = linkToken();
    const body = (await (await confirm(token)).json()) as { publishableKey: string; secretKey: string };
    const everything = [...kv.store.entries()].flat().join('\n');
    expect(everything).not.toContain(body.secretKey);
    expect(everything).not.toContain(body.publishableKey);
    expect(everything).not.toContain(token);
    expect(kv.store.has(`key:${await sha256Hex(body.secretKey)}`)).toBe(true);
    const index = JSON.parse(kv.store.get('partnerkeys:p_abc')!) as Record<string, string>;
    expect(index.sk_live).toBe(await sha256Hex(body.secretKey));
  });

  it('holds the keys for 24 hours at most', async () => {
    await queue('p_abc');
    await processLiveApprovals(env);
    const key = `livereveal:${await sha256Hex(linkToken())}`;
    expect(kv.ttl.get(key)).toBe(86400);
  });

  it('only answers the GoodCash docs site', async () => {
    await queue('p_abc');
    await processLiveApprovals(env);
    const token = linkToken();
    expect((await confirm(token, 'https://evil.example')).status).toBe(403);
    expect((await confirm(token, null)).status).toBe(403);
    expect((await confirm('short')).status).toBe(400);
    expect((await confirm(token)).status).toBe(200); // the refused tries did not use it up
  });

  it('takes the new keys back and tries again next time when the email cannot be sent', async () => {
    mailOk = false;
    await queue('p_abc');
    expect(await processLiveApprovals(env)).toEqual({ issued: 0, waiting: 1 });
    expect([...kv.store.keys()].some((k) => k.startsWith('livereveal:'))).toBe(false);
    expect(kv.store.get('partnerkeys:p_abc')).toBe('{}');
    expect([...kv.store.keys()].filter((k) => k.startsWith('key:'))).toEqual([]);
    expect((JSON.parse(kv.store.get(LIVE_QUEUE_KEY)!) as Array<{ tries: number }>)[0].tries).toBe(1);

    mailOk = true;
    expect(await processLiveApprovals(env)).toEqual({ issued: 1, waiting: 0 });
  });

  it('gives up after six failed tries', async () => {
    mailOk = false;
    await queue('p_abc');
    for (let i = 0; i < 6; i++) await processLiveApprovals(env);
    expect(kv.store.has(LIVE_QUEUE_KEY)).toBe(false);
  });

  it('never makes a second set of live keys, and skips partners without a contact email', async () => {
    await queue('p_abc');
    await processLiveApprovals(env);
    mails.length = 0;
    await queue('p_abc');
    expect(await processLiveApprovals(env)).toEqual({ issued: 0, waiting: 0 });
    expect(mails).toHaveLength(0);

    await kv.put('partner:p_nomail', JSON.stringify({ ...PARTNER, id: 'p_nomail', contactEmail: undefined }));
    await queue('p_nomail');
    expect(await processLiveApprovals(env)).toEqual({ issued: 0, waiting: 0 });
  });

  it('keeps a partner approved while a run is working', async () => {
    await kv.put('partner:p_two', JSON.stringify({ ...PARTNER, id: 'p_two', contactEmail: 'two@acme.example' }));
    await queue('p_abc', 'p_two');
    expect(await processLiveApprovals(env)).toEqual({ issued: 2, waiting: 0 });
    expect(mails.filter((m) => m.subject === 'Your GoodCash live keys are ready').map((m) => m.to[0]).sort()).toEqual(['dev@acme.example', 'two@acme.example']);
  });

  it('is off with the rest of the partner API', async () => {
    env.PARTNER_API_ENABLED = undefined;
    expect((await confirm('a'.repeat(40))).status).toBe(404);
  });
});
