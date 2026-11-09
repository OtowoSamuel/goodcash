# Fees for partners

What the customer sees, each on its own line:

| Line | Who | How much |
| --- | --- | --- |
| GoodDollar contribution | GoodDollar protocol (not GoodCash) | 10% of the G$ (exit contribution) |
| GoodCash fee | GoodCash | 1% of the payout |
| *Your app* fee | You (optional) | 0 to 3% of the payout, set in your agreement |
| Bank payout fee | Payout partner | about $0.02 per payout |
| Network fee | Celo network | paid in CELO from the wallet (not G$) |

How it is collected: the GoodCash fee and your fee are added together and collected in the same transaction by the
payout partner's sender fee, into the GoodCash Safe. GoodCash records your share of every paid cash out and pays
you monthly. You may also charge your users separately in your own app.

The fee the customer saw must equal the fee charged: the API refuses a cash out (`fee_mismatch`) otherwise.
Total fees (GoodCash + yours) are capped at 5%.
