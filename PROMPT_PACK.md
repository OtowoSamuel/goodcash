# GoodCash Prompt Pack

Version 1.0 | November 4, 2026 | Companion to `GoodCash Product Requirements Document.md` v0.2

This pack turns the PRD into a sequence of prompts for a coding agent. Run them **in order**. Each prompt is self-contained enough to paste into a fresh session, but the agent must read the PRD first.

## How to use this pack

1. Put the agent in the repo root: `/Users/admin/Documents/GoodCash`.
2. Prepend the **Global context** block below to every prompt.
3. Run one prompt at a time. Do not start the next prompt until the acceptance criteria and verification pass.
4. If a prompt reveals a blocking fact that contradicts the PRD (for example, the partner minimum is $5, or MiniPay rejects G$), **stop and report** instead of coding around it.
5. Commit after each prompt. Never commit secrets, API keys, seed phrases or `.env` files.

## Global context (prepend to every prompt)

```text
You are building GoodCash, a non-custodial Celo PWA that lets GoodDollar (G$) holders claim G$, accumulate it, swap it to USDT, and hand off to a licensed naira off-ramp.

Read these first:
- `/Users/admin/Documents/GoodCash/GoodCash Product Requirements Document.md` (v0.2)
- This prompt pack, especially "Verified facts" and "Non-negotiables" below.

Environment:
- Working directory: `/Users/admin/Documents/GoodCash`
- OS: macOS (darwin), shell: zsh
- Celo mainnet chainId: 42220
- Public RPC for verification: https://forno.celo.org
- Foundry is installed (`forge`, `cast`).

Verified facts (do not re-invent, do re-verify before mainnet):
- G$: 0x62B8B11039FcfE5aB0C56E502b1C372A3d2a9c7A, 18 decimals.
- USDm (cUSD): 0x765DE816845861e75A25fCA122bb6898B8B1282a, 18 decimals.
- USDT: 0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e, 6 decimals.
- USDC: 0xcebA9300f2b948710d2653dD7B07f33A8B32118C, 6 decimals.
- NGNm: 0xE2702Bd97ee33c88c8f6f92DA3B733608aa76F71, 18 decimals.
- GoodDollar Broker proxy: 0x88de45906D4F5a57315c133620cfa484cB297541 (implementation named Broker).
- GoodDollar Exchange Provider: 0x2fFBB49055d487DdBBb0C052Cd7c2a02A7971e41.
- G$/USDm exchangeId: 0xba77f5c7bb3317643c6d81d1ef3f9913561741d92095f88efa402faf2cbe9124.
- GoodDollar Reserve proxy: 0x94A3240f484A04F5e3d524f528d02694c109463b (implementation named Reserve).
- G$/USDm Uniswap V3 pool: 0x9491d57c5687AB75726423B55AC2d87D1cDa2c3F, fee tier 10000 (1%).
- UBISchemeV2: 0x43d72Ff17701B2DA814620735C39C620Ce0ea4A1.
- IdentityV4: 0xC361A6E67822a0EDc17D899227dd9FC50BD62F42.
- Exit contribution on G$ -> USDm is 10% (on-chain, verified).
- Gross G$ price ~$0.00012666; net after exit contribution ~$0.00011399.
- UBI ~123.5 G$/eligible user/day; ~5,105 claimers on day 1344 at the final verification snapshot (rises during the day).
- G$/USDm pool holds ~8.37M G$ and ~498 USDm (~$1,450 TVL). Thin.
- Paycrest: Celo supported (USDT/USDC/cNGN), NGN payout, $0.50 minimum on most chains (Celo not separately stated), mainnet only, sender must be KYB-verified; off-ramp `source.kyc` is optional in the API.
- Celo cNGN: 0xF6829D7393dAe24509eb1E52eE8e572e2E271a4f (6 decimals).
- MiniPay: supports only USDT/USDC/USDm; G$ is not permitted, so a G$ flow cannot be a listed Mini App. No connect button, no personal_sign/eth_signTypedData, never display wallet address, USDT mandatory, 2 MB bundle, legacy tx only.

Non-negotiables:
- Never hold user funds between transactions. The router may hold tokens only transiently inside a call and must end with zero balance.
- No arbitrary paths, arbitrary routers or arbitrary calldata. Use an enum + immutable allowlisted venues.
- Never put a Paycrest API key, private key or seed phrase in client code or git.
- Show the 10% GoodDollar Reserve exit contribution explicitly. Never call it a GoodCash fee.
- Do not promise weekly cash-outs. The product is accumulate-then-cash-out; ~36 days of daily claims for a first $0.50 cash-out.
- Do not promise a MiniPay Mini App listing. G$ is not a supported MiniPay asset; ship a mobile PWA for external wallets and show an unsupported notice inside MiniPay.
- Do not claim "no personal data." Wallet addresses and bank details are personal data under NDPA 2023.
- Every task ends with a verification step. If verification fails, fix it or report the blocker; do not move on silently.
```

## Verified facts and known traps

| Fact | Value | Trap |
| --- | --- | --- |
| G$ price (gross) | ~$0.00012666 | Do not use $0.0001; it overstates value by ~27% |
| G$ price (net) | ~$0.00011399 | This is after the 10% exit contribution |
| Daily UBI | ~123.5 G$ | The old PRD assumed ~3,000 G$/week; actual is ~865 G$/week |
| First $0.50 cash-out | ~4,386 G$ (~36 days) | Do not build a "cash out now" CTA for new users |
| G$/USDm pool | ~$1,450 TVL | A $100 swap is material; enforce impact limits |
| Paycrest minimum | $0.50 on most chains | Some networks enforce 1 unit; Celo not separately stated; confirm |
| Paycrest environment | Mainnet only | No sandbox; test with real small amounts |
| Paycrest sender | KYB required | GoodCash, not the user, is the sender; off-ramp customer KYC is optional in the API but legality still needs review |
| MiniPay G$ | Unsupported token | MiniPay allows only USDT/USDC/USDm; G$ flow cannot be listed, and the wallet cannot hold G$ |
| Claim | Credits msg.sender | Cannot be routed through the swap contract |

---

## Prompt 0 — Kickoff: read, audit, and lock scope

**Goal:** Make the agent understand the product and produce a build plan without writing product code yet.

**Tasks**

1. Read the PRD end to end. Read this prompt pack.
2. Inspect the repo (`ls -la`, `find . -maxdepth 2 -type f | head -100`). Report what exists.
3. Write `AGENTS.md` containing:
   - The global context block from this pack.
   - The verified facts table.
   - Commands for install, build, test, lint, typecheck and contract tests.
   - The rule: no secrets, no mainnet deploy without the gate in Prompt 4.
4. Create `docs/BUILD_PLAN.md` with the 14 prompts (0–13) as milestones, each with acceptance criteria copied from this pack.
5. Create `docs/DECISIONS.md` with the open questions from PRD section 15. Mark each as Open / Resolved / Blocking.
6. Report the three highest-risk unknowns and your recommended order.

**Acceptance criteria**

- `AGENTS.md`, `docs/BUILD_PLAN.md` and `docs/DECISIONS.md` exist.
- No product code written.
- The plan explicitly includes the verification spike before the contract.

**Verification**

```bash
ls -la AGENTS.md docs/BUILD_PLAN.md docs/DECISIONS.md
```

**Do not**

- Scaffold the app yet.
- Change the PRD.
- Invent addresses or partner terms.

---

## Prompt 1 — Verification spike (blocking) — COMPLETED November 4, 2026

**Goal:** Replace every remaining assumption with a checked fact. This prompt can stop the project.

**Output:** `script/verify.sh` passes; see `docs/VERIFY_OUTPUT.txt`, `docs/CLAIM_NOTES.md`, `docs/PAYCREST_NOTES.md`, `docs/MINIPAY_NOTES.md`, `docs/ECONOMICS.md`, and `docs/VERIFICATION.md`. Result: **GO for contract/PWA, NO-GO for the weekly-cash-out premise, "no KYC" marketing, and a MiniPay listing.**

**Tasks**

1. **On-chain re-verification.** Write `script/verify.sh` that uses `cast` against `https://forno.celo.org` and prints:
   - G$, USDm, USDT, USDC, NGNm `symbol()` and `decimals()`.
   - Broker `getExchangeProviders()` and the provider's `getExchangeIds()`.
   - The exchange tuple for the G$/USDm exchangeId: reserve asset, token, token supply, reserve balance, reserve ratio, exit contribution.
   - `getAmountOut(exchangeId, G$, USDm, 1000e18)` and `getAmountOut(exchangeId, USDm, G$, 1e18)`.
   - `UBISchemeV2.currentDay()`, `dailyUbi()`, `getDailyStats()`, `getClaimerCount(currentDay)`.
   - The Uniswap pool's `token0`, `token1`, `fee`, `slot0`, `liquidity`, and both token balances.
   - Assert the exit contribution is 10% (10,000,000 / 1e8). Fail loudly if not.
2. **Claim SDK spike.** Install `@goodsdks/citizen-sdk` and `@goodsdks/identity-sdk` in a throwaway directory. Read their types. Write a short note in `docs/CLAIM_NOTES.md` with the exact functions and return shapes for entitlement, claim, next claim time, and verification status. Do not build UI.
3. **Paycrest spike.** Read `https://docs.paycrest.io/implementation-guides/sender-api-integration` and the v2 create-order docs. Write `docs/PAYCREST_NOTES.md` with:
   - The exact v2 off-ramp request body for Celo USDT -> NGN.
   - The response fields (`id`, `providerAccount.receiveAddress`, `amount`, `senderFee`, `transactionFee`, `validUntil`).
   - The minimum order for Celo, confirmed from the docs or support (do not guess). Docs say $0.50 on most chains; Celo is not separately stated.
   - The KYB and customer-KYC obligations for a sender. Off-ramp `source.kyc` is optional in the API; sender KYB is mandatory.
   - A recommendation: can GoodCash be the sender without collecting user KYC, or does this require a partner/legal review?
4. **MiniPay spike.** Read the MiniPay requirements and common-mistakes references in `~/.agents/skills/celopedia-skill/references/`. Write `docs/MINIPAY_NOTES.md` with the exact constraints and a recommendation. Confirmed: MiniPay supports only USDT/USDC/USDm, so a G$ flow cannot be listed; ship a PWA for external wallets.
5. **Economics check.** Compute and record:
   - G$ per day and per week at the verified dailyUbi.
   - USD net per day/week/month at the verified net price.
   - Days to reach $0.50 and $1.00.
   - Season G$ volume if 300 users claim daily for 84 days, and its USD value.
6. **Stop condition.** If any of these is true, stop and report instead of proceeding:
   - Exit contribution is not 10%. **Pass: it is 10%.**
   - The net G$→USDm quote is materially different from $0.00011399/G$ (more than 5%). **Pass: diff is 0.000%.**
   - Paycrest's Celo minimum is above $1.00. **Unresolved, not violated: docs say $0.50 on most chains; confirm Celo.**
   - Paycrest requires GoodCash to KYC every end user and there is no acceptable structure. **Not required by the API for off-ramp; sender KYB required; legal review remains.**
   - MiniPay cannot hold or receive G$ and there is no browser path. **MiniPay cannot hold G$; a browser/external-wallet path exists. Scope MiniPay out and proceed.**

**Acceptance criteria**

- `script/verify.sh` runs and prints all values.
- `docs/CLAIM_NOTES.md`, `docs/PAYCREST_NOTES.md`, `docs/MINIPAY_NOTES.md`, `docs/ECONOMICS.md` exist.
- Every number in the PRD Appendix A is re-confirmed or corrected.
- `docs/VERIFICATION.md` states a clear GO / NO-GO recommendation and the conditions.

**Verification**

```bash
bash script/verify.sh | tee docs/VERIFY_OUTPUT.txt
```

**Do not**

- Deploy anything.
- Create a Paycrest order yet (that spends real money).
- Change the PRD numbers without evidence.

---

## Prompt 2 — Scaffold the repo

**Goal:** A clean monorepo skeleton that builds, tests and lints.

**Tasks**

1. Create:
   ```
   apps/web/          Vite + React + TypeScript PWA
   packages/contracts/ Foundry project
   services/orders/   Cloudflare Worker (TypeScript)
   docs/
   script/
   ```
2. Frontend dependencies: `react`, `react-dom`, `typescript`, `vite`, `@vitejs/plugin-react`, `wagmi`, `viem`, `@tanstack/react-query`, `tailwindcss`, `vite-plugin-pwa`, `zod`.
3. Add scripts at the root: `dev`, `build`, `test`, `lint`, `typecheck`, `contracts:test`, `contracts:build`.
4. Add ESLint + Prettier. Add a strict `tsconfig`.
5. Add `.env.example` with placeholders only:
   ```
   VITE_CELO_RPC_URL=
   VITE_WALLETCONNECT_PROJECT_ID=
   PAYCREST_API_KEY=
   PAYCREST_BASE_URL=
   ```
6. Add `.gitignore` covering `.env`, `node_modules`, `out`, `cache`, `broadcast`, `dist`.
7. Create a minimal home page that renders "GoodCash" and the connected chain id. No business logic.
8. Add a `README.md` with setup, scripts and the mainnet gate.

**Acceptance criteria**

- `npm install` and `npm run build` succeed.
- `npm run typecheck` and `npm run lint` pass.
- `forge build` succeeds in `packages/contracts`.
- No secrets in the repo.

**Verification**

```bash
npm install && npm run build && npm run typecheck && npm run lint
cd packages/contracts && forge build
git status --short
```

**Do not**

- Add Next.js.
- Add a UI kit heavier than Tailwind.
- Add analytics yet.

---

## Prompt 3 — `GoodCashRouter` contract

**Goal:** Implement, test and document the router. Reserve route first, Uniswap fallback second.

**Context**

- The 10% exit contribution is real and applies on G$→USDm.
- The router must not accept arbitrary paths, routers or calldata.
- The contract ends every call with zero token balance.

**Tasks**

1. In `packages/contracts`, create `GoodCashRouter.sol`.
2. Define:
   ```solidity
   enum Route { RESERVE_TO_USDM, UNISWAP_TO_USDM, RESERVE_THEN_UNISWAP, UNISWAP_THEN_UNISWAP }
   ```
3. Define immutable:
   - `G$`, `USDm`, `USDT`
   - `broker`, `exchangeProvider`, `exchangeId`
   - `uniswapRouter` (SwapRouter02)
   - `gDollarUsdmPool` (for the fallback quote/route)
   - `owner` (Safe)
4. Implement `cashOut(Route route, uint256 amountIn, uint256 minAmountOut, uint256 deadline, address recipient, bytes32 ref)`.
5. Implement the Reserve hop with the verified Broker signature `swapIn(address exchangeProvider, bytes32 exchangeId, address tokenIn, address tokenOut, uint256 amountIn, uint256 amountOutMin)`. The Broker pulls `tokenIn` from `msg.sender` (the router), so approve the Broker and expect the output at the router. Revert if the returned amount is zero.
6. Implement the Uniswap V3 exact-input single-hop for G$→USDm and USDm→USDT. Use the pool fee tier and token addresses; do not hardcode a USDm/USDT pool until verified.
7. Use `SafeERC20`; exact approvals; reset to zero after each hop. Use `ReentrancyGuard`. Use balance-delta accounting for the final output.
8. Add:
   - `pause()` / `unpause()` (owner only).
   - `setAllowedOutput(address,bool)` (owner only).
   - `rescue(address token, address to, uint256 amount)` (owner only, cannot run while paused? define and document).
   - `feeBps` fixed at 0 with a setter capped at 100, disabled in MVP.
9. Emit `CashOut(user, recipient, tokenOut, amountIn, amountOut, route, ref)`.
10. Write tests:
    - Fork test against Celo mainnet: 1,000 G$ -> USDT, assert output within 2% of the quoted net.
    - Reserve paused/limit simulation: fallback path.
    - Fuzz `amountIn` and `minAmountOut`.
    - Invariant: contract token balances are zero after every call.
    - Revert cases: deadline, zero amount, zero min, bad recipient, unsupported route, output below min.
    - Access control: non-owner cannot pause, rescue or set allowlist.
11. Add `docs/CONTRACT.md`: routes, addresses, invariants, known risks, and the exact quote formula.

**Acceptance criteria**

- `forge test` passes, including the fork test.
- `forge coverage` shows the core paths covered.
- The contract has no arbitrary call primitive.
- A small mainnet-fork swap produces a plausible USDT amount.
- `docs/CONTRACT.md` matches the code.

**Verification**

```bash
cd packages/contracts
forge build
forge test -vvv
forge coverage
```

**Do not**

- Accept `bytes path`.
- Approve infinity.
- Send output to the contract and leave it there.
- Deploy to mainnet in this prompt.

---

## Prompt 4 — Deploy, verify, and hand ownership to a Safe

**Goal:** A verified mainnet deployment behind a pause, with a Safe as owner.

**Tasks**

1. Create a deploy script using `forge script` with:
   - Network: Celo mainnet (chainId 42220).
   - RPC from `CELO_RPC_URL`.
   - Deployer from a hardware wallet or a temporary hot wallet funded with only gas.
2. Deploy the Safe first (or use an existing one). Record the address.
3. Deploy `GoodCashRouter` with the Safe as owner.
4. Verify source on Celoscan/Blockscout.
5. Confirm on-chain:
   - `owner()` is the Safe.
   - `paused()` is true.
   - `G$`, `USDm`, `USDT`, `broker`, `exchangeId` match the PRD.
6. Run a **small real swap** only after:
   - The fork tests pass.
   - The verification output matches Appendix A.
   - The Safe can unpause/pause.
7. Unpause for the test swap, execute 1,000 G$ -> USDT, confirm the USDT arrived and the router balance is zero, then pause again until launch.
8. Write `docs/DEPLOYMENT.md` with addresses, tx hashes, explorer links, owner, pause state, and the exact commands to reproduce.

**Acceptance criteria**

- Verified contract on the explorer.
- Owner is the Safe; contract is paused at the end.
- One real swap succeeded with a plausible output.
- Router token balances are zero.
- No private key or seed phrase in the repo or shell history.

**Verification**

```bash
cast call <ROUTER> "owner()(address)" --rpc-url https://forno.celo.org
cast call <ROUTER> "paused()(bool)" --rpc-url https://forno.celo.org
cast call <G$> "balanceOf(address)(uint256)" <ROUTER> --rpc-url https://forno.celo.org
cast call <USDT> "balanceOf(address)(uint256)" <ROUTER> --rpc-url https://forno.celo.org
```

**Do not**

- Deploy with a hot wallet holding more than gas money.
- Leave the contract unpaused.
- Skip verification.
- Proceed if the real swap output is more than 2% below the quote.

---

## Prompt 5 — Quote engine and route selection

**Goal:** A tested quote module that compares Reserve and Uniswap and returns a net quote.

**Tasks**

1. Create `apps/web/src/lib/quote.ts`.
2. Implement:
   - `getReserveQuote(amountIn)` via the provider `getAmountOut`.
   - `getUniswapQuote(amountIn)` via a quoter or pool math.
   - `getUsdmToUsdtQuote(amount)` via the verified route.
   - `getNetQuote({ amountIn, route })` returning:
     ```
     amountInG$, grossUsdm, netUsdm, usdtOut, priceImpactBps,
     exitContributionBps, swapFeeBps, networkFeeUsd, partnerFeeUsd,
     netNaira, route, quotedAt, expiresAt
     ```
3. Implement route selection per PRD Appendix B:
   - Prefer Reserve when within 1% of Uniswap.
   - Use Uniswap only when Reserve is paused, at limit, or >1% worse.
   - Refuse if impact >10% or depth <10× swap size.
4. Add a 30-second expiry. Refuse stale quotes in the swap function.
5. Add unit tests with mocked chain reads for:
   - Exact 10% exit contribution.
   - Reserve paused -> fallback.
   - Thin pool -> refusal.
   - Decimal conversion 18 -> 6.
   - Stale quote -> error.
6. Add `docs/QUOTES.md` with the formulas and a worked example at 1,000 G$ and at 4,386 G$.

**Acceptance criteria**

- The quote at 1,000 G$ matches the on-chain Reserve output within 0.5%.
- No floating-point money math in the contract path; use bigint everywhere in the client.
- Tests cover the fallback and refusal paths.

**Verification**

```bash
npm test -- quote
npm run typecheck
```

**Do not**

- Hardcode the G$ price.
- Use JavaScript `number` for token amounts.
- Ignore the exit contribution in the displayed price.

---

## Prompt 6 — Claim and identity integration

**Goal:** Claim daily G$ and show verification status, without routing the claim through the router.

**Tasks**

1. Create `apps/web/src/lib/gooddollar.ts`.
2. Use `@goodsdks/citizen-sdk` and `@goodsdks/identity-sdk`. Implement:
   - `isVerified(address)`
   - `getEntitlement(address)`
   - `claim()`
   - `getNextClaimTime(address)`
   - `getDailyStats()`
3. Build a `useClaim` hook that:
   - Reads entitlement on load.
   - Shows Claim only when entitlement > 0.
   - Sends the claim transaction from the user's wallet.
   - Refreshes balance and next claim time on success.
   - Handles "already claimed", "not verified", "insufficient gas", and user rejection.
4. Add a verification card with a link to GoodDollar verification when the user is not eligible.
5. Add tests for the hook states with mocked SDK responses.
6. Document in `docs/CLAIM_NOTES.md`:
   - The claim credits `msg.sender`, so it cannot be batched into the router.
   - The exact contract calls and the SDK version used.
   - The known limitation that MiniPay has no batching, and that the G$ claim flow is disabled inside MiniPay because it cannot hold G$.

**Acceptance criteria**

- A verified test wallet can claim on a fork or testnet.
- An unverified wallet sees the verification path, not a broken button.
- No claim logic in the router.
- The UI shows the next claim time after a successful claim.

**Verification**

```bash
npm test -- claim
npm run typecheck
```

**Do not**

- Ask for a seed phrase.
- Use `personal_sign` in MiniPay, or attempt a claim there at all.
- Hide the claim failure reason.

---

## Prompt 7 — Core UI: balance, readiness, quote, swap, success

**Goal:** The smallest complete flow that matches the PRD.

**Tasks**

1. Build screens/components:
   - `Home`: G$ balance, net USD value, claim button, readiness meter, days-to-cash-out.
   - `CashOut`: amount picker (25/50/75/100%, naira target), full cost breakdown, route label, min received.
   - `Confirm`: summary, price protection, deadline, 10% exit contribution explanation.
   - `Success`: USDT received, effective cost, explorer link, Continue to naira.
   - `History`: `CashOut` events for the wallet.
2. Enforce:
   - Default slippage 1%, cap 3%.
   - Block above 10% price impact.
   - Re-quote on 30-second expiry.
   - Disabled cash-out with an ETA when below the partner minimum; explain, don't dead-end.
3. Show all four numbers together: you give, you get (at least), what it costs, why.
4. Add skeleton and stale-data states. Cache the last balance.
5. Add the safety banner: never share your seed phrase; GoodCash will never DM first.
6. Add the contract address and explorer link.
7. Add a language scaffold (English only for MVP; Pidgin/Hausa/Yoruba/Igbo strings stubbed).
8. Add tests with React Testing Library for:
   - Below-minimum state.
   - Ready state.
   - High-impact warning and block.
   - Stale quote.
   - Success state.

**Acceptance criteria**

- The flow works end to end on Celo mainnet with a small real swap.
- The 10% exit contribution is visible before confirmation.
- A user below the minimum sees the ETA, not a disabled button with no explanation.
- Lighthouse mobile performance is measured and recorded.

**Verification**

```bash
npm test
npm run build
npx lighthouse http://localhost:4173 --only-categories=performance,accessibility --form-factor=mobile
```

**Do not**

- Use jargon without a one-line explanation.
- Show a naira figure without "estimate" and a source.
- Hide the route change when the fallback is used.

---

## Prompt 8 — Paycrest order service and handoff

**Goal:** A server-side order flow that keeps the API key off the client and never holds user funds.

**Tasks**

1. Implement `services/orders` as a Cloudflare Worker with:
   - `POST /orders` — create a Paycrest off-ramp order for Celo USDT -> NGN.
   - `GET /orders/:id` — poll status.
   - `POST /webhooks/paycrest` — verify the signature and update status.
2. Validate input with `zod`: amount, wallet, bank institution, account identifier, account name. Never log bank details.
3. Call `POST https://api.paycrest.io/v2/sender/orders` with:
   ```
   amount, source {type:"crypto", currency:"USDT", network:"celo", refundAddress},
   destination {type:"fiat", currency:"NGN", recipient {...}},
   reference
   ```
4. Return only what the client needs: `orderId`, `receiveAddress`, `amountToSend`, `senderFee`, `transactionFee`, `validUntil`.
5. Implement client `useOffRamp`:
   - Create the order after the swap.
   - Show the exact amount and address.
   - Ask the user to send from their own wallet.
   - Poll or wait for the webhook.
   - Show status: created, awaiting deposit, processing, settled, expired, refunded.
6. Handle:
   - Below minimum: block and explain.
   - Expired order: create a new one, never reuse an address.
   - Wrong amount: show support guidance.
   - Partner downtime: fall back to the second partner card.
7. Add `docs/OFFRAMP.md` with the sequence diagram, the exact fields, the KYC/KYB note, and the fact that Paycrest has no sandbox.

**Acceptance criteria**

- The API key exists only in the Worker environment.
- A real $0.50 test order is created, funded from a wallet, and observed to settlement or refund.
- No bank details appear in logs or analytics.
- The client never receives the API key.

**Verification**

```bash
npm test -- orders
npx wrangler dev --test-scheduled
curl -X POST http://localhost:8787/orders -d '...'
```

**Do not**

- Hold the user's USDT.
- Hardcode token decimals; fetch them from `GET /tokens`.
- Create orders without a KYB-verified sender account.
- Test with more than the minimum.

---

## Prompt 9 — Analytics and Dune dashboard

**Goal:** Verifiable metrics for GoodBuilders without leaking personal data.

**Tasks**

1. Add client events from PRD section 11. Use a privacy-friendly tool or a first-party endpoint. Never send bank details, names or phone numbers.
2. Add the `CashOut` event decoder and a Dune query spec:
   - Cumulative and weekly G$ routed.
   - USD value at swap time (join a price table or use the Reserve quote).
   - Unique wallets, new vs returning.
   - Route split.
   - Median swap size and median cost percent.
   - Cash-out completion rate (order created vs settled).
3. Create `docs/ANALYTICS.md` with event schemas, retention, and the exact Dune queries.
4. Add a public dashboard link placeholder and a README section.
5. Add a privacy note: wallet addresses are pseudonymous personal data; analytics are wallet-level only.

**Acceptance criteria**

- Events fire once per action (no duplicates).
- The Dune queries return non-zero data after a test swap.
- No PII in any event payload.
- The dashboard distinguishes G$ volume from USD value.

**Verification**

```bash
npm test -- analytics
```

**Do not**

- Send raw RPC payloads or partner responses to analytics.
- Report G$ volume without the USD equivalent.

---

## Prompt 10 — Performance and mobile wallet compatibility

**Goal:** Make the PWA usable on a low-end Android phone and fail honestly inside MiniPay, which cannot hold G$.

**Tasks**

1. Measure the current bundle. Split routes and lazy-load wagmi connectors and the history screen.
2. Target <400 KB gzipped initial JS. Remove unused dependencies. Use system fonts.
3. Add a service worker with a cache-first shell and a network-first balance read; show stale data with a label.
4. MiniPay detection:
   - Detect `window.ethereum.isMiniPay`.
   - Show a blocking, plain-language notice: GoodCash needs a wallet that holds G$, and MiniPay does not support G$; open GoodCash in a browser with a Celo wallet.
   - Do not connect the MiniPay wallet, do not call the claim SDK, and do not start a swap.
   - Never display, copy or share the wallet address.
   - Provide a copy-link button so the user can reopen the URL outside MiniPay. Do not claim a deep link works if it does not.
5. Keep the generic mobile path working: injected connector, WalletConnect, legacy and EIP-1559 transactions, no address exposure unless the user explicitly copies it.
6. Test on a physical Android device on a throttled connection. Record results in `docs/PERFORMANCE.md`.

**Acceptance criteria**

- Initial JS under 400 KB gzipped.
- LCP under 4 seconds on a throttled mid-range Android.
- MiniPay shows the unsupported notice and never starts a G$ flow.
- No `personal_sign` calls in the MiniPay path.
- No wallet address displayed in MiniPay.
- The generic mobile flow works in Safari/Chrome with a Celo wallet.

**Verification**

```bash
npm run build
npx lighthouse http://localhost:4173 --form-factor=mobile --throttling-method=simulate
grep -R "personal_sign\|eth_signTypedData" apps/web/src || true
```

**Do not**

- Add a Connect Wallet button for MiniPay.
- Attempt the G$ claim or swap inside MiniPay.
- Assume MiniPay supports G$ or can receive it.
- Ship a bundle over 2 MB.

---

## Prompt 11 — Security review and test plan

**Goal:** A written security review with tests that prove the invariants.

**Tasks**

1. Run Slither on `GoodCashRouter`. Triage findings into fixed / accepted / false positive.
2. Review:
   - Reentrancy and approval resets.
   - Arbitrary call / confused deputy.
   - Output recipient and balance-delta accounting.
   - Fee-on-transfer and rebasing token assumptions.
   - Pause and rescue access control.
   - Oracle/Reserve pause and fallback.
   - Slippage and deadline.
   - Front-running and sandwich resistance.
3. Add integration tests:
   - Reserve route.
   - Uniswap fallback.
   - Two-hop route.
   - Reserve paused.
   - Pool thin.
   - Output below min.
   - Recipient zero.
   - Stale quote client-side.
4. Write `docs/SECURITY.md` with:
   - Threat model.
   - Findings and fixes.
   - Residual risks (10% fee, thin liquidity, protocol exploit history).
   - The exact commands to reproduce.
5. Add a `SECURITY.md` disclosure contact.

**Acceptance criteria**

- No high/critical Slither findings unresolved.
- All invariant tests pass.
- The residual risk section is honest about the September 2026 exploit and thin liquidity.
- The owner cannot move user funds.

**Verification**

```bash
slither packages/contracts --config-file slither.config.json
cd packages/contracts && forge test -vvv
```

**Do not**

- Mark a finding "accepted" without a written reason.
- Deploy an upgraded contract without a new review.

---

## Prompt 12 — Launch checklist and GoodBuilders submission

**Goal:** Ship safely and submit a truthful application.

**Tasks**

1. Create `docs/LAUNCH.md` with a checklist:
   - Contract verified, owner is Safe, pause tested.
   - Fork tests and one real swap passed.
   - Paycrest order tested at the minimum.
   - Privacy notice published.
   - Terms and risk disclosure published (including the 10% exit contribution and the September 2026 exploit link).
   - Safety banner and contract link live.
   - Dune dashboard public.
   - Backup RPC and error states tested.
   - Support channel and incident contact.
2. Write the GoodBuilders submission text using PRD section 16, with:
   - G$ volume **and** USD value.
   - Realistic targets.
   - The MiniPay scope stated honestly.
   - The non-custodial architecture.
3. Add `docs/INCIDENT.md` with:
   - Who is on call.
   - How to pause the router.
   - How to disable the Reserve route and switch to Uniswap.
   - How to notify users.
   - How to contact the partner.
4. Add an ownership-transfer note: Safe signers, recovery, and what happens if a signer leaves.
5. Do a final `git status` and secret scan.

**Acceptance criteria**

- The launch checklist is complete and signed off.
- The submission contains no claim that is not verifiable.
- Incident and ownership docs exist.
- No secrets in the repo or build output.

**Verification**

```bash
git status --short
grep -R "PAYCREST_API_KEY\|PRIVATE_KEY\|MNEMONIC" . --exclude-dir=node_modules --exclude-dir=.git || true
```

**Do not**

- Submit before the contract is verified and the real swap is done.
- Claim a MiniPay listing that is not confirmed.
- Report G$ volume without its USD value.

---

## Prompt 13 (post-launch) — Operate, measure, and decide the fee model

**Goal:** Run the season with evidence and decide whether the product is viable.

**Tasks**

1. Weekly ops:
   - Check Reserve pause/limits and pool depth.
   - Check Paycrest success rate and refunds.
   - Check failed swaps and classify reasons.
   - Update the dashboard.
2. Monthly:
   - Cohort retention (claim vs cash-out).
   - Median days to first cash-out.
   - Median cost percent.
   - Route split and fallback frequency.
   - Partner completion rate.
3. Decide the fee model with data:
   - 0% MVP vs a capped 0.5% sender fee.
   - Whether a lower-minimum partner or direct NGNm route changes the unit economics.
4. Write `docs/SEASON_REPORT.md` with numbers, surprises and a go/no-go recommendation for a second season.
5. Update the PRD to v1.0 with what was learned.

**Acceptance criteria**

- The season report uses on-chain and partner data, not estimates.
- The fee decision is justified with a cost-per-cash-out analysis.
- The next season plan states whether the $0.50 minimum problem is solved.

**Verification**

- Dashboard links resolve.
- All report numbers trace to a query or a tx hash.

---

## Stop conditions summary

Stop and escalate if any of these is true:

1. The exit contribution is not 10%, or the net quote differs by more than 5% from $0.00011399/G$.
2. The Celo partner minimum is above $1.00, making the accumulation period longer than ~10 weeks.
3. Paycrest requires GoodCash to KYC every user and no legal structure avoids it.
4. MiniPay is a hard distribution requirement and no external-wallet or browser path is acceptable. (Prompt 1 confirmed MiniPay cannot hold G$, but the PWA/external-wallet path exists, so this is not a stop for the current scope.)
5. The real swap output is more than 2% below the quote.
6. The router cannot be made to end with zero balance.
7. The owner cannot pause the contract reliably.
8. A high/critical security finding has no fix.

In every stop case: write the finding in `docs/DECISIONS.md`, mark the affected prompt as blocked, and report to the human. Do not code around a broken premise.
