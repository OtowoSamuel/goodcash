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

const HANDLED_KEY = 'goodcash_ref_handled';

/**
 * The exact text a friend signs to accept an invite. Keep it word for word in step with buildJoinMessage in
 * services/orders/src/referral.ts, or the server refuses the signature (both test suites pin the same text).
 */
export function buildJoinMessage(wallet: string, inviter: string, issuedAt: number): string {
  const ts = new Date(Math.floor(issuedAt / 1000) * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z');
  return ['Accept a GoodCash invite.', '', 'This is free and sends no money.', '', `Invited by: ${inviter.toLowerCase()}`, `Wallet: ${wallet.toLowerCase()}`, `Issued at: ${ts}`].join('\n');
}

/** True once this wallet's invite was accepted (or turned out not to apply) on this device */
export function inviteHandled(wallet: string): boolean {
  try {
    return localStorage.getItem(HANDLED_KEY) === wallet.toLowerCase();
  } catch {
    return false;
  }
}

function markHandled(wallet: string): void {
  try {
    localStorage.setItem(HANDLED_KEY, wallet.toLowerCase());
  } catch {
    // Nothing to keep: the card may show again on the next visit
  }
}

export type AcceptResult = 'joined' | 'not_new' | 'already' | 'ended' | 'failed';

type Eip1193 = { request: (args: { method: string; params?: unknown[] }) => Promise<unknown> };

/**
 * The friend accepts the saved invite: their wallet signs a free message, and the server records it.
 * Throws the wallet's own error when they cancel, so the screen can say so.
 */
export async function acceptInvite(wallet: string, provider: Eip1193, fetchFn: typeof fetch = fetch, now = Date.now()): Promise<AcceptResult> {
  const ref = savedReferral(wallet);
  if (!ref) return 'failed';
  const me = wallet.toLowerCase();
  const message = buildJoinMessage(me, ref, now);
  const hex = '0x' + [...new TextEncoder().encode(message)].map((b) => b.toString(16).padStart(2, '0')).join('');
  const signature = (await provider.request({ method: 'personal_sign', params: [hex, me] })) as string;
  const res = await fetchFn(`${ORDERS_API_BASE}/referral/join`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ wallet: me, ref, signature, issuedAt: now }),
  });
  const body = (await res.json().catch(() => ({}))) as { ok?: boolean; reason?: string };
  const out: AcceptResult = body.ok ? 'joined' : body.reason === 'already_verified' ? 'not_new' : body.reason === 'already' ? 'already' : body.reason === 'ended' ? 'ended' : 'failed';
  if (out !== 'failed') markHandled(me);
  return out;
}
