// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {Vm} from "forge-std/Vm.sol";
import {IERC20} from "openzeppelin-contracts/contracts/token/ERC20/IERC20.sol";
import {Pausable} from "openzeppelin-contracts/contracts/utils/Pausable.sol";

import {GoodCashRouterV2} from "../src/GoodCashRouterV2.sol";

interface IGoodDollar677 {
    function transferAndCall(address to, uint256 amount, bytes calldata data) external returns (bool);
}

/*──────────────────────────────────────────────────────────────────────────────
  GoodCashRouterV2 tests. They run against a Celo mainnet fork so the router meets the REAL G$ token,
  the REAL GoodDollar reserve and the REAL Uniswap pools.

  The "customer" is a real wallet that holds G$ on mainnet; we only impersonate it inside the fork.

  Run:  CELO_RPC_URL=https://forno.celo.org forge test --match-contract GoodCashRouterV2Test -vv
──────────────────────────────────────────────────────────────────────────────*/

contract GoodCashRouterV2Test is Test {
    address constant G = 0x62B8B11039FcfE5aB0C56E502b1C372A3d2a9c7A;
    address constant USDM = 0x765DE816845861e75A25fCA122bb6898B8B1282a;
    address constant USDT = 0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e;
    address constant BROKER = 0x88de45906D4F5a57315c133620cfa484cB297541;
    address constant PROVIDER = 0x2fFBB49055d487DdBBb0C052Cd7c2a02A7971e41;
    bytes32 constant EXCHANGE_ID = 0xba77f5c7bb3317643c6d81d1ef3f9913561741d92095f88efa402faf2cbe9124;
    address constant UNI = 0x5615CDAb10dc425a742d643d949a7F474C01abc4;

    // A real wallet that holds G$ on mainnet (impersonated only inside the fork)
    address constant CUSTOMER = 0xafDeEbB89Cda1669361117eA2EAe3411F1228cb6;
    address constant PARTNER = address(0xFEED);

    GoodCashRouterV2 router;
    address owner = address(0xA11CE);

    function setUp() public {
        vm.createSelectFork(vm.envString("CELO_RPC_URL"));
        router = new GoodCashRouterV2(G, USDM, USDT, BROKER, PROVIDER, EXCHANGE_ID, UNI, owner);
        vm.prank(owner);
        router.unpause();
        // make sure the customer has enough G$ for the tests even if their balance moves
        if (IERC20(G).balanceOf(CUSTOMER) < 60_000e18) deal(G, CUSTOMER, 60_000e18);
    }

    function _data(
        GoodCashRouterV2.Route route,
        uint256 minOut,
        uint256 deadline,
        address payTo,
        uint256 payAmount
    ) internal pure returns (bytes memory) {
        return abi.encode(route, minOut, deadline, payTo, payAmount, bytes32("order-1"));
    }

    function _cashOut(GoodCashRouterV2.Route route, uint256 gIn, uint256 minOut, uint256 payAmount) internal {
        vm.prank(CUSTOMER);
        IGoodDollar677(G).transferAndCall(
            address(router), gIn, _data(route, minOut, block.timestamp + 600, PARTNER, payAmount)
        );
    }

    // ── The one-tap path works with the real token, reserve and Uniswap ─────────

    function testForkOneTapReserveRoutePaysExactAndReturnsSurplus() public {
        uint256 gBefore = IERC20(G).balanceOf(CUSTOMER);
        uint256 usdtBefore = IERC20(USDT).balanceOf(CUSTOMER);

        // 5,000 G$ produces about 0.57 USDT; the partner's order asks for exactly 0.50
        _cashOut(GoodCashRouterV2.Route.RESERVE_THEN_UNISWAP, 5_000e18, 0.5e6, 0.5e6);

        assertEq(gBefore - IERC20(G).balanceOf(CUSTOMER), 5_000e18, "exactly 5,000 G$ spent");
        assertEq(IERC20(USDT).balanceOf(PARTNER), 0.5e6, "partner got EXACTLY the order amount");
        uint256 surplus = IERC20(USDT).balanceOf(CUSTOMER) - usdtBefore;
        assertGt(surplus, 0.05e6, "customer got the leftover back");
        assertLt(surplus, 0.2e6, "leftover is small");
    }

    function testForkOneTapUniswapRouteWorksToo() public {
        _cashOut(GoodCashRouterV2.Route.UNISWAP_THEN_UNISWAP, 1_000e18, 0.05e6, 0.05e6);
        assertEq(IERC20(USDT).balanceOf(PARTNER), 0.05e6);
    }

    function testForkEmitsEventWithRealNumbers() public {
        vm.recordLogs();
        _cashOut(GoodCashRouterV2.Route.RESERVE_THEN_UNISWAP, 5_000e18, 0.5e6, 0.5e6);
        bool found;
        Vm.Log[] memory logs = vm.getRecordedLogs();
        bytes32 sig = keccak256("CashOutPaid(address,address,uint256,uint256,uint256,uint256,uint8,bytes32)");
        for (uint256 i; i < logs.length; i++) {
            if (logs[i].emitter == address(router) && logs[i].topics[0] == sig) {
                found = true;
                assertEq(address(uint160(uint256(logs[i].topics[1]))), CUSTOMER);
                assertEq(address(uint160(uint256(logs[i].topics[2]))), PARTNER);
                (uint256 gIn, uint256 out, uint256 paid, uint256 returned,,) =
                    abi.decode(logs[i].data, (uint256, uint256, uint256, uint256, uint8, bytes32));
                assertEq(gIn, 5_000e18);
                assertEq(paid, 0.5e6);
                assertEq(out, paid + returned);
            }
        }
        assertTrue(found, "CashOutPaid event");
    }

    // ── Custody: it keeps nothing, approvals are reset, dust cannot block it ────

    function testForkRouterKeepsNothingAndResetsApprovals() public {
        _cashOut(GoodCashRouterV2.Route.RESERVE_THEN_UNISWAP, 5_000e18, 0.5e6, 0.5e6);
        assertEq(IERC20(G).balanceOf(address(router)), 0);
        assertEq(IERC20(USDM).balanceOf(address(router)), 0);
        assertEq(IERC20(USDT).balanceOf(address(router)), 0);
        assertEq(IERC20(G).allowance(address(router), BROKER), 0);
        assertEq(IERC20(USDM).allowance(address(router), UNI), 0);
        assertEq(IERC20(G).allowance(address(router), UNI), 0);
    }

    function testForkStrayDustCannotBlockCashOut() public {
        deal(USDT, address(router), 1);
        deal(USDM, address(router), 1);
        // G$ is a SuperToken, so give it dust with a real transfer from the customer
        vm.prank(CUSTOMER);
        IERC20(G).transfer(address(router), 1);
        _cashOut(GoodCashRouterV2.Route.RESERVE_THEN_UNISWAP, 5_000e18, 0.5e6, 0.5e6);
        assertEq(IERC20(USDT).balanceOf(PARTNER), 0.5e6);
        assertEq(IERC20(USDT).balanceOf(address(router)), 1, "dust untouched");
        assertEq(IERC20(G).balanceOf(address(router)), 1, "G$ dust untouched");
    }

    // ── Protection for the customer ─────────────────────────────────────────────

    function testForkRevertsIfOutputIsBelowWhatThePartnerNeeds() public {
        uint256 gBefore = IERC20(G).balanceOf(CUSTOMER);
        vm.prank(CUSTOMER);
        vm.expectRevert(); // swap cannot reach 50 USDT from 5,000 G$
        IGoodDollar677(G).transferAndCall(
            address(router),
            5_000e18,
            _data(GoodCashRouterV2.Route.RESERVE_THEN_UNISWAP, 50e6, block.timestamp + 600, PARTNER, 50e6)
        );
        assertEq(IERC20(G).balanceOf(CUSTOMER), gBefore, "nothing was taken");
        assertEq(IERC20(USDT).balanceOf(PARTNER), 0);
    }

    function testForkRevertsWhenMinOutDoesNotCoverPayAmount() public {
        vm.prank(CUSTOMER);
        vm.expectRevert();
        IGoodDollar677(G).transferAndCall(
            address(router),
            5_000e18,
            _data(GoodCashRouterV2.Route.RESERVE_THEN_UNISWAP, 0.3e6, block.timestamp + 600, PARTNER, 0.5e6)
        );
    }

    function testForkRevertsAfterDeadline() public {
        vm.prank(CUSTOMER);
        vm.expectRevert();
        IGoodDollar677(G).transferAndCall(
            address(router),
            5_000e18,
            _data(GoodCashRouterV2.Route.RESERVE_THEN_UNISWAP, 0.5e6, block.timestamp - 1, PARTNER, 0.5e6)
        );
    }

    function testForkRevertsOnBadRecipientOrZeroPay() public {
        vm.startPrank(CUSTOMER);
        vm.expectRevert();
        IGoodDollar677(G).transferAndCall(
            address(router), 5_000e18, _data(GoodCashRouterV2.Route.RESERVE_THEN_UNISWAP, 0.5e6, block.timestamp + 600, address(0), 0.5e6)
        );
        vm.expectRevert();
        IGoodDollar677(G).transferAndCall(
            address(router), 5_000e18, _data(GoodCashRouterV2.Route.RESERVE_THEN_UNISWAP, 0.5e6, block.timestamp + 600, address(router), 0.5e6)
        );
        vm.expectRevert();
        IGoodDollar677(G).transferAndCall(
            address(router), 5_000e18, _data(GoodCashRouterV2.Route.RESERVE_THEN_UNISWAP, 0.5e6, block.timestamp + 600, PARTNER, 0)
        );
        vm.stopPrank();
    }

    function testForkGarbageDataRevertsAndKeepsTheG() public {
        uint256 gBefore = IERC20(G).balanceOf(CUSTOMER);
        vm.prank(CUSTOMER);
        vm.expectRevert();
        IGoodDollar677(G).transferAndCall(address(router), 5_000e18, hex"deadbeef");
        assertEq(IERC20(G).balanceOf(CUSTOMER), gBefore);
    }

    // ── Only the G$ token can trigger the callback ──────────────────────────────

    function testForkNobodyElseCanCallOnTokenTransfer() public {
        vm.prank(address(0xBAD));
        vm.expectRevert(GoodCashRouterV2.NotGoodDollar.selector);
        router.onTokenTransfer(CUSTOMER, 5_000e18, _data(GoodCashRouterV2.Route.RESERVE_THEN_UNISWAP, 0.5e6, block.timestamp + 600, PARTNER, 0.5e6));
    }

    // ── Owner can only pause/unpause ────────────────────────────────────────────

    function testForkStartsPausedAndOnlyOwnerCanUnpause() public {
        GoodCashRouterV2 fresh = new GoodCashRouterV2(G, USDM, USDT, BROKER, PROVIDER, EXCHANGE_ID, UNI, owner);
        assertTrue(fresh.paused());
        vm.prank(CUSTOMER);
        vm.expectRevert(GoodCashRouterV2.NotOwner.selector);
        fresh.unpause();
        vm.prank(owner);
        fresh.unpause();
        assertFalse(fresh.paused());
    }

    function testForkPausedBlocksCashOut() public {
        vm.prank(owner);
        router.pause();
        vm.prank(CUSTOMER);
        vm.expectRevert();
        IGoodDollar677(G).transferAndCall(
            address(router), 5_000e18, _data(GoodCashRouterV2.Route.RESERVE_THEN_UNISWAP, 0.5e6, block.timestamp + 600, PARTNER, 0.5e6)
        );
    }

    function testForkRejectsZeroAddressesInConstructor() public {
        vm.expectRevert();
        new GoodCashRouterV2(address(0), USDM, USDT, BROKER, PROVIDER, EXCHANGE_ID, UNI, owner);
        vm.expectRevert();
        new GoodCashRouterV2(G, USDM, USDT, BROKER, PROVIDER, EXCHANGE_ID, UNI, address(0));
    }

    // ── Fuzz: whatever the order amount, the partner is paid exactly and the router keeps nothing ──

    function testForkFuzzPayAmount(uint256 payAmount) public {
        payAmount = bound(payAmount, 0.05e6, 0.5e6);
        _cashOut(GoodCashRouterV2.Route.RESERVE_THEN_UNISWAP, 5_000e18, payAmount, payAmount);
        assertEq(IERC20(USDT).balanceOf(PARTNER), payAmount);
        assertEq(IERC20(USDT).balanceOf(address(router)), 0);
        assertEq(IERC20(G).balanceOf(address(router)), 0);
        assertEq(IERC20(USDM).balanceOf(address(router)), 0);
    }
}
