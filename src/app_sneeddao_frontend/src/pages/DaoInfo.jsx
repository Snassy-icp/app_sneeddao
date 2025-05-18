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
    const [error, setError] = useState(null);
    const [daoMetrics, setDaoMetrics] = useState({
        memberCount: 0,
        activeNeurons: 0,
        proposalCount: 0
    });
    const [tokenomics, setTokenomics] = useState({
        price: 0,
        marketCap: 0,
        totalAssets: {
            totalUsd: 0,
            icp: 0,
            sneed: 0
        },
        totalRewardsDistributed: 0,
        latestDistribution: {
            round: 0,
            timestamp: null
        }
    });
    const [conversionRates, setConversionRates] = useState({});

    // Fetch conversion rates from Neutrinite
    useEffect(() => {
        const fetchConversionRates = async () => {
            try {
                const neutriniteActor = createNeutriniteDappActor('wedc6-xiaaa-aaaaq-aabaq-cai', {
                    agentOptions: { identity }
                });
                const latestWalletTokens = await neutriniteActor.get_latest_wallet_tokens();
                const rates = {};
                latestWalletTokens.forEach(token => {
                    if (token.symbol.endsWith('/USD')) {
                        rates[token.symbol.replace('/USD', '')] = Number(token.price) / Math.pow(10, 8);
                    }
                });
                setConversionRates(rates);
            } catch (err) {
                console.error('Error fetching conversion rates:', err);
            }
        };

        if (identity) {
            fetchConversionRates();
        }
    }, [identity]);

    const getUSDValue = (amount, decimals, symbol) => {
        return (amount / Math.pow(10, decimals)) * (conversionRates[symbol] || 0);
    };

    // Fetch DAO data
    useEffect(() => {
        const fetchData = async () => {
            setLoading(true);
            setError(null);
            try {
                const rllActor = createRllActor(rllCanisterId, {
                    agentOptions: { identity }
                });

                // Get SNS governance canister
                const sneedSns = getSnsById('fp274-iaaaa-aaaaq-aacha-cai');
                if (!sneedSns) {
                    throw new Error('Sneed SNS not found');
                }

                const snsGovActor = createSnsGovernanceActor(sneedSns.canisters.governance, {
                    agentOptions: { identity }
                });

                // Fetch metrics
                const [listNeuronsResponse, listProposalsResponse] = await Promise.all([
                    snsGovActor.list_neurons({ limit: 0 }),
                    snsGovActor.list_proposals({ limit: 0 })
                ]);

                // Get total neurons and active neurons
                const totalNeurons = listNeuronsResponse.neurons.length;
                const activeNeurons = listNeuronsResponse.neurons.filter(n => 
                    n.dissolve_state?.[0]?.DissolveDelaySeconds || 
                    n.dissolve_state?.[0]?.WhenDissolvedTimestampSeconds
                ).length;

                // Get total proposals
                const totalProposals = listProposalsResponse.proposals.length;

                setDaoMetrics({
                    memberCount: totalNeurons,
                    activeNeurons: activeNeurons,
                    proposalCount: totalProposals
                });

                // Fetch tokenomics data from RLL
                const [treasuryBalances, distributionInfo] = await Promise.all([
                    rllActor.get_treasury_balances(),
                    rllActor.get_latest_distribution_info()
                ]);

                // Calculate total assets
                let totalUsd = 0;
                let icpBalance = 0;
                let sneedBalance = 0;

                treasuryBalances.forEach(([tokenId, balance]) => {
                    const tokenIdStr = tokenId.toString();
                    if (tokenIdStr === 'ryjl3-tyaaa-aaaaa-aaaba-cai') { // ICP
                        icpBalance = Number(balance);
                        totalUsd += getUSDValue(Number(balance), 8, 'ICP');
                    } else if (tokenIdStr === 'zfcdd-tqaaa-aaaaq-aaaga-cai') { // SNEED
                        sneedBalance = Number(balance);
                        totalUsd += getUSDValue(Number(balance), 8, 'SNEED');
                    }
                });

                setTokenomics({
                    price: conversionRates['SNEED'] || 0,
                    marketCap: (conversionRates['SNEED'] || 0) * 100000000, // Total supply is 100M
                    totalAssets: {
                        totalUsd: totalUsd,
                        icp: icpBalance / Math.pow(10, 8),
                        sneed: sneedBalance / Math.pow(10, 8)
                    },
                    totalRewardsDistributed: distributionInfo?.total_rewards_distributed || 0,
                    latestDistribution: {
                        round: distributionInfo?.current_round || 0,
                        timestamp: distributionInfo?.last_distribution_timestamp
                    }
                });

            } catch (err) {
                console.error('Error fetching DAO data:', err);
                setError(err.message);
            } finally {
                setLoading(false);
            }
        };

        if (identity) {
            fetchData();
        }
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