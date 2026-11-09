# Add G$ / CELO with naira (top-ups)

Let your users **pay naira from their own bank account and receive G$ (or CELO) in their own wallet**, without leaving
your app. It is the other direction from cash out.

> **Availability.** Top-ups are switched on per partner by GoodCash. Until they are, these calls answer "not found".
> Ask GoodCash to enable test mode for you, then live later. Test mode never moves money.

## Your users' ID details never come to you

Paying naira needs the payer's name, date of birth and BVN or NIN. **They are typed on GoodCash's own page
(`pay.goodcash.xyz`) and go straight to the payout partner.** Your app, your page and your servers never see them, and
no `/v1` call accepts them. You only get the order's progress: quotes, status and webhooks.

## The quickest way: one button

```html
<script src="https://pay.goodcash.xyz/widget.js"></script>
<script>
  function addMoney(playerId) {
    GoodCash.open({
      publishableKey: 'gc_pk_test_...',   // test first
      flow: 'topup',
      mode: 'popup',                      // or 'embed' (a panel over your page)
      amountNaira: 5000,                  // optional starting amount
      asset: 'g',                         // 'g' (G$) or 'celo'
      partnerRef: playerId,
      onEvent: (e) => { if (e.type === 'topup.delivered') showToast('G$ added!'); },
    });
  }
</script>
```

React:

```tsx
import { GoodCashProvider, TopUpButton } from '@goodcash/react';

<GoodCashProvider publishableKey="gc_pk_test_...">
  <TopUpButton amountNaira={5000} partnerRef={user.id} onEvent={(e) => console.log(e.type)} />
</GoodCashProvider>
```

The customer connects their own wallet, pays by bank transfer, and approves **once** in their wallet. Games with their
own embedded wallets are not supported for top-ups yet: the customer's own wallet signs.

## Events

Browser events (`e.topUp` has the top-up): `topup.created`, `topup.paid_in` (the naira arrived), `topup.delivered`
(the G$/CELO is in the wallet), `topup.failed` (expired or refunded).

## From your server

Quote and status, with your keys. Listing needs the secret key.

```bash
curl "https://api.goodcash.xyz/v1/topup/quote?amountNaira=5000&asset=g" -H "Authorization: Bearer $GOODCASH_PUBLISHABLE_KEY" -H "Origin: https://your-site.example"
curl https://api.goodcash.xyz/v1/topups/tu_... -H "Authorization: Bearer $GOODCASH_SECRET_KEY"
curl https://api.goodcash.xyz/v1/topups        -H "Authorization: Bearer $GOODCASH_SECRET_KEY"
```

With the SDK: `gc.topUpQuote({ amountNaira })`, `gc.getTopUp(id)`, `gc.watchTopUp(id, onChange)`, `gc.listTopUps()`.

Statuses: `awaiting_payment` → `paid_in` → `delivered`; or `failed` / `expired`.

**Webhooks** (same signed, retried delivery as cash out): `topup.paid_in`, `topup.delivered`, `topup.failed`. `data` is the
top-up. Credit your user from `topup.delivered`, not from browser events alone.

## Quote

`youGet.amount` is about what the customer receives and `youGet.minimum` is the least. Show every line in `fees`. A quote
is good for about 30 seconds. The smallest top-up is ₦1,000 (`minimumNaira`).

## Test mode

Simulated end to end, in a few seconds: waiting, then the naira lands (about 5 s), then delivered (about 15 s). **An amount
ending in 13 fails**, so you can test your failure path. No wallet or ID details are asked for in test mode.

## Fees

GoodCash's top-up price is shown as lines in the quote (a payment partner fee and a network and exchange fee). There is
no partner fee on top-ups yet.
