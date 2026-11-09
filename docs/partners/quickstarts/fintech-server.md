# Server quickstart (fintechs, games paying from their own wallet)

Your server holds the **secret key** and, if you pay out from your own wallet, that wallet's key. GoodCash holds neither.

```bash
npm install @goodcash/sdk viem
```

```ts
import { GoodCash } from '@goodcash/sdk';
import { createWalletClient, http } from 'viem';
import { celo } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';

const gc = new GoodCash({ secretKey: process.env.GOODCASH_SECRET_KEY! });
const payoutWallet = createWalletClient({ account: privateKeyToAccount(process.env.PAYOUT_WALLET_KEY as `0x${string}`), chain: celo, transport: http() });

export async function payUser(userId: string, amountG: string, bank: { bankCode: string; accountNumber: string }) {
  const quote = await gc.quote({ amountG });                       // show or store these fee lines for your user
  const { accountName } = await gc.verifyAccount(bank);
  const { cashOut } = await gc.cashOut({
    signer: payoutWallet,                                          // your server wallet signs the one transaction
    amountG,
    recipient: { ...bank, accountName },
    quote,
    partnerRef: userId,
    idempotencyKey: `payout-${userId}-${Date.now()}`,              // reuse it if you retry the same attempt
  });
  return cashOut.id;                                               // "paid" arrives by webhook
}
```

Without the SDK, call the API directly (see [OpenAPI](../openapi.yaml)): `GET /v1/quote`, `POST /v1/banks/verify`,
`POST /v1/cashouts` (with `Idempotency-Key`), sign `transaction` after checking it, then
`POST /v1/cashouts/{id}/transaction`.

## Webhooks

```ts
import { verifyWebhook } from '@goodcash/sdk/server';

app.post('/goodcash', express.raw({ type: 'application/json' }), async (req, res) => {
  try {
    const event = await verifyWebhook(req.body.toString('utf8'), req.header('goodcash-signature'), process.env.GOODCASH_WEBHOOK_SECRET!);
    if (await alreadyHandled(event.id)) return res.sendStatus(200);
    if (event.type === 'cashout.paid') await markPaid(event.data.partnerRef, event.data.id);
    res.sendStatus(200);
  } catch {
    res.sendStatus(400);
  }
});
```

## Airtime, data and bills

To turn G$ into naira you then spend (airtime, MTN data, bills), cash out to **your own collection account** and
credit the user in your system when `cashout.paid` arrives. Your agreement with GoodCash covers who does user checks.

## Safety for server wallets

- Keep the key in a secret manager; give the wallet only what it needs each day.
- Set your own per-user and per-day limits before calling `cashOut`.
- Treat `uncertain` and `pending_confirmation` as "do not retry": check `getCashOut` first.
