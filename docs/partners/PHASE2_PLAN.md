# Phase 2: partners adding G$ / CELO with naira (design, 10 Nov 2026)

Status: **design only. Nothing is built.** Phase 1 (cash out) is live. This is the on-ramp for partners: their user pays
naira from their bank and receives G$ (or CELO) in their wallet.

## How the on-ramp works today (the GoodCash app)

1. The customer enters an amount, then **their name, date of birth and BVN or NIN**, and the bank account they will pay from.
2. The worker creates an order with the payout partner (Paycrest) and returns bank details to pay into. The ID details go straight
   to Paycrest and are **never stored or logged by GoodCash** (only wallet, naira, asset and time are kept).
3. The customer pays by bank transfer. Paycrest delivers dollars (USDC) to the customer's wallet on **Base**.
4. The customer taps "Get my G$". Their wallet signs **one** USDC authorization on Base; a gas-free swap (Relay) turns it into G$
   (or CELO) on **Celo**, in the same wallet.

## The design: hosted only, so partners never touch ID details

The ID details (BVN/NIN) are the sensitive part and plan question 4 was answered on 9 Nov 2026 (Paycrest and the lawyer side are fine with this hosted-only design). So:

- **The partner never sees or sends ID details.** The whole flow runs on `pay.goodcash.xyz` (the same widget, a new "add" mode:
  `GoodCash.open({ mode: 'popup' | 'embed' | 'redirect', flow: 'topup', ... })`). The customer types their details on GoodCash's
  page. The partner's page can't read the frame (different origin).
- **No `/v1` endpoint accepts BVN/NIN.** Partners (and servers) get quotes, status and webhooks only. There is no server-to-server
  way to create a naira-in order in v1. That also keeps any legal duty for those details with GoodCash and Paycrest, not the partner.
- **The wallet is the customer's own.** Unlike cash out, there is no "server wallet" mode: the customer must sign on Base.
  Embedded-wallet hosts need one more signing call in the host bridge (`signTypedData` for Base), not just `sendTransaction`.

## What partners get

| Piece | Detail |
| --- | --- |
| Widget | `flow: 'topup'` with `amountNaira`, `asset: 'g' | 'celo'`, `partnerRef`, `wallet` (optional hint). Same events API: `topup.created`, `topup.paid_in` (naira received), `topup.delivered` (G$/CELO in wallet), `topup.failed`. |
| API (read only) | `GET /v1/topup/quote?amountNaira=&asset=`: what the customer gets, every fee as its own line. `GET /v1/topups/{id}`: status. `GET /v1/topups`: list (secret key). |
| Webhooks | `topup.paid_in`, `topup.delivered`, `topup.failed` on the existing signed, retried webhook system. |
| Test mode | Simulated end to end (no Paycrest, no chain), like cash out. Test amounts pick the outcome. |
| SDK / React | `quoteTopup()`, `watchTopup()`; `<TopUpButton />`. |

## What I'd reuse, and what is new

- Reuse: partner keys, origins, test mode, webhook delivery, the widget shell, docs site, the app's existing naira-in logic
  (quote, order create, status follow, History row, delivery detection).
- New: partner records for top-ups (`pt:<id>`: partner, wallet, naira, asset, status; **no ID details, no bank details**),
  the widget "topup" screens (ID details form, bank pick/verify, pay, get), the host-bridge Base signing call, docs.
- Storage: a top-up writes about 5 records over its life. At low volume that is fine; at scale the paid Workers plan is needed
  (free KV allows 1,000 writes a day).

## Fees

- GoodCash's fee on naira-in is whatever the app charges today (shown as its own line).
- **Partner fee on top-ups: none in v1.** Paycrest's sender-fee mechanism for naira-in is not the same as for cash out, and
  I have not verified how a partner share could be charged and paid. I'd add it only after checking with Paycrest.

## Switch and safety

- Behind `PARTNER_ONRAMP_ENABLED` (**off**). Nothing changes for anyone while it is off.
- Per-partner enable: even with the switch on, a partner only gets top-ups if GoodCash turns it on for them.
- Same limits as the app (minimum ₦1,000 and the existing daily and size caps), plus a per-partner rate limit.

## Decisions needed before building

1. **Legal question 4** (BVN/NIN through partner apps): is "hosted only, partner never sees it" acceptable, or does Paycrest/your
   lawyer need more? I will not switch this on until you say it is answered.
2. **v1 scope:** widget + read-only API + webhooks (above), no server-side order creation. OK?
3. **Partner fee on top-ups:** none in v1. OK?
4. **Embedded-wallet hosts** (games with their own wallets): support top-ups through the bridge in v1, or wallet-in-browser and
   wallet-app customers only first?

## Order of work (each step committed and reported; nothing deployed without your go-ahead)

1. Worker: top-up records, quote, status, list, webhooks, test mode, tests (off by default).
2. Widget: topup flow screens, events, Base signing in the host bridge, end-to-end test in test mode.
3. SDK + React: `quoteTopup`, `watchTopup`, `<TopUpButton />`.
4. Docs, OpenAPI, quickstart, `llms-full.txt`, changelog.
5. Report with test output and the exact commands for you.
