import { ORDERS_API_BASE } from './rate';

/** The friend's link the customer opened, kept on this device until they add money. */
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
  friends: number;
  earnedG: number;
  bonusG: number;
  perFriendG: number;
  friendBonusG: number;
  minNaira: number;
  maxFriends: number;
}

export async function fetchReferralSummary(wallet: string): Promise<ReferralSummary> {
  const res = await fetch(`${ORDERS_API_BASE}/referral/me?wallet=${wallet}`);
  if (!res.ok) throw new Error('We could not load this right now.');
  return (await res.json()) as ReferralSummary;
}
