# GoodCash on Dune

Public usage numbers for GoodCash, read straight from Celo. Nothing here needs a GoodCash server, and nothing private is shown: only on-chain data.

## Why only cash outs

The numbers come from the **G$ sent into the two GoodCash router contracts**. Adding G$ with naira happens in the customer's own wallet (dollars arrive on another network, then are swapped), so it never touches our contracts and cannot be counted from Celo alone. Say so on the dashboard.

## Build it (about 15 minutes)

1. Sign in at dune.com and create a **New query** for each `.sql` file in this folder. Name them as in the first comment line of each file. Run each one.
2. Check the results against the **expected values** below. If they don't match, the query is wrong, not the chain.
3. Create a **New dashboard**, add each query as a visualization (counters for the summary, a bar chart for the daily one), give it a title like "GoodCash: G$ cash outs on Celo", and make it **public**.
4. Put the dashboard link in the GoodBuilders form (field 2.8) and, if you like, in the app footer.

Notes on the queries: they use Dune's raw Celo tables (`celo.logs`). Dune does not offer the ready-made `tokens.transfers` table for Celo, so the queries read the token's `Transfer` events directly. Column names follow Dune's standard log table (`contract_address`, `topic0`..`topic3`, `data`, `tx_hash`, `block_time`); if Dune reports an unknown column, open the table in Dune's data explorer and adjust the name.

## Expected values on 8 Nov 2026 (checked on Blockscout)

| Check | Value |
| --- | --- |
| G$ cash-out transfers into the routers | 12 |
| Total G$ moved | about 56,754 |
| Distinct wallets | 3 (two are the team's own) |

These grow as people use GoodCash.

## Addresses

- G$ token: `0x62B8B11039FcfE5aB0C56E502b1C372A3d2a9c7A`
- Original router: `0xA4338586d4B2f0E1641C54b8cF0d53CD06B5c407`
- One-tap router (owned by the GoodCash Safe): `0x546698368a246539Df5e641EdC2b79c5782ea359`
