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

By default the customer connects their own wallet, pays by bank transfer, and approves **once** in their wallet.

## Your app already has the customer's wallet (email sign-in, Magic, Privy, Thirdweb...)

If your users signed in to **your** app and your app created their wallet (for example a Magic email wallet), do not make
them connect again. Pass their wallet address and a way for your page to sign. GoodCash then **skips the connect step**:
your page signs the one approval with the wallet they are already using, and the G$ or CELO arrives in that same wallet.

```js
GoodCash.open({
  publishableKey: 'gc_pk_live_...',
  flow: 'topup',
  mode: 'embed',                          // recommended on phones (see below)
  wallet: user.walletAddress,             // the wallet the customer is signed in with in YOUR app
  signer: user.walletProvider,            // an EIP-1193 provider (Magic: magic.rpcProvider; Privy, Thirdweb, wagmi...)
  // or, instead of signer (lets you run your own check, see below):
  // signTypedData: async (typedData, { orderId, maxUsdc, wallet }) => signature   // 0x... (65 bytes)
  partnerRef: user.id,
  onEvent: (e) => { if (e.type === 'topup.delivered') showToast('G$ added!'); },
});
```

React: pass the same `wallet`, `signer` (or `signTypedData`) to `<TopUpButton />`.

- **Nothing else changes.** The customer still pays naira on GoodCash's page and still types their ID details there.
  Your page never sees those details.
- **What your page signs, and nothing else.** Your page only ever signs a USDC authorization on Base, **from the wallet you
  passed**, valid for a short time. `widget.js` checks this itself before it asks your wallet (anything else is refused),
  and GoodCash checks the signature really came from that wallet before using it.
- **Check the exact amount yourself (recommended).** With `signTypedData`, your function is also given
  `{ orderId, maxUsdc, wallet }`. `maxUsdc` is the most this order may convert, in 6-decimal USDC units (`3551428` is
  $3.551428). Refuse unless the permit's `message.value` is not above `maxUsdc`, `message.from` is your signed-in
  customer's wallet, the domain is USD Coin on chain 8453 (USDC `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`), and
  `message.to` is one of [Relay's approval contracts](#relays-approval-contracts). `widget.js` already refuses anything
  above `maxUsdc` before it calls you; your check is a second, independent one. It has no `maxUsdc` before version `0.4.0`
  (`GoodCash.version`), so refuse a request without one.
- **No fee and no network switch for the customer.** The approval costs the customer nothing. If your wallet can move to
  Base for the signature, `widget.js` moves it there and back; a wallet that cannot switch (some email wallets stay on one
  network) signs without switching.
- **Only an app GoodCash has approved can do this.** The widget only opens for the sites on your allowed list, and your
  page is the only page it will talk to.
- **Not available in `redirect` mode** (there is no page to answer the signing request). Use `popup` or `embed`.
- **If you pass only a function that sends transactions** (`signer: async (tx) => hash`, as used for cash out), the
  customer is asked to connect their own wallet as before. Pass an EIP-1193 provider or `signTypedData` to skip the step.
- **Wallets that are smart contracts** (not a normal key-based wallet) are not supported here yet. The customer can use
  the connect step instead.

### If the signature fails, or never comes

The customer's dollars stay in **their own wallet on Base** and nothing is taken. They can tap Add G$ again: the widget finds
the order whose naira arrived but whose conversion did not finish and shows the last step again, for up to **14 days**.
Each tap gets a fresh price and a new signature (one signature is valid for about 30 minutes). If Relay's answer is
unclear, the order is held until Relay says it failed or was refunded, or until that signature has run out (35 minutes),
so a second signature cannot be asked for by mistake. GoodCash does not refund or retry the dollars on its own; the naira
is refunded to the customer's bank only if the payout itself fails. Suggested wording: "Your money is safe in your wallet.
Open Add G$ again to finish." This works from the same wallet.

### Relay's approval contracts

The permit's `to` is always one of these two contracts, which belong to Relay (the swap service GoodCash uses), not to GoodCash:

| Contract | Address (Base) |
| --- | --- |
| Relay approval proxy v3 | `0xccc88a9d1b4ed6b0eaba998850414b24f1c315be` |
| Relay approval proxy v3.2 | `0x5567954cd026cebfe486062cb75848e0f1c12e58` |

Keep them in **one config value** in your app. GoodCash refuses any other address, so if Relay changes or adds one,
customers would be blocked until both sides are updated. **GoodCash will tell partners at least 7 days before the list
changes** (in the [changelog](../CHANGELOG.md)), except when Relay forces an
emergency change, when we will tell you the same day.

### On phones

Use `mode: 'embed'`. A pop-up window on a phone is often blocked, or opens in a separate tab that cannot talk back to your
page, and then nothing can sign. `embed` shows the panel over your own page, so signing works the same as on a laptop.
Inside a wallet app's own browser, `embed` is also the safest choice.

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
