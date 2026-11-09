# React / Next.js quickstart

```bash
npm install @goodcash/react @goodcash/sdk
```

```tsx
'use client';
import { GoodCashProvider, CashOutButton } from '@goodcash/react';

export default function CashOut({ user, provider }) {
  return (
    <GoodCashProvider publishableKey={process.env.NEXT_PUBLIC_GOODCASH_KEY!} theme={{ accent: '#7b39fc', mode: 'auto' }}>
      <CashOutButton
        signer={provider}                 // window.ethereum, wagmi/WalletConnect/Magic EIP-1193 provider
        partnerRef={user.id}
        onEvent={(e) => {
          if (e.type === 'cashout.paid') console.log('paid', e.cashOut.id);
        }}
      />
    </GoodCashProvider>
  );
}
```

Only the **publishable** key goes in `NEXT_PUBLIC_...`. Never expose the secret key.

## Your own screens

```tsx
import { useQuote, useBanks, useVerifyAccount, useCashOut } from '@goodcash/react';

const { quote } = useQuote(amount);                         // show quote.fees and quote.receive.naira
const { banks } = useBanks();
const { accountName } = useVerifyAccount(bankCode, account); // show it before confirming
const { start, step, error } = useCashOut();

await start({ signer, amountG: amount, recipient: { bankCode, accountNumber: account, accountName: accountName! }, quote: quote!, partnerRef: user.id });
```

Show `error.message` to users. If `error.code` is `uncertain` or `pending_confirmation`, do not offer a retry: tell
the user to check their history.

Theme tokens: `background`, `surface`, `ink`, `accent`, `accentInk`, `highlight`, `success`, `radius`, `font`, `mode`.
