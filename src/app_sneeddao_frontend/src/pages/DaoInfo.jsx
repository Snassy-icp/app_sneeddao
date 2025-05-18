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
                // For now, we'll use the rates from the ticker
                setConversionRates({
                    'ICP': 5.07,
                    'SNEED': 77.29
                });
            } catch (err) {
                console.error('Error fetching conversion rates:', err);
            }
        };

        fetchConversionRates();
    }, []);

    const getUSDValue = (amount, decimals, symbol) => {
        return (amount / Math.pow(10, decimals)) * (conversionRates[symbol] || 0);
    };

    // Fetch DAO data
    useEffect(() => {
        const fetchData = async () => {
            if (!identity) return;
            
            setLoading(true);
            setError(null);
            try {
                // Create actors
                const snsGovActor = createSnsGovernanceActor('fi3zi-fyaaa-aaaaq-aachq-cai', {
                    agentOptions: { identity }
                });
                const rllActor = createRllActor(rllCanisterId, {
                    agentOptions: { identity }
                });

                // Get list of all neurons
                const listNeuronsResponse = await snsGovActor.list_neurons({
                    limit: 0,
                    start_page_at: [],
                    of_principal: []
                });
                
                // Count active neurons (not dissolved)
                const activeNeurons = listNeuronsResponse.neurons.filter(neuron => {
                    if (!neuron.dissolve_state?.[0]) return false;
                    return 'DissolveDelaySeconds' in neuron.dissolve_state[0];
                }).length;

                // Get proposal count
                const listProposalsResponse = await snsGovActor.list_proposals({
                    limit: 0,
                    before_proposal: [],
                    exclude_type: [],
                    include_reward_status: [],
                    include_status: [],
                    include_topics: []
                });

                // Get total distributions for each token
                const totalDistributions = await rllActor.get_total_distributions();
                const distributionsMap = new Map(totalDistributions.map(([principal, amount]) => [principal.toString(), amount]));
                
                // Get treasury balances
                const treasuryBalances = await rllActor.all_token_balances();
                
                // Calculate total assets
                let totalIcpUsd = 0;
                let totalSneedUsd = 0;
                let icpBalance = 0n;
                let sneedBalance = 0n;

                treasuryBalances.forEach(([tokenId, balance]) => {
                    const tokenIdStr = tokenId.toString();
                    if (tokenIdStr === 'ryjl3-tyaaa-aaaaa-aaaba-cai') { // ICP
                        icpBalance = balance;
                        totalIcpUsd = getUSDValue(Number(balance), 8, 'ICP');
                    } else if (tokenIdStr === 'zfcdd-tqaaa-aaaaq-aaaga-cai') { // SNEED
                        sneedBalance = balance;
                        totalSneedUsd = getUSDValue(Number(balance), 8, 'SNEED');
                    }
                });

                // Get main loop status for latest distribution info
                const mainLoopStatus = await rllActor.get_main_loop_status();

                // Update state
                setDaoMetrics({
                    memberCount: listNeuronsResponse.neurons.length,
                    activeNeurons: activeNeurons,
                    proposalCount: listProposalsResponse.proposals.length
                });

                setTokenomics({
                    price: conversionRates['SNEED'] || 0,
                    marketCap: (conversionRates['SNEED'] || 0) * 100000000, // Assuming 100M total supply
                    totalAssets: {
                        totalUsd: totalIcpUsd + totalSneedUsd,
                        icp: Number(icpBalance),
                        sneed: Number(sneedBalance)
                    },
                    totalRewardsDistributed: distributionsMap.get('zfcdd-tqaaa-aaaaq-aaaga-cai') || 0, // SNEED distributions
                    latestDistribution: {
                        round: 0, // This info is not directly available
                        timestamp: Number(mainLoopStatus.last_cycle_ended || 0)
                    }
                });
            } catch (err) {
                console.error('Error fetching DAO data:', err);
                setError('Failed to fetch DAO data');
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