import { describe, expect, it, vi } from 'vitest';
import { BASE_USDC, chainIdNumber, checkRelaySigning, readDollarsOnBase, signAndStart, walletStepMessage } from './chain';

const WALLET = '0xb4932bf6e653b98d88f9e520b4d6b5a567dbf61b';
const AMOUNT = 700_000n;

function quote(over: { primaryType?: string; contract?: string; chainId?: number; from?: string; value?: string; noSign?: boolean } = {}) {
  return {
    requestId: '0x' + 'cd'.repeat(32),
    steps: [
      {
        items: [
          {
            data: {
              sign: over.noSign
                ? undefined
                : {
                    primaryType: over.primaryType ?? 'ReceiveWithAuthorization',
                    domain: { name: 'USD Coin', version: '2', chainId: over.chainId ?? 8453, verifyingContract: over.contract ?? BASE_USDC },
                    types: { ReceiveWithAuthorization: [{ name: 'from', type: 'address' }] },
                    value: { from: over.from ?? WALLET, to: '0x1', value: over.value ?? AMOUNT.toString() },
                  },
              post: { body: { kind: 'eip3009', api: 'swap' } },
            },
          },
        ],
      },
    ],
    details: { currencyOut: { amount: '1', minimumAmount: '1' } },
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
    }) as never);
    expect(out.requestId).toBe('0x' + 'cd'.repeat(32));
    expect(w.calls).toEqual(['eth_chainId', 'wallet_switchEthereumChain', 'eth_signTypedData_v4']);
    expect(posts.map((p) => p[0])).toEqual(['/relay/quote', '/relay/execute']);
    expect((posts[1][1] as { kind: string }).kind).toBe('eip3009');
  });

  it('a wallet that reports Base as a number is not asked to switch', async () => {
    const w = wallet(8453);
    await signAndStart(w, WALLET, AMOUNT, 'g', (async (path: string) => (path === '/relay/quote' ? quote() : {})) as never);
    expect(w.calls).toEqual(['eth_chainId', 'eth_signTypedData_v4']);
  });

  it('never asks the wallet to sign when the details do not match', async () => {
    const sign = vi.fn();
    const w = wallet(8453, sign);
    await expect(signAndStart(w, WALLET, AMOUNT, 'g', (async () => quote({ value: '999999999' })) as never)).rejects.toThrow(/nothing was signed/);
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
