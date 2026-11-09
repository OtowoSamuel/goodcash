import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { MobileHistoryView } from './MobileHistoryView';
import type { SwapHistoryItem } from './HistoryCard';

const cashOut: SwapHistoryItem = {
  id: 'c1',
  txHash: `0x${'cd'.repeat(32)}`,
  timestamp: Date.now(),
  amountInG: 5000,
  amountOutUsdt: 0.57,
  route: 'Reserve → USDT',
  orderId: 'order-1',
  steps: { swapped: 'completed', sentToPartner: 'completed', paidInNaira: 'completed' },
};

const naira = (over: Partial<SwapHistoryItem>): SwapHistoryItem => ({
  id: `in-${over.orderId}`,
  txHash: '',
  timestamp: Date.now() - 1000,
  amountInG: 0,
  amountOutUsdt: 0,
  route: 'Naira → G$',
  kind: 'onramp',
  asset: 'g',
  nairaIn: 5000,
  ...over,
});

const render_ = (history: SwapHistoryItem[]) => render(<MobileHistoryView history={history} onClose={() => {}} onNavigate={() => {}} />);

describe('History on a phone: Naira rows look like cash out rows', () => {
  it('only the two usual tags, the same colours, and the same receipt line', () => {
    const tx = `0x${'ab'.repeat(32)}`;
    render_([
      cashOut,
      naira({ orderId: 'paid', arrived: true, onrampStage: 'done', txHash: tx, nairaIn: 2100, assetOut: 1800 }),
      naira({ orderId: 'half', onrampStage: 'done', nairaIn: 2200 }),
      naira({ orderId: 'wait', onrampStage: 'waiting', nairaIn: 2300 }),
      naira({ orderId: 'refund', onrampStage: 'refund', nairaIn: 2400 }),
      naira({ orderId: 'closed', onrampStage: 'expired', nairaIn: 9999 }),
    ]);
    const pills = [...document.querySelectorAll('span.gc-pill')].map((p) => p.textContent).filter((t) => t === 'Paid' || t === 'On its way' || (t ?? '').length > 12);
    expect(pills.filter((t) => t === 'Paid')).toHaveLength(2); // the cash out and the arrived purchase
    expect(pills.filter((t) => t === 'On its way')).toHaveLength(3);
    expect(document.body.textContent).not.toMatch(/Naira received(?! so far)|In your wallet|Not completed|Returned|Under review|Waiting for your transfer|Receipt pending|Checking status/i);
    // an order that was never paid is not listed
    expect(screen.queryByText(/9,999/)).not.toBeInTheDocument();
    // receipt line: the same underlined link as a cash out, and none at all when there is no transaction yet
    expect(screen.getAllByText(/^Receipt 0x/)).toHaveLength(2);
    expect(screen.getByText(/Receipt 0xabab…abab/).closest('a')).toHaveAttribute('href', `https://celo.blockscout.com/tx/${tx}`);
  });

  it('Naira rows are not counted in "Your totals" for cash outs', () => {
    render_([cashOut, naira({ orderId: 'x', onrampStage: 'waiting', nairaIn: 4000 })]);
    expect(screen.getByText('Cash outs').nextSibling?.textContent).toBe('1');
  });
});
