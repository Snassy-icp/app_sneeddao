import React, { useState, useEffect } from 'react';
import { useAuth } from '../AuthContext';
import Header from '../components/Header';
import { Principal } from '@dfinity/principal';
import { createActor as createSnsGovernanceActor } from 'external/sns_governance';
import { createActor as createRllActor, canisterId as rllCanisterId } from 'external/rll';
import { createActor as createNeutriniteDappActor } from 'external/neutrinite_dapp';
import { fetchAndCacheSnsData, getSnsById } from '../utils/SnsUtils';

const styles = {
    container: {
        maxWidth: '1800px',
        margin: '0 auto',
        padding: '2rem',
        color: '#ffffff',
    },
    heading: {
        fontSize: '2rem',
        marginBottom: '2rem',
        color: '#ffffff',
    },
    sectionsGrid: {
        display: 'grid',
        gridTemplateColumns: '1fr 1fr 1fr 1fr',
        gap: '2rem',
        '@media (max-width: 1600px)': {
            gridTemplateColumns: '1fr 1fr',
        },
        '@media (max-width: 900px)': {
            gridTemplateColumns: '1fr',
        },
    },
    section: {
        backgroundColor: '#2a2a2a',
        borderRadius: '8px',
        padding: '1.5rem',
        minWidth: '300px',
    },
    subheading: {
        fontSize: '1.5rem',
        marginBottom: '1.5rem',
        color: '#ffffff',
    },
    grid: {
        display: 'grid',
        gridTemplateColumns: '1fr',
        gap: '1rem',
    },
    card: {
        backgroundColor: '#3a3a3a',
        borderRadius: '8px',
        padding: '1.5rem',
    },
    metric: {
        fontSize: '1.8rem',
        fontWeight: 'bold',
        marginBottom: '0.5rem',
        color: '#3498db',
    },
    label: {
        color: '#888',
        fontSize: '1rem',
    },
    spinner: {
        width: '20px',
        height: '20px',
        border: '2px solid #f3f3f3',
        borderTop: '2px solid #3498db',
        borderRadius: '50%',
        animation: 'spin 1s linear infinite',
    },
    emptySection: {
        textAlign: 'center',
        padding: '2rem',
        color: '#888',
        backgroundColor: '#3a3a3a',
        borderRadius: '8px',
    },
};

// Add media query styles
const mediaStyles = `
    @media (max-width: 1600px) {
        .sections-grid {
            grid-template-columns: 1fr 1fr !important;
        }
    }
    @media (max-width: 900px) {
        .sections-grid {
            grid-template-columns: 1fr !important;
        }
    }
`;

// Add keyframes for spinner
const spinKeyframes = `
@keyframes spin {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
}`;

function DaoInfo() {
    const { identity } = useAuth();
    const [loading, setLoading] = useState(true);
    const [daoMetrics, setDaoMetrics] = useState({
        memberCount: 0,
        activeNeurons: 0,
        proposalCount: 0,
    });
    const [tokenomics, setTokenomics] = useState({
        price: 0,
        marketCap: 0,
        totalAssets: {
            icp: 0,
            sneed: 0,
            others: 0,
            totalUsd: 0,
        },
        totalRewardsDistributed: 0,
        latestDistribution: {
            round: 0,
            amount: 0,
            timestamp: null,
        },
    });
    const [conversionRates, setConversionRates] = useState({
        ICP: 0,
        SNEED: 0
    });

    // Fetch conversion rates from Neutrinite
    useEffect(() => {
        const fetchConversionRates = async () => {
            try {
                const neutriniteActor = createNeutriniteDappActor(Principal.fromText("u45jl-liaaa-aaaam-abppa-cai"));
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
            } catch (error) {
                console.error('Error fetching conversion rates:', error);
            }
        };

        fetchConversionRates();
    }, []);

    // Helper function to calculate USD value
    const getUSDValue = (amount, decimals, symbol) => {
        const value = Number(amount) / Math.pow(10, decimals);
        return value * (conversionRates[symbol] || 0);
    };

    useEffect(() => {
        const fetchData = async () => {
            setLoading(true);
            try {
                // Fetch SNS data for Sneed
                const snsData = await fetchAndCacheSnsData(identity);
                const sneedSns = snsData.find(sns => sns.rootCanisterId === 'fp274-iaaaa-aaaaq-aacha-cai');
                
                if (sneedSns) {
                    // Create actors
                    const snsGovActor = createSnsGovernanceActor(sneedSns.canisters.governance, {
                        agentOptions: { identity },
                    });
                    const rllActor = createRllActor(rllCanisterId, {
                        agentOptions: { identity },
                    });

                    // Fetch DAO metrics
                    const [listNeuronsResponse, listProposalsResponse] = await Promise.all([
                        snsGovActor.list_neurons({ limit: 0 }),
                        snsGovActor.list_proposals({
                            limit: 0,
                            before_proposal: [],
                            include_reward_status: [],
                            exclude_type: [],
                            include_status: [],
                            include_topics: [],
                        }),
                    ]);

                    // Get active neurons (those that have voted in the last month)
                    const activeNeuronCount = await rllActor.get_active_neuron_count();

                    setDaoMetrics({
                        memberCount: listNeuronsResponse.neurons.length,
                        activeNeurons: Number(activeNeuronCount),
                        proposalCount: listProposalsResponse.proposals.length,
                    });

                    // Fetch tokenomics data
                    const [
                        distributionStats,
                        latestDistribution,
                        treasuryBalances,
                    ] = await Promise.all([
                        rllActor.get_distribution_stats(),
                        rllActor.get_latest_distribution(),
                        rllActor.get_treasury_balances(),
                    ]);

                    // Calculate total assets
                    let totalIcp = 0;
                    let totalSneed = 0;
                    let totalOthers = 0;
                    let totalUsd = 0;

                    treasuryBalances.forEach(([token, balance]) => {
                        const amount = Number(balance);
                        if (token.toString() === 'ryjl3-tyaaa-aaaaa-aaaba-cai') {
                            totalIcp = amount;
                            totalUsd += getUSDValue(amount, 8, 'ICP');
                        } else if (token.toString() === 'zfcdd-tqaaa-aaaaq-aaaga-cai') {
                            totalSneed = amount;
                            totalUsd += getUSDValue(amount, 8, 'SNEED');
                        } else {
                            totalOthers += amount;
                            // Note: Other tokens' USD value would need their own conversion rates
                        }
                    });

                    // Set tokenomics data
                    setTokenomics({
                        price: conversionRates.SNEED || 0,
                        marketCap: (conversionRates.SNEED || 0) * 100000000, // Assuming total supply of 100M SNEED
                        totalAssets: {
                            icp: totalIcp / Math.pow(10, 8),
                            sneed: totalSneed / Math.pow(10, 8),
                            others: totalOthers / Math.pow(10, 8),
                            totalUsd,
                        },
                        totalRewardsDistributed: Number(distributionStats.total_rewards_e8s) / Math.pow(10, 8),
                        latestDistribution: {
                            round: Number(latestDistribution.round_number),
                            amount: Number(latestDistribution.total_e8s) / Math.pow(10, 8),
                            timestamp: Number(latestDistribution.timestamp_seconds),
                        },
                    });
                }
            } catch (error) {
                console.error('Error fetching DAO data:', error);
            } finally {
                setLoading(false);
            }
        };

        fetchData();
    }, [identity, conversionRates]);

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
        <div className='page-container'>
            <Header />
            <main style={styles.container}>
                <h1 style={styles.heading}>DAO Dashboard</h1>

                {loading ? (
                    <div style={{ textAlign: 'center', padding: '2rem' }}>
                        <div style={styles.spinner} />
                    </div>
                ) : (
                    <div className="sections-grid" style={styles.sectionsGrid}>
                        {/* DAO Metrics Section */}
                        <section style={styles.section}>
                            <h2 style={styles.subheading}>DAO Metrics</h2>
                            <div style={styles.grid}>
                                <div style={styles.card}>
                                    <div style={styles.metric}>{formatNumber(daoMetrics.memberCount)}</div>
                                    <div style={styles.label}>Total Members</div>
                                </div>
                                <div style={styles.card}>
                                    <div style={styles.metric}>{formatNumber(daoMetrics.activeNeurons)}</div>
                                    <div style={styles.label}>Active Neurons</div>
                                </div>
                                <div style={styles.card}>
                                    <div style={styles.metric}>{formatNumber(daoMetrics.proposalCount)}</div>
                                    <div style={styles.label}>Total Proposals</div>
                                </div>
                            </div>
                        </section>

                        {/* Tokenomics Section */}
                        <section style={styles.section}>
                            <h2 style={styles.subheading}>Tokenomics</h2>
                            <div style={styles.grid}>
                                <div style={styles.card}>
                                    <div style={styles.metric}>{formatUSD(tokenomics.price)}</div>
                                    <div style={styles.label}>SNEED Price</div>
                                </div>
                                <div style={styles.card}>
                                    <div style={styles.metric}>{formatUSD(tokenomics.marketCap)}</div>
                                    <div style={styles.label}>Market Cap</div>
                                </div>
                                <div style={styles.card}>
                                    <div style={styles.metric}>{formatUSD(tokenomics.totalAssets.totalUsd)}</div>
                                    <div style={styles.label}>Total Assets (USD)</div>
                                </div>
                                <div style={styles.card}>
                                    <div style={styles.metric}>{formatNumber(tokenomics.totalAssets.icp)} ICP</div>
                                    <div style={styles.label}>ICP Holdings (${formatUSD(getUSDValue(tokenomics.totalAssets.icp * Math.pow(10, 8), 8, 'ICP'))})</div>
                                </div>
                                <div style={styles.card}>
                                    <div style={styles.metric}>{formatNumber(tokenomics.totalAssets.sneed)} SNEED</div>
                                    <div style={styles.label}>SNEED Holdings (${formatUSD(getUSDValue(tokenomics.totalAssets.sneed * Math.pow(10, 8), 8, 'SNEED'))})</div>
                                </div>
                                <div style={styles.card}>
                                    <div style={styles.metric}>{formatNumber(tokenomics.totalRewardsDistributed)}</div>
                                    <div style={styles.label}>Total Rewards Distributed</div>
                                </div>
                                <div style={styles.card}>
                                    <div style={styles.metric}>Round #{tokenomics.latestDistribution.round}</div>
                                    <div style={styles.label}>Latest Distribution</div>
                                    <div style={styles.label}>
                                        {tokenomics.latestDistribution.timestamp 
                                            ? new Date(tokenomics.latestDistribution.timestamp * 1000).toLocaleDateString()
                                            : 'N/A'
                                        }
                                    </div>
                                </div>
                            </div>
                        </section>

                        {/* Partners Section */}
                        <section style={styles.section}>
                            <h2 style={styles.subheading}>Partners</h2>
                            <div style={styles.emptySection}>
                                Coming Soon
                            </div>
                        </section>

                        {/* Products Section */}
                        <section style={styles.section}>
                            <h2 style={styles.subheading}>Products</h2>
                            <div style={styles.emptySection}>
                                Coming Soon
                            </div>
                        </section>
                    </div>
                )}
            </main>
            <style>
                {spinKeyframes}
                {mediaStyles}
            </style>
        </div>
    );
}

export default DaoInfo; 