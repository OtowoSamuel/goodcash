# React Native quickstart

The SDK has no DOM or Node dependencies, so it runs in React Native as is.

```bash
npm install @goodcash/sdk
```

```ts
import { GoodCash } from '@goodcash/sdk';

const gc = new GoodCash({ publishableKey: 'gc_pk_test_...', appId: 'com.yourcompany.app' }); // app id registered with GoodCash

const quote = await gc.quote({ amountG: 5000 });
const banks = await gc.banks();
const { accountName } = await gc.verifyAccount({ bankCode, accountNumber });

const { cashOut } = await gc.cashOut({
  signer: walletConnectProvider,   // any EIP-1193 provider (WalletConnect, Privy, Thirdweb, Magic...)
  amountG: 5000,
  recipient: { bankCode, accountNumber, accountName },
  quote,
  partnerRef: user.id,
});
await gc.watchCashOut(cashOut.id, (c) => setStatus(c.status));
```

React Native needs `crypto.getRandomValues` (for idempotency keys): add `react-native-get-random-values` and import it
first in your entry file.

## Or: the hosted flow in a WebView

```tsx
<WebView
  source={{ uri: `https://pay.goodcash.xyz/?key=${PK}&mode=redirect&amountG=5000&ref=${user.id}&returnUrl=myapp://cashout` }}
  onShouldStartLoadWithRequest={(r) => {
    if (r.url.startsWith('myapp://cashout')) { handleReturn(r.url); return false; }
    return true;
  }}
/>
```
