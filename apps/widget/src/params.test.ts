import { describe, expect, it } from 'vitest';
import { checkHost, readParams, type WidgetParams } from './params';

const KEY = 'gc_pk_test_' + 'a'.repeat(32);
const SITE = 'https://game.example';
const p = (q: string) => readParams(q) as WidgetParams;

describe('widget address', () => {
  it('needs a publishable key (never a secret one)', () => {
    expect(readParams('?mode=popup')).toEqual({ error: 'missing_key' });
    expect(readParams(`?key=gc_sk_test_${'a'.repeat(32)}`)).toEqual({ error: 'missing_key' });
  });
  it('drops values that do not look right', () => {
    const r = p(`?key=${KEY}&amountG=12abc&ref=<x>&wallet=0x12&accent=red`);
    expect(r.amountG).toBeUndefined();
    expect(r.partnerRef).toBeUndefined();
    expect(r.wallet).toBeUndefined();
    expect(r.accent).toBeUndefined();
  });
});

describe('where the widget may run', () => {
  const env = { ancestorOrigin: null, referrerOrigin: null, framed: false };
  it('popup: only for an allowed site', () => {
    expect(checkHost(p(`?key=${KEY}&origin=${SITE}`), [SITE], env)).toBeNull();
    expect(checkHost(p(`?key=${KEY}&origin=https://evil.example`), [SITE], env)).toMatch(/allowed/);
    expect(checkHost(p(`?key=${KEY}`), [SITE], env)).toMatch(/origin/);
  });
  it('embed: the real page around the frame must be that site', () => {
    const q = p(`?key=${KEY}&mode=embed&origin=${SITE}`);
    expect(checkHost(q, [SITE], { ancestorOrigin: SITE, referrerOrigin: null, framed: true })).toBeNull();
    expect(checkHost(q, [SITE], { ancestorOrigin: null, referrerOrigin: SITE, framed: true })).toBeNull();
    expect(checkHost(q, [SITE], { ancestorOrigin: 'https://evil.example', referrerOrigin: SITE, framed: true })).toMatch(/not the allowed site/);
    expect(checkHost(q, [SITE], { ancestorOrigin: SITE, referrerOrigin: SITE, framed: false })).toMatch(/inside a frame/);
  });
  it('redirect: returnUrl must be an allowed site or an app link', () => {
    expect(checkHost(p(`?key=${KEY}&mode=redirect&returnUrl=${encodeURIComponent(SITE + '/done')}`), [SITE], env)).toBeNull();
    expect(checkHost(p(`?key=${KEY}&mode=redirect&returnUrl=${encodeURIComponent('mygame://cashout')}`), [SITE], env)).toBeNull();
    expect(checkHost(p(`?key=${KEY}&mode=redirect&returnUrl=${encodeURIComponent('https://evil.example/x')}`), [SITE], env)).toMatch(/allowed/);
    for (const bad of ['javascript://%0aalert(1)', 'javascript:alert(1)', 'data:text/html,hi', 'JaVaScRiPt://x', 'blob:https://x/1', 'mygame:nope']) {
      expect(checkHost(p(`?key=${KEY}&mode=redirect&returnUrl=${encodeURIComponent(bad)}`), [SITE], env)).toMatch(/allowed/);
    }
  });
});
