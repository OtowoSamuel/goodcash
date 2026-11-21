/**
 * How many wallets use GoodCash, across both things it does: naira top-ups and cash outs. A wallet counts once
 * whichever it used. "Came back" means two or more top-ups or cash outs in total, in any mix. Counts only.
 *
 * Cash outs come from the chain (one row each). Top-ups come from one marker per wallet (`topupwallet:<wallet>`),
 * whose metadata holds that wallet's number of top-ups and the time of its first one, so a single list call reads
 * them all. Markers written before the metadata existed read as one top-up with no date until the backfill runs.
 */
import type { Store } from './referral';
import type { CashOutRow } from './stats';
import { weekStart } from './topupStats';

export const TOPUP_WALLET_PREFIX = 'topupwallet:';
const WEEKS_SHOWN = 12;
const MAX_PAGES = 20;

export interface TopUpWallet {
  wallet: string;
  /** Top-ups this wallet has made */
  n: number;
  /** First top-up, ms since 1970; null for an old marker with no date */
  first: number | null;
}

/** The marker value and metadata for a wallet's top-ups (the same object in both) */
export interface TopUpWalletMeta {
  n: number;
  first: number | null;
}

/** Read an existing marker value: old markers are the plain string "1" */
export function parseTopUpWallet(raw: string | null): TopUpWalletMeta | null {
  if (raw === null) return null;
  try {
    const v = JSON.parse(raw) as unknown;
    if (v && typeof v === 'object' && typeof (v as TopUpWalletMeta).n === 'number') {
      const m = v as TopUpWalletMeta;
      return { n: m.n, first: typeof m.first === 'number' ? m.first : null };
    }
  } catch {
    /* an old marker */
  }
  return { n: 1, first: null };
}

export async function listTopUpWallets(store: Pick<Store, 'list'>): Promise<TopUpWallet[]> {
  const out: TopUpWallet[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < MAX_PAGES; page++) {
    const res = (await store.list({ prefix: TOPUP_WALLET_PREFIX, limit: 1000, cursor })) as {
      keys: Array<{ name: string; metadata?: unknown }>;
      list_complete?: boolean;
      cursor?: string;
    };
    for (const k of res.keys) {
      const m = k.metadata as Partial<TopUpWalletMeta> | undefined;
      out.push({
        wallet: k.name.slice(TOPUP_WALLET_PREFIX.length).toLowerCase(),
        n: typeof m?.n === 'number' && m.n > 0 ? m.n : 1,
        first: typeof m?.first === 'number' ? m.first : null,
      });
    }
    if (res.list_complete !== false || !res.cursor) break;
    cursor = res.cursor;
  }
  return out;
}

export interface UsageSummary {
  /** Different wallets with a top-up or a cash out */
  wallets: number;
  /** Wallets with two or more top-ups or cash outs in total */
  cameBack: number;
  /** Wallets that have made both a top-up and a cash out */
  usedBoth: number;
  /** Wallets with two or more top-ups */
  topUpCameBack: number;
  /** Wallets first seen each week (Monday, UTC), last 12 weeks, oldest first */
  newWeekly: Array<{ date: string; wallets: number }>;
  /** Wallets whose first use has no date yet (old top-up markers); left out of newWeekly */
  undated: number;
}

export function summariseUsage(cashOuts: CashOutRow[], topUps: TopUpWallet[], now: Date, exclude: Set<string> = new Set()): UsageSummary {
  const per = new Map<string, { cash: number; top: number; first: number | null; dated: boolean }>();
  const entry = (w: string) => {
    let e = per.get(w);
    if (!e) per.set(w, (e = { cash: 0, top: 0, first: null, dated: true }));
    return e;
  };
  for (const r of cashOuts) {
    if (exclude.has(r.wallet)) continue;
    const e = entry(r.wallet);
    e.cash++;
    e.first = e.first === null ? r.time * 1000 : Math.min(e.first, r.time * 1000);
  }
  for (const t of topUps) {
    if (exclude.has(t.wallet)) continue;
    const e = entry(t.wallet);
    e.top += t.n;
    if (t.first === null) e.dated = false;
    else e.first = e.first === null ? t.first : Math.min(e.first, t.first);
  }

  // A wallet with an undated top-up may have started before its first dated use, so its week is unknown
  const byWeek = new Map<string, number>();
  let undated = 0;
  for (const e of per.values()) {
    if (!e.dated || e.first === null) {
      undated++;
      continue;
    }
    const w = weekStart(e.first);
    byWeek.set(w, (byWeek.get(w) ?? 0) + 1);
  }
  const thisWeek = weekStart(now.getTime());
  const newWeekly: UsageSummary['newWeekly'] = [];
  for (let i = WEEKS_SHOWN - 1; i >= 0; i--) {
    const date = new Date(new Date(`${thisWeek}T00:00:00Z`).getTime() - i * 7 * 86400000).toISOString().slice(0, 10);
    newWeekly.push({ date, wallets: byWeek.get(date) ?? 0 });
  }

  const all = [...per.values()];
  return {
    wallets: all.length,
    cameBack: all.filter((e) => e.cash + e.top >= 2).length,
    usedBoth: all.filter((e) => e.cash > 0 && e.top > 0).length,
    topUpCameBack: all.filter((e) => e.top >= 2).length,
    newWeekly,
    undated,
  };
}
