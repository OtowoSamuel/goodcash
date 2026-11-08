import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { CashOutTracker } from './CashOutTracker';

const ORDER_ID = 'f6f1a0c3-c51a-44b7-bdc1-ad070cc621f0';
const base = {
  txHash: '0x' + 'ab'.repeat(32),
  usdtReceived: 0.65,
  amountGSwapped: 5000,
  bankName: 'OPay',
  accountNumber: '9138681897',
  accountHolderName: 'Ada Obi',
  walletAddress: '0xDeaDbeefdEAdbeefdEadbEEFdeadbeEFdEaDbeeF',
  onDone: vi.fn(),
  onSendDeposit: vi.fn(async () => {}),
  depositSent: true,
  // An order that arrives already created (one tap, or after a reload), as the real app passes it
  initialOrder: { orderId: ORDER_ID, receiveAddress: '0xec0112860D16CD9a23Cb0BCCc2D53342CAE33BC1', amountToSend: '0.652873', status: 'initiated' as const },
};

function serverSays(status: string) {
  const calls: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (u: string) => {
      calls.push(String(u));
      return new Response(JSON.stringify({ orderId: ORDER_ID, status, receiveAddress: '0xec0112860D16CD9a23Cb0BCCc2D53342CAE33BC1', amountToSend: '0.652873', paymentReference: null }), { status: 200 });
    })
  );
  return calls;
}

describe('Tracker for an order it did not create itself', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('asks the server on its own and moves on when the bank has been paid', async () => {
    const calls = serverSays('settled');
    const onSettled = vi.fn();
    render(<CashOutTracker {...base} onSettled={onSettled} />);
    await waitFor(() => expect(calls.some((c) => c.includes(`/orders/${ORDER_ID}`))).toBe(true));
    await waitFor(() => expect(onSettled).toHaveBeenCalled());
    expect(screen.queryByRole('heading', { name: /paying to your bank/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /refresh status/i })).not.toBeInTheDocument();
  });

  it('Refresh status really asks the server, and says so while it checks and after', async () => {
    const calls = serverSays('pending'); // paid in, bank not paid yet
    render(<CashOutTracker {...base} />);
    await waitFor(() => expect(calls.length).toBeGreaterThan(0));
    const before = calls.length;
    const btn = await screen.findByRole('button', { name: /refresh status/i });
    expect(btn).toBeEnabled();
    fireEvent.click(btn);
    await waitFor(() => expect(calls.length).toBeGreaterThan(before));
    expect(await screen.findByText(/Checked just now/)).toBeInTheDocument();
  });

  it('tells the customer plainly when it could not check', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));
    render(<CashOutTracker {...base} />);
    expect(await screen.findByText(/couldn't check just now/i)).toBeInTheDocument();
  });
});
