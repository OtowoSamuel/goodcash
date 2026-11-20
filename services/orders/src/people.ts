/**
 * Who has used GoodCash, counted as people rather than wallets. Every wallet that has made a top-up or a cash out is
 * looked up in GoodDollar's Identity contract: a wallet that belongs to a verified person has that person's "root", and
 * several wallets of one person share it, so a person counts once. Wallets verified only after they were used (the
 * verify rule started on 20 Nov 2026) show up as "not verified", which is the true picture. Counts only.
 */
import { isZero, rootsOf, type VerifiedEnv } from './verified';

export interface PeopleSummary {
  /** Different wallets that have used GoodCash */
  wallets: number;
  /** Of those, wallets GoodDollar shows as verified */
  verifiedWallets: number;
  /** Different verified people behind those wallets */
  verifiedPeople: number;
}

export async function summarisePeople(env: VerifiedEnv, wallets: Iterable<string>): Promise<PeopleSummary | null> {
  const all = [...new Set([...wallets].map((w) => w.toLowerCase()))];
  const roots = await rootsOf(env, all);
  if (!roots) return null;
  const verified = [...roots.values()].filter((r) => !isZero(r));
  return { wallets: all.length, verifiedWallets: verified.length, verifiedPeople: new Set(verified).size };
}
