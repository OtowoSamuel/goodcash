# Verification spike: GO / NO-GO

Date: November 4, 2026
Scope: Prompt 1 of `PROMPT_PACK.md`. No product code, no deployment, no Paycrest order.

## Result

**GO for the contract and PWA build, with conditions.**
**NO-GO for the original weekly-cash-out premise, the "no KYC" claim, and a MiniPay Mini App listing.**

## Checks that passed

| Check | Result |
| --- | --- |
| G$, USDm, USDT, USDC, NGNm addresses and decimals | Confirmed on-chain |
| GoodDollar Broker, Exchange Provider, exchangeId, Reserve | Confirmed; addresses and roles match |
| Exit contribution | **10%** (10,000,000 / 1e8) |
| Gross G$ price | $0.000126658838/G$ |
| Net G$ → USDm price | $0.000113992939/G$ |
| Quote consistency | Net = gross × 0.9, diff 0.000% |
| UBI per eligible user | 123.487460819 G$/day |
| Daily stats | ~5,105 claimers at run time; count rises during the day |
| Uniswap G$/USDm pool | 1% fee, ~$1,446 TVL, implied $0.00011314/G$ |
| Claim SDK | `ClaimSDK` exists in `@goodsdks/citizen-sdk@1.2.7`; `identity-sdk@1.0.5` has no claim methods |
| Paycrest Celo support | USDT, USDC, cNGN; NGN bank/mobile |
| Paycrest minimum | $0.50 on most chains; Celo not separately stated |
| Paycrest off-ramp KYC | `source.kyc` optional in the API; sender KYB required |
| MiniPay supported tokens | USDT, USDC, USDm only; G$ is not supported |

## Corrections to PRD v0.2

1. **Claimers:** "about 5,065" → **"about 5,100 at verification time; rises during the day."**
2. **Paycrest KYC:** the API does not force off-ramp customer KYC (`source.kyc` is optional). GoodCash still needs KYB as a sender and local legal review. Soften "senders own customer KYC" to "senders own local obligations; off-ramp customer KYC is optional in the API but may be required by law."
3. **Paycrest Celo:** add USDT 6 decimals, USDC 6, cNGN 6 at `0xF6829D7393dAe24509eb1E52eE8e572e2E271a4f`; NGN bank/mobile.
4. **Paycrest minimum:** "$0.50 (testing)" → **"$0.50 on most chains; confirm Celo with support; some networks enforce 1 unit."**
5. **MiniPay:** strengthen from "not native / conditional" to **"not listable for the G$ flow"**. MiniPay explicitly limits tokens to USDT/USDC/USDm and prohibits arbitrary ERC-20s in a Mini App. Ship a PWA; do not apply for listing in Season 5.
6. **Countdown:** 30-day net is **$0.422**, not $0.427; $1.00 takes **71 days**, not 72.
7. **Season base:** 3M G$ is ~**$342 net**; 300 daily claimers for 84 days is ~3.11M G$ (~$355 net). 10M G$ requires ~1,000 daily claimers.

## Stop-condition review

| Stop condition | Status |
| --- | --- |
| Exit contribution is not 10% | **Pass** — it is exactly 10% |
| Net quote differs >5% from $0.00011399/G$ | **Pass** — diff is 0.000% |
| Celo partner minimum >$1.00 | **Unresolved, not violated** — docs say $0.50; confirm Celo |
| Paycrest requires GoodCash to KYC every user | **Not required by the API** for off-ramp; sender KYB required; legal review remains |
| MiniPay cannot hold/receive G$ and no browser path | **MiniPay cannot hold G$**; a browser/external-wallet path exists. Scope MiniPay out, proceed |
| Real swap output >2% below quote | Not tested yet; Prompt 4 gate |
| Router cannot end with zero balance | Not built yet; Prompt 3 invariant |
| Owner cannot pause reliably | Not built yet; Prompt 4 gate |
| High/critical security finding with no fix | Not reviewed yet; Prompt 11 gate |

## What this means

- The contract and PWA can be built. The Reserve route is real, deep enough for the target sizes, and costs exactly 10% on exit.
- The product must be sold as **accumulate, then cash out**. A new daily claimer needs ~36 days to reach the $0.50 minimum. Do not build a "cash out now" CTA for new users.
- MiniPay is not a viable distribution channel for a G$ app. The PWA should target mobile browsers and wallets that hold G$.
- GoodCash can likely be a Paycrest sender without collecting customer KYC on every off-ramp, but that is a legal conclusion, not an API fact. Do not launch the off-ramp before counsel signs off.
- The unit economics are tiny at current UBI: ~$342–355 net for a 300-daily-claimer season. Report USD alongside G$, and treat Season 5 as a pilot.

## Next steps

1. Scaffold the repo (Prompt 2).
2. Build the router with the Reserve route first and the Uniswap fallback second (Prompt 3).
3. Do not deploy to mainnet until the Prompt 4 gate: fork tests, a small real swap, Safe owner, pause tested.
4. In parallel, start Paycrest KYB and the legal review, and ask Paycrest support to confirm the Celo minimum and NGN liquidity at $0.50–$5.
5. Do not apply to MiniPay. If MiniPay distribution becomes mandatory, scope a separate USDT-only product and confirm the provider-withdrawal rule first.
