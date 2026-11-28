/**
 * Only GoodDollar-verified people may add G$ with naira or cash out.
 *
 * "Verified" is read from GoodDollar's own Identity contract on Celo: getWhitelistedRoot(wallet) is not the zero
 * address when the wallet belongs to a verified person (a wallet connected to a verified person counts). This is
 * the same check the referral payouts and the voting screen use.
 *
 * The check runs on the server, at the moment an order is created and before any money moves, so a changed app or
 * a direct call cannot skip it. A "yes" is remembered for 10 minutes at the edge (no storage writes); a "no" is
 * never remembered, so someone who has just verified can go straight on. If the chain cannot be read the answer
 * is "try again", never "yes": a money step is not allowed to guess.
 *
 * REQUIRE_VERIFIED=true switches the rule on. Anything else leaves it off (how the tests and local development
 * run), and setting it to anything but "true" in production is the quick way to switch it off again.
 */

export const GOODDOLLAR_IDENTITY = '0xC361A6E67822a0EDc17D899227dd9FC50BD62F42';
export const VERIFY_URL = 'https://wallet.gooddollar.org';
const GET_WHITELISTED_ROOT = '0x2d0e9b46'; // getWhitelistedRoot(address)
const IDENTITIES = '0xf653b81e'; // identities(address)
const ZERO = '0x' + '0'.repeat(40);
const YES_CACHE_SECONDS = 600;
const RPC_FALLBACK = 'https://forno.celo.org';

export interface VerifiedEnv {
  REQUIRE_VERIFIED?: string;
  CELO_RPC_URL?: string;
}

export const verificationRequired = (env: VerifiedEnv) => env.REQUIRE_VERIFIED === 'true';

export const NOT_VERIFIED_MESSAGE = 'Please verify with GoodDollar first. It is quick, free, and only needs to be done once.';
export const CHECK_FAILED_MESSAGE = 'We could not check your GoodDollar verification right now. Nothing was sent. Please try again in a moment.';

/** true = verified, false = not verified, null = could not tell */
export async function isVerified(env: VerifiedEnv, wallet: string): Promise<boolean | null> {
  const address = wallet.toLowerCase();
  if (!/^0x[0-9a-f]{40}$/.test(address)) return false;
  const edge = typeof caches !== 'undefined' ? (caches as unknown as { default?: Cache }).default : undefined;
  const cacheKey = new Request(`https://cache.goodcash.invalid/verified/${address}`);
  if (await edge?.match(cacheKey).catch(() => undefined)) return true;
  try {
    const res = await fetch(env.CELO_RPC_URL || RPC_FALLBACK, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_call', params: [{ to: GOODDOLLAR_IDENTITY, data: `${GET_WHITELISTED_ROOT}${'0'.repeat(24)}${address.slice(2)}` }, 'latest'] }),
    });
    const body = (await res.json().catch(() => ({}))) as { result?: unknown; error?: unknown };
    if (!res.ok || body.error || typeof body.result !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(body.result)) return null;
    const verified = `0x${body.result.slice(-40).toLowerCase()}` !== ZERO;
    if (verified) await edge?.put(cacheKey, new Response('1', { headers: { 'Cache-Control': `public, max-age=${YES_CACHE_SECONDS}` } })).catch(() => undefined);
    return verified;
  } catch {
    return null;
  }
}

const reply = (status: number, error: string, code: string) =>
  new Response(JSON.stringify({ error, code, ...(code === 'not_verified' ? { verifyUrl: VERIFY_URL } : {}) }), { status, headers: { 'Content-Type': 'application/json' } });

/** null = go ahead. Otherwise the response to send instead of creating anything. */
export async function verifiedGate(env: VerifiedEnv, wallet: string): Promise<Response | null> {
  if (!verificationRequired(env)) return null;
  const v = await isVerified(env, wallet);
  if (v === true) return null;
  return v === false ? reply(403, NOT_VERIFIED_MESSAGE, 'not_verified') : reply(503, CHECK_FAILED_MESSAGE, 'verification_unavailable');
}

/** GET /verified?wallet=0x... for the app's pre-check (read-only). */
export async function handleVerified(env: VerifiedEnv, wallet: string): Promise<Response> {
  const headers = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };
  if (!/^0x[0-9a-fA-F]{40}$/.test(wallet)) return new Response(JSON.stringify({ error: 'Invalid wallet address' }), { status: 400, headers });
  const v = await isVerified(env, wallet);
  if (v === null) return new Response(JSON.stringify({ error: CHECK_FAILED_MESSAGE, code: 'verification_unavailable' }), { status: 503, headers });
  return new Response(JSON.stringify({ required: verificationRequired(env), verified: v, verifyUrl: VERIFY_URL }), { status: 200, headers });
}

const BATCH = 100;
const MAX_BATCHES = 5;

/**
 * GoodDollar identity ("root") of many wallets at once, in as few requests as possible. A wallet GoodDollar has not
 * verified maps to the zero address. Returns null if any part could not be read, so a count built from it is left
 * out rather than shown wrong. More than BATCH * MAX_BATCHES wallets is not attempted.
 */
/** One eth_call per wallet to GoodDollar's Identity contract, in batches; null when any answer is missing or bad. */
async function callEach(env: VerifiedEnv, wallets: string[], selector: string, minLength: number): Promise<Map<string, string> | null> {
  const list = [...new Set(wallets.map((w) => w.toLowerCase()).filter((w) => /^0x[0-9a-f]{40}$/.test(w)))];
  if (list.length > BATCH * MAX_BATCHES) return null;
  const out = new Map<string, string>();
  try {
    for (let i = 0; i < list.length; i += BATCH) {
      const chunk = list.slice(i, i + BATCH);
      const res = await fetch(env.CELO_RPC_URL || RPC_FALLBACK, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(chunk.map((w, n) => ({ jsonrpc: '2.0', id: n, method: 'eth_call', params: [{ to: GOODDOLLAR_IDENTITY, data: `${selector}${'0'.repeat(24)}${w.slice(2)}` }, 'latest'] }))),
      });
      const body = (await res.json().catch(() => null)) as Array<{ id: number; result?: unknown; error?: unknown }> | null;
      if (!res.ok || !Array.isArray(body) || body.length !== chunk.length) return null;
      for (const r of body) {
        if (r.error || typeof r.result !== 'string' || !/^0x[0-9a-fA-F]*$/.test(r.result) || r.result.length < 2 + minLength * 64 || !chunk[r.id]) return null;
        out.set(chunk[r.id], r.result);
      }
    }
  } catch {
    return null;
  }
  return out;
}

export async function rootsOf(env: VerifiedEnv, wallets: string[]): Promise<Map<string, string> | null> {
  const raw = await callEach(env, wallets, GET_WHITELISTED_ROOT, 1);
  if (!raw) return null;
  return new Map([...raw].map(([w, r]) => [w, `0x${r.slice(2, 66).slice(-40).toLowerCase()}`]));
}

/**
 * Whether GoodDollar has ever verified each wallet itself: identities(wallet).status is 1 for a verified person even
 * after their verification runs out (a first verification lasts only 3 days, later ones 180), and 255 when GoodDollar
 * blacklisted them. Returns true for status 1 only.
 */
export async function everVerifiedOf(env: VerifiedEnv, wallets: string[]): Promise<Map<string, boolean> | null> {
  const raw = await callEach(env, wallets, IDENTITIES, 6);
  if (!raw) return null;
  // identities() returns dateAuthenticated, dateAdded, did (offset), whitelistedOnChainId, status, authCount, ...
  return new Map([...raw].map(([w, r]) => [w, BigInt(`0x${r.slice(2 + 4 * 64, 2 + 5 * 64)}`) === 1n]));
}

export const isZero = (root: string) => root === ZERO;
