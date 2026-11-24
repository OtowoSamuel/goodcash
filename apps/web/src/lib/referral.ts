import { ORDERS_API_BASE } from './rate';

/** The friend's link the customer opened, kept on this device until their wallet connects. */
export const REF_KEY = 'goodcash_ref';
const SITE = 'https://goodcash.xyz';
const WALLET = /^0x[0-9a-fA-F]{40}$/;

/** The address in `?ref=`, or null. Anything that is not a plain address is ignored. */
export function refFromSearch(search: string): string | null {
  try {
    const v = new URLSearchParams(search).get('ref');
    return v && WALLET.test(v) ? v.toLowerCase() : null;
  } catch {
    return null;
  }
}

/** Keep the first friend's link a visitor opens. A later link never replaces it. */
export function captureReferral(search: string = typeof window !== 'undefined' ? window.location.search : ''): void {
  const ref = refFromSearch(search);
  if (!ref) return;
  try {
    if (!localStorage.getItem(REF_KEY)) localStorage.setItem(REF_KEY, ref);
  } catch {
    // Storage can be blocked (private windows). The link then simply does not count; nothing breaks.
  }
}

/** The saved friend's link, unless it is the customer's own wallet. */
export function savedReferral(ownWallet?: string | null): string | null {
  try {
    const v = localStorage.getItem(REF_KEY);
    if (!v || !WALLET.test(v)) return null;
    return ownWallet && v.toLowerCase() === ownWallet.toLowerCase() ? null : v;
  } catch {
    return null;
  }
}

export function inviteLink(wallet: string): string {
  return `${SITE}/?ref=${wallet.toLowerCase()}`;
}

export interface ReferralSummary {
  /** False once the campaign has ended or its budget is used up */
  open: boolean;
  endsAt: string;
  /** Friends who joined with this link and have not verified and claimed yet */
  waiting: number;
  /** Friends who counted */
  friends: number;
  perFriends: number;
  rewardG: number;
  maxFriends: number;
  paidG: number;
  pendingG: number;
  /** False when this wallet is not verified with GoodDollar right now */
  verified: boolean;
}

export async function fetchReferralSummary(wallet: string): Promise<ReferralSummary> {
  const res = await fetch(`${ORDERS_API_BASE}/referral/me?wallet=${wallet}`);
  if (!res.ok) throw new Error('We could not load this right now.');
  return (await res.json()) as ReferralSummary;
}

const JOINED_KEY = 'goodcash_ref_joined';

/**
 * A wallet connected with a friend's link saved: tell the server once per wallet on this device. The server keeps it
 * only for a wallet GoodDollar has not verified yet, and counts it later. Never throws and never blocks the app.
 */
export async function joinWithSavedReferral(wallet: string, fetchFn: typeof fetch = fetch): Promise<void> {
  const ref = savedReferral(wallet);
  if (!ref) return;
  const me = wallet.toLowerCase();
  try {
    if (localStorage.getItem(JOINED_KEY) === me) return;
  } catch {
    // Storage blocked: still try once
  }
  try {
    const res = await fetchFn(`${ORDERS_API_BASE}/referral/join`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ wallet: me, ref }),
    });
    if (res.ok) {
      try {
        localStorage.setItem(JOINED_KEY, me);
      } catch {
        // Nothing to keep
      }
    }
  } catch {
    // Offline or blocked: tried again on the next visit
  }
}
