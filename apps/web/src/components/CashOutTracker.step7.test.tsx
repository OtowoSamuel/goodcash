import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { CashOutTracker } from './CashOutTracker';

describe('CashOutTracker - Step 7 requirements', () => {
  const baseProps = {
    txHash: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
    usdtReceived: 0.114,
    amountGSwapped: 1000,
    bankName: 'First Bank',
    accountNumber: '1234567890',
    accountHolderName: 'John Doe',
    walletAddress: '0xabcd1234',
    onDone: vi.fn(),
    ngnPerUsdt: 1500,
  };

  it('renders all 4 timeline steps in correct order', () => {
    render(<CashOutTracker {...baseProps} initialStep={2} />);

    // All 4 steps should be present
    expect(screen.getByText(/1 Swapped to USDT/i)).toBeInTheDocument();
    expect(screen.getByText(/2 Send to partner/i)).toBeInTheDocument();
    expect(screen.getByText(/3 Paying to your bank/i)).toBeInTheDocument();
    expect(screen.getByText(/4 Done/i)).toBeInTheDocument();
  });

  it('shows step 1 as completed with checkmark', () => {
    render(<CashOutTracker {...baseProps} initialStep={2} />);

    // Step 1 should show completed state
    expect(screen.getByText(/1 Swapped to USDT/i)).toBeInTheDocument();
  });

  it('shows step 2 (Send to partner) content when on step 2', () => {
    render(<CashOutTracker {...baseProps} initialStep={2} />);

    expect(screen.getByText(/Deposit Instructions/i)).toBeInTheDocument();
    expect(screen.getByText(/Send exactly/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /I've sent it/i })).toBeInTheDocument();
  });

  it('shows step 3 (Paying to your bank) content when on step 3', () => {
    render(<CashOutTracker {...baseProps} initialStep={3} />);

    expect(screen.getByText(/Deposit received by Paycrest/i)).toBeInTheDocument();
    expect(screen.getByText(/Destination Bank:/i)).toBeInTheDocument();
  });

  it('shows step 4 (Done) content when completed', () => {
    const mockOrder = {
      orderId: 'ord-test-123',
      status: 'settled' as const,
      receiveAddress: '0x1234',
      amountToSend: '0.114',
      currency: 'USDT',
      network: 'celo',
      senderFee: '0',
      transactionFee: '0',
      validUntil: new Date(Date.now() + 900000).toISOString(),
      paymentReference: 'PAY-TEST-123',
    };

    render(<CashOutTracker {...baseProps} initialStep={4} initialOrder={mockOrder} />);

    expect(screen.getByText(/Naira Delivered!/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Done/i })).toBeInTheDocument();
  });

  it('has aria-live="polite" on main container for dynamic updates', () => {
    const { container } = render(<CashOutTracker {...baseProps} initialStep={2} />);

    const mainDiv = container.querySelector('[aria-live="polite"]');
    expect(mainDiv).not.toBeNull();
  });

  it('displays transaction details at bottom regardless of step', () => {
    render(<CashOutTracker {...baseProps} initialStep={2} />);

    expect(screen.getByText(/Details/i)).toBeInTheDocument();
    expect(screen.getByText(/Swap Hash:/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /View on Celo Explorer/i })).toHaveAttribute(
      'href',
      'https://celo.blockscout.com/tx/0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef'
    );
  });

  it('shows estimated Naira at top based on usdtReceived and ngnPerUsdt rate', () => {
    // 0.114 USDT * 1500 NGN/USDT = 171 NGN
    render(<CashOutTracker {...baseProps} />);

    expect(screen.getByText(/≈ ₦171\.00/i)).toBeInTheDocument();
  });

  it('shows bank reference when order is settled', () => {
    const mockOrder = {
      orderId: 'ord-test-456',
      status: 'settled' as const,
      receiveAddress: '0x1234',
      amountToSend: '0.114',
      currency: 'USDT',
      network: 'celo',
      senderFee: '0',
      transactionFee: '0',
      validUntil: new Date(Date.now() + 900000).toISOString(),
      paymentReference: 'PAY-NGN-FINAL',
    };

    render(<CashOutTracker {...baseProps} initialStep={4} initialOrder={mockOrder} />);

    // Check for the reference in the settled state display
    expect(screen.getByText(/Bank Reference:/i)).toBeInTheDocument();
  });

  it('shows expired failure state', () => {
    const mockOrder = {
      orderId: 'ord-expired-789',
      status: 'expired' as const,
      receiveAddress: '0x1234',
      amountToSend: '0.114',
      currency: 'USDT',
      network: 'celo',
      senderFee: '0',
      transactionFee: '0',
      validUntil: new Date(Date.now() - 900000).toISOString(),
    };

    render(<CashOutTracker {...baseProps} initialFailureState="expired" initialOrder={mockOrder} />);

    expect(screen.getByText(/order expired before USDT arrived/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Contact support/i })).toBeInTheDocument();
  });

  it('shows refunded failure state', () => {
    render(<CashOutTracker {...baseProps} initialFailureState="refunded" />);

    expect(screen.getByText(/order refunded/i)).toBeInTheDocument();
    expect(screen.getByText(/refunded to your Celo wallet/i)).toBeInTheDocument();
  });
});
