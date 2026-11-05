import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { CashOutCard } from './CashOutCard';

describe('Bank Details - Part 8 compliance', () => {
  it('enforces NO pre-filled bank values on mount', () => {
    const mockFetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: { sell: { rate: 1500 } } }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ institutions: [] }),
      });
    vi.stubGlobal('fetch', mockFetch);

    render(
      <CashOutCard
        balanceG={5000}
        onInitiateCashOut={() => {}}
        language="en"
        ngnPerUsdt={1500}
      />
    );

    // Bank select should be empty/default
    const bankSelect = screen.getByLabelText(/Bank/i);
    expect(bankSelect).toHaveValue('');

    // Account number should be empty
    const accountInput = screen.getByPlaceholderText(/10-digit account number/i);
    expect(accountInput).toHaveValue('');

    vi.unstubAllGlobals();
  });

  it('shows account name field starts in idle state', () => {
    const mockFetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: { sell: { rate: 1500 } } }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ institutions: [] }),
      });
    vi.stubGlobal('fetch', mockFetch);

    render(
      <CashOutCard
        balanceG={5000}
        onInitiateCashOut={() => {}}
        language="en"
        ngnPerUsdt={1500}
      />
    );

    // Initial state: idle message
    expect(screen.getByText(/Enter a 10-digit account number/i)).toBeInTheDocument();

    vi.unstubAllGlobals();
  });

  it('review button is disabled without confirmed bank details', () => {
    const mockFetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: { sell: { rate: 1500 } } }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ institutions: [] }),
      });
    vi.stubGlobal('fetch', mockFetch);

    render(
      <CashOutCard
        balanceG={5000}
        onInitiateCashOut={() => {}}
        language="en"
        ngnPerUsdt={1500}
      />
    );

    // Review button should be disabled
    const reviewButton = screen.getByRole('button', { name: /Review cash out/i });
    expect(reviewButton).toBeDisabled();

    vi.unstubAllGlobals();
  });
});

describe('Price Protection - slippage terminology', () => {
  it('displays Price Protection pills (1%, 2%, 3%)', () => {
    const mockFetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: { sell: { rate: 1500 } } }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ institutions: [] }),
      });
    vi.stubGlobal('fetch', mockFetch);

    render(
      <CashOutCard
        balanceG={5000}
        onInitiateCashOut={() => {}}
        language="en"
        ngnPerUsdt={1500}
      />
    );

    expect(screen.getByText(/Price protection/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '1%' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '2%' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '3%' })).toBeInTheDocument();

    vi.unstubAllGlobals();
  });

  it('updates selected price protection value when pill is clicked', () => {
    const mockFetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: { sell: { rate: 1500 } } }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ institutions: [] }),
      });
    vi.stubGlobal('fetch', mockFetch);

    render(
      <CashOutCard
        balanceG={5000}
        onInitiateCashOut={() => {}}
        language="en"
        ngnPerUsdt={1500}
      />
    );

    // Default is 1%
    const pill1 = screen.getByRole('button', { name: '1%' });
    expect(pill1).toHaveClass('border-[#7C3AED]');

    // Click 2%
    const pill2 = screen.getByRole('button', { name: '2%' });
    fireEvent.click(pill2);

    // 2% should now be selected
    expect(pill2).toHaveClass('border-[#7C3AED]');
    expect(pill1).not.toHaveClass('border-[#7C3AED]');

    // Click 3%
    const pill3 = screen.getByRole('button', { name: '3%' });
    fireEvent.click(pill3);

    // 3% should now be selected
    expect(pill3).toHaveClass('border-[#7C3AED]');
    expect(pill2).not.toHaveClass('border-[#7C3AED]');

    vi.unstubAllGlobals();
  });

  it('defaults to 1% price protection', () => {
    const mockFetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: { sell: { rate: 1500 } } }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ institutions: [] }),
      });
    vi.stubGlobal('fetch', mockFetch);

    render(
      <CashOutCard
        balanceG={5000}
        onInitiateCashOut={() => {}}
        language="en"
        ngnPerUsdt={1500}
      />
    );

    const pill1 = screen.getByRole('button', { name: '1%' });
    expect(pill1).toHaveClass('border-[#7C3AED]');

    vi.unstubAllGlobals();
  });
});
