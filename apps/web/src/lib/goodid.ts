import { compressToEncodedURIComponent } from 'lz-string';
import { createWalletClient, custom, getAddress, type Address } from 'viem';
import { celo } from 'viem/chains';
import { getWalletProvider } from './router';

/**
 * GoodDollar face verification, started from the wallet the customer is ALREADY connected with: no second login.
 *
 * This is GoodDollar's documented flow (Identity SDK, @goodsdks/citizen-sdk 1.2.8, `generateFVLink` in
 * packages/citizen-sdk/src/sdks/viem-identity-sdk.ts of github.com/GoodDollar/GoodSdks): the connected wallet signs
 * a fixed message naming its own address, and the customer is sent to GoodDollar's verification page with that
 * signature. GoodDollar then knows exactly which wallet to verify, does the face check, and sends the customer back
 * to `rdu` with `?verified=true`. We never trust that flag: the app asks the chain (the Identity contract) instead.
 *
 * Keep FV_MESSAGE and the link format in step with the SDK; if GoodDollar changes them, the link stops working.
 */
export const GOODID_URL = 'https://goodid.gooddollar.org';
const CELO_CHAIN_ID = 42220;

/** GoodDollar's FV_IDENTIFIER_MSG2, word for word. `<account>` is the checksummed wallet address. */
export function fvMessage(address: string): string {
  return `Sign this message to request verifying your account ${getAddress(address)} and to create your own secret unique identifier for your anonymized record.
You can use this identifier in the future to delete this anonymized record.
WARNING: do not sign this message unless you trust the website/application requesting this signature.`;
}

/** The link to GoodDollar's verification page, in the SDK's exact format (redirect mode). */
export function buildFvLink(input: { address: string; signature: string; nonce: string; returnUrl: string; chainId?: number }): string {
  const params = { account: getAddress(input.address), nonce: input.nonce, fvsig: input.signature, chain: input.chainId ?? CELO_CHAIN_ID, rdu: input.returnUrl };
  const url = new URL(GOODID_URL);
  url.searchParams.append('lz', compressToEncodedURIComponent(JSON.stringify(params)));
  return url.toString();
}

/** What the customer was about to do when they went to verify, so we can take them straight back to it. */
export type VerifyIntent = 'cashout' | 'add-g' | 'add-celo' | 'vote' | 'claim';
const PENDING_KEY = 'goodcash_verify_pending';
const RETURN_FLAG = 'gdverify';
/** A trip to GoodDollar older than this is treated as abandoned */
const PENDING_MAX_MS = 2 * 60 * 60 * 1000;

export interface PendingVerify {
  wallet: string;
  intent: VerifyIntent;
  at: number;
}

type Eip1193 = { request: (args: { method: string; params?: unknown[] }) => Promise<unknown> };

/**
 * Ask the connected wallet to sign GoodDollar's message, remember where the customer was going, and send them to
 * GoodDollar's verification page. Throws 'NO_WALLET', 'WRONG_ACCOUNT', or the wallet's own error (for example when
 * the customer cancels in the wallet); nothing is stored and nobody leaves the page in that case.
 */
export async function startGoodDollarVerification(
  wallet: string,
  intent: VerifyIntent,
  deps: { provider?: Eip1193 | null; go?: (url: string) => void; now?: () => number; storage?: Pick<Storage, 'setItem'> | null; here?: string } = {},
): Promise<void> {
  const provider = deps.provider === undefined ? getWalletProvider() : deps.provider;
  if (!provider) throw new Error('NO_WALLET');
  // The wallet that signs must be the one the customer is signed in with: that is the whole point
  const accounts = ((await provider.request({ method: 'eth_accounts' })) as string[] | undefined) ?? [];
  if (!accounts.some((a) => a.toLowerCase() === wallet.toLowerCase())) throw new Error('WRONG_ACCOUNT');

  const now = (deps.now ?? Date.now)();
  const nonce = Math.floor(now / 1000).toString();
  const walletClient = createWalletClient({ chain: celo, transport: custom(provider) });
  const signature = await walletClient.signMessage({ account: getAddress(wallet) as Address, message: fvMessage(wallet) });

  const here = new URL(deps.here ?? window.location.href);
  here.hash = '';
  for (const k of [...here.searchParams.keys()]) if (k === 'verified' || k === RETURN_FLAG) here.searchParams.delete(k);
  here.searchParams.set(RETURN_FLAG, '1');

  const storage = deps.storage === undefined ? safeStorage() : deps.storage;
  try {
    storage?.setItem(PENDING_KEY, JSON.stringify({ wallet: wallet.toLowerCase(), intent, at: now } satisfies PendingVerify));
  } catch {
    // Private windows can refuse storage; the return flag in the address still brings them back to the check
  }
  (deps.go ?? ((u: string) => window.location.assign(u)))(buildFvLink({ address: wallet, signature, nonce, returnUrl: here.toString() }));
}

function safeStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/**
 * Coming back from GoodDollar? Returns what the customer was doing (or a plain 'cashout' when storage was lost but
 * the address shows they came back), and tidies the address bar. Returns null when this is not a return trip.
 */
export function takeVerifyReturn(wallet: string, deps: { href?: string; storage?: Pick<Storage, 'getItem' | 'removeItem'> | null; now?: () => number; replace?: (url: string) => void } = {}): PendingVerify | null {
  const href = deps.href ?? window.location.href;
  const url = new URL(href);
  const flagged = url.searchParams.has(RETURN_FLAG) || url.searchParams.has('verified');
  const storage = deps.storage === undefined ? safeStorage() : deps.storage;
  let pending: PendingVerify | null = null;
  try {
    const raw = storage?.getItem(PENDING_KEY);
    if (raw) pending = JSON.parse(raw) as PendingVerify;
  } catch {
    pending = null;
  }
  const now = (deps.now ?? Date.now)();
  const fresh = !!pending && pending.wallet === wallet.toLowerCase() && now - pending.at < PENDING_MAX_MS;
  // Only the address GoodDollar sends them back to starts the check. Someone who left for GoodDollar and came back some
  // other way (a bookmark, a new tab) is not jumped on uninvited; their next Add G$ or cash out shows the step again.
  if (!flagged) return null;
  try {
    storage?.removeItem(PENDING_KEY);
  } catch {
    // nothing to tidy
  }
  if (flagged) {
    url.searchParams.delete(RETURN_FLAG);
    url.searchParams.delete('verified');
    (deps.replace ?? ((u: string) => window.history.replaceState(window.history.state, '', u)))(url.pathname + (url.search === '?' ? '' : url.search) + url.hash);
  }
  return fresh && pending ? pending : { wallet: wallet.toLowerCase(), intent: 'cashout', at: now };
}

/** Plain words for what went wrong when starting verification. */
export function verifyStartError(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  if (msg === 'NO_WALLET') return 'Connect your wallet first, then try again.';
  if (msg === 'WRONG_ACCOUNT') return 'Your wallet switched to a different account. Switch back to the account you signed in with, then try again.';
  if (/reject|denied|cancel/i.test(msg)) return 'You cancelled in your wallet. Tap Verify with GoodDollar to try again.';
  return 'We could not start verification. Please try again.';
}
