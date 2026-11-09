import { createPublicClient, http } from 'viem';
import { celo } from 'viem/chains';
import { fetchLiveChainState as coreFetchLiveChainState, getLiveQuote, type EthCall } from '@goodcash/core/chain';
import type { QuoteChainState, QuoteResult } from './quote';
import { CELO_RPC_URL } from './router';

/** Live on-chain prices are used in production builds. Dev and tests keep the fixed prices. */
export const LIVE_QUOTES: boolean =
  typeof import.meta !== 'undefined' && Boolean((import.meta as { env?: { PROD?: boolean } }).env?.PROD);

const client = createPublicClient({ chain: celo, transport: http(CELO_RPC_URL) });

/** One plain eth_call. The price reads and maths are shared with the server and the partner SDK (@goodcash/core). */
const ethCall: EthCall = async (to, data) => {
  const { data: out } = await client.call({ to, data });
  if (!out) throw new Error('Empty result');
  return out;
};

/** Read the real reserve and Uniswap prices for this exact amount. Throws if either read fails. */
export function fetchLiveChainState(amountG: bigint): Promise<QuoteChainState> {
  return coreFetchLiveChainState(amountG, ethCall);
}

/** A quote built from live on-chain prices. */
export function getLiveNetQuote(amountG: bigint, ngnPerUsdt?: number): Promise<QuoteResult> {
  return getLiveQuote(amountG, ethCall, ngnPerUsdt);
}
