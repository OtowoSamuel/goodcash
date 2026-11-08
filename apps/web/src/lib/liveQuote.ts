import { createPublicClient, http, parseAbi, type Address } from 'viem';
import { celo } from 'viem/chains';
import { getNetQuote, ONE_18, EXIT_CONTRIBUTION_BPS, type QuoteChainState, type QuoteResult } from './quote';
import { CELO_RPC_URL, G_DOLLAR_ADDRESS, USDT_ADDRESS } from './router';

/** Live on-chain prices are used in production builds. Dev and tests keep the fixed prices. */
export const LIVE_QUOTES: boolean =
  typeof import.meta !== 'undefined' && Boolean((import.meta as { env?: { PROD?: boolean } }).env?.PROD);

// GoodDollar reserve (Mento broker) used by the router for the G$ -> USDm hop
const BROKER: Address = '0x88de45906D4F5a57315c133620cfa484cB297541';
const EXCHANGE_PROVIDER: Address = '0x2fFBB49055d487DdBBb0C052Cd7c2a02A7971e41';
const EXCHANGE_ID = '0xba77f5c7bb3317643c6d81d1ef3f9913561741d92095f88efa402faf2cbe9124' as const;
const USDM: Address = '0x765DE816845861e75A25fCA122bb6898B8B1282a';

// Uniswap V3 QuoterV2 on Celo, used for the USDm -> USDT hop (0.01% pool)
const QUOTER_V2: Address = '0x82825d0554fA07f7FC52Ab63c961F330fdEFa8E8';
const USDM_USDT_FEE = 100;

const BROKER_ABI = parseAbi([
  'function getAmountOut(address exchangeProvider, bytes32 exchangeId, address assetIn, address assetOut, uint256 amountIn) external view returns (uint256 amountOut)',
]);
const QUOTER_ABI = parseAbi([
  'function quoteExactInputSingle((address tokenIn, address tokenOut, uint256 amountIn, uint24 fee, uint160 sqrtPriceLimitX96) params) external returns (uint256 amountOut, uint160 sqrtPriceX96After, uint32 initializedTicksCrossed, uint256 gasEstimate)',
]);

const client = createPublicClient({ chain: celo, transport: http(CELO_RPC_URL) });

/** Read the real reserve and Uniswap prices for this exact amount. Throws if either read fails. */
export async function fetchLiveChainState(amountG: bigint): Promise<QuoteChainState> {
  if (amountG <= 0n) throw new Error('Amount must be positive');

  // Hop 1: G$ -> USDm through the GoodDollar reserve (already net of the 10% exit contribution)
  const netUsdm = await client.readContract({
    address: BROKER,
    abi: BROKER_ABI,
    functionName: 'getAmountOut',
    args: [EXCHANGE_PROVIDER, EXCHANGE_ID, G_DOLLAR_ADDRESS, USDM, amountG],
  });
  if (netUsdm <= 0n) throw new Error('Reserve returned no quote');

  // Hop 2: USDm -> USDT on Uniswap for that net amount
  const { result } = await client.simulateContract({
    address: QUOTER_V2,
    abi: QUOTER_ABI,
    functionName: 'quoteExactInputSingle',
    args: [{ tokenIn: USDM, tokenOut: USDT_ADDRESS, amountIn: netUsdm, fee: USDM_USDT_FEE, sqrtPriceLimitX96: 0n }],
  });
  const usdtOut = result[0];
  if (usdtOut <= 0n) throw new Error('Uniswap returned no quote');

  // Express those results in the units quote.ts works with
  const grossDivisor = 10_000n - EXIT_CONTRIBUTION_BPS;
  return {
    reserveCurrentPriceRaw: (netUsdm * ONE_18 * 10_000n) / (amountG * grossDivisor),
    // usdtOut = netUsdm * rate * 1e6 / 1e36  =>  rate = usdtOut * 1e30 / netUsdm
    usdmToUsdtRateRaw: (usdtOut * 10n ** 30n) / netUsdm,
  };
}

/** A quote built from live on-chain prices. */
export async function getLiveNetQuote(amountG: bigint, ngnPerUsdt?: number): Promise<QuoteResult> {
  const chainState = await fetchLiveChainState(amountG);
  return getNetQuote({ amountIn: amountG, route: 'reserve', chainState, ngnPerUsdt });
}
