import { CELO_RPC_URL, setActiveProvider } from './router';

type WcProvider = {
  accounts: string[];
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
  on: (event: string, cb: (...args: unknown[]) => void) => void;
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
  session?: unknown;
};

const PROJECT_ID: string | undefined =
  typeof import.meta !== 'undefined'
    ? (import.meta as { env?: { VITE_WALLETCONNECT_PROJECT_ID?: string } }).env?.VITE_WALLETCONNECT_PROJECT_ID
    : undefined;

export const WALLETCONNECT_ENABLED = Boolean(PROJECT_ID && PROJECT_ID.trim());

let provider: WcProvider | null = null;

/**
 * What we ask the WalletConnect library for. Celo is OPTIONAL, not required. A required chain makes any wallet that
 * does not list Celo refuse the connection outright ("connection rejected"). With it optional, every wallet can
 * connect, and the app switches to Celo (or says clearly that the wallet does not support it) right before a payment.
 */
export function walletConnectInitOptions(projectId: string, origin: string, rpcUrl: string) {
  return {
    projectId,
    optionalChains: [42220],
    showQrModal: true,
    rpcMap: { 42220: rpcUrl },
    metadata: {
      name: 'GoodCash',
      description: 'Cash out your GoodDollar (G$) to naira.',
      url: origin,
      icons: [`${origin}/pwa-192x192.png`],
    },
    qrModalOptions: { themeMode: 'light' as const },
  };
}

async function init(): Promise<WcProvider> {
  if (provider) return provider;
  const { EthereumProvider } = await import('@walletconnect/ethereum-provider');
  provider = (await EthereumProvider.init(
    walletConnectInitOptions(PROJECT_ID as string, window.location.origin, CELO_RPC_URL) as never
  )) as unknown as WcProvider;
  return provider;
}

/** Open the WalletConnect wallet picker (QR on desktop, wallet apps on phones). */
export async function connectWithWalletConnect(onDisconnect?: () => void): Promise<string> {
  if (!WALLETCONNECT_ENABLED) throw new Error('WalletConnect is not set up yet.');
  const p = await init();
  p.on('disconnect', () => {
    setActiveProvider(null);
    onDisconnect?.();
  });
  if (!p.accounts?.length) await p.connect();
  const account = p.accounts?.[0];
  if (!account) throw new Error('No account returned by the wallet.');
  setActiveProvider(p);
  return account;
}

/** Reuse a previous WalletConnect session after a page reload. Returns the account or null. */
export async function restoreWalletConnect(onDisconnect?: () => void): Promise<string | null> {
  if (!WALLETCONNECT_ENABLED) return null;
  try {
    const p = await init();
    if (!p.accounts?.length) return null;
    p.on('disconnect', () => {
      setActiveProvider(null);
      onDisconnect?.();
    });
    setActiveProvider(p);
    return p.accounts[0];
  } catch {
    return null;
  }
}

export async function disconnectWalletConnect(): Promise<void> {
  try {
    await provider?.disconnect();
  } catch {
    // already disconnected
  }
  setActiveProvider(null);
}

