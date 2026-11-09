# Game quickstart (web, WebGL, Unity, mobile)

## A. Players use their own wallet (MetaMask, MiniPay, Valora...)

Web or WebGL build: add two lines to your page.

```html
<script src="https://pay.goodcash.xyz/widget.js"></script>
<script>
  function cashOut(playerId, gBalance) {
    GoodCash.open({
      publishableKey: 'gc_pk_test_...',   // test first
      mode: 'popup',                      // or 'embed' (overlay on your page)
      amountG: gBalance,
      partnerRef: playerId,
      onEvent: (e) => { if (e.type === 'cashout.paid') showToast('Paid to your bank!'); },
    });
  }
</script>
```

From Unity WebGL, call it with a `.jslib` plugin:

```js
mergeInto(LibraryManager.library, {
  GoodCashOpen: function (playerIdPtr, amount) {
    GoodCash.open({ publishableKey: 'gc_pk_test_...', mode: 'embed', amountG: amount, partnerRef: UTF8ToString(playerIdPtr) });
  },
});
```

## B. Unity / native mobile (no web page)

Open the hosted flow in a WebView and come back by deep link:

```
https://pay.goodcash.xyz/?key=gc_pk_test_...&mode=redirect&amountG=5000&ref=player-42&returnUrl=mygame://cashout
```

Your app receives `mygame://cashout?goodcash_cashout=<id>&status=sent`. Register your app id with GoodCash.
Note: inside a WebView the player needs a wallet the WebView can reach (an in-app browser wallet such as MiniPay).
For players without one, use option C or the widget's host signing (D).

## C. Your game pays out from its own wallet (players earned G$ inside the game)

Run it on your server with the secret key. See the [server quickstart](fintech-server.md). Keep the payout wallet's
key in a key manager with limits; GoodCash never sees it.

## D. Your game has an embedded wallet (Privy, Thirdweb, your own)

The widget asks your page to send the one transaction; it never sees keys:

```js
GoodCash.open({
  publishableKey: 'gc_pk_test_...',
  mode: 'embed',
  wallet: player.address,
  signer: player.walletProvider,          // EIP-1193 provider, or async (tx) => txHash
  partnerRef: player.id,
});
```

Then credit or notify players from your **server webhook** (`cashout.paid`), not from browser events alone.
