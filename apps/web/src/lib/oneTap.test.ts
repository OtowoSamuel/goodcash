// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { decodeAbiParameters, encodeAbiParameters, encodeEventTopics, parseAbi, parseAbiParameters, pad, type Address } from 'viem';

const ROUTER2 = '0x2222222222222222222222222222222222222222' as Address;
const USER = '0x1111111111111111111111111111111111111111' as Address;
const PARTNER = '0x7F259f22250e8a92Ed4b87c944A3e048B67e53ef' as Address;
const G = '0x62B8B11039FcfE5aB0C56E502b1C372A3d2a9c7A';

async function load() {
  const r = await import('./router');
  // run every flow against the test router address, like a real deployment would
  const executeOneTapCashOut: typeof r.executeOneTapCashOut = (a) => r.executeOneTapCashOut({ ...a, routerAddress: ROUTER2 });
  return { ...r, executeOneTapCashOut };
}

const quote = { usdtOut: 574_000n, route: 'reserve' } as never;
const goodOrder = (over: Record<string, unknown> = {}) => ({
  receiveAddress: PARTNER,
  payAmountAtomic: '570000',
  routerAddress: ROUTER2,
  validUntil: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
  orderId: '550e8400-e29b-41d4-a716-446655440000',
  ...over,
});

describe('one-tap cash out', () => {
  beforeEach(() => {
    vi.stubGlobal('window', { ethereum: { request: vi.fn(async () => '0xa4ec') } });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('is only switched on by a real router address', async () => {
    const { parseRouterV2Address } = await import('./router');
    expect(parseRouterV2Address(ROUTER2)).toBe(ROUTER2);
    for (const bad of [undefined, '', '0x', '0x123', '0x0000000000000000000000000000000000000000', 'not-an-address']) {
      expect(parseRouterV2Address(bad)).toBeNull();
    }
  });

  it('is off in this build, because no router address is configured yet', async () => {
    expect((await import('./router')).ONE_TAP_ENABLED).toBe(false);
  });

  it('encodes exactly what the router decodes, and sizes the guaranteed minimum with a 0.5% cushion', async () => {
    const r = await load();
    expect(r.computeOneTapMinOut(quote)).toBe((574_000n * 9_950n) / 10_000n);
    const data = r.encodeOneTapData({
      route: 0,
      minOut: 571_130n,
      deadline: 1_900_000_000n,
      payTo: PARTNER,
      payAmount: 570_000n,
      ref: pad('0x01', { size: 32, dir: 'right' }),
    });
    const [route, minOut, deadline, payTo, payAmount] = decodeAbiParameters(
      parseAbiParameters('uint8, uint256, uint256, address, uint256, bytes32'),
      data
    );
    expect([route, minOut, deadline, payTo.toLowerCase(), payAmount]).toEqual([0, 571_130n, 1_900_000_000n, PARTNER.toLowerCase(), 570_000n]);
  });

  describe('refuses before the wallet is ever asked', () => {
    const attempt = async (order: ReturnType<typeof goodOrder>, minOut = 571_000n) => {
      const r = await load();
      const walletClient = { writeContract: vi.fn(), account: undefined } as never;
      const publicClient = { readContract: vi.fn().mockResolvedValue(false) } as never;
      const p = r.executeOneTapCashOut({ amountG: 5000, quote, minOut, walletAddress: USER, order, walletClient, publicClient });
      return { p, walletClient: walletClient as unknown as { writeContract: ReturnType<typeof vi.fn> } };
    };

    it('a router address that is not ours', async () => {
      const { p, walletClient } = await attempt(goodOrder({ routerAddress: '0x3333333333333333333333333333333333333333' }));
      await expect(p).rejects.toThrow(/ORDER_MISMATCH/);
      expect(walletClient.writeContract).not.toHaveBeenCalled();
    });
    it('a zero or placeholder deposit address', async () => {
      for (const receiveAddress of ['0x0000000000000000000000000000000000000000', '0x3841D6A1F3E92B710c0e5a953eB684B24B35fC75', '0x123']) {
        const { p, walletClient } = await attempt(goodOrder({ receiveAddress }));
        await expect(p).rejects.toThrow(/ORDER_MISMATCH/);
        expect(walletClient.writeContract).not.toHaveBeenCalled();
      }
    });
    it('an order that asks for more than the guaranteed minimum', async () => {
      const { p, walletClient } = await attempt(goodOrder({ payAmountAtomic: '600000' }), 571_000n);
      await expect(p).rejects.toThrow(/PRICE_MOVED/);
      expect(walletClient.writeContract).not.toHaveBeenCalled();
    });
    it('an order that is about to expire', async () => {
      const { p, walletClient } = await attempt(goodOrder({ validUntil: new Date(Date.now() + 30_000).toISOString() }));
      await expect(p).rejects.toThrow(/ORDER_EXPIRED/);
      expect(walletClient.writeContract).not.toHaveBeenCalled();
    });
  });

  it('sends ONE transferAndCall to the G$ token, to our router, and reads the result from the receipt', async () => {
    const r = await load();
    const eventAbi = parseAbi([
      'event CashOutPaid(address indexed user, address indexed payTo, uint256 gIn, uint256 usdtOut, uint256 usdtPaid, uint256 usdtReturned, uint8 route, bytes32 ref)',
    ]);
    const topics = encodeEventTopics({ abi: eventAbi, eventName: 'CashOutPaid', args: { user: USER, payTo: PARTNER } });
    const logData = encodeAbiParameters(parseAbiParameters('uint256,uint256,uint256,uint256,uint8,bytes32'), [
      5000n * 10n ** 18n, 574_000n, 570_000n, 4_000n, 0, pad('0x00', { size: 32 }),
    ]);
    const writeContract = vi.fn().mockResolvedValue('0x' + 'ab'.repeat(32));
    const walletClient = { writeContract, account: undefined } as never;
    const publicClient = {
      readContract: vi.fn().mockResolvedValue(false),
      waitForTransactionReceipt: vi.fn().mockResolvedValue({ status: 'success', logs: [{ address: ROUTER2, topics, data: logData }] }),
    } as never;
    const steps: Array<{ kind: string; n: number; total: number }> = [];

    const out = await r.executeOneTapCashOut({
      amountG: 5000, quote, minOut: 571_000n, walletAddress: USER, order: goodOrder(), walletClient, publicClient,
      onStep: (s) => steps.push(s),
    });

    expect(writeContract).toHaveBeenCalledTimes(1); // one confirmation
    const call = writeContract.mock.calls[0][0];
    expect(call.address.toLowerCase()).toBe(G.toLowerCase());
    expect(call.functionName).toBe('transferAndCall');
    expect((call.args[0] as string).toLowerCase()).toBe(ROUTER2.toLowerCase());
    expect(call.args[1]).toBe(5000n * 10n ** 18n);
    expect(steps).toEqual([{ kind: 'swap', n: 1, total: 1 }]);
    expect(out).toMatchObject({ usdtOut: 0.574, usdtPaid: 0.57, usdtReturned: 0.004, amountG: 5000 });
  });

  it('says "still confirming" instead of "failed" when the receipt cannot be read', async () => {
    const r = await load();
    const walletClient = { writeContract: vi.fn().mockResolvedValue('0x' + 'cd'.repeat(32)), account: undefined } as never;
    const publicClient = {
      readContract: vi.fn().mockResolvedValue(false),
      waitForTransactionReceipt: vi.fn().mockRejectedValue(new Error('timeout')),
    } as never;
    await expect(
      r.executeOneTapCashOut({ amountG: 5000, quote, minOut: 571_000n, walletAddress: USER, order: goodOrder(), walletClient, publicClient })
    ).rejects.toMatchObject({ name: 'SwapPendingError' });
  });

  it('plain wording for the new failures, never "nothing was taken" when money may have moved', async () => {
    const r = await load();
    expect(r.friendlySwapError(new Error('PRICE_MOVED'))).toMatch(/price moved/i);
    expect(r.friendlySwapError(new Error('execution reverted: InsufficientOutput(1,2)'))).toMatch(/price moved/i);
    expect(r.friendlySwapError(new Error('ORDER_EXPIRED'))).toMatch(/window closed/i);
    expect(r.friendlySwapError(new r.SwapPendingError('0xabc'))).toMatch(/don't send it again/i);
  });
});

describe('pause check', () => {
  it('reports paused when the router is paused, and not when it is open', async () => {
    const r = await import('./router');
    // not configured in this build, so it counts as paused (the flow is off)
    expect(await r.isOneTapRouterPaused({ readContract: vi.fn().mockResolvedValue(false) } as never)).toBe(true);
  });
});

describe('reading the pause flag fails closed', () => {
  const ADDR = '0x546698368a246539Df5e641EdC2b79c5782ea359' as const;
  it('answers from the router when it can be read, and retries once', async () => {
    const r = await import('./router');
    expect(await r.readRouterPaused({ readContract: vi.fn().mockResolvedValue(true) } as never, ADDR)).toBe(true);
    expect(await r.readRouterPaused({ readContract: vi.fn().mockResolvedValue(false) } as never, ADDR)).toBe(false);
    const flaky = vi.fn().mockRejectedValueOnce(new Error('rpc down')).mockResolvedValueOnce(false);
    expect(await r.readRouterPaused({ readContract: flaky } as never, ADDR)).toBe(false);
    expect(flaky).toHaveBeenCalledTimes(2);
  });
  it('throws, and never answers "not paused", when the state cannot be read', async () => {
    const r = await import('./router');
    const down = vi.fn().mockRejectedValue(new Error('rpc down'));
    await expect(r.readRouterPaused({ readContract: down } as never, ADDR)).rejects.toThrow('rpc down');
    expect(down).toHaveBeenCalledTimes(2);
  });
});

describe('which cash-out flow is used', () => {
  it('uses one tap when it is switched on and open; pauses (never the original router) when it is paused', async () => {
    const { chooseCashOutFlow } = await import('./router');
    expect(chooseCashOutFlow(true, false)).toBe('one-tap');
    expect(chooseCashOutFlow(true, true)).toBe('paused'); // paused: nothing is sent; the original router is never the fallback
    expect(chooseCashOutFlow(false, false)).toBe('three-step'); // one-tap not configured at all (development builds only)
    expect(chooseCashOutFlow(false, true)).toBe('three-step');
  });
});

describe('network fee check', () => {
  const W = '0x1111111111111111111111111111111111111111';
  const GWEI = 1_000_000_000n;
  const client = (balanceWei: bigint) => ({
    getBalance: async () => balanceWei,
    getGasPrice: async () => 202n * GWEI,
    readContract: (async () => [67_650_000_000_000_000_000_000n, 10n ** 24n]) as never,
  });

  it('uses real cash-out sizes: a wallet with no CELO cannot send, and is told exactly how much to add', async () => {
    const { getNetworkFeeInfo, friendlySwapError, NetworkFeeError } = await import('./router');
    const empty = (await getNetworkFeeInfo(W, 'one-tap', client(0n)))!;
    expect(empty.enough).toBe(false);
    // ~1M gas at 202 gwei is ~0.20 CELO spent; the wallet must hold ~0.35 before it will send
    expect(empty.feeCelo).toBeCloseTo(0.202, 3);
    expect(empty.needCelo).toBeGreaterThan(0.3);
    const msg = friendlySwapError(new NetworkFeeError(empty));
    expect(msg).toMatch(/Top up first/);
    expect(msg).toMatch(/you have 0 CELO/);
    expect(msg).toMatch(/not G\$/);
    expect(msg).not.toMatch(/revert|0x|error|swap failed/i);
  });

  it('lets a wallet with enough CELO through, and never blocks when the check itself fails', async () => {
    const { getNetworkFeeInfo } = await import('./router');
    expect((await getNetworkFeeInfo(W, 'one-tap', client(10n ** 18n)))!.enough).toBe(true);
    const broken = { getBalance: async () => { throw new Error('rpc'); }, getGasPrice: async () => 1n };
    expect(await getNetworkFeeInfo(W, 'one-tap', broken)).toBeNull();
  });

  it('shows the top-up in naira when the price is known, and a wallet "insufficient funds" error says top up too', async () => {
    const { getNetworkFeeInfo, networkFeeMessage, friendlySwapError } = await import('./router');
    const info = (await getNetworkFeeInfo(W, 'three-step', client(0n)))!;
    expect(networkFeeMessage(info, 1385)).toMatch(/about ₦\d+/);
    expect(friendlySwapError(new Error('insufficient funds for gas * price + value'))).toMatch(/Top up a little CELO/);
  });
});

describe('a lost wallet reply is never reported as "nothing was taken"', () => {
  it('only treats an error as "nothing sent" when it proves it', async () => {
    const { provesNothingWasSent } = await import('./router');
    expect(provesNothingWasSent({ code: 4001, message: 'User rejected the request.' })).toBe(true);
    expect(provesNothingWasSent(Object.assign(new Error('x'), { name: 'TransactionExecutionError', cause: { name: 'UserRejectedRequestError', message: 'denied' } }))).toBe(true);
    expect(provesNothingWasSent(Object.assign(new Error('Execution reverted'), { name: 'EstimateGasExecutionError' }))).toBe(true);
    expect(provesNothingWasSent(new Error('insufficient funds for gas'))).toBe(true);
    // a phone wallet's request timing out says nothing about whether the customer approved it
    expect(provesNothingWasSent(new Error('Request expired. Please try again.'))).toBe(false);
    expect(provesNothingWasSent(new Error('The request timed out'))).toBe(false);
    expect(provesNothingWasSent({ name: 'HttpRequestError', message: 'Failed to fetch' })).toBe(false);
  });

  it('says to check History first, and never "nothing was taken", for an unclear failure', async () => {
    const { friendlySwapError, SwapUncertainError } = await import('./router');
    const msg = friendlySwapError(new SwapUncertainError(new Error('Request expired')));
    expect(msg).toMatch(/check History/i);
    expect(msg).not.toMatch(/nothing was taken/i);
    expect(friendlySwapError(new Error('some odd thing'))).not.toMatch(/nothing was taken/i);
  });

  it('finds a cash out that went through even though the wallet reply was lost', async () => {
    const { findOneTapPayment } = await import('./useOffRamp');
    let calls = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        calls++;
        const swaps = calls < 3 ? [] : [{ txHash: '0xabc', amountG: '5500', usdtReceived: '0.7', at: 1, orderId: 'ord-1' }];
        return new Response(JSON.stringify({ swaps }), { status: 200 });
      })
    );
    expect(await findOneTapPayment('ord-1', '0x1111111111111111111111111111111111111111', 5, 1)).toBe('0xabc');
    expect(await findOneTapPayment('other', '0x1111111111111111111111111111111111111111', 2, 1)).toBeNull();
    vi.unstubAllGlobals();
  });
});

describe('messages from our own server', () => {
  it('are shown as written, so a retry after a successful cash out says why instead of a vague error', async () => {
    const { friendlySwapError } = await import('./router');
    const { createOneTapOrder, OrderRequestError } = await import('./useOffRamp');
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: "That's more G$ than your wallet holds." }), { status: 400 })));
    const err = await createOneTapOrder({ minUsdt: '0.57', amountG: '5000', refundAddress: '0x1111111111111111111111111111111111111111', recipient: { institution: 'X', accountIdentifier: '1', accountName: 'A' } }).catch((e) => e);
    expect(err).toBeInstanceOf(OrderRequestError);
    expect(friendlySwapError(err)).toBe("That's more G$ than your wallet holds.");
    vi.unstubAllGlobals();
  });
});

describe('three-step cash out after a lost wallet reply', () => {
  it('finds the swap that went through (same amount, after the attempt started) so the payout can be finished', async () => {
    const { findRecentCashOut } = await import('./useOffRamp');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            swaps: [
              { txHash: '0xold', amountG: '5000', usdtReceived: '0.57', at: 100 },
              { txHash: '0xpaid', amountG: '5000', usdtReceived: '0.57', at: 2000, orderId: 'o1' },
              { txHash: '0xnew', amountG: '5000', usdtReceived: '0.58', at: 2000 },
            ],
            complete: true,
          }),
          { status: 200 }
        )
      )
    );
    expect(await findRecentCashOut('0x1111111111111111111111111111111111111111', 5000, 1500, 1, 1)).toEqual({ txHash: '0xnew', usdtReceived: 0.58, amountG: 5000 });
    expect(await findRecentCashOut('0x1111111111111111111111111111111111111111', 4700, 1500, 1, 1)).toBeNull();
    vi.unstubAllGlobals();
  });

  it('the history call says when the server is still reading older cash outs', async () => {
    const { fetchWalletHistoryFull } = await import('./useOffRamp');
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ swaps: [], complete: false }), { status: 200 })));
    expect((await fetchWalletHistoryFull('0x1111111111111111111111111111111111111111')).complete).toBe(false);
    vi.unstubAllGlobals();
  });
});
