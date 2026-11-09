# Go-live checklist

Got your keys from the [self-serve page](https://pay.goodcash.xyz/docs/get-test-keys/)? Finish the list below, then ask for live access with your **test secret key** from your server: `POST https://api.goodcash.xyz/v1/live-access`. A person at GoodCash reviews it and replies by email.

- [ ] Agreement with GoodCash signed (fees, acceptable use, user checks for server-wallet payouts).
- [ ] Every site that loads the widget or uses the publishable key is on your allowed list (exact origins).
      Native apps: your app id is registered and sent as `X-GoodCash-App` (SDK option `appId`).
- [ ] The secret key is only on your server (environment variable / secret manager), never in an app or repo.
- [ ] Fees: you show every line from the quote, and pass the same quote to `cashOut()` (`feePercentShown`).
- [ ] You show the verified account name before the user confirms.
- [ ] `uncertain` and `pending_confirmation` are handled as "check history, don't retry".
- [ ] Webhook endpoint set for **live**, verifies signatures on the raw body, ignores repeated event ids, answers in < 5 s.
- [ ] You credit or notify users from webhooks (or `GET /v1/cashouts/{id}`), not from browser events alone.
- [ ] Server wallets (if any): key in a key manager, spending limits, alerting; it holds only what it needs.
- [ ] One small live cash out end to end with a real bank account, before announcing.
- [ ] Switch keys from `_test_` to `_live_`.
