/**
 * Who has used GoodCash, counted as people rather than wallets. Every wallet that has made a top-up or a cash out is
 * looked up in GoodDollar's Identity contract: a wallet that belongs to a verified person has that person's "root", and
 * several wallets of one person share it, so a person counts once.
 *
 * "Verified" means GoodDollar has verified the person, even if that verification has since run out: GoodDollar's
 * first verification lasts only 3 days (later ones 180), so counting only people verified right now made the number
 * fall every time a new person's 3 days ended. A wallet whose verification ran out counts as its own person, since its
 * other wallets can't be linked any more. Blacklisted wallets never count. Counts only.
 */
import { everVerifiedOf, isZero, rootsOf, type VerifiedEnv } from './verified';

export interface PeopleSummary {
  /** Different wallets that have used GoodCash */
  wallets: number;
  /** Of those, wallets GoodDollar has verified (now, or earlier and since run out) */
  verifiedWallets: number;
  /** Different verified people behind those wallets */
  verifiedPeople: number;
  /** Wallets whose verification is current right now */
  verifiedNow: number;
}

export async function summarisePeople(env: VerifiedEnv, wallets: Iterable<string>): Promise<PeopleSummary | null> {
  const all = [...new Set([...wallets].map((w) => w.toLowerCase()))];
  const [roots, ever] = await Promise.all([rootsOf(env, all), everVerifiedOf(env, all)]);
  if (!roots || !ever) return null;
  const people = new Set<string>();
  let verifiedWallets = 0;
  let verifiedNow = 0;
  for (const w of all) {
    const root = roots.get(w) ?? '0x' + '0'.repeat(40);
    if (!isZero(root)) {
      verifiedNow++;
      verifiedWallets++;
      people.add(root);
    } else if (ever.get(w)) {
      verifiedWallets++;
      people.add(w);
    }
  }
  return { wallets: all.length, verifiedWallets, verifiedPeople: people.size, verifiedNow };
}
