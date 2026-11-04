// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IERC20} from "openzeppelin-contracts/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "openzeppelin-contracts/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "openzeppelin-contracts/contracts/utils/ReentrancyGuard.sol";
import {Pausable} from "openzeppelin-contracts/contracts/utils/Pausable.sol";

import {IBroker} from "./interfaces/IBroker.sol";
import {ISwapRouter02} from "./interfaces/ISwapRouter02.sol";

/*──────────────────────────────────────────────────────────────────────────────
  GoodCashRouter — non-custodial G$ → USDT router
  ══════════════════════════════════════════════════════════════════════════════

  Design invariants (enforced in tests):
  ① The contract holds zero token balance after every external call.
  ② No arbitrary call primitive: only the two whitelisted venues are called.
  ③ All ERC-20 approvals are exact and reset to zero after each hop.
  ④ Output below minAmountOut reverts.
  ⑤ No infinity approvals.

  Venue allowlist (immutable):
  • GoodDollar Broker (swapIn) — Reserve route for G$ → USDm
  • Uniswap V3 SwapRouter02   — Single-hop exact-input for G$/USDm and USDm/USDT

  Exit contribution note:
  The GoodDollar Reserve charges a 10% exit contribution on G$ → USDm swaps.
  This is a protocol-level fee enforced on-chain; it is NOT a GoodCash fee.
  Callers must account for it in their minAmountOut.

──────────────────────────────────────────────────────────────────────────────*/

/// @title GoodCashRouter
/// @notice Routes G$ to USDT via the GoodDollar Reserve and/or Uniswap V3.
/// @dev    Non-custodial: every code path ends with the router holding zero tokens.
///         Owner is a Safe multisig; all privileged functions are gated by Pausable + onlyOwner.
contract GoodCashRouter is ReentrancyGuard, Pausable {
    using SafeERC20 for IERC20;

    // ────────────────────────────────────────────────────────────────────────
    //  Enumerations
    // ────────────────────────────────────────────────────────────────────────

    /// @notice The four allowed swap routes.
    /// @dev    Adding new routes requires a contract upgrade; arbitrary paths are disallowed.
    enum Route {
        RESERVE_TO_USDM,          // G$ → USDm via Reserve (then caller keeps USDm)
        UNISWAP_TO_USDM,          // G$ → USDm via Uniswap V3
        RESERVE_THEN_UNISWAP,     // G$ → USDm via Reserve, then USDm → USDT via Uniswap V3
        UNISWAP_THEN_UNISWAP      // G$ → USDm via Uniswap V3, then USDm → USDT via Uniswap V3
    }

    // ────────────────────────────────────────────────────────────────────────
    //  Immutable state (set once at construction; cannot be changed)
    // ────────────────────────────────────────────────────────────────────────

    /// @dev Celo mainnet G$ token (18 decimals)
    IERC20  public immutable G_DOLLAR;
    /// @dev Celo mainnet USDm/cUSD token (18 decimals)
    IERC20  public immutable USDM;
    /// @dev Celo mainnet USDT token (6 decimals)
    IERC20  public immutable USDT;

    /// @dev GoodDollar Broker proxy — the only venue allowed for Reserve swaps
    IBroker public immutable BROKER;
    /// @dev GoodDollar Exchange Provider — used for pre-swap quoting
    address public immutable EXCHANGE_PROVIDER;
    /// @dev G$/USDm exchange ID on the Exchange Provider
    bytes32 public immutable EXCHANGE_ID;

    /// @dev Uniswap V3 SwapRouter02 — the only venue allowed for Uniswap swaps
    ISwapRouter02 public immutable UNISWAP_ROUTER;

    /// @dev Fee tier for the G$/USDm Uniswap V3 pool (1%, encoded as 10000 / 1e6)
    uint24 public constant G_DOLLAR_USDM_FEE = 10_000;

    /// @dev Fee tier for USDm/USDT swaps — NOTE: not independently verified yet.
    ///      If the pool does not exist at this tier, the transaction will revert.
    ///      See docs/CONTRACT.md for the verification step before this route is used in production.
    uint24 public constant USDM_USDT_FEE = 3_000; // 0.3% — most common for stablecoin pairs

    /// @dev Maximum feeBps the owner can ever set (1%). Guards against fat-finger.
    uint256 public constant MAX_FEE_BPS = 100; // 1 %

    /// @dev Owner address (should be a Gnosis Safe)
    address public immutable OWNER;

    // ────────────────────────────────────────────────────────────────────────
    //  Mutable state
    // ────────────────────────────────────────────────────────────────────────

    /// @notice Protocol fee in basis points. 0 in MVP. Max 100 (1%).
    /// @dev    Fee is taken from amountIn before the swap. Disabled until explicitly set > 0.
    uint256 public feeBps;

    /// @notice Allowlist of accepted output token addresses.
    /// @dev    At deploy time only USDm and USDT are allowed.
    mapping(address => bool) public allowedOutputs;

    // ────────────────────────────────────────────────────────────────────────
    //  Events
    // ────────────────────────────────────────────────────────────────────────

    /// @notice Emitted on every successful cash-out.
    /// @param  user       Address that called cashOut (the G$ holder)
    /// @param  recipient  Address that received the output token
    /// @param  tokenOut   Address of the output token (USDm or USDT)
    /// @param  amountIn   G$ amount consumed
    /// @param  amountOut  Output token amount delivered to recipient
    /// @param  route      Enum variant used for this swap
    /// @param  ref        Caller-supplied 32-byte reference (e.g. Paycrest order id)
    event CashOut(
        address indexed user,
        address indexed recipient,
        address indexed tokenOut,
        uint256 amountIn,
        uint256 amountOut,
        Route   route,
        bytes32 ref
    );

    event FeeBpsSet(uint256 oldFeeBps, uint256 newFeeBps);
    event AllowedOutputSet(address token, bool allowed);
    event Rescued(address token, address to, uint256 amount);

    // ────────────────────────────────────────────────────────────────────────
    //  Errors
    // ────────────────────────────────────────────────────────────────────────

    error NotOwner();
    error ZeroAmount();
    error ZeroMinAmountOut();
    error ZeroRecipient();
    error DeadlineExpired();
    error InsufficientOutput(uint256 got, uint256 minRequired);
    error OutputNotAllowed(address token);
    error FeeTooHigh(uint256 requested, uint256 max);
    error ZeroOutput();
    error NonZeroBalanceAfterSwap(address token, uint256 balance);

    // ────────────────────────────────────────────────────────────────────────
    //  Modifiers
    // ────────────────────────────────────────────────────────────────────────

    modifier onlyOwner() {
        if (msg.sender != OWNER) revert NotOwner();
        _;
    }

    // ────────────────────────────────────────────────────────────────────────
    //  Constructor
    // ────────────────────────────────────────────────────────────────────────

    /// @param gDollar          G$ token address
    /// @param usdm             USDm token address
    /// @param usdt             USDT token address
    /// @param broker           GoodDollar Broker proxy
    /// @param exchangeProvider GoodDollar Exchange Provider
    /// @param exchangeId       G$/USDm exchange ID
    /// @param uniswapRouter    Uniswap V3 SwapRouter02 address
    /// @param owner            Owner address (must be a Safe multisig in production)
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
        require(gDollar        != address(0), "GoodCashRouter: G$ is zero");
        require(usdm           != address(0), "GoodCashRouter: USDm is zero");
        require(usdt           != address(0), "GoodCashRouter: USDT is zero");
        require(broker         != address(0), "GoodCashRouter: broker is zero");
        require(exchangeProvider != address(0), "GoodCashRouter: provider is zero");
        require(exchangeId     != bytes32(0), "GoodCashRouter: exchangeId is zero");
        require(uniswapRouter  != address(0), "GoodCashRouter: router is zero");
        require(owner          != address(0), "GoodCashRouter: owner is zero");

        G_DOLLAR          = IERC20(gDollar);
        USDM              = IERC20(usdm);
        USDT              = IERC20(usdt);
        BROKER            = IBroker(broker);
        EXCHANGE_PROVIDER = exchangeProvider;
        EXCHANGE_ID       = exchangeId;
        UNISWAP_ROUTER    = ISwapRouter02(uniswapRouter);
        OWNER             = owner;

        // Allow USDm and USDT as valid outputs at deploy time
        allowedOutputs[usdm] = true;
        allowedOutputs[usdt] = true;

        // Start paused; owner must explicitly unpause before production use
        _pause();
    }

    // ────────────────────────────────────────────────────────────────────────
    //  Core: cashOut
    // ────────────────────────────────────────────────────────────────────────

    /// @notice Swap G$ to USDm or USDT using the specified route.
    /// @dev    Caller must approve this contract for `amountIn` G$ before calling.
    ///         All intermediate approvals are exact and reset to zero after each hop.
    ///         The function reverts if the router holds any token balance at exit.
    ///
    /// @param  route        Which swap path to use (see Route enum)
    /// @param  amountIn     Amount of G$ to swap (18 decimals)
    /// @param  minAmountOut Minimum acceptable output (in output token decimals). Protects slippage.
    /// @param  deadline     Unix timestamp — reverts if block.timestamp > deadline
    /// @param  recipient    Address to receive the output token (can differ from caller)
    /// @param  ref          Caller-supplied reference (e.g. a Paycrest order ID). Logged in event.
    /// @return amountOut    Actual amount of output token delivered to recipient
    function cashOut(
        Route   route,
        uint256 amountIn,
        uint256 minAmountOut,
        uint256 deadline,
        address recipient,
        bytes32 ref
    ) external nonReentrant whenNotPaused returns (uint256 amountOut) {
        // ── Input validation ──────────────────────────────────────────────
        if (amountIn     == 0) revert ZeroAmount();
        if (minAmountOut == 0) revert ZeroMinAmountOut();
        if (recipient    == address(0)) revert ZeroRecipient();
        if (block.timestamp > deadline) revert DeadlineExpired();

        // ── Fee deduction (MVP: feeBps == 0, so no fee) ───────────────────
        uint256 effectiveAmountIn = _deductFee(amountIn);

        // ── Pull G$ from caller ───────────────────────────────────────────
        G_DOLLAR.safeTransferFrom(msg.sender, address(this), effectiveAmountIn);

        // ── Route dispatch ────────────────────────────────────────────────
        address tokenOut;
        if (route == Route.RESERVE_TO_USDM) {
            tokenOut  = address(USDM);
            amountOut = _swapReserveGDollarToUsdm(effectiveAmountIn, 1 /* let minAmountOut guard below */);
        } else if (route == Route.UNISWAP_TO_USDM) {
            tokenOut  = address(USDM);
            amountOut = _swapUniswapSingle(address(G_DOLLAR), address(USDM), G_DOLLAR_USDM_FEE, effectiveAmountIn, 1);
        } else if (route == Route.RESERVE_THEN_UNISWAP) {
            tokenOut  = address(USDT);
            uint256 usdmOut = _swapReserveGDollarToUsdm(effectiveAmountIn, 1);
            amountOut = _swapUniswapSingle(address(USDM), address(USDT), USDM_USDT_FEE, usdmOut, 1);
        } else {
            // Route.UNISWAP_THEN_UNISWAP
            tokenOut  = address(USDT);
            uint256 usdmOut = _swapUniswapSingle(address(G_DOLLAR), address(USDM), G_DOLLAR_USDM_FEE, effectiveAmountIn, 1);
            amountOut = _swapUniswapSingle(address(USDM), address(USDT), USDM_USDT_FEE, usdmOut, 1);
        }

        // ── Slippage guard ────────────────────────────────────────────────
        if (amountOut == 0) revert ZeroOutput();
        if (amountOut < minAmountOut) revert InsufficientOutput(amountOut, minAmountOut);

        // ── Output token allowlist ────────────────────────────────────────
        if (!allowedOutputs[tokenOut]) revert OutputNotAllowed(tokenOut);

        // ── Deliver output to recipient ───────────────────────────────────
        IERC20(tokenOut).safeTransfer(recipient, amountOut);

        // ── Invariant: router must hold zero balance ──────────────────────
        _assertZeroBalance(address(G_DOLLAR));
        _assertZeroBalance(address(USDM));
        _assertZeroBalance(address(USDT));

        emit CashOut(msg.sender, recipient, tokenOut, amountIn, amountOut, route, ref);
    }

    // ────────────────────────────────────────────────────────────────────────
    //  Internal swap helpers
    // ────────────────────────────────────────────────────────────────────────

    /// @dev Swaps G$ → USDm using the GoodDollar Reserve Broker.
    ///      Exit contribution (10%) is deducted on-chain by the protocol.
    /// @param amountIn    G$ amount held by this contract (18 dec)
    /// @param amountOutMin Minimum USDm required (pass 1 and guard at the top level)
    /// @return usdmOut   USDm received (18 dec)
    function _swapReserveGDollarToUsdm(uint256 amountIn, uint256 amountOutMin)
        internal
        returns (uint256 usdmOut)
    {
        // Exact approval for the Broker; reset after the call
        G_DOLLAR.forceApprove(address(BROKER), amountIn);

        usdmOut = BROKER.swapIn(
            EXCHANGE_PROVIDER,
            EXCHANGE_ID,
            address(G_DOLLAR),
            address(USDM),
            amountIn,
            amountOutMin
        );

        // Reset approval to zero (Broker should have consumed it, but be explicit)
        G_DOLLAR.forceApprove(address(BROKER), 0);

        if (usdmOut == 0) revert ZeroOutput();
    }

    /// @dev Swaps tokenIn → tokenOut using Uniswap V3 exactInputSingle.
    /// @param tokenIn      Input token (held by this contract)
    /// @param tokenOut     Output token (sent to this contract)
    /// @param fee          Pool fee tier
    /// @param amountIn     Amount of tokenIn to swap
    /// @param amountOutMin Minimum output (1 — slippage guarded at the top level)
    /// @return amountOut   Amount of tokenOut received
    function _swapUniswapSingle(
        address tokenIn,
        address tokenOut,
        uint24  fee,
        uint256 amountIn,
        uint256 amountOutMin
    ) internal returns (uint256 amountOut) {
        // Exact approval for the Uniswap router
        IERC20(tokenIn).forceApprove(address(UNISWAP_ROUTER), amountIn);

        amountOut = UNISWAP_ROUTER.exactInputSingle(
            ISwapRouter02.ExactInputSingleParams({
                tokenIn:           tokenIn,
                tokenOut:          tokenOut,
                fee:               fee,
                recipient:         address(this),
                amountIn:          amountIn,
                amountOutMinimum:  amountOutMin,
                sqrtPriceLimitX96: 0
            })
        );

        // Reset approval (Uniswap should have consumed it)
        IERC20(tokenIn).forceApprove(address(UNISWAP_ROUTER), 0);

        if (amountOut == 0) revert ZeroOutput();
    }

    /// @dev Deducts the protocol fee from amountIn.
    ///      In MVP (feeBps == 0) this is a no-op.
    function _deductFee(uint256 amountIn) internal view returns (uint256 effectiveAmountIn) {
        if (feeBps == 0) return amountIn;
        uint256 feeAmount = (amountIn * feeBps) / 10_000;
        effectiveAmountIn = amountIn - feeAmount;
        // Note: fee is kept by the router (not transferred anywhere in MVP).
        // A future `collectFees` function could send it to a treasury.
    }

    /// @dev Reverts if this contract holds any balance of `token`.
    ///      Enforces the zero-balance invariant.
    function _assertZeroBalance(address token) internal view {
        uint256 bal = IERC20(token).balanceOf(address(this));
        if (bal != 0) revert NonZeroBalanceAfterSwap(token, bal);
    }

    // ────────────────────────────────────────────────────────────────────────
    //  Owner-only privileged functions
    // ────────────────────────────────────────────────────────────────────────

    /// @notice Pause the contract. No swaps can execute while paused.
    function pause() external onlyOwner {
        _pause();
    }

    /// @notice Unpause the contract. Must be called explicitly after deploy.
    function unpause() external onlyOwner {
        _unpause();
    }

    /// @notice Update the allowed-output allowlist.
    /// @dev    Restricts outputs to known tokens; prevents the router from becoming
    ///         a general-purpose swapper for arbitrary tokens.
    function setAllowedOutput(address token, bool allowed) external onlyOwner {
        require(token != address(0), "GoodCashRouter: zero token");
        allowedOutputs[token] = allowed;
        emit AllowedOutputSet(token, allowed);
    }

    /// @notice Set the protocol fee. Capped at MAX_FEE_BPS (100 = 1%). 0 in MVP.
    /// @dev    Setting feeBps > 0 means users will receive less than amountIn in effective G$.
    ///         The UI must reflect this if feeBps ever becomes non-zero.
    function setFeeBps(uint256 newFeeBps) external onlyOwner {
        if (newFeeBps > MAX_FEE_BPS) revert FeeTooHigh(newFeeBps, MAX_FEE_BPS);
        emit FeeBpsSet(feeBps, newFeeBps);
        feeBps = newFeeBps;
    }

    /// @notice Rescue stuck tokens.
    /// @dev    Cannot be called while paused (pausing is the emergency stop).
    ///         The owner is a Safe, so this requires multisig approval.
    ///         This function exists for edge cases (e.g. a failed hop that left dust).
    ///         It CANNOT rescue user funds in transit because every call either completes
    ///         or reverts — the router never ends a successful call with a non-zero balance.
    /// @param  token  Token address to rescue
    /// @param  to     Destination address
    /// @param  amount Amount to transfer
    function rescue(address token, address to, uint256 amount) external onlyOwner whenNotPaused {
        require(to != address(0), "GoodCashRouter: rescue to zero");
        IERC20(token).safeTransfer(to, amount);
        emit Rescued(token, to, amount);
    }
}
