# Error codes

Every error has a stable `code`, a plain `message` you can show customers, and sometimes a `detail` for you.
API errors look like `{ "error": { "code": "...", "message": "...", "detail": "..." } }`; the SDK throws `GoodCashError`
with the same fields plus `status` and `requestId`.

| Code | HTTP | What it means | What to do |
| --- | --- | --- | --- |
| `invalid_request` | 400 | A field is missing or malformed (`detail` names it) | Fix the request |
| `amount_too_small` | 400 | Below the minimum after fees | Show `quote.minimumG` |
| `amount_too_large` | 400 | Above the per-cash-out maximum | Use `/v1/limits` |
| `insufficient_balance` | 400 | The wallet holds less G$ than asked | Lower the amount |
| `fee_mismatch` | 409 | Fee changed since the quote you showed | Get and show a new quote |
| `price_unavailable` | 503 | Prices could not be read | Retry shortly |
| `cashout_paused` | 503 | GoodCash paused cash outs | Nothing was sent; retry later |
| `bank_account_not_found` | 400 | Name check failed | Ask the user to check bank and number |
| `needs_network_fee` (SDK) | - | Wallet lacks CELO for the network fee; `data` has `needCelo`, `haveCelo` | Ask the user to top up CELO |
| `wallet_rejected` (SDK) | - | The user cancelled in their wallet | Nothing was sent |
| `wrong_network` (SDK) | - | Wallet would not switch to Celo | Ask the user to switch |
| `no_wallet` (SDK) | - | No signer for a live cash out | Connect a wallet |
| `unsafe_transaction` (SDK) | - | The transaction failed the check before signing | Nothing was sent; retry; contact GoodCash if repeated |
| `order_expired` (SDK) | - | The payout window was about to close | Retry |
| `price_moved` (SDK) | - | The network refused before signing | Nothing was sent; retry |
| `uncertain` (SDK) | - | Wallet lost its reply and no payment was found yet; `data.cashOutId` | **Do not retry.** Tell the user to check history; poll `getCashOut` |
| `pending_confirmation` (SDK) | - | Sent, not confirmed yet | **Do not retry.** Keep watching |
| `transaction_mismatch` | 400 | Reported transaction is not this cash out | Report the right hash |
| `idempotency_conflict` | 409 | Same Idempotency-Key, different body | Use a new key per attempt |
| `rate_limited` | 429 | Too many requests | Back off |
| `unauthorized` | 401 | Missing/unknown key | Check the key |
| `partner_disabled` | 403 | Your account is switched off | Contact GoodCash |
| `forbidden_origin` | 403 | Publishable key used from a site/app not on your list | Ask GoodCash to add it |
| `secret_key_in_browser` | 403 | Secret key sent from a browser | Use the publishable key there |
| `secret_key_required` | 403 | Endpoint needs the secret key | Call it from your server |
| `test_mode_only` | 400 | Simulation with a live key | Use a test key |
| `not_found` | 404 | No such cash out (for this key and mode) | Check the id and mode |
| `webhook_not_configured` | 400 | Test send without a URL | `PUT /v1/webhooks` first |
| `topups_not_enabled` | 403 | Live top-ups are not switched on for your account | Ask GoodCash to enable them (test mode needs no switch) |
| `invalid_signature` (server helper) | - | Webhook failed verification | Reject it (400) |
| `unavailable` / `network_error` | 503 / - | Temporary problem | Retry with back-off |
