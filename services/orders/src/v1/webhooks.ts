/**
 * Webhooks to partners. Each event is signed:
 *   GoodCash-Signature: t=<unix seconds>,v1=<hex HMAC-SHA256(secret, "<t>.<raw body>")>
 * Partners reject messages older than 5 minutes (replay protection) and ignore event ids they have seen.
 *
 * Delivery: at once when the change happens; failures are retried from a small KV queue by the worker's
 * 10-minute schedule (about 10 min, 30 min, 2 h, 12 h). Signing secrets are stored encrypted (AES-GCM) with
 * PARTNER_SECRETS_KEY and shown to the partner only once.
 */
import { V1Error } from './http';
import { clearWorkIfIdle, markWork, shouldList } from './work';
import { loadPartner } from './auth';
import type { CashOutRecord, Env, Mode, Partner, TopUpRecord } from './types';

export type EventType =
  | 'cashout.paid'
  | 'cashout.failed'
  | 'cashout.refunded'
  | 'cashout.expired'
  | 'cashout.delayed'
  | 'cashout.test'
  | 'topup.paid_in'
  | 'topup.delivered'
  | 'topup.failed';

export interface PartnerEvent {
  id: string;
  object: 'event';
  type: EventType;
  mode: Mode;
  createdAt: string;
  data: unknown;
}

interface QueueItem {
  partnerId: string;
  mode: Mode;
  event: PartnerEvent;
  attempt: number;
}

/** Minutes to wait before retry number n (1-based). Given the 10-minute schedule, the first two land at about 10 min. */
export const RETRY_MINUTES = [1, 5, 30, 120, 720];
const QUEUE_TTL = 3 * 86400;

const b64 = (u: Uint8Array) => btoa(String.fromCharCode(...u));
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function secretsKey(env: Env): Promise<CryptoKey> {
  const raw = env.PARTNER_SECRETS_KEY ? unb64(env.PARTNER_SECRETS_KEY) : null;
  if (!raw || raw.length !== 32) throw new V1Error('unavailable', 'Webhooks are not set up on this server yet (PARTNER_SECRETS_KEY).');
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

export async function encryptSecret(env: Env, secret: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await secretsKey(env), new TextEncoder().encode(secret)));
  return `${b64(iv)}.${b64(ct)}`;
}

export async function decryptSecret(env: Env, enc: string): Promise<string> {
  const [iv, ct] = enc.split('.');
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(iv) }, await secretsKey(env), unb64(ct));
  return new TextDecoder().decode(pt);
}

export async function hmacHex(secret: string, payload: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload));
  return Array.from(new Uint8Array(sig), (b) => b.toString(16).padStart(2, '0')).join('');
}

export async function signatureHeader(secret: string, body: string, nowSec = Math.floor(Date.now() / 1000)): Promise<string> {
  return `t=${nowSec},v1=${await hmacHex(secret, `${nowSec}.${body}`)}`;
}

function randomId(prefix: string): string {
  const b = crypto.getRandomValues(new Uint8Array(12));
  return `${prefix}_${Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')}`;
}

export function newWebhookSecret(): string {
  return randomId('whsec');
}

export function buildEvent(type: EventType, mode: Mode, data: unknown): PartnerEvent {
  return { id: randomId('evt'), object: 'event', type, mode, createdAt: new Date().toISOString(), data };
}

/** Send one event to the partner. True when they answered 2xx within 5 seconds. */
export async function deliver(env: Env, partner: Partner, mode: Mode, event: PartnerEvent): Promise<{ ok: boolean; status: number | null; reason?: string }> {
  const url = partner.webhookUrl?.[mode];
  const enc = partner.webhookSecretEnc?.[mode];
  if (!url || !enc) return { ok: false, status: null, reason: 'no_webhook' };
  try {
    const secret = await decryptSecret(env, enc);
    const body = JSON.stringify(event);
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'GoodCash-Webhooks/1',
        'GoodCash-Signature': await signatureHeader(secret, body),
        'GoodCash-Event-Id': event.id,
      },
      body,
      signal: AbortSignal.timeout(5000),
    });
    return { ok: res.ok, status: res.status };
  } catch (e) {
    return { ok: false, status: null, reason: (e as Error)?.name === 'TimeoutError' ? 'timeout' : 'network' };
  }
}

function queueKey(dueMs: number, eventId: string): string {
  return `whq:${String(dueMs).padStart(13, '0')}:${eventId}`;
}

async function enqueue(env: Env, item: QueueItem, now = Date.now()): Promise<string> {
  const minutes = RETRY_MINUTES[Math.min(item.attempt - 1, RETRY_MINUTES.length - 1)];
  const key = queueKey(now + minutes * 60_000, item.event.id);
  await env.ORDER_STORE.put(key, JSON.stringify(item), { expirationTtl: QUEUE_TTL });
  await markWork(env, 'whq', now);
  return key;
}

/**
 * Tell the partner about a cash out change, once per (cash out, event type). Tries at once; on failure it is queued.
 * Partners without a webhook are skipped (they poll instead).
 */
export async function emitCashOutEvent(env: Env, rec: CashOutRecord, type: EventType, data: unknown, waitUntil?: (p: Promise<unknown>) => void): Promise<void> {
  return emitEvent(env, { id: rec.id, partnerId: rec.partnerId, mode: rec.mode }, type, data, waitUntil);
}

/** The same, for a top-up. */
export async function emitTopUpEvent(env: Env, rec: TopUpRecord, type: EventType, data: unknown, waitUntil?: (p: Promise<unknown>) => void): Promise<void> {
  return emitEvent(env, { id: rec.id, partnerId: rec.partnerId, mode: rec.mode }, type, data, waitUntil);
}

async function emitEvent(env: Env, subject: { id: string; partnerId: string; mode: Mode }, type: EventType, data: unknown, waitUntil?: (p: Promise<unknown>) => void): Promise<void> {
  const once = `evt:${subject.id}:${type}`;
  if (await env.ORDER_STORE.get(once)) return;
  const partner = await loadPartner(env, subject.partnerId);
  if (!partner?.webhookUrl?.[subject.mode]) return;
  await env.ORDER_STORE.put(once, '1', { expirationTtl: subject.mode === 'test' ? 7 * 86400 : 400 * 86400 });
  const event = buildEvent(type, subject.mode, data);
  // Write the event to the queue FIRST, then try to deliver it. If the worker stops in between, the schedule still
  // delivers it. A successful delivery removes it. (A partner may see an event twice, never zero times: they ignore repeated ids.)
  const queued = await enqueue(env, { partnerId: partner.id, mode: subject.mode, event, attempt: 1 });
  const attempt = async () => {
    const out = await deliver(env, partner, subject.mode, event);
    if (out.ok) await env.ORDER_STORE.delete(queued).catch(() => undefined);
  };
  if (waitUntil) waitUntil(attempt());
  else await attempt();
}

/** Retry queued events that are due. Runs on the worker's schedule. */
export async function processWebhookQueue(env: Env, now = Date.now()): Promise<{ delivered: number; retried: number; dropped: number }> {
  let delivered = 0;
  let retried = 0;
  let dropped = 0;
  if (!(await shouldList(env, 'whq', now))) return { delivered, retried, dropped };
  const startedAt = Date.now();
  const page = await env.ORDER_STORE.list({ prefix: 'whq:', limit: 50 });
  if (page.keys.length === 0 && page.list_complete !== false) await clearWorkIfIdle(env, 'whq', startedAt);
  for (const k of page.keys) {
    const due = Number(k.name.split(':')[1]);
    if (due > now) break; // keys sort by due time
    const raw = await env.ORDER_STORE.get(k.name);
    if (!raw) continue;
    const item = JSON.parse(raw) as QueueItem;
    const partner = await loadPartner(env, item.partnerId);
    if (!partner || !partner.enabled) {
      dropped++;
      await env.ORDER_STORE.delete(k.name);
      continue;
    }
    // The item stays in the queue until the outcome is known, so a stop in the middle loses nothing
    const out = await deliver(env, partner, item.mode, item.event);
    if (out.ok) {
      delivered++;
    } else if (item.attempt >= RETRY_MINUTES.length) {
      dropped++;
      console.error(`[v1-webhook] gave up on ${item.event.id} (${item.event.type}) for partner ${partner.id} after ${item.attempt + 1} tries`);
    } else {
      retried++;
      await enqueue(env, { ...item, attempt: item.attempt + 1 }, now);
    }
    await env.ORDER_STORE.delete(k.name);
  }
  return { delivered, retried, dropped };
}

export function eventForStatus(status: string): EventType | null {
  switch (status) {
    case 'paid':
      return 'cashout.paid';
    case 'failed':
      return 'cashout.failed';
    case 'refunded':
      return 'cashout.refunded';
    case 'expired':
      return 'cashout.expired';
    default:
      return null;
  }
}

/** PUT /v1/webhooks: set the URL for this key's mode. A new signing secret is created (and shown once) when there is none or on rotate. */
export async function setWebhook(env: Env, partner: Partner, mode: Mode, body: { url?: unknown; rotateSecret?: unknown }) {
  const url = typeof body.url === 'string' ? body.url.trim() : '';
  let parsed: URL | null = null;
  try {
    parsed = new URL(url);
  } catch {
    parsed = null;
  }
  if (!parsed || parsed.protocol !== 'https:' || /^(localhost|127\.|10\.|192\.168\.|\[)/.test(parsed.hostname)) {
    throw new V1Error('invalid_request', 'url must be a public https:// address.');
  }
  let secret: string | null = null;
  const enc = { ...(partner.webhookSecretEnc ?? {}) };
  if (!enc[mode] || body.rotateSecret === true) {
    secret = newWebhookSecret();
    enc[mode] = await encryptSecret(env, secret);
  }
  const next: Partner = { ...partner, webhookUrl: { ...(partner.webhookUrl ?? {}), [mode]: parsed.toString() }, webhookSecretEnc: enc };
  await env.ORDER_STORE.put(`partner:${partner.id}`, JSON.stringify(next));
  return { url: parsed.toString(), mode, ...(secret ? { secret, note: 'Store this signing secret now. It will not be shown again.' } : {}) };
}
