#!/usr/bin/env node
/**
 * Referral rewards waiting to be paid, checked against GoodDollar, as a list to pay by hand.
 * READ ONLY: it never sends anything and never changes storage. It uses your own signed-in wrangler (no secret) and
 * a public Celo node.
 *
 *   cd /Users/admin/Documents/GoodCash/services/orders && node ../../scripts/referral-payouts.mjs
 *   ... referral-payouts.mjs --csv > rewards.csv     (spreadsheet)
 *   ... referral-payouts.mjs --file dump.json        (a saved list instead of live storage; the check still runs)
 *
 * The check: GoodDollar's Identity contract says which person (the "root") each wallet belongs to. One person has
 * one root however many wallets they connect. So:
 *   - a wallet GoodDollar has not verified is not paid yet ("not verified");
 *   - a friend who is the same person as their inviter is not paid ("same person");
 *   - a person is paid a friend bonus once, the earliest first ("already rewarded");
 *   - one person is paid for at most MAX_FRIENDS friends, counted across all their wallets.
 * Each line is PAY or HOLD with the reason. Rows are never dropped, so nothing is lost; a HELD line can be paid
 * later by running the script again once the wallet is verified.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const NAMESPACE_ID = 'c7897f6e178b431d99d7fef60dd0c81e'; // ORDER_STORE, from services/orders/wrangler.toml
/** GoodDollar's Identity contract on Celo (GoodProtocol releases/deployment.json, "production-celo") */
export const IDENTITY = '0xC361A6E67822a0EDc17D899227dd9FC50BD62F42';
const GET_WHITELISTED_ROOT = '0x2d0e9b46'; // getWhitelistedRoot(address)
const CELO_RPC = process.env.CELO_RPC_URL || 'https://forno.celo.org';
const ZERO = '0x0000000000000000000000000000000000000000';
const MAX_FRIENDS = 20; // keep in step with REFERRAL.maxPerInviter in services/orders/src/referral.ts
const DAY = 24 * 3600 * 1000;

/**
 * records: [{ friend, reward: { inviter, orderId, naira, at, newG, inviterG, status } }]
 * roots:   Map of lower-case wallet -> lower-case root ('0x000...0' when GoodDollar has not verified it)
 * Returns one line per payee: { action: 'PAY'|'HOLD', role, wallet, g, orderId, at, reason }
 */
export function judge(records, roots) {
  const rootOf = (w) => roots.get(w.toLowerCase()) ?? ZERO;
  const ordered = [...records].filter((r) => r.reward.status === 'pending').sort((a, b) => a.reward.at - b.reward.at);
  const friendRootsPaid = new Set();
  const friendsPaidFor = new Map(); // inviter root -> count
  const byInviter = new Map();
  for (const r of ordered) byInviter.set(r.reward.inviter, (byInviter.get(r.reward.inviter) ?? 0) + 1);
  const lines = [];

  for (const { friend, reward } of ordered) {
    const fRoot = rootOf(friend);
    const iRoot = rootOf(reward.inviter);
    const base = { orderId: reward.orderId, at: new Date(reward.at).toISOString() };
    const notes = [];
    if (byInviter.get(reward.inviter) >= 5) notes.push(`inviter has ${byInviter.get(reward.inviter)} friends`);
    if (ordered.filter((s) => s.reward.inviter === reward.inviter && Math.abs(s.reward.at - reward.at) < DAY).length >= 3) notes.push('3 or more friends of this inviter within a day');
    const look = notes.length ? `; look at: ${notes.join(', ')}` : '';

    // The friend's bonus
    let friendReason = '';
    if (fRoot === ZERO) friendReason = 'not verified with GoodDollar yet';
    else if (iRoot !== ZERO && fRoot === iRoot) friendReason = 'same person as the inviter';
    else if (friendRootsPaid.has(fRoot)) friendReason = 'this person was already rewarded';
    const friendOk = friendReason === '';
    if (friendOk) friendRootsPaid.add(fRoot);
    lines.push({ ...base, role: 'friend', wallet: friend, g: reward.newG, action: friendOk ? 'PAY' : 'HOLD', reason: friendOk ? `verified${look}` : friendReason });

    // The inviter's share (zero when they were over the cap when it was recorded)
    if (reward.inviterG > 0) {
      let reason = '';
      if (iRoot === ZERO) reason = 'inviter not verified with GoodDollar yet';
      else if (fRoot !== ZERO && fRoot === iRoot) reason = 'same person as the friend';
      else if (!friendOk) reason = `friend's bonus is held (${friendReason})`;
      else if ((friendsPaidFor.get(iRoot) ?? 0) >= MAX_FRIENDS) reason = `this person already has ${MAX_FRIENDS} rewarded friends`;
      const ok = reason === '';
      if (ok) friendsPaidFor.set(iRoot, (friendsPaidFor.get(iRoot) ?? 0) + 1);
      lines.push({ ...base, role: 'inviter', wallet: reward.inviter, g: reward.inviterG, action: ok ? 'PAY' : 'HOLD', reason: ok ? `verified${look}` : reason });
    }
  }
  return lines;
}

export function totals(lines) {
  const pay = lines.filter((l) => l.action === 'PAY');
  return { pay: pay.length, payG: pay.reduce((n, l) => n + l.g, 0), hold: lines.length - pay.length };
}

// --- live data ---------------------------------------------------------------------------------------------------

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

/** GoodDollar's answer for one wallet. Throws if the node does not answer: a failed check must never look like "verified". */
export async function fetchRoot(wallet, fetchImpl = fetch) {
  const data = `${GET_WHITELISTED_ROOT}${'0'.repeat(24)}${wallet.toLowerCase().slice(2)}`;
  const res = await fetchImpl(CELO_RPC, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'user-agent': 'goodcash-referral-payouts' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_call', params: [{ to: IDENTITY, data }, 'latest'] }),
  });
  const body = await res.json();
  if (typeof body.result !== 'string' || !/^0x[0-9a-f]{64}$/i.test(body.result)) throw new Error(`No answer for ${wallet}: ${JSON.stringify(body.error ?? body).slice(0, 120)}`);
  return `0x${body.result.slice(-40)}`.toLowerCase();
}

export async function lookUpRoots(records, fetchImpl = fetch) {
  const wallets = new Set();
  for (const { friend, reward } of records) {
    wallets.add(friend.toLowerCase());
    wallets.add(reward.inviter.toLowerCase());
  }
  const roots = new Map();
  for (const w of wallets) roots.set(w, await fetchRoot(w, fetchImpl));
  return roots;
}

const csvCell = (v) => `"${String(v).replaceAll('"', '""')}"`;

if (import.meta.url === `file://${process.argv[1]}`) {
  const fileAt = process.argv.indexOf('--file');
  const records = fileAt > 0 ? JSON.parse(readFileSync(process.argv[fileAt + 1], 'utf8')) : loadFromStorage();
  const lines = judge(records, await lookUpRoots(records));
  if (process.argv.includes('--csv')) {
    const cols = ['action', 'role', 'wallet', 'g', 'reason', 'at', 'orderId'];
    console.log(cols.join(','));
    for (const l of lines) console.log(cols.map((c) => csvCell(l[c])).join(','));
  } else {
    for (const l of lines) console.log(`${l.action.padEnd(4)} ${l.role.padEnd(7)} ${l.wallet}  G$ ${String(l.g).padStart(5)}  ${l.reason}`);
    const t = totals(lines);
    console.log(`\nPAY ${t.pay} lines, G$ ${t.payG.toLocaleString('en-US')} in total. HOLD ${t.hold} lines (not paid).`);
  }
}
