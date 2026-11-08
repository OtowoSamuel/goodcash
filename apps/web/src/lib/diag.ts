import { ORDERS_API_BASE } from './rate';

/**
 * Sends a short, anonymous error report to the team's logs. Never shown to users, never blocks the screen.
 * Carries a code and the error text only: no bank details, no email.
 */
export function reportIssue(kind: string, err: unknown, extra: { orderId?: string; txHash?: string } = {}): void {
  try {
    const e = err as { shortMessage?: string; message?: string } | null;
    const message = (e?.shortMessage || e?.message || String(err ?? '')).slice(0, 300);
    void fetch(`${ORDERS_API_BASE}/diag`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind, message, ...extra }),
      keepalive: true,
    }).catch(() => {});
  } catch {
    // reporting must never break the app
  }
}
