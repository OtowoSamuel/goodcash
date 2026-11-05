import { describe, expect, it, vi } from 'vitest';

import { PAYCREST_FEE_RESERVE_USDT, createPaycrestOrder, paycrestOrderAmount } from './useOffRamp';

// Paycrest docs: providerAccount.amountToTransfer =
// amount + senderFee + transactionFee.
const SENDER_FEE = 0;
const TRANSACTION_FEE = 0.01;

function amountToSendFor(usdtReceived: number): number {
  return Number(paycrestOrderAmount(usdtReceived)) + SENDER_FEE + TRANSACTION_FEE;
}

describe('paycrestOrderAmount', () => {
  it('reserves the documented fees so amountToSend never exceeds the swap output', () => {
    const usdtReceived = 0.55;
    const amount = paycrestOrderAmount(usdtReceived);

    expect(amount).toBe('0.540000');
    for (const received of [0.51, 0.55, 1, 5, 100]) {
      expect(amountToSendFor(received)).toBeLessThanOrEqual(received);
    }
  });

  it('keeps the payout at the $0.50 partner minimum at the $0.51 floor', () => {
    const usdtReceived = 0.51;
    const amount = paycrestOrderAmount(usdtReceived);

    expect(amount).toBe('0.500000');
    expect(amountToSendFor(usdtReceived)).toBeLessThanOrEqual(usdtReceived);
  });

  it('never returns a negative amount', () => {
    expect(paycrestOrderAmount(0.005)).toBe('0.000000');
    expect(paycrestOrderAmount(0)).toBe('0.000000');
    expect(paycrestOrderAmount(Number.NaN)).toBe('0.000000');
  });

  it('reserve is the documented transaction fee', () => {
    expect(PAYCREST_FEE_RESERVE_USDT).toBe(TRANSACTION_FEE);
  });
});

const SWAP_TX_HASH = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const REFUND_ADDRESS = '0xafDeEbB89Cda1669361117eA2EAe3411F1228cb6';

function mockOrder(amountToSend: string, transactionFee = '0.1') {
  return new Response(
    JSON.stringify({
      orderId: 'ord-test',
      receiveAddress: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      amountToSend,
      currency: 'USDT',
      network: 'celo',
      senderFee: '0',
      transactionFee,
      validUntil: new Date(Date.now() + 900000).toISOString(),
      status: 'initiated',
    }),
    { status: 200, headers: { 'content-type': 'application/json' } }
  );
}

function baseInput(usdtReceived: number) {
  return {
    amountUsdt: paycrestOrderAmount(usdtReceived),
    usdtReceived,
    swapTxHash: SWAP_TX_HASH,
    refundAddress: REFUND_ADDRESS,
    recipient: {
      institution: 'GTBINGLA',
      accountIdentifier: '0123456789',
      accountName: 'JANE DOE',
    },
  } as Parameters<typeof createPaycrestOrder>[0];
}

describe('createPaycrestOrder fee overflow', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('recreates the order with a smaller amount when transactionFee pushes amountToSend above usdtReceived', async () => {
    const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(
      async () => mockOrder('1.090000')
    );
    fetchMock.mockResolvedValueOnce(mockOrder('1.090000'));
    fetchMock.mockResolvedValueOnce(mockOrder('0.999999'));
    vi.stubGlobal('fetch', fetchMock);

    const order = await createPaycrestOrder(baseInput(1));

    expect(order.amountToSend).toBe('0.999999');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const secondBody = JSON.parse(fetchMock.mock.calls[1][1]!.body as string);
    expect(secondBody.amount).toBe('0.899999');
    expect(Number(order.amountToSend)).toBeLessThanOrEqual(1);
  });

  it('shows an error instead of a deposit step when the reduced order would fall below the $0.50 minimum', async () => {
    const fetchMock = vi.fn(async () => mockOrder('0.640000'));
    vi.stubGlobal('fetch', fetchMock);

    await expect(createPaycrestOrder(baseInput(0.55))).rejects.toThrow(/0\.50/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
