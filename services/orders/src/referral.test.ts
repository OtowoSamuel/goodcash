import { describe, expect, it } from 'vitest';
import worker from './index.js';
import type { Env } from './index.js';
import {
  campaignOpen,
  checkFriend,
  checkWaitingFriends,
  inviterFrom,
  buildJoinMessage,
  joinReferral,
  payRewards,
  REFERRAL,
  referralSummary,
  type Chain,
  type Payer,
  type Reward,
} from './referral';

class MockKV {
  store = new Map<string, string>();
  async get(k: string) {
    return this.store.get(k) ?? null;
  }
  async put(k: string, v: string) {
    this.store.set(k, v);
  }
  async delete(k: string) {
    this.store.delete(k);
  }
  async list(opts: { prefix?: string; limit?: number; cursor?: string } = {}) {
    const all = [...this.store.keys()].filter((k) => k.startsWith(opts.prefix ?? '')).sort();
    const start = opts.cursor ? Number(opts.cursor) : 0;
    const end = start + (opts.limit ?? 1000);
    const done = end >= all.length;
    return { keys: all.slice(start, end).map((name) => ({ name })), list_complete: done, ...(done ? {} : { cursor: String(end) }) };
  }
}

/** Storage that answers like Cloudflare can right after a write: reads and lists do not see this run's writes yet */
class StaleKV extends MockKV {
  fresh = new Set<string>();
  async put(k: string, v: string) {
    this.fresh.add(k);
    await super.put(k, v);
  }
  async get(k: string) {
    return this.fresh.has(k) ? null : super.get(k);
  }
  async list(opts: { prefix?: string; limit?: number; cursor?: string } = {}) {
    const r = await super.list(opts);
    return { ...r, keys: r.keys.filter((x) => !this.fresh.has(x.name)) };
  }
}
const kvOf = (kv: MockKV) => kv as unknown as KVNamespace;

const INVITER = '0x2222222222222222222222222222222222222222';
const friend = (i: number) => `0x${String(i).padStart(4, '0')}${'1'.repeat(36)}`;
const T0 = Date.parse('2026-12-01T10:00:00Z');
const HOUR = 3600_000;

/** A pretend GoodDollar: who is verified (and as which person), when they were first verified, when they claimed */
class FakeChain implements Chain {
  person = new Map<string, string>();
  firstAt = new Map<string, number>();
  claimedAt = new Map<string, number>();
  verify(wallet: string, at: number, person = wallet) {
    this.person.set(wallet, person);
    if (!this.firstAt.has(person)) this.firstAt.set(person, at);
  }
  async personOf(w: string) {
    return this.person.get(w) ?? null;
  }
  async firstVerifiedAt(p: string) {
    return this.firstAt.get(p) ?? 0;
  }
  async lastClaimedAt(w: string) {
    return this.claimedAt.get(w) ?? 0;
  }
  /** In this pretend world a wallet's signature of the join message is sigOf(wallet, message) */
  async verifySignature(w: string, message: string, signature: string) {
    return signature === sigOf(w, message);
  }
}

const sigOf = (w: string, message: string) => '0x' + [...new TextEncoder().encode(`${w}|${message}`)].map((b) => b.toString(16).padStart(2, '0')).join('');
/** A friend's own wallet accepts the invite, correctly signed */
const join = (kv: MockKV, chain: Chain, f: string, inviter: string, at: number) =>
  joinReferral(kvOf(kv), chain, { wallet: f, ref: inviter, issuedAt: at, signature: sigOf(f, buildJoinMessage(f, inviter, at)) }, at);

/** Join, verify for the first time after joining, claim: a friend who should count */
async function realFriend(kv: MockKV, chain: FakeChain, f: string, inviter = INVITER) {
  expect(await join(kv, chain, f, inviter, T0)).toEqual({ ok: true });
  chain.verify(f, T0 + HOUR);
  chain.claimedAt.set(f, T0 + 2 * HOUR);
}

function setup() {
  const kv = new MockKV();
  const chain = new FakeChain();
  chain.verify(INVITER, T0 - 100 * HOUR);
  return { kv, chain };
}

describe('inviterFrom', () => {
  it('accepts an address in any case and lowers it, refuses anything else', () => {
    expect(inviterFrom(INVITER.toUpperCase().replace('0X', '0x'))).toBe(INVITER);
    expect(inviterFrom('nope')).toBeNull();
  });
});

describe('joining', () => {
  it('records a wallet GoodDollar has not verified yet, once', async () => {
    const { kv, chain } = setup();
    expect(await join(kv, chain, friend(1), INVITER, T0)).toEqual({ ok: true });
    expect(await join(kv, chain, friend(1), '0x3333333333333333333333333333333333333333', T0)).toEqual({ ok: false, reason: 'already' });
    expect(JSON.parse(kv.store.get(`refj:${friend(1)}`)!)).toEqual({ inviter: INVITER, at: T0 });
  });

  it('writes nothing for a wallet that is already verified, for yourself, or after the end', async () => {
    const { kv, chain } = setup();
    chain.verify(friend(1), T0 - HOUR);
    expect(await join(kv, chain, friend(1), INVITER, T0)).toEqual({ ok: false, reason: 'already_verified' });
    expect(await join(kv, chain, INVITER, INVITER, T0)).toEqual({ ok: false, reason: 'self' });
    expect(await join(kv, chain, friend(2), INVITER, Date.parse(REFERRAL.endsAt) + 1)).toEqual({ ok: false, reason: 'ended' });
    expect([...kv.store.keys()]).toEqual([]);
  });
});

describe('checking friends', () => {
  it('waits until the friend is verified and has claimed, then counts them', async () => {
    const { kv, chain } = setup();
    await join(kv, chain, friend(1), INVITER, T0);
    expect(await checkFriend(kvOf(kv), chain, friend(1), T0 + HOUR)).toBe('waiting');
    chain.verify(friend(1), T0 + HOUR);
    expect(await checkFriend(kvOf(kv), chain, friend(1), T0 + HOUR)).toBe('waiting'); // not claimed yet
    chain.claimedAt.set(friend(1), T0 + 2 * HOUR);
    expect(await checkFriend(kvOf(kv), chain, friend(1), T0 + 3 * HOUR)).toBe('counted');
    expect(kv.store.has(`refwait:${friend(1)}`)).toBe(false);
    expect(kv.store.has(`refwi:${INVITER}:${friend(1)}`)).toBe(false);
  });

  it('does not count a claim from before joining', async () => {
    const { kv, chain } = setup();
    await join(kv, chain, friend(1), INVITER, T0);
    chain.verify(friend(1), T0 + HOUR);
    chain.claimedAt.set(friend(1), T0 - HOUR);
    expect(await checkFriend(kvOf(kv), chain, friend(1), T0 + 3 * HOUR)).toBe('waiting');
  });

  it('refuses a person first verified before they joined (an existing GoodDollar user with a new wallet)', async () => {
    const { kv, chain } = setup();
    await join(kv, chain, friend(1), INVITER, T0);
    const oldPerson = '0x9999999999999999999999999999999999999999';
    chain.firstAt.set(oldPerson, T0 - 50 * HOUR);
    chain.person.set(friend(1), oldPerson);
    chain.claimedAt.set(oldPerson, T0 + 2 * HOUR);
    expect(await checkFriend(kvOf(kv), chain, friend(1), T0 + 3 * HOUR)).toBe('not_new');
  });

  it('refuses a friend who is the inviter with another wallet', async () => {
    const { kv, chain } = setup();
    await join(kv, chain, friend(1), INVITER, T0);
    // The inviter's person has a fresh first-verified date in this story, so only the same-person rule can stop it
    chain.person.set(friend(1), INVITER);
    chain.firstAt.set(INVITER, T0 + HOUR);
    chain.claimedAt.set(INVITER, T0 + 2 * HOUR);
    expect(await checkFriend(kvOf(kv), chain, friend(1), T0 + 3 * HOUR)).toBe('self');
  });

  it('counts one person once, even across two wallets and two inviters', async () => {
    const { kv, chain } = setup();
    const other = '0x3333333333333333333333333333333333333333';
    chain.verify(other, T0 - 100 * HOUR);
    await realFriend(kv, chain, friend(1));
    await join(kv, chain, friend(2), other, T0);
    chain.person.set(friend(2), friend(1)); // the same human connected a second wallet
    expect(await checkFriend(kvOf(kv), chain, friend(1), T0 + 3 * HOUR)).toBe('counted');
    expect(await checkFriend(kvOf(kv), chain, friend(2), T0 + 3 * HOUR)).toBe('already');
  });

  it('waits while the inviter is not verified, and stops checking after the wait runs out', async () => {
    const { kv, chain } = setup();
    chain.person.delete(INVITER);
    await realFriend(kv, chain, friend(1));
    expect(await checkFriend(kvOf(kv), chain, friend(1), T0 + 3 * HOUR)).toBe('waiting');
    expect(await checkFriend(kvOf(kv), chain, friend(1), T0 + (REFERRAL.waitDays + 1) * 24 * HOUR)).toBe('expired');
    expect(kv.store.has(`refwait:${friend(1)}`)).toBe(false);
  });

  it('creates one reward for every 2 friends, and stops at 20 friends', async () => {
    const { kv, chain } = setup();
    for (let i = 1; i <= REFERRAL.maxFriends + 2; i++) await realFriend(kv, chain, friend(i));
    for (let i = 1; i <= REFERRAL.maxFriends + 2; i++) await checkFriend(kvOf(kv), chain, friend(i), T0 + 3 * HOUR);
    const rewards = [...kv.store.keys()].filter((k) => k.startsWith('refpay:'));
    expect(rewards.length).toBe(REFERRAL.maxFriends / REFERRAL.perFriends);
    const first = JSON.parse(kv.store.get(`refpay:${INVITER}:1`)!) as Reward;
    expect(first).toMatchObject({ wallet: INVITER, g: REFERRAL.rewardG, status: 'pending' });
    expect(kv.store.get('refpay-total')).toBe(String((REFERRAL.maxFriends / REFERRAL.perFriends) * REFERRAL.rewardG));
  });

  it('gives no reward for a single friend', async () => {
    const { kv, chain } = setup();
    await realFriend(kv, chain, friend(1));
    const out = await checkWaitingFriends(kvOf(kv), chain, T0 + 3 * HOUR);
    expect(out.counted).toBe(1);
    expect([...kv.store.keys()].some((k) => k.startsWith('refpay:'))).toBe(false);
  });

  it('closes when the budget cannot fit another reward', async () => {
    const { kv } = setup();
    expect(await campaignOpen(kvOf(kv), T0)).toBe(true);
    kv.store.set('refpay-total', String(REFERRAL.budgetG - REFERRAL.rewardG + 1));
    expect(await campaignOpen(kvOf(kv), T0)).toBe(false);
  });
});

class FakePayer implements Payer {
  address = '0x5555555555555555555555555555555555555555';
  g = 1_000_000n * 10n ** 18n;
  celo = 10n ** 18n;
  sent: Array<[string, bigint]> = [];
  nonces: number[] = [];
  fail = false;
  next = 7;
  receipts = new Map<string, 'success' | 'reverted' | null>();
  async gBalance() {
    return this.g;
  }
  async celoBalance() {
    return this.celo;
  }
  async nonce() {
    return this.next;
  }
  async sendG(to: string, wei: bigint, nonce: number) {
    if (this.fail) throw new Error('rejected');
    this.sent.push([to, wei]);
    this.nonces.push(nonce);
    this.g -= wei;
    return '0xabc';
  }
  async receipt(hash: string) {
    return this.receipts.has(hash) ? this.receipts.get(hash)! : 'success';
  }
}

async function withRewards(count: number) {
  const { kv, chain } = setup();
  for (let i = 1; i <= count * 2; i++) await realFriend(kv, chain, friend(i));
  await checkWaitingFriends(kvOf(kv), chain, T0 + 3 * HOUR);
  return kv;
}

describe('paying rewards', () => {
  it('does nothing unless switched on', async () => {
    const kv = await withRewards(1);
    const payer = new FakePayer();
    expect(await payRewards({ ORDER_STORE: kvOf(kv) }, payer, T0)).toMatchObject({ paid: 0, skipped: 'off' });
    expect(payer.sent).toEqual([]);
  });

  it('pays a pending reward to the inviter once', async () => {
    const kv = await withRewards(1);
    const payer = new FakePayer();
    const env = { ORDER_STORE: kvOf(kv), REFERRAL_PAY_ENABLED: 'true' };
    expect(await payRewards(env, payer, T0)).toEqual({ paid: 1, check: 0 });
    expect(payer.sent).toEqual([[INVITER, BigInt(REFERRAL.rewardG) * 10n ** 18n]]);
    expect(await payRewards(env, payer, T0)).toEqual({ paid: 0, check: 0 });
    expect(payer.sent.length).toBe(1);
    expect(JSON.parse(kv.store.get(`refpay:${INVITER}:1`)!)).toMatchObject({ status: 'paid', hash: '0xabc' });
  });

  it('marks a failed send for a person to check and never resends it by itself', async () => {
    const kv = await withRewards(1);
    const payer = new FakePayer();
    payer.fail = true;
    const env = { ORDER_STORE: kvOf(kv), REFERRAL_PAY_ENABLED: 'true' };
    expect(await payRewards(env, payer, T0)).toEqual({ paid: 0, check: 1 });
    payer.fail = false;
    expect(await payRewards(env, payer, T0)).toEqual({ paid: 0, check: 0 });
    expect(JSON.parse(kv.store.get(`refpay:${INVITER}:1`)!)).toMatchObject({ status: 'check' });
  });

  it('stops when the referral wallet is low, and at the daily cap', async () => {
    const kv = await withRewards(3);
    const payer = new FakePayer();
    payer.celo = 0n;
    const env = { ORDER_STORE: kvOf(kv), REFERRAL_PAY_ENABLED: 'true', REFERRAL_DAILY_G: String(REFERRAL.rewardG * 2) };
    expect(await payRewards(env, payer, T0)).toMatchObject({ paid: 0, skipped: 'low' });
    payer.celo = 10n ** 18n;
    expect(await payRewards(env, payer, T0)).toEqual({ paid: 2, check: 0, skipped: 'day_cap' });
    expect(await payRewards(env, payer, T0 + 24 * HOUR)).toEqual({ paid: 1, check: 0 });
  });
});

describe('safety', () => {
  it('refuses a join that the wallet did not sign, or that was signed for another invite', async () => {
    const { kv, chain } = setup();
    const f = friend(1);
    const msg = buildJoinMessage(f, INVITER, T0);
    expect(await joinReferral(kvOf(kv), chain, { wallet: f, ref: INVITER, issuedAt: T0, signature: '0x1234' }, T0)).toEqual({ ok: false, reason: 'bad_signature' });
    const other = '0x3333333333333333333333333333333333333333';
    // The friend signed for INVITER; an attacker swaps in their own link
    expect(await joinReferral(kvOf(kv), chain, { wallet: f, ref: other, issuedAt: T0, signature: sigOf(f, msg) }, T0)).toEqual({ ok: false, reason: 'bad_signature' });
    expect(await joinReferral(kvOf(kv), chain, { wallet: f, ref: INVITER, issuedAt: T0, signature: undefined }, T0)).toEqual({ ok: false, reason: 'bad_signature' });
    expect([...kv.store.keys()]).toEqual([]);
  });

  it('refuses a signed join that is too old or from the future', async () => {
    const { kv, chain } = setup();
    const f = friend(1);
    const old = T0 - 11 * 60_000;
    expect(await joinReferral(kvOf(kv), chain, { wallet: f, ref: INVITER, issuedAt: old, signature: sigOf(f, buildJoinMessage(f, INVITER, old)) }, T0)).toEqual({ ok: false, reason: 'bad_signature' });
    const ahead = T0 + 5 * 60_000;
    expect(await joinReferral(kvOf(kv), chain, { wallet: f, ref: INVITER, issuedAt: ahead, signature: sigOf(f, buildJoinMessage(f, INVITER, ahead)) }, T0)).toEqual({ ok: false, reason: 'bad_signature' });
  });

  it('signs exactly the same text as the app (pinned in apps/web/src/lib/referral.test.ts too)', () => {
    expect(buildJoinMessage('0x3333333333333333333333333333333333333333', INVITER, Date.parse('2026-12-01T10:00:00.500Z'))).toBe(
      'Accept a GoodCash invite.\n\nThis is free and sends no money.\n\nInvited by: 0x2222222222222222222222222222222222222222\nWallet: 0x3333333333333333333333333333333333333333\nIssued at: 2026-12-01T10:00:00Z',
    );
  });

  it('the join message says plainly that it is free and names both wallets', () => {
    const m = buildJoinMessage(friend(1), INVITER, T0);
    expect(m).toContain('free and sends no money');
    expect(m).toContain(`Invited by: ${INVITER}`);
    expect(m).toContain(`Wallet: ${friend(1)}`);
  });

  it('counts one person once and makes the right reward even when storage answers late', async () => {
    const kv = new StaleKV();
    const chain = new FakeChain();
    chain.verify(INVITER, T0 - 100 * HOUR);
    const other = '0x3333333333333333333333333333333333333333';
    chain.verify(other, T0 - 100 * HOUR);
    await realFriend(kv, chain, friend(1));
    await realFriend(kv, chain, friend(2));
    await join(kv, chain, friend(3), other, T0);
    chain.person.set(friend(3), friend(1)); // the same human as friend 1, with a second wallet
    kv.fresh.clear(); // the joins happened long ago
    const out = await checkWaitingFriends(kvOf(kv), chain, T0 + 3 * HOUR);
    expect(out.counted).toBe(2);
    expect(out.already).toBe(1);
    expect([...kv.store.keys()].filter((k) => k.startsWith('refpay:'))).toEqual([`refpay:${INVITER}:1`]);
    expect(kv.store.get('refpay-total')).toBe(String(REFERRAL.rewardG));
  });

  it('moves through a long waiting list over several runs, so people who never verify cannot block the rest', async () => {
    const { kv, chain } = setup();
    for (let i = 1; i <= 25; i++) await join(kv, chain, friend(i), INVITER, T0); // nobody verifies
    await realFriend(kv, chain, friend(30)); // this one does, and sorts last
    let counted = 0;
    for (let run = 0; run < 3; run++) counted += (await checkWaitingFriends(kvOf(kv), chain, T0 + 3 * HOUR)).counted;
    expect(counted).toBe(1);
  });

  it('numbers each send itself, so two payments never share a transaction number', async () => {
    const kv = await withRewards(3);
    const payer = new FakePayer();
    await payRewards({ ORDER_STORE: kvOf(kv), REFERRAL_PAY_ENABLED: 'true' }, payer, T0);
    expect(payer.nonces).toEqual([7, 8, 9]);
  });

  it('confirms sent payments later, and hands a failed or vanished one to a person without resending', async () => {
    const kv = await withRewards(2);
    const payer = new FakePayer();
    const env = { ORDER_STORE: kvOf(kv), REFERRAL_PAY_ENABLED: 'true' };
    await payRewards(env, payer, T0);
    expect(payer.sent.length).toBe(2);
    // Both sends got the same hash in this pretend world; make it look reverted
    payer.receipts.set('0xabc', 'reverted');
    expect(await payRewards(env, payer, T0 + 60_000)).toMatchObject({ paid: 0, check: 2 });
    expect(payer.sent.length).toBe(2);
    const r = JSON.parse(kv.store.get(`refpay:${INVITER}:1`)!);
    expect(r.status).toBe('check');
  });

  it('waits for a receipt, then hands it to a person after 30 minutes without one', async () => {
    const kv = await withRewards(1);
    const payer = new FakePayer();
    const env = { ORDER_STORE: kvOf(kv), REFERRAL_PAY_ENABLED: 'true' };
    await payRewards(env, payer, T0);
    payer.receipts.set('0xabc', null);
    expect(await payRewards(env, payer, T0 + 10 * 60_000)).toMatchObject({ check: 0 });
    expect(await payRewards(env, payer, T0 + 31 * 60_000)).toMatchObject({ check: 1 });
  });

  it('stops paying after a failed send in the same run, since its transaction number is unknown', async () => {
    const kv = await withRewards(2);
    const payer = new FakePayer();
    payer.fail = true;
    expect(await payRewards({ ORDER_STORE: kvOf(kv), REFERRAL_PAY_ENABLED: 'true' }, payer, T0)).toEqual({ paid: 0, check: 1 });
    const statuses = [1, 2].map((n) => JSON.parse(kv.store.get(`refpay:${INVITER}:${n}`)!).status);
    expect(statuses).toEqual(['check', 'pending']);
  });
});

describe('summary and HTTP', () => {
  it('shows waiting, counted, paid and on-its-way amounts', async () => {
    const { kv, chain } = setup();
    for (let i = 1; i <= 3; i++) await realFriend(kv, chain, friend(i));
    await join(kv, chain, friend(9), INVITER, T0); // joined, has not verified
    await checkWaitingFriends(kvOf(kv), chain, T0 + 3 * HOUR);
    const s = await referralSummary(kvOf(kv), chain, INVITER, T0 + 3 * HOUR);
    expect(s).toMatchObject({ open: true, friends: 3, waiting: 1, pendingG: REFERRAL.rewardG, paidG: 0, verified: true, perFriends: 2 });
  });

  it('refuses a bad wallet on both routes', async () => {
    const env = { ORDER_STORE: kvOf(new MockKV()) } as unknown as Env;
    const me = await worker.fetch(new Request('https://api.test/referral/me?wallet=nope'), env);
    expect(me.status).toBe(400);
    const res = await worker.fetch(new Request('https://api.test/referral/join', { method: 'POST', body: JSON.stringify({ wallet: 'nope', ref: INVITER }) }), env);
    expect(res.status).toBe(400);
  });
});
