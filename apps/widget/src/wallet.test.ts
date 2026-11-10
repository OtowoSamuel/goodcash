import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  addressFromMagicInfo,
  connectInjected,
  finishLoginWith,
  friendlyConnectError,
  injectedProvider,
  MAGIC_WALLETS,
  WALLETS_WITHOUT_EXTENSION,
  browserHasWallet,
  restoreWith,
  walletsForBrowser,
  type MagicLike,
} from './wallet';

const A = '0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef';
const B = '0x1111111111111111111111111111111111111111';

const provider = (accounts: string[] = [A]) => ({ request: vi.fn(async ({ method }: { method: string }) => (method === 'eth_accounts' || method === 'eth_requestAccounts' ? accounts : null)) });

const magic = (over: Partial<MagicLike> = {}): MagicLike => ({
  rpcProvider: provider([B]),
  user: { isLoggedIn: async () => false, getInfo: async () => ({}), logout: async () => true },
  walletKit: { getWalletProvider: async () => null },
  ...over,
});

afterEach(() => {
  delete (window as unknown as { ethereum?: unknown }).ethereum;
});

describe('which wallets the panel offers', () => {
  it('lists the wallets customers use, WalletConnect included (it opens phone wallet apps)', () => {
    expect(MAGIC_WALLETS).toEqual(expect.arrayContaining(['metamask', 'walletconnect', 'coinbase']));
  });
});

describe('only wallets that can work in this browser are listed', () => {
  const win = (setup: (w: EventTarget & { ethereum?: unknown }) => void) => {
    const w = new EventTarget() as EventTarget & { ethereum?: unknown };
    setup(w);
    return w as unknown as Window;
  };
  it('a plain phone browser (no wallet inside it) is not offered MetaMask, Phantom or Rabby', () => {
    expect(browserHasWallet(win(() => undefined))).toBe(false);
    expect(walletsForBrowser(false)).toEqual(['walletconnect', 'coinbase']);
    for (const w of ['metamask', 'phantom', 'rabby']) expect(WALLETS_WITHOUT_EXTENSION).not.toContain(w);
  });
  it('a browser with a wallet in it gets the full list; one that only announces itself (EIP-6963) counts too', () => {
    expect(browserHasWallet(win((w) => (w.ethereum = {})))).toBe(true);
    expect(walletsForBrowser(true)).toEqual([...MAGIC_WALLETS]);
    expect(browserHasWallet(win((t) => t.addEventListener('eip6963:requestProvider', () => t.dispatchEvent(new Event('eip6963:announceProvider')))))).toBe(true);
  });
});

describe('the wallet inside the browser', () => {
  it('uses window.ethereum, or OKX Wallet own provider when that is all there is', async () => {
    const { injectedProvider } = await import('./wallet');
    const okx = { request: async () => [] };
    const eth = { request: async () => [] };
    vi.stubGlobal('window', { okxwallet: okx });
    expect(injectedProvider()).toBe(okx);
    vi.stubGlobal('window', { ethereum: eth, okxwallet: okx });
    expect(injectedProvider()).toBe(eth);
    vi.stubGlobal('window', {});
    expect(injectedProvider()).toBeNull();
    vi.unstubAllGlobals();
  });
});

describe('reading an address out of what Magic returns', () => {
  it.each([
    ['a plain address', A, A],
    ['publicAddress', { publicAddress: A }, A],
    ['a wallets list', { wallets: [{ address: B }] }, B],
    ['deeply nested', { a: { b: [{ c: { ethereum: A } }] } }, A],
    ['nothing usable', { address: 'nope', wallets: [] }, null],
    ['not even an object', 42, null],
  ])('%s', (_n, input, want) => {
    expect(addressFromMagicInfo(input)).toBe(want);
  });
});

describe('after the connect panel reports a login', () => {
  it('a wallet the customer picked: sends through that wallet, never another', async () => {
    const own = provider([A]);
    const w = await finishLoginWith(magic({ walletKit: { getWalletProvider: async () => own } }), { method: 'wallet', walletAddress: A });
    expect(w.address).toBe(A);
    expect(w.provider).toBe(own);
  });

  it('a wallet whose connection is not available, or with a bad address, says so in plain words', async () => {
    await expect(finishLoginWith(magic(), { method: 'wallet', walletAddress: A })).rejects.toThrow(/connection was not available/);
    await expect(finishLoginWith(magic({ walletKit: { getWalletProvider: async () => provider() } }), { method: 'wallet', walletAddress: 'nope' })).rejects.toThrow(/connection was not available/);
  });

  it('an email wallet: the address comes from Magic and it sends through Magic', async () => {
    const m = magic({ user: { isLoggedIn: async () => true, getInfo: async () => ({ wallets: { ethereum: { publicAddress: B } } }), logout: async () => true } });
    const w = await finishLoginWith(m, { method: 'email' });
    expect(w).toEqual({ address: B, provider: m.rpcProvider });
  });

  it('an email wallet whose address cannot be read is an error, not a wrong address', async () => {
    await expect(finishLoginWith(magic(), { method: 'email' })).rejects.toThrow(/could not read its address/);
  });
});

describe('picking up where the customer left off', () => {
  it('reconnects a wallet connected earlier', async () => {
    const own = provider([A]);
    const w = await restoreWith(magic({ walletKit: { getWalletProvider: async () => own } }));
    expect(w).toEqual({ address: A, provider: own });
  });

  it('reconnects an email wallet', async () => {
    const m = magic({ user: { isLoggedIn: async () => true, getInfo: async () => ({ publicAddress: B }), logout: async () => true } });
    expect((await restoreWith(m))?.address).toBe(B);
  });

  it('returns nothing (and never throws) when there is nothing to restore', async () => {
    expect(await restoreWith(magic())).toBeNull();
    expect(await restoreWith(magic({ walletKit: { getWalletProvider: async () => provider([]) } }))).toBeNull();
    expect(await restoreWith(magic({ user: { isLoggedIn: async () => { throw new Error('boom'); }, getInfo: async () => ({}), logout: async () => true } }))).toBeNull();
  });
});

describe("a wallet the browser already has", () => {
  it('is found only when there is one', () => {
    expect(injectedProvider()).toBeNull();
    (window as unknown as { ethereum: unknown }).ethereum = provider();
    expect(injectedProvider()).not.toBeNull();
    (window as unknown as { ethereum: unknown }).ethereum = {};
    expect(injectedProvider()).toBeNull();
  });

  it('asks the wallet for an account and refuses an answer that is not an address', async () => {
    expect((await connectInjected(provider([A]))).address).toBe(A);
    await expect(connectInjected(provider(['nope']))).rejects.toThrow();
    await expect(connectInjected(provider([]))).rejects.toThrow();
  });
});

describe('plain words for a failed connection', () => {
  it('cancelling is not an error to be scared of', () => {
    expect(friendlyConnectError({ code: 4001, message: 'User rejected' })).toMatch(/cancelled/);
    expect(friendlyConnectError(new Error('Connection request denied'))).toMatch(/cancelled/);
  });
  it('anything else is kind and short, with no technical text', () => {
    const msg = friendlyConnectError(new Error('WebSocket 1006 relay.walletconnect.org handshake'));
    expect(msg).toBe("We couldn't connect your wallet. Please try again, or pick another wallet.");
    expect(msg).not.toMatch(/websocket|relay|1006/i);
  });
});

describe('wallet apps on phones (WalletConnect asking for Celo)', () => {
  it('asks for Celo as an optional chain, so wallets that do not list it can still connect', async () => {
    const { walletConnectInitOptions } = await import('./wallet');
    const o = walletConnectInitOptions('pid', 'https://pay.goodcash.xyz');
    expect(o.optionalChains).toEqual([42220]);
    expect((o as Record<string, unknown>).chains).toBeUndefined();
    expect(o.rpcMap[42220]).toBe('https://forno.celo.org');
  });

  it('on a phone a bare window.ethereum is not a wallet, but a wallet app own browser is', async () => {
    const { browserHasWallet } = await import('./wallet');
    const phone = (eth: Record<string, unknown>) => {
      const w = new EventTarget() as unknown as Record<string, unknown>;
      w.navigator = { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) Mobile' };
      w.ethereum = eth;
      return w as unknown as Window;
    };
    expect(browserHasWallet(phone({}))).toBe(false);
    expect(browserHasWallet(phone({ isMetaMask: true }))).toBe(true);
    expect(browserHasWallet(phone({ isOkxWallet: true }))).toBe(true);
    expect(browserHasWallet(phone({ isOKExWallet: true }))).toBe(true);
    const okx = new EventTarget() as unknown as Record<string, unknown>;
    okx.navigator = { userAgent: 'Mozilla/5.0 (Linux; Android 14) Mobile' };
    okx.okxwallet = {};
    expect(browserHasWallet(okx as unknown as Window)).toBe(true);
  });
});
