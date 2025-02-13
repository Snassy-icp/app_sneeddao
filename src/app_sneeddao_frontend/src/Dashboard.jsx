import React, { useState, useEffect } from 'react';
import { useAuth } from './AuthContext';
import { createActor as createIcpSwapActor } from 'external/icp_swap';
import { toJsonString, formatAmount } from './utils/StringUtils';
import { createActor as createSneedLockActor, canisterId as sneedLockCanisterId  } from 'external/sneed_lock';

function Dashboard() {
    const { identity } = useAuth();
    const [tokenLocks, setTokenLocks] = useState([]);
    const [positionLocks, setPositionLocks] = useState([]);
    const [positionDetails, setPositionDetails] = useState({});

    const swapCanisterCache = { };

    useEffect(() => {
        if (identity) {
            fetchDashboardData();
        }
    }, [identity]);

    async function fetchPositionDetails(swapCanisterId) {
        const swapActor = createIcpSwapActor(swapCanisterId, { agentOptions: { identity } });

        try {
            const tokenMeta = await swapActor.getTokenMeta();
            const token0Decimals = tokenMeta.token0[2][1].Nat;
            const token1Decimals = tokenMeta.token1[2][1].Nat;
            const token0Symbol = tokenMeta.token0[1][1].Text;
            const token1Symbol = tokenMeta.token1[1][1].Text;

            let offset = 0;
            const limit = 10;
            let allPositions = [];
            let hasMorePositions = true;

            while (hasMorePositions) {
                const positionsResult = await swapActor.getUserPositionWithTokenAmount(offset, limit);
                const positions = positionsResult.ok.content;

                allPositions = [...allPositions, ...positions];
                offset += limit;
                hasMorePositions = positions.length === limit;
            }

            swapCanisterCache[swapCanisterId.toText()] = {
                positions: allPositions,
                token0Decimals,
                token1Decimals,
                token0Symbol,
                token1Symbol,
            };
        } catch (error) {
            console.error(`Error fetching data for swap canister ${swapCanisterId.toText()}:`, error);
            swapCanisterCache[swapCanisterId.toText()] = { error: true };
        }
    }

    const fetchDashboardData = async () => {
        const sneedLockActor = createSneedLockActor(sneedLockCanisterId, { agentOptions: { identity } });
        
        // Fetch token locks
        const allTokenLocks = await sneedLockActor.get_all_token_locks();
        setTokenLocks(allTokenLocks);
    
        // Fetch position locks
        const allPositionLocks = await sneedLockActor.get_all_position_locks();
        setPositionLocks(allPositionLocks);
    
        // Fetch position details for each locked position
        const details = {};
        for (const lock of allPositionLocks) {
            const swapCanisterId = lock[1];
            const positionId = lock[2].position_id;
            
            if (!swapCanisterCache[swapCanisterId.toText()]) {
                await fetchPositionDetails(swapCanisterId);
            }
    
            const canisterData = swapCanisterCache[swapCanisterId.toText()];
            if (!canisterData.error) {
                const matchingPosition = canisterData.positions.find(p => p.id === positionId);
    
                if (matchingPosition) {
                    details[`${swapCanisterId.toText()}-${positionId}`] = {
                        token0Amount: formatAmount(matchingPosition.token0Amount, canisterData.token0Decimals),
                        token1Amount: formatAmount(matchingPosition.token1Amount, canisterData.token1Decimals),
                        token0Symbol: canisterData.token0Symbol,
                        token1Symbol: canisterData.token1Symbol,
                    };
                }
            }
        }
        setPositionDetails(details);
    };

    return (
        <div>
            <h1>Dashboard</h1>
            
            <h2>Token Locks</h2>
            <pre>{toJsonString(tokenLocks)}</pre>
            
            <h2>Position Locks</h2>
            {positionLocks.map((lock, index) => (
                <div key={index}>
                    <h3>Lock {index + 1}</h3>
                    <pre>{toJsonString(lock)}</pre>
                    {positionDetails[`${lock[1].toText()}-${lock[2].position_id}`] && (
                        <div>
                            <h4>Position Details</h4>
                            <p>Token0: {positionDetails[`${lock[1].toText()}-${lock[2].position_id}`].token0Amount} {positionDetails[`${lock[1].toText()}-${lock[2].position_id}`].token0Symbol}</p>
                            <p>Token1: {positionDetails[`${lock[1].toText()}-${lock[2].position_id}`].token1Amount} {positionDetails[`${lock[1].toText()}-${lock[2].position_id}`].token1Symbol}</p>
                        </div>
                    )}
                </div>
            ))}
        </div>
    );
}

export default Dashboard;