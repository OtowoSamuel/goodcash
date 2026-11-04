#!/usr/bin/env bash
set -euo pipefail

RPC="${CELO_RPC_URL:-https://forno.celo.org}"

G=0x62B8B11039FcfE5aB0C56E502b1C372A3d2a9c7A
USDM=0x765DE816845861e75A25fCA122bb6898B8B1282a
USDT=0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e
USDC=0xcebA9300f2b948710d2653dD7B07f33A8B32118C
NGNM=0xE2702Bd97ee33c88c8f6f92DA3B733608aa76F71

BROKER=0x88de45906D4F5a57315c133620cfa484cB297541
PROVIDER=0x2fFBB49055d487DdBBb0C052Cd7c2a02A7971e41
EXID=0xba77f5c7bb3317643c6d81d1ef3f9913561741d92095f88efa402faf2cbe9124
RESERVE=0x94A3240f484A04F5e3d524f528d02694c109463b

UBI=0x43d72Ff17701B2DA814620735C39C620Ce0ea4A1
POOL=0x9491d57c5687AB75726423B55AC2d87D1cDa2c3F

json_call() {
  cast call "$1" "$2" "${@:3}" --rpc-url "$RPC" --json
}

one() {
  json_call "$@" | jq -r '.[0]'
}

line() {
  printf '%s\n' "------------------------------------------------------------------------"
}

fail() {
  printf '\nFAIL: %s\n' "$1" >&2
  exit 1
}

line
printf 'GoodCash verification spike\n'
printf 'RPC: %s\n' "$RPC"
printf 'Time: %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
line

printf '\n[1] Token identity\n'
for token in "$G" "$USDM" "$USDT" "$USDC" "$NGNM"; do
  symbol=$(one "$token" "symbol()(string)")
  decimals=$(one "$token" "decimals()(uint8)")
  printf '  %-18s %s  decimals=%s\n' "$symbol" "$token" "$decimals"
done

[[ "$(one "$G" "symbol()(string)")" == 'G$' ]] || fail "G\$ symbol mismatch"
[[ "$(one "$G" "decimals()(uint8)")" == '18' ]] || fail "G\$ decimals mismatch"
[[ "$(one "$USDM" "symbol()(string)")" == 'USDm' ]] || fail "USDm symbol mismatch"
[[ "$(one "$USDM" "decimals()(uint8)")" == '18' ]] || fail "USDm decimals mismatch"
[[ "$(one "$USDT" "decimals()(uint8)")" == '6' ]] || fail "USDT decimals mismatch"
[[ "$(one "$USDC" "decimals()(uint8)")" == '6' ]] || fail "USDC decimals mismatch"
[[ "$(one "$NGNM" "decimals()(uint8)")" == '18' ]] || fail "NGNm decimals mismatch"

line
printf '\n[2] GoodDollar Broker and Exchange Provider\n'
PROVIDERS=$(json_call "$BROKER" "getExchangeProviders()(address[])")
printf '  Broker: %s\n' "$BROKER"
printf '  Providers:\n'
printf '%s\n' "$PROVIDERS" | jq -r '.[0][] | "    " + .'

printf '  Reserve proxy: %s\n' "$RESERVE"
printf '  Exchange ids from provider:\n'
json_call "$PROVIDER" "getExchangeIds()(bytes32[])" | jq -r '.[0][] | "    " + .'

line
printf '\n[3] G$/USDm exchange tuple\n'
EX=$(json_call "$PROVIDER" "exchanges(bytes32)(address,address,uint256,uint256,uint32,uint32)" "$EXID")
RESERVE_ASSET=$(printf '%s' "$EX" | jq -r '.[0]')
TOKEN=$(printf '%s' "$EX" | jq -r '.[1]')
SUPPLY=$(printf '%s' "$EX" | jq -r '.[2]')
RESERVE_BAL=$(printf '%s' "$EX" | jq -r '.[3]')
RATIO=$(printf '%s' "$EX" | jq -r '.[4]')
EXIT=$(printf '%s' "$EX" | jq -r '.[5]')

printf '  exchangeId:      %s\n' "$EXID"
printf '  reserve asset:   %s\n' "$RESERVE_ASSET"
printf '  token:           %s\n' "$TOKEN"
printf '  token supply:    %s\n' "$SUPPLY"
printf '  reserve balance: %s\n' "$RESERVE_BAL"
printf '  reserve ratio:   %s (1e8 scale)\n' "$RATIO"
printf '  exit contribution: %s (1e8 scale)\n' "$EXIT"

[[ "$RESERVE_ASSET" == "$USDM" ]] || fail "exchange reserve asset is not USDm"
[[ "$TOKEN" == "$G" ]] || fail "exchange token is not G\$"
[[ "$EXIT" == '10000000' ]] || fail "exit contribution is not 10% (got $EXIT / 1e8)"

line
printf '\n[4] Reserve quotes\n'
GROSS_PRICE=$(one "$PROVIDER" "currentPrice(bytes32)(uint256)" "$EXID")
Q1000=$(one "$PROVIDER" "getAmountOut(bytes32,address,address,uint256)(uint256)" "$EXID" "$G" "$USDM" "1000000000000000000000")
QENTRY=$(one "$PROVIDER" "getAmountOut(bytes32,address,address,uint256)(uint256)" "$EXID" "$USDM" "$G" "1000000000000000000")
Q10000=$(one "$PROVIDER" "getAmountOut(bytes32,address,address,uint256)(uint256)" "$EXID" "$G" "$USDM" "10000000000000000000000")

printf '  currentPrice raw:   %s\n' "$GROSS_PRICE"
printf '  1000 G$  -> USDm:   %s wei\n' "$Q1000"
printf '  1 USDm   -> G$:     %s wei\n' "$QENTRY"
printf '  10000 G$ -> USDm:   %s wei\n' "$Q10000"

python3 - "$GROSS_PRICE" "$Q1000" "$QENTRY" "$Q10000" <<'PY'
import sys
gross_raw, q1000, qentry, q10000 = map(int, sys.argv[1:])
gross = gross_raw / 1e18
net = q1000 / 1e18 / 1000
entry = qentry / 1e18
big = q10000 / 1e18 / 10000
print(f"  gross price:        ${gross:.12f}/G$")
print(f"  net price (1000):   ${net:.12f}/G$")
print(f"  entry:              1 USDm -> {qentry/1e18:.4f} G$ (implied ${1/(qentry/1e18):.12f}/G$)")
print(f"  net price (10000):  ${big:.12f}/G$")
expected = gross * 0.90
diff = abs(net - expected) / expected
print(f"  expected net (0.9x): ${expected:.12f}/G$  diff={diff*100:.3f}%")
if diff > 0.05:
    raise SystemExit("FAIL: net quote differs from gross*0.9 by more than 5%")
PY

line
printf '\n[5] UBI scheme\n'
DAY=$(one "$UBI" "currentDay()(uint256)")
DAILY=$(one "$UBI" "dailyUbi()(uint256)")
STATS=$(json_call "$UBI" "getDailyStats()(uint256,uint256)")
CLAIMERS=$(printf '%s' "$STATS" | jq -r '.[0]')
CLAIMED=$(printf '%s' "$STATS" | jq -r '.[1]')
CLAIMER_COUNT=$(one "$UBI" "getClaimerCount(uint256)(uint256)" "$DAY")
CLAIM_AMOUNT=$(one "$UBI" "getClaimAmount(uint256)(uint256)" "$DAY")

printf '  currentDay:        %s\n' "$DAY"
printf '  dailyUbi:          %s wei\n' "$DAILY"
printf '  getDailyStats:     claimers=%s claimed=%s wei\n' "$CLAIMERS" "$CLAIMED"
printf '  getClaimerCount:   %s\n' "$CLAIMER_COUNT"
printf '  getClaimAmount:    %s wei\n' "$CLAIM_AMOUNT"

python3 - "$DAILY" "$CLAIMERS" "$CLAIMED" "$CLAIMER_COUNT" "$CLAIM_AMOUNT" <<'PY'
import sys
daily, claimers, claimed, claimer_count, claim_amount = map(int, sys.argv[1:])
d = daily / 1e18
print(f"  per-user entitlement: {d:.9f} G$")
if claimers:
    print(f"  cross-check:          {claim_amount/1e18/claimers:.6f} G$/claimer")
    print(f"  total claimed:        {claimed/1e18:.6f} G$")
print(f"  claimers (count):     {claimer_count}")
PY

line
printf '\n[6] Uniswap G$/USDm pool\n'
T0=$(one "$POOL" "token0()(address)")
T1=$(one "$POOL" "token1()(address)")
FEE=$(one "$POOL" "fee()(uint24)")
SLOT0=$(json_call "$POOL" "slot0()(uint160,int24,uint16,uint16,uint16,uint8,bool)")
SQRT=$(printf '%s' "$SLOT0" | jq -r '.[0]')
TICK=$(printf '%s' "$SLOT0" | jq -r '.[1]')
LIQ=$(one "$POOL" "liquidity()(uint128)")
GBAL=$(one "$G" "balanceOf(address)(uint256)" "$POOL")
UBAL=$(one "$USDM" "balanceOf(address)(uint256)" "$POOL")

printf '  token0:   %s\n' "$T0"
printf '  token1:   %s\n' "$T1"
printf '  fee:      %s (1e6 scale)\n' "$FEE"
printf '  sqrtP:    %s\n' "$SQRT"
printf '  tick:     %s\n' "$TICK"
printf '  liquidity:%s\n' "$LIQ"
printf '  G$ bal:   %s wei\n' "$GBAL"
printf '  USDm bal: %s wei\n' "$UBAL"

python3 - "$SQRT" "$GBAL" "$UBAL" <<'PY'
import sys
sqrtp, gbal, ubal = map(int, sys.argv[1:])
price = (sqrtp / 2**96) ** 2
g = gbal / 1e18
u = ubal / 1e18
print(f"  implied price: ${price:.12f}/G$")
print(f"  balances:      {g:,.2f} G$ / {u:,.4f} USDm")
print(f"  approx TVL:    ${g*price + u:,.2f}")
PY

line
printf '\nVERIFY OK: token identities, 10%% exit contribution, quotes, UBI and pool data confirmed.\n'
