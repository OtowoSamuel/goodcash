// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';
import { chainIdNumber, ensureCeloChain, setActiveProvider, activeProviderKind } from './router';
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

  const baseNode = (result: unknown) =>
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify(result), { status: 200 }));

  it('reads the Base balance from a Base node, never asking the wallet (so no network switch prompt)', async () => {
    const p = wallet(8453);
    setActiveProvider(p);
    const f = baseNode({ jsonrpc: '2.0', id: 1, result: '0x' + (1_000_000).toString(16).padStart(64, '0') });
    expect(await readDollarsOnBase(WALLET)).toBe(1_000_000n);
    expect(p.calls).toEqual([]);
    expect(String(f.mock.calls[0][0])).toContain('base');
    setActiveProvider(null);
    f.mockRestore();
  });

  it('an empty balance answer ("0x") reads as zero instead of crashing', async () => {
    const f = baseNode({ jsonrpc: '2.0', id: 1, result: '0x' });
    expect(await readDollarsOnBase(WALLET)).toBe(0n);
    f.mockRestore();
  });

  it('falls back to the second Base node when the first fails', async () => {
    const f = vi
      .spyOn(globalThis, 'fetch')
      .mockRejectedValueOnce(new Error('down'))
      .mockResolvedValueOnce(new Response(JSON.stringify({ result: '0x' + (5).toString(16).padStart(64, '0') }), { status: 200 }));
    expect(await readDollarsOnBase(WALLET)).toBe(5n);
    expect(f).toHaveBeenCalledTimes(2);
    f.mockRestore();
  });

  it('an email wallet is marked, a brought wallet is not', () => {
    setActiveProvider(wallet(42220), 'magic');
    expect(activeProviderKind()).toBe('magic');
    setActiveProvider(wallet(42220));
    expect(activeProviderKind()).toBe('wallet');
    setActiveProvider(null);
    expect(activeProviderKind()).toBe('wallet');
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
