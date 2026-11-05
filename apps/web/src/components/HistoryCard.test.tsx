import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { HistoryCard, type SwapHistoryItem } from './HistoryCard';

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

  it('displays all transactions when "All" filter is active', () => {
    render(<HistoryCard history={mockHistory} onCashOutClick={() => {}} language="en" ngnPerUsdt={1500} />);
    expect(screen.getByText('1,000 G$')).toBeInTheDocument();
    expect(screen.getByText('500 G$')).toBeInTheDocument();
    expect(screen.getByText('750 G$')).toBeInTheDocument();
  });

  it('filters to show only "Paid" transactions', () => {
    render(<HistoryCard history={mockHistory} onCashOutClick={() => {}} language="en" ngnPerUsdt={1500} />);
    
    const paidButton = screen.getByRole('button', { name: /^Paid$/i });
    fireEvent.click(paidButton);

    // Should show the 2 paid transactions
    expect(screen.getByText('1,000 G$')).toBeInTheDocument();
    expect(screen.getByText('750 G$')).toBeInTheDocument();
    // Should not show the "on its way" transaction
    expect(screen.queryByText('500 G$')).not.toBeInTheDocument();
  });

  it('filters to show only "On its way" transactions', () => {
    render(<HistoryCard history={mockHistory} onCashOutClick={() => {}} language="en" ngnPerUsdt={1500} />);
    
    const onItsWayButton = screen.getByRole('button', { name: /On its way/i });
    fireEvent.click(onItsWayButton);

    // Should show the 1 "on its way" transaction
    expect(screen.getByText('500 G$')).toBeInTheDocument();
    // Should not show the paid transactions
    expect(screen.queryByText('1,000 G$')).not.toBeInTheDocument();
    expect(screen.queryByText('750 G$')).not.toBeInTheDocument();
  });

  it('shows "no matching transactions" when filter returns empty', () => {
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

    expect(screen.getByText(/No transactions match this filter/i)).toBeInTheDocument();
  });

  it('renders receipt links that open blockscout', () => {
    render(<HistoryCard history={[mockHistory[0]]} onCashOutClick={() => {}} language="en" ngnPerUsdt={1500} />);
    
    const receiptLink = screen.getByRole('link', { name: /Receipt 0x1234…cdef/i });
    expect(receiptLink).toHaveAttribute('href', 'https://celo.blockscout.com/tx/0x1234567890abcdef');
    expect(receiptLink).toHaveAttribute('target', '_blank');
  });

  it('shows "Status unknown" when order status is undefined/unrecognized', () => {
    const unknownHistory: SwapHistoryItem[] = [
      {
        id: '1',
        txHash: '0x1234567890abcdef',
        timestamp: Date.now(),
        amountInG: 1000,
        amountOutUsdt: 0.114,
        route: 'Reserve → USDT',
        steps: {
          swapped: 'completed',
          sentToPartner: 'pending',
          paidInNaira: 'pending',
        },
      },
    ];

    render(<HistoryCard history={unknownHistory} onCashOutClick={() => {}} language="en" ngnPerUsdt={1500} />);

    expect(screen.getByText(/Status unknown/i)).toBeInTheDocument();
  });
});
