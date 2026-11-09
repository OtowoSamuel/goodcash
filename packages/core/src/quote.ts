// Paycrest keeps about 0.02 USDT of each payout, so naira estimates are for (dollars - 0.02)
const PAYOUT_FEE_RESERVE_ATOMIC = 20_000n;
export const ONE_18 = 10n ** 18n;
export const ONE_6 = 10n ** 6n;
export const EXIT_CONTRIBUTION_BPS = 1000n;
export const MAX_PRICE_IMPACT_BPS = 1000n;
export const MAX_ROUTE_DELTA_BPS = 100n;
export const QUOTE_TTL_MS = 30_000;
const DEFAULT_POOL_DEPTH_USDM = 1_000_000n * ONE_18;

export type QuoteRoute = 'reserve' | 'uniswap';

export interface QuoteChainState {
  reserveCurrentPriceRaw?: bigint;
  reservePaused?: boolean;
  reserveLimitReached?: boolean;
  reserveDepthUsdm?: bigint;
  uniswapPriceRaw?: bigint;
  poolDepthUsdm?: bigint;
  usdmToUsdtRateRaw?: bigint;
  networkFeeUsdRaw?: bigint;
  partnerFeeUsdRaw?: bigint;
}

export interface QuoteResult {
  amountInG$: bigint;
  grossUsdm: bigint;
  netUsdm: bigint;
  usdtOut: bigint;
  priceImpactBps: bigint;
  exitContributionBps: bigint;
  swapFeeBps: bigint;
  networkFeeUsd: bigint;
  partnerFeeUsd: bigint;
  netNaira: bigint;
  route: QuoteRoute;
  quotedAt: number;
  expiresAt: number;
}

export interface GetNetQuoteArgs {
  amountIn: bigint | string;
  route?: QuoteRoute;
  now?: number;
  chainState?: QuoteChainState;
  ngnPerUsdt?: number;
}

export interface RouteSelectionArgs {
  amountIn: bigint | string;
  chainState?: QuoteChainState;
}

function toBigInt(value: bigint | string): bigint {
  return typeof value === 'bigint' ? value : BigInt(value);
}

function safeDiv(numerator: bigint, denominator: bigint): bigint {
  if (denominator === 0n) {
    throw new Error('Division by zero in quote calculation');
  }
  return numerator / denominator;
}

function clampBps(value: bigint): bigint {
  return value < 0n ? 0n : value;
}

function computePercentDifference(numerator: bigint, denominator: bigint): bigint {
  if (denominator === 0n) {
    return 0n;
  }

  return safeDiv((numerator > denominator ? numerator - denominator : denominator - numerator) * 10_000n, denominator);
}

export function getReserveQuote(
  amountIn: bigint | string,
  chainState: QuoteChainState = {}
): {
  grossUsdm: bigint;
  netUsdm: bigint;
  exitContributionBps: bigint;
  priceImpactBps: bigint;
  swapFeeBps: bigint;
} {
  const amount = toBigInt(amountIn);
  const reserveCurrentPriceRaw = chainState.reserveCurrentPriceRaw ?? 126_658_838_063_094n;
  const grossUsdm = safeDiv(amount * reserveCurrentPriceRaw, ONE_18);
  const netUsdm = safeDiv(grossUsdm * (10_000n - EXIT_CONTRIBUTION_BPS), 10_000n);

  return {
    grossUsdm,
    netUsdm,
    exitContributionBps: EXIT_CONTRIBUTION_BPS,
    priceImpactBps: 0n,
    swapFeeBps: 0n
  };
}

export function getUniswapQuote(
  amountIn: bigint | string,
  chainState: QuoteChainState = {}
): {
  grossUsdm: bigint;
  netUsdm: bigint;
  exitContributionBps: bigint;
  priceImpactBps: bigint;
  swapFeeBps: bigint;
} {
  const amount = toBigInt(amountIn);
  const uniswapPriceRaw = chainState.uniswapPriceRaw ?? 113_135_376_000_000n;
  const grossUsdm = safeDiv(amount * uniswapPriceRaw, ONE_18);
  const impactBps = clampBps(safeDiv(amount * 100n, chainState.poolDepthUsdm ?? DEFAULT_POOL_DEPTH_USDM));

  return {
    grossUsdm,
    netUsdm: grossUsdm,
    exitContributionBps: 0n,
    priceImpactBps: impactBps,
    swapFeeBps: 100n
  };
}

export function getUsdmToUsdtQuote(
  amountUsdm: bigint | string,
  chainState: QuoteChainState = {}
): bigint {
  const amount = toBigInt(amountUsdm);
  const rateRaw = chainState.usdmToUsdtRateRaw ?? ONE_18;
  return safeDiv(amount * rateRaw * ONE_6, ONE_18 * ONE_18);
}

export function selectBestRoute({ amountIn, chainState = {} }: RouteSelectionArgs): QuoteRoute {
  const amount = toBigInt(amountIn);
  const reserve = getReserveQuote(amount, chainState);
  const uniswap = getUniswapQuote(amount, chainState);

  const poolDepth = chainState.poolDepthUsdm ?? DEFAULT_POOL_DEPTH_USDM;

  if (chainState.reservePaused || chainState.reserveLimitReached) {
    if (uniswap.priceImpactBps > MAX_PRICE_IMPACT_BPS || poolDepth < amount * 10n) {
      throw new Error('Uniswap route refused: impact or depth violates limits');
    }
    return 'uniswap';
  }

  const reserveDeltaBps = computePercentDifference(reserve.netUsdm, uniswap.netUsdm);

  if (reserveDeltaBps <= MAX_ROUTE_DELTA_BPS) {
    return 'reserve';
  }

  if (uniswap.priceImpactBps > MAX_PRICE_IMPACT_BPS || poolDepth < amount * 10n) {
    throw new Error('Uniswap route refused: impact or depth violates limits');
  }

  return 'uniswap';
}

export function getNetQuote({
  amountIn,
  route,
  now = Date.now(),
  chainState = {},
  ngnPerUsdt,
}: GetNetQuoteArgs): QuoteResult {
  const amount = toBigInt(amountIn);
  const chosenRoute = route ?? selectBestRoute({ amountIn: amount, chainState });
  const reserve = getReserveQuote(amount, chainState);
  const uniswap = getUniswapQuote(amount, chainState);

  if (chosenRoute === 'uniswap') {
    const poolDepth = chainState.poolDepthUsdm ?? DEFAULT_POOL_DEPTH_USDM;
    if (uniswap.priceImpactBps > MAX_PRICE_IMPACT_BPS || poolDepth < amount * 10n) {
      throw new Error('Uniswap route refused: impact or depth violates limits');
    }
  }

  const routeQuote = chosenRoute === 'reserve' ? reserve : uniswap;
  const grossUsdm = routeQuote.grossUsdm;
  const netUsdm = routeQuote.netUsdm;
  const usdtOut = getUsdmToUsdtQuote(netUsdm, chainState);
  const networkFeeUsd = chainState.networkFeeUsdRaw ?? 0n;
  const partnerFeeUsd = chainState.partnerFeeUsdRaw ?? 0n;
  const netNaira = Number.isFinite(ngnPerUsdt)
    ? safeDiv((usdtOut > PAYOUT_FEE_RESERVE_ATOMIC ? usdtOut - PAYOUT_FEE_RESERVE_ATOMIC : 0n) * BigInt(Math.round((ngnPerUsdt as number) * 1_000_000)), 1_000_000n)
    : 0n;

  const quote: QuoteResult = {
    amountInG$: amount,
    grossUsdm,
    netUsdm,
    usdtOut,
    priceImpactBps: routeQuote.priceImpactBps,
    exitContributionBps: chosenRoute === 'reserve' ? EXIT_CONTRIBUTION_BPS : 0n,
    swapFeeBps: routeQuote.swapFeeBps,
    networkFeeUsd,
    partnerFeeUsd,
    netNaira,
    route: chosenRoute,
    quotedAt: now,
    expiresAt: now + QUOTE_TTL_MS
  };

  return quote;
}

export function assertFreshQuote(quote: QuoteResult, nowMs = Date.now()): QuoteResult {
  if (nowMs > quote.expiresAt) {
    throw new Error('Quote expired');
  }
  return quote;
}
