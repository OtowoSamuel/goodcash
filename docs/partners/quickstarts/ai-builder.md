# AI app builder quickstart

Point your AI at [`llms.txt`](../llms.txt) (short rules) or [`llms-full.txt`](../llms-full.txt) (everything).

The smallest working integration, safe to paste into any generated page:

```html
<script src="https://pay.goodcash.xyz/widget.js"></script>
<button onclick="GoodCash.open({ publishableKey: 'gc_pk_test_REPLACE_ME', mode: 'popup' })">
  Cash out G$ to my bank
</button>
```

For a React app the AI generates:

```tsx
import { GoodCashProvider, CashOutButton } from '@goodcash/react';
<GoodCashProvider publishableKey="gc_pk_test_REPLACE_ME"><CashOutButton /></GoodCashProvider>
```

Rules your AI must keep:
- Only a publishable key (`gc_pk_...`) in generated frontend code. Never a secret key.
- Start with a test key; the user switches to live.
- Don't compute fees or prices: show what the quote returns.
- The site the generated app runs on must be on the partner's allowed list. Today each site is listed exactly
  (for example `https://shop.example.com`); wildcard sub-domains (`https://*.yourbuilder.app`) are not supported yet.
  Builders that publish every app on its own sub-domain should talk to GoodCash first.
