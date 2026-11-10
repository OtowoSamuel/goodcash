// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const setActiveProvider = vi.fn();
vi.mock('./router', () => ({ setActiveProvider: (...a: unknown[]) => setActiveProvider(...a) }));

import { connectOkx, disconnectOkx, isPhoneBrowser, okxAppLink, okxProvider, restoreOkx } from './okxWallet';

const store = new Map<string, string>();
beforeEach(() => {
  store.clear();
  setActiveProvider.mockClear();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  });
});

const win = (okx?: unknown, ua = 'Mozilla/5.0 (Macintosh)') => ({ okxwallet: okx, navigator: { userAgent: ua } }) as unknown as Window;
const provider = (accounts: string[] | Error) => ({
  request: vi.fn(async ({ method }: { method: string }) => {
    if (accounts instanceof Error) throw accounts;
    return method === 'eth_requestAccounts' || method === 'eth_accounts' ? accounts : null;
  }),
});

describe('OKX Wallet connection', () => {
  it('finds OKX only when its provider is there', () => {
    expect(okxProvider(win())).toBeNull();
    expect(okxProvider(win({}))).toBeNull();
    const p = provider(['0xabc']);
    expect(okxProvider(win(p))).toBe(p);
  });

  it('knows a phone browser from a laptop one', () => {
    expect(isPhoneBrowser(win(undefined, 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) Mobile'))).toBe(true);
    expect(isPhoneBrowser(win(undefined, 'Mozilla/5.0 (Linux; Android 14) Mobile'))).toBe(true);
    expect(isPhoneBrowser(win())).toBe(false);
  });

  it('builds the link that opens this page inside the OKX app', () => {
    const link = okxAppLink('https://goodcash.xyz/?a=1&b=2');
    expect(link.startsWith('https://web3.okx.com/download?deeplink=')).toBe(true);
    const deep = decodeURIComponent(link.split('deeplink=')[1]);
    expect(deep).toBe(`okx://wallet/dapp/url?dappUrl=${encodeURIComponent('https://goodcash.xyz/?a=1&b=2')}`);
  });

  it('connects, makes OKX the wallet payments go through, and remembers the choice', async () => {
    const p = provider(['0x1111111111111111111111111111111111111111']);
    expect(await connectOkx(win(p))).toBe('0x1111111111111111111111111111111111111111');
    expect(p.request).toHaveBeenCalledWith({ method: 'eth_requestAccounts' });
    expect(setActiveProvider).toHaveBeenCalledWith(p);
    expect(store.size).toBe(1);
  });

  it('says so plainly when OKX is missing or gives no account, and changes nothing', async () => {
    await expect(connectOkx(win())).rejects.toThrow(/not found/);
    await expect(connectOkx(win(provider([])))).rejects.toThrow(/No account/);
    await expect(connectOkx(win(provider(new Error('User rejected'))))).rejects.toThrow('User rejected');
    expect(setActiveProvider).not.toHaveBeenCalled();
    expect(store.size).toBe(0);
  });

  it('restores only after the customer chose OKX, and only while it still has the account', async () => {
    const p = provider(['0x2222222222222222222222222222222222222222']);
    expect(await restoreOkx(win(p))).toBeNull(); // never chosen: nothing is restored
    expect(setActiveProvider).not.toHaveBeenCalled();

    await connectOkx(win(p));
    setActiveProvider.mockClear();
    expect(await restoreOkx(win(p))).toBe('0x2222222222222222222222222222222222222222');
    expect(setActiveProvider).toHaveBeenCalledWith(p);

    expect(await restoreOkx(win(provider([])))).toBeNull(); // locked or no account
    expect(await restoreOkx(win())).toBeNull(); // OKX gone
  });

  it('forgets the choice on disconnect', async () => {
    await connectOkx(win(provider(['0x3333333333333333333333333333333333333333'])));
    disconnectOkx();
    expect(await restoreOkx(win(provider(['0x3333333333333333333333333333333333333333'])))).toBeNull();
  });
});
