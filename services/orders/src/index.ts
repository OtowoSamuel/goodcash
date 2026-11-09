/**
 * GoodCash Order Service — Cloudflare Worker
 *
 * Keeps the Paycrest API key server-side only. The client never receives it.
 *
 * Routes:
 *   POST /orders               Create a Paycrest off-ramp order (USDT → NGN)
 *   GET  /orders/:id           Poll order status
 *   POST /webhooks/paycrest    Receive and verify Paycrest status webhooks
 */

import { z } from 'zod';

// ---------------------------------------------------------------------------
// Environment bindings (declared in wrangler.toml or via CF dashboard)
// ---------------------------------------------------------------------------
export interface Env {
  PAYCREST_API_KEY: string;       // Never sent to client
  PAYCREST_API_SECRET: string;    // For webhook signature verification
  PAYCREST_BASE_URL: string;      // https://api.paycrest.io
  ORDER_STORE: KVNamespace;       // CF KV for lightweight order state
  ALLOWED_ORIGINS?: string;       // Comma-separated browser origins
  CELO_RPC_URL?: string;          // On-chain swap verification RPC
  ROUTER_ADDRESS?: string;        // GoodCashRouter address override
  ROUTER_V2_ADDRESS?: string;     // One-tap router (GoodCashRouterV2). Unset means the one-tap flow is off
  ROUTER_V2_DEPLOY_BLOCK?: string; // Block the one-tap router was deployed in (where history scanning starts)
  SENDER_FEE?: string;            // Optional GoodCash fee in USDT (needs SENDER_FEE_ADDRESS)
  RELAY_API_KEY?: string;         // Optional key for the swap service (a secret; raises its limits)
  SENDER_FEE_ADDRESS?: string;    // Wallet that receives SENDER_FEE or SENDER_FEE_PERCENT
  SENDER_FEE_PERCENT?: string;    // GoodCash fee as a percent of each cash out (for example "1"). Needs SENDER_FEE_ADDRESS
  RESEND_API_KEY?: string;        // Optional: emails support tickets to SUPPORT_INBOX (secret)
  SUPPORT_INBOX?: string;         // Where support tickets are emailed. A secret: never put it in code or wrangler.toml
  RATE_LIMITER_READ?: { limit: (opts: { key: string }) => Promise<{ success: boolean }> };   // looser, for status polling
  RATE_LIMITER_STRICT?: { limit: (opts: { key: string }) => Promise<{ success: boolean }> }; // tight, for email-sending endpoints
  RATE_LIMITER?: { limit: (opts: { key: string }) => Promise<{ success: boolean }> }; // Cloudflare rate-limit binding (no storage writes)
  RESEND_FROM?: string;           // Sender for customer emails, e.g. "GoodCash <hello@goodcash.xyz>" (needs a verified domain)
  BLOCKSCOUT_URL?: string;        // Indexer used to find a wallet's swaps (default celo.blockscout.com)
  VERIFY_SWAP_ONCHAIN?: string;   // "false" disables swap-proof checks (tests/local only)
  RATE_LIMIT_MAX?: string;        // Requests per window per IP
  RATE_LIMIT_WINDOW_SECONDS?: string;
}

// Browser origins allowed to call the Worker. Override with ALLOWED_ORIGINS.
const DEFAULT_ALLOWED_ORIGINS = [
  'http://localhost:5173',
  'http://localhost:4173',
  'https://goodcash.app',
  'https://www.goodcash.app',
  'https://goodcash.pages.dev',
];

// Celo mainnet contracts used for swap-proof verification.
const CELO_USDT = '0x48065fbbE25f71c9282ddf5e1cD6D6a887483d5e'.toLowerCase();
const DEFAULT_ROUTER_ADDRESS = '0xa4338586d4b2f0e1641c54b8cf0d53cd06b5c407'.toLowerCase();
const CASH_OUT_TOPIC = '0xfd08ba0cf09cbb75e5d99933b03678a9b307c9a4839063749004850da25931dc';
/** keccak256("CashOutPaid(address,address,uint256,uint256,uint256,uint256,uint8,bytes32)"): the one-tap router's event */
const CASH_OUT_PAID_TOPIC = '0xf76a7b57d20e27c73ccada71d551173e9a82e46372f8dedf840cb08ad5ea60d7';
const G_DOLLAR_TOKEN = '0x62b8b11039fcfe5ab0c56e502b1c372a3d2a9c7a';
const CELO_RPC_FALLBACK = 'https://forno.celo.org';

// ---------------------------------------------------------------------------
// Paycrest minimum for Celo USDT (docs say $0.50 on most chains)
// ---------------------------------------------------------------------------
const PAYCREST_MIN_USDT = 0.50;

// ---------------------------------------------------------------------------
// Zod schemas
// ---------------------------------------------------------------------------

/**
 * Bank recipient — do NOT log any of these fields.
 */
const RecipientSchema = z.object({
  institution: z
    .string()
    .min(2)
    .max(20)
    .describe('SWIFT/bank code, e.g. GTBINGLA'),
  accountIdentifier: z
    .string()
    .min(10)
    .max(20)
    .describe('Account number or phone number'),
  accountName: z
    .string()
    .min(2)
    .max(80)
    .describe('Account holder name'),
  memo: z.string().max(50).optional().default('GoodCash'),
});

/**
 * Input body for POST /orders.
 * Fields that identify the bank recipient are validated but never logged.
 */
const PAYCREST_MIN_DISPLAY = PAYCREST_MIN_USDT.toFixed(2);

const CreateOrderSchema = z.object({
  /** USDT amount as a decimal string, e.g. "0.50" */
  amount: z
    .string()
    .regex(/^\d+(\.\d{1,6})?$/, 'Amount must be a decimal number string')
    .refine((v) => parseFloat(v) >= PAYCREST_MIN_USDT, {
      message: `Amount must be at least the minimum of $${PAYCREST_MIN_DISPLAY} USDT`,
    }),
  /** Celo wallet address used as the refund address if the order fails */
  refundAddress: z
    .string()
    .regex(/^0x[0-9a-fA-F]{40}$/, 'Must be a valid Ethereum/Celo address'),
  /** Confirmed swap transaction that produced the USDT being off-ramped */
  swapTxHash: z
    .string()
    .regex(/^0x[0-9a-fA-F]{64}$/, 'Must be a valid transaction hash')
    .optional(),
  /** Recipient bank details */
  recipient: RecipientSchema,
  /** Optional idempotency ref generated by the client (UUID recommended) */
  reference: z
    .string()
    .min(8)
    .max(64)
    .regex(/^[a-zA-Z0-9_-]+$/)
    .optional(),
  /** The GoodCash fee percent the customer's screen showed. The fee is charged only when this matches the server's setting. */
  feePercent: z.number().min(0).max(5).optional(),
});

type CreateOrderInput = z.infer<typeof CreateOrderSchema>;

const VerifyAccountSchema = z.object({
  institution: z.string().min(2).max(20),
  accountIdentifier: z.string().min(6).max(20),
  /** Optional caller wallet; validated so requests are attributable in logs. */
  walletAddress: z
    .string()
    .regex(/^0x[0-9a-fA-F]{40}$/, 'Must be a valid Ethereum/Celo address')
    .optional(),
});

// ---------------------------------------------------------------------------
// Paycrest API types (v2)
// ---------------------------------------------------------------------------

interface PaycrestInstitution {
  name: string;
  code: string;
  type: string;
}

interface PaycrestOrderResponse {
  id: string;
  status: string;
  amount?: string;
  rate?: string;
  providerAccount: {
    network: string;
    receiveAddress: string;
    validUntil: string;
    amountToTransfer: string;
    currency: string;
    memo?: string;
  };
  senderFee: string;
  transactionFee: string;
}

interface PaycrestStatusResponse {
  id: string;
  status: string;
  providerAccount?: {
    receiveAddress: string;
    validUntil: string;
    amountToTransfer: string;
    network: string;
    currency: string;
    memo?: string;
  };
  paymentReference?: string | null;
}

// What we return to the client — no API key, no raw bank details
interface ClientOrderResponse {
  orderId: string;
  receiveAddress: string;
  amountToSend: string;
  currency: string;
  network: string;
  memo?: string;
  amount?: string;
  rate?: string;
  expectedNaira?: string;
  senderFee: string;
  transactionFee: string;
  validUntil: string;
  status: string;
}

interface ClientStatusResponse {
  orderId: string;
  status: string;
  receiveAddress?: string;
  amountToSend?: string;
  validUntil?: string;
  paymentReference?: string | null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function corsHeaders(origin: string | null): Record<string, string> {
  const headers: Record<string, string> = {
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    Vary: 'Origin',
  };
  if (origin) headers['Access-Control-Allow-Origin'] = origin;
  return headers;
}

function allowedOrigins(env: Env): string[] {
  return (env.ALLOWED_ORIGINS ?? DEFAULT_ALLOWED_ORIGINS.join(','))
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
}

function resolveCorsOrigin(request: Request, env: Env): string | null {
  const origin = request.headers.get('Origin');
  if (!origin) return null;
  return allowedOrigins(env).includes(origin) ? origin : null;
}

function withCors(response: Response, request: Request, env: Env): Response {
  const headers = new Headers(response.headers);
  for (const [key, value] of Object.entries(corsHeaders(resolveCorsOrigin(request, env)))) {
    headers.set(key, value);
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function json(data: unknown, status = 200, extraHeaders: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...extraHeaders,
    },
  });
}

/**
 * A refused request, in words a customer understands. The technical reasons (which field, what was wrong) go to our
 * log as field names only, never the values.
 */
export function invalidRequest(issues: ReadonlyArray<{ path: PropertyKey[]; code?: string }>, where: string): Response {
  const fields = [...new Set(issues.map((i) => i.path.map(String).join('.') || '(body)'))].slice(0, 6).join(',');
  console.error(`[${where}] invalid request: ${fields}`);
  const tooSmall = issues.some((i) => i.path.map(String).join('.') === 'amount' && (i.code === 'custom' || i.code === 'too_small'));
  return err(tooSmall ? 'That amount is too small to cash out. Please try a larger amount.' : 'Some details were missing or not right. Please check them and try again.');
}

function err(message: string, status = 400): Response {
  return json({ error: message }, status);
}

/**
 * Paycrest docs wrap responses in `{ status, message, data }`, while some
 * deployed responses are already unwrapped. Accept both shapes.
 */
function unwrapPaycrestData<T>(payload: unknown): T {
  const wrapped = payload as { data?: T };
  return (wrapped?.data ?? payload) as T;
}

function expectedNairaFromOrder(order: PaycrestOrderResponse): string | undefined {
  const amount = Number(order.amount);
  const rate = Number(order.rate);
  if (!Number.isFinite(amount) || !Number.isFinite(rate) || amount <= 0 || rate <= 0) {
    return undefined;
  }
  return (amount * rate).toFixed(2);
}

/**
 * Timing-safe hex string comparison (constant time).
 */
async function timingSafeEqual(a: string, b: string): Promise<boolean> {
  const enc = new TextEncoder();
  const ka = await crypto.subtle.importKey('raw', enc.encode(a), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const kb = await crypto.subtle.importKey('raw', enc.encode(b), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sa = await crypto.subtle.sign('HMAC', ka, enc.encode('gc'));
  const sb = await crypto.subtle.sign('HMAC', kb, enc.encode('gc'));
  const va = new Uint8Array(sa);
  const vb = new Uint8Array(sb);
  if (va.length !== vb.length) return false;
  let diff = 0;
  for (let i = 0; i < va.length; i++) diff |= va[i] ^ vb[i];
  return diff === 0;
}

/**
 * Compute HMAC-SHA256 hex of `payload` using `secret`.
 */
async function hmacSha256Hex(secret: string, payload: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(payload));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Generate a random reference if none provided.
 */
function generateRef(prefix = 'goodcash'): string {
  const rand = crypto.getRandomValues(new Uint8Array(12));
  const hex = Array.from(rand)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  return `${prefix}-${hex}`;
}

function clientIp(request: Request): string {
  const cfIp = request.headers.get('CF-Connecting-IP');
  if (cfIp) return cfIp;
  const forwarded = request.headers.get('X-Forwarded-For');
  return forwarded?.split(',')[0]?.trim() || 'unknown';
}

/**
 * Fixed-window rate limit keyed by client IP + bucket. Uses the existing KV
 * binding so it works across Worker isolates without extra infrastructure.
 */
async function checkRateLimit(
  request: Request,
  env: Env,
  bucket: string,
  tier: 'normal' | 'read' | 'strict' = 'normal'
): Promise<Response | null> {
  // Preferred: Cloudflare's built-in rate limiter. It costs no storage writes, so it can never use up the KV quota.
  const limiter = tier === 'read' ? env.RATE_LIMITER_READ : tier === 'strict' ? env.RATE_LIMITER_STRICT : env.RATE_LIMITER;
  if (limiter) {
    try {
      const { success } = await limiter.limit({ key: `${bucket}:${clientIp(request)}` });
      return success ? null : err('Too many requests. Please try again later.', 429);
    } catch (e) {
      console.error('[orders] rate limiter unavailable:', e);
      return null; // never block customers because the limiter itself failed
    }
  }

  const max = Number(env.RATE_LIMIT_MAX ?? '30');
  if (!Number.isFinite(max) || max <= 0) return null;

  const windowSeconds = Number(env.RATE_LIMIT_WINDOW_SECONDS ?? '60');
  const windowMs = (Number.isFinite(windowSeconds) && windowSeconds > 0 ? windowSeconds : 60) * 1000;
  const windowStart = Math.floor(Date.now() / windowMs);
  const key = `rl:${bucket}:${clientIp(request)}:${windowStart}`;

  const current = Number((await env.ORDER_STORE.get(key)) ?? '0') || 0;
  if (current >= max) {
    return err('Too many requests. Please try again later.', 429);
  }

  await env.ORDER_STORE.put(key, String(current + 1), {
    expirationTtl: Math.max(Math.ceil((windowMs / 1000) * 2), 60),
  });
  return null;
}

interface RpcLog {
  address: string;
  topics: string[];
  data: string;
}

interface RpcReceipt {
  status: string;
  logs?: RpcLog[];
}

async function rpcCall(env: Env, method: string, params: unknown[]): Promise<unknown> {
  const res = await fetch(env.CELO_RPC_URL || CELO_RPC_FALLBACK, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  const payload = (await res.json().catch(() => ({}))) as {
    result?: unknown;
    error?: { message?: string };
  };
  if (!res.ok || payload.error) {
    throw new Error(payload.error?.message || `RPC error (${res.status})`);
  }
  return payload.result;
}

function topicToAddress(topic: string | undefined): string | null {
  if (!topic || topic.length < 42) return null;
  return `0x${topic.slice(-40)}`.toLowerCase();
}

function toAtomic6(value: string): bigint {
  const [whole, fraction = ''] = value.split('.');
  return BigInt(whole) * 1_000_000n + BigInt((fraction + '000000').slice(0, 6));
}

/**
 * Proves that `swapTxHash` is a successful GoodCashRouter CashOut from
 * `refundAddress` to `refundAddress` with USDT output at least `amount`.
 * This prevents creating payout orders for swaps the caller does not own.
 */
async function verifySwapOnChain(
  swapTxHash: string | undefined,
  refundAddress: string,
  amount: string,
  env: Env
): Promise<Response | null> {
  if (env.VERIFY_SWAP_ONCHAIN === 'false') return null;
  if (!swapTxHash) {
    return err('swapTxHash is required to create a payout order', 400);
  }

  let receipt: RpcReceipt | null;
  try {
    receipt = (await rpcCall(env, 'eth_getTransactionReceipt', [swapTxHash])) as RpcReceipt | null;
  } catch (e) {
    console.error('[orders] Swap verification RPC failed:', e);
    return err('Could not verify the swap transaction. Please try again.', 503);
  }

  if (!receipt) return err('Swap transaction not found', 400);
  if (receipt.status !== '0x1') return err('Swap transaction did not succeed', 400);

  const router = (env.ROUTER_ADDRESS || DEFAULT_ROUTER_ADDRESS).toLowerCase();
  const log = receipt.logs?.find(
    (entry) =>
      entry.address?.toLowerCase() === router &&
      entry.topics?.[0]?.toLowerCase() === CASH_OUT_TOPIC
  );
  if (!log) return err('Swap transaction has no GoodCashRouter CashOut event', 400);

  const user = topicToAddress(log.topics[1]);
  const recipient = topicToAddress(log.topics[2]);
  const tokenOut = topicToAddress(log.topics[3]);
  const wallet = refundAddress.toLowerCase();

  if (user !== wallet || recipient !== wallet) {
    return err('Swap does not belong to the refund wallet', 403);
  }
  if (tokenOut !== CELO_USDT) {
    return err('Swap output is not USDT', 400);
  }

  const data = log.data.startsWith('0x') ? log.data.slice(2) : log.data;
  if (data.length < 128) return err('CashOut event data is malformed', 400);
  const amountOut = BigInt(`0x${data.slice(64, 128)}`);
  if (toAtomic6(amount) > amountOut) {
    return err('Payout amount exceeds the verified swap output', 400);
  }

  return null;
}


// ---------------------------------------------------------------------------
// Swap <-> order bookkeeping, unfinished-swap detection and support tickets
// ---------------------------------------------------------------------------

/** Statuses meaning no money has reached the payout partner for this order. */
const UNPAID_STATUSES = new Set(['initiated', 'expired', 'refunded', 'cancelled', 'error']);
const ROUTER_DEPLOY_BLOCK = 81917173;
const THIRTY_DAYS_S = 60 * 60 * 24 * 30;


// The bank has been paid from "fulfilled" on; the later statuses are the partner's own bookkeeping
const PAID_STATUSES = new Set(['fulfilled', 'validated', 'settling', 'settled']);

const FINAL_STATUSES = new Set(['settled', 'refunded', 'expired', 'cancelled', 'error']);
const STATUS_RANK: Record<string, number> = { initiated: 0, deposited: 1, pending: 2, fulfilling: 3, validated: 4, settling: 5, settled: 6 };

/** True when `next` would undo progress already recorded (or change a final status). */
function statusMovesBackwards(current: string | undefined, next: string): boolean {
  if (!current || current === next) return false;
  if (FINAL_STATUSES.has(current)) return true;
  if (FINAL_STATUSES.has(next)) return false;
  return (STATUS_RANK[next] ?? 0) < (STATUS_RANK[current] ?? 0);
}

/** The "your naira is sent" email, in GoodCash's look. Inline styles only, because email apps ignore the rest. */
function paidEmailHtml(orderId: string, naira: string | null): string {
  const ref = orderId.slice(0, 8);
  return `<!doctype html><html><body style="margin:0;padding:0;background:#cdb8ff;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#cdb8ff;padding:28px 12px;">
<tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:440px;">
<tr><td style="padding:0 4px 14px;font-family:Arial,Helvetica,sans-serif;font-size:24px;font-weight:900;color:#111;letter-spacing:-0.5px;"><img src="https://goodcash.xyz/email-logo.png" width="44" height="44" alt="" style="vertical-align:middle;border:0;margin-right:10px;">GoodCash</td></tr>
<tr><td style="background:#ffffff;border:3px solid #111;border-radius:22px;box-shadow:5px 5px 0 #111;padding:26px 22px;text-align:center;font-family:Arial,Helvetica,sans-serif;color:#111;">
<div style="display:inline-block;width:54px;height:54px;line-height:54px;border-radius:50%;background:#8cf0c0;border:3px solid #111;font-size:28px;font-weight:900;">&#10003;</div>
<div style="font-size:12px;font-weight:800;letter-spacing:1.5px;margin-top:14px;">CASH OUT COMPLETE</div>
<div style="font-size:40px;font-weight:900;line-height:1.1;margin:8px 0 4px;">${naira ? naira : 'Your naira'}</div>
<div style="font-size:16px;font-weight:700;">${naira ? 'has been sent to your bank' : 'has been sent to your bank'}</div>
<div style="font-size:14px;line-height:1.5;margin:16px 0 20px;color:#333;">It can take a few minutes to show up in your account.</div>
<a href="https://goodcash.xyz" style="display:inline-block;background:#7b39fc;color:#ffffff;text-decoration:none;font-weight:900;font-size:16px;padding:14px 26px;border:3px solid #111;border-radius:16px;box-shadow:3px 3px 0 #111;">Open GoodCash</a>
</td></tr>
<tr><td style="padding:16px 8px 0;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:1.6;color:#2b1d55;text-align:center;">
Reference: ${ref}<br>Not there after an hour? Open GoodCash, go to History, tap your cash out and choose Contact support.
</td></tr>
</table></td></tr></table></body></html>`;
}

/**
 * If the customer asked to be emailed when their naira lands, send it once and forget the address.
 * Safe to call as often as we like: it does nothing unless an address is waiting.
 */
async function sendPaidEmailIfRequested(orderId: string, env: Env): Promise<void> {
  if (!env.RESEND_API_KEY) return;
  const key = `notify:${orderId}`;
  const stored = await env.ORDER_STORE.get(key);
  if (!stored) return;
  // Older entries are just the address; newer ones also carry the naira amount to show in the email
  let email = stored;
  let naira: string | null = null;
  if (stored.startsWith('{')) {
    try {
      const parsed = JSON.parse(stored) as { email?: string; naira?: string };
      email = parsed.email ?? '';
      naira = parsed.naira ?? null;
    } catch {
      return;
    }
  }
  if (!email) return;
  // Forget it first, so a retry or a second poll can never send a duplicate
  await env.ORDER_STORE.delete(key);
  try {
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: env.RESEND_FROM || 'GoodCash <onboarding@resend.dev>',
        to: [email],
        subject: naira ? `Your ${naira} is on its way to your bank` : 'Your naira is on its way to your bank',
        html: paidEmailHtml(orderId, naira),
        text: [
          'Good news: your GoodCash cash out is complete.',
          '',
          naira
            ? `Your ${naira} has been sent to your bank account. It can take a few minutes to show up in your account.`
            : 'Your naira has been sent to your bank account. It can take a few minutes to show up in your account.',
          '',
          `Reference: ${orderId.slice(0, 8)}`,
          '',
          'If it has not arrived after an hour, open GoodCash, go to History, tap your cash out and choose Contact support.',
        ].join('\n'),
      }),
    });
  } catch (e) {
    console.error('[notify] email failed:', e);
  }
}

/** POST /notify - "email me when it lands". Stores the address for this order only, for three days. */
async function handleNotify(request: Request, env: Env): Promise<Response> {
  const limited = await checkRateLimit(request, env, 'notify', 'strict');
  if (limited) return limited;
  let body: { orderId?: unknown; email?: unknown; naira?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return err('Invalid JSON body');
  }
  const orderId = typeof body.orderId === 'string' ? body.orderId : '';
  const email = typeof body.email === 'string' ? body.email.trim() : '';
  if (!/^[0-9a-f-]{36}$/i.test(orderId)) return err('Invalid order', 400);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) || email.length > 200) return err('Enter a valid email address.', 400);
  // The amount is only for display in the email, so accept nothing but a plain ₦ figure
  const naira = typeof body.naira === 'string' && /^₦[\d,]{1,12}$/.test(body.naira) ? body.naira : null;
  await env.ORDER_STORE.put(`notify:${orderId}`, naira ? JSON.stringify({ email, naira }) : email, { expirationTtl: 60 * 60 * 24 * 3 });
  // If it already landed, tell them now
  const status = await lookupOrderStatus(orderId, env);
  if (status && PAID_STATUSES.has(status)) await sendPaidEmailIfRequested(orderId, env);
  return new Response(null, { status: 204 });
}

/** Current status of an order, preferring a live Paycrest answer over the saved copy. */
async function lookupOrderStatus(orderId: string, env: Env): Promise<string | null> {
  try {
    const res = await fetch(`${env.PAYCREST_BASE_URL}/v2/sender/orders/${orderId}`, {
      headers: { 'API-Key': env.PAYCREST_API_KEY },
    });
    if (res.ok) {
      const data = unwrapPaycrestData<{ status?: string }>(await res.json());
      if (data?.status) {
        if (PAID_STATUSES.has(data.status)) await sendPaidEmailIfRequested(orderId, env);
        return data.status;
      }
    }
  } catch {
    // fall through to the saved copy
  }
  const cached = await env.ORDER_STORE.get(`order:${orderId}`);
  if (cached) {
    try {
      return (JSON.parse(cached) as { status?: string }).status ?? null;
    } catch {
      return null;
    }
  }
  return null;
}


type SwapRow = { transactionHash: string; data: string; timeStamp: string; v2?: boolean; payTo?: string };

/**
 * A wallet's GoodCash swaps. The free block explorer allows only about 10 requests and shared servers
 * exhaust it (HTTP 429), so we read the chain ourselves instead: Celo's public node answers log queries
 * quickly but only 5,000 blocks at a time. We scan in small windows and remember where we got to, so a
 * normal refresh costs one or two windows. Answers are cached for 3 minutes, and if the node is
 * unavailable we serve the last list we saw.
 */
const LOG_WINDOW = 5000;

interface ScanState {
  fwd: number; // next block not yet scanned going forward
  back: number; // highest block not yet scanned going backward (older history)
  rows: SwapRow[];
}

interface ScanTarget {
  router: string;
  topic0: string;
  deployBlock: number;
  stateKey: (wallet: string) => string;
  v2: boolean;
}

function scanTargets(env: Env): ScanTarget[] {
  const targets: ScanTarget[] = [
    {
      router: (env.ROUTER_ADDRESS || DEFAULT_ROUTER_ADDRESS).toLowerCase(),
      topic0: CASH_OUT_TOPIC,
      deployBlock: ROUTER_DEPLOY_BLOCK,
      stateKey: (w) => `wscan:${w}`,
      v2: false,
    },
  ];
  if (env.ROUTER_V2_ADDRESS && /^0x[0-9a-fA-F]{40}$/.test(env.ROUTER_V2_ADDRESS)) {
    targets.push({
      router: env.ROUTER_V2_ADDRESS.toLowerCase(),
      topic0: CASH_OUT_PAID_TOPIC,
      deployBlock: Number(env.ROUTER_V2_DEPLOY_BLOCK) > 0 ? Number(env.ROUTER_V2_DEPLOY_BLOCK) : ROUTER_DEPLOY_BLOCK,
      stateKey: (w) => `wscan2:${w}`,
      v2: true,
    });
  }
  return targets;
}

async function scanWalletSwapsViaRpc(wallet: string, env: Env, target: ScanTarget = scanTargets(env)[0]): Promise<SwapRow[]> {
  const router = target.router;
  const w = wallet.toLowerCase();
  const topic1 = `0x${'0'.repeat(24)}${w.slice(2)}`;
  const stateKey = target.stateKey(w);

  const latest = parseInt((await rpcCall(env, 'eth_blockNumber', [])) as string, 16);
  const saved = await env.ORDER_STORE.get(stateKey);
  let state: ScanState = saved ? (JSON.parse(saved) as ScanState) : { fwd: latest + 1, back: latest, rows: [] };
  const start = JSON.stringify({ back: state.back, rowsLen: state.rows.length, fwd: state.fwd });

  const found = new Map(state.rows.map((r) => [r.transactionHash.toLowerCase(), r] as const));
  const logsIn = async (from: number, to: number) => {
    const logs = (await rpcCall(env, 'eth_getLogs', [
      { fromBlock: `0x${from.toString(16)}`, toBlock: `0x${to.toString(16)}`, address: router, topics: [target.topic0, topic1] },
    ])) as Array<{ transactionHash: string; data: string; blockNumber: string; topics: string[] }>;
    for (const l of logs) {
      if (found.has(l.transactionHash.toLowerCase())) continue;
      const block = (await rpcCall(env, 'eth_getBlockByNumber', [l.blockNumber, false])) as { timestamp?: string } | null;
      found.set(l.transactionHash.toLowerCase(), {
        transactionHash: l.transactionHash,
        data: l.data,
        timeStamp: block?.timestamp ?? '0x0',
        ...(target.v2 ? { v2: true, payTo: topicToAddress(l.topics?.[2]) ?? undefined } : {}),
      });
    }
  };

  // Forward: everything since the last scan, newest first so recent swaps always appear
  let to = latest;
  let windows = 0;
  while (to >= state.fwd && windows < 12) {
    const from = Math.max(state.fwd, to - LOG_WINDOW + 1);
    await logsIn(from, to);
    to = from - 1;
    windows++;
  }
  const fwd = to >= state.fwd ? state.fwd : latest + 1; // finished the gap, or keep working next time

  // Backward: older history, a few windows per call until the router's first block
  let back = state.back;
  let backWindows = 0;
  while (back >= target.deployBlock && backWindows < (saved ? 6 : 12)) {
    const from = Math.max(target.deployBlock, back - LOG_WINDOW + 1);
    await logsIn(from, back);
    back = from - 1;
    backWindows++;
  }

  const rows = [...found.values()];
  state = { fwd, back, rows };
  const changed =
    start !== JSON.stringify({ back: state.back, rowsLen: rows.length, fwd: state.fwd }) &&
    (rows.length !== (saved ? (JSON.parse(saved) as ScanState).rows.length : 0) ||
      back !== (saved ? (JSON.parse(saved) as ScanState).back : latest) ||
      latest + 1 - (saved ? (JSON.parse(saved) as ScanState).fwd : latest + 1) >= LOG_WINDOW);
  if (!saved || changed) await env.ORDER_STORE.put(stateKey, JSON.stringify(state), { expirationTtl: 60 * 60 * 24 * 120 });
  // Finished when nothing is left to scan in either direction (the backward scan takes a few calls for a new wallet)
  return Object.assign(rows, { complete: back < target.deployBlock && fwd === latest + 1 });
}

async function getWalletSwapRows(wallet: string, env: Env): Promise<SwapRow[]> {
  const w = wallet.toLowerCase();
  const edge = typeof caches !== 'undefined' ? (caches as unknown as { default?: Cache }).default : undefined;
  const cacheKey = new Request(`https://cache.goodcash.invalid/wallet-swaps/${w}`);
  if (edge) {
    const hit = await edge.match(cacheKey);
    if (hit) {
      try {
        return Object.assign((await hit.json()) as SwapRow[], { complete: true });
      } catch {
        // fall through to a fresh read
      }
    }
  }

  let rows: SwapRow[] | null = null;
  // False while a new wallet's history is still being read; the app then asks again shortly
  let complete = false;
  try {
    // The current router must answer. The one-tap router (when switched on) adds to it, and a hiccup there
    // never hides the rest of a customer's history.
    const targets = scanTargets(env);
    const settled = await Promise.allSettled(targets.map((t) => scanWalletSwapsViaRpc(w, env, t)));
    if (settled[0].status === 'rejected') throw settled[0].reason;
    rows = settled.flatMap((r) => (r.status === 'fulfilled' ? r.value : []));
    complete = settled.every((r) => r.status === 'fulfilled' && (r.value as { complete?: boolean }).complete === true);
    settled.forEach((r, i) => {
      if (i > 0 && r.status === 'rejected') console.error('[orders] one-tap chain scan failed:', r.reason);
    });
  } catch (e) {
    console.error('[orders] chain scan failed:', e);
  }

  // Last resort: the public block explorer (tight limits, so only when the node failed)
  if (!rows) {
    try {
      const router = (env.ROUTER_ADDRESS || DEFAULT_ROUTER_ADDRESS).toLowerCase();
      const base = env.BLOCKSCOUT_URL || 'https://celo.blockscout.com';
      const topic1 = `0x${'0'.repeat(24)}${w.slice(2)}`;
      const res = await fetch(
        `${base}/api?module=logs&action=getLogs&fromBlock=${ROUTER_DEPLOY_BLOCK}&toBlock=latest` +
          `&address=${router}&topic0=${CASH_OUT_TOPIC}&topic1=${topic1}&topic0_1_opr=and`
      );
      if (!res.ok) throw new Error(`indexer ${res.status}`);
      const payload = (await res.json()) as { result?: unknown };
      rows = Array.isArray(payload.result) ? (payload.result as SwapRow[]) : [];
    } catch (e) {
      console.error('[orders] swap indexer lookup failed:', e);
    }
  }

  if (rows) {
    // Never cache a half-read history: that kept showing customers an incomplete list for minutes
    if (edge && complete) {
      await edge.put(cacheKey, new Response(JSON.stringify(rows), { headers: { 'Cache-Control': 'public, max-age=180' } }));
    }
    return Object.assign(rows, { complete });
  }

  const saved: SwapRow[] = [];
  let sawAny = false;
  for (const t of scanTargets(env)) {
    const state = await env.ORDER_STORE.get(t.stateKey(w));
    if (!state) continue;
    try {
      saved.push(...(JSON.parse(state) as ScanState).rows);
      sawAny = true;
    } catch {
      // unreadable
    }
  }
  if (sawAny) return saved;
  throw new Error('swap lookup unavailable');
}

/**
 * GET /swaps/unfinished?wallet=0x...
 * Finds recent GoodCash swaps made by this wallet that never got a payout (or whose payout
 * order was never paid), so the app can offer to finish them without the customer doing anything.
 */
async function handleUnfinishedSwaps(request: Request, env: Env): Promise<Response> {
  const limited = await checkRateLimit(request, env, 'unfinished');
  if (limited) return limited;

  const wallet = new URL(request.url).searchParams.get('wallet') ?? '';
  if (!/^0x[0-9a-fA-F]{40}$/.test(wallet)) return err('Invalid wallet address', 400);

  let rows: SwapRow[];
  try {
    rows = await getWalletSwapRows(wallet, env);
  } catch {
    return err('Could not check your swaps right now.', 503);
  }

  const now = Math.floor(Date.now() / 1000);
  const recent = rows
    .map((r) => ({
      txHash: r.transactionHash,
      at: parseInt(r.timeStamp, 16),
      data: r.data.startsWith('0x') ? r.data.slice(2) : r.data,
    }))
    .filter((r) => r.data.length >= 128 && now - r.at <= THIRTY_DAYS_S)
    .sort((a, b) => b.at - a.at)
    .slice(0, 8);
  const oneTapHashes = new Set(rows.filter((r) => r.v2).map((r) => r.transactionHash.toLowerCase()));

  const swaps: Array<{ txHash: string; amountG: string; usdtReceived: string; at: number }> = [];
  for (const r of recent) {
    // A one-tap cash out pays the partner in the same transaction, so there is never a payout left to finish
    if (oneTapHashes.has(r.txHash.toLowerCase())) continue;
    const orderId = await env.ORDER_STORE.get(`swap:${r.txHash.toLowerCase()}`);
    if (orderId) {
      const status = await lookupOrderStatus(orderId, env);
      if (status && !UNPAID_STATUSES.has(status)) continue; // already paid out or in progress
    }
    const amountIn = BigInt(`0x${r.data.slice(0, 64)}`);
    const amountOut = BigInt(`0x${r.data.slice(64, 128)}`);
    swaps.push({
      txHash: r.txHash,
      amountG: (Number(amountIn) / 1e18).toString(),
      usdtReceived: (Number(amountOut) / 1e6).toString(),
      at: r.at,
    });
  }
  return json({ swaps });
}

const SupportSchema = z.object({
  email: z.string().trim().email().max(200),
  topic: z.enum(['not_arrived', 'payment_failed', 'wrong_amount', 'charged_nothing', 'other']),
  message: z.string().trim().min(10).max(2000),
  context: z
    .object({
      orderId: z.string().max(80).optional(),
      txHash: z.string().max(80).optional(),
      wallet: z.string().max(60).optional(),
      status: z.string().max(60).optional(),
      amountG: z.string().max(40).optional(),
      naira: z.string().max(40).optional(),
      createdAt: z.string().max(60).optional(),
      page: z.string().max(200).optional(),
      userAgent: z.string().max(300).optional(),
    })
    .default({}),
});

const TOPIC_LABELS: Record<string, string> = {
  not_arrived: 'Naira has not arrived',
  payment_failed: "Payment didn't go through",
  wrong_amount: 'Amount looks wrong',
  charged_nothing: 'Charged but nothing happened',
  other: 'Something else',
};

/** POST /support - store a help request and (if configured) email it to the team. */
async function handleSupport(request: Request, env: Env): Promise<Response> {
  const limited = await checkRateLimit(request, env, 'support', 'strict');
  if (limited) return limited;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return err('Invalid JSON body');
  }
  const parsed = SupportSchema.safeParse(body);
  if (!parsed.success) return err('Please check your email and describe the problem (at least 10 characters).');

  const { email, topic, message, context } = parsed.data;
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  const ticketId = `GC-${Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('')}`;

  await env.ORDER_STORE.put(
    `ticket:${ticketId}`,
    JSON.stringify({ ticketId, email, topic, message, context, createdAt: new Date().toISOString() }),
    { expirationTtl: 60 * 60 * 24 * 90 }
  );
  // The team's log gets the ticket id and topic only; the email address stays in the ticket itself.
  console.error(`[support] ticket ${ticketId} topic=${topic} order=${context.orderId ?? '-'}`);

  if (env.RESEND_API_KEY && env.SUPPORT_INBOX) {
    const text = [
      `Ticket ${ticketId}`,
      `Topic: ${TOPIC_LABELS[topic]}`,
      `Customer email: ${email}`,
      '',
      message,
      '',
      '--- Attached automatically ---',
      `Order reference: ${context.orderId ?? '-'}`,
      `Swap transaction: ${context.txHash ? `https://celo.blockscout.com/tx/${context.txHash}` : '-'}`,
      `Wallet: ${context.wallet ?? '-'}`,
      `Status shown: ${context.status ?? '-'}`,
      `Amount: ${context.amountG ?? '-'} G$ -> ${context.naira ?? '-'}`,
      `Cash out time: ${context.createdAt ?? '-'}`,
      `Page: ${context.page ?? '-'}`,
      `Browser: ${context.userAgent ?? '-'}`,
    ].join('\n');
    try {
      await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: env.RESEND_FROM || 'GoodCash Support <onboarding@resend.dev>',
          to: [env.SUPPORT_INBOX],
          reply_to: email,
          subject: `[${ticketId}] ${TOPIC_LABELS[topic]}`,
          text,
        }),
      });
    } catch (e) {
      console.error('[support] email notification failed:', e);
    }
  }

  return json({ ticketId }, 201);
}


/**
 * POST /diag - quiet error reports from the app. Goes to the team's logs only, never shown to users.
 * Carries a short code and message; no bank details and no email addresses.
 */
async function handleDiag(request: Request, env: Env): Promise<Response> {
  const limited = await checkRateLimit(request, env, 'diag', 'strict');
  if (limited) return new Response(null, { status: 204 });
  try {
    const body = (await request.json()) as { kind?: unknown; message?: unknown; orderId?: unknown; txHash?: unknown };
    const clean = (v: unknown, n: number) => (typeof v === 'string' ? v.replace(/[\r\n]+/g, ' ').slice(0, n) : '-');
    console.error(
      `[diag] kind=${clean(body.kind, 40)} order=${clean(body.orderId, 60)} tx=${clean(body.txHash, 70)} msg=${clean(body.message, 300)}`
    );
  } catch {
    // ignore malformed reports
  }
  return new Response(null, { status: 204 });
}

/** GET /swaps/:txHash - which payout order belongs to a swap, and its current status. */
async function handleSwapOrder(txHash: string, env: Env): Promise<Response> {
  if (!/^0x[0-9a-fA-F]{64}$/.test(txHash)) return err('Invalid transaction hash', 400);
  const orderId = await env.ORDER_STORE.get(`swap:${txHash.toLowerCase()}`);
  if (!orderId) return err('No payout order for this swap', 404);
  const status = await lookupOrderStatus(orderId, env);
  return json({ orderId, status: status ?? 'initiated' });
}


/**
 * GET /history?wallet=0x...
 * Every GoodCash swap this wallet has made, with the payout status of each, so the same wallet shows
 * the same History on any phone or laptop. Public swap data plus order status only: no bank details.
 */
async function handleWalletHistory(request: Request, env: Env): Promise<Response> {
  const limited = await checkRateLimit(request, env, 'history');
  if (limited) return limited;

  const wallet = new URL(request.url).searchParams.get('wallet') ?? '';
  if (!/^0x[0-9a-fA-F]{40}$/.test(wallet)) return err('Invalid wallet address', 400);

  let rows: SwapRow[];
  try {
    rows = await getWalletSwapRows(wallet, env);
  } catch {
    return err('Could not load your history right now.', 503);
  }

  const swaps = rows
    .map((r) => ({
      txHash: r.transactionHash,
      at: parseInt(r.timeStamp, 16),
      data: r.data.startsWith('0x') ? r.data.slice(2) : r.data,
      payTo: r.v2 ? r.payTo : undefined,
    }))
    .filter((r) => r.data.length >= 128)
    .sort((a, b) => b.at - a.at)
    .slice(0, 25);

  let liveLookups = 0;
  const out: Array<{
    txHash: string;
    amountG: string;
    usdtReceived: string;
    at: number;
    orderId?: string;
    status?: string;
    naira?: string;
  }> = [];
  for (const r of swaps) {
    const key = r.txHash.toLowerCase();
    let orderId = await env.ORDER_STORE.get(`swap:${key}`);
    // A one-tap cash out paid the partner's deposit address directly: find its order from that address
    if (!orderId && r.payTo) {
      const link = await env.ORDER_STORE.get(`rcv:${r.payTo.toLowerCase()}`);
      if (link) {
        try {
          const parsedLink = JSON.parse(link) as { o?: string; n?: string };
          if (parsedLink.o) {
            orderId = parsedLink.o;
            await env.ORDER_STORE.put(`swap:${key}`, orderId, { expirationTtl: 60 * 60 * 24 * 400 });
            if (parsedLink.n) await env.ORDER_STORE.put(`naira:${key}`, parsedLink.n, { expirationTtl: 60 * 60 * 24 * 400 });
          }
        } catch {
          // unreadable link: show the swap without an order
        }
      }
    }
    let status: string | undefined;
    if (orderId) {
      const done = await env.ORDER_STORE.get(`done:${key}`);
      if (done) {
        status = done;
      } else if (liveLookups < 8) {
        liveLookups += 1;
        status = (await lookupOrderStatus(orderId, env)) ?? undefined;
        if (status && PAID_STATUSES.has(status)) {
          await env.ORDER_STORE.put(`done:${key}`, status, { expirationTtl: 60 * 60 * 24 * 400 });
        }
      }
    }
    const naira = (await env.ORDER_STORE.get(`naira:${key}`)) ?? undefined;
    out.push({
      txHash: r.txHash,
      amountG: (Number(BigInt(`0x${r.data.slice(0, 64)}`)) / 1e18).toString(),
      usdtReceived: (Number(BigInt(`0x${r.data.slice(64, 128)}`)) / 1e6).toString(),
      at: r.at,
      ...(orderId ? { orderId } : {}),
      ...(status ? { status } : {}),
      ...(naira ? { naira } : {}),
    });
  }
  return json({ swaps: out, complete: (rows as { complete?: boolean }).complete !== false });
}

// ---------------------------------------------------------------------------
// Route handlers
// ---------------------------------------------------------------------------

/**
 * POST /orders
 * Create a Paycrest off-ramp order. The Paycrest API key stays server-side.
 */
/**
 * Ask the payout partner for an off-ramp order. Returns the order, or a ready-made friendly error response.
 * The partner's API key stays on the server.
 */
/**
 * GoodCash's own fee on a cash out, as a percent of the payout. Off unless BOTH a percent and an EVM fee address
 * are configured. Capped at 5 so a typo can never charge a customer a lot.
 */
export function goodcashFeePercent(env: Env): number {
  const pct = Number(env.SENDER_FEE_PERCENT);
  if (!Number.isFinite(pct) || pct <= 0 || pct > 5) return 0;
  if (!env.SENDER_FEE_ADDRESS || !/^0x[0-9a-fA-F]{40}$/.test(env.SENDER_FEE_ADDRESS)) return 0;
  return pct;
}

/**
 * The fee we actually charge on this order: the configured percent, but only when the customer's screen showed that
 * same percent. An older screen (or a different build) that does not show the fee is never charged it.
 */
export function chargedFeePercent(env: Env, shown: number | undefined): number {
  const configured = goodcashFeePercent(env);
  return configured > 0 && typeof shown === 'number' && Math.abs(shown - configured) < 1e-9 ? configured : 0;
}

/**
 * A partner error, safe for our logs: the field and message only, with long digit runs (account numbers, BVN/NIN,
 * phone numbers) and email addresses masked, because the partner may echo back what we sent.
 */
export function safePartnerError(text: string): string {
  let field = '';
  let message = text;
  try {
    const j = JSON.parse(text) as { field?: unknown; message?: unknown; error?: unknown };
    field = typeof j.field === 'string' ? j.field : '';
    message = typeof j.message === 'string' ? j.message : typeof j.error === 'string' ? j.error : text;
  } catch {
    // not JSON: keep the raw text, masked below
  }
  const masked = message
    .replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, '[email]')
    .replace(/\d{6,}/g, '[number]')
    .replace(/[\r\n]+/g, ' ')
    .slice(0, 160);
  return `${field ? `field=${field} ` : ''}${masked}`;
}

async function createPaycrestOrderRaw(
  env: Env,
  input: {
    amount: string;
    refundAddress: string;
    recipient: { institution: string; accountIdentifier: string; accountName: string; memo?: string };
    reference: string;
    /** The fee percent the customer's screen showed (see chargedFeePercent) */
    feePercentShown?: number;
  }
): Promise<{ order: PaycrestOrderResponse } | { response: Response }> {
  const feePct = chargedFeePercent(env, input.feePercentShown);
  const feeFields: Record<string, string> =
    feePct > 0
      ? // A percent fee. "customer" pays the partner's own transaction fee on top, so GoodCash earns the full percent
        // even on small orders (otherwise the partner's fee would swallow it).
        { senderFeePercent: String(feePct), senderFeeAddress: env.SENDER_FEE_ADDRESS as string, transactionFeePayer: 'customer' }
      : // Paycrest rejects an explicit zero fee ("Sender fee must be greater than zero") and requires a fee address
        // whenever a fee is set. So send no fee at all unless the team configures both.
        env.SENDER_FEE && Number(env.SENDER_FEE) > 0 && env.SENDER_FEE_ADDRESS
        ? { senderFee: env.SENDER_FEE, senderFeeAddress: env.SENDER_FEE_ADDRESS }
        : {};
  const paycrestBody = {
    amount: input.amount,
    ...feeFields,
    source: {
      type: 'crypto',
      currency: 'USDT',
      network: 'celo',
      refundAddress: input.refundAddress,
    },
    destination: {
      type: 'fiat',
      currency: 'NGN',
      recipient: {
        institution: input.recipient.institution,
        accountIdentifier: input.recipient.accountIdentifier,
        accountName: input.recipient.accountName,
        memo: input.recipient.memo ?? 'GoodCash',
      },
    },
    reference: input.reference,
  };

  const post = (body: unknown) =>
    fetch(`${env.PAYCREST_BASE_URL}/v2/sender/orders`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'API-Key': env.PAYCREST_API_KEY,
      },
      body: JSON.stringify(body),
    });

  try {
    let res = await post(paycrestBody);
    if (!res.ok && feePct > 0 && (res.status === 400 || res.status === 422)) {
      // The partner may refuse our fee setting (for example a cap on the profile). Never block a customer's cash out
      // over our own fee: log it for the team and create the order without the fee.
      console.error(`[orders] Paycrest refused the GoodCash fee (${res.status}): ${safePartnerError(await res.text())}. Retrying without it.`);
      const { senderFeePercent: _a, senderFeeAddress: _b, transactionFeePayer: _c, ...noFee } = paycrestBody as Record<string, unknown>;
      res = await post(noFee);
    }
    if (!res.ok) {
      const errText = await res.text();
      // Sanitise: do not forward raw Paycrest error which may contain internal details
      console.error(`[orders] Paycrest error ${res.status}: ${safePartnerError(errText)}`);
      return { response: err('The payout partner could not create the order right now. Please try again shortly.', 502) };
    }
    return { order: unwrapPaycrestData<PaycrestOrderResponse>(await res.json()) };
  } catch (e) {
    console.error('[orders] Paycrest fetch failed:', e);
    return { response: err('Off-ramp provider is unreachable. Please try again later.', 503) };
  }
}

/** A one-way fingerprint of where an order pays out, so we can tell whether two orders are for the same bank account. */
async function recipientFingerprint(input: { recipient: { institution: string; accountIdentifier: string } ; refundAddress: string }): Promise<string> {
  const data = new TextEncoder().encode(`${input.recipient.institution}|${input.recipient.accountIdentifier}|${input.refundAddress.toLowerCase()}`);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

function toClientOrder(o: PaycrestOrderResponse): ClientOrderResponse {
  return {
    orderId: o.id,
    receiveAddress: o.providerAccount.receiveAddress,
    amountToSend: o.providerAccount.amountToTransfer,
    currency: o.providerAccount.currency,
    network: o.providerAccount.network,
    memo: o.providerAccount.memo,
    amount: o.amount,
    rate: o.rate,
    expectedNaira: expectedNairaFromOrder(o),
    senderFee: o.senderFee ?? '0',
    transactionFee: o.transactionFee,
    validUntil: o.providerAccount.validUntil,
    status: o.status ?? 'initiated',
  };
}

async function fetchPaycrestOrder(orderId: string, env: Env): Promise<PaycrestOrderResponse | null> {
  try {
    const res = await fetch(`${env.PAYCREST_BASE_URL}/v2/sender/orders/${orderId}`, { headers: { 'API-Key': env.PAYCREST_API_KEY } });
    if (!res.ok) return null;
    const o = unwrapPaycrestData<PaycrestOrderResponse>(await res.json());
    return o?.providerAccount ? { ...o, id: o.id ?? orderId } : null;
  } catch {
    return null;
  }
}

async function handleCreateOrder(request: Request, env: Env): Promise<Response> {
  const limited = await checkRateLimit(request, env, 'orders');
  if (limited) return limited;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return err('Invalid JSON body');
  }

  const parsed = CreateOrderSchema.safeParse(body);
  if (!parsed.success) {
    return invalidRequest(parsed.error.issues, 'orders');
  }

  const swapCheck = await verifySwapOnChain(
    parsed.data.swapTxHash,
    parsed.data.refundAddress,
    parsed.data.amount,
    env
  );
  if (swapCheck) return swapCheck;

  // One swap should only ever be paid out once. An earlier order that is still unpaid may be replaced.
  const swapKey = parsed.data.swapTxHash ? `swap:${parsed.data.swapTxHash.toLowerCase()}` : null;
  const previousOrderId = swapKey ? await env.ORDER_STORE.get(swapKey) : null;
  if (previousOrderId) {
    const previous = await lookupOrderStatus(previousOrderId, env);
    if (previous && !UNPAID_STATUSES.has(previous)) {
      return err('This swap already has a payout in progress.', 409);
    }
    // An order that is still open (and may be mid-payment) is handed back, never replaced by a second one.
    // Only when it was made for the SAME bank account: anyone can ask for an order on a public swap, and a
    // customer must never be handed an order that pays out to somebody else's bank.
    const sameRecipient =
      swapKey !== null && (await env.ORDER_STORE.get(`swaprec:${swapKey.slice(5)}`)) === (await recipientFingerprint(parsed.data));
    if (previous === 'initiated' && sameRecipient) {
      const open = await fetchPaycrestOrder(previousOrderId, env);
      const until = open?.providerAccount?.validUntil ? new Date(open.providerAccount.validUntil).getTime() : 0;
      if (open && open.status === 'initiated' && until - Date.now() > 120_000 && open.providerAccount.amountToTransfer) {
        const sameAmount = Math.abs(Number(open.providerAccount.amountToTransfer) - Number(parsed.data.amount)) < 0.05;
        if (sameAmount) return json(toClientOrder(open), 200);
      }
    }
  }

  const input: CreateOrderInput = parsed.data;
  const created = await createPaycrestOrderRaw(env, {
    amount: input.amount,
    refundAddress: input.refundAddress,
    recipient: input.recipient,
    reference: input.reference ?? generateRef(),
    feePercentShown: input.feePercent,
  });
  if ('response' in created) return created.response;
  const paycrestResponse = created.order;

  // Store lightweight state in KV so webhooks can update it
  const orderState = {
    status: paycrestResponse.status ?? 'initiated',
    receiveAddress: paycrestResponse.providerAccount.receiveAddress,
    amountToTransfer: paycrestResponse.providerAccount.amountToTransfer,
    validUntil: paycrestResponse.providerAccount.validUntil,
    paymentReference: null as string | null,
    createdAt: Date.now(),
  };
  await env.ORDER_STORE.put(
    `order:${paycrestResponse.id}`,
    JSON.stringify(orderState),
    { expirationTtl: 86400 }, // 24 hours
  );

  if (swapKey) {
    await env.ORDER_STORE.put(swapKey, paycrestResponse.id, { expirationTtl: 60 * 60 * 24 * 400 });
    await env.ORDER_STORE.put(`swaprec:${swapKey.slice(5)}`, await recipientFingerprint(parsed.data), { expirationTtl: 60 * 60 * 3 });
    const naira = expectedNairaFromOrder(paycrestResponse);
    if (naira) {
      await env.ORDER_STORE.put(`naira:${swapKey.slice(5)}`, naira, { expirationTtl: 60 * 60 * 24 * 400 });
    }
  }

  return json(toClientOrder(paycrestResponse), 201);
}

/**
 * GET /orders/:id
 * Poll order status. Reads from KV (updated by webhook) for fast response.
 * Falls back to Paycrest API if KV has no entry.
 */
async function handleGetOrder(orderId: string, env: Env): Promise<Response> {
  if (!orderId || !/^[0-9a-f-]{36}$/.test(orderId)) {
    return err('Invalid order ID format', 400);
  }

  // Statuses that never change again can be served straight from KV
  const TERMINAL = new Set(['settled', 'refunded', 'expired', 'cancelled', 'error']);

  type CachedState = {
    status: string;
    receiveAddress: string;
    amountToTransfer: string;
    validUntil: string;
    paymentReference: string | null;
  };
  const cachedRaw = await env.ORDER_STORE.get(`order:${orderId}`);
  const cached = cachedRaw ? (JSON.parse(cachedRaw) as CachedState) : null;

  const fromCache = (state: CachedState): ClientStatusResponse => ({
    orderId,
    status: state.status,
    receiveAddress: state.receiveAddress,
    amountToSend: state.amountToTransfer,
    validUntil: state.validUntil,
    paymentReference: state.paymentReference,
  });

  if (cached && TERMINAL.has(cached.status)) return json(fromCache(cached));

  // Not final yet: ask Paycrest, because the webhook may not be set up or may be late
  let res: Response;
  try {
    res = await fetch(`${env.PAYCREST_BASE_URL}/v2/sender/orders/${orderId}`, {
      headers: { 'API-Key': env.PAYCREST_API_KEY },
    });
  } catch {
    if (cached) return json(fromCache(cached));
    return err('The payout partner is unreachable right now.', 503);
  }

  if (res.status === 404) return err('Order not found', 404);
  if (!res.ok) {
    console.error(`[orders] Paycrest order lookup error ${res.status}`);
    if (cached) return json(fromCache(cached));
    return err('The payout partner could not be reached right now.', 502);
  }

  const data = unwrapPaycrestData<PaycrestStatusResponse>(await res.json());
  if (PAID_STATUSES.has(data.status)) await sendPaidEmailIfRequested(orderId, env);
  const clientStatus: ClientStatusResponse = {
    orderId: data.id ?? orderId,
    status: data.status,
    receiveAddress: data.providerAccount?.receiveAddress ?? cached?.receiveAddress,
    amountToSend: data.providerAccount?.amountToTransfer ?? cached?.amountToTransfer,
    validUntil: data.providerAccount?.validUntil ?? cached?.validUntil,
    paymentReference: data.paymentReference ?? cached?.paymentReference ?? null,
  };

  if (cached && data.status && data.status !== cached.status) {
    await env.ORDER_STORE.put(
      `order:${orderId}`,
      JSON.stringify({ ...cached, status: data.status, paymentReference: clientStatus.paymentReference ?? null }),
      { expirationTtl: 86400 }
    );
  }
  return json(clientStatus);
}

/**
 * POST /webhooks/paycrest
 * Receives signed Paycrest events and updates KV order state.
 * Bank details are NOT stored or logged.
 */
async function handleWebhook(request: Request, env: Env): Promise<Response> {
  const rawBody = await request.text();

  // Verify signature: X-Paycrest-Signature header is HMAC-SHA256(secret, body)
  const signatureHeader = request.headers.get('X-Paycrest-Signature')?.trim().toLowerCase() ?? '';
  const expectedSig = await hmacSha256Hex(env.PAYCREST_API_SECRET, rawBody);

  const valid = await timingSafeEqual(signatureHeader, expectedSig);
  if (!valid) {
    console.warn('[webhook] Invalid signature — rejected');
    return new Response('Forbidden', { status: 403 });
  }

  let event: { event: string; data: { id: string; status: string; paymentReference?: string | null } };
  try {
    event = JSON.parse(rawBody);
  } catch {
    return new Response('Bad Request', { status: 400 });
  }

  const { id, status, paymentReference } = event.data ?? {};
  if (!id) return new Response('OK', { status: 200 }); // ignore malformed

  // Naira-in order delivered: tell the customer even if the app is closed
  if (status === 'settled' && (await env.ORDER_STORE.get(`onramp:${id}`))) {
    await maybeSendOnrampReady(id, env);
    return new Response('OK', { status: 200 });
  }

  // Naira-in order held for a compliance review: the status stays "pending", so remember it separately
  if (event.event === 'payment_order.compliance_hold' && (await env.ORDER_STORE.get(`onramp:${id}`))) {
    await env.ORDER_STORE.put(`onramphold:${id}`, '1', { expirationTtl: 14 * 24 * 3600 });
    return new Response('OK', { status: 200 });
  }

  // Update KV — only status and paymentReference (no PII)
  const existing = await env.ORDER_STORE.get(`order:${id}`);
  if (existing) {
    const state = JSON.parse(existing);
    // A late or repeated message must never move an order backwards (e.g. "settled" back to "pending")
    if (status && !statusMovesBackwards(state.status, status)) state.status = status;
    state.paymentReference = paymentReference ?? state.paymentReference ?? null;
    await env.ORDER_STORE.put(`order:${id}`, JSON.stringify(state), { expirationTtl: 86400 });
  }

  if (status && PAID_STATUSES.has(status)) await sendPaidEmailIfRequested(id, env);

  // Return 200 quickly so Paycrest does not retry
  return new Response('OK', { status: 200 });
}

/**
 * GET /institutions/:currency
 * Proxies Paycrest's supported-institution list so the API key stays server-side.
 */
async function handleGetInstitutions(currency: string, env: Env): Promise<Response> {
  if (!/^[A-Z]{3}$/.test(currency)) {
    return err('Currency must be a three-letter uppercase ISO code', 400);
  }

  const base = env.PAYCREST_BASE_URL || 'https://api.paycrest.io';
  try {
    const res = await fetch(`${base}/v2/institutions/${currency}`, {
      headers: {
        Accept: 'application/json',
        'API-Key': env.PAYCREST_API_KEY,
      },
    });
    if (!res.ok) {
      console.error(`[orders] Paycrest institutions error ${res.status}`);
      return err(`Institution list unavailable (${res.status})`, 502);
    }

    const payload = (await res.json()) as { data?: PaycrestInstitution[] };
    const institutions = Array.isArray(payload.data)
      ? payload.data.filter(
          (item): item is PaycrestInstitution =>
            typeof item?.name === 'string' &&
            typeof item?.code === 'string' &&
            typeof item?.type === 'string'
        )
      : [];

    return json({ institutions });
  } catch (e) {
    console.error('[orders] Paycrest institutions fetch failed:', e);
    return err('Institution list unavailable', 503);
  }
}

/**
 * POST /verify-account
 * Resolves a bank account name through Paycrest before an order is created.
 */
async function handleVerifyAccount(request: Request, env: Env): Promise<Response> {
  const limited = await checkRateLimit(request, env, 'verify-account');
  if (limited) return limited;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return err('Invalid JSON body');
  }

  const parsed = VerifyAccountSchema.safeParse(body);
  if (!parsed.success) {
    return err('institution and accountIdentifier are required');
  }

  const base = env.PAYCREST_BASE_URL || 'https://api.paycrest.io';
  let res: Response;
  try {
    res = await fetch(`${base}/v2/verify-account`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'API-Key': env.PAYCREST_API_KEY,
      },
      body: JSON.stringify(parsed.data),
    });
  } catch (e) {
    console.error('[orders] Paycrest verify-account fetch failed:', e);
    return err('Failed to verify account. Please try again.', 503);
  }

  const payload = (await res.json().catch(() => ({}))) as { message?: string; data?: unknown };

  if (res.status === 400) {
    return err(payload.message || 'Account could not be verified. Check the institution and account number.', 400);
  }
  if (!res.ok) {
    return err(payload.message || 'Failed to verify account. Please try again.', 503);
  }

  const accountName = typeof payload.data === 'string' ? payload.data.trim() : '';
  if (!accountName || accountName.toUpperCase() === 'OK') {
    return err('Account name could not be resolved for this account.', 503);
  }

  return json({ accountName, message: payload.message ?? 'Account name was fetched successfully' });
}

/**
 * GET /rates
 * Proxies Paycrest rates endpoint with CORS headers.
 */
async function edgeCached(key: string, ttlSeconds: number, make: () => Promise<Response>): Promise<Response> {
  const edge = typeof caches !== 'undefined' ? (caches as unknown as { default?: Cache }).default : undefined;
  if (!edge) return make();
  const cacheKey = new Request(`https://cache.goodcash.invalid/${key}`);
  const hit = await edge.match(cacheKey);
  if (hit) return new Response(hit.body, { status: hit.status, headers: { 'Content-Type': 'application/json' } });
  const fresh = await make();
  if (fresh.ok) {
    await edge.put(cacheKey, new Response(await fresh.clone().text(), { headers: { 'Cache-Control': `public, max-age=${ttlSeconds}`, 'Content-Type': 'application/json' } }));
  }
  return fresh;
}

async function handleGetRates(env: Env): Promise<Response> {
  return edgeCached('rates', 15, () => fetchRates(env));
}

async function fetchRates(env: Env): Promise<Response> {
  const base = env.PAYCREST_BASE_URL || 'https://api.paycrest.io';
  try {
    const res = await fetch(`${base}/v2/rates/celo/USDT/1/NGN?side=sell`, {
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) {
      return err(`Paycrest rate error (${res.status})`, 502);
    }
    const data = (await res.json()) as { data?: { sell?: { rate?: unknown } } };
    const sellRate = data?.data?.sell?.rate;
    if (sellRate === undefined || sellRate === null || sellRate === '') {
      return err('Paycrest sell rate missing from response', 502);
    }
    return json(data);
  } catch (e) {
    console.error('[orders] Paycrest rates fetch failed:', e);
    return err('Paycrest rate service unreachable', 503);
  }
}

// ---------------------------------------------------------------------------
// One-tap cash out (GoodCashRouterV2)
//
// The customer's single wallet confirmation swaps their G$ and pays the payout partner in the same
// transaction. For that, the payout order has to exist BEFORE the swap, sized to the swap's guaranteed
// minimum, and the router pays the partner exactly the order's amount (anything left goes back to the customer).
// ---------------------------------------------------------------------------

const OneTapOrderSchema = z.object({
  /** The least USDT the swap will produce (the customer's price protection), 6 decimals */
  minUsdt: z.string().regex(/^\d+(\.\d{1,6})?$/, 'Must be a decimal number string'),
  /** G$ the customer is about to cash out (checked against their balance) */
  amountG: z.string().regex(/^\d+(\.\d{1,6})?$/, 'Must be a decimal number string'),
  refundAddress: z.string().regex(/^0x[0-9a-fA-F]{40}$/, 'Must be a valid Ethereum/Celo address'),
  recipient: RecipientSchema,
  reference: z.string().min(8).max(64).regex(/^[a-zA-Z0-9_-]+$/).optional(),
  /** The GoodCash fee percent the customer's screen showed. The fee is charged only when this matches the server's setting. */
  feePercent: z.number().min(0).max(5).optional(),
});

/** The payout partner keeps about this much of the dollars; the order is sized below the minimum by it. */
const ONE_TAP_FEE_RESERVE_ATOMIC = 20_000n; // 0.02 USDT

function toAtomic18(value: string): bigint {
  const [whole, fraction = ''] = value.split('.');
  return BigInt(whole) * 10n ** 18n + BigInt((fraction + '0'.repeat(18)).slice(0, 18));
}

function fromAtomic6Str(v: bigint): string {
  const whole = v / 1_000_000n;
  const frac = (v % 1_000_000n).toString().padStart(6, '0');
  return `${whole}.${frac}`;
}

/** POST /orders/v2 - create the payout order BEFORE a one-tap swap. */
async function handleCreateOneTapOrder(request: Request, env: Env): Promise<Response> {
  const limited = await checkRateLimit(request, env, 'orders');
  if (limited) return limited;

  const routerV2 = env.ROUTER_V2_ADDRESS && /^0x[0-9a-fA-F]{40}$/.test(env.ROUTER_V2_ADDRESS) ? env.ROUTER_V2_ADDRESS : null;
  if (!routerV2) return err('This is not available right now. Please try again later.', 503);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return err('Invalid JSON body');
  }
  const parsed = OneTapOrderSchema.safeParse(body);
  if (!parsed.success) return invalidRequest(parsed.error.issues, 'orders-v2');
  const input = parsed.data;

  // Only people who really hold the G$ can ask for an order (keeps junk orders out)
  try {
    const word = `0x70a08231${'0'.repeat(24)}${input.refundAddress.slice(2).toLowerCase()}`;
    const raw = (await rpcCall(env, 'eth_call', [{ to: G_DOLLAR_TOKEN, data: word }, 'latest'])) as string;
    if (BigInt(raw) < toAtomic18(input.amountG)) return err("That's more G$ than your wallet holds.", 400);
  } catch (e) {
    console.error('[orders] one-tap balance check failed:', e);
    return err('Could not check your balance right now. Please try again.', 503);
  }

  const minAtomic = toAtomic6(input.minUsdt);
  const floor = toAtomic6(PAYCREST_MIN_USDT.toFixed(2));
  // Start from what fits: (guaranteed minimum - partner fee) / (1 + GoodCash fee %). The loop below corrects any rounding.
  const feeBps = BigInt(Math.round(chargedFeePercent(env, input.feePercent) * 100));
  let amountAtomic = ((minAtomic - ONE_TAP_FEE_RESERVE_ATOMIC) * 10_000n) / (10_000n + feeBps);
  const tooSmall = () => err('That amount is too small to pay out after fees. Try a larger amount.', 400);
  if (amountAtomic < floor) return tooSmall();

  // The partner's fee is added on top of the order amount. The total to send must never exceed the guaranteed minimum.
  let order: PaycrestOrderResponse | null = null;
  const reference = input.reference ?? generateRef();
  for (let attempt = 0; attempt < 3; attempt++) {
    const created = await createPaycrestOrderRaw(env, {
      amount: fromAtomic6Str(amountAtomic),
      refundAddress: input.refundAddress,
      recipient: input.recipient,
      reference: attempt === 0 ? reference : `${reference}-${attempt}`.slice(0, 64),
      feePercentShown: input.feePercent,
    });
    if ('response' in created) return created.response;
    const toSend = toAtomic6(created.order.providerAccount.amountToTransfer);
    if (toSend <= minAtomic) {
      order = created.order;
      break;
    }
    amountAtomic -= toSend - minAtomic;
    if (amountAtomic < floor) return tooSmall();
  }
  if (!order) return err('The payout partner could not create the order right now. Please try again shortly.', 502);

  const receive = order.providerAccount.receiveAddress ?? '';
  if (!/^0x[0-9a-fA-F]{40}$/.test(receive) || /^0x0{40}$/.test(receive)) {
    console.error('[orders] one-tap order had an unusable deposit address');
    return err('The payout partner could not create the order right now. Please try again shortly.', 502);
  }
  const validUntil = new Date(order.providerAccount.validUntil).getTime();
  if (!Number.isFinite(validUntil) || validUntil - Date.now() < 5 * 60 * 1000) {
    return err('The payout partner could not create the order right now. Please try again shortly.', 502);
  }

  await env.ORDER_STORE.put(
    `order:${order.id}`,
    JSON.stringify({
      status: order.status ?? 'initiated',
      receiveAddress: receive,
      amountToTransfer: order.providerAccount.amountToTransfer,
      validUntil: order.providerAccount.validUntil,
      paymentReference: null as string | null,
      createdAt: Date.now(),
    }),
    { expirationTtl: 86400 }
  );
  // Lets us find the order from the deposit address later (the swap pays that address directly)
  const naira = expectedNairaFromOrder(order);
  await env.ORDER_STORE.put(`rcv:${receive.toLowerCase()}`, JSON.stringify({ o: order.id, ...(naira ? { n: naira } : {}) }), {
    expirationTtl: 60 * 60 * 24 * 14,
  });

  const client = toClientOrder(order);
  return json({ ...client, payAmountAtomic: toAtomic6(order.providerAccount.amountToTransfer).toString(), routerAddress: routerV2 }, 201);
}

/** POST /orders/:id/swap - link a finished one-tap swap to its order, after checking the chain. */
async function handleLinkOneTapSwap(orderId: string, request: Request, env: Env): Promise<Response> {
  const limited = await checkRateLimit(request, env, 'orders');
  if (limited) return limited;
  if (!/^[0-9a-f-]{36}$/i.test(orderId)) return err('Invalid order ID format', 400);
  const routerV2 = env.ROUTER_V2_ADDRESS?.toLowerCase();
  if (!routerV2) return err('This is not available right now. Please try again later.', 503);

  let body: { txHash?: unknown; wallet?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return err('Invalid JSON body');
  }
  const txHash = typeof body.txHash === 'string' ? body.txHash : '';
  const wallet = typeof body.wallet === 'string' ? body.wallet.toLowerCase() : '';
  if (!/^0x[0-9a-fA-F]{64}$/.test(txHash) || !/^0x[0-9a-f]{40}$/.test(wallet)) return err('Some details were missing or not right. Please try again.', 400);

  const stateRaw = await env.ORDER_STORE.get(`order:${orderId}`);
  if (!stateRaw) return err('We could not find that order.', 404);
  const state = JSON.parse(stateRaw) as { receiveAddress: string; amountToTransfer: string };

  let receipt: RpcReceipt | null;
  try {
    receipt = (await rpcCall(env, 'eth_getTransactionReceipt', [txHash])) as RpcReceipt | null;
  } catch (e) {
    console.error('[orders] one-tap link RPC failed:', e);
    return err('Could not check the transaction right now. Please try again.', 503);
  }
  if (!receipt) return json({ pending: true }, 202);
  if (receipt.status !== '0x1') return err('That transaction did not succeed.', 400);

  const log = receipt.logs?.find((l) => l.address?.toLowerCase() === routerV2 && l.topics?.[0]?.toLowerCase() === CASH_OUT_PAID_TOPIC);
  if (!log) return err('That transaction is not a cash out.', 400);
  if (topicToAddress(log.topics[1]) !== wallet) return err('That cash out belongs to a different wallet.', 403);
  if (topicToAddress(log.topics[2]) !== state.receiveAddress.toLowerCase()) return err('That cash out was not paid to this order.', 400);
  const data = log.data.startsWith('0x') ? log.data.slice(2) : log.data;
  if (data.length < 192) return err('That cash out looks malformed.', 400);
  const paid = BigInt(`0x${data.slice(128, 192)}`);
  if (paid !== toAtomic6(state.amountToTransfer)) return err('That cash out does not match this order.', 400);

  const key = txHash.toLowerCase();
  await env.ORDER_STORE.put(`swap:${key}`, orderId, { expirationTtl: 60 * 60 * 24 * 400 });
  const link = await env.ORDER_STORE.get(`rcv:${state.receiveAddress.toLowerCase()}`);
  try {
    const n = link ? (JSON.parse(link) as { n?: string }).n : undefined;
    if (n) await env.ORDER_STORE.put(`naira:${key}`, n, { expirationTtl: 60 * 60 * 24 * 400 });
  } catch {
    // optional
  }
  return new Response(null, { status: 204 });
}

// ---------------------------------------------------------------------------
// Add G$ (naira -> G$): live quote
//
// Path: the customer pays naira by bank transfer; the payout partner delivers dollars (USDT) on Base to
// the customer's own wallet; one cross-chain swap then turns those dollars into G$ on Celo, in the same wallet.
// This endpoint only READS prices. It creates no order and moves no money.
// ---------------------------------------------------------------------------

const BASE_USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const CELO_G_DOLLAR = '0x62B8B11039FcfE5aB0C56E502b1C372A3d2a9c7A';
/** What a naira order can end up as in the customer's wallet on Celo: G$, or CELO (the coin that pays network fees). */
export type OnrampAsset = 'g' | 'celo';
const ONRAMP_ASSETS: Record<OnrampAsset, { address: string; label: string }> = {
  g: { address: CELO_G_DOLLAR, label: 'G$' },
  celo: { address: '0x0000000000000000000000000000000000000000', label: 'CELO' },
};
function parseAsset(v: unknown): OnrampAsset {
  return v === 'celo' ? 'celo' : 'g';
}
/** Assumed partner fee for a naira order, in dollars. UNVERIFIED: the real fee comes back when an order is created. */
const ONRAMP_FEE_RESERVE_USDT = 0.02;
const ONRAMP_MIN_USDT = 0.5;
const ONRAMP_MAX_NAIRA = 2_000_000;
const QUOTE_WALLET_PLACEHOLDER = '0x000000000000000000000000000000000000dEaD'; // only used when no wallet is connected yet

interface LifiQuote {
  tool?: string;
  estimate?: {
    toAmount?: string;
    toAmountMin?: string;
    executionDuration?: number;
    feeCosts?: Array<{ amountUSD?: string }>;
    gasCosts?: Array<{ amountUSD?: string }>;
  };
}

interface RelayQuote {
  fees?: { relayer?: { amountUsd?: string }; gas?: { amountUsd?: string }; app?: { amountUsd?: string } };
  details?: { currencyOut?: { amount?: string; minimumAmount?: string } };
}

interface OnrampPaycrestOrder {
  id: string;
  status?: string;
  providerAccount?: { institution?: string; accountIdentifier?: string; accountName?: string; amountToTransfer?: string; currency?: string; validUntil?: string };
}

async function handleOnrampQuote(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const naira = Number(url.searchParams.get('naira'));
  const wallet = url.searchParams.get('wallet') ?? '';
  const asset = parseAsset(url.searchParams.get('asset'));
  if (!Number.isFinite(naira) || naira <= 0) return err('Enter an amount in naira.', 400);
  if (naira > ONRAMP_MAX_NAIRA) return err(`The most you can add at once is ₦${ONRAMP_MAX_NAIRA.toLocaleString('en-US')}.`, 400);
  if (wallet && !/^0x[0-9a-fA-F]{40}$/.test(wallet)) return err('Invalid wallet address', 400);

  const unavailable = () => err('Adding G$ is not available right now. Please try again later.', 503);
  const base = env.PAYCREST_BASE_URL || 'https://api.paycrest.io';

  // 1. What the partner charges for dollars on Base (naira per dollar)
  let rate: number;
  try {
    const guess = Math.max(ONRAMP_MIN_USDT, Math.round((naira / 1385) * 100) / 100);
    const res = await fetch(`${base}/v2/rates/base/USDC/${guess}/NGN?side=buy`, { headers: { Accept: 'application/json' } });
    if (!res.ok) return unavailable();
    const body = (await res.json()) as { data?: { buy?: { rate?: string } } };
    rate = Number(body?.data?.buy?.rate);
    if (!Number.isFinite(rate) || rate <= 0) return unavailable();
  } catch (e) {
    console.error('[onramp] partner rate failed:', e);
    return unavailable();
  }

  // 2. Dollars that actually reach the customer's wallet after the partner fee
  const usdtDelivered = naira / rate - ONRAMP_FEE_RESERVE_USDT;
  const minNaira = Math.ceil(((ONRAMP_MIN_USDT + ONRAMP_FEE_RESERVE_USDT) * rate) / 100) * 100;
  if (usdtDelivered < ONRAMP_MIN_USDT) {
    return json({ error: `The least you can add is ₦${minNaira.toLocaleString('en-US')}.`, minNaira }, 400);
  }
  const atomic = BigInt(Math.floor(usdtDelivered * 1e6));

  // 3. What one gasless swap turns those dollars into (G$ on Celo, same wallet)
  const from = wallet || QUOTE_WALLET_PLACEHOLDER;
  let relay: RelayQuote;
  try {
    const res = await fetch('https://api.relay.link/quote/v2', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        user: from,
        recipient: from,
        originChainId: 8453,
        originCurrency: BASE_USDC,
        destinationChainId: 42220,
        destinationCurrency: ONRAMP_ASSETS[asset].address,
        tradeType: 'EXACT_INPUT',
        amount: atomic.toString(),
        usePermit: true,
      }),
    });
    if (!res.ok) return unavailable();
    relay = (await res.json()) as RelayQuote;
  } catch (e) {
    console.error('[onramp] swap quote failed:', e);
    return unavailable();
  }
  const out = relay.details?.currencyOut;
  if (!out?.amount) return unavailable();
  const gOut = Number(BigInt(out.amount)) / 1e18;
  const minOut = relay.details?.currencyOut?.minimumAmount ? Number(BigInt(relay.details.currencyOut.minimumAmount)) / 1e18 : gOut * 0.99;
  const feeUsd = Number(relay.fees?.relayer?.amountUsd ?? 0) + Number(relay.fees?.gas?.amountUsd ?? 0) + Number(relay.fees?.app?.amountUsd ?? 0);
  return json({
    naira,
    ngnPerUsd: rate,
    usdtDelivered,
    partnerFeeUsd: ONRAMP_FEE_RESERVE_USDT,
    swapFeeUsd: Math.round(feeUsd * 10_000) / 10_000,
    networkFeeUsd: 0,
    asset,
    // gOut / gOutMin keep their old names (they hold the amount of whichever asset was asked for)
    gOut,
    gOutMin: minOut,
    amountOut: gOut,
    amountOutMin: minOut,
    seconds: null,
    minNaira,
    // Quotes move; the app must ask again if it is older than this
    validForSeconds: 30,
  });
}

// ---------------------------------------------------------------------------
// Add G$: create the naira order, and follow it
//
// The customer's ID details (name, birth date, BVN or NIN) go straight to the payout partner, which the partner
// requires to take naira. We never write them to storage and never log them.
// ---------------------------------------------------------------------------

const OnrampOrderSchema = z.object({
  naira: z.number().int().min(1000).max(ONRAMP_MAX_NAIRA),
  wallet: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  fullName: z.string().trim().min(3).max(100),
  birthDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  idType: z.enum(['BVN', 'NIN']),
  idNumber: z.string().regex(/^\d{11}$/),
  asset: z.enum(['g', 'celo']).optional(),
  refundAccount: z.object({
    institution: z.string().regex(/^[A-Za-z0-9]{4,16}$/),
    accountIdentifier: z.string().regex(/^\d{10}$/),
    accountName: z.string().trim().min(3).max(100),
  }),
});

export function isAdult(birthDate: string, now = Date.now()): boolean {
  const [y, m, d] = birthDate.split('-').map(Number);
  const born = new Date(Date.UTC(y, m - 1, d));
  if (Number.isNaN(born.getTime()) || born.getUTCMonth() !== m - 1 || y < 1900) return false;
  const t = new Date(now);
  let age = t.getUTCFullYear() - y;
  if (t.getUTCMonth() < m - 1 || (t.getUTCMonth() === m - 1 && t.getUTCDate() < d)) age -= 1;
  return age >= 18;
}

async function handleCreateOnrampOrder(request: Request, env: Env): Promise<Response> {
  const limited = await checkRateLimit(request, env, 'onramp', 'strict');
  if (limited) return limited;
  if (Number(request.headers.get('Content-Length') ?? '0') > 8_192) return err('Request too large', 413);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return err('Invalid JSON body');
  }
  const parsed = OnrampOrderSchema.safeParse(body);
  if (!parsed.success) return err('Please check your details and try again.');
  const input = parsed.data;
  if (!isAdult(input.birthDate)) return err('You must be 18 or older to use this.', 400);

  const reference = generateRef('goodcash-in');
  const paycrestBody = {
    amount: String(input.naira),
    amountIn: 'fiat',
    source: {
      type: 'fiat',
      currency: 'NGN',
      refundAccount: input.refundAccount,
      kyc: {
        entityType: 'person',
        personDetails: {
          fullName: input.fullName,
          birthDate: input.birthDate,
          idDocument: { type: input.idType === 'BVN' ? 'BVN' : 'nationalID', number: input.idNumber, issuerCountry: 'NG' },
        },
      },
    },
    destination: { type: 'crypto', currency: 'USDC', recipient: { address: input.wallet, network: 'base' } },
    reference,
  };

  let res: Response;
  try {
    res = await fetch(`${env.PAYCREST_BASE_URL}/v2/sender/orders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'API-Key': env.PAYCREST_API_KEY },
      body: JSON.stringify(paycrestBody),
    });
  } catch (e) {
    console.error('[onramp] partner unreachable:', e);
    return err('Adding G$ is not available right now. Please try again later.', 503);
  }
  if (!res.ok) {
    const text = (await res.text()).slice(0, 300);
    // The partner's message can quote back the customer's details, so log only the status and the field name
    console.error(`[onramp] partner error ${res.status}: ${(text.match(/"field":"([A-Za-z]+)"/) ?? [])[1] ?? 'unknown'}`);
    if (res.status === 400 && /name does not match/i.test(text)) {
      return err('The name on your details must match the name on the bank account you will pay from.', 400);
    }
    return err('We could not start this order. Please check your details and try again.', res.status >= 500 ? 502 : 400);
  }
  const order = unwrapPaycrestData<OnrampPaycrestOrder>(await res.json());
  const pa = order?.providerAccount;
  if (!order?.id || !pa?.accountIdentifier || !pa.amountToTransfer) {
    console.error('[onramp] unexpected partner response shape');
    return err('We could not start this order. Please try again.', 502);
  }
  await env.ORDER_STORE.put(
    `onramp:${order.id}`,
    JSON.stringify({ wallet: input.wallet.toLowerCase(), naira: input.naira, asset: parseAsset(input.asset), createdAt: Date.now() }),
    { expirationTtl: 14 * 24 * 3600 }
  );
  return json(
    {
      orderId: order.id,
      status: order.status ?? 'initiated',
      bank: { institution: pa.institution, accountIdentifier: pa.accountIdentifier, accountName: pa.accountName },
      amountToTransfer: pa.amountToTransfer,
      validUntil: pa.validUntil,
    },
    201
  );
}

// The swap service is reached through us, so its key (if any) stays secret and this is not an open relay:
// only the one fixed swap (dollars on Base -> G$ on Celo, to the customer's own wallet) can be asked for.
function relayHeaders(env: Env): Record<string, string> {
  return { 'Content-Type': 'application/json', Accept: 'application/json', ...(env.RELAY_API_KEY ? { 'x-api-key': env.RELAY_API_KEY } : {}) };
}

const RelayQuoteSchema = z.object({
  wallet: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  amount: z.string().regex(/^\d{1,12}$/), // USDC, 6 decimals
  asset: z.enum(['g', 'celo']).optional(),
});

async function handleRelayQuote(request: Request, env: Env): Promise<Response> {
  const limited = await checkRateLimit(request, env, 'relay');
  if (limited) return limited;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return err('Invalid JSON body');
  }
  const parsed = RelayQuoteSchema.safeParse(body);
  if (!parsed.success || BigInt(parsed.data.amount) < 500_000n) return err('Some details were missing or not right. Please try again.');
  try {
    const res = await fetch('https://api.relay.link/quote/v2', {
      method: 'POST',
      headers: relayHeaders(env),
      body: JSON.stringify({
        user: parsed.data.wallet,
        recipient: parsed.data.wallet,
        originChainId: 8453,
        originCurrency: BASE_USDC,
        destinationChainId: 42220,
        destinationCurrency: ONRAMP_ASSETS[parseAsset(parsed.data.asset)].address,
        tradeType: 'EXACT_INPUT',
        amount: parsed.data.amount,
        usePermit: true,
      }),
    });
    if (!res.ok) {
      console.error(`[relay] quote ${res.status}`);
      return err('Could not get a price right now. Please try again.', 502);
    }
    return json(await res.json());
  } catch (e) {
    console.error('[relay] quote failed:', e);
    return err('Could not get a price right now. Please try again.', 503);
  }
}

const RelayExecuteSchema = z.object({
  signature: z.string().regex(/^0x[0-9a-fA-F]{130,}$/),
  requestId: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
  kind: z.literal('eip3009'),
  api: z.enum(['swap', 'bridge', 'user-swap']).optional(),
});

async function handleRelayExecute(request: Request, env: Env): Promise<Response> {
  const limited = await checkRateLimit(request, env, 'relay');
  if (limited) return limited;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return err('Invalid JSON body');
  }
  const parsed = RelayExecuteSchema.safeParse(body);
  if (!parsed.success) return err('Some details were missing or not right. Please try again.');
  const { signature, ...rest } = parsed.data;
  try {
    const res = await fetch(`https://api.relay.link/execute/permits?signature=${signature}`, {
      method: 'POST',
      headers: relayHeaders(env),
      body: JSON.stringify(rest),
    });
    if (!res.ok) {
      console.error(`[relay] execute ${res.status}`);
      return err('The swap could not be started. Nothing was taken. Please try again.', 502);
    }
    return json(await res.json());
  } catch (e) {
    console.error('[relay] execute failed:', e);
    return err('The swap could not be started. Nothing was taken. Please try again.', 503);
  }
}

async function handleRelayStatus(request: Request, env: Env): Promise<Response> {
  const requestId = new URL(request.url).searchParams.get('requestId') ?? '';
  if (!/^0x[0-9a-fA-F]{64}$/.test(requestId)) return err('Some details were missing or not right. Please try again.');
  try {
    const res = await fetch(`https://api.relay.link/intents/status/v3?requestId=${requestId}`, { headers: relayHeaders(env) });
    if (!res.ok) return err('Could not check this right now.', 502);
    const d = (await res.json()) as { status?: string };
    return json({ status: d.status ?? 'unknown' });
  } catch {
    return err('Could not check this right now.', 503);
  }
}

/**
 * Customer-facing stages for a naira order (Paycrest on-ramp lifecycle):
 * initiated -> pending (matched to a provider, STILL WAITING for the bank transfer) -> fulfilling (naira received)
 * -> validated -> settling -> settled (dollars delivered to the wallet).
 * A compliance hold is a webhook event, not a status: the order stays "pending", so it is passed in separately.
 */
export function onrampStage(status: string, held = false): 'waiting' | 'received' | 'done' | 'expired' | 'refund' | 'review' {
  switch (status) {
    case 'settled':
      return 'done';
    case 'fulfilling':
    case 'fulfilled':
    case 'validated':
    case 'settling':
      return 'received';
    case 'expired':
    case 'cancelled':
      return 'expired';
    case 'refunding':
    case 'refunded':
      return 'refund';
    case 'pending':
      return held ? 'review' : 'waiting';
    default:
      return 'waiting';
  }
}

// ---------------------------------------------------------------------------
// Add G$ emails: "your money is ready" (naira arrived, tap to get G$) and "your G$ is in your wallet".
// Kept apart from the cash-out email on purpose (different keys, different words).
// ---------------------------------------------------------------------------

function onrampEmailHtml(kind: 'ready' | 'arrived', orderId: string, naira: string | null, asset: OnrampAsset = 'g'): string {
  const ref = orderId.slice(0, 8);
  const what = ONRAMP_ASSETS[asset].label;
  const headline = kind === 'ready' ? 'YOUR MONEY IS READY' : `${what} ADDED`;
  const big = kind === 'ready' ? 'One last tap' : `Your ${what} is in your wallet`;
  const small =
    kind === 'ready'
      ? `${naira ? `Your ${naira} has arrived. ` : 'Your naira has arrived. '}Open GoodCash and tap <b>Get my ${what}</b> to finish. It costs you no fee.`
      : asset === 'celo'
      ? 'It is in your wallet now. It pays the small network fee when you cash out.'
      : 'It is in your wallet now. You can cash out any time.';
  const button = kind === 'ready' ? `Get my ${what}` : 'Open GoodCash';
  return `<!doctype html><html><body style="margin:0;padding:0;background:#cdb8ff;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#cdb8ff;padding:28px 12px;">
<tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:440px;">
<tr><td style="padding:0 4px 14px;font-family:Arial,Helvetica,sans-serif;font-size:24px;font-weight:900;color:#111;letter-spacing:-0.5px;"><img src="https://goodcash.xyz/email-logo.png" width="44" height="44" alt="" style="vertical-align:middle;border:0;margin-right:10px;">GoodCash</td></tr>
<tr><td style="background:#ffffff;border:3px solid #111;border-radius:22px;box-shadow:5px 5px 0 #111;padding:26px 22px;text-align:center;font-family:Arial,Helvetica,sans-serif;color:#111;">
<div style="display:inline-block;width:54px;height:54px;line-height:54px;border-radius:50%;background:#8cf0c0;border:3px solid #111;font-size:28px;font-weight:900;">&#10003;</div>
<div style="font-size:12px;font-weight:800;letter-spacing:1.5px;margin-top:14px;">${headline}</div>
<div style="font-size:30px;font-weight:900;line-height:1.15;margin:8px 0 10px;">${big}</div>
<div style="font-size:15px;line-height:1.5;margin:0 0 20px;color:#333;">${small}</div>
<a href="https://goodcash.xyz" style="display:inline-block;background:#7b39fc;color:#ffffff;text-decoration:none;font-weight:900;font-size:16px;padding:14px 26px;border:3px solid #111;border-radius:16px;box-shadow:3px 3px 0 #111;">${button}</a>
</td></tr>
<tr><td style="padding:16px 8px 0;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:1.6;color:#2b1d55;text-align:center;">
Reference: ${ref}<br>Questions? Open GoodCash and choose Contact support.
</td></tr>
</table></td></tr></table></body></html>`;
}

/** Which asset a naira order was for (older orders had no choice: G$). */
async function onrampAssetOf(orderId: string, env: Env): Promise<OnrampAsset> {
  try {
    const raw = await env.ORDER_STORE.get(`onramp:${orderId}`);
    return raw ? parseAsset((JSON.parse(raw) as { asset?: unknown }).asset) : 'g';
  } catch {
    return 'g';
  }
}

interface OnrampNotify {
  email: string;
  naira: string | null;
  readySent?: boolean;
}

async function sendOnrampEmail(kind: 'ready' | 'arrived', orderId: string, to: OnrampNotify, env: Env): Promise<void> {
  if (!env.RESEND_API_KEY) return;
  const asset = await onrampAssetOf(orderId, env);
  const what = ONRAMP_ASSETS[asset].label;
  const subject = kind === 'ready' ? `Your money is ready. Tap to get your ${what}` : `Your ${what} is in your wallet`;
  const text =
    kind === 'ready'
      ? `${to.naira ? `Your ${to.naira} has arrived. ` : 'Your naira has arrived. '}Open GoodCash (https://goodcash.xyz) and tap "Get my ${what}" to finish. It costs you no fee.\n\nReference: ${orderId.slice(0, 8)}`
      : `Your ${what} is in your wallet now. ${asset === 'celo' ? 'It pays the small network fee when you cash out.' : 'You can cash out any time.'}\n\nReference: ${orderId.slice(0, 8)}`;
  try {
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: env.RESEND_FROM || 'GoodCash <onboarding@resend.dev>', to: [to.email], subject, html: onrampEmailHtml(kind, orderId, to.naira, asset), text }),
    });
  } catch (e) {
    console.error('[onramp-notify] email failed:', e);
  }
}

/** Sends "your money is ready" once, the first time the naira order is seen as delivered. */
async function maybeSendOnrampReady(orderId: string, env: Env): Promise<void> {
  const raw = await env.ORDER_STORE.get(`onrampnotify:${orderId}`);
  if (!raw) return;
  const n = JSON.parse(raw) as OnrampNotify;
  if (n.readySent) return;
  // Mark first, so two quick checks can never send two emails
  await env.ORDER_STORE.put(`onrampnotify:${orderId}`, JSON.stringify({ ...n, readySent: true }), { expirationTtl: 3 * 24 * 3600 });
  await sendOnrampEmail('ready', orderId, n, env);
}

async function handleOnrampNotify(orderId: string, request: Request, env: Env): Promise<Response> {
  const limited = await checkRateLimit(request, env, 'onramp-notify', 'strict');
  if (limited) return limited;
  if (!/^[0-9a-f-]{36}$/i.test(orderId)) return err('Invalid order', 400);
  if (!(await env.ORDER_STORE.get(`onramp:${orderId}`))) return err('Order not found', 404);
  let body: { email?: unknown; naira?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return err('Invalid JSON body');
  }
  const email = typeof body.email === 'string' ? body.email.trim() : '';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) || email.length > 200) return err('Enter a valid email address.', 400);
  const naira = typeof body.naira === 'string' && /^₦[\d,]{1,12}$/.test(body.naira) ? body.naira : null;
  await env.ORDER_STORE.put(`onrampnotify:${orderId}`, JSON.stringify({ email, naira } satisfies OnrampNotify), { expirationTtl: 3 * 24 * 3600 });
  // If the naira already arrived, say so now
  try {
    const res = await fetch(`${env.PAYCREST_BASE_URL}/v2/sender/orders/${orderId}`, { headers: { 'API-Key': env.PAYCREST_API_KEY } });
    if (res.ok) {
      const o = unwrapPaycrestData<OnrampPaycrestOrder>(await res.json());
      if (onrampStage(String(o?.status ?? '')) === 'done') await maybeSendOnrampReady(orderId, env);
    }
  } catch {
    // the next status check will send it
  }
  return new Response(null, { status: 204 });
}

const OnrampArrivedSchema = z.object({ requestId: z.string().regex(/^0x[0-9a-fA-F]{64}$/) });

/** The app says the G$ swap finished; we check with the swap service ourselves before sending anything. */
async function handleOnrampArrived(orderId: string, request: Request, env: Env): Promise<Response> {
  const limited = await checkRateLimit(request, env, 'onramp-notify', 'strict');
  if (limited) return limited;
  if (!/^[0-9a-f-]{36}$/i.test(orderId)) return err('Invalid order', 400);
  const raw = await env.ORDER_STORE.get(`onrampnotify:${orderId}`);
  if (!raw) return new Response(null, { status: 204 });
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return err('Invalid JSON body');
  }
  const parsed = OnrampArrivedSchema.safeParse(body);
  if (!parsed.success) return err('Some details were missing or not right. Please try again.');
  try {
    const res = await fetch(`https://api.relay.link/intents/status/v3?requestId=${parsed.data.requestId}`, { headers: relayHeaders(env) });
    const d = (await res.json()) as { status?: string };
    if (!res.ok || d.status !== 'success') return err('Not finished yet', 409);
  } catch {
    return err('Could not check this right now.', 503);
  }
  const n = JSON.parse(raw) as OnrampNotify;
  await env.ORDER_STORE.delete(`onrampnotify:${orderId}`); // forget first: one email only
  await sendOnrampEmail('arrived', orderId, n, env);
  return new Response(null, { status: 204 });
}

async function handleGetOnrampOrder(orderId: string, env: Env): Promise<Response> {
  if (!/^[0-9a-f-]{36}$/.test(orderId)) return err('Invalid order ID format', 400);
  const known = await env.ORDER_STORE.get(`onramp:${orderId}`);
  if (!known) return err('Order not found', 404);
  try {
    const res = await fetch(`${env.PAYCREST_BASE_URL}/v2/sender/orders/${orderId}`, { headers: { 'API-Key': env.PAYCREST_API_KEY } });
    if (!res.ok) return err('Could not check this order right now.', 502);
    const o = unwrapPaycrestData<OnrampPaycrestOrder>(await res.json());
    const status = String(o?.status ?? 'initiated');
    const held = (await env.ORDER_STORE.get(`onramphold:${orderId}`)) !== null;
    const stage = onrampStage(status, held);
    if (stage === 'done') await maybeSendOnrampReady(orderId, env);
    return json({ orderId, status, stage });
  } catch {
    return err('Could not check this order right now.', 502);
  }
}

// ---------------------------------------------------------------------------
// Slow-payout alert for the team
//
// A paid order should reach "settled" within minutes. If one sits in a paid-but-not-finished status for too
// long, tell the team once, with the order reference only (never bank details), so nobody has to wait for a
// customer to complain. Runs on a schedule (Cloudflare cron, free on the free plan).
// ---------------------------------------------------------------------------

/** Statuses meaning the partner already has the customer's deposit but has not finished. */
// Paid but not yet paid out to the bank ("fulfilled" and later mean the bank already has it)
const IN_FLIGHT_STATUSES = new Set(['deposited', 'pending', 'fulfilling']);
const SLOW_PAYOUT_MINUTES = 25;

export async function alertSlowPayouts(env: Env, now = Date.now()): Promise<{ checked: number; alerted: number }> {
  let checked = 0;
  let alerted = 0;
  const list = await env.ORDER_STORE.list({ prefix: 'order:', limit: 100 });
  for (const key of list.keys) {
    const id = key.name.slice('order:'.length);
    const raw = await env.ORDER_STORE.get(key.name);
    if (!raw) continue;
    let state: { status?: string; createdAt?: number };
    try {
      state = JSON.parse(raw);
    } catch {
      continue;
    }
    if (!state.createdAt || now - state.createdAt < SLOW_PAYOUT_MINUTES * 60_000) continue;
    if (state.status && FINAL_STATUSES.has(state.status)) continue;
    checked++;
    if (await env.ORDER_STORE.get(`alerted:${id}`)) continue;

    // Ask the partner for the live status (the saved copy can be out of date)
    const live = await lookupOrderStatus(id, env);
    if (!live || !IN_FLIGHT_STATUSES.has(live)) continue; // never paid, or already finished

    await env.ORDER_STORE.put(`alerted:${id}`, String(now), { expirationTtl: 60 * 60 * 24 * 3 });
    alerted++;
    const minutes = Math.round((now - state.createdAt) / 60_000);
    console.error(`[slow-payout] order ${id} has been "${live}" for about ${minutes} minutes`);
    if (env.RESEND_API_KEY && env.SUPPORT_INBOX) {
      try {
        await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            from: env.RESEND_FROM || 'GoodCash Alerts <onboarding@resend.dev>',
            to: [env.SUPPORT_INBOX],
            subject: `[GoodCash] Slow payout: ${id.slice(0, 8)} is "${live}" after ${minutes} min`,
            text: [
              `A payout is taking longer than expected.`,
              ``,
              `Order: ${id}`,
              `Status: ${live}`,
              `Age: about ${minutes} minutes`,
              ``,
              `The customer's deposit was received by the payout partner, but the payout has not finished.`,
              `Check it in the partner dashboard (https://app.paycrest.io) and contact the partner if it is stuck.`,
              `(No bank details are included in this alert.)`,
            ].join('\n'),
          }),
        });
      } catch (e) {
        console.error('[slow-payout] alert email failed:', e);
      }
    }
  }
  return { checked, alerted };
}

// ---------------------------------------------------------------------------
// Main fetch handler
// ---------------------------------------------------------------------------

async function handleRequest(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const { pathname } = url;
  const m = request.method;

  // CORS pre-flight
  if (m === 'OPTIONS') {
    return new Response(null, { status: 204 });
  }

  // Read-only endpoints share a looser limit (many people sit behind one phone-network address)
  if (m === 'GET' && (pathname === '/rates' || pathname === '/onramp/quote' || /^\/(institutions|orders|swaps\/0x)/i.test(pathname))) {
    const limited = await checkRateLimit(request, env, 'read', 'read');
    if (limited) return limited;
  }

  // Requests that carry free text can't be huge
  if (m === 'POST' && (['/support', '/diag', '/notify'].includes(pathname) || /^\/onramp\/orders\/[^/]+\/(notify|arrived)$/i.test(pathname))) {
    if (Number(request.headers.get('Content-Length') ?? '0') > 16_384) return err('Request too large', 413);
  }

  // POST /onramp/orders - start a naira order; GET /onramp/orders/:id - follow it
  if (m === 'POST' && pathname === '/onramp/orders') return handleCreateOnrampOrder(request, env);
  const onrampNotifyMatch = pathname.match(/^\/onramp\/orders\/([^/]+)\/(notify|arrived)$/i);
  if (m === 'POST' && onrampNotifyMatch) {
    return onrampNotifyMatch[2].toLowerCase() === 'notify'
      ? handleOnrampNotify(onrampNotifyMatch[1], request, env)
      : handleOnrampArrived(onrampNotifyMatch[1], request, env);
  }
  const onrampMatch = pathname.match(/^\/onramp\/orders\/([^/]+)$/i);
  if (m === 'GET' && onrampMatch) {
    const limitedRead = await checkRateLimit(request, env, 'read', 'read');
    if (limitedRead) return limitedRead;
    return handleGetOnrampOrder(onrampMatch[1], env);
  }

  if (m === 'POST' && pathname === '/relay/quote') return handleRelayQuote(request, env);
  if (m === 'POST' && pathname === '/relay/execute') return handleRelayExecute(request, env);
  if (m === 'GET' && pathname === '/relay/status') {
    const limitedRead = await checkRateLimit(request, env, 'read', 'read');
    if (limitedRead) return limitedRead;
    return handleRelayStatus(request, env);
  }

  // GET /onramp/quote?naira=5000&wallet=0x... - what naira buys in G$ (read-only)
  if (m === 'GET' && pathname === '/onramp/quote') {
    return handleOnrampQuote(request, env);
  }

  // GET /rates — CORS-safe proxy for Paycrest rates
  if (m === 'GET' && pathname === '/rates') {
    return handleGetRates(env);
  }

  // GET /institutions/:currency — Paycrest's supported institution list
  const institutionMatch = pathname.match(/^\/institutions\/([A-Za-z]{3})$/);
  if (m === 'GET' && institutionMatch) {
    return edgeCached(`institutions-${institutionMatch[1].toUpperCase()}`, 3600, () => handleGetInstitutions(institutionMatch[1].toUpperCase(), env));
  }

  // POST /verify-account — resolve bank account name through Paycrest
  if (m === 'POST' && pathname === '/verify-account') {
    return handleVerifyAccount(request, env);
  }

  // POST /orders/v2 - payout order created BEFORE a one-tap swap
  if (m === 'POST' && pathname === '/orders/v2') {
    return handleCreateOneTapOrder(request, env);
  }

  // POST /orders/:id/swap - link a finished one-tap swap to its order
  const linkMatch = pathname.match(/^\/orders\/([^/]+)\/swap$/i);
  if (m === 'POST' && linkMatch) {
    return handleLinkOneTapSwap(linkMatch[1], request, env);
  }

  // POST /orders
  if (m === 'POST' && pathname === '/orders') {
    return handleCreateOrder(request, env);
  }

  // GET /orders/:id — accept any non-empty path segment, validate format inside handler
  const orderMatch = pathname.match(/^\/orders\/([^/]+)$/i);
  if (m === 'GET' && orderMatch) {
    return handleGetOrder(orderMatch[1], env);
  }

  // GET /history?wallet=0x... - this wallet's cash outs on any device
  if (m === 'GET' && pathname === '/history') {
    return handleWalletHistory(request, env);
  }

  // GET /swaps/unfinished?wallet=0x... - swaps that still need a payout
  if (m === 'GET' && pathname === '/swaps/unfinished') {
    return handleUnfinishedSwaps(request, env);
  }

  // POST /diag - quiet error reports for the team
  if (m === 'POST' && pathname === '/diag') {
    return handleDiag(request, env);
  }

  // GET /swaps/:txHash - the payout order for a swap
  const swapOrderMatch = pathname.match(/^\/swaps\/(0x[0-9a-fA-F]{64})$/);
  if (m === 'GET' && swapOrderMatch) {
    return handleSwapOrder(swapOrderMatch[1], env);
  }

  // POST /notify - email me when my naira lands
  if (m === 'POST' && pathname === '/notify') {
    return handleNotify(request, env);
  }

  // POST /support - help requests
  if (m === 'POST' && pathname === '/support') {
    return handleSupport(request, env);
  }

  // POST /webhooks/paycrest
  if (m === 'POST' && pathname === '/webhooks/paycrest') {
    return handleWebhook(request, env);
  }

  // Health check
  if (m === 'GET' && pathname === '/health') {
    return json({ ok: true, service: 'goodcash-orders', version: '1.0.0' });
  }

  return err('Not found', 404);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const response = await handleRequest(request, env);
    return withCors(response, request, env);
  },
  /** Runs on a schedule: tells the team about payouts that are taking too long. */
  async scheduled(_event: unknown, env: Env): Promise<void> {
    try {
      const out = await alertSlowPayouts(env);
      if (out.alerted > 0) console.error(`[slow-payout] alerted ${out.alerted} of ${out.checked} open orders`);
    } catch (e) {
      console.error('[slow-payout] check failed:', e);
    }
  },
};
