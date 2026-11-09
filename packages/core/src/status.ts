/**
 * The bank has been paid. The payout partner says "fulfilled" once its provider has sent the naira; "validated",
 * "settling" and "settled" only follow later, so these all count as paid.
 */
export const PAID_OUT_STATUSES = ['fulfilled', 'validated', 'settling', 'settled'] as const;

export function isPaidOutStatus(s?: string | null): boolean {
  return !!s && (PAID_OUT_STATUSES as readonly string[]).includes(s);
}

/** Statuses that will never change again. */
export const FINAL_STATUSES = ['settled', 'refunded', 'expired', 'cancelled', 'error'] as const;

/** Plain status names partners and customers see. The payout partner's own names never leave the server. */
export type CashOutStatus = 'awaiting_signature' | 'sent' | 'processing' | 'paid' | 'failed' | 'refunded' | 'expired';

/**
 * Map the payout partner's status to ours. `sent` means we know the customer's transaction exists but the partner
 * has not seen the money yet.
 */
export function cashOutStatusFrom(partnerStatus: string | null | undefined, txKnown: boolean): CashOutStatus {
  const s = (partnerStatus ?? '').toLowerCase();
  if (isPaidOutStatus(s)) return 'paid';
  if (s === 'refunded' || s === 'refunding') return 'refunded';
  if (s === 'expired' || s === 'cancelled') return txKnown ? 'failed' : 'expired';
  if (s === 'error') return 'failed';
  if (s === 'deposited' || s === 'pending' || s === 'fulfilling' || s === 'processing') return 'processing';
  return txKnown ? 'sent' : 'awaiting_signature';
}
