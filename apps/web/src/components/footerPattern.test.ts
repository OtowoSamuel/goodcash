import { describe, it, expect } from 'vitest';
import source from '../App.tsx?raw';

// A stray logo once ended up in the middle of the footer links. This keeps the footer to links and separators.
describe('page footer', () => {
  const footer = source.slice(source.indexOf('<footer'), source.indexOf('</footer>'));

  it('has no logo in it', () => {
    expect(footer.length).toBeGreaterThan(200);
    expect(footer).not.toMatch(/gc-logo/);
    expect(footer).not.toMatch(/>GoodCash<\/span>/);
  });

  it('shows each link once, with separators between all of them', () => {
    expect((footer.match(/href="\/about"/g) ?? []).length).toBe(1);
    expect((footer.match(/href="\/privacy"/g) ?? []).length).toBe(1);
    expect((footer.match(/href="\/terms"/g) ?? []).length).toBe(1);
    // four separators between five items: contract, GoodDollar, About, Privacy, Terms
    expect((footer.match(/>·<\/span>/g) ?? []).length).toBe(4);
  });

  it('names no payout partner and has no second privacy link', () => {
    expect(footer).not.toMatch(/paycrest/i);
    expect(footer).not.toMatch(/privacyLinkText/);
  });

  it('links the contract customers actually use', async () => {
    const { ROUTER_ADDRESS, BLOCKSCOUT_URL } = await import('./SafetyBanner');
    expect(BLOCKSCOUT_URL).toContain(ROUTER_ADDRESS);
    expect(ROUTER_ADDRESS).toMatch(/^0x[0-9a-fA-F]{40}$/);
  });
});
