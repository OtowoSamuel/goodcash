import { type Address, createPublicClient, createWalletClient, custom, decodeEventLog, http, parseAbi } from 'viem';
import { celo } from 'viem/chains';
import { ORDERS_API_BASE } from './rate';
import { CELO_RPC_URL, ensureCeloChain, getWalletProvider } from './router';

/**
 * The daily free G$ from GoodDollar, claimed inside GoodCash.
 *
 * Same contract and calls as GoodDollar's own claim SDK (@goodsdks/citizen-sdk ClaimSDK, "production-celo"): the
 * person's own wallet calls UBIScheme.claim(), and the G$ lands in that wallet. GoodCash never touches it.
 * When the wallet has almost no CELO for the network fee, GoodCash asks GoodDollar's faucet for it (POST /claim/gas
 * on our server, which forwards to GoodDollar), then waits for the CELO to arrive before asking the wallet to sign.
 */
export const UBI_SCHEME = '0x43d72Ff17701B2DA814620735C39C620Ce0ea4A1' as const;
const DAY_MS = 24 * 3600 * 1000;
/** GoodDollar's claim gas buffer on Celo */
const CLAIM_GAS = 250_000n;

const UBI_ABI = parseAbi([
  'function claim() returns (bool)',
  'function checkEntitlement(address _member) view returns (uint256)',
  'function periodStart() view returns (uint256)',
  'function currentDay() view returns (uint256)',
  'event UBIClaimed(address indexed account, uint256 amount)',
]);

type Eip1193 = { request: (args: { method: string; params?: unknown[] }) => Promise<unknown> };
type Client = {
  readContract: (a: never) => Promise<unknown>;
  getBalance: (a: { address: Address }) => Promise<bigint>;
  getGasPrice: () => Promise<bigint>;
  waitForTransactionReceipt: (a: { hash: `0x${string}`; timeout?: number }) => Promise<{ status: string; logs: Array<{ address: string; data: `0x${string}`; topics: `0x${string}`[] }> }>;
};

export function claimClient(): Client {
  return createPublicClient({ chain: celo, transport: http(CELO_RPC_URL), pollingInterval: 1000 }) as unknown as Client;
}

const read = <T>(client: Client, functionName: string, args: unknown[] = []) =>
  (client.readContract as (a: unknown) => Promise<T>)({ address: UBI_SCHEME, abi: UBI_ABI, functionName, args });

export interface ClaimInfo {
  /** G$ ready to claim now (0 when today's is already claimed) */
  readyG: number;
  /** When the next claim opens, in ms (0 when one is ready now) */
  nextAt: number;
}

/** What is ready for this wallet. Throws when the chain cannot be read. */
export async function readClaim(wallet: string, client: Client = claimClient(), now = Date.now()): Promise<ClaimInfo> {
  const wei = await read<bigint>(client, 'checkEntitlement', [wallet]);
  if (wei > 0n) return { readyG: Number(wei / 10n ** 14n) / 1e4, nextAt: 0 };
  const [periodStart, currentDay] = await Promise.all([read<bigint>(client, 'periodStart'), read<bigint>(client, 'currentDay')]);
  const dayStart = Number(periodStart) * 1000 + Number(currentDay) * DAY_MS;
  return { readyG: 0, nextAt: dayStart <= now ? dayStart + DAY_MS : dayStart };
}

/** True when the wallet cannot pay the claim's network fee (with a fifth on top for the price to move). */
export async function needsClaimGas(wallet: string, client: Client = claimClient()): Promise<boolean> {
  const [balance, price] = await Promise.all([client.getBalance({ address: wallet as Address }), client.getGasPrice()]);
  return balance < (CLAIM_GAS * price * 12n) / 10n;
}

export type GasAnswer = 'sent' | 'enough' | 'refused';

/** Ask GoodDollar's faucet (through our server) for the claim fee. */
export async function askClaimGas(wallet: string, fetchFn: typeof fetch = fetch): Promise<GasAnswer> {
  const res = await fetchFn(`${ORDERS_API_BASE}/claim/gas`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ wallet: wallet.toLowerCase() }),
  });
  const body = (await res.json().catch(() => ({}))) as { ok?: boolean; status?: string };
  if (body.ok && (body.status === 'sent' || body.status === 'enough')) return body.status;
  return 'refused';
}

/** Wait until the fee has arrived. Resolves false when it did not come in time. */
export async function waitForClaimGas(wallet: string, client: Client = claimClient(), opts: { tries?: number; everyMs?: number } = {}): Promise<boolean> {
  const tries = opts.tries ?? 15;
  for (let i = 0; i < tries; i++) {
    if (!(await needsClaimGas(wallet, client))) return true;
    await new Promise((r) => setTimeout(r, opts.everyMs ?? 3000));
  }
  return false;
}

async function assertSameAccount(provider: Eip1193, wallet: string): Promise<void> {
  const accounts = ((await provider.request({ method: 'eth_accounts' })) as string[] | undefined) ?? [];
  if (!accounts.some((a) => a.toLowerCase() === wallet.toLowerCase())) throw new Error('WRONG_ACCOUNT');
}

/** Ask the wallet to claim. Resolves with the transaction hash. */
export async function sendClaim(wallet: string, provider: Eip1193 | null = getWalletProvider()): Promise<`0x${string}`> {
  if (!provider) throw new Error('NO_WALLET');
  await assertSameAccount(provider, wallet);
  await ensureCeloChain(provider);
  const walletClient = createWalletClient({ chain: celo, transport: custom(provider) });
  return walletClient.writeContract({ account: wallet as Address, chain: celo, address: UBI_SCHEME, abi: UBI_ABI, functionName: 'claim' });
}

/** Wait for the claim to be confirmed. Resolves with the G$ received. */
export async function confirmClaim(hash: `0x${string}`, client: Client = claimClient()): Promise<number> {
  const receipt = await client.waitForTransactionReceipt({ hash, timeout: 90_000 });
  if (receipt.status !== 'success') throw new Error('CLAIM_FAILED');
  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== UBI_SCHEME.toLowerCase()) continue;
    try {
      const ev = decodeEventLog({ abi: UBI_ABI, data: log.data, topics: log.topics as [`0x${string}`, ...`0x${string}`[]] });
      if (ev.eventName === 'UBIClaimed') return Number((ev.args as { amount: bigint }).amount / 10n ** 14n) / 1e4;
    } catch {
      // another event from the same contract
    }
  }
  return 0;
}

/** "5h 12m", "12m", "less than a minute" */
export function timeUntil(at: number, now = Date.now()): string {
  const mins = Math.ceil((at - now) / 60_000);
  if (mins <= 1) return 'less than a minute';
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

/** What a customer reads when something goes wrong. Details never reach them. */
export function friendlyClaimError(err: unknown): string {
  const e = err as { name?: string; message?: string; shortMessage?: string; code?: number; cause?: { code?: number; name?: string } } | null;
  const raw = `${e?.name ?? ''} ${e?.cause?.name ?? ''} ${e?.shortMessage ?? ''} ${e?.message ?? ''}`;
  if (e?.message === 'WRONG_ACCOUNT') return 'Your wallet is using a different account. Switch it back to the account shown in GoodCash, then try again.';
  if (e?.message === 'NO_WALLET') return 'Your wallet is not connected. Reconnect it, then try again.';
  if (e?.message === 'NO_GAS') return 'Your wallet needs a little CELO to claim, and we could not get it for you right now. Add a little CELO, or try again later.';
  if (e?.code === 4001 || e?.cause?.code === 4001 || /user rejected|user denied|rejected the request|cancel/i.test(raw)) return 'You cancelled in your wallet. Nothing was sent. Tap Claim to try again.';
  if (/insufficient funds|not enough/i.test(raw)) return 'Your wallet needs a little CELO to claim. Add a little CELO, then try again.';
  return 'The claim did not go through. Nothing was taken. Please try again.';
}
