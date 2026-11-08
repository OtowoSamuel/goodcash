import { CELO_RPC_URL, setActiveProvider } from './router';

/**
 * Wallet connection through Magic's Wallet Kit (the "magic-test" branch).
 *
 * What it does, from Magic's own docs and the package's type definitions:
 *  - A "Connect wallet" panel (the Wallet Kit widget) lists wallets the customer already has: MetaMask, Coinbase,
 *    Phantom, Rabby and WalletConnect (Wallet Kit uses Reown/WalletConnect underneath for phones).
 *  - After a wallet is picked, the customer signs one "Sign-In with Ethereum" message, and we get the address.
 *  - Wallet Kit exposes the connected wallet's own provider (getWalletProvider), which is what we send payments
 *    through, so the payment always comes from the wallet the customer picked.
 *  - The same panel also offers email login. That creates a NEW Magic wallet; we send through magic.rpcProvider.
 *
 * Needs VITE_MAGIC_PUBLISHABLE_KEY (a public key from the Magic dashboard). Without it, Magic is off.
 */

const env = (typeof import.meta !== 'undefined' ? (import.meta as { env?: Record<string, string | undefined> }).env : undefined) ?? {};
const KEY = (env.VITE_MAGIC_PUBLISHABLE_KEY ?? '').trim();
const REOWN_PROJECT_ID = (env.VITE_WALLETCONNECT_PROJECT_ID ?? '').trim();

export const MAGIC_ENABLED = KEY.length > 0;

/** Wallets the panel offers. */
export const MAGIC_WALLETS = ['metamask', 'walletconnect', 'coinbase', 'phantom', 'rabby'] as const;

interface Eip1193 {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
}

export interface MagicLike {
  rpcProvider: Eip1193;
  user: {
    isLoggedIn: () => Promise<boolean>;
    getInfo: () => Promise<unknown>;
    logout: () => Promise<boolean>;
  };
  walletKit?: { getWalletProvider: () => Promise<Eip1193 | null> };
}

/** What we hand the Magic SDK. Celo is the network, so email wallets are always on Celo. */
export function magicOptions(rpcUrl: string) {
  return { network: { rpcUrl, chainId: 42220 } };
}

let magicPromise: Promise<MagicLike> | null = null;

/** Loads Magic only when it is needed, so the rest of the app stays light. */
export function getMagic(): Promise<MagicLike> {
  if (!MAGIC_ENABLED) return Promise.reject(new Error('Magic is not set up in this build.'));
  if (!magicPromise) {
    magicPromise = (async () => {
      const [{ Magic }, { WalletKitExtension }] = await Promise.all([import('magic-sdk'), import('@magic-ext/wallet-kit')]);
      return new Magic(KEY, {
        // EXPERIMENT: pointing Magic at our own Celo node may be what its servers choke on. Off unless asked for.
        ...(env.VITE_MAGIC_CELO_NETWORK === 'true' ? magicOptions(CELO_RPC_URL) : {}),
        extensions: [new WalletKitExtension(REOWN_PROJECT_ID ? { projectId: REOWN_PROJECT_ID } : undefined)],
      } as never) as unknown as MagicLike;
    })();
    // a failed load must not be remembered, or every later try fails the same way
    magicPromise.catch(() => {
      magicPromise = null;
    });
  }
  return magicPromise;
}

/** The first 0x address found in whatever shape Magic returns the user's wallets in. */
export function addressFromMagicInfo(info: unknown): string | null {
  const find = (v: unknown): string | null => {
    if (typeof v === 'string') return /^0x[0-9a-fA-F]{40}$/.test(v) ? v : null;
    if (Array.isArray(v)) {
      for (const x of v) {
        const a = find(x);
        if (a) return a;
      }
    } else if (v && typeof v === 'object') {
      const o = v as Record<string, unknown>;
      // prefer the documented places first
      for (const k of ['publicAddress', 'address']) {
        const a = find(o[k]);
        if (a) return a;
      }
      for (const k of ['wallets', 'ethereum', 'evm']) {
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

export type MagicLoginResult =
  | { method: 'wallet'; walletAddress: string }
  | { method: 'email' | 'sms' | 'oauth' | 'farcaster' | 'passkey'; [k: string]: unknown };

/**
 * Called when the panel reports a successful login. Makes the right provider the one the app sends payments
 * through, and returns the customer's address.
 */
export async function finishMagicLogin(result: MagicLoginResult): Promise<string> {
  return finishLoginWith(await getMagic(), result);
}

/** The logic of finishMagicLogin, for any Magic-shaped object (so it can be tested without the real SDK). */
export async function finishLoginWith(magic: MagicLike, result: MagicLoginResult): Promise<string> {
  if (result.method === 'wallet') {
    const provider = await magic.walletKit?.getWalletProvider();
    if (!provider) throw new Error('The wallet connected, but its connection was not available. Please try again.');
    setActiveProvider(provider);
    return (result as { walletAddress: string }).walletAddress;
  }
  // Email, text message or social login: a Magic wallet
  const address = addressFromMagicInfo(await magic.user.getInfo());
  if (!address) throw new Error('Your wallet was created, but we could not read its address. Please try again.');
  setActiveProvider(magic.rpcProvider);
  return address;
}

/** Picks up where the customer left off after a reload. Returns the address, or null. */
export async function restoreMagic(): Promise<string | null> {
  if (!MAGIC_ENABLED) return null;
  try {
    return await restoreWith(await getMagic());
  } catch {
    return null;
  }
}

/** The logic of restoreMagic, for any Magic-shaped object. */
export async function restoreWith(magic: MagicLike): Promise<string | null> {
  try {
    // A wallet the customer connected earlier (Wallet Kit reconnects it by itself)
    const provider = await magic.walletKit?.getWalletProvider();
    if (provider) {
      const accounts = (await provider.request({ method: 'eth_accounts' })) as string[];
      if (accounts?.[0]) {
        setActiveProvider(provider);
        return accounts[0];
      }
    }
    // A Magic email wallet
    if (await magic.user.isLoggedIn()) {
      const address = addressFromMagicInfo(await magic.user.getInfo());
      if (address) {
        setActiveProvider(magic.rpcProvider);
        return address;
      }
    }
  } catch {
    // nothing to restore
  }
  return null;
}

export async function disconnectMagic(): Promise<void> {
  try {
    if (MAGIC_ENABLED) await (await getMagic()).user.logout();
  } catch {
    // already signed out
  }
  setActiveProvider(null);
}
