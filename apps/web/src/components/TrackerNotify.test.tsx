import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import { CashOutTracker } from './CashOutTracker';

const props = {
  txHash: '0x' + 'ab'.repeat(32),
  usdtReceived: 0.57,
  amountGSwapped: 5000,
  bankName: 'GTBank',
  accountNumber: '0123456789',
  accountHolderName: 'Jane Doe',
  walletAddress: '0xDeaDbeefdEAdbeefdEadbEEFdeadbeEFdEaDbeeF',
  onDone: () => {},
  depositSent: true,
  initialOrder: {
    orderId: '550e8400-e29b-41d4-a716-446655440000',
    receiveAddress: '0x6157820d8ADE8Cb501CcFD01fdD1B918d78C1E76',
    amountToSend: '0.55',
    status: 'initiated' as const,
  },
};

beforeEach(() => {
  const store: Record<string, string> = {};
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store[k] ?? null,
    setItem: (k: string, v: string) => { store[k] = v; },
    removeItem: (k: string) => { delete store[k]; },
  });
});
afterEach(() => vi.unstubAllGlobals());

describe('Email me when it lands', () => {
  it('lets the customer ask for an email so they do not have to wait on the screen', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);
    render(<CashOutTracker {...props} />);

    fireEvent.change(screen.getByLabelText(/email me when it's sent/i), { target: { value: 'me@example.com' } });
    fireEvent.click(screen.getByRole('button', { name: /email me/i }));

    await waitFor(() => expect(screen.getByText(/We'll email you/i)).toBeInTheDocument());
    const call = fetchMock.mock.calls.find((c) => String(c[0]).endsWith('/notify'))!;
    expect(JSON.parse((call[1] as RequestInit).body as string)).toEqual({
      orderId: props.initialOrder.orderId,
      email: 'me@example.com',
    });
  });

  it('asks for a valid address instead of sending nonsense', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    render(<CashOutTracker {...props} />);
    fireEvent.change(screen.getByLabelText(/email me when it's sent/i), { target: { value: 'nope' } });
    fireEvent.click(screen.getByRole('button', { name: /email me/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/valid email/i);
    expect(fetchMock.mock.calls.some((c) => String(c[0]).endsWith('/notify'))).toBe(false);
  });
});

describe('honest timing while the payout is slow', () => {
  const order = (status: string) => ({ orderId: '11111111-1111-4111-8111-111111111111', receiveAddress: '0x1111111111111111111111111111111111111111', amountToSend: '0.57', status });

  it('waits 15 minutes by default before showing the "taking longer" card', () => {
    vi.useFakeTimers();
    try {
      render(<CashOutTracker {...props} depositSent initialOrder={order('fulfilled') as never} />);
      act(() => { vi.advanceTimersByTime(10 * 60_000); });
      expect(screen.queryByText(/taking longer than usual|not received after/i)).not.toBeInTheDocument();
      act(() => { vi.advanceTimersByTime(6 * 60_000); });
      expect(screen.getByText(/not received after 15 minutes/i)).toBeInTheDocument();
      expect(screen.getByText(/your payment is safe/i)).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it('says plainly where the payout is, with the usual time, and offers the email option first', () => {
    render(<CashOutTracker {...props} depositSent initialOrder={order('fulfilled') as never} />);
    expect(screen.getByText(/Your bank is being paid now/i)).toBeInTheDocument();
    expect(screen.getByText(/Usually a few minutes\. Sometimes up to 20\./i)).toBeInTheDocument();
    const email = screen.getByLabelText(/email me when it's sent/i);
    const bank = screen.getByText(/Destination Bank/i);
    // the email option sits above the bank details, so it is seen straight away
    expect(email.compareDocumentPosition(bank) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/paycrest|usdt|fulfilled/i);
  });
});
