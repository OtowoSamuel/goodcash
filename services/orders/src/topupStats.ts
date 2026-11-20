/**
 * Public numbers for naira top-ups (shown on the stats page next to the cash-out numbers).
 *
 * There is no public record of a top-up on the chain we can read cheaply, so we keep running totals: when a top-up
 * settles it is added once, to one small value. Only counts and naira amounts are kept, never a wallet, bank or
 * name. A per-order marker makes it safe to run any number of times for the same order (the app polls and the
 * partner's webhook both report the same settle). Counting problems are logged and never break an order.
 */
import type { Store } from './referral';

export const TOPUP_KEY = 'stats:topups';
const COUNTED_TTL = 60 * 60 * 24 * 400;
const WEEKS_KEPT = 12;

export interface TopUpTotals {
  topUps: number;
  wallets: number;
  naira: number;
  firstAt: string | null;
  /** Weeks start on Monday (UTC); only the most recent ones are kept */
  weeks: Record<string, { topUps: number; naira: number }>;
}

const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);
export function weekStart(ms: number): string {
  const d = new Date(Math.floor(ms / 86400000) * 86400000);
  return day(d.getTime() - ((d.getUTCDay() + 6) % 7) * 86400000);
}

const empty = (): TopUpTotals => ({ topUps: 0, wallets: 0, naira: 0, firstAt: null, weeks: {} });

export async function readTopUpTotals(store: Pick<Store, 'get'>): Promise<TopUpTotals> {
  const raw = await store.get(TOPUP_KEY);
  if (!raw) return empty();
  try {
    return { ...empty(), ...(JSON.parse(raw) as Partial<TopUpTotals>) };
  } catch {
    return empty();
  }
}

/** A naira top-up has settled: add it to the totals once. */
export async function countTopUp(store: Store, orderId: string, now = Date.now()): Promise<boolean> {
  if ((await store.get(`topupcounted:${orderId}`)) !== null) return false;
  const rawOrder = await store.get(`onramp:${orderId}`);
  if (!rawOrder) return false;
  const order = JSON.parse(rawOrder) as { wallet?: string; naira?: number; createdAt?: number };
  if (typeof order.naira !== 'number' || !(order.naira > 0) || typeof order.wallet !== 'string') return false;
  const wallet = order.wallet.toLowerCase();

  const totals = await readTopUpTotals(store);
  const isNewWallet = (await store.get(`topupwallet:${wallet}`)) === null;
  const at = order.createdAt ?? now;
  const week = weekStart(at);
  const w = totals.weeks[week] ?? { topUps: 0, naira: 0 };
  totals.weeks[week] = { topUps: w.topUps + 1, naira: w.naira + order.naira };
  const keep = Object.keys(totals.weeks).sort().slice(-WEEKS_KEPT);
  totals.weeks = Object.fromEntries(keep.map((k) => [k, totals.weeks[k]]));
  totals.topUps += 1;
  totals.naira += order.naira;
  if (isNewWallet) totals.wallets += 1;
  const iso = new Date(at).toISOString();
  if (!totals.firstAt || iso < totals.firstAt) totals.firstAt = iso;

  // Marker first: if the total then fails to save, one top-up goes uncounted rather than counted twice
  await store.put(`topupcounted:${orderId}`, '1', { expirationTtl: COUNTED_TTL });
  if (isNewWallet) await store.put(`topupwallet:${wallet}`, '1');
  await store.put(TOPUP_KEY, JSON.stringify(totals));
  return true;
}

export async function countTopUpSafely(store: Store, orderId: string): Promise<void> {
  try {
    await countTopUp(store, orderId);
  } catch (e) {
    console.error('[stats] could not count a top-up:', (e as Error)?.message);
  }
}

export interface TopUpSummary {
  topUps: number;
  wallets: number;
  naira: number;
  firstAt: string | null;
  thisWeek: { topUps: number; naira: number };
  /** Last 12 weeks, oldest first, zeros included */
  weekly: Array<{ date: string; topUps: number; naira: number }>;
}

export function summariseTopUps(t: TopUpTotals, now = new Date()): TopUpSummary {
  const thisWeek = weekStart(now.getTime());
  const weekly: TopUpSummary['weekly'] = [];
  for (let i = WEEKS_KEPT - 1; i >= 0; i--) {
    const date = day(new Date(`${thisWeek}T00:00:00Z`).getTime() - i * 7 * 86400000);
    weekly.push({ date, topUps: t.weeks[date]?.topUps ?? 0, naira: t.weeks[date]?.naira ?? 0 });
  }
  const cur = weekly[weekly.length - 1];
  return { topUps: t.topUps, wallets: t.wallets, naira: t.naira, firstAt: t.firstAt, thisWeek: { topUps: cur.topUps, naira: cur.naira }, weekly };
}
