/** Every SDK error: a stable `code`, a plain `message` you may show customers, and a `detail` for developers. */

export type GoodCashErrorCode =
  | 'invalid_request'
  | 'amount_too_small'
  | 'amount_too_large'
  | 'insufficient_balance'
  | 'needs_network_fee'
  | 'fee_mismatch'
  | 'price_unavailable'
  | 'price_moved'
  | 'order_expired'
  | 'cashout_paused'
  | 'bank_account_not_found'
  | 'wallet_rejected'
  | 'wrong_network'
  | 'no_wallet'
  | 'unsafe_transaction'
  | 'uncertain'
  | 'pending_confirmation'
  | 'transaction_mismatch'
  | 'rate_limited'
  | 'unauthorized'
  | 'partner_disabled'
  | 'forbidden_origin'
  | 'secret_key_in_browser'
  | 'secret_key_required'
  | 'test_mode_only'
  | 'not_found'
  | 'idempotency_conflict'
  | 'webhook_not_configured'
  | 'topups_not_enabled'
  | 'invalid_signature'
  | 'unavailable'
  | 'network_error';

const SETUP = "This app isn't set up correctly for cash out. Please contact the app's support.";

/** Plain messages for errors the SDK raises itself (server errors carry their own message). */
export const MESSAGES: Partial<Record<GoodCashErrorCode, string>> = {
  invalid_request: 'Some details were missing or not right. Please check them and try again.',
  needs_network_fee: "Your wallet doesn't have enough CELO to pay the network fee. Top up a little CELO, then try again. Your G$ has not been touched.",
  price_moved: 'The price moved just before your cash out. Nothing was taken. Please try again.',
  order_expired: 'That payout window closed before you confirmed. Nothing was taken. Please try again.',
  wallet_rejected: 'You cancelled the request in your wallet. Nothing was sent.',
  wrong_network: 'Your wallet is on the wrong network. Please switch it to Celo and try again.',
  no_wallet: 'Connect a wallet first.',
  unsafe_transaction: "We couldn't confirm your payout details just now. Nothing was taken. Please try again.",
  uncertain: "We couldn't confirm your cash out. It may still have gone through, so please check your history before trying again. That way you don't send it twice.",
  pending_confirmation: "Your cash out was sent and is still being confirmed. Please don't send it again.",
  secret_key_in_browser: SETUP,
  invalid_signature: 'Invalid signature.',
  unavailable: 'This is not available right now. Please try again in a moment.',
  network_error: "We couldn't reach GoodCash. Please check your connection and try again.",
};

export class GoodCashError extends Error {
  readonly code: GoodCashErrorCode;
  readonly detail?: string;
  readonly status?: number;
  readonly requestId?: string;
  /** Extra data for some codes (for example the network fee numbers, or the transaction hash) */
  readonly data?: Record<string, unknown>;

  constructor(code: GoodCashErrorCode, opts: { message?: string; detail?: string; status?: number; requestId?: string; data?: Record<string, unknown>; cause?: unknown } = {}) {
    super(opts.message ?? MESSAGES[code] ?? MESSAGES.unavailable!);
    this.name = 'GoodCashError';
    this.code = code;
    this.detail = opts.detail;
    this.status = opts.status;
    this.requestId = opts.requestId;
    this.data = opts.data;
    if (opts.cause !== undefined) (this as { cause?: unknown }).cause = opts.cause;
  }
}

export function isGoodCashError(e: unknown): e is GoodCashError {
  return e instanceof GoodCashError || (typeof e === 'object' && e !== null && (e as { name?: string }).name === 'GoodCashError');
}
