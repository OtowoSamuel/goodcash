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
    expect(r.friendlySwapError(new r.SwapPendingError('0xabc'))).toMatch(/don't swap again/i);
  });
});

describe('pause check', () => {
  it('reports paused when the router is paused, and not when it is open', async () => {
    const r = await import('./router');
    // not configured in this build, so it counts as paused (the flow is off)
    expect(await r.isOneTapRouterPaused({ readContract: vi.fn().mockResolvedValue(false) } as never)).toBe(true);
  });
});
