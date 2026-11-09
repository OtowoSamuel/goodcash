/**
 * What a cash out is worth right now, with every fee line. Live keys read the real prices on Celo (the same reads
 * and maths as goodcash.xyz, from @goodcash/core). Test keys use fixed prices so partners' tests are repeatable.
 */
import { computeOneTapMinOut, gToWei, getLiveQuote, getNetQuote, parseDecimal, payoutUsdt, PAYOUT_FEE_RESERVE_USDT, type EthCall, type Hex } from '@goodcash/core';
import { V1Error } from './http';
import type { Env, Mode, Partner, V1Deps } from './types';

export const TEST_NGN_PER_USD = 1500;
export const MAX_PARTNER_FEE_PERCENT = 3;

export interface Priced {
  amountG: string;
  amountWei: bigint;
  usdtOut: bigint;
  minOut: bigint;
  ngnPerUsd: number;
  goodcashFeePercent: number;
  partnerFeePercent: number;
  feePercent: number;
  naira: number;
  minimumNaira: number;
  exitContributionG: number;
}

export function feesFor(env: Env, partner: Partner, deps: V1Deps): { goodcash: number; partner: number; total: number } {
  const goodcash = deps.goodcashFeePercent(env);
  const p = Number.isFinite(partner.feePercent) && partner.feePercent > 0 ? Math.min(partner.feePercent, MAX_PARTNER_FEE_PERCENT) : 0;
  // A partner fee is collected through the same fee setting as ours, so it needs our fee address configured
  const partnerPct = /^0x[0-9a-fA-F]{40}$/.test(env.SENDER_FEE_ADDRESS ?? '') ? p : 0;
  const total = Math.round((goodcash + partnerPct) * 100) / 100;
  return { goodcash, partner: partnerPct, total: Math.min(total, 5) };
}

export function maxG(env: Env): number {
  const n = Number(env.PARTNER_MAX_G);
  return Number.isFinite(n) && n > 0 ? n : 1_000_000;
}

export function parseAmountG(raw: unknown): { amountG: string; amountWei: bigint } {
  const text = typeof raw === 'number' ? String(raw) : typeof raw === 'string' ? raw.trim() : '';
  if (!/^\d+(\.\d{1,6})?$/.test(text)) throw new V1Error('invalid_request', 'amountG must be a positive G$ amount with at most 6 decimals, e.g. "5000".');
  const amountWei = parseDecimal(text, 18);
  if (amountWei <= 0n) throw new V1Error('invalid_request', 'amountG must be more than 0.');
  return { amountG: text, amountWei };
}

export function ethCallVia(env: Env, deps: V1Deps): EthCall {
  return async (to: Hex, data: Hex) => (await deps.rpcCall(env, 'eth_call', [{ to, data }, 'latest'])) as Hex;
}

export async function priceCashOut(env: Env, deps: V1Deps, partner: Partner, mode: Mode, amountG: string, amountWei: bigint): Promise<Priced> {
  if (Number(amountG) > maxG(env)) throw new V1Error('amount_too_large', `The largest single cash out is ${maxG(env).toLocaleString('en-US')} G$.`);
  const fees = feesFor(env, partner, deps);

  let quote;
  let rate: number | null;
  if (mode === 'test') {
    quote = getNetQuote({ amountIn: amountWei, route: 'reserve' });
    rate = TEST_NGN_PER_USD;
  } else {
    try {
      [quote, rate] = await Promise.all([getLiveQuote(amountWei, ethCallVia(env, deps)), deps.fetchNgnRate(env)]);
    } catch (e) {
      throw new V1Error('price_unavailable', `Reading prices on Celo failed: ${(e as Error).message?.slice(0, 120)}`);
    }
  }
  if (!rate) throw new V1Error('price_unavailable', 'The naira rate is not available right now.');

  const minOut = computeOneTapMinOut(quote);
  const usdt = Number(quote.usdtOut) / 1e6;
  const naira = Math.floor(payoutUsdt(usdt, fees.total) * rate * 100) / 100;
  const minimumNaira = Math.floor(payoutUsdt(Number(minOut) / 1e6, fees.total) * rate * 100) / 100;
  return {
    amountG,
    amountWei,
    usdtOut: quote.usdtOut,
    minOut,
    ngnPerUsd: rate,
    goodcashFeePercent: fees.goodcash,
    partnerFeePercent: fees.partner,
    feePercent: fees.total,
    naira,
    minimumNaira,
    exitContributionG: Number(amountG) * 0.1,
  };
}

/** Fee lines in plain words, as a customer should see them. */
export function feeLines(p: Priced, partnerName: string) {
  const payout = payoutUsdt(Number(p.usdtOut) / 1e6, p.feePercent);
  const nairaOf = (pct: number) => Math.round(payout * (pct / 100) * p.ngnPerUsd * 100) / 100;
  const lines: Array<{ type: string; label: string; percent?: number; amountG?: string; naira?: number }> = [
    { type: 'gooddollar_contribution', label: 'GoodDollar contribution (10%)', percent: 10, amountG: p.exitContributionG.toFixed(2) },
  ];
  if (p.goodcashFeePercent > 0) lines.push({ type: 'goodcash_fee', label: `GoodCash fee (${p.goodcashFeePercent}%)`, percent: p.goodcashFeePercent, naira: nairaOf(p.goodcashFeePercent) });
  if (p.partnerFeePercent > 0) lines.push({ type: 'partner_fee', label: `${partnerName} fee (${p.partnerFeePercent}%)`, percent: p.partnerFeePercent, naira: nairaOf(p.partnerFeePercent) });
  lines.push({ type: 'payout_fee', label: 'Bank payout fee', naira: Math.round(PAYOUT_FEE_RESERVE_USDT * p.ngnPerUsd * 100) / 100 });
  return lines;
}

/** Smallest G$ that pays out after every fee, rounded up to 10 G$ with a 1% margin. */
export function minimumG(p: Priced): number {
  const perG = Number(p.usdtOut) / 1e6 / Number(p.amountG);
  if (!(perG > 0)) return 0;
  // order amount = (minOut - 0.02) / (1 + fee) must be >= 0.50; minOut = 99.5% of the swap
  const needUsdt = (0.5 * (1 + p.feePercent / 100) + 0.02) / 0.995;
  return Math.ceil(((needUsdt / perG) * 1.01) / 10) * 10;
}

export { gToWei };
