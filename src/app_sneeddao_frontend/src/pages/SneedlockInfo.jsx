import React, { useState, useEffect } from 'react';
import { useAuth } from '../AuthContext';
import { createActor as createSneedLockActor, canisterId as sneedLockCanisterId } from 'external/sneed_lock';
import { createActor as createLedgerActor } from 'external/icrc1_ledger';
import { createActor as createIcpSwapActor } from 'external/icp_swap';
import { formatAmount } from '../utils/StringUtils';
import Header from '../components/Header';
import { Principal } from '@dfinity/principal';

function SneedlockInfo() {
    const { identity } = useAuth();
    const [tokenData, setTokenData] = useState({});
    const [loading, setLoading] = useState(true);
    const [tokenSymbols, setTokenSymbols] = useState({});

    // Cache for swap canister data
    const swapCanisterCache = {};

    const fetchTokenSymbol = async (tokenId) => {
        try {
            const ledgerActor = createLedgerActor(tokenId, { agentOptions: { identity } });
            const metadata = await ledgerActor.icrc1_metadata();
            const symbolEntry = metadata.find(entry => entry[0] === 'symbol');
            if (symbolEntry) {
                return symbolEntry[1].Text;
            }
            return tokenId.toText();
        } catch (error) {
            console.error(`Error fetching symbol for token ${tokenId.toText()}:`, error);
            return tokenId.toText();
        }
    };

    async function fetchPositionDetails(swapCanisterId) {
        if (swapCanisterCache[swapCanisterId.toText()]) {
            return swapCanisterCache[swapCanisterId.toText()];
        }

        const swapActor = createIcpSwapActor(swapCanisterId, { agentOptions: { identity } });

        try {
            const tokenMeta = await swapActor.getTokenMeta();
            const token0Decimals = tokenMeta.token0[2][1].Nat;
            const token1Decimals = tokenMeta.token1[2][1].Nat;
            const token0Symbol = tokenMeta.token0[1][1].Text;
            const token1Symbol = tokenMeta.token1[1][1].Text;
            const token0Id = tokenMeta.token0[0];
            const token1Id = tokenMeta.token1[0];

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

            const data = {
                positions: allPositions,
                token0Decimals,
                token1Decimals,
                token0Symbol,
                token1Symbol,
                token0Id,
                token1Id
            };

            swapCanisterCache[swapCanisterId.toText()] = data;
            return data;
        } catch (error) {
            console.error(`Error fetching data for swap canister ${swapCanisterId.toText()}:`, error);
            swapCanisterCache[swapCanisterId.toText()] = { error: true };
            return { error: true };
        }
    }

    const fetchData = async () => {
        setLoading(true);
        try {
            const sneedLockActor = createSneedLockActor(sneedLockCanisterId, { agentOptions: { identity } });
            
            // Fetch all locks
            const allTokenLocks = await sneedLockActor.get_all_token_locks();
            const allPositionLocks = await sneedLockActor.get_all_position_locks();

            // Aggregate token locks by token type
            const aggregatedData = {};
            const symbols = {};

            // Process token locks
            for (const lock of allTokenLocks) {
                const tokenId = lock[1];
                const amount = BigInt(lock[2].amount);
                const tokenKey = tokenId.toText();

                if (!aggregatedData[tokenKey]) {
                    aggregatedData[tokenKey] = {
                        tokenId,
                        tokenLockAmount: 0n,
                        positionLockAmount: 0n,
                        positionsLoading: true
                    };
                }
                aggregatedData[tokenKey].tokenLockAmount += amount;

                // Fetch symbol if not already fetched
                if (!symbols[tokenKey]) {
                    symbols[tokenKey] = await fetchTokenSymbol(tokenId);
                }
            }

            setTokenSymbols(symbols);

            // Process position locks
            for (const lock of allPositionLocks) {
                const swapCanisterId = lock[1];
                const positionId = lock[2].position_id;
                const token0 = lock[2].token0;
                const token1 = lock[2].token1;

                // Fetch position details
                const canisterData = await fetchPositionDetails(swapCanisterId);
                if (!canisterData.error) {
                    const matchingPosition = canisterData.positions.find(p => p.id === positionId);
                    if (matchingPosition) {
                        // Add token0 amount
                        const token0Key = token0.toText();
                        if (!aggregatedData[token0Key]) {
                            aggregatedData[token0Key] = {
                                tokenId: token0,
                                tokenLockAmount: 0n,
                                positionLockAmount: 0n,
                                positionsLoading: false
                            };
                            symbols[token0Key] = canisterData.token0Symbol;
                        }
                        aggregatedData[token0Key].positionLockAmount += BigInt(matchingPosition.token0Amount);

                        // Add token1 amount
                        const token1Key = token1.toText();
                        if (!aggregatedData[token1Key]) {
                            aggregatedData[token1Key] = {
                                tokenId: token1,
                                tokenLockAmount: 0n,
                                positionLockAmount: 0n,
                                positionsLoading: false
                            };
                            symbols[token1Key] = canisterData.token1Symbol;
                        }
                        aggregatedData[token1Key].positionLockAmount += BigInt(matchingPosition.token1Amount);
                    }
                }
            }

            // Update state
            setTokenData(aggregatedData);
            setTokenSymbols(symbols);
        } catch (error) {
            console.error('Error fetching data:', error);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        if (identity) {
            fetchData();
        }
    }, [identity]);

    return (
        <div className='page-container'>
            <Header />
            <main className="wallet-container">
                <h1 style={{ color: '#ffffff', marginBottom: '20px' }}>SneedLock Info</h1>
                
                {loading ? (
                    <div style={{ display: 'flex', justifyContent: 'center', padding: '40px' }}>
                        <div className="spinner"></div>
                    </div>
                ) : (
                    <div style={{ backgroundColor: '#2a2a2a', borderRadius: '8px', padding: '20px' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                            <thead>
                                <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
                                    <th style={{ padding: '10px', textAlign: 'left', color: '#888' }}>Token</th>
                                    <th style={{ padding: '10px', textAlign: 'right', color: '#888' }}>Token Locks</th>
                                    <th style={{ padding: '10px', textAlign: 'right', color: '#888' }}>Position Locks</th>
                                    <th style={{ padding: '10px', textAlign: 'right', color: '#888' }}>Total Locked</th>
                                </tr>
                            </thead>
                            <tbody>
                                {Object.entries(tokenData).map(([tokenKey, data]) => (
                                    <tr 
                                        key={tokenKey}
                                        style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}
                                    >
                                        <td style={{ padding: '10px', color: '#fff' }}>
                                            {tokenSymbols[tokenKey] || tokenKey}
                                        </td>
                                        <td style={{ padding: '10px', textAlign: 'right', color: '#fff' }}>
                                            {formatAmount(data.tokenLockAmount, 8)}
                                        </td>
                                        <td style={{ padding: '10px', textAlign: 'right', color: '#fff' }}>
                                            {data.positionsLoading ? (
                                                <div className="spinner" style={{ width: '16px', height: '16px', margin: '0 0 0 auto' }} />
                                            ) : (
                                                formatAmount(data.positionLockAmount, 8)
                                            )}
                                        </td>
                                        <td style={{ padding: '10px', textAlign: 'right', color: '#fff' }}>
                                            {data.positionsLoading ? (
                                                <div className="spinner" style={{ width: '16px', height: '16px', margin: '0 0 0 auto' }} />
                                            ) : (
                                                formatAmount(data.tokenLockAmount + data.positionLockAmount, 8)
                                            )}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </main>
        </div>
    );
}

export default SneedlockInfo; 