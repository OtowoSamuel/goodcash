-- GoodCash: how many cash outs used the one-tap router vs the original router
SELECT
  CASE bytearray_substring(l.topic2, 13, 20)
    WHEN 0x546698368a246539Df5e641EdC2b79c5782ea359 THEN 'One-tap router'
    ELSE 'Original router'
  END AS router,
  COUNT(*)                                        AS cash_outs,
  ROUND(SUM(bytearray_to_uint256(l.data) / 1e18)) AS g_dollars_moved
FROM celo.logs l
WHERE l.contract_address = 0x62B8B11039FcfE5aB0C56E502b1C372A3d2a9c7A
  AND l.topic0 = 0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef
  AND bytearray_substring(l.topic2, 13, 20) IN (
    0xA4338586d4B2f0E1641C54b8cF0d53CD06B5c407,
    0x546698368a246539Df5e641EdC2b79c5782ea359
  )
  AND l.block_time >= TIMESTAMP '2026-10-01'
GROUP BY 1
ORDER BY 2 DESC;
