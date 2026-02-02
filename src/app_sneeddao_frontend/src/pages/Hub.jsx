import React, { useState, useEffect, useCallback } from 'react';
import { useTheme } from '../contexts/ThemeContext';
import Header from '../components/Header';
import { Link } from 'react-router-dom';
import { FaExchangeAlt, FaCoins, FaLock, FaComments, FaWallet, FaServer, FaNewspaper, FaUsers, FaVoteYea, FaRss, FaArrowRight, FaHistory, FaStar, FaUnlock, FaShieldAlt, FaGlobe, FaBrain, FaGavel, FaLayerGroup, FaStream, FaReply, FaNetworkWired } from 'react-icons/fa';
import { HttpAgent } from '@dfinity/agent';
import { createActor as createForumActor, canisterId as forumCanisterId } from 'declarations/sneed_sns_forum';
import { createActor as createSnsGovernanceActor, canisterId as snsGovernanceCanisterId } from 'external/sns_governance';
import { createSneedexActor } from '../utils/SneedexUtils';
import { getSnsById, getAllSnses } from '../utils/SnsUtils';
import { useTokenMetadata } from '../hooks/useTokenMetadata';
import OfferCard from '../components/OfferCard';
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
    50% { transform: translateY(-10px); }
}

@keyframes gradientShift {
    0% { background-position: 0% 50%; }
    50% { background-position: 100% 50%; }
    100% { background-position: 0% 50%; }
}

@keyframes glow {
    0%, 100% { box-shadow: 0 0 30px rgba(99, 102, 241, 0.4); }
    50% { box-shadow: 0 0 60px rgba(99, 102, 241, 0.7); }
}

@keyframes tickerPulse {
    0%, 100% { transform: scale(1); }
    50% { transform: scale(1.02); }
}

@keyframes priceGlow {
    0%, 100% { text-shadow: 0 0 10px rgba(34, 197, 94, 0.3); }
    50% { text-shadow: 0 0 20px rgba(34, 197, 94, 0.6); }
}

@keyframes orbit {
    from { transform: rotate(0deg) translateX(120px) rotate(0deg); }
    to { transform: rotate(360deg) translateX(120px) rotate(-360deg); }
}

@keyframes orbit2 {
    from { transform: rotate(180deg) translateX(100px) rotate(-180deg); }
    to { transform: rotate(540deg) translateX(100px) rotate(-540deg); }
}

@keyframes orbit3 {
    from { transform: rotate(90deg) translateX(80px) rotate(-90deg); }
    to { transform: rotate(450deg) translateX(80px) rotate(-450deg); }
}

@keyframes slideIn {
    from {
        opacity: 0;
        transform: translateX(-20px);
    }
    to {
        opacity: 1;
        transform: translateX(0);
    }
}

@keyframes scaleIn {
    from {
        opacity: 0;
        transform: scale(0.9);
    }
    to {
        opacity: 1;
        transform: scale(1);
    }
}

@keyframes borderGlow {
    0%, 100% { border-color: rgba(99, 102, 241, 0.3); }
    50% { border-color: rgba(139, 92, 246, 0.6); }
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

.hub-hero-glow {
    animation: glow 3s ease-in-out infinite;
}

.hub-orbit-1 {
    animation: orbit 20s linear infinite;
}

.hub-orbit-2 {
    animation: orbit2 15s linear infinite;
}

.hub-orbit-3 {
    animation: orbit3 25s linear infinite;
}

.hub-stat-card:hover {
    transform: translateY(-4px) scale(1.02);
    box-shadow: 0 20px 40px rgba(0,0,0,0.2);
}

.hub-cta-primary:hover {
    transform: translateY(-2px);
    box-shadow: 0 12px 35px rgba(99, 102, 241, 0.5);
}

.hub-cta-secondary:hover {
    transform: translateY(-2px);
    box-shadow: 0 12px 35px rgba(34, 197, 94, 0.4);
}

.hub-offer-card {
    transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
}

.hub-offer-card:hover {
    transform: translateY(-6px);
    box-shadow: 0 20px 50px rgba(0,0,0,0.25);
}

.hub-border-glow {
    animation: borderGlow 3s ease-in-out infinite;
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
    
    // Use global token metadata cache
    const { getTokenMetadata, metadata: tokenMetadataState } = useTokenMetadata();
    
    // SNS data
    const [snsList, setSnsList] = useState([]);
    const [snsLogosMap, setSnsLogosMap] = useState(new Map());
    
    // Dynamic data state
    const [prices, setPrices] = useState({
        sneedUsd: null,
        sneedIcp: null,
        icpUsd: null,
        loading: true
    });
    const [daoStats, setDaoStats] = useState({
        activeMembers: null,
        totalNeurons: null,
        loading: true
    });
    const [feedItems, setFeedItems] = useState([]);
    const [offers, setOffers] = useState([]);
    const [activityLoading, setActivityLoading] = useState(true);
    const [snsLogos, setSnsLogos] = useState({});
    const [tokenPrices, setTokenPrices] = useState({}); // ledger_id -> USD price
    
    // Helper to get token info
    const getTokenInfo = useCallback((ledgerId) => {
        const globalMeta = getTokenMetadata(ledgerId);
        const cachedLogo = globalMeta?.logo || null;
        
        // Check SNS list for tokens (SNS data uses canisters.ledger)
        const snsMatch = snsList.find(s => s.canisters?.ledger === ledgerId);
        if (snsMatch) {
            return {
                symbol: snsMatch.token_symbol || snsMatch.symbol || 'TOKEN',
                decimals: snsMatch.decimals || 8,
                logo: cachedLogo || snsMatch.logo,
                fee: snsMatch.fee ? BigInt(snsMatch.fee) : null,
                name: snsMatch.name
            };
        }
        
        // Known tokens
        if (ledgerId === 'ryjl3-tyaaa-aaaaa-aaaba-cai') return { symbol: 'ICP', decimals: 8, logo: cachedLogo || '/icp_symbol.svg', fee: BigInt(10000) };
        if (ledgerId === 'hvgxa-wqaaa-aaaaq-aacia-cai') return { symbol: 'SNEED', decimals: 8, logo: cachedLogo || '/sneed_logo.png', fee: BigInt(10000) };
        if (ledgerId === 'mxzaz-hqaaa-aaaar-qaada-cai') return { symbol: 'ckBTC', decimals: 8, logo: cachedLogo, fee: BigInt(10) };
        if (ledgerId === 'ss2fx-dyaaa-aaaar-qacoq-cai') return { symbol: 'ckETH', decimals: 18, logo: cachedLogo, fee: BigInt(2000000000000) };
        
        return { symbol: globalMeta?.symbol || 'TOKEN', decimals: globalMeta?.decimals || 8, logo: cachedLogo, fee: null };
    }, [snsList, getTokenMetadata, tokenMetadataState]);
    
    // Helper to get SNS info by governance ID
    const getSnsInfo = useCallback((governanceId) => {
        const sns = snsList.find(s => s.canisters?.governance === governanceId);
        if (sns) {
            return {
                name: sns.name,
                symbol: sns.token_symbol || sns.symbol,
                logo: sns.logo,
                ledgerId: sns.canisters?.ledger,
                decimals: sns.decimals || 8,
            };
        }
        return null;
    }, [snsList]);
    
    // Helper to get SNS logo by governance ID
    const getSnsLogo = useCallback((governanceId) => {
        // First check the logos map
        const mapLogo = snsLogosMap.get(governanceId);
        if (mapLogo) return mapLogo;
        
        // Fallback to logo from SNS list
        const sns = snsList.find(s => s.canisters?.governance === governanceId);
        return sns?.logo || null;
    }, [snsLogosMap, snsList]);
    
    // Fetch SNS list on mount
    useEffect(() => {
        const fetchSnsList = async () => {
            try {
                const list = await getAllSnses();
                setSnsList(list || []);
            } catch (e) {
                console.warn('Could not fetch SNS list:', e);
            }
        };
        fetchSnsList();
    }, []);

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

    // Fetch DAO stats - count unique owners (active members)
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
                
                // Count unique owners with stake > 0 (active members)
                // Group neurons by owner principal and sum their stake
                const ownerStakes = new Map();
                
                for (const neuron of response.neurons) {
                    // Get the owner principal
                    const permissions = neuron.permissions || [];
                    for (const perm of permissions) {
                        // Check if this permission includes MANAGE_VOTING_PERMISSION (owner-level)
                        // Permission types: 1=Unspecified, 2=ManageVotingPermission, 3=ConfigureDissolveState, etc.
                        const MANAGE_VOTING_PERMISSION = 2;
                        const hasOwnerPerm = perm.permission_type?.some(pt => pt === MANAGE_VOTING_PERMISSION);
                        
                        if (hasOwnerPerm && perm.principal?.[0]) {
                            const principalStr = perm.principal[0].toString();
                            
                            // Get neuron stake
                            const stake = neuron.cached_neuron_stake_e8s?.[0] || BigInt(0);
                            
                            // Add to owner's total stake
                            const currentStake = ownerStakes.get(principalStr) || BigInt(0);
                            ownerStakes.set(principalStr, currentStake + stake);
                        }
                    }
                }
                
                // Count owners with stake > 0
                const activeMembers = Array.from(ownerStakes.values()).filter(stake => stake > BigInt(0)).length;
                
                setDaoStats({
                    activeMembers,
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

    // Fetch token prices for USD display on offer cards
    useEffect(() => {
        const fetchOfferTokenPrices = async () => {
            if (offers.length === 0) return;
            
            try {
                const prices = {};
                
                // Collect unique ledger IDs from offers (payment tokens and asset tokens)
                const ledgerIds = new Set();
                
                for (const offer of offers) {
                    // Payment token
                    if (offer.price_token_ledger) {
                        ledgerIds.add(offer.price_token_ledger.toString());
                    }
                    
                    // Asset tokens (for ICRC1Token and SNS neuron assets)
                    for (const assetEntry of (offer.assets || [])) {
                        const asset = assetEntry?.asset;
                        if (asset) {
                            if ('ICRC1Token' in asset && asset.ICRC1Token.ledger_canister_id) {
                                ledgerIds.add(asset.ICRC1Token.ledger_canister_id.toString());
                            } else if ('SNSNeuron' in asset && asset.SNSNeuron.governance_canister_id) {
                                // Get SNS ledger from governance
                                const govId = asset.SNSNeuron.governance_canister_id.toString();
                                const snsMatch = snsList.find(s => s.canisters?.governance === govId);
                                if (snsMatch?.canisters?.ledger) {
                                    ledgerIds.add(snsMatch.canisters.ledger);
                                }
                            }
                        }
                    }
                }
                
                // Always include ICP
                ledgerIds.add('ryjl3-tyaaa-aaaaa-aaaba-cai');
                
                // Fetch prices for each token
                for (const ledgerId of ledgerIds) {
                    try {
                        const tokenInfo = getTokenInfo(ledgerId);
                        const price = await priceService.getTokenUSDPrice(ledgerId, tokenInfo.decimals);
                        if (price > 0) {
                            prices[ledgerId] = price;
                        }
                    } catch (e) {
                        // Skip tokens we can't get prices for
                    }
                }
                
                setTokenPrices(prices);
            } catch (error) {
                console.warn('Error fetching token prices:', error);
            }
        };
        
        if (offers.length > 0 && snsList.length > 0) {
            fetchOfferTokenPrices();
        }
    }, [offers, snsList, getTokenInfo]);

    // Helper to get SNS ledger from governance ID
    const getSnsLedgerFromGovernance = useCallback((governanceId) => {
        const sns = snsList.find(s => s.canisters?.governance === governanceId);
        return sns?.canisters?.ledger || null;
    }, [snsList]);

    // Calculate estimated value for an offer
    const getOfferEstimatedValue = useCallback((offer) => {
        let totalUsd = 0;
        
        for (const assetEntry of (offer.assets || [])) {
            const asset = assetEntry?.asset;
            if (!asset) continue;
            
            if ('ICRC1Token' in asset) {
                // Token asset - use token price
                const ledgerId = asset.ICRC1Token.ledger_canister_id?.toString();
                if (!ledgerId) continue;
                const price = tokenPrices[ledgerId];
                if (price && asset.ICRC1Token.amount) {
                    const tokenInfo = getTokenInfo(ledgerId);
                    const amount = Number(asset.ICRC1Token.amount) / Math.pow(10, tokenInfo.decimals || 8);
                    totalUsd += amount * price;
                }
            } else if ('SNSNeuron' in asset) {
                // SNS Neuron - use cached stake
                const cachedStake = assetEntry.cached_stake_e8s?.[0];
                if (cachedStake) {
                    const stakeE8s = Number(cachedStake);
                    const govId = asset.SNSNeuron.governance_canister_id?.toString();
                    if (!govId) continue;
                    const snsLedger = getSnsLedgerFromGovernance(govId);
                    if (snsLedger && tokenPrices[snsLedger]) {
                        const snsInfo = getSnsInfo(govId);
                        const decimals = snsInfo?.decimals || 8;
                        const amount = stakeE8s / Math.pow(10, decimals);
                        totalUsd += amount * tokenPrices[snsLedger];
                    }
                }
            } else if ('Canister' in asset) {
                // Check if it's an ICP Neuron Manager
                const canisterKind = asset.Canister.kind?.[0];
                if (canisterKind === 1 || canisterKind === 1n) {
                    // ICP Neuron Manager - use cached total stake
                    const cachedStake = assetEntry.cached_total_stake_e8s?.[0];
                    if (cachedStake && prices.icpUsd) {
                        const stakeIcp = Number(cachedStake) / 1e8;
                        totalUsd += stakeIcp * prices.icpUsd;
                    }
                }
            }
        }
        
        return totalUsd;
    }, [tokenPrices, prices.icpUsd, snsList, getTokenInfo, getSnsInfo, getSnsLedgerFromGovernance]);

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
                {/* ============================================ */}
                {/* HERO SECTION - Modern & Engaging Design */}
                {/* ============================================ */}
                <div style={{
                    background: `linear-gradient(165deg, ${theme.colors.secondaryBg} 0%, ${hubPrimary}08 30%, ${hubSecondary}12 60%, ${theme.colors.primaryBg} 100%)`,
                    borderRadius: '32px',
                    padding: '0',
                    marginBottom: '2rem',
                    border: `1px solid ${theme.colors.border}`,
                    position: 'relative',
                    overflow: 'hidden',
                }}>
                    {/* Animated Background Elements */}
                    <div style={{ position: 'absolute', inset: 0, overflow: 'hidden', pointerEvents: 'none' }}>
                        {/* Main glow */}
                        <div style={{
                            position: 'absolute',
                            top: '-30%',
                            right: '-15%',
                            width: '700px',
                            height: '700px',
                            background: `radial-gradient(circle, ${hubPrimary}25 0%, ${hubPrimary}10 30%, transparent 70%)`,
                            borderRadius: '50%',
                        }} />
                        <div style={{
                            position: 'absolute',
                            bottom: '-40%',
                            left: '-10%',
                            width: '600px',
                            height: '600px',
                            background: `radial-gradient(circle, ${hubSecondary}20 0%, ${hubSecondary}08 40%, transparent 70%)`,
                            borderRadius: '50%',
                        }} />
                        <div style={{
                            position: 'absolute',
                            top: '50%',
                            left: '50%',
                            width: '400px',
                            height: '400px',
                            background: `radial-gradient(circle, ${hubAccent}12 0%, transparent 60%)`,
                            borderRadius: '50%',
                            transform: 'translate(-50%, -50%)',
                        }} />
                        
                        {/* Floating orbs */}
                        <div className="hub-orbit-1" style={{
                            position: 'absolute',
                            top: '50%',
                            left: '50%',
                            width: '16px',
                            height: '16px',
                            background: `linear-gradient(135deg, ${hubPrimary}, ${hubSecondary})`,
                            borderRadius: '50%',
                            boxShadow: `0 0 20px ${hubPrimary}60`,
                        }} />
                        <div className="hub-orbit-2" style={{
                            position: 'absolute',
                            top: '50%',
                            left: '50%',
                            width: '10px',
                            height: '10px',
                            background: `linear-gradient(135deg, ${hubAccent}, ${theme.colors.success})`,
                            borderRadius: '50%',
                            boxShadow: `0 0 15px ${hubAccent}60`,
                        }} />
                        <div className="hub-orbit-3" style={{
                            position: 'absolute',
                            top: '50%',
                            left: '50%',
                            width: '8px',
                            height: '8px',
                            background: `linear-gradient(135deg, ${theme.colors.success}, ${hubPrimary})`,
                            borderRadius: '50%',
                            boxShadow: `0 0 12px ${theme.colors.success}60`,
                        }} />
                        
                        {/* Grid pattern overlay */}
                        <div style={{
                            position: 'absolute',
                            inset: 0,
                            backgroundImage: `radial-gradient(${theme.colors.border} 1px, transparent 1px)`,
                            backgroundSize: '30px 30px',
                            opacity: 0.3,
                        }} />
                    </div>
                    
                    {/* Hero Content */}
                    <div style={{ 
                        position: 'relative', 
                        zIndex: 1,
                        padding: '4rem 2.5rem 3.5rem',
                    }}>
                        {/* Logo with animated glow */}
                        <div style={{
                            display: 'flex',
                            justifyContent: 'center',
                            marginBottom: '2rem',
                        }}>
                            <div 
                                className="hub-float hub-hero-glow"
                                style={{
                                    width: '100px',
                                    height: '100px',
                                    borderRadius: '28px',
                                    background: `linear-gradient(145deg, ${hubPrimary}, ${hubSecondary})`,
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    padding: '4px',
                                    boxSizing: 'border-box',
                                }}
                            >
                                <div style={{
                                    width: '100%',
                                    height: '100%',
                                    borderRadius: '24px',
                                    background: theme.colors.secondaryBg,
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    padding: '12px',
                                    boxSizing: 'border-box',
                                }}>
                                    <img 
                                        src="sneed_logo.png" 
                                        alt="Sneed Logo" 
                                        style={{
                                            width: '100%',
                                            height: '100%',
                                            borderRadius: '16px',
                                            objectFit: 'cover',
                                        }}
                                    />
                                </div>
                            </div>
                        </div>
                        
                        {/* Main headline */}
                        <h1 style={{
                            fontSize: 'clamp(2.5rem, 6vw, 3.75rem)',
                            fontWeight: '900',
                            color: theme.colors.primaryText,
                            marginBottom: '1.5rem',
                            letterSpacing: '-0.03em',
                            lineHeight: '1.1',
                            textAlign: 'center',
                        }}>
                            Your Gateway to the{' '}
                            <span style={{
                                background: `linear-gradient(135deg, ${hubPrimary} 0%, ${hubSecondary} 50%, ${hubAccent} 100%)`,
                                backgroundSize: '200% 200%',
                                WebkitBackgroundClip: 'text',
                                WebkitTextFillColor: 'transparent',
                                backgroundClip: 'text',
                                animation: 'gradientShift 5s ease infinite',
                            }}>
                                Internet Computer
                            </span>
                        </h1>
                        
                        {/* Subtitle */}
                        <p style={{
                            color: theme.colors.secondaryText,
                            fontSize: '1.25rem',
                            lineHeight: '1.8',
                            maxWidth: '700px',
                            margin: '0 auto 2.5rem auto',
                            textAlign: 'center',
                            fontWeight: '400',
                        }}>
                            The all-in-one platform for <strong style={{ color: hubPrimary }}>trading</strong>,{' '}
                            <strong style={{ color: theme.colors.success }}>staking</strong>,{' '}
                            <strong style={{ color: '#9b59b6' }}>locking</strong>, and{' '}
                            <strong style={{ color: hubAccent }}>governing</strong> across all SNS DAOs.
                        </p>
                        
                        {/* CTA Buttons */}
                        <div style={{
                            display: 'flex',
                            justifyContent: 'center',
                            gap: '1rem',
                            flexWrap: 'wrap',
                            marginBottom: '3rem',
                        }}>
                            <Link 
                                to="/sneedex_offers" 
                                className="hub-cta-primary"
                                style={{
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: '10px',
                                    background: `linear-gradient(135deg, ${hubPrimary}, ${hubSecondary})`,
                                    color: '#fff',
                                    padding: '16px 32px',
                                    borderRadius: '16px',
                                    textDecoration: 'none',
                                    fontWeight: '700',
                                    fontSize: '1.05rem',
                                    boxShadow: `0 8px 30px ${hubPrimary}50`,
                                    transition: 'all 0.3s ease',
                                }}
                            >
                                <FaGavel size={18} />
                                Explore Marketplace
                                <FaArrowRight size={14} />
                            </Link>
                            <Link 
                                to="/liquid_staking" 
                                className="hub-cta-secondary"
                                style={{
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: '10px',
                                    background: `linear-gradient(135deg, ${theme.colors.success}, #059669)`,
                                    color: '#fff',
                                    padding: '16px 32px',
                                    borderRadius: '16px',
                                    textDecoration: 'none',
                                    fontWeight: '700',
                                    fontSize: '1.05rem',
                                    boxShadow: `0 8px 30px ${theme.colors.success}40`,
                                    transition: 'all 0.3s ease',
                                }}
                            >
                                <FaCoins size={18} />
                                Start Staking
                            </Link>
                            <Link 
                                to="/sneedlock_info" 
                                style={{
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: '10px',
                                    background: theme.colors.secondaryBg,
                                    color: theme.colors.primaryText,
                                    padding: '16px 32px',
                                    borderRadius: '16px',
                                    textDecoration: 'none',
                                    fontWeight: '600',
                                    fontSize: '1.05rem',
                                    border: `2px solid ${theme.colors.border}`,
                                    transition: 'all 0.3s ease',
                                }}
                            >
                                <FaLock size={16} style={{ color: '#9b59b6' }} />
                                Lock Tokens
                            </Link>
                        </div>
                        
                        {/* Quick Stats Row */}
                        <div style={{
                            display: 'flex',
                            justifyContent: 'center',
                            gap: '2rem',
                            flexWrap: 'wrap',
                        }}>
                            {/* ICP Price */}
                            <div 
                                className="hub-stat-card"
                                style={{ 
                                    display: 'flex', 
                                    alignItems: 'center', 
                                    gap: '14px',
                                    padding: '14px 24px',
                                    background: `linear-gradient(135deg, ${theme.colors.secondaryBg}, ${theme.colors.primaryBg})`,
                                    borderRadius: '16px',
                                    border: `1px solid ${theme.colors.success}30`,
                                    boxShadow: `0 4px 20px rgba(0,0,0,0.1), inset 0 1px 0 rgba(255,255,255,0.05)`,
                                    transition: 'all 0.3s ease',
                                }}
                            >
                                <div style={{
                                    width: '48px',
                                    height: '48px',
                                    borderRadius: '14px',
                                    background: `linear-gradient(135deg, ${theme.colors.success}20, ${theme.colors.success}08)`,
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    border: `1px solid ${theme.colors.success}30`,
                                }}>
                                    <img 
                                        src="https://swaprunner.com/icp_symbol.svg" 
                                        alt="ICP" 
                                        style={{ width: '28px', height: '28px', borderRadius: '50%' }}
                                    />
                                </div>
                                <div>
                                    <div style={{ fontSize: '0.7rem', color: theme.colors.mutedText, fontWeight: '600', textTransform: 'uppercase', letterSpacing: '0.8px' }}>ICP</div>
                                    <div style={{ 
                                        fontSize: '1.75rem', 
                                        fontWeight: '800', 
                                        color: theme.colors.success,
                                        lineHeight: 1,
                                        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, monospace',
                                    }}>
                                        ${prices.loading ? '—' : formatPrice(prices.icpUsd, 2)}
                                    </div>
                                </div>
                            </div>

                            {/* SNEED Price */}
                            <div 
                                className="hub-stat-card"
                                style={{ 
                                    display: 'flex', 
                                    alignItems: 'center', 
                                    gap: '14px',
                                    padding: '14px 24px',
                                    background: `linear-gradient(135deg, ${theme.colors.secondaryBg}, ${theme.colors.primaryBg})`,
                                    borderRadius: '16px',
                                    border: `1px solid ${hubPrimary}30`,
                                    boxShadow: `0 4px 20px rgba(0,0,0,0.1), inset 0 1px 0 rgba(255,255,255,0.05)`,
                                    transition: 'all 0.3s ease',
                                }}
                            >
                                <div style={{
                                    width: '48px',
                                    height: '48px',
                                    borderRadius: '14px',
                                    background: `linear-gradient(135deg, ${hubPrimary}20, ${hubPrimary}08)`,
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    border: `1px solid ${hubPrimary}30`,
                                    overflow: 'hidden',
                                }}>
                                    <img 
                                        src="sneed_logo.png" 
                                        alt="SNEED" 
                                        style={{ width: '32px', height: '32px', borderRadius: '8px' }}
                                    />
                                </div>
                                <div>
                                    <div style={{ fontSize: '0.7rem', color: theme.colors.mutedText, fontWeight: '600', textTransform: 'uppercase', letterSpacing: '0.8px' }}>SNEED</div>
                                    <div style={{ 
                                        fontSize: '1.75rem', 
                                        fontWeight: '800', 
                                        color: hubPrimary,
                                        lineHeight: 1,
                                        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, monospace',
                                    }}>
                                        ${prices.loading ? '—' : formatPrice(prices.sneedUsd, 6)}
                                    </div>
                                    <div style={{ fontSize: '0.75rem', color: theme.colors.mutedText, marginTop: '2px' }}>
                                        {prices.loading ? '' : `≈ ${formatPrice(prices.sneedIcp, 8)} ICP`}
                                    </div>
                                </div>
                            </div>

                            {/* DAO Neurons */}
                            <div 
                                className="hub-stat-card"
                                style={{ 
                                    display: 'flex', 
                                    alignItems: 'center', 
                                    gap: '14px',
                                    padding: '14px 24px',
                                    background: `linear-gradient(135deg, ${theme.colors.secondaryBg}, ${theme.colors.primaryBg})`,
                                    borderRadius: '16px',
                                    border: `1px solid ${hubAccent}30`,
                                    boxShadow: `0 4px 20px rgba(0,0,0,0.1), inset 0 1px 0 rgba(255,255,255,0.05)`,
                                    transition: 'all 0.3s ease',
                                }}
                            >
                                <div style={{
                                    width: '48px',
                                    height: '48px',
                                    borderRadius: '14px',
                                    background: `linear-gradient(135deg, ${hubAccent}25, ${hubAccent}10)`,
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    border: `1px solid ${hubAccent}30`,
                                }}>
                                    <FaUsers size={22} style={{ color: hubAccent }} />
                                </div>
                                <div>
                                    <div style={{ fontSize: '0.7rem', color: theme.colors.mutedText, fontWeight: '600', textTransform: 'uppercase', letterSpacing: '0.8px' }}>Active Members</div>
                                    <div style={{ 
                                        fontSize: '1.75rem', 
                                        fontWeight: '800', 
                                        color: hubAccent,
                                        lineHeight: 1,
                                        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, monospace',
                                    }}>
                                        {daoStats.loading ? '—' : (daoStats.activeMembers?.toLocaleString() || '0')}
                                    </div>
                                    <div style={{ fontSize: '0.75rem', color: theme.colors.mutedText, marginTop: '2px' }}>
                                        Sneed DAO
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                {/* ============================================ */}
                {/* LIVE ACTIVITY SECTION */}
                {/* ============================================ */}
                <div style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fit, minmax(420px, 1fr))',
                    gap: '1.5rem',
                    marginBottom: '2.5rem',
                }}>
                    {/* Sneed Forum Activity */}
                    <div style={{
                        background: `linear-gradient(145deg, ${theme.colors.secondaryBg} 0%, ${theme.colors.primaryBg} 100%)`,
                        border: `1px solid ${theme.colors.border}`,
                        borderRadius: '24px',
                        overflow: 'hidden',
                        boxShadow: '0 8px 32px rgba(0,0,0,0.12)',
                    }}>
                        {/* Branded Header */}
                        <div style={{
                            background: 'linear-gradient(135deg, #f97316 0%, #ea580c 50%, #dc2626 100%)',
                            padding: '18px 24px',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                        }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
                                <div style={{
                                    width: '48px',
                                    height: '48px',
                                    borderRadius: '14px',
                                    background: 'rgba(255,255,255,0.2)',
                                    backdropFilter: 'blur(10px)',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                }}>
                                    <FaComments size={22} style={{ color: 'white' }} />
                                </div>
                                <div>
                                    <div style={{ color: 'white', fontWeight: '800', fontSize: '1.2rem', letterSpacing: '-0.01em' }}>Sneed Forum</div>
                                    <div style={{ color: 'rgba(255,255,255,0.85)', fontSize: '0.8rem', fontWeight: '500' }}>Latest discussions</div>
                                </div>
                            </div>
                            <Link 
                                to="/feed" 
                                style={{ 
                                    color: 'white', 
                                    textDecoration: 'none', 
                                    fontSize: '0.9rem',
                                    fontWeight: '600',
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '8px',
                                    background: 'rgba(255,255,255,0.2)',
                                    backdropFilter: 'blur(10px)',
                                    padding: '10px 18px',
                                    borderRadius: '10px',
                                    transition: 'all 0.2s ease',
                                }}
                            >
                                View All <FaArrowRight size={12} />
                            </Link>
                        </div>

                        {/* Feed Items */}
                        <div style={{ padding: '16px' }}>
                            {activityLoading ? (
                                <div style={{ textAlign: 'center', padding: '3rem', color: theme.colors.mutedText }}>
                                    <div className="hub-pulse" style={{ fontSize: '2rem', marginBottom: '12px' }}>💬</div>
                                    <div>Loading discussions...</div>
                                </div>
                            ) : feedItems.length === 0 ? (
                                <div style={{ textAlign: 'center', padding: '3rem', color: theme.colors.mutedText }}>
                                    <div style={{ fontSize: '2rem', marginBottom: '12px' }}>📭</div>
                                    <div>No recent activity</div>
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
                                                    borderRadius: '14px',
                                                    textDecoration: 'none',
                                                    border: `1px solid ${theme.colors.border}`,
                                                    transition: 'all 0.2s ease',
                                                }}
                                                onMouseEnter={(e) => {
                                                    e.currentTarget.style.transform = 'translateX(4px)';
                                                    e.currentTarget.style.borderColor = typeColor;
                                                    e.currentTarget.style.boxShadow = `0 4px 16px ${typeColor}20`;
                                                }}
                                                onMouseLeave={(e) => {
                                                    e.currentTarget.style.transform = 'translateX(0)';
                                                    e.currentTarget.style.borderColor = theme.colors.border;
                                                    e.currentTarget.style.boxShadow = 'none';
                                                }}
                                            >
                                                {/* SNS Logo */}
                                                <div style={{
                                                    width: '44px',
                                                    height: '44px',
                                                    borderRadius: '12px',
                                                    background: `linear-gradient(135deg, ${typeColor}30, ${typeColor}15)`,
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    justifyContent: 'center',
                                                    flexShrink: 0,
                                                    overflow: 'hidden',
                                                    border: `1px solid ${typeColor}30`,
                                                }}>
                                                    {snsLogo ? (
                                                        <img src={snsLogo} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                                                    ) : (
                                                        <span style={{ color: typeColor }}>{getFeedTypeIcon(itemType)}</span>
                                                    )}
                                                </div>
                                                
                                                <div style={{ flex: 1, minWidth: 0 }}>
                                                    {/* Header row */}
                                                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px', flexWrap: 'wrap' }}>
                                                        <span style={{
                                                            display: 'inline-flex',
                                                            alignItems: 'center',
                                                            gap: '4px',
                                                            padding: '4px 10px',
                                                            borderRadius: '8px',
                                                            background: typeColor,
                                                            color: 'white',
                                                            fontSize: '0.7rem',
                                                            fontWeight: '700',
                                                            textTransform: 'uppercase',
                                                            letterSpacing: '0.3px',
                                                        }}>
                                                            {getFeedTypeIcon(itemType)}
                                                            {itemType}
                                                        </span>
                                                        {snsData && (
                                                            <span style={{
                                                                fontSize: '0.75rem',
                                                                color: theme.colors.secondaryText,
                                                                background: theme.colors.secondaryBg,
                                                                padding: '4px 10px',
                                                                borderRadius: '8px',
                                                                fontWeight: '500',
                                                            }}>
                                                                {snsData.name}
                                                            </span>
                                                        )}
                                                        <span style={{ fontSize: '0.75rem', color: theme.colors.mutedText, marginLeft: 'auto', fontWeight: '500' }}>
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

                    {/* Sneedex Marketplace - Enhanced Offer Cards */}
                    <div style={{
                        background: `linear-gradient(145deg, ${theme.colors.secondaryBg} 0%, ${theme.colors.primaryBg} 100%)`,
                        border: `1px solid ${theme.colors.border}`,
                        borderRadius: '24px',
                        overflow: 'hidden',
                        boxShadow: '0 8px 32px rgba(0,0,0,0.12)',
                    }}>
                        {/* Branded Header */}
                        <div style={{
                            background: `linear-gradient(135deg, ${hubPrimary} 0%, ${hubSecondary} 50%, #7c3aed 100%)`,
                            padding: '18px 24px',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                        }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
                                <div style={{
                                    width: '48px',
                                    height: '48px',
                                    borderRadius: '14px',
                                    background: 'rgba(255,255,255,0.2)',
                                    backdropFilter: 'blur(10px)',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                }}>
                                    <FaGavel size={22} style={{ color: 'white' }} />
                                </div>
                                <div>
                                    <div style={{ color: 'white', fontWeight: '800', fontSize: '1.2rem', letterSpacing: '-0.01em' }}>Sneedex</div>
                                    <div style={{ color: 'rgba(255,255,255,0.85)', fontSize: '0.8rem', fontWeight: '500' }}>Active marketplace offers</div>
                                </div>
                            </div>
                            <Link 
                                to="/sneedex_offers" 
                                style={{ 
                                    color: 'white', 
                                    textDecoration: 'none', 
                                    fontSize: '0.9rem',
                                    fontWeight: '600',
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '8px',
                                    background: 'rgba(255,255,255,0.2)',
                                    backdropFilter: 'blur(10px)',
                                    padding: '10px 18px',
                                    borderRadius: '10px',
                                    transition: 'all 0.2s ease',
                                }}
                            >
                                Browse All <FaArrowRight size={12} />
                            </Link>
                        </div>

                        {/* Enhanced Offer Cards */}
                        <div style={{ padding: '16px' }}>
                            {activityLoading ? (
                                <div style={{ textAlign: 'center', padding: '3rem', color: theme.colors.mutedText }}>
                                    <div className="hub-pulse" style={{ fontSize: '2rem', marginBottom: '12px' }}>🔨</div>
                                    <div>Loading offers...</div>
                                </div>
                            ) : offers.length === 0 ? (
                                <div style={{ textAlign: 'center', padding: '3rem', color: theme.colors.mutedText }}>
                                    <div style={{ fontSize: '2rem', marginBottom: '12px' }}>📭</div>
                                    <div>No active offers</div>
                                    <Link 
                                        to="/sneedex_create" 
                                        style={{
                                            display: 'inline-flex',
                                            alignItems: 'center',
                                            gap: '8px',
                                            marginTop: '1rem',
                                            padding: '10px 20px',
                                            background: `linear-gradient(135deg, ${hubPrimary}, ${hubSecondary})`,
                                            color: 'white',
                                            borderRadius: '10px',
                                            textDecoration: 'none',
                                            fontWeight: '600',
                                            fontSize: '0.9rem',
                                        }}
                                    >
                                        <FaGavel size={14} /> Create First Offer
                                    </Link>
                                </div>
                            ) : (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                                    {offers.map((offer) => (
                                        <OfferCard
                                            key={`offer-${offer.id}`}
                                            offer={offer}
                                            getTokenInfo={getTokenInfo}
                                            getSnsInfo={getSnsInfo}
                                            getSnsLogo={getSnsLogo}
                                            tokenPrices={tokenPrices}
                                            icpPrice={prices.icpUsd}
                                            getOfferEstimatedValue={getOfferEstimatedValue}
                                            compact={true}
                                        />
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>
                </div>

                {/* ============================================ */}
                {/* FEATURES HIGHLIGHT STRIP */}
                {/* ============================================ */}
                <div style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))',
                    gap: '1rem',
                    marginBottom: '3rem',
                }}>
                    {[
                        { icon: <FaShieldAlt size={22} />, title: 'Secure Escrow', desc: '100% on-chain trading', color: hubPrimary, gradient: `linear-gradient(135deg, ${hubPrimary}15, ${hubPrimary}05)` },
                        { icon: <FaCoins size={22} />, title: 'Liquid Staking', desc: 'Tradable ICP & SNS positions', color: theme.colors.success, gradient: `linear-gradient(135deg, ${theme.colors.success}15, ${theme.colors.success}05)` },
                        { icon: <FaNetworkWired size={22} />, title: 'Multi-DAO Hub', desc: 'All SNS DAOs in one place', color: hubAccent, gradient: `linear-gradient(135deg, ${hubAccent}15, ${hubAccent}05)` },
                        { icon: <FaLock size={22} />, title: 'Token Locks', desc: 'Transferable vesting & locks', color: '#9b59b6', gradient: `linear-gradient(135deg, #9b59b615, #9b59b605)` },
                    ].map((item, idx) => (
                        <div 
                            key={item.title}
                            className="hub-stat-card"
                            style={{
                                background: item.gradient,
                                borderRadius: '18px',
                                padding: '1.5rem',
                                border: `1px solid ${item.color}20`,
                                display: 'flex',
                                alignItems: 'center',
                                gap: '1rem',
                                transition: 'all 0.3s ease',
                            }}
                        >
                            <div style={{
                                width: '52px',
                                height: '52px',
                                borderRadius: '14px',
                                background: `linear-gradient(135deg, ${item.color}30, ${item.color}15)`,
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                color: item.color,
                                flexShrink: 0,
                                border: `1px solid ${item.color}25`,
                            }}>
                                {item.icon}
                            </div>
                            <div>
                                <div style={{ color: theme.colors.primaryText, fontWeight: '700', fontSize: '1.05rem', marginBottom: '2px' }}>
                                    {item.title}
                                </div>
                                <div style={{ color: theme.colors.secondaryText, fontSize: '0.85rem', fontWeight: '500' }}>
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
