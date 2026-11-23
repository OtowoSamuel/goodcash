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

## The gas tank (network fee from GoodCash)

Written 23 November 2026. When a verified person's wallet is short of CELO and they tap **Vote**, GoodCash sends the fee by itself (there is no extra button). Their wallet asks for one free message to prove the wallet is theirs, GoodCash sends enough CELO to reach 0.25 (`VOTE_TANK_CELO`; the shared vote needs about 0.2 in the wallet at the fee on 23 November 2026, of which about 0.1 is spent), the app waits for it, and the vote goes on. A first-time voter reuses the free message they sign to turn on voting, so they are not asked twice (the app sends it with `kind: "claim"`; the Worker checks it against the voting message, a normal request against the fee message).

- `POST /vote/tank` on the Worker: `services/orders/src/voteTank.ts`. The signed message is checked against the wallet (normal wallets only), the wallet must be verified with GoodDollar, and the top-up is once per PERSON (the verified main wallet, marker `votetank:<person>`), so connected wallets cannot collect twice.
- Limits: a wallet that already has 0.25 CELO gets nothing; 30 top-ups a day (`VOTE_TANK_DAILY_CAP`); the tank stops before it falls under 0.3 CELO (`VOTE_TANK_RESERVE_CELO`); one send at a time (lock `vote-tank`).
- Off until `VOTE_TANK_ENABLED=true` and the secret `VOTE_TANK_KEY` (a fresh wallet used only for this, funded with a small amount) is set. While off, the button explains it and the "Add CELO with naira" option stays.
- Fund and watch the tank from its own address. Worst case in a day is the daily cap times 0.25 CELO.
- Not tested with a real tank: the send itself ran against a stand-in for the chain.

## Shared votes with GoodBuildIt

Written 23 November 2026, from GoodBuild's guide. Each vote from GoodCash is shared 50/50 with GoodBuildIt (recipient 10, `0xf0449277e30cc9063147bfb9ecdf036bf9d41531`), the odd point going to GoodCash. GoodBuild's app shares its voters' points with GoodCash the same way.

- One transaction sets both totals: `vote([{ GoodCash, total }, { GoodBuildIt, total }])`. The contract SETS totals, so each amount is existing support plus the new share. Other projects are never in the array, so they keep their votes.
- Everything goes to GoodCash when GoodBuildIt is not active, when only one point is given, or when the voter's project limit has room for one new project only.
- If the council would refuse the shared vote, the app checks the same points all for GoodCash and sends that instead, so sharing never stops a vote. The screen always shows exactly what will be sent.
- Before reading the ballot, the app checks the council's code hash (`COUNCIL_CODE_HASH`). A different contract stops voting before any signature.
- Checked on chain on 23 November 2026: code hash matches, both projects active, no project limit, and a shared 5 + 5 vote simulates fine from two real registered voters (about 504,000 gas, against 313,000 for GoodCash alone). No real shared vote has been sent yet.

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

- Moving points from another project to GoodCash. A voter with no free points is sent to Flow State's website.
- Paying the fee inside the vote itself (a paymaster). Flow State's own website seems to sponsor the fee that way (on 19 November 2026 most recent votes were sent by one bundler wallet through the account-abstraction entry point); ours sends a normal transaction from the customer's wallet, and the gas tank below tops that wallet up first.
- Our own check of the signature before forwarding. Flow State checks it, and our Worker only checks the format and age (5 minutes).
- Smart-contract wallets are untested.
- The full flow has been tested with a pretend wallet and a pretend chain, and every on-chain read and the fee simulation against the real council. A real wallet voting for real has not been done yet.
