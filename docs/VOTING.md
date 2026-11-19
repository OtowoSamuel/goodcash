# Voting for GoodCash inside the app

Written 19 November 2026. A GoodDollar-verified customer can vote for GoodCash in the GoodBuilders programme (Flow State) from the Home screen ("Vote for GoodCash"), without leaving GoodCash and without reconnecting anywhere.

## What it does

Two steps for the customer: **1. Verify with GoodDollar, 2. Vote.**

1. Reads the customer's ballot from the council contract on Celo: voting points, points already given, and GoodCash's share. A wallet with voting points is verified by definition. Otherwise it asks GoodDollar's Identity contract (`getWhitelistedRoot`) whether the wallet is verified. A wallet connected to a verified person counts.
2. **Not verified:** step 1 shows a "Verify with GoodDollar" button (GoodWallet, `https://wallet.gooddollar.org`, the link GoodDollar's own site uses) and "I've verified, check again".
3. **Verified, no voting points yet:** one **Vote** button. It asks for one free signature in the customer's own wallet (no money, no transaction), our Worker passes it to Flow State, which gives the wallet its points, and then the app carries straight on to the vote with all of them. It stops instead, and shows the normal screen, if the wallet cannot pay the network fee or the fee cannot be checked (and offers "Add CELO with naira"). The customer's wallet asks them to approve two things: the free message, then the vote.
4. **Already has voting points:** a slider (all free points by default), the exact vote simulated, and the network fee in CELO. The vote button stays off until the simulation works and the wallet can pay the fee.
5. The vote is one transaction approved in the customer's own wallet: `vote([{ recipient: GoodCash, amount: newTotal }])` on the council. Only GoodCash's own total is sent, so other projects are never touched. The vote uses voting points, not G$.
6. Waits for 3 confirmations, then reads the council again at that block. Success is shown only when the council itself shows GoodCash with the points. A vote that cannot be confirmed yet is never sent a second time on its own.

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
- Paying the network fee for the customer. They need a little CELO (about 0.06 CELO for this vote). Flow State's own website seems to sponsor the fee (on 19 November 2026 most recent votes were sent by one bundler wallet through the account-abstraction entry point); ours sends a normal transaction from the customer's wallet.
- Our own check of the signature before forwarding. Flow State checks it, and our Worker only checks the format and age (5 minutes).
- Smart-contract wallets are untested.
- The full flow has been tested with a pretend wallet and a pretend chain, and every on-chain read and the fee simulation against the real council. A real wallet voting for real has not been done yet.
