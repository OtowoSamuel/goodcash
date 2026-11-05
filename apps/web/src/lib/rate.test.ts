import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { CashOutCard } from '../components/CashOutCard';
import { ConfirmModal } from '../components/ConfirmModal';
import { ReadinessCard } from '../components/ReadinessCard';
import { getNetQuote } from './quote';
import { getCashoutRate } from './rate';

describe('shared rate conversion', () => {
  const fakeNgnRate = 1500;

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const BANK_NAME = 'Zenith Bank';
  const BANK_CODE = 'ZENITHB0001';

  function stubBankingFetch(accountName = 'JANE DOE') {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes('/institutions/')) {
          return {
            ok: true,
            json: async () => ({
              institutions: [{ name: BANK_NAME, code: BANK_CODE, type: 'bank' }],
            }),
          };
        }
        if (url.includes('/verify-account')) {
          return { ok: true, json: async () => ({ accountName }) };
        }
        return {
          ok: true,
          json: async () => ({ data: { sell: { rate: fakeNgnRate } } }),
        };
      })
    );
  }

  const amounts = [1, 100, 1000, 4386];

  for (const amount of amounts) {
    it(`keeps the Home calculation aligned with the quote engine for ${amount} G$`, () => {
      const homeRate = getCashoutRate(amount, 123.48, fakeNgnRate);
      const quote = getNetQuote({ amountIn: BigInt(Math.floor(amount * 1e18)), ngnPerUsdt: fakeNgnRate });
      const quoteUsdt = Number(quote.usdtOut) / 1e6;
      const quoteNaira = quoteUsdt * fakeNgnRate;

      expect(Math.abs(homeRate.netUsdt - quoteUsdt)).toBeLessThan(0.000001);
      expect(Math.abs(homeRate.netNaira - quoteNaira)).toBeLessThan(0.02);

      render(
        React.createElement(ReadinessCard, {
          balanceG: amount,
          dailyClaimG: 123.48,
          onCashOutClick: () => undefined,
          onClaimClick: () => undefined,
          language: 'en',
          ngnPerUsdt: fakeNgnRate,
        })
      );

      expect(document.body.textContent).toContain(`${amount.toLocaleString(undefined, { maximumFractionDigits: 2 })} G$`);
      expect(document.body.textContent).toContain(`₦${homeRate.netNaira.toLocaleString(undefined, { maximumFractionDigits: 2 })}`);
    });
  }

  it('renders the same home and cash-out Naira value for the same G$ amount', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ data: { sell: { rate: fakeNgnRate } } }),
      })
    );

    const amount = 1000;
    const homeRate = getCashoutRate(amount, 123.48, fakeNgnRate);

    render(
      React.createElement(
        React.Fragment,
        null,
        React.createElement(ReadinessCard, {
          balanceG: amount,
          dailyClaimG: 123.48,
          onCashOutClick: () => undefined,
          onClaimClick: () => undefined,
          language: 'en',
          ngnPerUsdt: fakeNgnRate,
        }),
        React.createElement(CashOutCard, {
          balanceG: amount,
          onInitiateCashOut: () => undefined,
          language: 'en',
          ngnPerUsdt: fakeNgnRate,
        })
      )
    );

    await waitFor(() => {
      expect(screen.getAllByText(`₦${homeRate.netNaira.toFixed(2)}`).length).toBeGreaterThanOrEqual(2);
    });
  });

  it('treats 4,473 G$ as below the minimum and 4,474 G$ as above it', () => {
    const below = getCashoutRate(4473, 123.48, fakeNgnRate);
    const above = getCashoutRate(4474, 123.48, fakeNgnRate);

    expect(below.minimumReached).toBe(false);
    expect(above.minimumReached).toBe(true);
    expect(below.remainingUsdt).toBeCloseTo(0.51 - below.netUsdt, 8);
    expect(above.remainingUsdt).toBe(0);
  });

  it('keeps the G$ minimum identical across different NGN rates', () => {
    const rates = [1500, 1373.05];

    const first = rates.map((ngn) => getCashoutRate(4474, 123.48, ngn));
    const belowFirst = rates.map((ngn) => getCashoutRate(4473, 123.48, ngn));

    for (const rate of first) {
      expect(rate.netUsdt).toBeCloseTo(first[0].netUsdt, 8);
      expect(rate.minimumReached).toBe(true);
      expect(rate.remainingG).toBe(0);
    }

    for (const rate of belowFirst) {
      expect(rate.netUsdt).toBeCloseTo(belowFirst[0].netUsdt, 8);
      expect(rate.minimumReached).toBe(false);
    }

    expect(belowFirst[0].netUsdt).toBeCloseTo(0.50989, 5);
    expect(first[0].netUsdt).toBeCloseTo(0.510004, 5);
  });

  it('with empty or invalid bank fields the Review cash out button is disabled', async () => {
    stubBankingFetch('JANE DOE');

    render(
      React.createElement(CashOutCard, {
        balanceG: 5000,
        onInitiateCashOut: () => undefined,
        language: 'en',
        ngnPerUsdt: fakeNgnRate,
      })
    );

    const input = screen.getByDisplayValue('1000');
    fireEvent.change(input, { target: { value: '4500' } });

    const reviewBtn = screen.getByRole('button', { name: /review cash out/i });

    // 1. Initial empty bank fields: disabled
    await waitFor(() => {
      expect(reviewBtn).toBeDisabled();
    });

    const bankSelect = screen.getByLabelText('Bank name');
    const accountInput = screen.getByPlaceholderText('10-digit account number');

    // 2. Only bank selected: still disabled
    await screen.findByRole('option', { name: BANK_NAME });
    fireEvent.change(bankSelect, { target: { value: BANK_CODE } });
    expect(reviewBtn).toBeDisabled();

    // 3. Invalid account number (9 digits): disabled
    fireEvent.change(accountInput, { target: { value: '123456789' } });
    expect(reviewBtn).toBeDisabled();

    // 4. 10-digit account number but unconfirmed Paycrest name: disabled
    fireEvent.change(accountInput, { target: { value: '1234567890' } });
    expect(await screen.findByText('JANE DOE')).toBeInTheDocument();
    expect(reviewBtn).toBeDisabled();

    // 5. Confirming the Paycrest name: now ENABLED
    fireEvent.click(screen.getByRole('checkbox', { name: /confirm this is my account name/i }));
    await waitFor(() => {
      expect(reviewBtn).not.toBeDisabled();
    });

    // 6. Unchecking the confirmation: disabled again
    fireEvent.click(screen.getByRole('checkbox', { name: /confirm this is my account name/i }));
    expect(reviewBtn).toBeDisabled();
  });

  it('disables review below the minimum and enables it above it', async () => {
    stubBankingFetch('JANE DOE');

    render(
      React.createElement(CashOutCard, {
        balanceG: 5000,
        onInitiateCashOut: () => undefined,
        language: 'en',
        ngnPerUsdt: fakeNgnRate,
      })
    );

    // Provide valid bank details
    await screen.findByRole('option', { name: BANK_NAME });
    fireEvent.change(screen.getByLabelText('Bank name'), { target: { value: BANK_CODE } });
    fireEvent.change(screen.getByPlaceholderText('10-digit account number'), { target: { value: '1234567890' } });
    expect(await screen.findByText('JANE DOE')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('checkbox', { name: /confirm this is my account name/i }));

    const input = screen.getByDisplayValue('1000');
    // 4473 G$ is below the $0.51 floor
    fireEvent.change(input, { target: { value: '4473' } });
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /review cash out/i })).toBeDisabled();
    });

    // 4474 G$ reaches the $0.51 floor
    fireEvent.change(input, { target: { value: '4474' } });
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /review cash out/i })).not.toBeDisabled();
    });
  });

  it('shows a 10% exit contribution on the cash-out screen', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ data: { sell: { rate: fakeNgnRate } } }),
      })
    );

    render(
      React.createElement(CashOutCard, {
        balanceG: 5000,
        onInitiateCashOut: () => undefined,
        language: 'en',
        ngnPerUsdt: fakeNgnRate,
      })
    );

    const input = screen.getByDisplayValue('1000');
    fireEvent.change(input, { target: { value: '1000' } });

    await waitFor(() => {
      expect(screen.getByText('−100 G$')).toBeInTheDocument();
    });
  });

  it('shows the same naira value in the cash-out screen and review sheet', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ data: { sell: { rate: fakeNgnRate } } }),
      })
    );

    const amount = 1000;
    const rate = getCashoutRate(amount, 123.48, fakeNgnRate);
    const formattedValue = `₦${rate.netNaira.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;

    render(
      React.createElement(
        React.Fragment,
        null,
        React.createElement(CashOutCard, {
          balanceG: amount,
          onInitiateCashOut: () => undefined,
          language: 'en',
          ngnPerUsdt: fakeNgnRate,
        }),
        React.createElement(ConfirmModal, {
          isOpen: true,
          onClose: () => undefined,
          onConfirm: async () => undefined,
          onRefresh: () => undefined,
          quote: getNetQuote({ amountIn: BigInt(Math.floor(amount * 1e18)), ngnPerUsdt: fakeNgnRate }),
          amountG: amount,
          slippageBps: 100,
          language: 'en',
          bankName: 'First Bank',
          accountNumber: '1234567890',
          ngnPerUsdt: fakeNgnRate,
        })
      )
    );

    const escapedValue = formattedValue.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

    await waitFor(() => {
      expect(document.body.textContent).toMatch(new RegExp(`about\\s*${escapedValue}`, 'i'));
      expect(document.body.textContent).toMatch(new RegExp(`${escapedValue}`, 'i'));
    });
  });

  describe('fetchPaycrestRate strict sell rate and CORS routing', () => {
    it('throws when data.sell.rate is missing, refusing to fall back to buy.rate', async () => {
      const { fetchPaycrestRate } = await import('./rate');
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          json: async () => ({
            data: {
              buy: { rate: '1700.00' }, // buy rate present, but sell rate missing
            },
          }),
        })
      );

      await expect(fetchPaycrestRate()).rejects.toThrow('Rate unavailable, try again');
    });

    it('routes through orders service /rates when direct Paycrest request fails (CORS fallback)', async () => {
      const { fetchPaycrestRate } = await import('./rate');
      const mockFetch = vi.fn()
        .mockRejectedValueOnce(new TypeError('Failed to fetch')) // simulated CORS or network block on direct URL
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            data: {
              sell: { rate: '1650.00' },
            },
          }),
        });

      vi.stubGlobal('fetch', mockFetch);

      const rate = await fetchPaycrestRate();
      expect(rate).toBe(1650);
      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(mockFetch.mock.calls[1][0]).toContain('/rates');
    });
  });
});
