// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script, console2} from "forge-std/Script.sol";
import {GoodCashRouterV2} from "../src/GoodCashRouterV2.sol";

/*──────────────────────────────────────────────────────────────────────────────
  Deploy GoodCashRouterV2 (the one-tap router) to Celo mainnet.

  READ BEFORE RUNNING
  • ADMIN_ADDRESS must be your Safe MULTISIG address, not a personal wallet. The owner is built into
    the contract and cannot be changed later.
  • The wallet that pays for the deploy (PRIVATE_KEY) does NOT become the owner and keeps no power.
  • The router starts PAUSED. The Safe must approve a transaction to unpause it.
  • Run it yourself. Never paste your private key anywhere except your own terminal.

  Usage (from packages/contracts):
      source .env     # loads PRIVATE_KEY, ADMIN_ADDRESS, CELO_RPC_URL
      forge script script/DeployV2.s.sol --rpc-url $CELO_RPC_URL --broadcast
──────────────────────────────────────────────────────────────────────────────*/

contract DeployV2 is Script {
    address constant G_DOLLAR_ADDR = 0x62B8B11039FcfE5aB0C56E502b1C372A3d2a9c7A;
    address constant USDM_ADDR = 0x765DE816845861e75A25fCA122bb6898B8B1282a;
    address constant USDT_ADDR = 0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e;
    address constant BROKER_ADDR = 0x88de45906D4F5a57315c133620cfa484cB297541;
    address constant EXCH_PROVIDER = 0x2fFBB49055d487DdBBb0C052Cd7c2a02A7971e41;
    bytes32 constant EXCHANGE_ID = 0xba77f5c7bb3317643c6d81d1ef3f9913561741d92095f88efa402faf2cbe9124;
    address constant UNISWAP_ROUTER = 0x5615CDAb10dc425a742d643d949a7F474C01abc4;

    function run() external {
        require(block.chainid == 42220, "DeployV2: wrong chain, expected Celo mainnet 42220");

        address owner = vm.envAddress("ADMIN_ADDRESS");
        require(owner != address(0), "DeployV2: ADMIN_ADDRESS not set");
        // A multisig is a contract. A personal wallet is not. Refuse a personal wallet by mistake.
        require(owner.code.length > 0, "DeployV2: ADMIN_ADDRESS is not a contract. Use your Safe multisig address.");

        console2.log("=== GoodCashRouterV2 deploy ===");
        console2.log("Deployer:", msg.sender);
        console2.log("Owner (Safe):", owner);

        vm.startBroadcast();
        GoodCashRouterV2 router = new GoodCashRouterV2(
            G_DOLLAR_ADDR, USDM_ADDR, USDT_ADDR, BROKER_ADDR, EXCH_PROVIDER, EXCHANGE_ID, UNISWAP_ROUTER, owner
        );
        vm.stopBroadcast();

        require(router.OWNER() == owner, "DeployV2: owner mismatch");
        require(router.paused(), "DeployV2: not paused");
        require(address(router.G_DOLLAR()) == G_DOLLAR_ADDR, "DeployV2: G$ mismatch");
        require(address(router.USDT()) == USDT_ADDR, "DeployV2: USDT mismatch");

        console2.log("GoodCashRouterV2:", address(router));
        console2.log("Next: verify the source, then have the Safe unpause it, then give me the address.");
    }
}
