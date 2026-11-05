import { describe, expect, it } from 'vitest';

import {
  EXIT_CONTRIBUTION_BPS,
  ONE_18,
  ONE_6,
  assertFreshQuote,
  getNetQuote,
  getReserveQuote,
  getUniswapQuote,
  getUsdmToUsdtQuote,
  selectBestRoute
} from './quote';

describe('quote engine', () => {
  it('enforces the exact 10% exit contribution', () => {
    const amountIn = 1_000n * ONE_18;
    const reserveQuote = getReserveQuote(amountIn);

    expect(reserveQuote.exitContributionBps).toBe(EXIT_CONTRIBUTION_BPS);
    expect(reserveQuote.netUsdm).toBe((reserveQuote.grossUsdm * (10_000n - EXIT_CONTRIBUTION_BPS)) / 10_000n);

    const quote = getNetQuote({ amountIn });
    expect(quote.route).toBe('reserve');
    expect(quote.exitContributionBps).toBe(EXIT_CONTRIBUTION_BPS);
    expect(quote.netUsdm).toBe(reserveQuote.netUsdm);
  });

  it('falls back to uniswap when reserve is paused', () => {
    const amountIn = 1_000n * ONE_18;
    const route = selectBestRoute({
      amountIn,
      chainState: {
        reservePaused: true,
        uniswapPriceRaw: 113_135_376_000_000n,
        poolDepthUsdm: 50_000n * ONE_18
      }
    });

    expect(route).toBe('uniswap');

    const quote = getNetQuote({
      amountIn,
      chainState: {
        reservePaused: true,
        uniswapPriceRaw: 113_135_376_000_000n,
        poolDepthUsdm: 50_000n * ONE_18
      }
    });

    expect(quote.route).toBe('uniswap');
  });

  it('rejects thin uniswap depth', () => {
    const amountIn = 50_000n * ONE_18;

    expect(() =>
      getNetQuote({
        amountIn,
        route: 'uniswap',
        chainState: {
          uniswapPriceRaw: 113_135_376_000_000n,
          poolDepthUsdm: 1_000n * ONE_18
        }
      })
    ).toThrow('Uniswap route refused');
  });

  it('converts 18-decimal USDm amounts to 6-decimal USDT amounts', () => {
    const amountUsdm = 123n * ONE_18;
    const usdtOut = getUsdmToUsdtQuote(amountUsdm);

    expect(usdtOut).toBe(123n * ONE_6);
  });

  it('refuses stale quotes', () => {
    const quote = getNetQuote({
      amountIn: 1_000n * ONE_18,
      now: 1_000
    });

    expect(() => assertFreshQuote(quote, 40_000)).toThrow('Quote expired');
  });

  it('keeps the uniswap math consistent with the expected route data', () => {
    const amountIn = 1_000n * ONE_18;
    const uniswapQuote = getUniswapQuote(amountIn, {
      uniswapPriceRaw: 113_135_376_000_000n,
      poolDepthUsdm: 50_000n * ONE_18
    });

    expect(uniswapQuote.grossUsdm).toBe((amountIn * 113_135_376_000_000n) / ONE_18);
    expect(uniswapQuote.priceImpactBps).toBeLessThan(1_000n);
  });

  it('refuses execution when the uniswap route exceeds the 10% price impact cap', () => {
    const amountIn = 100_000n * ONE_18;

    expect(() =>
      getNetQuote({
        amountIn,
        route: 'uniswap',
        chainState: {
          uniswapPriceRaw: 113_135_376_000_000n,
          poolDepthUsdm: 100n * ONE_18
        }
      })
    ).toThrow('Uniswap route refused');
  });
});
