import React, { useState, useEffect } from 'react';
import { useAuth } from './AuthContext';
import { createActor as createIcpSwapActor } from 'external/icp_swap';
import { toJsonString, formatAmount } from './utils/StringUtils';
import { createActor as createSneedLockActor, canisterId as sneedLockCanisterId  } from 'external/sneed_lock';
import { createActor as createBackendActor, canisterId as backendCanisterId } from 'declarations/app_sneeddao_backend';
import { getTokenMetaForSwap } from './utils/TokenUtils';
import Header from './components/Header';
import { Link } from 'react-router-dom';
import { Principal } from '@dfinity/principal';
import { createActor as createLedgerActor } from 'external/icrc1_ledger';

function Dashboard() {
    const { identity } = useAuth();
    const [tokenLocks, setTokenLocks] = useState([]);
    const [positionLocks, setPositionLocks] = useState([]);
    const [positionDetails, setPositionDetails] = useState({});
    const [loading, setLoading] = useState(true);
    const [tokenSymbols, setTokenSymbols] = useState({});

    const swapCanisterCache = { };

    useEffect(() => {
        if (identity) {
            fetchDashboardData();
        }
    }, [identity]);

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
        const swapActor = createIcpSwapActor(swapCanisterId, { agentOptions: { identity } });
        const backendActor = createBackendActor(backendCanisterId, { agentOptions: { identity } });

        try {
            const token_meta = await getTokenMetaForSwap(swapActor, backendActor, swapCanisterId);
            const token0Decimals = token_meta?.token0?.find(([key]) => key === "decimals")?.[1]?.Nat ?? 0;
            const token0Symbol = token_meta?.token0?.find(([key]) => key === "symbol")?.[1]?.Text ?? "Unknown";
            const token1Decimals = token_meta?.token1?.find(([key]) => key === "decimals")?.[1]?.Nat ?? 0;
            const token1Symbol = token_meta?.token1?.find(([key]) => key === "symbol")?.[1]?.Text ?? "Unknown";

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
        setLoading(true);
        try {
            const sneedLockActor = createSneedLockActor(sneedLockCanisterId, { agentOptions: { identity } });
            
            // Fetch token locks
            const allTokenLocks = await sneedLockActor.get_all_token_locks();
            setTokenLocks(allTokenLocks);

            // Fetch token symbols
            const symbols = {};
            for (const lock of allTokenLocks) {
                const tokenId = lock[0];
                if (!symbols[tokenId.toText()]) {
                    symbols[tokenId.toText()] = await fetchTokenSymbol(tokenId);
                }
            }
            setTokenSymbols(symbols);
        
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
        } catch (error) {
            console.error('Error fetching dashboard data:', error);
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className='page-container'>
            <Header />
            <main className="wallet-container">
                <h1 style={{ color: '#ffffff', marginBottom: '20px' }}>SneedLock Dashboard</h1>
                
                {loading ? (
                    <div style={{ display: 'flex', justifyContent: 'center', padding: '40px' }}>
                        <div className="spinner"></div>
                    </div>
                ) : (
                    <>
                        <section style={{ backgroundColor: '#2a2a2a', borderRadius: '8px', padding: '20px', marginBottom: '20px' }}>
                            <h2 style={{ color: '#ffffff', marginBottom: '15px' }}>Token Locks</h2>
                            {tokenLocks.length === 0 ? (
                                <p style={{ color: '#888', fontStyle: 'italic' }}>No token locks found</p>
                            ) : (
                                <div style={{ display: 'grid', gap: '15px' }}>
                                    {tokenLocks.map((lock, index) => (
                                        <div 
                                            key={index}
                                            style={{
                                                backgroundColor: '#3a3a3a',
                                                borderRadius: '6px',
                                                padding: '15px',
                                                border: '1px solid rgba(255,255,255,0.1)'
                                            }}
                                        >
                                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                                                <h3 style={{ color: '#ffffff', margin: 0 }}>Lock #{index + 1}</h3>
                                                <Link 
                                                    to={`/tokenlock?id=${index}`}
                                                    style={{
                                                        backgroundColor: '#3498db',
                                                        color: '#fff',
                                                        padding: '6px 12px',
                                                        borderRadius: '4px',
                                                        textDecoration: 'none',
                                                        fontSize: '14px'
                                                    }}
                                                >
                                                    View Details
                                                </Link>
                                            </div>
                                            <div style={{ color: '#888' }}>
                                                <p style={{ margin: '5px 0' }}>
                                                    <strong>Token:</strong> {tokenSymbols[lock[0].toText()] || lock[0].toText()}
                                                </p>
                                                <p style={{ margin: '5px 0' }}>
                                                    <strong>Amount:</strong> {formatAmount(lock[1], 8)} {tokenSymbols[lock[0].toText()]}
                                                </p>
                                                <p style={{ margin: '5px 0' }}>
                                                    <strong>Unlock Date:</strong> {new Date(Number(lock[2]) / 1000000).toLocaleString()}
                                                </p>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </section>

                        <section style={{ backgroundColor: '#2a2a2a', borderRadius: '8px', padding: '20px' }}>
                            <h2 style={{ color: '#ffffff', marginBottom: '15px' }}>Position Locks</h2>
                            {positionLocks.length === 0 ? (
                                <p style={{ color: '#888', fontStyle: 'italic' }}>No position locks found</p>
                            ) : (
                                <div style={{ display: 'grid', gap: '15px' }}>
                                    {positionLocks.map((lock, index) => (
                                        <div 
                                            key={index}
                                            style={{
                                                backgroundColor: '#3a3a3a',
                                                borderRadius: '6px',
                                                padding: '15px',
                                                border: '1px solid rgba(255,255,255,0.1)'
                                            }}
                                        >
                                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                                                <h3 style={{ color: '#ffffff', margin: 0 }}>Position Lock #{index + 1}</h3>
                                                <Link 
                                                    to={`/positionlock?id=${index}`}
                                                    style={{
                                                        backgroundColor: '#3498db',
                                                        color: '#fff',
                                                        padding: '6px 12px',
                                                        borderRadius: '4px',
                                                        textDecoration: 'none',
                                                        fontSize: '14px'
                                                    }}
                                                >
                                                    View Details
                                                </Link>
                                            </div>
                                            <div style={{ color: '#888' }}>
                                                <p style={{ margin: '5px 0' }}><strong>Swap Canister:</strong> {lock[1].toText()}</p>
                                                <p style={{ margin: '5px 0' }}><strong>Position ID:</strong> {lock[2].position_id}</p>
                                                <p style={{ margin: '5px 0' }}><strong>Unlock Date:</strong> {new Date(Number(lock[2].unlock_timestamp) / 1000000).toLocaleString()}</p>
                                                {positionDetails[`${lock[1].toText()}-${lock[2].position_id}`] && (
                                                    <div style={{ 
                                                        marginTop: '10px',
                                                        padding: '10px',
                                                        backgroundColor: '#2a2a2a',
                                                        borderRadius: '4px'
                                                    }}>
                                                        <p style={{ margin: '5px 0' }}>
                                                            <strong>Token0:</strong> {positionDetails[`${lock[1].toText()}-${lock[2].position_id}`].token0Amount} {positionDetails[`${lock[1].toText()}-${lock[2].position_id}`].token0Symbol}
                                                        </p>
                                                        <p style={{ margin: '5px 0' }}>
                                                            <strong>Token1:</strong> {positionDetails[`${lock[1].toText()}-${lock[2].position_id}`].token1Amount} {positionDetails[`${lock[1].toText()}-${lock[2].position_id}`].token1Symbol}
                                                        </p>
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </section>
                    </>
                )}
            </main>
        </div>
    );
}

export default Dashboard;