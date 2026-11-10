/**
 * Self-serve TEST keys for partners.
 *
 *   POST /v1/signup          { name, email, origins }  -> emails a one-hour confirmation link (nothing is created yet)
 *   POST /v1/signup/confirm  { token }                 -> creates the partner and returns its TEST keys, once
 *   POST /v1/live-access     (secret test key)         -> asks GoodCash to approve live keys (a person does that)
 *
 * Only test keys are ever issued here, and test mode moves no money. Live keys stay a manual step (scripts/partners.mjs
 * approve-live). Because the sign-up form is public, it is protected by: an email confirmation, a per-address rate
 * limit, one request per email per day, a daily cap on new sign-ups, and an allowed-origin check. It is off unless
 * PARTNER_SIGNUP_ENABLED is "true". Nothing here ever stores a key (only its SHA-256) or a bank detail.
 */
import { sha256Hex, widgetOrigins } from './auth';
import { V1Error, v1Json } from './http';
import type { AuthContext, Env, KeyRecord, Partner, V1Deps } from './types';

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
const CONFIRM_TTL_SECONDS = 3600;
const DEFAULT_DAILY_CAP = 20;
const MAX_ORIGINS = 5;
const EMAIL_RE = /^[^\s@<>"]{1,64}@[^\s@<>"]{1,190}\.[^\s@<>"]{2,24}$/;

export function randomString(n: number): string {
  let out = '';
  while (out.length < n) {
    for (const b of crypto.getRandomValues(new Uint8Array(n * 2))) {
      if (b < 248 && out.length < n) out += ALPHABET[b % 62];
    }
  }
  return out;
}

const unavailable = (message: string) => new V1Error('unavailable', undefined, message);

export function isSignupPath(pathname: string): boolean {
  const p = pathname.replace(/\/+$/, '');
  return p === '/v1/signup' || p === '/v1/signup/confirm';
}

/** Allowed web addresses must be exact origins: https (or http://localhost for development), no path. */
export function checkOrigins(list: unknown): string[] {
  if (!Array.isArray(list) || list.length === 0 || list.length > MAX_ORIGINS) {
    throw new V1Error('invalid_request', `Give between 1 and ${MAX_ORIGINS} website addresses you will test from.`);
  }
  const out: string[] = [];
  for (const raw of list) {
    let u: URL;
    try {
      u = new URL(String(raw).trim());
    } catch {
      throw new V1Error('invalid_request', `Not a web address: ${String(raw).slice(0, 80)}`);
    }
    const origin = String(raw).trim();
    if (u.origin !== origin) throw new V1Error('invalid_request', `Use just the address, like ${u.origin} (no path, no slash at the end).`);
    if (u.protocol !== 'https:' && !(u.protocol === 'http:' && u.hostname === 'localhost')) {
      throw new V1Error('invalid_request', 'Addresses must start with https:// (or http://localhost for development).');
    }
    if (!out.includes(origin)) out.push(origin);
  }
  return out;
}

function cleanName(v: unknown): string {
  const name = typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f<>]/g, ' ').replace(/\s+/g, ' ').trim() : '';
  if (name.length < 2 || name.length > 60) throw new V1Error('invalid_request', 'Your app or company name must be 2 to 60 characters.');
  return name;
}

function cleanEmail(v: unknown): string {
  const email = typeof v === 'string' ? v.trim().toLowerCase() : '';
  if (!EMAIL_RE.test(email)) throw new V1Error('invalid_request', 'Please enter a valid email address.');
  return email;
}

function dailyCap(env: Env): number {
  const n = Number(env.PARTNER_SIGNUP_DAILY_CAP);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : DEFAULT_DAILY_CAP;
}

/** Only the GoodCash widget site (the docs page) may call these endpoints from a browser. */
export function requireDocsSite(request: Request, env: Env): string {
  const origin = request.headers.get('Origin');
  if (!origin || !widgetOrigins(env).includes(origin)) {
    throw new V1Error('forbidden_origin', 'Get test keys from https://pay.goodcash.xyz/docs/get-test-keys/');
  }
  return origin;
}

export async function readJson(request: Request): Promise<Record<string, unknown>> {
  try {
    const body = (await request.json()) as unknown;
    if (body && typeof body === 'object' && !Array.isArray(body)) return body as Record<string, unknown>;
  } catch {
    // fall through
  }
  throw new V1Error('invalid_request', 'The body must be JSON.');
}

export async function ipLimited(request: Request, env: Env, deps: V1Deps, name: string): Promise<void> {
  const limiter = env.RATE_LIMITER_STRICT;
  if (!limiter) return;
  try {
    const { success } = await limiter.limit({ key: `${name}:${deps.clientIp(request)}` });
    if (!success) throw new V1Error('rate_limited');
  } catch (e) {
    if (e instanceof V1Error) throw e; // never block people because the limiter itself failed
  }
}

function confirmationEmail(link: string, name: string): { html: string; text: string } {
  const safeName = name.replace(/[&<>"]/g, '');
  const text = [
    `Confirm your email to get GoodCash test keys for "${name}".`,
    '',
    link,
    '',
    'This link works once and expires in one hour. The page it opens shows your keys one time, so keep them somewhere safe.',
    'Test keys never move real money. If you did not ask for this, ignore this email and nothing is created.',
  ].join('\n');
  const html = `<!doctype html><html><body style="font-family:Arial,Helvetica,sans-serif;color:#14111f;line-height:1.5">
<p>Confirm your email to get GoodCash test keys for <b>${safeName}</b>.</p>
<p><a href="${link}" style="display:inline-block;background:#7b39fc;color:#fff;padding:12px 18px;border-radius:10px;text-decoration:none;font-weight:bold">Get my test keys</a></p>
<p style="font-size:13px;color:#5d5873">This link works once and expires in one hour. The page it opens shows your keys one time, so keep them somewhere safe.<br>Test keys never move real money. If you did not ask for this, ignore this email and nothing is created.</p>
</body></html>`;
  return { html, text };
}

export async function sendEmail(env: Env, to: string, subject: string, html: string, text: string): Promise<boolean> {
  if (!env.RESEND_API_KEY) return false;
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: env.RESEND_FROM || 'GoodCash <onboarding@resend.dev>', to: [to], subject, html, text }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

interface Pending {
  name: string;
  email: string;
  origins: string[];
  createdAt: number;
}

/** POST /v1/signup */
async function requestSignup(request: Request, env: Env, deps: V1Deps): Promise<{ origin: string; body: unknown }> {
  const origin = requireDocsSite(request, env);
  await ipLimited(request, env, deps, 'signup');
  const body = await readJson(request);
  const name = cleanName(body.name);
  const email = cleanEmail(body.email);
  const origins = checkOrigins(body.origins);

  // The same answer whether or not this email was seen before, so the form cannot be used to find out who signed up
  const accepted = { origin, body: { status: 'check_your_email' } };
  const emailKey = `signup:email:${await sha256Hex(email)}`;
  if (await env.ORDER_STORE.get(emailKey)) return accepted;

  const day = new Date().toISOString().slice(0, 10);
  const dayKey = `signup:day:${day}`;
  const used = Number((await env.ORDER_STORE.get(dayKey)) ?? '0') || 0;
  if (used >= dailyCap(env)) throw unavailable('Sign-ups are full for today. Please try again tomorrow.');

  const token = randomString(40);
  const pending: Pending = { name, email, origins, createdAt: Date.now() };
  await env.ORDER_STORE.put(`signup:${await sha256Hex(token)}`, JSON.stringify(pending), { expirationTtl: CONFIRM_TTL_SECONDS });
  const link = `${origin}/docs/get-test-keys/confirm/#${token}`;
  const mail = confirmationEmail(link, name);
  if (!(await sendEmail(env, email, 'Confirm your email for GoodCash test keys', mail.html, mail.text))) {
    await env.ORDER_STORE.delete(`signup:${await sha256Hex(token)}`);
    throw unavailable('We could not send the email right now. Please try again in a few minutes.');
  }
  await env.ORDER_STORE.put(emailKey, '1', { expirationTtl: 86400 });
  await env.ORDER_STORE.put(dayKey, String(used + 1), { expirationTtl: 172800 });
  return accepted;
}

/** POST /v1/signup/confirm */
async function confirmSignup(request: Request, env: Env, deps: V1Deps): Promise<{ origin: string; body: unknown }> {
  const origin = requireDocsSite(request, env);
  await ipLimited(request, env, deps, 'signup-confirm');
  const body = await readJson(request);
  const token = typeof body.token === 'string' ? body.token : '';
  if (!/^[A-Za-z0-9]{40}$/.test(token)) throw new V1Error('invalid_request', 'This link is not valid. Please ask for new test keys.');

  const pendingKey = `signup:${await sha256Hex(token)}`;
  const raw = await env.ORDER_STORE.get(pendingKey);
  let pending: Pending | null = null;
  try {
    pending = raw ? (JSON.parse(raw) as Pending) : null;
  } catch {
    pending = null;
  }
  if (!pending || Date.now() - pending.createdAt > CONFIRM_TTL_SECONDS * 1000) {
    throw new V1Error('invalid_request', 'This link has expired or was already used. Please ask for new test keys.');
  }
  // Used once: forget it before anything is created, so a second tap can never make a second partner
  await env.ORDER_STORE.delete(pendingKey);

  const id = `p_${randomString(12)}`;
  const partner: Partner = {
    id,
    name: pending.name,
    enabled: true,
    allowedOrigins: pending.origins,
    appIds: [],
    feePercent: 0,
    contactEmail: pending.email,
    selfServe: true,
    createdAt: Date.now(),
  };
  const publishableKey = `gc_pk_test_${randomString(40)}`;
  const secretKey = `gc_sk_test_${randomString(40)}`;
  const index: Record<string, string> = {};
  const issue = async (key: string, kind: 'pk' | 'sk') => {
    const hash = await sha256Hex(key);
    const rec: KeyRecord = { partnerId: id, kind, mode: 'test', createdAt: Date.now() };
    await env.ORDER_STORE.put(`key:${hash}`, JSON.stringify(rec));
    index[`${kind}_test`] = hash;
  };
  await env.ORDER_STORE.put(`partner:${id}`, JSON.stringify(partner));
  await issue(publishableKey, 'pk');
  await issue(secretKey, 'sk');
  await env.ORDER_STORE.put(`partnerkeys:${id}`, JSON.stringify(index));

  return {
    origin,
    body: {
      partnerId: id,
      name: partner.name,
      mode: 'test',
      publishableKey,
      secretKey,
      allowedOrigins: partner.allowedOrigins,
      note: 'Shown once. Test keys never move real money. Ask for live access from your dashboard page or with POST /v1/live-access.',
    },
  };
}

/** Handles the two public sign-up routes (no key needed). Returns the response with CORS for the docs site only. */
export async function handleSignup(request: Request, env: Env, deps: V1Deps): Promise<Response> {
  if (env.PARTNER_SIGNUP_ENABLED !== 'true') throw new V1Error('not_found', undefined, 'Not found');
  if (request.method !== 'POST') throw new V1Error('invalid_request', 'Use POST.');
  const path = new URL(request.url).pathname.replace(/\/+$/, '');
  const out = path === '/v1/signup/confirm' ? await confirmSignup(request, env, deps) : await requestSignup(request, env, deps);
  return v1Json(out.body, 200, { 'Access-Control-Allow-Origin': out.origin });
}

/** POST /v1/live-access: a self-serve partner asks for live keys. A person at GoodCash approves them. */
export async function requestLiveAccess(env: Env, ctx: AuthContext): Promise<Response> {
  const p = ctx.partner;
  if (ctx.mode !== 'test') throw new V1Error('test_mode_only', 'Ask for live access with your test secret key.');
  if (!p.selfServe) throw new V1Error('invalid_request', 'Your account was set up by GoodCash. Contact us for live keys.');
  const last = p.liveRequestedAt ?? 0;
  if (Date.now() - last < 86_400_000) return v1Json({ status: 'already_requested', requestedAt: last });
  const updated: Partner = { ...p, liveRequestedAt: Date.now() };
  await env.ORDER_STORE.put(`partner:${p.id}`, JSON.stringify(updated));
  const inbox = env.SUPPORT_INBOX;
  if (inbox) {
    const text = [
      `${p.name} (${p.id}) asked for LIVE keys.`,
      '',
      `Contact: ${p.contactEmail ?? '-'}`,
      `Sites: ${p.allowedOrigins.join(', ') || '-'}`,
      '',
      `To approve: node scripts/partners.mjs approve-live ${p.id}`,
    ].join('\n');
    await sendEmail(env, inbox, `Live access requested: ${p.name}`, `<pre>${text.replace(/[&<>]/g, '')}</pre>`, text);
  }
  return v1Json({ status: 'requested', message: 'Thanks. GoodCash will review this and contact you by email.' });
}
