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
    // five separators between six items: contract, GoodDollar, Paycrest, About, Privacy page, Terms, privacy notice
    expect((footer.match(/>·<\/span>/g) ?? []).length).toBeGreaterThanOrEqual(6);
  });
});
