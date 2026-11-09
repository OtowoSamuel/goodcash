// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { walletConnectInitOptions } from './walletConnect';

describe('wallet app connection', () => {
  it('asks for Celo as optional, so wallets that do not list it can still connect', () => {
    const o = walletConnectInitOptions('pid', 'https://goodcash.xyz', 'https://forno.celo.org');
    // Base too: adding G$ or CELO signs once on Base, and a wallet app refuses any chain not in the connection
    expect(o.optionalChains).toEqual([42220, 8453]);
    expect((o as Record<string, unknown>).chains).toBeUndefined();
    expect(o.rpcMap[42220]).toBe('https://forno.celo.org');
  });
});
