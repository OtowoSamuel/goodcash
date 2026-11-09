/** Everything GoodCash touches on Celo mainnet. One list, used by the app, the server and the SDK. */
import type { Hex } from './hex';

export const CELO_CHAIN_ID = 42220;
export const CELO_CHAIN_HEX = '0xa4ec';
export const CELO_RPC_DEFAULT = 'https://forno.celo.org';

export const G_DOLLAR: Hex = '0x62B8B11039FcfE5aB0C56E502b1C372A3d2a9c7A';
export const USDT: Hex = '0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e';
export const USDM: Hex = '0x765DE816845861e75A25fCA122bb6898B8B1282a';

/** The original three-step router (owner: team wallet). */
export const ROUTER_V1: Hex = '0xA4338586d4B2f0E1641C54b8cF0d53CD06B5c407';
/** The one-tap router customers use (owner: the GoodCash Safe; it can only pause). */
export const ROUTER_V2: Hex = '0x546698368a246539Df5e641EdC2b79c5782ea359';
export const GOODCASH_SAFE: Hex = '0x735Ef948F746bc141D04042d2A18aA7f967bce2f';

/** GoodDollar reserve (Mento broker), used for the G$ -> USDm price. */
export const BROKER: Hex = '0x88de45906D4F5a57315c133620cfa484cB297541';
export const EXCHANGE_PROVIDER: Hex = '0x2fFBB49055d487DdBBb0C052Cd7c2a02A7971e41';
export const EXCHANGE_ID: Hex = '0xba77f5c7bb3317643c6d81d1ef3f9913561741d92095f88efa402faf2cbe9124';
/** Uniswap V3 QuoterV2 on Celo, used for the USDm -> USDT price (0.01% pool). */
export const QUOTER_V2: Hex = '0x82825d0554fA07f7FC52Ab63c961F330fdEFa8E8';
export const USDM_USDT_FEE = 100;
/** Celo's own price feed (dollars per CELO). */
export const SORTED_ORACLES: Hex = '0xefB84935239dAcdecF7c5bA76d8dE40b077B7b33';

/** keccak256("CashOutPaid(address,address,uint256,uint256,uint256,uint256,uint8,bytes32)") */
export const CASH_OUT_PAID_TOPIC: Hex = '0xf76a7b57d20e27c73ccada71d551173e9a82e46372f8dedf840cb08ad5ea60d7';

export const SELECTORS = {
  transferAndCall: '0x4000aea0', // transferAndCall(address,uint256,bytes)
  balanceOf: '0x70a08231', // balanceOf(address)
  paused: '0x5c975abb', // paused()
  getAmountOut: '0xa20f2305', // getAmountOut(address,bytes32,address,address,uint256)
  quoteExactInputSingle: '0xc6a5026a', // quoteExactInputSingle((address,address,uint256,uint24,uint160))
  medianRate: '0xef90e1b0', // medianRate(address)
} as const;
