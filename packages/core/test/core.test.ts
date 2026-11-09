import { describe, expect, it } from 'vitest';
import { encodeAbiParameters, encodeFunctionData, pad, parseAbi, parseAbiParameters, parseUnits, stringToHex } from 'viem';
import {
  buildOneTapTransaction,
  cashOutStatusFrom,
  chainStateFromReads,
  checkCashOutTransaction,
  clampFeePercent,
  computeMinAmountOut,
  decodeOneTapData,
  decodeTransferAndCall,
  encodeBalanceOf,
  encodeOneTapData,
  encodeQuoteUsdmToUsdt,
  encodeReserveGetAmountOut,
  encodeTransferAndCall,
  formatAtomic,
  G_DOLLAR,
  getLiveQuote,
  gToWei,
  isPaidOutStatus,
  MIN_AMOUNT_OUT,
  networkFeeFrom,
  orderRefBytes32,
  parseDecimal,
  payoutUsdt,
  provesNothingWasSent,
  ROUTER_V2,
  BROKER,
  EXCHANGE_ID,
  EXCHANGE_PROVIDER,
  USDM,
  USDT,
  type Hex,
} from '../src';

const PAY_TO = '0x1111111111111111111111111111111111111111' as Hex;
const ORDER = '3f2c9a1e-7b4d-4c2a-9f10-2b3c4d5e6f70';

describe('encoders match viem byte for byte', () => {
  it('one-tap data', () => {
    const args = { route: 1 as const, minOut: 1_234_567n, deadline: 1_900_000_000n, payTo: PAY_TO, payAmount: 1_200_000n, ref: orderRefBytes32(ORDER) };
    const viem = encodeAbiParameters(parseAbiParameters('uint8, uint256, uint256, address, uint256, bytes32'), [
      args.route, args.minOut, args.deadline, args.payTo, args.payAmount, args.ref,
    ]);
    expect(encodeOneTapData(args)).toBe(viem);
    expect(decodeOneTapData(viem)).toEqual({ ...args, payTo: args.payTo.toLowerCase() });
  });

  it('order reference matches the web app', () => {
    expect(orderRefBytes32(ORDER)).toBe(pad(stringToHex(ORDER.replace(/-/g, '').slice(0, 31)), { size: 32, dir: 'right' }));
  });

  it('transferAndCall', () => {
    const inner = encodeOneTapData({ route: 0, minOut: 600_000n, deadline: 1n, payTo: PAY_TO, payAmount: 500_000n, ref: orderRefBytes32(ORDER) });
    const viem = encodeFunctionData({
      abi: parseAbi(['function transferAndCall(address to, uint256 amount, bytes data) returns (bool)']),
      functionName: 'transferAndCall',
      args: [ROUTER_V2, 10n ** 21n, inner],
    });
    expect(encodeTransferAndCall(ROUTER_V2, 10n ** 21n, inner)).toBe(viem);
    const back = decodeTransferAndCall(viem);
    expect(back.to.toLowerCase()).toBe(ROUTER_V2.toLowerCase());
    expect(back.amount).toBe(10n ** 21n);
    expect(back.data).toBe(inner);
  });

  it('price reads', () => {
    expect(encodeBalanceOf(PAY_TO)).toBe(encodeFunctionData({ abi: parseAbi(['function balanceOf(address) view returns (uint256)']), functionName: 'balanceOf', args: [PAY_TO] }));
    expect(encodeReserveGetAmountOut(5n * 10n ** 21n)).toBe(
      encodeFunctionData({
        abi: parseAbi(['function getAmountOut(address exchangeProvider, bytes32 exchangeId, address assetIn, address assetOut, uint256 amountIn) view returns (uint256)']),
        functionName: 'getAmountOut',
        args: [EXCHANGE_PROVIDER, EXCHANGE_ID, G_DOLLAR, USDM, 5n * 10n ** 21n],
      })
    );
    expect(encodeQuoteUsdmToUsdt(7n * 10n ** 17n)).toBe(
      encodeFunctionData({
        abi: parseAbi(['function quoteExactInputSingle((address tokenIn, address tokenOut, uint256 amountIn, uint24 fee, uint160 sqrtPriceLimitX96) params) returns (uint256, uint160, uint32, uint256)']),
        functionName: 'quoteExactInputSingle',
        args: [{ tokenIn: USDM, tokenOut: USDT, amountIn: 7n * 10n ** 17n, fee: 100, sqrtPriceLimitX96: 0n }],
      })
    );
  });
});

describe('units', () => {
  it('parses and formats like viem', () => {
    expect(parseDecimal('12.345678', 18)).toBe(parseUnits('12.345678', 18));
    expect(parseDecimal('1', 6)).toBe(1_000_000n);
    expect(formatAtomic(1_500_000n, 6)).toBe('1.500000');
    expect(gToWei(1234.5678919)).toBe(parseUnits('1234.567891', 18));
    expect(gToWei(-1)).toBe(0n);
  });
  it('fees', () => {
    expect(clampFeePercent('1')).toBe(1);
    expect(clampFeePercent('6')).toBe(0);
    expect(clampFeePercent('abc')).toBe(0);
    expect(payoutUsdt(1.02, 1)).toBeCloseTo(1 / 1.01, 10);
    expect(payoutUsdt(0.01, 0)).toBe(0);
  });
});

describe('safety check before signing', () => {
  const now = 1_800_000_000_000;
  const validUntilMs = now + 30 * 60_000;
  const base = { router: ROUTER_V2, amountWei: 5n * 10n ** 21n, route: 0 as const, minOut: 700_000n, deadline: BigInt(Math.floor((now + 20 * 60_000) / 1000)), payTo: PAY_TO, payAmount: 650_000n, orderId: ORDER };
  const expected = { router: ROUTER_V2, payTo: PAY_TO, payAmount: 650_000n, amountWei: base.amountWei, validUntilMs, orderId: ORDER };

  it('accepts the exact transaction', () => {
    expect(checkCashOutTransaction(buildOneTapTransaction(base), expected, now)).toBeNull();
  });
  it.each([
    ['wrong_router', { router: '0x2222222222222222222222222222222222222222' as Hex }],
    ['wrong_pay_to', { payTo: '0x3333333333333333333333333333333333333333' as Hex }],
    ['wrong_amount', { amountWei: 1n }],
  ])('refuses %s', (reason, change) => {
    expect(checkCashOutTransaction(buildOneTapTransaction({ ...base, ...change }), expected, now)).toBe(reason);
  });
  it('refuses a pay amount above the minimum, an expiring order, and a different token', () => {
    expect(() => buildOneTapTransaction({ ...base, payAmount: 800_000n })).toThrow();
    expect(checkCashOutTransaction(buildOneTapTransaction(base), { ...expected, validUntilMs: now + 60_000 }, now)).toBe('order_expiring');
    expect(checkCashOutTransaction({ ...buildOneTapTransaction(base), to: USDT }, expected, now)).toBe('wrong_token');
    expect(checkCashOutTransaction({ ...buildOneTapTransaction(base), chainId: 1 }, expected, now)).toBe('wrong_chain');
    expect(checkCashOutTransaction({ ...buildOneTapTransaction(base), data: '0x1234' }, expected, now)).toBe('malformed');
  });
  it('keeps the minimum floor', () => {
    expect(computeMinAmountOut(100n, 50)).toBe(MIN_AMOUNT_OUT);
  });
});

describe('statuses and wallet errors', () => {
  it('maps partner statuses to plain ones', () => {
    expect(isPaidOutStatus('fulfilled')).toBe(true);
    expect(cashOutStatusFrom('settled', true)).toBe('paid');
    expect(cashOutStatusFrom('initiated', false)).toBe('awaiting_signature');
    expect(cashOutStatusFrom('initiated', true)).toBe('sent');
    expect(cashOutStatusFrom('pending', true)).toBe('processing');
    expect(cashOutStatusFrom('refunded', true)).toBe('refunded');
    expect(cashOutStatusFrom('expired', false)).toBe('expired');
  });
  it('only a refusal proves nothing was sent', () => {
    expect(provesNothingWasSent({ code: 4001 })).toBe(true);
    expect(provesNothingWasSent({ message: 'x', cause: { name: 'UserRejectedRequestError' } })).toBe(true);
    expect(provesNothingWasSent(new Error('Request timed out'))).toBe(false);
  });
  it('network fee', () => {
    const info = networkFeeFrom({ balanceWei: 10n ** 17n, gasPriceWei: 200_000_000_000n, flow: 'one-tap', celoUsd: 0.5 });
    expect(info.enough).toBe(false);
    expect(info.needCelo).toBeCloseTo(0.348, 3);
  });
});

describe('live quote from plain eth_call', () => {
  it('turns the two reads into a quote', async () => {
    const amountG = 5000n * 10n ** 18n;
    const netUsdm = 570n * 10n ** 15n; // 0.57 USDm
    const usdtOut = 569_900n; // 0.5699 USDT
    const word = (v: bigint) => `0x${v.toString(16).padStart(64, '0')}` as Hex;
    const calls: string[] = [];
    const q = await getLiveQuote(amountG, async (to, data) => {
      calls.push(to);
      return to === BROKER ? word(netUsdm) : (`${word(usdtOut)}${'0'.repeat(192)}` as Hex);
    });
    expect(calls).toHaveLength(2);
    expect(q.route).toBe('reserve');
    expect(chainStateFromReads(amountG, netUsdm, usdtOut).reserveCurrentPriceRaw).toBeGreaterThan(0n);
    expect(netUsdm - q.netUsdm).toBeLessThan(10n ** 6n); // rounding only
    expect(q.usdtOut).toBeGreaterThanOrEqual(usdtOut - 1n);
    expect(q.usdtOut).toBeLessThanOrEqual(usdtOut);
  });
});
