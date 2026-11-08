import { isPaidOutStatus } from './useOffRamp';
import type { SwapHistoryItem } from '../components/HistoryCard';
import { MIN_NET_USDT_REQUIRED } from './rate';

/** One swap as reported by our service for a wallet. */
export interface ServerSwap {
  txHash: string;
  amountG: number;
  usdtReceived: number;
  at: number; // unix seconds
  orderId?: string;
  status?: string;
  naira?: number;
}

/**
 * Swaps the owner asked us to remove from History for good (a payment that was sent to a wrong address
 * during testing and can never be paid out). They are hidden everywhere and never offered for finishing.
 */
export const HIDDEN_SWAPS = new Set(['0x750c4c01399d1e5ab5614bdbbfb8a119496dcba5f47a7e86f2a5793038e614e5']);
export const isHiddenSwap = (txHash: string) => HIDDEN_SWAPS.has(txHash.toLowerCase());

const isPaid = (status?: string) => isPaidOutStatus(status);

/**
 * Fold a wallet's swaps (from our service) into the history saved on this device, so the same wallet shows
 * the same History everywhere. One row per swap; a paid row never goes back to unpaid.
 */
export function mergeServerHistory(local: SwapHistoryItem[], server: ServerSwap[]): SwapHistoryItem[] {
  local = local.filter((h) => !isHiddenSwap(h.txHash));
  server = server.filter((sw) => !isHiddenSwap(sw.txHash));
  const byHash = new Map(local.map((h) => [h.txHash.toLowerCase(), h] as const));
  const next = [...local];

  for (const sw of server) {
    const key = sw.txHash.toLowerCase();
    const existing = byHash.get(key);
    const paid = isPaid(sw.status);

    if (!existing) {
      // A swap too small to ever pay out, with no order, is not a cash out the customer can act on
      if (!sw.orderId && sw.usdtReceived < MIN_NET_USDT_REQUIRED) continue;
      const row: SwapHistoryItem = {
        id: `tx-${key.slice(2, 14)}`,
        txHash: sw.txHash,
        timestamp: sw.at * 1000,
        amountInG: sw.amountG,
        amountOutUsdt: sw.usdtReceived,
        route: 'GoodCash router',
        ...(sw.orderId ? { orderId: sw.orderId } : {}),
        ...(sw.naira ? { nairaAmount: sw.naira } : {}),
        steps: paid
          ? { swapped: 'completed', sentToPartner: 'completed', paidInNaira: 'completed' }
          : sw.orderId
          ? { swapped: 'completed', sentToPartner: 'pending', paidInNaira: 'pending' }
          : { swapped: 'completed', sentToPartner: 'unknown', paidInNaira: 'unknown' },
      };
      next.push(row);
      byHash.set(key, row);
      continue;
    }

    const i = next.findIndex((h) => h === existing);
    const alreadyPaid = existing.steps?.paidInNaira === 'completed';
    next[i] = {
      ...existing,
      amountInG: existing.amountInG || sw.amountG,
      orderId: sw.orderId ?? existing.orderId,
      nairaAmount: existing.nairaAmount ?? sw.naira,
      steps:
        paid && !alreadyPaid
          ? { swapped: 'completed', sentToPartner: 'completed', paidInNaira: 'completed' }
          : existing.steps,
    };
  }

  return next.sort((a, b) => b.timestamp - a.timestamp);
}
