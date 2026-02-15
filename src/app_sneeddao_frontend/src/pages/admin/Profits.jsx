import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../../AuthContext';
import { useTheme } from '../../contexts/ThemeContext';
import { useAdminCheck } from '../../hooks/useAdminCheck';
import Header from '../../components/Header';
import { FaChartLine, FaDollarSign, FaSync, FaExclamationTriangle, FaCoins, FaCrown, FaLock, FaStore, FaCube, FaUnlock } from 'react-icons/fa';

// Canister imports
import { createActor as createFactoryActor, canisterId as factoryCanisterId } from 'declarations/sneedapp';
import { createActor as createSneedexActor, canisterId as sneedexCanisterId } from 'declarations/sneedex';
import { createActor as createSneedLockActor, canisterId as sneedLockCanisterId } from 'declarations/sneed_lock';
import { createSneedPremiumActor } from '../../utils/SneedPremiumUtils';
import { createActor as createBackendActor, canisterId as backendCanisterId } from 'declarations/app_sneeddao_backend';

// Price service
import priceService from '../../services/PriceService';

const E8S = 100_000_000;
const ICP_LEDGER_ID = 'ryjl3-tyaaa-aaaaa-aaaba-cai';

export default function ProfitsAdmin() {
    const { isAuthenticated, identity } = useAuth();
    const { theme, isDark } = useTheme();
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    
    // Profit data states
    const [factoryProfits, setFactoryProfits] = useState(null);
    const [sneedexProfits, setSneedexProfits] = useState(null);
    const [sneedLockProfits, setSneedLockProfits] = useState(null);
    const [premiumProfits, setPremiumProfits] = useState(null);
    const [jailbreakProfits, setJailbreakProfits] = useState(null);
    
    // Price states
    const [icpUsdPrice, setIcpUsdPrice] = useState(null);
    const [tokenPrices, setTokenPrices] = useState({}); // ledgerId -> USD price
    
    // Loading states
    const [loadingFactory, setLoadingFactory] = useState(false);
    const [loadingSneedex, setLoadingSneedex] = useState(false);
    const [loadingSneedLock, setLoadingSneedLock] = useState(false);
    const [loadingPremium, setLoadingPremium] = useState(false);
    const [loadingJailbreak, setLoadingJailbreak] = useState(false);
    const [loadingPrices, setLoadingPrices] = useState(false);

    // Use admin check hook
    useAdminCheck({ identity, isAuthenticated });

    // Format ICP amount
    const formatIcp = (e8s) => {
        if (e8s === null || e8s === undefined) return '—';
        const icp = Number(e8s) / E8S;
        return icp.toLocaleString(undefined, { minimumFractionDigits: 4, maximumFractionDigits: 4 });
    };

    // Format USD amount
    const formatUsd = (amount) => {
        if (amount === null || amount === undefined) return '—';
        return `$${Number(amount).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    };

    // Calculate USD value from e8s
    const e8sToUsd = (e8s) => {
        if (!icpUsdPrice || e8s === null || e8s === undefined) return null;
        return (Number(e8s) / E8S) * icpUsdPrice;
    };

    // Format token amount with decimals
    const formatTokenAmount = (amount, decimals) => {
        if (amount === null || amount === undefined) return '—';
        const divisor = Math.pow(10, decimals);
        return (Number(amount) / divisor).toLocaleString(undefined, { 
            minimumFractionDigits: 2, 
            maximumFractionDigits: Math.min(decimals, 6) 
        });
    };

    // Fetch ICP/USD price
    const fetchIcpPrice = useCallback(async () => {
        setLoadingPrices(true);
        try {
            const price = await priceService.getICPUSDPrice();
            setIcpUsdPrice(price);
        } catch (err) {
            console.error('Failed to fetch ICP price:', err);
        } finally {
            setLoadingPrices(false);
        }
    }, []);

    // Fetch token USD price
    const fetchTokenPrice = useCallback(async (ledgerId, decimals = 8) => {
        if (ledgerId === ICP_LEDGER_ID) {
            // ICP price is already fetched
            return;
        }
        try {
            const price = await priceService.getTokenUSDPrice(ledgerId, decimals);
            setTokenPrices(prev => ({ ...prev, [ledgerId]: price }));
        } catch (err) {
            console.error(`Failed to fetch price for ${ledgerId}:`, err);
        }
    }, []);

    // Fetch Factory profits
    const fetchFactoryProfits = useCallback(async () => {
        if (!identity) return;
        setLoadingFactory(true);
        try {
            const actor = createFactoryActor(factoryCanisterId, {
                agentOptions: { identity }
            });
            const aggregates = await actor.getFactoryAggregates();
            setFactoryProfits(aggregates);
        } catch (err) {
            console.error('Failed to fetch factory profits:', err);
            setFactoryProfits({ error: err.message });
        } finally {
            setLoadingFactory(false);
        }
    }, [identity]);

    // Fetch Sneedex profits
    const fetchSneedexProfits = useCallback(async () => {
        if (!identity) return;
        setLoadingSneedex(true);
        try {
            const actor = createSneedexActor(sneedexCanisterId, {
                agentOptions: { identity }
            });
            const stats = await actor.getPaymentStats();
            setSneedexProfits(stats);
            
            // Fetch prices for each token with cuts
            if (stats.cuts_by_ledger) {
                for (const [ledger, _] of stats.cuts_by_ledger) {
                    const ledgerId = ledger.toString();
                    if (ledgerId !== ICP_LEDGER_ID) {
                        fetchTokenPrice(ledgerId);
                    }
                }
            }
        } catch (err) {
            console.error('Failed to fetch Sneedex profits:', err);
            setSneedexProfits({ error: err.message });
        } finally {
            setLoadingSneedex(false);
        }
    }, [identity, fetchTokenPrice]);

    // Fetch SneedLock profits
    const fetchSneedLockProfits = useCallback(async () => {
        if (!identity) return;
        setLoadingSneedLock(true);
        try {
            const actor = createSneedLockActor(sneedLockCanisterId, {
                agentOptions: { identity }
            });
            const stats = await actor.get_lock_fee_stats();
            setSneedLockProfits(stats);
        } catch (err) {
            console.error('Failed to fetch SneedLock profits:', err);
            setSneedLockProfits({ error: err.message });
        } finally {
            setLoadingSneedLock(false);
        }
    }, [identity]);

    // Fetch Premium profits
    const fetchPremiumProfits = useCallback(async () => {
        if (!identity) return;
        setLoadingPremium(true);
        try {
            const actor = await createSneedPremiumActor(identity);
            const stats = await actor.getPaymentStats();
            setPremiumProfits(stats);
        } catch (err) {
            console.error('Failed to fetch Premium profits:', err);
            setPremiumProfits({ error: err.message });
        } finally {
            setLoadingPremium(false);
        }
    }, [identity]);

    // Fetch Jailbreak profits
    const fetchJailbreakProfits = useCallback(async () => {
        if (!identity) return;
        setLoadingJailbreak(true);
        try {
            const actor = createBackendActor(backendCanisterId, {
                agentOptions: { identity }
            });
            const result = await actor.get_jailbreak_payment_stats();
            if ('ok' in result) {
                setJailbreakProfits(result.ok);
            } else {
                setJailbreakProfits({ error: result.err });
            }
        } catch (err) {
            console.error('Failed to fetch Jailbreak profits:', err);
            setJailbreakProfits({ error: err.message });
        } finally {
            setLoadingJailbreak(false);
        }
    }, [identity]);

    // Fetch all data
    const fetchAllData = useCallback(async () => {
        setLoading(true);
        setError('');
        
        await Promise.all([
            fetchIcpPrice(),
            fetchFactoryProfits(),
            fetchSneedexProfits(),
            fetchSneedLockProfits(),
            fetchPremiumProfits(),
            fetchJailbreakProfits()
        ]);
        
        setLoading(false);
    }, [fetchIcpPrice, fetchFactoryProfits, fetchSneedexProfits, fetchSneedLockProfits, fetchPremiumProfits, fetchJailbreakProfits]);

    // Initial load
    useEffect(() => {
        if (isAuthenticated && identity) {
            fetchAllData();
        }
    }, [isAuthenticated, identity]);

    // Calculate total ICP profit (e8s)
    const calculateTotalIcpE8s = () => {
        let total = BigInt(0);
        
        // Factory profits
        if (factoryProfits && !factoryProfits.error && factoryProfits.totalIcpProfitE8s) {
            total += BigInt(factoryProfits.totalIcpProfitE8s);
        }
        
        // Sneedex creation fees (ICP)
        if (sneedexProfits && !sneedexProfits.error && sneedexProfits.total_creation_fees_collected_e8s) {
            total += BigInt(sneedexProfits.total_creation_fees_collected_e8s);
        }
        
        // Sneedex ICP cuts
        if (sneedexProfits && !sneedexProfits.error && sneedexProfits.cuts_by_ledger) {
            for (const [ledger, amount] of sneedexProfits.cuts_by_ledger) {
                if (ledger.toString() === ICP_LEDGER_ID) {
                    total += BigInt(amount);
                }
            }
        }
        
        // SneedLock profits
        if (sneedLockProfits && !sneedLockProfits.error) {
            if (sneedLockProfits.total_token_lock_fees_collected_e8s) {
                total += BigInt(sneedLockProfits.total_token_lock_fees_collected_e8s);
            }
            if (sneedLockProfits.total_position_lock_fees_collected_e8s) {
                total += BigInt(sneedLockProfits.total_position_lock_fees_collected_e8s);
            }
        }
        
        // Premium profits
        if (premiumProfits && !premiumProfits.error && premiumProfits.total_icp_collected_e8s) {
            total += BigInt(premiumProfits.total_icp_collected_e8s);
        }
        
        // Jailbreak profits
        if (jailbreakProfits && !jailbreakProfits.error && jailbreakProfits.total_revenue_e8s) {
            total += BigInt(jailbreakProfits.total_revenue_e8s);
        }
        
        return total;
    };

    // Calculate total USD value of all profits
    const calculateTotalUsd = () => {
        if (!icpUsdPrice) return null;
        
        let total = 0;
        
        // ICP profits
        const totalIcpE8s = calculateTotalIcpE8s();
        total += (Number(totalIcpE8s) / E8S) * icpUsdPrice;
        
        // Non-ICP token cuts from Sneedex
        if (sneedexProfits && !sneedexProfits.error && sneedexProfits.cuts_by_ledger) {
            for (const [ledger, amount] of sneedexProfits.cuts_by_ledger) {
                const ledgerId = ledger.toString();
                if (ledgerId !== ICP_LEDGER_ID && tokenPrices[ledgerId]) {
                    // Assume 8 decimals for unknown tokens - could be improved
                    total += (Number(amount) / 1e8) * tokenPrices[ledgerId];
                }
            }
        }
        
        return total;
    };

    // Styles
    const styles = {
        container: {
            maxWidth: '1200px',
            margin: '0 auto',
            padding: '20px',
        },
        title: {
            color: theme.colors.primaryText,
            fontSize: '2rem',
            marginBottom: '10px',
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
        },
        subtitle: {
            color: theme.colors.secondaryText,
            fontSize: '1rem',
            marginBottom: '30px',
        },
        refreshButton: {
            backgroundColor: theme.colors.accent,
            color: theme.colors.primaryBg,
            border: 'none',
            borderRadius: '8px',
            padding: '12px 24px',
            cursor: loading ? 'not-allowed' : 'pointer',
            opacity: loading ? 0.6 : 1,
            fontSize: '1rem',
            fontWeight: '600',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            marginBottom: '30px',
        },
        summaryCard: {
            backgroundColor: theme.colors.secondaryBg,
            borderRadius: '12px',
            padding: '24px',
            marginBottom: '30px',
            border: `1px solid ${theme.colors.border}`,
        },
        summaryTitle: {
            color: theme.colors.primaryText,
            fontSize: '1.25rem',
            fontWeight: '600',
            marginBottom: '20px',
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
        },
        summaryGrid: {
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
            gap: '20px',
        },
        summaryItem: {
            textAlign: 'center',
            padding: '15px',
            backgroundColor: theme.colors.tertiaryBg,
            borderRadius: '8px',
        },
        summaryLabel: {
            color: theme.colors.secondaryText,
            fontSize: '0.85rem',
            marginBottom: '8px',
        },
        summaryValue: {
            color: theme.colors.success,
            fontSize: '1.75rem',
            fontWeight: '700',
        },
        summaryValueSecondary: {
            color: theme.colors.mutedText,
            fontSize: '1rem',
            marginTop: '4px',
        },
        sectionGrid: {
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
            gap: '20px',
            marginBottom: '30px',
        },
        card: {
            backgroundColor: theme.colors.secondaryBg,
            borderRadius: '12px',
            padding: '20px',
            border: `1px solid ${theme.colors.border}`,
        },
        cardTitle: {
            color: theme.colors.primaryText,
            fontSize: '1.1rem',
            fontWeight: '600',
            marginBottom: '15px',
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
        },
        cardIcon: {
            color: theme.colors.accent,
        },
        statRow: {
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            padding: '10px 0',
            borderBottom: `1px solid ${theme.colors.border}`,
        },
        statLabel: {
            color: theme.colors.secondaryText,
            fontSize: '0.9rem',
        },
        statValue: {
            color: theme.colors.primaryText,
            fontSize: '0.95rem',
            fontWeight: '600',
            textAlign: 'right',
        },
        statUsd: {
            color: theme.colors.mutedText,
            fontSize: '0.8rem',
        },
        errorText: {
            color: theme.colors.error,
            fontSize: '0.85rem',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
        },
        loadingText: {
            color: theme.colors.mutedText,
            fontSize: '0.9rem',
        },
        tokenCutsTable: {
            width: '100%',
            marginTop: '15px',
        },
        tokenCutRow: {
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            padding: '8px 12px',
            backgroundColor: theme.colors.tertiaryBg,
            borderRadius: '6px',
            marginBottom: '8px',
        },
        tokenCutLabel: {
            color: theme.colors.secondaryText,
            fontSize: '0.85rem',
            fontFamily: 'monospace',
        },
        tokenCutValue: {
            color: theme.colors.primaryText,
            fontSize: '0.9rem',
            fontWeight: '500',
            textAlign: 'right',
        },
        priceIndicator: {
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            padding: '10px 15px',
            backgroundColor: theme.colors.tertiaryBg,
            borderRadius: '8px',
            marginBottom: '20px',
        },
        priceLabel: {
            color: theme.colors.secondaryText,
            fontSize: '0.85rem',
        },
        priceValue: {
            color: theme.colors.accent,
            fontSize: '1rem',
            fontWeight: '600',
        },
    };

    // Render individual section cards
    const renderJailbreakCard = () => (
        <div style={styles.card}>
            <h3 style={styles.cardTitle}>
                <FaUnlock style={styles.cardIcon} />
                SNS Jailbreak
            </h3>
            {loadingJailbreak ? (
                <p style={styles.loadingText}>Loading...</p>
            ) : jailbreakProfits?.error ? (
                <p style={styles.errorText}>
                    <FaExclamationTriangle />
                    {jailbreakProfits.error}
                </p>
            ) : jailbreakProfits ? (
                <>
                    <div style={styles.statRow}>
                        <span style={styles.statLabel}>Total Revenue</span>
                        <div style={styles.statValue}>
                            {formatIcp(jailbreakProfits.total_revenue_e8s)} ICP
                            <div style={styles.statUsd}>{formatUsd(e8sToUsd(jailbreakProfits.total_revenue_e8s))}</div>
                        </div>
                    </div>
                    <div style={styles.statRow}>
                        <span style={styles.statLabel}>Premium Revenue</span>
                        <div style={styles.statValue}>
                            {formatIcp(jailbreakProfits.premium_revenue_e8s)} ICP
                            <div style={styles.statUsd}>
                                {Number(jailbreakProfits.total_premium_payments).toLocaleString()} payments
                            </div>
                        </div>
                    </div>
                    <div style={styles.statRow}>
                        <span style={styles.statLabel}>Regular Revenue</span>
                        <div style={styles.statValue}>
                            {formatIcp(jailbreakProfits.regular_revenue_e8s)} ICP
                            <div style={styles.statUsd}>
                                {Number(jailbreakProfits.total_regular_payments).toLocaleString()} payments
                            </div>
                        </div>
                    </div>
                    <div style={styles.statRow}>
                        <span style={styles.statLabel}>Scripts Created</span>
                        <div style={styles.statValue}>
                            {Number(jailbreakProfits.total_scripts_created).toLocaleString()}
                        </div>
                    </div>
                    <div style={{ ...styles.statRow, borderBottom: 'none' }}>
                        <span style={styles.statLabel}>Unique Users</span>
                        <div style={styles.statValue}>
                            {Number(jailbreakProfits.unique_users).toLocaleString()}
                        </div>
                    </div>
                </>
            ) : (
                <p style={styles.loadingText}>No data</p>
            )}
        </div>
    );

    const renderFactoryCard = () => (
        <div style={styles.card}>
            <h3 style={styles.cardTitle}>
                <FaCube style={styles.cardIcon} />
                ICP Staking Bot Factory
            </h3>
            {loadingFactory ? (
                <p style={styles.loadingText}>Loading...</p>
            ) : factoryProfits?.error ? (
                <p style={styles.errorText}>
                    <FaExclamationTriangle />
                    {factoryProfits.error}
                </p>
            ) : factoryProfits ? (
                <>
                    <div style={styles.statRow}>
                        <span style={styles.statLabel}>Total ICP Profit</span>
                        <div style={styles.statValue}>
                            {formatIcp(factoryProfits.totalIcpProfitE8s)} ICP
                            <div style={styles.statUsd}>{formatUsd(e8sToUsd(factoryProfits.totalIcpProfitE8s))}</div>
                        </div>
                    </div>
                    <div style={styles.statRow}>
                        <span style={styles.statLabel}>Total ICP Received</span>
                        <div style={styles.statValue}>
                            {formatIcp(factoryProfits.totalIcpPaidE8s)} ICP
                        </div>
                    </div>
                    <div style={styles.statRow}>
                        <span style={styles.statLabel}>ICP Used for Cycles</span>
                        <div style={styles.statValue}>
                            {formatIcp(factoryProfits.totalIcpForCyclesE8s)} ICP
                        </div>
                    </div>
                    <div style={{ ...styles.statRow, borderBottom: 'none' }}>
                        <span style={styles.statLabel}>Canisters Created</span>
                        <div style={styles.statValue}>
                            {Number(factoryProfits.totalCanistersCreated).toLocaleString()}
                        </div>
                    </div>
                </>
            ) : (
                <p style={styles.loadingText}>No data</p>
            )}
        </div>
    );

    const renderSneedexCard = () => (
        <div style={styles.card}>
            <h3 style={styles.cardTitle}>
                <FaStore style={styles.cardIcon} />
                Sneedex Marketplace
            </h3>
            {loadingSneedex ? (
                <p style={styles.loadingText}>Loading...</p>
            ) : sneedexProfits?.error ? (
                <p style={styles.errorText}>
                    <FaExclamationTriangle />
                    {sneedexProfits.error}
                </p>
            ) : sneedexProfits ? (
                <>
                    <div style={styles.statRow}>
                        <span style={styles.statLabel}>Creation Fees (ICP)</span>
                        <div style={styles.statValue}>
                            {formatIcp(sneedexProfits.total_creation_fees_collected_e8s)} ICP
                            <div style={styles.statUsd}>{formatUsd(e8sToUsd(sneedexProfits.total_creation_fees_collected_e8s))}</div>
                        </div>
                    </div>
                    <div style={styles.statRow}>
                        <span style={styles.statLabel}>Total Creation Fee Payments</span>
                        <div style={styles.statValue}>
                            {Number(sneedexProfits.total_creation_fee_payments || 0).toLocaleString()}
                        </div>
                    </div>
                    <div style={{ ...styles.statRow, borderBottom: 'none' }}>
                        <span style={styles.statLabel}>Total Cut Payments</span>
                        <div style={styles.statValue}>
                            {Number(sneedexProfits.total_cut_payments || 0).toLocaleString()}
                        </div>
                    </div>
                    
                    {/* Token cuts breakdown */}
                    {sneedexProfits.cuts_by_ledger && sneedexProfits.cuts_by_ledger.length > 0 && (
                        <>
                            <h4 style={{ 
                                color: theme.colors.primaryText, 
                                fontSize: '0.95rem', 
                                marginTop: '15px',
                                marginBottom: '10px',
                                fontWeight: '600'
                            }}>
                                Marketplace Cuts by Token
                            </h4>
                            <div style={styles.tokenCutsTable}>
                                {sneedexProfits.cuts_by_ledger.map(([ledger, amount], idx) => {
                                    const ledgerId = ledger.toString();
                                    const isIcp = ledgerId === ICP_LEDGER_ID;
                                    const symbol = isIcp ? 'ICP' : ledgerId.substring(0, 10) + '...';
                                    const usdPrice = isIcp ? icpUsdPrice : tokenPrices[ledgerId];
                                    const usdValue = usdPrice ? (Number(amount) / 1e8) * usdPrice : null;
                                    
                                    return (
                                        <div key={idx} style={styles.tokenCutRow}>
                                            <span style={styles.tokenCutLabel}>{symbol}</span>
                                            <div style={styles.tokenCutValue}>
                                                {formatTokenAmount(amount, 8)}
                                                {usdValue && (
                                                    <div style={styles.statUsd}>{formatUsd(usdValue)}</div>
                                                )}
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </>
                    )}
                </>
            ) : (
                <p style={styles.loadingText}>No data</p>
            )}
        </div>
    );

    const renderSneedLockCard = () => (
        <div style={styles.card}>
            <h3 style={styles.cardTitle}>
                <FaLock style={styles.cardIcon} />
                Sneed Lock
            </h3>
            {loadingSneedLock ? (
                <p style={styles.loadingText}>Loading...</p>
            ) : sneedLockProfits?.error ? (
                <p style={styles.errorText}>
                    <FaExclamationTriangle />
                    {sneedLockProfits.error}
                </p>
            ) : sneedLockProfits ? (
                <>
                    <div style={styles.statRow}>
                        <span style={styles.statLabel}>Token Lock Fees</span>
                        <div style={styles.statValue}>
                            {formatIcp(sneedLockProfits.total_token_lock_fees_collected_e8s)} ICP
                            <div style={styles.statUsd}>{formatUsd(e8sToUsd(sneedLockProfits.total_token_lock_fees_collected_e8s))}</div>
                        </div>
                    </div>
                    <div style={styles.statRow}>
                        <span style={styles.statLabel}>Position Lock Fees</span>
                        <div style={styles.statValue}>
                            {formatIcp(sneedLockProfits.total_position_lock_fees_collected_e8s)} ICP
                            <div style={styles.statUsd}>{formatUsd(e8sToUsd(sneedLockProfits.total_position_lock_fees_collected_e8s))}</div>
                        </div>
                    </div>
                    <div style={{ ...styles.statRow, borderBottom: 'none' }}>
                        <span style={styles.statLabel}>Total Lock Fees</span>
                        <div style={styles.statValue}>
                            {formatIcp(
                                (Number(sneedLockProfits.total_token_lock_fees_collected_e8s || 0) + 
                                 Number(sneedLockProfits.total_position_lock_fees_collected_e8s || 0))
                            )} ICP
                            <div style={styles.statUsd}>
                                {formatUsd(e8sToUsd(
                                    Number(sneedLockProfits.total_token_lock_fees_collected_e8s || 0) + 
                                    Number(sneedLockProfits.total_position_lock_fees_collected_e8s || 0)
                                ))}
                            </div>
                        </div>
                    </div>
                </>
            ) : (
                <p style={styles.loadingText}>No data</p>
            )}
        </div>
    );

    const renderPremiumCard = () => (
        <div style={styles.card}>
            <h3 style={styles.cardTitle}>
                <FaCrown style={styles.cardIcon} />
                Sneed Premium
            </h3>
            {loadingPremium ? (
                <p style={styles.loadingText}>Loading...</p>
            ) : premiumProfits?.error ? (
                <p style={styles.errorText}>
                    <FaExclamationTriangle />
                    {premiumProfits.error}
                </p>
            ) : premiumProfits ? (
                <>
                    <div style={styles.statRow}>
                        <span style={styles.statLabel}>Total ICP Collected</span>
                        <div style={styles.statValue}>
                            {formatIcp(premiumProfits.total_icp_collected_e8s)} ICP
                            <div style={styles.statUsd}>{formatUsd(e8sToUsd(premiumProfits.total_icp_collected_e8s))}</div>
                        </div>
                    </div>
                    <div style={styles.statRow}>
                        <span style={styles.statLabel}>ICP Payments</span>
                        <div style={styles.statValue}>
                            {Number(premiumProfits.total_icp_payments || 0).toLocaleString()}
                        </div>
                    </div>
                    <div style={styles.statRow}>
                        <span style={styles.statLabel}>VP Claims</span>
                        <div style={styles.statValue}>
                            {Number(premiumProfits.total_vp_claims || 0).toLocaleString()}
                        </div>
                    </div>
                    <div style={{ ...styles.statRow, borderBottom: 'none' }}>
                        <span style={styles.statLabel}>Promo Claims</span>
                        <div style={styles.statValue}>
                            {Number(premiumProfits.total_promo_claims || 0).toLocaleString()}
                        </div>
                    </div>
                </>
            ) : (
                <p style={styles.loadingText}>No data</p>
            )}
        </div>
    );

    if (!isAuthenticated) {
        return (
            <div className="page-container">
                <Header />
                <main className="wallet-container">
                    <div style={{ textAlign: 'center', padding: '40px 20px', color: theme.colors.primaryText }}>
                        <h2>Please log in to access the Profits Dashboard</h2>
                    </div>
                </main>
            </div>
        );
    }

    const totalIcpE8s = calculateTotalIcpE8s();
    const totalUsd = calculateTotalUsd();

    return (
        <div className="page-container">
            <Header />
            <main className="wallet-container">
                <div style={styles.container}>
                    <h1 style={styles.title}>
                        <FaChartLine />
                        Profits Dashboard
                    </h1>
                    <p style={styles.subtitle}>
                        Consolidated view of profits from all SneedDAO products
                    </p>

                    {/* ICP Price Indicator */}
                    <div style={styles.priceIndicator}>
                        <FaDollarSign style={{ color: theme.colors.accent }} />
                        <span style={styles.priceLabel}>ICP/USD Price:</span>
                        <span style={styles.priceValue}>
                            {loadingPrices ? 'Loading...' : icpUsdPrice ? formatUsd(icpUsdPrice) : 'Unavailable'}
                        </span>
                    </div>

                    {/* Refresh Button */}
                    <button 
                        onClick={fetchAllData}
                        disabled={loading}
                        style={styles.refreshButton}
                    >
                        <FaSync className={loading ? 'spin' : ''} />
                        {loading ? 'Refreshing...' : 'Refresh All Data'}
                    </button>

                    {/* Summary Card */}
                    <div style={styles.summaryCard}>
                        <h2 style={styles.summaryTitle}>
                            <FaCoins />
                            Total Profits Summary
                        </h2>
                        <div style={styles.summaryGrid}>
                            <div style={styles.summaryItem}>
                                <div style={styles.summaryLabel}>Total ICP Profit</div>
                                <div style={styles.summaryValue}>
                                    {formatIcp(totalIcpE8s)} ICP
                                </div>
                            </div>
                            <div style={styles.summaryItem}>
                                <div style={styles.summaryLabel}>Total USD Value</div>
                                <div style={{ ...styles.summaryValue, color: theme.colors.accent }}>
                                    {totalUsd !== null ? formatUsd(totalUsd) : '—'}
                                </div>
                                <div style={styles.summaryValueSecondary}>
                                    (includes non-ICP tokens)
                                </div>
                            </div>
                            <div style={styles.summaryItem}>
                                <div style={styles.summaryLabel}>ICP USD Equivalent</div>
                                <div style={styles.summaryValue}>
                                    {formatUsd(e8sToUsd(totalIcpE8s))}
                                </div>
                                <div style={styles.summaryValueSecondary}>
                                    (ICP only)
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Product Cards */}
                    <div style={styles.sectionGrid}>
                        {renderFactoryCard()}
                        {renderSneedexCard()}
                        {renderSneedLockCard()}
                        {renderPremiumCard()}
                        {renderJailbreakCard()}
                    </div>
                </div>
            </main>
        </div>
    );
}
