/**
 * Voting for GoodCash in the GoodBuilders council (Flow State), from inside the app.
 *
 * The vote itself is a transaction the customer signs in their own wallet and sends straight to the council contract
 * on Celo. This file covers the one step the browser cannot do: asking Flow State to register the customer's wallet as
 * a voter. Flow State's service refuses requests from other websites, so the app sends the customer's signed message
 * to us and we pass it on to that one fixed address. Flow State checks the signature, checks GoodDollar verification,
 * and gives the wallet its voting points. We never see a key, a password or an email, and we store nothing.
 */

export const VOTE_CHAIN_ID = 42220;
/** GoodBuilders Season 5 council (Flow State), Celo mainnet */
export const VOTE_COUNCIL = '0x889e0aadaa3f8b28a794ef70da147827c620a590';
/** The only place a registration is ever sent */
export const FLOWSTATE_ELIGIBILITY_URL = 'https://flowstate.network/api/flow-council/eligibility';

/** How old a signed message may be, and how far ahead of our clock (clocks differ a little). */
const MAX_AGE_MS = 5 * 60 * 1000;
const MAX_AHEAD_MS = 60 * 1000;
const FLOWSTATE_TIMEOUT_MS = 60_000;

/** The exact text the customer signs. It must match Flow State's own format character for character. */
export function buildClaimMessage(input: { chainId: number; councilId: string; address: string; issuedAt: number }): string {
  const issuedAtSecond = Math.floor(input.issuedAt / 1000) * 1000;
  const timestamp = new Date(issuedAtSecond).toISOString().replace(/\.\d{3}Z$/, 'Z');
  return [
    'Claim voting rights in this Flow Council.',
    '',
    `Council: ${input.councilId.toLowerCase()}`,
    `Chain: ${input.chainId}`,
    `Wallet: ${input.address.toLowerCase()}`,
    `Issued at: ${timestamp}`,
  ].join('\n');
}

export interface RegisterInput {
  address: string;
  issuedAt: number;
  signature: string;
}

/** The parts of the request we check before passing anything on. Returns null when it is not usable. */
export function parseRegisterBody(body: unknown, now = Date.now()): RegisterInput | null {
  const b = body as { address?: unknown; issuedAt?: unknown; signature?: unknown } | null;
  if (!b || typeof b.address !== 'string' || !/^0x[0-9a-fA-F]{40}$/.test(b.address)) return null;
  if (typeof b.issuedAt !== 'number' || !Number.isFinite(b.issuedAt)) return null;
  if (now - b.issuedAt > MAX_AGE_MS || b.issuedAt - now > MAX_AHEAD_MS) return null;
  // A normal wallet signature is 65 bytes. A smart-contract wallet can send a longer one; Flow State judges those.
  if (typeof b.signature !== 'string' || !/^0x[0-9a-fA-F]{130,4000}$/.test(b.signature) || b.signature.length % 2 !== 0) return null;
  return { address: b.address, issuedAt: b.issuedAt, signature: b.signature };
}

export type RegisterResult =
  | { ok: true }
  | { ok: false; reason: 'not_verified' | 'other_wallet' | 'busy' | 'error' };

/** Pass the signed message to Flow State and say, in our own words, what it answered. */
export async function registerWithFlowState(input: RegisterInput, fetchImpl: typeof fetch = fetch): Promise<RegisterResult> {
  let res: Response;
  try {
    res = await fetchImpl(FLOWSTATE_ELIGIBILITY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // Chain and council are fixed here, never taken from the customer
      body: JSON.stringify({ address: input.address, chainId: VOTE_CHAIN_ID, councilId: VOTE_COUNCIL, signature: input.signature, issuedAt: input.issuedAt }),
      signal: AbortSignal.timeout(FLOWSTATE_TIMEOUT_MS),
    });
  } catch (e) {
    console.error('[vote] Flow State not reachable:', (e as Error)?.name);
    return { ok: false, reason: 'error' };
  }
  if (res.status === 429 || res.status === 409) return { ok: false, reason: 'busy' };
  let data: { success?: boolean; notWhitelisted?: boolean; alreadyClaimed?: boolean; error?: string } = {};
  try {
    data = (await res.json()) as typeof data;
  } catch {
    // an unreadable answer is treated as a failure below
  }
  if (data.success === true) return { ok: true };
  if (data.notWhitelisted === true) return { ok: false, reason: 'not_verified' };
  if (data.alreadyClaimed === true) return { ok: false, reason: 'other_wallet' };
  // Only the kind of failure is logged, never the wallet or the signature
  console.error(`[vote] Flow State refused: ${res.status} ${String(data.error ?? 'no reason').slice(0, 80)}`);
  return { ok: false, reason: 'error' };
}
