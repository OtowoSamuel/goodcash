// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import {
  createPublicClient,
  createTestClient,
  createWalletClient,
  decodeEventLog,
  http,
  parseAbi,
  parseUnits,
  type Address,
} from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { celo } from 'viem/chains';
import {
  executeRouterSwap,
  ROUTER_ADDRESS,
  CASH_OUT_EVENT_ABI,
  ROUTE_RESERVE_THEN_UNISWAP,
  ROUTE_UNISWAP_THEN_UNISWAP,
} from './router';
import type { QuoteResult } from './quote';

// This is a real Celo-mainnet fork driven by anvil. It is opt-in because it
// needs network access and the anvil binary:
//   RUN_ANVIL_FORK=1 npm --workspace apps/web run test -- router.anvil
const RUN = process.env.RUN_ANVIL_FORK === '1';
const anvilDescribe = RUN ? describe : describe.skip;

const G_DOLLAR = '0x62B8B11039FcfE5aB0C56E502b1C372A3d2a9c7A' as Address;
const USDT = '0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e' as Address;
const OWNER = '0xDeaDbeefdEAdbeefdEadbEEFdeadbeEFdEaDbeeF' as Address;
// Uniswap G$/USDm pool holds >8M G$ on Celo mainnet.
const G_WHALE = '0x9491d57c5687AB75726423B55AC2d87D1cDa2c3F' as Address;

const ERC20_TRANSFER_ABI = parseAbi([
  'function transfer(address to, uint256 amount) external returns (bool)',
  'function balanceOf(address account) external view returns (uint256)',
]);
const ROUTER_ADMIN_ABI = parseAbi([
  'function unpause() external',
  'function paused() external view returns (bool)',
]);

function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close();
        reject(new Error('Could not allocate an anvil port'));
        return;
      }
      const { port } = address;
      server.close(() => resolve(port));
    });
  });
}

async function waitForRpc(url: string, timeoutMs = 90_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_chainId', params: [] }),
      });
      if (res.ok) return;
    } catch {
      // Not listening yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error('anvil RPC did not become ready');
}

anvilDescribe('executeRouterSwap on a Celo anvil fork (both routes)', () => {
  let anvil: ChildProcess;
  let rpcUrl: string;
  let account: ReturnType<typeof privateKeyToAccount>;
  let publicClient: ReturnType<typeof createPublicClient>;
  let walletClient: ReturnType<typeof createWalletClient>;
  let testClient: ReturnType<typeof createTestClient>;

  beforeAll(async () => {
    const port = await getFreePort();
    rpcUrl = `http://127.0.0.1:${port}`;
    const forkUrl = process.env.CELO_RPC_URL || 'https://forno.celo.org';

    anvil = spawn(
      'anvil',
      ['--fork-url', forkUrl, '--chain-id', '42220', '--port', String(port)],
      { stdio: 'ignore' }
    );
    await waitForRpc(rpcUrl);

    account = privateKeyToAccount(generatePrivateKey());
    const transport = http(rpcUrl);
    publicClient = createPublicClient({ chain: celo, transport });
    walletClient = createWalletClient({ chain: celo, transport, account });
    testClient = createTestClient({ chain: celo, mode: 'anvil', transport });

    // Fund throwaway wallet with CELO (gas) and G$ from whale
    await testClient.setBalance({ address: account.address, value: parseUnits('100', 18) });
    await testClient.setBalance({ address: G_WHALE, value: parseUnits('100', 18) });
    await testClient.impersonateAccount({ address: G_WHALE });

    const whaleWallet = createWalletClient({ chain: celo, transport, account: G_WHALE });
    const transferHash = await whaleWallet.writeContract({
      address: G_DOLLAR,
      abi: ERC20_TRANSFER_ABI,
      functionName: 'transfer',
      args: [account.address, parseUnits('40000', 18)],
      account: G_WHALE,
    });
    await publicClient.waitForTransactionReceipt({ hash: transferHash });

    // Unpause router on the fork if paused
    await testClient.setBalance({ address: OWNER, value: parseUnits('100', 18) });
    await testClient.impersonateAccount({ address: OWNER });
    const ownerWallet = createWalletClient({ chain: celo, transport, account: OWNER });
    const isPaused = await publicClient.readContract({
      address: ROUTER_ADDRESS,
      abi: ROUTER_ADMIN_ABI,
      functionName: 'paused',
    });
    if (isPaused) {
      const unpauseHash = await ownerWallet.writeContract({
        address: ROUTER_ADDRESS,
        abi: ROUTER_ADMIN_ABI,
        functionName: 'unpause',
        account: OWNER,
      });
      await publicClient.waitForTransactionReceipt({ hash: unpauseHash });
    }

    (globalThis as unknown as { window: { ethereum?: unknown } }).window = {
      ethereum: { isAnvil: true },
    };
  }, 180_000);

  afterAll(() => {
    if (anvil && !anvil.killed) {
      anvil.kill('SIGKILL');
    }
  });

  it(
    'executes route 1: reserve route (ReserveThenUniswap) and decodes CashOut event',
    async () => {
      const quote: QuoteResult = {
        'amountInG$': parseUnits('10000', 18),
        grossUsdm: 1_266_588_380_630_945_380n,
        netUsdm: 1_139_928_040_919_229_989n,
        usdtOut: 1_139_928n, // ~1.139928 USDT (6 decimals)
        priceImpactBps: 5n,
        exitContributionBps: 1000n,
        swapFeeBps: 0n,
        networkFeeUsd: 0n,
        partnerFeeUsd: 0n,
        netNaira: 0n,
        route: 'reserve',
        quotedAt: Date.now(),
        expiresAt: Date.now() + 60_000,
      };

      const result = await executeRouterSwap({
        amountG: 10_000,
        quote,
        slippageBps: 300,
        walletAddress: account.address,
        isDemoMode: false,
        publicClient,
        walletClient,
      });

      expect(result.txHash).toMatch(/^0x[0-9a-fA-F]{64}$/);
      expect(result.usdtReceived).toBeGreaterThan(0.5);

      const receipt = await publicClient.waitForTransactionReceipt({ hash: result.txHash as `0x${string}` });
      expect(receipt.status).toBe('success');

      const cashOutLog = receipt.logs.find((log) => log.address.toLowerCase() === ROUTER_ADDRESS.toLowerCase());
      expect(cashOutLog).toBeDefined();

      const decoded = decodeEventLog({
        abi: [CASH_OUT_EVENT_ABI],
        data: cashOutLog!.data,
        topics: cashOutLog!.topics,
      });
      expect(decoded.eventName).toBe('CashOut');
      const args = decoded.args as { user: Address; recipient: Address; tokenOut: Address; amountOut: bigint; route: number };
      expect(args.user.toLowerCase()).toBe(account.address.toLowerCase());
      expect(args.recipient.toLowerCase()).toBe(account.address.toLowerCase());
      expect(args.tokenOut.toLowerCase()).toBe(USDT.toLowerCase());
      expect(args.route).toBe(ROUTE_RESERVE_THEN_UNISWAP);
      expect(Number(args.amountOut) / 1e6).toBeCloseTo(result.usdtReceived, 6);
    },
    180_000
  );

  it(
    'executes route 2: uniswap route (UniswapThenUniswap) and decodes CashOut event',
    async () => {
      const quote: QuoteResult = {
        'amountInG$': parseUnits('10000', 18),
        grossUsdm: 1_266_588_380_630_945_380n,
        netUsdm: 1_139_928_040_919_229_989n,
        usdtOut: 1_139_928n, // ~1.139928 USDT (6 decimals)
        priceImpactBps: 5n,
        exitContributionBps: 1000n,
        swapFeeBps: 30n,
        networkFeeUsd: 0n,
        partnerFeeUsd: 0n,
        netNaira: 0n,
        route: 'uniswap',
        quotedAt: Date.now(),
        expiresAt: Date.now() + 60_000,
      };

      const result = await executeRouterSwap({
        amountG: 10_000,
        quote,
        slippageBps: 500,
        walletAddress: account.address,
        isDemoMode: false,
        publicClient,
        walletClient,
      });

      expect(result.txHash).toMatch(/^0x[0-9a-fA-F]{64}$/);
      expect(result.usdtReceived).toBeGreaterThan(0.5);

      const receipt = await publicClient.waitForTransactionReceipt({ hash: result.txHash as `0x${string}` });
      expect(receipt.status).toBe('success');

      const cashOutLog = receipt.logs.find((log) => log.address.toLowerCase() === ROUTER_ADDRESS.toLowerCase());
      expect(cashOutLog).toBeDefined();

      const decoded = decodeEventLog({
        abi: [CASH_OUT_EVENT_ABI],
        data: cashOutLog!.data,
        topics: cashOutLog!.topics,
      });
      expect(decoded.eventName).toBe('CashOut');
      const args = decoded.args as { user: Address; recipient: Address; tokenOut: Address; amountOut: bigint; route: number };
      expect(args.user.toLowerCase()).toBe(account.address.toLowerCase());
      expect(args.recipient.toLowerCase()).toBe(account.address.toLowerCase());
      expect(args.tokenOut.toLowerCase()).toBe(USDT.toLowerCase());
      expect(args.route).toBe(ROUTE_UNISWAP_THEN_UNISWAP);
      expect(Number(args.amountOut) / 1e6).toBeCloseTo(result.usdtReceived, 6);
    },
    180_000
  );
});
