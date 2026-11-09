/**
 * Server helpers (Node 18+, Deno, Bun, Cloudflare Workers). Verify GoodCash webhooks before trusting them.
 *
 *   const event = await verifyWebhook(rawBody, req.headers['goodcash-signature'], process.env.GOODCASH_WEBHOOK_SECRET);
 */
import { GoodCashError } from './errors';

export interface WebhookEvent<T = unknown> {
  id: string;
  object: 'event';
  type: 'cashout.paid' | 'cashout.failed' | 'cashout.refunded' | 'cashout.expired' | 'cashout.delayed' | 'cashout.test';
  mode: 'live' | 'test';
  createdAt: string;
  data: T;
}

async function subtle(): Promise<SubtleCrypto> {
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (c?.subtle) return c.subtle;
  // Older Node without a global crypto (kept out of type resolution so the package stays platform neutral)
  const specifier = 'node:crypto';
  const node = (await import(/* @vite-ignore */ specifier)) as unknown as { webcrypto: Crypto };
  return node.webcrypto.subtle;
}

async function hmacHex(secret: string, payload: string): Promise<string> {
  const s = await subtle();
  const key = await s.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await s.sign('HMAC', key, new TextEncoder().encode(payload));
  return Array.from(new Uint8Array(sig), (b) => b.toString(16).padStart(2, '0')).join('');
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * Check a webhook's GoodCash-Signature header (t=<unix>,v1=<hex>) against the RAW request body, and reject
 * messages older than `toleranceSec` (default 5 minutes). Returns the parsed event.
 * Ignore event ids you have already handled: the same event may arrive more than once.
 */
export async function verifyWebhook<T = unknown>(
  rawBody: string,
  signatureHeader: string | null | undefined,
  secret: string,
  opts: { toleranceSec?: number; nowSec?: number } = {}
): Promise<WebhookEvent<T>> {
  const m = /^t=(\d+),v1=([0-9a-f]{64})$/.exec((signatureHeader ?? '').trim());
  if (!m) throw new GoodCashError('invalid_signature', { detail: 'Missing or malformed GoodCash-Signature header.' });
  const t = Number(m[1]);
  const now = opts.nowSec ?? Math.floor(Date.now() / 1000);
  if (Math.abs(now - t) > (opts.toleranceSec ?? 300)) throw new GoodCashError('invalid_signature', { detail: 'Timestamp outside the allowed window (possible replay).' });
  const expected = await hmacHex(secret, `${m[1]}.${rawBody}`);
  if (!safeEqual(expected, m[2])) throw new GoodCashError('invalid_signature', { detail: 'Signature does not match. Check the secret and that you used the raw body.' });
  return JSON.parse(rawBody) as WebhookEvent<T>;
}

export { GoodCash } from './client';
export { GoodCashError } from './errors';
