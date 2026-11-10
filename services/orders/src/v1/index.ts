/**
 * GoodCash partner API, version 1. Mounted at /v1 on the orders worker. Off unless PARTNER_API_ENABLED is "true".
 * goodcash.xyz's own endpoints are untouched; this only adds routes.
 */
import { CELO_CHAIN_ID, fetchCeloUsd, isAddress, networkFeeFrom } from '@goodcash/core';
import { authenticate } from './auth';
import { createCashOut, listCashOuts, loadCashOut, notifyChange, publicCashOut, refreshCashOut, reportTransaction, sweepOpenCashOuts } from './cashouts';
import { buildEvent, deliver, processWebhookQueue, setWebhook } from './webhooks';
import { requireSecret } from './auth';
import type { CashOutRecord } from './types';
import { handleSignup, isSignupPath, requestLiveAccess } from './signup';
import { handleLiveKeys, isLiveKeysPath } from './liveKeys';
import { createTopUp, getTopUp, listTopUps, sweepOpenTopUps, topUpQuote } from './topups';
import { requestId, V1Error, v1ErrorResponse, v1Json, v1Preflight, withV1Headers } from './http';
import { ethCallVia, feeLines, maxG, minimumG, parseAmountG, priceCashOut } from './pricing';
import type { AuthContext, Env, V1Deps } from './types';

export type { V1Deps } from './types';

/** Names as the payout partner spells them; the most used banks first. */
const POPULAR = ['opay', 'palmpay', 'moniepoint mfb', 'kuda microfinance bank', 'guaranty trust bank', 'access bank', 'zenith bank', 'first bank of nigeria', 'united bank for africa', 'wema bank'];

const TEST_BANKS = [
  { code: 'TESTBANKA', name: 'Test Bank A', popular: true },
  { code: 'TESTBANKB', name: 'Test Bank B', popular: true },
];

export function isV1Path(pathname: string): boolean {
  return pathname === '/v1' || pathname.startsWith('/v1/');
}

export async function handleV1(request: Request, env: Env, deps: V1Deps, waitUntil?: (p: Promise<unknown>) => void): Promise<Response> {
  const reqId = requestId();
  if (env.PARTNER_API_ENABLED !== 'true') return withV1Headers(v1Json({ error: { code: 'not_found', message: 'Not found' } }, 404), reqId, null);
  if (request.method === 'OPTIONS') return v1Preflight(request);

  // Public sign-up for test keys: no key yet, so it has its own checks (see signup.ts)
  if (isSignupPath(new URL(request.url).pathname)) {
    try {
      return withV1Headers(await handleSignup(request, env, deps), reqId, null);
    } catch (e) {
      if (e instanceof V1Error) return withV1Headers(v1ErrorResponse(e), reqId, null);
      console.error(`[v1] ${reqId} unexpected error:`, (e as Error)?.message ?? e);
      return withV1Headers(v1ErrorResponse(new V1Error('unavailable')), reqId, null);
    }
  }

  // The emailed live-keys link's page: no key yet either (see liveKeys.ts)
  if (isLiveKeysPath(new URL(request.url).pathname)) {
    try {
      return withV1Headers(await handleLiveKeys(request, env, deps), reqId, null);
    } catch (e) {
      if (e instanceof V1Error) return withV1Headers(v1ErrorResponse(e), reqId, null);
      console.error(`[v1] ${reqId} unexpected error:`, (e as Error)?.message ?? e);
      return withV1Headers(v1ErrorResponse(new V1Error('unavailable')), reqId, null);
    }
  }

  let ctx: AuthContext | null = null;
  try {
    ctx = await authenticate(request, env);
    await partnerRateLimit(env, ctx);
    const res = await route(request, env, ctx, deps, waitUntil);
    return withV1Headers(res, reqId, ctx.corsOrigin);
  } catch (e) {
    if (e instanceof V1Error) return withV1Headers(v1ErrorResponse(e), reqId, ctx?.corsOrigin ?? null);
    console.error(`[v1] ${reqId} unexpected error:`, (e as Error)?.message ?? e);
    return withV1Headers(v1ErrorResponse(new V1Error('unavailable')), reqId, ctx?.corsOrigin ?? null);
  }
}

async function partnerRateLimit(env: Env, ctx: AuthContext): Promise<void> {
  if (!env.RATE_LIMITER_PARTNER) return;
  try {
    const { success } = await env.RATE_LIMITER_PARTNER.limit({ key: `partner:${ctx.partner.id}:${ctx.mode}` });
    if (!success) throw new V1Error('rate_limited', 'This partner is over its request limit. Contact GoodCash for a higher limit.');
  } catch (e) {
    if (e instanceof V1Error) throw e; // never block partners because the limiter itself failed
  }
}

async function route(request: Request, env: Env, ctx: AuthContext, deps: V1Deps, waitUntil?: (p: Promise<unknown>) => void): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, '');
  const m = request.method;

  if (m === 'GET' && path === '/v1/partner') {
    const p = ctx.partner;
    // allowedOrigins are public web addresses; the widget uses them to decide where it may be shown and talk to
    return v1Json({ id: p.id, name: p.name, mode: ctx.mode, logoUrl: p.logoUrl ?? null, accentColor: p.accentColor ?? null, feePercent: p.feePercent, allowedOrigins: p.allowedOrigins });
  }

  // Naira in (top-ups): off unless PARTNER_ONRAMP_ENABLED. The customer's ID details never come through here.
  if (m === 'GET' && path === '/v1/topup/quote') return topUpQuote(env, ctx, deps, url);
  if (m === 'POST' && path === '/v1/topups') return createTopUp(request, env, ctx, deps);
  if (m === 'GET' && path === '/v1/topups') return listTopUps(env, ctx, url);
  const topUpMatch = /^\/v1\/topups\/([^/]+)$/.exec(path);
  if (m === 'GET' && topUpMatch) return getTopUp(env, ctx, deps, topUpMatch[1], waitUntil);

  if (m === 'POST' && path === '/v1/live-access') {
    requireSecret(ctx);
    return requestLiveAccess(env, ctx);
  }

  if (m === 'GET' && path === '/v1/limits') {
    const probe = parseAmountG('10000');
    const priced = await priceCashOut(env, deps, ctx.partner, ctx.mode, probe.amountG, probe.amountWei);
    return v1Json({ currency: 'NGN', country: 'NG', chainId: CELO_CHAIN_ID, minimumG: minimumG(priced), maximumG: maxG(env), feePercent: priced.feePercent });
  }

  if (m === 'GET' && path === '/v1/banks') {
    if (ctx.mode === 'test') return v1Json({ object: 'list', data: TEST_BANKS });
    const list = await deps.cachedInstitutionList(env);
    if (!list) throw new V1Error('unavailable', 'The bank list is not available right now.');
    const data = list
      .filter((b) => b.type === 'bank' || !b.type)
      .map((b) => ({ code: b.code, name: b.name.trim(), popular: POPULAR.includes(b.name.trim().toLowerCase()) }));
    return v1Json({ object: 'list', data });
  }

  if (m === 'POST' && path === '/v1/banks/verify') {
    let body: { bankCode?: unknown; accountNumber?: unknown };
    try {
      body = (await request.json()) as typeof body;
    } catch {
      throw new V1Error('invalid_request', 'The body must be JSON: { "bankCode": "...", "accountNumber": "..." }.');
    }
    const bankCode = typeof body.bankCode === 'string' ? body.bankCode.trim() : '';
    const accountNumber = typeof body.accountNumber === 'string' ? body.accountNumber.trim() : '';
    if (bankCode.length < 2 || bankCode.length > 20 || !/^\d{10,20}$/.test(accountNumber)) {
      throw new V1Error('invalid_request', 'bankCode (from /v1/banks) and a 10-20 digit accountNumber are required.');
    }
    if (ctx.mode === 'test') {
      if (accountNumber === '0000000009') throw new V1Error('bank_account_not_found', 'Test mode: 0000000009 always fails the name check.');
      return v1Json({ accountName: 'TEST ACCOUNT' });
    }
    const out = await deps.verifyAccountName({ institution: bankCode, accountIdentifier: accountNumber }, env);
    if ('error' in out) throw new V1Error(out.reason === 'not_found' ? 'bank_account_not_found' : 'unavailable');
    return v1Json({ accountName: out.accountName });
  }

  if (m === 'GET' && path === '/v1/quote') {
    const { amountG, amountWei } = parseAmountG(url.searchParams.get('amountG'));
    const priced = await priceCashOut(env, deps, ctx.partner, ctx.mode, amountG, amountWei);
    return v1Json({
      object: 'quote',
      mode: ctx.mode,
      amountG,
      receive: { naira: priced.naira, minimumNaira: priced.minimumNaira },
      feePercent: priced.feePercent,
      fees: feeLines(priced, ctx.partner.name),
      minimumG: minimumG(priced),
      enough: priced.minimumNaira > 0 && Number(amountG) >= minimumG(priced),
      nairaPerDollar: priced.ngnPerUsd,
      expiresAt: new Date(Date.now() + 30_000).toISOString(),
    });
  }

  if (m === 'GET' && path === '/v1/network-fee') {
    const wallet = url.searchParams.get('wallet') ?? '';
    if (!isAddress(wallet)) throw new V1Error('invalid_request', 'wallet must be a 0x address.');
    if (ctx.mode === 'test') {
      return v1Json(networkFeeFrom({ balanceWei: 10n ** 18n, gasPriceWei: 25_000_000_000n, flow: 'one-tap', celoUsd: 0.5 }));
    }
    try {
      const [bal, gas, celoUsd] = await Promise.all([
        deps.rpcCall(env, 'eth_getBalance', [wallet, 'latest']) as Promise<string>,
        deps.rpcCall(env, 'eth_gasPrice', []) as Promise<string>,
        fetchCeloUsd(ethCallVia(env, deps)),
      ]);
      return v1Json(networkFeeFrom({ balanceWei: BigInt(bal), gasPriceWei: BigInt(gas), flow: 'one-tap', celoUsd }));
    } catch {
      throw new V1Error('unavailable', 'Could not read the network fee on Celo.');
    }
  }

  if (path === '/v1/cashouts') {
    if (m === 'POST') {
      const out = await createCashOut(request, env, ctx, deps);
      return v1Json(out.body, out.status);
    }
    if (m === 'GET') return v1Json(await listCashOuts(env, ctx, url));
  }

  const one = path.match(/^\/v1\/cashouts\/([^/]+)$/);
  if (m === 'GET' && one) {
    const rec = await loadCashOut(env, ctx, one[1]);
    const { rec: fresh, changed, delayed } = await refreshCashOut(env, rec, deps);
    await notifyChange(env, fresh, changed, !!delayed, waitUntil);
    return v1Json(publicCashOut(fresh));
  }

  const tx = path.match(/^\/v1\/cashouts\/([^/]+)\/transaction$/);
  if (m === 'POST' && tx) {
    const out = await reportTransaction(request, env, ctx, deps, tx[1]);
    const raw = await env.ORDER_STORE.get(`pc:${tx[1]}`);
    if (raw) {
      const rec = JSON.parse(raw) as CashOutRecord;
      await notifyChange(env, rec, rec.status !== 'sent' && rec.status !== 'awaiting_signature', false, waitUntil);
    }
    return v1Json(out.body, out.status);
  }

  const sim = path.match(/^\/v1\/test\/cashouts\/([^/]+)\/simulate$/);
  if (m === 'POST' && sim) {
    if (ctx.mode !== 'test') throw new V1Error('test_mode_only', 'Simulation works only with test keys.');
    const rec = await loadCashOut(env, ctx, sim[1]);
    if (!rec.sentAt) {
      rec.sentAt = Date.now();
      rec.txHash = `0x${'7e57'.repeat(16)}`;
      rec.status = 'sent';
      rec.updatedAt = Date.now();
      await env.ORDER_STORE.put(`pc:${rec.id}`, JSON.stringify(rec), { expirationTtl: 7 * 86400 });
    }
    return v1Json(publicCashOut(rec));
  }

  if (path === '/v1/webhooks') {
    requireSecret(ctx);
    if (m === 'GET') {
      const p = ctx.partner;
      return v1Json({ url: p.webhookUrl?.[ctx.mode] ?? null, mode: ctx.mode, hasSecret: !!p.webhookSecretEnc?.[ctx.mode] });
    }
    if (m === 'PUT') {
      let body: { url?: unknown; rotateSecret?: unknown };
      try {
        body = (await request.json()) as typeof body;
      } catch {
        throw new V1Error('invalid_request', 'The body must be JSON: { "url": "https://..." }.');
      }
      return v1Json(await setWebhook(env, ctx.partner, ctx.mode, body));
    }
  }

  if (m === 'POST' && path === '/v1/webhooks/test') {
    requireSecret(ctx);
    if (!ctx.partner.webhookUrl?.[ctx.mode]) throw new V1Error('webhook_not_configured', 'Set a webhook URL first with PUT /v1/webhooks.');
    const event = buildEvent('cashout.test', ctx.mode, { message: 'This is a test event from GoodCash.' });
    const out = await deliver(env, ctx.partner, ctx.mode, event);
    return v1Json({ delivered: out.ok, status: out.status, eventId: event.id, ...(out.reason ? { reason: out.reason } : {}) });
  }

  throw new V1Error('not_found', `No ${m} ${path} in the partner API.`);
}

/** The payout partner told us about an order. If it belongs to a partner cash out, refresh it and notify the partner. */
export async function partnerOrderUpdated(env: Env, orderId: string, deps: V1Deps, waitUntil?: (p: Promise<unknown>) => void): Promise<void> {
  if (env.PARTNER_API_ENABLED !== 'true') return;
  const raw = await env.ORDER_STORE.get(`pc:${orderId}`);
  if (!raw) return;
  try {
    const { rec, changed, delayed } = await refreshCashOut(env, JSON.parse(raw) as CashOutRecord, deps);
    await notifyChange(env, rec, changed, !!delayed, waitUntil);
  } catch (e) {
    console.error('[v1] partner order update failed:', (e as Error)?.message);
  }
}

/** Partner work for the worker's schedule: retry webhooks and refresh open cash outs. */
export async function runPartnerSchedule(env: Env, deps: V1Deps): Promise<void> {
  if (env.PARTNER_API_ENABLED !== 'true') return;
  const swept = await sweepOpenCashOuts(env, deps);
  try {
    await sweepOpenTopUps(env, deps);
  } catch (e) {
    console.error('[v1-schedule] top-up sweep failed:', e);
  }
  const q = await processWebhookQueue(env);
  if (q.delivered + q.retried + q.dropped > 0 || swept.checked > 0) {
    console.log(`[v1-schedule] open checked ${swept.checked}; webhooks delivered ${q.delivered}, retrying ${q.retried}, dropped ${q.dropped}`);
  }
}
