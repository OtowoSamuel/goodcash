// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IERC20} from "openzeppelin-contracts/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "openzeppelin-contracts/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "openzeppelin-contracts/contracts/utils/ReentrancyGuard.sol";
import {Pausable} from "openzeppelin-contracts/contracts/utils/Pausable.sol";

import {IBroker} from "./interfaces/IBroker.sol";
import {ISwapRouter02} from "./interfaces/ISwapRouter02.sol";

/*──────────────────────────────────────────────────────────────────────────────
  GoodCashRouterV2 — one-tap G$ → naira payout router
  ══════════════════════════════════════════════════════════════════════════════

  What it does, in one wallet confirmation:
    1. The customer calls  G$.transferAndCall(router, amount, data)  on the G$ token.
       (G$ is an ERC-677 token. No separate "approve" step is needed.)
    2. G$ hands the tokens to this router and calls onTokenTransfer() in the SAME transaction.
    3. The router swaps G$ → USDT (GoodDollar reserve or Uniswap, then Uniswap).
    4. It sends EXACTLY `payAmount` USDT to `payTo` (the payout partner's deposit address for this
       customer's order) and anything left over back to the customer. Not a cent stays behind.

  Design invariants (enforced in tests):
  ① Custody: the router never keeps anything. Balances after the call are exactly what they were
    before it, so a stray "donation" of dust cannot block it.
  ② Only the G$ token can call onTokenTransfer, and `from` is who really sent the G$ (the token
    passes msg.sender), so nobody can spend someone else's G$ through this router.
  ③ The partner is paid exactly `payAmount`, never more. The surplus goes back to the customer.
  ④ Output below `minOut` reverts; `minOut` must also cover `payAmount`. Deadline in the past reverts.
  ⑤ No arbitrary call primitive: only the two whitelisted venues are ever called.
  ⑥ Every approval to a venue is exact and reset to zero straight after.
  ⑦ No fee. No owner function can move tokens: the owner can only pause and unpause. Starts paused.

  Exit contribution note: the GoodDollar reserve charges a 10% exit contribution on G$ → USDm swaps.
  That is a protocol rule, not a GoodCash fee. Callers account for it in `minOut`.
──────────────────────────────────────────────────────────────────────────────*/

/// @title GoodCashRouterV2
/// @notice Swap G$ to USDT and pay a payout partner exactly, in one transaction.
/// @dev    Owner (a Safe multisig in production) can only pause and unpause.
contract GoodCashRouterV2 is ReentrancyGuard, Pausable {
    using SafeERC20 for IERC20;

    /// @notice The two allowed swap paths. Both end in USDT.
    enum Route {
        RESERVE_THEN_UNISWAP,    // G$ → USDm via the GoodDollar reserve, then USDm → USDT on Uniswap V3
        UNISWAP_THEN_UNISWAP     // G$ → USDm on Uniswap V3, then USDm → USDT on Uniswap V3
    }

    IERC20 public immutable G_DOLLAR;
    IERC20 public immutable USDM;
    IERC20 public immutable USDT;
    IBroker public immutable BROKER;
    address public immutable EXCHANGE_PROVIDER;
    bytes32 public immutable EXCHANGE_ID;
    ISwapRouter02 public immutable UNISWAP_ROUTER;
    address public immutable OWNER;

    /// @dev G$/USDm Uniswap V3 pool fee tier (1%)
    uint24 public constant G_DOLLAR_USDM_FEE = 10_000;
    /// @dev USDm/USDT Uniswap V3 pool fee tier (0.01%)
    uint24 public constant USDM_USDT_FEE = 100;

    /// @param user         The wallet that sent the G$ (and receives any surplus USDT)
    /// @param payTo        Where the payment went (the payout partner's deposit address)
    /// @param gIn          G$ swapped (18 decimals)
    /// @param usdtOut      Total USDT the swap produced (6 decimals)
    /// @param usdtPaid     USDT sent to `payTo`
    /// @param usdtReturned Surplus USDT sent back to `user`
    /// @param route        Which swap path was used
    /// @param ref          Caller-supplied reference (e.g. a payout order id)
    event CashOutPaid(
        address indexed user,
        address indexed payTo,
        uint256 gIn,
        uint256 usdtOut,
        uint256 usdtPaid,
        uint256 usdtReturned,
        Route route,
        bytes32 ref
    );

    error NotOwner();
    error NotGoodDollar();
    error ZeroAmount();
    error ZeroPayAmount();
    error BadRecipient();
    error MinOutBelowPayAmount(uint256 minOut, uint256 payAmount);
    error DeadlineExpired();
    error ZeroOutput();
    error InsufficientOutput(uint256 got, uint256 minimum);
    error TokenLeftBehind(address token);

    modifier onlyOwner() {
        if (msg.sender != OWNER) revert NotOwner();
        _;
    }

    constructor(
        address gDollar,
        address usdm,
        address usdt,
        address broker,
        address exchangeProvider,
        bytes32 exchangeId,
        address uniswapRouter,
        address owner
    ) {
        require(gDollar != address(0), "GoodCashRouterV2: G$ is zero");
        require(usdm != address(0), "GoodCashRouterV2: USDm is zero");
        require(usdt != address(0), "GoodCashRouterV2: USDT is zero");
        require(broker != address(0), "GoodCashRouterV2: broker is zero");
        require(exchangeProvider != address(0), "GoodCashRouterV2: provider is zero");
        require(exchangeId != bytes32(0), "GoodCashRouterV2: exchangeId is zero");
        require(uniswapRouter != address(0), "GoodCashRouterV2: router is zero");
        require(owner != address(0), "GoodCashRouterV2: owner is zero");

        G_DOLLAR = IERC20(gDollar);
        USDM = IERC20(usdm);
        USDT = IERC20(usdt);
        BROKER = IBroker(broker);
        EXCHANGE_PROVIDER = exchangeProvider;
        EXCHANGE_ID = exchangeId;
        UNISWAP_ROUTER = ISwapRouter02(uniswapRouter);
        OWNER = owner;

        // Start paused; the owner must explicitly unpause before production use
        _pause();
    }

    /// @dev What the customer asked for, decoded from the `data` they sent (all fixed-size, so it is
    ///      encoded exactly like abi.encode(route, minOut, deadline, payTo, payAmount, ref)).
    struct Order {
        Route route;
        uint256 minOut;
        uint256 deadline;
        address payTo;
        uint256 payAmount;
        bytes32 ref;
    }

    /// @dev What the router held before the call, so stray dust never matters (and never blocks us).
    struct Snapshot {
        uint256 g;
        uint256 usdm;
        uint256 usdt;
    }

    /// @notice ERC-677 receiver. Called by the G$ token inside G$.transferAndCall(this, amount, data).
    /// @param from    The wallet that called transferAndCall on G$ (supplied by the token, not by the caller)
    /// @param amount  G$ received (after any token fee), 18 decimals
    /// @param data    abi.encode(Route route, uint256 minOut, uint256 deadline, address payTo, uint256 payAmount, bytes32 ref)
    /// @return ok     Always true; any problem reverts the whole transaction (the G$ transfer is undone)
    function onTokenTransfer(address from, uint256 amount, bytes calldata data)
        external
        nonReentrant
        whenNotPaused
        returns (bool ok)
    {
        if (msg.sender != address(G_DOLLAR)) revert NotGoodDollar();
        Order memory o = abi.decode(data, (Order));
        _validate(o, amount);

        // The G$ just arrived, so take it off to learn what the router held before
        Snapshot memory before = _snapshot();
        before.g -= amount;

        uint256 usdtOut = _swapToUsdt(o.route, amount);
        if (usdtOut == 0) revert ZeroOutput();
        if (usdtOut < o.minOut) revert InsufficientOutput(usdtOut, o.minOut);

        // The partner gets exactly payAmount. The customer gets everything else back.
        USDT.safeTransfer(o.payTo, o.payAmount);
        uint256 surplus = usdtOut - o.payAmount;
        if (surplus > 0) USDT.safeTransfer(from, surplus);

        _assertNothingLeftBehind(before);

        emit CashOutPaid(from, o.payTo, amount, usdtOut, o.payAmount, surplus, o.route, o.ref);
        return true;
    }

    function _validate(Order memory o, uint256 amount) internal view {
        if (amount == 0) revert ZeroAmount();
        if (o.payAmount == 0) revert ZeroPayAmount();
        if (o.payTo == address(0) || o.payTo == address(this)) revert BadRecipient();
        if (o.minOut < o.payAmount) revert MinOutBelowPayAmount(o.minOut, o.payAmount);
        if (block.timestamp > o.deadline) revert DeadlineExpired();
    }

    function _snapshot() internal view returns (Snapshot memory snap) {
        snap = Snapshot(G_DOLLAR.balanceOf(address(this)), USDM.balanceOf(address(this)), USDT.balanceOf(address(this)));
    }

    function _assertNothingLeftBehind(Snapshot memory before) internal view {
        if (G_DOLLAR.balanceOf(address(this)) > before.g) revert TokenLeftBehind(address(G_DOLLAR));
        if (USDM.balanceOf(address(this)) > before.usdm) revert TokenLeftBehind(address(USDM));
        if (USDT.balanceOf(address(this)) > before.usdt) revert TokenLeftBehind(address(USDT));
    }

    /// @dev G$ → USDm (reserve or Uniswap) → USDT (Uniswap).
    function _swapToUsdt(Route route, uint256 gIn) internal returns (uint256 usdtOut) {
        uint256 usdmOut = route == Route.RESERVE_THEN_UNISWAP
            ? _swapReserveGDollarToUsdm(gIn)
            : _swapUniswapSingle(address(G_DOLLAR), address(USDM), G_DOLLAR_USDM_FEE, gIn);
        usdtOut = _swapUniswapSingle(address(USDM), address(USDT), USDM_USDT_FEE, usdmOut);
    }

    /// @dev G$ → USDm through the GoodDollar reserve (Mento broker). Exact approval, reset after.
    function _swapReserveGDollarToUsdm(uint256 amountIn) internal returns (uint256 usdmOut) {
        G_DOLLAR.forceApprove(address(BROKER), amountIn);
        usdmOut = BROKER.swapIn(EXCHANGE_PROVIDER, EXCHANGE_ID, address(G_DOLLAR), address(USDM), amountIn, 1);
        G_DOLLAR.forceApprove(address(BROKER), 0);
        if (usdmOut == 0) revert ZeroOutput();
    }

    /// @dev Uniswap V3 exactInputSingle with an exact approval that is reset afterwards.
    function _swapUniswapSingle(address tokenIn, address tokenOut, uint24 fee, uint256 amountIn)
        internal
        returns (uint256 amountOut)
    {
        IERC20(tokenIn).forceApprove(address(UNISWAP_ROUTER), amountIn);
        amountOut = UNISWAP_ROUTER.exactInputSingle(
            ISwapRouter02.ExactInputSingleParams({
                tokenIn: tokenIn,
                tokenOut: tokenOut,
                fee: fee,
                recipient: address(this),
                amountIn: amountIn,
                amountOutMinimum: 1, // the final minOut check guards the result
                sqrtPriceLimitX96: 0
            })
        );
        IERC20(tokenIn).forceApprove(address(UNISWAP_ROUTER), 0);
        if (amountOut == 0) revert ZeroOutput();
    }

    /// @notice Stop all cash outs. Customers' funds are never held, so there is nothing to lock.
    function pause() external onlyOwner {
        _pause();
    }

    /// @notice Allow cash outs again.
    function unpause() external onlyOwner {
        _unpause();
    }
}
