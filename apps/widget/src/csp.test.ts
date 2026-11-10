import { describe, expect, it } from 'vitest';
import { widgetCsp } from './csp';
import { BASE_RPCS } from './topup/chain';
import appHeaders from '../../web/public/_headers?raw';

const API = 'https://api.goodcash.xyz';

describe('widget security policy', () => {
  it('allows the wallet services (Magic, WalletConnect/Reown, Coinbase) and our API, nothing broader', () => {
    const csp = widgetCsp(API, "'none'");
    for (const must of ['https://*.magic.link', 'wss://*.walletconnect.org', 'https://*.reown.com', 'https://api.web3modal.org', 'https://verify.walletconnect.org', API, 'https://forno.celo.org']) {
      expect(csp).toContain(must);
    }
    expect(csp).not.toContain("'unsafe-eval'");
    expect(csp).not.toMatch(/(^|[ ;])\*($|[ ;])/);
    expect(csp).toContain("script-src 'self' 'wasm-unsafe-eval'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("base-uri 'none'");
  });
  it('allows every Base node the top-up step reads the customer balance from (a blocked read ends in a vague error)', () => {
    const csp = widgetCsp(API, "'none'");
    for (const url of BASE_RPCS) expect(csp).toContain(new URL(url).origin);
  });
  it('frame-ancestors is exactly what it is given (none by default, the partner sites when embedded)', () => {
    expect(widgetCsp(API, "'none'")).toContain("frame-ancestors 'none'");
    expect(widgetCsp(API, 'https://game.example https://www.game.example')).toContain('frame-ancestors https://game.example https://www.game.example;');
  });
  it('matches the GoodCash app for the wallet services, so one allow-list serves both', () => {
    const headers = appHeaders;
    const csp = widgetCsp(API, "'none'");
    for (const host of ['https://*.magic.link', 'https://*.reown.com', 'wss://*.walletconnect.com', 'https://*.coinbase.com', 'https://fonts.reown.com']) {
      expect(headers).toContain(host);
      expect(csp).toContain(host);
    }
  });
});
