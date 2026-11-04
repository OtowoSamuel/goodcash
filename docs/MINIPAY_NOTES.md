# MiniPay notes and scope decision

Spike date: November 4, 2026

Sources read from `~/.agents/skills/celopedia-skill/references/`:

- `minipay-requirements.md`
- `minipay-common-mistakes.md`
- `minipay-guide.md`
- `minipay-performance.md`

## Decision

**Do not target a MiniPay Mini App listing for the G$ flow.** MiniPay natively supports only **USDT, USDC and USDm**. Its requirements explicitly say not to add support for tokens MiniPay does not natively support, including arbitrary ERC-20s. G$ is an arbitrary ERC-20 on Celo. A Mini App whose UI holds, displays, claims or swaps G$ is therefore not listable as-is.

GoodCash ships as a **mobile-first PWA** used in a normal mobile browser with a Celo wallet that holds G$. MiniPay's in-app browser may load the PWA, but the MiniPay wallet does not hold G$, and the claim/identity flow requires message signing that MiniPay does not support. So MiniPay is not a distribution channel for this product in Season 5.

Do not write "MiniPay Mini App" in the GoodBuilders application. Write "mobile PWA; MiniPay listing is out of scope because MiniPay does not support G$."

## Verified MiniPay requirements that matter

### Supported assets

- Supported tokens: **USDT, USDC, USDm only**.
- **USDT is mandatory** for every Mini App.
- Do not add any token MiniPay does not natively support.
- Do not display or require CELO. Fees are abstracted.
- Use the **adapter** address for USDT/USDC in `feeCurrency`; USDm uses the token address. USDT/USDC are 6 decimals; USDm is 18.

### Wallet and identity

- **Zero-click connect:** no "Connect Wallet" button when `window.ethereum.isMiniPay === true`.
- **No message signing:** `personal_sign` and `eth_signTypedData` are unavailable.
- **No address exposure:** never display, copy, share, or QR the wallet address. A truncated `0x1234…abcd` is still prohibited. Use a username or generated display name.
- **No arbitrary withdrawals:** no free-text address field, no paste-an-address flow, no "send to any wallet." Payouts must go to the connected user or a destination MiniPay resolves.
- **Physical device required:** the emulator does not work.

### Transactions

- MiniPay uses **legacy transactions** and ignores EIP-1559 fields.
- Every on-chain action needs explicit **pending / success / failure** states.
- Pre-flight check must cover **amount + network fee**, not just the amount.
- If the balance is short, redirect to `https://link.minipay.xyz/add_cash` (optionally `?tokens=USDm,USDC,USDT`).
- MiniPay may override the `feeCurrency` field; do not fight it.

### Copy

Use **Network fee**, **Deposit**, **Withdraw**, **Stablecoin**. Do not use gas, onramp, offramp, or crypto in user-facing copy. Code identifiers can keep technical names.

### Performance and listing

- 2 MB bundle limit.
- Fully functional at **360 × 640**; tap targets at least 44 × 44 px.
- PageSpeed Insights mobile target 90+.
- SVG/WebP assets.
- Contracts verified on Celoscan, with sample transaction hashes for every user-facing method.
- Privacy Policy, Terms, Support, About and How to Use reachable from the footer/menu.
- An explicit line that the app is operated by your organisation and not by Opera or MiniPay.
- After listing, MiniPay whitelists exact contract addresses, method signatures, parameters and URLs. Changing any of them requires re-whitelisting.
- Critical issues must be fixed within 24 hours or the listing can be disabled.
- Pin exact dependency versions and commit the lockfile; supply-chain review is in scope.

## Why the G$ flow cannot be listed

| Requirement | G$ flow | Result |
| --- | --- | --- |
| Only USDT/USDC/USDm | G$ is the input asset | Fails |
| USDT mandatory | USDT is only the output | Could support, but does not fix the input |
| No arbitrary ERC-20s | G$ is an arbitrary ERC-20 | Fails |
| No message signing | GoodDollar identity/claim uses a signed identity message | Fails |
| No address exposure | Claim/verification flows often need the address; can be hidden, but the asset issue remains | Manageable |
| 2 MB bundle | React + wagmi + viem + claim SDK is tight | Manageable with work |
| Legacy tx only | Claim SDK may use EIP-1559 assumptions | Needs testing |
| No arbitrary withdrawals | Off-ramp sends USDT to a provider address | Potentially fails: the provider address is not the connected user |

The last row is important: an off-ramp by definition sends funds to a third-party provider's deposit address. MiniPay prohibits arbitrary/external withdrawals. Even a USDT-only off-ramp Mini App may be rejected unless MiniPay explicitly supports the provider flow. Do not assume it is allowed.

## What would change this decision

Only a direct confirmation from the MiniPay team that:

1. A G$-input app can be listed even though G$ is not a native token, and
2. The claim/identity flow may use message signing or an alternative verification path, and
3. Sending USDT to a licensed provider's deposit address is permitted.

Until all three are confirmed in writing, stay out of MiniPay.

## PWA requirements that still apply

Even without MiniPay, keep the good constraints:

- 360 px width, 48 px tap targets, system fonts.
- Wallet auto-connect when injected; standard connector otherwise.
- No `personal_sign` unless the user explicitly verifies identity; explain why.
- Never show a seed phrase prompt.
- Legacy transaction support is useful for older wallets but not mandatory.
- Test on a physical low-end Android device.
- Keep the bundle small and measure with Lighthouse.

## Recommendation

1. Build the PWA for mobile Safari/Chrome with a Celo wallet.
2. Use WalletConnect or injected connectors; do not build a Connect button for MiniPay.
3. Do not apply to MiniPay in Season 5.
4. If distribution inside MiniPay becomes a hard requirement, scope a **separate USDT-only product** that does not touch G$, and confirm the provider-withdrawal rule with MiniPay first. That product would not satisfy the GoodBuilders "G$ used inside the product" goal, so it is not a substitute.
