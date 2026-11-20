# Verified people only

Only people verified with GoodDollar can add G$ with naira or cash out.

**The check.** GoodDollar's Identity contract on Celo (`0xC361A6E67822a0EDc17D899227dd9FC50BD62F42`):
`getWhitelistedRoot(wallet)` is not the zero address when the wallet belongs to a verified person (a wallet connected to
a verified person counts). Code: `services/orders/src/verified.ts`.

**Where it is enforced (server, before any order exists at the payout partner)**
- `POST /onramp/orders` (adding G$ or CELO with naira; the partner top-up API needs an order from here, so it is covered)
- `POST /orders/v2` (one-tap cash out) and `POST /orders` (older cash-out route)
- `POST /v1/cashouts` for live partner keys (test keys are never checked)

Refused with `403` and `code: "not_verified"` (plain message, `verifyUrl`). If the chain cannot be read: `503`,
`code: "verification_unavailable"`, nothing created. A "yes" is remembered 10 minutes at the edge (no storage writes);
a "no" is never remembered.

**What is not blocked.** Finishing something already paid for: an Add G$ order in progress, a payout whose swap is done,
status checks, History. Only starting something new is gated.

**The app.** Verifying is a step inside adding G$ and cashing out, not a banner or a warning. `GET /verified?wallet=0x…`
tells the app whether to show it. A verified person never sees it. Someone who is not verified sees "One quick step:
verify" when they start, and the app carries on with what they were doing by itself once GoodDollar shows them as
verified (it asks again when they return to the tab). If the check cannot be made the screens let the person go on;
the server decides.

**Switch.** `REQUIRE_VERIFIED` in `services/orders/wrangler.toml` (`"true"` = on). Set it to `"false"` and deploy to switch
the rule off at once. Unset (tests, local development) means off.
