import React, { useState, useEffect } from 'react';
import { useAuth } from '../AuthContext';
import Header from '../components/Header';
import { Principal } from '@dfinity/principal';
import { HttpAgent } from '@dfinity/agent';
import { createActor as createSnsGovernanceActor, canisterId as snsGovernanceCanisterId } from 'external/sns_governance';
import { createActor as createRllActor, canisterId as rllCanisterId } from 'external/rll';
import { createActor as createNeutriniteDappActor } from 'external/neutrinite_dapp';
import { createActor as createLedgerActor } from 'external/icrc1_ledger';
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
        proposalCount: 0
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
        }
    });
    const [conversionRates, setConversionRates] = useState({});
    const [eventStats, setEventStats] = useState(null);
    const [reconciliation, setReconciliation] = useState([]);

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
                
                setConversionRates(prevRates => ({
                    ...prevRates,
                    ...rates
                }));
            } catch (err) {
                console.error('Error fetching conversion rates:', err);
            }
        };

        fetchConversionRates();
        // Refresh rates every 5 minutes
        const interval = setInterval(fetchConversionRates, 5 * 60 * 1000);
        return () => clearInterval(interval);
    }, []);

    const getUSDValue = (amount, decimals, symbol) => {
        return (amount / Math.pow(10, decimals)) * (conversionRates[symbol] || 0);
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
                    const [listNeuronsResponse, listProposalsResponse] = await Promise.all([
                        snsGovActor.list_neurons({
                            limit: 0,
                            start_page_at: [],
                            of_principal: []
                        }),
                        snsGovActor.list_proposals({
                            limit: 0,
                            before_proposal: [],
                            exclude_type: [],
                            include_reward_status: [],
                            include_status: [],
                            include_topics: []
                        })
                    ]);
                    
                    // Count active neurons (not dissolved)
                    const activeNeurons = listNeuronsResponse.neurons.filter(neuron => {
                        if (!neuron.dissolve_state?.[0]) return false;
                        return 'DissolveDelaySeconds' in neuron.dissolve_state[0];
                    }).length;

                    setDaoMetrics({
                        memberCount: listNeuronsResponse.neurons.length,
                        activeNeurons: activeNeurons,
                        proposalCount: listProposalsResponse.proposals.length
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
                    // Create SNEED ledger actor to get total supply
                    const sneedLedgerActor = createLedgerActor('hvgxa-wqaaa-aaaaq-aacia-cai', {
                        agentOptions: { agent }
                    });

                    const [
                        totalDistributions,
                        mainLoopStatus,
                        eventStats,
                        totalSupply
                    ] = await Promise.all([
                        rllActor.get_total_distributions(),
                        rllActor.get_main_loop_status(),
                        rllActor.get_event_statistics(),
                        sneedLedgerActor.icrc1_total_supply()
                    ]);

                    // Process total distributions
                    let totalRewardsDistributed = 0;
                    totalDistributions.forEach(([tokenId, amount]) => {
                        const tokenIdStr = tokenId.toString();
                        if (tokenIdStr === 'hvgxa-wqaaa-aaaaq-aacia-cai') { // SNEED
                            totalRewardsDistributed = Number(amount);
                        }
                    });

                    // Calculate prices and market cap
                    const sneedPriceUsd = conversionRates['SNEED'] || 0;
                    const icpPriceUsd = conversionRates['ICP'] || 0;
                    const sneedPriceIcp = icpPriceUsd > 0 ? sneedPriceUsd / icpPriceUsd : 0;
                    const totalSupplyNum = Number(totalSupply) / 1e8;
                    const marketCapUsd = sneedPriceUsd * totalSupplyNum;
                    const marketCapIcp = sneedPriceIcp * totalSupplyNum;

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
                        totalRewardsDistributed: totalRewardsDistributed,
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
        <div className='page-container'>
            <Header />
            <main style={styles.container}>
                <h1 style={styles.heading}>DAO Dashboard</h1>

                <div className="sections-grid" style={styles.sectionsGrid}>
                    {/* DAO Metrics Section */}
                    <section style={styles.section}>
                        <h2 style={styles.subheading}>DAO Metrics</h2>
                        {loading.metrics ? (
                            <div style={{ display: 'flex', justifyContent: 'center', padding: '20px' }}>
                                <div style={styles.spinner} />
                            </div>
                        ) : error.metrics ? (
                            <div style={{ color: '#e74c3c', padding: '20px', textAlign: 'center' }}>
                                {error.metrics}
                            </div>
                        ) : (
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
                        )}
                    </section>

                    {/* Tokenomics Section */}
                    <section style={styles.section}>
                        <h2 style={styles.subheading}>Tokenomics</h2>
                        {loading.tokenomics ? (
                            <div style={{ display: 'flex', justifyContent: 'center', padding: '20px' }}>
                                <div style={styles.spinner} />
                            </div>
                        ) : error.tokenomics ? (
                            <div style={{ color: '#e74c3c', padding: '20px', textAlign: 'center' }}>
                                {error.tokenomics}
                            </div>
                        ) : (
                            <>
                                {/* Token Metadata Card */}
                                <div style={{
                                    backgroundColor: '#3a3a3a',
                                    borderRadius: '8px',
                                    padding: '20px',
                                    marginBottom: '20px',
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '20px'
                                }}>
                                    <img 
                                        src={tokenomics.metadata.logo} 
                                        alt={tokenomics.metadata.symbol}
                                        style={{
                                            width: '64px',
                                            height: '64px',
                                            borderRadius: '50%'
                                        }}
                                    />
                                    <div>
                                        <h3 style={{ 
                                            margin: '0 0 10px 0',
                                            color: '#ffffff',
                                            fontSize: '1.5em'
                                        }}>
                                            {tokenomics.metadata.name}
                                        </h3>
                                        <div style={{
                                            display: 'flex',
                                            gap: '20px',
                                            color: '#888'
                                        }}>
                                            <div>
                                                <strong>Symbol:</strong> {tokenomics.metadata.symbol}
                                            </div>
                                            <div>
                                                <strong>Decimals:</strong> {tokenomics.metadata.decimals}
                                            </div>
                                            <div>
                                                <strong>Fee:</strong> {(Number(tokenomics.metadata.fee) / Math.pow(10, tokenomics.metadata.decimals))} {tokenomics.metadata.symbol}
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                {/* Existing Tokenomics Grid */}
                                <div style={styles.grid}>
                                    <div style={styles.card}>
                                        <div style={styles.metric}>
                                            ${formatUSD(tokenomics.price)}
                                            <div style={{ fontSize: '0.7em', color: '#888' }}>
                                                {formatNumber(tokenomics.priceIcp)} ICP
                                            </div>
                                        </div>
                                        <div style={styles.label}>SNEED Price</div>
                                    </div>
                                    <div style={styles.card}>
                                        <div style={styles.metric}>
                                            ${formatUSD(tokenomics.marketCap)}
                                            <div style={{ fontSize: '0.7em', color: '#888' }}>
                                                {formatNumber(tokenomics.marketCapIcp)} ICP
                                            </div>
                                        </div>
                                        <div style={styles.label}>Market Cap</div>
                                    </div>
                                    <div style={styles.card}>
                                        <div style={styles.metric}>{formatNumber(tokenomics.totalSupply)}</div>
                                        <div style={styles.label}>Total Supply</div>
                                    </div>
                                    <div style={styles.card}>
                                        <div style={styles.metric}>${formatUSD(tokenomics.totalAssets.totalUsd)}</div>
                                        <div style={styles.label}>Total Assets (USD)</div>
                                    </div>
                                    <div style={styles.card}>
                                        <div style={styles.metric}>{formatNumber(tokenomics.totalAssets.icp / 1e8)} ICP</div>
                                        <div style={styles.label}>ICP Holdings (${formatUSD(getUSDValue(tokenomics.totalAssets.icp, 8, 'ICP'))})</div>
                                    </div>
                                    <div style={styles.card}>
                                        <div style={styles.metric}>{formatNumber(tokenomics.totalAssets.sneed / 1e8)} SNEED</div>
                                        <div style={styles.label}>SNEED Holdings (${formatUSD(getUSDValue(tokenomics.totalAssets.sneed, 8, 'SNEED'))})</div>
                                    </div>
                                    <div style={styles.card}>
                                        <div style={styles.metric}>{formatNumber(tokenomics.totalRewardsDistributed / 1e8)}</div>
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
                            </>
                        )}
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
            </main>
            <style>
                {spinKeyframes}
                {mediaStyles}
            </style>
        </div>
    );
}

export default DaoInfo; 