import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { App, PENDING_PAYOUT_KEY } from './App';
import { CashOutCard } from './components/CashOutCard';
import { ReadinessCard } from './components/ReadinessCard';
import { getCashoutRate } from './lib/rate';
import * as routerModule from './lib/router';
import * as offRampModule from './lib/useOffRamp';

// Setup resilient mock localStorage
const createStorageMock = () => {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => {
      store[key] = String(value);
    },
    removeItem: (key: string) => {
      delete store[key];
    },
    clear: () => {
      store = {};
    },
    keys: () => Object.keys(store),
    dump: () => ({ ...store }),
  };
};

const storageMock = createStorageMock();
Object.defineProperty(window, 'localStorage', {
  value: storageMock,
  writable: true,
});
Object.defineProperty(globalThis, 'localStorage', {
  value: storageMock,
  writable: true,
});

const BANK_NAME = 'Zenith Bank';
const BANK_CODE = 'ZENITHB0001';

async function selectBank() {
  await screen.findByRole('option', { name: BANK_NAME });
  fireEvent.change(screen.getByLabelText('Bank name'), { target: { value: BANK_CODE } });
}

function mockPaycrestBanking(accountName: string | Promise<string>) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('/institutions/')) {
      return {
        ok: true,
        json: async () => ({
          institutions: [
            { name: BANK_NAME, code: BANK_CODE, type: 'bank' },
            { name: 'Access Bank', code: 'ABNGNGLA', type: 'bank' },
          ],
        }),
      };
    }
    if (url.includes('/verify-account')) {
      return {
        ok: true,
        json: async () => ({ accountName: await accountName }),
      };
    }
    return {
      ok: true,
      json: async () => ({ data: { sell: { rate: 1500 } } }),
    };
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('Step 1 home validation', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders the simplified home screen without the legacy hero content', () => {
    storageMock.clear();
    render(<App />);

    expect(screen.getByText(/G\$ balance/i)).toBeInTheDocument();
    expect(screen.getByText(/About .* more days of claiming to cash out/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /dismiss/i })).toBeInTheDocument();
    expect(screen.queryByText(/Cash out your GoodDollar/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/New\b/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/dune\.com/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/privacy/i)).not.toBeInTheDocument();

    const primaryAction = screen.getByRole('button', { name: /Claim today's G\$/i });
    expect(primaryAction).toBeInTheDocument();
  });

  it('keeps the shared rate consistent across Home and Cash Out for the same G$ amount', () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ data: { sell: { rate: 1500 } } }),
      })
    );

    const amount = 1000;
    const rate = getCashoutRate(amount, 123.48, 1500);

    render(
      <>
        <ReadinessCard
          balanceG={amount}
          dailyClaimG={123.48}
          onCashOutClick={() => undefined}
          onClaimClick={() => undefined}
          language="en"
          ngnPerUsdt={1500}
        />
        <CashOutCard balanceG={amount} onInitiateCashOut={() => undefined} language="en" ngnPerUsdt={1500} />
      </>
    );

    expect(screen.getAllByText(`₦${rate.netNaira.toFixed(2)}`)).toHaveLength(2);
  });
});

describe('localStorage security — render <App /> and drive cash-out', () => {
  const STORAGE_KEY = 'goodcash_active_tracker';
  const TYPED_ACCOUNT = '9876543210';
  const TYPED_HOLDER = 'ADA LOVELACE';

  beforeEach(() => {
    storageMock.clear();
    storageMock.setItem('goodcash_balance_g', '5000');
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ data: { sell: { rate: 1500 } } }),
      })
    );
    mockPaycrestBanking(TYPED_HOLDER);
  });

  afterEach(() => {
    storageMock.clear();
    vi.restoreAllMocks();
  });

  it('types bank details, completes cash-out, and never stores them in any localStorage key', async () => {
    const swapSpy = vi.spyOn(routerModule, 'executeRouterSwap').mockResolvedValue({
      txHash: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      usdtReceived: 0.55,
      amountG: 4500,
    });

    const createOrderSpy = vi.spyOn(offRampModule, 'createPaycrestOrder').mockResolvedValue({
      orderId: 'ord-app-drive-test-123',
      receiveAddress: '0x9999999999999999999999999999999999999999',
      amountToSend: '0.550000',
      currency: 'USDT',
      network: 'CELO',
      validUntil: new Date(Date.now() + 900000).toISOString(),
      status: 'initiated',
      senderFee: '0',
      transactionFee: '0',
    });

    render(<App />);

    // 1. Navigate to Cash Out tab
    const cashOutNavButtons = screen.getAllByRole('button', { name: /Cash Out/i });
    fireEvent.click(cashOutNavButtons[0]);

    // 2. Enter the amount
    const amountInput = screen.getByPlaceholderText('0');
    fireEvent.change(amountInput, { target: { value: '4500' } });

    // 3. Type the bank details (the bank field is a select; the other two are text inputs)
    await selectBank();
    fireEvent.change(screen.getByPlaceholderText('10-digit account number'), { target: { value: TYPED_ACCOUNT } });

    // Paycrest resolves the account name; the user confirms it.
    expect(await screen.findByText(TYPED_HOLDER)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('checkbox', { name: /confirm this is my account name/i }));

    // 4. Review and confirm
    const reviewBtn = await screen.findByRole('button', { name: /Review cash out/i });
    await waitFor(() => {
      expect(reviewBtn).toBeEnabled();
    });
    fireEvent.click(reviewBtn);

    const confirmBtn = await screen.findByRole('button', { name: /^Confirm$/i });
    fireEvent.click(confirmBtn);

    // 5. Complete the swap and order creation
    await waitFor(() => {
      expect(swapSpy).toHaveBeenCalledTimes(1);
      expect(createOrderSpy).toHaveBeenCalledTimes(1);
    });
    expect(createOrderSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        amountUsdt: '0.540000',
        swapTxHash: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        refundAddress: '0xafDeEbB89Cda1669361117eA2EAe3411F1228cb6',
        recipient: expect.objectContaining({
          institution: BANK_CODE,
          accountIdentifier: TYPED_ACCOUNT,
          accountName: TYPED_HOLDER,
        }),
      })
    );

    // 6. Tracker opened with the created order; only orderId + txHash are persisted
    await waitFor(() => {
      expect(screen.getByText(/Send to partner/i)).toBeInTheDocument();
    });

    const rawStored = storageMock.getItem(STORAGE_KEY);
    expect(rawStored).toBeTruthy();
    const parsed = JSON.parse(rawStored!);
    expect(parsed.orderId).toBe('ord-app-drive-test-123');
    expect(parsed.txHash).toBe('0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');

    // 7. Strict security check across every localStorage key
    const allStorage = storageMock
      .keys()
      .map((key) => `${key}=${storageMock.getItem(key)}`)
      .join('\n');

    for (const secret of [BANK_NAME, BANK_CODE, TYPED_ACCOUNT, TYPED_HOLDER]) {
      expect(allStorage).not.toContain(secret);
    }
    expect(allStorage).not.toContain('accountNumber');
    expect(allStorage).not.toContain('bankName');
    expect(allStorage).not.toContain('accountHolderName');
  });
  it('keeps Review cash out disabled until Paycrest returns the name and the user confirms it', async () => {
    let resolveName: (name: string) => void = () => {};
    mockPaycrestBanking(
      new Promise<string>((resolve) => {
        resolveName = resolve;
      })
    );

    render(<App />);
    fireEvent.click(screen.getAllByRole('button', { name: /Cash Out/i })[0]);
    fireEvent.change(screen.getByPlaceholderText('0'), { target: { value: '4500' } });
    await selectBank();
    fireEvent.change(screen.getByPlaceholderText('10-digit account number'), { target: { value: TYPED_ACCOUNT } });

    const reviewBtn = screen.getByRole('button', { name: /Review cash out/i });
    expect(reviewBtn).toBeDisabled();

    resolveName('ADA LOVELACE');
    expect(await screen.findByText('ADA LOVELACE')).toBeInTheDocument();
    expect(reviewBtn).toBeDisabled();

    fireEvent.click(screen.getByRole('checkbox', { name: /confirm this is my account name/i }));
    await waitFor(() => expect(reviewBtn).toBeEnabled());
  });
});

describe('pending payout survives reload', () => {
  const TX_HASH = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
  const TYPED_ACCOUNT = '0123456789';
  const TYPED_HOLDER = 'GRACE HOPPER';

  beforeEach(() => {
    storageMock.clear();
    storageMock.setItem('goodcash_balance_g', '5000');
    // Simulate a confirmed swap that was persisted before the browser reloaded.
    storageMock.setItem(
      PENDING_PAYOUT_KEY,
      JSON.stringify({ txHash: TX_HASH, usdtReceived: 0.57 })
    );
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ data: { sell: { rate: 1500 } } }),
      })
    );
    mockPaycrestBanking(TYPED_HOLDER);
  });

  afterEach(() => {
    storageMock.clear();
    vi.restoreAllMocks();
  });

  it('shows "Finish your payout" on reload, accepts re-entered bank details, and clears the record', async () => {
    const swapSpy = vi.spyOn(routerModule, 'executeRouterSwap');
    const createOrderSpy = vi.spyOn(offRampModule, 'createPaycrestOrder').mockResolvedValue({
      orderId: 'ord-after-reload-789',
      receiveAddress: '0x7777777777777777777777777777777777777777',
      amountToSend: '0.570000',
      currency: 'USDT',
      network: 'CELO',
      validUntil: new Date(Date.now() + 900000).toISOString(),
      status: 'initiated',
      senderFee: '0',
      transactionFee: '0',
    });

    render(<App />);

    expect(await screen.findByRole('heading', { name: /Finish your payout/i })).toBeInTheDocument();
    expect(screen.getByText(/0\.570000 USDT/)).toBeInTheDocument();

    // Bank details must be re-entered; nothing is pre-filled from storage.
    await selectBank();
    fireEvent.change(screen.getByLabelText('Account number'), { target: { value: TYPED_ACCOUNT } });
    expect(await screen.findByText(TYPED_HOLDER)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('checkbox', { name: /confirm this is my account name/i }));

    fireEvent.click(screen.getByRole('button', { name: /^Retry payout$/i }));

    await waitFor(() => {
      expect(createOrderSpy).toHaveBeenCalledTimes(1);
    });
    expect(createOrderSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        amountUsdt: '0.560000',
        swapTxHash: TX_HASH,
        refundAddress: '0xafDeEbB89Cda1669361117eA2EAe3411F1228cb6',
        recipient: expect.objectContaining({
          institution: BANK_CODE,
          accountIdentifier: TYPED_ACCOUNT,
          accountName: TYPED_HOLDER,
        }),
      })
    );

    // The swap is never repeated after reload.
    expect(swapSpy).not.toHaveBeenCalled();
    // The record is cleared when the order is created.
    expect(storageMock.getItem(PENDING_PAYOUT_KEY)).toBeNull();

    await waitFor(() => {
      expect(screen.getByText(/Send to partner/i)).toBeInTheDocument();
    });

    const allStorage = storageMock
      .keys()
      .map((key) => `${key}=${storageMock.getItem(key)}`)
      .join('\n');
    for (const secret of [BANK_NAME, BANK_CODE, TYPED_ACCOUNT, TYPED_HOLDER]) {
      expect(allStorage).not.toContain(secret);
    }
  });

  it('uses the connected wallet address as the Paycrest refund address', async () => {
    const USER_WALLET = '0x1234567890abcdef1234567890abcdef12345678';
    const createOrderSpy = vi.spyOn(offRampModule, 'createPaycrestOrder').mockResolvedValue({
      orderId: 'ord-refund-wallet-123',
      receiveAddress: '0x7777777777777777777777777777777777777777',
      amountToSend: '0.560000',
      currency: 'USDT',
      network: 'CELO',
      validUntil: new Date(Date.now() + 900000).toISOString(),
      status: 'initiated',
      senderFee: '0',
      transactionFee: '0',
    });

    render(<App walletAddress={USER_WALLET} />);

    expect(await screen.findByRole('heading', { name: /Finish your payout/i })).toBeInTheDocument();
    await selectBank();
    fireEvent.change(screen.getByLabelText('Account number'), { target: { value: TYPED_ACCOUNT } });
    expect(await screen.findByText(TYPED_HOLDER)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('checkbox', { name: /confirm this is my account name/i }));
    fireEvent.click(screen.getByRole('button', { name: /^Retry payout$/i }));

    await waitFor(() => expect(createOrderSpy).toHaveBeenCalledTimes(1));
    expect(createOrderSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        refundAddress: USER_WALLET,
        swapTxHash: TX_HASH,
        amountUsdt: '0.560000',
      })
    );
  });
});

describe('Swap succeeded but order creation failed — retry payout flow', () => {
  beforeEach(() => {
    storageMock.clear();
    storageMock.setItem('goodcash_balance_g', '5000');
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ data: { sell: { rate: 1500 } } }),
      })
    );
    mockPaycrestBanking('JANE DOE');
  });

  afterEach(() => {
    storageMock.clear();
    vi.restoreAllMocks();
  });

  it('displays error, shows Retry payout button, and reuses confirmed swap without swapping twice', async () => {
    const swapSpy = vi.spyOn(routerModule, 'executeRouterSwap').mockResolvedValue({
      txHash: '0xbeefcafe1234567890beefcafe1234567890beefcafe1234567890beefcafe',
      usdtReceived: 0.55,
      amountG: 4500,
    });

    // First attempt fails; second attempt (retry) succeeds
    const createOrderSpy = vi.spyOn(offRampModule, 'createPaycrestOrder')
      .mockRejectedValueOnce(new Error('Paycrest 502 Bad Gateway'))
      .mockResolvedValueOnce({
        orderId: 'ord-retry-success-456',
        receiveAddress: '0x8888888888888888888888888888888888888888',
        amountToSend: '0.550000',
        currency: 'USDT',
        network: 'CELO',
        validUntil: new Date(Date.now() + 900000).toISOString(),
        status: 'initiated',
        senderFee: '0',
        transactionFee: '0',
      });

    render(<App />);

    // 1. Navigate to Cash Out tab
    const cashOutNavButtons = screen.getAllByRole('button', { name: /Cash Out/i });
    fireEvent.click(cashOutNavButtons[0]);

    // 2. Input 4500 G$ to satisfy the minimum payout requirement
    const amountInput = screen.getByPlaceholderText('0');
    fireEvent.change(amountInput, { target: { value: '4500' } });

    // 2b. Enter bank details
    await selectBank();
    fireEvent.change(screen.getByPlaceholderText('10-digit account number'), { target: { value: '1234567890' } });
    expect(await screen.findByText('JANE DOE')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('checkbox', { name: /confirm this is my account name/i }));

    // 3. Click Review cash out
    const reviewBtn = await screen.findByRole('button', { name: /Review cash out/i });
    await waitFor(() => {
      expect(reviewBtn).toBeEnabled();
    });
    fireEvent.click(reviewBtn);

    // 4. In ConfirmModal, click Confirm
    const confirmBtn = await screen.findByRole('button', { name: /^Confirm$/i });
    fireEvent.click(confirmBtn);

    // 5. Wait for error to display
    await waitFor(() => {
      expect(swapSpy).toHaveBeenCalledTimes(1);
      expect(createOrderSpy).toHaveBeenCalledTimes(1);
    });

    // User sees the error message indicating swap was confirmed but payout failed
    expect(
      await screen.findByText(/Swap confirmed \(0xbeefcafe…\) but payout order failed: Paycrest 502 Bad Gateway/i)
    ).toBeInTheDocument();

    // User sees "Retry payout (swap already confirmed)" button
    const retryBtn = screen.getByRole('button', { name: /Retry payout \(swap already confirmed\)/i });
    expect(retryBtn).toBeInTheDocument();

    // Confirm button is disabled with text "Swap already confirmed" to prevent double-swapping
    const disabledConfirmBtn = screen.getByRole('button', { name: /^Swap already confirmed$/i });
    expect(disabledConfirmBtn).toBeDisabled();

    // 6. User clicks "Retry payout"
    fireEvent.click(retryBtn);

    // 7. Verify order creation succeeded and executeRouterSwap was NEVER called again
    await waitFor(() => {
      expect(createOrderSpy).toHaveBeenCalledTimes(2);
    });
    expect(swapSpy).toHaveBeenCalledTimes(1); // STRICTLY 1! Never swapped twice.

    // 8. Tracker screen opens with the retried order
    await waitFor(() => {
      expect(screen.getByText(/Send to partner/i)).toBeInTheDocument();
    });
  });
});
