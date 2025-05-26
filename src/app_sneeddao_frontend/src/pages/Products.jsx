import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import Header from '../components/Header';
import { useAuth } from '../AuthContext';
import { Principal } from '@dfinity/principal';
import { createActor as createSneedLockActor, canisterId as sneedLockCanisterId } from 'external/sneed_lock';
import { createActor as createNeutriniteDappActor, canisterId as neutriniteCanisterId } from 'external/neutrinite_dapp';
import { createActor as createBackendActor, canisterId as backendCanisterId } from 'declarations/app_sneeddao_backend';
import { createActor as createLedgerActor } from 'external/icrc1_ledger';
import { createActor as createIcpSwapActor } from 'external/icp_swap';
import { createActor as createSwapRunnerActor } from 'external/swaprunner_backend';
import { canisterId as swapRunnerCanisterId } from 'external/swaprunner_backend';
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
    statValuePending: {
        fontSize: '1.5rem',
        fontWeight: 'bold',
        color: '#888',
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

const LoadingSpinner = () => (
    <div style={{
        display: 'inline-block',
        width: '20px',
        height: '20px',
        border: '2px solid #f3f3f3',
        borderTop: '2px solid #3498db',
        borderRadius: '50%',
        animation: 'spin 1s linear infinite',
    }}>
        <style>
            {`
                @keyframes spin {
                    0% { transform: rotate(0deg); }
                    100% { transform: rotate(360deg); }
                }
            `}
        </style>
    </div>
);

function StatCard({ value, label, isLoading, isParentComplete, isFinalValue }) {
    const [displayValue, setDisplayValue] = useState('0');
    const [isComplete, setIsComplete] = useState(false);
    
    useEffect(() => {
        if (isLoading) {
            setDisplayValue(null);
            setIsComplete(false);
            return;
        }

        let start = 0;
        const end = parseFloat(value.replace(/[^0-9.-]+/g, ''));
        const isUSD = value.startsWith('$');
        
        // For USD values, stay gray until we have a non-zero value
        if (isUSD && end === 0) {
            setDisplayValue('$0.00');
            setIsComplete(false);
            return;
        }
        
        // For non-USD values, show the actual value even if it's zero
        if (!isUSD) {
            if (end === 0) {
                setDisplayValue('0');
                setIsComplete(true);
                return;
            }
        }

        if (isNaN(end)) {
            setDisplayValue(value);
            setIsComplete(!isUSD); // USD values need to be non-zero to be complete
            return;
        }

        // For total value, use parent completion state
        if (label === "Total Value Locked" && isUSD) {
            setDisplayValue(value);
            setIsComplete(isParentComplete);
            return;
        }

        // For position locks value, only complete when it's the final value
        if (label === "Pos. Locks Value" && isUSD) {
            setDisplayValue(value);
            setIsComplete(isFinalValue && end > 0);
            return;
        }

        const duration = 2000;
        const increment = end / (duration / 16);
        let timer;

        const updateNumber = () => {
            start += increment;
            if (start >= end) {
                setDisplayValue(value);
                // Only set complete if not position locks value (which needs isFinalValue)
                setIsComplete(label !== "Pos. Locks Value");
                clearInterval(timer);
            } else {
                if (isUSD) {
                    // Format USD values with appropriate decimals during animation
                    const currentValue = start;
                    if (currentValue < 0.01 && currentValue > 0) {
                        setDisplayValue(`$${currentValue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 8 })}`);
                    } else if (currentValue < 1) {
                        setDisplayValue(`$${currentValue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 4 })}`);
                    } else {
                        setDisplayValue(`$${currentValue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
                    }
                } else {
                    // Format non-USD values with commas
                    setDisplayValue(Math.floor(start).toLocaleString('en-US'));
                }
                setIsComplete(false);
            }
        };

        timer = setInterval(updateNumber, 16);
        return () => clearInterval(timer);
    }, [value, isLoading, label, isParentComplete, isFinalValue]);

    return (
        <div style={styles.stat}>
            <div style={isComplete ? styles.statValue : styles.statValuePending}>
                {isLoading ? <LoadingSpinner /> : displayValue}
            </div>
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
        activeUsers: 0,
        totalValue: 0,
    });
    const [swapRunnerStats, setSwapRunnerStats] = useState({
        total_swaps: 0,
        split_swaps: 0,
        kong_swaps: 0,
        icpswap_swaps: 0,
        unique_users: 0,
        unique_traders: 0
    });
    const [isLoading, setIsLoading] = useState(true);
    const [conversionRates, setConversionRates] = useState({});
    const swapCanisterCache = {};
    const [ratesLoaded, setRatesLoaded] = useState(false);
    const [tokenValueComplete, setTokenValueComplete] = useState(false);
    const [positionValueComplete, setPositionValueComplete] = useState(false);

    // Track completion of individual USD values
    const [tokenRef, setTokenRef] = useState(null);
    const [positionRef, setPositionRef] = useState(null);

    const [isLastPositionProcessed, setIsLastPositionProcessed] = useState(false);

    const formatUSD = (value) => {
        if (value === undefined || value === null || isNaN(value)) return '$0.00';
        const num = Number(value);
        if (num === 0) return '$0.00';
        
        // For very small amounts, show more decimals
        if (num < 0.01 && num > 0) {
            return `$${num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 8 })}`;
        }
        
        // For amounts less than 1, show up to 4 decimals
        if (num < 1) {
            return `$${num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 4 })}`;
        }
        
        // For larger amounts, show 2 decimals but remove trailing zeros
        const formatted = num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        return `$${formatted}`;
    };

    const getUSDValue = (amount, decimals, symbol) => {
        if (!amount || !decimals || !symbol) return 0;
        const normalizedAmount = Number(amount) / Math.pow(10, Number(decimals));
        const rate = conversionRates[symbol];
        console.log(`Calculating USD value for ${symbol}:`, {
            amount: amount.toString(),
            decimals,
            normalizedAmount,
            rate,
            hasRate: symbol in conversionRates
        });
        return rate ? normalizedAmount * Number(rate) : 0;
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
            
            console.log('Conversion rates:', rates);
            return rates;
        } catch (err) {
            console.error('Error fetching conversion rates:', err);
            return {};
        }
    };

    async function fetchPositionDetails(swapCanisterId) {
        const canisterId = swapCanisterId.toText();
        if (swapCanisterCache[canisterId]) {
            return swapCanisterCache[canisterId];
        }

        const swapActor = createIcpSwapActor(swapCanisterId, { agentOptions: { identity } });

        try {
            const [tokenMeta, positionsResult] = await Promise.all([
                swapActor.getTokenMeta(),
                swapActor.getUserPositionWithTokenAmount(0, 1000) // Increased limit to avoid pagination
            ]);

            const token0Decimals = tokenMeta.token0[2][1].Nat;
            const token1Decimals = tokenMeta.token1[2][1].Nat;
            const token0Symbol = tokenMeta.token0[1][1].Text;
            const token1Symbol = tokenMeta.token1[1][1].Text;
            const token0Id = tokenMeta.token0[0];
            const token1Id = tokenMeta.token1[0];

            const data = {
                positions: positionsResult.ok.content,
                token0Decimals,
                token1Decimals,
                token0Symbol,
                token1Symbol,
                token0Id,
                token1Id
            };

            swapCanisterCache[canisterId] = data;
            return data;
        } catch (error) {
            console.error(`Error fetching data for swap canister ${canisterId}:`, error);
            swapCanisterCache[canisterId] = { error: true };
            return { error: true };
        }
    }

    const fetchSneedLockStats = async () => {
        setIsLoading(true);
        setIsLastPositionProcessed(false);
        console.time('Total fetchSneedLockStats');
        try {
            // Reset USD values to trigger updates
            setSneedLockStats(prev => ({
                ...prev,
                tokenLocksValue: 0,
                positionLocksValue: 0,
                totalValue: 0
            }));

            // Fetch conversion rates first and wait for them
            console.time('Fetch conversion rates');
            const rates = await fetchConversionRates();
            setConversionRates(rates);
            setRatesLoaded(true);
            console.timeEnd('Fetch conversion rates');

            const sneedLockActor = createSneedLockActor(sneedLockCanisterId, { agentOptions: { identity } });
            const backendActor = createBackendActor(backendCanisterId, { agentOptions: { identity } });
            
            // Fetch all locks and whitelisted tokens
            console.time('Fetch locks and tokens');
            const [tokenLocks, positionLocks, whitelistedTokens] = await Promise.all([
                sneedLockActor.get_all_token_locks(),
                sneedLockActor.get_all_position_locks(),
                backendActor.get_whitelisted_tokens()
            ]);
            console.timeEnd('Fetch locks and tokens');
            console.log('Token locks count:', tokenLocks.length);
            console.log('Position locks count:', positionLocks.length);
            console.log('Whitelisted tokens count:', whitelistedTokens.length);

            // Update counts immediately
            setSneedLockStats(prev => ({
                ...prev,
                totalTokenLocks: tokenLocks.length,
                totalPositionLocks: positionLocks.length,
            }));

            // Calculate unique users
            console.time('Calculate users');
            const uniqueUsers = new Set();
            tokenLocks.forEach(lock => uniqueUsers.add(lock[0].toText()));
            positionLocks.forEach(lock => uniqueUsers.add(lock[0].toText()));
            console.timeEnd('Calculate users');

            // Update user count
            setSneedLockStats(prev => ({
                ...prev,
                activeUsers: uniqueUsers.size,
            }));

            // Create a map of whitelisted tokens
            console.time('Create token map');
            const whitelistedTokenMap = new Map(whitelistedTokens.map(token => [token.ledger_id.toText(), token]));
            console.timeEnd('Create token map');

            // Calculate total value from token locks
            console.time('Calculate token locks value');
            let tokenLocksValue = 0;
            for (const lock of tokenLocks) {
                const tokenId = lock[1].toText();
                const amount = BigInt(lock[2].amount);
                const token = whitelistedTokenMap.get(tokenId);
                if (token) {
                    console.log('Processing token lock:', {
                        tokenId,
                        symbol: token.symbol,
                        amount: amount.toString(),
                        decimals: token.decimals
                    });
                    const normalizedAmount = Number(amount) / Math.pow(10, Number(token.decimals));
                    const rate = rates[token.symbol];
                    const usdValue = rate ? normalizedAmount * Number(rate) : 0;
                    console.log('USD value calculated:', {
                        symbol: token.symbol,
                        normalizedAmount,
                        rate,
                        usdValue
                    });
                    if (!isNaN(usdValue)) {
                        tokenLocksValue += usdValue;
                    }
                }
            }
            console.timeEnd('Calculate token locks value');
            console.log('Final token locks value:', tokenLocksValue);

            // Update token locks value
            setSneedLockStats(prev => {
                console.log('Updating token locks value:', { old: prev.tokenLocksValue, new: tokenLocksValue });
                return {
                    ...prev,
                    tokenLocksValue,
                    totalValue: tokenLocksValue // Start total with just token locks
                };
            });

            // Group position locks by swap canister
            console.time('Calculate position locks value');
            const positionsByCanister = new Map();
            positionLocks.forEach(lock => {
                const canisterId = lock[1].toText();
                if (!positionsByCanister.has(canisterId)) {
                    positionsByCanister.set(canisterId, []);
                }
                positionsByCanister.get(canisterId).push(lock);
            });

            // Process each canister's positions sequentially but fetch details in parallel
            let runningPositionValue = 0;
            const canisterIds = Array.from(positionsByCanister.keys());
            
            // First fetch all position details in parallel
            const canisterDetailsPromises = canisterIds.map(canisterId => 
                fetchPositionDetails(Principal.fromText(canisterId))
            );
            
            // Process each canister's data as it comes in
            for (let i = 0; i < canisterIds.length; i++) {
                const canisterId = canisterIds[i];
                const locks = positionsByCanister.get(canisterId);
                const isLastCanister = i === canisterIds.length - 1;
                
                // Wait for this canister's data
                const canisterData = await canisterDetailsPromises[i];
                if (!canisterData || canisterData.error) continue;

                let canisterValue = 0;
                for (const lock of locks) {
                    const positionId = lock[2].position_id;
                    const token0 = lock[2].token0;
                    const token1 = lock[2].token1;

                    const matchingPosition = canisterData.positions.find(p => p.id === positionId);
                    if (matchingPosition) {
                        // Add token0 value
                        const token0Data = whitelistedTokenMap.get(token0.toText());
                        if (token0Data) {
                            const token0Value = rates[token0Data.symbol] ? 
                                (Number(matchingPosition.token0Amount) / Math.pow(10, Number(token0Data.decimals))) * Number(rates[token0Data.symbol]) : 0;
                            if (!isNaN(token0Value)) canisterValue += token0Value;
                        }

                        // Add token1 value
                        const token1Data = whitelistedTokenMap.get(token1.toText());
                        if (token1Data) {
                            const token1Value = rates[token1Data.symbol] ?
                                (Number(matchingPosition.token1Amount) / Math.pow(10, Number(token1Data.decimals))) * Number(rates[token1Data.symbol]) : 0;
                            if (!isNaN(token1Value)) canisterValue += token1Value;
                        }
                    }
                }

                // Update running total and state after each canister is processed
                runningPositionValue += canisterValue;
                console.log(`Processed canister ${canisterId}, value: ${canisterValue}, running total: ${runningPositionValue}, isLastCanister: ${isLastCanister}`);
                
                setSneedLockStats(prev => {
                    const newTotal = prev.tokenLocksValue + runningPositionValue;
                    console.log('Updating position value:', {
                        oldPositionValue: prev.positionLocksValue,
                        newPositionValue: runningPositionValue,
                        oldTotal: prev.totalValue,
                        newTotal,
                        tokenLocksValue: prev.tokenLocksValue,
                        isLastCanister
                    });
                    return {
                        ...prev,
                        positionLocksValue: runningPositionValue,
                        totalValue: newTotal
                    };
                });

                if (isLastCanister) {
                    setIsLastPositionProcessed(true);
                }
            }
            
            console.timeEnd('Calculate position locks value');
            console.log('Final position locks value:', runningPositionValue);

        } catch (error) {
            console.error('Error fetching SneedLock stats:', error);
        } finally {
            setIsLoading(false);
            console.timeEnd('Total fetchSneedLockStats');
        }
    };

    const fetchSwapRunnerStats = async () => {
        try {
            const swapRunnerActor = createSwapRunnerActor(swapRunnerCanisterId, { agentOptions: { identity } });
            const [stats, userCount, traderCount] = await Promise.all([
                swapRunnerActor.get_global_stats(),
                swapRunnerActor.get_unique_user_count(),
                swapRunnerActor.get_unique_trader_count()
            ]);
            setSwapRunnerStats({
                total_swaps: Number(stats.total_swaps),
                split_swaps: Number(stats.split_swaps),
                kong_swaps: Number(stats.kong_swaps),
                icpswap_swaps: Number(stats.icpswap_swaps),
                unique_users: Number(userCount),
                unique_traders: Number(traderCount)
            });
        } catch (error) {
            console.error('Error fetching SwapRunner stats:', error);
        }
    };

    useEffect(() => {
        fetchSneedLockStats();
        fetchSwapRunnerStats();
        
        // Refresh data every 5 minutes
        const interval = setInterval(() => {
            fetchSneedLockStats();
            fetchSwapRunnerStats();
        }, 5 * 60 * 1000);

        return () => clearInterval(interval);
    }, []);

    // Function to check if a StatCard is complete
    const isCardComplete = (ref) => {
        if (!ref) return false;
        return ref.querySelector('[style*="color: rgb(52, 152, 219)"]') !== null;
    };

    // Effect to check completion states
    useEffect(() => {
        const checkCompletion = () => {
            setTokenValueComplete(isCardComplete(tokenRef));
            setPositionValueComplete(isCardComplete(positionRef));
        };

        const observer = new MutationObserver(checkCompletion);
        if (tokenRef) {
            observer.observe(tokenRef, { attributes: true, subtree: true });
        }
        if (positionRef) {
            observer.observe(positionRef, { attributes: true, subtree: true });
        }

        return () => observer.disconnect();
    }, [tokenRef, positionRef]);

    const isValueLoading = (value) => isLoading || value === 0;

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
                                    isLoading={sneedLockStats.totalTokenLocks === 0}
                                />
                                <StatCard 
                                    value={sneedLockStats.totalPositionLocks.toString()} 
                                    label="Position Locks"
                                    isLoading={sneedLockStats.totalPositionLocks === 0}
                                />
                                <StatCard 
                                    value={sneedLockStats.activeUsers.toString()} 
                                    label="Active Users"
                                    isLoading={sneedLockStats.activeUsers === 0}
                                />
                                <div ref={setTokenRef}>
                                    <StatCard 
                                        value={formatUSD(sneedLockStats.tokenLocksValue)} 
                                        label="Token Locks Value"
                                        isLoading={false}
                                    />
                                </div>
                                <div ref={setPositionRef}>
                                    <StatCard 
                                        value={formatUSD(sneedLockStats.positionLocksValue)} 
                                        label="Pos. Locks Value"
                                        isLoading={false}
                                        isFinalValue={isLastPositionProcessed}
                                    />
                                </div>
                                <StatCard 
                                    value={formatUSD(sneedLockStats.totalValue)} 
                                    label="Total Value Locked"
                                    isLoading={false}
                                    isParentComplete={tokenValueComplete && positionValueComplete}
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
                                    value={swapRunnerStats.total_swaps.toString()} 
                                    label="Total Swaps"
                                    isLoading={swapRunnerStats.total_swaps === 0}
                                />
                                <StatCard 
                                    value={swapRunnerStats.split_swaps.toString()} 
                                    label="Split Swaps"
                                    isLoading={swapRunnerStats.split_swaps === 0}
                                />
                                <StatCard 
                                    value={swapRunnerStats.kong_swaps.toString()} 
                                    label="Kong Swaps"
                                    isLoading={swapRunnerStats.kong_swaps === 0}
                                />
                                <StatCard 
                                    value={swapRunnerStats.icpswap_swaps.toString()} 
                                    label="ICPSwap Swaps"
                                    isLoading={swapRunnerStats.icpswap_swaps === 0}
                                />
                                <StatCard 
                                    value={swapRunnerStats.unique_users.toString()} 
                                    label="Registered Users"
                                    isLoading={swapRunnerStats.unique_users === 0}
                                />
                                <StatCard 
                                    value={swapRunnerStats.unique_traders.toString()} 
                                    label="Active Traders"
                                    isLoading={swapRunnerStats.unique_traders === 0}
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