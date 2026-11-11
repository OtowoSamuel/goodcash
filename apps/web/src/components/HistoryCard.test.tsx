import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { HistoryCard, getSavedHistoryStatus, isListedInHistory, type SwapHistoryItem } from './HistoryCard';
import { HistoryDetailModal } from './HistoryDetailModal';

const mockHistory: SwapHistoryItem[] = [
  {
    id: '1',
    txHash: '0x1234567890abcdef',
    timestamp: Date.now(),
    amountInG: 1000,
    amountOutUsdt: 0.114,
    route: 'Reserve → USDT',
    orderId: 'order-1',
    steps: {
      swapped: 'completed',
      sentToPartner: 'completed',
      paidInNaira: 'completed',
    },
  },
  {
    id: '2',
    txHash: '0xfedcba0987654321',
    timestamp: Date.now() - 86400000,
    amountInG: 500,
    amountOutUsdt: 0.057,
    route: 'Reserve → USDT',
    orderId: 'order-2',
    steps: {
      swapped: 'completed',
      sentToPartner: 'completed',
      paidInNaira: 'processing',
    },
  },
  {
    id: '3',
    txHash: '0xabcd1234efgh5678',
    timestamp: Date.now() - 172800000,
    amountInG: 750,
    amountOutUsdt: 0.085,
    route: 'Reserve → USDT',
    orderId: 'order-3',
    steps: {
      swapped: 'completed',
      sentToPartner: 'completed',
      paidInNaira: 'completed',
    },
  },
];

describe('HistoryCard', () => {
  it('shows empty state when history is empty', () => {
    render(<HistoryCard history={[]} onCashOutClick={() => {}} language="en" />);
    expect(screen.getByText(/No cash outs yet/i)).toBeInTheDocument();
  });

  const row = (over: Partial<SwapHistoryItem>): SwapHistoryItem => ({
    id: `in-${over.orderId ?? 'x'}`,
    txHash: '',
    timestamp: Date.now(),
    amountInG: 0,
    amountOutUsdt: 0,
    route: 'Naira → G$',
    orderId: 'order-x',
    kind: 'onramp',
    asset: 'g',
    nairaIn: 5000,
    ...over,
  });

  const NEW_WORDS = /Naira received|In your wallet|Not completed|Returned|Under review|Waiting for your transfer|Receipt pending|Checking status|Status unknown/i;

  it('naira rows read exactly like cash outs: "Paid" when the asset arrived, "On its way" for everything else', () => {
    const items = [
      row({ orderId: 'a', onrampStage: 'done', arrived: true, nairaIn: 1100, assetOut: 900 }),
      row({ orderId: 'b', onrampStage: 'waiting', nairaIn: 1200 }),
      row({ orderId: 'c', onrampStage: 'received', nairaIn: 1300 }),
      row({ orderId: 'd', onrampStage: 'review', nairaIn: 1400 }),
      row({ orderId: 'e', onrampStage: 'done', nairaIn: 1500 }),
      row({ orderId: 'f', onrampStage: 'refund', nairaIn: 1600 }),
    ];
    render(<HistoryCard history={items} onCashOutClick={() => {}} language="en" />);
    // every row has one of the two tags, and no other words appear
    const pills = [...document.querySelectorAll('span.gc-pill')].map((p) => p.textContent);
    expect(pills.filter((t) => t === 'Paid')).toHaveLength(1);
    expect(pills.filter((t) => t === 'On its way')).toHaveLength(5);
    expect(pills).toHaveLength(6);
    expect(document.body.textContent).not.toMatch(NEW_WORDS);
    // same colours as cash outs: Paid is mint, On its way is yellow
    expect(document.querySelectorAll('span.gc-pill--mint')).toHaveLength(1);
    expect(document.querySelectorAll('span.gc-pill--yellow')).toHaveLength(5);
  });

  it('an order that was never paid (the window closed) is not listed, so there is no third kind of row', () => {
    render(<HistoryCard history={[row({ orderId: 'gone', onrampStage: 'expired', nairaIn: 7777 }), row({ orderId: 'ok', onrampStage: 'waiting', nairaIn: 2222 })]} onCashOutClick={() => {}} language="en" />);
    expect(screen.queryByText(/7,777/)).not.toBeInTheDocument();
    expect(screen.getByText(/2,222/)).toBeInTheDocument();
    expect(isListedInHistory(row({ onrampStage: 'expired', arrived: true }))).toBe(true);
  });

  it('only an order whose asset really arrived counts as paid', () => {
    expect(getSavedHistoryStatus(row({ onrampStage: 'done' }))).toBe('onItsWay');
    expect(getSavedHistoryStatus(row({ onrampStage: 'done', arrived: true }))).toBe('paid');
    expect(getSavedHistoryStatus(row({ onrampStage: 'expired' }))).toBe('onItsWay');
  });

  it('the receipt line is the same as a cash out when there is a transaction, and absent (never an error-looking line) when there is none yet', () => {
    const tx = `0x${'ab'.repeat(32)}`;
    render(<HistoryCard history={[row({ orderId: 'has', txHash: tx, arrived: true, onrampStage: 'done', nairaIn: 3100 }), row({ orderId: 'not', nairaIn: 3200 })]} onCashOutClick={() => {}} language="en" />);
    const link = screen.getByText(/Receipt 0xabab…abab/);
    expect(link.closest('a')?.getAttribute('href')).toBe(`https://celo.blockscout.com/tx/${tx}`);
    expect(screen.getAllByText(/Receipt/)).toHaveLength(1);
    expect(document.body.textContent).not.toMatch(/pending/i);
  });

  it('a purchase from before History kept its amounts shows without a made-up G$ figure', () => {
    render(<HistoryCard history={[row({ orderId: 'old', nairaIn: 3000, assetOut: undefined, asset: 'celo', onrampStage: 'done' })]} onCashOutClick={() => {}} language="en" />);
    expect(screen.getByText('₦3,000 → CELO')).toBeInTheDocument();
  });

  it('the details pop-up keeps the original words and says nothing about "swap"', () => {
    render(<HistoryDetailModal item={row({ orderId: 'z', onrampStage: 'done', nairaIn: 4000, assetOut: 3000 })} naira={null} savedStage="onItsWay" wallet={null} onClose={() => {}} />);
    expect(screen.getByText('On its way')).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/swap/i);
    // the status heading is the same two words as everywhere else (the step names below it are the original ones)
    expect(screen.queryByText(/Checking status|Under review|Not completed|Returned/)).not.toBeInTheDocument();
  });

  it('displays all transactions when "All" filter is active', () => {
    render(<HistoryCard history={mockHistory} onCashOutClick={() => {}} language="en" ngnPerUsdt={1500} />);
    expect(screen.getByText(/1,000 G\$/)).toBeInTheDocument();
    expect(screen.getByText(/500 G\$/)).toBeInTheDocument();
    expect(screen.getByText(/750 G\$/)).toBeInTheDocument();
  });

  it('filters to show only "Paid" transactions', () => {
    render(<HistoryCard history={mockHistory} onCashOutClick={() => {}} language="en" ngnPerUsdt={1500} />);
    
    const paidButton = screen.getByRole('button', { name: /^Paid$/i });
    fireEvent.click(paidButton);

    // Should show the 2 paid transactions
    expect(screen.getByText(/1,000 G\$/)).toBeInTheDocument();
    expect(screen.getByText(/750 G\$/)).toBeInTheDocument();
    // Should not show the "on its way" transaction
    expect(screen.queryByText(/500 G\$/)).not.toBeInTheDocument();
  });

  it('filters to show only "On its way" transactions', () => {
    render(<HistoryCard history={mockHistory} onCashOutClick={() => {}} language="en" ngnPerUsdt={1500} />);
    
    const onItsWayButton = screen.getByRole('button', { name: /On its way/i });
    fireEvent.click(onItsWayButton);

    // Should show the 1 "on its way" transaction
    expect(screen.getByText(/500 G\$/)).toBeInTheDocument();
    // Should not show the paid transactions
    expect(screen.queryByText(/1,000 G\$/)).not.toBeInTheDocument();
    expect(screen.queryByText(/750 G\$/)).not.toBeInTheDocument();
  });

  it('shows empty state when filter returns no matches', () => {
    const allPaidHistory: SwapHistoryItem[] = [
      {
        id: '1',
        txHash: '0x1234567890abcdef',
        timestamp: Date.now(),
        amountInG: 1000,
        amountOutUsdt: 0.114,
        route: 'Reserve → USDT',
        steps: {
          swapped: 'completed',
          sentToPartner: 'completed',
          paidInNaira: 'completed',
        },
      },
    ];

    render(<HistoryCard history={allPaidHistory} onCashOutClick={() => {}} language="en" ngnPerUsdt={1500} />);
    
    const onItsWayButton = screen.getByRole('button', { name: /On its way/i });
    fireEvent.click(onItsWayButton);

    expect(screen.getByText('Nothing is on its way right now.')).toBeInTheDocument();
    expect(screen.queryByText(/No cash outs yet/i)).not.toBeInTheDocument();
  });

  it('renders receipt links that open blockscout', () => {
    render(<HistoryCard history={[mockHistory[0]]} onCashOutClick={() => {}} language="en" ngnPerUsdt={1500} />);
    
    const receiptLink = screen.getByRole('link', { name: /Receipt 0x1234…cdef/i });
    expect(receiptLink).toHaveAttribute('href', 'https://celo.blockscout.com/tx/0x1234567890abcdef');
    expect(receiptLink).toHaveAttribute('target', '_blank');
  });

  it('shows "Checking status" when order status is undefined/unrecognized', () => {
    const unknownHistory: SwapHistoryItem[] = [
      {
        id: '1',
        txHash: '0x1234567890abcdef',
        timestamp: Date.now(),
        amountInG: 1000,
        amountOutUsdt: 0.114,
        route: 'Reserve → USDT',
        steps: {
          swapped: 'unknown',
          sentToPartner: 'unknown',
          paidInNaira: 'unknown',
        },
      },
    ];

    render(<HistoryCard history={unknownHistory} onCashOutClick={() => {}} language="en" ngnPerUsdt={1500} />);

    expect(screen.getByText(/Checking status/i)).toBeInTheDocument();
  });
});
