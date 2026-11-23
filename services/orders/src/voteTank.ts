/**
 * The vote gas tank: a small wallet owned by GoodCash that gives a GoodDollar-verified person just enough CELO to pay
 * the network fee for their one vote for GoodCash. The vote itself stays a normal transaction from the person's own
 * wallet; the tank only tops the wallet up.
 *
 * Why it is hard to drain:
 *  - the person signs a plain message in their own wallet, so nobody can ask for a top-up on someone else's behalf;
 *  - the wallet must be verified with GoodDollar, read from GoodDollar's Identity contract on Celo;
 *  - one top-up per PERSON (the verified main wallet), so connected wallets cannot collect it again;
 *  - a wallet that already has enough CELO gets nothing;
 *  - a fixed top-up size, a daily cap on top-ups, and the tank stops before it empties;
 *  - one send at a time (a lock), so two requests never use the same transaction number.
 *
 * The tank's private key is the Worker secret VOTE_TANK_KEY. Put only a small amount in that wallet. It is never
 * logged, never returned, and never written to storage. VOTE_TANK_ENABLED must be "true" for any of this to run.
 */
import { createWalletClient, http, recoverMessageAddress, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { celo } from 'viem/chains';
import { claimLock } from './lock';
import { GOODDOLLAR_IDENTITY } from './verified';
import { buildClaimMessage, VOTE_CHAIN_ID, VOTE_COUNCIL, type RegisterInput } from './vote';

const RPC_FALLBACK = 'https://forno.celo.org';
const GET_WHITELISTED_ROOT = '0x2d0e9b46'; // getWhitelistedRoot(address)
const ZERO = '0x' + '0'.repeat(40);
const WEI = 10n ** 18n;

/** A wallet is topped up to this much CELO (enough for the vote with room for the fee price to move) */
export const DEFAULT_TARGET_CELO = '0.1';
/** Smallest top-up worth sending */
const MIN_TOPUP_WEI = WEI / 100n; // 0.01 CELO
export const DEFAULT_DAILY_CAP = 30;
/** The tank keeps at least this much, so it can always pay for its own sends */
export const DEFAULT_RESERVE_CELO = '0.3';
const DAY_SECONDS = 2 * 24 * 60 * 60;

export interface TankEnv {
  ORDER_STORE: KVNamespace;
  KEY_LOCK?: DurableObjectNamespace;
  CELO_RPC_URL?: string;
  VOTE_TANK_ENABLED?: string;
  VOTE_TANK_KEY?: string; // Secret: the tank wallet's private key (0x + 64 hex)
  VOTE_TANK_CELO?: string; // Top-up size in CELO (default 0.1)
  VOTE_TANK_DAILY_CAP?: string; // Top-ups per day (default 30)
  VOTE_TANK_RESERVE_CELO?: string; // The tank never goes below this (default 0.3)
}

export type TankResult =
  | { ok: true; status: 'sent'; hash: string; amountCelo: number }
  | { ok: true; status: 'enough' }
  | { ok: false; reason: 'off' | 'bad_signature' | 'not_verified' | 'already' | 'empty' | 'busy' | 'error' };

/** The exact text the person signs. Plain words, no cost, no transaction. */
export function buildTankMessage(address: string, issuedAt: number): string {
  const issuedAtSecond = Math.floor(issuedAt / 1000) * 1000;
  const timestamp = new Date(issuedAtSecond).toISOString().replace(/\.\d{3}Z$/, 'Z');
  return ['Ask GoodCash for the small network fee needed to vote.', '', `Chain: ${VOTE_CHAIN_ID}`, `Wallet: ${address.toLowerCase()}`, `Issued at: ${timestamp}`].join('\n');
}

/** Money and chain access, so tests can stand in for the chain. */
export interface TankDeps {
  rpc: (method: string, params: unknown[]) => Promise<unknown>;
  /** The tank wallet's address and a way to send CELO from it. Throws when the send fails. */
  tank: { address: string; send: (to: string, wei: bigint) => Promise<string> };
  now: () => number;
}

export function liveDeps(env: TankEnv): TankDeps | null {
  const key = env.VOTE_TANK_KEY;
  if (!key || !/^0x[0-9a-fA-F]{64}$/.test(key)) return null;
  const url = env.CELO_RPC_URL || RPC_FALLBACK;
  const account = privateKeyToAccount(key as Hex);
  const client = createWalletClient({ account, chain: celo, transport: http(url) });
  return {
    rpc: async (method, params) => {
      const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
      const body = (await res.json()) as { result?: unknown; error?: unknown };
      if (!res.ok || body.error || body.result === undefined) throw new Error(`rpc ${method} failed`);
      return body.result;
    },
    tank: { address: account.address, send: (to, wei) => client.sendTransaction({ to: to as Hex, value: wei }) },
    now: () => Date.now(),
  };
}

const celoToWei = (v: string | undefined, fallback: string): bigint => {
  const n = Number(v ?? fallback);
  return BigInt(Math.round((Number.isFinite(n) && n > 0 ? n : Number(fallback)) * 1e6)) * (WEI / 1_000_000n);
};
const toCelo = (wei: bigint) => Number(wei / 10n ** 12n) / 1e6;

async function balanceOf(deps: TankDeps, address: string): Promise<bigint> {
  const r = await deps.rpc('eth_getBalance', [address, 'latest']);
  if (typeof r !== 'string' || !/^0x[0-9a-fA-F]+$/.test(r)) throw new Error('bad balance');
  return BigInt(r);
}

/** The verified person behind a wallet: their main wallet, or null when the wallet is not verified. Throws when unreadable. */
async function personOf(deps: TankDeps, wallet: string): Promise<string | null> {
  const r = await deps.rpc('eth_call', [{ to: GOODDOLLAR_IDENTITY, data: `${GET_WHITELISTED_ROOT}${'0'.repeat(24)}${wallet.slice(2).toLowerCase()}` }, 'latest']);
  if (typeof r !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(r)) throw new Error('bad identity answer');
  const root = `0x${r.slice(-40).toLowerCase()}`;
  return root === ZERO ? null : root;
}

/** Give a verified person's wallet the small network fee for their vote. */
/**
 * `kind` says which message the person signed: the one made for this request ('fee'), or the free message a first-time
 * voter has just signed to turn on voting ('claim'), which the app reuses so they sign once, not twice.
 */
export type TankInput = RegisterInput & { kind?: 'fee' | 'claim' };

export async function giveVoteFee(env: TankEnv, input: TankInput, deps: TankDeps | null = liveDeps(env)): Promise<TankResult> {
  if (env.VOTE_TANK_ENABLED !== 'true' || !deps) return { ok: false, reason: 'off' };

  // 1. Only the owner of the wallet can ask for its top-up (a normal 65-byte signature; smart wallets are not supported)
  if (!/^0x[0-9a-fA-F]{130}$/.test(input.signature)) return { ok: false, reason: 'bad_signature' };
  try {
    const message = input.kind === 'claim' ? buildClaimMessage({ chainId: VOTE_CHAIN_ID, councilId: VOTE_COUNCIL, address: input.address, issuedAt: input.issuedAt }) : buildTankMessage(input.address, input.issuedAt);
    const signer = await recoverMessageAddress({ message, signature: input.signature as Hex });
    if (signer.toLowerCase() !== input.address.toLowerCase()) return { ok: false, reason: 'bad_signature' };
  } catch {
    return { ok: false, reason: 'bad_signature' };
  }

  const wallet = input.address.toLowerCase();
  const target = celoToWei(env.VOTE_TANK_CELO, DEFAULT_TARGET_CELO);
  let person: string | null;
  let have: bigint;
  try {
    // 2. Verified with GoodDollar, and short of CELO
    person = await personOf(deps, wallet);
    if (!person) return { ok: false, reason: 'not_verified' };
    have = await balanceOf(deps, wallet);
  } catch (e) {
    console.error('[vote-tank] chain read failed:', (e as Error)?.message);
    return { ok: false, reason: 'error' };
  }
  if (have >= target) return { ok: true, status: 'enough' };
  const amount = target - have < MIN_TOPUP_WEI ? MIN_TOPUP_WEI : target - have;

  // 3. One send at a time: checks and the send happen under one lock, so the daily count and the transaction number are safe
  let lock;
  try {
    lock = await claimLock(env, 'vote-tank', 60_000);
  } catch {
    return { ok: false, reason: 'error' };
  }
  if (!lock.ok) return { ok: false, reason: 'busy' };
  const markerKey = `votetank:${person}`;
  let markerWritten = false;
  try {
    if (await env.ORDER_STORE.get(markerKey)) return { ok: false, reason: 'already' };

    const day = new Date(deps.now()).toISOString().slice(0, 10);
    const dayKey = `votetank:day:${day}`;
    const used = Number((await env.ORDER_STORE.get(dayKey)) ?? '0') || 0;
    const cap = Number(env.VOTE_TANK_DAILY_CAP ?? DEFAULT_DAILY_CAP);
    if (used >= (Number.isFinite(cap) && cap > 0 ? cap : DEFAULT_DAILY_CAP)) return { ok: false, reason: 'empty' };

    const reserve = celoToWei(env.VOTE_TANK_RESERVE_CELO, DEFAULT_RESERVE_CELO);
    if ((await balanceOf(deps, deps.tank.address)) < amount + reserve) {
      console.error('[vote-tank] tank is low: top-ups paused');
      return { ok: false, reason: 'empty' };
    }

    // Mark first, so a request that slips past cannot be paid twice; undone below if the send fails
    await env.ORDER_STORE.put(markerKey, JSON.stringify({ at: deps.now() }));
    markerWritten = true;
    const hash = await deps.tank.send(wallet, amount);
    await env.ORDER_STORE.put(markerKey, JSON.stringify({ at: deps.now(), hash }));
    await env.ORDER_STORE.put(dayKey, String(used + 1), { expirationTtl: DAY_SECONDS });
    return { ok: true, status: 'sent', hash, amountCelo: toCelo(amount) };
  } catch (e) {
    if (markerWritten) await env.ORDER_STORE.delete(markerKey).catch(() => undefined);
    // Only the kind of failure is logged, never a key, a wallet or a signature
    console.error('[vote-tank] send failed:', (e as Error)?.name);
    return { ok: false, reason: 'error' };
  } finally {
    await lock.release();
  }
}

/** The status a result should answer with: normal answers are 200, a fault is 502, busy is 503. */
export const tankStatus = (r: TankResult): number => (r.ok ? 200 : r.reason === 'error' ? 502 : r.reason === 'busy' ? 503 : r.reason === 'bad_signature' ? 400 : 200);
