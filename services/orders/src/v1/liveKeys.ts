/**
 * Live keys, delivered by email link instead of by hand.
 *
 *   scripts/partners.mjs approve-live <id>   -> adds the partner to the queue `liveapprove:queue` (the person approves; no key is made here)
 *   scheduled run (every 10 min)             -> makes the live keys, emails the partner's confirmed address a one-time link
 *   POST /v1/live-keys/confirm { token }     -> the link's page calls this; returns the keys once, then forgets them
 *
 * The keys are never in the approver's terminal or chat. Until the partner opens the link they are held encrypted
 * (AES-GCM with PARTNER_SECRETS_KEY) for 24 hours; only their SHA-256 is kept as the key record, as always.
 * If the email cannot be sent the new keys are removed again and the partner stays in the queue for the next run.
 */
import { sha256Hex, widgetOrigins } from './auth';
import { V1Error, v1Json } from './http';
import { ipLimited, randomString, readJson, requireDocsSite, sendEmail } from './signup';
import type { Env, KeyRecord, Partner, V1Deps } from './types';
import { decryptSecret, encryptSecret } from './webhooks';

export const LIVE_QUEUE_KEY = 'liveapprove:queue';
const REVEAL_TTL_SECONDS = 86400;
const MAX_TRIES = 6;

export interface QueueEntry {
  id: string;
  at: number;
  tries: number;
}

interface Reveal {
  partnerId: string;
  name: string;
  allowedOrigins: string[];
  publishableKey: string;
  secretKey: string;
}

export function isLiveKeysPath(pathname: string): boolean {
  return pathname.replace(/\/+$/, '') === '/v1/live-keys/confirm';
}

function parseQueue(raw: string | null): QueueEntry[] {
  if (!raw) return [];
  try {
    const list = JSON.parse(raw) as unknown;
    if (!Array.isArray(list)) return [];
    return list.filter((e): e is QueueEntry => !!e && typeof (e as QueueEntry).id === 'string').map((e) => ({ id: e.id, at: Number(e.at) || 0, tries: Number(e.tries) || 0 }));
  } catch {
    return [];
  }
}

function linkEmail(link: string, name: string): { html: string; text: string } {
  const safeName = name.replace(/[&<>"]/g, '');
  const text = [
    `Your GoodCash live keys for "${name}" are ready.`,
    '',
    link,
    '',
    'This link works once and expires in 24 hours. The page it opens shows your live keys one time, so keep them somewhere safe.',
    'The secret key stays on your server only. If you did not ask for live access, reply to this email.',
  ].join('\n');
  const html = `<!doctype html><html><body style="font-family:Arial,Helvetica,sans-serif;color:#14111f;line-height:1.5">
<p>Your GoodCash live keys for <b>${safeName}</b> are ready.</p>
<p><a href="${link}" style="display:inline-block;background:#7b39fc;color:#fff;padding:12px 18px;border-radius:10px;text-decoration:none;font-weight:bold">Get my live keys</a></p>
<p style="font-size:13px;color:#5d5873">This link works once and expires in 24 hours. The page it opens shows your live keys one time, so keep them somewhere safe.<br>The secret key stays on your server only. If you did not ask for live access, reply to this email.</p>
</body></html>`;
  return { html, text };
}

type Outcome = 'done' | 'retry' | 'drop';

async function issueLiveKeys(env: Env, id: string): Promise<Outcome> {
  const raw = await env.ORDER_STORE.get(`partner:${id}`);
  const partner = raw ? (JSON.parse(raw) as Partner) : null;
  if (!partner) {
    console.error(`[live-keys] ${id}: no such partner, dropped`);
    return 'drop';
  }
  if (!partner.contactEmail) {
    console.error(`[live-keys] ${id}: no contact email, dropped (use approve-live --print)`);
    return 'drop';
  }
  const indexRaw = await env.ORDER_STORE.get(`partnerkeys:${id}`);
  const index: Record<string, string> = indexRaw ? (JSON.parse(indexRaw) as Record<string, string>) : {};
  if (index.pk_live || index.sk_live) {
    console.error(`[live-keys] ${id}: already has live keys, dropped`);
    return 'drop';
  }

  const publishableKey = `gc_pk_live_${randomString(40)}`;
  const secretKey = `gc_sk_live_${randomString(40)}`;
  const token = randomString(40);
  const tokenHash = await sha256Hex(token);
  const reveal: Reveal = { partnerId: id, name: partner.name, allowedOrigins: partner.allowedOrigins, publishableKey, secretKey };

  let enc: string;
  try {
    enc = await encryptSecret(env, JSON.stringify(reveal));
  } catch (e) {
    console.error(`[live-keys] ${id}: cannot encrypt (PARTNER_SECRETS_KEY missing?)`);
    return 'retry';
  }

  const pkHash = await sha256Hex(publishableKey);
  const skHash = await sha256Hex(secretKey);
  const now = Date.now();
  const rec = (kind: 'pk' | 'sk'): KeyRecord => ({ partnerId: id, kind, mode: 'live', createdAt: now });
  await env.ORDER_STORE.put(`livereveal:${tokenHash}`, enc, { expirationTtl: REVEAL_TTL_SECONDS });
  await env.ORDER_STORE.put(`key:${pkHash}`, JSON.stringify(rec('pk')));
  await env.ORDER_STORE.put(`key:${skHash}`, JSON.stringify(rec('sk')));
  await env.ORDER_STORE.put(`partnerkeys:${id}`, JSON.stringify({ ...index, pk_live: pkHash, sk_live: skHash }));

  const origin = widgetOrigins(env)[0];
  const link = `${origin}/docs/get-live-keys/confirm/#${token}`;
  const mail = linkEmail(link, partner.name);
  if (!(await sendEmail(env, partner.contactEmail, 'Your GoodCash live keys are ready', mail.html, mail.text))) {
    // Take the new keys back out so nothing live exists that nobody can reach
    await env.ORDER_STORE.delete(`key:${pkHash}`);
    await env.ORDER_STORE.delete(`key:${skHash}`);
    await env.ORDER_STORE.put(`partnerkeys:${id}`, JSON.stringify(index));
    await env.ORDER_STORE.delete(`livereveal:${tokenHash}`);
    console.error(`[live-keys] ${id}: email not sent, will retry`);
    return 'retry';
  }

  await env.ORDER_STORE.put(`partner:${id}`, JSON.stringify({ ...partner, liveApprovedAt: now } satisfies Partner));
  if (env.SUPPORT_INBOX) {
    const text = `Live keys for ${partner.name} (${id}) were emailed as a one-time link to ${partner.contactEmail}. Nothing for you to send.`;
    await sendEmail(env, env.SUPPORT_INBOX, `Live keys sent: ${partner.name}`, `<p>${text.replace(/[&<>]/g, '')}</p>`, text);
  }
  return 'done';
}

/** Called on the schedule: handles everything approve-live has queued. One KV read when nothing is waiting. */
export async function processLiveApprovals(env: Env): Promise<{ issued: number; waiting: number }> {
  const snapshotRaw = await env.ORDER_STORE.get(LIVE_QUEUE_KEY);
  const snapshot = parseQueue(snapshotRaw);
  if (snapshot.length === 0) return { issued: 0, waiting: 0 };

  const remaining: QueueEntry[] = [];
  let issued = 0;
  for (const entry of snapshot) {
    let outcome: Outcome;
    try {
      outcome = await issueLiveKeys(env, entry.id);
    } catch (e) {
      console.error(`[live-keys] ${entry.id} failed:`, (e as Error)?.message ?? e);
      outcome = 'retry';
    }
    if (outcome === 'done') issued++;
    else if (outcome === 'retry') {
      if (entry.tries + 1 >= MAX_TRIES) console.error(`[live-keys] ${entry.id}: gave up after ${MAX_TRIES} tries`);
      else remaining.push({ ...entry, tries: entry.tries + 1 });
    }
  }

  // Keep anything approve-live added while this run was working
  const seen = new Set(snapshot.map((e) => e.id));
  const added = parseQueue(await env.ORDER_STORE.get(LIVE_QUEUE_KEY)).filter((e) => !seen.has(e.id));
  const next = [...remaining, ...added];
  if (next.length === 0) await env.ORDER_STORE.delete(LIVE_QUEUE_KEY);
  else await env.ORDER_STORE.put(LIVE_QUEUE_KEY, JSON.stringify(next));
  return { issued, waiting: next.length };
}

/** POST /v1/live-keys/confirm: the emailed link's page. Returns the live keys once. */
export async function handleLiveKeys(request: Request, env: Env, deps: V1Deps): Promise<Response> {
  if (request.method !== 'POST') throw new V1Error('invalid_request', 'Use POST.');
  const origin = requireDocsSite(request, env);
  await ipLimited(request, env, deps, 'live-keys-confirm');
  const body = await readJson(request);
  const token = typeof body.token === 'string' ? body.token : '';
  if (!/^[A-Za-z0-9]{40}$/.test(token)) throw new V1Error('invalid_request', 'This link is not valid. Please contact GoodCash for a new one.');

  const key = `livereveal:${await sha256Hex(token)}`;
  const enc = await env.ORDER_STORE.get(key);
  if (!enc) throw new V1Error('invalid_request', 'This link has expired or was already used. Please contact GoodCash for new live keys.');
  // Used once: forget it before showing anything
  await env.ORDER_STORE.delete(key);

  let reveal: Reveal;
  try {
    reveal = JSON.parse(await decryptSecret(env, enc)) as Reveal;
  } catch {
    throw new V1Error('unavailable');
  }
  return v1Json(
    {
      partnerId: reveal.partnerId,
      name: reveal.name,
      mode: 'live',
      publishableKey: reveal.publishableKey,
      secretKey: reveal.secretKey,
      allowedOrigins: reveal.allowedOrigins,
      note: 'Shown once. These live keys move real money. The secret key stays on your server only.',
    },
    200,
    { 'Access-Control-Allow-Origin': origin },
  );
}
