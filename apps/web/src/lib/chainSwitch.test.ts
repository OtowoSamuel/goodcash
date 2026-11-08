// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';
import { ensureCeloChain, friendlySwapError } from './router';

function fakeProvider(chainId: string, switchFails = false) {
  const calls: string[] = [];
  return {
    calls,
    request: vi.fn(async ({ method }: { method: string }) => {
      calls.push(method);
      if (method === 'eth_chainId') return chainId;
      if (method === 'wallet_switchEthereumChain' && switchFails) throw new Error('Unrecognized chain');
      return null;
    }),
  };
}

describe('ensureCeloChain', () => {
  it('does nothing when the wallet is already on Celo', async () => {
    const p = fakeProvider('0xa4ec');
    await ensureCeloChain(p);
    expect(p.calls).toEqual(['eth_chainId']);
  });

  it('asks a wallet on Ethereum to switch to Celo', async () => {
    const p = fakeProvider('0x1');
    await ensureCeloChain(p);
    expect(p.calls).toEqual(['eth_chainId', 'wallet_switchEthereumChain']);
  });

  it('adds Celo first when the wallet does not know it', async () => {
    const p = fakeProvider('0x1', true);
    await ensureCeloChain(p);
    expect(p.calls).toEqual(['eth_chainId', 'wallet_switchEthereumChain', 'wallet_addEthereumChain']);
  });
});

describe('wrong-network wording', () => {
  it('turns the wallet error into a plain instruction', () => {
    const err = new Error('The current chain of the wallet (id: 1) does not match the target chain for the transaction (id: 42220 – Celo).');
    expect(friendlySwapError(err)).toMatch(/wrong network/i);
    expect(friendlySwapError(err)).not.toMatch(/42220|chain of the wallet/);
  });
});
