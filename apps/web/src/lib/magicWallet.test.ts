// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { addressFromMagicInfo, magicOptions, finishMagicLogin, restoreMagic, MAGIC_WALLETS, WALLETS_WITHOUT_EXTENSION, browserHasWallet, walletsForBrowser } from './magicWallet';

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
    expect(setActive).toHaveBeenCalledWith(m.rpcProvider, 'magic');
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
    expect(setActive).toHaveBeenCalledWith(m.rpcProvider, 'magic');
  });

  it('restores nothing when nobody is signed in', async () => {
    expect(await mod.restoreWith(makeMagic({ walletProvider: null, loggedIn: false }) as never)).toBeNull();
    expect(setActive).not.toHaveBeenCalled();
  });
});

describe('which wallets the connect panel offers', () => {
  const win = (setup: (w: EventTarget & { ethereum?: unknown }) => void) => {
    const w = new EventTarget() as EventTarget & { ethereum?: unknown };
    setup(w);
    return w as unknown as Window;
  };

  it('a plain phone browser (no wallet inside it) is not offered the extension-only wallets', () => {
    expect(browserHasWallet(win(() => undefined))).toBe(false);
    expect(walletsForBrowser(false)).toEqual(['walletconnect', 'coinbase']);
    for (const w of ['metamask', 'phantom', 'rabby']) expect(WALLETS_WITHOUT_EXTENSION).not.toContain(w);
  });

  it('a browser with a wallet in it (window.ethereum, such as MetaMask own browser) gets the full list', () => {
    expect(browserHasWallet(win((w) => (w.ethereum = {})))).toBe(true);
    expect(walletsForBrowser(true)).toEqual([...MAGIC_WALLETS]);
  });

  it('on a phone, a bare window.ethereum is not enough, but a wallet app own browser is', () => {
    const phone = (setup: (w: Record<string, any>) => void) => win((w0) => { const w = w0 as Record<string, any>; w.navigator = { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) Mobile' }; setup(w); });
    expect(browserHasWallet(phone((w) => (w.ethereum = {})))).toBe(false);
    expect(browserHasWallet(phone((w) => (w.ethereum = { isMetaMask: true })))).toBe(true);
  });

  it('a wallet that only announces itself (EIP-6963) counts too', () => {
    const w = win((t) => t.addEventListener('eip6963:requestProvider', () => t.dispatchEvent(new Event('eip6963:announceProvider'))));
    expect(browserHasWallet(w)).toBe(true);
  });

  it('phone browsers always keep WalletConnect, so every wallet app can still be reached', () => {
    expect(WALLETS_WITHOUT_EXTENSION).toContain('walletconnect');
  });
});
