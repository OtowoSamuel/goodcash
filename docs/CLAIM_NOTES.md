# GoodDollar claim notes

This project integrates the GoodDollar claim flow without routing the claim through the router or swap contract. The router is only responsible for cash-out after the user has already claimed G$ into their wallet.

## SDK facts

The app uses the GoodDollar SDKs verified in the repo spike:

- `@goodsdks/citizen-sdk` version `^1.2.7`
- `@goodsdks/identity-sdk` version `^1.0.5`

The relevant SDK calls are:

- `IdentitySDK.getWhitelistedRoot(address)`
- `IdentitySDK.generateFVLink(false, callbackUrl, chainId)`
- `ClaimSDK.getWalletClaimStatus()`
- `ClaimSDK.checkEntitlement()`
- `ClaimSDK.nextClaimTime()`
- `ClaimSDK.claim()`

## Why the claim is not batched into the router

The GoodDollar claim credits `msg.sender` directly. The claim flow therefore has to be sent from the user wallet, not from a router contract or shared wallet. This is why the cash-out router performs a separate swap only after the user already holds the G$ in their own address.

## Verification path

If `getWhitelistedRoot()` returns `isWhitelisted === false`, the UI must show a verification card with a GoodDollar face-verification link and not present a broken claim button.

## MiniPay limitation

MiniPay cannot hold or support G$, and the claim flow is disabled there. There is no batching or contract-address abstraction that can make G$ claims work inside a MiniPay wallet because the wallet itself cannot hold G$ and MiniPay does not support the required flow.

## Mainnet safety

- Never ask for a seed phrase.
- Never put a Paycrest key or private key in the frontend.
- Always surface the actual claim failure reason to the user instead of hiding it.
