# GoodCash Referral Campaign: Rules

Written 24 November 2026, replacing the 19 November version (a first top-up of ₦2,000 earned a bonus; nobody ever qualified, so no reward was owed when it was replaced). These match what the code does (`services/orders/src/referral.ts`). If you change a rule in the code, change it here too.

## The reward

1. For every 2 friends who count, the person who shared the link gets G$ 6,500. That is about ₦1,000 in the bank after every fee at the 24 November 2026 price, and it is more than the smallest cash out, so it can be cashed out straight away.
2. The reward is a fixed amount of G$, so its naira value moves with the G$ price. The invite screen shows today's naira value.
3. Nobody pays anything to take part. Rewards are paid by GoodCash, never from other people's money.
4. Each person earns only from the friends they invited themselves. Nothing is paid for friends of friends.

## How a friend counts

5. The friend opens the inviter's link, connects their wallet in GoodCash on the same phone or browser, and taps Accept. Their wallet signs a free message naming the inviter, so nobody can sign up someone else's wallet under their link. They must accept before they verify.
6. GoodDollar verifies the friend for the first time after that (the free face check). Someone who was already verified with GoodDollar before opening the link does not count, even with a new wallet.
7. The friend claims their free G$ at least once after opening the link (in the GoodDollar app or anywhere else).
8. If a person opens several links, only the first one they connect with counts.
9. A friend has 30 days from connecting to verify and claim.

## Who is paid

10. The inviter must be verified with GoodDollar. While they are not, their friends wait and are counted once they verify.
11. Each person counts once, for one inviter, however many wallets they have. GoodDollar tells us which wallets belong to the same person.
12. Nobody counts as their own friend, including with a second wallet.
13. One person can be counted for at most 20 friends, which is 10 rewards (about ₦10,000).
14. The reward goes to the wallet whose link was used.

## How payment works

15. Everything is checked automatically, on the chain, every 10 minutes, a few friends per run in turn so nobody is skipped. No form and no waiting for a person.
16. A reward is sent automatically from the GoodCash referral wallet, usually within a day of the second friend counting.
17. Every payment is checked again later. If it failed, or no receipt appears within 30 minutes, it is not retried by itself. It is marked for the team to look at, so nobody is ever paid twice.
18. At most G$ 100,000 of rewards are paid per day (about 15 rewards). Rewards over that wait for the next day.

## When the campaign stops

19. The campaign ends on 31 December 2026 at 23:59 UTC, or when the budget is used up, whichever comes first. A friend must connect before the end.
20. The budget is G$ 3,500,000 of rewards in total, about 538 rewards, which is about 1,070 friends.
21. When the campaign is closed, the invite screen says the rewards have ended. Rewards already earned are still paid.

## What we reserve

22. GoodCash can change or end the campaign, and can refuse any reward that looks like abuse.

## Settings in the code

- Reward size, friends per reward, friends per person, end date, budget and the 30-day wait: `REFERRAL` in `services/orders/src/referral.ts`.
- Paying on or off: `REFERRAL_PAY_ENABLED` in `services/orders/wrangler.toml` (`"true"` or `"false"`). Checking friends runs either way, so nothing is lost while paying is off.
- Most G$ paid per day: `REFERRAL_DAILY_G` in `services/orders/wrangler.toml`.
- The referral wallet's key: the Worker secret `REFERRAL_KEY`. Without it nothing is paid.

## Running it

1. Create a new wallet for referrals only. Keep a small amount in it: a week of rewards and about 0.5 CELO for its own network fees.
2. Set its key: `cd /Users/admin/Documents/GoodCash/services/orders && npx wrangler secret put REFERRAL_KEY`
3. Set `REFERRAL_PAY_ENABLED = "true"` and deploy.
4. Each week, send that wallet the G$ you want to spend that week from the GoodCash voting wallet. The referral wallet can only spend what is in it, and pauses by itself when it runs low.

A failed payment shows as `status: "check"` in the reward record (`refpay:<inviter person>:<n>` in ORDER_STORE). Look up the inviter's wallet on the chain before paying it by hand, then set the record's status to `"paid"`.
