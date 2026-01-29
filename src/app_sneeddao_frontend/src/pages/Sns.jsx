import React, { useState, useEffect } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { useAuth } from '../AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import { useSns } from '../contexts/SnsContext';
import Header from '../components/Header';
import { fetchAndCacheSnsData, fetchSnsLogo, getSnsById } from '../utils/SnsUtils';
import { createActor as createSnsGovernanceActor } from 'external/sns_governance';
import { createActor as createIcrc1Actor } from 'external/icrc1_ledger';
import { HttpAgent } from '@dfinity/agent';
import { formatE8s } from '../utils/NeuronUtils';
import { FaGlobe, FaVoteYea, FaComments, FaRss, FaExternalLinkAlt, FaChevronDown, FaChevronRight, FaSearch, FaCoins, FaServer, FaUsers, FaHistory, FaClock, FaShieldAlt, FaArrowRight } from 'react-icons/fa';

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
    const [expandedSns, setExpandedSns] = useState(new Set());
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
                        flex: isMobile ? 'none' : '1',
                        minWidth: isMobile ? 'auto' : '400px'
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
                                    placeholder="Search SNS by name or canister ID..."
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
                                        transition: 'border-color 0.2s ease'
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
                                    fontSize: '0.9rem',
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '6px'
                                }}>
                                    <FaUsers size={14} style={{ color: snsPrimary }} />
                                    <span><strong style={{ color: theme.colors.primaryText }}>{sortedList.length}</strong> SNS{sortedList.length !== 1 ? 'es' : ''} {searchQuery && 'found'}</span>
                                </div>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                    <label style={{ color: theme.colors.mutedText, fontSize: '0.85rem' }}>Sort:</label>
                                    <select
                                        value={sortBy}
                                        onChange={(e) => setSortBy(e.target.value)}
                                        style={{
                                            backgroundColor: theme.colors.primaryBg,
                                            color: theme.colors.primaryText,
                                            border: `1px solid ${theme.colors.border}`,
                                            borderRadius: '8px',
                                            padding: '8px 12px',
                                            fontSize: '0.85rem',
                                            cursor: 'pointer',
                                            outline: 'none'
                                        }}
                                    >
                                        <option value="age-newest">Newest First</option>
                                        <option value="age-oldest">Oldest First</option>
                                        <option value="name-asc">Name (A-Z)</option>
                                        <option value="name-desc">Name (Z-A)</option>
                                    </select>
                                </div>
                            </div>
                        </div>

                        {/* SNS Cards */}
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                            {sortedList.map((sns, index) => {
                                const isSelected = sns.rootCanisterId === selectedSnsRoot;
                                const isExpanded = expandedSns.has(sns.rootCanisterId);
                                const logo = snsLogos.get(sns.canisters.governance);
                                const isLoadingLogo = loadingLogos.has(sns.canisters.governance);
                                const startsWithAlphanumeric = /^[a-zA-Z0-9]/.test(sns.name);
                                const isHovered = hoveredCard === sns.rootCanisterId;

                                return (
                                    <div
                                        key={sns.rootCanisterId}
                                        className="sns-card-animate"
                                        style={{
                                            background: isSelected
                                                ? `linear-gradient(135deg, ${snsPrimary}15 0%, ${snsSecondary}10 100%)`
                                                : theme.colors.secondaryBg,
                                            border: isSelected
                                                ? `2px solid ${snsPrimary}`
                                                : `1px solid ${isHovered ? snsPrimary : theme.colors.border}`,
                                            borderRadius: '14px',
                                            overflow: 'hidden',
                                            opacity: startsWithAlphanumeric ? 1 : 0.7,
                                            transition: 'all 0.3s ease',
                                            transform: isHovered ? 'translateY(-2px)' : 'translateY(0)',
                                            boxShadow: isHovered
                                                ? `0 8px 25px ${snsPrimary}20`
                                                : isSelected
                                                    ? `0 4px 20px ${snsPrimary}25`
                                                    : '0 2px 10px rgba(0,0,0,0.05)',
                                            animationDelay: `${0.15 + index * 0.03}s`
                                        }}
                                        onMouseEnter={() => setHoveredCard(sns.rootCanisterId)}
                                        onMouseLeave={() => setHoveredCard(null)}
                                    >
                                        {/* SNS Header */}
                                        <div
                                            onClick={() => handleSnsSelect(sns.rootCanisterId)}
                                            style={{
                                                padding: '1rem 1.25rem',
                                                cursor: 'pointer',
                                                display: 'flex',
                                                alignItems: 'center',
                                                justifyContent: 'space-between',
                                                borderBottom: isExpanded ? `1px solid ${theme.colors.border}` : 'none'
                                            }}
                                        >
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
                                                {isLoadingLogo ? (
                                                    <div style={{
                                                        width: '40px',
                                                        height: '40px',
                                                        borderRadius: '50%',
                                                        background: `linear-gradient(135deg, ${theme.colors.border}, ${theme.colors.tertiaryBg || theme.colors.border})`
                                                    }} />
                                                ) : logo ? (
                                                    <img
                                                        src={logo}
                                                        alt={sns.name}
                                                        style={{
                                                            width: '40px',
                                                            height: '40px',
                                                            borderRadius: '50%',
                                                            objectFit: 'cover',
                                                            border: isSelected ? `2px solid ${snsPrimary}` : `2px solid ${theme.colors.border}`
                                                        }}
                                                    />
                                                ) : (
                                                    <div style={{
                                                        width: '40px',
                                                        height: '40px',
                                                        borderRadius: '50%',
                                                        background: `linear-gradient(135deg, ${snsPrimary}30, ${snsSecondary}20)`,
                                                        display: 'flex',
                                                        alignItems: 'center',
                                                        justifyContent: 'center',
                                                        color: snsPrimary,
                                                        fontSize: '14px',
                                                        fontWeight: '700'
                                                    }}>
                                                        {sns.name.substring(0, 2).toUpperCase()}
                                                    </div>
                                                )}
                                                <div>
                                                    <div style={{
                                                        color: startsWithAlphanumeric ? theme.colors.primaryText : theme.colors.mutedText,
                                                        fontSize: '1rem',
                                                        fontWeight: '600'
                                                    }}>
                                                        {sns.name}
                                                    </div>
                                                    <div style={{
                                                        color: theme.colors.mutedText,
                                                        fontSize: '0.75rem',
                                                        fontFamily: 'monospace'
                                                    }}>
                                                        {sns.rootCanisterId.slice(0, 8)}...{sns.rootCanisterId.slice(-8)}
                                                    </div>
                                                </div>
                                            </div>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                                {isSelected && (
                                                    <span style={{
                                                        background: `${snsPrimary}20`,
                                                        color: snsPrimary,
                                                        padding: '4px 10px',
                                                        borderRadius: '6px',
                                                        fontSize: '0.7rem',
                                                        fontWeight: '600',
                                                        textTransform: 'uppercase'
                                                    }}>
                                                        Selected
                                                    </span>
                                                )}
                                                <button
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        toggleSnsExpansion(sns.rootCanisterId);
                                                    }}
                                                    style={{
                                                        background: 'none',
                                                        border: 'none',
                                                        color: theme.colors.mutedText,
                                                        cursor: 'pointer',
                                                        padding: '4px',
                                                        display: 'flex',
                                                        alignItems: 'center',
                                                        transition: 'transform 0.2s ease',
                                                        transform: isExpanded ? 'rotate(180deg)' : 'none'
                                                    }}
                                                >
                                                    <FaChevronDown size={14} />
                                                </button>
                                            </div>
                                        </div>

                                        {/* Expanded Details */}
                                        {isExpanded && (
                                            <div style={{
                                                padding: '1.25rem',
                                                background: theme.colors.primaryBg
                                            }}>
                                                <div style={{
                                                    display: 'grid',
                                                    gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
                                                    gap: '1rem',
                                                    fontSize: '0.85rem'
                                                }}>
                                                    <div>
                                                        <div style={{ color: theme.colors.mutedText, marginBottom: '4px', fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Root Canister</div>
                                                        <div style={{
                                                            color: theme.colors.primaryText,
                                                            fontFamily: 'monospace',
                                                            fontSize: '0.75rem',
                                                            wordBreak: 'break-all'
                                                        }}>
                                                            {sns.rootCanisterId}
                                                        </div>
                                                    </div>
                                                    <div>
                                                        <div style={{ color: theme.colors.mutedText, marginBottom: '4px', fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Governance</div>
                                                        <div style={{
                                                            color: theme.colors.primaryText,
                                                            fontFamily: 'monospace',
                                                            fontSize: '0.75rem',
                                                            wordBreak: 'break-all'
                                                        }}>
                                                            {sns.canisters.governance}
                                                        </div>
                                                    </div>
                                                    <div>
                                                        <div style={{ color: theme.colors.mutedText, marginBottom: '4px', fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Ledger</div>
                                                        <div style={{
                                                            color: theme.colors.primaryText,
                                                            fontFamily: 'monospace',
                                                            fontSize: '0.75rem',
                                                            wordBreak: 'break-all'
                                                        }}>
                                                            {sns.canisters.ledger}
                                                        </div>
                                                    </div>
                                                    {sns.canisters.swap && (
                                                        <div>
                                                            <div style={{ color: theme.colors.mutedText, marginBottom: '4px', fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Swap</div>
                                                            <div style={{
                                                                color: theme.colors.primaryText,
                                                                fontFamily: 'monospace',
                                                                fontSize: '0.75rem',
                                                                wordBreak: 'break-all'
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

                            {sortedList.length === 0 && searchQuery && (
                                <div style={{
                                    textAlign: 'center',
                                    padding: '3rem 2rem',
                                    background: theme.colors.secondaryBg,
                                    borderRadius: '14px',
                                    border: `1px solid ${theme.colors.border}`
                                }}>
                                    <FaSearch size={32} style={{ color: theme.colors.mutedText, marginBottom: '1rem' }} />
                                    <p style={{ color: theme.colors.secondaryText, fontSize: '1rem' }}>
                                        No SNS found matching "{searchQuery}"
                                    </p>
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Selected SNS Details */}
                    <div style={{
                        flex: isMobile ? 'none' : '1',
                        minWidth: isMobile ? 'auto' : '450px'
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
                                    <div style={{
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: '12px',
                                        marginBottom: '1.5rem',
                                        paddingBottom: '1.25rem',
                                        borderBottom: `1px solid ${theme.colors.border}`
                                    }}>
                                        <div style={{
                                            width: '44px',
                                            height: '44px',
                                            borderRadius: '12px',
                                            background: `linear-gradient(135deg, ${snsPrimary}, ${snsSecondary})`,
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'center',
                                            boxShadow: `0 4px 15px ${snsPrimary}40`
                                        }}>
                                            <FaServer size={20} color="white" />
                                        </div>
                                        <h2 style={{
                                            color: theme.colors.primaryText,
                                            fontSize: '1.4rem',
                                            fontWeight: '700',
                                            margin: 0
                                        }}>
                                            SNS Details
                                        </h2>
                                    </div>

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
                                            <p style={{ color: theme.colors.mutedText }}>Loading detailed information...</p>
                                        </div>
                                    ) : selectedSnsDetails ? (
                                        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.75rem' }}>
                                            {/* Basic Info */}
                                            <div>
                                                <h3 style={{
                                                    color: snsPrimary,
                                                    fontSize: '0.9rem',
                                                    fontWeight: '600',
                                                    marginBottom: '1rem',
                                                    textTransform: 'uppercase',
                                                    letterSpacing: '0.5px',
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    gap: '8px'
                                                }}>
                                                    <FaCoins size={14} />
                                                    Basic Information
                                                </h3>
                                                <div style={{
                                                    background: theme.colors.primaryBg,
                                                    borderRadius: '12px',
                                                    padding: '1rem',
                                                    display: 'flex',
                                                    flexDirection: 'column',
                                                    gap: '0.75rem'
                                                }}>
                                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                                        <span style={{ color: theme.colors.mutedText, fontSize: '0.9rem' }}>Name</span>
                                                        <span style={{ color: theme.colors.primaryText, fontWeight: '600' }}>{selectedSnsDetails.name}</span>
                                                    </div>
                                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                                        <span style={{ color: theme.colors.mutedText, fontSize: '0.9rem' }}>Token Symbol</span>
                                                        <span style={{
                                                            color: snsPrimary,
                                                            fontWeight: '600',
                                                            background: `${snsPrimary}15`,
                                                            padding: '2px 10px',
                                                            borderRadius: '6px'
                                                        }}>
                                                            {selectedSnsDetails.tokenSymbol}
                                                        </span>
                                                    </div>
                                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                                        <span style={{ color: theme.colors.mutedText, fontSize: '0.9rem' }}>Total Supply</span>
                                                        <span style={{ color: theme.colors.primaryText, fontWeight: '500' }}>
                                                            {formatE8s(selectedSnsDetails.totalSupply)} {selectedSnsDetails.tokenSymbol}
                                                        </span>
                                                    </div>
                                                </div>

                                                {selectedSnsDetails.metadata?.description?.[0] && (
                                                    <div style={{ marginTop: '1rem' }}>
                                                        <div style={{ color: theme.colors.mutedText, marginBottom: '0.5rem', fontSize: '0.85rem' }}>Description</div>
                                                        <div style={{
                                                            color: theme.colors.secondaryText,
                                                            background: theme.colors.primaryBg,
                                                            padding: '1rem',
                                                            borderRadius: '12px',
                                                            fontSize: '0.9rem',
                                                            lineHeight: '1.6'
                                                        }}>
                                                            {selectedSnsDetails.metadata.description[0]}
                                                        </div>
                                                    </div>
                                                )}
                                            </div>

                                            {/* Governance Parameters */}
                                            {selectedSnsDetails.nervousSystemParameters && (
                                                <div>
                                                    <h3 style={{
                                                        color: snsPrimary,
                                                        fontSize: '0.9rem',
                                                        fontWeight: '600',
                                                        marginBottom: '1rem',
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
                                                        background: theme.colors.primaryBg,
                                                        borderRadius: '12px',
                                                        padding: '1rem',
                                                        display: 'flex',
                                                        flexDirection: 'column',
                                                        gap: '0.75rem'
                                                    }}>
                                                        {selectedSnsDetails.nervousSystemParameters.neuron_minimum_stake_e8s?.[0] && (
                                                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                                                <span style={{ color: theme.colors.mutedText, fontSize: '0.9rem' }}>Min Neuron Stake</span>
                                                                <span style={{ color: theme.colors.primaryText, fontWeight: '500' }}>
                                                                    {formatE8s(selectedSnsDetails.nervousSystemParameters.neuron_minimum_stake_e8s[0])} {selectedSnsDetails.tokenSymbol}
                                                                </span>
                                                            </div>
                                                        )}
                                                        {selectedSnsDetails.nervousSystemParameters.max_dissolve_delay_seconds?.[0] && (
                                                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                                                <span style={{ color: theme.colors.mutedText, fontSize: '0.9rem' }}>Max Dissolve Delay</span>
                                                                <span style={{ color: theme.colors.primaryText, fontWeight: '500' }}>
                                                                    {formatDuration(selectedSnsDetails.nervousSystemParameters.max_dissolve_delay_seconds[0] * 1000000000n)}
                                                                </span>
                                                            </div>
                                                        )}
                                                        {selectedSnsDetails.nervousSystemParameters.proposal_reject_cost_e8s?.[0] && (
                                                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                                                <span style={{ color: theme.colors.mutedText, fontSize: '0.9rem' }}>Proposal Reject Cost</span>
                                                                <span style={{ color: theme.colors.primaryText, fontWeight: '500' }}>
                                                                    {formatE8s(selectedSnsDetails.nervousSystemParameters.proposal_reject_cost_e8s[0])} {selectedSnsDetails.tokenSymbol}
                                                                </span>
                                                            </div>
                                                        )}
                                                    </div>
                                                </div>
                                            )}

                                            {/* External Links */}
                                            <div>
                                                <h3 style={{
                                                    color: snsPrimary,
                                                    fontSize: '0.9rem',
                                                    fontWeight: '600',
                                                    marginBottom: '1rem',
                                                    textTransform: 'uppercase',
                                                    letterSpacing: '0.5px',
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    gap: '8px'
                                                }}>
                                                    <FaExternalLinkAlt size={12} />
                                                    External Links
                                                </h3>
                                                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                                                    <a
                                                        href={`https://nns.ic0.app/project/?project=${selectedSnsRoot}`}
                                                        target="_blank"
                                                        rel="noopener noreferrer"
                                                        style={{
                                                            color: snsAccent,
                                                            textDecoration: 'none',
                                                            padding: '0.75rem 1rem',
                                                            background: theme.colors.primaryBg,
                                                            borderRadius: '10px',
                                                            display: 'flex',
                                                            alignItems: 'center',
                                                            justifyContent: 'space-between',
                                                            transition: 'all 0.2s ease',
                                                            border: `1px solid transparent`
                                                        }}
                                                        onMouseEnter={(e) => {
                                                            e.currentTarget.style.borderColor = snsAccent;
                                                            e.currentTarget.style.background = `${snsAccent}10`;
                                                        }}
                                                        onMouseLeave={(e) => {
                                                            e.currentTarget.style.borderColor = 'transparent';
                                                            e.currentTarget.style.background = theme.colors.primaryBg;
                                                        }}
                                                    >
                                                        <span>View on NNS dApp</span>
                                                        <FaArrowRight size={12} />
                                                    </a>
                                                    <a
                                                        href={`https://dashboard.internetcomputer.org/sns/${selectedSnsRoot}`}
                                                        target="_blank"
                                                        rel="noopener noreferrer"
                                                        style={{
                                                            color: snsAccent,
                                                            textDecoration: 'none',
                                                            padding: '0.75rem 1rem',
                                                            background: theme.colors.primaryBg,
                                                            borderRadius: '10px',
                                                            display: 'flex',
                                                            alignItems: 'center',
                                                            justifyContent: 'space-between',
                                                            transition: 'all 0.2s ease',
                                                            border: `1px solid transparent`
                                                        }}
                                                        onMouseEnter={(e) => {
                                                            e.currentTarget.style.borderColor = snsAccent;
                                                            e.currentTarget.style.background = `${snsAccent}10`;
                                                        }}
                                                        onMouseLeave={(e) => {
                                                            e.currentTarget.style.borderColor = 'transparent';
                                                            e.currentTarget.style.background = theme.colors.primaryBg;
                                                        }}
                                                    >
                                                        <span>View on IC Dashboard</span>
                                                        <FaArrowRight size={12} />
                                                    </a>
                                                </div>
                                            </div>

                                            {/* Internal Pages */}
                                            <div>
                                                <h3 style={{
                                                    color: snsPrimary,
                                                    fontSize: '0.9rem',
                                                    fontWeight: '600',
                                                    marginBottom: '1rem',
                                                    textTransform: 'uppercase',
                                                    letterSpacing: '0.5px',
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    gap: '8px'
                                                }}>
                                                    <FaChevronRight size={12} />
                                                    Explore This SNS
                                                </h3>
                                                <div style={{
                                                    display: 'grid',
                                                    gridTemplateColumns: 'repeat(2, 1fr)',
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
                                                                gap: '8px',
                                                                padding: '1rem',
                                                                background: theme.colors.primaryBg,
                                                                borderRadius: '12px',
                                                                textDecoration: 'none',
                                                                transition: 'all 0.2s ease',
                                                                border: `1px solid transparent`
                                                            }}
                                                            onMouseEnter={(e) => {
                                                                e.currentTarget.style.borderColor = item.color;
                                                                e.currentTarget.style.transform = 'translateY(-2px)';
                                                                e.currentTarget.style.boxShadow = `0 4px 15px ${item.color}25`;
                                                            }}
                                                            onMouseLeave={(e) => {
                                                                e.currentTarget.style.borderColor = 'transparent';
                                                                e.currentTarget.style.transform = 'translateY(0)';
                                                                e.currentTarget.style.boxShadow = 'none';
                                                            }}
                                                        >
                                                            <div style={{ color: item.color }}>{item.icon}</div>
                                                            <span style={{ color: theme.colors.primaryText, fontSize: '0.9rem', fontWeight: '500' }}>{item.label}</span>
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
