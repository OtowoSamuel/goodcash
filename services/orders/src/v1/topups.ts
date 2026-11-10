/**
 * Partner top-ups: the customer pays naira from their bank and receives G$ (or CELO) in their own wallet.
 *
 * The customer's ID details (BVN/NIN) are NEVER handled here. They are typed on pay.goodcash.xyz and go straight to the
 * payout partner through the existing app order endpoint; this module only learns the order's id and follows it.
 * A top-up record holds: partner, wallet, naira amount, asset, status. No ID details, no bank details.
 *
 *   GET  /v1/topup/quote?amountNaira=&asset=   what the customer would get (fees as their own lines)
 *   POST /v1/topups                            register a top-up (the widget does this after the order exists)
 *   GET  /v1/topups/{id}                       status
 *   GET  /v1/topups                            list (secret key)
 *
 * Off unless PARTNER_ONRAMP_ENABLED is "true". In live mode a partner also needs `topupEnabled` (set when GoodCash approves live keys, or with partners.mjs update --topups).
 * Test mode is simulated end to end (no payout partner, no chain).
 */
import { isAddress } from '@goodcash/core';
import { V1Error, v1Json } from './http';
import { clearWorkIfIdle, markWork, shouldList } from './work';
import { emitTopUpEvent, type EventType } from './webhooks';
import type { AuthContext, Env, Mode, Partner, TopUpAsset, TopUpRecord, TopUpStatus, V1Deps } from './types';

export const TOPUP_MIN_NAIRA = 1000;
export const TOPUP_MAX_NAIRA = 2_000_000;
const ASSETS: TopUpAsset[] = ['g', 'celo'];
const ORDER_ID_RE = /^[0-9a-f-]{36}$/;
const ID_RE = /^tu_[0-9a-f]{24}$/;
const FINAL: TopUpStatus[] = ['delivered', 'failed', 'expired'];

/** Test mode timing: waiting, then the naira lands, then the asset is delivered. An amount ending in 13 fails. */
export const TEST_PAID_AFTER_MS = 5_000;
export const TEST_DELIVERED_AFTER_MS = 15_000;
const TEST_NGN_PER_USD = 1500;
const TEST_FEE_USD = 0.02;
const TEST_SWAP_FEE_USD = 0.01;
const TEST_USD_PER = { g: 0.0001129, celo: 0.3 } as const;

function newId(): string {
  const b = crypto.getRandomValues(new Uint8Array(12));
  return `tu_${Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')}`;
}

export function onrampSwitchOn(env: Env): boolean {
  return env.PARTNER_ONRAMP_ENABLED === 'true';
}

/** Throws unless top-ups are on for everyone and (for live mode) for this partner. */
export function requireTopUps(env: Env, ctx: AuthContext): void {
  if (!onrampSwitchOn(env)) throw new V1Error('not_found', undefined, 'Not found');
  if (ctx.mode === 'live' && !ctx.partner.topupEnabled) {
    throw new V1Error('topups_not_enabled', 'Top-ups are not switched on for this partner yet. Contact GoodCash.');
  }
}

function parseAmount(v: string | number | null | undefined): number {
  const n = Number(v);
  if (!Number.isFinite(n) || !Number.isInteger(n)) throw new V1Error('invalid_request', 'amountNaira must be a whole number of naira, like 5000.');
  if (n < TOPUP_MIN_NAIRA) throw new V1Error('amount_too_small', `The least a customer can add is ₦${TOPUP_MIN_NAIRA.toLocaleString('en-US')}.`);
  if (n > TOPUP_MAX_NAIRA) throw new V1Error('amount_too_large', undefined);
  return n;
}

function parseAsset(v: unknown): TopUpAsset {
  if (v === undefined || v === null || v === '') return 'g';
  if (typeof v === 'string' && (ASSETS as string[]).includes(v)) return v as TopUpAsset;
  throw new V1Error('invalid_request', 'asset must be "g" (G$) or "celo".');
}

export function publicTopUp(r: TopUpRecord) {
  return {
    id: r.id,
    object: 'topup',
    mode: r.mode,
    status: r.status,
    amountNaira: r.naira,
    asset: r.asset,
    wallet: r.wallet,
    partnerRef: r.partnerRef ?? null,
    ...(r.txHash ? { txHash: r.txHash } : {}),
    createdAt: new Date(r.createdAt).toISOString(),
    updatedAt: new Date(r.updatedAt).toISOString(),
    ...(r.deliveredAt ? { deliveredAt: new Date(r.deliveredAt).toISOString() } : {}),
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Quote
// ---------------------------------------------------------------------------------------------------------------

export async function topUpQuote(env: Env, ctx: AuthContext, deps: V1Deps, url: URL): Promise<Response> {
  requireTopUps(env, ctx);
  const naira = parseAmount(url.searchParams.get('amountNaira'));
  const asset = parseAsset(url.searchParams.get('asset'));
  const wallet = url.searchParams.get('wallet') ?? '';
  if (wallet && !isAddress(wallet)) throw new V1Error('invalid_request', 'wallet must be a 0x address.');

  if (ctx.mode === 'test') {
    const usd = naira / TEST_NGN_PER_USD - TEST_FEE_USD;
    const net = Math.max(usd - TEST_SWAP_FEE_USD, 0);
    const out = net / TEST_USD_PER[asset];
    return v1Json({
      object: 'topup_quote',
      mode: 'test',
      amountNaira: naira,
      asset,
      youGet: { amount: round(out, asset), minimum: round(out * 0.99, asset) },
      fees: [
        { label: 'Payment partner fee', usd: TEST_FEE_USD },
        { label: 'Network and exchange fee', usd: TEST_SWAP_FEE_USD },
      ],
      minimumNaira: TOPUP_MIN_NAIRA,
      validForSeconds: 30,
    });
  }

  const q = await deps.onrampQuote(env, { naira, asset, wallet });
  if ('error' in q) throw new V1Error(q.status === 400 ? 'invalid_request' : 'unavailable', undefined, q.error);
  return v1Json({
    object: 'topup_quote',
    mode: 'live',
    amountNaira: naira,
    asset,
    youGet: { amount: round(q.amountOut, asset), minimum: round(q.amountOutMin, asset) },
    fees: [
      { label: 'Payment partner fee', usd: q.partnerFeeUsd },
      { label: 'Network and exchange fee', usd: q.swapFeeUsd },
    ],
    minimumNaira: q.minNaira,
    validForSeconds: q.validForSeconds,
  });
}

function round(n: number, asset: TopUpAsset): number {
  return asset === 'celo' ? Math.floor(n * 100) / 100 : Math.floor(n);
}

// ---------------------------------------------------------------------------------------------------------------
// Register, read, list
// ---------------------------------------------------------------------------------------------------------------

async function save(env: Env, r: TopUpRecord): Promise<void> {
  await env.ORDER_STORE.put(`pt:${r.id}`, JSON.stringify(r), { expirationTtl: (r.mode === 'test' ? 7 : 400) * 86400 });
}

export async function loadTopUp(env: Env, id: string): Promise<TopUpRecord | null> {
  if (!ID_RE.test(id)) return null;
  const raw = await env.ORDER_STORE.get(`pt:${id}`);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as TopUpRecord;
  } catch {
    return null;
  }
}

function ownTopUp(rec: TopUpRecord | null, ctx: AuthContext): TopUpRecord {
  if (!rec || rec.partnerId !== ctx.partner.id || rec.mode !== ctx.mode) throw new V1Error('not_found', undefined, "We couldn't find that top-up.");
  return rec;
}

export async function createTopUp(request: Request, env: Env, ctx: AuthContext, deps: V1Deps): Promise<Response> {
  requireTopUps(env, ctx);
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    throw new V1Error('invalid_request', 'The body must be JSON.');
  }
  const wallet = typeof body.wallet === 'string' ? body.wallet.toLowerCase() : '';
  if (!isAddress(wallet)) throw new V1Error('invalid_request', 'wallet must be the 0x address that will receive the G$ or CELO.');
  const naira = parseAmount(body.amountNaira as string | number);
  const asset = parseAsset(body.asset);
  const partnerRef = typeof body.partnerRef === 'string' && body.partnerRef.length <= 100 ? body.partnerRef : undefined;
  const now = Date.now();
  const rec: TopUpRecord = { id: newId(), partnerId: ctx.partner.id, mode: ctx.mode, wallet, naira, asset, status: 'awaiting_payment', partnerRef, createdAt: now, updatedAt: now };

  if (ctx.mode === 'live') {
    const orderId = typeof body.orderId === 'string' ? body.orderId : '';
    if (!ORDER_ID_RE.test(orderId)) throw new V1Error('invalid_request', 'orderId (from the GoodCash order) is required in live mode.');
    // The order must exist, belong to this wallet, and match the amount and asset. Nobody can attach someone else's order.
    const known = await deps.onrampOrderMeta(env, orderId);
    if (!known || known.wallet.toLowerCase() !== wallet || known.naira !== naira || known.asset !== asset) {
      throw new V1Error('invalid_request', 'That order was not found for this wallet and amount.');
    }
    const taken = await env.ORDER_STORE.get(`ptorder:${orderId}`);
    if (taken) {
      const prior = await loadTopUp(env, taken);
      if (prior && prior.partnerId === ctx.partner.id) return v1Json(publicTopUp(prior)); // registering twice is harmless
      throw new V1Error('invalid_request', 'That order is already registered.');
    }
    rec.orderId = orderId;
    await env.ORDER_STORE.put(`ptorder:${orderId}`, rec.id, { expirationTtl: 400 * 86400 });
  }

  await save(env, rec);
  await env.ORDER_STORE.put(`pta:${ctx.partner.id}:${ctx.mode}:${String(now).padStart(13, '0')}:${rec.id}`, '1', { expirationTtl: (ctx.mode === 'test' ? 7 : 400) * 86400 });
  await env.ORDER_STORE.put(`ptopen:${rec.id}`, '1', { expirationTtl: 30 * 86400 });
  await markWork(env, 'ptopen');
  return v1Json(publicTopUp(rec), 201);
}

export async function getTopUp(env: Env, ctx: AuthContext, deps: V1Deps, id: string, waitUntil?: (p: Promise<unknown>) => void): Promise<Response> {
  requireTopUps(env, ctx);
  const rec = ownTopUp(await loadTopUp(env, id), ctx);
  const { rec: fresh, changed } = await refreshTopUp(env, rec, deps);
  await notifyTopUp(env, fresh, changed, waitUntil);
  return v1Json(publicTopUp(fresh));
}

export async function listTopUps(env: Env, ctx: AuthContext, url: URL): Promise<Response> {
  requireTopUps(env, ctx);
  if (ctx.kind !== 'sk') throw new V1Error('secret_key_required', 'Listing top-ups needs your secret key (gc_sk_...), from your server.');
  const limit = Math.min(Math.max(Number(url.searchParams.get('limit') ?? '20') || 20, 1), 100);
  const cursor = url.searchParams.get('cursor') ?? undefined;
  const page = await env.ORDER_STORE.list({ prefix: `pta:${ctx.partner.id}:${ctx.mode}:`, limit, cursor });
  const items = [];
  for (const k of page.keys) {
    const raw = await env.ORDER_STORE.get(`pt:${k.name.slice(k.name.lastIndexOf(':') + 1)}`);
    if (raw) items.push(publicTopUp(JSON.parse(raw) as TopUpRecord));
  }
  return v1Json({ object: 'list', data: items, nextCursor: page.list_complete ? null : (page as { cursor?: string }).cursor ?? null });
}

// ---------------------------------------------------------------------------------------------------------------
// Following an order, and telling the partner
// ---------------------------------------------------------------------------------------------------------------

/** Our status from the payout partner's stage (plus whether the G$/CELO has reached the wallet). */
export function statusFromStage(stage: string, arrived: boolean): TopUpStatus {
  if (stage === 'done') return arrived ? 'delivered' : 'paid_in';
  if (stage === 'received') return 'paid_in';
  if (stage === 'expired') return 'expired';
  if (stage === 'refund') return 'failed';
  return 'awaiting_payment'; // waiting, or "review" (the payment is being checked)
}

export function testStatus(rec: TopUpRecord, now: number): TopUpStatus {
  const age = now - rec.createdAt;
  if (rec.naira % 100 === 13) return age >= TEST_PAID_AFTER_MS ? 'failed' : 'awaiting_payment';
  if (age >= TEST_DELIVERED_AFTER_MS) return 'delivered';
  if (age >= TEST_PAID_AFTER_MS) return 'paid_in';
  return 'awaiting_payment';
}

export async function refreshTopUp(env: Env, rec: TopUpRecord, deps: V1Deps, now = Date.now()): Promise<{ rec: TopUpRecord; changed: boolean }> {
  if (FINAL.includes(rec.status)) return { rec, changed: false };
  let status = rec.status;
  let txHash = rec.txHash;
  if (rec.mode === 'test') {
    status = testStatus(rec, now);
  } else if (rec.orderId) {
    const o = await deps.onrampOrderStatus(env, rec.orderId);
    if (!o) return { rec, changed: false }; // the payout partner could not be reached: try again later
    status = statusFromStage(o.stage, o.arrived);
    if (o.txHash) txHash = o.txHash;
  }
  if (status === rec.status && txHash === rec.txHash) return { rec, changed: false };
  const next: TopUpRecord = { ...rec, status, ...(txHash ? { txHash } : {}), updatedAt: now, ...(status === 'delivered' ? { deliveredAt: now } : {}) };
  await save(env, next);
  return { rec: next, changed: status !== rec.status };
}

const EVENT_FOR: Partial<Record<TopUpStatus, EventType>> = {
  paid_in: 'topup.paid_in',
  delivered: 'topup.delivered',
  failed: 'topup.failed',
  expired: 'topup.failed',
};

export async function notifyTopUp(env: Env, rec: TopUpRecord, changed: boolean, waitUntil?: (p: Promise<unknown>) => void): Promise<void> {
  if (changed) {
    const type = EVENT_FOR[rec.status];
    if (type) {
      // A top-up that jumps straight to "delivered" still tells the partner the naira arrived first
      if (rec.status === 'delivered') await emitTopUpEvent(env, rec, 'topup.paid_in', publicTopUp(rec), waitUntil);
      await emitTopUpEvent(env, rec, type, publicTopUp(rec), waitUntil);
    }
  }
  if (FINAL.includes(rec.status)) await env.ORDER_STORE.delete(`ptopen:${rec.id}`);
}

/** Refresh open top-ups on the schedule, so partners get webhooks even when nobody is polling. */
export async function sweepOpenTopUps(env: Env, deps: V1Deps): Promise<{ checked: number }> {
  if (!onrampSwitchOn(env)) return { checked: 0 };
  if (!(await shouldList(env, 'ptopen'))) return { checked: 0 };
  const startedAt = Date.now();
  const page = await env.ORDER_STORE.list({ prefix: 'ptopen:', limit: 50 });
  if (page.keys.length === 0 && page.list_complete !== false) await clearWorkIfIdle(env, 'ptopen', startedAt);
  let checked = 0;
  for (const k of page.keys) {
    const rec = await loadTopUp(env, k.name.slice('ptopen:'.length));
    if (!rec) {
      await env.ORDER_STORE.delete(k.name);
      continue;
    }
    checked++;
    const out = await refreshTopUp(env, rec, deps);
    await notifyTopUp(env, out.rec, out.changed);
  }
  return { checked };
}

export type { Partner, Mode };
