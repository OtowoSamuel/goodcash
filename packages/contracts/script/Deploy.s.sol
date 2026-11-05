// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script, console2} from "forge-std/Script.sol";
import {GoodCashRouter} from "../src/GoodCashRouter.sol";

/*──────────────────────────────────────────────────────────────────────────────
  Deploy.s.sol — GoodCashRouter mainnet deployment script
  ══════════════════════════════════════════════════════════════════════════════

  Usage:
      source .env   # loads PRIVATE_KEY, ADMIN_ADDRESS, CELO_RPC_URL, CELOSCAN_API_KEY

      # Dry-run (no broadcast):
      forge script packages/contracts/script/Deploy.s.sol \
          --rpc-url $CELO_RPC_URL --chain-id 42220 --legacy

      # Live deploy + verify:
      forge script packages/contracts/script/Deploy.s.sol \
          --rpc-url $CELO_RPC_URL --chain-id 42220 --legacy \
          --broadcast --verify --etherscan-api-key $CELOSCAN_API_KEY \
          --private-key $PRIVATE_KEY

  Non-negotiables enforced:
  - Owner is set to ADMIN_ADDRESS (a Safe multisig in production).
  - Contract starts PAUSED at deploy (enforced in constructor).
  - No secrets in this file; all loaded from environment.
  - Celo requires --legacy (no EIP-1559 maxFeePerGas support from external wallets).
──────────────────────────────────────────────────────────────────────────────*/

contract Deploy is Script {

    // ── Celo mainnet addresses (verified in Prompt 1 / docs/VERIFY_OUTPUT.txt) ──
    address constant G_DOLLAR_ADDR  = 0x62B8B11039FcfE5aB0C56E502b1C372A3d2a9c7A;
    address constant USDM_ADDR      = 0x765DE816845861e75A25fCA122bb6898B8B1282a;
    address constant USDT_ADDR      = 0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e;
    address constant BROKER_ADDR    = 0x88de45906D4F5a57315c133620cfa484cB297541;
    address constant EXCH_PROVIDER  = 0x2fFBB49055d487DdBBb0C052Cd7c2a02A7971e41;
    bytes32 constant EXCHANGE_ID    =
        0xba77f5c7bb3317643c6d81d1ef3f9913561741d92095f88efa402faf2cbe9124;
    address constant UNISWAP_ROUTER = 0x5615CDAb10dc425a742d643d949a7F474C01abc4;

    function run() external {
        // ── Gate: enforce chainId ─────────────────────────────────────────
        require(block.chainid == 42220, "Deploy: wrong chainId - expected Celo mainnet 42220");

        // ── Load owner from environment ───────────────────────────────────
        address owner = vm.envAddress("ADMIN_ADDRESS");
        require(owner != address(0), "Deploy: ADMIN_ADDRESS not set");

        console2.log("=== GoodCashRouter Deploy ===");
        console2.log("Chain ID  :", block.chainid);
        console2.log("Deployer  :", msg.sender);
        console2.log("Owner     :", owner);
        console2.log("G$        :", G_DOLLAR_ADDR);
        console2.log("USDm      :", USDM_ADDR);
        console2.log("USDT      :", USDT_ADDR);
        console2.log("Broker    :", BROKER_ADDR);
        console2.log("Provider  :", EXCH_PROVIDER);
        console2.log("Router    :", UNISWAP_ROUTER);

        vm.startBroadcast();

        GoodCashRouter router = new GoodCashRouter(
            G_DOLLAR_ADDR,
            USDM_ADDR,
            USDT_ADDR,
            BROKER_ADDR,
            EXCH_PROVIDER,
            EXCHANGE_ID,
            UNISWAP_ROUTER,
            owner
        );

        vm.stopBroadcast();

        // ── Post-deploy assertions (read-only, no broadcast needed) ──────
        require(router.OWNER()    == owner,         "Deploy: owner mismatch");
        require(router.paused()   == true,          "Deploy: not paused");
        require(address(router.G_DOLLAR()) == G_DOLLAR_ADDR, "Deploy: G$ mismatch");
        require(address(router.USDM())     == USDM_ADDR,     "Deploy: USDm mismatch");
        require(address(router.USDT())     == USDT_ADDR,     "Deploy: USDT mismatch");
        require(address(router.BROKER())   == BROKER_ADDR,   "Deploy: broker mismatch");
        require(router.EXCHANGE_ID()       == EXCHANGE_ID,   "Deploy: exchangeId mismatch");

        console2.log("");
        console2.log("=== Deployment SUCCESS ===");
        console2.log("GoodCashRouter:", address(router));
        console2.log("owner()       :", router.OWNER());
        console2.log("paused()      :", router.paused());
        console2.log("All immutable checks PASSED.");
        console2.log("");
        console2.log("Next steps:");
        console2.log("  1. Verify source: see --verify flag above, or run script/verify_contract.sh");
        console2.log("  2. Run test swap: script/TestSwap.s.sol");
        console2.log("  3. Re-pause after test swap.");
        console2.log("  4. Update docs/DEPLOYMENT.md with the tx hashes.");
    }
}
