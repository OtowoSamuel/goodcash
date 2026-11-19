# GoodCash Referral Campaign: Rules

Written 19 November 2026. These match what the code does (services/orders/src/referral.ts and scripts/referral-payouts.mjs). If you change a rule in the code, change it here too.

## The reward

1. A friend who joins through your link gets G$ 3,500 free, which is about ₦500 at the 19 November 2026 rate.
2. The person who shared the link also gets G$ 3,500.
3. The reward is a fixed amount of G$, so it does not change if the price moves.

## How a friend qualifies

4. The friend opens the inviter's link, then adds money to GoodCash through the Add G$ screen on the same phone or browser. Adding G$ or CELO both count.
5. It must be the friend's first ever top-up, and it must be at least ₦2,000.
6. The reward counts only once the bank payment has actually arrived. Starting an order or asking for details does not count.
7. If a person opens several links, only the first one counts.
8. Opening a link on one device and topping up on another does not count.

## Who is paid

9. Rewards go only to wallets verified with GoodDollar.
10. Each person is rewarded once, however many wallets they have. GoodDollar tells us which wallets belong to the same person.
11. Nobody is paid for inviting themselves, including with a second wallet.
12. One person is paid for at most 20 friends. After that, new friends still get their own bonus, but the inviter gets nothing more.
13. If an inviter is not verified, the friend is still paid and the inviter's share is held. If the friend is not verified, both are held.
14. Existing customers who have already finished a top-up are not "new" and get no bonus.

## How payment works

15. Rewards are never sent automatically. Each one is recorded, then checked by a person, then sent by hand to the wallet. This can take a few days.
16. A held reward can be paid later, once the wallet is verified with GoodDollar.
17. Links made to claim rewards over and over are not paid.

## When the campaign stops

18. The campaign ends on 31 December 2026 at 23:59 UTC, or when the budget is used up, whichever comes first.
19. The budget is G$ 3,500,000 in total, friend bonuses and inviter rewards together. That is about 500 friends, around $365 at the 19 November 2026 price.
20. What counts is when the friend started their top-up. A top-up started before the end still counts if the bank payment arrives after it.
21. When the campaign is closed, the app stops promising a reward and the invite screen says the rewards have ended. Rewards already recorded are still paid.

## What we reserve

22. GoodCash can change or end the campaign, and can refuse any reward that looks like abuse.

## Settings in the code

- Friend bonus and inviter reward: `REFERRAL.newG` and `REFERRAL.inviterG` in `services/orders/src/referral.ts`.
- Minimum first top-up: `REFERRAL.minNaira`.
- End date and total budget: `REFERRAL.endsAt` and `REFERRAL.budgetG`. Two top-ups settling at the very same moment can overshoot the budget by one reward. That is accepted.
- Friends one person can be paid for: `REFERRAL.maxPerInviter`, and `MAX_FRIENDS` in `scripts/referral-payouts.mjs`. Keep the two equal.
- The amounts shown to a friend before they top up come from the server, so there is nothing to keep in step.

## Paying out

Run these from `/Users/admin/Documents/GoodCash/services/orders`.

1. `node ../../scripts/referral-payouts.mjs --csv > rewards.csv` writes the list. It reads the waiting rewards, asks GoodDollar's Identity contract on Celo who each wallet belongs to, and gives every line PAY, HOLD (with the reason) or PAID.
2. Send the G$ by hand for the PAY lines only.
3. `node ../../scripts/referral-payouts.mjs --mark-paid rewards.csv` shows what would be marked as paid. It writes nothing.
4. `node ../../scripts/referral-payouts.mjs --mark-paid rewards.csv --yes` marks those lines as paid.

Use the same file for steps 3 and 4 that you paid from. A line is marked only if it matches a real reward (same wallet, same amount) and is not already marked, so a wrong or old file marks nothing. Paid lines still count toward "one person once" and the 20 friends limit. Listing never changes anything; only `--mark-paid ... --yes` writes.
