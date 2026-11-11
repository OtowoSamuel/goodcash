import { describe, expect, it, vi } from 'vitest';
import { BASE_USDC, chainIdNumber, checkRelaySigning, convertibleDollars, readDollarsOnBase, signAndStart, walletStepMessage } from './chain';

const WALLET = '0xb4932bf6e653b98d88f9e520b4d6b5a567dbf61b';
const AMOUNT = 700_000n;

const PROXY = '0xccc88a9d1b4ed6b0eaba998850414b24f1c315be';
const REQ = '0x' + 'cd'.repeat(32);
const ORDER = '660e8400-e29b-41d4-a716-446655440001';

/** The shape of a real answer from the swap service, so a loose check cannot pass by accident. */
function quote(over: { primaryType?: string; contract?: string; chainId?: number; from?: string; to?: string; value?: string; noSign?: boolean; validBefore?: number; recipient?: string } = {}) {
  return {
    requestId: REQ,
    steps: [
      {
        items: [
          {
            data: {
              sign: over.noSign
                ? undefined
                : {
                    signatureKind: 'eip712',
                    primaryType: over.primaryType ?? 'ReceiveWithAuthorization',
                    domain: { name: 'USD Coin', version: '2', chainId: over.chainId ?? 8453, verifyingContract: over.contract ?? BASE_USDC },
                    types: { ReceiveWithAuthorization: [{ name: 'from', type: 'address' }, { name: 'to', type: 'address' }, { name: 'value', type: 'uint256' }, { name: 'validAfter', type: 'uint256' }, { name: 'validBefore', type: 'uint256' }, { name: 'nonce', type: 'bytes32' }] },
                    value: { from: over.from ?? WALLET, to: over.to ?? PROXY, value: over.value ?? AMOUNT.toString(), validAfter: 0, validBefore: over.validBefore ?? Math.floor(Date.now() / 1000) + 600, nonce: '0x' + '12'.repeat(32) },
                  },
              post: { endpoint: '/execute/permits', method: 'POST', body: { kind: 'eip3009', requestId: REQ, api: 'swap' } },
            },
          },
        ],
      },
    ],
    details: {
      sender: WALLET,
      recipient: over.recipient ?? WALLET,
      currencyIn: { currency: { chainId: 8453, address: BASE_USDC }, amount: over.value ?? AMOUNT.toString() },
      currencyOut: { currency: { chainId: 42220, address: '0x62B8B11039FcfE5aB0C56E502b1C372A3d2a9c7A' }, amount: '1', minimumAmount: '1' },
    },
  };
}

describe('the check before anything is signed', () => {
  it('accepts exactly the expected message', () => {
    expect(checkRelaySigning(quote(), WALLET, AMOUNT).api).toBe('swap');
  });

  it('is case-insensitive about addresses', () => {
    expect(() => checkRelaySigning(quote({ from: WALLET.toUpperCase().replace('0X', '0x') }), WALLET, AMOUNT)).not.toThrow();
  });

  it.each([
    ['another kind of message', { primaryType: 'Permit' }],
    ['another token contract', { contract: '0x0000000000000000000000000000000000000001' }],
    ['another network', { chainId: 1 }],
    ['another wallet as the payer', { from: '0x2222222222222222222222222222222222222222' }],
    ['a larger amount', { value: '700001' }],
    ['a smaller amount', { value: '699999' }],
    ['no message at all', { noSign: true }],
    ['a destination that is not the swap service', { to: '0x1111111111111111111111111111111111111111' }],
    ['the wallet itself as the destination', { to: WALLET }],
    ['a permit that has already run out', { validBefore: 1 }],
    ['a permit that lasts for days', { validBefore: Math.floor(Date.now() / 1000) + 5 * 86_400 }],
    ['the result going to another wallet', { recipient: '0x3333333333333333333333333333333333333333' }],
  ])('refuses %s', (_name, over) => {
    expect(() => checkRelaySigning(quote(over), WALLET, AMOUNT)).toThrow();
  });
});

describe('signing', () => {
  const wallet = (chain: unknown, onSign?: () => void) => {
    const calls: string[] = [];
    return {
      calls,
      request: vi.fn(async ({ method }: { method: string }) => {
        calls.push(method);
        if (method === 'eth_chainId') return chain;
        if (method === 'eth_signTypedData_v4') {
          onSign?.();
          return '0x' + 'ee'.repeat(65);
        }
        return null;
      }),
    };
  };

  it('signs once, on Base, and hands the signature over', async () => {
    const posts: Array<[string, unknown]> = [];
    const w = wallet(1);
    const out = await signAndStart(w, WALLET, AMOUNT, 'g', (async (path: string, body: unknown) => {
      posts.push([path, body]);
      return path === '/relay/quote' ? quote() : {};
    }) as never, ORDER);
    expect(out.requestId).toBe('0x' + 'cd'.repeat(32));
    expect(w.calls).toEqual(['eth_chainId', 'wallet_switchEthereumChain', 'eth_signTypedData_v4']);
    expect(posts.map((p) => p[0])).toEqual(['/relay/quote', '/relay/execute']);
    expect((posts[1][1] as { kind: string }).kind).toBe('eip3009');
    // the order id goes with both calls, so the server can hold the conversion to that order's own dollars
    expect((posts[0][1] as { orderId: string }).orderId).toBe(ORDER);
    expect((posts[1][1] as { orderId: string }).orderId).toBe(ORDER);
  });

  it('a wallet that reports Base as a number is not asked to switch', async () => {
    const w = wallet(8453);
    await signAndStart(w, WALLET, AMOUNT, 'g', (async (path: string) => (path === '/relay/quote' ? quote() : {})) as never, ORDER);
    expect(w.calls).toEqual(['eth_chainId', 'eth_signTypedData_v4']);
  });

  it('never asks the wallet to sign when the details do not match', async () => {
    const sign = vi.fn();
    const w = wallet(8453, sign);
    await expect(signAndStart(w, WALLET, AMOUNT, 'g', (async () => quote({ value: '999999999' })) as never, ORDER)).rejects.toThrow(/nothing was signed/);
    expect(sign).not.toHaveBeenCalled();
    expect(w.calls).toEqual([]);
  });
});

describe('reading the balance', () => {
  it('reads dollars on Base from a Base node, not the wallet', async () => {
    const f = vi.fn(async () => new Response(JSON.stringify({ result: '0x' + (1_000_000).toString(16).padStart(64, '0') })));
    expect(await readDollarsOnBase(WALLET, f as never)).toBe(1_000_000n);
  });
  it('an empty answer is zero, and a failing first node falls back to the second', async () => {
    const empty = vi.fn(async () => new Response(JSON.stringify({ result: '0x' })));
    expect(await readDollarsOnBase(WALLET, empty as never)).toBe(0n);
    const f = vi
      .fn()
      .mockRejectedValueOnce(new Error('down'))
      .mockResolvedValueOnce(new Response(JSON.stringify({ result: '0x' + (5).toString(16).padStart(64, '0') })));
    expect(await readDollarsOnBase(WALLET, f as never)).toBe(5n);
  });
});

describe('small helpers', () => {
  it('reads chain ids in every shape', () => {
    expect(chainIdNumber('0x2105')).toBe(8453);
    expect(chainIdNumber(8453)).toBe(8453);
    expect(chainIdNumber('8453')).toBe(8453);
  });
  it('wallet messages are plain words with no technical text', () => {
    for (const e of [{ code: 4001 }, new Error('insufficient funds'), new Error('The details did not match'), new Error('switch chain'), new Error('boom 0xabc stack')]) {
      expect(walletStepMessage(e)).not.toMatch(/0x|stack|RPC|EIP|signature|chain|revert/i);
    }
  });
});

describe('converting only the order\'s own dollars', () => {
  const balance = (n: bigint) => vi.fn(async () => new Response(JSON.stringify({ result: `0x${n.toString(16)}` })));
  it('uses the whole balance when it is no more than the order delivers', async () => {
    expect(await convertibleDollars(WALLET, async () => '3551428', balance(3_000_000n) as never)).toBe(3_000_000n);
  });
  it('stops at what the order delivers when the wallet holds more (other dollars, or another order)', async () => {
    expect(await convertibleDollars(WALLET, async () => '3551428', balance(12_000_000n) as never)).toBe(3_551_428n);
  });
  it('does nothing when the server cannot say what the order delivers', async () => {
    await expect(convertibleDollars(WALLET, async () => undefined, balance(12_000_000n) as never)).rejects.toThrow(/not ready/);
  });
});
