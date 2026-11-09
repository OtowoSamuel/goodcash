import { feeNaira, gToWei as coreGToWei, nairaFromUsdt as coreNairaFromUsdt, payoutUsdt as corePayoutUsdt, PAYOUT_FEE_RESERVE_USDT as CORE_RESERVE } from '@goodcash/core/units';

/**
 * G$ amount (a JavaScript number) to exact on-chain units (18 decimals).
 * Rounds DOWN to 6 decimals first, so the result can never exceed what the user typed or holds.
 */
export const gToWei = coreGToWei;

/** Paycrest keeps about this much of every payout as its fee, so the customer gets (dollars - this) in naira. */
export const PAYOUT_FEE_RESERVE_USDT = CORE_RESERVE;

/**
 * GoodCash's own fee, as a percent of each cash out (0 = no fee). It is set at build time and must match the
 * server's SENDER_FEE_PERCENT, so what the screen shows is what is charged. Capped at 5 so a typo cannot show
 * or charge a large fee.
 */
const rawFee = Number(import.meta.env?.VITE_GOODCASH_FEE_PERCENT);
export const GOODCASH_FEE_PERCENT: number = Number.isFinite(rawFee) && rawFee > 0 && rawFee <= 5 ? rawFee : 0;

/** The part of the dollars that is paid out to the bank, after the partner's fee and ours. Never negative. */
export function payoutUsdt(usdt: number, feePercent: number = GOODCASH_FEE_PERCENT): number {
  return corePayoutUsdt(usdt, feePercent);
}

/** What a customer really receives in naira for a given amount of dollars: after both fees, never negative. */
export function nairaFromUsdt(usdt: number, ngnPerUsdt: number, feePercent: number = GOODCASH_FEE_PERCENT): number {
  return coreNairaFromUsdt(usdt, ngnPerUsdt, feePercent);
}

/** GoodCash's fee in naira on that cash out (0 when there is no fee). */
export function goodcashFeeNaira(usdt: number, ngnPerUsdt: number, feePercent: number = GOODCASH_FEE_PERCENT): number {
  return feeNaira(usdt, ngnPerUsdt, feePercent);
}
