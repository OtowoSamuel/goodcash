/**
 * Partner keys. A key looks like gc_pk_live_<random> / gc_sk_test_<random>. Only its SHA-256 is stored
 * (`key:<hash>` -> KeyRecord), so a leaked database never leaks keys.
 */
import { V1Error } from './http';
import type { AuthContext, Env, KeyRecord, Partner } from './types';

const KEY_RE = /^gc_(pk|sk)_(live|test)_[A-Za-z0-9]{24,64}$/;
export const DEFAULT_WIDGET_ORIGIN = 'https://pay.goodcash.xyz';

export async function sha256Hex(text: string): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(d), (b) => b.toString(16).padStart(2, '0')).join('');
}

export function widgetOrigins(env: Env): string[] {
  return (env.WIDGET_ORIGINS ?? DEFAULT_WIDGET_ORIGIN).split(',').map((s) => s.trim()).filter(Boolean);
}

export async function loadPartner(env: Env, id: string): Promise<Partner | null> {
  const raw = await env.ORDER_STORE.get(`partner:${id}`);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Partner;
  } catch {
    return null;
  }
}

/** Who is calling, and may they? Throws V1Error with a developer detail when not. */
export async function authenticate(request: Request, env: Env): Promise<AuthContext> {
  const header = request.headers.get('Authorization') ?? '';
  const key = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  const m = KEY_RE.exec(key);
  if (!m) throw new V1Error('unauthorized', 'Send your key as "Authorization: Bearer gc_pk_..." (or gc_sk_... from a server).');
  const kind = m[1] as 'pk' | 'sk';
  const mode = m[2] as 'live' | 'test';

  const raw = await env.ORDER_STORE.get(`key:${await sha256Hex(key)}`);
  let rec: KeyRecord | null = null;
  try {
    rec = raw ? (JSON.parse(raw) as KeyRecord) : null;
  } catch {
    rec = null;
  }
  if (!rec || rec.kind !== kind || rec.mode !== mode) throw new V1Error('unauthorized', 'That key is not recognised. It may have been rotated.');

  const partner = await loadPartner(env, rec.partnerId);
  if (!partner) throw new V1Error('unauthorized', 'That key is not recognised.');
  if (!partner.enabled) throw new V1Error('partner_disabled', 'This partner account is switched off. Contact GoodCash.');

  const origin = request.headers.get('Origin');
  if (kind === 'sk') {
    // A secret key must never be in a browser. Browsers always send Origin on cross-site requests.
    if (origin) throw new V1Error('secret_key_in_browser', 'Secret keys work only from your server. Use your publishable key (gc_pk_...) in browsers and apps.');
    return { partner, kind, mode, corsOrigin: null };
  }

  if (origin) {
    if (partner.allowedOrigins.includes(origin) || widgetOrigins(env).includes(origin)) return { partner, kind, mode, corsOrigin: origin };
    throw new V1Error('forbidden_origin', `The site ${origin} is not on this key's allowed list. Ask GoodCash to add it.`);
  }
  const app = request.headers.get('X-GoodCash-App');
  if (app && partner.appIds.includes(app)) return { partner, kind, mode, corsOrigin: null };
  throw new V1Error('forbidden_origin', 'Publishable keys need a browser Origin on the allowed list, or an X-GoodCash-App header with a registered app id.');
}

export function requireSecret(ctx: AuthContext): void {
  if (ctx.kind !== 'sk') throw new V1Error('secret_key_required', 'This needs your secret key (gc_sk_...), from your server.');
}
