import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { captureReferral, inviteLink, refFromSearch, REF_KEY, savedReferral } from './referral';

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
