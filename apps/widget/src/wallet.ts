/**
 * Wallets inside the widget. Three ways to get a wallet, in this order:
 *   1. the host page signs for us (games with embedded wallets): see bridge.ts, no wallet is connected here;
 *   2. a wallet the browser already has (window.ethereum, an in-app wallet like MiniPay);
 *   3. Magic's Wallet Kit panel: MetaMask, WalletConnect (phones), Coinbase, Phantom, Rabby, and email login.
 *      It is loaded only when the customer asks for it, so the widget stays small.
 *
 * Needs two PUBLIC values at build time (both are visible in any web page that uses them, so they are not secrets):
 *   VITE_MAGIC_PUBLISHABLE_KEY   (Magic dashboard; allow https://pay.goodcash.xyz there)
 *   VITE_WALLETCONNECT_PROJECT_ID (Reown dashboard; allow https://pay.goodcash.xyz there)
 * Without the Magic key the panel is off and only wallets the browser already has can be used.
 */
import type { Eip1193Provider } from '@goodcash/sdk';

const env = (import.meta as { env?: Record<string, string | undefined> }).env ?? {};
const MAGIC_KEY = (env.VITE_MAGIC_PUBLISHABLE_KEY ?? '').trim();
const REOWN_PROJECT_ID = (env.VITE_WALLETCONNECT_PROJECT_ID ?? '').trim();

const CELO_RPC = 'https://forno.celo.org';

export const MAGIC_ENABLED = MAGIC_KEY.length > 0;

/** Wallets the panel offers. */
export const MAGIC_WALLETS = ['metamask', 'walletconnect', 'coinbase', 'phantom', 'rabby'] as const;

/**
 * Wallets that work with no wallet inside the browser: WalletConnect opens the customer's wallet app (MetaMask, Trust,
 * Valora...) from a phone, and Coinbase has its own app link. MetaMask, Phantom and Rabby on their own are browser
 * extensions, so listing them in a plain phone browser ends in "connector not found" (this happened in the GoodCash app).
 */
export const WALLETS_WITHOUT_EXTENSION = ['walletconnect', 'coinbase'] as const;

/** True when this browser already has a wallet in it: window.ethereum, or a wallet announcing itself (EIP-6963). */
export function browserHasWallet(win: Window = window): boolean {
  const eth = (win as unknown as { ethereum?: Record<string, unknown> }).ethereum;
  // OKX Wallet (its app browser or its extension) also sets window.okxwallet
  if ((win as unknown as { okxwallet?: unknown }).okxwallet) return true;
  if (eth) {
    // On a phone a bare window.ethereum is not a wallet we can connect to: only a wallet app's own browser sets a flag.
    const phone = /Android|iPhone|iPad|iPod|Mobile/i.test(win.navigator?.userAgent ?? '');
    const known = ['isMetaMask', 'isCoinbaseWallet', 'isTrust', 'isTrustWallet', 'isPhantom', 'isRabby', 'isMiniPay', 'isOkxWallet', 'isOKExWallet'].some((k) => eth[k] === true);
    if (!phone || known) return true;
  }
  let found = false;
  const onAnnounce = () => {
    found = true;
  };
  win.addEventListener('eip6963:announceProvider', onAnnounce);
  try {
    // Wallets answer straight away, inside this call
    win.dispatchEvent(new Event('eip6963:requestProvider'));
  } finally {
    win.removeEventListener('eip6963:announceProvider', onAnnounce);
  }
  return found;
}

/** The wallets to list in the connect panel for this browser. */
export function walletsForBrowser(hasWallet: boolean = browserHasWallet()): readonly (typeof MAGIC_WALLETS)[number][] {
  return hasWallet ? MAGIC_WALLETS : WALLETS_WITHOUT_EXTENSION;
}

export interface MagicLike {
  rpcProvider: Eip1193Provider;
  user: {
    isLoggedIn: () => Promise<boolean>;
    getInfo: () => Promise<unknown>;
    logout: () => Promise<boolean>;
  };
  walletKit?: { getWalletProvider: () => Promise<Eip1193Provider | null> };
}

export interface ConnectedWallet {
  address: `0x${string}`;
  provider: Eip1193Provider;
}

export type MagicLoginResult =
  | { method: 'wallet'; walletAddress: string }
  | { method: 'email' | 'sms' | 'oauth' | 'farcaster' | 'passkey'; [k: string]: unknown };

const isAddr = (v: unknown): v is `0x${string}` => typeof v === 'string' && /^0x[0-9a-fA-F]{40}$/.test(v);

let magicPromise: Promise<MagicLike> | null = null;

/** Loads Magic only when it is needed. A failed load is not remembered, so the next try starts fresh. */
export function getMagic(): Promise<MagicLike> {
  if (!MAGIC_ENABLED) return Promise.reject(new Error('Magic is not set up in this build.'));
  if (!magicPromise) {
    magicPromise = (async () => {
      const [{ Magic }, { WalletKitExtension }] = await Promise.all([import('magic-sdk'), import('@magic-ext/wallet-kit')]);
      return new Magic(MAGIC_KEY, {
        // Email and passkey wallets must live on Celo: Magic starts on Ethereum and cannot switch afterwards.
        // (Magic dashboard: https://forno.celo.org must be allowed in the Content Security Policy.)
        ...(env.VITE_MAGIC_CELO_NETWORK === 'false' ? {} : { network: { rpcUrl: CELO_RPC, chainId: 42220 } }),
        extensions: [new WalletKitExtension(REOWN_PROJECT_ID ? { projectId: REOWN_PROJECT_ID } : undefined)],
      } as never) as unknown as MagicLike;
    })();
    magicPromise.catch(() => {
      magicPromise = null;
    });
  }
  return magicPromise;
}

/** The first 0x address found in whatever shape Magic returns the user's wallets in. */
export function addressFromMagicInfo(info: unknown): `0x${string}` | null {
  const find = (v: unknown): `0x${string}` | null => {
    if (isAddr(v)) return v;
    if (Array.isArray(v)) {
      for (const x of v) {
        const a = find(x);
        if (a) return a;
      }
    } else if (v && typeof v === 'object') {
      const o = v as Record<string, unknown>;
      for (const k of ['publicAddress', 'address', 'wallets', 'ethereum', 'evm']) {
        const a = find(o[k]);
        if (a) return a;
      }
      for (const x of Object.values(o)) {
        const a = find(x);
        if (a) return a;
      }
    }
    return null;
  };
  return find(info);
}

/** After the panel reports a login: the wallet the customer picked (and the provider to send through). */
export async function finishLoginWith(magic: MagicLike, result: MagicLoginResult): Promise<ConnectedWallet> {
  if (result.method === 'wallet') {
    const provider = await magic.walletKit?.getWalletProvider();
    const address = (result as { walletAddress?: unknown }).walletAddress;
    if (!provider || !isAddr(address)) throw new Error('The wallet connected, but its connection was not available. Please try again.');
    return { address, provider };
  }
  const address = addressFromMagicInfo(await magic.user.getInfo());
  if (!address) throw new Error('Your wallet was created, but we could not read its address. Please try again.');
  return { address, provider: magic.rpcProvider };
}

export async function finishMagicLogin(result: MagicLoginResult): Promise<ConnectedWallet> {
  return finishLoginWith(await getMagic(), result);
}

/** Picks up where the customer left off. Returns the wallet, or null. */
export async function restoreWith(magic: MagicLike): Promise<ConnectedWallet | null> {
  try {
    const provider = await magic.walletKit?.getWalletProvider();
    if (provider) {
      const accounts = (await provider.request({ method: 'eth_accounts' })) as string[];
      if (isAddr(accounts?.[0])) return { address: accounts[0], provider };
    }
    if (await magic.user.isLoggedIn()) {
      const address = addressFromMagicInfo(await magic.user.getInfo());
      if (address) return { address, provider: magic.rpcProvider };
    }
  } catch {
    // nothing to restore
  }
  return null;
}

export async function restoreMagic(): Promise<ConnectedWallet | null> {
  if (!MAGIC_ENABLED) return null;
  try {
    return await restoreWith(await getMagic());
  } catch {
    return null;
  }
}

/** A wallet the browser already has (extension, or an in-app wallet such as MiniPay). */
export function injectedProvider(): Eip1193Provider | null {
  const eth = typeof window !== 'undefined' ? (window as unknown as { ethereum?: Eip1193Provider }).ethereum : undefined;
  return eth && typeof eth.request === 'function' ? eth : null;
}

/** Ask the browser's own wallet for an account. Throws the wallet's own error when the customer says no. */
export async function connectInjected(provider: Eip1193Provider): Promise<ConnectedWallet> {
  const accounts = (await provider.request({ method: 'eth_requestAccounts' })) as string[];
  if (!isAddr(accounts?.[0])) throw new Error('No account was shared.');
  return { address: accounts[0], provider };
}

/** Plain words for a failed connection. */
export function friendlyConnectError(e: unknown): string {
  const x = e as { code?: number; message?: string } | null;
  const text = `${x?.message ?? ''}`;
  if (x?.code === 4001 || /reject|denied|cancel|closed/i.test(text)) return 'You cancelled the connection. You can try again when you are ready.';
  if (/connection was not available|could not read its address/i.test(text)) return text;
  return "We couldn't connect your wallet. Please try again, or pick another wallet.";
}

// ---------------------------------------------------------------------------------------------------------------
// Wallet apps on a phone, through WalletConnect. Magic's own wallet list only knows Ethereum, not Celo, so a phone
// wallet connected through it can never approve a Celo payment. This asks for Celo directly (as an optional chain,
// so wallets that do not list it can still connect, and are asked to switch right before paying).
// ---------------------------------------------------------------------------------------------------------------

export const WALLETCONNECT_ENABLED = REOWN_PROJECT_ID.length > 0;

/** What we ask the WalletConnect library for. */
export function walletConnectInitOptions(projectId: string, origin: string) {
  return {
    projectId,
    optionalChains: [42220],
    showQrModal: true,
    rpcMap: { 42220: CELO_RPC },
    metadata: {
      name: 'GoodCash',
      description: 'Cash out your GoodDollar (G$) to naira.',
      url: origin,
      icons: [`${origin}/favicon.svg`],
    },
    qrModalOptions: { themeMode: 'light' as const },
  };
}

type WcProvider = Eip1193Provider & { accounts: string[]; connect: () => Promise<void> };
let wcProvider: WcProvider | null = null;

async function initWalletConnect(): Promise<WcProvider> {
  if (wcProvider) return wcProvider;
  const { EthereumProvider } = await import('@walletconnect/ethereum-provider');
  wcProvider = (await EthereumProvider.init(walletConnectInitOptions(REOWN_PROJECT_ID, window.location.origin) as never)) as unknown as WcProvider;
  return wcProvider;
}

/** Open the wallet picker (wallet apps on a phone, a QR code on a computer). */
export async function connectWithWalletConnect(): Promise<ConnectedWallet> {
  if (!WALLETCONNECT_ENABLED) throw new Error('Wallet apps are not set up in this build.');
  const p = await initWalletConnect();
  if (!p.accounts?.length) await p.connect();
  const address = p.accounts?.[0];
  if (!isAddr(address)) throw new Error('No account was shared.');
  return { address, provider: p };
}

/** Reuse a wallet-app session after a reload. */
export async function restoreWalletConnect(): Promise<ConnectedWallet | null> {
  if (!WALLETCONNECT_ENABLED) return null;
  try {
    // Only load the (large) WalletConnect library for someone who has connected a wallet app before
    const had = Object.keys(localStorage).some((k) => k.startsWith('wc@2:'));
    if (!had) return null;
    const p = await initWalletConnect();
    const address = p.accounts?.[0];
    return isAddr(address) ? { address, provider: p } : null;
  } catch {
    return null;
  }
}
