import {
  type Address,
  createPublicClient,
  createWalletClient,
  custom,
  decodeEventLog,
  http,
  pad,
  parseAbi,
  parseAbiItem,
  stringToHex,
} from 'viem';
import { celo } from 'viem/chains';
import type { QuoteResult } from './quote';
import { MIN_NET_USDT_REQUIRED } from './rate';

// ---------------------------------------------------------------------------
const envRouter =
  typeof import.meta !== 'undefined'
    ? (import.meta as { env?: { VITE_ROUTER_ADDRESS?: string } }).env?.VITE_ROUTER_ADDRESS
    : undefined;

export const ROUTER_ADDRESS: Address =
  (envRouter && envRouter.startsWith('0x') ? envRouter : '0xA4338586d4B2f0E1641C54b8cF0d53CD06B5c407') as Address;

export const G_DOLLAR_ADDRESS: Address = '0x62B8B11039FcfE5aB0C56E502b1C372A3d2a9c7A';
export const USDT_ADDRESS: Address = '0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e';

const envRpc =
  typeof import.meta !== 'undefined'
    ? (import.meta as { env?: { VITE_CELO_RPC_URL?: string } }).env?.VITE_CELO_RPC_URL
    : undefined;
export const CELO_RPC_URL: string = envRpc || 'https://forno.celo.org';

// ---------------------------------------------------------------------------
// Demo Mode Gating
// OFF in production. Can only be turned on via VITE_ENABLE_DEMO="true" in non-prod.
// ---------------------------------------------------------------------------
export const IS_DEMO_MODE: boolean =
  typeof import.meta !== 'undefined' &&
  !import.meta.env?.PROD &&
  import.meta.env?.VITE_ENABLE_DEMO === 'true';

// ---------------------------------------------------------------------------
// Contract <-> app Route mapping
// ---------------------------------------------------------------------------
// Contract (packages/contracts/src/GoodCashRouter.sol):
//
//   enum Route {
//       RESERVE_TO_USDM,       // 0
//       UNISWAP_TO_USDM,       // 1
//       RESERVE_THEN_UNISWAP,  // 2
//       UNISWAP_THEN_UNISWAP   // 3
//   }
//
//   function cashOut(
//       Route   route,
//       uint256 amountIn,
//       uint256 minAmountOut,
//       uint256 deadline,
//       address recipient,
//       bytes32 ref
//   ) external nonReentrant whenNotPaused returns (uint256 amountOut)
//
// The ABI below encodes the enum parameter as uint8 (Solidity enum ABI type).
// The app only performs full cash-outs, so:
//   quote.route === 'reserve' -> 2 (RESERVE_THEN_UNISWAP)
//   quote.route === 'uniswap' -> 3 (UNISWAP_THEN_UNISWAP)
// ---------------------------------------------------------------------------
export const ROUTE_RESERVE_TO_USDM = 0;
export const ROUTE_UNISWAP_TO_USDM = 1;
export const ROUTE_RESERVE_THEN_UNISWAP = 2;
export const ROUTE_UNISWAP_THEN_UNISWAP = 3;

export const ROUTE_NUMBER_BY_QUOTE_ROUTE: Record<QuoteResult['route'], number> = {
  reserve: ROUTE_RESERVE_THEN_UNISWAP,
  uniswap: ROUTE_UNISWAP_THEN_UNISWAP,
};

// Single unified threshold: swap floor ($0.51 = Paycrest $0.50 min + $0.01 fee margin)
export const SWAP_FLOOR_USDT = MIN_NET_USDT_REQUIRED;
export const MIN_AMOUNT_OUT = BigInt(Math.round(SWAP_FLOOR_USDT * 1e6)); // 510_000 atomic USDT = $0.51

export function computeMinAmountOut(usdtOut: bigint, slippageBps: number): bigint {
  const slippageAdjusted = (usdtOut * BigInt(10_000 - slippageBps)) / 10_000n;
  return slippageAdjusted > MIN_AMOUNT_OUT ? slippageAdjusted : MIN_AMOUNT_OUT;
}

// ---------------------------------------------------------------------------
// Contract ABIs
// ---------------------------------------------------------------------------
// Contract ABI (forge inspect) matches this: route is uint8 with
// internalType "enum GoodCashRouter.Route"; CashOut also carries uint8 route.
export const GOOD_CASH_ROUTER_ABI = parseAbi([
  'function cashOut(uint8 route, uint256 amountIn, uint256 minAmountOut, uint256 deadline, address recipient, bytes32 ref) external returns (uint256 amountOut)',
  'event CashOut(address indexed user, address indexed recipient, address indexed tokenOut, uint256 amountIn, uint256 amountOut, uint8 route, bytes32 ref)',
]);

export const ERC20_ABI = parseAbi([
  'function approve(address spender, uint256 amount) external returns (bool)',
  'function allowance(address owner, address spender) external view returns (uint256)',
  'function balanceOf(address account) external view returns (uint256)',
]);

export const CASH_OUT_EVENT_ABI = parseAbiItem(
  'event CashOut(address indexed user, address indexed recipient, address indexed tokenOut, uint256 amountIn, uint256 amountOut, uint8 route, bytes32 ref)'
);

export interface ExecuteSwapArgs {
  amountG: number;
  quote: QuoteResult;
  slippageBps: number;
  walletAddress: string;
  isDemoMode?: boolean;
  walletClient?: ReturnType<typeof createWalletClient>;
  publicClient?: ReturnType<typeof createPublicClient>;
  /** Test/fork override; production always uses ROUTER_ADDRESS. */
  routerAddress?: Address;
}

export interface SwapExecutionResult {
  txHash: string;
  usdtReceived: number;
  amountG: number;
}

/**
 * Execute on-chain swap through GoodCashRouter:
 * 1. Checks G$ allowance, approves GoodCashRouter if needed.
 * 2. Calls cashOut on the router.
 * 3. Waits for transaction receipt.
 * 4. Parses the on-chain CashOut event log to extract amountOut.
 * 5. Returns real usdtReceived = amountOut / 1e6.
 */
export async function executeRouterSwap(args: ExecuteSwapArgs): Promise<SwapExecutionResult> {
  const { amountG, quote, slippageBps, walletAddress, isDemoMode = IS_DEMO_MODE } = args;
  const routerAddress = args.routerAddress ?? ROUTER_ADDRESS;

  // Gate demo mode: only allowed if explicit demo flag is active
  if (isDemoMode) {
    await new Promise((resolve) => setTimeout(resolve, 800));
    const minUsdt = (Number(quote.usdtOut) * (10000 - slippageBps)) / 10000 / 1e6;
    const fakeHash = '0x' + Array.from({ length: 64 }, () => Math.floor(Math.random() * 16).toString(16)).join('');
    return {
      txHash: fakeHash,
      usdtReceived: minUsdt,
      amountG,
    };
  }

  // Real flow requires an Ethereum provider (e.g. MiniPay, MetaMask, Valora)
  if (typeof window === 'undefined' || !(window as unknown as { ethereum?: unknown }).ethereum) {
    throw new Error('No Celo wallet detected. Please open in MiniPay or connect a Web3 wallet.');
  }

  const ethereum = (window as unknown as { ethereum: Parameters<typeof custom>[0] }).ethereum;
  const publicClient =
    args.publicClient ??
    createPublicClient({
      chain: celo,
      transport: http(CELO_RPC_URL),
    });

  const walletClient =
    args.walletClient ??
    createWalletClient({
      chain: celo,
      transport: custom(ethereum),
      account: walletAddress as Address,
    });

  const amountInWei = BigInt(Math.floor(amountG * 1e18));
  const minAmountOut = computeMinAmountOut(quote.usdtOut, slippageBps);
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 1200); // 20 minutes
  const routeNum = ROUTE_NUMBER_BY_QUOTE_ROUTE[quote.route];
  const refBytes = pad(stringToHex('goodcash-ui'), { size: 32, dir: 'right' });

  // 1. Check and set G$ allowance
  const currentAllowance = (await publicClient.readContract({
    address: G_DOLLAR_ADDRESS,
    abi: ERC20_ABI,
    functionName: 'allowance',
    args: [walletAddress as Address, routerAddress],
  })) as bigint;

  if (currentAllowance < amountInWei) {
    const approveTx = await walletClient.writeContract({
      chain: celo,
      address: G_DOLLAR_ADDRESS,
      abi: ERC20_ABI,
      functionName: 'approve',
      args: [routerAddress, amountInWei],
      account: walletClient.account ?? (walletAddress as Address),
    });
    const approveReceipt = await publicClient.waitForTransactionReceipt({ hash: approveTx });
    if (approveReceipt.status !== 'success') {
      throw new Error('G$ approval transaction failed');
    }
  }

  // 2. Call cashOut
  const txHash = await walletClient.writeContract({
    chain: celo,
    address: routerAddress,
    abi: GOOD_CASH_ROUTER_ABI,
    functionName: 'cashOut',
    args: [routeNum, amountInWei, minAmountOut, deadline, walletAddress as Address, refBytes],
    account: walletClient.account ?? (walletAddress as Address),
  });

  // 3. Wait for swap receipt
  const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
  if (receipt.status !== 'success') {
    throw new Error('Swap transaction reverted on Celo');
  }

  // 4. Parse CashOut event from receipt logs
  let amountOut: bigint | null = null;
  for (const log of receipt.logs) {
    // Ignore same-shaped logs emitted by any other contract.
    if (log.address.toLowerCase() !== routerAddress.toLowerCase()) continue;
    try {
      const decoded = decodeEventLog({
        abi: [CASH_OUT_EVENT_ABI],
        data: log.data,
        topics: log.topics,
      });
      if (decoded.eventName === 'CashOut') {
        amountOut = (decoded.args as { amountOut: bigint }).amountOut;
        break;
      }
    } catch {
      // Ignore logs that don't match CashOut
    }
  }

  if (amountOut === null) {
    throw new Error('CashOut event log not found in transaction receipt');
  }

  // USDT has 6 decimals on Celo
  const usdtReceived = Number(amountOut) / 1e6;

  return {
    txHash,
    usdtReceived,
    amountG,
  };
}
