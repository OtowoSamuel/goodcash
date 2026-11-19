#!/usr/bin/env node
/**
 * Referral rewards waiting to be paid, as a list to check by hand. READ ONLY: it never sends anything and never
 * changes storage. It uses your own signed-in wrangler, so no secret is needed.
 *
 *   cd /Users/admin/Documents/GoodCash/services/orders && node ../../scripts/referral-payouts.mjs
 *   ... referral-payouts.mjs --file dump.json     (a saved list, for testing)
 *   ... referral-payouts.mjs --csv > rewards.csv  (spreadsheet)
 *
 * Each row says who to pay and how much, plus "check" notes where the pattern looks like one person making many
 * wallets: look at those before paying. Also check each wallet is GoodDollar-verified and not a duplicate of another
 * person before sending.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const NAMESPACE_ID = 'c7897f6e178b431d99d7fef60dd0c81e'; // ORDER_STORE, from services/orders/wrangler.toml
const DAY = 24 * 3600 * 1000;

/** records: [{ friend, reward: { inviter, orderId, naira, at, newG, inviterG, status } }] */
export function buildRows(records) {
  const byInviter = new Map();
  for (const r of records) {
    const list = byInviter.get(r.reward.inviter) ?? [];
    list.push(r);
    byInviter.set(r.reward.inviter, list);
  }
  const rows = [];
  for (const { friend, reward } of records) {
    const siblings = byInviter.get(reward.inviter) ?? [];
    const sameDay = siblings.filter((s) => Math.abs(s.reward.at - reward.at) < DAY).length;
    const notes = [];
    if (siblings.length >= 5) notes.push(`inviter has ${siblings.length} friends`);
    if (sameDay >= 3) notes.push(`${sameDay} of this inviter's friends within one day`);
    if (reward.naira === 2000) notes.push('exactly the minimum');
    if (reward.inviter === friend) notes.push('inviter is the friend');
    rows.push({
      status: reward.status,
      at: new Date(reward.at).toISOString(),
      friend,
      friendG: reward.newG,
      inviter: reward.inviter,
      inviterG: reward.inviterG,
      naira: reward.naira,
      orderId: reward.orderId,
      check: notes.join('; '),
    });
  }
  return rows.sort((a, b) => a.at.localeCompare(b.at));
}

export function totals(rows) {
  const pending = rows.filter((r) => r.status === 'pending');
  return {
    rewards: pending.length,
    g: pending.reduce((n, r) => n + r.friendG + r.inviterG, 0),
    flagged: pending.filter((r) => r.check).length,
  };
}

function wrangler(args) {
  return execFileSync('./node_modules/.bin/wrangler', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
}

function loadFromStorage() {
  const keys = JSON.parse(wrangler(['kv', 'key', 'list', '--namespace-id', NAMESPACE_ID, '--prefix', 'refq:', '--remote']));
  return keys.map((k) => ({
    friend: k.name.slice('refq:'.length),
    reward: JSON.parse(wrangler(['kv', 'key', 'get', k.name, '--namespace-id', NAMESPACE_ID, '--remote'])),
  }));
}

const csvCell = (v) => `"${String(v).replaceAll('"', '""')}"`;

if (import.meta.url === `file://${process.argv[1]}`) {
  const fileAt = process.argv.indexOf('--file');
  const records = fileAt > 0 ? JSON.parse(readFileSync(process.argv[fileAt + 1], 'utf8')) : loadFromStorage();
  const rows = buildRows(records);
  if (process.argv.includes('--csv')) {
    const cols = ['status', 'at', 'friend', 'friendG', 'inviter', 'inviterG', 'naira', 'orderId', 'check'];
    console.log(cols.join(','));
    for (const r of rows) console.log(cols.map((c) => csvCell(r[c])).join(','));
  } else {
    for (const r of rows) {
      console.log(`${r.at.slice(0, 10)}  friend ${r.friend} gets G$ ${r.friendG}  |  inviter ${r.inviter} gets G$ ${r.inviterG}  |  ₦${r.naira}${r.check ? `  CHECK: ${r.check}` : ''}`);
    }
    const t = totals(rows);
    console.log(`\n${t.rewards} pending, G$ ${t.g.toLocaleString('en-US')} in total, ${t.flagged} to look at first.`);
  }
}
