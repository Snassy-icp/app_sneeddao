import React, { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from '../AuthContext';
import { useSns } from '../contexts/SnsContext';
import Header from '../components/Header';
import { fetchAndCacheSnsData, fetchSnsLogo, getSnsById } from '../utils/SnsUtils';
import { createActor as createSnsGovernanceActor } from 'external/sns_governance';
import { createActor as createIcrc1Actor } from 'external/icrc1_ledger';
import { HttpAgent } from '@dfinity/agent';
import { formatE8s } from '../utils/NeuronUtils';
import { Link } from 'react-router-dom';

function Hub() {
    const { identity } = useAuth();
    const { selectedSnsRoot, updateSelectedSns, SNEED_SNS_ROOT } = useSns();
    const [searchParams, setSearchParams] = useSearchParams();
    const [snsList, setSnsList] = useState([]);
    const [expandedSns, setExpandedSns] = useState(new Set());
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [snsLogos, setSnsLogos] = useState(new Map());
    const [loadingLogos, setLoadingLogos] = useState(new Set());
    const [selectedSnsDetails, setSelectedSnsDetails] = useState(null);
    const [loadingDetails, setLoadingDetails] = useState(false);
    const [isMobile, setIsMobile] = useState(window.innerWidth <= 768);
    const [sortBy, setSortBy] = useState('age'); // 'age' or 'name'

    // Handle window resize for responsive design
    useEffect(() => {
        const handleResize = () => {
            setIsMobile(window.innerWidth <= 768);
        };
        window.addEventListener('resize', handleResize);
        return () => window.removeEventListener('resize', handleResize);
    }, []);

    // Sync URL parameters with global state
    useEffect(() => {
        const snsParam = searchParams.get('sns');
        if (snsParam && snsParam !== selectedSnsRoot) {
            updateSelectedSns(snsParam);
        } else if (!snsParam && selectedSnsRoot !== SNEED_SNS_ROOT) {
            setSearchParams(prev => {
                prev.set('sns', selectedSnsRoot);
                return prev;
            });
        }
    }, [searchParams, selectedSnsRoot, updateSelectedSns, SNEED_SNS_ROOT, setSearchParams]);

    // Load SNS data on component mount
    useEffect(() => {
        loadSnsData();
    }, []);

    // Load detailed information when selected SNS changes
    useEffect(() => {
        if (selectedSnsRoot) {
            loadSelectedSnsDetails();
        }
    }, [selectedSnsRoot]);

    const loadSnsData = async () => {
        setLoading(true);
        try {
            const data = await fetchAndCacheSnsData(identity);
            setSnsList(data);
            
            // Start loading logos for all SNSes
            data.forEach(sns => {
                if (sns.canisters.governance) {
                    loadSnsLogo(sns.canisters.governance);
                }
            });
        } catch (err) {
            console.error('Error loading SNS data:', err);
            setError('Failed to load SNS data');
        } finally {
            setLoading(false);
        }
    };

    const loadSnsLogo = async (governanceId) => {
        if (snsLogos.has(governanceId) || loadingLogos.has(governanceId)) return;
        
        setLoadingLogos(prev => new Set([...prev, governanceId]));
        
        try {
            const host = process.env.DFX_NETWORK === 'ic' ? 'https://ic0.app' : 'http://localhost:4943';
            const agent = new HttpAgent({
                host,
                ...(identity && { identity })
            });

            if (process.env.DFX_NETWORK !== 'ic') {
                await agent.fetchRootKey();
            }

            const logo = await fetchSnsLogo(governanceId, agent);
            setSnsLogos(prev => new Map(prev).set(governanceId, logo));
        } catch (error) {
            console.error(`Error loading logo for SNS ${governanceId}:`, error);
        } finally {
            setLoadingLogos(prev => {
                const next = new Set(prev);
                next.delete(governanceId);
                return next;
            });
        }
    };

    const loadSelectedSnsDetails = async () => {
        if (!selectedSnsRoot) return;
        
        setLoadingDetails(true);
        try {
            const selectedSns = getSnsById(selectedSnsRoot);
            if (!selectedSns) return;

            const host = process.env.DFX_NETWORK === 'ic' ? 'https://ic0.app' : 'http://localhost:4943';
            const agent = new HttpAgent({
                host,
                ...(identity && { identity })
            });

            if (process.env.DFX_NETWORK !== 'ic') {
                await agent.fetchRootKey();
            }

            // Fetch detailed governance metadata
            const governanceActor = createSnsGovernanceActor(selectedSns.canisters.governance, { agent });
            const metadata = await governanceActor.get_metadata({});
            
            // Fetch token metadata
            const ledgerActor = createIcrc1Actor(selectedSns.canisters.ledger, { agent });
            const tokenMetadata = await ledgerActor.icrc1_metadata();
            const totalSupply = await ledgerActor.icrc1_total_supply();
            
            // Extract token symbol and decimals
            const symbolEntry = tokenMetadata.find(entry => entry[0] === 'icrc1:symbol');
            const decimalsEntry = tokenMetadata.find(entry => entry[0] === 'icrc1:decimals');
            const symbol = symbolEntry?.[1]?.Text || 'SNS';
            const decimals = decimalsEntry?.[1]?.Nat || 8n;

            // Fetch nervous system parameters
            let nervousSystemParameters = null;
            try {
                nervousSystemParameters = await governanceActor.get_nervous_system_parameters(null);
            } catch (err) {
                console.warn('Could not fetch nervous system parameters:', err);
            }

            setSelectedSnsDetails({
                ...selectedSns,
                metadata,
                tokenSymbol: symbol,
                tokenDecimals: Number(decimals),
                totalSupply,
                nervousSystemParameters
            });
        } catch (err) {
            console.error('Error loading SNS details:', err);
        } finally {
            setLoadingDetails(false);
        }
    };

    const handleSnsSelect = (snsRoot) => {
        updateSelectedSns(snsRoot);
        
        // Update URL parameters
        setSearchParams(prev => {
            if (snsRoot === SNEED_SNS_ROOT) {
                prev.delete('sns');
            } else {
                prev.set('sns', snsRoot);
            }
            return prev;
        });
    };

    const toggleSnsExpansion = (snsRoot) => {
        setExpandedSns(prev => {
            const newSet = new Set(prev);
            if (newSet.has(snsRoot)) {
                newSet.delete(snsRoot);
            } else {
                newSet.add(snsRoot);
            }
            return newSet;
        });
    };

    const formatTimestamp = (timestamp) => {
        if (!timestamp) return 'N/A';
        return new Date(Number(timestamp) / 1000000).toLocaleDateString();
    };

    const formatDuration = (nanoseconds) => {
        const seconds = Number(nanoseconds) / 1000000000;
        const days = Math.floor(seconds / (24 * 60 * 60));
        const years = Math.floor(days / 365);
        
        if (years > 0) {
            return `${years} year${years > 1 ? 's' : ''}`;
        } else {
            return `${days} day${days > 1 ? 's' : ''}`;
        }
    };

    // Sort SNSes based on selected criteria
    const getSortedSnsList = () => {
        const sortedList = [...snsList];
        
        if (sortBy === 'name') {
            return sortedList.sort((a, b) => a.name.localeCompare(b.name));
        } else {
            // Sort by age (creation time) - newest first (default order from API)
            return sortedList;
        }
    };

    if (loading) {
        return (
            <div className='page-container'>
                <Header showSnsDropdown={true} />
                <main style={{ padding: '2rem', textAlign: 'center' }}>
                    <div style={{ color: '#ffffff' }}>Loading SNS data...</div>
                </main>
            </div>
        );
    }

    if (error) {
        return (
            <div className='page-container'>
                <Header showSnsDropdown={true} />
                <main style={{ padding: '2rem', textAlign: 'center' }}>
                    <div style={{ color: '#e74c3c' }}>{error}</div>
                </main>
            </div>
        );
    }

    return (
        <div className='page-container'>
            <Header showSnsDropdown={true} />
            <main style={{
                maxWidth: '1400px',
                margin: '0 auto',
                padding: '2rem',
                display: 'flex',
                flexDirection: isMobile ? 'column' : 'row',
                gap: '2rem'
            }}>
                {/* SNS List */}
                <div style={{
                    flex: isMobile ? 'none' : '1',
                    minWidth: isMobile ? 'auto' : '400px'
                }}>
                    <h1 style={{
                        fontSize: '2rem',
                        color: '#ffffff',
                        marginBottom: '1.5rem'
                    }}>
                        SNS Explorer
                    </h1>
                    
                    {/* Sort Controls */}
                    <div style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        marginBottom: '1rem',
                        padding: '0.5rem 0'
                    }}>
                        <div style={{ color: '#888', fontSize: '14px' }}>
                            {snsList.length} SNS{snsList.length !== 1 ? 'es' : ''} found
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <label style={{ color: '#888', fontSize: '14px' }}>Sort by:</label>
                            <select
                                value={sortBy}
                                onChange={(e) => setSortBy(e.target.value)}
                                style={{
                                    backgroundColor: '#3a3a3a',
                                    color: '#ffffff',
                                    border: '1px solid #4a4a4a',
                                    borderRadius: '4px',
                                    padding: '4px 8px',
                                    fontSize: '14px'
                                }}
                            >
                                <option value="age">Age (Newest First)</option>
                                <option value="name">Name (A-Z)</option>
                            </select>
                        </div>
                    </div>
                    
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                        {getSortedSnsList().map(sns => {
                            const isSelected = sns.rootCanisterId === selectedSnsRoot;
                            const isExpanded = expandedSns.has(sns.rootCanisterId);
                            const logo = snsLogos.get(sns.canisters.governance);
                            const isLoadingLogo = loadingLogos.has(sns.canisters.governance);
                            
                            return (
                                <div
                                    key={sns.rootCanisterId}
                                    style={{
                                        backgroundColor: isSelected ? '#3a3a3a' : '#2a2a2a',
                                        border: isSelected ? '2px solid #3498db' : '1px solid #4a4a4a',
                                        borderRadius: '8px',
                                        overflow: 'hidden'
                                    }}
                                >
                                    {/* SNS Header */}
                                    <div
                                        onClick={() => handleSnsSelect(sns.rootCanisterId)}
                                        style={{
                                            padding: '1rem',
                                            cursor: 'pointer',
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'space-between',
                                            borderBottom: isExpanded ? '1px solid #4a4a4a' : 'none'
                                        }}
                                    >
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                                            {isLoadingLogo ? (
                                                <div style={{
                                                    width: '32px',
                                                    height: '32px',
                                                    borderRadius: '50%',
                                                    backgroundColor: '#4a4a4a'
                                                }} />
                                            ) : logo ? (
                                                <img
                                                    src={logo}
                                                    alt={sns.name}
                                                    style={{
                                                        width: '32px',
                                                        height: '32px',
                                                        borderRadius: '50%',
                                                        objectFit: 'cover'
                                                    }}
                                                />
                                            ) : (
                                                <div style={{
                                                    width: '32px',
                                                    height: '32px',
                                                    borderRadius: '50%',
                                                    backgroundColor: '#4a4a4a',
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    justifyContent: 'center',
                                                    color: '#888',
                                                    fontSize: '12px'
                                                }}>
                                                    SNS
                                                </div>
                                            )}
                                            <div>
                                                <div style={{
                                                    color: '#ffffff',
                                                    fontSize: '16px',
                                                    fontWeight: 'bold'
                                                }}>
                                                    {sns.name}
                                                </div>
                                                <div style={{
                                                    color: '#888',
                                                    fontSize: '12px',
                                                    fontFamily: 'monospace'
                                                }}>
                                                    {sns.rootCanisterId.slice(0, 8)}...{sns.rootCanisterId.slice(-8)}
                                                </div>
                                            </div>
                                        </div>
                                        <button
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                toggleSnsExpansion(sns.rootCanisterId);
                                            }}
                                            style={{
                                                background: 'none',
                                                border: 'none',
                                                color: '#888',
                                                cursor: 'pointer',
                                                fontSize: '16px',
                                                transform: isExpanded ? 'rotate(180deg)' : 'none',
                                                transition: 'transform 0.2s ease'
                                            }}
                                        >
                                            ▼
                                        </button>
                                    </div>

                                    {/* Expanded Details */}
                                    {isExpanded && (
                                        <div style={{
                                            padding: '1rem',
                                            backgroundColor: '#1a1a1a'
                                        }}>
                                            <div style={{
                                                display: 'grid',
                                                gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
                                                gap: '1rem',
                                                fontSize: '14px'
                                            }}>
                                                <div>
                                                    <div style={{ color: '#888', marginBottom: '4px' }}>Root Canister</div>
                                                    <div style={{ 
                                                        color: '#ffffff',
                                                        fontFamily: 'monospace',
                                                        fontSize: '12px'
                                                    }}>
                                                        {sns.rootCanisterId}
                                                    </div>
                                                </div>
                                                <div>
                                                    <div style={{ color: '#888', marginBottom: '4px' }}>Governance</div>
                                                    <div style={{ 
                                                        color: '#ffffff',
                                                        fontFamily: 'monospace',
                                                        fontSize: '12px'
                                                    }}>
                                                        {sns.canisters.governance}
                                                    </div>
                                                </div>
                                                <div>
                                                    <div style={{ color: '#888', marginBottom: '4px' }}>Ledger</div>
                                                    <div style={{ 
                                                        color: '#ffffff',
                                                        fontFamily: 'monospace',
                                                        fontSize: '12px'
                                                    }}>
                                                        {sns.canisters.ledger}
                                                    </div>
                                                </div>
                                                {sns.canisters.swap && (
                                                    <div>
                                                        <div style={{ color: '#888', marginBottom: '4px' }}>Swap</div>
                                                        <div style={{ 
                                                            color: '#ffffff',
                                                            fontFamily: 'monospace',
                                                            fontSize: '12px'
                                                        }}>
                                                            {sns.canisters.swap}
                                                        </div>
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                </div>

                {/* Selected SNS Details */}
                <div style={{
                    flex: isMobile ? 'none' : '1',
                    minWidth: isMobile ? 'auto' : '500px'
                }}>
                    {selectedSnsRoot ? (
                        <div style={{
                            backgroundColor: '#2a2a2a',
                            borderRadius: '8px',
                            padding: '2rem',
                            border: '1px solid #4a4a4a'
                        }}>
                            <h2 style={{
                                color: '#ffffff',
                                marginBottom: '1.5rem',
                                fontSize: '1.5rem'
                            }}>
                                SNS Details
                            </h2>

                            {loadingDetails ? (
                                <div style={{ textAlign: 'center', color: '#888', padding: '2rem' }}>
                                    Loading detailed information...
                                </div>
                            ) : selectedSnsDetails ? (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                                    {/* Basic Info */}
                                    <div>
                                        <h3 style={{ color: '#3498db', marginBottom: '1rem' }}>Basic Information</h3>
                                        <div style={{ display: 'grid', gap: '0.5rem' }}>
                                            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                                                <span style={{ color: '#888' }}>Name:</span>
                                                <span style={{ color: '#ffffff' }}>{selectedSnsDetails.name}</span>
                                            </div>
                                            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                                                <span style={{ color: '#888' }}>Token Symbol:</span>
                                                <span style={{ color: '#ffffff' }}>{selectedSnsDetails.tokenSymbol}</span>
                                            </div>
                                            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                                                <span style={{ color: '#888' }}>Total Supply:</span>
                                                <span style={{ color: '#ffffff' }}>
                                                    {formatE8s(selectedSnsDetails.totalSupply)} {selectedSnsDetails.tokenSymbol}
                                                </span>
                                            </div>
                                            {selectedSnsDetails.metadata?.description?.[0] && (
                                                <div>
                                                    <div style={{ color: '#888', marginBottom: '0.5rem' }}>Description:</div>
                                                    <div style={{ 
                                                        color: '#ffffff',
                                                        backgroundColor: '#1a1a1a',
                                                        padding: '1rem',
                                                        borderRadius: '4px',
                                                        fontSize: '14px',
                                                        lineHeight: '1.4'
                                                    }}>
                                                        {selectedSnsDetails.metadata.description[0]}
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    </div>

                                    {/* Governance Parameters */}
                                    {selectedSnsDetails.nervousSystemParameters && (
                                        <div>
                                            <h3 style={{ color: '#3498db', marginBottom: '1rem' }}>Governance Parameters</h3>
                                            <div style={{ display: 'grid', gap: '0.5rem' }}>
                                                {selectedSnsDetails.nervousSystemParameters.neuron_minimum_stake_e8s?.[0] && (
                                                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                                                        <span style={{ color: '#888' }}>Min Neuron Stake:</span>
                                                        <span style={{ color: '#ffffff' }}>
                                                            {formatE8s(selectedSnsDetails.nervousSystemParameters.neuron_minimum_stake_e8s[0])} {selectedSnsDetails.tokenSymbol}
                                                        </span>
                                                    </div>
                                                )}
                                                {selectedSnsDetails.nervousSystemParameters.max_dissolve_delay_seconds?.[0] && (
                                                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                                                        <span style={{ color: '#888' }}>Max Dissolve Delay:</span>
                                                        <span style={{ color: '#ffffff' }}>
                                                            {formatDuration(selectedSnsDetails.nervousSystemParameters.max_dissolve_delay_seconds[0] * 1000000000n)}
                                                        </span>
                                                    </div>
                                                )}
                                                {selectedSnsDetails.nervousSystemParameters.proposal_reject_cost_e8s?.[0] && (
                                                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                                                        <span style={{ color: '#888' }}>Proposal Reject Cost:</span>
                                                        <span style={{ color: '#ffffff' }}>
                                                            {formatE8s(selectedSnsDetails.nervousSystemParameters.proposal_reject_cost_e8s[0])} {selectedSnsDetails.tokenSymbol}
                                                        </span>
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    )}

                                    {/* External Links */}
                                    <div>
                                        <h3 style={{ color: '#3498db', marginBottom: '1rem' }}>External Links</h3>
                                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                                            <a
                                                href={`https://nns.ic0.app/project/?project=${selectedSnsRoot}`}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                style={{
                                                    color: '#3498db',
                                                    textDecoration: 'none',
                                                    padding: '0.5rem',
                                                    backgroundColor: '#1a1a1a',
                                                    borderRadius: '4px',
                                                    display: 'block'
                                                }}
                                            >
                                                View on NNS dApp →
                                            </a>
                                            <a
                                                href={`https://dashboard.internetcomputer.org/sns/${selectedSnsRoot}`}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                style={{
                                                    color: '#3498db',
                                                    textDecoration: 'none',
                                                    padding: '0.5rem',
                                                    backgroundColor: '#1a1a1a',
                                                    borderRadius: '4px',
                                                    display: 'block'
                                                }}
                                            >
                                                View on IC Dashboard →
                                            </a>
                                        </div>
                                    </div>

                                    {/* Internal Pages */}
                                    <div>
                                        <h3 style={{ color: '#3498db', marginBottom: '1rem' }}>Explore This SNS</h3>
                                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                                            <Link
                                                to={`/proposals?sns=${selectedSnsRoot}`}
                                                style={{
                                                    color: '#2ecc71',
                                                    textDecoration: 'none',
                                                    padding: '0.5rem',
                                                    backgroundColor: '#1a1a1a',
                                                    borderRadius: '4px',
                                                    display: 'block',
                                                    transition: 'background-color 0.2s'
                                                }}
                                                onMouseEnter={(e) => e.target.style.backgroundColor = '#2a2a2a'}
                                                onMouseLeave={(e) => e.target.style.backgroundColor = '#1a1a1a'}
                                            >
                                                📋 View Proposals →
                                            </Link>
                                            <Link
                                                to={`/neurons?sns=${selectedSnsRoot}`}
                                                style={{
                                                    color: '#2ecc71',
                                                    textDecoration: 'none',
                                                    padding: '0.5rem',
                                                    backgroundColor: '#1a1a1a',
                                                    borderRadius: '4px',
                                                    display: 'block',
                                                    transition: 'background-color 0.2s'
                                                }}
                                                onMouseEnter={(e) => e.target.style.backgroundColor = '#2a2a2a'}
                                                onMouseLeave={(e) => e.target.style.backgroundColor = '#1a1a1a'}
                                            >
                                                🧠 Browse Neurons →
                                            </Link>
                                            <Link
                                                to={`/transactions?sns=${selectedSnsRoot}`}
                                                style={{
                                                    color: '#2ecc71',
                                                    textDecoration: 'none',
                                                    padding: '0.5rem',
                                                    backgroundColor: '#1a1a1a',
                                                    borderRadius: '4px',
                                                    display: 'block',
                                                    transition: 'background-color 0.2s'
                                                }}
                                                onMouseEnter={(e) => e.target.style.backgroundColor = '#2a2a2a'}
                                                onMouseLeave={(e) => e.target.style.backgroundColor = '#1a1a1a'}
                                            >
                                                💰 View Transactions →
                                            </Link>
                                        </div>
                                    </div>
                                </div>
                            ) : (
                                <div style={{ textAlign: 'center', color: '#888', padding: '2rem' }}>
                                    Failed to load SNS details
                                </div>
                            )}
                        </div>
                    ) : (
                        <div style={{
                            backgroundColor: '#2a2a2a',
                            borderRadius: '8px',
                            padding: '2rem',
                            border: '1px solid #4a4a4a',
                            textAlign: 'center'
                        }}>
                            <h2 style={{
                                color: '#ffffff',
                                marginBottom: '1rem',
                                fontSize: '1.5rem'
                            }}>
                                Select an SNS
                            </h2>
                            <p style={{ color: '#888' }}>
                                Choose an SNS from the list to view detailed information
                            </p>
                        </div>
                    )}
                </div>
            </main>
        </div>
    );
}

export default Hub; 