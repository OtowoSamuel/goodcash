/**
 * Referral campaign (second version, 24 Nov 2026): bring 2 real new people, get about ₦1,000 in G$, automatically.
 *
 * How a friend counts (all checked here, on the chain, with no person in the loop):
 *  1. The friend opened the inviter's link and then connected their wallet in GoodCash. The app tells the server
 *     (POST /referral/join). The first link a wallet joins with is the only one that counts.
 *  2. GoodDollar first verified the friend AFTER they joined. Identity.identities(person).dateAdded is the date a
 *     person was first verified, and it never changes on a re-check, so an existing GoodDollar user cannot count.
 *  3. The friend has claimed G$ since joining (GoodDollar's claim contract, lastClaimed). A real, active person.
 *  4. The friend and the inviter are different people (GoodDollar ties all of a person's wallets to one main wallet).
 *  5. Each person counts once, for one inviter, and one inviter is counted for at most 20 friends.
 *
 * Every second counted friend earns the inviter one reward of REFERRAL.rewardG. Nobody pays anything in: rewards are
 * paid by GoodCash from a separate referral wallet (secret REFERRAL_KEY) that the team tops up by hand. The payer
 * only ever spends what is already in that wallet, keeps a daily cap, and stops when the budget is used up.
 *
 * Storage (Workers KV, ORDER_STORE):
 *   refj:<friend>                  -> { inviter, at } the join, written once
 *   refwait:<friend>               -> '1' friends still to check (expires after REFERRAL.waitDays)
 *   refwi:<inviter>:<friend>       -> '1' joined through this inviter's link and not decided yet
 *   refc:<inviterPerson>:<person>  -> { friend, inviter, at } a counted friend
 *   refp:<person>                  -> '1' this person has already been counted for someone
 *   refpay:<inviterPerson>:<n>     -> Reward, the n-th reward (n = 1..maxFriends/perFriends)
 *   refpay-total                   -> G$ committed to rewards so far
 *   refpay-day:<yyyy-mm-dd>        -> G$ paid that day
 */
import { createPublicClient, createWalletClient, decodeFunctionResult, encodeFunctionData, http, parseAbi, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { celo } from 'viem/chains';
import { claimLock } from './lock';
import { GOODDOLLAR_IDENTITY } from './verified';

/** Settings for the campaign. Change here, nowhere else (docs/REFERRAL-RULES.md says the same in words). */
export const REFERRAL = {
  /** Friends needed for one reward */
  perFriends: 2,
  /**
   * G$ per reward. 6,500 G$ is about ₦1,000 in the bank after every fee at the 24 Nov 2026 price, and stays above the
   * smallest cash out (about 5,000 G$) unless the G$ price falls by about a quarter.
   */
  rewardG: 6500,
  /** Friends one person can be counted for: 20 friends, 10 rewards, about ₦10,000 */
  maxFriends: 20,
  /** A friend who joins after this moment does not count */
  endsAt: '2026-12-31T23:59:59Z',
  /** The most G$ the campaign will ever commit to rewards */
  budgetG: 3_500_000,
  /** How long a joined friend has to verify and claim before they stop being checked */
  waitDays: 30,
} as const;

export const GOODDOLLAR_UBI = '0x43d72Ff17701B2DA814620735C39C620Ce0ea4A1'; // claim contract on Celo (citizen-sdk, production-celo)
export const G_TOKEN = '0x62B8B11039FcfE5aB0C56E502b1C372A3d2a9c7A';
const RPC_FALLBACK = 'https://forno.celo.org';
const ZERO = '0x' + '0'.repeat(40);
const WALLET = /^0x[0-9a-fA-F]{40}$/;
const DAY_MS = 24 * 3600 * 1000;
/** Default most G$ paid in one day (about 15 rewards). REFERRAL_DAILY_G changes it. */
export const DEFAULT_DAILY_G = 100_000;
/** The referral wallet needs a little CELO for its own sends */
const MIN_PAYER_CELO_WEI = 2n * 10n ** 16n; // 0.02 CELO
/** Kept small so one scheduled run stays well inside Cloudflare's limit on outside calls */
const CHECKS_PER_RUN = 10;
const PAYS_PER_RUN = 5;
const RECEIPTS_PER_RUN = 5;
/** A sent payment with no receipt after this long is handed to a person */
const RECEIPT_WAIT_MS = 30 * 60 * 1000;
/** A signed join must be this fresh */
const JOIN_MAX_AGE_MS = 10 * 60 * 1000;

const ABI = parseAbi([
  'function getWhitelistedRoot(address) view returns (address)',
  'function identities(address) view returns (uint256 dateAuthenticated, uint256 dateAdded, string did, uint256 whitelistedOnChainId, uint8 status, uint32 authCount)',
  'function lastClaimed(address) view returns (uint256)',
  'function balanceOf(address) view returns (uint256)',
  'function transfer(address to, uint256 amount) returns (bool)',
]);

export type Store = Pick<KVNamespace, 'get' | 'put' | 'list' | 'delete'>;

export interface ReferralEnv {
  ORDER_STORE: KVNamespace;
  KEY_LOCK?: DurableObjectNamespace;
  CELO_RPC_URL?: string;
  REFERRAL_PAY_ENABLED?: string; // "true" turns on automatic payment
  REFERRAL_KEY?: string; // Secret: the referral wallet's private key (0x + 64 hex)
  REFERRAL_DAILY_G?: string; // Most G$ paid per day (default 100,000)
}

export interface Reward {
  wallet: string; // the inviter's wallet whose link was used: the reward is sent here
  person: string; // the inviter's main wallet (GoodDollar)
  n: number;
  g: number;
  at: number;
  status: 'pending' | 'sending' | 'paid' | 'check';
  hash?: string;
  paidAt?: number;
  /** Set once the payment's receipt shows it went through */
  confirmed?: boolean;
}

export function isWallet(v: unknown): v is string {
  return typeof v === 'string' && WALLET.test(v);
}

/** The inviter's wallet from a link or an order, or null if it is not a usable address. */
export function inviterFrom(raw: unknown): string | null {
  return isWallet(raw) ? raw.toLowerCase() : null;
}

// ---------------------------------------------------------------------------
// Chain reads (behind a small interface so tests can stand in for the chain)
// ---------------------------------------------------------------------------

export interface Chain {
  /** The person (main wallet) behind a wallet, or null when GoodDollar does not count it as verified right now */
  personOf(wallet: string): Promise<string | null>;
  /** When GoodDollar first verified this person, in ms (0 when never) */
  firstVerifiedAt(person: string): Promise<number>;
  /** When this wallet last claimed G$, in ms (0 when never) */
  lastClaimedAt(wallet: string): Promise<number>;
  /** True when `signature` is this wallet's signature of `message` (normal wallets and smart wallets) */
  verifySignature(wallet: string, message: string, signature: string): Promise<boolean>;
}

export function rpcFor(env: Pick<ReferralEnv, 'CELO_RPC_URL'>) {
  const url = env.CELO_RPC_URL || RPC_FALLBACK;
  return async (method: string, params: unknown[]): Promise<unknown> => {
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
    const body = (await res.json()) as { result?: unknown; error?: unknown };
    if (!res.ok || body.error || body.result === undefined) throw new Error(`rpc ${method} failed`);
    return body.result;
  };
}

export function liveChain(env: Pick<ReferralEnv, 'CELO_RPC_URL'>): Chain {
  const rpc = rpcFor(env);
  const call = async (to: string, functionName: 'getWhitelistedRoot' | 'identities' | 'lastClaimed', arg: string) => {
    const data = encodeFunctionData({ abi: ABI, functionName, args: [arg as Hex] });
    const r = await rpc('eth_call', [{ to, data }, 'latest']);
    if (typeof r !== 'string' || !r.startsWith('0x')) throw new Error('bad answer');
    return decodeFunctionResult({ abi: ABI, functionName, data: r as Hex });
  };
  return {
    async personOf(wallet) {
      const root = String(await call(GOODDOLLAR_IDENTITY, 'getWhitelistedRoot', wallet)).toLowerCase();
      return root === ZERO ? null : root;
    },
    async firstVerifiedAt(person) {
      const r = (await call(GOODDOLLAR_IDENTITY, 'identities', person)) as readonly [bigint, bigint, string, bigint, number, number];
      return Number(r[1]) * 1000;
    },
    async lastClaimedAt(wallet) {
      return Number((await call(GOODDOLLAR_UBI, 'lastClaimed', wallet)) as bigint) * 1000;
    },
    async verifySignature(wallet, message, signature) {
      const client = createPublicClient({ chain: celo, transport: http(env.CELO_RPC_URL || RPC_FALLBACK) });
      try {
        return await client.verifyMessage({ address: wallet as Hex, message, signature: signature as Hex });
      } catch {
        return false;
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Joining (the app calls this when a wallet connects with a friend's link saved)
// ---------------------------------------------------------------------------

export type JoinResult =
  | { ok: true }
  | { ok: false; reason: 'bad_wallet' | 'self' | 'already' | 'ended' | 'already_verified' | 'bad_signature' | 'error' };

/**
 * The exact text a friend signs to accept an invite. Free, sends nothing. The signature proves the wallet's owner
 * chose this invite, so nobody can sign up other people's wallets under their own link.
 */
export function buildJoinMessage(wallet: string, inviter: string, issuedAt: number): string {
  const ts = new Date(Math.floor(issuedAt / 1000) * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z');
  return ['Accept a GoodCash invite.', '', 'This is free and sends no money.', '', `Invited by: ${inviter.toLowerCase()}`, `Wallet: ${wallet.toLowerCase()}`, `Issued at: ${ts}`].join('\n');
}

export interface JoinInput {
  wallet: unknown;
  ref: unknown;
  signature: unknown;
  issuedAt: unknown;
}

export async function joinReferral(store: Store, chain: Chain, input: JoinInput, now = Date.now()): Promise<JoinResult> {
  const friend = inviterFrom(input.wallet);
  const inviter = inviterFrom(input.ref);
  if (!friend || !inviter) return { ok: false, reason: 'bad_wallet' };
  if (friend === inviter) return { ok: false, reason: 'self' };
  if (now > Date.parse(REFERRAL.endsAt)) return { ok: false, reason: 'ended' };
  const issuedAt = typeof input.issuedAt === 'number' ? input.issuedAt : NaN;
  if (typeof input.signature !== 'string' || !/^0x[0-9a-fA-F]+$/.test(input.signature) || input.signature.length > 20_000) return { ok: false, reason: 'bad_signature' };
  if (!Number.isFinite(issuedAt) || issuedAt > now + 2 * 60_000 || now - issuedAt > JOIN_MAX_AGE_MS) return { ok: false, reason: 'bad_signature' };
  if ((await store.get(`refj:${friend}`)) !== null) return { ok: false, reason: 'already' };
  try {
    if (!(await chain.verifySignature(friend, buildJoinMessage(friend, inviter, issuedAt), input.signature))) return { ok: false, reason: 'bad_signature' };
    // A wallet GoodDollar already counts as verified is not a new person: nothing to write
    if (await chain.personOf(friend)) return { ok: false, reason: 'already_verified' };
  } catch {
    return { ok: false, reason: 'error' };
  }
  const ttl = REFERRAL.waitDays * 24 * 3600;
  await store.put(`refj:${friend}`, JSON.stringify({ inviter, at: now }));
  await store.put(`refwait:${friend}`, '1', { expirationTtl: ttl });
  await store.put(`refwi:${inviter}:${friend}`, '1', { expirationTtl: ttl });
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Checking joined friends (runs on the 10-minute schedule)
// ---------------------------------------------------------------------------

export type CheckOutcome = 'counted' | 'waiting' | 'not_new' | 'self' | 'already' | 'full' | 'expired';

async function committedG(store: Store): Promise<number> {
  return Number((await store.get('refpay-total')) ?? '0') || 0;
}

/** Open while it is before the end date and one more reward still fits in the budget */
export async function campaignOpen(store: Store, now = Date.now()): Promise<boolean> {
  if (now > Date.parse(REFERRAL.endsAt)) return false;
  return (await committedG(store)) + REFERRAL.rewardG <= REFERRAL.budgetG;
}

async function countFor(store: Store, inviterPerson: string): Promise<number> {
  return (await store.list({ prefix: `refc:${inviterPerson}:`, limit: 1000 })).keys.length;
}

/**
 * What one scheduled run has already decided. Storage can answer with an old value for up to a minute after a write,
 * so within a run these, not fresh reads, say who was counted, each inviter's count, the rewards made and the total.
 */
export interface RunState {
  persons: Set<string>;
  counts: Map<string, number>;
  rewards: Set<string>;
  total: number | null;
}
export const newRunState = (): RunState => ({ persons: new Set(), counts: new Map(), rewards: new Set(), total: null });

/** Decide one joined friend. Safe to run again and again: a friend is written as counted once. */
export async function checkFriend(store: Store, chain: Chain, friend: string, now = Date.now(), run: RunState = newRunState()): Promise<CheckOutcome> {
  const raw = await store.get(`refj:${friend}`);
  if (!raw) {
    await store.delete(`refwait:${friend}`);
    return 'expired';
  }
  const join = JSON.parse(raw) as { inviter: string; at: number };
  const done = async (o: CheckOutcome) => {
    await store.delete(`refwait:${friend}`);
    await store.delete(`refwi:${join.inviter}:${friend}`);
    return o;
  };
  if (now - join.at > REFERRAL.waitDays * DAY_MS) return done('expired');

  const person = await chain.personOf(friend);
  if (!person) return 'waiting'; // not verified yet
  if ((await chain.firstVerifiedAt(person)) <= join.at) return done('not_new');
  const claimed = Math.max(await chain.lastClaimedAt(person), person === friend ? 0 : await chain.lastClaimedAt(friend));
  if (claimed <= join.at) return 'waiting'; // verified, has not claimed since joining

  const inviterPerson = await chain.personOf(join.inviter);
  if (!inviterPerson) return 'waiting'; // the inviter has to be verified to be counted; checked again later
  if (inviterPerson === person) return done('self');
  if (run.persons.has(person) || (await store.get(`refp:${person}`)) !== null) return done('already');

  const count = run.counts.get(inviterPerson) ?? (await countFor(store, inviterPerson));
  if (count >= REFERRAL.maxFriends) return done('full');
  await store.put(`refp:${person}`, '1');
  await store.put(`refc:${inviterPerson}:${person}`, JSON.stringify({ friend, inviter: join.inviter, at: now }));
  run.persons.add(person);
  const newCount = count + 1;
  run.counts.set(inviterPerson, newCount);
  if (newCount % REFERRAL.perFriends === 0) {
    const n = newCount / REFERRAL.perFriends;
    const key = `refpay:${inviterPerson}:${n}`;
    const total = run.total ?? (await committedG(store));
    if (!run.rewards.has(key) && (await store.get(key)) === null && total + REFERRAL.rewardG <= REFERRAL.budgetG) {
      const reward: Reward = { wallet: join.inviter, person: inviterPerson, n, g: REFERRAL.rewardG, at: now, status: 'pending' };
      await store.put(key, JSON.stringify(reward));
      run.rewards.add(key);
      run.total = total + REFERRAL.rewardG;
      // Runs happen one after another on the schedule, so only this run adds to the total
      await store.put('refpay-total', String(run.total));
    }
  }
  return done('counted');
}

export async function checkWaitingFriends(store: Store, chain: Chain, now = Date.now()): Promise<Record<CheckOutcome, number>> {
  const out: Record<CheckOutcome, number> = { counted: 0, waiting: 0, not_new: 0, self: 0, already: 0, full: 0, expired: 0 };
  // Walk the whole list over several runs with a saved place, so friends who never verify cannot hold up the rest
  const cursor = (await store.get('refwait-cursor')) ?? undefined;
  const rows = (await store.list({ prefix: 'refwait:', limit: CHECKS_PER_RUN, cursor })) as { keys: { name: string }[]; list_complete?: boolean; cursor?: string };
  if (rows.list_complete === false && rows.cursor) await store.put('refwait-cursor', rows.cursor, { expirationTtl: 24 * 3600 });
  else await store.delete('refwait-cursor');
  const run = newRunState();
  for (const k of rows.keys) {
    const friend = k.name.slice('refwait:'.length);
    try {
      out[await checkFriend(store, chain, friend, now, run)]++;
    } catch (e) {
      out.waiting++;
      console.error('[referral] check failed:', (e as Error)?.message);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Paying rewards (runs on the same schedule, only when switched on)
// ---------------------------------------------------------------------------

export interface Payer {
  address: string;
  gBalance(): Promise<bigint>;
  celoBalance(): Promise<bigint>;
  /** The next transaction number for the referral wallet, counting sends still waiting to be confirmed */
  nonce(): Promise<number>;
  /** Sends G$ with the given transaction number; resolves with the hash once the network accepted it. Throws when it fails. */
  sendG(to: string, wei: bigint, nonce: number): Promise<string>;
  /** 'success' or 'reverted' once confirmed, null while unknown */
  receipt(hash: string): Promise<'success' | 'reverted' | null>;
}

export function livePayer(env: ReferralEnv): Payer | null {
  const key = env.REFERRAL_KEY;
  if (!key || !/^0x[0-9a-fA-F]{64}$/.test(key)) return null;
  const rpc = rpcFor(env);
  const account = privateKeyToAccount(key as Hex);
  const client = createWalletClient({ account, chain: celo, transport: http(env.CELO_RPC_URL || RPC_FALLBACK) });
  return {
    address: account.address,
    async gBalance() {
      const data = encodeFunctionData({ abi: ABI, functionName: 'balanceOf', args: [account.address] });
      return BigInt((await rpc('eth_call', [{ to: G_TOKEN, data }, 'latest'])) as string);
    },
    async celoBalance() {
      return BigInt((await rpc('eth_getBalance', [account.address, 'latest'])) as string);
    },
    async nonce() {
      return Number(BigInt((await rpc('eth_getTransactionCount', [account.address, 'pending'])) as string));
    },
    sendG: (to, wei, nonce) => client.writeContract({ address: G_TOKEN, abi: ABI, functionName: 'transfer', args: [to as Hex, wei], nonce }),
    async receipt(hash) {
      const r = (await rpc('eth_getTransactionReceipt', [hash]).catch(() => null)) as { status?: string } | null;
      if (!r || typeof r.status !== 'string') return null;
      return r.status === '0x1' ? 'success' : 'reverted';
    },
  };
}

export interface PayResult {
  paid: number;
  check: number;
  skipped?: 'off' | 'busy' | 'low' | 'day_cap';
}

export async function payRewards(env: ReferralEnv, payer: Payer | null = livePayer(env), now = Date.now()): Promise<PayResult> {
  if (env.REFERRAL_PAY_ENABLED !== 'true' || !payer) return { paid: 0, check: 0, skipped: 'off' };
  const store = env.ORDER_STORE;
  const lock = await claimLock(env, 'referral-pay', 120_000);
  if (!lock.ok) return { paid: 0, check: 0, skipped: 'busy' };
  let paid = 0;
  let check = 0;
  try {
    const rows = await store.list({ prefix: 'refpay:', limit: 1000 });
    const rewards: Array<[string, Reward]> = [];
    for (const k of rows.keys) {
      const raw = await store.get(k.name);
      if (raw) rewards.push([k.name, JSON.parse(raw) as Reward]);
    }

    // 1. Payments sent earlier: confirm them, or hand them to a person if they failed or never arrived
    let looked = 0;
    for (const [key, r] of rewards) {
      if (r.status !== 'paid' || r.confirmed || !r.hash || looked >= RECEIPTS_PER_RUN) continue;
      looked++;
      const outcome = await payer.receipt(r.hash).catch(() => null);
      if (outcome === 'success') await store.put(key, JSON.stringify({ ...r, confirmed: true }));
      else if (outcome === 'reverted' || now - (r.paidAt ?? now) > RECEIPT_WAIT_MS) {
        await store.put(key, JSON.stringify({ ...r, status: 'check' }));
        check++;
        console.error('[referral] a sent payment did not go through, marked for a person to check');
      }
    }

    // 2. New payments, numbered here one after another so two sends never share a transaction number
    const pending = rewards.filter(([, r]) => r.status === 'pending');
    if (pending.length === 0) return { paid, check };
    const dayKey = `refpay-day:${new Date(now).toISOString().slice(0, 10)}`;
    let usedToday = Number((await store.get(dayKey)) ?? '0') || 0;
    const capRaw = Number(env.REFERRAL_DAILY_G ?? DEFAULT_DAILY_G);
    const cap = Number.isFinite(capRaw) && capRaw > 0 ? capRaw : DEFAULT_DAILY_G;
    let gLeft = await payer.gBalance();
    const celo = await payer.celoBalance();
    let nonce = await payer.nonce();
    for (const [key, reward] of pending) {
      if (paid >= PAYS_PER_RUN) break;
      if (usedToday + reward.g > cap) return { paid, check, skipped: 'day_cap' };
      const wei = BigInt(reward.g) * 10n ** 18n;
      if (gLeft < wei || celo < MIN_PAYER_CELO_WEI) {
        console.error('[referral] referral wallet is low: payments paused');
        return { paid, check, skipped: 'low' };
      }
      // Marked before sending, so a send that fails halfway is never sent twice: it waits for a person to look
      await store.put(key, JSON.stringify({ ...reward, status: 'sending' }));
      try {
        const hash = await payer.sendG(reward.wallet, wei, nonce);
        nonce++;
        gLeft -= wei;
        await store.put(key, JSON.stringify({ ...reward, status: 'paid', hash, paidAt: now }));
        usedToday += reward.g;
        await store.put(dayKey, String(usedToday), { expirationTtl: 3 * 24 * 3600 });
        paid++;
      } catch (e) {
        await store.put(key, JSON.stringify({ ...reward, status: 'check' }));
        check++;
        console.error('[referral] payment failed, marked for a person to check:', (e as Error)?.name);
        // The transaction number may or may not have been used: stop, and start fresh on the next run
        return { paid, check };
      }
    }
    return { paid, check };
  } finally {
    await lock.release();
  }
}

// ---------------------------------------------------------------------------
// What the invite screen shows
// ---------------------------------------------------------------------------

export interface ReferralSummary {
  /** False once the end date has passed or the budget is used up: nobody should be promised a reward */
  open: boolean;
  endsAt: string;
  /** Friends who joined with this link and are not decided yet (verify and claim still to come) */
  waiting: number;
  /** Friends who counted */
  friends: number;
  perFriends: number;
  rewardG: number;
  maxFriends: number;
  /** G$ sent to this person */
  paidG: number;
  /** G$ earned and on its way */
  pendingG: number;
  /** False when this wallet is not verified with GoodDollar right now (its friends cannot count until it is) */
  verified: boolean;
}

export async function referralSummary(store: Store, chain: Chain, wallet: string, now = Date.now()): Promise<ReferralSummary> {
  const me = wallet.toLowerCase();
  const waiting = (await store.list({ prefix: `refwi:${me}:`, limit: 1000 })).keys.length;
  let person: string | null = null;
  try {
    person = await chain.personOf(me);
  } catch {
    person = null;
  }
  let friends = 0;
  let paidG = 0;
  let pendingG = 0;
  if (person) {
    friends = await countFor(store, person);
    const rewards = await store.list({ prefix: `refpay:${person}:`, limit: 100 });
    for (const k of rewards.keys) {
      const raw = await store.get(k.name);
      if (!raw) continue;
      const r = JSON.parse(raw) as Reward;
      if (r.status === 'paid') paidG += r.g;
      else pendingG += r.g;
    }
  }
  return {
    open: await campaignOpen(store, now),
    endsAt: REFERRAL.endsAt,
    waiting,
    friends,
    perFriends: REFERRAL.perFriends,
    rewardG: REFERRAL.rewardG,
    maxFriends: REFERRAL.maxFriends,
    paidG,
    pendingG,
    verified: person !== null,
  };
}
