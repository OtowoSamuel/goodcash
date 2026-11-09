/**
 * Sending the one cash-out transaction from any wallet: a browser/mobile wallet (EIP-1193 provider such as
 * window.ethereum, WalletConnect, Magic, MiniPay), a viem WalletClient (including server wallets with a local
 * account), or your own send function (ethers, a custody API, ...).
 */
import { CASH_OUT_PAID_TOPIC, CELO_CHAIN_HEX, CELO_CHAIN_ID, CELO_RPC_DEFAULT, provesNothingWasSent, isUserRejection, type CashOutTransaction, type Hex } from './core';
import { GoodCashError } from './errors';

export interface Eip1193Provider {
  request(args: { method: string; params?: unknown[] | object }): Promise<unknown>;
}

/** The parts of a viem WalletClient we use (so viem stays optional). */
export interface ViemLikeWalletClient {
  account?: { address: `0x${string}`; type?: string };
  request: Eip1193Provider['request'];
  sendTransaction(args: { account: unknown; to: `0x${string}`; data: `0x${string}`; value: bigint; chain: null }): Promise<`0x${string}`>;
}

/** Your own sender: gets the transaction, returns its hash once it is broadcast. */
export type SendFunction = (tx: CashOutTransaction & { from: `0x${string}` }) => Promise<`0x${string}`>;

export type Signer = Eip1193Provider | ViemLikeWalletClient | SendFunction;

function isViem(s: Signer): s is ViemLikeWalletClient {
  return typeof s === 'object' && s !== null && typeof (s as ViemLikeWalletClient).sendTransaction === 'function' && typeof (s as ViemLikeWalletClient).request === 'function';
}

/** The wallet address behind a signer (asks the wallet if needed). */
export async function signerAddress(signer: Signer): Promise<`0x${string}` | null> {
  if (typeof signer === 'function') return null;
  if (isViem(signer) && signer.account?.address) return signer.account.address;
  const accounts = (await signer.request({ method: 'eth_accounts' }).catch(() => [])) as string[];
  if (accounts?.[0]) return accounts[0] as `0x${string}`;
  const asked = (await signer.request({ method: 'eth_requestAccounts' })) as string[];
  return (asked?.[0] as `0x${string}`) ?? null;
}

/** Ask the wallet to switch to Celo (adding Celo first if the wallet does not know it). */
export async function ensureCelo(provider: Eip1193Provider, rpcUrl = CELO_RPC_DEFAULT): Promise<void> {
  const current = (await provider.request({ method: 'eth_chainId' })) as string;
  if (parseInt(current, 16) === CELO_CHAIN_ID) return;
  try {
    await provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: CELO_CHAIN_HEX }] });
  } catch (e) {
    if (isUserRejection(e)) throw new GoodCashError('wrong_network', { detail: 'The customer declined switching to Celo.', cause: e });
    await provider.request({
      method: 'wallet_addEthereumChain',
      params: [{ chainId: CELO_CHAIN_HEX, chainName: 'Celo', nativeCurrency: { name: 'CELO', symbol: 'CELO', decimals: 18 }, rpcUrls: [rpcUrl], blockExplorerUrls: ['https://celo.blockscout.com'] }],
    });
  }
  const after = (await provider.request({ method: 'eth_chainId' })) as string;
  if (parseInt(after, 16) !== CELO_CHAIN_ID) throw new GoodCashError('wrong_network', { detail: `Wallet is on chain ${parseInt(after, 16)}.` });
}

/**
 * Send the transaction. Errors that PROVE nothing was sent (the customer said no, or the network refused it before
 * signing) are thrown as they are; anything else is thrown as `uncertain`, because it may have gone through.
 */
export async function sendTransaction(signer: Signer, tx: CashOutTransaction, from: `0x${string}`, rpcUrl?: string): Promise<Hex> {
  try {
    if (typeof signer === 'function') return await signer({ ...tx, from });
    if (isViem(signer) && signer.account?.type === 'local') {
      return await signer.sendTransaction({ account: signer.account, to: tx.to, data: tx.data, value: 0n, chain: null });
    }
    const provider = signer as Eip1193Provider;
    await ensureCelo(provider, rpcUrl);
    return (await provider.request({ method: 'eth_sendTransaction', params: [{ from, to: tx.to, data: tx.data, value: '0x0' }] })) as Hex;
  } catch (e) {
    if (e instanceof GoodCashError) throw e;
    if (isUserRejection(e)) throw new GoodCashError('wallet_rejected', { cause: e });
    if (provesNothingWasSent(e)) {
      const text = String((e as { message?: string })?.message ?? '');
      if (/insufficient funds|gas required exceeds/i.test(text)) throw new GoodCashError('needs_network_fee', { detail: text.slice(0, 200), cause: e });
      throw new GoodCashError('price_moved', { detail: `The network refused the transaction before signing: ${text.slice(0, 200)}`, cause: e });
    }
    throw new GoodCashError('uncertain', { detail: `The wallet did not confirm sending: ${String((e as Error)?.message ?? e).slice(0, 200)}`, cause: e });
  }
}

async function rpc(rpcUrl: string, method: string, params: unknown[], fetchImpl: typeof fetch): Promise<unknown> {
  const res = await fetchImpl(rpcUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
  const body = (await res.json()) as { result?: unknown; error?: { message?: string } };
  if (body.error) throw new Error(body.error.message ?? 'RPC error');
  return body.result;
}

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(t);
      reject(new GoodCashError('unavailable', { detail: 'Aborted' }));
    }, { once: true });
  });

/**
 * After a lost wallet reply: look on chain for a cash out from `wallet` paying `payTo` (the order's own address).
 * Returns its hash, or null if none is found after a few tries.
 */
export async function findPaymentOnChain(opts: {
  wallet: string;
  payTo: string;
  router: string;
  rpcUrl?: string;
  tries?: number;
  waitMs?: number;
  fetchImpl?: typeof fetch;
}): Promise<Hex | null> {
  const rpcUrl = opts.rpcUrl ?? CELO_RPC_DEFAULT;
  const f = opts.fetchImpl ?? fetch;
  const topic = (a: string) => `0x${a.toLowerCase().replace(/^0x/, '').padStart(64, '0')}`;
  for (let i = 0; i < (opts.tries ?? 8); i++) {
    try {
      const latest = BigInt((await rpc(rpcUrl, 'eth_blockNumber', [], f)) as string);
      const from = latest > 3000n ? latest - 3000n : 0n;
      const logs = (await rpc(rpcUrl, 'eth_getLogs', [{ address: opts.router, fromBlock: `0x${from.toString(16)}`, toBlock: 'latest', topics: [CASH_OUT_PAID_TOPIC, topic(opts.wallet), topic(opts.payTo)] }], f)) as Array<{ transactionHash: Hex }>;
      if (logs?.length) return logs[logs.length - 1].transactionHash;
    } catch {
      // try again
    }
    if (i < (opts.tries ?? 8) - 1) await sleep(opts.waitMs ?? 4000);
  }
  return null;
}

export { sleep };
