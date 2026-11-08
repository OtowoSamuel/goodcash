-- GoodCash: summary (cash outs, G$ moved, wallets)
-- Every cash out sends G$ into one of the two GoodCash routers. We count those G$ Transfer events.
WITH routers AS (
  SELECT 0xA4338586d4B2f0E1641C54b8cF0d53CD06B5c407 AS addr
  UNION ALL SELECT 0x546698368a246539Df5e641EdC2b79c5782ea359
),
cashouts AS (
  SELECT
    l.block_time,
    l.tx_hash,
    bytearray_substring(l.topic1, 13, 20) AS wallet,
    bytearray_to_uint256(l.data) / 1e18 AS g_amount
  FROM celo.logs l
  WHERE l.contract_address = 0x62B8B11039FcfE5aB0C56E502b1C372A3d2a9c7A
    AND l.topic0 = 0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef -- Transfer
    AND bytearray_substring(l.topic2, 13, 20) IN (SELECT addr FROM routers)
    AND l.block_time >= TIMESTAMP '2026-10-01'
)
SELECT
  COUNT(*)                          AS cash_outs,
  ROUND(SUM(g_amount))              AS g_dollars_moved,
  COUNT(DISTINCT wallet)            AS wallets,
  ROUND(AVG(g_amount))              AS average_cash_out_g,
  MIN(block_time)                   AS first_cash_out,
  MAX(block_time)                   AS latest_cash_out
FROM cashouts;
