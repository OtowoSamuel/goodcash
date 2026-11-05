# GoodCash

GoodCash is a non-custodial Celo PWA that helps GoodDollar holders claim G$, accumulate it, swap to a stablecoin, and hand off to a licensed naira off-ramp.

## Local setup

```bash
npm install
npm run dev
```

## Scripts

```bash
npm run dev          # start the web app
npm run build        # production web build
npm run test         # run web app tests
npm run lint         # lint the web app
npm run typecheck    # TypeScript validation
npm run contracts:build
npm run contracts:test
```

## Analytics and dashboard

GoodCash keeps analytics wallet-level only and never sends names, phone numbers, bank details, or raw partner payloads to tracking tools.

- Privacy notice: wallet addresses are pseudonymous personal data; analytics remain wallet-level only.
- Public dashboard placeholder: https://dune.com/your-org/goodcash-dashboard
- Source-of-truth metrics: `CashOut` contract events, with app-level funnel events for conversion and retention.

## Mainnet gate

No mainnet deployment or live swap is allowed before the verification gate in Prompt 4 is completed and the Safe owner, pause state, fork tests, and quote checks are validated.

This repository is scaffolded for local build verification only. Do not commit secrets or deploy without completing the required verification steps.
