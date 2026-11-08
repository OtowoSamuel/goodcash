# Full audit prompt for GoodCash

Paste everything below the line into a fresh Claude Code session started in the GoodCash folder.

---

You are a senior engineer doing a full, independent audit of GoodCash before it handles more real money. GoodCash lets people cash out GoodDollar (G$) to naira and add G$ or CELO with naira. It is live on Celo mainnet at goodcash.xyz. Treat every claim in this brief as something to verify, not trust.

## What exists (read the code, do not assume)

- `packages/contracts`: GoodCashRouter (original) and GoodCashRouterV2 (one-tap, owned by the Safe 0x735Ef948F746bc141D04042d2A18aA7f967bce2f). Foundry tests, fork tests, deploy scripts.
- `services/orders`: a Cloudflare Worker (KV, rate-limit bindings, cron) that creates payout orders with the payout partner, tracks status, sends email, proxies the swap service, and charges a 1% fee.
- `apps/web`: React + Vite + Tailwind PWA (cash out, Add G$ / Add CELO, History, Magic and WalletConnect wallets).
- `docs/`: design, security and fee notes. `video/`: a demo video project (low priority).

## Hard rules

- Do not deploy anything, push to main, or change production. Work on a branch named `audit-YYYYMMDD`.
- Do not ask for, read, print or store any secret, private key, seed phrase or API key. If you meet one in the repo or history, stop and report where it is (path and commit), never the value.
- Do not move funds or send transactions. Read-only chain access and local forks only.
- Keep the look (sticker-pop: lilac, thick black borders) and the plain, non-technical customer wording. Never show partner, token or network names to customers.
- Report plainly. Every finding has: severity (critical / high / medium / low / note), where (file:line), what is wrong, how it could be exploited or hurt a customer, and a fix. Do not pad the report.

## 1. Smart contracts (highest priority)

For both routers: read every line, then try to break them.
- Funds: can any path leave G$, USDT or dust in the contract, strand a user's funds, or let anyone but the owner pause or withdraw? Prove the zero-balance-delta invariant with tests, including fee-on-transfer and 18-vs-6-decimal edge cases.
- Authorization: who can call what, who can pass the `payTo` / `payAmount` / `minOut` / `deadline` / `ref` fields, and can a malicious caller or a front-runner redirect a payout or steal the surplus?
- Reentrancy and token behaviour: transferAndCall (ERC-677) callbacks, approvals left open, allowance races, the swap routes (Mento broker, Uniswap), slippage and price-manipulation windows, the deadline and `minOut` checks, rounding direction.
- Ownership and upgrade: Safe is the owner (confirm on-chain: threshold, owners, any module), no hidden admin, immutability claims are true, pause cannot trap funds.
- Verification: confirm the deployed bytecode matches the repo source and the build settings. Report that the V2 source is not yet verified on Blockscout and give the exact steps (the standard-input JSON is in `packages/contracts/verification`).
- Run the full Foundry suite plus fork tests against Celo mainnet. Add invariant or fuzz tests where coverage is thin. Run Slither (or equivalent) and triage every result; do not paste raw tool output as findings.

## 2. Worker (services/orders)

- Abuse and money: every endpoint that creates an order, proxies the swap service, sends email or accepts a webhook. Look for open relays, missing rate limits, replay, order-hijack or double-pay paths, KV key collisions, race conditions between webhook, cron and client polling, and wrong status mapping.
- The 1% fee: check the maths end to end (client estimate, worker sizing, partner response, amount the customer sends), that the fee is only charged when the screen showed it, and that a refusal by the partner falls back safely and visibly to the team.
- Privacy: customer ID details (name, birth date, BVN or NIN) must never be stored or logged. Grep logs, KV writes, error paths and tests. Check bank details, emails, wallet addresses and what leaves the worker.
- Webhook signature checking, CORS allow-list, input validation (zod), error messages (no internals leaked), email templates (injection), cron jobs.
- Run the worker tests and read them critically: which important behaviours have no test?

## 3. Web app (apps/web)

- Money flows: cash out (one-tap and three-step), Add G$ / Add CELO (order, wait, gas-free signature, swap). For each, list every state and failure and check the customer is told the truth. In particular: a lost wallet reply, a double tap, a page reload mid-order, a wrong network, a wallet with no CELO, a tab closed early, an order that expires or is refunded.
- Signing: confirm the typed-data signing request is checked against what we expect before the wallet is asked; confirm what is stored in localStorage (no secrets, no BVN, no bank details beyond what is intended).
- Security: CSP and `_headers`, XSS sinks, third-party scripts, dependency vulnerabilities (`npm audit` triage, not dumping), the Magic and WalletConnect integrations, service worker caching of stale builds.
- Correctness: run tsc, eslint and the whole test suite several times; list flaky tests and fix their cause.

## 4. Wording audit

Go through every customer-facing string: app screens, pop-ups, errors, emails (`services/orders/src/index.ts`), About, Privacy, Terms, `i18n.ts`, the video captions.
- Grammar, spelling, punctuation, capitalisation (G$, CELO, naira, GoodDollar, GoodCash) and consistency (one name per thing).
- Plain language a first-time Nigerian user understands; no jargon (swap, slippage, router, gas, Uniswap, Paycrest, USDT, Base) on customer screens.
- Truthfulness: every number and claim ("no hidden fee", "fees are included", "about ₦X", "within minutes", "non-custodial", "open source") must be true today. Flag any that are not.
- Errors must never say "nothing was taken" unless that is provably true.
Give a table: file:line, current text, problem, replacement.

## 5. UI and accessibility audit

Open the app in a real browser at 360, 375, 768 and 1280 widths. For home, cash out, review, confirm, tracker, History, Add G$, Add CELO and every pop-up, check: layout breaks, clipped or overlapping text, tap targets under 44px, contrast, focus order and keyboard use, labels for screen readers, loading, empty and error states, one pop-up never over another, the status strip showing only the most urgent notice, long names and amounts, dark-mode or large-font behaviour. Attach a screenshot reference for each issue.

## 6. System checks

- Read-only on-chain reconciliation: for the last N cash outs, match each contract event to its order, its payout status and the amount the customer received. Report any that do not reconcile.
- Config consistency: `wrangler.toml`, `.env.production` keys (names only), addresses in the app, worker, docs and tests all agree (routers, Safe, tokens). List mismatches.
- Dependency and supply-chain review (`package-lock`, install scripts, the skills in `.agents/`).
- Docs: anything in `docs/` that is now wrong.

## Output

1. A short executive summary (what is solid, what is risky, what must be fixed before more volume).
2. The findings list, most severe first, in the format above.
3. A branch with fixes for everything low-risk (tests included), each in its own commit, and a clear list of the items that need my decision (anything touching contracts, money maths, or customer wording policy).
4. A test and verification log: what you ran, the results, and what you could not verify and why.

Be adversarial and specific. If you find nothing in an area, say what you checked so I can trust the silence.
