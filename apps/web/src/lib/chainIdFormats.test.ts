// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';
import { chainIdNumber, ensureCeloChain, setActiveProvider } from './router';
import { readDollarsOnBase } from './addGs';

const WALLET = '0xb4932bf6e653b98d88f9e520b4d6b5a567dbf61b';

function wallet(chainId: unknown) {
  const calls: string[] = [];
  return {
    calls,
    request: vi.fn(async ({ method }: { method: string }) => {
      calls.push(method);
      if (method === 'eth_chainId') return chainId;
      if (method === 'eth_call') return '0x' + (1_000_000).toString(16).padStart(64, '0');
      return null;
    }),
  };
}

describe('wallets that answer the chain id in different shapes', () => {
  it('reads hex text, numbers and decimal text', () => {
    expect(chainIdNumber('0xa4ec')).toBe(42220);
    expect(chainIdNumber(42220)).toBe(42220);
    expect(chainIdNumber('42220')).toBe(42220);
    expect(chainIdNumber(undefined)).toBeNaN();
  });

  it('a WalletConnect wallet (chain id as a number) can be read on Base without crashing', async () => {
    // this crashed with "toLowerCase is not a function" and showed customers "Something went wrong"
    const p = wallet(8453);
    setActiveProvider(p);
    expect(await readDollarsOnBase(WALLET)).toBe(1_000_000n);
    expect(p.calls).toEqual(['eth_chainId', 'eth_call']);
    setActiveProvider(null);
  });

  it('a number chain id of Celo is recognised, so no switch is asked for', async () => {
    const p = wallet(42220);
    await ensureCeloChain(p);
    expect(p.calls).toEqual(['eth_chainId']);
  });

  it('a wallet on another chain is still asked to switch', async () => {
    const p = wallet(8453);
    setActiveProvider(p);
    await ensureCeloChain(p);
    expect(p.calls).toEqual(['eth_chainId', 'wallet_switchEthereumChain']);
    setActiveProvider(null);
  });
});
