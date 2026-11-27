# Changelog

## 0.2.1

- `<CashOutFlow />` shows the wallet's G$ balance on the amount step with a "Use all" link, and will not go on when the
  amount is more than the wallet holds. New hook `useBalance(wallet)`. Requires `@goodcash/sdk` 0.2.2.

- `<TopUpButton />` takes `wallet`, `signer` and `signTypedData`: an app that already has the customer's wallet can sign the
  one top-up approval itself, so the customer is not asked to connect a wallet a second time. `signTypedData` also receives
  `{ orderId, maxUsdc, wallet }` so it can refuse any amount above the order's maximum.

## 0.2.0

- `<TopUpButton />`: opens the hosted "add G$ or CELO with naira" flow. Requires `@goodcash/sdk` 0.2.0.

## 0.1.0 (unreleased)

First release: `GoodCashProvider`, `CashOutButton` (accessible dialog), `CashOutFlow`, hooks `useQuote`,
`useBanks`, `useVerifyAccount`, `useCashOut`, `useCashOutStatus`, theming with light/dark/auto.
