# GoodCashRouter — Contract Reference

Version: 1.0 (Prompt 3) | November 4, 2026

---

## Overview

`GoodCashRouter` is a non-custodial swap router that converts G$ (GoodDollar) to USDm or USDT using two whitelisted venues:

1. **GoodDollar Reserve** (via the Broker proxy) — preferred route.
2. **Uniswap V3 SwapRouter02** — fallback when the Reserve is paused or at limit.

The router **never holds user funds** between transactions. Every code path either completes in full or reverts entirely. Residual balance after a successful call is an invariant violation and causes a revert via `_assertZeroBalance`.

---

## Deployed Addresses (Celo mainnet)

| Contract | Address |
|---|---|
| `GoodCashRouter` | `0xA4338586d4B2f0E1641C54b8cF0d53CD06B5c407` |
| G$ | `0x62B8B11039FcfE5aB0C56E502b1C372A3d2a9c7A` |
| USDm (cUSD) | `0x765DE816845861e75A25fCA122bb6898B8B1282a` |
| USDT | `0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e` |
| GoodDollar Broker | `0x88de45906D4F5a57315c133620cfa484cB297541` |
| Exchange Provider | `0x2fFBB49055d487DdBBb0C052Cd7c2a02A7971e41` |
| G$/USDm exchangeId | `0xba77f5c7bb3317643c6d81d1ef3f9913561741d92095f88efa402faf2cbe9124` |
| Uniswap SwapRouter02 | `0x5615CDAb10dc425a742d643d949a7F474C01abc4` |
| G$/USDm Uniswap Pool | `0x9491d57c5687AB75726423B55AC2d87D1cDa2c3F` (fee tier 10000 = 1%) |
| USDm/USDT Uniswap Pool | `0x5dC631aD6C26BEA1a59fBF2C2680CF3df43d249f` (fee tier 100 = 0.01%) |
| Owner (Safe/Admin) | `0xafDeEbB89Cda1669361117eA2EAe3411F1228cb6` |

---

## Routes

The `Route` enum defines the four allowed swap paths:

| Route | Path | Output token | Notes |
|---|---|---|---|
| `RESERVE_TO_USDM` | G$ → Reserve → USDm | USDm | Preferred. 10% exit contribution deducted by protocol. |
| `UNISWAP_TO_USDM` | G$ → Uniswap V3 → USDm | USDm | Fallback when Reserve is paused/at limit. Pool is thin (~$1,450 TVL). |
| `RESERVE_THEN_UNISWAP` | G$ → Reserve → USDm → Uniswap V3 → USDT | USDT | Full cash-out path via Reserve. |
| `UNISWAP_THEN_UNISWAP` | G$ → Uniswap V3 → USDm → Uniswap V3 → USDT | USDT | Full cash-out via Uniswap only. |

> **Important:** The USDm → USDT leg uses fee tier `100` (0.01%), matching `USDM_USDT_FEE` in the router and the pool listed above. If the pool does not exist at this tier, the transaction will revert.

---

## Quote Formula

### Reserve route (G$ → USDm)

The GoodDollar Reserve applies a 10% exit contribution on G$ → USDm swaps. This is a protocol-level fee, **not a GoodCash fee**.

```
grossUsdm = ExchangeProvider.getAmountOut(exchangeId, G$_addr, USDm_addr, amountIn)
// The Reserve computes: netUsdm = grossUsdm * (1 - exitContributionBps / 1e8)
// exitContributionBps = 10,000,000 / 1e8 = 10%
netUsdm = grossUsdm * 0.9
```

**Verified output at current on-chain state (block ~day 1344):**

| Input (G$) | Gross USDm | Net USDm (after 10% exit) | Net price |
|---|---|---|---|
| 1,000 | ~0.1266 USDm | 0.113992939… USDm | $0.000113992939/G$ |
| 10,000 | ~1.2666 USDm | 1.139928040… USDm | $0.000113992804/G$ |

> Source: `docs/VERIFY_OUTPUT.txt` — diff from expected net: **0.000%** (pass).

### Uniswap route (G$ → USDm)

Uses `exactInputSingle` on the G$/USDm Uniswap V3 pool (fee tier 10000 = 1%).

```
Implied Uniswap price at verification: $0.000113135376/G$
(slightly worse than Reserve due to fee + pool shape)
```

The pool holds ~8.37M G$ and ~498 USDm (~$1,450 TVL). A swap of 1,000 G$ is ~0.014% of pool depth — small but non-trivial. A swap of 10,000 G$ is ~0.14%. The UI must enforce a 10% price-impact cap and check pool depth (at least 10× the swap size).

### Price impact

```
priceImpactBps = abs(executionPrice - marketPrice) / marketPrice * 10_000
```

The UI (not the contract) is responsible for computing and displaying price impact before confirming the swap. The contract enforces only `minAmountOut`.

---

## Invariants

1. **Zero balance:** `GoodCashRouter` holds zero balance of G$, USDm, and USDT after every successful `cashOut` call. Enforced on-chain via `_assertZeroBalance`.
2. **No arbitrary calls:** Only `IBroker.swapIn` and `ISwapRouter02.exactInputSingle` are ever called. No `call`/`delegatecall` with caller-supplied calldata.
3. **Exact approvals:** Approvals to external contracts are set to exactly `amountIn` before each hop and reset to zero after. No infinity approvals.
4. **Output allowlist:** The output token must be in the `allowedOutputs` mapping (initially USDm and USDT).
5. **Reentrancy guard:** `cashOut` uses OpenZeppelin `ReentrancyGuard`.
6. **Pausable:** When paused, `cashOut` reverts. Only the Safe owner can pause/unpause.

---

## Privileged Functions

| Function | Who | Notes |
|---|---|---|
| `pause()` | Owner only | Emergency stop. Prevents all swaps. |
| `unpause()` | Owner only | Re-enables swaps. Contract starts paused at deploy. |
| `setAllowedOutput(address, bool)` | Owner only | Add/remove output tokens. |
| `setFeeBps(uint256)` | Owner only | Set protocol fee. Max 100 bps (1%). 0 in MVP. |
| `rescue(address, address, uint256)` | Owner only | Move stuck tokens. Cannot run while paused. |

---

## Known Risks

| Risk | Severity | Mitigation |
|---|---|---|
| **Thin G$/USDm Uniswap pool** (~$1,450 TVL) | High | UI enforces 10% price-impact cap and 10× depth check. Reserve is preferred. |
| **GoodDollar Reserve pause** | Medium | Uniswap fallback routes available. Pause button on router. |
| **10% exit contribution** | Informational | Displayed explicitly in UI. Never labelled as a GoodCash fee. |
| **USDm/USDT pool fee tier** | Informational | The router uses `USDM_USDT_FEE = 100` (0.01%), matching the canonical Celo stablecoin pool above. |
| **Oracle dependency** | Low | The Reserve uses its own AMM formula; no external price feed. Uniswap is TWAP-less (spot). Deadline and minAmountOut protect against sandwich attacks. |
| **September 2026 GoodDollar exploit** | Historical | Acknowledged. The Reserve has been re-deployed and the exchange ID re-verified. Users should check the Dune dashboard for anomalous activity. |
| **Legacy tx only on Celo** | Informational | Celo does not support EIP-1559 `maxFeePerGas`/`maxPriorityFeePerGas` from non-Celo wallets. Use `gasPrice` instead. Handled in the PWA gas config. |

---

## Deployment Commands (Prompt 4 reference)

```bash
cd packages/contracts
forge build
forge test -vvv
forge coverage

# Deploy (do NOT run until Prompt 4 gate):
# forge script script/Deploy.s.sol --rpc-url $CELO_RPC_URL --broadcast --verify
```

---

## Test Coverage Summary

| Category | Tests |
|---|---|
| Unit — all 4 routes | ✅ |
| 10% exit contribution accounting | ✅ |
| Approval reset after each hop | ✅ |
| CashOut event emission | ✅ |
| Revert: zero amount/min/recipient | ✅ |
| Revert: deadline expired | ✅ |
| Revert: output below min | ✅ |
| Revert: paused | ✅ |
| Revert: broker fails (Reserve paused simulation) | ✅ |
| Access control: all 5 owner-only functions | ✅ |
| Fuzz: amountIn × 500 runs | ✅ |
| Fuzz: minAmountOut × 500 runs | ✅ |
| Fuzz: all routes × random amounts | ✅ |
| Invariant: zero balance after every call | ✅ |
| Fork: Reserve route 1,000 G$ → USDm | ✅ |
| Fork: Reserve route 10,000 G$ → USDm | ✅ |
| Fork: Uniswap route 1,000 G$ → USDm | ✅ |
| Fork: invariant after real swap | ✅ |
