import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import Header from '../components/Header';
import { useAuth } from '../AuthContext';
import { createActor as createSneedLockActor, canisterId as sneedLockCanisterId } from 'external/sneed_lock';
import { createActor as createNeutriniteDappActor, canisterId as neutriniteCanisterId } from 'external/neutrinite_dapp';
import { createActor as createBackendActor, canisterId as backendCanisterId } from 'declarations/app_sneeddao_backend';
import { createActor as createLedgerActor } from 'external/icrc1_ledger';
import { createActor as createIcpSwapActor } from 'external/icp_swap';
import { formatAmount } from '../utils/StringUtils';
import { getTokenLogo } from '../utils/TokenUtils';

const styles = {
    container: {
        maxWidth: '1200px',
        margin: '0 auto',
        padding: '2rem',
        color: '#ffffff',
    },
    heading: {
        fontSize: '2.5rem',
        marginBottom: '2rem',
        color: '#ffffff',
        textAlign: 'center',
    },
    grid: {
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
        gap: '2rem',
    },
    product: {
        backgroundColor: '#2a2a2a',
        borderRadius: '8px',
        padding: '2rem',
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
    },
    productTitle: {
        fontSize: '2rem',
        marginBottom: '1rem',
        color: '#3498db',
    },
    description: {
        fontSize: '1.1rem',
        lineHeight: '1.6',
        color: '#ccc',
        marginBottom: '2rem',
    },
    statsSection: {
        marginTop: 'auto',
    },
    statsGrid: {
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))',
        gap: '1rem',
        marginBottom: '2rem',
    },
    stat: {
        backgroundColor: '#3a3a3a',
        padding: '1rem',
        borderRadius: '6px',
        textAlign: 'center',
    },
    statValue: {
        fontSize: '1.5rem',
        fontWeight: 'bold',
        color: '#3498db',
        marginBottom: '0.5rem',
    },
    statLabel: {
        color: '#888',
        fontSize: '0.9rem',
    },
    button: {
        backgroundColor: '#3498db',
        color: '#ffffff',
        border: 'none',
        borderRadius: '4px',
        padding: '1rem',
        fontSize: '1.1rem',
        cursor: 'pointer',
        textDecoration: 'none',
        textAlign: 'center',
        transition: 'background-color 0.2s',
        '&:hover': {
            backgroundColor: '#2980b9',
        },
    },
};

function StatCard({ value, label }) {
    const [displayValue, setDisplayValue] = useState('0');
    
    useEffect(() => {
        let start = 0;
        const end = parseFloat(value.replace(/[^0-9.-]+/g, ''));
        if (isNaN(end)) {
            setDisplayValue(value);
            return;
        }
        const duration = 2000;
        const increment = end / (duration / 16);
        let timer;

        const updateNumber = () => {
            start += increment;
            if (start >= end) {
                setDisplayValue(value);
                clearInterval(timer);
            } else {
                if (value.includes('$')) {
                    setDisplayValue(`$${start.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
                } else {
                    setDisplayValue(Math.floor(start).toLocaleString());
                }
            }
        };

        timer = setInterval(updateNumber, 16);
        return () => clearInterval(timer);
    }, [value]);

    return (
        <div style={styles.stat}>
            <div style={styles.statValue}>{displayValue}</div>
            <div style={styles.statLabel}>{label}</div>
        </div>
    );
}

function Products() {
    const { identity } = useAuth();
    const [sneedLockStats, setSneedLockStats] = useState({
        totalTokenLocks: 0,
        totalPositionLocks: 0,
        tokenLocksValue: 0,
        positionLocksValue: 0,
        activeUsers: new Set(),
        totalValue: 0,
    });
    const [conversionRates, setConversionRates] = useState({});
    const [tokenMetadata, setTokenMetadata] = useState({});
    const swapCanisterCache = {};

    const formatUSD = (value) => {
        if (value === undefined || value === null || isNaN(value)) return '$0.00';
        return `$${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    };

    const getUSDValue = (amount, decimals, symbol) => {
        if (!amount || !decimals || !symbol || !conversionRates[symbol]) return 0;
        const normalizedAmount = Number(amount) / Math.pow(10, decimals);
        return normalizedAmount * conversionRates[symbol];
    };

    const fetchConversionRates = async () => {
        try {
            const neutriniteActor = createNeutriniteDappActor(neutriniteCanisterId, { agentOptions: { identity } });
            const tokens = await neutriniteActor.get_latest_wallet_tokens();
            const rates = {};
            
            tokens.latest.forEach(token => {
                if (token.rates) {
                    token.rates.forEach(rate => {
                        if (rate.symbol.endsWith("/USD")) {
                            const tokenSymbol = rate.symbol.split("/")[0];
                            rates[tokenSymbol] = rate.rate;
                        }
                    });
                }
            });
            
            setConversionRates(rates);
        } catch (err) {
            console.error('Error fetching conversion rates:', err);
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

    const fetchTokenMetadata = async (tokenId, whitelistedTokenMap) => {
        if (tokenMetadata[tokenId]) return;
        
        const token = whitelistedTokenMap.get(tokenId);
        if (!token) return;

        try {
            const ledgerActor = createLedgerActor(token.ledger_id, { agentOptions: { identity } });
            const metadata = await ledgerActor.icrc1_metadata();
            const logo = getTokenLogo(metadata);
            setTokenMetadata(prev => ({
                ...prev,
                [tokenId]: {
                    ...token,
                    logo
                }
            }));
        } catch (error) {
            console.error(`Error fetching metadata for token ${tokenId}:`, error);
        }
    };

    const fetchSneedLockStats = async () => {
        try {
            const sneedLockActor = createSneedLockActor(sneedLockCanisterId, { agentOptions: { identity } });
            const backendActor = createBackendActor(backendCanisterId, { agentOptions: { identity } });
            
            // Fetch all locks and whitelisted tokens
            const [tokenLocks, positionLocks, whitelistedTokens] = await Promise.all([
                sneedLockActor.get_all_token_locks(),
                sneedLockActor.get_all_position_locks(),
                backendActor.get_whitelisted_tokens()
            ]);

            // Calculate unique users
            const uniqueUsers = new Set();
            tokenLocks.forEach(lock => uniqueUsers.add(lock[0].toText()));
            positionLocks.forEach(lock => uniqueUsers.add(lock[0].toText()));

            // Create a map of whitelisted tokens
            const whitelistedTokenMap = new Map(whitelistedTokens.map(token => [token.ledger_id.toText(), token]));

            // Collect unique token IDs from locks
            const uniqueTokenIds = new Set();
            tokenLocks.forEach(lock => uniqueTokenIds.add(lock[1].toText()));
            
            // Fetch metadata only for tokens in locks
            await Promise.all(
                Array.from(uniqueTokenIds).map(tokenId => 
                    fetchTokenMetadata(tokenId, whitelistedTokenMap)
                )
            );

            // Calculate total value from token locks
            let tokenLocksValue = 0;
            for (const lock of tokenLocks) {
                const tokenId = lock[1].toText();
                const amount = BigInt(lock[2].amount);
                const token = whitelistedTokenMap.get(tokenId);
                if (token) {
                    const usdValue = getUSDValue(amount, token.decimals, token.symbol);
                    if (!isNaN(usdValue)) {
                        tokenLocksValue += usdValue;
                    }
                }
            }

            // Calculate total value from position locks
            let positionLocksValue = 0;
            for (const lock of positionLocks) {
                const swapCanisterId = lock[1];
                const positionId = lock[2].position_id;
                const token0 = lock[2].token0;
                const token1 = lock[2].token1;

                // Add these tokens to metadata fetch queue
                await Promise.all([
                    fetchTokenMetadata(token0.toText(), whitelistedTokenMap),
                    fetchTokenMetadata(token1.toText(), whitelistedTokenMap)
                ]);

                const canisterData = await fetchPositionDetails(swapCanisterId);
                if (!canisterData.error) {
                    const matchingPosition = canisterData.positions.find(p => p.id === positionId);
                    if (matchingPosition) {
                        // Add token0 value
                        const token0Data = whitelistedTokenMap.get(token0.toText());
                        if (token0Data) {
                            const token0Value = getUSDValue(
                                BigInt(matchingPosition.token0Amount),
                                token0Data.decimals,
                                token0Data.symbol
                            );
                            if (!isNaN(token0Value)) positionLocksValue += token0Value;
                        }

                        // Add token1 value
                        const token1Data = whitelistedTokenMap.get(token1.toText());
                        if (token1Data) {
                            const token1Value = getUSDValue(
                                BigInt(matchingPosition.token1Amount),
                                token1Data.decimals,
                                token1Data.symbol
                            );
                            if (!isNaN(token1Value)) positionLocksValue += token1Value;
                        }
                    }
                }
            }

            setSneedLockStats({
                totalTokenLocks: tokenLocks.length,
                totalPositionLocks: positionLocks.length,
                tokenLocksValue,
                positionLocksValue,
                activeUsers: uniqueUsers.size,
                totalValue: tokenLocksValue + positionLocksValue
            });

        } catch (error) {
            console.error('Error fetching SneedLock stats:', error);
        }
    };

    useEffect(() => {
        fetchConversionRates();
        fetchSneedLockStats();
        
        // Refresh data every 5 minutes
        const interval = setInterval(() => {
            fetchConversionRates();
            fetchSneedLockStats();
        }, 5 * 60 * 1000);

        return () => clearInterval(interval);
    }, []);

    return (
        <div className="page-container">
            <Header />
            <main style={styles.container}>
                <h1 style={styles.heading}>Our Products</h1>
                
                <div style={styles.grid}>
                    {/* SneedLock */}
                    <div style={styles.product}>
                        <h2 style={styles.productTitle}>SneedLock</h2>
                        <p style={styles.description}>
                            A secure and flexible token locking solution built on the Internet Computer.
                            Create customizable token locks with various vesting schedules and conditions.
                            Perfect for team tokens, investor allocations, and liquidity management.
                        </p>
                        
                        <div style={styles.statsSection}>
                            <div style={styles.statsGrid}>
                                <StatCard 
                                    value={sneedLockStats.totalTokenLocks.toString()} 
                                    label="Token Locks" 
                                />
                                <StatCard 
                                    value={sneedLockStats.totalPositionLocks.toString()} 
                                    label="Position Locks" 
                                />
                                <StatCard 
                                    value={formatUSD(sneedLockStats.tokenLocksValue)} 
                                    label="Token Locks Value" 
                                />
                                <StatCard 
                                    value={formatUSD(sneedLockStats.positionLocksValue)} 
                                    label="Position Locks Value" 
                                />
                                <StatCard 
                                    value={sneedLockStats.activeUsers.toString()} 
                                    label="Active Users" 
                                />
                                <StatCard 
                                    value={formatUSD(sneedLockStats.totalValue)} 
                                    label="Total Value Locked" 
                                />
                            </div>
                            
                            <Link to="/sneedlock" style={styles.button}>
                                Launch SneedLock
                            </Link>
                        </div>
                    </div>

                    {/* SwapRunner */}
                    <div style={styles.product}>
                        <h2 style={styles.productTitle}>SwapRunner</h2>
                        <p style={styles.description}>
                            A high-performance decentralized exchange (DEX) built for speed and efficiency.
                            Experience lightning-fast token swaps with minimal slippage, powered by
                            advanced routing algorithms and deep liquidity pools.
                        </p>
                        
                        <div style={styles.statsSection}>
                            <div style={styles.statsGrid}>
                                <StatCard 
                                    value="1,234" 
                                    label="Total Swaps" 
                                />
                                <StatCard 
                                    value="$500K" 
                                    label="Daily Volume" 
                                />
                                <StatCard 
                                    value="789" 
                                    label="Unique Users" 
                                />
                            </div>
                            
                            <a 
                                href="https://swaprunner.com" 
                                target="_blank" 
                                rel="noopener noreferrer" 
                                style={styles.button}
                            >
                                Visit SwapRunner
                            </a>
                        </div>
                    </div>
                </div>
            </main>
        </div>
    );
}

export default Products; 