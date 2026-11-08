# GoodCash fee

GoodCash charges **1% of each cash out** (the naira the customer is paid). It is collected through the payout partner's sender-fee feature and paid to the GoodCash Safe `0x735Ef948F746bc141D04042d2A18aA7f967bce2f`. The customer pays the partner's own transaction fee on top, so GoodCash earns the full percent even on small orders.

## Where it is set (two places that must match)

| Place | Setting | Meaning |
| --- | --- | --- |
| `services/orders/wrangler.toml` | `SENDER_FEE_PERCENT`, `SENDER_FEE_ADDRESS` | What the server charges. Empty or `0` means no fee. Capped at 5. |
| `apps/web/.env.production` (not in git) | `VITE_GOODCASH_FEE_PERCENT` | What the screens show. Empty or `0` means no fee row. Capped at 5. |

## Deploy order does not matter

Each order request carries the fee percent the customer's screen **showed**. The server charges the fee only when that matches its own setting. So:

- The live site (an older build, no fee on screen) is never charged, even after the worker has the fee switched on.
- A preview or release build that shows the fee is charged exactly what it showed.

## Safety

- If the payout partner refuses the fee setting (for example a cap on the profile), the order is created **without** the fee and the team sees an error in the worker log. A customer is never blocked over our own fee.
- One-tap orders are sized so payout + GoodCash fee + partner fee never exceed the guaranteed minimum the contract will receive.

## Turn it off

Set `SENDER_FEE_PERCENT = "0"` in `wrangler.toml` and `VITE_GOODCASH_FEE_PERCENT=0`, then deploy both. Also change the wording in `apps/web/public/about.html` and `terms.html`.
