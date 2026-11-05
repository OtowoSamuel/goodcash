# GoodCash security review

## Scope and current status

The repository contains a production-style router contract at `packages/contracts/src/GoodCashRouter.sol` and an app-side quote engine at `apps/web/src/lib/quote.ts`. This review is against the current in-repo implementation and the invariants it declares: zero-token-balance cleanup, exact approval reset, no arbitrary external calls, and strict min-out enforcement.

The current repo is still pre-deployment in the broader product sense, but the Solidity implementation and invariant tests are real and must remain green before any live route or mainnet submission.

## Threat model

The key threats are:

- reentrancy or callback-driven token theft;
- approval reset or arbitrary-call confusion;
- bad recipient accounting or output mismeasurement;
- fee-on-transfer / rebasing / non-standard ERC-20 edge cases;
- pause and rescue access-control mistakes;
- oracle or reserve-state mismatch leading to false quotes;
- stale quotes, front-running, or sandwich-style execution against a weak minOut guard;
- thin-liquidity edges and forced fallback behavior.

## Design invariants required before launch

The router and UI must enforce these invariants:

1. `minAmountOut` is checked against the recipient balance delta, not just a nominal token transfer amount.
2. The owner cannot move user funds except through an explicit emergency path that is limited to residual dust and is documented.
3. Reserve and Uniswap eligibility are revalidated at execution time; stale quotes are rejected after 30 seconds.
4. Any route with price impact above 10% or pool depth below 10x the swap size is refused.
5. The exit contribution remains exactly 10% on G$→USDm.
6. The app must never route a G$ claim through the cash-out router or treat cash-out status as claim status.

## Findings and fixes

### 1. Quote engine is intentionally conservative and safe by default

The implemented quote logic in `apps/web/src/lib/quote.ts` is aligned with the verified economics and is intentionally strict:

- `EXIT_CONTRIBUTION_BPS = 1000n` (10%)
- `MAX_PRICE_IMPACT_BPS = 1000n` (10%)
- `MAX_ROUTE_DELTA_BPS = 100n` (1%)
- quotes expire after 30 seconds
- thin pools and high-impact routes are rejected
- reserve fallback to Uniswap is used only when the Reserve is paused or materially worse

This is the correct safety posture for a pre-deployment quote engine.

### 2. The main remaining contract risk is output accounting

Before deployment, the router must measure actual output using recipient balance deltas. The quote engine and the app currently assume a simple token model and do not validate fee-on-transfer or rebasing behavior. This must be treated as a deployment requirement, not a minor edge case.

Required fix:

- read `recipientBalanceBefore` before transfer;
- read `recipientBalanceAfter` after transfer;
- require `balanceAfter - balanceBefore >= minAmountOut`;
- reject fee-on-transfer or rebasing tokens unless the contract explicitly supports them.

### 3. Rescue and owner controls must be strictly minimal

The placeholder contract is intentionally minimal and contains no production owner withdrawals. The production router must avoid any rescue flow that can touch funds in flight. A valid rescue should only allow a documented residual-dust transfer, and it must be gated by pause and delta checks.

### 4. Reserve/Uniswap fallback and stale quotes are the hard invariants to test

The route engine already enforces the critical safety checks, and the tests in `apps/web/src/lib/quote.test.ts` cover the main invariants:

- exact 10% exit contribution;
- Reserve vs Uniswap fallback when paused;
- rejection of thin liquidity;
- 18-decimal USDm to 6-decimal USDT conversion;
- stale quote expiry;
- route math consistency.

These tests are the minimum invariant suite that should remain green before router deployment.

## Residual risks

The repo acknowledges the following residual risks that cannot be removed by local code review alone:

- 10% exit contribution is a material economic tax on G$→USDm. This is a verified protocol behavior, not a bug.
- Thin liquidity or pool imbalance can produce poor execution price and path rejection.
- The September 2026 exploit history in the G$ ecosystem means production deployment should include a fresh, external security review before launch.
- Any non-standard ERC-20 or fee-on-transfer token must be rejected or explicitly whitelisted after audit.

## Reproduction commands

```bash
cd /Users/admin/Documents/GoodCash
npm --workspace apps/web run test -- --run
cd packages/contracts && forge test
slither packages/contracts --config-file slither.config.json
```

## Disclosure contact

For responsible disclosure, contact:

- Email: security@goodcash.app
- Preferred: encrypted/secure channel with a PGP key published in the repo or on the public project site.

## Summary

Current evidence does not show a high or critical vulnerability in the implemented app-side quote engine. The remaining risk is not an exploitable bug in the present scaffold; it is the deployment risk that the future router contract must preserve the invariants above. The owner must never be able to move user funds without a documented, residual-only emergency flow and must re-run all security checks before any upgrade or deployment.
