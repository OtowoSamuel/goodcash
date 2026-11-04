// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// @title IExchangeProvider — minimal interface for the GoodDollar Exchange Provider
/// @dev Verified address: 0x2fFBB49055d487DdBBb0C052Cd7c2a02A7971e41
interface IExchangeProvider {
    /// @notice Get the amount of tokenOut received for a given amountIn of tokenIn.
    /// @param exchangeId  Bytes32 id of the trading pair
    /// @param tokenIn     Token being sold
    /// @param tokenOut    Token being bought
    /// @param amountIn    Amount of tokenIn (in its native decimals)
    /// @return amountOut  Amount of tokenOut that would be received
    function getAmountOut(
        bytes32 exchangeId,
        address tokenIn,
        address tokenOut,
        uint256 amountIn
    ) external view returns (uint256 amountOut);

    /// @notice Get list of registered exchange IDs.
    function getExchangeIds() external view returns (bytes32[] memory);
}
