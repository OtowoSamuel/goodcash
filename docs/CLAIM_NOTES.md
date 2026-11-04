# Claim and identity SDK notes

Spike date: November 4, 2026
Packages installed in a throwaway directory:

- `@goodsdks/citizen-sdk@1.2.7`
- `@goodsdks/identity-sdk@1.0.5`

```bash
npm install @goodsdks/citizen-sdk @goodsdks/identity-sdk
```

## Which package to use

Use **`@goodsdks/citizen-sdk`**. Despite its README title ("GoodDollar Identity SDK"), it exports both the identity SDK and the claim SDK:

- `IdentitySDK`
- `ClaimSDK`
- `ClaimCustodialSDK`
- `checkGenericEntitlement`
- `checkGenericDailyStats`
- `ubiSchemeV2ABI`
- `identityV2ABI`
- `chainConfigs`
- `SupportedChains`

`@goodsdks/identity-sdk@1.0.5` is the older identity-only package. Its type definitions contain no claim or entitlement methods. Do not use it for claiming.

## Initialization

`ClaimSDK.init` takes the clients and an initialized `IdentitySDK`, but **not** an account. The account comes from the connected `walletClient`.

```ts
import { createPublicClient, createWalletClient, custom, http } from "viem";
import { IdentitySDK, ClaimSDK } from "@goodsdks/citizen-sdk";

const publicClient = createPublicClient({
  transport: http("https://forno.celo.org"),
});

const walletClient = createWalletClient({
  transport: custom(window.ethereum),
});

const identitySDK = await IdentitySDK.init({
  publicClient,
  walletClient,
  env: "production",
});

const claimSDK = await ClaimSDK.init({
  publicClient,
  walletClient,
  identitySDK,
  env: "production",
});
```

The wallet client must have a connected account before `IdentitySDK.init` or `ClaimSDK.init` is called. In MiniPay the account exists automatically, but the signing limitations below still apply.

## Verified Celo production addresses

From `chainConfigs[SupportedChains.CELO].contracts.production` in the package source:

| Contract | Address |
| --- | --- |
| Identity | `0xC361A6E67822a0EDc17D899227dd9FC50BD62F42` |
| UBI scheme | `0x43d72Ff17701B2DA814620735C39C620Ce0ea4A1` |
| Faucet | `0x4F93Fa058b03953C851eFaA2e4FC5C34afDFAb84` |
| G$ | `0x62B8B11039FcfE5aB0C56E502b1C372A3d2a9c7A` |

Read these from `chainConfigs` in code. Do not hardcode them; the SDK also supports Fuse and XDC and can fall back to another chain.

## API and return shapes

### `checkEntitlement(options?)`

```ts
const result = await claimSDK.checkEntitlement();
// {
//   amount: bigint,
//   altClaimAvailable: boolean,
//   altChainId: SupportedChains | null,
//   altAmount: bigint | null
// }
```

- Does **not** check whitelisting. It only checks the UBI entitlement.
- Returns `amount = 0n` if the user is not eligible or has already claimed.
- `altClaimAvailable` covers the SDK's Fuse/XDC fallback path. For a Celo-only product, ignore it or surface a deliberate "claim on another chain" option.

### `getWalletClaimStatus()`

```ts
const status = await claimSDK.getWalletClaimStatus();
// {
//   status: "not_whitelisted" | "can_claim" | "already_claimed",
//   entitlement: bigint,
//   nextClaimTime?: Date
// }
```

This is the best single call for the home screen: it combines whitelist state, entitlement and next claim time.

### `claim(txConfirm?)`

```ts
const receipt = await claimSDK.claim(async (message) => {
  // show a confirmation UI; return when the user approves
});
```

The SDK:

1. Checks whitelisting through `IdentitySDK`.
2. If not whitelisted, redirects to face verification and throws.
3. Checks entitlement.
4. Checks the user's balance and may trigger a faucet if the balance is too low.
5. Calls `claim()` on the UBI scheme and waits for the receipt.

Implication: `claim()` is not a pure transaction helper. It can redirect and it can request faucet funds. Wrap it in explicit pending / success / failure states and do not call it silently.

### `nextClaimTime()`

```ts
const next = await claimSDK.nextClaimTime();
// Date; epoch 0 / now if the user can claim immediately
```

### `getDailyStats()`

```ts
const { claimers, amount } = await claimSDK.getDailyStats();
// both bigint
```

### Disconnected / pre-connect reads

```ts
import { checkGenericEntitlement, checkGenericDailyStats, SupportedChains } from "@goodsdks/citizen-sdk";

const entitlement = await checkGenericEntitlement({
  publicClient,
  chainId: SupportedChains.CELO,
  env: "production",
});

const stats = await checkGenericDailyStats({
  publicClient,
  chainId: SupportedChains.CELO,
  env: "production",
});
```

Use these for a landing screen before a wallet is connected.

### Faucet helpers

- `triggerFaucet(txConfirm?)`
- `getFaucetParameters() -> { minTopping: number, toppingAmount: bigint }`
- `checkBalanceWithRetry(txConfirm?)`

The SDK already calls these inside `claim()` when the balance is low. Only call them directly if the UI needs a separate "top up for network fees" action.

## Constraints that affect the product

1. **The claim credits `msg.sender`.** The GoodCash router cannot claim on the user's behalf. Claim remains a separate user transaction. Do not try to batch it through the router.
2. **No batching assumption.** EIP-5792 batching is a progressive enhancement. MiniPay uses legacy transactions and does not support it.
3. **Identity verification uses message signing.** The SDK's face-verification flow uses the identity message (`FV_IDENTIFIER_MSG2`). MiniPay does not support `personal_sign` or `eth_signTypedData`, so verification inside MiniPay is expected to fail. This is another reason to scope MiniPay out for the G$ flow.
4. **The SDK needs a connected wallet client.** There is no read-only claim path through `ClaimSDK`; use the generic helpers for disconnected reads.
5. **`rdu` is optional.** It is the referral/data identifier parameter. Do not set it unless the referral program is defined.
6. **Chain fallback.** The SDK may report an alternative entitlement on Fuse or XDC. For MVP, Celo-only is simpler; if the UI shows the alternative, it must also explain that the swap and partner payout are Celo-only.

## Recommended integration for GoodCash

- Home screen: `getWalletClaimStatus()` (or `checkGenericEntitlement` before connect).
- Claim button: enabled only for `can_claim`.
- Not verified: explain the GoodDollar face-verification path and link out; do not call `claim()` and let it redirect unexpectedly.
- Already claimed: show `nextClaimTime` and the updated balance.
- After claim: refresh balance and the days-to-cash-out meter.
- Never claim through the router.
- Do not use this flow inside MiniPay; see `MINIPAY_NOTES.md`.

## Verification performed

- Installed both packages and read the exported type definitions and READMEs.
- Confirmed `ClaimSDK` is exported from `@goodsdks/citizen-sdk@1.2.7`.
- Confirmed `@goodsdks/identity-sdk@1.0.5` has no claim methods.
- Confirmed Celo production identity/UBI/faucet/G$ addresses from the compiled `chainConfigs`.
- Did **not** send a claim transaction; that requires a verified test wallet and gas.
