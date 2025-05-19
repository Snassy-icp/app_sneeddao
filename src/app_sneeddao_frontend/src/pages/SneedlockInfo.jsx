import React, { useState, useEffect } from 'react';
import { useAuth } from '../AuthContext';
import { createActor as createSneedLockActor, canisterId as sneedLockCanisterId } from 'external/sneed_lock';
import { createActor as createLedgerActor } from 'external/icrc1_ledger';
import { createActor as createIcpSwapActor } from 'external/icp_swap';
import { createActor as createBackendActor, canisterId as backendCanisterId } from 'declarations/app_sneeddao_backend';
import { formatAmount } from '../utils/StringUtils';
import { getTokenLogo } from '../utils/TokenUtils';
import Header from '../components/Header';
import { Principal } from '@dfinity/principal';

function SneedlockInfo() {
    const { identity } = useAuth();
    const [tokenData, setTokenData] = useState({});
    const [initialLoading, setInitialLoading] = useState(true);
    const [metadataLoading, setMetadataLoading] = useState(true);
    const [tokenMetadata, setTokenMetadata] = useState({});

    // Cache for swap canister data
    const swapCanisterCache = {};

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
        setInitialLoading(true);
        try {
            const sneedLockActor = createSneedLockActor(sneedLockCanisterId, { agentOptions: { identity } });
            
            // Fetch all locks first to know which tokens we need metadata for
            const allTokenLocks = await sneedLockActor.get_all_token_locks();
            const allPositionLocks = await sneedLockActor.get_all_position_locks();

            // Aggregate token locks by token type
            const aggregatedData = {};

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
            }

            // Update state with initial data
            setTokenData(aggregatedData);
            setInitialLoading(false);

            // Start loading metadata and positions in the background
            setMetadataLoading(true);

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
                        setTokenData(prevData => {
                            const newData = { ...prevData };
                            
                            // Add token0 amount
                            const token0Key = token0.toText();
                            if (!newData[token0Key]) {
                                newData[token0Key] = {
                                    tokenId: token0,
                                    tokenLockAmount: 0n,
                                    positionLockAmount: 0n,
                                    positionsLoading: false
                                };
                            }
                            newData[token0Key].positionLockAmount = (newData[token0Key].positionLockAmount || 0n) + BigInt(matchingPosition.token0Amount);
                            newData[token0Key].positionsLoading = false;

                            // Add token1 amount
                            const token1Key = token1.toText();
                            if (!newData[token1Key]) {
                                newData[token1Key] = {
                                    tokenId: token1,
                                    tokenLockAmount: 0n,
                                    positionLockAmount: 0n,
                                    positionsLoading: false
                                };
                            }
                            newData[token1Key].positionLockAmount = (newData[token1Key].positionLockAmount || 0n) + BigInt(matchingPosition.token1Amount);
                            newData[token1Key].positionsLoading = false;

                            return newData;
                        });
                    }
                }
            }

            // Now fetch whitelisted tokens and only process the ones we need
            const backendActor = createBackendActor(backendCanisterId, { agentOptions: { identity } });
            const whitelistedTokens = await backendActor.get_whitelisted_tokens();
            
            // Create a map for faster lookup
            const whitelistedTokenMap = new Map(whitelistedTokens.map(token => [token.ledger_id.toText(), token]));
            
            // Only process metadata for tokens that have locks or positions
            for (const tokenKey of Object.keys(aggregatedData)) {
                const whitelistedToken = whitelistedTokenMap.get(tokenKey);
                if (whitelistedToken) {
                    try {
                        const ledgerActor = createLedgerActor(whitelistedToken.ledger_id, { agentOptions: { identity } });
                        const tokenMetadata = await ledgerActor.icrc1_metadata();
                        const logo = getTokenLogo(tokenMetadata);
                        
                        setTokenMetadata(prev => ({
                            ...prev,
                            [tokenKey]: {
                                ...whitelistedToken,
                                logo
                            }
                        }));
                    } catch (error) {
                        console.error(`Error fetching metadata for token ${tokenKey}:`, error);
                        setTokenMetadata(prev => ({
                            ...prev,
                            [tokenKey]: whitelistedToken
                        }));
                    }
                }
            }

            setMetadataLoading(false);
        } catch (error) {
            console.error('Error fetching data:', error);
        }
    };

    useEffect(() => {
        if (identity) {
            fetchData();
        }
    }, [identity]);

    if (initialLoading) {
        return (
            <div className='page-container'>
                <Header />
                <main className="wallet-container">
                    <h1 style={{ color: '#ffffff', marginBottom: '20px' }}>SneedLock Info</h1>
                    <div style={{ display: 'flex', justifyContent: 'center', padding: '40px' }}>
                        <div className="spinner"></div>
                    </div>
                </main>
            </div>
        );
    }

    return (
        <div className='page-container'>
            <Header />
            <main className="wallet-container">
                <h1 style={{ color: '#ffffff', marginBottom: '20px' }}>
                    SneedLock Info
                    {metadataLoading && (
                        <div className="spinner" style={{ width: '16px', height: '16px', display: 'inline-block', marginLeft: '10px', verticalAlign: 'middle' }} />
                    )}
                </h1>
                
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
                            {Object.entries(tokenData).map(([tokenKey, data]) => {
                                const token = tokenMetadata[tokenKey];
                                return (
                                    <tr 
                                        key={tokenKey}
                                        style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}
                                    >
                                        <td style={{ padding: '10px', color: '#fff', display: 'flex', alignItems: 'center', gap: '10px' }}>
                                            {token?.logo && (
                                                <img 
                                                    src={token.logo} 
                                                    alt={token?.symbol || tokenKey} 
                                                    style={{ width: '24px', height: '24px', borderRadius: '50%' }}
                                                />
                                            )}
                                            {token?.symbol || tokenKey}
                                        </td>
                                        <td style={{ padding: '10px', textAlign: 'right', color: '#fff' }}>
                                            {formatAmount(data.tokenLockAmount, token?.decimals || 8)}
                                        </td>
                                        <td style={{ padding: '10px', textAlign: 'right', color: '#fff' }}>
                                            {data.positionsLoading ? (
                                                <div className="spinner" style={{ width: '16px', height: '16px', margin: '0 0 0 auto' }} />
                                            ) : (
                                                formatAmount(data.positionLockAmount, token?.decimals || 8)
                                            )}
                                        </td>
                                        <td style={{ padding: '10px', textAlign: 'right', color: '#fff' }}>
                                            {data.positionsLoading ? (
                                                <div className="spinner" style={{ width: '16px', height: '16px', margin: '0 0 0 auto' }} />
                                            ) : (
                                                formatAmount(data.tokenLockAmount + data.positionLockAmount, token?.decimals || 8)
                                            )}
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            </main>
        </div>
    );
}

export default SneedlockInfo; 