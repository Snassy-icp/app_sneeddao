import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import Header from '../components/Header';
import { useAuth } from '../AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import { Principal } from '@dfinity/principal';
import { createActor as createSneedLockActor, canisterId as sneedLockCanisterId } from 'declarations/sneed_lock';
import { createActor as createNeutriniteDappActor, canisterId as neutriniteCanisterId } from 'external/neutrinite_dapp';
import { createActor as createBackendActor, canisterId as backendCanisterId } from 'declarations/app_sneeddao_backend';
import { createActor as createLedgerActor } from 'external/icrc1_ledger';
import { createActor as createIcpSwapActor } from 'external/icp_swap';
import { createActor as createSwapRunnerActor } from 'external/swaprunner_backend';
import { canisterId as swapRunnerCanisterId } from 'external/swaprunner_backend';
import { formatAmount } from '../utils/StringUtils';
import { getTokenLogo, getTokenMetaForSwap } from '../utils/TokenUtils';
import { FaRocket, FaLock, FaExchangeAlt, FaUsers, FaDollarSign, FaArrowRight, FaSpinner, FaCubes, FaBolt, FaChartLine, FaGavel, FaWater } from 'react-icons/fa';
import { createSneedexActor } from '../utils/SneedexUtils';

// Custom CSS for animations
const customAnimations = `
@keyframes fadeInUp {
    from {
        opacity: 0;
        transform: translateY(20px);
    }
    to {
        opacity: 1;
        transform: translateY(0);
    }
}

@keyframes productsFloat {
    0%, 100% { transform: translateY(0px); }
    50% { transform: translateY(-8px); }
}

@keyframes spin {
    0% { transform: rotate(0deg); }
    100% { transform: rotate(360deg); }
}

.products-float {
    animation: productsFloat 3s ease-in-out infinite;
}

.products-fade-in {
    animation: fadeInUp 0.5s ease-out forwards;
}

.products-spin {
    animation: spin 1s linear infinite;
}
`;

// Page accent colors
const productsPrimary = '#10b981';
const productsSecondary = '#34d399';
const sneedlockPrimary = '#8b5cf6';
const sneedlockSecondary = '#a78bfa';
const swaprunnerPrimary = '#f59e0b';
const swaprunnerSecondary = '#fbbf24';
const sneedexPrimary = '#14b8a6';
const sneedexSecondary = '#2dd4bf';
const liquidStakingPrimary = '#06b6d4';
const liquidStakingSecondary = '#22d3ee';

const getStyles = (theme) => ({
    container: {
        maxWidth: '900px',
        margin: '0 auto',
        padding: '1.25rem',
        color: theme.colors.primaryText,
    },
    heading: {
        fontSize: '1.75rem',
        marginBottom: '1.5rem',
        color: theme.colors.primaryText,
        textAlign: 'center',
        fontWeight: '700',
    },
    grid: {
        display: 'flex',
        flexDirection: 'column',
        gap: '1.25rem',
    },
    product: (accentColor) => ({
        background: theme.colors.cardGradient,
        border: `1px solid ${theme.colors.border}`,
        borderRadius: '16px',
        padding: '1.5rem',
        display: 'flex',
        flexDirection: 'column',
        boxShadow: theme.colors.cardShadow,
        transition: 'all 0.3s ease',
        position: 'relative',
        overflow: 'hidden',
    }),
    productIcon: (accentColor) => ({
        width: '56px',
        height: '56px',
        borderRadius: '14px',
        background: `linear-gradient(135deg, ${accentColor}, ${accentColor}cc)`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        marginBottom: '1rem',
        boxShadow: `0 8px 24px ${accentColor}40`,
    }),
    productHeader: {
        display: 'flex',
        alignItems: 'flex-start',
        gap: '1rem',
        marginBottom: '1rem',
    },
    productTitle: (accentColor) => ({
        fontSize: '1.5rem',
        margin: 0,
        color: accentColor,
        fontWeight: '700',
    }),
    productBadge: (accentColor) => ({
        display: 'inline-flex',
        alignItems: 'center',
        gap: '4px',
        padding: '4px 10px',
        borderRadius: '20px',
        background: `${accentColor}15`,
        color: accentColor,
        fontSize: '0.75rem',
        fontWeight: '600',
        marginTop: '6px',
    }),
    description: {
        fontSize: '0.95rem',
        lineHeight: '1.6',
        color: theme.colors.secondaryText,
        marginBottom: '1.25rem',
    },
    statsSection: {
        marginTop: 'auto',
    },
    statsGrid: {
        display: 'grid',
        gridTemplateColumns: 'repeat(3, 1fr)',
        gap: '0.75rem',
        marginBottom: '1.25rem',
    },
    stat: (accentColor) => ({
        background: `${accentColor}08`,
        border: `1px solid ${accentColor}20`,
        padding: '0.875rem',
        borderRadius: '12px',
        textAlign: 'center',
        transition: 'all 0.3s ease',
    }),
    statValue: (accentColor) => ({
        fontSize: '1.25rem',
        fontWeight: '700',
        color: accentColor,
        marginBottom: '0.25rem',
        fontFamily: 'monospace',
    }),
    statValuePending: {
        fontSize: '1.25rem',
        fontWeight: '700',
        color: theme.colors.mutedText,
        marginBottom: '0.25rem',
        fontFamily: 'monospace',
    },
    statLabel: {
        color: theme.colors.secondaryText,
        fontSize: '0.75rem',
        fontWeight: '500',
    },
    button: (accentColor) => ({
        background: `linear-gradient(135deg, ${accentColor}, ${accentColor}dd)`,
        color: '#fff',
        border: 'none',
        borderRadius: '12px',
        padding: '0.875rem 1.25rem',
        fontSize: '1rem',
        fontWeight: '600',
        cursor: 'pointer',
        textDecoration: 'none',
        textAlign: 'center',
        transition: 'all 0.3s ease',
        boxShadow: `0 4px 16px ${accentColor}40`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '8px',
    }),
    decorativeGlow: (accentColor) => ({
        position: 'absolute',
        top: '-50%',
        right: '-20%',
        width: '200px',
        height: '200px',
        background: `radial-gradient(circle, ${accentColor}10 0%, transparent 70%)`,
        pointerEvents: 'none',
    }),
});

const LoadingSpinner = ({ accentColor }) => (
    <FaSpinner className="products-spin" size={18} style={{ color: accentColor }} />
);

function StatCard({ value, label, isLoading, isParentComplete, isFinalValue, theme, accentColor }) {
    const [displayValue, setDisplayValue] = useState('0');
    const [isComplete, setIsComplete] = useState(false);
    const styles = getStyles(theme);
    
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
        <div style={styles.stat(accentColor)}>
            <div style={isComplete ? styles.statValue(accentColor) : styles.statValuePending}>
                {isLoading ? <LoadingSpinner accentColor={accentColor} /> : displayValue}
            </div>
            <div style={styles.statLabel}>{label}</div>
        </div>
    );
}

function Products() {
    const { identity } = useAuth();
    const { theme } = useTheme();
    const styles = getStyles(theme);
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
    const [sneedexStats, setSneedexStats] = useState({
        active_offers: 0,
        total_offers: 0,
        completed_offers: 0,
        total_bids: 0
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
            // TODO: Migrate to use priceService for specific tokens as needed
            // For now, return empty to remove Neutrinite dependency
            console.warn('fetchConversionRates: Rate fetching disabled. Migrate to use priceService per-token.');
            return {};
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
        const backendActor = createBackendActor(backendCanisterId, { agentOptions: { identity } });

        try {
            const [tokenMeta, positionsResult] = await Promise.all([
                getTokenMetaForSwap(swapActor, backendActor, canisterId),
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

    const fetchSneedexStats = async () => {
        try {
            const actor = createSneedexActor(identity);
            const marketStats = await actor.getMarketStats();
            setSneedexStats({
                active_offers: Number(marketStats.active_offers),
                total_offers: Number(marketStats.total_offers),
                completed_offers: Number(marketStats.completed_offers),
                total_bids: Number(marketStats.total_bids)
            });
        } catch (error) {
            console.error('Error fetching Sneedex stats:', error);
        }
    };

    useEffect(() => {
        fetchSneedLockStats();
        fetchSwapRunnerStats();
        fetchSneedexStats();
        
        // Refresh data every 5 minutes
        const interval = setInterval(() => {
            fetchSneedLockStats();
            fetchSwapRunnerStats();
            fetchSneedexStats();
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
        <div className="page-container" style={{ background: theme.colors.primaryGradient, minHeight: '100vh' }}>
            <style>{customAnimations}</style>
            <Header />
            
            {/* Hero Banner */}
            <div style={{
                background: `linear-gradient(135deg, ${theme.colors.primaryBg} 0%, ${productsPrimary}12 50%, ${productsSecondary}08 100%)`,
                borderBottom: `1px solid ${theme.colors.border}`,
                padding: '2rem 1rem',
                position: 'relative',
                overflow: 'hidden',
                width: '100%',
                boxSizing: 'border-box'
            }}>
                {/* Background decorations */}
                <div style={{
                    position: 'absolute',
                    top: '-30%',
                    right: '-5%',
                    width: '300px',
                    height: '300px',
                    background: `radial-gradient(circle, ${productsPrimary}15 0%, transparent 70%)`,
                    pointerEvents: 'none'
                }} />
                
                <div className="products-fade-in" style={{ maxWidth: '900px', margin: '0 auto', textAlign: 'center', position: 'relative', zIndex: 1 }}>
                    <div className="products-float" style={{
                        width: '72px',
                        height: '72px',
                        borderRadius: '18px',
                        background: `linear-gradient(135deg, ${productsPrimary}, ${productsSecondary})`,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        margin: '0 auto 1rem',
                        boxShadow: `0 12px 40px ${productsPrimary}50`,
                    }}>
                        <FaRocket size={32} style={{ color: '#fff' }} />
                    </div>
                    
                    <div style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '6px',
                        padding: '6px 14px',
                        borderRadius: '20px',
                        background: `${productsPrimary}15`,
                        color: productsPrimary,
                        fontSize: '0.8rem',
                        fontWeight: '600',
                        marginBottom: '0.75rem'
                    }}>
                        <FaCubes size={12} />
                        Sneed DAO Products
                    </div>
                    
                    <h1 style={{
                        fontSize: '1.75rem',
                        fontWeight: '700',
                        color: theme.colors.primaryText,
                        margin: '0 0 0.5rem',
                        letterSpacing: '-0.5px'
                    }}>
                        Our Products
                    </h1>
                    <p style={{
                        fontSize: '0.95rem',
                        color: theme.colors.secondaryText,
                        margin: 0
                    }}>
                        Powerful DeFi tools built on the Internet Computer
                    </p>
                </div>
            </div>
            
            <main style={styles.container}>
                <div style={styles.grid}>
                    {/* Sneedex */}
                    <div className="products-fade-in" style={styles.product(sneedexPrimary)}>
                        <div style={styles.decorativeGlow(sneedexPrimary)} />
                        
                        <div style={styles.productHeader}>
                            <div style={styles.productIcon(sneedexPrimary)}>
                                <FaGavel size={24} style={{ color: '#fff' }} />
                            </div>
                            <div>
                                <h2 style={styles.productTitle(sneedexPrimary)}>Sneedex</h2>
                                <div style={styles.productBadge(sneedexPrimary)}>
                                    <FaExchangeAlt size={10} />
                                    Marketplace
                                </div>
                            </div>
                        </div>
                        
                        <p style={styles.description}>
                            A trustless marketplace for trading unique Internet Computer assets.
                            Trade canisters, SNS neurons, ICP Neuron Managers, and tokens through secure escrow auctions.
                        </p>
                        
                        <div style={styles.statsSection}>
                            <div style={{ ...styles.statsGrid, gridTemplateColumns: 'repeat(4, 1fr)' }}>
                                <StatCard 
                                    value={sneedexStats.active_offers.toString()} 
                                    label="Active Offers"
                                    isLoading={sneedexStats.total_offers === 0}
                                    theme={theme}
                                    accentColor={sneedexPrimary}
                                />
                                <StatCard 
                                    value={sneedexStats.total_offers.toString()} 
                                    label="Total Offers"
                                    isLoading={sneedexStats.total_offers === 0}
                                    theme={theme}
                                    accentColor={sneedexPrimary}
                                />
                                <StatCard 
                                    value={sneedexStats.completed_offers.toString()} 
                                    label="Completed"
                                    isLoading={sneedexStats.total_offers === 0}
                                    theme={theme}
                                    accentColor={sneedexPrimary}
                                />
                                <StatCard 
                                    value={sneedexStats.total_bids.toString()} 
                                    label="Total Bids"
                                    isLoading={sneedexStats.total_offers === 0}
                                    theme={theme}
                                    accentColor={sneedexPrimary}
                                />
                            </div>
                            
                            <Link 
                                to="/sneedex_offers" 
                                style={styles.button(sneedexPrimary)}
                            >
                                Explore Sneedex
                                <FaArrowRight size={14} />
                            </Link>
                        </div>
                    </div>

                    {/* SwapRunner */}
                    <div className="products-fade-in" style={{ ...styles.product(swaprunnerPrimary), animationDelay: '0.1s' }}>
                        <div style={styles.decorativeGlow(swaprunnerPrimary)} />
                        
                        <div style={styles.productHeader}>
                            <div style={styles.productIcon(swaprunnerPrimary)}>
                                <FaExchangeAlt size={24} style={{ color: '#fff' }} />
                            </div>
                            <div>
                                <h2 style={styles.productTitle(swaprunnerPrimary)}>SwapRunner</h2>
                                <div style={styles.productBadge(swaprunnerPrimary)}>
                                    <FaBolt size={10} />
                                    DEX Aggregator
                                </div>
                            </div>
                        </div>
                        
                        <p style={styles.description}>
                            A high-performance decentralized exchange aggregator built for speed and efficiency.
                            Experience lightning-fast token swaps with minimal slippage.
                        </p>
                        
                        <div style={styles.statsSection}>
                            <div style={styles.statsGrid}>
                                <StatCard 
                                    value={swapRunnerStats.total_swaps.toString()} 
                                    label="Total Swaps"
                                    isLoading={swapRunnerStats.total_swaps === 0}
                                    theme={theme}
                                    accentColor={swaprunnerPrimary}
                                />
                                <StatCard 
                                    value={swapRunnerStats.split_swaps.toString()} 
                                    label="Split Swaps"
                                    isLoading={swapRunnerStats.split_swaps === 0}
                                    theme={theme}
                                    accentColor={swaprunnerPrimary}
                                />
                                <StatCard 
                                    value={swapRunnerStats.kong_swaps.toString()} 
                                    label="Kong Swaps"
                                    isLoading={swapRunnerStats.kong_swaps === 0}
                                    theme={theme}
                                    accentColor={swaprunnerPrimary}
                                />
                                <StatCard 
                                    value={swapRunnerStats.icpswap_swaps.toString()} 
                                    label="ICPSwap Swaps"
                                    isLoading={swapRunnerStats.icpswap_swaps === 0}
                                    theme={theme}
                                    accentColor={swaprunnerPrimary}
                                />
                                <StatCard 
                                    value={swapRunnerStats.unique_users.toString()} 
                                    label="Registered Users"
                                    isLoading={swapRunnerStats.unique_users === 0}
                                    theme={theme}
                                    accentColor={swaprunnerPrimary}
                                />
                                <StatCard 
                                    value={swapRunnerStats.unique_traders.toString()} 
                                    label="Active Traders"
                                    isLoading={swapRunnerStats.unique_traders === 0}
                                    theme={theme}
                                    accentColor={swaprunnerPrimary}
                                />
                            </div>
                            
                            <a 
                                href="https://swaprunner.com" 
                                target="_blank" 
                                rel="noopener noreferrer" 
                                style={styles.button(swaprunnerPrimary)}
                            >
                                Visit SwapRunner
                                <FaArrowRight size={14} />
                            </a>
                        </div>
                    </div>

                    {/* Liquid Staking */}
                    <div className="products-fade-in" style={{ ...styles.product(liquidStakingPrimary), animationDelay: '0.2s' }}>
                        <div style={styles.decorativeGlow(liquidStakingPrimary)} />
                        
                        <div style={styles.productHeader}>
                            <div style={styles.productIcon(liquidStakingPrimary)}>
                                <FaWater size={24} style={{ color: '#fff' }} />
                            </div>
                            <div>
                                <h2 style={styles.productTitle(liquidStakingPrimary)}>Liquid Staking</h2>
                                <div style={styles.productBadge(liquidStakingPrimary)}>
                                    <FaLock size={10} />
                                    Tradable Positions
                                </div>
                            </div>
                        </div>
                        
                        <p style={styles.description}>
                            Transform your staking positions into tradable assets. Create ICP or SNS neurons that remain
                            transferable and liquid — sell your position anytime on Sneedex without waiting for dissolve delays.
                        </p>
                        
                        <div style={styles.statsSection}>
                            {/* Feature highlights instead of stats */}
                            <div style={{
                                display: 'grid',
                                gridTemplateColumns: 'repeat(2, 1fr)',
                                gap: '0.75rem',
                                marginBottom: '1.25rem',
                            }}>
                                <div style={{
                                    background: `${liquidStakingPrimary}08`,
                                    border: `1px solid ${liquidStakingPrimary}20`,
                                    padding: '0.875rem',
                                    borderRadius: '12px',
                                    textAlign: 'center',
                                }}>
                                    <div style={{ fontSize: '1.5rem', marginBottom: '0.25rem' }}>🧠</div>
                                    <div style={{ color: theme.colors.secondaryText, fontSize: '0.75rem', fontWeight: '500' }}>
                                        ICP Neuron Managers
                                    </div>
                                </div>
                                <div style={{
                                    background: `${liquidStakingPrimary}08`,
                                    border: `1px solid ${liquidStakingPrimary}20`,
                                    padding: '0.875rem',
                                    borderRadius: '12px',
                                    textAlign: 'center',
                                }}>
                                    <div style={{ fontSize: '1.5rem', marginBottom: '0.25rem' }}>🧬</div>
                                    <div style={{ color: theme.colors.secondaryText, fontSize: '0.75rem', fontWeight: '500' }}>
                                        SNS Liquid Neurons
                                    </div>
                                </div>
                                <div style={{
                                    background: `${liquidStakingPrimary}08`,
                                    border: `1px solid ${liquidStakingPrimary}20`,
                                    padding: '0.875rem',
                                    borderRadius: '12px',
                                    textAlign: 'center',
                                }}>
                                    <div style={{ fontSize: '1.5rem', marginBottom: '0.25rem' }}>💰</div>
                                    <div style={{ color: theme.colors.secondaryText, fontSize: '0.75rem', fontWeight: '500' }}>
                                        Earn Staking Rewards
                                    </div>
                                </div>
                                <div style={{
                                    background: `${liquidStakingPrimary}08`,
                                    border: `1px solid ${liquidStakingPrimary}20`,
                                    padding: '0.875rem',
                                    borderRadius: '12px',
                                    textAlign: 'center',
                                }}>
                                    <div style={{ fontSize: '1.5rem', marginBottom: '0.25rem' }}>🔓</div>
                                    <div style={{ color: theme.colors.secondaryText, fontSize: '0.75rem', fontWeight: '500' }}>
                                        Exit Anytime
                                    </div>
                                </div>
                            </div>
                            
                            <Link 
                                to="/liquid_staking" 
                                style={styles.button(liquidStakingPrimary)}
                            >
                                Start Liquid Staking
                                <FaArrowRight size={14} />
                            </Link>
                        </div>
                    </div>

                    {/* SneedLock */}
                    <div className="products-fade-in" style={{ ...styles.product(sneedlockPrimary), animationDelay: '0.3s' }}>
                        <div style={styles.decorativeGlow(sneedlockPrimary)} />
                        
                        <div style={styles.productHeader}>
                            <div style={styles.productIcon(sneedlockPrimary)}>
                                <FaLock size={24} style={{ color: '#fff' }} />
                            </div>
                            <div>
                                <h2 style={styles.productTitle(sneedlockPrimary)}>SneedLock</h2>
                                <div style={styles.productBadge(sneedlockPrimary)}>
                                    <FaLock size={10} />
                                    Token Locking
                                </div>
                            </div>
                        </div>
                        
                        <p style={styles.description}>
                            A secure and flexible token locking solution built on the Internet Computer.
                            Create customizable token locks with various vesting schedules and conditions.
                        </p>
                        
                        <div style={styles.statsSection}>
                            <div style={styles.statsGrid}>
                                <StatCard 
                                    value={sneedLockStats.totalTokenLocks.toString()} 
                                    label="Token Locks"
                                    isLoading={sneedLockStats.totalTokenLocks === 0}
                                    theme={theme}
                                    accentColor={sneedlockPrimary}
                                />
                                <StatCard 
                                    value={sneedLockStats.totalPositionLocks.toString()} 
                                    label="Position Locks"
                                    isLoading={sneedLockStats.totalPositionLocks === 0}
                                    theme={theme}
                                    accentColor={sneedlockPrimary}
                                />
                                <StatCard 
                                    value={sneedLockStats.activeUsers.toString()} 
                                    label="Active Users"
                                    isLoading={sneedLockStats.activeUsers === 0}
                                    theme={theme}
                                    accentColor={sneedlockPrimary}
                                />
                                <div ref={setTokenRef}>
                                    <StatCard 
                                        value={formatUSD(sneedLockStats.tokenLocksValue)} 
                                        label="Token Locks Value"
                                        isLoading={false}
                                        theme={theme}
                                        accentColor={sneedlockPrimary}
                                    />
                                </div>
                                <div ref={setPositionRef}>
                                    <StatCard 
                                        value={formatUSD(sneedLockStats.positionLocksValue)} 
                                        label="Pos. Locks Value"
                                        isLoading={false}
                                        isFinalValue={isLastPositionProcessed}
                                        theme={theme}
                                        accentColor={sneedlockPrimary}
                                    />
                                </div>
                                <StatCard 
                                    value={formatUSD(sneedLockStats.totalValue)} 
                                    label="Total Value Locked"
                                    isLoading={false}
                                    isParentComplete={tokenValueComplete && positionValueComplete}
                                    theme={theme}
                                    accentColor={sneedlockPrimary}
                                />
                            </div>
                            
                            <Link 
                                to="/sneedlock" 
                                style={styles.button(sneedlockPrimary)}
                            >
                                Launch SneedLock
                                <FaArrowRight size={14} />
                            </Link>
                        </div>
                    </div>
                </div>
            </main>
        </div>
    );
}

export default Products; 