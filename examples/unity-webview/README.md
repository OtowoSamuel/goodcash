# Unity

**WebGL build:** load `https://pay.goodcash.xyz/widget.js` in your template and call `GoodCash.open(...)` from a
`.jslib` plugin (see `docs/partners/quickstarts/game.md`).

**Android / iOS build:** open the hosted flow in a WebView (for example the free `gree/unity-webview` plugin) and
come back with a deep link. Register `mygame` as your app's URL scheme and your app id with GoodCash.
See `GoodCashCashOut.cs`.

Paying players from your game's own wallet? Do it on your server: `docs/partners/quickstarts/fintech-server.md`.
