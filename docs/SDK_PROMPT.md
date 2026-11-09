# Prompt: build the GoodCash Partner SDK and Widget

Paste everything below the line into a fresh Claude Code session in this repo.

---

You are a senior engineer who has shipped payment SDKs used by other companies (think Stripe Elements, Transak, Onramper). Build **GoodCash for Partners**: a developer SDK **and** a drop-in widget so other apps can let their users cash out G$ to a Nigerian bank account (and later add G$/CELO with naira) without leaving their app.

## 1. Read first, then plan, then build

1. Read the repo before writing anything: `services/orders/src/index.ts` (the worker: orders, one-tap `/orders/v2`, `/history`, `/onramp/*`, webhooks, fees), `apps/web/src/lib/` (`router.ts`, `useOffRamp.ts`, `units.ts`, `addGs.ts`), `packages/contracts/src/GoodCashRouterV2.sol`, `docs/FEE.md`, `docs/AUDIT-2026-11-08.md`. The SDK must reuse this logic, not re-invent it. Where web-app code is reused, move it into a shared package and make the web app import it, with its tests still passing.
2. Write `docs/partners/PLAN.md`: architecture, package layout, the public API surface (every function, endpoint, event), the auth/key model, the fee model, and the phases below. **Stop and show me the plan before building.** Ask about anything that is genuinely my decision (fees, legal, naming).
3. Work on a new branch `partner-sdk`. Do not push, merge or deploy anything without my go-ahead. I run `npx wrangler deploy` and every `wrangler secret put` myself. Never ask me for, print or read API keys, private keys or seed phrases. Do not publish anything to npm; prepare it and tell me the command.

## 2. Who the partners are (design for all of them)

| Partner type | What they want | Best fit |
|---|---|---|
| **Games** (most partners): web/WebGL, Unity, mobile | Players turn G$ rewards into naira. Some players have their own wallets; some games hold G$ for players and pay out from a game wallet | Widget (pop-up or WebView) for player wallets; **server API** for payouts from the game's own wallet |
| **Apps** (web, React Native) | A "Cash out to bank" button inside their app | Widget, or the React components |
| **Fintechs** (airtime, data, bills) | Convert G$ to naira so the user can buy airtime/MTN data or pay bills; payout may go to the fintech's own collection account | Core SDK + server API + webhooks, fully headless, their own UI |
| **AI/no-code app builders** (a "Web3 Lovable") | Their AI generates apps that include cash out with zero hand-holding | A tiny copy-paste component, an OpenAPI spec, and `llms.txt` docs an AI can read and use correctly first time |

## 3. What to build

### A. Partner API (worker, versioned under `/v1`)
- Leave today's endpoints unchanged for goodcash.xyz; add `/v1/*` for partners.
- **Keys:** each partner gets a *publishable key* (`gc_pk_live_…`, safe in browsers, locked to their allowed websites/app ids) and a *secret key* (`gc_sk_live_…`, server only). Store only hashes in KV. Per-key rate limits, an on/off switch, and `test` vs `live` mode. Write a small admin script I run myself to create, list and switch off partners (it prints the key once, to me only).
- **Endpoints (headless):** banks list, verify bank account name, quote (G$ in → naira out, with every fee line), create cash-out order (returns what the wallet must sign), order status, wallet history, minimum and limits, network fee estimate.
- **Idempotency** keys on every create, and a `partnerRef` field so partners can match orders to their own users.
- **Webhooks to partners:** `order.paid`, `order.failed`, `order.refunded`, `order.delayed`, signed with HMAC-SHA256 plus a timestamp (reject replays), retried with backoff, with a test-send endpoint.
- **Test mode:** test keys never touch the real payout partner or real money. Fake banks, fake account-name check, a simulated status timeline, and a way to force failures. Partners must be able to build everything before going live.
- CORS: publishable keys work only from that partner's allowed origins; secret keys are refused from browsers.

### B. Core SDK: `packages/sdk` → `@goodcash/sdk`
- TypeScript, zero UI, works in browsers, Node, React Native and Cloudflare/edge (no DOM, no Node-only APIs in the core). ESM + CJS + types. Small: no heavy dependencies; viem as an optional peer.
- Two signing modes, both **non-custodial for GoodCash** (we never hold anyone's keys or money):
  1. **User wallet:** returns the exact transaction (`G$.transferAndCall` to RouterV2) for any wallet to sign: injected, WalletConnect, Magic, MiniPay, or a game's embedded wallet. Accepts a viem `WalletClient` or a plain EIP-1193 provider.
  2. **Server wallet:** for games and fintechs paying out from their own wallet: the partner's backend signs with its own key using the same call. Document the security rules for them.
- Carries over everything production already learned: the minimum, the 0.5% price protection, the network-fee check (CELO), the "lost wallet reply" recovery (`provesNothingWasSent`, find the payment on chain before saying anything failed), fee-shown-equals-fee-charged, and paid = `fulfilled/validated/settling/settled`.
- Typed errors with a stable `code` plus a plain customer-safe `message` (same wording rules as the app) and a separate `detail` for developers.
- `watchOrder(id, onChange)` polling with backoff, and cancellation.

### C. React package: `packages/react` → `@goodcash/react`
- `<GoodCashProvider publishableKey>` plus hooks (`useQuote`, `useBanks`, `useCashOut`, `useOrder`) and one ready-made `<CashOutButton />` that opens the full flow.
- Themeable (colors, radius, font) with the sticker-pop look as the default; works in light and dark; accessible (focus trap, keyboard, labels); 360 px phones first.

### D. Widget: `apps/widget` (hosted, e.g. `pay.goodcash.xyz` or `goodcash.xyz/widget`)
- The full GoodCash cash-out flow (amount, bank, review, confirm, tracker, done) as a page that opens as a **pop-up, embedded iframe, or redirect**, and in a **WebView** for Unity and mobile games.
- One-line install: `<script src=".../widget.js">` then `GoodCash.open({ publishableKey, wallet?, amount?, partnerRef?, theme? })`. Also an npm entry.
- Events back to the host by `postMessage` (strict origin checks): `ready`, `order.created`, `order.paid`, `order.failed`, `closed`. Redirect mode returns with `?goodcash_order=…`. A deep-link return for mobile.
- Partner branding allowed ("Powered by GoodCash" stays). Security headers adjusted only for the widget routes so it can be framed by allowed partner sites, and nowhere else.
- Built on `@goodcash/sdk` + `@goodcash/react`, so there is one source of truth.

### E. Docs and examples (`docs/partners/`, plus `examples/`)
- Quickstarts, 5 minutes each: **game (WebGL + Unity WebView)**, **React web app**, **React Native**, **fintech server (Node)**, **AI builder (copy-paste component)**.
- `openapi.yaml` for `/v1`, `llms.txt` + `llms-full.txt` (concise rules an AI coding tool must follow, including "never put the secret key in the browser"), error-code table, webhook guide with verification code, test-mode guide, go-live checklist.
- `examples/` runnable demos for each quickstart, all working in test mode.
- `docs/partners/ONE_PAGER.md`: a plain-English page I can send to partners (what it does, how long integration takes, fees, what they need to do, contact).

## 4. Fees: propose, don't decide
- GoodCash charges 1% today through the payout partner's sender fee, which allows **one** fee address per order (our Safe).
- Partners will want to add their own fee. Propose options with trade-offs, for example (a) GoodCash collects the total and pays partners a revenue share from a ledger, (b) the partner charges their user separately in their own app, (c) a new router version that splits the fee on-chain. **Do not change or deploy any contract.** If (c) wins, write the design and tests only, and flag that it needs a new audit and a Safe deployment.
- Whatever is chosen: the fee the customer saw must equal the fee charged (keep the existing `feePercent` check), shown as separate lines.

## 5. Phases (build Phase 1 fully before touching Phase 2)
- **Phase 1:** cash out G$ → naira: API `/v1`, core SDK, React package, widget, test mode, webhooks, docs, examples.
- **Phase 2 (behind a flag, off by default):** add G$ / CELO with naira. ID details (BVN/NIN) are never stored or logged; write down the legal and partner-agreement questions for me instead of guessing.

## 6. Non-negotiables
- Non-custodial: no GoodCash wallet ever holds customer or partner funds.
- Customer screens use plain words: no "swap", "quote", "slippage", "gas", "Celo", "Paycrest", "Relay", "USDT" or other partner/token names. Errors shown to customers are short and kind; technical detail goes to logs and to the developer `detail` field only.
- Never log bank account numbers in full, names, emails or ID numbers; mask them like the existing `safePartnerError`.
- Backwards compatible: goodcash.xyz must behave exactly as it does today. All existing worker, web and contract tests must still pass.
- Tests: unit tests for every SDK function and endpoint, webhook signature tests, key/CORS tests (wrong origin, secret key from browser, switched-off partner, rate limit), a widget end-to-end test in test mode, and a fork test for the transaction the SDK builds against RouterV2.
- Semantic versioning, a CHANGELOG, and an `npm publish --dry-run` that shows only intended files.

## 7. When you finish each phase, report
- What was built, file by file, and what was **not** done or not verified.
- Test results with real output.
- The exact commands for me: worker deploy, secrets to set (names only), how to create the first partner key, and how to publish the packages.
- Open decisions for me (fees, domain for the widget, legal questions), each with your recommendation.
