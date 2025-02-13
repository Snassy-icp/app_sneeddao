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
    let total0 = positionDetails.token0Amount;
    let total1 = positionDetails.token1Amount;

    if (!hideUnclaimedFees) {
        total0 += positionDetails.tokensOwed0 + positionDetails.tokensUnused0;
        total1 += positionDetails.tokensOwed1 + positionDetails.tokensUnused1;
    }

    let total0USD = parseFloat(formatAmountWithConversion(total0, position.token0Decimals, position.token0_conversion_rate));
    let total1USD = parseFloat(formatAmountWithConversion(total1, position.token1Decimals, position.token1_conversion_rate));

    let total = total0USD + total1USD;
    return total;
}

export {
    getIcpSwapLink,
    isLockedPosition,
    lockFromLocks,
    getPositionTVL
}
