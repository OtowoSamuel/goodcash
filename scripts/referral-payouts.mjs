#!/usr/bin/env node
/**
 * Referral rewards waiting to be paid, checked against GoodDollar, as a list to pay by hand.
 * It never sends money. Listing only reads. The one thing that writes is --mark-paid ... --yes, which records
 * that you paid, so the next list does not show the same reward again. It uses your own signed-in wrangler (no
 * secret) and a public Celo node.
 *
 *   cd /Users/admin/Documents/GoodCash/services/orders
 *   node ../../scripts/referral-payouts.mjs                      the list (PAY, HOLD, and PAID for what was marked)
 *   node ../../scripts/referral-payouts.mjs --csv > rewards.csv  the same, as a spreadsheet
 *   node ../../scripts/referral-payouts.mjs --mark-paid rewards.csv         shows what would be marked, writes nothing
 *   node ../../scripts/referral-payouts.mjs --mark-paid rewards.csv --yes   marks the PAY lines in that file as paid
 *   ... --file dump.json   uses a saved list instead of live storage (for testing; the GoodDollar check still runs)
 *
 * Pay first, then mark: use the same CSV you paid from. A line is marked only if it matches a real reward (same
 * wallet, same amount), so a wrong or old file cannot mark anything by mistake.
 *
 * The check: GoodDollar's Identity contract says which person (the "root") each wallet belongs to. One person has
 * one root however many wallets they connect. So:
 *   - a wallet GoodDollar has not verified is not paid yet ("not verified");
 *   - a friend who is the same person as their inviter is not paid ("same person");
 *   - a person is paid a friend bonus once, the earliest first ("already rewarded");
 *   - one person is paid for at most MAX_FRIENDS friends, counted across all their wallets.
 * Each line is PAY or HOLD with the reason, or PAID once marked. Rows are never dropped, so nothing is lost; a HELD
 * line can be paid later by running the script again once the wallet is verified. A line that was marked paid still
 * counts toward "one person once" and the 20 friends limit.
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
 * paid:    Set of `${friend}:${role}` already marked paid
 * Returns one line per payee: { action: 'PAY'|'HOLD'|'PAID', role, friend, wallet, g, orderId, at, reason }
 */
export function judge(records, roots, paid = new Set()) {
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
    const base = { orderId: reward.orderId, at: new Date(reward.at).toISOString(), friend };
    const notes = [];
    if (byInviter.get(reward.inviter) >= 5) notes.push(`inviter has ${byInviter.get(reward.inviter)} friends`);
    if (ordered.filter((s) => s.reward.inviter === reward.inviter && Math.abs(s.reward.at - reward.at) < DAY).length >= 3) notes.push('3 or more friends of this inviter within a day');
    const look = notes.length ? `; look at: ${notes.join(', ')}` : '';

    // The friend's bonus
    const friendPaid = paid.has(paidKey(friend, 'friend'));
    if (friendPaid && fRoot !== ZERO) friendRootsPaid.add(fRoot);
    let friendReason = '';
    if (friendPaid) friendReason = '';
    else if (fRoot === ZERO) friendReason = 'not verified with GoodDollar yet';
    else if (iRoot !== ZERO && fRoot === iRoot) friendReason = 'same person as the inviter';
    else if (friendRootsPaid.has(fRoot)) friendReason = 'this person was already rewarded';
    const friendOk = friendReason === '';
    if (friendOk && !friendPaid) friendRootsPaid.add(fRoot);
    lines.push({ ...base, role: 'friend', wallet: friend, g: reward.newG, action: friendPaid ? 'PAID' : friendOk ? 'PAY' : 'HOLD', reason: friendPaid ? 'already paid' : friendOk ? `verified${look}` : friendReason });

    // The inviter's share (zero when they were over the cap when it was recorded)
    if (reward.inviterG > 0) {
      const inviterPaid = paid.has(paidKey(friend, 'inviter'));
      let reason = '';
      if (inviterPaid) {
        if (iRoot !== ZERO) friendsPaidFor.set(iRoot, (friendsPaidFor.get(iRoot) ?? 0) + 1);
        lines.push({ ...base, role: 'inviter', wallet: reward.inviter, g: reward.inviterG, action: 'PAID', reason: 'already paid' });
        continue;
      }
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

export const paidKey = (friend, role) => `${friend.toLowerCase()}:${role}`;

export function totals(lines) {
  const pay = lines.filter((l) => l.action === 'PAY');
  const paid = lines.filter((l) => l.action === 'PAID');
  return { pay: pay.length, payG: pay.reduce((n, l) => n + l.g, 0), hold: lines.length - pay.length - paid.length, paid: paid.length };
}

/** Read back a CSV this script wrote. */
export function parseCsv(text) {
  const rows = text.split(/\r?\n/).filter((l) => l.trim() !== '');
  const cells = (line) => [...line.matchAll(/"((?:[^"]|"")*)"|([^,]+)/g)].map((m) => (m[1] ?? m[2]).replaceAll('""', '"'));
  const head = rows[0].split(',').map((h) => h.trim());
  return rows.slice(1).map((line) => Object.fromEntries(cells(line).map((v, i) => [head[i], v])));
}

/**
 * The lines of a paid-from CSV to mark as paid. Each must be a PAY line that matches a real reward (same friend,
 * same wallet, same amount) and not already marked. Anything else throws, so nothing is half-marked.
 */
export function marksFromCsv(text, records, paid = new Set()) {
  const marks = [];
  for (const row of parseCsv(text)) {
    if (row.action !== 'PAY') continue;
    const rec = records.find((r) => r.friend.toLowerCase() === String(row.friend).toLowerCase());
    if (!rec) throw new Error(`No reward for friend ${row.friend}`);
    const role = row.role;
    const expectWallet = role === 'friend' ? rec.friend : role === 'inviter' ? rec.reward.inviter : null;
    const expectG = role === 'friend' ? rec.reward.newG : rec.reward.inviterG;
    if (!expectWallet || String(row.wallet).toLowerCase() !== expectWallet.toLowerCase() || Number(row.g) !== expectG) {
      throw new Error(`Line does not match the reward: ${role} ${row.wallet} G$ ${row.g}`);
    }
    const key = paidKey(rec.friend, role);
    if (paid.has(key)) throw new Error(`Already marked paid: ${role} ${row.wallet}`);
    if (!marks.some((m) => m.key === key)) marks.push({ key, friend: rec.friend.toLowerCase(), role, wallet: expectWallet.toLowerCase(), g: expectG });
  }
  return marks;
}

// --- live data ---------------------------------------------------------------------------------------------------

function wrangler(args) {
  return execFileSync('./node_modules/.bin/wrangler', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
}

function loadFromStorage() {
  const keys = JSON.parse(wrangler(['kv', 'key', 'list', '--namespace-id', NAMESPACE_ID, '--prefix', 'refq:']));
  return keys.map((k) => ({
    friend: k.name.slice('refq:'.length),
    reward: JSON.parse(wrangler(['kv', 'key', 'get', k.name, '--namespace-id', NAMESPACE_ID])),
  }));
}

function loadPaid() {
  const keys = JSON.parse(wrangler(['kv', 'key', 'list', '--namespace-id', NAMESPACE_ID, '--prefix', 'refpaid:']));
  return new Set(keys.map((k) => k.name.slice('refpaid:'.length)));
}

function writeMark(m) {
  const value = JSON.stringify({ at: new Date().toISOString(), wallet: m.wallet, g: m.g });
  wrangler(['kv', 'key', 'put', `refpaid:${m.key}`, value, '--namespace-id', NAMESPACE_ID]);
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
  const arg = (name) => {
    const at = process.argv.indexOf(name);
    return at > 0 ? process.argv[at + 1] : null;
  };
  const fileArg = arg('--file');
  const markArg = arg('--mark-paid');
  const records = fileArg ? JSON.parse(readFileSync(fileArg, 'utf8')) : loadFromStorage();
  const paid = fileArg ? new Set() : loadPaid();

  if (markArg) {
    const marks = marksFromCsv(readFileSync(markArg, 'utf8'), records, paid);
    for (const m of marks) console.log(`${m.role.padEnd(7)} ${m.wallet}  G$ ${String(m.g).padStart(5)}`);
    if (!process.argv.includes('--yes')) {
      console.log(`\n${marks.length} lines would be marked as paid. Nothing was written. Add --yes after you have paid them.`);
    } else {
      for (const m of marks) writeMark(m);
      console.log(`\nMarked ${marks.length} lines as paid.`);
    }
  } else {
    const lines = judge(records, await lookUpRoots(records), paid);
    if (process.argv.includes('--csv')) {
      const cols = ['action', 'role', 'friend', 'wallet', 'g', 'reason', 'at', 'orderId'];
      console.log(cols.join(','));
      for (const l of lines) console.log(cols.map((c) => csvCell(l[c])).join(','));
    } else {
      for (const l of lines) console.log(`${l.action.padEnd(4)} ${l.role.padEnd(7)} ${l.wallet}  G$ ${String(l.g).padStart(5)}  ${l.reason}`);
      const t = totals(lines);
      console.log(`\nPAY ${t.pay} lines, G$ ${t.payG.toLocaleString('en-US')} in total. HOLD ${t.hold} lines (not paid). Already paid: ${t.paid}.`);
    }
  }
}
