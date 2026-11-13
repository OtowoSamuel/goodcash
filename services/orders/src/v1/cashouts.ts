/**
 * Cash outs through the partner API. The server prices the cash out and builds the exact transaction, so partners
 * cannot get the maths wrong; the SDK re-checks that transaction before any wallet signs it.
 */
import { z } from 'zod';
import {
  buildOneTapTransaction,
  cashOutStatusFrom,
  checkCashOutTransaction,
  encodeBalanceOf,
  G_DOLLAR,
  isAddress,
  isTxHash,
  ONE_TAP_ROUTE,
  readWord,
  SELECTORS,
  type CashOutTransaction,
  type Hex,
} from '@goodcash/core';
import { V1Error } from './http';
import { clearWorkIfIdle, markWork, shouldList } from './work';
import { emitCashOutEvent, eventForStatus } from './webhooks';
import { ethCallVia, feeLines, parseAmountG, priceCashOut } from './pricing';
import type { AuthContext, CashOutRecord, Env, V1Deps } from './types';

/** Test mode: the transaction is built for real, but with a deadline in 1970 and a burn address, so it can never succeed on chain. */
export const TEST_PAY_TO = '0x000000000000000000000000000000000000dEaD';

const CreateSchema = z.object({
  wallet: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  amountG: z.union([z.string(), z.number()]),
  recipient: z.object({
    bankCode: z.string().min(2).max(20),
    accountNumber: z.string().regex(/^\d{10,20}$/),
    accountName: z.string().min(2).max(80),
  }),
  partnerRef: z.string().regex(/^[A-Za-z0-9_.:-]{1,64}$/).optional(),
  /** Total fee percent the customer was shown (GoodCash + partner). Must match, or nothing is created. */
  feePercentShown: z.number().min(0).max(5),
});

const IDEM_RE = /^[A-Za-z0-9_-]{8,64}$/;
const DAY = 86400;
const LIVE_TTL = 400 * DAY;
const TEST_TTL = 7 * DAY;

function inv(ts: number): string {
  return String(9_999_999_999_999 - ts).padStart(13, '0');
}

async function bodyHash(text: string): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(d), (b) => b.toString(16).padStart(2, '0')).join('').slice(0, 32);
}

export async function loadCashOut(env: Env, ctx: AuthContext, id: string): Promise<CashOutRecord> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new V1Error('not_found', 'Cash out ids look like UUIDs.');
  const raw = await env.ORDER_STORE.get(`pc:${id}`);
  const rec = raw ? (JSON.parse(raw) as CashOutRecord) : null;
  // Another partner's (or the other mode's) cash out is simply "not found"
  if (!rec || rec.partnerId !== ctx.partner.id || rec.mode !== ctx.mode) throw new V1Error('not_found');
  return rec;
}

async function saveCashOut(env: Env, rec: CashOutRecord): Promise<void> {
  await env.ORDER_STORE.put(`pc:${rec.id}`, JSON.stringify(rec), { expirationTtl: rec.mode === 'test' ? TEST_TTL : LIVE_TTL });
}

/** The plain public view of a cash out. */
export function publicCashOut(rec: CashOutRecord) {
  return {
    id: rec.id,
    object: 'cashout',
    mode: rec.mode,
    status: rec.status,
    wallet: rec.wallet,
    amountG: rec.amountG,
    receive: { naira: rec.naira, minimumNaira: rec.minimumNaira },
    feePercent: rec.feePercent,
    partnerRef: rec.partnerRef ?? null,
    txHash: rec.txHash ?? null,
    expiresAt: rec.validUntil,
    createdAt: new Date(rec.createdAt).toISOString(),
    updatedAt: new Date(rec.updatedAt).toISOString(),
    paidAt: rec.paidAt ? new Date(rec.paidAt).toISOString() : null,
  };
}

function testOutcome(accountNumber: string): CashOutRecord['testOutcome'] {
  if (accountNumber === '0000000001') return 'failed';
  if (accountNumber === '0000000002') return 'refunded';
  if (accountNumber === '0000000003') return 'delayed';
  return 'paid';
}

export async function createCashOut(request: Request, env: Env, ctx: AuthContext, deps: V1Deps): Promise<{ status: number; body: unknown }> {
  const idem = request.headers.get('Idempotency-Key') ?? '';
  if (!IDEM_RE.test(idem)) throw new V1Error('invalid_request', 'Send an Idempotency-Key header (8-64 letters, digits, - or _), unique per cash out attempt.');
  const text = await request.text();
  const hash = await bodyHash(text);
  const idemKey = `idem:${ctx.partner.id}:${ctx.mode}:${idem}`;
  const seen = await env.ORDER_STORE.get(idemKey);
  if (seen) {
    const prior = JSON.parse(seen) as { hash: string; status?: number; body?: unknown; pending?: boolean; at?: number };
    if (prior.hash !== hash) throw new V1Error('idempotency_conflict', 'This Idempotency-Key was used with a different request body.');
    if (!prior.pending) return { status: prior.status as number, body: prior.body };
    // The same request is being set up right now: do not start a second payout order for it
    if (Date.now() - (prior.at ?? 0) < IDEM_PENDING_MS) throw new V1Error('idempotency_in_progress');
    // Older than that: the first try most likely died. Starting again is allowed (an unused payout order just expires).
  }

  let parsedBody: unknown;
  try {
    parsedBody = JSON.parse(text);
  } catch {
    throw new V1Error('invalid_request', 'The body must be JSON.');
  }
  const parsed = CreateSchema.safeParse(parsedBody);
  if (!parsed.success) {
    const fields = [...new Set(parsed.error.issues.map((i) => i.path.join('.') || '(body)'))].join(', ');
    throw new V1Error('invalid_request', `Check these fields: ${fields}.`);
  }
  const input = parsed.data;
  const wallet = input.wallet.toLowerCase();
  const { amountG, amountWei } = parseAmountG(input.amountG);

  // Reserve this key BEFORE anything is created at the payout partner, so a repeat or a crash cannot make two orders
  await env.ORDER_STORE.put(idemKey, JSON.stringify({ hash, pending: true, at: Date.now() }), { expirationTtl: 600 });
  try {
    return await createReserved(env, ctx, deps, { idemKey, hash, input, wallet, amountG, amountWei });
  } catch (e) {
    // Nothing was created, so the same key may be used again
    await env.ORDER_STORE.delete(idemKey).catch(() => undefined);
    throw e;
  }
}

/** How long a reserved key blocks a repeat of the same request. */
const IDEM_PENDING_MS = 2 * 60_000;

async function createReserved(
  env: Env,
  ctx: AuthContext,
  deps: V1Deps,
  a: { idemKey: string; hash: string; input: z.infer<typeof CreateSchema>; wallet: string; amountG: string; amountWei: bigint }
): Promise<{ status: number; body: unknown }> {
  const { idemKey, hash, input, wallet, amountG, amountWei } = a;

  // One wallet cannot flood orders (shared limit with the app's per-visitor limiter)
  if (env.RATE_LIMITER) {
    try {
      const { success } = await env.RATE_LIMITER.limit({ key: `v1-create:${ctx.partner.id}:${wallet}` });
      if (!success) throw new V1Error('rate_limited', 'At most a few new cash outs per wallet per minute.');
    } catch (e) {
      if (e instanceof V1Error) throw e;
    }
  }

  const priced = await priceCashOut(env, deps, ctx.partner, ctx.mode, amountG, amountWei);
  if (Math.abs(input.feePercentShown - priced.feePercent) > 1e-9) {
    throw new V1Error('fee_mismatch', `The fee is ${priced.feePercent}% but the customer was shown ${input.feePercentShown}%. Get a new quote and show it.`);
  }
  if (priced.minimumNaira <= 0) throw new V1Error('amount_too_small');

  const router = (env.ROUTER_V2_ADDRESS ?? '') as Hex;
  if (!isAddress(router)) throw new V1Error('unavailable', 'One-tap cash out is not switched on on this server.');
  const now = Date.now();
  let id: string;
  let payTo: Hex;
  let payAmount: bigint;
  let validUntilMs: number;
  let deadline: bigint;
  let naira = priced.naira;
  let orderAmountUsdt: string | undefined;
  let feeCharged = priced.feePercent === 0;

  if (ctx.mode === 'test') {
    id = crypto.randomUUID();
    payTo = TEST_PAY_TO;
    // Roughly what a real order would ask for; never above the minimum
    payAmount = priced.minOut - 20_000n > 0n ? ((priced.minOut - 20_000n) * 10_000n) / (10_000n + BigInt(Math.round(priced.feePercent * 100))) : 1n;
    validUntilMs = now + 30 * 60_000;
    deadline = 1n; // 1970: the router refuses it, so a test transaction can never move money
  } else {
    const ethCall = ethCallVia(env, deps);
    try {
      const paused = readWord(await ethCall(router, SELECTORS.paused as Hex), 0);
      if (paused !== 0n) throw new V1Error('cashout_paused');
      const bal = readWord(await ethCall(G_DOLLAR, encodeBalanceOf(wallet as Hex)), 0);
      if (bal < amountWei) throw new V1Error('insufficient_balance');
    } catch (e) {
      if (e instanceof V1Error) throw e;
      throw new V1Error('unavailable', 'Could not read the wallet balance or router state on Celo.');
    }
    const created = await deps.createSizedOneTapOrder(env, {
      minUsdtAtomic: priced.minOut,
      refundAddress: wallet,
      recipient: { institution: input.recipient.bankCode, accountIdentifier: input.recipient.accountNumber, accountName: input.recipient.accountName, memo: 'GoodCash' },
      reference: deps.generateRef('gcp'),
      feePercentOverride: priced.feePercent,
    });
    if ('response' in created) {
      if (created.reason === 'amount_too_small') throw new V1Error('amount_too_small');
      const detail = ((await created.response.json().catch(() => ({}))) as { error?: string }).error;
      throw new V1Error('unavailable', detail ? `Payout partner: ${detail}` : undefined);
    }
    id = created.order.id;
    payTo = created.receive as Hex;
    payAmount = created.payAmountAtomic;
    validUntilMs = new Date(created.order.providerAccount.validUntil).getTime();
    deadline = BigInt(Math.floor(Math.min(now + 20 * 60_000, validUntilMs - 60_000) / 1000));
    orderAmountUsdt = created.order.amount;
    // If the payout partner refused our fee setting, the order went through without it: nobody is credited a fee
    feeCharged = priced.feePercent === 0 || Number(created.order.senderFee ?? 0) > 0;
    const exact = Number(created.order.amount) * Number(created.order.rate);
    if (Number.isFinite(exact) && exact > 0) naira = Math.floor(exact * 100) / 100;
  }

  const transaction: CashOutTransaction = buildOneTapTransaction({
    router,
    amountWei,
    route: ONE_TAP_ROUTE.reserve,
    minOut: priced.minOut,
    deadline,
    payTo,
    payAmount,
    orderId: id,
  });
  if (ctx.mode === 'live') {
    // Belt and braces: our own transaction must pass the same check the SDK runs
    const problem = checkCashOutTransaction(transaction, { router, payTo, payAmount, amountWei, validUntilMs, orderId: id }, now);
    if (problem) {
      console.error(`[v1] built transaction failed its own check: ${problem}`);
      throw new V1Error('unavailable');
    }
  }

  const rec: CashOutRecord = {
    id,
    partnerId: ctx.partner.id,
    mode: ctx.mode,
    wallet,
    amountG,
    amountWei: amountWei.toString(),
    router,
    payTo,
    payAmount: payAmount.toString(),
    minOut: priced.minOut.toString(),
    validUntil: new Date(validUntilMs).toISOString(),
    naira,
    minimumNaira: priced.minimumNaira,
    feePercent: priced.feePercent,
    goodcashFeePercent: priced.goodcashFeePercent,
    partnerFeePercent: priced.partnerFeePercent,
    partnerRef: input.partnerRef,
    ...(orderAmountUsdt ? { orderAmountUsdt, feeCharged } : {}),
    status: 'awaiting_signature',
    ...(ctx.mode === 'test' ? { testOutcome: testOutcome(input.recipient.accountNumber) } : {}),
    createdAt: now,
    updatedAt: now,
  };
  await saveCashOut(env, rec);
  const ttl = ctx.mode === 'test' ? TEST_TTL : LIVE_TTL;
  await env.ORDER_STORE.put(`pcl:${ctx.partner.id}:${ctx.mode}:${wallet}:${inv(now)}:${id}`, '1', { expirationTtl: ttl });
  await env.ORDER_STORE.put(`pca:${ctx.partner.id}:${ctx.mode}:${inv(now)}:${id}`, '1', { expirationTtl: ttl });
  // Open cash outs the schedule keeps an eye on (for webhooks when nobody is polling)
  await env.ORDER_STORE.put(`pcopen:${id}`, '1', { expirationTtl: 3 * DAY });
  await markWork(env, 'pcopen');

  const body = {
    ...publicCashOut(rec),
    fees: feeLines(priced, ctx.partner.name),
    transaction,
    // What the SDK checks before signing
    order: { router, payTo, payAmount: payAmount.toString(), amountWei: amountWei.toString(), minOut: priced.minOut.toString(), validUntil: rec.validUntil },
    ...(ctx.mode === 'test' ? { test: { note: 'Test mode: do not send this transaction. Call POST /v1/test/cashouts/{id}/simulate (or report any hash) to move it along.' } } : {}),
  };
  await env.ORDER_STORE.put(idemKey, JSON.stringify({ hash, status: 201, body }), { expirationTtl: DAY });
  return { status: 201, body };
}

/** Simulated timeline for test cash outs: sent -> processing (5 s) -> outcome (30 s). */
export function testStatus(rec: CashOutRecord, now = Date.now()): { status: string; paidAt?: number; delayed?: boolean } {
  if (!rec.sentAt) return { status: now > new Date(rec.validUntil).getTime() ? 'expired' : 'awaiting_signature' };
  const t = now - rec.sentAt;
  if (t < 5_000) return { status: 'sent' };
  if (t < 30_000) return { status: 'processing' };
  switch (rec.testOutcome) {
    case 'failed':
      return { status: 'failed' };
    case 'refunded':
      return { status: 'refunded' };
    case 'delayed':
      return { status: 'processing', delayed: true };
    default:
      return { status: 'paid', paidAt: rec.sentAt + 30_000 };
  }
}

/** Bring a record's status up to date (live: ask the payout partner; test: the simulated timeline). */
export async function refreshCashOut(env: Env, rec: CashOutRecord, deps: V1Deps): Promise<{ rec: CashOutRecord; changed: boolean; delayed?: boolean }> {
  const before = rec.status;
  let delayed = false;
  if (rec.mode === 'test') {
    const t = testStatus(rec);
    rec.status = t.status;
    if (t.paidAt) rec.paidAt = t.paidAt;
    delayed = !!t.delayed;
  } else if (!['paid', 'failed', 'refunded', 'expired'].includes(rec.status)) {
    const partnerStatus = await deps.lookupOrderStatus(rec.id, env);
    let next = cashOutStatusFrom(partnerStatus, !!rec.txHash);
    if (next === 'awaiting_signature' && Date.now() > new Date(rec.validUntil).getTime()) next = 'expired';
    rec.status = next;
    if (next === 'paid' && !rec.paidAt) rec.paidAt = Date.now();
  }
  const changed = rec.status !== before;
  if (changed) {
    rec.updatedAt = Date.now();
    await saveCashOut(env, rec);
    if (rec.status === 'paid') await recordLedger(env, rec);
  }
  return { rec, changed, delayed };
}

export async function reportTransaction(request: Request, env: Env, ctx: AuthContext, deps: V1Deps, id: string) {
  const rec = await loadCashOut(env, ctx, id);
  let body: { txHash?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    throw new V1Error('invalid_request', 'The body must be JSON: { "txHash": "0x..." }.');
  }
  if (!isTxHash(body.txHash)) throw new V1Error('invalid_request', 'txHash must be a 0x-prefixed 32-byte hash.');
  const txHash = body.txHash.toLowerCase();
  if (rec.txHash && rec.txHash !== txHash) throw new V1Error('transaction_mismatch', 'A different transaction was already reported for this cash out.');

  if (ctx.mode === 'test') {
    if (!rec.sentAt) {
      rec.txHash = txHash;
      rec.sentAt = Date.now();
      rec.status = 'sent';
      rec.updatedAt = Date.now();
      await saveCashOut(env, rec);
    }
    return { status: 200, body: publicCashOut(rec) };
  }

  const linked = await deps.linkOneTapSwap(rec.id, txHash, rec.wallet, env);
  if ('pending' in linked) {
    return { status: 202, body: { ...publicCashOut(rec), pending: true } };
  }
  if ('error' in linked) {
    if (linked.reason === 'unavailable') throw new V1Error('unavailable', linked.error);
    if (linked.reason === 'not_found') throw new V1Error('not_found', linked.error);
    throw new V1Error('transaction_mismatch', `${linked.reason}: ${linked.error}`);
  }
  rec.txHash = txHash;
  rec.sentAt = rec.sentAt ?? Date.now();
  if (rec.status === 'awaiting_signature' || rec.status === 'expired') rec.status = 'sent';
  rec.updatedAt = Date.now();
  await saveCashOut(env, rec);
  const { rec: fresh } = await refreshCashOut(env, rec, deps);
  return { status: 200, body: publicCashOut(fresh) };
}

export async function listCashOuts(env: Env, ctx: AuthContext, url: URL) {
  const walletParam = url.searchParams.get('wallet');
  const wallet = walletParam ? walletParam.toLowerCase() : null;
  if (wallet && !isAddress(wallet)) throw new V1Error('invalid_request', 'wallet must be a 0x address.');
  if (!wallet && ctx.kind !== 'sk') throw new V1Error('secret_key_required', 'Listing every cash out needs your secret key. With a publishable key, pass ?wallet=0x...');
  const limit = Math.min(Math.max(Number(url.searchParams.get('limit') ?? '20') || 20, 1), 100);
  const cursor = url.searchParams.get('cursor') ?? undefined;
  const prefix = wallet ? `pcl:${ctx.partner.id}:${ctx.mode}:${wallet}:` : `pca:${ctx.partner.id}:${ctx.mode}:`;
  const page = await env.ORDER_STORE.list({ prefix, limit, cursor });
  const items = [];
  for (const k of page.keys) {
    const id = k.name.slice(k.name.lastIndexOf(':') + 1);
    const raw = await env.ORDER_STORE.get(`pc:${id}`);
    if (raw) items.push(publicCashOut(JSON.parse(raw) as CashOutRecord));
  }
  return { object: 'list', data: items, nextCursor: page.list_complete ? null : (page as { cursor?: string }).cursor ?? null };
}

const FINAL = new Set(['paid', 'failed', 'refunded', 'expired']);
/** A payout counts as late after this long (same as the team alert). */
export const DELAYED_AFTER_MS = 25 * 60_000;

/** After a refresh: tell the partner about a new final status (or a late payout), and stop watching finished ones. */
export async function notifyChange(
  env: Env,
  rec: CashOutRecord,
  changed: boolean,
  delayed: boolean,
  waitUntil?: (p: Promise<unknown>) => void
): Promise<void> {
  if (changed) {
    const type = eventForStatus(rec.status);
    if (type) await emitCashOutEvent(env, rec, type, publicCashOut(rec), waitUntil);
  }
  const late = delayed || (rec.mode === 'live' && !!rec.sentAt && (rec.status === 'sent' || rec.status === 'processing') && Date.now() - rec.sentAt > DELAYED_AFTER_MS);
  if (late) await emitCashOutEvent(env, rec, 'cashout.delayed', publicCashOut(rec), waitUntil);
  if (FINAL.has(rec.status)) await env.ORDER_STORE.delete(`pcopen:${rec.id}`);
}

/** Refresh open cash outs on the schedule, so partners get webhooks even when nobody is polling. */
export async function sweepOpenCashOuts(env: Env, deps: V1Deps): Promise<{ checked: number }> {
  if (!(await shouldList(env, 'pcopen'))) return { checked: 0 };
  const startedAt = Date.now();
  const page = await env.ORDER_STORE.list({ prefix: 'pcopen:', limit: 50 });
  if (page.keys.length === 0 && page.list_complete !== false) await clearWorkIfIdle(env, 'pcopen', startedAt);
  let checked = 0;
  for (const k of page.keys) {
    const id = k.name.slice('pcopen:'.length);
    const raw = await env.ORDER_STORE.get(`pc:${id}`);
    if (!raw) {
      await env.ORDER_STORE.delete(k.name);
      continue;
    }
    checked++;
    const { rec, changed, delayed } = await refreshCashOut(env, JSON.parse(raw) as CashOutRecord, deps);
    await notifyChange(env, rec, changed, !!delayed);
  }
  return { checked };
}

/**
 * Partner fee ledger (fee option A): one entry per paid live cash out, `ledger:<partner>:<YYYY-MM>:<id>`, so monthly
 * partner payouts can be totalled (scripts/partners.mjs ledger). Written once; never overwritten.
 */
export async function recordLedger(env: Env, rec: CashOutRecord): Promise<void> {
  if (rec.mode !== 'live' || !rec.orderAmountUsdt) return;
  const month = new Date(rec.paidAt ?? Date.now()).toISOString().slice(0, 7);
  const key = `ledger:${rec.partnerId}:${month}:${rec.id}`;
  if (await env.ORDER_STORE.get(key)) return;
  const payout = Number(rec.orderAmountUsdt);
  const charged = rec.feeCharged === true;
  const share = (pct: number) => (charged && Number.isFinite(payout) ? Math.round(payout * (pct / 100) * 1e6) / 1e6 : 0);
  await env.ORDER_STORE.put(
    key,
    JSON.stringify({
      cashOutId: rec.id,
      paidAt: new Date(rec.paidAt ?? Date.now()).toISOString(),
      payoutUsdt: rec.orderAmountUsdt,
      naira: rec.naira,
      feeCharged: charged,
      goodcashFeePercent: rec.goodcashFeePercent,
      partnerFeePercent: rec.partnerFeePercent,
      goodcashFeeUsdt: share(rec.goodcashFeePercent),
      partnerFeeUsdt: share(rec.partnerFeePercent),
    }),
    { expirationTtl: 3 * 365 * 86400 }
  );
}
