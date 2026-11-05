export type AnalyticsEventName =
  | 'wallet_connected'
  | 'balance_viewed'
  | 'readiness_viewed'
  | 'quote_shown'
  | 'swap_submitted'
  | 'CashOut'
  | 'swap_failed'
  | 'claim_confirmed'
  | 'handoff_clicked'
  | 'order_created'
  | 'order_paid'
  | 'order_settled'
  | 'goal_created'
  | 'alert_created'
  | 'weekly_return';

export type AnalyticsPayload = Record<string, string | number | boolean | null | undefined>;

export interface AnalyticsEvent {
  event_id: string;
  event_name: AnalyticsEventName;
  source: 'app' | 'contract' | 'backend';
  timestamp: string;
  payload: AnalyticsPayload;
}

const DISALLOWED_KEYS = new Set([
  'name',
  'phone',
  'bank',
  'bank_name',
  'account_number',
  'iban',
  'routing_number',
  'sort_code',
  'cvv',
  'card',
  'raw_partner_payload',
]);

const queue: AnalyticsEvent[] = [];
const eventKeys = new Set<string>();

function sanitizePayload(payload: AnalyticsPayload): AnalyticsPayload {
  const cleaned: AnalyticsPayload = {};

  for (const [key, value] of Object.entries(payload)) {
    if (value === undefined || value === null) {
      continue;
    }

    const normalizedKey = key.toLowerCase();
    if (DISALLOWED_KEYS.has(normalizedKey)) {
      continue;
    }

    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (!trimmed) {
        continue;
      }
      cleaned[key] = trimmed;
      continue;
    }

    cleaned[key] = value;
  }

  return cleaned;
}

function canonicalizePayload(payload: AnalyticsPayload): string {
  return JSON.stringify(sanitizePayload(payload));
}

export function emitAnalyticsEvent(
  event_name: AnalyticsEventName,
  payload: AnalyticsPayload,
  source: AnalyticsEvent['source'] = 'app'
): AnalyticsEvent | null {
  const cleanPayload = sanitizePayload(payload);
  const key = `${event_name}:${canonicalizePayload(cleanPayload)}`;

  if (eventKeys.has(key)) {
    return null;
  }

  const event: AnalyticsEvent = {
    event_id: `${event_name}:${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 8)}`,
    event_name,
    source,
    timestamp: new Date().toISOString(),
    payload: cleanPayload,
  };

  eventKeys.add(key);
  queue.push(event);

  if (typeof window !== 'undefined' && typeof window.localStorage !== 'undefined') {
    try {
      const previous = JSON.parse(window.localStorage.getItem('goodcash_analytics') ?? '[]') as AnalyticsEvent[];
      const next = [...previous, event].slice(-200);
      window.localStorage.setItem('goodcash_analytics', JSON.stringify(next));
    } catch {
      // Ignore storage errors in private browsing or restricted environments.
    }
  }

  const endpoint = typeof import.meta !== 'undefined' ? import.meta.env?.VITE_ANALYTICS_ENDPOINT : undefined;
  if (endpoint && typeof navigator !== 'undefined' && 'sendBeacon' in navigator) {
    const body = JSON.stringify(event);
    const blob = new Blob([body], { type: 'application/json' });
    navigator.sendBeacon(endpoint, blob);
  }

  return event;
}

export function resetAnalyticsState() {
  queue.length = 0;
  eventKeys.clear();
}

export function getAnalyticsQueue(): AnalyticsEvent[] {
  return [...queue];
}

export function decodeCashOutEvent(raw: {
  user?: string;
  recipient?: string;
  tokenOut?: string;
  amountIn?: string | number | bigint;
  amountOut?: string | number | bigint;
  route?: string | number;
  ref?: string;
  source?: 'app' | 'contract';
}): AnalyticsPayload {
  const amountInValue = typeof raw.amountIn === 'bigint' ? raw.amountIn.toString() : raw.amountIn ?? '0';
  const amountOutValue = typeof raw.amountOut === 'bigint' ? raw.amountOut.toString() : raw.amountOut ?? '0';

  return {
    user: raw.user ?? '0x0000000000000000000000000000000000000000',
    recipient: raw.recipient ?? '0x0000000000000000000000000000000000000000',
    tokenOut: raw.tokenOut ?? '0x0000000000000000000000000000000000000000',
    amountIn: amountInValue,
    amountOut: amountOutValue,
    route: String(raw.route ?? 'unknown'),
    ref: raw.ref ?? 'unset',
    source: raw.source ?? 'contract',
  };
}

export function createDuneQuerySpec() {
  return {
    title: 'GoodCash cash-out dashboard',
    description:
      'Measures cumulative and weekly G$ routed, USD value at the time of each swap, unique wallets, new vs returning wallets, median swap size, route split, and cash-out completion rate.',
    metrics: [
      'cumulative_g_routed',
      'weekly_g_routed',
      'usd_value_at_swap_time',
      'unique_wallets',
      'new_vs_returning_wallets',
      'route_split',
      'median_swap_size_g',
      'median_cost_percent',
      'cashout_completion_rate',
    ],
    source: 'GoodCashRouter.CashOut events + app funnel events',
    notes: [
      'Use the contract event as the source of truth for G$ volume and route selection.',
      'Join a price table or Reserve quote to convert amountIn to USD at swap time.',
      'Do not store raw bank details or names in analytics tables.',
      'Wallet addresses are pseudonymous personal data and remain wallet-level only.',
    ],
  };
}

export const ANALYTICS_DASHBOARD_URL = 'https://dune.com/your-org/goodcash-dashboard';
export const PRIVACY_NOTICE =
  'Wallet addresses are pseudonymous personal data. GoodCash analytics are wallet-level only and never include bank details, names, phone numbers, or raw partner responses.';
