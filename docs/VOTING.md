# Voting for GoodCash inside the app

Written 19 November 2026. A GoodDollar-verified customer can vote for GoodCash in the GoodBuilders programme (Flow State) from the Home screen ("Vote for GoodCash"), without leaving GoodCash and without reconnecting anywhere.

## What it does

1. Reads the customer's ballot from the council contract on Celo: voting points, points already given, and GoodCash's share.
2. If the wallet has no voting points yet, asks them to sign one readable message in their own wallet (free, no transaction). Our Worker passes that message to Flow State, which checks the signature and GoodDollar verification and gives the wallet its points.
3. Shows a slider (all free points by default), simulates the exact vote, and shows the network fee in CELO. The vote button stays off until the simulation works and the wallet can pay the fee. If CELO is short it offers "Add CELO with naira".
4. The customer approves one transaction in their own wallet: `vote([{ recipient: GoodCash, amount: newTotal }])` on the council. Only GoodCash's own total is sent, so other projects are never touched. The vote uses voting points, not G$.
5. Waits for 3 confirmations, then reads the council again at that block. Success is shown only when the council itself shows GoodCash with the points. A vote that cannot be confirmed yet is never sent a second time on its own.

## Fixed facts (checked on chain, 19 November 2026)

- Network: Celo mainnet, chain 42220.
- Council (GoodBuilders Season 5): `0x889e0aadaa3f8b28a794ef70da147827c620a590`.
- GoodCash's funding address in the council: `0xafdeebb89cda1669361117ea2eae3411f1228cb6` (recipient 11, active, never removed).
- Voting points are plain whole numbers. Most voters have 10; some have more (one has 500), so the slider never assumes 10.
- Flow State's registration service: `POST https://flowstate.network/api/flow-council/eligibility`. No API key. It refuses requests from other websites (no CORS), which is why `POST /vote/register` on our Worker forwards the signed message. Chain and council are fixed in the Worker; the customer cannot choose them.
- The signed message format was checked against the live service: the right text passes the signature check and reaches the GoodDollar check; a one-word change is rejected as an invalid signature.

## Where the code is

- `apps/web/src/lib/vote.ts`: reading the ballot, working out the vote, fee, signing, sending, confirming.
- `apps/web/src/components/VoteModal.tsx`: the screen. Opened from `HomeLinks.tsx`.
- `services/orders/src/vote.ts` and the `/vote/register` route in `index.ts`: the one step the browser cannot do.

## If the council or GoodCash's address changes

Change `VOTE_COUNCIL` and `GOODCASH_RECIPIENT` in `apps/web/src/lib/vote.ts` and `VOTE_COUNCIL` in `services/orders/src/vote.ts`, then redeploy both. To find a project's address, read `RecipientAdded` events on the council (the metadata holds the project name).

## Not built

- A pin of the council contract's code hash (GoodBuild does this). The address is fixed, but a change to the contract's behaviour would not be noticed.
- Moving points from another project to GoodCash. A voter with no free points is sent to Flow State's website.
- Paying the network fee for the customer. They need a little CELO (about 0.06 CELO at today's price for this vote).
- Our own check of the signature before forwarding. Flow State checks it, and our Worker only checks the format and age (5 minutes).
- Smart-contract wallets are untested.
- The full flow has been tested with a pretend wallet and a pretend chain, and every on-chain read and the fee simulation against the real council. A real wallet voting for real has not been done yet.
