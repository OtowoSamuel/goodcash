// After a website deploy, checks that every file in dist/ is really being served (not the home page in its place).
// A half-uploaded deploy leaves some script files missing; the page then loads, but the wallet panel and other
// on-demand parts fail on phones. Run it from apps/web:   node scripts/verify-deploy.mjs https://goodcash.xyz
import { readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const base = (process.argv[2] || 'https://goodcash.xyz').replace(/\/$/, '');
const root = join(fileURLToPath(new URL('.', import.meta.url)), '..', 'dist');

function walk(dir) {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

const files = walk(root)
  .map((p) => relative(root, p).split(sep).join('/'))
  .filter((p) => /\.(js|css|wasm)$/.test(p));
// Docs pages (widget site): each must come back as its own page, not the widget's home page
const docPages = walk(root)
  .map((p) => relative(root, p).split(sep).join('/'))
  .filter((p) => /^docs\/(.*\/)?index\.html$/.test(p));

const bad = [];
let next = 0;
async function worker() {
  while (next < files.length) {
    const f = files[next++];
    try {
      const res = await fetch(`${base}/${f}?verify=${Date.now()}`, { method: 'GET' });
      const type = res.headers.get('content-type') || '';
      await res.arrayBuffer();
      if (!res.ok || type.includes('text/html')) bad.push(`${f} (${res.status}, ${type || 'no type'})`);
    } catch (e) {
      bad.push(`${f} (${e.message})`);
    }
  }
}
await Promise.all(Array.from({ length: 8 }, worker));
for (const f of docPages) {
  const url = `${base}/${f.replace(/index\.html$/, '')}`;
  try {
    const res = await fetch(`${url}?verify=${Date.now()}`);
    const text = await res.text();
    if (!res.ok || !text.includes('Partner docs')) bad.push(`${f} (${res.status}, not the docs page)`);
  } catch (e) {
    bad.push(`${f} (${e.message})`);
  }
}

if (bad.length) {
  console.error(`NOT SERVED: ${bad.length} problem(s)`);
  for (const b of bad) console.error('  ' + b);
  process.exit(1);
}
console.log(`OK: all ${files.length} files and ${docPages.length} docs pages are being served from ${base}`);
