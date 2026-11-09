/**
 * End to end, in a real browser, with nothing mocked on our side and no real money:
 *   the real worker (wrangler dev, local storage, test key)  <- http://localhost:8799
 *   the real widget build (VITE_API_BASE=local worker)      <- http://localhost:5199
 *   a partner page that loads widget.js                    <- http://localhost:5198 (allowed) / 5197 (not allowed)
 * Run: npm --workspace apps/widget run e2e
 */
import { spawn, execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { createHash, randomBytes } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const here = path.dirname(fileURLToPath(import.meta.url));
const WIDGET_DIR = path.resolve(here, '..');
const WORKER_DIR = path.resolve(here, '../../../services/orders');
const persist = mkdtempSync(path.join(tmpdir(), 'goodcash-e2e-'));
const procs = [];
const servers = [];
let failed = 0;

function log(...a) {
  console.log('[e2e]', ...a);
}
function check(cond, what) {
  if (cond) log('PASS', what);
  else {
    failed++;
    log('FAIL', what);
  }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(url, ms = 60_000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try {
      const r = await fetch(url);
      if (r.status < 500) return;
    } catch {}
    await sleep(500);
  }
  throw new Error(`timed out waiting for ${url}`);
}

const key = `gc_pk_test_${randomBytes(30).toString('base64').replace(/[^A-Za-z0-9]/g, '').slice(0, 32)}`;
const hash = createHash('sha256').update(key).digest('hex');
const liveKey = `gc_pk_live_${randomBytes(30).toString('base64').replace(/[^A-Za-z0-9]/g, '').slice(0, 32)}`;
const liveHash = createHash('sha256').update(liveKey).digest('hex');

function kvPut(k, v) {
  execFileSync('npx', ['wrangler', 'kv', 'key', 'put', k, JSON.stringify(v), '--binding', 'ORDER_STORE', '--local', '--persist-to', persist], { cwd: WORKER_DIR, stdio: 'ignore' });
}

async function main() {
  log('seeding a test partner in local storage');
  kvPut('partner:p_e2e', { id: 'p_e2e', name: 'Acme Game', enabled: true, allowedOrigins: ['http://localhost:5198'], appIds: [], feePercent: 0.5, createdAt: Date.now() });
  kvPut(`key:${hash}`, { partnerId: 'p_e2e', kind: 'pk', mode: 'test', createdAt: Date.now() });
  kvPut(`key:${liveHash}`, { partnerId: 'p_e2e', kind: 'pk', mode: 'live', createdAt: Date.now() });

  log('starting the worker');
  procs.push(
    spawn('npx', ['wrangler', 'dev', '--port', '8799', '--persist-to', persist, '--var', 'PARTNER_API_ENABLED:true', '--var', 'WIDGET_ORIGINS:http://localhost:5199', '--var', 'SENDER_FEE_PERCENT:1', '--var', 'SENDER_FEE_ADDRESS:0x735Ef948F746bc141D04042d2A18aA7f967bce2f'], { cwd: WORKER_DIR, stdio: 'ignore' })
  );
  log('building and serving the widget');
  execFileSync('npx', ['vite', 'build'], { cwd: WIDGET_DIR, stdio: 'ignore', env: { ...process.env, VITE_API_BASE: 'http://localhost:8799' } });
  procs.push(spawn('npx', ['vite', 'preview', '--port', '5199', '--strictPort'], { cwd: WIDGET_DIR, stdio: 'ignore' }));
  const host = readFileSync(path.join(here, 'host.html'));
  for (const port of [5198, 5197]) {
    const s = createServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(host);
    }).listen(port);
    servers.push(s);
  }
  await waitFor('http://localhost:8799/health');
  await waitFor('http://localhost:5199/widget.js');

  const exe = process.env.PW_CHROMIUM ?? '/Users/admin/Library/Caches/ms-playwright/chromium_headless_shell-1248/chrome-headless-shell-mac-arm64/chrome-headless-shell';
  const browser = await chromium.launch(existsSync(exe) ? { executablePath: exe } : {});
  const consoleLines = [];
  try {
    // 1. Allowed site, embedded: the whole flow, events back to the page
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    page.on('console', (m) => consoleLines.push(`${m.type()}: ${m.text()}`.slice(0, 300)));
    process.on('exit', () => failed && consoleLines.length && console.log('[e2e] browser console:\n' + consoleLines.slice(-15).join('\n')));
    await page.goto(`http://localhost:5198/?key=${key}`);
    await page.click('#cash');
    const frame = page.frameLocator('iframe[title="Cash out to your bank"]');
    await frame.getByText('Test mode: no real money moves.').waitFor({ timeout: 30_000 });
    await frame.getByText(/^₦\d/).first().waitFor();
    check(await frame.getByText('You get about').isVisible(), 'quote shows in the frame');
    await frame.getByRole('button', { name: 'Next' }).click();
    await frame.getByRole('option', { name: 'Test Bank A' }).click();
    await frame.getByLabel('Account number').fill('0123456789');
    await frame.getByText('TEST ACCOUNT').waitFor();
    await frame.getByRole('button', { name: 'Review' }).click();
    for (const label of ['GoodDollar contribution (10%)', 'GoodCash fee (1%)', 'Acme Game fee (0.5%)', 'Bank payout fee']) {
      check(await frame.getByText(label).isVisible(), `review shows "${label}"`);
    }
    const reviewText = await frame.locator('body').innerText();
    check(!/swap|slippage|usdt|paycrest|relay|quote/i.test(reviewText), 'no jargon on the review screen');
    await page.screenshot({ path: path.join(here, 'review.png') });
    await frame.getByRole('button', { name: 'Confirm cash out' }).click();
    try {
      await frame.getByText(/is in your bank account/).waitFor({ timeout: 90_000 });
    } catch (e) {
      await page.screenshot({ path: path.join(here, 'failure.png') });
      log('widget says:', (await frame.locator('body').innerText()).replace(/\s+/g, ' ').slice(0, 600));
      throw e;
    }
    await page.screenshot({ path: path.join(here, 'paid.png') });
    const events = await page.evaluate(() => window.__events.map((e) => e.type + ':' + (e.cashOut?.id === 'fake' ? 'FAKE' : 'ok')));
    log('host events', events.join(', '));
    check(events.includes('cashout.created:ok') && events.includes('cashout.sent:ok') && events.includes('cashout.paid:ok'), 'host page got created, sent and paid');
    check(!events.some((e) => e.includes('FAKE')), 'a spoofed message never reached the host app');

    // Escape closes the overlay and tells the page
    await page.keyboard.press('Escape');
    await sleep(300);
    check((await page.locator('[data-goodcash-overlay]').count()) === 0, 'Escape closes the widget');

    // 2. A live cash out needs a wallet: "Connect your wallet" first. Test keys (above) never ask.
    const bare = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await bare.goto(`http://localhost:5198/?key=${liveKey}`);
    await bare.click('#cash');
    const noWallet = bare.frameLocator('iframe[title="Cash out to your bank"]');
    await noWallet.getByRole('heading', { name: 'Connect your wallet' }).waitFor({ timeout: 30_000 });
    check(await noWallet.getByText(/No wallet was found/).isVisible(), 'live key with no wallet: asked to connect, with a kind note');
    check((await noWallet.getByLabel('How much G$?').count()) === 0, 'no cash-out screen before a wallet is connected');
    const noWalletText = await noWallet.locator('body').innerText();
    check(!/swap|slippage|usdt|paycrest|relay|quote|magic|walletconnect/i.test(noWalletText), 'no jargon on the connect screen');
    await bare.screenshot({ path: path.join(here, 'connect.png') });

    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    await ctx.addInitScript(() => {
      window.ethereum = {
        request: async ({ method }) => (method === 'eth_requestAccounts' || method === 'eth_accounts' ? ['0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef'] : method === 'eth_chainId' ? '0xa4ec' : null),
      };
    });
    const withWallet = await ctx.newPage();
    await withWallet.goto(`http://localhost:5198/?key=${liveKey}`);
    await withWallet.click('#cash');
    const f3 = withWallet.frameLocator('iframe[title="Cash out to your bank"]');
    await f3.getByRole('button', { name: "Use this browser's wallet" }).click({ timeout: 30_000 });
    await f3.getByLabel('How much G$?').waitFor({ timeout: 30_000 });
    check((await f3.getByLabel('How much G$?').inputValue()) === '5000', 'after connecting, the cash-out screen opens with the amount from the partner page');
    await ctx.close();
    await bare.close();

    // 3. A site that is not on the list: the widget refuses
    const evil = await browser.newPage();
    await evil.goto(`http://localhost:5197/?key=${key}`);
    await evil.click('#cash');
    const f2 = evil.frameLocator('iframe[title="Cash out to your bank"]');
    await f2.getByText("Cash out can't open here.").waitFor({ timeout: 30_000 });
    check(true, 'not-allowed site gets "can\'t open here"');
    const evilEvents = await evil.evaluate(() => window.__events.filter((e) => e.cashOut?.id !== 'fake').length);
    check(evilEvents === 0, 'not-allowed site receives no events');
  } finally {
    await browser.close();
  }
}

main()
  .catch((e) => {
    failed++;
    console.error('[e2e] ERROR', e.message);
  })
  .finally(() => {
    for (const p of procs) p.kill();
    for (const s of servers) s.close();
    rmSync(persist, { recursive: true, force: true });
    log(failed ? `${failed} failed` : 'all passed');
    process.exit(failed ? 1 : 0);
  });
