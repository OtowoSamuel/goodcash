import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import worker from './index.js';
import type { Env } from './index.js';
import { buildClaimMessage, FLOWSTATE_ELIGIBILITY_URL, parseRegisterBody, registerWithFlowState, VOTE_CHAIN_ID, VOTE_COUNCIL } from './vote';

const WALLET = '0xDeaDbeefdEAdbeefdEadbEEFdeadbeEFdEaDbeeF';
const SIG = `0x${'ab'.repeat(65)}`;
const NOW = Date.UTC(2026, 10, 19, 12, 0, 0, 789);

describe('buildClaimMessage', () => {
  it('is exactly the text Flow State expects, with the time cut to whole seconds and everything in lower case', () => {
    expect(buildClaimMessage({ chainId: 42220, councilId: '0x889E0AadAA3f8b28a794ef70da147827c620a590', address: WALLET, issuedAt: NOW })).toBe(
      [
        'Claim voting rights in this Flow Council.',
        '',
        'Council: 0x889e0aadaa3f8b28a794ef70da147827c620a590',
        'Chain: 42220',
        `Wallet: ${WALLET.toLowerCase()}`,
        'Issued at: 2026-11-19T12:00:00Z',
      ].join('\n'),
    );
  });
});

describe('parseRegisterBody', () => {
  const good = { address: WALLET, issuedAt: NOW, signature: SIG };
  it('accepts a normal request', () => {
    expect(parseRegisterBody(good, NOW)).toEqual(good);
  });
  it('accepts a longer smart-wallet signature', () => {
    expect(parseRegisterBody({ ...good, signature: `0x${'cd'.repeat(200)}` }, NOW)).not.toBeNull();
  });
  it('refuses anything not usable', () => {
    for (const bad of [
      null,
      {},
      { ...good, address: '0x123' },
      { ...good, address: undefined },
      { ...good, issuedAt: '2026' },
      { ...good, issuedAt: NaN },
      { ...good, signature: '0x1234' },
      { ...good, signature: 'ab'.repeat(65) },
      { ...good, signature: `0x${'zz'.repeat(65)}` },
      { ...good, signature: `0x${'ab'.repeat(65)}0` },
    ]) {
      expect(parseRegisterBody(bad, NOW)).toBeNull();
    }
  });
  it('refuses a message signed more than five minutes ago, or from well ahead of our clock', () => {
    expect(parseRegisterBody({ ...good, issuedAt: NOW - 5 * 60 * 1000 - 1 }, NOW)).toBeNull();
    expect(parseRegisterBody({ ...good, issuedAt: NOW - 4 * 60 * 1000 }, NOW)).not.toBeNull();
    expect(parseRegisterBody({ ...good, issuedAt: NOW + 61_000 }, NOW)).toBeNull();
    expect(parseRegisterBody({ ...good, issuedAt: NOW + 30_000 }, NOW)).not.toBeNull();
  });
});

describe('registerWithFlowState', () => {
  const input = { address: WALLET, issuedAt: NOW, signature: SIG };
  const answer = (status: number, body: unknown) => vi.fn(async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;

  it('sends the fixed council and chain to the one fixed address, whatever the customer asked for', async () => {
    const f = answer(200, { success: true });
    expect(await registerWithFlowState(input, f)).toEqual({ ok: true });
    const [url, init] = (f as unknown as { mock: { calls: Array<[string, RequestInit]> } }).mock.calls[0];
    expect(url).toBe(FLOWSTATE_ELIGIBILITY_URL);
    expect(JSON.parse(String(init.body))).toEqual({ address: WALLET, chainId: VOTE_CHAIN_ID, councilId: VOTE_COUNCIL, signature: SIG, issuedAt: NOW });
  });
  it('says when the wallet is not verified with GoodDollar', async () => {
    expect(await registerWithFlowState(input, answer(200, { success: false, notWhitelisted: true, error: 'Not whitelisted' }))).toEqual({ ok: false, reason: 'not_verified' });
  });
  it('says when the same person already voted from another wallet', async () => {
    expect(await registerWithFlowState(input, answer(200, { success: false, alreadyClaimed: true }))).toEqual({ ok: false, reason: 'other_wallet' });
  });
  it('says busy when Flow State is busy or the claim was contested', async () => {
    expect(await registerWithFlowState(input, answer(429, { success: false }))).toEqual({ ok: false, reason: 'busy' });
    expect(await registerWithFlowState(input, answer(409, { success: false }))).toEqual({ ok: false, reason: 'busy' });
  });
  it('says error for anything else, an unreadable answer, or no answer at all', async () => {
    expect(await registerWithFlowState(input, answer(200, { success: false, error: 'Invalid signature' }))).toEqual({ ok: false, reason: 'error' });
    expect(await registerWithFlowState(input, vi.fn(async () => new Response('<html>', { status: 502 })) as unknown as typeof fetch)).toEqual({ ok: false, reason: 'error' });
    expect(await registerWithFlowState(input, vi.fn(async () => { throw new Error('down'); }) as unknown as typeof fetch)).toEqual({ ok: false, reason: 'error' });
  });
});

describe('POST /vote/register', () => {
  let env: Env;
  let flowStateAnswer: { status: number; body: unknown };
  let sent: Array<{ url: string; body: string }>;
  const post = (body: unknown) =>
    worker.fetch(new Request('https://api.goodcash.xyz/vote/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }), env);

  beforeEach(() => {
    sent = [];
    flowStateAnswer = { status: 200, body: { success: true } };
    env = { ORDER_STORE: {} as KVNamespace, ALLOWED_ORIGINS: 'https://goodcash.xyz', RATE_LIMIT_MAX: '0' } as unknown as Env;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        sent.push({ url: String(url), body: String(init?.body) });
        return new Response(JSON.stringify(flowStateAnswer.body), { status: flowStateAnswer.status });
      }),
    );
  });
  afterEach(() => vi.unstubAllGlobals());

  const fresh = () => ({ address: WALLET, issuedAt: Date.now(), signature: SIG });

  it('registers and answers ok', async () => {
    const res = await post(fresh());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(sent).toHaveLength(1);
    expect(sent[0].url).toBe(FLOWSTATE_ELIGIBILITY_URL);
  });

  it('passes the not-verified answer back as a normal answer, not an error', async () => {
    flowStateAnswer = { status: 200, body: { success: false, notWhitelisted: true } };
    const res = await post(fresh());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: false, reason: 'not_verified' });
  });

  it('answers 503 when Flow State is busy and 502 when it fails', async () => {
    flowStateAnswer = { status: 429, body: {} };
    expect((await post(fresh())).status).toBe(503);
    flowStateAnswer = { status: 500, body: { error: 'boom' } };
    expect((await post(fresh())).status).toBe(502);
  });

  it('never calls Flow State for a request that is not usable', async () => {
    expect((await post({ ...fresh(), address: 'nope' })).status).toBe(400);
    expect((await post({ ...fresh(), issuedAt: Date.now() - 10 * 60 * 1000 })).status).toBe(400);
    const notJson = await worker.fetch(new Request('https://api.goodcash.xyz/vote/register', { method: 'POST', body: 'not json' }), env);
    expect(notJson.status).toBe(400);
    expect(sent).toHaveLength(0);
  });

  it('ignores a council or chain the customer tries to send', async () => {
    await post({ ...fresh(), chainId: 1, councilId: '0x0000000000000000000000000000000000000001' });
    expect(JSON.parse(sent[0].body)).toMatchObject({ chainId: VOTE_CHAIN_ID, councilId: VOTE_COUNCIL });
  });
});
