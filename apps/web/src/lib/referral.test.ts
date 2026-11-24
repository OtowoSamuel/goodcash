import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { acceptInvite, buildJoinMessage, captureReferral, inviteHandled, inviteLink, refFromSearch, REF_KEY, savedReferral } from './referral';

const A = '0x2222222222222222222222222222222222222222';
const B = '0x3333333333333333333333333333333333333333';

beforeEach(() => {
  const data = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
    clear: () => data.clear(),
  });
});
afterEach(() => vi.unstubAllGlobals());

describe('refFromSearch', () => {
  it('reads an address and lowers it', () => {
    expect(refFromSearch(`?ref=${A.toUpperCase().replace('0X', '0x')}`)).toBe(A);
  });
  it('ignores anything else', () => {
    for (const s of ['', '?ref=', '?ref=hello', '?ref=0x12', `?x=${A}`]) expect(refFromSearch(s)).toBeNull();
  });
});

describe('captureReferral', () => {
  it('keeps the first link and never replaces it', () => {
    captureReferral(`?ref=${A}`);
    captureReferral(`?ref=${B}`);
    expect(localStorage.getItem(REF_KEY)).toBe(A);
  });
  it('saves nothing for a bad link', () => {
    captureReferral('?ref=oops');
    expect(localStorage.getItem(REF_KEY)).toBeNull();
  });
});

describe('savedReferral', () => {
  it('does not count your own link', () => {
    captureReferral(`?ref=${A}`);
    expect(savedReferral(A)).toBeNull();
    expect(savedReferral(B)).toBe(A);
  });
  it('is null when nothing was saved', () => {
    expect(savedReferral(B)).toBeNull();
  });
});

describe('inviteLink', () => {
  it('carries the wallet in lower case', () => {
    expect(inviteLink(A.toUpperCase().replace('0X', '0x'))).toBe(`https://goodcash.xyz/?ref=${A}`);
  });
});

/** Pinned word for word, and the same text is pinned in services/orders/src/referral.test.ts */
export const PINNED_JOIN = 'Accept a GoodCash invite.\n\nThis is free and sends no money.\n\nInvited by: 0x2222222222222222222222222222222222222222\nWallet: 0x3333333333333333333333333333333333333333\nIssued at: 2026-12-01T10:00:00Z';

describe('accepting an invite', () => {
  const T = Date.parse('2026-12-01T10:00:00.500Z');

  it('signs exactly the text the server checks', () => {
    expect(buildJoinMessage(B, A, T)).toBe(PINNED_JOIN);
  });

  it('asks the wallet to sign, sends the signature, and remembers it was handled', async () => {
    localStorage.setItem(REF_KEY, A);
    const provider = { request: vi.fn(async () => '0xsig') };
    const f = vi.fn(async () => Response.json({ ok: true }));
    expect(await acceptInvite(B, provider, f as unknown as typeof fetch, T)).toBe('joined');
    const call = provider.request.mock.calls[0] as unknown as [{ method: string; params: string[] }];
    expect(call[0].method).toBe('personal_sign');
    expect(call[0].params[1]).toBe(B);
    const body = JSON.parse(String((f.mock.calls[0] as unknown as [string, RequestInit])[1].body));
    expect(body).toEqual({ wallet: B, ref: A, signature: '0xsig', issuedAt: T });
    expect(inviteHandled(B)).toBe(true);
  });

  it('says when the invite does not apply, and lets a failure be tried again', async () => {
    localStorage.setItem(REF_KEY, A);
    const provider = { request: vi.fn(async () => '0xsig') };
    expect(await acceptInvite(B, provider, (async () => Response.json({ ok: false, reason: 'already_verified' })) as unknown as typeof fetch, T)).toBe('not_new');
    localStorage.removeItem('goodcash_ref_handled');
    expect(await acceptInvite(B, provider, (async () => Response.json({ ok: false, reason: 'error' })) as unknown as typeof fetch, T)).toBe('failed');
    expect(inviteHandled(B)).toBe(false);
  });

  it('passes on a cancel in the wallet', async () => {
    localStorage.setItem(REF_KEY, A);
    const provider = { request: vi.fn(async () => { throw Object.assign(new Error('User rejected'), { code: 4001 }); }) };
    await expect(acceptInvite(B, provider, vi.fn() as unknown as typeof fetch, T)).rejects.toMatchObject({ code: 4001 });
  });
});
