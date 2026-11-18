# Partner API changelog

The API is versioned in the path (`/v1`). Within `v1` we only add things (new fields, endpoints, event types,
error codes); we never remove or rename them. Ignore fields you don't know. Breaking changes get a new version.

## v1 (unreleased)

- Endpoints: `partner`, `limits`, `banks`, `banks/verify`, `quote`, `network-fee`, `cashouts` (create, list, get,
  report transaction), `test/cashouts/{id}/simulate`, `webhooks` (get, set, test).
- Events: `cashout.paid`, `cashout.failed`, `cashout.refunded`, `cashout.expired`, `cashout.delayed`, `cashout.test`.
- Naira in (top-ups), switched on per partner: `topup/quote`, `topups` (create, get, list); events `topup.paid_in`,
  `topup.delivered`, `topup.failed`; error code `topups_not_enabled`; `widget.js` option `flow: 'topup'`; SDK `topUpQuote`,
  `createTopUp`, `getTopUp`, `listTopUps`, `watchTopUp`; React `<TopUpButton />`. Customers' ID details never pass through
  partners or `/v1`.
- Top-ups for apps that already hold the customer's wallet (email sign-in wallets such as Magic, Privy, Thirdweb): pass
  `wallet` and a `signer` (EIP-1193 provider) or `signTypedData` to `GoodCash.open` / `<TopUpButton />`, and the customer is not
  asked to connect again. `widget.js` 0.4.0 (unreleased) signs only a USDC permit on Base from that wallet; the hosted page
  checks the signature came from it. Not available in `redirect` mode. The signing request carries `orderId` and `maxUsdc`
  (the most the order may convert); `signTypedData` receives them as a second argument and `widget.js` refuses a larger
  amount. Relay's two approval contracts are now published (top-ups quickstart); changes to them come with at least 7 days'
  notice here. `GoodCash.version` is `0.4.0`.
- Packages: `@goodcash/sdk` 0.2.1, `@goodcash/react` 0.2.0, `widget.js` 0.2.0.
