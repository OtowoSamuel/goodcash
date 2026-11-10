import { setActiveProvider } from './router';

/**
 * OKX Wallet, connected straight through its own browser provider (window.okxwallet), outside Magic's panel.
 * Magic's wallet list does not include OKX, and its provider is not the same as window.ethereum when other wallets
 * are installed too. On a phone, a link opens this page inside the OKX app's own browser, where the provider exists.
 *
 * Nothing here changes how other wallets connect. A remembered flag (set only after the customer chose OKX) lets
 * a reload reconnect to it quietly; without the flag nothing is restored.
 */

interface Eip1193 {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
}

const REMEMBER_KEY = 'goodcash_okx_wallet';

/** OKX's provider if this browser has it (the OKX extension, or the OKX app's own browser). */
export function okxProvider(win: Window = window): Eip1193 | null {
  const p = (win as unknown as { okxwallet?: Eip1193 }).okxwallet;
  return p && typeof p.request === 'function' ? p : null;
}

export function isPhoneBrowser(win: Window = window): boolean {
  return /Android|iPhone|iPad|iPod|Mobile/i.test(win.navigator?.userAgent ?? '');
}

/** A link that opens this page inside the OKX app (OKX's documented deep link, wrapped in its download redirect). */
export function okxAppLink(pageUrl: string): string {
  const deep = `okx://wallet/dapp/url?dappUrl=${encodeURIComponent(pageUrl)}`;
  return `https://web3.okx.com/download?deeplink=${encodeURIComponent(deep)}`;
}

function remember(on: boolean): void {
  try {
    if (on) localStorage.setItem(REMEMBER_KEY, '1');
    else localStorage.removeItem(REMEMBER_KEY);
  } catch {
    // storage blocked: the customer simply connects again after a reload
  }
}

function remembered(): boolean {
  try {
    return localStorage.getItem(REMEMBER_KEY) === '1';
  } catch {
    return false;
  }
}

/** Ask OKX for the account and make it the wallet the app sends payments through. Returns the address. */
export async function connectOkx(win: Window = window): Promise<string> {
  const p = okxProvider(win);
  if (!p) throw new Error('OKX Wallet was not found in this browser.');
  const accounts = (await p.request({ method: 'eth_requestAccounts' })) as string[];
  const account = accounts?.[0];
  if (!account) throw new Error('No account returned by the wallet.');
  setActiveProvider(p);
  remember(true);
  return account;
}

/** After a reload: reconnect to OKX only if the customer chose it before and it still has the account unlocked. */
export async function restoreOkx(win: Window = window): Promise<string | null> {
  if (!remembered()) return null;
  const p = okxProvider(win);
  if (!p) return null;
  try {
    const accounts = (await p.request({ method: 'eth_accounts' })) as string[];
    if (!accounts?.[0]) return null;
    setActiveProvider(p);
    return accounts[0];
  } catch {
    return null;
  }
}

export function disconnectOkx(): void {
  remember(false);
}
