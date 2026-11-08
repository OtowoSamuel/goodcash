/**
 * Turn technical errors (network failures, HTTP codes, partner API text) into
 * short sentences a user can act on. Never show raw error text in the UI.
 */
export function friendlyApiError(err: unknown, fallback = 'Something went wrong. Please try again.'): string {
  const raw = err instanceof Error ? err.message : typeof err === 'string' ? err : '';
  if (!raw) return fallback;
  if (/failed to fetch|networkerror|load failed|network request failed|abort/i.test(raw)) {
    return "Can't reach GoodCash right now. Check your connection and try again.";
  }
  if (/HTTP 429|too many|rate limit/i.test(raw)) {
    return 'Too many requests. Please wait a minute and try again.';
  }
  if (/HTTP 5\d\d|internal server|bad gateway|unavailable/i.test(raw)) {
    return 'Something went wrong on our side. Please try again in a moment.';
  }
  if (/fees exceed|below the \$|minimum/i.test(raw)) {
    return 'This amount is too small to pay out after fees. Try a larger amount.';
  }
  // Payout-partner and server wording is for the team (it goes to the service logs), never for users
  if (/provider|partner|paycrest|order|off-ramp|HTTP \d{3}|\(\d{3}\)/i.test(raw)) {
    return 'We could not set up your payout right now. Your funds are safe. Please try again shortly.';
  }
  // Short plain messages written for users (e.g. "Enter a 10-digit account number") are fine
  if (raw.length <= 90 && !/0x[0-9a-f]{6}|undefined|TypeError|Unexpected token|JSON|\bat \w+\(/i.test(raw)) {
    return raw;
  }
  return fallback;
}
