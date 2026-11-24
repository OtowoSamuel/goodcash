import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { captureReferral, inviteLink, joinWithSavedReferral, refFromSearch, REF_KEY, savedReferral } from './referral';

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

describe('joinWithSavedReferral', () => {
  const ok = () => vi.fn(async () => new Response('{"ok":true}', { status: 200 }));

  it('tells the server once per wallet, with the saved link', async () => {
    localStorage.setItem(REF_KEY, A);
    const f = ok();
    await joinWithSavedReferral(B, f as unknown as typeof fetch);
    await joinWithSavedReferral(B, f as unknown as typeof fetch);
    expect(f).toHaveBeenCalledTimes(1);
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toMatch(/\/referral\/join$/);
    expect(JSON.parse(String(init.body))).toEqual({ wallet: B, ref: A });
  });

  it('does nothing without a saved link, or when the link is the wallet itself', async () => {
    const f = ok();
    await joinWithSavedReferral(B, f as unknown as typeof fetch);
    localStorage.setItem(REF_KEY, B);
    await joinWithSavedReferral(B, f as unknown as typeof fetch);
    expect(f).not.toHaveBeenCalled();
  });

  it('tries again next time when the server could not be reached, and never throws', async () => {
    localStorage.setItem(REF_KEY, A);
    const down = vi.fn(async () => {
      throw new Error('offline');
    });
    await expect(joinWithSavedReferral(B, down as unknown as typeof fetch)).resolves.toBeUndefined();
    const f = ok();
    await joinWithSavedReferral(B, f as unknown as typeof fetch);
    expect(f).toHaveBeenCalledTimes(1);
  });
});
