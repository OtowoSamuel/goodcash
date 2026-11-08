import { describe, it, expect } from 'vitest';
import { mergeServerHistory, type ServerSwap } from './historySync';
import type { SwapHistoryItem } from '../components/HistoryCard';

const H1 = '0x' + 'ab'.repeat(32);
const H2 = '0x' + 'cd'.repeat(32);
const H3 = '0x' + 'ef'.repeat(32);

const server = (over: Partial<ServerSwap> & { txHash: string }): ServerSwap => ({
  amountG: 5000, usdtReceived: 0.573332, at: 1_800_000_000, ...over,
});

describe('mergeServerHistory', () => {
  it('shows this wallet\'s other-device cash outs on a device with an empty history', () => {
    const merged = mergeServerHistory([], [
      server({ txHash: H1, orderId: 'o1', status: 'settled', naira: 757.37 }),
      server({ txHash: H2, orderId: 'o2', status: 'initiated', at: 1_800_000_100 }),
    ]);
    expect(merged).toHaveLength(2);
    expect(merged[0].txHash).toBe(H2); // newest first
    const paid = merged.find((m) => m.txHash === H1)!;
    expect(paid.steps?.paidInNaira).toBe('completed');
    expect(paid.nairaAmount).toBe(757.37);
    expect(merged.find((m) => m.txHash === H2)!.steps?.paidInNaira).toBe('pending');
  });

  it('keeps one row per swap and upgrades a local row once the service says it is paid', () => {
    const local: SwapHistoryItem[] = [{
      id: 'a', txHash: H1, timestamp: 1, amountInG: 0, amountOutUsdt: 0.57, route: 'r',
      steps: { swapped: 'completed', sentToPartner: 'pending', paidInNaira: 'pending' },
    }];
    const merged = mergeServerHistory(local, [server({ txHash: H1.toUpperCase().replace('0X', '0x'), orderId: 'o9', status: 'settled' })]);
    expect(merged).toHaveLength(1);
    expect(merged[0].amountInG).toBe(5000);
    expect(merged[0].orderId).toBe('o9');
    expect(merged[0].steps?.paidInNaira).toBe('completed');
  });

  it('never moves a paid row back to unpaid', () => {
    const local: SwapHistoryItem[] = [{
      id: 'a', txHash: H1, timestamp: 1, amountInG: 5000, amountOutUsdt: 0.57, route: 'r',
      steps: { swapped: 'completed', sentToPartner: 'completed', paidInNaira: 'completed' },
    }];
    const merged = mergeServerHistory(local, [server({ txHash: H1, orderId: 'o9', status: 'initiated' })]);
    expect(merged[0].steps?.paidInNaira).toBe('completed');
  });

  it('skips a tiny swap with no payout order, which is not a cash out', () => {
    const merged = mergeServerHistory([], [server({ txHash: H3, amountG: 1000, usdtReceived: 0.114 })]);
    expect(merged).toHaveLength(0);
  });
});

import { isHiddenSwap } from './historySync';
describe('scrapped swaps', () => {
  it('never appear in merged history', () => {
    const hash = '0x750c4c01399d1e5ab5614bdbbfb8a119496dcba5f47a7e86f2a5793038e614e5';
    expect(isHiddenSwap(hash.toUpperCase().replace('0X', '0x'))).toBe(true);
    const out = mergeServerHistory([], [{ txHash: hash, amountG: 5000, usdtReceived: 0.574, at: 1, orderId: 'x' }]);
    expect(out).toHaveLength(0);
  });
});
