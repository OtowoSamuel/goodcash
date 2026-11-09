import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { HistoryCard, getOnrampLook, getSavedHistoryStatus, type SwapHistoryItem } from './HistoryCard';
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

  it('shows naira-in rows with the same statuses as cash outs', () => {
    const onramps: SwapHistoryItem[] = [
      {
        id: 'in-1',
        txHash: '',
        timestamp: Date.now(),
        amountInG: 0,
        amountOutUsdt: 0,
        route: 'Naira → G$',
        orderId: 'order-in-1',
        kind: 'onramp',
        asset: 'g',
        nairaIn: 5000,
        assetOut: 4420,
        onrampStage: 'waiting',
      },
      {
        id: 'in-2',
        txHash: '',
        timestamp: Date.now() - 86400000,
        amountInG: 0,
        amountOutUsdt: 0,
        route: 'Naira → CELO',
        orderId: 'order-in-2',
        kind: 'onramp',
        asset: 'celo',
        nairaIn: 2500,
        assetOut: 1.05,
        onrampStage: 'done',
        arrived: true,
      },
    ];
    render(<HistoryCard history={onramps} onCashOutClick={() => {}} language="en" />);
    expect(screen.getByText(/₦5,000 → 4,420 G\$/)).toBeInTheDocument();
    expect(screen.getByText(/₦2,500 → 1.05 CELO/)).toBeInTheDocument();
    expect(screen.getByText('In your wallet')).toBeInTheDocument();
    expect(screen.getByText('Waiting for your transfer')).toBeInTheDocument();
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

  it('a naira order that closed, was returned, is under review or is only half done never reads "Checking status"', () => {
    const items = [
      row({ orderId: 'a', onrampStage: 'expired', nairaIn: 1100 }),
      row({ orderId: 'b', onrampStage: 'refund', nairaIn: 1200 }),
      row({ orderId: 'c', onrampStage: 'review', nairaIn: 1300 }),
      row({ orderId: 'd', onrampStage: 'done', nairaIn: 1400 }),
      row({ orderId: 'e', onrampStage: 'received', nairaIn: 1500 }),
    ];
    render(<HistoryCard history={items} onCashOutClick={() => {}} language="en" />);
    for (const label of ['Not completed', 'Returned', 'Under review', 'Naira received', 'On its way']) {
      expect(screen.getAllByText(label).length).toBeGreaterThan(0);
    }
    expect(screen.queryByText(/Checking status|Status unknown/i)).not.toBeInTheDocument();
  });

  it('only an order whose asset really arrived is "In your wallet" (and counted as paid), whatever the stage says', () => {
    expect(getSavedHistoryStatus(row({ onrampStage: 'done' }))).toBe('onItsWay');
    expect(getSavedHistoryStatus(row({ onrampStage: 'done', arrived: true }))).toBe('paid');
    expect(getOnrampLook(row({ onrampStage: 'done' })).label).toBe('Naira received');
    expect(getOnrampLook(row({ onrampStage: 'done', arrived: true })).label).toBe('In your wallet');
  });

  it('a purchase from before History kept its amounts shows without a made-up G$ figure', () => {
    render(<HistoryCard history={[row({ orderId: 'old', nairaIn: 3000, assetOut: undefined, asset: 'celo', onrampStage: 'done' })]} onCashOutClick={() => {}} language="en" />);
    expect(screen.getByText('₦3,000 → CELO')).toBeInTheDocument();
  });

  it('the details pop-up uses plain words (no "swap") and is honest when the naira arrived but the asset is not marked as received', () => {
    render(<HistoryDetailModal item={row({ orderId: 'z', onrampStage: 'done', nairaIn: 4000, assetOut: 3000 })} naira={null} savedStage="onItsWay" wallet={null} onClose={() => {}} />);
    expect(screen.getByText(/If your G\$ is already in your wallet, you are all set/)).toBeInTheDocument();
    expect(screen.getByText('Adding G$')).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/swap/i);
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

    expect(screen.getByText(/No cash outs yet/i)).toBeInTheDocument();
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
