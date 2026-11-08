import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';

vi.mock('../lib/useOffRamp', async () => {
  const actual = await vi.importActual<typeof import('../lib/useOffRamp')>('../lib/useOffRamp');
  return { ...actual, fetchOrderDetails: vi.fn().mockRejectedValue(new Error('HTTP 404')) };
});

import { CashOutTracker } from './CashOutTracker';

const base = {
  txHash: '0x' + 'ab'.repeat(32),
  usdtReceived: 0.57,
  amountGSwapped: 5000,
  bankName: 'GTBank',
  accountNumber: '0123456789',
  accountHolderName: 'Jane Doe',
  walletAddress: '0xDeaDbeefdEAdbeefdEadbEEFdeadbeEFdEaDbeeF',
  onDone: vi.fn(),
  onSendDeposit: vi.fn(async () => {}),
};

describe('a reopened order that cannot be loaded', () => {
  it('shows a plain failure with a way out instead of an endless spinner, and no made-up order ID', async () => {
    const onOrderClosed = vi.fn();
    render(
      <CashOutTracker
        {...base}
        onOrderClosed={onOrderClosed}
        initialOrder={{ orderId: '11111111-1111-4111-8111-111111111111' }}
      />
    );
    await waitFor(() => expect(screen.getByText(/couldn't load your payment/i)).toBeInTheDocument());
    expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /start fresh/i })).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/ord-[0-9a-f]{8}/);
    expect(screen.queryByRole('button', { name: /^pay now$/i })).not.toBeInTheDocument();
  });
});
