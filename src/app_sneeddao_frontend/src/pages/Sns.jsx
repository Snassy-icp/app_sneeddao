import React, { useState, useEffect } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { useAuth } from '../AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import { useSns } from '../contexts/SnsContext';
import Header from '../components/Header';
import { fetchAndCacheSnsData, fetchSnsLogo, getSnsById } from '../utils/SnsUtils';
import { createActor as createSnsGovernanceActor } from 'external/sns_governance';
import { createActor as createSnsRootActor } from 'external/sns_root';
import { createActor as createIcrc1Actor } from 'external/icrc1_ledger';
import { HttpAgent } from '@dfinity/agent';
import { formatE8s } from '../utils/NeuronUtils';
import { FaGlobe, FaVoteYea, FaComments, FaRss, FaExternalLinkAlt, FaSearch, FaCoins, FaServer, FaUsers, FaHistory, FaShieldAlt, FaArrowRight, FaLink, FaCube, FaArchive, FaCode, FaExchangeAlt, FaCopy, FaCheck, FaChevronDown, FaChevronUp, FaList, FaInfoCircle } from 'react-icons/fa';

// Custom CSS for animations
const customStyles = `
@keyframes shimmer {
    0% { background-position: -200% 0; }
    100% { background-position: 200% 0; }
}

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

@keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.7; }
}

@keyframes float {
    0%, 100% { transform: translateY(0px); }
    50% { transform: translateY(-6px); }
}

@keyframes spin {
    0% { transform: rotate(0deg); }
    100% { transform: rotate(360deg); }
}

.sns-card-animate {
    animation: fadeInUp 0.5s ease-out forwards;
    opacity: 0;
}

.sns-shimmer {
    background: linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.08) 50%, transparent 100%);
    background-size: 200% 100%;
    animation: shimmer 2s infinite;
}

.sns-pulse {
    animation: pulse 2s ease-in-out infinite;
}

.sns-float {
    animation: float 4s ease-in-out infinite;
}

.sns-spin {
    animation: spin 1s linear infinite;
}
`;

// Accent colors for the SNS page
const snsPrimary = '#8b5cf6'; // Purple
const snsSecondary = '#6366f1'; // Indigo
const snsAccent = '#06b6d4'; // Cyan

function Sns() {
    const { identity } = useAuth();
    const { theme } = useTheme();
    const { selectedSnsRoot, updateSelectedSns, SNEED_SNS_ROOT } = useSns();
    const [searchParams, setSearchParams] = useSearchParams();
    const [snsList, setSnsList] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [snsLogos, setSnsLogos] = useState(new Map());
    const [loadingLogos, setLoadingLogos] = useState(new Set());
    const [selectedSnsDetails, setSelectedSnsDetails] = useState(null);
    const [loadingDetails, setLoadingDetails] = useState(false);
    const [isMobile, setIsMobile] = useState(window.innerWidth <= 768);
    const [sortBy, setSortBy] = useState('age-oldest');
    const [searchQuery, setSearchQuery] = useState('');
    const [hoveredCard, setHoveredCard] = useState(null);
    const [copiedId, setCopiedId] = useState(null);
    const [isListCollapsed, setIsListCollapsed] = useState(false);
    const [isDetailsCollapsed, setIsDetailsCollapsed] = useState(false);

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
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Load detailed information when selected SNS changes
    useEffect(() => {
        if (selectedSnsRoot) {
            loadSelectedSnsDetails();
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selectedSnsRoot]);

    const withSnsParam = (path) => {
        if (!selectedSnsRoot || selectedSnsRoot === SNEED_SNS_ROOT) return path;
        return `${path}?sns=${selectedSnsRoot}`;
    };

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
            const host = process.env.DFX_NETWORK === 'ic' || process.env.DFX_NETWORK === 'staging' ? 'https://ic0.app' : 'http://localhost:4943';
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

            const host = process.env.DFX_NETWORK === 'ic' || process.env.DFX_NETWORK === 'staging' ? 'https://ic0.app' : 'http://localhost:4943';
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

            // Extract token symbol, decimals, name
            const symbolEntry = tokenMetadata.find(entry => entry[0] === 'icrc1:symbol');
            const decimalsEntry = tokenMetadata.find(entry => entry[0] === 'icrc1:decimals');
            const tokenNameEntry = tokenMetadata.find(entry => entry[0] === 'icrc1:name');
            const feeEntry = tokenMetadata.find(entry => entry[0] === 'icrc1:fee');
            const symbol = symbolEntry?.[1]?.Text || 'SNS';
            const decimals = decimalsEntry?.[1]?.Nat || 8n;
            const tokenName = tokenNameEntry?.[1]?.Text || symbol;
            const fee = feeEntry?.[1]?.Nat || 0n;

            // Fetch nervous system parameters
            let nervousSystemParameters = null;
            try {
                nervousSystemParameters = await governanceActor.get_nervous_system_parameters(null);
            } catch (err) {
                console.warn('Could not fetch nervous system parameters:', err);
            }

            // Fetch all canisters from root canister
            let allCanisters = {
                root: selectedSns.rootCanisterId,
                governance: selectedSns.canisters.governance,
                ledger: selectedSns.canisters.ledger,
                swap: selectedSns.canisters.swap,
                index: null,
                dapps: [],
                archives: []
            };

            try {
                const rootActor = createSnsRootActor(selectedSns.rootCanisterId, { agent });
                const canisterList = await rootActor.list_sns_canisters({});
                
                allCanisters = {
                    root: canisterList.root?.[0]?.toText?.() || canisterList.root?.[0] || selectedSns.rootCanisterId,
                    governance: canisterList.governance?.[0]?.toText?.() || canisterList.governance?.[0] || selectedSns.canisters.governance,
                    ledger: canisterList.ledger?.[0]?.toText?.() || canisterList.ledger?.[0] || selectedSns.canisters.ledger,
                    swap: canisterList.swap?.[0]?.toText?.() || canisterList.swap?.[0] || selectedSns.canisters.swap,
                    index: canisterList.index?.[0]?.toText?.() || canisterList.index?.[0] || null,
                    dapps: (canisterList.dapps || []).map(d => d?.toText?.() || d).filter(Boolean),
                    archives: (canisterList.archives || []).map(a => a?.toText?.() || a).filter(Boolean)
                };
            } catch (err) {
                console.warn('Could not fetch canister list from root:', err);
            }

            setSelectedSnsDetails({
                ...selectedSns,
                metadata,
                tokenSymbol: symbol,
                tokenName,
                tokenDecimals: Number(decimals),
                totalSupply,
                transactionFee: fee,
                nervousSystemParameters,
                allCanisters
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

    const copyToClipboard = async (text, id) => {
        try {
            await navigator.clipboard.writeText(text);
            setCopiedId(id);
            setTimeout(() => setCopiedId(null), 2000);
        } catch (err) {
            console.error('Failed to copy:', err);
        }
    };

    // Sort and filter SNSes based on selected criteria
    const getSortedSnsList = () => {
        let filteredList = [...snsList];

        // Apply search filter
        if (searchQuery.trim()) {
            const query = searchQuery.toLowerCase();
            filteredList = filteredList.filter(sns =>
                sns.name.toLowerCase().includes(query) ||
                sns.rootCanisterId.toLowerCase().includes(query)
            );
        }

        // Helper function to check if a name starts with alphanumeric character
        const startsWithAlphanumeric = (name) => {
            return /^[a-zA-Z0-9]/.test(name);
        };

        if (sortBy === 'name-asc') {
            return filteredList.sort((a, b) => {
                const aStartsAlphanumeric = startsWithAlphanumeric(a.name);
                const bStartsAlphanumeric = startsWithAlphanumeric(b.name);

                if (aStartsAlphanumeric && !bStartsAlphanumeric) return -1;
                if (!aStartsAlphanumeric && bStartsAlphanumeric) return 1;

                return a.name.localeCompare(b.name);
            });
        } else if (sortBy === 'name-desc') {
            return filteredList.sort((a, b) => {
                const aStartsAlphanumeric = startsWithAlphanumeric(a.name);
                const bStartsAlphanumeric = startsWithAlphanumeric(b.name);

                if (aStartsAlphanumeric && !bStartsAlphanumeric) return -1;
                if (!aStartsAlphanumeric && bStartsAlphanumeric) return 1;

                return b.name.localeCompare(a.name);
            });
        } else if (sortBy === 'age-newest') {
            return filteredList.sort((a, b) => {
                const aStartsAlphanumeric = startsWithAlphanumeric(a.name);
                const bStartsAlphanumeric = startsWithAlphanumeric(b.name);

                if (aStartsAlphanumeric && !bStartsAlphanumeric) return -1;
                if (!aStartsAlphanumeric && bStartsAlphanumeric) return 1;

                return snsList.indexOf(b) - snsList.indexOf(a);
            });
        } else {
            return filteredList.sort((a, b) => {
                const aStartsAlphanumeric = startsWithAlphanumeric(a.name);
                const bStartsAlphanumeric = startsWithAlphanumeric(b.name);

                if (aStartsAlphanumeric && !bStartsAlphanumeric) return -1;
                if (!aStartsAlphanumeric && bStartsAlphanumeric) return 1;

                return snsList.indexOf(a) - snsList.indexOf(b);
            });
        }
    };

    // Render a canister row with links
    const renderCanisterRow = (label, canisterId, icon, color) => {
        if (!canisterId) return null;
        const isCopied = copiedId === canisterId;
        
        return (
            <div style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '0.75rem',
                background: theme.colors.primaryBg,
                borderRadius: '10px',
                gap: '0.5rem'
            }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0, flex: 1 }}>
                    <div style={{
                        width: '32px',
                        height: '32px',
                        borderRadius: '8px',
                        background: `${color}20`,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        color: color,
                        flexShrink: 0
                    }}>
                        {icon}
                    </div>
                    <div style={{ minWidth: 0, flex: 1 }}>
                        <div style={{ color: theme.colors.secondaryText, fontSize: '0.75rem', marginBottom: '2px' }}>{label}</div>
                        <div style={{
                            color: theme.colors.primaryText,
                            fontSize: '0.8rem',
                            fontFamily: 'monospace',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap'
                        }}>
                            {canisterId}
                        </div>
                    </div>
                </div>
                <div style={{ display: 'flex', gap: '6px', flexShrink: 0 }}>
                    <button
                        onClick={() => copyToClipboard(canisterId, canisterId)}
                        title="Copy ID"
                        style={{
                            background: isCopied ? `${theme.colors.success}20` : theme.colors.secondaryBg,
                            border: `1px solid ${isCopied ? theme.colors.success : theme.colors.border}`,
                            borderRadius: '6px',
                            padding: '6px',
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            color: isCopied ? theme.colors.success : theme.colors.mutedText,
                            transition: 'all 0.2s ease'
                        }}
                    >
                        {isCopied ? <FaCheck size={12} /> : <FaCopy size={12} />}
                    </button>
                    <Link
                        to={`/canister/${canisterId}`}
                        title="View on Sneed"
                        style={{
                            background: theme.colors.secondaryBg,
                            border: `1px solid ${theme.colors.border}`,
                            borderRadius: '6px',
                            padding: '6px',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            color: snsPrimary,
                            textDecoration: 'none',
                            transition: 'all 0.2s ease'
                        }}
                    >
                        <FaCube size={12} />
                    </Link>
                    <a
                        href={`https://dashboard.internetcomputer.org/canister/${canisterId}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        title="View on IC Dashboard"
                        style={{
                            background: theme.colors.secondaryBg,
                            border: `1px solid ${theme.colors.border}`,
                            borderRadius: '6px',
                            padding: '6px',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            color: snsAccent,
                            textDecoration: 'none',
                            transition: 'all 0.2s ease'
                        }}
                    >
                        <FaExternalLinkAlt size={12} />
                    </a>
                </div>
            </div>
        );
    };

    if (loading) {
        return (
            <div className='page-container'>
                <style>{customStyles}</style>
                <Header showSnsDropdown={true} />
                <main style={{
                    background: theme.colors.primaryGradient,
                    minHeight: '100vh',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center'
                }}>
                    <div style={{ textAlign: 'center' }}>
                        <div className="sns-float" style={{
                            width: '70px',
                            height: '70px',
                            borderRadius: '50%',
                            background: `linear-gradient(135deg, ${snsPrimary}, ${snsSecondary})`,
                            margin: '0 auto 1.5rem',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center'
                        }}>
                            <FaGlobe size={32} color="white" />
                        </div>
                        <p style={{ color: theme.colors.secondaryText, fontSize: '1.1rem' }}>
                            Loading SNS Directory...
                        </p>
                    </div>
                </main>
            </div>
        );
    }

    if (error) {
        return (
            <div className='page-container'>
                <style>{customStyles}</style>
                <Header showSnsDropdown={true} />
                <main style={{
                    background: theme.colors.primaryGradient,
                    minHeight: '100vh',
                    padding: '2rem'
                }}>
                    <div style={{
                        maxWidth: '600px',
                        margin: '4rem auto',
                        background: 'rgba(231, 76, 60, 0.1)',
                        border: '1px solid rgba(231, 76, 60, 0.3)',
                        borderRadius: '16px',
                        padding: '2rem',
                        textAlign: 'center',
                        color: theme.colors.error
                    }}>
                        <p style={{ fontSize: '1.1rem' }}>{error}</p>
                    </div>
                </main>
            </div>
        );
    }

    const sortedList = getSortedSnsList();
    const selectedLogo = selectedSnsDetails?.canisters?.governance ? snsLogos.get(selectedSnsDetails.canisters.governance) : null;

    return (
        <div
            className='page-container'
            style={{
                background: theme.colors.primaryGradient,
                color: theme.colors.primaryText,
                minHeight: '100vh'
            }}
        >
            <style>{customStyles}</style>
            <Header showSnsDropdown={true} />

            <main style={{
                maxWidth: '1400px',
                margin: '0 auto',
                padding: '2rem'
            }}>
                {/* Hero Section */}
                <div style={{
                    background: `linear-gradient(135deg, ${theme.colors.secondaryBg} 0%, ${snsPrimary}15 50%, ${snsSecondary}10 100%)`,
                    borderRadius: '24px',
                    padding: '3rem 2rem',
                    marginBottom: '2rem',
                    border: `1px solid ${theme.colors.border}`,
                    position: 'relative',
                    overflow: 'hidden'
                }}>
                    {/* Background decorations */}
                    <div style={{
                        position: 'absolute',
                        top: '-50%',
                        right: '-10%',
                        width: '450px',
                        height: '450px',
                        background: `radial-gradient(circle, ${snsPrimary}20 0%, transparent 70%)`,
                        borderRadius: '50%',
                        pointerEvents: 'none'
                    }} />
                    <div style={{
                        position: 'absolute',
                        bottom: '-40%',
                        left: '-5%',
                        width: '350px',
                        height: '350px',
                        background: `radial-gradient(circle, ${snsSecondary}15 0%, transparent 70%)`,
                        borderRadius: '50%',
                        pointerEvents: 'none'
                    }} />

                    <div style={{ position: 'relative', zIndex: 1, textAlign: 'center' }}>
                        {/* Animated Icon */}
                        <div
                            className="sns-float"
                            style={{
                                width: '80px',
                                height: '80px',
                                borderRadius: '20px',
                                background: `linear-gradient(135deg, ${snsPrimary}, ${snsSecondary})`,
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                margin: '0 auto 1.5rem auto',
                                boxShadow: `0 8px 30px ${snsPrimary}40`
                            }}
                        >
                            <FaGlobe size={36} color="white" />
                        </div>

                        <h1 style={{
                            fontSize: 'clamp(2rem, 5vw, 2.75rem)',
                            color: theme.colors.primaryText,
                            marginBottom: '1rem',
                            fontWeight: '800',
                            letterSpacing: '-0.02em'
                        }}>
                            SNS Directory
                        </h1>

                        <p style={{
                            color: theme.colors.secondaryText,
                            fontSize: '1.1rem',
                            lineHeight: '1.7',
                            maxWidth: '700px',
                            margin: '0 auto 1rem auto'
                        }}>
                            Browse the SNS ecosystem, pick a DAO, and jump straight into proposals, neurons, transactions, and the forum.
                        </p>

                        <p style={{
                            color: theme.colors.mutedText,
                            fontSize: '0.95rem',
                            marginBottom: '2rem'
                        }}>
                            💡 Use the SNS dropdown in the header to switch context anywhere on the site.
                        </p>

                        {/* Quick Stats */}
                        <div style={{
                            display: 'flex',
                            justifyContent: 'center',
                            gap: '2rem',
                            flexWrap: 'wrap',
                            marginBottom: '2rem'
                        }}>
                            <div style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: '8px',
                                color: theme.colors.secondaryText
                            }}>
                                <FaUsers style={{ color: snsPrimary }} />
                                <span><strong style={{ color: theme.colors.primaryText }}>{snsList.length}</strong> SNS DAOs</span>
                            </div>
                        </div>

                        {/* CTA Buttons */}
                        <div style={{
                            display: 'flex',
                            justifyContent: 'center',
                            gap: '1rem',
                            flexWrap: 'wrap'
                        }}>
                            <Link
                                to={withSnsParam('/feed')}
                                style={{
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: '8px',
                                    background: `linear-gradient(135deg, ${snsPrimary}, ${snsSecondary})`,
                                    color: 'white',
                                    padding: '12px 24px',
                                    borderRadius: '12px',
                                    textDecoration: 'none',
                                    fontWeight: '600',
                                    fontSize: '0.95rem',
                                    boxShadow: `0 4px 20px ${snsPrimary}40`,
                                    transition: 'all 0.3s ease'
                                }}
                            >
                                <FaRss />
                                Open Feed
                            </Link>

                            <Link
                                to={withSnsParam('/forum')}
                                style={{
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: '8px',
                                    background: theme.colors.success,
                                    color: 'white',
                                    padding: '12px 24px',
                                    borderRadius: '12px',
                                    textDecoration: 'none',
                                    fontWeight: '600',
                                    fontSize: '0.95rem',
                                    boxShadow: `0 4px 20px ${theme.colors.success}40`,
                                    transition: 'all 0.3s ease'
                                }}
                            >
                                <FaComments />
                                Open Forum
                            </Link>

                            <Link
                                to={withSnsParam('/proposals')}
                                style={{
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: '8px',
                                    background: '#f59e0b',
                                    color: 'white',
                                    padding: '12px 24px',
                                    borderRadius: '12px',
                                    textDecoration: 'none',
                                    fontWeight: '600',
                                    fontSize: '0.95rem',
                                    boxShadow: '0 4px 20px rgba(245, 158, 11, 0.4)',
                                    transition: 'all 0.3s ease'
                                }}
                            >
                                <FaVoteYea />
                                Open Proposals
                            </Link>
                        </div>
                    </div>
                </div>

                {/* Content Section - Two columns */}
                <div style={{
                    display: 'flex',
                    flexDirection: isMobile ? 'column' : 'row',
                    gap: '2rem'
                }}>
                    {/* SNS List */}
                    <div style={{
                        flex: isMobile ? 'none' : '0 0 380px',
                        minWidth: isMobile ? 'auto' : '380px',
                        maxWidth: isMobile ? 'none' : '380px'
                    }}>
                        {/* Search and Sort Controls */}
                        <div
                            className="sns-card-animate"
                            style={{
                                background: theme.colors.secondaryBg,
                                borderRadius: '16px',
                                padding: '1.25rem',
                                marginBottom: '1.5rem',
                                border: `1px solid ${theme.colors.border}`,
                                animationDelay: '0.1s',
                                opacity: 0
                            }}
                        >
                            {/* Search Input */}
                            <div style={{
                                position: 'relative',
                                marginBottom: '1rem'
                            }}>
                                <FaSearch style={{
                                    position: 'absolute',
                                    left: '14px',
                                    top: '50%',
                                    transform: 'translateY(-50%)',
                                    color: theme.colors.mutedText,
                                    fontSize: '14px'
                                }} />
                                <input
                                    type="text"
                                    placeholder="Search SNS..."
                                    value={searchQuery}
                                    onChange={(e) => setSearchQuery(e.target.value)}
                                    style={{
                                        width: '100%',
                                        padding: '12px 14px 12px 40px',
                                        background: theme.colors.primaryBg,
                                        border: `1px solid ${theme.colors.border}`,
                                        borderRadius: '10px',
                                        color: theme.colors.primaryText,
                                        fontSize: '0.95rem',
                                        outline: 'none',
                                        transition: 'border-color 0.2s ease',
                                        boxSizing: 'border-box'
                                    }}
                                />
                            </div>

                            {/* Sort and Count */}
                            <div style={{
                                display: 'flex',
                                justifyContent: 'space-between',
                                alignItems: 'center',
                                flexWrap: 'wrap',
                                gap: '0.75rem'
                            }}>
                                <div style={{
                                    color: theme.colors.secondaryText,
                                    fontSize: '0.85rem',
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '6px'
                                }}>
                                    <FaUsers size={12} style={{ color: snsPrimary }} />
                                    <span><strong style={{ color: theme.colors.primaryText }}>{sortedList.length}</strong></span>
                                </div>
                                <select
                                    value={sortBy}
                                    onChange={(e) => setSortBy(e.target.value)}
                                    style={{
                                        backgroundColor: theme.colors.primaryBg,
                                        color: theme.colors.primaryText,
                                        border: `1px solid ${theme.colors.border}`,
                                        borderRadius: '8px',
                                        padding: '6px 10px',
                                        fontSize: '0.8rem',
                                        cursor: 'pointer',
                                        outline: 'none'
                                    }}
                                >
                                    <option value="age-newest">Newest</option>
                                    <option value="age-oldest">Oldest</option>
                                    <option value="name-asc">A-Z</option>
                                    <option value="name-desc">Z-A</option>
                                </select>
                            </div>
                        </div>

                        {/* SNS Cards */}
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                            {sortedList.map((sns, index) => {
                                const isSelected = sns.rootCanisterId === selectedSnsRoot;
                                const logo = snsLogos.get(sns.canisters.governance);
                                const isLoadingLogo = loadingLogos.has(sns.canisters.governance);
                                const startsWithAlphanumeric = /^[a-zA-Z0-9]/.test(sns.name);
                                const isHovered = hoveredCard === sns.rootCanisterId;

                                return (
                                    <div
                                        key={sns.rootCanisterId}
                                        className="sns-card-animate"
                                        onClick={() => handleSnsSelect(sns.rootCanisterId)}
                                        style={{
                                            background: isSelected
                                                ? `linear-gradient(135deg, ${snsPrimary}15 0%, ${snsSecondary}10 100%)`
                                                : theme.colors.secondaryBg,
                                            border: isSelected
                                                ? `2px solid ${snsPrimary}`
                                                : `1px solid ${isHovered ? snsPrimary : theme.colors.border}`,
                                            borderRadius: '12px',
                                            padding: '0.875rem 1rem',
                                            cursor: 'pointer',
                                            opacity: startsWithAlphanumeric ? 1 : 0.7,
                                            transition: 'all 0.2s ease',
                                            transform: isHovered ? 'translateX(4px)' : 'translateX(0)',
                                            boxShadow: isSelected
                                                ? `0 4px 20px ${snsPrimary}25`
                                                : 'none',
                                            animationDelay: `${0.15 + index * 0.02}s`,
                                            display: 'flex',
                                            alignItems: 'center',
                                            gap: '12px'
                                        }}
                                        onMouseEnter={() => setHoveredCard(sns.rootCanisterId)}
                                        onMouseLeave={() => setHoveredCard(null)}
                                    >
                                        {isLoadingLogo ? (
                                            <div style={{
                                                width: '36px',
                                                height: '36px',
                                                borderRadius: '50%',
                                                background: theme.colors.border,
                                                flexShrink: 0
                                            }} />
                                        ) : logo ? (
                                            <img
                                                src={logo}
                                                alt={sns.name}
                                                style={{
                                                    width: '36px',
                                                    height: '36px',
                                                    borderRadius: '50%',
                                                    objectFit: 'cover',
                                                    border: isSelected ? `2px solid ${snsPrimary}` : `2px solid ${theme.colors.border}`,
                                                    flexShrink: 0
                                                }}
                                            />
                                        ) : (
                                            <div style={{
                                                width: '36px',
                                                height: '36px',
                                                borderRadius: '50%',
                                                background: `linear-gradient(135deg, ${snsPrimary}30, ${snsSecondary}20)`,
                                                display: 'flex',
                                                alignItems: 'center',
                                                justifyContent: 'center',
                                                color: snsPrimary,
                                                fontSize: '12px',
                                                fontWeight: '700',
                                                flexShrink: 0
                                            }}>
                                                {sns.name.substring(0, 2).toUpperCase()}
                                            </div>
                                        )}
                                        <div style={{ minWidth: 0, flex: 1 }}>
                                            <div style={{
                                                color: startsWithAlphanumeric ? theme.colors.primaryText : theme.colors.mutedText,
                                                fontSize: '0.95rem',
                                                fontWeight: '600',
                                                overflow: 'hidden',
                                                textOverflow: 'ellipsis',
                                                whiteSpace: 'nowrap'
                                            }}>
                                                {sns.name}
                                            </div>
                                        </div>
                                        {isSelected && (
                                            <div style={{
                                                width: '8px',
                                                height: '8px',
                                                borderRadius: '50%',
                                                background: snsPrimary,
                                                flexShrink: 0
                                            }} />
                                        )}
                                    </div>
                                );
                            })}

                            {sortedList.length === 0 && searchQuery && (
                                <div style={{
                                    textAlign: 'center',
                                    padding: '2rem',
                                    background: theme.colors.secondaryBg,
                                    borderRadius: '12px',
                                    border: `1px solid ${theme.colors.border}`
                                }}>
                                    <FaSearch size={24} style={{ color: theme.colors.mutedText, marginBottom: '0.75rem' }} />
                                    <p style={{ color: theme.colors.secondaryText, fontSize: '0.9rem', margin: 0 }}>
                                        No SNS found
                                    </p>
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Selected SNS Details */}
                    <div style={{
                        flex: 1,
                        minWidth: 0
                    }}>
                        <div
                            className="sns-card-animate"
                            style={{
                                background: theme.colors.secondaryBg,
                                borderRadius: '20px',
                                padding: '1.75rem',
                                border: `1px solid ${theme.colors.border}`,
                                position: isMobile ? 'static' : 'sticky',
                                top: '2rem',
                                animationDelay: '0.2s',
                                opacity: 0
                            }}
                        >
                            {selectedSnsRoot ? (
                                <>
                                    {loadingDetails ? (
                                        <div style={{ textAlign: 'center', padding: '3rem 2rem' }}>
                                            <div className="sns-spin" style={{
                                                width: '40px',
                                                height: '40px',
                                                border: `3px solid ${theme.colors.border}`,
                                                borderTopColor: snsPrimary,
                                                borderRadius: '50%',
                                                margin: '0 auto 1rem'
                                            }} />
                                            <p style={{ color: theme.colors.mutedText }}>Loading SNS details...</p>
                                        </div>
                                    ) : selectedSnsDetails ? (
                                        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                                            {/* SNS Header */}
                                            <div style={{
                                                display: 'flex',
                                                alignItems: 'center',
                                                gap: '1rem',
                                                paddingBottom: '1.25rem',
                                                borderBottom: `1px solid ${theme.colors.border}`
                                            }}>
                                                {selectedLogo ? (
                                                    <img
                                                        src={selectedLogo}
                                                        alt={selectedSnsDetails.name}
                                                        style={{
                                                            width: '60px',
                                                            height: '60px',
                                                            borderRadius: '16px',
                                                            objectFit: 'cover',
                                                            border: `3px solid ${snsPrimary}40`
                                                        }}
                                                    />
                                                ) : (
                                                    <div style={{
                                                        width: '60px',
                                                        height: '60px',
                                                        borderRadius: '16px',
                                                        background: `linear-gradient(135deg, ${snsPrimary}, ${snsSecondary})`,
                                                        display: 'flex',
                                                        alignItems: 'center',
                                                        justifyContent: 'center',
                                                        color: 'white',
                                                        fontSize: '1.25rem',
                                                        fontWeight: '700'
                                                    }}>
                                                        {selectedSnsDetails.name?.substring(0, 2).toUpperCase() || 'SN'}
                                                    </div>
                                                )}
                                                <div style={{ flex: 1, minWidth: 0 }}>
                                                    <h2 style={{
                                                        color: theme.colors.primaryText,
                                                        fontSize: '1.5rem',
                                                        fontWeight: '700',
                                                        margin: 0,
                                                        marginBottom: '4px'
                                                    }}>
                                                        {selectedSnsDetails.name}
                                                    </h2>
                                                    <div style={{
                                                        display: 'flex',
                                                        alignItems: 'center',
                                                        gap: '8px',
                                                        flexWrap: 'wrap'
                                                    }}>
                                                        <span style={{
                                                            color: snsPrimary,
                                                            fontWeight: '600',
                                                            background: `${snsPrimary}15`,
                                                            padding: '2px 10px',
                                                            borderRadius: '6px',
                                                            fontSize: '0.85rem'
                                                        }}>
                                                            ${selectedSnsDetails.tokenSymbol}
                                                        </span>
                                                        {selectedSnsDetails.metadata?.url?.[0] && (
                                                            <a
                                                                href={selectedSnsDetails.metadata.url[0]}
                                                                target="_blank"
                                                                rel="noopener noreferrer"
                                                                style={{
                                                                    color: snsAccent,
                                                                    fontSize: '0.8rem',
                                                                    display: 'flex',
                                                                    alignItems: 'center',
                                                                    gap: '4px',
                                                                    textDecoration: 'none'
                                                                }}
                                                            >
                                                                <FaLink size={10} />
                                                                Website
                                                            </a>
                                                        )}
                                                    </div>
                                                </div>
                                            </div>

                                            {/* Description */}
                                            {selectedSnsDetails.metadata?.description?.[0] && (
                                                <div style={{
                                                    color: theme.colors.secondaryText,
                                                    fontSize: '0.9rem',
                                                    lineHeight: '1.6',
                                                    padding: '1rem',
                                                    background: theme.colors.primaryBg,
                                                    borderRadius: '12px'
                                                }}>
                                                    {selectedSnsDetails.metadata.description[0]}
                                                </div>
                                            )}

                                            {/* Token Info */}
                                            <div>
                                                <h3 style={{
                                                    color: snsPrimary,
                                                    fontSize: '0.85rem',
                                                    fontWeight: '600',
                                                    marginBottom: '0.75rem',
                                                    textTransform: 'uppercase',
                                                    letterSpacing: '0.5px',
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    gap: '8px'
                                                }}>
                                                    <FaCoins size={14} />
                                                    Token Information
                                                </h3>
                                                <div style={{
                                                    display: 'grid',
                                                    gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
                                                    gap: '0.75rem'
                                                }}>
                                                    <div style={{ background: theme.colors.primaryBg, borderRadius: '10px', padding: '0.75rem' }}>
                                                        <div style={{ color: theme.colors.mutedText, fontSize: '0.75rem', marginBottom: '4px' }}>Symbol</div>
                                                        <div style={{ color: theme.colors.primaryText, fontWeight: '600' }}>{selectedSnsDetails.tokenSymbol}</div>
                                                    </div>
                                                    <div style={{ background: theme.colors.primaryBg, borderRadius: '10px', padding: '0.75rem' }}>
                                                        <div style={{ color: theme.colors.mutedText, fontSize: '0.75rem', marginBottom: '4px' }}>Name</div>
                                                        <div style={{ color: theme.colors.primaryText, fontWeight: '600', fontSize: '0.9rem' }}>{selectedSnsDetails.tokenName}</div>
                                                    </div>
                                                    <div style={{ background: theme.colors.primaryBg, borderRadius: '10px', padding: '0.75rem' }}>
                                                        <div style={{ color: theme.colors.mutedText, fontSize: '0.75rem', marginBottom: '4px' }}>Decimals</div>
                                                        <div style={{ color: theme.colors.primaryText, fontWeight: '600' }}>{selectedSnsDetails.tokenDecimals}</div>
                                                    </div>
                                                    <div style={{ background: theme.colors.primaryBg, borderRadius: '10px', padding: '0.75rem' }}>
                                                        <div style={{ color: theme.colors.mutedText, fontSize: '0.75rem', marginBottom: '4px' }}>Total Supply</div>
                                                        <div style={{ color: theme.colors.primaryText, fontWeight: '600', fontSize: '0.85rem' }}>{formatE8s(selectedSnsDetails.totalSupply)}</div>
                                                    </div>
                                                    {selectedSnsDetails.transactionFee > 0n && (
                                                        <div style={{ background: theme.colors.primaryBg, borderRadius: '10px', padding: '0.75rem' }}>
                                                            <div style={{ color: theme.colors.mutedText, fontSize: '0.75rem', marginBottom: '4px' }}>Tx Fee</div>
                                                            <div style={{ color: theme.colors.primaryText, fontWeight: '600', fontSize: '0.85rem' }}>{formatE8s(selectedSnsDetails.transactionFee)}</div>
                                                        </div>
                                                    )}
                                                </div>
                                            </div>

                                            {/* Governance Parameters */}
                                            {selectedSnsDetails.nervousSystemParameters && (
                                                <div>
                                                    <h3 style={{
                                                        color: snsPrimary,
                                                        fontSize: '0.85rem',
                                                        fontWeight: '600',
                                                        marginBottom: '0.75rem',
                                                        textTransform: 'uppercase',
                                                        letterSpacing: '0.5px',
                                                        display: 'flex',
                                                        alignItems: 'center',
                                                        gap: '8px'
                                                    }}>
                                                        <FaShieldAlt size={14} />
                                                        Governance Parameters
                                                    </h3>
                                                    <div style={{
                                                        display: 'grid',
                                                        gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
                                                        gap: '0.75rem'
                                                    }}>
                                                        {selectedSnsDetails.nervousSystemParameters.neuron_minimum_stake_e8s?.[0] && (
                                                            <div style={{ background: theme.colors.primaryBg, borderRadius: '10px', padding: '0.75rem' }}>
                                                                <div style={{ color: theme.colors.mutedText, fontSize: '0.75rem', marginBottom: '4px' }}>Min Stake</div>
                                                                <div style={{ color: theme.colors.primaryText, fontWeight: '600', fontSize: '0.85rem' }}>
                                                                    {formatE8s(selectedSnsDetails.nervousSystemParameters.neuron_minimum_stake_e8s[0])}
                                                                </div>
                                                            </div>
                                                        )}
                                                        {selectedSnsDetails.nervousSystemParameters.max_dissolve_delay_seconds?.[0] && (
                                                            <div style={{ background: theme.colors.primaryBg, borderRadius: '10px', padding: '0.75rem' }}>
                                                                <div style={{ color: theme.colors.mutedText, fontSize: '0.75rem', marginBottom: '4px' }}>Max Dissolve</div>
                                                                <div style={{ color: theme.colors.primaryText, fontWeight: '600', fontSize: '0.85rem' }}>
                                                                    {formatDuration(selectedSnsDetails.nervousSystemParameters.max_dissolve_delay_seconds[0] * 1000000000n)}
                                                                </div>
                                                            </div>
                                                        )}
                                                        {selectedSnsDetails.nervousSystemParameters.proposal_reject_cost_e8s?.[0] && (
                                                            <div style={{ background: theme.colors.primaryBg, borderRadius: '10px', padding: '0.75rem' }}>
                                                                <div style={{ color: theme.colors.mutedText, fontSize: '0.75rem', marginBottom: '4px' }}>Reject Cost</div>
                                                                <div style={{ color: theme.colors.primaryText, fontWeight: '600', fontSize: '0.85rem' }}>
                                                                    {formatE8s(selectedSnsDetails.nervousSystemParameters.proposal_reject_cost_e8s[0])}
                                                                </div>
                                                            </div>
                                                        )}
                                                    </div>
                                                </div>
                                            )}

                                            {/* Canisters */}
                                            <div>
                                                <h3 style={{
                                                    color: snsPrimary,
                                                    fontSize: '0.85rem',
                                                    fontWeight: '600',
                                                    marginBottom: '0.75rem',
                                                    textTransform: 'uppercase',
                                                    letterSpacing: '0.5px',
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    gap: '8px'
                                                }}>
                                                    <FaServer size={14} />
                                                    SNS Canisters
                                                </h3>
                                                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                                                    {renderCanisterRow('Root', selectedSnsDetails.allCanisters?.root, <FaCube size={14} />, snsPrimary)}
                                                    {renderCanisterRow('Governance', selectedSnsDetails.allCanisters?.governance, <FaShieldAlt size={14} />, '#f59e0b')}
                                                    {renderCanisterRow('Ledger', selectedSnsDetails.allCanisters?.ledger, <FaCoins size={14} />, theme.colors.success)}
                                                    {renderCanisterRow('Swap', selectedSnsDetails.allCanisters?.swap, <FaExchangeAlt size={14} />, '#e74c3c')}
                                                    {renderCanisterRow('Index', selectedSnsDetails.allCanisters?.index, <FaSearch size={14} />, snsAccent)}
                                                    
                                                    {/* Dapp Canisters */}
                                                    {selectedSnsDetails.allCanisters?.dapps?.length > 0 && (
                                                        <>
                                                            <div style={{ 
                                                                color: theme.colors.mutedText, 
                                                                fontSize: '0.75rem', 
                                                                marginTop: '0.5rem',
                                                                textTransform: 'uppercase',
                                                                letterSpacing: '0.5px'
                                                            }}>
                                                                Dapp Canisters ({selectedSnsDetails.allCanisters.dapps.length})
                                                            </div>
                                                            {selectedSnsDetails.allCanisters.dapps.map((dapp, idx) => (
                                                                renderCanisterRow(`Dapp ${idx + 1}`, dapp, <FaCode size={14} />, '#9b59b6')
                                                            ))}
                                                        </>
                                                    )}
                                                    
                                                    {/* Archive Canisters */}
                                                    {selectedSnsDetails.allCanisters?.archives?.length > 0 && (
                                                        <>
                                                            <div style={{ 
                                                                color: theme.colors.mutedText, 
                                                                fontSize: '0.75rem', 
                                                                marginTop: '0.5rem',
                                                                textTransform: 'uppercase',
                                                                letterSpacing: '0.5px'
                                                            }}>
                                                                Archive Canisters ({selectedSnsDetails.allCanisters.archives.length})
                                                            </div>
                                                            {selectedSnsDetails.allCanisters.archives.map((archive, idx) => (
                                                                renderCanisterRow(`Archive ${idx + 1}`, archive, <FaArchive size={14} />, theme.colors.mutedText)
                                                            ))}
                                                        </>
                                                    )}
                                                </div>
                                            </div>

                                            {/* External Links */}
                                            <div>
                                                <h3 style={{
                                                    color: snsPrimary,
                                                    fontSize: '0.85rem',
                                                    fontWeight: '600',
                                                    marginBottom: '0.75rem',
                                                    textTransform: 'uppercase',
                                                    letterSpacing: '0.5px',
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    gap: '8px'
                                                }}>
                                                    <FaExternalLinkAlt size={12} />
                                                    External Links
                                                </h3>
                                                <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                                                    <a
                                                        href={`https://nns.ic0.app/project/?project=${selectedSnsRoot}`}
                                                        target="_blank"
                                                        rel="noopener noreferrer"
                                                        style={{
                                                            color: snsAccent,
                                                            textDecoration: 'none',
                                                            padding: '0.6rem 1rem',
                                                            background: theme.colors.primaryBg,
                                                            borderRadius: '10px',
                                                            display: 'flex',
                                                            alignItems: 'center',
                                                            gap: '8px',
                                                            fontSize: '0.85rem',
                                                            fontWeight: '500',
                                                            border: `1px solid transparent`,
                                                            transition: 'all 0.2s ease'
                                                        }}
                                                    >
                                                        NNS dApp
                                                        <FaArrowRight size={10} />
                                                    </a>
                                                    <a
                                                        href={`https://dashboard.internetcomputer.org/sns/${selectedSnsRoot}`}
                                                        target="_blank"
                                                        rel="noopener noreferrer"
                                                        style={{
                                                            color: snsAccent,
                                                            textDecoration: 'none',
                                                            padding: '0.6rem 1rem',
                                                            background: theme.colors.primaryBg,
                                                            borderRadius: '10px',
                                                            display: 'flex',
                                                            alignItems: 'center',
                                                            gap: '8px',
                                                            fontSize: '0.85rem',
                                                            fontWeight: '500',
                                                            border: `1px solid transparent`,
                                                            transition: 'all 0.2s ease'
                                                        }}
                                                    >
                                                        IC Dashboard
                                                        <FaArrowRight size={10} />
                                                    </a>
                                                </div>
                                            </div>

                                            {/* Explore This SNS */}
                                            <div>
                                                <h3 style={{
                                                    color: snsPrimary,
                                                    fontSize: '0.85rem',
                                                    fontWeight: '600',
                                                    marginBottom: '0.75rem',
                                                    textTransform: 'uppercase',
                                                    letterSpacing: '0.5px',
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    gap: '8px'
                                                }}>
                                                    <FaArrowRight size={12} />
                                                    Explore This SNS
                                                </h3>
                                                <div style={{
                                                    display: 'grid',
                                                    gridTemplateColumns: 'repeat(auto-fit, minmax(100px, 1fr))',
                                                    gap: '0.75rem'
                                                }}>
                                                    {[
                                                        { path: `/proposals?sns=${selectedSnsRoot}`, icon: <FaVoteYea size={18} />, label: 'Proposals', color: '#f59e0b' },
                                                        { path: `/forum?sns=${selectedSnsRoot}`, icon: <FaComments size={18} />, label: 'Forum', color: theme.colors.success },
                                                        { path: `/neurons?sns=${selectedSnsRoot}`, icon: <FaUsers size={18} />, label: 'Neurons', color: snsPrimary },
                                                        { path: `/transactions?sns=${selectedSnsRoot}`, icon: <FaHistory size={18} />, label: 'Transactions', color: snsAccent }
                                                    ].map((item) => (
                                                        <Link
                                                            key={item.path}
                                                            to={item.path}
                                                            style={{
                                                                display: 'flex',
                                                                flexDirection: 'column',
                                                                alignItems: 'center',
                                                                gap: '6px',
                                                                padding: '0.875rem',
                                                                background: theme.colors.primaryBg,
                                                                borderRadius: '12px',
                                                                textDecoration: 'none',
                                                                transition: 'all 0.2s ease',
                                                                border: `1px solid transparent`
                                                            }}
                                                            onMouseEnter={(e) => {
                                                                e.currentTarget.style.borderColor = item.color;
                                                                e.currentTarget.style.transform = 'translateY(-2px)';
                                                            }}
                                                            onMouseLeave={(e) => {
                                                                e.currentTarget.style.borderColor = 'transparent';
                                                                e.currentTarget.style.transform = 'translateY(0)';
                                                            }}
                                                        >
                                                            <div style={{ color: item.color }}>{item.icon}</div>
                                                            <span style={{ color: theme.colors.primaryText, fontSize: '0.8rem', fontWeight: '500' }}>{item.label}</span>
                                                        </Link>
                                                    ))}
                                                </div>
                                            </div>
                                        </div>
                                    ) : (
                                        <div style={{ textAlign: 'center', padding: '2rem', color: theme.colors.mutedText }}>
                                            Failed to load SNS details
                                        </div>
                                    )}
                                </>
                            ) : (
                                <div style={{ textAlign: 'center', padding: '3rem 2rem' }}>
                                    <div className="sns-float" style={{
                                        width: '70px',
                                        height: '70px',
                                        borderRadius: '50%',
                                        background: `linear-gradient(135deg, ${snsPrimary}30, ${snsSecondary}20)`,
                                        margin: '0 auto 1.5rem',
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                        color: snsPrimary
                                    }}>
                                        <FaGlobe size={28} />
                                    </div>
                                    <h2 style={{
                                        color: theme.colors.primaryText,
                                        marginBottom: '0.75rem',
                                        fontSize: '1.3rem',
                                        fontWeight: '600'
                                    }}>
                                        Select an SNS
                                    </h2>
                                    <p style={{ color: theme.colors.mutedText, fontSize: '0.95rem' }}>
                                        Choose an SNS from the list to view detailed information
                                    </p>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            </main>
        </div>
    );
}

export default Sns;
