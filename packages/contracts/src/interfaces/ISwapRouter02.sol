// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// @title ISwapRouter02 — minimal interface for Uniswap V3 SwapRouter02
/// @dev The router on Celo is the standard Uniswap V3 SwapRouter02.
interface ISwapRouter02 {
    struct ExactInputSingleParams {
        address tokenIn;
        address tokenOut;
        uint24  fee;
        address recipient;
        uint256 amountIn;
        uint256 amountOutMinimum;
        uint160 sqrtPriceLimitX96;
    }

    /// @notice Swaps amountIn of tokenIn for as much tokenOut as possible.
    /// @param params The parameters for the swap, encoded as ExactInputSingleParams.
    /// @return amountOut The amount of the received token.
    function exactInputSingle(ExactInputSingleParams calldata params)
        external
        payable
        returns (uint256 amountOut);
}
