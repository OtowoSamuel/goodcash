/**
 * The network fee for a cash out, paid in CELO by the wallet (never in G$).
 * Measured on real cash outs (Nov 2026): one-tap uses ~1M gas (wallet limit ~1.16M). A wallet only sends when it holds
 * gas limit x max fee, so the balance we ask for is higher than what is actually spent.
 */
export type CashOutFlow = 'one-tap' | 'three-step';

export const FEE_GAS: Record<CashOutFlow, { used: bigint; limit: bigint }> = {
  'one-tap': { used: 1_000_000n, limit: 1_160_000n },
  'three-step': { used: 1_000_000n, limit: 1_150_000n },
};
/** Wallets set their max fee above today's price, so ask for 50% headroom. */
const HEADROOM_NUM = 3n;
const HEADROOM_DEN = 2n;

export interface NetworkFeeInfo {
  /** What a cash out usually costs, in CELO */
  feeCelo: number;
  /** What the wallet must hold before it will send, in CELO */
  needCelo: number;
  haveCelo: number;
  enough: boolean;
  /** Dollars per CELO, when the price feed answered */
  celoUsd: number | null;
}

export function networkFeeFrom(args: { balanceWei: bigint; gasPriceWei: bigint; flow: CashOutFlow; celoUsd: number | null }): NetworkFeeInfo {
  const g = FEE_GAS[args.flow];
  const fee = g.used * args.gasPriceWei;
  const need = (g.limit * args.gasPriceWei * HEADROOM_NUM) / HEADROOM_DEN;
  const toCelo = (w: bigint) => Number(w) / 1e18;
  return { feeCelo: toCelo(fee), needCelo: toCelo(need), haveCelo: toCelo(args.balanceWei), enough: args.balanceWei >= need, celoUsd: args.celoUsd };
}

/** Rounds CELO up so we never ask for less than needed. */
export function celoText(v: number): string {
  if (v <= 0) return '0';
  return (Math.ceil(v * 100) / 100).toFixed(2);
}
