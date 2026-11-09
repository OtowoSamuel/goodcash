# @goodcash/sdk

Let your users cash out **GoodDollar (G$) to a Nigerian bank account** from inside your app or game.
One wallet confirmation, paid to the bank in minutes. GoodCash never holds your users' money or keys.

```bash
npm install @goodcash/sdk
```

Works in browsers, React Native, Node 18+, Deno, Bun and Cloudflare Workers. No dependencies.

## Quick start (browser or app)

```ts
import { GoodCash } from '@goodcash/sdk';

const gc = new GoodCash({ publishableKey: 'gc_pk_test_...' }); // test key: no real money

const quote = await gc.quote({ amountG: 5000 });       // show quote.fees and quote.receive.naira
const banks = await gc.banks();                        // most used first
const { accountName } = await gc.verifyAccount({ bankCode, accountNumber }); // show it before confirming

const { cashOut } = await gc.cashOut({
  signer: window.ethereum,        // any wallet: injected, WalletConnect, Magic, MiniPay, a viem WalletClient...
  amountG: 5000,
  recipient: { bankCode, accountNumber, accountName },
  quote,                          // the quote you showed: the fee is checked against it
  partnerRef: 'player-123',       // your own id, returned everywhere
  onStep: (step) => console.log(step),
});

await gc.watchCashOut(cashOut.id, (c) => console.log(c.status)); // ... 'processing', 'paid'
```

With a test key the wallet is never asked to sign: the cash out is simulated and reaches `paid` after about 30 seconds.

## Server (secret key)

```ts
import { GoodCash } from '@goodcash/sdk';
import { verifyWebhook } from '@goodcash/sdk/server';

const gc = new GoodCash({ secretKey: process.env.GOODCASH_SECRET_KEY });
const page = await gc.listCashOuts({ limit: 50 });

// Webhook endpoint: use the RAW body
const event = await verifyWebhook(rawBody, req.headers['goodcash-signature'], process.env.GOODCASH_WEBHOOK_SECRET);
if (event.type === 'cashout.paid') { /* credit, notify, ... (ignore event ids you already handled) */ }
```

Paying out from your own wallet (games, fintechs): pass a viem `WalletClient` with a local account, or your own
`signer: async (tx) => hash` function, plus `wallet`. Keep that wallet's key in your own key management.

## Safety built in

- The SDK checks the transaction **before any wallet signs**: it must go to the G$ token, call the GoodCash router
  (pinned in the SDK), move exactly the amount asked for, and pay the order's own address no more than the
  guaranteed minimum, before the order closes. Anything else throws `unsafe_transaction`.
- If a wallet loses its reply, the SDK looks for the payment on chain before saying anything, and never says
  "nothing was taken" unless that is proven (`uncertain` otherwise).
- Fees are shown as separate lines, and the server refuses (`fee_mismatch`) if the fee differs from what was shown.
- Secret keys are refused in web pages.

## Errors

Every error is a `GoodCashError` with a stable `code`, a plain `message` you can show customers, and a `detail` for
you. Full list: https://pay.goodcash.xyz/docs/errors/

Docs: https://pay.goodcash.xyz/docs · API reference (OpenAPI): https://pay.goodcash.xyz/docs/openapi.yaml
