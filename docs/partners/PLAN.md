# GoodCash for Partners: plan

Status: **Phase 1 built** on branch `partner-sdk` (approved 9 Nov 2026). See PHASE1_REPORT.md for what changed from this plan.

## 1. What partners get

A partner adds "Cash out to bank" to their game or app in one of three ways:

| Way | Who it suits | Effort for them |
| --- | --- | --- |
| **Widget** (pop-up, embedded frame, redirect, or in-app browser) | Games, apps, AI builders | One script tag, about 10 minutes |
| **React components** (`<CashOutButton />` + hooks) | React and Next.js apps that want it to look native | About 1 hour |
| **SDK + server API** (no UI) | Fintechs, games paying from their own wallet | 1 to 3 days with their own screens |

All three use the same partner API, so fees, limits and safety checks are always the same.

## 2. How it fits together

```
 Partner's app ──┬── widget.js ──> pay.goodcash.xyz (widget app) ──┐
                 ├── @goodcash/react ──────────────────────────────┤
                 └── @goodcash/sdk (browser, Node, React Native) ──┤
                                                                   ▼
                                       api.goodcash.xyz/v1/*  (same worker as today)
                                         │  keys, limits, quotes, orders, webhooks
                         ┌───────────────┼──────────────────┐
                    payout partner     Celo chain        KV store
                    (live keys only)   (price, checks)   (partners, orders, webhook queue)

 The customer's wallet (or a partner's server wallet) signs ONE transaction:
   G$.transferAndCall(RouterV2, amount, data) → RouterV2 pays the payout address exactly, surplus back to the customer.
```

What stays true: GoodCash never holds money or keys. Today's endpoints and goodcash.xyz keep working exactly as now; `/v1` is added alongside them.

### Key change from how goodcash.xyz works today
Today the web app calculates the price itself and the server sizes the payout from it. For partners, **the server calculates the price** (the same maths, reading the same GoodDollar reserve and Uniswap prices on Celo) and returns the exact transaction to sign. That means a partner cannot get the maths wrong. The SDK still **checks the transaction before signing**: it must go to the G$ token, call RouterV2, pay the payout address the order gave, with a pay amount no more than the guaranteed minimum. This is the same "never pay where the server merely says" rule the app follows today.

## 3. Repo layout

```
packages/
  core/       @goodcash/core   (private, shared)  pure logic moved out of apps/web/src/lib:
              quote maths, units/fees, paid statuses, one-tap data encoding, addresses,
              lost-reply rules (provesNothingWasSent), plain customer messages.
              apps/web and services/orders both import it. No env, no DOM, no React.
  sdk/        @goodcash/sdk    public. Client + wallet sending + webhook verify (/server entry).
  react/      @goodcash/react  public. Provider, hooks, CashOutFlow UI, CashOutButton.
  contracts/  (unchanged)
apps/
  web/        goodcash.xyz (imports @goodcash/core instead of its own copies; tests unchanged)
  widget/     pay.goodcash.xyz: the hosted flow + widget.js loader. Built on @goodcash/react.
services/
  orders/     worker. New folder src/v1/ (auth, quote, cashouts, webhooks, testmode, partners),
              routed before the existing routes. Existing handlers untouched apart from
              moving shared helpers into src/shared.ts.
scripts/
  partners.mjs   admin tool you run: create / list / disable / rotate partners.
examples/
  web-widget/  react-app/  react-native/  node-server/  unity-webview/  ai-snippet/
docs/partners/
  README.md  quickstarts/*.md  openapi.yaml  llms.txt  llms-full.txt  errors.md
  webhooks.md  test-mode.md  go-live.md  ONE_PAGER.md  FEES.md  CHANGELOG.md
```

What moves into `@goodcash/core` (moved, not copied; web re-exports so its imports and tests keep working):
`quote.ts` (all), `units.ts` (fee passed in instead of read from env), `encodeOneTapData`, `computeMinAmountOut`, `computeOneTapMinOut`, `provesNothingWasSent`, `PAID_OUT_STATUSES`/`isPaidOutStatus`, addresses, the network-fee maths from `getNetworkFeeInfo` (with the client passed in), and the plain message table behind `friendlySwapError`. The worker uses the same quote maths for `/v1/quote`.

## 4. Partner API (`/v1`)

Base `https://api.goodcash.xyz/v1`. JSON only. Every response has a `requestId`. Errors are `{ error: { code, message, detail? } }`, where `message` is safe to show customers and `detail` is for developers.

### Auth
| Key | Looks like | Where it may be used | What it can do |
| --- | --- | --- | --- |
| Publishable | `gc_pk_live_…` / `gc_pk_test_…` | Browsers, apps, widget. Only from the partner's allowed websites (Origin check) or allowed app ids (`X-GoodCash-App`) | Everything a customer flow needs, for **one wallet at a time** |
| Secret | `gc_sk_live_…` / `gc_sk_test_…` | Partner servers only. **Refused with 403 if a browser Origin header is present** | All of the above, plus listing all the partner's orders, webhook settings, test-send |

Sent as `Authorization: Bearer <key>`. Only SHA-256 hashes of keys are stored (`key:<hash>` → partner id). Per-partner settings live at `partner:<id>`: name, enabled, mode, allowed origins, app ids, webhook URL, webhook signing secret (encrypted with a worker secret), fee, rate limits. A disabled partner gets `403 partner_disabled` at once.

Native apps (Unity, React Native) cannot prove where they run, so a publishable key from a native app is limited to the same per-wallet, rate-limited actions. That is the same exposure as goodcash.xyz today. Anything that lists data across wallets needs the secret key.

### Endpoints (Phase 1)
| Method and path | Key | Does |
| --- | --- | --- |
| `GET /v1/limits` | pk/sk | Minimum and maximum G$, fee percent, supported banks currency |
| `GET /v1/banks` | pk/sk | Bank list (popular first) |
| `POST /v1/banks/verify` | pk/sk | Account name for a bank + account number |
| `GET /v1/quote?amountG=` | pk/sk | Naira out with every line: GoodDollar contribution (10%), GoodCash fee, partner fee, payout fee, network fee estimate in CELO, `expiresAt` |
| `GET /v1/network-fee?wallet=` | pk/sk | CELO needed vs held, and whether the wallet can send |
| `POST /v1/cashouts` | pk/sk | Body: `wallet, amountG, recipient, partnerRef?, feePercentShown, quoteId?`, header `Idempotency-Key`. Checks balance, prices, creates the payout order, returns `cashout` + `transaction {chainId, to, data, value}` + `expiresAt` |
| `POST /v1/cashouts/:id/transaction` | pk/sk | Report the tx hash. Checked on chain (same checks as `/orders/:id/swap`) |
| `GET /v1/cashouts/:id` | pk/sk | Status: `awaiting_signature → sent → processing → paid` or `failed / refunded / expired`, plus naira and timestamps |
| `GET /v1/cashouts?wallet=` | pk (one wallet) / sk (all, paged) | History |
| `POST /v1/webhooks/test` | sk | Sends a signed test event |
| `GET/PUT /v1/webhooks` | sk | Read or set the webhook URL. The signing secret is shown once by the admin script |

Status names are ours and plain; the payout partner's raw statuses never leave the worker. "Paid" = their `fulfilled/validated/settling/settled`, as today.

**Idempotency:** the same `Idempotency-Key` + partner within 24 hours returns the first result, never a second order. **`partnerRef`** (up to 64 safe characters) is stored and returned on every response and webhook.

**Fee shown = fee charged:** `feePercentShown` must equal the fee the partner's quote showed (GoodCash + partner). If not, the order is refused with `fee_mismatch` rather than silently charged differently. The widget and SDK send it automatically.

### Webhooks to partners
Events: `cashout.paid`, `cashout.failed`, `cashout.refunded`, `cashout.delayed` (still not paid 25 minutes after sending, same rule as today's team alert), `cashout.test`.
- Header `GoodCash-Signature: t=<unix>,v1=<hex HMAC-SHA256 of "t.body">`. Rejected by our verify helper if older than 5 minutes (replay protection).
- Triggered from the payout partner's webhook and from the existing 10-minute check. The first attempt goes out at once. Retries at 1 min, 5 min, 30 min, 2 h, 12 h, then stop and log. Retries run from a KV queue checked every minute (needs the cron changed from `*/10` to `*/1`; the slow-payout alert still runs every 10th minute).
- Each event has an `id`, so partners can ignore duplicates.

### Test mode (`gc_*_test_*` keys)
- Never calls the payout partner. Never needs real G$.
- Fake banks ("Test Bank A/B"), account names always `TEST ACCOUNT`.
- `POST /v1/cashouts` returns a real-looking transaction, but in test mode the partner does **not** send it. Instead `POST /v1/test/cashouts/:id/simulate` moves it along: `processing` after 5 s, `paid` after 30 s, with webhooks.
- Magic account numbers: `0000000001` → fails, `0000000002` → refunded, `0000000003` → delayed (fires `cashout.delayed`).
- Test data lives under separate KV keys and expires after 7 days.

### Rate limits
Per partner and per wallet, using a new Cloudflare rate-limit binding (`RATE_LIMITER_PARTNER`). Defaults: 60 reads/min and 10 creates/min per wallet; 600/min per partner. They can be changed per partner. Today's per-visitor limits for goodcash.xyz stay as they are.

## 5. `@goodcash/sdk`

```ts
import { GoodCash } from '@goodcash/sdk';
const gc = new GoodCash({ publishableKey: 'gc_pk_test_…' });   // or { secretKey } on a server

const quote = await gc.quote({ amountG: 5000 });               // every fee line, plain labels
const banks = await gc.banks();
const name  = await gc.verifyAccount({ bankCode, accountNumber });
const fee   = await gc.networkFee({ wallet });                 // { enough, needCelo, haveCelo }

// One call does create → check → sign → report → recover:
const result = await gc.cashOut({
  wallet: walletClient | eip1193Provider,                     // viem WalletClient, window.ethereum, WalletConnect, Magic, MiniPay…
  amountG: 5000, recipient: { bankCode, accountNumber, accountName },
  partnerRef: 'player-123',
});
gc.watchCashOut(result.id, (c) => …, { signal });              // polls with backoff, stops on paid/failed, cancellable

// Or step by step (custom UIs, server wallets):
const c = await gc.createCashOut({ wallet: '0x…', amountG, recipient, idempotencyKey });
assertSafeTransaction(c.transaction, c.order);                // throws if anything doesn't match
// … partner signs c.transaction with their own wallet …
await gc.reportTransaction(c.id, txHash);
```

Server entry `@goodcash/sdk/server`: `verifyWebhook(rawBody, signatureHeader, secret)` with WebCrypto (Node 18+, Deno, Bun, Workers).

Carried over from production:
- Chain switch to Celo before sending.
- Network-fee check before sending (`needs_network_fee` with CELO amounts).
- Router paused → `cashout_paused`, nothing sent.
- **Lost wallet reply:** if the wallet errors in a way that does not prove nothing was sent, the SDK searches for the payment on chain (as `findOneTapPayment` does) before returning `uncertain`, and never says "nothing was taken" unless that is proven.
- 0.5% price protection; order must have 90 s left before signing; deadline inside the order window.

Errors (`GoodCashError`, stable `code`): `invalid_request`, `amount_too_small`, `amount_too_large`, `insufficient_balance`, `needs_network_fee`, `price_moved`, `order_expired`, `cashout_paused`, `wallet_rejected`, `wrong_network`, `uncertain`, `pending_confirmation`, `fee_mismatch`, `bank_account_not_found`, `rate_limited`, `partner_disabled`, `unauthorized`, `forbidden_origin`, `secret_key_in_browser`, `not_found`, `unavailable`. Each has a plain `message` (from the same wording table as the app) and a developer `detail`.

Build: TypeScript, ESM + CJS + `.d.ts` (tsup), target ES2020, no DOM or Node imports in the core entry. viem is an **optional peer** (only needed to pass a viem WalletClient); plain EIP-1193 providers work with zero dependencies apart from the small ABI encoding, which comes from core. Size target under 15 kB gzipped without viem.

## 6. `@goodcash/react` and the widget

**`@goodcash/react`**
- `<GoodCashProvider publishableKey theme>`; hooks `useQuote`, `useBanks`, `useVerifyAccount`, `useCashOut`, `useCashOutStatus`.
- `<CashOutFlow />`: the full flow (amount → bank → review → confirm → tracker → done), the same steps and wording as goodcash.xyz.
- `<CashOutButton />` opens it in an accessible dialog: focus trap, Escape closes, labelled controls, 360 px first.
- Theme: `colors`, `radius`, `font`, `mode: 'light' | 'dark' | 'auto'`. The default is the sticker-pop look. Styles are scoped (prefixed classes and CSS variables) so they can't clash with the partner's CSS. No Tailwind is required on their side.
- BankPicker and StepBar move here from apps/web, and the web app imports them back (its tests must still pass).

**Widget (`apps/widget` → `pay.goodcash.xyz`)**
- `<script src="https://pay.goodcash.xyz/widget.js"></script>` then `GoodCash.open({ publishableKey, mode: 'popup' | 'embed' | 'redirect', wallet?, amountG?, partnerRef?, theme?, returnUrl?, onEvent })`. The same is available from npm as `@goodcash/sdk/widget`.
- Events by `postMessage`, checked against the exact origin both ways: `ready`, `cashout.created`, `cashout.paid`, `cashout.failed`, `closed`.
- Redirect mode returns to `returnUrl?goodcash_cashout=<id>&status=…`. `returnUrl` must be on the partner's allowed list. Deep links (`mygame://…`) are allowed when registered as an app id.
- Wallet inside the widget: injected wallets, WalletConnect and Magic (email login), the same as goodcash.xyz. If the partner passes `wallet`, the widget asks the host page to sign through a postMessage bridge (`sign_request` → `sign_result`). That suits games with embedded wallets.
- "Powered by GoodCash" always shows. Partners can set a logo and accent color.
- Security headers: `frame-ancestors` lists only the partner origins allowed for the key. Because this is a separate site, **goodcash.xyz keeps `frame-ancestors 'none'` untouched**. The widget site gets its own CSP and the same safety scans.

## 7. Docs and examples

- Quickstarts (5 min each): game (WebGL + Unity WebView), React app, React Native (core SDK + their wallet, or the widget in `react-native-webview`), fintech server (Node, secret key, webhooks), AI builder (copy-paste snippet).
- `openapi.yaml` for `/v1`, generated from the same zod schemas the worker uses, so it can't drift.
- `llms.txt` (short rules) and `llms-full.txt` (everything). Rules include: never put a secret key in a browser, always show the fee lines, always send `feePercentShown`, treat `uncertain` as "check before retrying", amounts in G$ not wei.
- `errors.md`, `webhooks.md` (verification code for Node, Python, Go), `test-mode.md`, `go-live.md` checklist, `CHANGELOG.md`.
- `ONE_PAGER.md`: plain English for partners.
- Every example runs in test mode with a test key.

## 8. Fees (proposal, your decision)

Today: 1% GoodCash fee through the payout partner's sender fee, which allows **one** fee address per order (the Safe).

| Option | How | Good | Bad |
| --- | --- | --- | --- |
| **A. One fee, shared from a ledger (recommended to start)** | The order's sender fee = GoodCash % + partner %, all paid to the Safe. The worker records each partner's share per paid order (`ledger:<partner>:<month>`). You pay partners monthly from the Safe; an admin report shows what is owed. | No contract change. Works now. One line for the customer ("Fees: 1.5%") or two lines. | You hold partner money until payout (a trust and bookkeeping job). Monthly Safe transactions. |
| B. Partner charges separately | GoodCash charges only its 1%. The partner charges their user in their own app (in-game currency, airtime margin). | Zero bookkeeping for us. | Partners can't earn on the cash out itself; a fintech will want this. |
| C. On-chain split (new router V3) | The router sends the partner's cut to their wallet in the same transaction. | Instant, trustless, transparent. | New contract, new audit, new Safe deployment, more gas. |

Recommendation: **A for launch, with B always allowed**. Design C only when a partner's volume justifies an audit. I will not touch contracts in this work.

Whatever is chosen: each fee is its own line on the review screen and in the quote; `feePercentShown` must match or the order is refused; partner fees are capped (proposed 3%, total with ours 5%, the existing worker cap).

## 9. Decisions I need from you

| # | Decision | My recommendation |
| --- | --- | --- |
| 1 | Fee model | **A + B** (above). Partner fee cap 3%. |
| 2 | Widget address | **pay.goodcash.xyz** as a separate Pages project. It keeps goodcash.xyz unframeable and needs no DNS work from you (the domain is already on Cloudflare). |
| 3 | npm names | **@goodcash/sdk** and **@goodcash/react** (both free today). You create the free npm organisation "goodcash" and publish; I prepare `npm publish --dry-run`. |
| 4 | Server-wallet mode (games/fintechs paying from their own wallet) | Allow it with the secret key only, and require the partner to accept terms that they do their own user checks. See legal question 1. |
| 5 | Webhook retries | KV queue + cron every minute (free). Cloudflare Queues would be cleaner but needs the paid Workers plan. |
| 6 | Test mode on chain | **Simulated**, with no testnet. Our router is only on Celo mainnet, and test G$ would confuse partners. |
| 7 | Who can get keys | You approve each partner (admin script). No self-serve sign-up in Phase 1. |

### Legal and partner-agreement questions (I will not guess these)
1. Cash outs from partner apps run through **our** payout partner account. Does Paycrest allow us to serve other companies' users through it (sub-merchants)? Do they need to know each partner?
2. In server-wallet mode a fintech or game sends G$ it holds for users. Who is responsible for user checks (KYC/AML) in that case: the partner, us, or Paycrest? This needs a written partner agreement.
3. Partner revenue share (option A) means GoodCash holds money owed to partners for up to a month. Is that fine for your entity and tax situation?
4. Phase 2 (naira in): ID details (BVN/NIN) would pass through partner apps. Needs Paycrest's position and probably a lawyer before it is switched on.
5. A partner agreement template: acceptable use (no gambling payouts?), limits, ending the partnership, data handling.

## 10. Phases and order of work

**Phase 1: cash out (this plan)**
1. `packages/core`: move shared logic; web app imports it. All 218 web tests still pass.
2. Worker `/v1`: auth/keys, limits, banks, verify, quote (server-side, same maths), network fee, cashouts (create/report/status/list), idempotency, test mode, webhooks + queue, per-partner limits. Existing 85+ worker tests unchanged, plus new tests.
3. `scripts/partners.mjs` (you run it; it writes to KV with `wrangler kv`, prints keys once).
4. `@goodcash/sdk` + tests, including a Celo fork test that the transaction it builds is accepted by the real RouterV2 and pays exactly.
5. `@goodcash/react`.
6. `apps/widget` + widget.js + an end-to-end test in test mode (Playwright).
7. Docs, OpenAPI, llms.txt, examples, ONE_PAGER, CHANGELOG, `npm publish --dry-run`.
8. Report: what was built, test output, your commands (worker deploy, the new secret name `PARTNER_SECRETS_KEY`, KV/rate-limit binding, widget deploy, creating the first partner, publishing).

**Phase 2: add G$ / CELO with naira.** Behind `PARTNER_ONRAMP_ENABLED` (off). Only after the legal questions above are answered.

Rough size: Phase 1 is several days of work in this session. I will commit in small steps on `partner-sdk` and report after each numbered item above. Nothing gets pushed, merged, deployed or published without your go-ahead.

## 11. Tests (Phase 1)
- core: existing quote/units/fee tests move with the code.
- worker: every `/v1` endpoint (happy path and errors); keys (wrong key, pk from a wrong origin, sk with an Origin header, disabled partner, test key never calling the payout partner); rate limit; idempotency (same key twice → one order); fee mismatch; webhook signature, timestamp and replay; retry backoff; test-mode timeline and magic accounts.
- sdk: every method against a mocked API; transaction safety check (wrong router, wrong payTo, pay amount above minimum, expiring order); lost-reply recovery; EIP-1193 and viem paths; watchCashOut backoff and cancel; verifyWebhook.
- fork: the SDK-built transaction runs against the real RouterV2 on a Celo fork and pays exactly.
- react: flow renders at 360 px, keyboard path, focus trap, labels.
- widget: Playwright in test mode (open → bank → review → simulate → paid event received by host page), wrong-origin postMessage ignored.
- Regression: all existing web, worker and contract tests.
