/**
 * Live prices read straight from Celo with plain eth_call, so the browser, the SDK and the server all use the
 * same maths. Pass any function that performs an eth_call.
 */
import { BROKER, EXCHANGE_ID, EXCHANGE_PROVIDER, G_DOLLAR, QUOTER_V2, SELECTORS, SORTED_ORACLES, USDM, USDM_USDT_FEE, USDT } from './addresses';
import { addressWord, bytes32Word, readWord, uintWord, type Hex } from './hex';
import { EXIT_CONTRIBUTION_BPS, getNetQuote, ONE_18, type QuoteChainState, type QuoteResult } from './quote';

export type EthCall = (to: Hex, data: Hex) => Promise<Hex>;

export function encodeBalanceOf(owner: Hex): Hex {
  return `${SELECTORS.balanceOf}${addressWord(owner)}` as Hex;
}

export function encodeReserveGetAmountOut(amountG: bigint): Hex {
  return `${SELECTORS.getAmountOut}${addressWord(EXCHANGE_PROVIDER)}${bytes32Word(EXCHANGE_ID)}${addressWord(G_DOLLAR)}${addressWord(USDM)}${uintWord(amountG)}` as Hex;
}

export function encodeQuoteUsdmToUsdt(amountUsdm: bigint): Hex {
  // static tuple (tokenIn, tokenOut, amountIn, fee, sqrtPriceLimitX96) is encoded inline
  return `${SELECTORS.quoteExactInputSingle}${addressWord(USDM)}${addressWord(USDT)}${uintWord(amountUsdm)}${uintWord(BigInt(USDM_USDT_FEE))}${uintWord(0n)}` as Hex;
}

export function encodeMedianRate(token: Hex = USDM): Hex {
  return `${SELECTORS.medianRate}${addressWord(token)}` as Hex;
}

/** The two on-chain results expressed in the units the quote maths uses. */
export function chainStateFromReads(amountG: bigint, netUsdm: bigint, usdtOut: bigint): QuoteChainState {
  const grossDivisor = 10_000n - EXIT_CONTRIBUTION_BPS;
  return {
    reserveCurrentPriceRaw: (netUsdm * ONE_18 * 10_000n) / (amountG * grossDivisor),
    // usdtOut = netUsdm * rate * 1e6 / 1e36  =>  rate = usdtOut * 1e30 / netUsdm
    usdmToUsdtRateRaw: (usdtOut * 10n ** 30n) / netUsdm,
  };
}

/** Read the real reserve and Uniswap prices for this exact amount. Throws if either read fails. */
export async function fetchLiveChainState(amountG: bigint, ethCall: EthCall): Promise<QuoteChainState> {
  if (amountG <= 0n) throw new Error('Amount must be positive');
  const netUsdm = readWord(await ethCall(BROKER, encodeReserveGetAmountOut(amountG)), 0);
  if (netUsdm <= 0n) throw new Error('Reserve returned no quote');
  const usdtOut = readWord(await ethCall(QUOTER_V2, encodeQuoteUsdmToUsdt(netUsdm)), 0);
  if (usdtOut <= 0n) throw new Error('Uniswap returned no quote');
  return chainStateFromReads(amountG, netUsdm, usdtOut);
}

/** A quote from live prices, through the GoodDollar reserve (the route production uses). */
export async function getLiveQuote(amountG: bigint, ethCall: EthCall, ngnPerUsdt?: number, now = Date.now()): Promise<QuoteResult> {
  const chainState = await fetchLiveChainState(amountG, ethCall);
  return getNetQuote({ amountIn: amountG, route: 'reserve', chainState, ngnPerUsdt, now });
}

/** Dollars per CELO from Celo's own price feed, or null. */
export async function fetchCeloUsd(ethCall: EthCall): Promise<number | null> {
  try {
    const out = await ethCall(SORTED_ORACLES, encodeMedianRate());
    const v = Number(readWord(out, 0)) / Number(readWord(out, 1));
    return Number.isFinite(v) && v > 0 ? v : null;
  } catch {
    return null;
  }
}
