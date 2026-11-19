import { type Address, createPublicClient, createWalletClient, custom, encodeFunctionData, http } from 'viem';
import { celo } from 'viem/chains';
import { ORDERS_API_BASE } from './rate';
import { CELO_RPC_URL, ensureCeloChain, getWalletProvider } from './router';

/**
 * Voting for GoodCash in the GoodBuilders council (Flow State), from inside the app.
 *
 * Voting costs no G$. It spends the voting points a GoodDollar-verified wallet is given (10), and the vote is one
 * transaction the customer approves in their own wallet, sent straight to the council contract on Celo. The only fee
 * is the small network fee, paid in CELO. Everything here is fixed: one council, one project, one network.
 */

export const VOTE_CHAIN_ID = 42220;
/** GoodBuilders Season 5 council (Flow State) */
export const VOTE_COUNCIL: Address = '0x889e0aadaa3f8b28a794ef70da147827c620a590';
/** GoodCash's funding address in that council (recipient number 11 when this was written) */
export const GOODCASH_RECIPIENT: Address = '0xafdeebb89cda1669361117ea2eae3411f1228cb6';

const COUNCIL_ABI = [
  {
    type: 'function',
    name: 'getVoter',
    stateMutability: 'view',
    inputs: [{ name: '_account', type: 'address' }],
    outputs: [
      {
        name: 'voter',
        type: 'tuple',
        components: [
          { name: 'account', type: 'address' },
          { name: 'votingPower', type: 'uint96' },
          {
            name: 'votes',
            type: 'tuple[]',
            components: [
              { name: 'recipientId', type: 'uint160' },
              { name: 'amount', type: 'uint96' },
            ],
          },
        ],
      },
    ],
  },
  { type: 'function', name: 'recipientIdByAddress', stateMutability: 'view', inputs: [{ name: '', type: 'address' }], outputs: [{ name: '', type: 'uint160' }] },
  { type: 'function', name: 'maxVotingSpread', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'uint8' }] },
  {
    type: 'function',
    name: 'vote',
    stateMutability: 'nonpayable',
    inputs: [
      {
        name: '_votes',
        type: 'tuple[]',
        components: [
          { name: 'recipient', type: 'address' },
          { name: 'amount', type: 'uint96' },
        ],
      },
    ],
    outputs: [],
  },
] as const;

export type Eip1193 = { request: (args: { method: string; params?: unknown[] }) => Promise<unknown> };

// --- reading the ballot ---------------------------------------------------------------------------------------

export interface Ballot {
  /** The wallet has been given voting points in this council */
  registered: boolean;
  /** Points the wallet has in all */
  power: number;
  /** Points already given to any project */
  allocated: number;
  /** Points already given to GoodCash */
  mine: number;
  /** Points still free to give */
  available: number;
  /** GoodCash is an active project in the council */
  active: boolean;
  /** The most projects one voter may support at once. 0 means no limit. */
  spread: number;
  /** How many projects this wallet supports now */
  projects: number;
}

type ReadClient = {
  readContract: (a: never) => Promise<unknown>;
};

const read = <T>(client: ReadClient, functionName: string, args: unknown[], blockNumber?: bigint): Promise<T> =>
  (client.readContract as (a: unknown) => Promise<T>)({ address: VOTE_COUNCIL, abi: COUNCIL_ABI, functionName, args, ...(blockNumber ? { blockNumber } : {}) });

export function publicClient() {
  return createPublicClient({ chain: celo, transport: http(CELO_RPC_URL), pollingInterval: 1000 });
}

/** What the wallet has, what it has given and what is left, read from the council itself. Throws when the chain cannot be read. */
export async function readBallot(wallet: string, client: ReadClient = publicClient(), blockNumber?: bigint): Promise<Ballot> {
  const [recipientId, voter, spread] = await Promise.all([
    read<bigint>(client, 'recipientIdByAddress', [GOODCASH_RECIPIENT], blockNumber),
    read<{ votingPower: bigint; votes: ReadonlyArray<{ recipientId: bigint; amount: bigint }> }>(client, 'getVoter', [wallet], blockNumber),
    read<number>(client, 'maxVotingSpread', [], blockNumber),
  ]);
  const power = Number(voter.votingPower);
  const given = voter.votes.filter((v) => v.amount > 0n);
  const allocated = given.reduce((n, v) => n + Number(v.amount), 0);
  const mine = recipientId === 0n ? 0 : Number(given.find((v) => v.recipientId === recipientId)?.amount ?? 0n);
  return {
    registered: power > 0,
    power,
    allocated,
    mine,
    available: Math.max(0, power - allocated),
    active: recipientId !== 0n,
    spread: Number(spread),
    projects: given.length,
  };
}

// --- GoodDollar verification -----------------------------------------------------------------------------------

/** GoodDollar's Identity contract on Celo (GoodProtocol releases/deployment.json, "production-celo") */
export const GOODDOLLAR_IDENTITY: Address = '0xC361A6E67822a0EDc17D899227dd9FC50BD62F42';
/** Where a person does the face check. GoodDollar's own site sends people here. */
export const VERIFY_URL = 'https://wallet.gooddollar.org';

const IDENTITY_ABI = [
  { type: 'function', name: 'getWhitelistedRoot', stateMutability: 'view', inputs: [{ name: 'account', type: 'address' }], outputs: [{ name: '', type: 'address' }] },
] as const;

const ZERO = '0x0000000000000000000000000000000000000000';

/**
 * Is this wallet verified with GoodDollar? GoodDollar answers with the person's main wallet, or zero when the wallet
 * is not verified. A wallet connected to a verified person counts too. Throws when the chain cannot be read, so a
 * failed check is never mistaken for "not verified".
 */
export async function readVerified(wallet: string, client: ReadClient = publicClient()): Promise<boolean> {
  const root = await (client.readContract as (a: unknown) => Promise<string>)({ address: GOODDOLLAR_IDENTITY, abi: IDENTITY_ABI, functionName: 'getWhitelistedRoot', args: [wallet] });
  return typeof root === 'string' && root.toLowerCase() !== ZERO;
}

// --- working out the vote --------------------------------------------------------------------------------------

export type VotePlan =
  | { ok: true; /** GoodCash's points after this vote (the contract sets the total, it does not add) */ newTotal: number }
  | { ok: false; reason: 'not_active' | 'not_registered' | 'no_points' | 'too_many' | 'too_many_projects' | 'bad_amount' };

export function planVote(ballot: Ballot, points: number): VotePlan {
  if (!ballot.active) return { ok: false, reason: 'not_active' };
  if (!ballot.registered) return { ok: false, reason: 'not_registered' };
  if (!Number.isInteger(points) || points < 1) return { ok: false, reason: 'bad_amount' };
  if (ballot.available < 1) return { ok: false, reason: 'no_points' };
  if (points > ballot.available) return { ok: false, reason: 'too_many' };
  // A voter may be limited in how many projects they support; a first vote for GoodCash adds one
  if (ballot.spread > 0 && ballot.mine === 0 && ballot.projects + 1 > ballot.spread) return { ok: false, reason: 'too_many_projects' };
  // Other projects are never touched: only GoodCash's own total is sent
  return { ok: true, newTotal: ballot.mine + points };
}

/** The exact transaction: set GoodCash's total in the council. Nothing else is ever sent. */
export function voteData(newTotal: number): `0x${string}` {
  return encodeFunctionData({ abi: COUNCIL_ABI, functionName: 'vote', args: [[{ recipient: GOODCASH_RECIPIENT, amount: BigInt(newTotal) }]] });
}

// --- the network fee -------------------------------------------------------------------------------------------

export interface VoteFee {
  gas: bigint;
  feeCelo: number;
  /** What the wallet must hold: the fee with room for the price to move */
  needCelo: number;
  haveCelo: number;
  enough: boolean;
}

type FeeClient = {
  estimateGas: (a: { account: Address; to: Address; data: `0x${string}` }) => Promise<bigint>;
  getGasPrice: () => Promise<bigint>;
  getBalance: (a: { address: Address }) => Promise<bigint>;
};

/** The fee headroom: wallets set a limit above today's price. */
const GAS_NUM = 13n; // 30% more gas than estimated
const GAS_DEN = 10n;
const PRICE_NUM = 3n; // and 50% more than today's price
const PRICE_DEN = 2n;

/** Simulates the exact vote. It throws when the contract would refuse it, so a vote that would fail is never offered. */
export async function estimateVoteFee(wallet: string, newTotal: number, client: FeeClient = publicClient() as unknown as FeeClient): Promise<VoteFee> {
  const [estimate, price, balance] = await Promise.all([
    client.estimateGas({ account: wallet as Address, to: VOTE_COUNCIL, data: voteData(newTotal) }),
    client.getGasPrice(),
    client.getBalance({ address: wallet as Address }),
  ]);
  const gas = (estimate * GAS_NUM) / GAS_DEN;
  const need = (gas * price * PRICE_NUM) / PRICE_DEN;
  const toCelo = (w: bigint) => Number(w) / 1e18;
  return { gas, feeCelo: toCelo(estimate * price), needCelo: toCelo(need), haveCelo: toCelo(balance), enough: balance >= need };
}

// --- turning voting on -----------------------------------------------------------------------------------------

/** The text the customer signs. It must match Flow State's own format exactly (checked against their service). */
export function buildClaimMessage(address: string, issuedAt: number): string {
  const issuedAtSecond = Math.floor(issuedAt / 1000) * 1000;
  const timestamp = new Date(issuedAtSecond).toISOString().replace(/\.\d{3}Z$/, 'Z');
  return [
    'Claim voting rights in this Flow Council.',
    '',
    `Council: ${VOTE_COUNCIL.toLowerCase()}`,
    `Chain: ${VOTE_CHAIN_ID}`,
    `Wallet: ${address.toLowerCase()}`,
    `Issued at: ${timestamp}`,
  ].join('\n');
}

export type RegisterOutcome = 'registered' | 'not_verified' | 'other_wallet' | 'busy' | 'error';

/** Ask the customer to sign the readable message (no cost, no transaction), then have Flow State register the wallet. */
export async function registerVoter(wallet: string, provider: Eip1193 | null = getWalletProvider(), fetchImpl: typeof fetch = fetch): Promise<RegisterOutcome> {
  if (!provider) throw new Error('NO_WALLET');
  await assertSameAccount(provider, wallet);
  const issuedAt = Date.now();
  const walletClient = createWalletClient({ chain: celo, transport: custom(provider) });
  const signature = await walletClient.signMessage({ account: wallet as Address, message: buildClaimMessage(wallet, issuedAt) });
  let res: Response;
  try {
    res = await fetchImpl(`${ORDERS_API_BASE}/vote/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ address: wallet, issuedAt, signature }),
    });
  } catch {
    return 'error';
  }
  const data = (await res.json().catch(() => ({}))) as { ok?: boolean; reason?: string };
  if (data.ok === true) return 'registered';
  if (data.reason === 'not_verified' || data.reason === 'other_wallet' || data.reason === 'busy') return data.reason;
  return 'error';
}

async function assertSameAccount(provider: Eip1193, wallet: string): Promise<void> {
  const accounts = ((await provider.request({ method: 'eth_accounts' })) as string[] | undefined) ?? [];
  if (!accounts.some((a) => a.toLowerCase() === wallet.toLowerCase())) throw new Error('WRONG_ACCOUNT');
}

// --- casting the vote ------------------------------------------------------------------------------------------

export interface PendingVote {
  hash: `0x${string}`;
  newTotal: number;
  at: number;
}

const pendingKey = (wallet: string) => `goodcash_vote_pending_${wallet.toLowerCase()}`;

export function loadPendingVote(wallet: string): PendingVote | null {
  try {
    const v = JSON.parse(localStorage.getItem(pendingKey(wallet)) ?? 'null') as PendingVote | null;
    return v && /^0x[0-9a-fA-F]{64}$/.test(v.hash) && Number.isInteger(v.newTotal) ? v : null;
  } catch {
    return null;
  }
}

export function savePendingVote(wallet: string, v: PendingVote | null): void {
  try {
    if (v) localStorage.setItem(pendingKey(wallet), JSON.stringify(v));
    else localStorage.removeItem(pendingKey(wallet));
  } catch {
    // Storage can be blocked. The vote still works; it just cannot be picked up again after closing.
  }
}

export type VoteOutcome = { status: 'done'; ballot: Ballot } | { status: 'failed' } | { status: 'unclear' };

/** Wait for a sent vote, then confirm from the council itself that GoodCash now has the points. */
export async function confirmVote(hash: `0x${string}`, newTotal: number, wallet: string, client = publicClient()): Promise<VoteOutcome> {
  let receipt;
  try {
    receipt = await client.waitForTransactionReceipt({ hash, confirmations: 3, timeout: 150_000 });
  } catch {
    return { status: 'unclear' }; // not seen yet: the wallet may still be sending it. Never send it again on its own.
  }
  if (receipt.status !== 'success') return { status: 'failed' };
  const ballot = await readBallot(wallet, client as unknown as ReadClient, receipt.blockNumber);
  return ballot.mine === newTotal ? { status: 'done', ballot } : { status: 'unclear' };
}

/** Send the vote from the customer's own wallet. The wallet asks them to approve; nothing happens without that. */
export async function sendVote(wallet: string, newTotal: number, gas: bigint, provider: Eip1193 | null = getWalletProvider()): Promise<`0x${string}`> {
  if (!provider) throw new Error('NO_WALLET');
  await assertSameAccount(provider, wallet);
  await ensureCeloChain(provider);
  const walletClient = createWalletClient({ chain: celo, transport: custom(provider) });
  const hash = await walletClient.sendTransaction({ account: wallet as Address, chain: celo, to: VOTE_COUNCIL, data: voteData(newTotal), gas });
  savePendingVote(wallet, { hash, newTotal, at: Date.now() });
  return hash;
}

// --- plain words -----------------------------------------------------------------------------------------------

/** What a customer reads when something goes wrong. Details never reach them. */
export function friendlyVoteError(err: unknown): string {
  const e = err as { name?: string; message?: string; shortMessage?: string; code?: number; cause?: { code?: number; name?: string } } | null;
  const raw = `${e?.name ?? ''} ${e?.cause?.name ?? ''} ${e?.shortMessage ?? ''} ${e?.message ?? ''}`;
  if (e?.message === 'WRONG_ACCOUNT') return 'Your wallet is using a different account. Switch it back to the account shown in GoodCash, then try again.';
  if (e?.message === 'NO_WALLET') return 'Your wallet is not connected. Reconnect it, then try again.';
  if (e?.code === 4001 || e?.cause?.code === 4001 || /user rejected|user denied|rejected the request|cancel/i.test(raw)) return 'You cancelled in your wallet. Nothing was sent. Tap to try again.';
  if (/insufficient funds|not enough/i.test(raw)) return 'Your wallet needs a little CELO to pay the network fee. Nothing was sent.';
  return 'Something went wrong. Nothing was taken and your G$ is safe. Please try again.';
}
