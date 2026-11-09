# Changelog

All notable changes to `@goodcash/sdk`. This package follows [semantic versioning](https://semver.org).

## 0.2.0

Naira in (top-ups). Cash out is unchanged.

- `topUpQuote`, `createTopUp`, `getTopUp`, `listTopUps`, `watchTopUp`. Top-ups run on the hosted page; the customer's ID
  details are typed only there and never pass through your app or this package.
- Top-up webhook events `topup.paid_in`, `topup.delivered`, `topup.failed` (same signature check as cash outs).
- Live top-ups are switched on per partner by GoodCash; test mode needs no switch.

## 0.1.0 (unreleased)

First release.

- `GoodCash` client: `partner`, `limits`, `banks`, `verifyAccount`, `quote`, `networkFee`, `createCashOut`,
  `reportTransaction`, `getCashOut`, `listCashOuts`, `simulate` (test keys), `watchCashOut`.
- `cashOut()`: create, check, sign, report in one call, for EIP-1193 wallets, viem WalletClients and send functions.
- Safety check before signing (`assertSafeTransaction`), router pinned in the SDK.
- Lost wallet reply recovery: finds the payment on chain before reporting anything.
- `@goodcash/sdk/server`: `verifyWebhook` (HMAC-SHA256, 5-minute replay window).
