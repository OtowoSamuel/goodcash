# @goodcash/react

A ready-made **"Cash out to bank"** button for React apps: your users turn GoodDollar (G$) into naira in their own
Nigerian bank account, without leaving your app. Built on [`@goodcash/sdk`](https://www.npmjs.com/package/@goodcash/sdk).

```bash
npm install @goodcash/react @goodcash/sdk
```

```tsx
import { GoodCashProvider, CashOutButton } from '@goodcash/react';

export function Wallet() {
  return (
    <GoodCashProvider publishableKey="gc_pk_test_..." theme={{ accent: '#7b39fc', mode: 'auto' }}>
      <CashOutButton
        signer={window.ethereum}            // or your WalletConnect / Magic / embedded wallet provider
        partnerRef={currentUser.id}
        onEvent={(e) => e.type === 'cashout.paid' && toast('Paid!')}
      />
    </GoodCashProvider>
  );
}
```

- `<CashOutButton />` opens the whole flow (amount, bank, review, confirm, tracking) in an accessible dialog
  (focus trap, Escape to close, labelled controls). Phones first.
- `<CashOutFlow />` is the same flow inline, for your own page or sheet.
- Hooks for your own screens: `useQuote`, `useBanks`, `useVerifyAccount`, `useCashOut`, `useCashOutStatus`.
- Theme: `background`, `surface`, `ink`, `accent`, `accentInk`, `highlight`, `success`, `radius`, `font`,
  `mode: 'light' | 'dark' | 'auto'`. Styles are scoped (`.gcw-*`), so they never touch your CSS. No web fonts are loaded.
- Every fee is shown as its own line, in plain words. "Powered by GoodCash" stays visible.

Events: `cashout.created`, `cashout.sent`, `cashout.paid`, `cashout.failed`, `closed`.
Use webhooks (server) for anything that must not be missed, like crediting a user.

Docs: https://goodcash.xyz/partners
