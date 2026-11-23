const { chromium } = require('/Users/admin/Documents/GoodCash/node_modules/playwright-core');
const [,, sp, out] = process.argv;
(async () => {
  const b = await chromium.launch({ channel: 'chrome', headless: true });
  for (const [name, w, h] of [['wide', 1600, 900], ['square', 1080, 1080]]) {
    const p = await (await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2 })).newPage();
    await p.goto(`file://${sp}/poster-${name}.html`, { waitUntil: 'networkidle' });
    await p.evaluate(() => document.fonts.ready);
    const info = await p.evaluate(() => {
      const fonts = [...document.fonts].filter((f) => f.status === 'loaded').map((f) => f.family + ' ' + f.weight);
      const W = innerWidth, H = innerHeight, bad = [];
      const els = [...document.querySelectorAll('body *')];
      for (const e of els) { const r = e.getBoundingClientRect(); if (r.width && (r.left < 0 || r.top < 0 || r.right > W || r.bottom > H)) bad.push(e.className + ':' + e.textContent.slice(0, 20)); }
      const boxes = ['.head', '.sub', '.url', '.badge', '.top', ...[...document.querySelectorAll('.p')].map((_, i) => `.p:nth-of-type(${i})`)];
      const rect = (s) => document.querySelector(s)?.getBoundingClientRect();
      const blocks = [...document.querySelectorAll('.head,.sub,.url,.badge,.top,.p')].map((e) => ({ n: e.className.split(' ').pop() + (e.querySelector('.n') ? ':' + e.querySelector('.n').textContent : ''), r: e.getBoundingClientRect() }));
      const overlaps = [];
      for (let i = 0; i < blocks.length; i++) for (let j = i + 1; j < blocks.length; j++) { const a = blocks[i].r, c = blocks[j].r; if (a.left < c.right && c.left < a.right && a.top < c.bottom && c.top < a.bottom) overlaps.push(blocks[i].n + ' x ' + blocks[j].n); }
      return { fonts, offCanvas: bad, overlaps, head: Math.round(document.querySelector('.head').getBoundingClientRect().bottom), sub: Math.round(document.querySelector('.sub').getBoundingClientRect().top) };
    });
    console.log(name, JSON.stringify(info));
    await p.screenshot({ path: `${out}/goodcash-first-partners-${name}.png`, clip: { x: 0, y: 0, width: w, height: h } });
  }
  await b.close();
})();
