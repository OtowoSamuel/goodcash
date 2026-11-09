// @vitest-environment node
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// The docs website is built from docs/partners by scripts/build-docs.mjs
const script = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../scripts/build-docs.mjs');
const OUT = path.resolve(path.dirname(script), '../apps/widget/public/docs');

async function docs() {
  return (await import(/* @vite-ignore */ script)) as {
    build: () => number;
    resolveLink: (href: string, from: string) => string;
    PAGES: Array<{ file: string; slug: string; title: string }>;
  };
}

function htmlFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = path.join(dir, n);
    return statSync(p).isDirectory() ? htmlFiles(p) : p.endsWith('.html') ? [p] : [];
  });
}

describe('partner docs website', () => {
  it('sends links between docs pages to their web addresses, and repository links to GitHub', async () => {
    const { resolveLink } = await docs();
    expect(resolveLink('quickstarts/game.md', 'README.md')).toBe('/docs/quickstarts/game/');
    expect(resolveLink('../errors.md#codes', 'quickstarts/game.md')).toBe('/docs/errors/#codes');
    expect(resolveLink('FEES.md', 'README.md')).toBe('/docs/fees/');
    expect(resolveLink('openapi.yaml', 'README.md')).toBe('/docs/openapi.yaml');
    expect(resolveLink('../../packages/sdk/README.md', 'README.md')).toBe('https://github.com/OtowoSamuel/goodcash/blob/main/packages/sdk/README.md');
    expect(resolveLink('../../examples', 'README.md')).toBe('https://github.com/OtowoSamuel/goodcash/tree/main/examples');
    expect(resolveLink('https://example.com/x', 'README.md')).toBe('https://example.com/x');
  });

  it('builds every page, and no link inside the site goes nowhere', async () => {
    const { build, PAGES } = await docs();
    expect(build()).toBeGreaterThanOrEqual(PAGES.length);
    const pages = htmlFiles(OUT);
    expect(pages.length).toBe(PAGES.length);
    const broken: string[] = [];
    for (const f of pages) {
      const html = readFileSync(f, 'utf8');
      for (const m of html.matchAll(/href="(\/docs\/[^"#]*)/g)) {
        const target = path.join(OUT, m[1].replace(/^\/docs\/?/, ''));
        const ok = existsSync(target) && (statSync(target).isFile() || existsSync(path.join(target, 'index.html')));
        if (!ok) broken.push(`${path.relative(OUT, f)} -> ${m[1]}`);
      }
    }
    expect(broken).toEqual([]);
  });

  it('keeps internal planning documents off the website', async () => {
    const { PAGES } = await docs();
    for (const p of PAGES) expect(p.file).not.toMatch(/PLAN|PHASE1|ONE_PAGER/i);
  });

  it('has a title, a page description and no scripts on every page', async () => {
    await docs().then((d) => d.build());
    for (const f of htmlFiles(OUT)) {
      const html = readFileSync(f, 'utf8');
      expect(html).toMatch(/<title>[^<]+<\/title>/);
      expect(html).toContain('name="description"');
      expect(html).not.toMatch(/<script/i);
    }
  });
});
