# Quote engine notes

This module uses bigint math throughout the client so that token values remain exact and no floating-point money math is introduced.

## Core formulas

### Reserve route

The GoodDollar Reserve quote is derived from the verified `currentPrice` for the G$/USDm exchange and a hard-coded 10% exit contribution.

```ts
const grossUsdm = (amountIn * reserveCurrentPriceRaw) / 1e18;
const netUsdm = (grossUsdm * (10_000 - 1_000)) / 10_000;
```

This is equivalent to multiplying by 0.9, which matches the verified Reserve exit contribution of 10%.

### Uniswap route

The fallback route uses the quoted G$/USDm pool price:

```ts
const grossUsdm = (amountIn * uniswapPriceRaw) / 1e18;
```

The price-impact guard ensures the pool is deep enough and that the route remains below the 10% limit.

```ts
const impactBps = (amountIn * 100n) / poolDepthUsdm;
if (impactBps > 1_000n) reject;
if (poolDepthUsdm < amountIn * 10n) reject;
```

### USDm -> USDT conversion

The app treats USDM and USDT as near 1:1 on Celo and converts with decimal normalization:

```ts
const usdtOut = (amountUsdm * 1e6) / 1e18;
```

## Worked examples

### 1,000 G$

At the verified gross price of roughly `0.000126658838` USD per G$:

```text
amountIn = 1_000e18
grossUsdm = ~126.658838e18
netUsdm = ~113.992939e18
usdtOut ~= 113.992939e6
```

This is the expected route output for a Reserve quote using the 10% exit contribution.

### 4,386 G$

This is approximately the amount required for a first $0.50 cash-out based on the verified daily UBI and net price:

```text
amountIn = 4_386.24 G$
netUsd ~= $0.50
```

At current rates, a user needs about 35.5 days of daily claiming to reach that threshold. The app should therefore display a countdown and never present a cash-out CTA as if the user is immediately eligible.

## Route selection policy

1. Prefer the Reserve route when it is within 1% of the Uniswap route.
2. Use Uniswap only when the Reserve route is paused, at capacity, or more than 1% worse.
3. Refuse any quote if the route impact exceeds 10%.
4. Refuse any quote whose pool depth is less than 10× the swap size.
5. Reject expired quotes after 30 seconds.
