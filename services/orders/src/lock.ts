/**
 * A lock that only one caller can hold at a time, per name.
 *
 * Why this exists: our key-value store has no "claim this if nobody has" step. Two requests that arrive at the same
 * moment both read "free" before either writes, so both go on. A Durable Object handles one request at a time per
 * name, and its storage calls are ordered, so exactly one caller gets the claim.
 *
 * Used for: a partner's Idempotency-Key while its cash out is being set up, and one order's conversion while the
 * attempt is being reserved. Each name is its own tiny object; it keeps one record and expires it by time, so a
 * caller that dies cannot block the name for ever.
 */

interface Holder {
  token: string;
  until: number;
}

export class KeyLock {
  private state: DurableObjectState;

  constructor(state: DurableObjectState) {
    this.state = state;
  }

  async fetch(request: Request): Promise<Response> {
    const path = new URL(request.url).pathname;
    let body: { token?: string; ttlMs?: number } = {};
    try {
      body = (await request.json()) as typeof body;
    } catch {
      return Response.json({ ok: false, error: 'bad body' }, { status: 400 });
    }
    if (typeof body.token !== 'string' || body.token.length < 8) return Response.json({ ok: false, error: 'bad token' }, { status: 400 });
    const now = Date.now();
    const current = await this.state.storage.get<Holder>('holder');
    if (path === '/claim') {
      if (current && current.until > now) return Response.json({ ok: false });
      const ttl = Math.min(Math.max(Number(body.ttlMs) || 10_000, 1_000), 120_000);
      await this.state.storage.put('holder', { token: body.token, until: now + ttl } satisfies Holder);
      return Response.json({ ok: true });
    }
    if (path === '/release') {
      // Only the holder can release: a late release from an expired holder must not free someone else's claim
      if (current && current.token === body.token) await this.state.storage.delete('holder');
      return Response.json({ ok: true });
    }
    return Response.json({ ok: false, error: 'not found' }, { status: 404 });
  }
}

export interface LockEnv {
  KEY_LOCK?: DurableObjectNamespace;
}

export type Claim = { ok: true; release: () => Promise<void> } | { ok: false };

/**
 * Claim a name for up to ttlMs. `ok: false` means someone else holds it right now.
 * Without the KEY_LOCK binding (local development and unit tests) there is nothing to lock with, so the claim always
 * succeeds and the callers' own checks are all that remain. If the lock service itself fails this THROWS: callers
 * stop and ask the customer to try again, instead of carrying on without the protection.
 */
export async function claimLock(env: LockEnv, name: string, ttlMs: number): Promise<Claim> {
  if (!env.KEY_LOCK) return { ok: true, release: async () => undefined };
  const stub = env.KEY_LOCK.get(env.KEY_LOCK.idFromName(name));
  const token = crypto.randomUUID();
  const res = await stub.fetch('https://lock/claim', { method: 'POST', body: JSON.stringify({ token, ttlMs }) });
  if (!res.ok) throw new Error(`lock service answered ${res.status}`);
  const out = (await res.json()) as { ok?: boolean };
  if (out.ok !== true) return { ok: false };
  return {
    ok: true,
    release: async () => {
      await stub.fetch('https://lock/release', { method: 'POST', body: JSON.stringify({ token }) }).catch(() => undefined);
    },
  };
}
