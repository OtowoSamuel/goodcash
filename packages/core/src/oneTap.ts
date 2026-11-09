/**
 * The one-tap cash out: ONE transaction, G$.transferAndCall(RouterV2, amount, data). The router swaps, pays the
 * payout address exactly `payAmount`, and returns any surplus to the sender in the same transaction.
 */
import { CELO_CHAIN_ID, G_DOLLAR, SELECTORS } from './addresses';
import { addressWord, asciiToHex, bytes32Word, isAddress, readAddressWord, readWord, strip0x, uintWord, type Hex } from './hex';

/** Price protection on one-tap: the swap must produce at least 99.5% of the quoted dollars, or it is undone. */
export const ONE_TAP_SLIPPAGE_BPS = 50;
/** Smallest dollars a cash out may produce ($0.50 payout minimum + $0.02 partner fee + margin). */
export const MIN_NET_USDT_REQUIRED = 0.53;
export const MIN_AMOUNT_OUT = BigInt(Math.round(MIN_NET_USDT_REQUIRED * 1e6));
/** An order must have at least this long left before the wallet is asked to sign. */
export const MIN_ORDER_TIME_LEFT_MS = 90_000;

export function computeMinAmountOut(usdtOut: bigint, slippageBps: number): bigint {
  const slippageAdjusted = (usdtOut * BigInt(10_000 - slippageBps)) / 10_000n;
  return slippageAdjusted > MIN_AMOUNT_OUT ? slippageAdjusted : MIN_AMOUNT_OUT;
}

export function computeOneTapMinOut(quote: { usdtOut: bigint }): bigint {
  return computeMinAmountOut(quote.usdtOut, ONE_TAP_SLIPPAGE_BPS);
}

/** RouterV2 route numbers. */
export const ONE_TAP_ROUTE = { reserve: 0, uniswap: 1 } as const;

export interface OneTapData {
  route: 0 | 1;
  minOut: bigint;
  deadline: bigint;
  payTo: Hex;
  payAmount: bigint;
  ref: Hex;
}

/** Exactly what the router decodes: abi.encode(uint8 route, uint256 minOut, uint256 deadline, address payTo, uint256 payAmount, bytes32 ref). */
export function encodeOneTapData(args: OneTapData): Hex {
  return `0x${uintWord(BigInt(args.route))}${uintWord(args.minOut)}${uintWord(args.deadline)}${addressWord(args.payTo)}${uintWord(args.payAmount)}${bytes32Word(args.ref)}` as Hex;
}

export function decodeOneTapData(data: string): OneTapData {
  const s = strip0x(data);
  if (s.length !== 64 * 6) throw new Error('One-tap data has the wrong length');
  const route = readWord(s, 0);
  if (route !== 0n && route !== 1n) throw new Error('Unknown route');
  return {
    route: Number(route) as 0 | 1,
    minOut: readWord(s, 1),
    deadline: readWord(s, 2),
    payTo: readAddressWord(s, 3),
    payAmount: readWord(s, 4),
    ref: `0x${s.slice(5 * 64, 6 * 64)}` as Hex,
  };
}

/** The order id as the bytes32 reference stored in the router's event (first 31 characters, dashes removed). */
export function orderRefBytes32(orderId: string): Hex {
  const hex = asciiToHex(orderId.replace(/-/g, '').slice(0, 31));
  return `0x${hex.padEnd(64, '0')}` as Hex;
}

/** G$.transferAndCall(to, amount, data) call data. */
export function encodeTransferAndCall(to: Hex, amount: bigint, data: Hex): Hex {
  const body = strip0x(data);
  if (body.length % 2 !== 0) throw new Error('Odd-length data');
  const len = BigInt(body.length / 2);
  const padded = body.padEnd(Math.ceil(body.length / 64) * 64, '0');
  return `${SELECTORS.transferAndCall}${addressWord(to)}${uintWord(amount)}${uintWord(96n)}${uintWord(len)}${padded}` as Hex;
}

export function decodeTransferAndCall(callData: string): { to: Hex; amount: bigint; data: Hex } {
  const s = strip0x(callData);
  if (!s.toLowerCase().startsWith(strip0x(SELECTORS.transferAndCall))) throw new Error('Not a transferAndCall');
  const args = s.slice(8);
  const to = readAddressWord(args, 0);
  const amount = readWord(args, 1);
  const offset = Number(readWord(args, 2));
  if (offset !== 96) throw new Error('Unexpected data offset');
  const len = Number(readWord(args, 3));
  const data = args.slice(4 * 64, 4 * 64 + len * 2);
  if (data.length !== len * 2) throw new Error('Data is too short');
  return { to, amount, data: `0x${data}` as Hex };
}

export interface CashOutTransaction {
  chainId: number;
  /** Always the G$ token */
  to: Hex;
  data: Hex;
  /** Always zero: no CELO is sent, only the network fee is paid */
  value: '0x0';
}

export function buildOneTapTransaction(args: {
  router: Hex;
  amountWei: bigint;
  route: 0 | 1;
  minOut: bigint;
  deadline: bigint;
  payTo: Hex;
  payAmount: bigint;
  orderId: string;
}): CashOutTransaction {
  if (!isAddress(args.router) || !isAddress(args.payTo)) throw new Error('Bad address');
  if (args.amountWei <= 0n) throw new Error('Amount must be positive');
  if (args.payAmount <= 0n || args.payAmount > args.minOut) throw new Error('Pay amount must be positive and at most the minimum');
  const inner = encodeOneTapData({
    route: args.route,
    minOut: args.minOut,
    deadline: args.deadline,
    payTo: args.payTo,
    payAmount: args.payAmount,
    ref: orderRefBytes32(args.orderId),
  });
  return { chainId: CELO_CHAIN_ID, to: G_DOLLAR, data: encodeTransferAndCall(args.router, args.amountWei, inner), value: '0x0' };
}

export interface ExpectedCashOut {
  router: Hex;
  payTo: Hex;
  payAmount: bigint;
  amountWei: bigint;
  /** Unix ms: the payout order closes then */
  validUntilMs: number;
  orderId: string;
}

/**
 * The safety check before any wallet signs: the transaction must be exactly a one-tap cash out to the known router,
 * paying the order's own address no more than the guaranteed minimum, before the order closes.
 * Returns a reason when something is wrong, or null when it is safe.
 */
export function checkCashOutTransaction(tx: CashOutTransaction, expected: ExpectedCashOut, nowMs = Date.now()): string | null {
  try {
    if (tx.chainId !== CELO_CHAIN_ID) return 'wrong_chain';
    if (tx.to.toLowerCase() !== G_DOLLAR.toLowerCase()) return 'wrong_token';
    if (tx.value !== '0x0') return 'sends_celo';
    const outer = decodeTransferAndCall(tx.data);
    if (outer.to.toLowerCase() !== expected.router.toLowerCase()) return 'wrong_router';
    if (outer.amount !== expected.amountWei) return 'wrong_amount';
    const inner = decodeOneTapData(outer.data);
    if (inner.payTo.toLowerCase() !== expected.payTo.toLowerCase()) return 'wrong_pay_to';
    if (inner.payAmount !== expected.payAmount) return 'wrong_pay_amount';
    if (inner.payAmount <= 0n || inner.payAmount > inner.minOut) return 'pay_amount_above_minimum';
    if (inner.ref.toLowerCase() !== orderRefBytes32(expected.orderId).toLowerCase()) return 'wrong_reference';
    if (!Number.isFinite(expected.validUntilMs) || expected.validUntilMs - nowMs < MIN_ORDER_TIME_LEFT_MS) return 'order_expiring';
    if (Number(inner.deadline) * 1000 > expected.validUntilMs) return 'deadline_after_order';
    if (Number(inner.deadline) * 1000 < nowMs) return 'deadline_passed';
    return null;
  } catch {
    return 'malformed';
  }
}
