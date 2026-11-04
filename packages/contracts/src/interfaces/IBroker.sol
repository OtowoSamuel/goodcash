// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// @title IBroker — minimal interface for the GoodDollar Broker proxy
/// @dev Verified address: 0x88de45906D4F5a57315c133620cfa484cB297541
interface IBroker {
    /// @notice Swap tokenIn for tokenOut via a specific exchange provider.
    /// @dev The Broker pulls `amountIn` of `tokenIn` from msg.sender (must have approval).
    ///      Output lands at msg.sender.
    /// @param exchangeProvider Address of the exchange provider
    /// @param exchangeId       Bytes32 id of the trading pair
    /// @param tokenIn          Token being sold
    /// @param tokenOut         Token being bought
    /// @param amountIn         Amount of tokenIn to sell (in its native decimals)
    /// @param amountOutMin     Minimum acceptable output (reverts if not met)
    /// @return amountOut       Actual amount of tokenOut received
    function swapIn(
        address exchangeProvider,
        bytes32 exchangeId,
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 amountOutMin
    ) external returns (uint256 amountOut);

    /// @notice Get the exchange provider addresses registered with this broker.
    function getExchangeProviders() external view returns (address[] memory);
}
