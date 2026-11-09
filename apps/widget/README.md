# GoodCash widget (pay.goodcash.xyz)

The hosted cash-out flow that partners open with `widget.js` (pop-up, embedded frame, redirect, or an in-app browser).

## Which wallet signs
In this order:
1. **The partner's own wallet** (games with embedded wallets): `GoodCash.open({ wallet, signer })`. The widget asks the
   partner's page to send the one transaction; it never sees a key.
2. **A wallet the browser already has** (a desktop extension, or a wallet app's own browser such as MiniPay or MetaMask's).
3. **Magic's Wallet Kit panel**, loaded only when the customer asks: WalletConnect (phone wallet apps), Coinbase, and
   email login. In a browser with no wallet in it the panel lists only WalletConnect and Coinbase, because MetaMask,
   Phantom and Rabby are browser extensions and fail with "connector not found" on a phone.

Test keys never ask for a wallet at all.

## Build settings (both are PUBLIC values, the same ones apps/web uses)
| Variable | Where from | Without it |
| --- | --- | --- |
| `VITE_MAGIC_PUBLISHABLE_KEY` | Magic dashboard | The panel is off: only a wallet already in the browser, or the partner's own wallet, can be used |
| `VITE_WALLETCONNECT_PROJECT_ID` | Reown (WalletConnect) dashboard | Phone wallets cannot connect |
| `VITE_API_BASE` | optional, default `https://api.goodcash.xyz` | |

Put them in `apps/widget/.env.production` (git-ignored). You can copy the two values from `apps/web/.env.production`.

## One-time dashboard settings
Add **https://pay.goodcash.xyz** as an allowed domain in the Magic dashboard and in the Reown dashboard (add
`http://localhost:5199` while developing). Without this, the wallet panel is refused by those services.

## What loads
About 180 kB (58 kB compressed) up front. The wallet library (about 2.2 MB) only loads if the customer opens the wallet panel.

## Security policy
`functions/_middleware.ts` sets the content security policy (`src/csp.ts`): the wallet services are allowed (the same
list as the GoodCash app, checked by a test), and `frame-ancestors` is limited per partner to their allowed sites.

## Checks
`npm run test` (unit), `npm run e2e` (real Chromium against the real worker in local test mode; includes the live-key
"connect your wallet" screen with and without a wallet).
