import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { HistoryDetailModal } from './HistoryDetailModal';

const item = {
  id: '1',
  txHash: '0x' + 'ab'.repeat(32),
  timestamp: new Date('2026-11-07T10:30:00').getTime(),
  amountInG: 5000,
};

afterEach(() => vi.unstubAllGlobals());

describe('HistoryDetailModal', () => {
  it('explains an in-progress cash out in plain words, with no technical terms', () => {
    render(<HistoryDetailModal item={item} naira={780} savedStage="onItsWay" onClose={() => {}} />);
    expect(screen.getByText('On its way')).toBeInTheDocument();
    expect(screen.getByText(/5,000 G\$ → ₦780/)).toBeInTheDocument();
    expect(screen.getByText('G$ converted')).toBeInTheDocument();
    expect(screen.queryByText(/USDT|Paycrest/i)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Contact support/i })).toBeInTheDocument();
  });

  it('shows a paid cash out as done and links to the receipt', () => {
    render(<HistoryDetailModal item={item} naira={780} savedStage="paid" onClose={() => {}} />);
    expect(screen.getByText(/Your naira has been sent to your bank account/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /View on explorer/i })).toHaveAttribute(
      'href',
      `https://celo.blockscout.com/tx/${item.txHash}`
    );
    expect(screen.queryByRole('button', { name: /Contact support/i })).not.toBeInTheDocument();
  });

  it('closes from the close button', () => {
    const onClose = vi.fn();
    render(<HistoryDetailModal item={item} naira={null} savedStage="unknown" onClose={onClose} />);
    fireEvent.click(screen.getAllByRole('button', { name: /close/i })[0]);
    expect(onClose).toHaveBeenCalled();
  });
});
