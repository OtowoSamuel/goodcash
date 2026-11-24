/**
 * Network fee for the daily G$ claim, from GoodDollar's own faucet.
 *
 * GoodDollar tops up a verified person's wallet with a little CELO so they can claim. Its claim SDK asks its server
 * (goodserver /verify/topWallet) when the person cannot pay for the faucet transaction themselves. That server only
 * answers GoodDollar's own websites in a browser, so GoodCash asks it from here instead, for the same wallet.
 *
 * Nothing here holds or spends GoodCash money. GoodDollar decides whether to top up (verified, not topped up too
 * recently). We only ask for a verified wallet that is really short of CELO, and the route is tightly rate limited.
 */
import { isVerified, type VerifiedEnv } from './verified';

export const GOODDOLLAR_SERVER = 'https://goodserver.gooddollar.org';
const RPC_FALLBACK = 'https://forno.celo.org';
const WALLET = /^0x[0-9a-fA-F]{40}$/;
/** A claim uses about 250,000 gas (GoodDollar's own buffer). At 200 gwei that is 0.05 CELO, so ask below 0.06. */
const ENOUGH_WEI = 6n * 10n ** 16n;

export interface ClaimGasEnv extends VerifiedEnv {
  CLAIM_GAS_ENABLED?: string; // "false" switches this off at once
  ORDER_STORE?: Pick<KVNamespace, 'get' | 'put'>;
}

/** One ask per wallet per this long, so nobody can use our server to hammer GoodDollar's faucet for many wallets */
const ONCE_PER_SECONDS = 20 * 3600;

export type ClaimGasResult =
  | { ok: true; status: 'sent' | 'enough' }
  | { ok: false; reason: 'off' | 'bad_wallet' | 'not_verified' | 'refused' | 'too_soon' | 'error' };

export interface ClaimGasDeps {
  fetch: typeof fetch;
  verified: (wallet: string) => Promise<boolean | null>;
}

export async function askClaimGas(env: ClaimGasEnv, walletRaw: unknown, deps: ClaimGasDeps = { fetch, verified: (w) => isVerified(env, w) }): Promise<ClaimGasResult> {
  if (env.CLAIM_GAS_ENABLED === 'false') return { ok: false, reason: 'off' };
  if (typeof walletRaw !== 'string' || !WALLET.test(walletRaw)) return { ok: false, reason: 'bad_wallet' };
  const wallet = walletRaw.toLowerCase();
  try {
    const v = await deps.verified(wallet);
    if (v === null) return { ok: false, reason: 'error' };
    if (!v) return { ok: false, reason: 'not_verified' };

    const res = await deps.fetch(env.CELO_RPC_URL || RPC_FALLBACK, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_getBalance', params: [wallet, 'latest'] }),
    });
    const body = (await res.json()) as { result?: unknown };
    if (typeof body.result !== 'string' || !/^0x[0-9a-fA-F]+$/.test(body.result)) return { ok: false, reason: 'error' };
    if (BigInt(body.result) >= ENOUGH_WEI) return { ok: true, status: 'enough' };

    const marker = `claimgas:${wallet}`;
    if (env.ORDER_STORE && (await env.ORDER_STORE.get(marker)) !== null) return { ok: false, reason: 'too_soon' };
    // Written before asking, so many requests at once for one wallet still reach GoodDollar about once
    await env.ORDER_STORE?.put(marker, '1', { expirationTtl: ONCE_PER_SECONDS });

    const top = await deps.fetch(`${GOODDOLLAR_SERVER}/verify/topWallet`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chainId: 42220, account: wallet }),
      signal: AbortSignal.timeout(25_000),
    });
    const answer = (await top.json().catch(() => ({}))) as { ok?: unknown; error?: unknown };
    // A refusal comes back as HTTP 200 with { ok: -1, error }, so the body decides. The app still waits for the CELO to
    // actually arrive before it asks the person to claim.
    if (top.ok && answer.ok !== -1 && answer.ok !== 0 && !answer.error) return { ok: true, status: 'sent' };
    // GoodDollar's own reason ("not whitelisted", topped up recently...) is logged, never shown
    console.error('[claim-gas] GoodDollar did not top up:', typeof answer.error === 'string' ? answer.error.slice(0, 80) : top.status);
    return { ok: false, reason: 'refused' };
  } catch (e) {
    console.error('[claim-gas] failed:', (e as Error)?.name);
    return { ok: false, reason: 'error' };
  }
}
