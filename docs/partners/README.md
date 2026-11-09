# GoodCash for Partners

Let your users turn **GoodDollar (G$)** into **naira in their own Nigerian bank account**, without leaving your app or game.
One wallet confirmation; paid in minutes. GoodCash never holds your users' money or keys.

| You are | Start here | Time |
| --- | --- | --- |
| A game (web, WebGL, Unity, mobile) | [Game quickstart](quickstarts/game.md) | 10 min |
| A React / Next.js app | [React quickstart](quickstarts/react.md) | 15 min |
| A React Native app | [React Native quickstart](quickstarts/react-native.md) | 30 min |
| A fintech / server (airtime, bills, your own UI) | [Server quickstart](quickstarts/fintech-server.md) | 1 day |
| An AI app builder | [AI builder quickstart](quickstarts/ai-builder.md) + [llms.txt](llms.txt) | 5 min |

Reference: [OpenAPI](openapi.yaml) · [Errors](errors.md) · [Webhooks](webhooks.md) · [Test mode](test-mode.md) ·
[Fees](FEES.md) · [Go-live checklist](go-live.md) · [Changelog](CHANGELOG.md)

## How it works

1. Your app asks GoodCash for a **quote**: what the user gets in naira, with every fee on its own line.
2. The user picks their bank; GoodCash shows the **account holder's name** to confirm.
3. GoodCash prepares **one transaction**. The SDK checks it, then the user's wallet (or your server wallet) signs it.
4. The GoodCash router swaps the G$ and pays the payout partner exactly; any surplus goes straight back to the user.
5. The bank is paid, usually within minutes. You get a signed **webhook** (`cashout.paid`).

## Keys

| Key | Where | Can |
| --- | --- | --- |
| `gc_pk_test_...` / `gc_pk_live_...` (publishable) | Browsers, apps, the widget. Only from your allowed sites or app ids. | Everything a user's own cash out needs |
| `gc_sk_test_...` / `gc_sk_live_...` (secret) | Your server only. Refused from browsers. | Plus: list all cash outs, webhook settings |

Test keys never move money (see [test mode](test-mode.md)). **Get test keys yourself, right away:** https://pay.goodcash.xyz/docs/get-test-keys/ (email-confirmed; you list the websites you will test from). Live keys are approved by GoodCash after you have tested: see the [go-live checklist](go-live.md).

## Packages

- `https://pay.goodcash.xyz/widget.js`: the whole flow, one script tag.
- [`@goodcash/react`](../../packages/react/README.md): `<CashOutButton />` and hooks.
- [`@goodcash/sdk`](../../packages/sdk/README.md): client for browsers, React Native, Node, edge; `@goodcash/sdk/server` for webhooks.
- Examples: [`examples/`](../../examples)
