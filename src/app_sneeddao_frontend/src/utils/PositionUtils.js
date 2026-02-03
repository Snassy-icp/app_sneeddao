import { formatAmountWithConversion } from './StringUtils';

function getIcpSwapLink(position) {
    return "https://info.icpswap.com/swap-scan/positions?pair=" + position.swapCanisterId;
}

const isLockedPosition = (position) => {
    return position.lockInfo !== null;
};

const lockFromLocks = (positionId, position_locks) => {
    for (const lock of position_locks) {
        if (lock[2].position_id === positionId) {
            return lock;
        }
    }
    return null;
};

function getPositionTVL(position, positionDetails, hideUnclaimedFees) {
    // Handle both token0Amount/token1Amount and amount0/amount1 naming conventions
    // Ensure all values are BigInt for consistent arithmetic
    let total0 = BigInt(positionDetails.token0Amount ?? positionDetails.amount0 ?? 0n);
    let total1 = BigInt(positionDetails.token1Amount ?? positionDetails.amount1 ?? 0n);

    if (!hideUnclaimedFees) {
        total0 += BigInt(positionDetails.tokensOwed0 ?? 0n);
        total1 += BigInt(positionDetails.tokensOwed1 ?? 0n);
    }

    // Ensure decimals are numbers
    const decimals0 = Number(position.token0Decimals ?? 8);
    const decimals1 = Number(position.token1Decimals ?? 8);

    let total0USD = parseFloat(formatAmountWithConversion(total0, decimals0, position.token0_conversion_rate));
    let total1USD = parseFloat(formatAmountWithConversion(total1, decimals1, position.token1_conversion_rate));

    let total = total0USD + total1USD;
    return isNaN(total) ? 0 : total;
}

export {
    getIcpSwapLink,
    isLockedPosition,
    lockFromLocks,
    getPositionTVL
}
