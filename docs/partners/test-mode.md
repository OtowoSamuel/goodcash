# Test mode

Test keys (`gc_pk_test_...`, `gc_sk_test_...`) never touch real money, the payout partner, or the chain.

- **Banks:** `Test Bank A` (`TESTBANKA`) and `Test Bank B` (`TESTBANKB`). Any 10-digit number verifies as `TEST ACCOUNT`.
- **Prices:** fixed, so your tests are repeatable. Naira rate 1,500 per dollar.
- **Transactions:** `POST /v1/cashouts` returns a real-looking transaction with a 1970 deadline and a burn address,
  so it can never succeed even if sent. Don't send it: call `POST /v1/test/cashouts/{id}/simulate` (the SDK does this
  for you, and never asks the wallet to sign with a test key).
- **Timeline after simulate:** `sent` → `processing` after 5 s → outcome after 30 s, with webhooks.
- **No wallet needed:** the SDK uses a stand-in address when no wallet is connected.

| Account number | Outcome |
| --- | --- |
| any other 10 digits | `paid` |
| `0000000001` | `failed` |
| `0000000002` | `refunded` |
| `0000000003` | stays `processing`, sends `cashout.delayed` |
| `0000000009` | name check fails (`bank_account_not_found`) |

## Top-ups (naira in)

Simulated end to end, no wallet, ID details or bank needed. `POST /v1/topups` creates one; it reads `awaiting_payment`, then
`paid_in` after about 5 seconds, then `delivered` after about 15 seconds, with webhooks. An amount ending in **13** fails
(`failed` after about 5 seconds). See [Add G$ / CELO with naira](quickstarts/topups.md).

Test data is deleted after 7 days.
