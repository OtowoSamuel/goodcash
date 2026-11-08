import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
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

describe('Pay now', () => {
  it('stays disabled while the order is only the stand-in from a reload', () => {
    // A reopened order carries just its id; the real deposit address is not known yet
    render(<CashOutTracker {...base} initialOrder={{ orderId: 'ord-1' }} />);
    const pay = screen.getByRole('button', { name: /getting your payment ready/i });
    expect(pay).toBeDisabled();
    expect(screen.queryByRole('button', { name: /^pay now$/i })).not.toBeInTheDocument();
    // No deposit address, copy button or manual instructions may ever be shown for an unknown order
    expect(document.body.textContent).not.toMatch(/0x3841D6A1/i);
    expect(screen.queryByText(/Deposit address/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /copy/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/pay manually/i)).not.toBeInTheDocument();
  });

  it('is available once the real deposit address is known', () => {
    render(
      <CashOutTracker
        {...base}
        initialOrder={{ orderId: 'ord-1', receiveAddress: '0x6157820d8ADE8Cb501CcFD01fdD1B918d78C1E76', amountToSend: '0.554443', status: 'initiated' }}
      />
    );
    expect(screen.getByRole('button', { name: /^pay now$/i })).toBeEnabled();
  });
});
