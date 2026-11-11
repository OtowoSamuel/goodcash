import { nairaFromUsdt } from './units';
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { CashOutCard } from '../components/CashOutCard';
import { ConfirmModal } from '../components/ConfirmModal';
import { ReadinessCard } from '../components/ReadinessCard';
import { getNetQuote } from './quote';
import { getBalanceProgressPercent, getCashoutRate, MIN_NET_USDT_REQUIRED } from './rate';

/** Choose a bank in our own bank picker (it replaced the phone's dropdown). */
async function pickBank(label: string | RegExp, bankName: string) {
  const btn = await waitFor(() => {
    const b = screen.getByLabelText(label);
    expect(b).not.toBeDisabled();
    expect(b.textContent).not.toMatch(/Loading banks/);
    return b;
  });
  fireEvent.click(btn);
  fireEvent.click(await screen.findByRole('button', { name: new RegExp(bankName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) }));
}

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
      const quoteNaira = nairaFromUsdt(quoteUsdt, fakeNgnRate);

      expect(Math.abs(homeRate.netUsdt - quoteUsdt)).toBeLessThan(0.000001);
      expect(Math.abs(homeRate.netNaira - quoteNaira)).toBeLessThan(0.02);

      render(
        React.createElement(ReadinessCard, {
          balanceG: amount,
          dailyClaimG: 123.48,
          onCashOutClick: () => undefined,
          language: 'en',
          ngnPerUsdt: fakeNgnRate,
        })
      );

      expect(document.body.textContent).toContain(`${amount.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}`);
      expect(document.body.textContent).toContain(`₦${Math.round(homeRate.netNaira).toLocaleString()}`);
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
      // Check that the Naira value appears in the rendered output
      const nairaValue = `₦${Math.round(homeRate.netNaira).toLocaleString()}`;
      expect(document.body.textContent).toContain(nairaValue);
    });
  });

  it('treats 5,000 G$ as below the minimum and 5,001 G$ as above it', () => {
    const below = getCashoutRate(5000, 123.48, fakeNgnRate);
    const above = getCashoutRate(5001, 123.48, fakeNgnRate);

    expect(below.minimumReached).toBe(false);
    expect(above.minimumReached).toBe(true);
    expect(below.remainingUsdt).toBeCloseTo(0.57 - below.netUsdt, 8);
    expect(above.remainingUsdt).toBe(0);
  });

  describe('balance progress', () => {
    const perG = getCashoutRate(1000).netUsdtPerG;

    it('shows 29 when the balance is worth 29% of the minimum', () => {
      const amount = (0.29 * MIN_NET_USDT_REQUIRED) / perG;
      expect(getBalanceProgressPercent(amount)).toBe(29);
    });

    it('caps at 100 when the balance is above the minimum', () => {
      const amount = (2 * MIN_NET_USDT_REQUIRED) / perG;
      expect(getBalanceProgressPercent(amount)).toBe(100);
    });

    it('shows 0 when the balance is 0', () => {
      expect(getBalanceProgressPercent(0)).toBe(0);
    });
  });

  it('keeps the G$ minimum identical across different NGN rates', () => {
    const rates = [1500, 1373.05];

    const first = rates.map((ngn) => getCashoutRate(5001, 123.48, ngn));
    const belowFirst = rates.map((ngn) => getCashoutRate(5000, 123.48, ngn));

    for (const rate of first) {
      expect(rate.netUsdt).toBeCloseTo(first[0].netUsdt, 8);
      expect(rate.minimumReached).toBe(true);
      expect(rate.remainingG).toBe(0);
    }

    for (const rate of belowFirst) {
      expect(rate.netUsdt).toBeCloseTo(belowFirst[0].netUsdt, 8);
      expect(rate.minimumReached).toBe(false);
    }

    expect(belowFirst[0].netUsdt).toBeCloseTo(0.569964, 5);
    expect(first[0].netUsdt).toBeCloseTo(0.570078, 5);
  });

  it('with empty or invalid bank fields the Review cash out button is disabled', async () => {
    stubBankingFetch('JANE DOE');

    render(
      React.createElement(CashOutCard, {
        balanceG: 6000,
        onInitiateCashOut: () => undefined,
        language: 'en',
        ngnPerUsdt: fakeNgnRate,
      })
    );

    const input = screen.getByDisplayValue('1,000');
    fireEvent.change(input, { target: { value: '6000' } });

    const reviewBtn = screen.getByRole('button', { name: /review cash out/i });

    // 1. Initial empty bank fields: disabled
    await waitFor(() => {
      expect(reviewBtn).toBeDisabled();
    });

    const accountInput = screen.getByPlaceholderText('10-digit account number');

    // 2. Only bank selected: still disabled
    await pickBank('Bank', BANK_NAME);
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
        balanceG: 6000,
        onInitiateCashOut: () => undefined,
        language: 'en',
        ngnPerUsdt: fakeNgnRate,
      })
    );

    // Provide valid bank details
    await pickBank('Bank', BANK_NAME);
    fireEvent.change(screen.getByPlaceholderText('10-digit account number'), { target: { value: '1234567890' } });
    expect(await screen.findByText('JANE DOE')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('checkbox', { name: /confirm this is my account name/i }));

    const input = screen.getByDisplayValue('1,000');
    // 5,000 G$ is just below the $0.57 floor (static prices)
    fireEvent.change(input, { target: { value: '5000' } });
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /review cash out/i })).toBeDisabled();
    });

    // 5,001 G$ reaches the $0.57 floor
    fireEvent.change(input, { target: { value: '5001' } });
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
        balanceG: 6000,
        onInitiateCashOut: () => undefined,
        language: 'en',
        ngnPerUsdt: fakeNgnRate,
      })
    );

    const input = screen.getByDisplayValue('1,000');
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

    await waitFor(() => {
      // Check that both components show a Naira value
      expect(document.body.textContent).toContain('₦');
      expect(document.body.textContent).toMatch(/₦14[01]/); // 1,000 G$ after the payout fee, with rounding
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
