import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  computeMinAmountOut,
  executeRouterSwap,
  MIN_AMOUNT_OUT,
  ROUTER_ADDRESS,
} from './router';
import type { QuoteResult } from './quote';
import { pad, keccak256, toBytes } from 'viem';
import type { PublicClient, WalletClient } from 'viem';

// ---------------------------------------------------------------------------
// Shared quote fixture: 1000 G$ → ~0.1140 USDT via reserve
// ---------------------------------------------------------------------------
const QUOTE: QuoteResult = {
  'amountInG$': BigInt(1000e18),
  grossUsdm: BigInt(Math.floor(0.126658 * 1e18)),
  netUsdm: BigInt(Math.floor(0.113992 * 1e18)),
  usdtOut: 114000n, // 0.114000 USDT in 6-decimal
  priceImpactBps: 5n,
  exitContributionBps: 1000n,
  swapFeeBps: 0n,
  networkFeeUsd: 0n,
  partnerFeeUsd: 0n,
  netNaira: 171000n,
  route: 'reserve',
  quotedAt: Date.now(),
  expiresAt: Date.now() + 60_000,
};

// Build a CashOut event log with the specified amountOut
function makeCashOutLog(amountOutUsdt6: bigint, address: string = ROUTER_ADDRESS) {
  // CashOut event signature
  const eventSig = keccak256(
    toBytes('CashOut(address,address,address,uint256,uint256,uint8,bytes32)')
  );

  // Indexed params as topics
  const userTopic = pad('0xafDeEbB89Cda1669361117eA2EAe3411F1228cb6' as `0x${string}`, { size: 32 });
  const recipientTopic = pad('0xafDeEbB89Cda1669361117eA2EAe3411F1228cb6' as `0x${string}`, { size: 32 });
  const tokenOutTopic = pad('0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e' as `0x${string}`, { size: 32 });

  const topics = [eventSig, userTopic, recipientTopic, tokenOutTopic] as const;

  // Non-indexed params: amountIn (uint256), amountOut (uint256), route (uint8), ref (bytes32)
  const amountIn = BigInt(1000e18).toString(16).padStart(64, '0');
  const amountOut = amountOutUsdt6.toString(16).padStart(64, '0');
  const routeHex = (2).toString(16).padStart(64, '0');
  const refHex = '676f6f64636173682d7569000000000000000000000000000000000000000000';
  const data = ('0x' + amountIn + amountOut + routeHex + refHex) as `0x${string}`;

  return { data, topics, address };
}

// ---------------------------------------------------------------------------
// Mock factories
// ---------------------------------------------------------------------------
function makePublicClient(opts: {
  receiptStatus?: 'success' | 'reverted';
  allowance?: bigint;
  logs?: Array<{ data: `0x${string}`; topics: readonly `0x${string}`[]; address: string }>;
} = {}) {
  const { receiptStatus = 'success', allowance = BigInt(1e30), logs = [makeCashOutLog(114107n)] } = opts;
  return {
    readContract: vi.fn().mockResolvedValue(allowance),
    waitForTransactionReceipt: vi.fn().mockResolvedValue({
      status: receiptStatus,
      logs,
    }),
  };
}

function makeWalletClient(opts: { rejectSwap?: boolean } = {}) {
  const { rejectSwap = false } = opts;
  return {
    writeContract: vi.fn().mockImplementation(async (args: { functionName: string }) => {
      if (args.functionName === 'approve') {
        return '0xapprovehash' as `0x${string}`;
      }
      // cashOut call
      if (rejectSwap) throw new Error('User rejected the request.');
      return '0xswaphash' as `0x${string}`;
    }),
  };
}

// Stub window.ethereum so executeRouterSwap doesn't bail
beforeEach(() => {
  vi.stubGlobal('window', {
    ...(typeof globalThis.window !== 'undefined' ? globalThis.window : {}),
    ethereum: { request: vi.fn() },
  });
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('executeRouterSwap', () => {
  it('parses usdtReceived from the on-chain CashOut event log, not from the quote', async () => {
    // The event log has amountOut = 114107 (6 decimals) = 0.114107 USDT
    // The quote shows 114000. They must differ to prove we read the log.
    const eventAmountOut = 114107n;
    const publicClient = makePublicClient({ logs: [makeCashOutLog(eventAmountOut)] });
    const walletClient = makeWalletClient();

    const result = await executeRouterSwap({
      amountG: 1000,
      quote: QUOTE,
      slippageBps: 100,
      walletAddress: '0xafDeEbB89Cda1669361117eA2EAe3411F1228cb6',
      isDemoMode: false,
      publicClient: publicClient as unknown as PublicClient,
      walletClient: walletClient as unknown as WalletClient,
    });

    // Must match the EVENT value, not the quote value
    expect(result.usdtReceived).toBeCloseTo(0.114107, 6);
    expect(result.usdtReceived).not.toBe(Number(QUOTE.usdtOut) / 1e6);
    expect(result.txHash).toBe('0xswaphash');
    expect(result.amountG).toBe(1000);
  });

  it('throws on wallet rejection and never reaches waitForTransactionReceipt', async () => {
    const publicClient = makePublicClient();
    const walletClient = makeWalletClient({ rejectSwap: true });

    await expect(
      executeRouterSwap({
        amountG: 1000,
        quote: QUOTE,
        slippageBps: 100,
        walletAddress: '0xafDeEbB89Cda1669361117eA2EAe3411F1228cb6',
        isDemoMode: false,
        publicClient: publicClient as unknown as PublicClient,
        walletClient: walletClient as unknown as WalletClient,
      })
    ).rejects.toThrow('User rejected');

    // Receipt should never have been awaited
    expect(publicClient.waitForTransactionReceipt).not.toHaveBeenCalled();
  });

  it('throws on reverted transaction and surfaces error message', async () => {
    const publicClient = makePublicClient({ receiptStatus: 'reverted' });
    const walletClient = makeWalletClient();

    await expect(
      executeRouterSwap({
        amountG: 1000,
        quote: QUOTE,
        slippageBps: 100,
        walletAddress: '0xafDeEbB89Cda1669361117eA2EAe3411F1228cb6',
        isDemoMode: false,
        publicClient: publicClient as unknown as PublicClient,
        walletClient: walletClient as unknown as WalletClient,
      })
    ).rejects.toThrow('Swap transaction reverted on Celo');
  });

  it('throws if CashOut event log is missing from successful receipt', async () => {
    const publicClient = makePublicClient({ logs: [] });
    const walletClient = makeWalletClient();

    await expect(
      executeRouterSwap({
        amountG: 1000,
        quote: QUOTE,
        slippageBps: 100,
        walletAddress: '0xafDeEbB89Cda1669361117eA2EAe3411F1228cb6',
        isDemoMode: false,
        publicClient: publicClient as unknown as PublicClient,
        walletClient: walletClient as unknown as WalletClient,
      })
    ).rejects.toThrow('CashOut event log not found');
  });

  it('ignores a same-shaped CashOut log emitted by another contract', async () => {
    const spoofAddress = '0x1111111111111111111111111111111111111111';
    // The spoofed log is first and has a much larger amountOut; it must be ignored.
    const publicClient = makePublicClient({
      logs: [makeCashOutLog(999999n, spoofAddress), makeCashOutLog(114107n, ROUTER_ADDRESS)],
    });
    const walletClient = makeWalletClient();

    const result = await executeRouterSwap({
      amountG: 1000,
      quote: QUOTE,
      slippageBps: 100,
      walletAddress: '0xafDeEbB89Cda1669361117eA2EAe3411F1228cb6',
      isDemoMode: false,
      publicClient: publicClient as unknown as PublicClient,
      walletClient: walletClient as unknown as WalletClient,
    });

    expect(result.usdtReceived).toBeCloseTo(0.114107, 6);
    expect(result.usdtReceived).not.toBeCloseTo(0.999999, 6);
  });

  it('throws if the only same-shaped CashOut log is from another contract', async () => {
    const publicClient = makePublicClient({
      logs: [makeCashOutLog(114107n, '0x2222222222222222222222222222222222222222')],
    });
    const walletClient = makeWalletClient();

    await expect(
      executeRouterSwap({
        amountG: 1000,
        quote: QUOTE,
        slippageBps: 100,
        walletAddress: '0xafDeEbB89Cda1669361117eA2EAe3411F1228cb6',
        isDemoMode: false,
        publicClient: publicClient as unknown as PublicClient,
        walletClient: walletClient as unknown as WalletClient,
      })
    ).rejects.toThrow('CashOut event log not found');
  });

  it('10,000 G$ with 1% slippage gives a minimum close to the quote, not 0.51', () => {
    // 10,000 G$ yields ~1.139928 USDT (1_139_928n in 6 decimals)
    const quote10kUsdtOut = 1_139_928n;
    const slippageBps = 100; // 1%
    const minOut = computeMinAmountOut(quote10kUsdtOut, slippageBps);

    // Slippage-based minimum: 1_139_928 * 9900 / 10000 = 1_128_528n
    expect(minOut).toBe(1_128_528n);
    expect(minOut).toBeGreaterThan(510_000n);
    // Confirms it is close to the quote (~1.1285 USDT) and NOT 0.51
    expect(Number(minOut) / 1e6).toBeCloseTo(1.128528, 5);
  });

  it('clamps minAmountOut to $0.51 so a $0.50 quote with 1% slippage cannot fall below the payout floor', async () => {
    const justAboveMinimum = { ...QUOTE, usdtOut: 500100n }; // $0.5001
    const slippageAdjusted = (justAboveMinimum.usdtOut * 9900n) / 10000n; // $0.495099

    expect(MIN_AMOUNT_OUT).toBe(510000n); // $0.51 (Paycrest $0.50 + $0.01 fee margin)
    expect(slippageAdjusted).toBe(495099n);
    expect(computeMinAmountOut(justAboveMinimum.usdtOut, 100)).toBe(510000n);

    const writeContract = vi.fn().mockImplementation(async (args: { functionName: string }) => {
      if (args.functionName === 'approve') return '0xapprovehash' as `0x${string}`;
      return '0xswaphash' as `0x${string}`;
    });
    const publicClient = makePublicClient({ logs: [makeCashOutLog(510000n)] });

    await executeRouterSwap({
      amountG: 4400,
      quote: justAboveMinimum,
      slippageBps: 100,
      walletAddress: '0xafDeEbB89Cda1669361117eA2EAe3411F1228cb6',
      isDemoMode: false,
      publicClient: publicClient as unknown as PublicClient,
      walletClient: { writeContract } as unknown as WalletClient,
    });

    const cashOutCall = writeContract.mock.calls.find(
      ([args]) => (args as { functionName: string }).functionName === 'cashOut'
    );
    expect(cashOutCall).toBeDefined();
    const cashOutArgs = (cashOutCall![0] as { args: readonly unknown[] }).args;
    expect(cashOutArgs[2]).toBe(510000n);
    expect(cashOutArgs[2] as bigint).toBeGreaterThan(slippageAdjusted);
  });

  it('demo mode returns fake result without touching wallet or public client', async () => {
    const publicClient = makePublicClient();
    const walletClient = makeWalletClient();

    const result = await executeRouterSwap({
      amountG: 1000,
      quote: QUOTE,
      slippageBps: 100,
      walletAddress: '0xafDeEbB89Cda1669361117eA2EAe3411F1228cb6',
      isDemoMode: true,
      publicClient: publicClient as unknown as PublicClient,
      walletClient: walletClient as unknown as WalletClient,
    });

    expect(result.txHash).toMatch(/^0x[0-9a-f]{64}$/);
    expect(result.amountG).toBe(1000);
    // Real clients should never have been called
    expect(publicClient.readContract).not.toHaveBeenCalled();
    expect(walletClient.writeContract).not.toHaveBeenCalled();
  });
});
