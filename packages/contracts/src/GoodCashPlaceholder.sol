// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

contract GoodCashPlaceholder {
    string public constant NAME = 'GoodCash';

    function ping() external pure returns (string memory) {
        return NAME;
    }
}
