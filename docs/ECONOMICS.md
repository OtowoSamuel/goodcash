# Economics check

Spike date: November 4, 2026
Source data: `docs/VERIFY_OUTPUT.txt`, `script/verify.sh`, Paycrest docs.

## Inputs

| Input | Value | Source |
| --- | --- | --- |
| Gross G$ price | $0.000126658838/G$ | Mento `currentPrice(exchangeId)` |
| Net G$ price (after 10% exit) | $0.000113992939/G$ | `getAmountOut(exchangeId, G$, USDm, 1000e18)` |
| Daily UBI per eligible user | 123.487460819 G$ | `UBISchemeV2.dailyUbi()` |
| Exit contribution | 10% | exchange tuple `exitContribution = 10,000,000 / 1e8` |
| Paycrest minimum | $0.50 | Paycrest docs ("$0.50 on most chains") |
| Reserve balance | 259,721.90 USDm | exchange tuple |
| G$ supply | 5,129,947,074.39 G$ | exchange tuple |
| G$/USDm Uniswap pool | ~$1,446 TVL | pool balances at run time |
| DEX implied price | $0.00011314/G$ | Uniswap `slot0` |

## Per-user value

| Period | G$ | Gross USD | Net USD (after 10%) |
| --- | ---: | ---: | ---: |
| 1 day | 123.49 | $0.01564 | $0.01408 |
| 7 days | 864.41 | $0.10949 | $0.09854 |
| 30 days | 3,704.62 | $0.46922 | $0.42230 |
| 84 days (season) | 10,372.95 | $1.31383 | $1.18244 |

## Days to reach a cash-out threshold

At 123.49 G$/day and the net price:

| Target | G$ needed | Days | Weeks |
| --- | ---: | ---: | ---: |
| $0.50 (Paycrest minimum) | 4,386.24 | 35.5 | 5.1 |
| $1.00 | 8,772.47 | 71.0 | 10.1 |
| $5.00 | 43,862.37 | 355.2 | 50.7 |
| $10.00 | 87,724.73 | 710.4 | 101.5 |

This is the central product constraint. A new daily claimer cannot cash out in the first month. The app must show the ETA and make accumulation the habit.

## Season volume scenarios

Assumes every active user claims every day for 84 days and routes all G$ through GoodCash. This is an upper bound; real users will miss days.

| Daily claimers | G$ routed | Gross USD | Net USD |
| ---: | ---: | ---: | ---: |
| 290 | 3,008,155 | $381.01 | $342.91 |
| 300 | 3,111,884 | $394.15 | $354.73 |
| 1,000 | 10,372,947 | $1,313.83 | $1,182.44 |

The PRD's 3M G$ base target is consistent with ~290 daily claimers. The 10M G$ stretch requires ~1,000 daily claimers, or a smaller number of users with large existing balances. It is not reachable with 300 weekly actives who only cash out weekly.

## Route economics

| Route | Cost | Net price | Notes |
| --- | --- | ---: | --- |
| Reserve G$ -> USDm | 10% exit contribution + gas | $0.000113993 | Deep; 259,722 USDm reserve; primary route |
| Uniswap G$/USDm 1% | ~1% pool fee + price impact + gas | $0.00011314 implied | ~$1,446 TVL; thin; fallback only |
| USDm -> USDT | second pool fee + gas | market | Needed because Paycrest supports USDT/USDC/cNGN, not USDm |

The Reserve net price is about **0.75% better** than the DEX implied price at the time of the run, and it is far deeper. The DEX is a liveness fallback, not a cheaper route.

The 10% exit contribution is not a GoodCash fee. It is the protocol's cost of redeeming G$ from the Reserve. It must be shown separately.

## Cost as a share of a cash-out

For a $0.50 minimum cash-out on the Reserve route:

- 10% exit contribution: $0.050
- USDm -> USDT swap: roughly 0.01–0.3% depending on venue and size
- Celo network fees: cents or less
- Paycrest transaction fee: returned in `providerAccount.amountToTransfer`; small at this size

The dominant cost is the 10% exit contribution. A 13% cost target is plausible; a 5% target is not, unless the user uses a route that avoids the Reserve, which the thin DEX cannot support at scale.

## What the numbers mean for the product

1. **Do not promise weekly cash-outs.** A first cash-out takes ~5 weeks of daily claims.
2. **Do not promise "cash out in 3 minutes" for new users.** That applies only to the swap-and-handoff step once the balance clears the minimum.
3. **The readiness meter is the core retention feature.** It converts a tiny daily amount into a visible countdown.
4. **Target existing holders.** A user with 50,000 G$ can cash out immediately; a new claimer cannot. Both are valid segments, but they need different onboarding.
5. **Report USD, not just G$.** 10M G$ sounds large but is about $1,140 net. GoodBuilders reviewers will notice if the report implies otherwise.
6. **Community claim days are more useful than pooled custody.** Pooling funds creates custody and trust problems; a shared claim day and a shared explainer do not.

## What would change the conclusion

- A higher daily UBI (for example, a protocol change that doubles or triples it).
- A partner minimum below $0.10.
- A subsidy that covers the 10% exit contribution or the gas for small cash-outs.
- A liquid G$ -> cNGN or G$ -> USDT route that avoids the Reserve without the 10% cost.
- A large cohort of existing G$ holders who already have balances above the minimum.

Until one of these is true, the product is an accumulation-and-conversion tool, not a weekly payout tool.
