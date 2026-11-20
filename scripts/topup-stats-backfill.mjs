#!/usr/bin/env node
/**
 * One-off: count the naira top-ups that finished BEFORE the public stats counters existed, so the stats page
 * starts from the real totals instead of zero. It reads each wallet's top-up history rows, keeps the finished
 * ones (stage "done" or arrived), and builds the same totals the Worker keeps.
 *
 *   cd /Users/admin/Documents/GoodCash/services/orders
 *   node ../../scripts/topup-stats-backfill.mjs            shows the totals it would write, writes nothing
 *   node ../../scripts/topup-stats-backfill.mjs --yes      writes them (only if no totals exist yet)
 *
 * Run it once, BEFORE deploying the Worker that keeps the counters. Each order it counts gets the same "already
 * counted" marker the Worker uses, so that order is never counted twice later. If totals already exist it stops,
 * so a second run cannot double anything. It uses your own signed-in wrangler (no secret).
 */
import { execFileSync } from 'node:child_process';

const NAMESPACE_ID = 'c7897f6e178b431d99d7fef60dd0c81e'; // ORDER_STORE, from services/orders/wrangler.toml
const WEEKS_KEPT = 12; // keep in step with services/orders/src/topupStats.ts
const day = (ms) => new Date(ms).toISOString().slice(0, 10);
export const weekStart = (ms) => {
  const d = new Date(Math.floor(ms / 86400000) * 86400000);
  return day(d.getTime() - ((d.getUTCDay() + 6) % 7) * 86400000);
};

/** rows: [{ orderId, wallet, naira, at, stage, arrived }] -> the totals value the Worker keeps, plus which orders it counted */
export function build(rows) {
  const done = rows.filter((r) => (r.stage === 'done' || r.arrived === true) && typeof r.naira === 'number' && r.naira > 0);
  const totals = { topUps: 0, wallets: 0, naira: 0, firstAt: null, weeks: {} };
  const wallets = new Set();
  for (const r of done) {
    const w = weekStart(r.at);
    const cur = totals.weeks[w] ?? { topUps: 0, naira: 0 };
    totals.weeks[w] = { topUps: cur.topUps + 1, naira: cur.naira + r.naira };
    totals.topUps += 1;
    totals.naira += r.naira;
    wallets.add(r.wallet.toLowerCase());
    const iso = new Date(r.at).toISOString();
    if (!totals.firstAt || iso < totals.firstAt) totals.firstAt = iso;
  }
  totals.wallets = wallets.size;
  const keep = Object.keys(totals.weeks).sort().slice(-WEEKS_KEPT);
  totals.weeks = Object.fromEntries(keep.map((k) => [k, totals.weeks[k]]));
  return { totals, orders: done.map((r) => r.orderId), wallets: [...wallets] };
}

const wrangler = (args) => execFileSync('./node_modules/.bin/wrangler', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
const kv = (...a) => wrangler(['kv', 'key', ...a, '--namespace-id', NAMESPACE_ID]);

function readRows() {
  const keys = JSON.parse(kv('list', '--prefix', 'onramp-wallet:'));
  return keys.map((k) => {
    const [, wallet, orderId] = k.name.split(':');
    const e = JSON.parse(kv('get', k.name));
    return { orderId, wallet, naira: e.naira, at: e.at, stage: e.stage, arrived: e.arrived };
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const yes = process.argv.includes('--yes');
  const existing = JSON.parse(kv('list', '--prefix', 'stats:topups'));
  if (existing.length) {
    console.log('Totals already exist (stats:topups). Nothing to do; this script only runs once.');
    process.exit(0);
  }
  const { totals, orders, wallets } = build(readRows());
  console.log(`Would count ${totals.topUps} finished top-ups from ${totals.wallets} wallets, ₦${totals.naira.toLocaleString('en-US')}.`);
  console.log(`That is ${orders.length + wallets.length + 1} storage writes.`);
  if (!yes) {
    console.log('Nothing written. Run again with --yes to write.');
    process.exit(0);
  }
  const ttl = String(60 * 60 * 24 * 400);
  for (const id of orders) kv('put', `topupcounted:${id}`, '1', '--ttl', ttl);
  for (const w of wallets) kv('put', `topupwallet:${w}`, '1');
  kv('put', 'stats:topups', JSON.stringify(totals));
  console.log('Written.');
}
