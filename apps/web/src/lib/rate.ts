import { gToWei, nairaFromUsdt } from './units';
import { getNetQuote } from './quote';

export const PAYCREST_RATE_URL = 'https://api.paycrest.io/v2/rates/celo/USDT/1/NGN?side=sell';
export const ORDERS_API_BASE =
  (typeof import.meta !== 'undefined' &&
    (import.meta as { env?: { VITE_ORDERS_API_URL?: string } }).env?.VITE_ORDERS_API_URL) ??
  'http://localhost:8787';
export { MIN_NET_USDT_REQUIRED } from '@goodcash/core/oneTap'; // Unified swap floor ($0.50 Paycrest min + $0.02 Paycrest fee + margin)
import { MIN_NET_USDT_REQUIRED } from '@goodcash/core/oneTap';
export const GOODCASH_G_TO_USD_RATE = 126_658_838_063_094n / 1_000_000_000_000_000n;

export interface CashoutRate {
  gAmount: number;
  grossUsd: number;
  exitContributionG: number;
  exitContributionUsd: number;
  netUsdt: number;
  netNaira: number;
  minimumReached: boolean;
  remainingUsdt: number;
  remainingG: number;
  daysToMinimum: number;
  netUsdtPerG: number;
  rateUnavailable: boolean;
  ngnPerUsdt: number | null;
}

export async function fetchPaycrestRate(): Promise<number> {
  // 1. Try Paycrest direct first (Paycrest sends Access-Control-Allow-Origin: *)
  try {
    const response = await fetch(PAYCREST_RATE_URL, {
      headers: {
        Accept: 'application/json',
      },
    });

    if (response.ok) {
      const payload = (await response.json()) as {
        data?: {
          sell?: { rate?: string | number | null };
        };
      };

      const sellRate = payload?.data?.sell?.rate;
      if (sellRate === undefined || sellRate === null || sellRate === '') {
        throw new Error('Rate unavailable, try again');
      }

      const rate = Number(sellRate);
      if (!Number.isFinite(rate) || rate <= 0) {
        throw new Error('Rate unavailable, try again');
      }

      return rate;
    }
  } catch (err: unknown) {
    if (err instanceof Error && err.message === 'Rate unavailable, try again') {
      throw err;
    }
    // Network / CORS failure, route through orders service fallback below
  }

  // 2. If direct fetch is blocked by CORS or fails, route through the orders service
  try {
    const fallbackRes = await fetch(`${ORDERS_API_BASE}/rates`, {
      headers: {
        Accept: 'application/json',
      },
    });

    if (!fallbackRes.ok) {
      throw new Error('Paycrest rate unavailable');
    }

    const payload = (await fallbackRes.json()) as {
      data?: {
        sell?: { rate?: string | number | null };
      };
    };

    const sellRate = payload?.data?.sell?.rate;
    if (sellRate === undefined || sellRate === null || sellRate === '') {
      throw new Error('Rate unavailable, try again');
    }

    const rate = Number(sellRate);
    if (!Number.isFinite(rate) || rate <= 0) {
      throw new Error('Rate unavailable, try again');
    }

    return rate;
  } catch {
    throw new Error('Paycrest rate unavailable');
  }
}

export function getCashoutRate(gAmount: number, dailyClaimG = 123.48, ngnPerUsdt?: number | null): CashoutRate {
  const safeGAmount = Number.isFinite(gAmount) && gAmount > 0 ? gAmount : 0;
  const amountInRaw = gToWei(safeGAmount);
  const effectiveNgnRate = Number.isFinite(ngnPerUsdt) ? (ngnPerUsdt as number) : null;
  // The payout floor must depend only on USDT out and the G$ price, never on NGN.
  const quote = getNetQuote({ amountIn: amountInRaw });

  const grossUsd = Number(quote.grossUsdm) / 1e18;
  const netUsdt = Number(quote.usdtOut) / 1e6;
  const exitContributionG = safeGAmount * 0.1;
  const exitContributionUsd = grossUsd * 0.1;
  const netNaira = effectiveNgnRate !== null ? nairaFromUsdt(netUsdt, effectiveNgnRate) : Number.NaN;
  const minimumReached = netUsdt >= MIN_NET_USDT_REQUIRED;
  const remainingUsdt = Math.max(0, MIN_NET_USDT_REQUIRED - netUsdt);
  const netUsdtPerG = safeGAmount > 0 ? netUsdt / safeGAmount : 0;
  const remainingG = netUsdtPerG > 0 ? remainingUsdt / netUsdtPerG : 0;
  const daysToMinimum = remainingG > 0 ? Math.ceil(remainingG / dailyClaimG) : 0;

  return {
    gAmount: safeGAmount,
    grossUsd,
    exitContributionG,
    exitContributionUsd,
    netUsdt,
    netNaira: Number.isFinite(netNaira) ? netNaira : Number.NaN,
    minimumReached,
    remainingUsdt,
    remainingG,
    daysToMinimum,
    netUsdtPerG,
    rateUnavailable: effectiveNgnRate === null,
    ngnPerUsdt: effectiveNgnRate,
  };
}

/**
 * Smallest cash out, in G$, that clears the payout floor at the current G$ price.
 * Rounded up to the next 10 with a 1% margin so a small price move cannot push a customer under it.
 */
export function getMinimumCashOutG(): number {
  const perG = getCashoutRate(5000).netUsdtPerG;
  if (!perG) return 0;
  return Math.ceil((MIN_NET_USDT_REQUIRED / perG) * 1.01 / 10) * 10;
}

export function getBalanceProgressPercent(gAmount: number): number {
  const { netUsdt } = getCashoutRate(gAmount);
  return Math.min(100, Math.round((netUsdt / MIN_NET_USDT_REQUIRED) * 100));
}

export function formatNaira(naira: number): string {
  return '₦' + Math.round(naira).toLocaleString();
}
