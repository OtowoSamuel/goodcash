/**
 * Referral campaign: a customer shares a link, a friend adds money for the first time, both get a G$ bonus.
 *
 * Nothing here moves money. A friend counts only when their first naira top-up has really settled (the bank
 * payment arrived), so every reward is backed by real money in. A qualifying friend is recorded as "pending"; the
 * team reviews the list and pays by hand (scripts/referral-payouts.mjs). Nothing is ever sent automatically.
 *
 * The link carries the inviter's wallet. The app sends it along with the friend's top-up order, so a visitor who
 * only opens a link costs no storage at all. The only writes happen for a top-up that settled:
 *   refq:<wallet>             -> the qualified reward for this friend (written once)
 *   refin:<inviter>:<wallet>  -> index so an inviter's friends can be counted
 */

/** Settings for the first campaign. Change here, nowhere else. */
export const REFERRAL = {
  /** G$ the new customer gets. 500 naira at about 0.141 naira per G$ on 19 Nov 2026 is about 3,540 G$, rounded down. */
  newG: 3500,
  /** G$ the person who shared the link gets. */
  inviterG: 3500,
  /** The first top-up must be at least this many naira. Bigger than the reward, so a reward never exceeds what was added. */
  minNaira: 2000,
  /** Friends one person can be paid for in this campaign. Beyond this a friend still gets their own bonus. */
  maxPerInviter: 20,
  /** A top-up started after this moment earns nothing. One of the two stops (this and the budget) ends the campaign. */
  endsAt: '2026-12-31T23:59:59Z',
  /** The most G$ the campaign will ever commit, friend bonuses and inviter rewards together. About 500 friends, around $365. */
  budgetG: 3_500_000,
} as const;

/** All the G$ recorded so far. One number, so checking the budget never means reading every reward. */
const TOTAL_KEY = 'reftotal';

export type Store = Pick<KVNamespace, 'get' | 'put' | 'list'>;

const WALLET = /^0x[0-9a-fA-F]{40}$/;

export interface QualifiedReward {
  inviter: string;
  orderId: string;
  naira: number;
  at: number;
  newG: number;
  inviterG: number;
  status: 'pending';
}

export function isWallet(v: unknown): v is string {
  return typeof v === 'string' && WALLET.test(v);
}

/** The inviter's wallet from a link or an order, or null if it is not a usable address. */
export function inviterFrom(raw: unknown): string | null {
  return isWallet(raw) ? raw.toLowerCase() : null;
}

export type QualifyResult =
  | { ok: true; reward: QualifiedReward }
  | { ok: false; reason: 'no_order' | 'too_small' | 'no_referral' | 'self' | 'already' | 'not_first' | 'ended' | 'budget_full' };

async function committedG(store: Store): Promise<number> {
  return Number((await store.get(TOTAL_KEY)) ?? '0') || 0;
}

/** Open while it is before the end date and a whole reward (friend and inviter) still fits in the budget. */
export async function campaignOpen(store: Store, now = Date.now()): Promise<boolean> {
  if (now > Date.parse(REFERRAL.endsAt)) return false;
  return (await committedG(store)) + REFERRAL.newG + REFERRAL.inviterG <= REFERRAL.budgetG;
}

/**
 * A naira top-up has settled. If it came from a friend's link, is this wallet's first finished top-up and is big
 * enough, record the reward as pending. Safe to run any number of times for the same order.
 */
export async function qualifyReferral(store: Store, orderId: string, now = Date.now()): Promise<QualifyResult> {
  const rawOrder = await store.get(`onramp:${orderId}`);
  if (!rawOrder) return { ok: false, reason: 'no_order' };
  const order = JSON.parse(rawOrder) as { wallet?: string; naira?: number; ref?: string; createdAt?: number };
  if (!isWallet(order.wallet)) return { ok: false, reason: 'no_order' };
  const me = order.wallet.toLowerCase();
  const inviter = inviterFrom(order.ref);
  if (!inviter) return { ok: false, reason: 'no_referral' };
  if (inviter === me) return { ok: false, reason: 'self' };
  if (typeof order.naira !== 'number' || order.naira < REFERRAL.minNaira) return { ok: false, reason: 'too_small' };
  // What counts is when the customer started the order, so someone who began in time is not cut off while the bank payment is on its way
  if ((order.createdAt ?? now) > Date.parse(REFERRAL.endsAt)) return { ok: false, reason: 'ended' };
  if ((await store.get(`refq:${me}`)) !== null) return { ok: false, reason: 'already' };

  // It has to be this wallet's first finished top-up
  const rows = await store.list({ prefix: `onramp-wallet:${me}:`, limit: 50 });
  for (const k of rows.keys) {
    if (k.name.endsWith(`:${orderId}`)) continue;
    const raw = await store.get(k.name);
    if (!raw) continue;
    const entry = JSON.parse(raw) as { stage?: string; arrived?: boolean };
    if (entry.stage === 'done' || entry.arrived === true) return { ok: false, reason: 'not_first' };
  }

  const counted = await store.list({ prefix: `refin:${inviter}:`, limit: REFERRAL.maxPerInviter });
  const capped = counted.keys.length >= REFERRAL.maxPerInviter;
  const reward: QualifiedReward = {
    inviter,
    orderId,
    naira: order.naira,
    at: now,
    newG: REFERRAL.newG,
    inviterG: capped ? 0 : REFERRAL.inviterG,
    status: 'pending',
  };
  const total = await committedG(store);
  if (total + reward.newG + reward.inviterG > REFERRAL.budgetG) return { ok: false, reason: 'budget_full' };
  await store.put(`refq:${me}`, JSON.stringify(reward));
  if (!capped) await store.put(`refin:${inviter}:${me}`, '1');
  // Two top-ups settling in the same instant could pass the check together and overshoot by one reward. That is accepted.
  await store.put(TOTAL_KEY, String(total + reward.newG + reward.inviterG));
  return { ok: true, reward };
}

/** For the order paths: referral problems are logged, never shown to a customer and never break an order. */
export async function qualifyReferralSafely(store: Store, orderId: string): Promise<void> {
  try {
    await qualifyReferral(store, orderId);
  } catch (e) {
    console.error('[referral] could not record a qualifying top-up:', (e as Error)?.message);
  }
}

export interface ReferralSummary {
  /** False once the end date has passed or the budget is used up: nobody should be promised a reward */
  open: boolean;
  endsAt: string;
  /** Friends whose first top-up has settled */
  friends: number;
  /** G$ earned from friends, waiting to be paid */
  earnedG: number;
  /** The bonus this wallet earned for being invited, if any */
  bonusG: number;
  perFriendG: number;
  friendBonusG: number;
  minNaira: number;
  maxFriends: number;
}

export async function referralSummary(store: Store, wallet: string, now = Date.now()): Promise<ReferralSummary> {
  const me = wallet.toLowerCase();
  const friends = await store.list({ prefix: `refin:${me}:`, limit: 1000 });
  let earnedG = 0;
  for (const k of friends.keys) {
    const raw = await store.get(`refq:${k.name.slice(`refin:${me}:`.length)}`);
    if (raw) earnedG += (JSON.parse(raw) as QualifiedReward).inviterG;
  }
  const own = await store.get(`refq:${me}`);
  return {
    open: await campaignOpen(store, now),
    endsAt: REFERRAL.endsAt,
    friends: friends.keys.length,
    earnedG,
    bonusG: own ? (JSON.parse(own) as QualifiedReward).newG : 0,
    perFriendG: REFERRAL.inviterG,
    friendBonusG: REFERRAL.newG,
    minNaira: REFERRAL.minNaira,
    maxFriends: REFERRAL.maxPerInviter,
  };
}
