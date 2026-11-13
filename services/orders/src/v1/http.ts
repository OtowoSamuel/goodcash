/** Responses and errors for the partner API. Every error has a stable code, a plain message and an optional developer detail. */

export type ErrorCode =
  | 'invalid_request'
  | 'amount_too_small'
  | 'amount_too_large'
  | 'insufficient_balance'
  | 'fee_mismatch'
  | 'price_unavailable'
  | 'cashout_paused'
  | 'bank_account_not_found'
  | 'unavailable'
  | 'rate_limited'
  | 'unauthorized'
  | 'partner_disabled'
  | 'forbidden_origin'
  | 'secret_key_in_browser'
  | 'secret_key_required'
  | 'test_mode_only'
  | 'not_found'
  | 'idempotency_conflict'
  | 'idempotency_in_progress'
  | 'transaction_mismatch'
  | 'webhook_not_configured'
  | 'topups_not_enabled';

const SETUP = "This app isn't set up correctly for cash out. Please contact the app's support.";

export const ERRORS: Record<ErrorCode, { status: number; message: string }> = {
  invalid_request: { status: 400, message: 'Some details were missing or not right. Please check them and try again.' },
  amount_too_small: { status: 400, message: 'That amount is too small to cash out. Please try a larger amount.' },
  amount_too_large: { status: 400, message: 'That amount is more than one cash out allows. Please try a smaller amount.' },
  insufficient_balance: { status: 400, message: "That's more G$ than your wallet holds." },
  fee_mismatch: { status: 409, message: 'The fees have changed. Please check the new amount and try again.' },
  price_unavailable: { status: 503, message: "We couldn't get today's price. Please try again in a moment." },
  cashout_paused: { status: 503, message: 'Cash out is paused right now. Nothing was sent. Please try again later.' },
  bank_account_not_found: { status: 400, message: "We couldn't find that bank account. Please check the bank and account number." },
  unavailable: { status: 503, message: 'This is not available right now. Please try again in a moment.' },
  rate_limited: { status: 429, message: 'Too many requests. Please wait a moment and try again.' },
  unauthorized: { status: 401, message: SETUP },
  partner_disabled: { status: 403, message: SETUP },
  forbidden_origin: { status: 403, message: SETUP },
  secret_key_in_browser: { status: 403, message: SETUP },
  secret_key_required: { status: 403, message: SETUP },
  test_mode_only: { status: 400, message: SETUP },
  not_found: { status: 404, message: "We couldn't find that cash out." },
  idempotency_conflict: { status: 409, message: 'This request was already used for a different cash out. Please start again.' },
  idempotency_in_progress: { status: 409, message: 'This cash out is still being set up. Please wait a moment and check it before sending it again.' },
  transaction_mismatch: { status: 400, message: "That transaction doesn't match this cash out." },
  webhook_not_configured: { status: 400, message: SETUP },
  topups_not_enabled: { status: 403, message: SETUP },
};

export class V1Error extends Error {
  constructor(public code: ErrorCode, public detail?: string, public messageOverride?: string) {
    super(code);
  }
}

export function requestId(): string {
  const b = crypto.getRandomValues(new Uint8Array(8));
  return `req_${Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')}`;
}

export function v1Json(data: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', ...headers } });
}

export function v1ErrorResponse(e: V1Error): Response {
  const def = ERRORS[e.code];
  return v1Json({ error: { code: e.code, message: e.messageOverride ?? def.message, ...(e.detail ? { detail: e.detail } : {}) } }, def.status);
}

const ALLOW_HEADERS = 'Authorization, Content-Type, Idempotency-Key, X-GoodCash-App';

/** Pre-flight: any origin may ask; the real request is then checked against the partner's allowed sites. */
export function v1Preflight(request: Request): Response {
  const origin = request.headers.get('Origin');
  return new Response(null, {
    status: 204,
    headers: {
      ...(origin ? { 'Access-Control-Allow-Origin': origin } : {}),
      'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS',
      'Access-Control-Allow-Headers': ALLOW_HEADERS,
      'Access-Control-Max-Age': '600',
      Vary: 'Origin',
    },
  });
}

export function withV1Headers(res: Response, reqId: string, corsOrigin: string | null): Response {
  const headers = new Headers(res.headers);
  headers.set('GoodCash-Request-Id', reqId);
  headers.set('Cache-Control', 'no-store');
  headers.set('Vary', 'Origin');
  if (corsOrigin) {
    headers.set('Access-Control-Allow-Origin', corsOrigin);
    headers.set('Access-Control-Expose-Headers', 'GoodCash-Request-Id');
  }
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}
