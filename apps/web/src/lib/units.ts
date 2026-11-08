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

/**
 * GoodCash's own fee, as a percent of each cash out (0 = no fee). It is set at build time and must match the
 * server's SENDER_FEE_PERCENT, so what the screen shows is what is charged. Capped at 5 so a typo cannot show
 * or charge a large fee.
 */
const rawFee = Number(import.meta.env?.VITE_GOODCASH_FEE_PERCENT);
export const GOODCASH_FEE_PERCENT: number = Number.isFinite(rawFee) && rawFee > 0 && rawFee <= 5 ? rawFee : 0;

/**
 * The part of the dollars that is paid out to the bank: what is left after the partner's fee, divided by (1 + our fee),
 * because the partner adds our fee on top of the payout amount. Never negative.
 */
export function payoutUsdt(usdt: number, feePercent: number = GOODCASH_FEE_PERCENT): number {
  return Math.max(0, usdt - PAYOUT_FEE_RESERVE_USDT) / (1 + feePercent / 100);
}

/** What a customer really receives in naira for a given amount of dollars: after both fees, never negative. */
export function nairaFromUsdt(usdt: number, ngnPerUsdt: number, feePercent: number = GOODCASH_FEE_PERCENT): number {
  return payoutUsdt(usdt, feePercent) * ngnPerUsdt;
}

/** GoodCash's fee in naira on that cash out (0 when there is no fee). */
export function goodcashFeeNaira(usdt: number, ngnPerUsdt: number, feePercent: number = GOODCASH_FEE_PERCENT): number {
  return payoutUsdt(usdt, feePercent) * (feePercent / 100) * ngnPerUsdt;
}
