import { useCallback, useEffect, useState } from 'react';
import { ORDERS_API_BASE } from './rate';

/**
 * Only GoodDollar-verified people can add G$ with naira or cash out. The server enforces it when an order is
 * created; this is the friendly front door, so a person learns it up front instead of at the end of a form.
 * If the check cannot be made, the screen lets them go on: the server still decides.
 */

export type VerifiedStatus = 'checking' | 'verified' | 'not_verified' | 'unknown';

/** true or false; throws when the answer could not be read */
export async function fetchVerified(wallet: string): Promise<boolean> {
  const res = await fetch(`${ORDERS_API_BASE}/verified?wallet=${wallet}`);
  if (!res.ok) throw new Error('verification check unavailable');
  const body = (await res.json()) as { required?: boolean; verified?: boolean };
  // A server that does not require it behaves as "everyone is fine". An answer we do not understand is "could not tell", never "no".
  if (body.required === false) return true;
  if (typeof body.verified !== 'boolean') throw new Error('verification check unreadable');
  return body.verified;
}

/**
 * Follows a wallet's verification. Asks again when the person comes back to the tab (they leave to verify), and
 * on demand. A person already known to be verified is not asked again.
 */
export function useVerified(wallet: string | null): { status: VerifiedStatus; recheck: () => Promise<VerifiedStatus> } {
  const [state, setState] = useState<{ wallet: string | null; status: VerifiedStatus }>({ wallet: null, status: 'unknown' });

  const check = useCallback(async (): Promise<VerifiedStatus> => {
    if (!wallet) return 'unknown';
    let next: VerifiedStatus;
    try {
      next = (await fetchVerified(wallet)) ? 'verified' : 'not_verified';
    } catch {
      next = 'unknown';
    }
    setState((s) => (s.wallet === wallet && s.status === 'verified' && next === 'unknown' ? s : { wallet, status: next }));
    return next;
  }, [wallet]);

  useEffect(() => {
    if (!wallet) return;
    setState({ wallet, status: 'checking' });
    void check();
    const onFocus = () => {
      if (document.visibilityState === 'visible') void check();
    };
    document.addEventListener('visibilitychange', onFocus);
    return () => document.removeEventListener('visibilitychange', onFocus);
  }, [wallet, check]);

  return { status: wallet && state.wallet === wallet ? state.status : 'unknown', recheck: check };
}
