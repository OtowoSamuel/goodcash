import { ORDERS_API_BASE } from './rate';

/** Backup contact if the support form itself cannot be reached. Change this one line to change it everywhere. */
export const SUPPORT_EMAIL = 'support@example.invalid';

export type SupportTopic = 'not_arrived' | 'payment_failed' | 'wrong_amount' | 'charged_nothing' | 'other';

export const SUPPORT_TOPICS: { id: SupportTopic; label: string }[] = [
  { id: 'not_arrived', label: "My naira hasn't arrived" },
  { id: 'payment_failed', label: "My payment didn't go through" },
  { id: 'wrong_amount', label: 'The amount looks wrong' },
  { id: 'charged_nothing', label: 'I was charged but nothing happened' },
  { id: 'other', label: 'Something else' },
];

/** Everything attached automatically so the team can find the cash out. Never includes bank details. */
export interface SupportContext {
  orderId?: string;
  txHash?: string;
  wallet?: string;
  status?: string;
  amountG?: string;
  naira?: string;
  createdAt?: string;
}

export interface SupportRequest {
  email: string;
  topic: SupportTopic;
  message: string;
  context: SupportContext;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function validateSupport(email: string, message: string): string | null {
  if (!EMAIL_RE.test(email.trim())) return 'Enter an email address we can reply to.';
  if (message.trim().length < 10) return 'Tell us a little more about what happened (at least 10 characters).';
  return null;
}

/** Sends the help request to the GoodCash team. Resolves with a ticket reference. */
export async function submitSupport(req: SupportRequest): Promise<string> {
  const res = await fetch(`${ORDERS_API_BASE}/support`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ...req,
      email: req.email.trim(),
      message: req.message.trim(),
      context: {
        ...req.context,
        page: typeof window !== 'undefined' ? window.location.origin : undefined,
        userAgent: typeof navigator !== 'undefined' ? navigator.userAgent.slice(0, 280) : undefined,
      },
    }),
  });
  if (!res.ok) throw new Error('support request failed');
  const data = (await res.json()) as { ticketId?: string };
  if (!data.ticketId) throw new Error('support request failed');
  return data.ticketId;
}

/** Fallback: an email to the team with the same details prefilled. Only used if the form can't be reached. */
export function supportMailto(req: Pick<SupportRequest, 'topic' | 'message' | 'context'>): string {
  const c = req.context;
  const lines = [
    req.message || 'Please describe what happened:',
    '',
    '--- Details (please keep) ---',
    c.orderId ? `Order reference: ${c.orderId}` : '',
    c.txHash ? `Swap transaction: ${c.txHash}` : '',
    c.wallet ? `Wallet: ${c.wallet}` : '',
    c.status ? `Status shown: ${c.status}` : '',
    c.amountG ? `Amount: ${c.amountG} G$` : '',
  ].filter(Boolean);
  const subject = `Cash out help${c.orderId ? ` ${c.orderId}` : ''}`;
  return `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(lines.join('\n'))}`;
}
