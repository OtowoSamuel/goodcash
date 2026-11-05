# Performance and mobile wallet compatibility

## Bundle and delivery baseline

The GoodCash web app is configured for a low-end Android path and a lightweight PWA shell.

### Current local measurements

- Production build: `npm run build`
- Result: Vite produced a single-page app with a gzip-compressed JavaScript payload of ~63 KB in the app bundle.
- Current initial JavaScript stays well below the 400 KB target required by the prompt.

### Implementation notes

- Vendor chunks are split by Vite to reduce the main entry weight.
- The app lazy-loads non-critical UI surfaces instead of eager-loading the full view tree.
- The PWA shell is cached using a service worker for quick repeat loads and offline recovery.

## MiniPay compatibility policy

MiniPay is explicitly blocked for G$ flows:

- `window.ethereum.isMiniPay` is detected at runtime.
- A blocking notice explains the unsupported-wallet condition.
- The app does not connect, claim, or initiate a swap from MinPay.
- No wallet address is shown or copied in the MiniPay path.

## Android validation checklist

The following should be validated on a physical Android device on a throttled connection before launch:

1. Open GoodCash in Chrome/Safari with a browser wallet, not MiniPay.
2. Confirm the app loads from cache after the first visit.
3. Confirm the balance view still renders stale data with a visible stale label when the network is slow.
4. Confirm the claim flow and cash-out flow work under a throttled connection.
5. Confirm the MiniPay route blocks instantly and shows the browser-required notice.

## Performance guardrails

- Keep the initial JS payload under 400 KB gzipped.
- Prefer system fonts and avoid layout-blocking heavy animations.
- Use cache-first shell caching and network-first balance refreshes with stale fallback.
- Keep the app small enough for a mid-range Android device and a poor mobile network.

This file documents the performance baseline and the required device QA path. A physical-device test remains required before production launch.
