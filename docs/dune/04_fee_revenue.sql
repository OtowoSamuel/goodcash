-- GoodCash: fee revenue (USDT received by the GoodCash Safe)
-- The payout partner pays GoodCash's 1% fee to the Safe in USDT when an order settles.
-- This counts every USDT transfer INTO the Safe. If the Safe ever receives USDT for another reason, filter by sender.
SELECT
  date_trunc('day', l.block_time)                        AS day,
  COUNT(*)                                               AS payments,
  ROUND(SUM(bytearray_to_uint256(l.data) / 1e6), 4)      AS usdt_received
FROM celo.logs l
WHERE l.contract_address = 0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e -- USDT on Celo
  AND l.topic0 = 0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef -- Transfer
  AND bytearray_substring(l.topic2, 13, 20) = 0x735Ef948F746bc141D04042d2A18aA7f967bce2f -- GoodCash Safe
  AND l.block_time >= TIMESTAMP '2026-11-08'
GROUP BY 1
ORDER BY 1;
