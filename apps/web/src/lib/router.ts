import { gToWei } from './units';
import {
  type Address,
  createPublicClient,
  createWalletClient,
  custom,
  decodeEventLog,
  encodeAbiParameters,
  http,
  pad,
  parseAbi,
  parseAbiItem,
  parseAbiParameters,
  stringToHex,
} from 'viem';
import { celo } from 'viem/chains';
import type { QuoteResult } from './quote';
import { MIN_NET_USDT_REQUIRED } from './rate';
import { computeMinAmountOut, computeOneTapMinOut as coreComputeOneTapMinOut, encodeOneTapData, MIN_AMOUNT_OUT, ONE_TAP_SLIPPAGE_BPS, provesNothingWasSent } from '@goodcash/core';

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

// Single unified threshold and price protection maths live in @goodcash/core (shared with the partner SDK)
export const SWAP_FLOOR_USDT = MIN_NET_USDT_REQUIRED;
export { MIN_AMOUNT_OUT, computeMinAmountOut } from '@goodcash/core/oneTap';

// ---------------------------------------------------------------------------
// Contract ABIs
// ---------------------------------------------------------------------------
// Contract ABI (forge inspect) matches this: route is uint8 with
// internalType "enum GoodCashRouter.Route"; CashOut also carries uint8 route.
export const GOOD_CASH_ROUTER_ABI = parseAbi([
  'function cashOut(uint8 route, uint256 amountIn, uint256 minAmountOut, uint256 deadline, address recipient, bytes32 ref) external returns (uint256 amountOut)',
  'event CashOut(address indexed user, address indexed recipient, address indexed tokenOut, uint256 amountIn, uint256 amountOut, uint8 route, bytes32 ref)',
]);

const ROUTER_STATE_ABI = parseAbi(['function paused() external view returns (bool)']);

/**
 * Asking the wallet to send failed in a way that does NOT prove nothing was sent (for example a phone wallet's request
 * timed out while the customer was still approving in the other app). The transaction may well have gone through,
 * so this is never reported as "nothing was taken".
 */
export class SwapUncertainError extends Error {
  constructor(public cause: unknown) {
    super('SWAP_UNCERTAIN');
    this.name = 'SwapUncertainError';
  }
}

export { provesNothingWasSent } from '@goodcash/core/wallet';

/** The swap was sent to the network but we could not confirm it yet. It may well have gone through. */
export class SwapPendingError extends Error {
  hash: string;
  constructor(hash: string) {
    super('Swap sent, still confirming');
    this.name = 'SwapPendingError';
    this.hash = hash;
  }
}

/** The payment was sent to the network but we could not confirm it yet. Never ask the user to pay again. */
export class DepositPendingError extends Error {
  hash: string;
  constructor(hash: string) {
    super('Payment sent, still confirming');
    this.name = 'DepositPendingError';
    this.hash = hash;
  }
}

const SENT_DEPOSITS_KEY = 'goodcash_sent_deposits';

function readSentDeposits(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(SENT_DEPOSITS_KEY) ?? '{}') as Record<string, string>;
  } catch {
    return {};
  }
}

function rememberSentDeposit(orderId: string, hash: string | null): void {
  try {
    const all = readSentDeposits();
    if (hash) all[orderId] = hash;
    else delete all[orderId];
    const keep = Object.entries(all).slice(-30);
    localStorage.setItem(SENT_DEPOSITS_KEY, JSON.stringify(Object.fromEntries(keep)));
  } catch {
    // optional convenience only
  }
}

/** Turn a wallet/RPC error into one short sentence a user can act on. */
// ---------------------------------------------------------------------------
// Network fee (paid in CELO by the wallet, never in G$)
//
// Measured on real GoodCash cash outs (Nov 2026): one-tap uses ~996k gas (wallet limit ~1.16M); the three-step
// swap uses ~864k (limit ~1.0M) plus an approval and a dollar transfer. A wallet will only send when it holds
// gas limit x max fee, so the balance we ask for is higher than what is actually spent.
// ---------------------------------------------------------------------------

export type CashOutFlow = 'one-tap' | 'three-step';
const FEE_GAS: Record<CashOutFlow, { used: bigint; limit: bigint }> = {
  'one-tap': { used: 1_000_000n, limit: 1_160_000n },
  'three-step': { used: 1_000_000n, limit: 1_150_000n },
};
/** Wallets set their max fee above today's price, so ask for 50% headroom. */
const FEE_HEADROOM_NUM = 3n;
const FEE_HEADROOM_DEN = 2n;
/** Celo's own price feed: dollars (USDm) per CELO. */
const SORTED_ORACLES = '0xefB84935239dAcdecF7c5bA76d8dE40b077B7b33' as Address;
const USDM = '0x765DE816845861e75A25fCA122bb6898B8B1282a' as Address;
const ORACLE_ABI = parseAbi(['function medianRate(address) view returns (uint256, uint256)']);

export interface NetworkFeeInfo {
  /** What a cash out usually costs, in CELO */
  feeCelo: number;
  /** What the wallet must hold before it will send, in CELO */
  needCelo: number;
  haveCelo: number;
  enough: boolean;
  /** Dollars per CELO, when the price feed answered */
  celoUsd: number | null;
}

type FeeClient = {
  getBalance: (a: { address: Address }) => Promise<bigint>;
  getGasPrice: () => Promise<bigint>;
  readContract?: (a: never) => Promise<unknown>;
};

/** The network fee for a cash out and whether this wallet can pay it. Null when it cannot be checked. */
export async function getNetworkFeeInfo(address: string, flow: CashOutFlow, client?: FeeClient): Promise<NetworkFeeInfo | null> {
  try {
    const c = (client ?? createPublicClient({ chain: celo, transport: http(CELO_RPC_URL) })) as FeeClient;
    const [balance, gasPrice] = await Promise.all([c.getBalance({ address: address as Address }), c.getGasPrice()]);
    let celoUsd: number | null = null;
    try {
      const r = (await (c.readContract as (a: unknown) => Promise<[bigint, bigint]>)({
        address: SORTED_ORACLES,
        abi: ORACLE_ABI,
        functionName: 'medianRate',
        args: [USDM],
      })) as [bigint, bigint];
      const v = Number(r[0]) / Number(r[1]);
      celoUsd = Number.isFinite(v) && v > 0 ? v : null;
    } catch {
      celoUsd = null;
    }
    const g = FEE_GAS[flow];
    const fee = g.used * gasPrice;
    const need = (g.limit * gasPrice * FEE_HEADROOM_NUM) / FEE_HEADROOM_DEN;
    const toCelo = (w: bigint) => Number(w) / 1e18;
    return { feeCelo: toCelo(fee), needCelo: toCelo(need), haveCelo: toCelo(balance), enough: balance >= need, celoUsd };
  } catch {
    return null;
  }
}

/** Rounds CELO up so we never ask for less than needed. */
export function celoText(v: number): string {
  if (v <= 0) return '0';
  const up = Math.ceil(v * 100) / 100;
  return up.toFixed(2);
}

/** Plain words for a wallet that cannot pay the network fee. */
export function networkFeeMessage(info: NetworkFeeInfo | null, ngnPerUsd?: number | null): string {
  if (!info) {
    return "Your wallet doesn't have enough CELO to pay the network fee. Top up a little CELO, then try again. Your G$ has not been touched.";
  }
  const short = Math.max(0, info.needCelo - info.haveCelo);
  const naira = info.celoUsd && ngnPerUsd ? Math.max(1, Math.ceil(short * info.celoUsd * ngnPerUsd)) : null;
  return (
    `Top up first: sending needs about ${celoText(info.needCelo)} CELO in your wallet for the network fee, and you have ${celoText(info.haveCelo)} CELO. ` +
    `Add at least ${celoText(short)} CELO${naira ? ` (about ₦${naira.toLocaleString('en-US')})` : ''}, then try again. ` +
    'The fee is paid in CELO, not G$. Your G$ has not been touched.'
  );
}

export class NetworkFeeError extends Error {
  constructor(public info: NetworkFeeInfo) {
    super('NEEDS_NETWORK_FEE');
    this.name = 'NetworkFeeError';
  }
}

async function assertNetworkFee(address: string, flow: CashOutFlow, publicClient: unknown): Promise<void> {
  const info = await getNetworkFeeInfo(address, flow, publicClient as FeeClient);
  if (info && !info.enough) throw new NetworkFeeError(info);
}

export function friendlySwapError(err: unknown): string {
  const e = err as { name?: string; message?: string; shortMessage?: string; cause?: { name?: string } } | null;
  const raw = `${e?.name ?? ''} ${e?.cause?.name ?? ''} ${e?.shortMessage ?? ''} ${e?.message ?? ''}`;
  // Our server's own plain message (for example "That's more G$ than your wallet holds."). It is only ever given before the wallet is asked.
  if (e?.name === 'OrderRequestError' && e.message) return e.message;
  if (/SWAP_UNCERTAIN/.test(raw)) {
    return "We couldn't confirm your cash out. It may still have gone through, so please check History before trying again. That way you don't send it twice.";
  }
  if (/NEEDS_NETWORK_FEE/.test(raw)) return networkFeeMessage((err as { info?: NetworkFeeInfo })?.info ?? null);
  if (/SwapPendingError/.test(raw)) {
    return "Your cash out was sent and is still being confirmed. Please don't send it again. It will show in History, and we'll help you finish your payout.";
  }
  if (/^\s*Minimum cash out/i.test(e?.message ?? '')) return (e?.message as string).trim();
  if (/PRICE_MOVED|InsufficientOutput|MinOutBelowPayAmount/.test(raw)) {
    return 'The price moved just before your cash out. Nothing was taken. Please try again.';
  }
  if (/ORDER_EXPIRED/.test(raw)) return 'That payout window closed before you confirmed. Nothing was taken. Please try again.';
  if (/ORDER_MISMATCH/.test(raw)) return "We couldn't confirm your payout details just now. Nothing was taken. Please try again.";
  if (/chain of the wallet|does not match the target chain|wrong network|chain mismatch|switch.*chain/i.test(raw)) {
    return 'Your wallet is on the wrong network. Please switch it to Celo and try again.';
  }
  if (/user rejected|user denied|rejected the request|UserRejectedRequest/i.test(raw)) {
    return 'You cancelled the request in your wallet. Nothing was sent.';
  }
  if (/EnforcedPause|0xd93c0665|paused/i.test(raw)) {
    return 'Cash out is paused right now. Nothing was sent. Please try again later.';
  }
  if (/insufficient funds|gas required exceeds/i.test(raw)) {
    return networkFeeMessage(null);
  }
  if (/approval transaction failed/i.test(raw)) return "Your wallet's first confirmation didn't go through. Your G$ was not taken. Please try again.";
  if (/reverted on Celo|execution reverted|reverted/i.test(raw)) {
    return "Your cash out didn't go through. Your G$ was not taken. Please refresh the price and try again.";
  }
  if (/event log not found/i.test(raw)) {
    return "Your cash out was sent but we couldn't read the result. Please check History before trying again.";
  }
  if (/No Celo wallet/i.test(raw)) return 'No Celo wallet found. Open GoodCash in a wallet app or install a wallet extension.';
  return "Something went wrong and we couldn't confirm your cash out. Please check History before trying again.";
}

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
  /** Tells the screen which wallet confirmation is coming next, so the user is never left guessing. */
  onStep?: (info: { kind: 'approve' | 'swap'; n: number; total: number }) => void;
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
  const { amountG, quote, slippageBps, walletAddress, isDemoMode = IS_DEMO_MODE, onStep } = args;
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
  const injected = getEthereum();
  if (!injected) {
    throw new Error('No Celo wallet detected. Please connect a wallet first.');
  }

  const ethereum = injected as unknown as Parameters<typeof custom>[0];
  const publicClient =
    args.publicClient ??
    createPublicClient({
      chain: celo,
      transport: http(CELO_RPC_URL),
      pollingInterval: 1000,
    });

  if (!args.walletClient) await ensureCeloChain(injected as unknown as Eip1193);
  await assertNetworkFee(walletAddress, 'three-step', publicClient);

  const walletClient =
    args.walletClient ??
    createWalletClient({
      chain: celo,
      transport: custom(ethereum),
      account: walletAddress as Address,
    });

  const amountInWei = gToWei(amountG);
  const minAmountOut = computeMinAmountOut(quote.usdtOut, slippageBps);
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 1200); // 20 minutes
  const routeNum = ROUTE_NUMBER_BY_QUOTE_ROUTE[quote.route];
  const refBytes = pad(stringToHex('goodcash-ui'), { size: 32, dir: 'right' });

  // 0. Stop early (before any wallet prompt) if the router is paused
  const isPaused = await publicClient
    .readContract({ address: routerAddress, abi: ROUTER_STATE_ABI, functionName: 'paused' })
    .catch(() => false);
  if (isPaused === true) {
    throw new Error('Cash out is paused right now. Nothing was sent. Please try again later.');
  }

  // 1. Check and set G$ allowance
  const currentAllowance = (await publicClient.readContract({
    address: G_DOLLAR_ADDRESS,
    abi: ERC20_ABI,
    functionName: 'allowance',
    args: [walletAddress as Address, routerAddress],
  })) as bigint;

  const needsApproval = currentAllowance < amountInWei;
  // Wallet confirmations the customer will see: allow G$ (first time), convert, then the final payment
  const totalSteps = needsApproval ? 3 : 2;
  if (needsApproval) {
    onStep?.({ kind: 'approve', n: 1, total: totalSteps });
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
  onStep?.({ kind: 'swap', n: totalSteps - 1, total: totalSteps });
  let txHash: `0x${string}`;
  try {
    txHash = await walletClient.writeContract({
      chain: celo,
      address: routerAddress,
      abi: GOOD_CASH_ROUTER_ABI,
      functionName: 'cashOut',
      args: [routeNum, amountInWei, minAmountOut, deadline, walletAddress as Address, refBytes],
      account: walletClient.account ?? (walletAddress as Address),
    });
  } catch (e) {
    // Same rule as one tap: only call it "not sent" when the error proves it
    if (provesNothingWasSent(e)) throw e;
    throw new SwapUncertainError(e);
  }

  // 3. Wait for swap receipt
  let receipt;
  try {
    receipt = await publicClient.waitForTransactionReceipt({ hash: txHash, timeout: 120_000 });
  } catch {
    // The transaction was sent. We just could not read the result: it may still succeed.
    throw new SwapPendingError(txHash);
  }
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

// ---------------------------------------------------------------------------
// One-tap cash out (GoodCashRouterV2): ONE wallet confirmation does everything.
// The customer calls G$.transferAndCall(router, amount, data). In that single transaction the router swaps the
// G$ and pays the payout partner exactly what the (already created) order asks for; leftovers return to the customer.
// It is OFF unless VITE_ROUTER_V2_ADDRESS is set, and then the app uses the older three-step flow.
// ---------------------------------------------------------------------------
const envRouterV2 =
  typeof import.meta !== 'undefined'
    ? (import.meta as { env?: { VITE_ROUTER_V2_ADDRESS?: string } }).env?.VITE_ROUTER_V2_ADDRESS
    : undefined;

/** The one-tap router address from settings, or null when unset or not a real address (a zero address counts as unset). */
export function parseRouterV2Address(value: string | undefined): Address | null {
  return value && /^0x[0-9a-fA-F]{40}$/.test(value) && !/^0x0{40}$/.test(value) ? (value as Address) : null;
}

export const ROUTER_V2_ADDRESS: Address | null = parseRouterV2Address(envRouterV2);

export const ONE_TAP_ENABLED = ROUTER_V2_ADDRESS !== null;

/** Tighter than the three-step flow: the order is sized to this minimum, so a small cushion keeps the naira close to the estimate. */
export { ONE_TAP_SLIPPAGE_BPS } from '@goodcash/core/oneTap';

const ONE_TAP_ABI = parseAbi([
  'function transferAndCall(address to, uint256 amount, bytes data) external returns (bool)',
]);
const ROUTER_V2_STATE_ABI = parseAbi(['function paused() external view returns (bool)']);
const CASH_OUT_PAID_EVENT_ABI = parseAbiItem(
  'event CashOutPaid(address indexed user, address indexed payTo, uint256 gIn, uint256 usdtOut, uint256 usdtPaid, uint256 usdtReturned, uint8 route, bytes32 ref)'
);

/** The guaranteed minimum USDT of a swap. The payout order is sized from this, before the swap. */
export function computeOneTapMinOut(quote: QuoteResult): bigint {
  return coreComputeOneTapMinOut(quote);
}

/** Exactly what the router decodes: abi.encode(route, minOut, deadline, payTo, payAmount, ref). */
export { encodeOneTapData } from '@goodcash/core/oneTap';

/** True when the one-tap router is paused. Checked BEFORE a payout order is created, so a pause never leaves orders behind. */
export async function isOneTapRouterPaused(publicClient?: ReturnType<typeof createPublicClient>): Promise<boolean> {
  if (!ROUTER_V2_ADDRESS) return true;
  const client = publicClient ?? createPublicClient({ chain: celo, transport: http(CELO_RPC_URL) });
  const paused = await client
    .readContract({ address: ROUTER_V2_ADDRESS, abi: ROUTER_V2_STATE_ABI, functionName: 'paused' })
    .catch(() => false);
  return paused === true;
}

/**
 * Which cash-out path to use. When one-tap is switched on, it is the only path: if that router is paused, cash out
 * is paused (nothing is sent) instead of falling back to the original router. The original router needs all its
 * balances to be exactly zero after every cash out, so anyone sending it a tiny amount could block it until an admin
 * stepped in. The one-tap router compares against what it held before, so stray balances cannot block it.
 * The three-step flow remains only for builds where one-tap is not configured at all (local development and tests).
 */
export function chooseCashOutFlow(oneTapEnabled: boolean, oneTapPaused: boolean): 'one-tap' | 'three-step' | 'paused' {
  if (!oneTapEnabled) return 'three-step';
  return oneTapPaused ? 'paused' : 'one-tap';
}

export interface OneTapOrderForSwap {
  receiveAddress: string;
  /** Exactly what the payout partner asked for, 6 decimals, as a whole number */
  payAmountAtomic: string;
  /** The router the server says to use. It must be the one this app is configured for. */
  routerAddress: string;
  validUntil: string;
  orderId: string;
}

export interface OneTapResult {
  txHash: string;
  usdtOut: number;
  usdtPaid: number;
  usdtReturned: number;
  amountG: number;
}

export async function executeOneTapCashOut(args: {
  amountG: number;
  quote: QuoteResult;
  minOut: bigint;
  walletAddress: string;
  order: OneTapOrderForSwap;
  onStep?: ExecuteSwapArgs['onStep'];
  walletClient?: ReturnType<typeof createWalletClient>;
  publicClient?: ReturnType<typeof createPublicClient>;
  /** Test/fork override; production always uses the configured router. */
  routerAddress?: Address;
}): Promise<OneTapResult> {
  const { amountG, quote, minOut, walletAddress, order, onStep } = args;
  const routerAddress = args.routerAddress ?? ROUTER_V2_ADDRESS;
  if (!routerAddress) throw new Error('One-tap cash out is not switched on.');

  // Never pay anywhere the server merely says: checks on everything that decides where money goes
  if (order.routerAddress.toLowerCase() !== routerAddress.toLowerCase()) throw new Error('ORDER_MISMATCH');
  if (!/^0x[0-9a-fA-F]{40}$/.test(order.receiveAddress) || /^0x0{40}$/.test(order.receiveAddress)) throw new Error('ORDER_MISMATCH');
  if (order.receiveAddress.toLowerCase() === PLACEHOLDER_DEPOSIT_ADDRESS.toLowerCase()) throw new Error('ORDER_MISMATCH');
  const payAmount = BigInt(order.payAmountAtomic);
  if (payAmount <= 0n || payAmount > minOut) throw new Error('PRICE_MOVED');
  const validUntilMs = new Date(order.validUntil).getTime();
  if (!Number.isFinite(validUntilMs) || validUntilMs - Date.now() < 90_000) throw new Error('ORDER_EXPIRED');

  const injected = getEthereum();
  if (!injected) throw new Error('No Celo wallet detected. Please connect a wallet first.');
  const publicClient =
    args.publicClient ?? createPublicClient({ chain: celo, transport: http(CELO_RPC_URL), pollingInterval: 1000 });

  if (!args.walletClient) await ensureCeloChain(injected as unknown as Eip1193);
  await assertNetworkFee(walletAddress, 'one-tap', publicClient);
  const walletClient =
    args.walletClient ??
    createWalletClient({
      chain: celo,
      transport: custom(injected as unknown as Parameters<typeof custom>[0]),
      account: walletAddress as Address,
    });

  const isPaused = await publicClient
    .readContract({ address: routerAddress, abi: ROUTER_V2_STATE_ABI, functionName: 'paused' })
    .catch(() => false);
  if (isPaused === true) throw new Error('Cash out is paused right now. Nothing was sent. Please try again later.');

  const amountInWei = gToWei(amountG);
  const route = ROUTE_NUMBER_BY_QUOTE_ROUTE[quote.route];
  if (route !== 2 && route !== 3) throw new Error('PRICE_MOVED');
  // The one-tap router has two routes, numbered 0 and 1
  const route2: 0 | 1 = route === 2 ? 0 : 1;
  // The swap must happen while the payout order is still open
  const deadline = BigInt(Math.floor(Math.min(Date.now() + 20 * 60 * 1000, validUntilMs - 60_000) / 1000));
  const data = encodeOneTapData({
    route: route2,
    minOut,
    deadline,
    payTo: order.receiveAddress as Address,
    payAmount,
    ref: pad(stringToHex(order.orderId.replace(/-/g, '').slice(0, 31)), { size: 32, dir: 'right' }),
  });

  onStep?.({ kind: 'swap', n: 1, total: 1 });
  let txHash: `0x${string}`;
  try {
    txHash = await walletClient.writeContract({
      chain: celo,
      address: G_DOLLAR_ADDRESS,
      abi: ONE_TAP_ABI,
      functionName: 'transferAndCall',
      args: [routerAddress, amountInWei, data],
      account: walletClient.account ?? (walletAddress as Address),
    });
  } catch (e) {
    if (provesNothingWasSent(e)) throw e;
    throw new SwapUncertainError(e);
  }

  let receipt;
  try {
    receipt = await publicClient.waitForTransactionReceipt({ hash: txHash, timeout: 120_000 });
  } catch {
    // Sent, just not confirmed yet: it may still go through
    throw new SwapPendingError(txHash);
  }
  if (receipt.status !== 'success') throw new Error('Swap transaction reverted on Celo');

  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== routerAddress.toLowerCase()) continue;
    try {
      const decoded = decodeEventLog({ abi: [CASH_OUT_PAID_EVENT_ABI], data: log.data, topics: log.topics });
      if (decoded.eventName === 'CashOutPaid') {
        const a = decoded.args as { usdtOut: bigint; usdtPaid: bigint; usdtReturned: bigint };
        return {
          txHash,
          usdtOut: Number(a.usdtOut) / 1e6,
          usdtPaid: Number(a.usdtPaid) / 1e6,
          usdtReturned: Number(a.usdtReturned) / 1e6,
          amountG,
        };
      }
    } catch {
      // not our event
    }
  }
  throw new Error('CashOut event log not found in transaction receipt');
}

type Eip1193 = { request: (args: { method: string; params?: unknown[] }) => Promise<unknown> };

let activeKind: 'wallet' | 'magic' = 'wallet';
let activeProvider: Eip1193 | null = null;

/** Use a connected WalletConnect session (or clear it) instead of the browser's own wallet. */
export function setActiveProvider(provider: Eip1193 | null, kind: 'wallet' | 'magic' = 'wallet'): void {
  activeProvider = provider;
  activeKind = provider ? kind : 'wallet';
}

/** 'magic' for an email or passkey wallet (one network, fixed at sign-in), otherwise a wallet the customer brought. */
export function activeProviderKind(): 'wallet' | 'magic' {
  return activeKind;
}

/** Tell the app when the wallet's account or network changes. Returns an unsubscribe function. */
export function subscribeWalletEvents(
  onAccounts: (accounts: string[]) => void,
  onChain: (chainId: number) => void
): () => void {
  const p = getEthereum() as unknown as {
    on?: (e: string, cb: (...a: unknown[]) => void) => void;
    removeListener?: (e: string, cb: (...a: unknown[]) => void) => void;
  } | null;
  if (!p?.on) return () => undefined;
  const a = (accounts: unknown) => onAccounts(Array.isArray(accounts) ? (accounts as string[]) : []);
  const c = (id: unknown) => onChain(typeof id === 'string' ? parseInt(id, 16) : Number(id));
  p.on('accountsChanged', a);
  p.on('chainChanged', c);
  return () => {
    p.removeListener?.('accountsChanged', a);
    p.removeListener?.('chainChanged', c);
  };
}

/** The wallet the customer connected (for flows outside this file). */
export function getWalletProvider(): Eip1193 | null {
  return getEthereum();
}

export function hasInjectedWallet(): boolean {
  return typeof window !== 'undefined' && Boolean((window as unknown as { ethereum?: unknown }).ethereum);
}

function getEthereum(): Eip1193 | null {
  if (activeProvider) return activeProvider;
  if (typeof window === 'undefined') return null;
  return ((window as unknown as { ethereum?: Eip1193 }).ethereum ?? null);
}

/** A wallet's chain id as a number. Browser wallets answer with hex text ("0xa4ec"); WalletConnect answers with a number. */
export function chainIdNumber(v: unknown): number {
  if (typeof v === 'number') return v;
  if (typeof v === 'bigint') return Number(v);
  if (typeof v === 'string') return /^0x/i.test(v) ? parseInt(v, 16) : parseInt(v, 10);
  return NaN;
}

/**
 * Make sure the wallet is on Celo mainnet before sending anything. A phone wallet is often left on
 * Ethereum, and it then refuses Celo transactions. This asks it to switch (or to add Celo first).
 */
export async function ensureCeloChain(provider: Eip1193): Promise<void> {
  const current = await provider.request({ method: 'eth_chainId' });
  if (chainIdNumber(current) === 42220) return;
  try {
    await provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: '0xa4ec' }] });
  } catch {
    await provider.request({
      method: 'wallet_addEthereumChain',
      params: [
        {
          chainId: '0xa4ec',
          chainName: 'Celo',
          nativeCurrency: { name: 'CELO', symbol: 'CELO', decimals: 18 },
          rpcUrls: [CELO_RPC_URL],
          blockExplorerUrls: ['https://celo.blockscout.com'],
        },
      ],
    });
  }
}

/**
 * Ask the user's wallet for an account. Getting the account is what "connected" means.
 * Moving the wallet to the Celo network is tried afterwards but never blocks connecting: the app asks again,
 * with a clear prompt, right before any swap or payment.
 */
export async function connectInjectedWallet(): Promise<string> {
  const ethereum = getEthereum();
  if (!ethereum) throw new Error('No Celo wallet detected. Open GoodCash in a wallet browser or install one.');
  const accounts = (await ethereum.request({ method: 'eth_requestAccounts' })) as string[];
  if (!accounts?.[0]) throw new Error('No account returned by the wallet.');
  try {
    await ensureCeloChain(ethereum);
  } catch {
    // Not fatal: connected is connected. The network is fixed when it matters.
  }
  return accounts[0];
}

/**
 * Make a browser wallet forget this site, so the next Connect asks for an account again.
 * Wallets cannot be disconnected by a website any other way. Best effort: not every wallet supports it.
 */
export async function disconnectInjectedWallet(): Promise<void> {
  const ethereum = getEthereum();
  if (!ethereum) return;
  try {
    await ethereum.request({ method: 'wallet_revokePermissions', params: [{ eth_accounts: {} }] });
  } catch {
    // unsupported or already revoked: the app still forgets the wallet
  }
}

/** Plain-language reason a wallet could not be connected. Never mentions swaps or technical codes. */
export function friendlyConnectError(err: unknown): string {
  const e = err as { name?: string; code?: number | string; message?: string; shortMessage?: string } | null;
  const raw = `${e?.name ?? ''} ${e?.shortMessage ?? ''} ${e?.message ?? ''}`;
  const code = Number(e?.code);
  if (code === 4001 || /user rejected|user denied|rejected the request|UserRejectedRequest|connection request reset|closed|cancel/i.test(raw)) {
    return 'The wallet connection was cancelled. Tap Connect wallet to try again.';
  }
  if (code === -32002 || /already pending|already processing|request of type/i.test(raw)) {
    return 'Your wallet already has a request waiting. Open your wallet, approve or reject it, then tap Connect wallet again.';
  }
  if (/locked|unlock/i.test(raw)) return 'Your wallet is locked. Unlock it, then tap Connect wallet again.';
  if (/No Celo wallet|no wallet/i.test(raw)) {
    return 'No wallet found. Open GoodCash inside your wallet app, or install a wallet extension, then try again.';
  }
  if (/unauthorized|origin not allowed|not allowed/i.test(raw)) {
    return "We couldn't open the wallet connection from this address. Please try again in a moment.";
  }
  return "We couldn't connect your wallet. Please try again, or try a different wallet.";
}

/** Read the wallet's real G$ balance from Celo (18 decimals). */
export async function fetchGBalance(address: string): Promise<number> {
  const client = createPublicClient({ chain: celo, transport: http(CELO_RPC_URL) });
  const raw = (await client.readContract({
    address: G_DOLLAR_ADDRESS,
    abi: ERC20_ABI,
    functionName: 'balanceOf',
    args: [address as Address],
  })) as bigint;
  return Number(raw) / 1e18;
}

/**
 * Look up a past GoodCash swap so an unfinished payout can be resumed.
 * Only accepts a successful CashOut on the GoodCash router made by this same wallet.
 */
export async function fetchSwapForRecovery(
  txHash: string,
  walletAddress?: string
): Promise<{ usdtReceived: number; amountG: number }> {
  if (!/^0x[0-9a-fA-F]{64}$/.test(txHash)) throw new Error('That does not look like a transaction hash.');
  const client = createPublicClient({ chain: celo, transport: http(CELO_RPC_URL) });
  const receipt = await client.getTransactionReceipt({ hash: txHash as `0x${string}` });
  if (receipt.status !== 'success') throw new Error('That transaction did not succeed.');
  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== ROUTER_ADDRESS.toLowerCase()) continue;
    try {
      const decoded = decodeEventLog({ abi: [CASH_OUT_EVENT_ABI], data: log.data, topics: log.topics });
      if (decoded.eventName !== 'CashOut') continue;
      const args = decoded.args as { user: string; recipient: string; amountIn: bigint; amountOut: bigint };
      if (walletAddress && (args.user.toLowerCase() !== walletAddress.toLowerCase() || args.recipient.toLowerCase() !== walletAddress.toLowerCase())) {
        throw new Error('That cash out was made by a different wallet. Connect the wallet that made it.');
      }
      return { usdtReceived: Number(args.amountOut) / 1e6, amountG: Number(args.amountIn) / 1e18 };
    } catch (e) {
      if (e instanceof Error && /different wallet/.test(e.message)) throw e;
    }
  }
  throw new Error('No GoodCash cash out was found in that transaction.');
}

/**
 * Send the exact USDT deposit Paycrest asked for, from the connected wallet.
 * Only ever sends USDT on Celo, to the address and amount given, and never more than `maxAmount`.
 */
/** Stand-in shown while a reopened order is still loading. It is NOT a real deposit address. */
export const PLACEHOLDER_DEPOSIT_ADDRESS = '0x3841D6A1F3E92B710c0e5a953eB684B24B35fC75';

export async function sendUsdtDeposit(args: {
  from: string;
  to: string;
  amount: string;
  maxAmount: number;
  /** Used to remember a sent payment, so it can never be sent twice. */
  orderId?: string;
  /** Re-checks the order with our server right before paying. Throws if it can no longer be paid. */
  checkOrder?: () => Promise<void>;
}): Promise<string> {
  const { from, to, amount, maxAmount, orderId, checkOrder } = args;
  if (!/^0x[0-9a-fA-F]{40}$/.test(to)) throw new Error('Invalid deposit address.');
  if (to.toLowerCase() === PLACEHOLDER_DEPOSIT_ADDRESS.toLowerCase() || /^0x0{40}$/.test(to)) {
    throw new Error('Payment details are still loading. Please wait a moment and try again.');
  }
  const value = Math.round(Number(amount) * 1e6);
  if (!Number.isFinite(value) || value <= 0) throw new Error('Invalid deposit amount.');
  if (value > Math.round(maxAmount * 1e6) + 1) throw new Error('Deposit amount is higher than your swap produced.');

  const provider = getEthereum();
  if (!provider) throw new Error('No Celo wallet detected. Please connect a wallet first.');

  const publicClient = createPublicClient({ chain: celo, transport: http(CELO_RPC_URL), pollingInterval: 1000 });

  // A payment for this order may already have been sent (even if this screen was closed meanwhile)
  const earlier = orderId ? readSentDeposits()[orderId] : undefined;
  if (orderId && earlier === 'detected') return earlier;
  if (orderId && earlier) {
    const prior = await publicClient.getTransactionReceipt({ hash: earlier as `0x${string}` }).catch(() => null);
    if (prior?.status === 'success') return earlier;
    if (!prior) throw new DepositPendingError(earlier);
    rememberSentDeposit(orderId, null); // it failed on-chain, so paying again is safe
  }

  if (checkOrder) await checkOrder();

  const balance = (await publicClient.readContract({
    address: USDT_ADDRESS,
    abi: ERC20_ABI,
    functionName: 'balanceOf',
    args: [from as Address],
  })) as bigint;
  if (balance < BigInt(value)) throw new Error('Not enough balance in your wallet for this payment.');

  await ensureCeloChain(provider);

  const walletClient = createWalletClient({
    chain: celo,
    transport: custom(provider as unknown as Parameters<typeof custom>[0]),
    account: from as Address,
  });
  let hash: `0x${string}`;
  try {
    hash = await walletClient.writeContract({
      chain: celo,
      address: USDT_ADDRESS,
      abi: parseAbi(['function transfer(address to, uint256 amount) external returns (bool)']),
      functionName: 'transfer',
      args: [to as Address, BigInt(value)],
      account: from as Address,
    });
  } catch (e) {
    const raw = `${(e as { name?: string })?.name ?? ''} ${(e as { message?: string })?.message ?? ''}`;
    if (/user rejected|user denied|rejected the request|UserRejectedRequest/i.test(raw)) throw e;
    // A phone wallet can report an error even though the payment was approved a moment later.
    // Watch the balance for a short while before telling the user it failed.
    for (let i = 0; i < 6; i++) {
      await new Promise((r) => setTimeout(r, 4000));
      const now = (await publicClient
        .readContract({ address: USDT_ADDRESS, abi: ERC20_ABI, functionName: 'balanceOf', args: [from as Address] })
        .catch(() => balance)) as bigint;
      if (balance - now >= (BigInt(value) * 99n) / 100n) {
        if (orderId) rememberSentDeposit(orderId, 'detected');
        throw new DepositPendingError('detected');
      }
    }
    throw e;
  }
  if (orderId) rememberSentDeposit(orderId, hash);
  let receipt;
  try {
    receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: 120_000 });
  } catch {
    // Sent, but we could not read the result yet. Never tell the user nothing was taken.
    throw new DepositPendingError(hash);
  }
  if (receipt.status !== 'success') {
    if (orderId) rememberSentDeposit(orderId, null);
    throw new Error('The payment did not go through.');
  }
  return hash;
}

/** Wallet balance of USDT on Celo (6 decimals). Used to check a past swap's funds are still there. */
export async function fetchUsdtBalance(address: string): Promise<number> {
  const client = createPublicClient({ chain: celo, transport: http(CELO_RPC_URL) });
  const raw = (await client.readContract({
    address: USDT_ADDRESS,
    abi: ERC20_ABI,
    functionName: 'balanceOf',
    args: [address as Address],
  })) as bigint;
  return Number(raw) / 1e6;
}

/** Plain-language reason a payment to the payout partner did not go through. */
export function friendlyPayError(err: unknown): string {
  const e = err as { name?: string; message?: string; shortMessage?: string } | null;
  const raw = `${e?.name ?? ''} ${e?.shortMessage ?? ''} ${e?.message ?? ''}`;
  if (/user rejected|user denied|rejected the request|UserRejectedRequest/i.test(raw)) {
    return 'You cancelled the payment. Nothing was sent.';
  }
  if (/DepositPendingError/.test(raw)) {
    return "Your payment was sent and is being confirmed. Please don't pay again. We'll update this page.";
  }
  if (/ORDER_ALREADY_PAID/.test(raw)) {
    return "We've already received a payment for this payout. We're finishing it now, so you don't need to pay again.";
  }
  if (/ORDER_EXPIRED/.test(raw)) {
    return 'This payment window has closed and nothing was sent. Go back to Home to start a fresh one.';
  }
  if (/ORDER_UNKNOWN|ORDER_MISMATCH/.test(raw)) {
    return "We couldn't confirm your payment details just now. Nothing was sent. Check your connection and try again.";
  }
  if (/not enough balance/i.test(raw)) {
    return "There isn't enough balance in your wallet for this payment. If you already paid this one, check History.";
  }
  if (/insufficient funds|gas required exceeds/i.test(raw)) {
    return 'Not enough CELO in your wallet to pay the network fee.';
  }
  if (/No Celo wallet/i.test(raw)) return 'No wallet found. Connect your wallet and try again.';
  return "We couldn't send the payment from your wallet. Open your wallet app, clear any request that is still waiting, then come back and tap Pay now again. If the payment already went through, this page will update by itself.";
}
