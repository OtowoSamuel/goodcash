# MetaMask "wallet drainer" warning on goodcash.xyz — 9 Nov 2026

## What we found
MetaMask's live site scanner (`dapp-scanning.api.cx.metamask.io`, run with Blockaid) returned:

```
goodcash.xyz → recommendedAction: BLOCK, DRAINER, CRITICAL, "Domain identified as a wallet drainer."
```

- Not on MetaMask's public GitHub blocklist (eth-phishing-detect), ScamSniffer, or ChainPatrol. It is the live scanner only.
- **Every `*.workers.dev` and `*.pages.dev` address is blocked**, including made-up ones (free Cloudflare hosting that drainer kits use). Our site sent all its server calls to `goodcash-orders.goodcash.workers.dev`.
- A brand-new random `.xyz` domain scores clean, so `.xyz` itself is not the problem.
- goodcash.xyz was registered on 7 Nov 2026, so the domain is very new, which scanners also weigh.
- The Add G$ flow asks for one signed USDC authorization on Base (`ReceiveWithAuthorization` to the swap service). The app checks every field before asking, but scanners are wary of this kind of signature.

## What we changed (branch `fix-metamask-flag`)
- The worker now also answers on **api.goodcash.xyz** (Cloudflare custom domain, same zone).
- The website only talks to `api.goodcash.xyz`; nothing in the built site mentions `workers.dev` or `pages.dev`.
- `workers.dev` stays on so the payout partner's webhook keeps working. Move the webhook URL in the payout partner's dashboard to `https://api.goodcash.xyz/webhooks/paycrest`, and then `workers_dev` can be turned off.

## How to check
```
curl -s "https://dapp-scanning.api.cx.metamask.io/scan?url=goodcash.xyz"
```
`"recommendedAction":"NONE"` means it is cleared.

---

## Dispute 1: MetaMask support
Where: https://support.metamask.io → Contact support → "Continue without wallet". Attach a screenshot of the warning.

> **Subject:** False positive: goodcash.xyz flagged as a wallet drainer
>
> Hello, I build GoodCash (https://goodcash.xyz), a non-custodial app on Celo that lets GoodDollar (G$) holders in Nigeria cash out to their own bank account, and add G$ with naira. MetaMask's site scanner flags the domain as "DRAINER / CRITICAL", which is blocking a grant reviewer from testing it.
>
> Why we believe it is a false positive:
> - The app never asks for unlimited approvals or blind signatures. Cash out is one wallet confirmation: `G$.transferAndCall` of the exact amount to our router contract, which swaps and pays the payout partner exactly, returns any surplus to the user in the same transaction, and holds nothing. The owner can only pause it.
> - Contracts are verified: RouterV2 0x546698368a246539Df5e641EdC2b79c5782ea359 and V1 0xA4338586d4B2f0E1641C54b8cF0d53CD06B5c407 on Celo (Celoscan / Blockscout, Sourcify exact match). V2's owner is a Safe.
> - Source code is public: https://github.com/OtowoSamuel/goodcash
> - Our API used to run on a `*.workers.dev` address, which your scanner blocks for every subdomain. We have moved it to api.goodcash.xyz on our own domain.
> - The domain is new (registered 7 Nov 2026) because we just moved to it.
>
> Please rescan goodcash.xyz and api.goodcash.xyz. Happy to answer any questions.
>
> Samuel Otowo, GoodCash

## Dispute 2: Blockaid
Where: https://report.blockaid.io → report a false positive / incorrectly flagged dApp. Use the same text as above, with the URL `https://goodcash.xyz`.

---

## Reply to the grant reviewer (send after the fix is live and the disputes are filed)

> Hi! Thanks for flagging this, and sorry for the trouble.
>
> We looked into it: MetaMask's automatic site scanner blocks every app hosted on Cloudflare's free `workers.dev` addresses (they're commonly abused by drainer kits), and our app's server was on one. Our domain is also only a few days old, which the scanner weighs heavily. Nothing on GoodCash asks for unlimited approvals or blind signatures. Cash out is a single confirmation of the exact amount to our verified, non-custodial contract (RouterV2 0x5466…a359 on Celo, owned by a Safe), and the code is public at https://github.com/OtowoSamuel/goodcash.
>
> What we've done: moved our server to api.goodcash.xyz on our own domain, and filed false-positive reports with MetaMask and Blockaid for a rescan.
>
> [If still flagged when you send:] Until the rescan clears, you can test with Rabby, Valora or MiniPay, or in MetaMask choose "Proceed anyway" on the warning page. We'll let you know the moment MetaMask clears it.
>
> Thanks again!
