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

**Verifying from the app (no second login).** "Verify with GoodDollar" follows GoodDollar's documented Identity SDK flow
(`@goodsdks/citizen-sdk` 1.2.8, `generateFVLink`), reimplemented in `apps/web/src/lib/goodid.ts`: the wallet the customer is
already signed in with signs GoodDollar's fixed message on our site, then they go to `goodid.gooddollar.org` with that
signature, do the face check, and come back to `?gdverify=1&verified=true`. The app never trusts `verified=true`: it asks the
chain every 10 seconds (about 3 minutes, then offers Try again). Once verified it offers the optional vote for GoodCash
(skipped for anyone who already voted), then returns them to what they were doing (Add G$ or cash out). If GoodDollar ever
changes the message or the link format, update `goodid.ts` from the SDK source.

**Switch.** `REQUIRE_VERIFIED` in `services/orders/wrangler.toml` (`"true"` = on). Set it to `"false"` and deploy to switch
the rule off at once. Unset (tests, local development) means off.
