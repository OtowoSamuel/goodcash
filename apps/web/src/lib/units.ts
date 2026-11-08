import { parseUnits } from 'viem';

/**
 * G$ amount (a JavaScript number) to exact on-chain units (18 decimals).
 * Rounds DOWN to 6 decimals first, so the result can never exceed what the user typed or holds,
 * and never carries floating-point noise like 1234.5670000000000073.
 */
export function gToWei(amountG: number): bigint {
  if (!Number.isFinite(amountG) || amountG <= 0) return 0n;
  const v = Math.floor(amountG * 1e6) / 1e6;
  return parseUnits(v.toFixed(6), 18);
}

/** Paycrest keeps about this much of every payout as its fee, so the customer gets (dollars - this) in naira. */
export const PAYOUT_FEE_RESERVE_USDT = 0.02;

/** What a customer really receives in naira for a given amount of dollars: after the payout fee, never negative. */
export function nairaFromUsdt(usdt: number, ngnPerUsdt: number): number {
  return Math.max(0, usdt - PAYOUT_FEE_RESERVE_USDT) * ngnPerUsdt;
}
