# GoodCash Redesign — Design-to-Component Mapping (v2)

Produced as STEP 0, updated after STEP 0 review.
Sources: goodcash-sticker-pop.html (mobile) · goodcash-desktop-all.html (desktop)

---

## 1 · Design Token Inventory

### Colours

| Token | Value | Job |
|---|---|---|
| App background | #cdb8ff (lilac) | Page background |
| Ink / outlines / shadows | #111 | All borders, shadows, text |
| --pu Purple | #7b39fc | Main action, nav active, progress fill |
| --ye Yellow | #ffd23f | Coin, sticker, cost mark highlight |
| --mi Mint | #8cf0c0 | Money-received card bg, success circle |
| Card | #fff | Card background |
| Pill default | #ede6ff | Inactive pills |
| Disabled button bg | #e9e3f7 | .gc-btn.gc-btn--dis |
| Disabled button text | #6b5f8a | .gc-btn.gc-btn--dis |
| Dashed row divider | #cfc3ee (2px dashed) | .gc-cost .gc-row borders |

Dark mode: OMITTED from app stylesheet (spec: lilac-only).

### Typography

| Element | Rule |
|---|---|
| Body font | Inter |
| Titles / numbers | Bricolage Grotesque 800 |
| Body weight | 600 |
| Chip / receipt | Inter 600 |
| Big number mobile | 42px / lh 1 / tabular-nums |
| Big number desktop | 44px / lh 1 / tabular-nums |
| Home balance desktop | 52px |
| Logo | 20px mobile · 22px desktop, 800 |
| Screen title | 20px 800 |
| Status headline | 26px 800 |
| Label (.gc-lab) | 10.5px mobile · 11px desktop, 700, UPPERCASE, ls 0.04em |
| Small text (.gc-sm) | 12.5px mobile · 13px desktop, 600 |
| Pill (.gc-pill) | 12px 800 Bricolage |
| Chip (.gc-chip) | 11px mobile · 12px desktop, Inter 600 |
| Keypad keys (.gc-keys) | 18px 800 Bricolage |

### Shape & Spacing

| Property | Mobile | Desktop |
|---|---|---|
| Border width | 2.5px solid #111 | 2.5px solid #111 |
| Card radius | 18px | 18px |
| Button radius | 16px | 16px |
| Pill radius | 99px | 99px |
| Card shadow | 5px 5px 0 #111 | 5px 5px 0 #111 |
| Chip shadow | 3px 3px 0 #111 | 3px 3px 0 #111 |
| Coin shadow | 2px 2px 0 #111 | 2px 2px 0 #111 |
| Button shadow | 5px 5px 0 #111 | 5px 5px 0 #111 |
| Disabled button shadow | none | none |
| Card padding | 12px 14px | 14px 18px |
| Button height | 52px | 54px |
| Button font size | 15px | 16px |
| Vertical card gap | 10px | 12px |
| Screen padding | 14px 14px 12px | 24px 28px 0 |
| Progress bar height | 18px | 20px |
| Progress bar border | 2.5px solid #111 | 2.5px solid #111 |
| Coin diameter | 42px | 46px |
| Coin rotation | 12deg | 12deg |
| Sticker border-radius | 10px | 10px |
| Sticker rotation | -5deg | -5deg |
| Sticker pos | right -5px, bottom -11px | right -6px, bottom -12px |

---

## 2 · CSS Scoping Strategy

All new design CSS is scoped under `.gc` root class added as a wrapper
div in App.tsx. Generic names are prefixed: gc-card, gc-btn, gc-row,
gc-nav, gc-pill, gc-chip, gc-lab, gc-sm, gc-cost, gc-mark, gc-bar,
gc-coin, gc-sticker, gc-top, gc-title, gc-back, gc-keys, gc-note,
gc-tl, gc-dot, gc-ln, gc-hero, gc-ok, gc-st, gc-foot, gc-sp.
Existing Tailwind utilities are layered on top; tailwind.config.js and
postcss.config.js are NOT edited.

---

## 3 · Screen-to-Component Mapping

### Mobile screens (goodcash-sticker-pop.html)

| Design screen | Existing component | Logic it must keep | New/changed strings |
|---|---|---|---|
| 1 Home | ReadinessCard (restructured) + ClaimCard (embedded) | getCashoutRate, MIN_NET_USDT_REQUIRED, ngnPerUsdt, claim logic | YOUR BALANCE; about N after fees; N G$ to go; Cash out / Cash out opens at N G$ |
| Home - last cash out row | HistoryCard excerpt (inlined in Home) | history[0] data; hidden when history empty | LAST CASH OUT; "1,000 G$ → ₦156"; "4 Nov ›" link opens that order's Status |
| Home - claim card (above main btn) | ClaimCard (restyled) | isVerified, entitlementG, onClaimSuccess, all claim hooks | TODAY'S CLAIM; Claim today's G$ (purple) or Next claim in Xh (disabled) |
| 2 Cash out | CashOutCard | getNetQuote, minimum check, rate check, slippageBps | YOU GIVE / YOU RECEIVE ABOUT; MAX pill; custom keypad (mobile) / typed input (desktop); Review btn |
| 3 Review | ConfirmModal (full-screen) | getCashoutRate, countdown, onConfirm, onRefresh, bank props | Review title; Confirm cash out btn; .gc-note with quote timer; Price protection row (tappable, opens SlippageSheet) |
| 4 Status | CashOutTracker | polling, useOffRamp, 4-step timeline, stop-on-terminal | On its way (26px); 4 steps; Back to home (white btn) |
| 5 Success | CashOutTracker (settled state) | status=settled guard | Cash out complete; paid to your bank |

### Desktop screens (goodcash-desktop-all.html)

| Design screen | Left column | Right panel | Notes |
|---|---|---|---|
| Desktop Home | ReadinessCard + ClaimCard + main button (no Last cash out card on desktop) | HOW IT WORKS, WHAT IT COSTS, STAY SAFE (three cards) | Balance big num = 52px desktop |
| Desktop Cash out | CashOutCard (typed input, % chips) | WHAT YOU'LL PAY, ROUTE, GOOD TO KNOW | Review/Status/Success open inside same 420px column |
| Desktop History | HistoryCard with filter pills + order cards + totals/status-means cards below | YOUR TOTALS, WHAT STATUSES MEAN, RECEIPTS | Same cards used on mobile but placed in right panel on desktop |

### Mobile History layout

Filter pills row (All / On its way / Paid) under the History title.
Order cards below.
Then below the list, two white gc-cards:
  - YOUR TOTALS (cost rows: Cash outs, G$ cashed out, Naira received so far)
  - WHAT THE STATUSES MEAN (numbered yellow circles)
No right panel on mobile.

---

## 4 · Dead Code (files left on disk, never rendered)

| File | Reason |
|---|---|
| apps/web/src/components/SuccessCard.tsx | Merged into CashOutTracker settled state; App.tsx no longer renders it |
| apps/web/src/components/Hero.tsx | Home screen is now ReadinessCard; Hero is not referenced in new layout |
| apps/web/src/components/OffRampCard.tsx | Fully replaced by CashOutTracker; App.tsx no longer renders it |

All three files stay on disk, unchanged. Listed here as dead code for the final report.

---

## 5 · Nav Tabs

Three tabs only: Home, Cash out, History.
Claim is NOT a nav tab. Claim card lives on Home screen.
(Part 5 "fourth nav item" from earlier prompt is explicitly excluded per user decision.)

---

## 6 · Part 5 Undrawn Screens

| Screen | Approach |
|---|---|
| Bank details | BankDetailsScreen: select+input+verified-name-card+checkbox+Save btn |
| Claim card on Home | ClaimCard restyled, TODAY'S CLAIM label, purple/disabled btn, unverified note |
| Finish payout | PendingPayoutCard restyled (note + Retry payout btn) |
| Price protection sheet | SlippageSheet: 1%/2%/3% gc-pill selector, bottom sheet on mobile |
| Loading skeleton | SkeletonCard with #ede6ff blocks |
| Error note | .gc-note class inline |
| MiniPay blocked | MiniPayNotice restyled: lilac bg, one gc-card, two buttons |
| Safety line | SafetyBanner restyled: white pill note, dismissible |
| Demo label | gc-pill next to logo only when isDemoMode |

---

## 7 · Bank Details Plan (pre-STEP 5, awaiting OK before coding)

State lives in: CashOutCard (for the main flow) and PendingPayoutCard
(for the retry flow). Both already use useBankAccountVerification from
useOffRamp.ts. After the redesign:

- BankDetailsScreen is a new component opened from the "Add ›" pill on
  Review. It receives (onSave, onCancel) callbacks.
- useBankAccountVerification (from lib/useOffRamp.ts) stays unchanged.
  Institution list fetched from ORDERS_API_BASE/institutions.
  Account name fetched from ORDERS_API_BASE/verify-account.
- State kept: institutionCode, accountIdentifier, accountName, confirmed.
  None of these go to localStorage.
- onSave(bankCode, bankName, accountNumber, accountHolderName) is called
  when confirmed=true and verificationStatus=verified.
- Review screen receives bank props from CashOutCard; passes them to
  ConfirmModal (unchanged signature).
- createPaycrestOrder receives institution code (not name) as before.

Existing tests affected:
- CashOutCard tests: "button disabled with empty bank fields" moves to
  the Confirm cash out button. Same cases: empty bank, 9-digit account,
  unverified name, unchecked box, whitespace. Test diff shown at STEP 5.
- App.test.tsx: bank field filling sequence may need selector update from
  old CashOutCard inputs to new BankDetailsScreen inputs.

Awaiting OK before coding.

---

## 8 · Mobile Keypad Contract

A real <input> with the same aria-label as today is kept, read-only,
inputMode="none" on mobile. Keypad buttons update the same state via the
same setter. Tests continue to type into the input. Keypad buttons each
have an aria-label ("Key 1", "Key 2", ..., "Decimal point", "Backspace").

---

## 9 · English String Changes

| Key | Old | New |
|---|---|---|
| balanceLabel | Your GoodDollar Balance | Your balance |
| readyToCashOut | Ready to cash out! | Cash out |
| (new) cashOutOpensAt | — | Cash out opens at N G$ |
| (new) youGiveLabel | — | You give |
| (new) youReceiveAbout | — | You receive about |
| (new) youGetAbout | — | You get about |
| (new) paidTo | — | Paid to |
| (new) goodDollarContrib | Exit contribution | GoodDollar contribution (10%) |
| (new) networkFee | — | Network fee (only if sourced) |
| slippageLabel | Slippage Tolerance | Price protection |
| (new) confirmBtn | Confirm | Confirm cash out |
| (new) reviewBtn | — | Review |
| (new) onItsWay | — | On its way |
| (new) backToHome | — | Back to home |
| (new) cashOutComplete | Cash-Out Swap Successful! | Cash out complete |
| (new) paidToYourBank | — | paid to your bank |
| Copy rule a | "licensed payout partner" | "payout partner" |
| Copy rule b | network fee shown always | only if sourced |

Non-English languages NOT updated. Fall back via translations[language] || translations.en.

---

## 10 · Allowed Test Label Changes

| Old text | New text |
|---|---|
| "Confirm" button | "Confirm cash out" |
| "Review cash out" button | "Review" |

No assertions deleted. No assertions weakened.

---

## 11 · Files That Will Change

| File | What changes |
|---|---|
| apps/web/index.html | Add Bricolage Grotesque + updated Inter link |
| apps/web/src/styles.css | New .gc design tokens layered over Tailwind |
| apps/web/src/App.tsx | .gc root wrapper div; layout only; no logic changes |
| apps/web/src/components/Navbar.tsx | Top bar + bottom pill nav, three tabs only |
| apps/web/src/components/ReadinessCard.tsx | Coin, sticker, progress bar, new labels |
| apps/web/src/components/ClaimCard.tsx | Restyle; embedded in Home |
| apps/web/src/components/CashOutCard.tsx | Mobile keypad + desktop typed input |
| apps/web/src/components/ConfirmModal.tsx | Full-screen Review; Price protection row tappable |
| apps/web/src/components/CashOutTracker.tsx | 4-step timeline, USDT-send expand, Success |
| apps/web/src/components/HistoryCard.tsx | Filter pills, order cards, totals cards |
| apps/web/src/components/MiniPayNotice.tsx | Restyle |
| apps/web/src/components/SafetyBanner.tsx | Restyle |
| apps/web/src/components/PendingPayoutCard.tsx | Restyle |
| apps/web/src/lib/i18n.ts | English strings per Section 9 |
| (new) apps/web/src/components/BankDetailsScreen.tsx | Bank picker, verify, confirm |
| (new) apps/web/src/components/SlippageSheet.tsx | 1%/2%/3% pill selector |

Files NOT touched: lib/*.ts (except i18n.ts string values), services/, packages/,
package.json, tsconfig*, eslint*, vite.config.ts, postcss.config.js, tailwind.config.js.
