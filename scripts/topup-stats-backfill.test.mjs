import test from 'node:test';
import assert from 'node:assert/strict';
import { build, weekStart } from './topup-stats-backfill.mjs';

const at = (iso) => new Date(iso).getTime();
const rows = [
  { orderId: 'a', wallet: '0xAA', naira: 5000, at: at('2026-11-16T09:00:00Z'), stage: 'done' },
  { orderId: 'b', wallet: '0xaa', naira: 2000, at: at('2026-11-22T09:00:00Z'), arrived: true },
  { orderId: 'c', wallet: '0xbb', naira: 9000, at: at('2026-11-23T09:00:00Z'), stage: 'done' },
  { orderId: 'd', wallet: '0xcc', naira: 7000, at: at('2026-11-23T09:00:00Z'), stage: 'waiting' },
  { orderId: 'e', wallet: '0xdd', naira: 8000, at: at('2026-11-23T09:00:00Z'), stage: 'expired' },
];

test('counts only finished top-ups, each wallet once, weeks from Monday', () => {
  const { totals, orders } = build(rows);
  assert.deepEqual(orders, ['a', 'b', 'c']);
  assert.equal(totals.topUps, 3);
  assert.equal(totals.wallets, 2);
  assert.equal(totals.naira, 16000);
  assert.equal(totals.firstAt, '2026-11-16T09:00:00.000Z');
  assert.deepEqual(totals.weeks['2026-11-16'], { topUps: 2, naira: 7000 });
});

test('weekStart is the Monday', () => assert.equal(weekStart(at('2026-11-22T23:00:00Z')), '2026-11-16'));

test('no history gives empty totals', () => {
  const { totals } = build([]);
  assert.equal(totals.topUps, 0);
  assert.equal(totals.firstAt, null);
});
