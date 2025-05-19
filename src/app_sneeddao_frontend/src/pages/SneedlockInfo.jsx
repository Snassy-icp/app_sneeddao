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
    const [expandedRows, setExpandedRows] = useState(new Set());  // Track expanded rows

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

    const toggleRow = (tokenKey) => {
        setExpandedRows(prev => {
            const newSet = new Set(prev);
            if (newSet.has(tokenKey)) {
                newSet.delete(tokenKey);
            } else {
                newSet.add(tokenKey);
            }
            return newSet;
        });
    };

    const formatTimestamp = (timestamp) => {
        if (!timestamp) return "Never";
        
        try {
            // For token locks, the field is named 'expiry'
            // For position locks, we need to handle both 'expiry' and 'expiration'
            const actualTimestamp = typeof timestamp === 'object' && timestamp.expiry ? 
                timestamp.expiry : timestamp;

            // Convert BigInt to string to avoid precision loss
            const timestampStr = actualTimestamp.toString();
            // Convert nanoseconds to milliseconds
            const milliseconds = Number(timestampStr) / 1_000_000;
            
            const date = new Date(milliseconds);
            
            // Check if date is valid
            if (isNaN(date.getTime())) {
                return "Never";
            }
            
            // Check if it's effectively "never" (far future date)
            if (date.getFullYear() > 2100) {
                return "Never";
            }
            
            return date.toLocaleString();
        } catch (error) {
            console.error("Error formatting timestamp:", error);
            return "Invalid Date";
        }
    };

    const fetchData = async () => {
        setInitialLoading(true);
        try {
            const sneedLockActor = createSneedLockActor(sneedLockCanisterId, { agentOptions: { identity } });
            
            // Fetch all locks first to know which tokens we need metadata for
            const allTokenLocks = await sneedLockActor.get_all_token_locks();
            const allPositionLocks = await sneedLockActor.get_all_position_locks();

            console.log("All token locks fetched", allTokenLocks);
            console.log("All position locks fetched", allPositionLocks);
            // Aggregate token locks by token type
            const aggregatedData = {};

            // Process token locks with detailed information
            for (const lock of allTokenLocks) {
                const tokenId = lock[1];
                const amount = BigInt(lock[2].amount);
                const tokenKey = tokenId.toText();
                const lockDetails = {
                    id: lock[0],  // Lock ID
                    amount: amount,
                    expiry: lock[2].expiration,
                    owner: lock[2].owner
                };

                if (!aggregatedData[tokenKey]) {
                    aggregatedData[tokenKey] = {
                        tokenId,
                        tokenLockAmount: 0n,
                        positionLockAmount: 0n,
                        tokenLockCount: 0,
                        positionLockCount: 0,
                        positionsLoading: false,
                        tokenLocks: [],      // Store individual lock details
                        positionLocks: []    // Store individual position details
                    };
                }
                aggregatedData[tokenKey].tokenLockAmount += amount;
                aggregatedData[tokenKey].tokenLockCount += 1;
                aggregatedData[tokenKey].tokenLocks.push(lockDetails);
            }

            // Create a Set of tokens that appear in position locks
            const tokensInPositions = new Set();
            for (const lock of allPositionLocks) {
                tokensInPositions.add(lock[2].token0.toText());
                tokensInPositions.add(lock[2].token1.toText());
            }

            // Pre-process position locks to create initial entries for all tokens
            for (const lock of allPositionLocks) {
                const token0 = lock[2].token0;
                const token1 = lock[2].token1;
                
                // Initialize token0 data if not exists
                const token0Key = token0.toText();
                if (!aggregatedData[token0Key]) {
                    aggregatedData[token0Key] = {
                        tokenId: token0,
                        tokenLockAmount: 0n,
                        positionLockAmount: 0n,
                        tokenLockCount: 0,
                        positionLockCount: 0,
                        positionsLoading: true,  // Set to true because this token has positions
                        tokenLocks: [],
                        positionLocks: []
                    };
                } else {
                    aggregatedData[token0Key].positionsLoading = true;  // Ensure it's set to true if token exists
                }
                
                // Initialize token1 data if not exists
                const token1Key = token1.toText();
                if (!aggregatedData[token1Key]) {
                    aggregatedData[token1Key] = {
                        tokenId: token1,
                        tokenLockAmount: 0n,
                        positionLockAmount: 0n,
                        tokenLockCount: 0,
                        positionLockCount: 0,
                        positionsLoading: true,  // Set to true because this token has positions
                        tokenLocks: [],
                        positionLocks: []
                    };
                } else {
                    aggregatedData[token1Key].positionsLoading = true;  // Ensure it's set to true if token exists
                }
            }

            // Update state with initial data
            setTokenData(aggregatedData);
            setInitialLoading(false);

            // Start loading metadata and positions in the background
            setMetadataLoading(true);

            // Now fetch whitelisted tokens for ALL tokens we found
            const backendActor = createBackendActor(backendCanisterId, { agentOptions: { identity } });
            const whitelistedTokens = await backendActor.get_whitelisted_tokens();
            
            // Create a map for faster lookup
            const whitelistedTokenMap = new Map(whitelistedTokens.map(token => [token.ledger_id.toText(), token]));
            
            // Process metadata for ALL tokens (both from token locks and position locks)
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

            // Process position locks with detailed information
            for (const lock of allPositionLocks) {
                const swapCanisterId = lock[1];
                const positionId = lock[2].position_id;
                const token0 = lock[2].token0;
                const token1 = lock[2].token1;
                const lockId = lock[0];
                const expiry = lock[2].expiry;
                const owner = lock[2].owner;

                // Fetch position details
                const canisterData = await fetchPositionDetails(swapCanisterId);
                if (!canisterData.error) {
                    const matchingPosition = canisterData.positions.find(p => p.id === positionId);
                    if (matchingPosition) {
                        setTokenData(prevData => {
                            const newData = { ...prevData };
                            
                            // Add token0 details
                            const token0Key = token0.toText();
                            if (!newData[token0Key]) {
                                newData[token0Key] = {
                                    tokenId: token0,
                                    tokenLockAmount: 0n,
                                    positionLockAmount: 0n,
                                    tokenLockCount: 0,
                                    positionLockCount: 0,
                                    positionsLoading: false,
                                    tokenLocks: [],
                                    positionLocks: []
                                };
                            }
                            const token0Amount = BigInt(matchingPosition.token0Amount);
                            newData[token0Key].positionLockAmount = (newData[token0Key].positionLockAmount || 0n) + token0Amount;
                            newData[token0Key].positionLockCount += 1;
                            newData[token0Key].positionsLoading = false;
                            newData[token0Key].positionLocks.push({
                                id: lockId,
                                positionId,
                                swapCanisterId,
                                amount: token0Amount,
                                expiry,
                                owner,
                                otherToken: token1,
                                otherAmount: BigInt(matchingPosition.token1Amount)
                            });

                            // Add token1 details (similar to token0)
                            const token1Key = token1.toText();
                            if (!newData[token1Key]) {
                                newData[token1Key] = {
                                    tokenId: token1,
                                    tokenLockAmount: 0n,
                                    positionLockAmount: 0n,
                                    tokenLockCount: 0,
                                    positionLockCount: 0,
                                    positionsLoading: false,
                                    tokenLocks: [],
                                    positionLocks: []
                                };
                            }
                            const token1Amount = BigInt(matchingPosition.token1Amount);
                            newData[token1Key].positionLockAmount = (newData[token1Key].positionLockAmount || 0n) + token1Amount;
                            newData[token1Key].positionLockCount += 1;
                            newData[token1Key].positionsLoading = false;
                            newData[token1Key].positionLocks.push({
                                id: lockId,
                                positionId,
                                swapCanisterId,
                                amount: token1Amount,
                                expiry,
                                owner,
                                otherToken: token0,
                                otherAmount: BigInt(matchingPosition.token0Amount)
                            });

                            return newData;
                        });
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
                                <th style={{ 
                                    padding: '10px 20px', 
                                    textAlign: 'left', 
                                    color: '#888', 
                                    width: '200px',
                                    position: 'relative'  // Add positioning context
                                }}>Token</th>
                                <th style={{ padding: '10px', textAlign: 'right', color: '#888' }}>Token Locks</th>
                                <th style={{ padding: '10px', textAlign: 'right', color: '#888' }}>Position Locks</th>
                                <th style={{ padding: '10px', textAlign: 'right', color: '#888' }}>Total Locked</th>
                            </tr>
                        </thead>
                        <tbody>
                            {Object.entries(tokenData).map(([tokenKey, data]) => {
                                const token = tokenMetadata[tokenKey];
                                const isExpanded = expandedRows.has(tokenKey);
                                return (
                                    <React.Fragment key={tokenKey}>
                                        <tr 
                                            onClick={() => toggleRow(tokenKey)}
                                            style={{ 
                                                borderBottom: '1px solid rgba(255,255,255,0.05)',
                                                cursor: 'pointer',
                                                backgroundColor: isExpanded ? '#333' : 'transparent'
                                            }}
                                        >
                                            <td style={{ 
                                                padding: '10px 20px', 
                                                color: '#fff',
                                                width: '200px',
                                                position: 'relative'  // Add positioning context
                                            }}>
                                                <div style={{
                                                    position: 'absolute',  // Position the container absolutely
                                                    left: '20px',         // Match the padding
                                                    top: '50%',           // Center vertically
                                                    transform: 'translateY(-50%)',  // Center vertically
                                                    display: 'grid',      // Use grid instead of flex
                                                    gridTemplateColumns: '20px 1fr',  // Fixed width for logo, auto for text
                                                    gap: '8px',
                                                    alignItems: 'center',
                                                    width: 'calc(100% - 40px)'  // Account for padding
                                                }}>
                                                    {token?.logo ? (
                                                        <img 
                                                            src={token.logo} 
                                                            alt={token?.symbol || tokenKey} 
                                                            style={{ 
                                                                width: '20px', 
                                                                height: '20px', 
                                                                borderRadius: '50%',
                                                                gridColumn: '1'
                                                            }}
                                                        />
                                                    ) : (
                                                        <div style={{ 
                                                            width: '20px', 
                                                            height: '20px',
                                                            gridColumn: '1'
                                                        }} />
                                                    )}
                                                    <span style={{ 
                                                        whiteSpace: 'nowrap',
                                                        overflow: 'hidden',
                                                        textOverflow: 'ellipsis',
                                                        gridColumn: '2'
                                                    }}>
                                                        {token?.symbol || tokenKey}
                                                    </span>
                                                </div>
                                            </td>
                                            <td style={{ padding: '10px', textAlign: 'right', color: '#fff' }}>
                                                {data.positionsLoading ? (
                                                    <div className="spinner" style={{ width: '16px', height: '16px', margin: '0 0 0 auto' }} />
                                                ) : (
                                                    <>
                                                        {formatAmount(data.tokenLockAmount, token?.decimals || 8)}
                                                        <div style={{ fontSize: '0.8em', color: '#888', marginTop: '2px' }}>
                                                            {data.tokenLockCount} lock{data.tokenLockCount !== 1 ? 's' : ''}
                                                        </div>
                                                    </>
                                                )}
                                            </td>
                                            <td style={{ padding: '10px', textAlign: 'right', color: '#fff' }}>
                                                {data.positionsLoading ? (
                                                    <div className="spinner" style={{ width: '16px', height: '16px', margin: '0 0 0 auto' }} />
                                                ) : (
                                                    <>
                                                        {formatAmount(data.positionLockAmount, token?.decimals || 8)}
                                                        <div style={{ fontSize: '0.8em', color: '#888', marginTop: '2px' }}>
                                                            {data.positionLockCount} position{data.positionLockCount !== 1 ? 's' : ''}
                                                        </div>
                                                    </>
                                                )}
                                            </td>
                                            <td style={{ padding: '10px', textAlign: 'right', color: '#fff' }}>
                                                {data.positionsLoading ? (
                                                    <div className="spinner" style={{ width: '16px', height: '16px', margin: '0 0 0 auto' }} />
                                                ) : (
                                                    <>
                                                        {formatAmount(data.tokenLockAmount + data.positionLockAmount, token?.decimals || 8)}
                                                        <div style={{ fontSize: '0.8em', color: '#888', marginTop: '2px' }}>
                                                            {data.tokenLockCount + data.positionLockCount} total lock{data.tokenLockCount + data.positionLockCount !== 1 ? 's' : ''}
                                                        </div>
                                                    </>
                                                )}
                                            </td>
                                        </tr>
                                        {isExpanded && (
                                            <>
                                                {/* Token Locks */}
                                                {data.tokenLocks.map(lock => (
                                                    <tr key={`token-${lock.id}`} style={{ backgroundColor: '#222' }}>
                                                        <td colSpan="4" style={{ padding: '8px 40px' }}>
                                                            <div style={{ display: 'flex', justifyContent: 'space-between', color: '#888', fontSize: '0.9em' }}>
                                                                <div>
                                                                    <span style={{ color: '#666' }}>Token Lock</span> #{lock.id?.toString() || 'Unknown'}
                                                                </div>
                                                                <div>
                                                                    Amount: {formatAmount(lock.amount, token?.decimals || 8)}
                                                                </div>
                                                                <div>
                                                                    Expires: {formatTimestamp(lock.expiry)}
                                                                </div>
                                                                <div style={{ opacity: 0.7 }}>
                                                                    Owner: {lock.owner?.toString() || 'Unknown'}
                                                                </div>
                                                            </div>
                                                        </td>
                                                    </tr>
                                                ))}
                                                {/* Position Locks */}
                                                {data.positionLocks.map(lock => (
                                                    <tr key={`position-${lock.id}`} style={{ backgroundColor: '#222' }}>
                                                        <td colSpan="4" style={{ padding: '8px 40px' }}>
                                                            <div style={{ display: 'flex', justifyContent: 'space-between', color: '#888', fontSize: '0.9em' }}>
                                                                <div>
                                                                    <span style={{ color: '#666' }}>Position Lock</span> #{lock.id?.toString() || 'Unknown'}
                                                                </div>
                                                                <div>
                                                                    Position: #{lock.positionId?.toString() || 'Unknown'}
                                                                </div>
                                                                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '2px' }}>
                                                                    <div>
                                                                        {formatAmount(lock.amount || 0n, token?.decimals || 8)} {token?.symbol || tokenKey}
                                                                    </div>
                                                                    <div>
                                                                        {formatAmount(lock.otherAmount || 0n, tokenMetadata[lock.otherToken?.toText() || '']?.decimals || 8)} {tokenMetadata[lock.otherToken?.toText() || '']?.symbol || (lock.otherToken?.toText() || 'Unknown')}
                                                                    </div>
                                                                </div>
                                                                <div>
                                                                    Expires: {formatTimestamp(lock.expiry)}
                                                                </div>
                                                                <div style={{ opacity: 0.7 }}>
                                                                    Owner: {lock.owner?.toString() || 'Unknown'}
                                                                </div>
                                                            </div>
                                                        </td>
                                                    </tr>
                                                ))}
                                            </>
                                        )}
                                    </React.Fragment>
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