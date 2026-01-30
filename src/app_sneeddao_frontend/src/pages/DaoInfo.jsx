import React, { useState, useEffect } from 'react';
import { useAuth } from '../AuthContext';
import Header from '../components/Header';
import { useTheme } from '../contexts/ThemeContext';
import { Principal } from '@dfinity/principal';
import { HttpAgent } from '@dfinity/agent';
import { createActor as createBackendActor, canisterId as backendCanisterId } from 'declarations/app_sneeddao_backend';
import { createActor as createSnsGovernanceActor, canisterId as snsGovernanceCanisterId } from 'external/sns_governance';
import { createActor as createRllActor, canisterId as rllCanisterId } from 'external/rll';
import { createActor as createLedgerActor } from 'external/icrc1_ledger';
import { fetchAndCacheSnsData, getSnsById } from '../utils/SnsUtils';
import priceService from '../services/PriceService';
import { 
    calculateTotalAssetsValue,
    getTokenLogo 
} from '../utils/TokenUtils';
import { Link } from 'react-router-dom';
import { FaChartPie, FaBrain, FaCoins, FaHandshake, FaRocket, FaArrowRight, FaSpinner, FaLock, FaExchangeAlt } from 'react-icons/fa';

// Custom CSS for animations
const customStyles = `
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

@keyframes float {
    0%, 100% { transform: translateY(0px); }
    50% { transform: translateY(-8px); }
}

@keyframes spin {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
}

.dao-info-float {
    animation: float 3s ease-in-out infinite;
}

.dao-info-fade-in {
    animation: fadeInUp 0.5s ease-out forwards;
}

.dao-info-spin {
    animation: spin 1s linear infinite;
}

@media (max-width: 900px) {
    .sections-grid {
        grid-template-columns: 1fr !important;
    }
    .metrics-grid {
        grid-template-columns: 1fr !important;
    }
    .products-grid {
        grid-template-columns: 1fr !important;
    }
}
`;

// Page accent colors - green/teal theme for DAO
const daoPrimary = '#10b981';
const daoSecondary = '#34d399';

// Theme-aware styles function
const getStyles = (theme) => ({
    container: {
        maxWidth: '1200px',
        margin: '0 auto',
        padding: '1.5rem 1rem',
        color: theme.colors.primaryText,
    },
    sectionsGrid: {
        display: 'grid',
        gridTemplateColumns: '1fr 1fr',
        gap: '1rem',
    },
    section: {
        backgroundColor: theme.colors.cardGradient,
        border: `1px solid ${theme.colors.border}`,
        borderRadius: '20px',
        padding: '1.25rem',
        boxShadow: theme.colors.cardShadow,
    },
    sectionHeader: {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: '1rem',
        gap: '12px',
        flexWrap: 'wrap',
    },
    sectionTitleRow: {
        display: 'flex',
        alignItems: 'center',
        gap: '10px',
    },
    sectionIcon: {
        width: '38px',
        height: '38px',
        borderRadius: '10px',
        background: `linear-gradient(135deg, ${daoPrimary}20, ${daoPrimary}10)`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
    },
    subheading: {
        fontSize: '1.1rem',
        fontWeight: '700',
        color: theme.colors.primaryText,
        margin: 0,
    },
    grid: {
        display: 'grid',
        gridTemplateColumns: 'repeat(2, 1fr)',
        gap: '10px',
    },
    card: {
        backgroundColor: `${daoPrimary}08`,
        border: `1px solid ${daoPrimary}20`,
        borderRadius: '14px',
        padding: '1rem',
        display: 'flex',
        flexDirection: 'column',
    },
    cardContent: {
        flex: 1,
    },
    metric: {
        fontSize: '1.4rem',
        fontWeight: '700',
        marginBottom: '0.25rem',
        color: daoPrimary,
    },
    label: {
        color: theme.colors.mutedText,
        fontSize: '0.8rem',
        fontWeight: '500',
    },
    spinner: {
        width: '20px',
        height: '20px',
        border: `2px solid ${theme.colors.border}`,
        borderTop: `2px solid ${daoPrimary}`,
        borderRadius: '50%',
        animation: 'spin 1s linear infinite',
    },
    emptySection: {
        textAlign: 'center',
        padding: '1.5rem',
        color: theme.colors.mutedText,
        backgroundColor: `${daoPrimary}05`,
        border: `1px solid ${daoPrimary}15`,
        borderRadius: '12px',
    },
    drillDownLink: {
        color: daoPrimary,
        textDecoration: 'none',
        fontSize: '0.8rem',
        fontWeight: '600',
        display: 'inline-flex',
        alignItems: 'center',
        gap: '4px',
    },
    cardHeader: {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: '0.5rem',
    },
    dissolveStateValue: {
        fontSize: '0.6em',
        color: theme.colors.mutedText,
    },
    doubleWidthCard: {
        backgroundColor: `${daoPrimary}08`,
        border: `1px solid ${daoPrimary}20`,
        borderRadius: '14px',
        padding: '1rem',
        display: 'flex',
        flexDirection: 'column',
        gridColumn: 'span 2',
    },
    tokenRow: {
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: '4px 0',
        fontSize: '0.9rem',
    },
    productsGrid: {
        display: 'grid',
        gridTemplateColumns: 'repeat(2, 1fr)',
        gap: '10px',
    },
    productCard: {
        backgroundColor: `${daoPrimary}08`,
        border: `1px solid ${daoPrimary}20`,
        borderRadius: '14px',
        padding: '1.25rem',
        display: 'flex',
        flexDirection: 'column',
        gap: '0.75rem',
    },
    productIcon: {
        width: '40px',
        height: '40px',
        borderRadius: '10px',
        background: `linear-gradient(135deg, ${daoPrimary}, ${daoSecondary})`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
    },
    productTitle: {
        fontSize: '1.1rem',
        color: theme.colors.primaryText,
        fontWeight: '700',
    },
    productDescription: {
        color: theme.colors.secondaryText,
        fontSize: '0.85rem',
        lineHeight: '1.5',
        flex: 1,
    },
});

function DaoInfo() {
    const { identity } = useAuth();
    const { theme } = useTheme();
    const styles = getStyles(theme);
    const [loading, setLoading] = useState({
        metrics: true,
        tokenomics: true,
        reconciliation: true,
        events: true
    });
    const [error, setError] = useState({
        metrics: null,
        tokenomics: null,
        reconciliation: null,
        events: null
    });
    const [daoMetrics, setDaoMetrics] = useState({
        memberCount: 0,
        activeNeurons: 0,
        proposalCount: 0,
        neuronStats: {
            totalNeurons: 0n,
            activeNeurons: 0n,
            dissolveState: {
                not_dissolving: 0n,
                dissolving: 0n,
                dissolved: 0n,
            },
            votingPower: {
                total: 0n,
                min: 100n,
                max: 100n,
                avg: 100
            },
            permissions: {
                totalHotkeys: 0n,
                multiHotkeyNeurons: 0n
            },
            totalStaked: 0n,
            not_dissolving_stake: 0n,
            dissolving_stake: 0n,
            dissolved_stake: 0n
        }
    });
    const [tokenomics, setTokenomics] = useState({
        price: 0,
        priceIcp: 0,
        marketCap: 0,
        marketCapIcp: 0,
        totalSupply: 0,
        metadata: {
            name: '',
            symbol: '',
            decimals: 8,
            fee: 0,
            logo: ''
        },
        totalAssets: {
            totalUsd: 0,
            icp: 0,
            sneed: 0
        },
        totalRewardsDistributed: 0,
        latestDistribution: {
            round: 0,
            timestamp: 0
        },
        tokenDistributions: {}
    });
    const [conversionRates, setConversionRates] = useState({});
    const [eventStats, setEventStats] = useState(null);
    const [reconciliation, setReconciliation] = useState([]);
    const [partners, setPartners] = useState([]);

    console.log("tokenomics", tokenomics);
    console.log("daoMetrics", daoMetrics);
    
    // Fetch conversion rates using new PriceService
    useEffect(() => {
        const fetchConversionRates = async () => {
            try {
                // Fetch prices for commonly used tokens (ICP and SNEED)
                const [icpPrice, sneedPrice] = await Promise.all([
                    priceService.getTokenUSDPrice('ryjl3-tyaaa-aaaaa-aaaba-cai', 8).catch(() => 0),
                    priceService.getTokenUSDPrice('hvgxa-wqaaa-aaaaq-aacia-cai', 8).catch(() => 0)
                ]);
                
                setConversionRates({
                    'ICP': icpPrice,
                    'SNEED': sneedPrice
                });
            } catch (err) {
                console.error('Error fetching conversion rates:', err);
            }
        };

        fetchConversionRates();
        // Refresh rates every 5 minutes
        const interval = setInterval(fetchConversionRates, 5 * 60 * 1000);
        return () => clearInterval(interval);
    }, []);

    // Fetch partners
    useEffect(() => {
        const fetchPartners = async () => {
            try {
                const agent = new HttpAgent({
                    host: 'https://ic0.app'
                });
                await agent.fetchRootKey();

                const backendActor = createBackendActor(backendCanisterId, {
                    agentOptions: { agent }
                });

                const partnersData = await backendActor.get_partners();
                setPartners(partnersData);
            } catch (err) {
                console.error('Error fetching partners:', err);
            }
        };

        fetchPartners();
    }, []);

    const getUSDValue = (amount, decimals, symbol) => {
        return (amount / Math.pow(10, decimals)) * (conversionRates[symbol] || 0);
    };

    const fetchProposalCount = async () => {
        try {
            const response = await fetch('https://sns-api.internetcomputer.org/api/v2/snses/fp274-iaaaa-aaaaq-aacha-cai/proposals/count');
            if (!response.ok) {
                throw new Error('Failed to fetch proposal count');
            }
            const data = await response.json();
            return data.total;
        } catch (error) {
            console.error('Error fetching proposal count:', error);
            return null;
        }
    };

    // Fetch DAO data
    useEffect(() => {
        const fetchData = async () => {
            try {
                const agent = new HttpAgent({
                    host: 'https://ic0.app'
                });
                await agent.fetchRootKey();

                // Create actors
                const snsGovActor = createSnsGovernanceActor(snsGovernanceCanisterId, {
                    agentOptions: { agent }
                });
                const rllActor = createRllActor(rllCanisterId, {
                    agentOptions: { agent }
                });

                // Fetch metrics data
                setLoading(prev => ({ ...prev, metrics: true }));
                try {
                    const [listNeuronsResponse, proposalCount, neuronStats] = await Promise.all([
                        snsGovActor.list_neurons({
                            limit: 0,
                            start_page_at: [],
                            of_principal: []
                        }),
                        fetchProposalCount(),
                        rllActor.get_neuron_statistics()
                    ]);

                    // Count active neurons (not dissolved)
                    const activeNeurons = listNeuronsResponse.neurons.filter(neuron => {
                        if (!neuron.dissolve_state?.[0]) return false;
                        return 'DissolveDelaySeconds' in neuron.dissolve_state[0];
                    }).length;

                    setDaoMetrics({
                        memberCount: listNeuronsResponse.neurons.length,
                        activeNeurons: activeNeurons,
                        proposalCount: proposalCount || 0,
                        neuronStats: {
                            totalNeurons: neuronStats.total_neurons,
                            activeNeurons: neuronStats.active_neurons,
                            dissolveState: {
                                not_dissolving: neuronStats.dissolve_state.not_dissolving,
                                dissolving: neuronStats.dissolve_state.dissolving,
                                dissolved: neuronStats.dissolve_state.dissolved
                            },
                            votingPower: neuronStats.voting_power,
                            permissions: neuronStats.permissions,
                            totalStaked: neuronStats.total_stake,
                            not_dissolving_stake: neuronStats.dissolve_state.not_dissolving_stake,
                            dissolving_stake: neuronStats.dissolve_state.dissolving_stake,
                            dissolved_stake: neuronStats.dissolve_state.dissolved_stake
                        }
                    });
                } catch (err) {
                    console.error('Error fetching metrics:', err);
                    setError(prev => ({ ...prev, metrics: 'Failed to fetch metrics' }));
                } finally {
                    setLoading(prev => ({ ...prev, metrics: false }));
                }

                // Fetch tokenomics data
                setLoading(prev => ({ ...prev, tokenomics: true }));
                try {
                    const sneedLedgerActor = createLedgerActor('hvgxa-wqaaa-aaaaq-aacia-cai', {
                        agentOptions: { agent }
                    });

                    const backendActor = createBackendActor(backendCanisterId, {
                        agentOptions: { agent }
                    });

                    // Get whitelisted tokens first
                    const whitelistedTokens = await backendActor.get_whitelisted_tokens();
                    const tokenMetadata = {};

                    // Use metadata from whitelisted tokens
                    whitelistedTokens.forEach(token => {
                        tokenMetadata[token.ledger_id.toString()] = {
                            symbol: token.symbol,
                            decimals: token.decimals,
                            name: token.name || token.symbol
                        };
                    });

                    // Fetch all required data in parallel
                    const [
                        totalDistributions,
                        mainLoopStatus,
                        eventStats,
                        totalSupply,
                        knownTokens
                    ] = await Promise.all([
                        rllActor.get_total_distributions(),
                        rllActor.get_main_loop_status(),
                        rllActor.get_event_statistics(),
                        sneedLedgerActor.icrc1_total_supply(),
                        rllActor.get_known_tokens()
                    ]);

                    // Get balances for each token
                    const balances = await Promise.all(knownTokens.map(async ([tokenId]) => {
                        const ledgerActor = createLedgerActor(tokenId.toString(), {
                            agentOptions: { agent }
                        });

                        const balance = await ledgerActor.icrc1_balance_of({
                            owner: Principal.fromText(rllCanisterId),
                            subaccount: []
                        });
                        return [tokenId, balance];
                    }));

                    // Get reconciliation data using the balances
                    const reconciliationData = await rllActor.balance_reconciliation_from_balances(balances);

                    // Get DeFi wallet tokens and balances
                    const defiKnownTokens = await rllActor.get_wallet_known_tokens(Principal.fromText("ok64y-uiaaa-aaaag-qdcbq-cai"));
                    const defiTokenBalances = await Promise.all(defiKnownTokens.map(async ([tokenId]) => {
                        const ledgerActor = createLedgerActor(tokenId.toString(), {
                            agentOptions: { agent }
                        });
                        const balance = await ledgerActor.icrc1_balance_of({
                            owner: Principal.fromText("ok64y-uiaaa-aaaag-qdcbq-cai"),
                            subaccount: []
                        });
                        return [tokenId.toString(), balance];
                    }));

                    // Process total distributions with metadata
                    let tokenDistributions = {};
                    let totalUsdValue = 0;
                    totalDistributions.forEach(([tokenId, amount]) => {
                        const tokenIdStr = tokenId.toString();
                        tokenDistributions[tokenIdStr] = {
                            amount: amount,
                            metadata: tokenMetadata[tokenIdStr]
                        };
                        const symbol = tokenMetadata[tokenIdStr]?.symbol || tokenIdStr;
                        const decimals = tokenMetadata[tokenIdStr]?.decimals || 8;
                        totalUsdValue += getUSDValue(Number(amount), decimals, symbol);
                    });

                    // Calculate prices and market cap
                    const sneedPriceUsd = conversionRates['SNEED'] || 0;
                    const icpPriceUsd = conversionRates['ICP'] || 0;
                    const sneedPriceIcp = icpPriceUsd > 0 ? sneedPriceUsd / icpPriceUsd : 0;
                    const totalSupplyNum = Number(totalSupply) / 1e8;
                    const marketCapUsd = sneedPriceUsd * totalSupplyNum;
                    const marketCapIcp = sneedPriceIcp * totalSupplyNum;

                    // Calculate total assets using the utility function
                    const assetsData = calculateTotalAssetsValue(
                        reconciliationData.map(item => ({
                            ...item,
                            server_balance: Number(item.server_balance),
                            local_total: Number(item.local_total),
                            remaining: Number(item.remaining),
                            underflow: Number(item.underflow),
                            total_distributed: Number(item.total_distributed || 0)
                        })),
                        [], // No LP positions
                        [], // No other LP positions
                        conversionRates
                    );

                    // Fetch token metadata
                    const [metadata, symbol, decimals, fee] = await Promise.all([
                        sneedLedgerActor.icrc1_metadata(),
                        sneedLedgerActor.icrc1_symbol(),
                        sneedLedgerActor.icrc1_decimals(),
                        sneedLedgerActor.icrc1_fee()
                    ]);

                    console.log("metadata", metadata, symbol, decimals, fee);
                    // Get token name and logo from metadata
                    const name = metadata.find(([key]) => key === 'icrc1:name')?.[1]?.Text || symbol;
                    const logo = metadata.find(([key]) => key === 'icrc1:logo')?.[1]?.Text || 'icp_symbol.svg';

                    setEventStats(eventStats);
                    setTokenomics(prev => ({
                        ...prev,
                        price: sneedPriceUsd,
                        priceIcp: sneedPriceIcp,
                        marketCap: marketCapUsd,
                        marketCapIcp: marketCapIcp,
                        totalSupply: totalSupplyNum,
                        metadata: {
                            name,
                            symbol,
                            decimals,
                            fee,
                            logo
                        },
                        totalAssets: {
                            icp: assetsData.totalIcp,
                            sneed: assetsData.totalSneed,
                            icpUsdValue: assetsData.icpUsdValue,
                            sneedUsdValue: assetsData.sneedUsdValue,
                            otherTokensUsd: assetsData.otherTokensUsdValue,
                            otherPositionsUsd: assetsData.otherPositionsUsdValue,
                            totalUsd: assetsData.totalUsdValue
                        },
                        tokenDistributions,
                        totalDistributionsUsd: totalUsdValue,
                        latestDistribution: {
                            round: eventStats?.all_time?.server_distributions?.total || 0,
                            timestamp: Number(mainLoopStatus.last_cycle_ended || 0)
                        }
                    }));
                } catch (err) {
                    console.error('Error fetching tokenomics:', err);
                    setError(prev => ({ ...prev, tokenomics: 'Failed to fetch tokenomics' }));
                } finally {
                    setLoading(prev => ({ ...prev, tokenomics: false }));
                }

                // Fetch reconciliation data
                setLoading(prev => ({ ...prev, reconciliation: true }));
                try {
                    const reconciliationData = await rllActor.balance_reconciliation();
                    setReconciliation(reconciliationData);

                    // Calculate total assets from reconciliation data
                    let totalIcpUsd = 0;
                    let totalSneedUsd = 0;
                    let icpBalance = 0n;
                    let sneedBalance = 0n;

                    reconciliationData.forEach(item => {
                        const tokenIdStr = item.token_id.toString();
                        if (tokenIdStr === 'ryjl3-tyaaa-aaaaa-aaaba-cai') { // ICP
                            icpBalance = item.server_balance;
                            totalIcpUsd = getUSDValue(Number(item.server_balance), 8, 'ICP');
                        } else if (tokenIdStr === 'hvgxa-wqaaa-aaaaq-aacia-cai') { // SNEED
                            sneedBalance = item.server_balance;
                            totalSneedUsd = getUSDValue(Number(item.server_balance), 8, 'SNEED');
                        }
                    });

                    setTokenomics(prev => ({
                        ...prev,
                        totalAssets: {
                            totalUsd: totalIcpUsd + totalSneedUsd,
                            icp: Number(icpBalance),
                            sneed: Number(sneedBalance)
                        }
                    }));
                } catch (err) {
                    console.error('Error fetching reconciliation:', err);
                    setError(prev => ({ ...prev, reconciliation: 'Failed to fetch reconciliation' }));
                } finally {
                    setLoading(prev => ({ ...prev, reconciliation: false }));
                }

            } catch (err) {
                console.error('Error in fetchData:', err);
                setError({
                    metrics: 'Failed to fetch data',
                    tokenomics: 'Failed to fetch data',
                    reconciliation: 'Failed to fetch data',
                    events: 'Failed to fetch data'
                });
            } finally {
                setLoading(prev => ({
                    metrics: false,
                    tokenomics: false,
                    reconciliation: false,
                    events: false
                }));
            }
        };

        fetchData();
        // Refresh data every minute
        const interval = setInterval(fetchData, 60000);
        return () => clearInterval(interval);
    }, [conversionRates]);

    const formatNumber = (number) => {
        return new Intl.NumberFormat('en-US').format(number);
    };

    const formatUSD = (value) => {
        return new Intl.NumberFormat('en-US', {
            style: 'currency',
            currency: 'USD',
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
        }).format(value);
    };

    return (
        <div className='page-container' style={{ background: theme.colors.primaryGradient, minHeight: '100vh' }}>
            <style>{customStyles}</style>
            <Header />
            
            {/* Hero Banner */}
            <div style={{
                background: `linear-gradient(135deg, ${theme.colors.primaryBg} 0%, ${daoPrimary}12 50%, ${daoSecondary}08 100%)`,
                borderBottom: `1px solid ${theme.colors.border}`,
                padding: '2rem 1rem',
                position: 'relative',
                overflow: 'hidden'
            }}>
                {/* Background decorations */}
                <div style={{
                    position: 'absolute',
                    top: '-30%',
                    right: '-5%',
                    width: '300px',
                    height: '300px',
                    background: `radial-gradient(circle, ${daoPrimary}15 0%, transparent 70%)`,
                    pointerEvents: 'none'
                }} />
                
                <div className="dao-info-fade-in" style={{ maxWidth: '1200px', margin: '0 auto', textAlign: 'center', position: 'relative', zIndex: 1 }}>
                    <div className="dao-info-float" style={{
                        width: '72px',
                        height: '72px',
                        borderRadius: '18px',
                        background: `linear-gradient(135deg, ${daoPrimary}, ${daoSecondary})`,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        margin: '0 auto 1rem',
                        boxShadow: `0 12px 40px ${daoPrimary}50`,
                    }}>
                        <FaChartPie size={32} style={{ color: '#fff' }} />
                    </div>
                    
                    <h1 style={{
                        fontSize: '1.75rem',
                        fontWeight: '700',
                        color: theme.colors.primaryText,
                        margin: '0 0 0.5rem',
                        letterSpacing: '-0.5px'
                    }}>
                        DAO Dashboard
                    </h1>
                    <p style={{
                        fontSize: '0.95rem',
                        color: theme.colors.secondaryText,
                        margin: 0
                    }}>
                        Real-time metrics and insights for Sneed DAO
                    </p>
                </div>
            </div>
            
            <main style={styles.container}>
                <div className="sections-grid" style={styles.sectionsGrid}>
                    {/* DAO Metrics Section */}
                    <section className="dao-info-fade-in" style={styles.section}>
                        <div style={styles.sectionHeader}>
                            <div style={styles.sectionTitleRow}>
                                <div style={styles.sectionIcon}>
                                    <FaBrain size={18} style={{ color: daoPrimary }} />
                                </div>
                                <h2 style={styles.subheading}>DAO Metrics</h2>
                            </div>
                            <Link to="/neurons" style={styles.drillDownLink}>
                                Drill down <FaArrowRight size={10} />
                            </Link>
                        </div>
                        {loading.metrics ? (
                            <div style={{ display: 'flex', justifyContent: 'center', padding: '20px' }}>
                                <FaSpinner className="dao-info-spin" size={24} style={{ color: daoPrimary }} />
                            </div>
                        ) : error.metrics ? (
                            <div style={{ color: theme.colors.error, padding: '20px', textAlign: 'center', fontSize: '0.9rem' }}>
                                {error.metrics}
                            </div>
                        ) : (
                            <div className="metrics-grid" style={styles.grid}>
                                <div style={styles.card}>
                                    <div style={styles.metric}>{formatNumber(Number(daoMetrics.neuronStats.totalNeurons))}</div>
                                    <div style={styles.label}>Total Neurons</div>
                                </div>
                                <div style={styles.card}>
                                    <div style={styles.metric}>{formatNumber(Number(daoMetrics.neuronStats.activeNeurons))}</div>
                                    <div style={styles.label}>Active Neurons</div>
                                </div>
                                <div style={styles.card}>
                                    <div style={styles.metric}>
                                        {formatNumber(Number(daoMetrics.neuronStats.dissolveState.not_dissolving))}
                                        <div style={styles.dissolveStateValue}>
                                            Not Dissolving
                                        </div>
                                        <div style={styles.dissolveStateValue}>
                                            {formatNumber(Number(daoMetrics.neuronStats.not_dissolving_stake) / 1e8)} SNEED
                                        </div>
                                    </div>
                                    <div style={styles.label}>Dissolve State</div>
                                </div>
                                <div style={styles.card}>
                                    <div style={styles.metric}>
                                        {formatNumber(Number(daoMetrics.neuronStats.dissolveState.dissolving))}
                                        <div style={styles.dissolveStateValue}>
                                            Dissolving
                                        </div>
                                        <div style={styles.dissolveStateValue}>
                                            {formatNumber(Number(daoMetrics.neuronStats.dissolving_stake) / 1e8)} SNEED
                                        </div>
                                    </div>
                                    <div style={styles.label}>Dissolve State</div>
                                </div>
                                <div style={styles.card}>
                                    <div style={styles.metric}>
                                        {formatNumber(Number(daoMetrics.neuronStats.dissolveState.dissolved))}
                                        <div style={styles.dissolveStateValue}>
                                            Dissolved
                                        </div>
                                        <div style={styles.dissolveStateValue}>
                                            {formatNumber(Number(daoMetrics.neuronStats.dissolved_stake) / 1e8)} SNEED
                                        </div>
                                    </div>
                                    <div style={styles.label}>Dissolve State</div>
                                </div>
                                <div style={styles.card}>
                                    <div style={styles.metric}>
                                        {formatNumber(Number(daoMetrics.neuronStats.votingPower.total))}
                                        <div style={{ fontSize: '0.6em', color: theme.colors.mutedText }}>
                                            Min: {formatNumber(Number(daoMetrics.neuronStats.votingPower.min))}
                                            {' | '}
                                            Max: {formatNumber(Number(daoMetrics.neuronStats.votingPower.max))}
                                        </div>
                                    </div>
                                    <div style={styles.label}>Total Voting Power</div>
                                </div>
                                <div style={styles.card}>
                                    <div style={styles.metric}>
                                        {formatNumber(Number(daoMetrics.neuronStats.permissions.total_hotkeys))}
                                        <div style={{ fontSize: '0.6em', color: theme.colors.mutedText }}>
                                            Multi-hotkey: {formatNumber(Number(daoMetrics.neuronStats.permissions.multi_hotkey_neurons))}
                                        </div>
                                    </div>
                                    <div style={styles.label}>Hotkeys</div>
                                </div>
                                <div style={styles.card}>
                                    <div style={styles.cardContent}>
                                        <div style={styles.metric}>{formatNumber(daoMetrics.proposalCount)}</div>
                                        <div style={styles.label}>Total Proposals</div>
                                    </div>
                                    <Link to="/proposals" style={{ ...styles.drillDownLink, marginTop: '8px' }}>
                                        View proposals <FaArrowRight size={10} />
                                    </Link>
                                </div>
                            </div>
                        )}
                    </section>

                    {/* Tokenomics Section */}
                    <section className="dao-info-fade-in" style={styles.section}>
                        <div style={styles.sectionHeader}>
                            <div style={styles.sectionTitleRow}>
                                <div style={styles.sectionIcon}>
                                    <FaCoins size={18} style={{ color: daoPrimary }} />
                                </div>
                                <h2 style={styles.subheading}>Tokenomics</h2>
                            </div>
                            <Link to="/rll_info" style={styles.drillDownLink}>
                                Drill down <FaArrowRight size={10} />
                            </Link>
                        </div>
                        {loading.tokenomics ? (
                            <div style={{ display: 'flex', justifyContent: 'center', padding: '20px' }}>
                                <FaSpinner className="dao-info-spin" size={24} style={{ color: daoPrimary }} />
                            </div>
                        ) : error.tokenomics ? (
                            <div style={{ color: theme.colors.error, padding: '20px', textAlign: 'center', fontSize: '0.9rem' }}>
                                {error.tokenomics}
                            </div>
                        ) : (
                            <>
                                {/* Token Metadata Card */}
                                <div style={{
                                    backgroundColor: `${daoPrimary}08`,
                                    border: `1px solid ${daoPrimary}20`,
                                    borderRadius: '14px',
                                    padding: '1rem',
                                    marginBottom: '10px',
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '14px',
                                    flexWrap: 'wrap'
                                }}>
                                    <img 
                                        src={tokenomics.metadata.logo} 
                                        alt={tokenomics.metadata.symbol}
                                        style={{
                                            width: '56px',
                                            height: '56px',
                                            borderRadius: '50%',
                                            border: `2px solid ${daoPrimary}30`
                                        }}
                                    />
                                    <div style={{ flex: '1 1 200px', minWidth: '150px' }}>
                                        <h3 style={{ 
                                            margin: '0 0 6px 0',
                                            color: theme.colors.primaryText,
                                            fontSize: '1.2rem',
                                            fontWeight: '700'
                                        }}>
                                            {tokenomics.metadata.name}
                                        </h3>
                                        <div style={{
                                            display: 'flex',
                                            gap: '12px',
                                            flexWrap: 'wrap',
                                            color: theme.colors.mutedText,
                                            fontSize: '0.8rem'
                                        }}>
                                            <span><strong>Symbol:</strong> {tokenomics.metadata.symbol}</span>
                                            <span><strong>Decimals:</strong> {tokenomics.metadata.decimals}</span>
                                            <span><strong>Fee:</strong> {(Number(tokenomics.metadata.fee) / Math.pow(10, tokenomics.metadata.decimals))} {tokenomics.metadata.symbol}</span>
                                        </div>
                                    </div>
                                </div>

                                {/* Existing Tokenomics Grid */}
                                <div className="metrics-grid" style={styles.grid}>
                                    <div style={styles.card}>
                                        <div style={styles.metric}>
                                            {formatUSD(tokenomics.price)}
                                            <div style={{ fontSize: '0.6em', color: theme.colors.mutedText }}>
                                                {formatNumber(tokenomics.priceIcp)} ICP
                                            </div>
                                        </div>
                                        <div style={styles.label}>SNEED Price</div>
                                    </div>
                                    <div style={styles.card}>
                                        <div style={styles.metric}>
                                            {formatUSD(tokenomics.marketCap)}
                                            <div style={{ fontSize: '0.6em', color: theme.colors.mutedText }}>
                                                {formatNumber(tokenomics.marketCapIcp)} ICP
                                            </div>
                                        </div>
                                        <div style={styles.label}>FDV</div>
                                    </div>
                                    <div style={styles.card}>
                                        <div style={styles.metric}>{formatNumber(tokenomics.totalSupply)} SNEED</div>
                                        <div style={styles.label}>Total Supply</div>
                                    </div>
                                    <div style={styles.card}>
                                        <div style={styles.metric}>
                                            {formatNumber(Number(daoMetrics.neuronStats.totalStaked) / 1e8)} SNEED
                                            <div style={{ fontSize: '0.6em', color: theme.colors.mutedText }}>
                                                {((Number(daoMetrics.neuronStats.totalStaked) / (Number(tokenomics.totalSupply) * 1e8)) * 100).toFixed(2)}% of supply
                                            </div>
                                        </div>
                                        <div style={styles.label}>Total Staked</div>
                                    </div>
                                    <div style={styles.doubleWidthCard}>
                                        <div style={styles.cardContent}>
                                            <div style={{ ...styles.metric, fontSize: '1.1rem' }}>
                                                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                                    {Object.entries(tokenomics.tokenDistributions || {}).map(([tokenId, data]) => {
                                                        const { amount, metadata } = data;
                                                        const symbol = metadata?.symbol || tokenId;
                                                        const decimals = metadata?.decimals || 8;
                                                        const tokenAmount = formatNumber(Number(amount) / Math.pow(10, decimals));
                                                        const usdValue = getUSDValue(Number(amount), decimals, symbol);
                                                        
                                                        return (
                                                            <div key={tokenId} style={styles.tokenRow}>
                                                                <div style={{ color: theme.colors.primaryText }}>{tokenAmount} {symbol}</div>
                                                                <div style={{ color: theme.colors.mutedText }}>
                                                                    {formatUSD(usdValue)}
                                                                </div>
                                                            </div>
                                                        );
                                                    })}
                                                    <div style={{ 
                                                        borderTop: `1px solid ${daoPrimary}30`,
                                                        paddingTop: '8px',
                                                        marginTop: '4px',
                                                        display: 'flex',
                                                        justifyContent: 'space-between',
                                                        alignItems: 'center',
                                                        color: daoPrimary,
                                                        fontWeight: '700'
                                                    }}>
                                                        <div>Total</div>
                                                        <div>{formatUSD(tokenomics.totalDistributionsUsd)}</div>
                                                    </div>
                                                </div>
                                            </div>
                                            <div style={styles.label}>Total Rewards Distributed</div>
                                        </div>
                                        <Link to="/rll" style={{ ...styles.drillDownLink, marginTop: '8px' }}>
                                            View rewards <FaArrowRight size={10} />
                                        </Link>
                                    </div>
                                </div>
                            </>
                        )}
                    </section>

                    {/* Partners Section */}
                    <section className="dao-info-fade-in" style={styles.section}>
                        <div style={styles.sectionHeader}>
                            <div style={styles.sectionTitleRow}>
                                <div style={styles.sectionIcon}>
                                    <FaHandshake size={18} style={{ color: daoPrimary }} />
                                </div>
                                <h2 style={styles.subheading}>Partners</h2>
                            </div>
                            <Link to="/partners" style={styles.drillDownLink}>
                                View all <FaArrowRight size={10} />
                            </Link>
                        </div>
                        {partners.length === 0 ? (
                            <div style={styles.emptySection}>
                                No partners yet
                            </div>
                        ) : (
                            <div style={{
                                display: 'grid',
                                gridTemplateColumns: 'repeat(auto-fill, minmax(70px, 1fr))',
                                gap: '10px',
                            }}>
                                {partners.map((partner) => {
                                    const handleClick = () => {
                                        if (partner.links && partner.links.length > 0) {
                                            window.open(partner.links[0].url, '_blank', 'noopener,noreferrer');
                                        } else {
                                            window.location.href = '/partners';
                                        }
                                    };

                                    return (
                                        <div
                                            key={partner.id}
                                            onClick={handleClick}
                                            title={`${partner.name}\n\n${partner.description}`}
                                            style={{
                                                cursor: 'pointer',
                                                display: 'flex',
                                                flexDirection: 'column',
                                                alignItems: 'center',
                                                padding: '10px',
                                                borderRadius: '12px',
                                                backgroundColor: `${daoPrimary}08`,
                                                border: `1px solid ${daoPrimary}20`,
                                                transition: 'all 0.2s ease'
                                            }}
                                            onMouseEnter={(e) => {
                                                e.currentTarget.style.backgroundColor = `${daoPrimary}15`;
                                                e.currentTarget.style.transform = 'translateY(-2px)';
                                            }}
                                            onMouseLeave={(e) => {
                                                e.currentTarget.style.backgroundColor = `${daoPrimary}08`;
                                                e.currentTarget.style.transform = 'translateY(0px)';
                                            }}
                                        >
                                            <img
                                                src={partner.logo_url}
                                                alt={partner.name}
                                                style={{
                                                    width: '48px',
                                                    height: '48px',
                                                    borderRadius: '50%',
                                                    objectFit: 'cover',
                                                    border: `2px solid ${daoPrimary}30`
                                                }}
                                                onError={(e) => {
                                                    e.target.style.display = 'none';
                                                    e.target.nextSibling.style.display = 'flex';
                                                }}
                                            />
                                            <div
                                                style={{
                                                    width: '48px',
                                                    height: '48px',
                                                    borderRadius: '50%',
                                                    backgroundColor: `${daoPrimary}20`,
                                                    display: 'none',
                                                    alignItems: 'center',
                                                    justifyContent: 'center',
                                                    fontSize: '18px',
                                                    color: daoPrimary,
                                                    fontWeight: '600'
                                                }}
                                            >
                                                {partner.name.charAt(0).toUpperCase()}
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </section>

                    {/* Products Section */}
                    <section className="dao-info-fade-in" style={styles.section}>
                        <div style={styles.sectionHeader}>
                            <div style={styles.sectionTitleRow}>
                                <div style={styles.sectionIcon}>
                                    <FaRocket size={18} style={{ color: daoPrimary }} />
                                </div>
                                <h2 style={styles.subheading}>Products</h2>
                            </div>
                            <Link to="/products" style={styles.drillDownLink}>
                                View all <FaArrowRight size={10} />
                            </Link>
                        </div>
                        <div className="products-grid" style={styles.productsGrid}>
                            <div style={styles.productCard}>
                                <div style={styles.productIcon}>
                                    <FaLock size={18} style={{ color: '#fff' }} />
                                </div>
                                <div style={styles.productTitle}>SneedLock</div>
                                <div style={styles.productDescription}>
                                    A secure and flexible token locking solution built on the Internet Computer.
                                    Create customizable token locks with various vesting schedules.
                                </div>
                                <Link to="/sneedlock" style={styles.drillDownLink}>
                                    Learn more <FaArrowRight size={10} />
                                </Link>
                            </div>
                            <div style={styles.productCard}>
                                <div style={styles.productIcon}>
                                    <FaExchangeAlt size={18} style={{ color: '#fff' }} />
                                </div>
                                <div style={styles.productTitle}>SwapRunner</div>
                                <div style={styles.productDescription}>
                                    A high-performance DEX aggregator built for speed and efficiency.
                                    Experience lightning-fast token swaps with minimal slippage.
                                </div>
                                <a 
                                    href="https://swaprunner.com" 
                                    target="_blank" 
                                    rel="noopener noreferrer" 
                                    style={styles.drillDownLink}
                                >
                                    Visit site <FaArrowRight size={10} />
                                </a>
                            </div>
                        </div>
                    </section>
                </div>
            </main>
        </div>
    );
}

export default DaoInfo; 