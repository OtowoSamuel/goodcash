import { checkCashOutTransaction, CELO_RPC_DEFAULT, ROUTER_V2, type Hex } from './core';
import { GoodCashError, type GoodCashErrorCode } from './errors';
import type { Bank, CashOut, CreatedCashOut, Limits, Mode, NetworkFeeInfo, Page, PartnerInfo, Quote, Recipient } from './types';
import { findPaymentOnChain, sendTransaction, signerAddress, sleep, type Signer } from './wallet';

export const DEFAULT_BASE_URL = 'https://api.goodcash.xyz';
export const SDK_VERSION = '0.1.0';
const FINAL: CashOut['status'][] = ['paid', 'failed', 'refunded', 'expired'];

export interface GoodCashOptions {
  /** gc_pk_live_... / gc_pk_test_...: safe in browsers and apps (only works from your allowed sites/apps) */
  publishableKey?: string;
  /** gc_sk_live_... / gc_sk_test_...: servers only. Refused in browsers. */
  secretKey?: string;
  /** Your registered app id, for native apps and WebViews without a web origin */
  appId?: string;
  baseUrl?: string;
  /** Celo RPC used only to find a payment after a lost wallet reply */
  rpcUrl?: string;
  /** The GoodCash router the SDK will let a wallet pay into. Leave it alone outside tests. */
  routerAddress?: `0x${string}`;
  fetch?: typeof fetch;
}

export type CashOutStep = 'checking' | 'creating' | 'confirm_in_wallet' | 'confirming' | 'reporting' | 'done';

export interface CashOutArgs {
  /** The wallet that holds the G$ and signs. See Signer. */
  signer: Signer;
  /** The wallet address. Optional for browser wallets (read from the wallet); required for a send function. */
  wallet?: `0x${string}`;
  amountG: string | number;
  recipient: Recipient;
  /** The quote you showed the customer: its feePercent is checked by the server, so fees never differ from what was shown */
  quote: Pick<Quote, 'feePercent'>;
  partnerRef?: string;
  /** Re-use the same key when retrying the same attempt; one is made for you otherwise */
  idempotencyKey?: string;
  onStep?: (step: CashOutStep, cashOut?: CashOut) => void;
  /** Skip the CELO network-fee check (server wallets that manage their own gas) */
  skipNetworkFeeCheck?: boolean;
}

function randomKey(): string {
  const b = new Uint8Array(16);
  globalThis.crypto.getRandomValues(b);
  return `sdk_${Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')}`;
}

export class GoodCash {
  readonly mode: Mode;
  private readonly key: string;
  private readonly baseUrl: string;
  private readonly rpcUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly appId?: string;
  private readonly router: string;

  constructor(opts: GoodCashOptions) {
    const key = opts.secretKey ?? opts.publishableKey;
    if (!key) throw new GoodCashError('unauthorized', { message: 'Pass publishableKey (browsers, apps) or secretKey (servers).' });
    if (opts.secretKey && typeof (globalThis as { document?: unknown }).document !== 'undefined') {
      throw new GoodCashError('secret_key_in_browser', { detail: 'Never put a secret key in a web page. Use your publishable key here and keep the secret key on your server.' });
    }
    const m = /^gc_(pk|sk)_(live|test)_/.exec(key);
    if (!m) throw new GoodCashError('unauthorized', { detail: 'Keys start with gc_pk_ or gc_sk_.' });
    if (opts.secretKey && m[1] !== 'sk') throw new GoodCashError('unauthorized', { detail: 'secretKey must start with gc_sk_.' });
    if (opts.publishableKey && !opts.secretKey && m[1] !== 'pk') throw new GoodCashError('unauthorized', { detail: 'publishableKey must start with gc_pk_.' });
    this.key = key;
    this.mode = m[2] as Mode;
    this.baseUrl = (opts.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '');
    this.rpcUrl = opts.rpcUrl ?? CELO_RPC_DEFAULT;
    this.fetchImpl = opts.fetch ?? ((...a: Parameters<typeof fetch>) => globalThis.fetch(...a));
    this.appId = opts.appId;
    this.router = (opts.routerAddress ?? ROUTER_V2).toLowerCase();
  }

  // ---------------------------------------------------------------------------- raw API
  private async api<T>(method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<{ status: number; data: T }> {
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${this.key}`,
          ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
          ...(this.appId ? { 'X-GoodCash-App': this.appId } : {}),
          ...headers,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (e) {
      throw new GoodCashError('network_error', { detail: String((e as Error)?.message ?? e), cause: e });
    }
    const requestId = res.headers.get('GoodCash-Request-Id') ?? undefined;
    const data = (await res.json().catch(() => ({}))) as T & { error?: { code?: string; message?: string; detail?: string } };
    if (!res.ok) {
      const e = data?.error;
      throw new GoodCashError((e?.code as GoodCashErrorCode) ?? 'unavailable', { message: e?.message, detail: e?.detail, status: res.status, requestId });
    }
    return { status: res.status, data };
  }

  partner(): Promise<PartnerInfo> {
    return this.api<PartnerInfo>('GET', '/v1/partner').then((r) => r.data);
  }
  limits(): Promise<Limits> {
    return this.api<Limits>('GET', '/v1/limits').then((r) => r.data);
  }
  /** Banks, most used first. */
  async banks(): Promise<Bank[]> {
    const { data } = await this.api<Page<Bank>>('GET', '/v1/banks');
    return [...data.data].sort((a, b) => Number(b.popular) - Number(a.popular) || a.name.localeCompare(b.name));
  }
  /** The account holder's name. Show it to the customer before they confirm. */
  verifyAccount(args: { bankCode: string; accountNumber: string }): Promise<{ accountName: string }> {
    return this.api<{ accountName: string }>('POST', '/v1/banks/verify', args).then((r) => r.data);
  }
  /** What the customer gets, with every fee as its own line. Valid for about 30 seconds. */
  quote(args: { amountG: string | number }): Promise<Quote> {
    return this.api<Quote>('GET', `/v1/quote?amountG=${encodeURIComponent(String(args.amountG))}`).then((r) => r.data);
  }
  /** Whether the wallet holds enough CELO for the network fee (it is paid in CELO, never G$). */
  networkFee(args: { wallet: string }): Promise<NetworkFeeInfo> {
    return this.api<NetworkFeeInfo>('GET', `/v1/network-fee?wallet=${encodeURIComponent(args.wallet)}`).then((r) => r.data);
  }
  createCashOut(args: { wallet: string; amountG: string | number; recipient: Recipient; feePercentShown: number; partnerRef?: string; idempotencyKey?: string }): Promise<CreatedCashOut> {
    const { idempotencyKey, ...body } = args;
    return this.api<CreatedCashOut>('POST', '/v1/cashouts', { ...body, amountG: String(body.amountG) }, { 'Idempotency-Key': idempotencyKey ?? randomKey() }).then((r) => r.data);
  }
  /** Tell GoodCash the transaction hash. Checked on chain. Returns { pending: true } while it is not mined yet. */
  reportTransaction(id: string, txHash: string): Promise<CashOut & { pending?: boolean }> {
    return this.api<CashOut & { pending?: boolean }>('POST', `/v1/cashouts/${encodeURIComponent(id)}/transaction`, { txHash }).then((r) => r.data);
  }
  getCashOut(id: string): Promise<CashOut> {
    return this.api<CashOut>('GET', `/v1/cashouts/${encodeURIComponent(id)}`).then((r) => r.data);
  }
  listCashOuts(args: { wallet?: string; limit?: number; cursor?: string } = {}): Promise<Page<CashOut>> {
    const q = new URLSearchParams();
    if (args.wallet) q.set('wallet', args.wallet);
    if (args.limit) q.set('limit', String(args.limit));
    if (args.cursor) q.set('cursor', args.cursor);
    return this.api<Page<CashOut>>('GET', `/v1/cashouts${q.size ? `?${q}` : ''}`).then((r) => r.data);
  }
  /** Test keys only: pretend the transaction was sent, so the status moves on (paid after about 30 seconds). */
  simulate(id: string): Promise<CashOut> {
    if (this.mode !== 'test') return Promise.reject(new GoodCashError('test_mode_only'));
    return this.api<CashOut>('POST', `/v1/test/cashouts/${encodeURIComponent(id)}/simulate`).then((r) => r.data);
  }

  // ---------------------------------------------------------------------------- safety
  /**
   * The check before ANY wallet signs: the transaction must be exactly a one-tap cash out of the requested amount
   * to the GoodCash router, paying the order's own address no more than the guaranteed minimum, before the order
   * closes. Throws `unsafe_transaction` otherwise.
   */
  assertSafeTransaction(c: CreatedCashOut, expected: { amountG?: string | number } = {}): void {
    // The router is pinned in the SDK: even a consistent-looking answer may not send money anywhere else
    if (c.order.router.toLowerCase() !== this.router) throw new GoodCashError('unsafe_transaction', { detail: `Unexpected router ${c.order.router}.` });
    const amountWei = BigInt(c.order.amountWei);
    if (expected.amountG !== undefined) {
      const want = String(expected.amountG);
      if (want !== c.amountG) throw new GoodCashError('unsafe_transaction', { detail: `Amount ${c.amountG} differs from requested ${want}.` });
    }
    const problem = checkCashOutTransaction(
      c.transaction,
      { router: c.order.router, payTo: c.order.payTo, payAmount: BigInt(c.order.payAmount), amountWei, validUntilMs: new Date(c.order.validUntil).getTime(), orderId: c.id },
      Date.now()
    );
    // Test transactions carry a 1970 deadline on purpose (they can never succeed on chain)
    const allowed = this.mode === 'test' && (problem === 'deadline_passed' || problem === null);
    if (problem && !allowed) throw new GoodCashError(problem === 'order_expiring' ? 'order_expired' : 'unsafe_transaction', { detail: `Transaction check failed: ${problem}` });
  }

  // ---------------------------------------------------------------------------- the whole flow
  /**
   * Create, check, sign, report: the whole cash out in one call. Resolves once the transaction is confirmed and
   * reported (status "sent" or later); use watchCashOut for the payout itself.
   * Test keys never ask the wallet to sign: the cash out is simulated instead.
   */
  async cashOut(args: CashOutArgs): Promise<{ cashOut: CashOut; txHash: string }> {
    const step = args.onStep ?? (() => undefined);
    const wallet = args.wallet ?? (await signerAddress(args.signer));
    if (!wallet) throw new GoodCashError('no_wallet', { detail: 'Pass `wallet` when the signer is a send function.' });

    step('checking');
    if (this.mode === 'live' && !args.skipNetworkFeeCheck) {
      const fee = await this.networkFee({ wallet }).catch(() => null);
      if (fee && !fee.enough) throw new GoodCashError('needs_network_fee', { data: { ...fee } });
    }

    step('creating');
    const created = await this.createCashOut({
      wallet,
      amountG: args.amountG,
      recipient: args.recipient,
      feePercentShown: args.quote.feePercent,
      partnerRef: args.partnerRef,
      idempotencyKey: args.idempotencyKey,
    });
    this.assertSafeTransaction(created, { amountG: args.amountG });

    if (this.mode === 'test') {
      step('confirm_in_wallet', created);
      const sim = await this.simulate(created.id);
      step('done', sim);
      return { cashOut: sim, txHash: sim.txHash ?? '' };
    }

    step('confirm_in_wallet', created);
    let txHash: Hex;
    try {
      txHash = await sendTransaction(args.signer, created.transaction, wallet as `0x${string}`, this.rpcUrl);
    } catch (e) {
      if (!(e instanceof GoodCashError) || e.code !== 'uncertain') throw e;
      // Lost wallet reply: look for the payment before saying anything
      const found = await findPaymentOnChain({ wallet, payTo: created.order.payTo, router: created.order.router, rpcUrl: this.rpcUrl, fetchImpl: this.fetchImpl });
      if (!found) throw new GoodCashError('uncertain', { detail: e.detail, data: { cashOutId: created.id } });
      txHash = found;
    }

    step('confirming', created);
    step('reporting', created);
    const reported = await this.reportUntilMined(created.id, txHash);
    step('done', reported);
    return { cashOut: reported, txHash };
  }

  private async reportUntilMined(id: string, txHash: string, tries = 40): Promise<CashOut> {
    for (let i = 0; i < tries; i++) {
      const r = await this.reportTransaction(id, txHash);
      if (!r.pending) return r;
      await sleep(3000);
    }
    throw new GoodCashError('pending_confirmation', { data: { cashOutId: id, txHash } });
  }

  /**
   * Follow a cash out until it is paid (or failed/refunded/expired). Calls onChange on every status change.
   * Polls every 3 s, slowing to 15 s. Pass an AbortSignal to stop.
   */
  async watchCashOut(id: string, onChange: (c: CashOut) => void, opts: { signal?: AbortSignal; minIntervalMs?: number; maxIntervalMs?: number } = {}): Promise<CashOut> {
    let wait = opts.minIntervalMs ?? 3000;
    const max = opts.maxIntervalMs ?? 15000;
    let last: string | null = null;
    for (;;) {
      if (opts.signal?.aborted) throw new GoodCashError('unavailable', { detail: 'Aborted' });
      let c: CashOut | null = null;
      try {
        c = await this.getCashOut(id);
      } catch (e) {
        if (e instanceof GoodCashError && (e.code === 'not_found' || e.code === 'unauthorized' || e.code === 'partner_disabled')) throw e;
      }
      if (c) {
        if (c.status !== last) {
          last = c.status;
          onChange(c);
        }
        if (FINAL.includes(c.status)) return c;
      }
      await sleep(wait, opts.signal);
      wait = Math.min(Math.round(wait * 1.5), max);
    }
  }
}
