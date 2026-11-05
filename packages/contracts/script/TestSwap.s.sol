// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script, console2} from "forge-std/Script.sol";
import {IERC20} from "openzeppelin-contracts/contracts/token/ERC20/IERC20.sol";
import {GoodCashRouter} from "../src/GoodCashRouter.sol";
import {ISwapRouter02} from "../src/interfaces/ISwapRouter02.sol";

/*──────────────────────────────────────────────────────────────────────────────
  TestSwap.s.sol — Post-deploy test swap: buy G$, then swap 1,000 G$ → USDT
  ══════════════════════════════════════════════════════════════════════════════

  This script:
    1. Buys 1,100 G$ with CELO via Uniswap V3 (CELO → USDm → G$).
    2. Calls cashOut(RESERVE_THEN_UNISWAP, 1000e18, minOut, deadline, recipient).
    3. Verifies USDT arrived at deployer and router balance is zero.
    4. The contract is assumed to be UNPAUSED by the owner before running.
    5. After the swap completes, the owner should re-pause.

  Usage:
      source .env
      ROUTER=<deployed_router_address> forge script packages/contracts/script/TestSwap.s.sol \
          --rpc-url $CELO_RPC_URL --chain-id 42220 --legacy \
          --broadcast --private-key $PRIVATE_KEY -vvv

  IMPORTANT: Run only after the owner has unpaused the router.
──────────────────────────────────────────────────────────────────────────────*/

interface IWrappedCelo {
    function deposit() external payable;
    function withdraw(uint256) external;
    function balanceOf(address) external view returns (uint256);
    function approve(address, uint256) external returns (bool);
}

contract TestSwap is Script {

    // Celo mainnet token addresses
    address constant G_DOLLAR_ADDR  = 0x62B8B11039FcfE5aB0C56E502b1C372A3d2a9c7A;
    address constant USDM_ADDR      = 0x765DE816845861e75A25fCA122bb6898B8B1282a;
    address constant USDT_ADDR      = 0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e;
    address constant CELO_NATIVE    = 0x471EcE3750Da237f93B8E339c536989b8978a438; // CELO ERC20
    address constant UNISWAP_ROUTER = 0x5615CDAb10dc425a742d643d949a7F474C01abc4;

    // G$/USDm Uniswap V3 pool fee tier (1%)
    uint24 constant G_USDM_FEE   = 10_000;
    // CELO/USDm fee tier — use 500 (most liquid on Celo)
    uint24 constant CELO_USDM_FEE = 500;

    uint256 constant SWAP_AMOUNT = 1_000e18; // 1,000 G$ to swap via router

    function run() external {
        require(block.chainid == 42220, "TestSwap: wrong chainId");

        address routerAddr = vm.envAddress("ROUTER");
        require(routerAddr != address(0), "TestSwap: ROUTER env var not set");
        require(!GoodCashRouter(routerAddr).paused(), "TestSwap: router is paused - owner must unpause first");

        address deployer = msg.sender;

        console2.log("=== TestSwap ===");
        console2.log("Router   :", routerAddr);
        console2.log("Deployer :", deployer);

        uint256 usdtBefore = IERC20(USDT_ADDR).balanceOf(deployer);
        uint256 gBefore    = IERC20(G_DOLLAR_ADDR).balanceOf(deployer);

        vm.startBroadcast();
        if (gBefore < SWAP_AMOUNT) {
            _buyGDollar(deployer);
        }
        uint256 usdtOut = _doRouterSwap(routerAddr, deployer);
        vm.stopBroadcast();

        _verify(routerAddr, deployer, usdtBefore, usdtOut, gBefore);
    }

    /// @dev Step 1: Buy G$ using CELO (CELO -> USDm -> G$ via Uniswap V3)
    function _buyGDollar(address deployer) internal {
        uint256 celoToSpend = 0.3 ether;
        IERC20(CELO_NATIVE).approve(UNISWAP_ROUTER, celoToSpend);

        // CELO -> USDm (fee 500)
        uint256 usdmOut = ISwapRouter02(UNISWAP_ROUTER).exactInputSingle(
            ISwapRouter02.ExactInputSingleParams({
                tokenIn: CELO_NATIVE, tokenOut: USDM_ADDR, fee: CELO_USDM_FEE,
                recipient: deployer, amountIn: celoToSpend, amountOutMinimum: 1, sqrtPriceLimitX96: 0
            })
        );
        console2.log("USDm from CELO:", usdmOut);

        // USDm -> G$ (fee 10000)
        IERC20(USDM_ADDR).approve(UNISWAP_ROUTER, usdmOut);
        uint256 gOut = ISwapRouter02(UNISWAP_ROUTER).exactInputSingle(
            ISwapRouter02.ExactInputSingleParams({
                tokenIn: USDM_ADDR, tokenOut: G_DOLLAR_ADDR, fee: G_USDM_FEE,
                recipient: deployer, amountIn: usdmOut, amountOutMinimum: 500e18, sqrtPriceLimitX96: 0
            })
        );
        console2.log("G$ bought:", gOut);
        require(gOut >= SWAP_AMOUNT, "TestSwap: not enough G$ bought");
    }

    /// @dev Step 2: Route 1,000 G$ -> USDT via GoodCashRouter
    function _doRouterSwap(address routerAddr, address deployer) internal returns (uint256 usdtOut) {
        IERC20(G_DOLLAR_ADDR).approve(routerAddr, SWAP_AMOUNT);
        usdtOut = GoodCashRouter(routerAddr).cashOut(
            GoodCashRouter.Route.RESERVE_THEN_UNISWAP,
            SWAP_AMOUNT,
            90_000,              // minOut: 0.09 USDT (18% slack for thin USDm/USDT pool)
            block.timestamp + 300,
            deployer,
            bytes32(uint256(0x1))
        );
        console2.log("USDT out:", usdtOut);
    }

    function _verify(
        address routerAddr,
        address deployer,
        uint256 usdtBefore,
        uint256 usdtOut,
        uint256 gConsumed
    ) internal view {
        IERC20 gDollar = IERC20(G_DOLLAR_ADDR);
        IERC20 usdt    = IERC20(USDT_ADDR);

        uint256 usdtAfter = usdt.balanceOf(deployer);
        uint256 rG        = gDollar.balanceOf(routerAddr);
        uint256 rUsdm     = IERC20(USDM_ADDR).balanceOf(routerAddr);
        uint256 rUsdt     = usdt.balanceOf(routerAddr);

        console2.log("");
        console2.log("=== Results ===");
        console2.log("USDT received :", usdtOut);
        console2.log("USDT balance  :", usdtAfter);
        console2.log("G$ consumed   :", gConsumed);
        console2.log("Router G$     :", rG);
        console2.log("Router USDm   :", rUsdm);
        console2.log("Router USDT   :", rUsdt);

        require(usdtOut   >= 90_000,                  "TestSwap: USDT output below minimum");
        require(usdtAfter == usdtBefore + usdtOut,    "TestSwap: USDT balance mismatch");
        require(rG        == 0,                        "TestSwap: router holds G$");
        require(rUsdm     == 0,                        "TestSwap: router holds USDm");
        require(rUsdt     == 0,                        "TestSwap: router holds USDT");

        // Within 2% of quoted net (~0.113992 USDT per 1000 G$)
        uint256 quotedOut = 113_992;
        require(
            usdtOut >= (quotedOut * 98) / 100,
            "TestSwap: output more than 2% below on-chain quote"
        );

        console2.log("");
        console2.log("ALL CHECKS PASSED.");
        console2.log("IMPORTANT: Owner must now RE-PAUSE the router.");
        console2.log("Run: cast send <ROUTER> \"pause()\" --rpc-url $CELO_RPC_URL --private-key $PRIVATE_KEY --legacy");
    }
}
