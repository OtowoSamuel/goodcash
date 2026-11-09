// Builds the partner docs website from docs/partners/*.md, so the web pages can never drift from the files.
// Output: apps/widget/public/docs/  (served at https://pay.goodcash.xyz/docs/). No scripts, no external requests.
//   node scripts/build-docs.mjs
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Marked } from 'marked';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(root, 'docs/partners');
const OUT = path.join(root, 'apps/widget/public/docs');
const REPO = 'https://github.com/OtowoSamuel/goodcash';
const SITE = '/docs';

/** Pages, in menu order. `file` is relative to docs/partners; `slug` is the web address under /docs/. */
export const PAGES = [
  { group: 'Start', file: 'README.md', slug: '', title: 'Overview' },
  { group: 'Start', file: 'test-mode.md', slug: 'test-mode', title: 'Test mode' },
  { group: 'Start', file: 'go-live.md', slug: 'go-live', title: 'Go-live checklist' },
  { group: 'Quickstarts', file: 'quickstarts/game.md', slug: 'quickstarts/game', title: 'Games' },
  { group: 'Quickstarts', file: 'quickstarts/react.md', slug: 'quickstarts/react', title: 'React apps' },
  { group: 'Quickstarts', file: 'quickstarts/react-native.md', slug: 'quickstarts/react-native', title: 'React Native' },
  { group: 'Quickstarts', file: 'quickstarts/fintech-server.md', slug: 'quickstarts/fintech-server', title: 'Fintech and servers' },
  { group: 'Quickstarts', file: 'quickstarts/ai-builder.md', slug: 'quickstarts/ai-builder', title: 'AI app builders' },
  { group: 'Reference', file: 'webhooks.md', slug: 'webhooks', title: 'Webhooks' },
  { group: 'Reference', file: 'errors.md', slug: 'errors', title: 'Errors' },
  { group: 'Reference', file: 'FEES.md', slug: 'fees', title: 'Fees' },
  { group: 'Reference', file: 'CHANGELOG.md', slug: 'changelog', title: 'Changelog' },
];
/** Files served as they are. */
export const RAW = ['openapi.yaml', 'llms.txt', 'llms-full.txt'];

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const urlFor = (page) => `${SITE}/${page.slug ? page.slug + '/' : ''}`;

/** Where a link written in a Markdown file should go on the website. */
export function resolveLink(href, fromFile) {
  if (!href || /^(https?:|mailto:|#)/i.test(href)) return href;
  const [target, hash = ''] = href.split('#');
  const frag = hash ? `#${hash}` : '';
  const abs = path.posix.normalize(path.posix.join(path.posix.dirname(fromFile), target));
  const page = PAGES.find((p) => p.file === abs);
  if (page) return urlFor(page) + frag;
  if (RAW.includes(abs)) return `${SITE}/${abs}`;
  // Anything else points into the repository (packages, examples): send it to GitHub
  const fromRepo = path.posix.normalize(path.posix.join('docs/partners', path.posix.dirname(fromFile), target));
  const isDir = !/\.[A-Za-z0-9]+$/.test(fromRepo);
  return `${REPO}/${isDir ? 'tree' : 'blob'}/main/${fromRepo.replace(/^\/+/, '')}`;
}

function render(markdown, fromFile) {
  const marked = new Marked({ gfm: true });
  marked.use({
    renderer: {
      link(href, title, text) {
        const to = resolveLink(href, fromFile);
        const external = /^https?:/i.test(to) && !to.startsWith('https://pay.goodcash.xyz');
        return `<a href="${esc(to)}"${title ? ` title="${esc(title)}"` : ''}${external ? ' rel="noopener noreferrer"' : ''}>${text}</a>`;
      },
      // Lets the headings be linked to
      heading(text, depth) {
        const id = text.replace(/<[^>]+>/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
        return `<h${depth} id="${id}">${text}</h${depth}>\n`;
      },
    },
  });
  return marked.parse(markdown);
}

const CSS = `
:root{--bg:#fff;--fg:#14111f;--mut:#5d5873;--line:#e6e2f2;--brand:#7b39fc;--soft:#f5f1ff;--code:#f3f1f8}
@media (prefers-color-scheme:dark){:root{--bg:#120e20;--fg:#f1eefb;--mut:#aaa3c4;--line:#2d2644;--brand:#a98bff;--soft:#1b1530;--code:#1d1733}}
*{box-sizing:border-box}html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.6 system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
a{color:var(--brand)}
header{border-bottom:1px solid var(--line);padding:14px 16px;display:flex;gap:12px;align-items:center;flex-wrap:wrap}
header b{font-size:18px}header span{color:var(--mut)}
.wrap{display:flex;gap:32px;max-width:1080px;margin:0 auto;padding:0 16px}
nav{width:220px;flex:none;padding:20px 0;font-size:15px}
nav h2{font-size:12px;letter-spacing:.06em;text-transform:uppercase;color:var(--mut);margin:18px 0 6px}
nav a{display:block;padding:4px 8px;border-radius:8px;text-decoration:none;color:var(--fg)}
nav a[aria-current=page]{background:var(--soft);color:var(--brand);font-weight:600}
main{min-width:0;flex:1;padding:20px 0 64px}
main h1{font-size:30px;line-height:1.2;margin:.2em 0 .6em}main h2{margin-top:2em;border-bottom:1px solid var(--line);padding-bottom:.2em}
table{border-collapse:collapse;display:block;overflow-x:auto;max-width:100%}th,td{border:1px solid var(--line);padding:8px 10px;text-align:left;vertical-align:top}th{background:var(--soft)}
code{background:var(--code);padding:.1em .35em;border-radius:6px;font-size:.92em}
pre{background:var(--code);padding:14px;border-radius:12px;overflow-x:auto}pre code{background:none;padding:0}
blockquote{margin:1em 0;padding:.2em 1em;border-left:4px solid var(--brand);background:var(--soft);border-radius:0 8px 8px 0}
li input[type=checkbox]{margin-right:8px}
@media (max-width:760px){.wrap{display:block}nav{width:auto;padding:12px 0;border-bottom:1px solid var(--line)}nav div{display:inline-block;margin-right:12px;vertical-align:top}}
`;

function nav(current) {
  const groups = [...new Set(PAGES.map((p) => p.group))];
  const parts = groups.map((g) => {
    const links = PAGES.filter((p) => p.group === g)
      .map((p) => `<a href="${urlFor(p)}"${p === current ? ' aria-current="page"' : ''}>${esc(p.title)}</a>`)
      .join('');
    return `<div><h2>${esc(g)}</h2>${links}</div>`;
  });
  const raw = `<div><h2>For tools</h2><a href="${SITE}/openapi.yaml">OpenAPI (YAML)</a><a href="${SITE}/llms.txt">llms.txt</a><a href="${SITE}/llms-full.txt">llms-full.txt</a></div>`;
  return `<nav aria-label="Documentation">${parts.join('')}${raw}</nav>`;
}

export function pageHtml(page, body) {
  const title = page.slug ? `${page.title} · GoodCash for Partners` : 'GoodCash for Partners';
  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="Let your users turn G$ into naira in their own Nigerian bank account. Documentation for GoodCash partners.">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<style>${CSS}</style>
</head><body>
<header><b>GoodCash</b><span>Partner docs</span></header>
<div class="wrap">${nav(page)}<main>${body}</main></div>
</body></html>
`;
}

export function build() {
  rmSync(OUT, { recursive: true, force: true });
  for (const page of PAGES) {
    const md = readFileSync(path.join(SRC, page.file), 'utf8');
    const dir = path.join(OUT, page.slug);
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, 'index.html'), pageHtml(page, render(md, page.file)));
  }
  for (const f of RAW) copyFileSync(path.join(SRC, f), path.join(OUT, f));
  return PAGES.length + RAW.length;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(`docs: wrote ${build()} files to apps/widget/public/docs`);
}
