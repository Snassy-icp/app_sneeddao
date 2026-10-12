import { computeUsdValue } from './StringUtils';
import { principalText } from './IdUtils';

// ICPSwap app links (the old info.icpswap.com swap-scan URLs no longer resolve).
function getIcpSwapPoolLink(swapCanisterId) {
    return `https://app.icpswap.com/info-swap/pool/details/${principalText(swapCanisterId)}`;
}

function getIcpSwapPositionLink(swapCanisterId, positionId) {
    return `https://app.icpswap.com/liquidity/position/${String(positionId)}/${principalText(swapCanisterId)}`;
}

// Link for a position card: the position itself when its id is known,
// otherwise the pool.
function getIcpSwapLink(position, positionDetails) {
    const positionId = positionDetails?.positionId;
    if (positionId !== undefined && positionId !== null) {
        return getIcpSwapPositionLink(position.swapCanisterId, positionId);
    }
    return getIcpSwapPoolLink(position.swapCanisterId);
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

    // Compute numerically. Parsing the locale-formatted display string here
    // used to truncate "3,971.73" to 3 and showed totals like $6.00.
    let total0USD = computeUsdValue(total0, decimals0, position.token0_conversion_rate);
    let total1USD = computeUsdValue(total1, decimals1, position.token1_conversion_rate);

    let total = total0USD + total1USD;
    return isNaN(total) ? 0 : total;
}

export {
    getIcpSwapLink,
    getIcpSwapPoolLink,
    getIcpSwapPositionLink,
    isLockedPosition,
    lockFromLocks,
    getPositionTVL
}
