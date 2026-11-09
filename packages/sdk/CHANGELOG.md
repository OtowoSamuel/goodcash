# Changelog

All notable changes to `@goodcash/sdk`. This package follows [semantic versioning](https://semver.org).

## 0.1.0 (unreleased)

First release.

- `GoodCash` client: `partner`, `limits`, `banks`, `verifyAccount`, `quote`, `networkFee`, `createCashOut`,
  `reportTransaction`, `getCashOut`, `listCashOuts`, `simulate` (test keys), `watchCashOut`.
- `cashOut()`: create, check, sign, report in one call, for EIP-1193 wallets, viem WalletClients and send functions.
- Safety check before signing (`assertSafeTransaction`), router pinned in the SDK.
- Lost wallet reply recovery: finds the payment on chain before reporting anything.
- `@goodcash/sdk/server`: `verifyWebhook` (HMAC-SHA256, 5-minute replay window).
