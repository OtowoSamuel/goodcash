// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { addressFromMagicInfo, magicOptions, finishMagicLogin, restoreMagic, MAGIC_WALLETS } from './magicWallet';

const ADDR = '0x1111111111111111111111111111111111111111';

describe('Magic wallet connection', () => {
  it('puts Magic on Celo mainnet with our node', () => {
    expect(magicOptions('https://forno.celo.org')).toEqual({ network: { rpcUrl: 'https://forno.celo.org', chainId: 42220 } });
  });

  it('offers the wallets people already have, including phone wallets through WalletConnect', () => {
    expect(MAGIC_WALLETS).toEqual(expect.arrayContaining(['metamask', 'walletconnect', 'coinbase']));
  });

  it('is off, and says so, when no Magic key is configured', async () => {
    // this test build has no VITE_MAGIC_PUBLISHABLE_KEY
    await expect(finishMagicLogin({ method: 'wallet', walletAddress: ADDR })).rejects.toThrow(/not set up/i);
    await expect(restoreMagic()).resolves.toBeNull();
  });

  describe('reading the address out of whatever shape Magic returns', () => {
    it('finds it in the documented places', () => {
      expect(addressFromMagicInfo({ wallets: { ethereum: { publicAddress: ADDR } } })).toBe(ADDR);
      expect(addressFromMagicInfo({ publicAddress: ADDR })).toBe(ADDR);
      expect(addressFromMagicInfo({ wallets: [{ type: 'evm', address: ADDR }] })).toBe(ADDR);
    });
    it('ignores values that are not addresses, and returns null when there is none', () => {
      expect(addressFromMagicInfo({ email: 'a@b.com', issuer: 'did:ethr:0x123', wallets: {} })).toBeNull();
      expect(addressFromMagicInfo(null)).toBeNull();
      expect(addressFromMagicInfo('0x12')).toBeNull();
    });
  });
});

describe('after a successful login', () => {
  const walletProvider = { request: vi.fn(async () => [ADDR]) };
  const rpcProvider = { request: vi.fn() };
  const makeMagic = (over: Partial<{ loggedIn: boolean; info: unknown; walletProvider: unknown }> = {}) => ({
    rpcProvider,
    user: {
      isLoggedIn: vi.fn(async () => over.loggedIn ?? false),
      getInfo: vi.fn(async () => over.info ?? { wallets: { ethereum: { publicAddress: ADDR } } }),
      logout: vi.fn(async () => true),
    },
    walletKit: { getWalletProvider: vi.fn(async () => ('walletProvider' in over ? over.walletProvider : walletProvider)) },
  });
  let setActive: ReturnType<typeof vi.fn>;
  let mod: typeof import('./magicWallet');

  beforeEach(async () => {
    vi.resetModules();
    setActive = vi.fn();
    vi.doMock('./router', () => ({ CELO_RPC_URL: 'https://forno.celo.org', setActiveProvider: setActive }));
    mod = await import('./magicWallet');
  });

  it('a connected wallet: payments go through THAT wallet, and we use the address it reported', async () => {
    const address = await mod.finishLoginWith(makeMagic() as never, { method: 'wallet', walletAddress: ADDR });
    expect(address).toBe(ADDR);
    expect(setActive).toHaveBeenCalledWith(walletProvider);
  });

  it('a connected wallet whose connection is missing is an error, never a silent fallback to another wallet', async () => {
    await expect(mod.finishLoginWith(makeMagic({ walletProvider: null }) as never, { method: 'wallet', walletAddress: ADDR })).rejects.toThrow(/connection was not available/i);
    expect(setActive).not.toHaveBeenCalled();
  });

  it('an email login creates a Magic wallet: payments go through Magic’s own provider', async () => {
    const m = makeMagic();
    const address = await mod.finishLoginWith(m as never, { method: 'email', didToken: 'x' });
    expect(address).toBe(ADDR);
    expect(setActive).toHaveBeenCalledWith(m.rpcProvider);
  });

  it('an email login whose address cannot be read is an error', async () => {
    await expect(mod.finishLoginWith(makeMagic({ info: { email: 'a@b.com' } }) as never, { method: 'email' })).rejects.toThrow(/could not read its address/i);
  });

  it('restores a connected wallet after a reload', async () => {
    expect(await mod.restoreWith(makeMagic() as never)).toBe(ADDR);
    expect(setActive).toHaveBeenCalledWith(walletProvider);
  });

  it('restores a Magic email wallet when no external wallet is connected', async () => {
    const m = makeMagic({ walletProvider: null, loggedIn: true });
    expect(await mod.restoreWith(m as never)).toBe(ADDR);
    expect(setActive).toHaveBeenCalledWith(m.rpcProvider);
  });

  it('restores nothing when nobody is signed in', async () => {
    expect(await mod.restoreWith(makeMagic({ walletProvider: null, loggedIn: false }) as never)).toBeNull();
    expect(setActive).not.toHaveBeenCalled();
  });
});
