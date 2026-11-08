import { describe, it, expect } from 'vitest';
import { walletConnectInitOptions } from './walletConnect';

describe('WalletConnect setup', () => {
  const opts = walletConnectInitOptions('project-id', 'https://goodcash.xyz', 'https://forno.celo.org');

  it('asks for Celo as an OPTIONAL chain, so wallets that do not list Celo can still connect', () => {
    expect(opts.optionalChains).toEqual([42220]);
    expect((opts as { chains?: number[] }).chains ?? []).toEqual([]); // nothing is required
  });

  it('tells the wallet who is asking, and where to reach Celo', () => {
    expect(opts.metadata.url).toBe('https://goodcash.xyz');
    expect(opts.metadata.icons[0]).toBe('https://goodcash.xyz/pwa-192x192.png');
    expect(opts.rpcMap[42220]).toBe('https://forno.celo.org');
    expect(opts.projectId).toBe('project-id');
  });
});
