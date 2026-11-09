# GoodCash partner examples

All examples use **test keys**: no real money moves. Get test keys from GoodCash (or, for the GoodCash team,
`node scripts/partners.mjs create ...`).

| Folder | What | Run |
| --- | --- | --- |
| `web-widget/` | One script tag, popup and embedded | open `index.html` from an allowed site (or `npx serve`) |
| `react-app/` | `<CashOutButton />` in a Vite React app | `npm install && npm run dev` |
| `node-server/` | Server: quote, test cash out, webhook endpoint | `GOODCASH_SECRET_KEY=gc_sk_test_... node payout.mjs` |
| `react-native/` | SDK in React Native + WebView option | copy `App.tsx` into your app |
| `unity-webview/` | Unity: open the hosted flow, return by deep link | see `README.md` |
| `ai-snippet/` | Smallest paste-in snippet for AI-generated apps | paste `snippet.html` |
