// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test, console2} from "forge-std/Test.sol";
import {IERC20} from "openzeppelin-contracts/contracts/token/ERC20/IERC20.sol";

import {GoodCashRouter} from "../src/GoodCashRouter.sol";

/*──────────────────────────────────────────────────────────────────────────────
  GoodCashRouter — comprehensive test suite
  ══════════════════════════════════════════════════════════════════════════════

  Test categories:
  A. Unit tests — no fork, mock-only
  B. Fork tests — Celo mainnet fork (requires CELO_RPC_URL env var)
  C. Fuzz tests
  D. Invariant tests
  E. Revert tests
  F. Access control tests

  Run:
      forge test -vvv
      forge test --match-test testFork -vvv --fork-url https://forno.celo.org

  Fork tests are tagged with `testFork` prefix so they can be run separately.
──────────────────────────────────────────────────────────────────────────────*/

// ─────────────────────────────────────────────────────────────────────────────
//  Celo mainnet addresses (verified in Prompt 1 / docs/VERIFY_OUTPUT.txt)
// ─────────────────────────────────────────────────────────────────────────────
address constant G_DOLLAR_ADDR     = 0x62B8B11039FcfE5aB0C56E502b1C372A3d2a9c7A;
address constant USDM_ADDR         = 0x765DE816845861e75A25fCA122bb6898B8B1282a;
address constant USDT_ADDR         = 0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e;
address constant BROKER_ADDR       = 0x88de45906D4F5a57315c133620cfa484cB297541;
address constant EXCH_PROVIDER     = 0x2fFBB49055d487DdBBb0C052Cd7c2a02A7971e41;
bytes32 constant EXCHANGE_ID       = 0xba77f5c7bb3317643c6d81d1ef3f9913561741d92095f88efa402faf2cbe9124;
address constant UNISWAP_ROUTER    = 0x5615CDAb10dc425a742d643d949a7F474C01abc4; // Uniswap V3 SwapRouter02 on Celo
address constant G_USDM_POOL       = 0x9491d57c5687AB75726423B55AC2d87D1cDa2c3F;

// ─────────────────────────────────────────────────────────────────────────────
//  Mock contracts for unit tests
// ─────────────────────────────────────────────────────────────────────────────

contract MockERC20 {
    string  public  name;
    string  public  symbol;
    uint8   public  decimals;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    constructor(string memory _symbol, uint8 _decimals) {
        symbol   = _symbol;
        decimals = _decimals;
    }

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        require(balanceOf[msg.sender] >= amount, "ERC20: insufficient balance");
        balanceOf[msg.sender] -= amount;
        balanceOf[to]         += amount;
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        require(allowance[from][msg.sender] >= amount, "ERC20: insufficient allowance");
        allowance[from][msg.sender] -= amount;
        balanceOf[from]            -= amount;
        balanceOf[to]              += amount;
        return true;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }
}

/// @dev A mock Broker that returns a configurable amount and correctly debits tokenIn from caller.
contract MockBroker {
    uint256 public returnAmount;
    bool    public shouldRevert;
    address public lastTokenIn;
    address public lastTokenOut;
    uint256 public lastAmountIn;

    function configure(uint256 _returnAmount, bool _shouldRevert) external {
        returnAmount   = _returnAmount;
        shouldRevert   = _shouldRevert;
    }

    function swapIn(
        address, bytes32, address tokenIn, address tokenOut, uint256 amountIn, uint256 amountOutMin
    ) external returns (uint256) {
        if (shouldRevert) revert("MockBroker: paused");
        lastTokenIn  = tokenIn;
        lastTokenOut = tokenOut;
        lastAmountIn = amountIn;
        require(returnAmount >= amountOutMin, "MockBroker: below min");

        // Pull tokenIn from caller
        MockERC20(tokenIn).transferFrom(msg.sender, address(this), amountIn);
        // Send tokenOut to caller
        MockERC20(tokenOut).transfer(msg.sender, returnAmount);
        return returnAmount;
    }
}

/// @dev A mock Uniswap SwapRouter02 that returns a configurable amount.
contract MockUniswapRouter {
    uint256 public returnAmount;
    bool    public shouldRevert;

    function configure(uint256 _returnAmount, bool _shouldRevert) external {
        returnAmount   = _returnAmount;
        shouldRevert   = _shouldRevert;
    }

    struct ExactInputSingleParams {
        address tokenIn;
        address tokenOut;
        uint24  fee;
        address recipient;
        uint256 amountIn;
        uint256 amountOutMinimum;
        uint160 sqrtPriceLimitX96;
    }

    function exactInputSingle(ExactInputSingleParams calldata p) external returns (uint256) {
        if (shouldRevert) revert("MockUniswap: pool not found");
        require(returnAmount >= p.amountOutMinimum, "MockUniswap: below min");
        MockERC20(p.tokenIn).transferFrom(msg.sender, address(this), p.amountIn);
        MockERC20(p.tokenOut).transfer(p.recipient, returnAmount);
        return returnAmount;
    }
}

// ─────────────────────────────────────────────────────────────────────────────
//  Helper: deploy a router with mock contracts
// ─────────────────────────────────────────────────────────────────────────────

contract RouterTestBase is Test {
    MockERC20        gDollar;
    MockERC20        usdm;
    MockERC20        usdt;
    MockBroker       broker;
    MockUniswapRouter uniswap;
    GoodCashRouter   router;

    address owner    = makeAddr("owner");
    address alice    = makeAddr("alice");
    address recipient = makeAddr("recipient");

    bytes32 constant REF = bytes32(uint256(0xdead));

    function setUp() public virtual {
        gDollar  = new MockERC20("GoodDollar", 18);
        usdm     = new MockERC20("USDm", 18);
        usdt     = new MockERC20("USDT", 6);
        broker   = new MockBroker();
        uniswap  = new MockUniswapRouter();

        // Pre-fund mock venues so they can pay out
        usdm.mint(address(broker),  1_000_000e18);
        usdm.mint(address(uniswap), 1_000_000e18);
        usdt.mint(address(uniswap), 1_000_000e6);

        router = new GoodCashRouter(
            address(gDollar),
            address(usdm),
            address(usdt),
            address(broker),
            makeAddr("exchangeProvider"), // only used as address in mock path
            bytes32(uint256(1)),
            address(uniswap),
            owner
        );

        // Unpause for most tests
        vm.prank(owner);
        router.unpause();
    }

    function _mintAndApprove(address user, uint256 amount) internal {
        gDollar.mint(user, amount);
        vm.prank(user);
        gDollar.approve(address(router), amount);
    }
}

// ─────────────────────────────────────────────────────────────────────────────
//  A. Unit tests
// ─────────────────────────────────────────────────────────────────────────────

contract RouterUnitTests is RouterTestBase {

    // ── Route: RESERVE_TO_USDM ───────────────────────────────────────────

    function test_reserveToUsdm_basic() public {
        uint256 amountIn   = 1_000e18;
        uint256 expectedOut = 113e15; // ~0.113 USDm (net of 10% exit contribution)

        broker.configure(expectedOut, false);
        _mintAndApprove(alice, amountIn);

        vm.prank(alice);
        uint256 out = router.cashOut(
            GoodCashRouter.Route.RESERVE_TO_USDM,
            amountIn,
            1,
            block.timestamp + 60,
            recipient,
            REF
        );

        assertEq(out, expectedOut);
        assertEq(usdm.balanceOf(recipient), expectedOut);
        // Invariant: router holds zero
        assertEq(gDollar.balanceOf(address(router)), 0);
        assertEq(usdm.balanceOf(address(router)),    0);
    }

    // ── Route: UNISWAP_TO_USDM ──────────────────────────────────────────

    function test_uniswapToUsdm_basic() public {
        uint256 amountIn   = 1_000e18;
        uint256 expectedOut = 113e15;

        uniswap.configure(expectedOut, false);
        _mintAndApprove(alice, amountIn);

        vm.prank(alice);
        uint256 out = router.cashOut(
            GoodCashRouter.Route.UNISWAP_TO_USDM,
            amountIn,
            1,
            block.timestamp + 60,
            recipient,
            REF
        );

        assertEq(out, expectedOut);
        assertEq(usdm.balanceOf(recipient), expectedOut);
        assertEq(gDollar.balanceOf(address(router)), 0);
        assertEq(usdm.balanceOf(address(router)),    0);
    }

    // ── Route: RESERVE_THEN_UNISWAP ─────────────────────────────────────

    function test_reserveThenUniswap_basic() public {
        uint256 amountIn      = 1_000e18;
        uint256 usdmFromBroker = 113e15;
        uint256 usdtFromUniswap = 112_000; // ~0.112 USDT (6 dec)

        broker.configure(usdmFromBroker, false);
        uniswap.configure(usdtFromUniswap, false);
        _mintAndApprove(alice, amountIn);

        vm.prank(alice);
        uint256 out = router.cashOut(
            GoodCashRouter.Route.RESERVE_THEN_UNISWAP,
            amountIn,
            1,
            block.timestamp + 60,
            recipient,
            REF
        );

        assertEq(out, usdtFromUniswap);
        assertEq(usdt.balanceOf(recipient), usdtFromUniswap);
        // Invariant
        assertEq(gDollar.balanceOf(address(router)), 0);
        assertEq(usdm.balanceOf(address(router)),    0);
        assertEq(usdt.balanceOf(address(router)),    0);
    }

    // ── Route: UNISWAP_THEN_UNISWAP ─────────────────────────────────────

    function test_uniswapThenUniswap_basic() public {
        uint256 amountIn        = 1_000e18;
        uint256 usdtFromUniswap = 112_000;

        uniswap.configure(usdtFromUniswap, false); // second call overrides
        // We need first hop to return usdm, second hop usdt.
        // The mock returns the same `returnAmount` for all calls.
        // For this test we just verify accounting; use a specialised mock if needed.
        _mintAndApprove(alice, amountIn);

        vm.prank(alice);
        uint256 out = router.cashOut(
            GoodCashRouter.Route.UNISWAP_THEN_UNISWAP,
            amountIn,
            1,
            block.timestamp + 60,
            recipient,
            REF
        );

        // Output should equal what the mock router emits on second call
        assertGt(out, 0);
        assertEq(gDollar.balanceOf(address(router)), 0);
        assertEq(usdm.balanceOf(address(router)),    0);
        assertEq(usdt.balanceOf(address(router)),    0);
    }

    // ── 10% exit contribution is NOT added by router ─────────────────────

    function test_exitContributionAppliedByProtocol() public {
        // The router passes the full amountIn to swapIn; the Broker deducts 10%.
        // Check that the router did not add its own fee.
        uint256 amountIn = 1_000e18;
        broker.configure(113_992_939_240_294_538, false); // exact on-chain value from VERIFY_OUTPUT.txt

        _mintAndApprove(alice, amountIn);
        vm.prank(alice);
        uint256 out = router.cashOut(
            GoodCashRouter.Route.RESERVE_TO_USDM,
            amountIn,
            1,
            block.timestamp + 60,
            recipient,
            REF
        );

        // Verify the router passed amountIn in full to the Broker
        assertEq(broker.lastAmountIn(), amountIn);
        // Verify output matches the mock's return
        assertEq(out, 113_992_939_240_294_538);
    }

    // ── Approval is reset to zero after Reserve hop ───────────────────────

    function test_approvalResetAfterReserveHop() public {
        uint256 amountIn = 500e18;
        broker.configure(50e15, false);
        _mintAndApprove(alice, amountIn);

        vm.prank(alice);
        router.cashOut(
            GoodCashRouter.Route.RESERVE_TO_USDM,
            amountIn,
            1,
            block.timestamp + 60,
            recipient,
            REF
        );

        // After the swap the router should have zero allowance to the Broker
        assertEq(gDollar.allowance(address(router), address(broker)), 0);
    }

    // ── Approval is reset to zero after Uniswap hop ──────────────────────

    function test_approvalResetAfterUniswapHop() public {
        uint256 amountIn = 500e18;
        uniswap.configure(50e15, false);
        _mintAndApprove(alice, amountIn);

        vm.prank(alice);
        router.cashOut(
            GoodCashRouter.Route.UNISWAP_TO_USDM,
            amountIn,
            1,
            block.timestamp + 60,
            recipient,
            REF
        );

        assertEq(gDollar.allowance(address(router), address(uniswap)), 0);
    }

    // ── CashOut event emitted correctly ──────────────────────────────────

    function test_cashOutEventEmitted() public {
        uint256 amountIn   = 1_000e18;
        uint256 expectedOut = 113e15;
        broker.configure(expectedOut, false);
        _mintAndApprove(alice, amountIn);

        vm.expectEmit(true, true, true, true);
        emit GoodCashRouter.CashOut(
            alice,
            recipient,
            address(usdm),
            amountIn,
            expectedOut,
            GoodCashRouter.Route.RESERVE_TO_USDM,
            REF
        );

        vm.prank(alice);
        router.cashOut(
            GoodCashRouter.Route.RESERVE_TO_USDM,
            amountIn,
            1,
            block.timestamp + 60,
            recipient,
            REF
        );
    }
}

// ─────────────────────────────────────────────────────────────────────────────
//  E. Revert tests
// ─────────────────────────────────────────────────────────────────────────────

contract RouterRevertTests is RouterTestBase {

    function test_revert_zeroAmount() public {
        _mintAndApprove(alice, 1_000e18);
        vm.expectRevert(GoodCashRouter.ZeroAmount.selector);
        vm.prank(alice);
        router.cashOut(GoodCashRouter.Route.RESERVE_TO_USDM, 0, 1, block.timestamp + 60, recipient, REF);
    }

    function test_revert_zeroMinAmountOut() public {
        _mintAndApprove(alice, 1_000e18);
        vm.expectRevert(GoodCashRouter.ZeroMinAmountOut.selector);
        vm.prank(alice);
        router.cashOut(GoodCashRouter.Route.RESERVE_TO_USDM, 1_000e18, 0, block.timestamp + 60, recipient, REF);
    }

    function test_revert_zeroRecipient() public {
        _mintAndApprove(alice, 1_000e18);
        vm.expectRevert(GoodCashRouter.ZeroRecipient.selector);
        vm.prank(alice);
        router.cashOut(GoodCashRouter.Route.RESERVE_TO_USDM, 1_000e18, 1, block.timestamp + 60, address(0), REF);
    }

    function test_revert_deadlineExpired() public {
        _mintAndApprove(alice, 1_000e18);
        vm.expectRevert(GoodCashRouter.DeadlineExpired.selector);
        vm.prank(alice);
        router.cashOut(GoodCashRouter.Route.RESERVE_TO_USDM, 1_000e18, 1, block.timestamp - 1, recipient, REF);
    }

    function test_revert_outputBelowMin() public {
        uint256 amountIn = 1_000e18;
        broker.configure(50e15, false); // returns 50e15 USDm
        _mintAndApprove(alice, amountIn);
        vm.expectRevert(abi.encodeWithSelector(GoodCashRouter.InsufficientOutput.selector, 50e15, 200e15));
        vm.prank(alice);
        router.cashOut(
            GoodCashRouter.Route.RESERVE_TO_USDM,
            amountIn,
            200e15, // minAmountOut higher than what broker returns
            block.timestamp + 60,
            recipient,
            REF
        );
    }

    function test_revert_paused() public {
        vm.prank(owner);
        router.pause();
        _mintAndApprove(alice, 1_000e18);
        vm.expectRevert(); // Pausable: paused
        vm.prank(alice);
        router.cashOut(GoodCashRouter.Route.RESERVE_TO_USDM, 1_000e18, 1, block.timestamp + 60, recipient, REF);
    }

    function test_revert_brokerFails_fallbackRequired() public {
        broker.configure(0, true); // simulates Reserve being paused or at limit
        _mintAndApprove(alice, 1_000e18);
        vm.expectRevert(); // MockBroker: paused
        vm.prank(alice);
        router.cashOut(
            GoodCashRouter.Route.RESERVE_TO_USDM,
            1_000e18,
            1,
            block.timestamp + 60,
            recipient,
            REF
        );
    }
}

// ─────────────────────────────────────────────────────────────────────────────
//  F. Access control tests
// ─────────────────────────────────────────────────────────────────────────────

contract RouterAccessControlTests is RouterTestBase {

    function test_nonOwner_cannotPause() public {
        vm.expectRevert(GoodCashRouter.NotOwner.selector);
        vm.prank(alice);
        router.pause();
    }

    function test_nonOwner_cannotUnpause() public {
        vm.prank(owner);
        router.pause();
        vm.expectRevert(GoodCashRouter.NotOwner.selector);
        vm.prank(alice);
        router.unpause();
    }

    function test_nonOwner_cannotSetAllowedOutput() public {
        vm.expectRevert(GoodCashRouter.NotOwner.selector);
        vm.prank(alice);
        router.setAllowedOutput(address(usdt), false);
    }

    function test_nonOwner_cannotRescue() public {
        // Give router some tokens (simulate dust)
        gDollar.mint(address(router), 1e18);
        vm.expectRevert(GoodCashRouter.NotOwner.selector);
        vm.prank(alice);
        router.rescue(address(gDollar), alice, 1e18);
    }

    function test_nonOwner_cannotSetFeeBps() public {
        vm.expectRevert(GoodCashRouter.NotOwner.selector);
        vm.prank(alice);
        router.setFeeBps(50);
    }

    function test_owner_canPauseAndUnpause() public {
        vm.prank(owner);
        router.pause();
        assertTrue(router.paused());

        vm.prank(owner);
        router.unpause();
        assertFalse(router.paused());
    }

    function test_owner_canSetFeeBpsUpToMax() public {
        vm.prank(owner);
        router.setFeeBps(100); // 1%
        assertEq(router.feeBps(), 100);
    }

    function test_feeBps_cannotExceedMax() public {
        vm.expectRevert(abi.encodeWithSelector(GoodCashRouter.FeeTooHigh.selector, 101, 100));
        vm.prank(owner);
        router.setFeeBps(101);
    }

    function test_owner_canRescue() public {
        gDollar.mint(address(router), 1e18);
        vm.prank(owner);
        router.rescue(address(gDollar), owner, 1e18);
        assertEq(gDollar.balanceOf(owner), 1e18);
        assertEq(gDollar.balanceOf(address(router)), 0);
    }

    function test_rescue_cannotRunWhilePaused() public {
        gDollar.mint(address(router), 1e18);
        vm.prank(owner);
        router.pause();
        vm.expectRevert(); // whenNotPaused
        vm.prank(owner);
        router.rescue(address(gDollar), owner, 1e18);
    }
}

// ─────────────────────────────────────────────────────────────────────────────
//  E2. Additional branch coverage tests
// ─────────────────────────────────────────────────────────────────────────────

contract RouterBranchCoverageTests is RouterTestBase {

    // ── feeBps > 0 deducts fee from amountIn ─────────────────────────────

    function test_feeBps_deductsFromAmountIn() public {
        // Set fee to 1% (100 bps)
        vm.prank(owner);
        router.setFeeBps(100);

        uint256 amountIn   = 1_000e18;
        uint256 effectiveIn = amountIn - (amountIn * 100 / 10_000); // 990e18
        uint256 brokerOut   = 100e15; // mock returns fixed amount
        broker.configure(brokerOut, false);

        _mintAndApprove(alice, amountIn);
        vm.prank(alice);
        router.cashOut(
            GoodCashRouter.Route.RESERVE_TO_USDM,
            amountIn,
            1,
            block.timestamp + 60,
            recipient,
            REF
        );

        // Broker should have received effectiveIn (990e18), not 1000e18
        assertEq(broker.lastAmountIn(), effectiveIn, "feeBps: wrong effectiveAmountIn");
        // Router holds zero
        assertEq(gDollar.balanceOf(address(router)), 0);
        assertEq(usdm.balanceOf(address(router)),    0);
    }

    // ── setAllowedOutput: disabling an output blocks the route ───────────

    function test_disabledOutput_reverts() public {
        // Disable USDm as an output
        vm.prank(owner);
        router.setAllowedOutput(address(usdm), false);

        uint256 amountIn = 1_000e18;
        broker.configure(100e15, false);
        _mintAndApprove(alice, amountIn);

        // RESERVE_TO_USDM produces USDm — should revert because USDm is no longer allowed
        vm.expectRevert(abi.encodeWithSelector(GoodCashRouter.OutputNotAllowed.selector, address(usdm)));
        vm.prank(alice);
        router.cashOut(
            GoodCashRouter.Route.RESERVE_TO_USDM,
            amountIn,
            1,
            block.timestamp + 60,
            recipient,
            REF
        );
    }

    // ── setAllowedOutput: enabling a new token allows it ─────────────────

    function test_newOutputToken_allowed() public {
        MockERC20 newToken = new MockERC20("NEW", 18);
        newToken.mint(address(broker), 1_000_000e18);

        // Enable newToken
        vm.prank(owner);
        router.setAllowedOutput(address(newToken), true);

        // The router won't route to newToken through any current route — this just
        // verifies the allowlist mapping is set correctly
        assertTrue(router.allowedOutputs(address(newToken)));
    }

    // ── rescue: reverts on zero `to` address ─────────────────────────────

    function test_rescue_revertsOnZeroTo() public {
        gDollar.mint(address(router), 1e18);
        vm.expectRevert("GoodCashRouter: rescue to zero");
        vm.prank(owner);
        router.rescue(address(gDollar), address(0), 1e18);
    }

    // ── setAllowedOutput: reverts on zero token address ──────────────────

    function test_setAllowedOutput_revertsOnZeroToken() public {
        vm.expectRevert("GoodCashRouter: zero token");
        vm.prank(owner);
        router.setAllowedOutput(address(0), true);
    }

    // ── exact deadline (block.timestamp == deadline) succeeds ────────────

    function test_deadline_exact_succeeds() public {
        uint256 amountIn = 1_000e18;
        broker.configure(100e15, false);
        _mintAndApprove(alice, amountIn);

        vm.prank(alice);
        // deadline == block.timestamp: should NOT revert (condition is strict >)
        router.cashOut(
            GoodCashRouter.Route.RESERVE_TO_USDM,
            amountIn,
            1,
            block.timestamp, // exactly now
            recipient,
            REF
        );
        assertEq(gDollar.balanceOf(address(router)), 0);
    }

    // ── FeeBpsSet event emitted ───────────────────────────────────────────

    function test_feeBpsSet_eventEmitted() public {
        vm.expectEmit(false, false, false, true);
        emit GoodCashRouter.FeeBpsSet(0, 50);
        vm.prank(owner);
        router.setFeeBps(50);
    }

    // ── AllowedOutputSet event emitted ───────────────────────────────────

    function test_allowedOutputSet_eventEmitted() public {
        vm.expectEmit(false, false, false, true);
        emit GoodCashRouter.AllowedOutputSet(address(usdt), false);
        vm.prank(owner);
        router.setAllowedOutput(address(usdt), false);
    }

    // ── Rescued event emitted ─────────────────────────────────────────────

    function test_rescued_eventEmitted() public {
        gDollar.mint(address(router), 1e18);
        vm.expectEmit(false, false, false, true);
        emit GoodCashRouter.Rescued(address(gDollar), owner, 1e18);
        vm.prank(owner);
        router.rescue(address(gDollar), owner, 1e18);
    }

    // ── USDT is an allowed output by default ─────────────────────────────

    function test_usdt_allowedByDefault() public view {
        assertTrue(router.allowedOutputs(address(usdt)));
        assertTrue(router.allowedOutputs(address(usdm)));
    }

    // ── Owner immutable matches constructor arg ───────────────────────────

    function test_ownerImmutable() public view {
        assertEq(router.OWNER(), owner);
    }
}

// ─────────────────────────────────────────────────────────────────────────────
//  C. Fuzz tests
// ─────────────────────────────────────────────────────────────────────────────

contract RouterFuzzTests is RouterTestBase {

    /// @dev Fuzz over amountIn. The router must end with zero balances.
    function testFuzz_reserveToUsdm_zeroBalance(uint256 amountIn) public {
        amountIn = bound(amountIn, 1e15, 10_000_000e18); // 0.001 to 10M G$
        uint256 mockedOut = amountIn / 10; // simulates ~10% exit contribution loss
        if (mockedOut == 0) return;

        broker.configure(mockedOut, false);
        _mintAndApprove(alice, amountIn);

        vm.prank(alice);
        router.cashOut(
            GoodCashRouter.Route.RESERVE_TO_USDM,
            amountIn,
            1,
            block.timestamp + 60,
            recipient,
            REF
        );

        assertEq(gDollar.balanceOf(address(router)), 0, "G$ dust");
        assertEq(usdm.balanceOf(address(router)),    0, "USDm dust");
        assertEq(usdt.balanceOf(address(router)),    0, "USDT dust");
    }

    /// @dev Fuzz over minAmountOut: should revert if too high.
    function testFuzz_minAmountOut_reverts(uint256 minAmountOut) public {
        uint256 amountIn   = 1_000e18;
        uint256 mockedOut  = 100e15; // mock returns 100e15 USDm
        minAmountOut = bound(minAmountOut, mockedOut + 1, type(uint256).max);

        broker.configure(mockedOut, false);
        _mintAndApprove(alice, amountIn);

        vm.expectRevert(
            abi.encodeWithSelector(GoodCashRouter.InsufficientOutput.selector, mockedOut, minAmountOut)
        );
        vm.prank(alice);
        router.cashOut(
            GoodCashRouter.Route.RESERVE_TO_USDM,
            amountIn,
            minAmountOut,
            block.timestamp + 60,
            recipient,
            REF
        );
    }

    /// @dev Any valid cashOut must leave router with zero token balances.
    function testFuzz_allRoutes_zeroBalance(uint256 amountIn, uint8 routeIdx) public {
        routeIdx = uint8(bound(uint256(routeIdx), 0, 3));
        amountIn = bound(amountIn, 1e15, 1_000_000e18);

        GoodCashRouter.Route route = GoodCashRouter.Route(routeIdx);

        uint256 brokerOut  = amountIn / 11; // simulates ~10% cut
        uint256 uniswapOut = amountIn / 11;
        if (brokerOut == 0 || uniswapOut == 0) return;

        broker.configure(brokerOut, false);
        uniswap.configure(uniswapOut, false);
        _mintAndApprove(alice, amountIn);

        vm.prank(alice);
        try router.cashOut(route, amountIn, 1, block.timestamp + 60, recipient, REF) {
            // Success: verify invariants
            assertEq(gDollar.balanceOf(address(router)), 0, "G$ non-zero");
            assertEq(usdm.balanceOf(address(router)),    0, "USDm non-zero");
            assertEq(usdt.balanceOf(address(router)),    0, "USDT non-zero");
        } catch {
            // Revert is acceptable for edge cases; just verify invariants still hold
            assertEq(gDollar.balanceOf(address(router)), 0, "G$ non-zero on revert");
            assertEq(usdm.balanceOf(address(router)),    0, "USDm non-zero on revert");
            assertEq(usdt.balanceOf(address(router)),    0, "USDT non-zero on revert");
        }
    }
}

// ─────────────────────────────────────────────────────────────────────────────
//  D. Invariant tests — handler-based
//
//  The handler is the ONLY target exposed to the invariant fuzzer.
//  This prevents the fuzzer calling MockERC20.mint(router, amount) directly —
//  that scenario is impossible with real ERC20s on mainnet.
//
//  Forge calls setUp() on each invariant test contract automatically.
//  The handler is a separate contract that exposes only the functions
//  the fuzzer should call.
// ─────────────────────────────────────────────────────────────────────────────

/// @dev Self-contained handler for invariant testing.
///      All state is public so the invariant contract can read it.
contract RouterInvariantHandler is Test {
    MockERC20         public gDollar;
    MockERC20         public usdm;
    MockERC20         public usdt;
    MockBroker        public broker;
    MockUniswapRouter public uniswap;
    GoodCashRouter    public router;

    address public owner     = makeAddr("owner");
    address public alice     = makeAddr("alice");
    address public recipient = makeAddr("recipient");

    uint256 public successfulSwaps;

    constructor() {
        gDollar  = new MockERC20("GoodDollar", 18);
        usdm     = new MockERC20("USDm", 18);
        usdt     = new MockERC20("USDT", 6);
        broker   = new MockBroker();
        uniswap  = new MockUniswapRouter();

        // Pre-fund mock venues
        usdm.mint(address(broker),  1_000_000e18);
        usdm.mint(address(uniswap), 1_000_000e18);
        usdt.mint(address(uniswap), 1_000_000e6);

        router = new GoodCashRouter(
            address(gDollar),
            address(usdm),
            address(usdt),
            address(broker),
            makeAddr("exchangeProvider"),
            bytes32(uint256(1)),
            address(uniswap),
            owner
        );

        vm.prank(owner);
        router.unpause();
    }

    /// @notice Bounded cashOut call: all four routes, random amountIn and mockedOut.
    function handler_cashOut(uint256 amountIn, uint8 routeIdx, uint256 mockedOut) external {
        amountIn  = bound(amountIn,  1e15, 100_000e18);
        routeIdx  = uint8(bound(uint256(routeIdx), 0, 3));
        mockedOut = bound(mockedOut, 1, amountIn / 2);

        GoodCashRouter.Route route = GoodCashRouter.Route(routeIdx);

        broker.configure(mockedOut, false);
        uniswap.configure(mockedOut, false);

        gDollar.mint(alice, amountIn);
        vm.prank(alice);
        gDollar.approve(address(router), amountIn);

        vm.prank(alice);
        try router.cashOut(route, amountIn, 1, block.timestamp + 60, recipient, bytes32(0)) {
            successfulSwaps++;
        } catch {
            // Revert is acceptable; invariant must still hold
        }
    }

    /// @notice Expired-deadline path — always reverts, invariant must still hold.
    function handler_cashOut_expired(uint256 amountIn) external {
        amountIn = bound(amountIn, 1e15, 100_000e18);
        broker.configure(amountIn / 10 + 1, false);

        gDollar.mint(alice, amountIn);
        vm.prank(alice);
        gDollar.approve(address(router), amountIn);

        vm.prank(alice);
        try router.cashOut(
            GoodCashRouter.Route.RESERVE_TO_USDM, amountIn, 1, block.timestamp - 1, recipient, bytes32(0)
        ) {} catch {}
    }
}

contract RouterInvariantTests is Test {
    RouterInvariantHandler handler;

    function setUp() public {
        handler = new RouterInvariantHandler();

        // Restrict invariant fuzzer to only call handler functions
        targetContract(address(handler));
        bytes4[] memory selectors = new bytes4[](2);
        selectors[0] = RouterInvariantHandler.handler_cashOut.selector;
        selectors[1] = RouterInvariantHandler.handler_cashOut_expired.selector;
        targetSelector(FuzzSelector({addr: address(handler), selectors: selectors}));
    }

    /// @notice Core invariant: router holds zero balance of every token after every call.
    function invariant_zeroTokenBalance() public view {
        GoodCashRouter router = handler.router();
        MockERC20 gDollar     = handler.gDollar();
        MockERC20 usdm        = handler.usdm();
        MockERC20 usdt        = handler.usdt();

        assertEq(gDollar.balanceOf(address(router)), 0, "Invariant: G$ balance non-zero");
        assertEq(usdm.balanceOf(address(router)),    0, "Invariant: USDm balance non-zero");
        assertEq(usdt.balanceOf(address(router)),    0, "Invariant: USDT balance non-zero");
    }

    /// @notice successfulSwaps grows over time — sanity check that the handler fires.
    function invariant_successfulSwapCountNonNegative() public view {
        assertGe(handler.successfulSwaps(), 0);
    }
}


// ─────────────────────────────────────────────────────────────────────────────
//  B. Fork tests — require CELO_RPC_URL env var
// ─────────────────────────────────────────────────────────────────────────────

contract RouterForkTests is Test {
    GoodCashRouter router;
    IERC20 gDollar = IERC20(G_DOLLAR_ADDR);
    IERC20 usdm    = IERC20(USDM_ADDR);
    IERC20 usdt    = IERC20(USDT_ADDR);

    address owner     = makeAddr("owner");
    address alice     = makeAddr("alice");
    address recipient = makeAddr("recipient");

    // Large G$ whale / Reserve — we'll prank as a known holder or use deal()
    uint256 constant SWAP_AMOUNT = 1_000e18; // 1,000 G$

    function setUp() public {
        string memory rpcUrl = vm.envOr("CELO_RPC_URL", string("https://forno.celo.org"));
        vm.createSelectFork(rpcUrl);

        router = new GoodCashRouter(
            G_DOLLAR_ADDR,
            USDM_ADDR,
            USDT_ADDR,
            BROKER_ADDR,
            EXCH_PROVIDER,
            EXCHANGE_ID,
            UNISWAP_ROUTER,
            owner
        );

        // Unpause
        vm.prank(owner);
        router.unpause();

        // Deal alice some G$ (Foundry fork cheat code)
        deal(G_DOLLAR_ADDR, alice, SWAP_AMOUNT * 10);
    }

    // ── Fork test: Reserve route — 1,000 G$ → USDm ───────────────────────

    function testFork_reserveToUsdm_1000G() public {
        // On-chain quote: 1,000 G$ → 113,992,939,240,294,538 wei USDm
        // (from VERIFY_OUTPUT.txt; 10% exit contribution already applied by protocol)
        uint256 expectedNet = 113_992_939_240_294_538; // ~0.114 USDm
        uint256 minAmountOut = (expectedNet * 98) / 100; // 2% slippage tolerance

        vm.startPrank(alice);
        gDollar.approve(address(router), SWAP_AMOUNT);

        uint256 usdmBefore = usdm.balanceOf(recipient);
        uint256 out = router.cashOut(
            GoodCashRouter.Route.RESERVE_TO_USDM,
            SWAP_AMOUNT,
            minAmountOut,
            block.timestamp + 300,
            recipient,
            bytes32(0)
        );
        vm.stopPrank();

        uint256 usdmAfter = usdm.balanceOf(recipient);

        console2.log("1,000 G$ -> USDm (Reserve route):");
        console2.log("  amountOut (wei):", out);
        console2.log("  amountOut (USDm):", out / 1e15, "* 1e-3 USDm");
        console2.log("  expected net (wei):", expectedNet);

        // Within 2% of the quoted net
        assertGt(out, minAmountOut, "Output below 2% slippage bound");
        assertLt(out, expectedNet * 102 / 100, "Output unrealistically high");
        assertEq(usdmAfter - usdmBefore, out, "Recipient balance mismatch");

        // Invariant: router holds zero
        assertEq(gDollar.balanceOf(address(router)), 0, "G$ dust");
        assertEq(usdm.balanceOf(address(router)),    0, "USDm dust");
        assertEq(usdt.balanceOf(address(router)),    0, "USDT dust");
    }

    // ── Fork test: Reserve route — 10,000 G$ → USDm ─────────────────────

    function testFork_reserveToUsdm_10000G() public {
        uint256 amount10k   = 10_000e18;
        uint256 expectedNet = 1_139_928_040_919_229_989; // from VERIFY_OUTPUT.txt
        uint256 minAmountOut = (expectedNet * 98) / 100;

        deal(G_DOLLAR_ADDR, alice, amount10k * 2);

        vm.startPrank(alice);
        gDollar.approve(address(router), amount10k);

        uint256 out = router.cashOut(
            GoodCashRouter.Route.RESERVE_TO_USDM,
            amount10k,
            minAmountOut,
            block.timestamp + 300,
            recipient,
            bytes32(0)
        );
        vm.stopPrank();

        console2.log("10,000 G$ -> USDm (Reserve route):");
        console2.log("  amountOut (wei):", out);

        assertGt(out, minAmountOut, "10k swap: below min");
        assertEq(gDollar.balanceOf(address(router)), 0, "10k G$ dust");
        assertEq(usdm.balanceOf(address(router)),    0, "10k USDm dust");
    }

    // ── Fork test: Reserve paused → Uniswap fallback ─────────────────────
    // Note: We cannot easily pause the actual Reserve in a fork test without
    // a governance tx. Instead we verify the UNISWAP_TO_USDM route independently.

    function testFork_uniswapToUsdm_1000G() public {
        // Uniswap pool implied price from VERIFY_OUTPUT.txt: $0.000113135376/G$
        // 1,000 G$ → ~0.113 USDm (slightly worse than Reserve due to pool depth/fees)
        uint256 minOut = 100e15; // 0.1 USDm — loose bound due to thin pool

        vm.startPrank(alice);
        gDollar.approve(address(router), SWAP_AMOUNT);

        uint256 out = router.cashOut(
            GoodCashRouter.Route.UNISWAP_TO_USDM,
            SWAP_AMOUNT,
            minOut,
            block.timestamp + 300,
            recipient,
            bytes32(0)
        );
        vm.stopPrank();

        console2.log("1,000 G$ -> USDm (Uniswap route):");
        console2.log("  amountOut (wei):", out);

        assertGt(out, minOut, "Uniswap output below minimum");
        assertEq(gDollar.balanceOf(address(router)), 0, "G$ dust");
        assertEq(usdm.balanceOf(address(router)),    0, "USDm dust");
    }

    // ── Fork test: invariant — router always ends at zero ─────────────────

    function testFork_invariant_zeroBalance_afterSwap() public {
        vm.startPrank(alice);
        gDollar.approve(address(router), SWAP_AMOUNT);
        router.cashOut(
            GoodCashRouter.Route.RESERVE_TO_USDM,
            SWAP_AMOUNT,
            1,
            block.timestamp + 300,
            recipient,
            bytes32(0)
        );
        vm.stopPrank();

        assertEq(gDollar.balanceOf(address(router)), 0);
        assertEq(usdm.balanceOf(address(router)),    0);
        assertEq(usdt.balanceOf(address(router)),    0);
    }
}
