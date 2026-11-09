/** Amounts and fees. Pure functions: the fee percent is always passed in, never read from settings here. */

/** Decimal text ("12.5") to whole units with `decimals` places. Extra decimals are cut off (never rounded up). */
export function parseDecimal(value: string, decimals: number): bigint {
  if (!/^\d+(\.\d+)?$/.test(value)) throw new Error('Not a decimal number');
  const [whole, fraction = ''] = value.split('.');
  return BigInt(whole) * 10n ** BigInt(decimals) + BigInt((fraction + '0'.repeat(decimals)).slice(0, decimals) || '0');
}

/** Whole units back to decimal text with all `decimals` places ("1.500000"). */
export function formatAtomic(v: bigint, decimals: number): string {
  const neg = v < 0n;
  const a = neg ? -v : v;
  const base = 10n ** BigInt(decimals);
  const frac = (a % base).toString().padStart(decimals, '0');
  return `${neg ? '-' : ''}${a / base}${decimals > 0 ? `.${frac}` : ''}`;
}

/**
 * G$ amount (a number) to exact on-chain units (18 decimals).
 * Rounds DOWN to 6 decimals first, so the result can never exceed what the user typed or holds.
 */
export function gToWei(amountG: number): bigint {
  if (!Number.isFinite(amountG) || amountG <= 0) return 0n;
  const v = Math.floor(amountG * 1e6) / 1e6;
  return parseDecimal(v.toFixed(6), 18);
}

/** The payout partner keeps about this much of every payout as its fee. */
export const PAYOUT_FEE_RESERVE_USDT = 0.02;
export const PAYOUT_FEE_RESERVE_ATOMIC = 20_000n;
/** The payout partner's smallest order, in dollars. */
export const PAYOUT_MIN_USDT = 0.5;
/** No fee setting (ours plus a partner's) may ever go above this. */
export const MAX_TOTAL_FEE_PERCENT = 5;

/** A fee percent from settings: anything invalid, zero, negative or above the cap means no fee. */
export function clampFeePercent(raw: unknown): number {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 && n <= MAX_TOTAL_FEE_PERCENT ? n : 0;
}

/**
 * The part of the dollars that is paid out to the bank: what is left after the partner's fee, divided by (1 + fee %),
 * because the fee is added on top of the payout amount. Never negative.
 */
export function payoutUsdt(usdt: number, feePercent: number): number {
  return Math.max(0, usdt - PAYOUT_FEE_RESERVE_USDT) / (1 + feePercent / 100);
}

/** What a customer really receives in naira for a given amount of dollars: after all fees, never negative. */
export function nairaFromUsdt(usdt: number, ngnPerUsdt: number, feePercent: number): number {
  return payoutUsdt(usdt, feePercent) * ngnPerUsdt;
}

/** The fee in naira on that cash out (0 when there is no fee). */
export function feeNaira(usdt: number, ngnPerUsdt: number, feePercent: number): number {
  return payoutUsdt(usdt, feePercent) * (feePercent / 100) * ngnPerUsdt;
}
