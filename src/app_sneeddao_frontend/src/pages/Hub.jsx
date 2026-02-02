import React, { useState, useEffect } from 'react';
import { useTheme } from '../contexts/ThemeContext';
import Header from '../components/Header';
import { Link } from 'react-router-dom';
import { FaExchangeAlt, FaCoins, FaLock, FaComments, FaWallet, FaServer, FaNewspaper, FaUsers, FaVoteYea, FaRss, FaArrowRight, FaHistory, FaStar, FaUnlock, FaShieldAlt, FaGlobe, FaBrain, FaGavel, FaCube, FaLayerGroup, FaStream, FaReply } from 'react-icons/fa';
import { HttpAgent } from '@dfinity/agent';
import { createActor as createForumActor, canisterId as forumCanisterId } from 'declarations/sneed_sns_forum';
import { createActor as createSnsGovernanceActor, canisterId as snsGovernanceCanisterId } from 'external/sns_governance';
import { createSneedexActor } from '../utils/SneedexUtils';
import { getSnsById } from '../utils/SnsUtils';
import priceService from '../services/PriceService';

// Constants
const SNEED_LEDGER_ID = 'hvgxa-wqaaa-aaaaq-aacia-cai';
const SNEED_DECIMALS = 8;
const ICP_CANISTER_ID = 'ryjl3-tyaaa-aaaaa-aaaba-cai';

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
    50% { transform: translateY(-8px); }
}

@keyframes gradientShift {
    0% { background-position: 0% 50%; }
    50% { background-position: 100% 50%; }
    100% { background-position: 0% 50%; }
}

@keyframes glow {
    0%, 100% { box-shadow: 0 0 20px rgba(99, 102, 241, 0.3); }
    50% { box-shadow: 0 0 40px rgba(99, 102, 241, 0.5); }
}

@keyframes tickerPulse {
    0%, 100% { transform: scale(1); }
    50% { transform: scale(1.02); }
}

@keyframes priceGlow {
    0%, 100% { text-shadow: 0 0 10px rgba(34, 197, 94, 0.3); }
    50% { text-shadow: 0 0 20px rgba(34, 197, 94, 0.6); }
}

.hub-card-animate {
    animation: fadeInUp 0.5s ease-out forwards;
    opacity: 0;
}

.hub-shimmer {
    background: linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.08) 50%, transparent 100%);
    background-size: 200% 100%;
    animation: shimmer 2s infinite;
}

.hub-pulse {
    animation: pulse 2s ease-in-out infinite;
}

.hub-float {
    animation: float 4s ease-in-out infinite;
}

.hub-glow {
    animation: glow 3s ease-in-out infinite;
}

.hub-gradient-animate {
    background-size: 200% 200%;
    animation: gradientShift 8s ease infinite;
}

.hub-price-ticker {
    animation: tickerPulse 3s ease-in-out infinite;
}

.hub-price-value {
    animation: priceGlow 2s ease-in-out infinite;
}

.hub-feed-item {
    transition: all 0.2s ease;
}

.hub-feed-item:hover {
    transform: translateX(4px);
    background-color: rgba(99, 102, 241, 0.08) !important;
}

.hub-activity-card:hover {
    transform: translateY(-2px);
    box-shadow: 0 8px 24px rgba(0,0,0,0.2);
}
`;

// Format relative time
const formatRelativeTime = (timestamp) => {
    const date = new Date(Number(timestamp) / 1000000);
    const now = new Date();
    const diffMs = now - date;
    const diffSeconds = Math.floor(diffMs / 1000);
    const diffMinutes = Math.floor(diffSeconds / 60);
    const diffHours = Math.floor(diffMinutes / 60);
    const diffDays = Math.floor(diffHours / 24);

    if (diffSeconds < 60) return 'just now';
    if (diffMinutes < 60) return `${diffMinutes}m`;
    if (diffHours < 24) return `${diffHours}h`;
    if (diffDays < 7) return `${diffDays}d`;
    return `${Math.floor(diffDays / 7)}w`;
};

// Extract variant key from Motoko variant type
const extractVariant = (variant) => {
    if (!variant) return 'unknown';
    const keys = Object.keys(variant);
    return keys.length > 0 ? keys[0].toLowerCase() : 'unknown';
};

// Get icon for feed item type
const getFeedTypeIcon = (type) => {
    switch (type) {
        case 'forum': return <FaComments size={12} />;
        case 'topic': return <FaLayerGroup size={12} />;
        case 'thread': return <FaStream size={12} />;
        case 'post': return <FaReply size={12} />;
        case 'auction': return <FaGavel size={12} />;
        default: return <FaRss size={12} />;
    }
};

// Get color for feed item type
const getFeedTypeColor = (type) => {
    switch (type) {
        case 'forum': return '#e74c3c';
        case 'topic': return '#3b82f6';
        case 'thread': return '#f97316';
        case 'post': return '#22c55e';
        case 'auction': return '#8b5cf6';
        default: return '#6b7280';
    }
};

// Accent colors for the hub
const hubPrimary = '#6366f1'; // Indigo
const hubSecondary = '#8b5cf6'; // Purple
const hubAccent = '#06b6d4'; // Cyan

function Hub() {
    const { theme } = useTheme();
    const [hoveredCard, setHoveredCard] = useState(null);
    
    // Dynamic data state
    const [prices, setPrices] = useState({
        sneedUsd: null,
        sneedIcp: null,
        icpUsd: null,
        loading: true
    });
    const [daoStats, setDaoStats] = useState({
        activeNeurons: null,
        totalNeurons: null,
        loading: true
    });
    const [feedItems, setFeedItems] = useState([]);
    const [offers, setOffers] = useState([]);
    const [activityLoading, setActivityLoading] = useState(true);
    const [snsLogos, setSnsLogos] = useState({});

    // Fetch prices
    useEffect(() => {
        const fetchPrices = async () => {
            try {
                const [icpUsd, sneedUsd] = await Promise.all([
                    priceService.getICPUSDPrice(),
                    priceService.getTokenUSDPrice(SNEED_LEDGER_ID, SNEED_DECIMALS)
                ]);
                
                const sneedIcp = icpUsd > 0 ? sneedUsd / icpUsd : 0;
                
                setPrices({
                    sneedUsd,
                    sneedIcp,
                    icpUsd,
                    loading: false
                });
            } catch (error) {
                console.error('Error fetching prices:', error);
                setPrices(prev => ({ ...prev, loading: false }));
            }
        };
        
        fetchPrices();
        const interval = setInterval(fetchPrices, 60000); // Refresh every minute
        return () => clearInterval(interval);
    }, []);

    // Fetch DAO stats
    useEffect(() => {
        const fetchDaoStats = async () => {
            try {
                const isLocal = process.env.DFX_NETWORK !== 'ic' && process.env.DFX_NETWORK !== 'staging';
                const host = isLocal ? 'http://localhost:4943' : 'https://ic0.app';
                const agent = new HttpAgent({ host });
                if (isLocal) await agent.fetchRootKey().catch(() => {});
                
                const snsGovActor = createSnsGovernanceActor(snsGovernanceCanisterId, { agent });
                const response = await snsGovActor.list_neurons({
                    limit: 0,
                    start_page_at: [],
                    of_principal: []
                });
                
                const activeNeurons = response.neurons.filter(neuron => {
                    if (!neuron.dissolve_state?.[0]) return false;
                    return 'DissolveDelaySeconds' in neuron.dissolve_state[0];
                }).length;
                
                setDaoStats({
                    activeNeurons,
                    totalNeurons: response.neurons.length,
                    loading: false
                });
            } catch (error) {
                console.error('Error fetching DAO stats:', error);
                setDaoStats(prev => ({ ...prev, loading: false }));
            }
        };
        
        fetchDaoStats();
    }, []);

    // Fetch feed items and offers
    useEffect(() => {
        const fetchActivity = async () => {
            setActivityLoading(true);
            try {
                const isLocal = process.env.DFX_NETWORK !== 'ic' && process.env.DFX_NETWORK !== 'staging';
                const host = isLocal ? 'http://localhost:4943' : 'https://ic0.app';
                const agent = new HttpAgent({ host });
                if (isLocal) await agent.fetchRootKey().catch(() => {});
                
                // Fetch forum feed items
                const forumActor = createForumActor(forumCanisterId, { agent });
                const feedResponse = await forumActor.get_feed({
                    start_id: [],
                    length: 5,
                    filter: []
                });
                
                // Get SNS logos from cached SNS data (no network calls needed)
                const snsRoots = [...new Set(feedResponse.items
                    .filter(item => item.sns_root_canister_id?.[0])
                    .map(item => item.sns_root_canister_id[0].toString()))];
                
                // Look up logos from cached SNS data - this is synchronous and won't error
                const logos = {};
                snsRoots.forEach(rootId => {
                    const snsData = getSnsById(rootId);
                    if (snsData?.logo) {
                        logos[rootId] = snsData.logo;
                    }
                });
                if (Object.keys(logos).length > 0) {
                    setSnsLogos(prev => ({ ...prev, ...logos }));
                }
                
                setFeedItems(feedResponse.items.slice(0, 5));
                
                // Fetch Sneedex offers
                try {
                    const sneedexActor = createSneedexActor(null);
                    const offerResponse = await sneedexActor.getOfferFeed({
                        start_id: [],
                        length: 5,
                        filter: [{
                            states: [[{ Active: null }]],
                            asset_types: [],
                            creator: [],
                            has_bids: [],
                            public_only: [true],
                            viewer: []
                        }]
                    });
                    if (offerResponse?.offers) {
                        setOffers(offerResponse.offers.slice(0, 5));
                    }
                } catch (e) {
                    // Silently fail - offers section will just be empty
                    console.warn('Could not fetch Sneedex offers:', e.message || e);
                }
            } catch (error) {
                console.error('Error fetching activity:', error);
            } finally {
                setActivityLoading(false);
            }
        };
        
        fetchActivity();
    }, []);

    // Format price display
    const formatPrice = (price, decimals = 4) => {
        if (price === null || price === undefined) return '...';
        if (price < 0.0001) return price.toExponential(2);
        if (price < 1) return price.toFixed(decimals);
        if (price < 100) return price.toFixed(2);
        return price.toLocaleString(undefined, { maximumFractionDigits: 2 });
    };

    const featuredProducts = [
        {
            title: 'Sneedex Marketplace',
            icon: <FaExchangeAlt size={28} />,
            desc: 'Trade canisters, neurons, tokens, and more through secure on-chain escrow. Buy and sell staking positions, neuron managers, and digital assets with confidence.',
            path: '/sneedex_offers',
            cta: 'Browse Marketplace',
            color: hubPrimary,
            badge: 'Popular',
            gradient: `linear-gradient(135deg, ${hubPrimary}20 0%, ${hubSecondary}10 100%)`,
        },
        {
            title: 'Liquid Staking',
            icon: <FaCoins size={28} />,
            desc: 'Make your staking positions tradable! Create ICP Neuron Manager canisters or stake SNS tokens in a way that keeps them transferable and sellable on Sneedex.',
            path: '/liquid_staking',
            cta: 'Start Staking',
            color: theme.colors.success,
            badge: 'New',
            gradient: `linear-gradient(135deg, ${theme.colors.success}20 0%, #10b98110 100%)`,
        },
        {
            title: 'Sneed Lock',
            icon: <FaLock size={28} />,
            desc: 'Lock tokens or ICPSwap liquidity positions with transferable "Liquid Locks" — keep your locks tradable on Sneedex. Perfect for team tokens, investor vesting, or secure savings.',
            path: '/sneedlock_info',
            cta: 'Create Lock',
            color: '#9b59b6',
            badge: 'New',
            gradient: `linear-gradient(135deg, #9b59b620 0%, #8e44ad10 100%)`,
        },
        {
            title: 'SNS Jailbreak',
            icon: <FaUnlock size={28} />,
            desc: 'Unlock your SNS neurons! Add your Sneed Wallet as a full controller to make neurons tradable on Sneedex, fully manageable from your wallet, and truly liquid.',
            path: '/tools/sns_jailbreak',
            cta: 'Jailbreak Neurons',
            color: '#e67e22',
            badge: 'Tool',
            gradient: `linear-gradient(135deg, #e67e2220 0%, #d3540010 100%)`,
        },
    ];

    const communityFeatures = [
        {
            title: 'SNS Forum',
            icon: <FaComments size={22} />,
            desc: 'Discuss proposals, share ideas, and engage with your DAO community. Rich text with Markdown and emoji support.',
            path: '/forum',
            cta: 'Visit Forum',
            color: '#e74c3c',
        },
        {
            title: 'Activity Feed',
            icon: <FaRss size={22} />,
            desc: 'Stay up to date with the latest activity across SNS DAOs. See proposals, votes, and community updates in real-time.',
            path: '/feed',
            cta: 'View Feed',
            color: '#f39c12',
        },
        {
            title: 'Direct Messages',
            icon: <FaUsers size={22} />,
            desc: 'Send private messages to other users with full Markdown and emoji support.',
            path: '/sms',
            cta: 'Open Messages',
            color: '#1abc9c',
        },
    ];

    const governanceFeatures = [
        {
            title: 'Proposals',
            icon: <FaVoteYea size={22} />,
            desc: 'Browse and vote on proposals across all SNS DAOs. Track voting activity and governance decisions.',
            path: '/proposals',
            cta: 'View Proposals',
            color: hubPrimary,
        },
        {
            title: 'Neurons',
            icon: <FaNewspaper size={22} />,
            desc: 'Explore neurons, manage voting power, and configure your staking positions.',
            path: '/neurons',
            cta: 'Browse Neurons',
            color: theme.colors.success,
        },
        {
            title: 'Users',
            icon: <FaUsers size={22} />,
            desc: 'Discover users with neuron holdings, see their stake, and explore their governance activity.',
            path: '/users',
            cta: 'Browse Users',
            color: '#f39c12',
        },
        {
            title: 'SNS Directory',
            icon: <FaUsers size={22} />,
            desc: 'Discover SNS DAOs and explore their governance, communities, and tokens.',
            path: '/sns',
            cta: 'Browse SNSes',
            color: '#9b59b6',
        },
    ];

    const utilityFeatures = [
        {
            title: 'Wallet',
            icon: <FaWallet size={22} />,
            desc: 'Track your token balances across all SNS tokens and ICP. Send, receive, and manage your assets.',
            path: '/wallet',
            cta: 'Open Wallet',
            color: hubPrimary,
        },
        {
            title: 'Canisters',
            icon: <FaServer size={22} />,
            desc: 'Monitor your canisters, check cycles, and manage canister ownership and controllers.',
            path: '/canisters',
            cta: 'Manage Canisters',
            color: theme.colors.success,
        },
        {
            title: 'Transactions',
            icon: <FaHistory size={22} />,
            desc: 'Browse and search transaction history across tokens. Track transfers, swaps, and more.',
            path: '/transactions',
            cta: 'View Transactions',
            color: '#9b59b6',
        },
    ];

    const renderFeatureCard = (card, index, sectionOffset = 0) => {
        const cardKey = `${card.title}-${index}`;
        const isHovered = hoveredCard === cardKey;
        
        return (
            <Link
                key={card.title}
                to={card.path}
                className="hub-card-animate"
                style={{
                    background: theme.colors.secondaryBg,
                    border: `1px solid ${isHovered ? card.color : theme.colors.border}`,
                    borderRadius: '16px',
                    padding: '1.5rem',
                    display: 'flex',
                    flexDirection: 'column',
                    textDecoration: 'none',
                    color: 'inherit',
                    transition: 'all 0.3s ease',
                    transform: isHovered ? 'translateY(-4px)' : 'translateY(0)',
                    boxShadow: isHovered 
                        ? `0 12px 40px ${card.color}25` 
                        : '0 2px 10px rgba(0,0,0,0.1)',
                    animationDelay: `${(sectionOffset + index) * 0.08}s`,
                    opacity: 0,
                }}
                onMouseEnter={() => setHoveredCard(cardKey)}
                onMouseLeave={() => setHoveredCard(null)}
            >
                <div style={{
                    width: '48px',
                    height: '48px',
                    borderRadius: '12px',
                    background: `${card.color}15`,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    marginBottom: '1rem',
                    color: card.color,
                    transition: 'all 0.3s ease',
                    transform: isHovered ? 'scale(1.1)' : 'scale(1)',
                }}>
                    {card.icon}
                </div>
                <div style={{
                    color: theme.colors.primaryText,
                    fontWeight: '700',
                    fontSize: '1.1rem',
                    marginBottom: '0.5rem',
                }}>
                    {card.title}
                </div>
                <div style={{
                    color: theme.colors.mutedText,
                    fontSize: '0.9rem',
                    lineHeight: '1.6',
                    marginBottom: '1rem',
                    flex: 1,
                }}>
                    {card.desc}
                </div>
                <div style={{
                    color: card.color,
                    fontWeight: '600',
                    fontSize: '0.9rem',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    transition: 'all 0.2s ease',
                    transform: isHovered ? 'translateX(4px)' : 'translateX(0)',
                }}>
                    {card.cta}
                    <FaArrowRight size={12} />
                </div>
            </Link>
        );
    };

    const renderSectionHeader = (icon, title, color, delay = 0) => (
        <div 
            className="hub-card-animate"
            style={{
                display: 'flex',
                alignItems: 'center',
                gap: '12px',
                marginBottom: '1.25rem',
                animationDelay: `${delay}s`,
                opacity: 0,
            }}
        >
            <div style={{
                width: '40px',
                height: '40px',
                borderRadius: '12px',
                background: `linear-gradient(135deg, ${color}, ${color}cc)`,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'white',
                boxShadow: `0 4px 15px ${color}40`,
            }}>
                {icon}
            </div>
            <h2 style={{
                fontSize: '1.5rem',
                fontWeight: '700',
                color: theme.colors.primaryText,
                margin: 0,
            }}>
                {title}
            </h2>
        </div>
    );

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
                maxWidth: '1200px',
                margin: '0 auto',
                padding: '2rem'
            }}>
                {/* Hero Section */}
                <div style={{
                    background: `linear-gradient(135deg, ${theme.colors.secondaryBg} 0%, ${hubPrimary}15 50%, ${hubSecondary}10 100%)`,
                    borderRadius: '24px',
                    padding: '3.5rem 2.5rem',
                    marginBottom: '2rem',
                    border: `1px solid ${theme.colors.border}`,
                    textAlign: 'center',
                    position: 'relative',
                    overflow: 'hidden',
                }}>
                    {/* Background decorations */}
                    <div style={{
                        position: 'absolute',
                        top: '-60%',
                        right: '-10%',
                        width: '500px',
                        height: '500px',
                        background: `radial-gradient(circle, ${hubPrimary}20 0%, transparent 70%)`,
                        borderRadius: '50%',
                        pointerEvents: 'none',
                    }} />
                    <div style={{
                        position: 'absolute',
                        bottom: '-40%',
                        left: '-5%',
                        width: '400px',
                        height: '400px',
                        background: `radial-gradient(circle, ${hubSecondary}15 0%, transparent 70%)`,
                        borderRadius: '50%',
                        pointerEvents: 'none',
                    }} />
                    <div style={{
                        position: 'absolute',
                        top: '20%',
                        left: '10%',
                        width: '200px',
                        height: '200px',
                        background: `radial-gradient(circle, ${hubAccent}10 0%, transparent 70%)`,
                        borderRadius: '50%',
                        pointerEvents: 'none',
                    }} />
                    
                    {/* Hero Content */}
                    <div style={{ position: 'relative', zIndex: 1 }}>
                        {/* Animated Icon */}
                        <div 
                            className="hub-float hub-glow"
                            style={{
                                width: '80px',
                                height: '80px',
                                borderRadius: '50%',
                                background: `linear-gradient(135deg, ${hubPrimary}, ${hubSecondary})`,
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                margin: '0 auto 1.5rem auto',
                                padding: '12px',
                                boxSizing: 'border-box',
                            }}
                        >
                            <img 
                                src="sneed_logo.png" 
                                alt="Sneed Logo" 
                                style={{
                                    width: '100%',
                                    height: '100%',
                                    borderRadius: '50%',
                                    objectFit: 'cover',
                                }}
                            />
                        </div>
                        
                        <h1 style={{
                            fontSize: 'clamp(2rem, 5vw, 3rem)',
                            fontWeight: '800',
                            color: theme.colors.primaryText,
                            marginBottom: '1.5rem',
                            letterSpacing: '-0.02em',
                            lineHeight: '1.2',
                        }}>
                            Your Home on the{' '}
                            <span style={{
                                background: `linear-gradient(135deg, ${hubPrimary}, ${hubSecondary})`,
                                WebkitBackgroundClip: 'text',
                                WebkitTextFillColor: 'transparent',
                                backgroundClip: 'text',
                            }}>
                                Internet Computer
                            </span>
                        </h1>
                        
                        <p style={{
                            color: theme.colors.secondaryText,
                            fontSize: '1.15rem',
                            lineHeight: '1.8',
                            maxWidth: '800px',
                            margin: '0 auto 2rem auto',
                        }}>
                            Trade assets on <Link to="/sneedex_offers" style={{ color: hubPrimary, fontWeight: '600', textDecoration: 'none' }}>Sneedex</Link>, 
                            unlock <Link to="/liquid_staking" style={{ color: theme.colors.success, fontWeight: '600', textDecoration: 'none' }}>liquid staking</Link> for ICP and SNS neurons, 
                            secure tokens with <Link to="/sneedlock_info" style={{ color: '#9b59b6', fontWeight: '600', textDecoration: 'none' }}>Sneed Lock</Link>, 
                            engage in <Link to="/proposals" style={{ color: hubPrimary, fontWeight: '600', textDecoration: 'none' }}>DAO governance</Link>, 
                            discuss in <Link to="/forum" style={{ color: '#e74c3c', fontWeight: '600', textDecoration: 'none' }}>forums</Link>, 
                            and manage everything from your <Link to="/wallet" style={{ color: hubAccent, fontWeight: '600', textDecoration: 'none' }}>wallet</Link>.
                        </p>
                        
                        {/* CTA Buttons */}
                        <div style={{
                            display: 'flex',
                            justifyContent: 'center',
                            gap: '1rem',
                            flexWrap: 'wrap',
                        }}>
                            <Link 
                                to="/sneedex_offers" 
                                style={{
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: '8px',
                                    background: `linear-gradient(135deg, ${hubPrimary}, ${hubSecondary})`,
                                    color: '#fff',
                                    padding: '14px 28px',
                                    borderRadius: '12px',
                                    textDecoration: 'none',
                                    fontWeight: '700',
                                    fontSize: '1rem',
                                    boxShadow: `0 4px 20px ${hubPrimary}40`,
                                    transition: 'all 0.3s ease',
                                }}
                            >
                                <FaExchangeAlt />
                                Browse Sneedex
                            </Link>
                            <Link 
                                to="/liquid_staking" 
                                style={{
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: '8px',
                                    background: theme.colors.success,
                                    color: '#fff',
                                    padding: '14px 28px',
                                    borderRadius: '12px',
                                    textDecoration: 'none',
                                    fontWeight: '700',
                                    fontSize: '1rem',
                                    boxShadow: `0 4px 20px ${theme.colors.success}40`,
                                    transition: 'all 0.3s ease',
                                }}
                            >
                                <FaCoins />
                                Liquid Staking
                            </Link>
                            <Link 
                                to="/sneedlock_info" 
                                style={{
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: '8px',
                                    background: '#9b59b6',
                                    color: '#fff',
                                    padding: '14px 28px',
                                    borderRadius: '12px',
                                    textDecoration: 'none',
                                    fontWeight: '700',
                                    fontSize: '1rem',
                                    boxShadow: '0 4px 20px rgba(155, 89, 182, 0.4)',
                                    transition: 'all 0.3s ease',
                                }}
                            >
                                <FaLock />
                                Sneed Lock
                            </Link>
                        </div>
                    </div>
                </div>

                {/* Live Price Ticker - Prominent at top */}
                <div style={{
                    background: `linear-gradient(135deg, ${theme.colors.secondaryBg} 0%, rgba(34, 197, 94, 0.08) 50%, rgba(99, 102, 241, 0.08) 100%)`,
                    border: `1px solid ${theme.colors.border}`,
                    borderRadius: '20px',
                    padding: '1.5rem 2rem',
                    marginBottom: '1.5rem',
                    boxShadow: '0 4px 20px rgba(0,0,0,0.1)',
                }}>
                    <div style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '2.5rem',
                        flexWrap: 'wrap',
                    }}>
                        {/* ICP Price */}
                        <div style={{ 
                            display: 'flex', 
                            alignItems: 'center', 
                            gap: '14px',
                            padding: '12px 20px',
                            background: 'rgba(34, 197, 94, 0.1)',
                            borderRadius: '14px',
                            border: '1px solid rgba(34, 197, 94, 0.2)',
                        }}>
                            <img 
                                src="https://swaprunner.com/icp_symbol.svg" 
                                alt="ICP" 
                                style={{ width: '40px', height: '40px', borderRadius: '50%' }}
                            />
                            <div>
                                <div style={{ fontSize: '0.7rem', color: theme.colors.mutedText, fontWeight: '600', textTransform: 'uppercase', letterSpacing: '0.5px' }}>ICP Price</div>
                                <div style={{ 
                                    fontSize: '1.5rem', 
                                    fontWeight: '800', 
                                    color: '#22c55e',
                                    lineHeight: 1.1
                                }}>
                                    ${prices.loading ? '...' : formatPrice(prices.icpUsd, 2)}
                                </div>
                            </div>
                        </div>

                        {/* SNEED Price */}
                        <div style={{ 
                            display: 'flex', 
                            alignItems: 'center', 
                            gap: '14px',
                            padding: '12px 20px',
                            background: `${hubPrimary}10`,
                            borderRadius: '14px',
                            border: `1px solid ${hubPrimary}20`,
                        }}>
                            <img 
                                src="sneed_logo.png" 
                                alt="SNEED" 
                                style={{ width: '40px', height: '40px', borderRadius: '50%' }}
                            />
                            <div>
                                <div style={{ fontSize: '0.7rem', color: theme.colors.mutedText, fontWeight: '600', textTransform: 'uppercase', letterSpacing: '0.5px' }}>SNEED Price</div>
                                <div style={{ 
                                    fontSize: '1.5rem', 
                                    fontWeight: '800', 
                                    color: hubPrimary,
                                    lineHeight: 1.1
                                }}>
                                    ${prices.loading ? '...' : formatPrice(prices.sneedUsd, 6)}
                                </div>
                                <div style={{ fontSize: '0.75rem', color: theme.colors.mutedText, marginTop: '2px' }}>
                                    {prices.loading ? '' : `${formatPrice(prices.sneedIcp, 8)} ICP`}
                                </div>
                            </div>
                        </div>

                        {/* DAO Stats */}
                        <div style={{ 
                            display: 'flex', 
                            alignItems: 'center', 
                            gap: '14px',
                            padding: '12px 20px',
                            background: 'rgba(16, 185, 129, 0.1)',
                            borderRadius: '14px',
                            border: '1px solid rgba(16, 185, 129, 0.2)',
                        }}>
                            <div style={{ 
                                width: '40px', 
                                height: '40px', 
                                borderRadius: '50%',
                                background: 'linear-gradient(135deg, #10b981, #059669)',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center'
                            }}>
                                <FaBrain size={18} style={{ color: 'white' }} />
                            </div>
                            <div>
                                <div style={{ fontSize: '0.7rem', color: theme.colors.mutedText, fontWeight: '600', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Sneed DAO</div>
                                <div style={{ 
                                    fontSize: '1.5rem', 
                                    fontWeight: '800', 
                                    color: '#10b981',
                                    lineHeight: 1.1
                                }}>
                                    {daoStats.loading ? '...' : daoStats.activeNeurons?.toLocaleString() || '0'}
                                </div>
                                <div style={{ fontSize: '0.75rem', color: theme.colors.mutedText, marginTop: '2px' }}>
                                    Active Neurons
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Live Activity Section */}
                <div style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fit, minmax(400px, 1fr))',
                    gap: '1.5rem',
                    marginBottom: '2.5rem',
                }}>
                    {/* Sneed Forum Activity */}
                    <div style={{
                        background: `linear-gradient(145deg, ${theme.colors.secondaryBg} 0%, ${theme.colors.primaryBg} 100%)`,
                        border: `1px solid ${theme.colors.border}`,
                        borderRadius: '20px',
                        overflow: 'hidden',
                        boxShadow: '0 4px 20px rgba(0,0,0,0.1)',
                    }}>
                        {/* Branded Header */}
                        <div style={{
                            background: 'linear-gradient(135deg, #f97316 0%, #ea580c 100%)',
                            padding: '16px 20px',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                        }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                                <div style={{
                                    width: '42px',
                                    height: '42px',
                                    borderRadius: '12px',
                                    background: 'rgba(255,255,255,0.2)',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                }}>
                                    <FaComments size={20} style={{ color: 'white' }} />
                                </div>
                                <div>
                                    <div style={{ color: 'white', fontWeight: '700', fontSize: '1.1rem' }}>Sneed Forum</div>
                                    <div style={{ color: 'rgba(255,255,255,0.8)', fontSize: '0.75rem' }}>Latest discussions</div>
                                </div>
                            </div>
                            <Link 
                                to="/feed" 
                                style={{ 
                                    color: 'white', 
                                    textDecoration: 'none', 
                                    fontSize: '0.85rem',
                                    fontWeight: '600',
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '6px',
                                    background: 'rgba(255,255,255,0.2)',
                                    padding: '8px 14px',
                                    borderRadius: '8px',
                                    transition: 'all 0.2s ease',
                                }}
                            >
                                View All <FaArrowRight size={12} />
                            </Link>
                        </div>

                        {/* Feed Items */}
                        <div style={{ padding: '16px' }}>
                            {activityLoading ? (
                                <div style={{ textAlign: 'center', padding: '2rem', color: theme.colors.mutedText }}>
                                    <div style={{ marginBottom: '8px' }}>Loading...</div>
                                </div>
                            ) : feedItems.length === 0 ? (
                                <div style={{ textAlign: 'center', padding: '2rem', color: theme.colors.mutedText }}>
                                    No recent activity
                                </div>
                            ) : (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                                    {feedItems.map((item, index) => {
                                        const itemType = extractVariant(item.item_type);
                                        const typeColor = getFeedTypeColor(itemType);
                                        const snsRoot = item.sns_root_canister_id?.[0]?.toString();
                                        const snsLogo = snsRoot ? snsLogos[snsRoot] : null;
                                        const snsData = snsRoot ? getSnsById(snsRoot) : null;
                                        
                                        let itemLink = '/feed';
                                        if (itemType === 'thread') {
                                            itemLink = `/thread?threadid=${item.thread_id?.[0] || item.id}`;
                                        } else if (itemType === 'post') {
                                            itemLink = `/thread?threadid=${item.thread_id?.[0]}&postid=${item.id}`;
                                        } else if (itemType === 'topic') {
                                            itemLink = `/topic?topicid=${item.topic_id?.[0] || item.id}`;
                                        }
                                        
                                        return (
                                            <Link
                                                key={`feed-${item.id}-${index}`}
                                                to={itemLink}
                                                style={{
                                                    display: 'flex',
                                                    alignItems: 'flex-start',
                                                    gap: '12px',
                                                    padding: '14px 16px',
                                                    background: theme.colors.primaryBg,
                                                    borderRadius: '12px',
                                                    textDecoration: 'none',
                                                    border: `1px solid ${theme.colors.border}`,
                                                    transition: 'all 0.2s ease',
                                                }}
                                                onMouseEnter={(e) => {
                                                    e.currentTarget.style.transform = 'translateX(4px)';
                                                    e.currentTarget.style.borderColor = typeColor;
                                                }}
                                                onMouseLeave={(e) => {
                                                    e.currentTarget.style.transform = 'translateX(0)';
                                                    e.currentTarget.style.borderColor = theme.colors.border;
                                                }}
                                            >
                                                {/* SNS Logo */}
                                                <div style={{
                                                    width: '40px',
                                                    height: '40px',
                                                    borderRadius: '10px',
                                                    background: `linear-gradient(135deg, ${typeColor}30, ${typeColor}15)`,
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    justifyContent: 'center',
                                                    flexShrink: 0,
                                                    overflow: 'hidden',
                                                }}>
                                                    {snsLogo ? (
                                                        <img src={snsLogo} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                                                    ) : (
                                                        getFeedTypeIcon(itemType)
                                                    )}
                                                </div>
                                                
                                                <div style={{ flex: 1, minWidth: 0 }}>
                                                    {/* Header row */}
                                                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px', flexWrap: 'wrap' }}>
                                                        <span style={{
                                                            display: 'inline-flex',
                                                            alignItems: 'center',
                                                            gap: '4px',
                                                            padding: '3px 8px',
                                                            borderRadius: '6px',
                                                            background: typeColor,
                                                            color: 'white',
                                                            fontSize: '0.7rem',
                                                            fontWeight: '700',
                                                            textTransform: 'uppercase',
                                                        }}>
                                                            {getFeedTypeIcon(itemType)}
                                                            {itemType}
                                                        </span>
                                                        {snsData && (
                                                            <span style={{
                                                                fontSize: '0.75rem',
                                                                color: theme.colors.mutedText,
                                                                background: theme.colors.secondaryBg,
                                                                padding: '3px 8px',
                                                                borderRadius: '6px',
                                                            }}>
                                                                {snsData.name}
                                                            </span>
                                                        )}
                                                        <span style={{ fontSize: '0.75rem', color: theme.colors.mutedText, marginLeft: 'auto' }}>
                                                            {formatRelativeTime(item.created_at)}
                                                        </span>
                                                    </div>
                                                    
                                                    {/* Title */}
                                                    <div style={{
                                                        color: theme.colors.primaryText,
                                                        fontSize: '0.95rem',
                                                        fontWeight: '600',
                                                        overflow: 'hidden',
                                                        textOverflow: 'ellipsis',
                                                        whiteSpace: 'nowrap',
                                                        marginBottom: '4px',
                                                    }}>
                                                        {item.title || 'Untitled'}
                                                    </div>
                                                    
                                                    {/* Body preview */}
                                                    {item.body && (
                                                        <div style={{
                                                            color: theme.colors.secondaryText,
                                                            fontSize: '0.8rem',
                                                            overflow: 'hidden',
                                                            textOverflow: 'ellipsis',
                                                            whiteSpace: 'nowrap',
                                                        }}>
                                                            {item.body.slice(0, 80)}{item.body.length > 80 ? '...' : ''}
                                                        </div>
                                                    )}
                                                </div>
                                            </Link>
                                        );
                                    })}
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Sneedex Marketplace */}
                    <div style={{
                        background: `linear-gradient(145deg, ${theme.colors.secondaryBg} 0%, ${theme.colors.primaryBg} 100%)`,
                        border: `1px solid ${theme.colors.border}`,
                        borderRadius: '20px',
                        overflow: 'hidden',
                        boxShadow: '0 4px 20px rgba(0,0,0,0.1)',
                    }}>
                        {/* Branded Header */}
                        <div style={{
                            background: `linear-gradient(135deg, ${hubPrimary} 0%, ${hubSecondary} 100%)`,
                            padding: '16px 20px',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                        }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                                <div style={{
                                    width: '42px',
                                    height: '42px',
                                    borderRadius: '12px',
                                    background: 'rgba(255,255,255,0.2)',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                }}>
                                    <FaExchangeAlt size={20} style={{ color: 'white' }} />
                                </div>
                                <div>
                                    <div style={{ color: 'white', fontWeight: '700', fontSize: '1.1rem' }}>Sneedex</div>
                                    <div style={{ color: 'rgba(255,255,255,0.8)', fontSize: '0.75rem' }}>Active marketplace offers</div>
                                </div>
                            </div>
                            <Link 
                                to="/sneedex_offers" 
                                style={{ 
                                    color: 'white', 
                                    textDecoration: 'none', 
                                    fontSize: '0.85rem',
                                    fontWeight: '600',
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '6px',
                                    background: 'rgba(255,255,255,0.2)',
                                    padding: '8px 14px',
                                    borderRadius: '8px',
                                    transition: 'all 0.2s ease',
                                }}
                            >
                                Browse All <FaArrowRight size={12} />
                            </Link>
                        </div>

                        {/* Offers */}
                        <div style={{ padding: '16px' }}>
                            {activityLoading ? (
                                <div style={{ textAlign: 'center', padding: '2rem', color: theme.colors.mutedText }}>
                                    <div style={{ marginBottom: '8px' }}>Loading...</div>
                                </div>
                            ) : offers.length === 0 ? (
                                <div style={{ textAlign: 'center', padding: '2rem', color: theme.colors.mutedText }}>
                                    No active offers
                                </div>
                            ) : (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                                    {offers.map((offer, index) => {
                                        const assetCount = offer.assets?.length || 0;
                                        const firstAsset = offer.assets?.[0];
                                        let assetType = 'Asset';
                                        let assetIcon = <FaCube size={16} style={{ color: 'white' }} />;
                                        let assetColor = hubPrimary;
                                        
                                        if (firstAsset) {
                                            if ('Canister' in firstAsset) {
                                                assetType = 'Canister';
                                                assetIcon = <FaServer size={16} style={{ color: 'white' }} />;
                                                assetColor = '#3b82f6';
                                            } else if ('SNSNeuron' in firstAsset) {
                                                assetType = 'SNS Neuron';
                                                assetIcon = <FaBrain size={16} style={{ color: 'white' }} />;
                                                assetColor = '#10b981';
                                            } else if ('ICRC1Token' in firstAsset) {
                                                assetType = 'Tokens';
                                                assetIcon = <FaCoins size={16} style={{ color: 'white' }} />;
                                                assetColor = '#f59e0b';
                                            } else if ('NeuronManager' in firstAsset) {
                                                assetType = 'ICP Neuron';
                                                assetIcon = <FaBrain size={16} style={{ color: 'white' }} />;
                                                assetColor = '#8b5cf6';
                                            }
                                        }
                                        
                                        return (
                                            <Link
                                                key={`offer-${offer.id}-${index}`}
                                                to={`/sneedex_offer?id=${offer.id}`}
                                                style={{
                                                    display: 'flex',
                                                    alignItems: 'flex-start',
                                                    gap: '12px',
                                                    padding: '14px 16px',
                                                    background: theme.colors.primaryBg,
                                                    borderRadius: '12px',
                                                    textDecoration: 'none',
                                                    border: `1px solid ${theme.colors.border}`,
                                                    transition: 'all 0.2s ease',
                                                }}
                                                onMouseEnter={(e) => {
                                                    e.currentTarget.style.transform = 'translateX(4px)';
                                                    e.currentTarget.style.borderColor = assetColor;
                                                }}
                                                onMouseLeave={(e) => {
                                                    e.currentTarget.style.transform = 'translateX(0)';
                                                    e.currentTarget.style.borderColor = theme.colors.border;
                                                }}
                                            >
                                                {/* Asset Icon */}
                                                <div style={{
                                                    width: '40px',
                                                    height: '40px',
                                                    borderRadius: '10px',
                                                    background: `linear-gradient(135deg, ${assetColor}, ${assetColor}cc)`,
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    justifyContent: 'center',
                                                    flexShrink: 0,
                                                }}>
                                                    {assetIcon}
                                                </div>
                                                
                                                <div style={{ flex: 1, minWidth: 0 }}>
                                                    {/* Header row */}
                                                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px', flexWrap: 'wrap' }}>
                                                        <span style={{
                                                            display: 'inline-flex',
                                                            alignItems: 'center',
                                                            gap: '4px',
                                                            padding: '3px 8px',
                                                            borderRadius: '6px',
                                                            background: assetColor,
                                                            color: 'white',
                                                            fontSize: '0.7rem',
                                                            fontWeight: '700',
                                                            textTransform: 'uppercase',
                                                        }}>
                                                            {assetType}
                                                        </span>
                                                        {assetCount > 1 && (
                                                            <span style={{
                                                                fontSize: '0.75rem',
                                                                color: theme.colors.mutedText,
                                                                background: theme.colors.secondaryBg,
                                                                padding: '3px 8px',
                                                                borderRadius: '6px',
                                                            }}>
                                                                +{assetCount - 1} more
                                                            </span>
                                                        )}
                                                        <span style={{ fontSize: '0.75rem', color: theme.colors.mutedText, marginLeft: 'auto' }}>
                                                            {formatRelativeTime(offer.created_at)}
                                                        </span>
                                                    </div>
                                                    
                                                    {/* Offer title */}
                                                    <div style={{
                                                        color: theme.colors.primaryText,
                                                        fontSize: '0.95rem',
                                                        fontWeight: '600',
                                                        marginBottom: '4px',
                                                    }}>
                                                        Offer #{offer.id?.toString()}
                                                    </div>
                                                    
                                                    {/* Public note or asset summary */}
                                                    <div style={{
                                                        color: theme.colors.secondaryText,
                                                        fontSize: '0.8rem',
                                                        overflow: 'hidden',
                                                        textOverflow: 'ellipsis',
                                                        whiteSpace: 'nowrap',
                                                    }}>
                                                        {offer.public_note?.[0] 
                                                            ? offer.public_note[0].slice(0, 60) + (offer.public_note[0].length > 60 ? '...' : '')
                                                            : `${assetCount} asset${assetCount !== 1 ? 's' : ''} for sale`
                                                        }
                                                    </div>
                                                </div>
                                            </Link>
                                        );
                                    })}
                                </div>
                            )}
                        </div>
                    </div>
                </div>

                {/* Context Note */}
                <div 
                    className="hub-card-animate hub-shimmer"
                    style={{
                        background: `linear-gradient(135deg, ${hubPrimary}10 0%, ${hubSecondary}08 100%)`,
                        border: `1px solid ${hubPrimary}30`,
                        borderRadius: '14px',
                        padding: '1rem 1.5rem',
                        marginBottom: '2.5rem',
                        textAlign: 'center',
                        color: theme.colors.secondaryText,
                        fontSize: '0.95rem',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '10px',
                        animationDelay: '0.25s',
                        opacity: 0,
                    }}
                >
                    <span style={{ fontSize: '1.2rem' }}>💡</span>
                    <span>
                        Use the <strong style={{ color: hubPrimary }}>SNS dropdown</strong> in the header to switch context across DAOs anywhere on the site.
                    </span>
                </div>

                {/* Value Props */}
                <div style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
                    gap: '1rem',
                    marginBottom: '3rem',
                }}>
                    {[
                        { icon: <FaShieldAlt size={20} />, title: 'Secure Escrow', desc: 'On-chain trading', color: hubPrimary },
                        { icon: <FaCoins size={20} />, title: 'Liquid Positions', desc: 'Tradable staking', color: theme.colors.success },
                        { icon: <FaGlobe size={20} />, title: 'Multi-DAO', desc: 'All SNS in one place', color: '#9b59b6' },
                    ].map((item, idx) => (
                        <div 
                            key={item.title}
                            className="hub-card-animate"
                            style={{
                                background: theme.colors.secondaryBg,
                                borderRadius: '14px',
                                padding: '1.25rem',
                                border: `1px solid ${theme.colors.border}`,
                                display: 'flex',
                                alignItems: 'center',
                                gap: '1rem',
                                animationDelay: `${0.15 + idx * 0.08}s`,
                                opacity: 0,
                            }}
                        >
                            <div style={{
                                width: '44px',
                                height: '44px',
                                borderRadius: '12px',
                                background: `linear-gradient(135deg, ${item.color}25, ${item.color}10)`,
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                color: item.color,
                                flexShrink: 0,
                            }}>
                                {item.icon}
                            </div>
                            <div>
                                <div style={{ color: theme.colors.primaryText, fontWeight: '600', fontSize: '1rem' }}>
                                    {item.title}
                                </div>
                                <div style={{ color: theme.colors.mutedText, fontSize: '0.85rem' }}>
                                    {item.desc}
                                </div>
                            </div>
                        </div>
                    ))}
                </div>

                {/* Featured Products */}
                <div style={{ marginBottom: '3rem' }}>
                    {renderSectionHeader(<FaStar size={20} />, 'Featured Products', hubPrimary, 0.3)}
                    
                    <div style={{
                        display: 'grid',
                        gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
                        gap: '1.25rem',
                    }}>
                        {featuredProducts.map((product, index) => {
                            const cardKey = `featured-${product.title}`;
                            const isHovered = hoveredCard === cardKey;
                            
                            return (
                                <Link
                                    key={product.title}
                                    to={product.path}
                                    className="hub-card-animate"
                                    style={{
                                        background: product.gradient,
                                        border: `2px solid ${isHovered ? product.color : `${product.color}30`}`,
                                        borderRadius: '20px',
                                        padding: '1.75rem',
                                        display: 'flex',
                                        flexDirection: 'column',
                                        textDecoration: 'none',
                                        color: 'inherit',
                                        position: 'relative',
                                        overflow: 'hidden',
                                        transition: 'all 0.3s ease',
                                        transform: isHovered ? 'translateY(-6px)' : 'translateY(0)',
                                        boxShadow: isHovered 
                                            ? `0 20px 50px ${product.color}30` 
                                            : '0 4px 20px rgba(0,0,0,0.1)',
                                        animationDelay: `${0.4 + index * 0.1}s`,
                                        opacity: 0,
                                    }}
                                    onMouseEnter={() => setHoveredCard(cardKey)}
                                    onMouseLeave={() => setHoveredCard(null)}
                                >
                                    {/* Badge */}
                                    <div style={{
                                        position: 'absolute',
                                        top: '1rem',
                                        right: '1rem',
                                        background: `${product.color}20`,
                                        color: product.color,
                                        padding: '4px 12px',
                                        borderRadius: '20px',
                                        fontSize: '0.75rem',
                                        fontWeight: '700',
                                        textTransform: 'uppercase',
                                        letterSpacing: '0.5px',
                                    }}>
                                        {product.badge}
                                    </div>
                                    
                                    {/* Icon */}
                                    <div style={{
                                        width: '56px',
                                        height: '56px',
                                        borderRadius: '16px',
                                        background: `linear-gradient(135deg, ${product.color}30, ${product.color}15)`,
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                        color: product.color,
                                        marginBottom: '1.25rem',
                                        transition: 'all 0.3s ease',
                                        transform: isHovered ? 'scale(1.1) rotate(5deg)' : 'scale(1)',
                                    }}>
                                        {product.icon}
                                    </div>
                                    
                                    <div style={{
                                        fontSize: '1.35rem',
                                        fontWeight: '700',
                                        color: theme.colors.primaryText,
                                        marginBottom: '0.75rem',
                                    }}>
                                        {product.title}
                                    </div>
                                    
                                    <div style={{
                                        color: theme.colors.secondaryText,
                                        fontSize: '0.95rem',
                                        lineHeight: '1.7',
                                        marginBottom: '1.5rem',
                                        flex: 1,
                                    }}>
                                        {product.desc}
                                    </div>
                                    
                                    <div style={{
                                        color: product.color,
                                        fontWeight: '600',
                                        fontSize: '0.95rem',
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: '6px',
                                        transition: 'all 0.2s ease',
                                        transform: isHovered ? 'translateX(6px)' : 'translateX(0)',
                                    }}>
                                        {product.cta}
                                        <FaArrowRight size={14} />
                                    </div>
                                </Link>
                            );
                        })}
                    </div>
                </div>

                {/* Community & Social */}
                <div style={{ marginBottom: '3rem' }}>
                    {renderSectionHeader(<FaComments size={20} />, 'Community & Social', '#e74c3c', 0.8)}
                    <div style={{
                        display: 'grid',
                        gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
                        gap: '1rem',
                    }}>
                        {communityFeatures.map((card, index) => renderFeatureCard(card, index, 9))}
                    </div>
                </div>

                {/* Governance */}
                <div style={{ marginBottom: '3rem' }}>
                    {renderSectionHeader(<FaVoteYea size={20} />, 'Governance', hubPrimary, 1.1)}
                    <div style={{
                        display: 'grid',
                        gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
                        gap: '1rem',
                    }}>
                        {governanceFeatures.map((card, index) => renderFeatureCard(card, index, 12))}
                    </div>
                </div>

                {/* Utilities */}
                <div style={{ marginBottom: '2.5rem' }}>
                    {renderSectionHeader(<FaWallet size={20} />, 'Utilities', theme.colors.success, 1.4)}
                    <div style={{
                        display: 'grid',
                        gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
                        gap: '1rem',
                    }}>
                        {utilityFeatures.map((card, index) => renderFeatureCard(card, index, 15))}
                    </div>
                </div>

                {/* Sneed Premium */}
                <Link 
                    to="/premium"
                    className="hub-card-animate hub-gradient-animate"
                    style={{
                        display: 'block',
                        background: `linear-gradient(135deg, #ffd700 0%, #ffb700 25%, #ff9500 50%, #ffb700 75%, #ffd700 100%)`,
                        backgroundSize: '200% 200%',
                        borderRadius: '20px',
                        padding: '28px 32px',
                        marginTop: '1rem',
                        textDecoration: 'none',
                        position: 'relative',
                        overflow: 'hidden',
                        boxShadow: '0 8px 30px rgba(255, 215, 0, 0.35)',
                        animationDelay: '1.7s',
                        opacity: 0,
                    }}
                >
                    {/* Shimmer effect */}
                    <div 
                        className="hub-shimmer"
                        style={{
                            position: 'absolute',
                            inset: 0,
                            background: 'linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.3) 50%, transparent 100%)',
                            backgroundSize: '200% 100%',
                        }}
                    />
                    
                    <div style={{ 
                        display: 'flex', 
                        alignItems: 'center', 
                        gap: '20px', 
                        flexWrap: 'wrap',
                        position: 'relative',
                        zIndex: 1,
                    }}>
                        <div style={{
                            width: '56px',
                            height: '56px',
                            borderRadius: '16px',
                            background: 'rgba(26, 26, 26, 0.9)',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            boxShadow: '0 4px 15px rgba(0,0,0,0.2)',
                        }}>
                            <FaStar size={28} style={{ color: '#ffd700' }} />
                        </div>
                        <div style={{ flex: 1, minWidth: '200px' }}>
                            <div style={{ 
                                color: '#1a1a1a', 
                                fontWeight: '800', 
                                fontSize: '1.5rem', 
                                marginBottom: '6px',
                                textShadow: '0 1px 2px rgba(255,255,255,0.3)',
                            }}>
                                Sneed Premium ✨
                            </div>
                            <div style={{ 
                                color: '#333', 
                                fontSize: '1.05rem', 
                                lineHeight: '1.5' 
                            }}>
                                Unlock exclusive features, priority support, and special perks. Join the premium experience!
                            </div>
                        </div>
                        <div style={{
                            background: '#1a1a1a',
                            color: '#ffd700',
                            padding: '14px 28px',
                            borderRadius: '12px',
                            fontWeight: '700',
                            fontSize: '1rem',
                            whiteSpace: 'nowrap',
                            boxShadow: '0 4px 15px rgba(0,0,0,0.2)',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '8px',
                        }}>
                            Learn More
                            <FaArrowRight size={14} />
                        </div>
                    </div>
                </Link>
            </main>
        </div>
    );
}

export default Hub;
