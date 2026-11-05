# GoodCash Deployment Record

**Network:** Celo Mainnet (Chain ID: `42220`)  
**Deployment Date:** November 4, 2026  
**Status:** Verified, Paused, Test Swap Completed Successfully

---

## 1. Core Addresses

| Component | Contract Address | Explorer Link | Notes |
|---|---|---|---|
| **GoodCashRouter** | `0xA4338586d4B2f0E1641C54b8cF0d53CD06B5c407` | [Blockscout](https://celo.blockscout.com/address/0xa4338586d4b2f0e1641c54b8cf0d53cd06b5c407) / [Celoscan](https://celoscan.io/address/0xa4338586d4b2f0e1641c54b8cf0d53cd06b5c407) | Verified source code |
| **Owner / Admin** | `0xafDeEbB89Cda1669361117eA2EAe3411F1228cb6` | [Blockscout](https://celo.blockscout.com/address/0xafDeEbB89Cda1669361117eA2EAe3411F1228cb6) | Safe / Admin multisig |
| **G$ (GoodDollar)** | `0x62B8B11039FcfE5aB0C56E502b1C372A3d2a9c7A` | [Blockscout](https://celo.blockscout.com/token/0x62b8b11039fcfe5ab0c56e502b1c372a3d2a9c7a) | 18 decimals |
| **USDm (cUSD)** | `0x765DE816845861e75A25fCA122bb6898B8B1282a` | [Blockscout](https://celo.blockscout.com/token/0x765de816845861e75a25fca122bb6898b8b1282a) | 18 decimals |
| **USDT** | `0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e` | [Blockscout](https://celo.blockscout.com/token/0x48065fbbe25f71c9282ddf5e1cd6d6a887483d5e) | 6 decimals |
| **GoodDollar Broker** | `0x88de45906D4F5a57315c133620cfa484cB297541` | [Blockscout](https://celo.blockscout.com/address/0x88de45906D4F5a57315c133620cfa484cB297541) | Reserve proxy |
| **Exchange Provider** | `0x2fFBB49055d487DdBBb0C052Cd7c2a02A7971e41` | [Blockscout](https://celo.blockscout.com/address/0x2fFBB49055d487DdBBb0C052Cd7c2a02A7971e41) | Mento exchange provider |
| **G$/USDm Exchange ID** | `0xba77f5c7bb3317643c6d81d1ef3f9913561741d92095f88efa402faf2cbe9124` | — | Constant |
| **Uniswap SwapRouter02** | `0x5615CDAb10dc425a742d643d949a7F474C01abc4` | [Blockscout](https://celo.blockscout.com/address/0x5615CDAb10dc425a742d643d949a7F474C01abc4) | Universal router |
| **Uniswap USDm/USDT Pool** | `0x5dC631aD6C26BEA1a59fBF2C2680CF3df43d249f` | [Blockscout](https://celo.blockscout.com/address/0x5dC631aD6C26BEA1a59fBF2C2680CF3df43d249f) | Fee tier 100 (0.01%), >$597k USDT TVL |

---

## 2. On-Chain State & Verification

All on-chain checks confirmed:
- `OWNER()` = `0xafDeEbB89Cda1669361117eA2EAe3411F1228cb6`
- `paused()` = `true` (enforced at deploy, unpaused for test swap, re-paused immediately after)
- `G_DOLLAR()` = `0x62B8B11039FcfE5aB0C56E502b1C372A3d2a9c7A`
- `USDM()` = `0x765DE816845861e75A25fCA122bb6898B8B1282a`
- `USDT()` = `0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e`
- `BROKER()` = `0x88de45906D4F5a57315c133620cfa484cB297541`
- `EXCHANGE_PROVIDER()` = `0x2fFBB49055d487DdBBb0C052Cd7c2a02A7971e41`
- `EXCHANGE_ID()` = `0xba77f5c7bb3317643c6d81d1ef3f9913561741d92095f88efa402faf2cbe9124`
- `UNISWAP_ROUTER()` = `0x5615CDAb10dc425a742d643d949a7F474C01abc4`
- `USDM_USDT_FEE` = `100` (0.01%)
- Post-swap token balances on router:
  - `G$` balance: `0`
  - `USDm` balance: `0`
  - `USDT` balance: `0`

---

## 3. Deployment Transactions

### Deployment
- **Tx Hash:** [`0x50c49b07c036fb72ad1aef8496c36a887038ad9a5c2ea3a800f4293964da4e9a`](https://celo.blockscout.com/tx/0x50c49b07c036fb72ad1aef8496c36a887038ad9a5c2ea3a800f4293964da4e9a)
- **Contract Created:** `0xA4338586d4B2f0E1641C54b8cF0d53CD06B5c407`
- **Gas Used:** 1,719,359 gas (~0.348 CELO)
- **Status:** Success (Block `81917173`)

### Contract Verification
- **Verifier:** Blockscout API
- **Status:** `Pass - Verified`
- **GUID:** `a4338586d4b2f0e1641c54b8cf0d53cd06b5c4076aeb7d9c`
- **URL:** [https://celo.blockscout.com/address/0xa4338586d4b2f0e1641c54b8cf0d53cd06b5c407](https://celo.blockscout.com/address/0xa4338586d4b2f0e1641c54b8cf0d53cd06b5c407)

### Unpause for Test Swap
- **Tx Hash:** [`0xa46958502452f1f1189e745fd468d02a11671aff178686a2ecc65d3886dfc486`](https://celo.blockscout.com/tx/0xa46958502452f1f1189e745fd468d02a11671aff178686a2ecc65d3886dfc486)
- **Action:** `unpause()` by owner `0xafDeEbB89Cda1669361117eA2EAe3411F1228cb6`
- **Status:** Success (Block `81917357`)

### Real Test Swap (1,000 G$ → USDT via RESERVE_THEN_UNISWAP)
- **G$ Approval Tx:** [`0xfc371981915a29febb29e89379b0ef6b2b5ed1532ca709a0084fa4a61ddfda1d`](https://celo.blockscout.com/tx/0xfc371981915a29febb29e89379b0ef6b2b5ed1532ca709a0084fa4a61ddfda1d)
- **CashOut Swap Tx:** [`0x1f73b2d4af5cd391f0eb1d319f262a1cad73a47ade16f03612eea89948b5e705`](https://celo.blockscout.com/tx/0x1f73b2d4af5cd391f0eb1d319f262a1cad73a47ade16f03612eea89948b5e705)
- **Route:** `Route.RESERVE_THEN_UNISWAP` (Hop 1: Reserve G$→USDm; Hop 2: Uniswap V3 USDm→USDT at fee 100)
- **Amount In:** `1,000.0 G$`
- **Amount Out Received:** `114,107 wei` = **`0.114107 USDT`**
- **Expected Net Quote:** `0.113992 USDT`
- **Difference from Quoted Net:** **+0.10%** (Well within the 2% tolerance threshold)
- **Router Residual Balances:** All 0 (`G$=0`, `USDm=0`, `USDT=0`)
- **Status:** Success (Block `81917482`)

### Re-Pause
- **Tx Hash:** [`0xaf532b565da418bcb5b13ca67f70ed9c63d288aaa3c3124fbbb8a0f7113e69ab`](https://celo.blockscout.com/tx/0xaf532b565da418bcb5b13ca67f70ed9c63d288aaa3c3124fbbb8a0f7113e69ab)
- **Action:** `pause()` by owner `0xafDeEbB89Cda1669361117eA2EAe3411F1228cb6`
- **Final State:** Contract is safely **PAUSED** pending production launch.

---

## 4. Commands to Reproduce Verification

### Query Contract State
```bash
# Check owner
cast call 0xA4338586d4B2f0E1641C54b8cF0d53CD06B5c407 "OWNER()(address)" --rpc-url https://forno.celo.org

# Check paused status (returns true)
cast call 0xA4338586d4B2f0E1641C54b8cF0d53CD06B5c407 "paused()(bool)" --rpc-url https://forno.celo.org

# Check router token balances (all return 0)
cast call 0x62B8B11039FcfE5aB0C56E502b1C372A3d2a9c7A "balanceOf(address)(uint256)" 0xA4338586d4B2f0E1641C54b8cF0d53CD06B5c407 --rpc-url https://forno.celo.org
cast call 0x765DE816845861e75A25fCA122bb6898B8B1282a "balanceOf(address)(uint256)" 0xA4338586d4B2f0E1641C54b8cF0d53CD06B5c407 --rpc-url https://forno.celo.org
cast call 0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e "balanceOf(address)(uint256)" 0xA4338586d4B2f0E1641C54b8cF0d53CD06B5c407 --rpc-url https://forno.celo.org
```

### Full Test Suite Run
```bash
cd packages/contracts
forge test -vvv
```
