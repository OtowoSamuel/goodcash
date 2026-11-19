// Run with: node --test scripts/referral-payouts.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { judge, totals, fetchRoot } from './referral-payouts.mjs';

const ZERO = '0x0000000000000000000000000000000000000000';
const w = (n) => `0x${String(n).padStart(40, '0')}`;
const rec = (friend, inviter, at = 1000, extra = {}) => ({ friend, reward: { inviter, orderId: `o${friend}`, naira: 5000, at, newG: 3500, inviterG: 3500, status: 'pending', ...extra } });
const roots = (pairs) => new Map(pairs.map(([a, r]) => [a.toLowerCase(), (r ?? ZERO).toLowerCase()]));
const find = (lines, role, wallet) => lines.find((l) => l.role === role && l.wallet === wallet);

test('pays both when both are verified and are different people', () => {
  const lines = judge([rec(w(1), w(2))], roots([[w(1), w(1)], [w(2), w(2)]]));
  assert.equal(find(lines, 'friend', w(1)).action, 'PAY');
  assert.equal(find(lines, 'inviter', w(2)).action, 'PAY');
  assert.deepEqual(totals(lines), { pay: 2, payG: 7000, hold: 0 });
});

test('holds a friend GoodDollar has not verified, and the inviter share that depends on it', () => {
  const lines = judge([rec(w(1), w(2))], roots([[w(1), ZERO], [w(2), w(2)]]));
  assert.equal(find(lines, 'friend', w(1)).action, 'HOLD');
  assert.match(find(lines, 'friend', w(1)).reason, /not verified/);
  assert.equal(find(lines, 'inviter', w(2)).action, 'HOLD');
});

test('holds an inviter who is not verified but still pays the verified friend', () => {
  const lines = judge([rec(w(1), w(2))], roots([[w(1), w(1)], [w(2), ZERO]]));
  assert.equal(find(lines, 'friend', w(1)).action, 'PAY');
  assert.equal(find(lines, 'inviter', w(2)).action, 'HOLD');
});

test('one person with two wallets (same root) is not paid for inviting themselves', () => {
  // wallet 1 is a connected account of wallet 2's person
  const lines = judge([rec(w(1), w(2))], roots([[w(1), w(2)], [w(2), w(2)]]));
  assert.equal(find(lines, 'friend', w(1)).action, 'HOLD');
  assert.match(find(lines, 'friend', w(1)).reason, /same person/);
  assert.equal(find(lines, 'inviter', w(2)).action, 'HOLD');
  assert.equal(totals(lines).pay, 0);
});

test('one person making several "new" wallets is rewarded once, the earliest', () => {
  const lines = judge(
    [rec(w(1), w(9), 1000), rec(w(2), w(9), 2000), rec(w(3), w(9), 3000)],
    roots([[w(1), w(1)], [w(2), w(1)], [w(3), w(1)], [w(9), w(9)]]),
  );
  assert.equal(find(lines, 'friend', w(1)).action, 'PAY');
  assert.equal(find(lines, 'friend', w(2)).action, 'HOLD');
  assert.match(find(lines, 'friend', w(2)).reason, /already rewarded/);
  assert.equal(find(lines, 'friend', w(3)).action, 'HOLD');
  // the inviter is paid once, for the one real friend
  assert.equal(lines.filter((l) => l.role === 'inviter' && l.action === 'PAY').length, 1);
});

test('one person is paid for at most 20 friends, counted across all their wallets', () => {
  const recs = [];
  const map = [[w(900), w(900)], [w(901), w(900)]]; // two wallets, one person
  for (let i = 1; i <= 22; i++) {
    recs.push(rec(w(i), i % 2 ? w(900) : w(901), 1000 + i));
    map.push([w(i), w(i)]);
  }
  const lines = judge(recs, roots(map));
  assert.equal(lines.filter((l) => l.role === 'inviter' && l.action === 'PAY').length, 20);
  assert.equal(lines.filter((l) => l.role === 'friend' && l.action === 'PAY').length, 22);
});

test('a reward already marked paid is skipped', () => {
  assert.equal(judge([rec(w(1), w(2), 1000, { status: 'paid' })], roots([[w(1), w(1)], [w(2), w(2)]])).length, 0);
});

test('an inviter share of zero (over the cap when recorded) makes no inviter line', () => {
  const lines = judge([rec(w(1), w(2), 1000, { inviterG: 0 })], roots([[w(1), w(1)], [w(2), w(2)]]));
  assert.equal(lines.length, 1);
  assert.equal(lines[0].role, 'friend');
});

test('flags a burst of friends from one inviter to look at', () => {
  const recs = [1, 2, 3].map((i) => rec(w(i), w(9), 1000 + i));
  const map = [[w(9), w(9)], ...[1, 2, 3].map((i) => [w(i), w(i)])];
  assert.match(find(judge(recs, roots(map)), 'friend', w(1)).reason, /look at/);
});

test('fetchRoot reads the address from the answer and never treats a failed answer as verified', async () => {
  const ok = await fetchRoot(w(5), async () => ({ json: async () => ({ result: `0x${'0'.repeat(24)}${'ab'.repeat(20)}` }) }));
  assert.equal(ok, `0x${'ab'.repeat(20)}`);
  await assert.rejects(fetchRoot(w(5), async () => ({ json: async () => ({ error: { message: 'rate limited' } }) })), /No answer/);
  await assert.rejects(fetchRoot(w(5), async () => ({ json: async () => ({ result: '0x' }) })), /No answer/);
});
