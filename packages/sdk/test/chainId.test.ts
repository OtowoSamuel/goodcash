import { describe, it, expect, vi } from 'vitest';
import { chainIdNumber, ensureCelo } from '../src/wallet';

const wallet = (chainId: unknown) => {
  const calls: string[] = [];
  return {
    calls,
    request: vi.fn(async ({ method }: { method: string }) => {
      calls.push(method);
      return method === 'eth_chainId' ? chainId : null;
    }),
  };
};

describe('wallets that report the chain id in different shapes', () => {
  it('reads hex text, numbers and decimal text', () => {
    expect(chainIdNumber('0xa4ec')).toBe(42220);
    expect(chainIdNumber(42220)).toBe(42220);
    expect(chainIdNumber('42220')).toBe(42220);
    expect(chainIdNumber(undefined)).toBeNaN();
  });

  it('a WalletConnect wallet already on Celo (chain id as a number) is accepted, no switch asked', async () => {
    const p = wallet(42220);
    await ensureCelo(p as never);
    expect(p.calls).toEqual(['eth_chainId']);
  });

  it('a browser wallet already on Celo (hex text) is accepted', async () => {
    const p = wallet('0xa4ec');
    await ensureCelo(p as never);
    expect(p.calls).toEqual(['eth_chainId']);
  });
});
