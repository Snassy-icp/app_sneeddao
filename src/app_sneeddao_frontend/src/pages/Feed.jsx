import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Link, useNavigate, useLocation, useSearchParams } from 'react-router-dom';
import { Principal } from '@dfinity/principal';
import { useAuth } from '../AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import { useSns } from '../contexts/SnsContext';
import { useNaming } from '../NamingContext';
import Header from '../components/Header';
import { createActor, canisterId } from 'declarations/sneed_sns_forum';
import { formatError } from '../utils/errorUtils';
import { fetchSnsLogo, getAllSnses, getSnsById } from '../utils/SnsUtils';
import { PrincipalDisplay } from '../utils/PrincipalUtils';
import { HttpAgent } from '@dfinity/agent';
import PrincipalInput from '../components/PrincipalInput';
import Poll from '../components/Poll';
import MarkdownBody from '../components/MarkdownBody';
import TokenIcon from '../components/TokenIcon';
import FeedItemCard from '../components/FeedItemCard';
import { FaRss, FaFilter, FaTimes, FaChevronDown, FaChevronUp, FaComments, FaLayerGroup, FaStream, FaReply, FaSearch, FaUser, FaList, FaGavel, FaBrain, FaRobot, FaCube, FaCoins, FaClock } from 'react-icons/fa';
import { createSneedexActor, getAssetDetails, formatAmount, formatTimeRemaining, getOfferStateString } from '../utils/SneedexUtils';

// Accent colors for Feed
const feedPrimary = '#f97316'; // Warm orange
const feedSecondary = '#fb923c';
const feedAccent = '#fbbf24'; // Golden yellow
const feedGreen = '#22c55e';
const feedBlue = '#3b82f6';
const feedPurple = '#a855f7';
const feedAuction = '#8b5cf6'; // Purple for auctions (less garish)

// Format relative time (e.g., "5m", "2h", "3d")
const formatRelativeTime = (timestamp) => {
    const date = new Date(Number(timestamp) / 1000000); // Convert nanoseconds to milliseconds
    const now = new Date();
    const diffMs = now - date;
    const diffSeconds = Math.floor(diffMs / 1000);
    const diffMinutes = Math.floor(diffSeconds / 60);
    const diffHours = Math.floor(diffMinutes / 60);
    const diffDays = Math.floor(diffHours / 24);
    const diffWeeks = Math.floor(diffDays / 7);
    const diffMonths = Math.floor(diffDays / 30);
    const diffYears = Math.floor(diffDays / 365);

    if (diffSeconds < 60) return 'just now';
    if (diffMinutes < 60) return `${diffMinutes}m`;
    if (diffHours < 24) return `${diffHours}h`;
    if (diffDays < 7) return `${diffDays}d`;
    if (diffWeeks < 4) return `${diffWeeks}w`;
    if (diffMonths < 12) return `${diffMonths}mo`;
    return `${diffYears}y`;
};

// Get full date for tooltip
const getFullDate = (timestamp) => {
    const date = new Date(Number(timestamp) / 1000000);
    return date.toLocaleString();
};

// CSS animation keyframes (injected into document)
const injectFeedStyles = () => {
    if (document.getElementById('feed-styles')) return;
    const style = document.createElement('style');
    style.id = 'feed-styles';
    style.textContent = `
        @keyframes feedFadeIn {
            from { opacity: 0; transform: translateY(20px); }
            to { opacity: 1; transform: translateY(0); }
        }
        @keyframes feedPulse {
            0%, 100% { opacity: 0.6; }
            50% { opacity: 1; }
        }
        @keyframes feedSlideDown {
            from { opacity: 0; transform: translateY(-10px); }
            to { opacity: 1; transform: translateY(0); }
        }
        @keyframes feedGlow {
            0%, 100% { box-shadow: 0 0 5px rgba(249, 115, 22, 0.3); }
            50% { box-shadow: 0 0 20px rgba(249, 115, 22, 0.5); }
        }
        .feed-item-animate {
            animation: feedFadeIn 0.4s ease-out forwards;
        }
        .feed-hero-logo {
            transition: transform 0.3s ease, box-shadow 0.3s ease;
        }
        .feed-hero-logo:hover {
            transform: scale(1.1) rotate(5deg);
            box-shadow: 0 8px 32px rgba(249, 115, 22, 0.4);
        }
        .feed-card:hover {
            transform: translateY(-2px);
            box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
        }
        .feed-type-badge {
            transition: all 0.2s ease;
        }
        .feed-type-badge:hover {
            transform: translateY(-1px) scale(1.05);
            filter: brightness(1.1);
        }
        .feed-title-link {
            transition: color 0.2s ease;
        }
        .feed-title-link:hover {
            color: ${feedPrimary} !important;
        }
        .feed-context-tag {
            transition: all 0.2s ease;
        }
        .feed-context-tag:hover {
            transform: translateY(-1px);
            border-color: ${feedPrimary};
            color: ${feedPrimary};
        }
        .feed-filter-toggle {
            transition: all 0.3s ease;
        }
        .feed-filter-toggle:hover {
            transform: scale(1.1);
            background-color: ${feedPrimary} !important;
            color: white !important;
        }
        .feed-sns-avatar {
            transition: all 0.2s ease;
        }
        .feed-sns-avatar:hover {
            transform: scale(1.15) translateY(-2px);
            z-index: 10;
            opacity: 1 !important;
            box-shadow: 0 4px 12px rgba(249, 115, 22, 0.4) !important;
        }
        .feed-sns-avatar:active {
            transform: scale(0.95);
        }
    `;
    document.head.appendChild(style);
};

const getStyles = (theme) => ({
    // Container
    container: {
        maxWidth: '900px',
        margin: '0 auto',
        padding: '24px 16px'
    },
    // Filter Section - Modern Card Style
    filterSection: {
        backgroundColor: theme.colors.secondaryBg,
        borderRadius: '16px',
        padding: '20px',
        marginBottom: '24px',
        border: `1px solid ${theme.colors.border}`,
        boxShadow: '0 4px 20px rgba(0, 0, 0, 0.15)',
        animation: 'feedSlideDown 0.3s ease-out'
    },
    filterRow: {
        display: 'flex',
        flexWrap: 'wrap',
        gap: '12px',
        marginBottom: '16px'
    },
    filterGroup: {
        display: 'flex',
        flexDirection: 'column',
        gap: '6px',
        flex: '1',
        minWidth: '180px'
    },
    filterLabel: {
        color: theme.colors.secondaryText,
        fontSize: '0.75rem',
        fontWeight: '600',
        textTransform: 'uppercase',
        letterSpacing: '0.5px'
    },
    filterInput: {
        backgroundColor: theme.colors.primaryBg,
        border: `1px solid ${theme.colors.border}`,
        borderRadius: '10px',
        padding: '10px 14px',
        color: theme.colors.primaryText,
        fontSize: '0.9rem',
        transition: 'all 0.2s ease',
        outline: 'none'
    },
    filterSelect: {
        backgroundColor: theme.colors.primaryBg,
        border: `1px solid ${theme.colors.border}`,
        borderRadius: '10px',
        padding: '10px 14px',
        color: theme.colors.primaryText,
        fontSize: '0.9rem',
        cursor: 'pointer',
        transition: 'all 0.2s ease'
    },
    applyButton: {
        background: `linear-gradient(135deg, ${feedPrimary}, ${feedSecondary})`,
        color: 'white',
        border: 'none',
        borderRadius: '10px',
        padding: '10px 20px',
        cursor: 'pointer',
        fontSize: '0.85rem',
        fontWeight: '600',
        transition: 'all 0.3s ease',
        boxShadow: `0 4px 15px ${feedPrimary}40`
    },
    clearButton: {
        backgroundColor: theme.colors.tertiaryBg,
        color: theme.colors.secondaryText,
        border: `1px solid ${theme.colors.border}`,
        borderRadius: '10px',
        padding: '10px 20px',
        cursor: 'pointer',
        fontSize: '0.85rem',
        fontWeight: '500',
        transition: 'all 0.2s ease'
    },
    // Feed Container
    feedContainer: {
        display: 'flex',
        flexDirection: 'column',
        gap: '16px'
    },
    // Feed Item Card
    feedItem: {
        backgroundColor: theme.colors.secondaryBg,
        borderRadius: '16px',
        padding: '20px',
        paddingLeft: '76px',
        border: `1px solid ${theme.colors.border}`,
        transition: 'all 0.3s ease',
        position: 'relative',
        cursor: 'default',
        overflow: 'hidden'
    },
    feedItemHeader: {
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: '12px',
        flexWrap: 'wrap',
        gap: '10px'
    },
    feedItemHeaderLeft: {
        display: 'flex',
        alignItems: 'center',
        gap: '10px',
        flexWrap: 'wrap'
    },
    feedItemType: {
        display: 'inline-flex',
        alignItems: 'center',
        gap: '5px',
        padding: '4px 10px',
        borderRadius: '6px',
        fontSize: '0.7rem',
        fontWeight: '700',
        textTransform: 'uppercase',
        letterSpacing: '0.5px',
        cursor: 'pointer',
        textDecoration: 'none'
    },
    feedItemDate: {
        color: theme.colors.mutedText,
        fontSize: '0.8rem',
        fontWeight: '500'
    },
    feedItemTitle: {
        color: theme.colors.primaryText,
        fontSize: '1.1rem',
        fontWeight: '700',
        marginBottom: '10px',
        lineHeight: '1.4',
        cursor: 'pointer',
        textDecoration: 'none'
    },
    feedItemBody: {
        color: theme.colors.secondaryText,
        fontSize: '0.9rem',
        lineHeight: '1.6',
        marginBottom: '14px',
        maxHeight: '100px',
        overflow: 'hidden',
        position: 'relative'
    },
    feedItemContext: {
        display: 'flex',
        flexWrap: 'wrap',
        gap: '8px',
        marginTop: '14px',
        paddingTop: '14px',
        borderTop: `1px solid ${theme.colors.border}`
    },
    contextLink: {
        color: theme.colors.secondaryText,
        textDecoration: 'none',
        fontSize: '0.75rem',
        fontWeight: '500',
        backgroundColor: theme.colors.tertiaryBg,
        padding: '6px 12px',
        borderRadius: '8px',
        border: `1px solid ${theme.colors.border}`,
        display: 'inline-flex',
        alignItems: 'center',
        gap: '5px'
    },
    // SNS Logo (in feed items)
    snsLogo: {
        position: 'absolute',
        top: '20px',
        left: '20px',
        width: '44px',
        height: '44px',
        minWidth: '44px',
        maxWidth: '44px',
        flexShrink: 0,
        borderRadius: '12px',
        objectFit: 'cover',
        border: `2px solid ${theme.colors.border}`,
        cursor: 'pointer',
        transition: 'all 0.2s ease',
        boxShadow: '0 2px 10px rgba(0, 0, 0, 0.2)'
    },
    snsLogoPlaceholder: {
        position: 'absolute',
        top: '20px',
        left: '20px',
        width: '44px',
        height: '44px',
        minWidth: '44px',
        maxWidth: '44px',
        flexShrink: 0,
        borderRadius: '12px',
        backgroundColor: theme.colors.tertiaryBg,
        border: `2px solid ${theme.colors.border}`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: '0.75rem',
        fontWeight: '700',
        color: theme.colors.secondaryText,
        cursor: 'pointer',
        transition: 'all 0.2s ease',
        boxShadow: '0 2px 10px rgba(0, 0, 0, 0.2)'
    },
    feedItemContent: {
        // Content is positioned by padding on feedItem
    },
    // Load More / Loading
    loadMoreButton: {
        background: `linear-gradient(135deg, ${feedPrimary}, ${feedSecondary})`,
        color: 'white',
        border: 'none',
        borderRadius: '12px',
        padding: '14px 32px',
        cursor: 'pointer',
        fontSize: '0.9rem',
        fontWeight: '600',
        alignSelf: 'center',
        marginTop: '24px',
        transition: 'all 0.3s ease',
        boxShadow: `0 4px 20px ${feedPrimary}40`
    },
    loadingSpinner: {
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        padding: '40px',
        color: theme.colors.mutedText,
        fontSize: '0.9rem'
    },
    errorMessage: {
        backgroundColor: '#ef4444',
        color: 'white',
        padding: '16px',
        borderRadius: '12px',
        marginBottom: '20px',
        textAlign: 'center',
        fontSize: '0.9rem',
        fontWeight: '500'
    },
    emptyState: {
        textAlign: 'center',
        padding: '60px 20px',
        color: theme.colors.mutedText
    },
    emptyStateTitle: {
        fontSize: '1.25rem',
        marginBottom: '10px',
        color: theme.colors.secondaryText,
        fontWeight: '600'
    },
    emptyStateDescription: {
        fontSize: '0.95rem',
        lineHeight: '1.6'
    },
    // New Items Notification
    newItemsNotification: {
        position: 'fixed',
        top: '80px',
        left: '50%',
        transform: 'translateX(-50%)',
        background: `linear-gradient(135deg, ${feedPrimary}, ${feedSecondary})`,
        color: 'white',
        padding: '12px 24px',
        borderRadius: '25px',
        boxShadow: `0 4px 20px ${feedPrimary}50`,
        cursor: 'pointer',
        zIndex: 1000,
        fontSize: '0.9rem',
        fontWeight: '600',
        transition: 'all 0.3s ease',
        border: 'none',
        animation: 'feedGlow 2s ease-in-out infinite'
    },
    // Filter Layout
    filterLayoutResponsive: {
        display: 'flex',
        gap: '20px',
        alignItems: 'flex-start',
        flexDirection: 'row'
    },
    filterLayoutStacked: {
        display: 'flex',
        flexDirection: 'column',
        gap: '20px'
    },
    filterLeftColumn: {
        display: 'flex',
        flexDirection: 'column',
        gap: '14px',
        flex: '1',
        minWidth: '0'
    },
    filterRightColumn: {
        flex: '1',
        minWidth: '0'
    },
    // SNS Filter Section
    snsFilterHeader: {
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: '10px'
    },
    snsToggleButton: {
        backgroundColor: 'transparent',
        border: 'none',
        color: feedPrimary,
        cursor: 'pointer',
        fontSize: '0.75rem',
        fontWeight: '600',
        padding: '4px 8px',
        display: 'flex',
        alignItems: 'center',
        gap: '4px'
    },
    checkboxContainer: {
        display: 'flex',
        flexDirection: 'column',
        gap: '4px',
        maxHeight: '220px',
        overflowY: 'auto',
        backgroundColor: theme.colors.primaryBg,
        border: `1px solid ${theme.colors.border}`,
        borderRadius: '10px',
        padding: '10px'
    },
    checkbox: {
        cursor: 'pointer',
        accentColor: feedPrimary,
        width: '16px',
        height: '16px',
        gridColumn: '1'
    },
    checkboxText: {
        color: theme.colors.secondaryText,
        fontSize: '0.8rem',
        userSelect: 'none',
        gridColumn: '3'
    },
    snsCheckboxWithLogo: {
        display: 'grid',
        gridTemplateColumns: '20px 22px 1fr',
        gap: '8px',
        alignItems: 'center',
        cursor: 'pointer',
        padding: '6px 8px',
        borderRadius: '8px',
        transition: 'background-color 0.2s ease',
        width: '100%'
    },
    clearSnsButton: {
        backgroundColor: theme.colors.tertiaryBg,
        color: theme.colors.secondaryText,
        border: `1px solid ${theme.colors.border}`,
        borderRadius: '8px',
        padding: '8px 12px',
        cursor: 'pointer',
        fontSize: '0.75rem',
        fontWeight: '500',
        marginTop: '10px',
        transition: 'all 0.2s ease',
        width: '100%'
    },
    snsLogoSmall: {
        width: '20px',
        height: '20px',
        minWidth: '20px',
        maxWidth: '20px',
        flexShrink: 0,
        borderRadius: '6px',
        objectFit: 'cover',
        border: `1px solid ${theme.colors.border}`,
        gridColumn: '2'
    },
    snsLogoPlaceholderSmall: {
        width: '20px',
        height: '20px',
        minWidth: '20px',
        maxWidth: '20px',
        flexShrink: 0,
        borderRadius: '6px',
        backgroundColor: theme.colors.tertiaryBg,
        border: `1px solid ${theme.colors.border}`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: '0.6rem',
        fontWeight: '700',
        color: theme.colors.mutedText,
        gridColumn: '2'
    }
});

function Feed() {
    const { identity, isAuthenticated } = useAuth();
    const { theme } = useTheme();
    const { selectedSnsRoot } = useSns();
    const { getPrincipalDisplayName } = useNaming();
    const navigate = useNavigate();
    const location = useLocation();
    const [searchParams] = useSearchParams();
    const scrollContainerRef = useRef(null);
    const [feedItems, setFeedItems] = useState([]);
    const [loading, setLoading] = useState(true);
    const [loadingMore, setLoadingMore] = useState(false);
    const [pollsData, setPollsData] = useState(new Map()); // pollId -> poll data
    const [loadingNewer, setLoadingNewer] = useState(false);
    const [error, setError] = useState(null);
    const [hasMore, setHasMore] = useState(true);
    const [hasNewer, setHasNewer] = useState(false);
    const [nextStartId, setNextStartId] = useState(null);
    const [prevStartId, setPrevStartId] = useState(null);
    const [canAutoLoadNewer, setCanAutoLoadNewer] = useState(true);
    const [canAutoLoadOlder, setCanAutoLoadOlder] = useState(true);
    
    // New items notification state
    const [newItemsCount, setNewItemsCount] = useState(0);
    const [showNewItemsNotification, setShowNewItemsNotification] = useState(false);
    const [lastSeenId, setLastSeenId] = useState(null);

    // Filter state
    const [showFilters, setShowFilters] = useState(false);
    const [showSnsList, setShowSnsList] = useState(true); // For collapsible SNS list
    const [showAllSnses, setShowAllSnses] = useState(false); // Expanded SNS avatar view
    const [isNarrowScreen, setIsNarrowScreen] = useState(window.innerWidth <= 768);
    const [searchText, setSearchText] = useState('');
    const [selectedCreator, setSelectedCreator] = useState('');
    const [selectedSnsList, setSelectedSnsList] = useState(() => {
        // Load SNS selection from localStorage
        try {
            const saved = localStorage.getItem('feedSnsSelection');
            return saved ? JSON.parse(saved) : [];
        } catch (e) {
            console.warn('Failed to load SNS selection from localStorage:', e);
            return [];
        }
    });
    const [selectedTypes, setSelectedTypes] = useState([]); // Array of selected types: 'forum', 'topic', 'thread', 'post', 'auction'
    const [appliedFilters, setAppliedFilters] = useState({});
    
    // All available feed item types (including auctions)
    const allFeedTypes = [
        { id: 'forum', label: 'Forum', icon: <FaComments size={12} />, color: feedBlue },
        { id: 'topic', label: 'Topic', icon: <FaLayerGroup size={12} />, color: feedGreen },
        { id: 'thread', label: 'Thread', icon: <FaStream size={12} />, color: feedPurple },
        { id: 'post', label: 'Post', icon: <FaReply size={12} />, color: feedPrimary },
        { id: 'auction', label: 'Auction', icon: <FaGavel size={12} />, color: feedAuction },
    ];
    
    // Toggle a type selection (syncs auction with header toggle)
    const toggleTypeSelection = (typeId) => {
        if (typeId === 'auction') {
            // Sync auction toggle with the header toggle
            toggleShowAuctions();
        } else {
            setSelectedTypes(prev => {
                if (prev.includes(typeId)) {
                    return prev.filter(t => t !== typeId);
                } else {
                    return [...prev, typeId];
                }
            });
        }
    };
    
    // Check if a type is selected (auction uses showAuctions, others use selectedTypes)
    const isTypeSelected = (typeId) => {
        if (typeId === 'auction') {
            return showAuctions;
        }
        // If no forum types selected, all forum types are shown
        return selectedTypes.length === 0 || selectedTypes.includes(typeId);
    };

    // SNS logos state
    const [snsLogos, setSnsLogos] = useState(new Map());
    const [loadingLogos, setLoadingLogos] = useState(new Set());
    const [allSnses, setAllSnses] = useState([]);
    const [snsInstances, setSnsInstances] = useState([]);
    
    // Auction (Sneedex) state
    const [showAuctions, setShowAuctions] = useState(() => {
        // Load auction toggle preference from localStorage
        try {
            const saved = localStorage.getItem('feedShowAuctions');
            return saved !== null ? JSON.parse(saved) : true; // Default to showing auctions
        } catch (e) {
            return true;
        }
    });
    const [auctionItems, setAuctionItems] = useState([]); // Raw auction offers
    const [loadingAuctions, setLoadingAuctions] = useState(false);
    const [auctionTokenMetadata, setAuctionTokenMetadata] = useState(new Map()); // ledger_id -> { symbol, decimals, logo }
    const [loadingAuctionTokens, setLoadingAuctionTokens] = useState(new Set());
    
    // ICP ledger ID and logo
    const ICP_LEDGER = 'ryjl3-tyaaa-aaaaa-aaaba-cai';
    const ICP_LOGO = 'https://swaprunner.com/icp_symbol.svg';
    
    // Ref to store the randomized SNS display list - only computed once per data change
    const randomizedSnsDisplayRef = useRef({ key: '', list: [] });

    // Inject CSS animations on mount
    useEffect(() => {
        injectFeedStyles();
    }, []);

    // Create forum actor
    const createForumActor = () => {
        return createActor(canisterId, {
            agentOptions: identity ? { identity } : {}
        });
    };

    // Fetch active auctions from Sneedex
    const fetchAuctions = async () => {
        if (!showAuctions) return [];
        
        try {
            setLoadingAuctions(true);
            const sneedexActor = createSneedexActor(identity);
            
            // Use the paginated feed API with Active state filter
            const input = {
                start_id: [], // Start from newest
                length: 20,
                filter: [{
                    // Include Active, Completed, and Claimed offers
                    // For Completed variant, must provide placeholder data for the record fields
                    states: [[
                        { Active: null }, 
                        { Completed: { winning_bid_id: 0n, completion_time: 0n } }, 
                        { Claimed: null }
                    ]],
                    asset_types: [],
                    creator: [],
                    has_bids: [],
                    public_only: [true], // Only public offers
                    viewer: [] // Not needed for public offers
                }]
            };
            
            const response = await sneedexActor.getOfferFeed(input);
            console.log('Fetched auctions:', response.offers.length);
            return response.offers;
        } catch (e) {
            console.error('Failed to fetch auctions:', e);
            return [];
        } finally {
            setLoadingAuctions(false);
        }
    };

    // Convert auction offer to feed item format
    const convertAuctionToFeedItem = (offer) => {
        // Generate a title from assets
        const assets = offer.assets.map(a => getAssetDetails(a));
        let title = '';
        
        if (assets.length === 1) {
            const asset = assets[0];
            if (asset.type === 'SNSNeuron') {
                title = 'SNS Neuron for Sale';
            } else if (asset.type === 'Canister') {
                // Check if it's an ICP Staking Bot (canister_kind === 1)
                if (asset.canister_kind === 1) {
                    title = asset.title || 'ICP Staking Bot for Sale';
                } else {
                    title = asset.title || 'App for Sale';
                }
            } else if (asset.type === 'ICRC1Token') {
                title = 'Token Lot for Sale';
            }
        } else {
            title = `Bundle of ${assets.length} Assets`;
        }
        
        // Use public_note as body if available
        const publicNote = offer.public_note?.[0] || null;
        
        // Get price token ledger ID
        const priceTokenLedger = offer.price_token_ledger?.toString() || null;
        
        // Check if offer is sold (Completed or Claimed state)
        const isSold = offer.state && ('Completed' in offer.state || 'Claimed' in offer.state);
        
        return {
            id: `auction_${offer.id}`, // Prefix to avoid ID collision with forum items
            item_type: { auction: null }, // Custom type
            title: title,
            body: publicNote || '', // Just the note, pricing will be rendered separately
            created_by: offer.creator,
            created_at: offer.activated_at?.[0] || offer.created_at, // Use activation time if available
            // Auction-specific fields
            _isAuction: true,
            _offerId: Number(offer.id),
            _offer: offer,
            _assets: assets,
            _priceTokenLedger: priceTokenLedger,
            _buyoutPrice: offer.buyout_price?.[0] || null,
            _minBidPrice: offer.min_bid_price?.[0] || null,
            _expiration: offer.expiration?.[0] || null,
            _isSold: isSold,
            _offerState: getOfferStateString(offer.state),
            // Compatibility fields (null/empty for auctions)
            sns_root_canister_id: null,
            forum_id: null,
            forum_title: null,
            topic_id: null,
            topic_title: null,
            thread_id: null,
            thread_title: null,
            poll_id: null,
            replied_to_post: null
        };
    };
    
    // Fetch token metadata for auction price tokens
    const fetchAuctionTokenMetadata = async (ledgerId) => {
        if (!ledgerId || auctionTokenMetadata.has(ledgerId) || loadingAuctionTokens.has(ledgerId)) {
            return;
        }
        
        setLoadingAuctionTokens(prev => new Set([...prev, ledgerId]));
        
        try {
            const agent = await HttpAgent.create({ host: 'https://icp-api.io' });
            
            // Create a minimal ICRC-1 actor for metadata
            const { Actor } = await import('@dfinity/agent');
            const icrc1IdlFactory = ({ IDL }) => {
                return IDL.Service({
                    icrc1_symbol: IDL.Func([], [IDL.Text], ['query']),
                    icrc1_decimals: IDL.Func([], [IDL.Nat8], ['query']),
                    icrc1_metadata: IDL.Func([], [IDL.Vec(IDL.Tuple(IDL.Text, IDL.Variant({
                        Nat: IDL.Nat,
                        Int: IDL.Int,
                        Text: IDL.Text,
                        Blob: IDL.Vec(IDL.Nat8)
                    })))], ['query']),
                });
            };
            
            const ledgerActor = Actor.createActor(icrc1IdlFactory, {
                agent,
                canisterId: ledgerId,
            });
            
            const [symbol, decimals, metadata] = await Promise.all([
                ledgerActor.icrc1_symbol(),
                ledgerActor.icrc1_decimals(),
                ledgerActor.icrc1_metadata().catch(() => [])
            ]);
            
            // Try to extract logo from metadata
            let logo = null;
            for (const [key, value] of metadata) {
                if (key === 'icrc1:logo' && value.Text) {
                    logo = value.Text;
                    break;
                }
            }
            
            setAuctionTokenMetadata(prev => {
                const newMap = new Map(prev);
                newMap.set(ledgerId, { symbol, decimals: Number(decimals), logo });
                return newMap;
            });
        } catch (e) {
            console.warn(`Failed to fetch token metadata for ${ledgerId}:`, e);
        } finally {
            setLoadingAuctionTokens(prev => {
                const newSet = new Set(prev);
                newSet.delete(ledgerId);
                return newSet;
            });
        }
    };

    // Toggle auction display
    const toggleShowAuctions = () => {
        const newValue = !showAuctions;
        setShowAuctions(newValue);
        localStorage.setItem('feedShowAuctions', JSON.stringify(newValue));
    };
    
    // Fetch token metadata for auctions when feed items change
    useEffect(() => {
        const auctionFeedItems = feedItems.filter(item => item._isAuction);
        const uniqueLedgers = new Set();
        
        // Collect price token ledgers
        auctionFeedItems.forEach(item => {
            if (item._priceTokenLedger) {
                uniqueLedgers.add(item._priceTokenLedger);
            }
            // Collect asset token ledgers
            if (item._assets) {
                item._assets.forEach(asset => {
                    if (asset.type === 'ICRC1Token' && asset.ledger_id) {
                        uniqueLedgers.add(asset.ledger_id);
                    }
                    // For SNS neurons, get the ledger ID from the SNS info
                    if (asset.type === 'SNSNeuron' && asset.governance_id) {
                        const snsInfo = allSnses.find(s => s.canisters?.governance === asset.governance_id);
                        if (snsInfo?.canisters?.ledger) {
                            uniqueLedgers.add(snsInfo.canisters.ledger);
                        }
                    }
                });
            }
        });
        
        uniqueLedgers.forEach(ledgerId => {
            if (!auctionTokenMetadata.has(ledgerId) && !loadingAuctionTokens.has(ledgerId)) {
                fetchAuctionTokenMetadata(ledgerId);
            }
        });
    }, [feedItems, allSnses]);
    
    // Fetch SNS logos for auction assets that are SNS neurons
    useEffect(() => {
        const auctionFeedItems = feedItems.filter(item => item._isAuction && item._assets);
        const uniqueGovernanceIds = new Set();
        
        // Collect governance IDs from SNS neuron assets
        auctionFeedItems.forEach(item => {
            item._assets.forEach(asset => {
                if (asset.type === 'SNSNeuron' && asset.governance_id) {
                    uniqueGovernanceIds.add(asset.governance_id);
                }
            });
        });
        
        // Fetch logos for each governance ID
        uniqueGovernanceIds.forEach(governanceId => {
            if (!snsLogos.has(governanceId) && !loadingLogos.has(governanceId)) {
                loadSnsLogo(governanceId);
            }
        });
    }, [feedItems, snsLogos, loadingLogos]);

    // Get/set last seen ID from localStorage
    const getLastSeenId = () => {
        try {
            const stored = localStorage.getItem('feedLastSeenId');
            return stored ? BigInt(stored) : null;
        } catch (e) {
            console.warn('Error reading last seen ID from localStorage:', e);
            return null;
        }
    };

    const saveLastSeenId = (id) => {
        try {
            if (id) {
                localStorage.setItem('feedLastSeenId', id.toString());
                setLastSeenId(id);
            }
        } catch (e) {
            console.warn('Error saving last seen ID to localStorage:', e);
        }
    };

    // Get/set highest checked ID from localStorage (to avoid redundant queries)
    const getHighestCheckedId = () => {
        try {
            const stored = localStorage.getItem('feedHighestCheckedId');
            return stored ? BigInt(stored) : null;
        } catch (e) {
            console.warn('Error reading highest checked ID from localStorage:', e);
            return null;
        }
    };

    const saveHighestCheckedId = (id) => {
        try {
            if (id) {
                localStorage.setItem('feedHighestCheckedId', id.toString());
                console.log('Saved highest checked ID:', id);
            }
        } catch (e) {
            console.warn('Error saving highest checked ID to localStorage:', e);
        }
    };

    // Check for new items with SNS filtering
    const checkForNewItems = async () => {
        try {
            const forumActor = createForumActor();
            const currentCounter = await forumActor.get_current_counter();
            const lastSeen = getLastSeenId();
            const highestChecked = getHighestCheckedId();
            
            if (lastSeen) {
                // currentCounter is the next ID to be assigned, so the last created item has ID (currentCounter - 1)
                const lastCreatedId = currentCounter - 1n;
                
                // Skip checking if we've already checked up to this ID
                if (highestChecked && lastCreatedId <= highestChecked) {
                    console.log(`Already checked up to ID ${highestChecked}, last created: ${lastCreatedId}`);
                    return;
                }
                
                if (lastCreatedId > lastSeen) {
                    // Check if we have SNS filters - if not, use simple count
                    const hasSnsFilter = appliedFilters.selectedSnsList && appliedFilters.selectedSnsList.length > 0;
                    
                    if (!hasSnsFilter) {
                        // No SNS filter - simple count based on ID difference
                        // Count items with IDs greater than lastSeen (exclude lastSeen itself)
                        const newCount = Number(lastCreatedId - lastSeen);
                        setNewItemsCount(newCount);
                        setShowNewItemsNotification(true);
                        console.log(`🐛 Found ${newCount} new items (no SNS filter). Last created ID: ${lastCreatedId}, last seen: ${lastSeen}`);
                        saveHighestCheckedId(lastCreatedId);
                        return;
                    }
                    
                    // Query page by page from newest to lastSeen with SNS filter only
                    let newItemsCount = 0;
                    let currentId = lastCreatedId;
                    const pageSize = 20;
                    
                    // Build filter with only SNS selection (no text or type filters)
                    let snsOnlyFilter = {
                        creator_principals: [],
                        topic_ids: [],
                        search_text: [],
                        sns_root_canister_ids: []
                    };
                    
                    try {
                        const principalArray = appliedFilters.selectedSnsList.map(snsId => 
                            Principal.fromText(snsId)
                        );
                        snsOnlyFilter.sns_root_canister_ids = [principalArray];
                    } catch (e) {
                        console.warn('Invalid SNS principal(s) for new items check:', appliedFilters.selectedSnsList, e);
                        // Fall back to simple count if SNS filter is invalid
                        const newCount = Number(lastCreatedId - lastSeen);
                        setNewItemsCount(newCount);
                        setShowNewItemsNotification(true);
                        saveHighestCheckedId(lastCreatedId);
                        return;
                    }
                    
                    // Query pages until we reach lastSeen
                    while (currentId > lastSeen) {
                        const input = {
                            start_id: [currentId],
                            length: pageSize,
                            filter: [snsOnlyFilter]
                        };
                        
                        const response = await forumActor.get_feed(input);
                        if (response.items.length === 0) break;
                        
                        // Count items that are newer than lastSeen
                        const relevantItems = response.items.filter(item => {
                            const itemId = typeof item.id === 'bigint' ? item.id : BigInt(item.id);
                            return itemId > lastSeen;
                        });
                        
                        newItemsCount += relevantItems.length;
                        
                        // Update currentId for next iteration
                        if (response.next_start_id && response.next_start_id.length > 0) {
                            currentId = response.next_start_id[0];
                        } else {
                            break;
                        }
                        
                        // Safety check to prevent infinite loops
                        if (currentId <= lastSeen) break;
                    }
                    
                    if (newItemsCount > 0) {
                        setNewItemsCount(newItemsCount);
                        setShowNewItemsNotification(true);
                        console.log(`Found ${newItemsCount} new items matching SNS filter. Last created ID: ${lastCreatedId}, last seen: ${lastSeen}`);
                    } else {
                        console.log(`No new items matching SNS filter. Last created ID: ${lastCreatedId}, last seen: ${lastSeen}`);
                    }
                    
                    // Save the highest ID we've checked to avoid redundant queries
                    saveHighestCheckedId(lastCreatedId);
                } else {
                    console.log(`No new items. Last created ID: ${lastCreatedId}, last seen: ${lastSeen}`);
                    // Still save that we've checked up to this ID
                    saveHighestCheckedId(lastCreatedId);
                }
            } else {
                console.log(`No last seen ID stored. Current counter: ${currentCounter}`);
            }
        } catch (error) {
            console.error('Error checking for new items:', error);
        }
    };

    // Handle clicking the new items notification
    const handleShowNewItems = () => {
        setShowNewItemsNotification(false);
        setNewItemsCount(0);
        
        // Clear the highest checked ID so we can check for new items again
        try {
            localStorage.removeItem('feedHighestCheckedId');
            console.log('Cleared highest checked ID - will check for new items again');
        } catch (e) {
            console.warn('Error clearing highest checked ID:', e);
        }
        
        // Clear scroll position when clicking new items notification (start from top)
        try {
            sessionStorage.removeItem('feedScrollPositionId');
            console.log('Cleared scroll position for new items view');
        } catch (e) {
            console.warn('Error clearing scroll position:', e);
        }
        
        // Clear text, creator, and type filters but keep SNS selection
        setSearchText('');
        setSelectedCreator('');
        setSelectedTypes([]);
        
        // Update applied filters to only include SNS selection
        const newFilters = {};
        if (selectedSnsList.length > 0) {
            newFilters.selectedSnsList = selectedSnsList;
        }
        setAppliedFilters(newFilters);
        
        // Reload feed from the top
        loadFeed(null, 'initial');
    };

    // Save SNS selection to localStorage
    useEffect(() => {
        try {
            localStorage.setItem('feedSnsSelection', JSON.stringify(selectedSnsList));
        } catch (e) {
            console.warn('Failed to save SNS selection to localStorage:', e);
        }
    }, [selectedSnsList]);

    // Load SNS data and logos
    useEffect(() => {
        const loadSnsData = () => {
            const cachedData = getAllSnses();
            if (cachedData && cachedData.length > 0) {
                setAllSnses(cachedData);
                // Convert to the format expected by the dropdown
                setSnsInstances(cachedData.map(sns => ({
                    root_canister_id: sns.rootCanisterId,
                    name: sns.name
                })));
                
                // Start loading logos for all SNSes
                cachedData.forEach(sns => {
                    if (sns.canisters.governance) {
                        loadSnsLogo(sns.canisters.governance);
                    }
                });
            } else {
                // Initialize empty array to prevent undefined errors
                setSnsInstances([]);
            }
        };
        
        loadSnsData();
    }, []);

    // Re-load SNS data when component becomes visible (e.g., after back button)
    useEffect(() => {
        const handleVisibilityChange = () => {
            if (!document.hidden && snsInstances.length === 0) {
                console.log('Page became visible and snsInstances is empty, reloading...');
                const cachedData = getAllSnses();
                if (cachedData && cachedData.length > 0) {
                    setSnsInstances(cachedData.map(sns => ({
                        root_canister_id: sns.rootCanisterId,
                        name: sns.name
                    })));
                }
            }
        };

        document.addEventListener('visibilitychange', handleVisibilityChange);
        return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
    }, [snsInstances]);

    // Handle window resize for responsive layout
    useEffect(() => {
        const handleResize = () => {
            setIsNarrowScreen(window.innerWidth <= 768);
        };

        window.addEventListener('resize', handleResize);
        return () => window.removeEventListener('resize', handleResize);
    }, []);

    // Function to load a single SNS logo
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

    // Get SNS info by root canister ID
    const getSnsInfo = (rootCanisterId) => {
        if (!rootCanisterId) return null;
        const rootStr = principalToText(rootCanisterId);
        return allSnses.find(sns => sns.rootCanisterId === rootStr);
    };

    // Format date - now using relative time from the top-level functions

    // Helper function to extract variant value from Motoko variant
    const extractVariant = (variant) => {
        if (typeof variant === 'string') return variant;
        if (typeof variant === 'object' && variant !== null) {
            const keys = Object.keys(variant);
            if (keys.length > 0) {
                return keys[0]; // Return the first (and usually only) key
            }
        }
        return String(variant);
    };

    // Filter feed items by type (frontend filtering since backend doesn't support it)
    const filterFeedItemsByType = (items, typeFilter) => {
        if (!typeFilter) return items;
        return items.filter(item => {
            const itemType = extractVariant(item.item_type);
            return itemType === typeFilter;
        });
    };

    // Get display text for type (Forum, Topic, etc.)
    const getTypeDisplayText = (type) => {
        // Handle auction type (custom feed item)
        if (type && type.auction !== undefined) {
            return 'Auction';
        }
        const typeStr = extractVariant(type);
        switch (typeStr) {
            case 'forum':
                return 'Forum';
            case 'topic':
                return 'Topic';
            case 'thread':
                return 'Thread';
            case 'post':
                return 'Post';
            case 'auction':
                return 'Auction';
            default:
                return typeStr.charAt(0).toUpperCase() + typeStr.slice(1);
        }
    };

    // Get type color
    const getTypeColor = (type) => {
        const typeStr = extractVariant(type);
        const colors = {
            forum: theme.colors.warning,
            topic: '#9b59b6',
            thread: theme.colors.success,
            post: theme.colors.accent
        };
        return colors[typeStr] || theme.colors.accent;
    };

    // Fetch polls async for feed items
    const fetchPollsForItems = async (items, actor) => {
        const pollIds = items
            .filter(item => item.poll_id && item.poll_id.length > 0)
            .map(item => Number(item.poll_id[0]));
        
        console.log('🗳️ Feed poll fetching:', { 
            totalItems: items.length, 
            itemsWithPolls: items.filter(item => item.poll_id && item.poll_id.length > 0).length,
            pollIds 
        });
        
        if (pollIds.length === 0) return;

        // Fetch polls in parallel
        const pollPromises = pollIds.map(async (pollId) => {
            try {
                const pollResponse = await actor.get_poll(pollId);
                console.log(`🗳️ Raw poll response for ${pollId}:`, pollResponse);
                if (pollResponse) {
                    // Handle Motoko optional: [] = null, [value] = Some(value)
                    const actualPoll = Array.isArray(pollResponse) && pollResponse.length > 0 ? pollResponse[0] : pollResponse;
                    return { pollId, poll: actualPoll };
                }
                return null;
            } catch (error) {
                console.warn(`Failed to fetch poll ${pollId}:`, error);
                return null;
            }
        });

        try {
            const results = await Promise.allSettled(pollPromises);
            const newPollsMap = new Map(pollsData);
            
            console.log('🗳️ Poll fetch results:', results);
            
            results.forEach((result) => {
                if (result.status === 'fulfilled' && result.value) {
                    const { pollId, poll } = result.value;
                    console.log(`🗳️ Successfully fetched poll ${pollId}:`, poll);
                    newPollsMap.set(pollId, poll);
                } else if (result.status === 'rejected') {
                    console.warn('🗳️ Poll fetch rejected:', result.reason);
                }
            });
            
            console.log('🗳️ Updated polls map:', newPollsMap);
            setPollsData(newPollsMap);
        } catch (error) {
            console.warn('Failed to fetch polls:', error);
        }
    };

    // Load feed items (supports bidirectional loading)
    const loadFeed = async (startId = null, direction = 'initial') => {
        try {
            if (direction === 'initial') {
                setLoading(true);
                setError(null);
            } else if (direction === 'older') {
                setLoadingMore(true);
            } else if (direction === 'newer') {
                setLoadingNewer(true);
            }

            const forumActor = createForumActor();
            
            // Build filter object - use Motoko optional format ([] for null, [value] for present)
            let filter = null;
            if (Object.keys(appliedFilters).length > 0) {
                filter = {
                    creator_principals: [], // Empty array means null/none
                    topic_ids: [], // Empty array means null/none
                    search_text: [], // Empty array means null/none
                    sns_root_canister_ids: [] // Empty array means null/none
                };
                
                if (appliedFilters.searchText) {
                    filter.search_text = [appliedFilters.searchText]; // Array with value
                }
                if (appliedFilters.selectedCreator) {
                    try {
                        const creatorPrincipal = Principal.fromText(appliedFilters.selectedCreator);
                        filter.creator_principals = [[creatorPrincipal]]; // Array containing array of principals
                    } catch (e) {
                        console.warn('Invalid creator principal:', appliedFilters.selectedCreator, e);
                    }
                }
                if (appliedFilters.selectedSnsList && appliedFilters.selectedSnsList.length > 0) {
                    try {
                        const principalArray = appliedFilters.selectedSnsList.map(snsId => 
                            Principal.fromText(snsId)
                        );
                        filter.sns_root_canister_ids = [principalArray]; // Wrap array in optional
                    } catch (e) {
                        console.warn('Invalid SNS principal(s):', appliedFilters.selectedSnsList, e);
                    }
                }
                // Note: We don't have topic_ids filters in the UI yet
            }

            // For newer items, we need to work differently since the API only goes backwards
            let actualStartId = startId;
            let actualLength = 20;
            
            if (direction === 'newer') {
                // For newer items, don't provide a start_id to get the latest items
                // Then we'll filter out what we already have
                actualStartId = null;
                actualLength = 20; // Use standard page size
            }

            const input = {
                start_id: actualStartId ? [actualStartId] : [],
                length: actualLength,
                filter: filter ? [filter] : []
            };

            const response = await forumActor.get_feed(input);
            
            // Apply frontend type filtering (supports multiple types)
            let filteredItems = response.items;
            if (appliedFilters.selectedTypes && appliedFilters.selectedTypes.length > 0) {
                filteredItems = response.items.filter(item => {
                    const typeStr = extractVariant(item.item_type);
                    return appliedFilters.selectedTypes.includes(typeStr);
                });
            }
            
            // Debug log to see the structure of the response
            if (response.items.length > 0) {
                console.log(`Feed ${direction} load - items:`, response.items.length, 'filtered:', filteredItems.length, 'has_more:', response.has_more);
            }
            
            if (direction === 'initial') {
                // Fetch auctions in parallel if enabled and auction type is selected (or no type filter)
                let auctionsToMerge = [];
                const hasTypeFilter = appliedFilters.selectedTypes && appliedFilters.selectedTypes.length > 0;
                const auctionTypeSelected = !hasTypeFilter || appliedFilters.selectedTypes.includes('auction');
                const shouldFetchAuctions = showAuctions && auctionTypeSelected;
                
                if (shouldFetchAuctions) {
                    try {
                        const auctions = await fetchAuctions();
                        auctionsToMerge = auctions.map(convertAuctionToFeedItem);
                        setAuctionItems(auctions);
                    } catch (e) {
                        console.warn('Failed to fetch auctions for feed:', e);
                    }
                }
                
                // Skip forum items if only auction type is selected
                const onlyAuctionSelected = hasTypeFilter && 
                    appliedFilters.selectedTypes.length === 1 && 
                    appliedFilters.selectedTypes.includes('auction');
                let forumItems = onlyAuctionSelected ? [] : filteredItems;
                
                // Merge forum items and auctions by timestamp (newest first)
                const mergedItems = [...forumItems, ...auctionsToMerge].sort((a, b) => {
                    const aTime = BigInt(a.created_at);
                    const bTime = BigInt(b.created_at);
                    if (aTime > bTime) return -1;
                    if (aTime < bTime) return 1;
                    return 0;
                });
                
                setFeedItems(mergedItems);
                setHasMore(response.has_more);
                setNextStartId(response.next_start_id.length > 0 ? response.next_start_id[0] : null);
                
                // Fetch polls for items with poll_id (async, non-blocking)
                if (forumItems.length > 0) {
                    fetchPollsForItems(forumItems, forumActor);
                }
                
                // If we started from a specific item (either URL param or back button), we might have newer items available
                const startFromParam = searchParams.get('startFrom');
                const wasBackButtonNavigation = startId !== null; // startId is set when loading from specific item
                
                if ((startFromParam || wasBackButtonNavigation) && response.items.length > 0) {
                    setHasNewer(true);
                    setPrevStartId(response.items[0].id);
                    console.log('Set hasNewer=true for specific item loading, prevStartId:', response.items[0].id);
                } else {
                    setHasNewer(false);
                    setPrevStartId(null);
                    console.log('Set hasNewer=false for top-of-feed loading');
                    
                    // If loading from the top (no specific start item), save the highest ID as last seen
                    // IMPORTANT: Only update if the new ID is higher - applying filters can return
                    // older items first, and we don't want to reset lastSeenId to a lower value
                    // which would cause false "new items" notifications
                    if (filteredItems.length > 0) {
                        const newHighestId = filteredItems[0].id;
                        const existingLastSeen = getLastSeenId();
                        if (!existingLastSeen || newHighestId > existingLastSeen) {
                            saveLastSeenId(newHighestId);
                            console.log('Saved last seen ID:', newHighestId);
                        } else {
                            console.log('Not updating lastSeenId - existing value is higher:', existingLastSeen, 'vs new:', newHighestId);
                        }
                    }
                }
            } else if (direction === 'older') {
                if (filteredItems.length > 0) {
                    setFeedItems(prev => [...prev, ...filteredItems]);
                    setHasMore(response.has_more);
                    setNextStartId(response.next_start_id.length > 0 ? response.next_start_id[0] : null);
                    
                    // Fetch polls for new items (async, non-blocking)
                    fetchPollsForItems(filteredItems, forumActor);
                } else {
                    // No more older items available, disable auto-loading
                    setCanAutoLoadOlder(false);
                    setHasMore(false);
                }
            } else if (direction === 'newer') {
                if (filteredItems.length > 0) {
                    // Filter out items we already have using a Set of existing IDs
                    const existingIds = new Set(feedItems.map(item => item.id.toString()));
                    const forumItems = feedItems.filter(item => !item._isAuction);
                    const currentFirstId = forumItems.length > 0 ? forumItems[0].id : 0n;
                    
                    const newerItems = filteredItems.filter(item => {
                        // Skip auction items in this comparison (they're handled separately)
                        if (item._isAuction) return false;
                        // Skip items we already have
                        if (existingIds.has(item.id.toString())) return false;
                        // Handle BigInt comparison for forum items
                        const itemId = typeof item.id === 'bigint' ? item.id : BigInt(item.id);
                        const currentId = typeof currentFirstId === 'bigint' ? currentFirstId : BigInt(currentFirstId);
                        return itemId > currentId;
                    });
                    
                    console.log('Filtered newer items:', newerItems.length, 'from', response.items.length, 'total. Current first ID:', currentFirstId);
                    
                    if (newerItems.length > 0) {
                        // Sort newer items in descending order (newest first) using BigInt comparison
                        newerItems.sort((a, b) => {
                            const aId = typeof a.id === 'bigint' ? a.id : BigInt(a.id);
                            const bId = typeof b.id === 'bigint' ? b.id : BigInt(b.id);
                            if (aId > bId) return -1;
                            if (aId < bId) return 1;
                            return 0;
                        });
                        
                        // Save current scroll position before adding newer items
                        const currentScrollTop = window.pageYOffset || document.documentElement.scrollTop;
                        const currentDocumentHeight = document.documentElement.scrollHeight;
                        
                        // Add newer items to the beginning
                        setFeedItems(prev => [...newerItems, ...prev]);
                        
                        // Fetch polls for new items (async, non-blocking)
                        fetchPollsForItems(newerItems, forumActor);
                        
                        // Restore scroll position after React re-renders
                        setTimeout(() => {
                            const newDocumentHeight = document.documentElement.scrollHeight;
                            const heightDifference = newDocumentHeight - currentDocumentHeight;
                            
                            // Adjust scroll position to account for new content added above
                            const newScrollTop = currentScrollTop + heightDifference;
                            window.scrollTo({
                                top: newScrollTop,
                                behavior: 'auto' // No smooth scrolling, instant adjustment
                            });
                            
                            console.log(`Scroll adjusted by ${heightDifference}px to maintain position`);
                        }, 0);
                        
                        // If we got a full page (20 items), there might be more newer items
                        // If we got less than 20, we've probably reached the newest items
                        const hasMoreNewer = newerItems.length >= 20;
                        setHasNewer(hasMoreNewer);
                        setPrevStartId(newerItems[0].id);
                        
                        // Re-enable auto-loading since we found newer items
                        setCanAutoLoadNewer(true);
                        
                        console.log(`Added ${newerItems.length} newer items. Has more newer: ${hasMoreNewer}`);
                    } else {
                        // No newer items found, disable auto-loading
                        setCanAutoLoadNewer(false);
                        setHasNewer(false);
                        console.log('No newer items found');
                    }
                } else {
                    // No more newer items available, disable auto-loading
                    setCanAutoLoadNewer(false);
                    setHasNewer(false);
                    console.log('No items returned for newer direction');
                }
            }

        } catch (err) {
            console.error(`Error loading feed (${direction}):`, err);
            if (direction === 'initial') {
                setError(formatError(err));
            }
            // For newer/older loads, disable auto-loading on error
            if (direction === 'newer') {
                setCanAutoLoadNewer(false);
            } else if (direction === 'older') {
                setCanAutoLoadOlder(false);
            }
        } finally {
            setLoading(false);
            setLoadingMore(false);
            setLoadingNewer(false);
        }
    };

    // Get/set scroll position cache (persists until browser refresh)
    const getScrollPositionId = () => {
        try {
            const stored = sessionStorage.getItem('feedScrollPositionId');
            return stored ? BigInt(stored) : null;
        } catch (e) {
            console.warn('Error reading scroll position ID from sessionStorage:', e);
            return null;
        }
    };

    const saveScrollPositionId = (id) => {
        try {
            if (id) {
                sessionStorage.setItem('feedScrollPositionId', id.toString());
                console.log('Saved scroll position ID:', id);
            }
        } catch (e) {
            console.warn('Error saving scroll position ID to sessionStorage:', e);
        }
    };

    // Clear text, creator, and type filters on page load (keep SNS selection)
    useEffect(() => {
        // Clear text, creator, and type filters but preserve SNS selection
        setSearchText('');
        setSelectedCreator('');
        setSelectedTypes([]);
        
        // Set initial applied filters to only include SNS selection
        const initialFilters = {};
        if (selectedSnsList.length > 0) {
            initialFilters.selectedSnsList = selectedSnsList;
        }
        setAppliedFilters(initialFilters);
    }, []); // Run only once on mount

    // Load initial feed
    useEffect(() => {
        // Check for cached scroll position first
        const scrollPositionId = getScrollPositionId();
        
        if (scrollPositionId) {
            console.log('Loading feed from cached scroll position:', scrollPositionId);
            loadFeed(scrollPositionId, 'initial');
        } else {
            // Check for URL parameter (manual navigation)
            const startFromParam = searchParams.get('startFrom');
            if (startFromParam) {
                console.log('Loading feed starting from URL parameter:', startFromParam);
                const startId = BigInt(startFromParam);
                loadFeed(startId, 'initial');
            } else {
                // Default: load from the top
                console.log('Loading feed from the top');
                loadFeed(null, 'initial');
            }
        }
    }, [appliedFilters, searchParams, showAuctions]); // Re-load when showAuctions changes

    // Initialize last seen ID from localStorage
    useEffect(() => {
        const storedLastSeen = getLastSeenId();
        if (storedLastSeen) {
            setLastSeenId(storedLastSeen);
            console.log('Initialized last seen ID from localStorage:', storedLastSeen);
        }
    }, []);

    // Periodic check for new items (only when authenticated)
    useEffect(() => {
        if (!identity) return;

        // Initial check after a short delay
        const initialTimer = setTimeout(() => {
            checkForNewItems();
        }, 5000); // 5 seconds after page load

        // Set up periodic checking every 30 seconds
        const interval = setInterval(() => {
            checkForNewItems();
        }, 30000); // 30 seconds

        return () => {
            clearTimeout(initialTimer);
            clearInterval(interval);
        };
    }, [identity, lastSeenId]);

    // Bidirectional infinite scroll effect with position caching
    useEffect(() => {
        const handleScroll = () => {
            const scrollTop = window.pageYOffset || document.documentElement.scrollTop;
            const windowHeight = window.innerHeight;
            const documentHeight = document.documentElement.scrollHeight;
            
            // Save scroll position based on visible items
            if (feedItems.length > 0) {
                // Find the item that's roughly in the middle of the viewport
                const viewportMiddle = scrollTop + windowHeight / 2;
                const feedContainer = document.querySelector('[data-feed-container]');
                
                if (feedContainer) {
                    const feedItemElements = feedContainer.querySelectorAll('[data-feed-item-id]');
                    let closestItem = null;
                    let closestDistance = Infinity;
                    
                    feedItemElements.forEach(element => {
                        const rect = element.getBoundingClientRect();
                        const elementTop = rect.top + scrollTop;
                        const elementMiddle = elementTop + rect.height / 2;
                        const distance = Math.abs(elementMiddle - viewportMiddle);
                        
                        if (distance < closestDistance) {
                            closestDistance = distance;
                            closestItem = element;
                        }
                    });
                    
                    if (closestItem) {
                        const itemId = closestItem.getAttribute('data-feed-item-id');
                        // Only save scroll position for forum items (not auctions which have string IDs)
                        if (itemId && !itemId.startsWith('auction_')) {
                            try {
                            saveScrollPositionId(BigInt(itemId));
                            } catch (e) {
                                // Ignore conversion errors for non-numeric IDs
                            }
                        }
                    }
                }
            }
            
            // Check if we're near the bottom (load older items)
            const isNearBottom = scrollTop + windowHeight >= documentHeight - 500;
            if (isNearBottom && hasMore && !loadingMore && !loading && nextStartId && canAutoLoadOlder) {
                console.log('Auto-loading older items');
                loadFeed(nextStartId, 'older');
            }
            
            // Check if we're near the top (load newer items)
            const isNearTop = scrollTop <= 500;
            if (isNearTop && hasNewer && !loadingNewer && !loading && prevStartId && canAutoLoadNewer) {
                console.log('Auto-loading newer items');
                loadFeed(prevStartId, 'newer');
            }
        };

        // Throttle scroll events for better performance
        let scrollTimeout;
        const throttledScroll = () => {
            if (scrollTimeout) return;
            scrollTimeout = setTimeout(() => {
                handleScroll();
                scrollTimeout = null;
            }, 100); // Throttle to every 100ms
        };

        // Add scroll event listener
        window.addEventListener('scroll', throttledScroll);
        
        // Also check on resize in case content changes
        window.addEventListener('resize', handleScroll);

        // Cleanup
        return () => {
            window.removeEventListener('scroll', throttledScroll);
            window.removeEventListener('resize', handleScroll);
            if (scrollTimeout) {
                clearTimeout(scrollTimeout);
            }
        };
    }, [hasMore, hasNewer, loadingMore, loadingNewer, loading, nextStartId, prevStartId, canAutoLoadOlder, canAutoLoadNewer, feedItems]);

    // Apply filters
    const applyFilters = () => {
        const filters = {};
        if (searchText.trim()) filters.searchText = searchText.trim();
        if (selectedCreator.trim()) filters.selectedCreator = selectedCreator.trim();
        if (selectedSnsList.length > 0) filters.selectedSnsList = selectedSnsList;
        if (selectedTypes.length > 0) filters.selectedTypes = selectedTypes;
        
        // Clear scroll position when manually applying filters (start from top)
        try {
            sessionStorage.removeItem('feedScrollPositionId');
            console.log('Cleared scroll position for manual filter application');
        } catch (e) {
            console.warn('Error clearing scroll position:', e);
        }
        
        setAppliedFilters(filters);
        setNextStartId(null);
    };

    // Clear filters (only clear principal, text, type - NOT SNS selection)
    const clearFilters = () => {
        // Clear scroll position when clearing filters (start from top)
        try {
            sessionStorage.removeItem('feedScrollPositionId');
            console.log('Cleared scroll position for filter clearing');
        } catch (e) {
            console.warn('Error clearing scroll position:', e);
        }
        
        setSearchText('');
        setSelectedCreator('');
        setSelectedTypes([]);
        
        // Keep SNS selection but clear other filters
        const newFilters = {};
        if (selectedSnsList.length > 0) {
            newFilters.selectedSnsList = selectedSnsList;
        }
        setAppliedFilters(newFilters);
        setNextStartId(null);
    };

    // Clear all SNS selections
    const clearAllSns = () => {
        setSelectedSnsList([]);
    };

    // Toggle SNS selection (for clicking on avatars)
    const toggleSnsSelection = (snsRootId) => {
        setSelectedSnsList(prev => {
            if (prev.includes(snsRootId)) {
                return prev.filter(id => id !== snsRootId);
            } else {
                return [...prev, snsRootId];
            }
        });
    };

    // Auto-apply filter when SNS selection changes (immediate feedback)
    useEffect(() => {
        // Update applied filters to include current SNS selection
        setAppliedFilters(prev => {
            const newFilters = { ...prev };
            if (selectedSnsList.length > 0) {
                newFilters.selectedSnsList = selectedSnsList;
            } else {
                delete newFilters.selectedSnsList;
            }
            return newFilters;
        });
        
        // Save to localStorage
        try {
            localStorage.setItem('feedSnsSelection', JSON.stringify(selectedSnsList));
        } catch (e) {
            console.warn('Failed to save SNS selection to localStorage:', e);
        }
    }, [selectedSnsList]);

    // Helper function to safely convert Principal to text
    const principalToText = (principal) => {
        if (!principal) return '';
        
        // If it's already a string
        if (typeof principal === 'string') return principal;
        
        // If it has toText method
        if (principal.toText && typeof principal.toText === 'function') {
            return principal.toText();
        }
        
        // If it's a Principal object with _arr property
        if (principal._arr) {
            try {
                return Principal.fromUint8Array(principal._arr).toText();
            } catch (e) {
                console.warn('Failed to convert principal with _arr:', e);
            }
        }
        
        // If it's an array (Uint8Array representation)
        if (Array.isArray(principal) || principal instanceof Uint8Array) {
            try {
                return Principal.fromUint8Array(principal).toText();
            } catch (e) {
                console.warn('Failed to convert principal array:', e);
            }
        }
        
        // Fallback - convert to string
        return String(principal);
    };

    // Convert principal to Principal object for PrincipalDisplay component
    const getPrincipalObject = (principal) => {
        try {
            const principalStr = principalToText(principal);
            if (!principalStr || !principalStr.trim()) {
                return null;
            }
            return Principal.fromText(principalStr);
        } catch (e) {
            console.warn('Failed to convert principal:', principal, e);
            return null;
        }
    };

    // Get navigation URL for item type
    const getItemNavigationUrl = (item) => {
        // Handle auction items
        if (item._isAuction) {
            return `/sneedex_offer/${item._offerId}`;
        }
        
        const typeStr = extractVariant(item.item_type);
        const snsRootId = Array.isArray(item.sns_root_canister_id) ? item.sns_root_canister_id[0] : item.sns_root_canister_id;
        const snsRootStr = principalToText(snsRootId);
        
        switch (typeStr) {
            case 'forum':
                return `/forum?sns=${snsRootStr}`;
            case 'topic':
                const topicId = Array.isArray(item.topic_id) ? item.topic_id[0] : item.topic_id;
                return `/topic/${topicId || item.id}?sns=${snsRootStr}`;
            case 'thread':
                const threadId = Array.isArray(item.thread_id) ? item.thread_id[0] : item.thread_id;
                return `/thread?threadid=${threadId || item.id}`;
            case 'post':
                return `/post?postid=${item.id}`;
            default:
                return '#';
        }
    };

    // Get fallback title for items without titles
    const getFallbackTitle = (item) => {
        const typeStr = extractVariant(item.item_type);
        const capitalizedType = typeStr.charAt(0).toUpperCase() + typeStr.slice(1);
        return `${capitalizedType} #${item.id}`;
    };

    // Get display title (actual title or fallback)
    const getDisplayTitle = (item) => {
        const actualTitle = Array.isArray(item.title) ? item.title[0] : item.title;
        if (actualTitle && actualTitle.trim().length > 0) {
            return actualTitle;
        }
        return getFallbackTitle(item);
    };

    // Type badge colors and icons
    const getTypeStyle = (type) => {
        switch (type) {
            case 'Forum':
                return { bg: feedBlue, icon: <FaComments size={10} /> };
            case 'Topic':
                return { bg: feedGreen, icon: <FaLayerGroup size={10} /> };
            case 'Thread':
                return { bg: feedPurple, icon: <FaStream size={10} /> };
            case 'Post':
                return { bg: feedPrimary, icon: <FaReply size={10} /> };
            case 'Auction':
                return { bg: feedAuction, icon: <FaGavel size={10} /> };
            default:
                return { bg: theme.colors.accent, icon: null };
        }
    };

    // Render feed item
    const renderFeedItem = (item, index) => {
        const typeDisplayText = getTypeDisplayText(item.item_type);
        const typeStyle = getTypeStyle(typeDisplayText);
        
        // Get SNS info and logo
        const snsRootId = Array.isArray(item.sns_root_canister_id) ? item.sns_root_canister_id[0] : item.sns_root_canister_id;
        const snsInfo = getSnsInfo(snsRootId);
        const snsLogo = snsInfo ? snsLogos.get(snsInfo.canisters.governance) : null;
        const isLoadingLogo = snsInfo ? loadingLogos.has(snsInfo.canisters.governance) : false;
        
        // Get creator principal object
        const creatorPrincipal = getPrincipalObject(item.created_by);
        const creatorDisplayInfo = creatorPrincipal ? getPrincipalDisplayName(creatorPrincipal) : null;
        
        // Handle SNS logo click to navigate to forum
        const handleSnsLogoClick = () => {
            const snsRootId = Array.isArray(item.sns_root_canister_id) ? item.sns_root_canister_id[0] : item.sns_root_canister_id;
            const snsRootStr = principalToText(snsRootId);
            navigate(`/forum?sns=${snsRootStr}`);
        };

        // Get navigation URL and display title
        const navigationUrl = getItemNavigationUrl(item);
        const displayTitle = getDisplayTitle(item);

        // Handle item navigation
        const handleItemClick = () => {
            navigate(navigationUrl);
        };
        
        return (
            <div 
                key={item.id} 
                className="feed-card feed-item-animate" 
                style={{
                    ...getStyles(theme).feedItem,
                    animationDelay: `${Math.min(index * 0.05, 0.5)}s`
                }} 
                data-feed-item-id={item.id.toString()}
            >
                {/* Status banners for auctions */}
                {item._isAuction && (() => {
                    const state = item._offerState;
                    let bannerText = null;
                    let bannerColor = null;
                    
                    if (state === 'Completed' || state === 'Claimed') {
                        bannerText = 'SOLD';
                        bannerColor = 'linear-gradient(135deg, #e74c3c, #c0392b)';
                    } else if (state === 'Expired') {
                        bannerText = 'EXPIRED';
                        bannerColor = 'linear-gradient(135deg, #6b7280, #4b5563)';
                    } else if (state === 'Cancelled') {
                        bannerText = 'CANCELLED';
                        bannerColor = 'linear-gradient(135deg, #f59e0b, #d97706)';
                    } else if (state === 'Reclaimed') {
                        bannerText = 'EXPIRED';
                        bannerColor = 'linear-gradient(135deg, #6b7280, #4b5563)';
                    }
                    
                    return bannerText ? (
                        <div style={{
                            position: 'absolute',
                            top: '12px',
                            right: '-30px',
                            background: bannerColor,
                            color: '#fff',
                            padding: '4px 40px',
                            fontWeight: '700',
                            fontSize: '0.7rem',
                            transform: 'rotate(45deg)',
                            boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
                            zIndex: 10,
                            letterSpacing: '1px',
                        }}>
                            {bannerText}
                        </div>
                    ) : null;
                })()}
                
                {/* Logo - SNS logo for forum items, Sneedex icon for auctions */}
                {item._isAuction ? (
                    <div
                        style={{
                            ...getStyles(theme).snsLogoPlaceholder,
                            background: (() => {
                                const state = item._offerState;
                                if (state === 'Completed' || state === 'Claimed') {
                                    return 'linear-gradient(135deg, #6b7280, #4b5563)'; // Gray for sold
                                } else if (state === 'Expired' || state === 'Cancelled' || state === 'Reclaimed') {
                                    return 'linear-gradient(135deg, #9ca3af, #6b7280)'; // Lighter gray for inactive
                                }
                                return `linear-gradient(135deg, ${feedAuction}, #7c3aed)`; // Purple for active
                            })(),
                            cursor: 'pointer'
                        }}
                        onClick={handleItemClick}
                        title="View Auction on Sneedex"
                    >
                        <FaGavel size={20} style={{ color: 'white' }} />
                    </div>
                ) : snsInfo && (
                            <div 
                                style={getStyles(theme).snsLogoPlaceholder}
                                onClick={handleSnsLogoClick}
                                title={`Go to ${snsInfo.name} Forum`}
                            >
                        {isLoadingLogo ? (
                            <span style={{ animation: 'feedPulse 1.5s ease-in-out infinite' }}>...</span>
                        ) : snsLogo ? (
                            <img
                                src={snsLogo}
                                alt={snsInfo.name}
                                style={{
                                    width: '100%',
                                    height: '100%',
                                    objectFit: 'cover',
                                    borderRadius: '10px'
                                }}
                            />
                        ) : (
                            <span>{snsInfo.name.substring(0, 2).toUpperCase()}</span>
                        )}
                            </div>
                )}
                
                {/* Content */}
                <div style={getStyles(theme).feedItemContent}>
                    <div style={getStyles(theme).feedItemHeader}>
                        <div style={getStyles(theme).feedItemHeaderLeft}>
                            <span 
                                className="feed-type-badge"
                                style={{
                                    ...getStyles(theme).feedItemType, 
                                    backgroundColor: typeStyle.bg,
                                    color: 'white'
                                }}
                                onClick={handleItemClick}
                                title={`Go to ${typeDisplayText.toLowerCase()}`}
                            >
                                {typeStyle.icon}
                                {typeDisplayText}
                            </span>
                            {creatorPrincipal && (
                                <PrincipalDisplay
                                    principal={creatorPrincipal}
                                    displayInfo={creatorDisplayInfo}
                                    short={true}
                                    style={{ fontSize: '0.8rem' }}
                                    isAuthenticated={isAuthenticated}
                                />
                            )}
                            {item._isAuction ? (
                                <>
                                    <span style={{
                                        fontSize: '0.75rem',
                                        color: 'white',
                                        backgroundColor: feedAuction,
                                        padding: '3px 8px',
                                        borderRadius: '6px',
                                        fontWeight: '500'
                                    }}>
                                        Sneedex
                                    </span>
                                    {item._assets && item._assets.length > 0 && (
                                        <span style={{
                                            fontSize: '0.7rem',
                                            color: theme.colors.secondaryText,
                                            backgroundColor: theme.colors.tertiaryBg,
                                            padding: '2px 6px',
                                            borderRadius: '4px'
                                        }}>
                                            {item._assets.length === 1 
                                                ? item._assets[0].type 
                                                : `${item._assets.length} assets`}
                                        </span>
                                    )}
                                </>
                            ) : snsInfo && (
                                <span style={{
                                    fontSize: '0.75rem',
                                    color: theme.colors.mutedText,
                                    backgroundColor: theme.colors.tertiaryBg,
                                    padding: '3px 8px',
                                    borderRadius: '6px'
                                }}>
                                    {snsInfo.name}
                                </span>
                            )}
                        </div>
                        <span 
                            style={{...getStyles(theme).feedItemDate, cursor: 'help'}}
                            title={getFullDate(item.created_at)}
                        >
                            {formatRelativeTime(item.created_at)}
                        </span>
                    </div>
                    
                    {/* Title */}
                    <h3 
                        className="feed-title-link"
                        style={getStyles(theme).feedItemTitle}
                        onClick={handleItemClick}
                        title={`Go to ${typeDisplayText.toLowerCase()}`}
                    >
                        {displayTitle}
                    </h3>
                    
                    {/* Auction info - what's being sold and pricing */}
                    {item._isAuction && (
                        <div style={{
                            marginBottom: '12px',
                            padding: '12px',
                            backgroundColor: theme.colors.tertiaryBg,
                            borderRadius: '10px',
                            border: `1px solid ${theme.colors.border}`
                        }}>
                            {/* Assets being sold */}
                            {item._assets && item._assets.length > 0 && (
                                <div style={{ marginBottom: '10px' }}>
                                    <div style={{ 
                                        fontSize: '0.7rem', 
                                        color: theme.colors.mutedText, 
                                        marginBottom: '6px',
                                        textTransform: 'uppercase',
                                        letterSpacing: '0.5px'
                                    }}>
                                        For Sale:
                                    </div>
                                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                                        {item._assets.map((asset, idx) => {
                                            // Get token metadata for this asset
                                            const assetTokenMeta = asset.ledger_id ? auctionTokenMetadata.get(asset.ledger_id) : null;
                                            const isLoadingAssetToken = asset.ledger_id ? loadingAuctionTokens.has(asset.ledger_id) : false;
                                            
                                            // For SNS neurons, get SNS info and token symbol
                                            const snsNeuronInfo = asset.type === 'SNSNeuron' && asset.governance_id 
                                                ? allSnses.find(s => s.canisters?.governance === asset.governance_id)
                                                : null;
                                            const snsNeuronLogo = snsNeuronInfo ? snsLogos.get(snsNeuronInfo.canisters.governance) : null;
                                            const snsTokenMeta = snsNeuronInfo?.canisters?.ledger ? auctionTokenMetadata.get(snsNeuronInfo.canisters.ledger) : null;
                                            
                                            // Check if it's an ICP Neuron Manager canister
                                            const isNeuronManager = asset.type === 'Canister' && asset.canister_kind === 1;
                                            
                                            return (
                                                <div key={idx} style={{
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    gap: '6px',
                                                    padding: '4px 10px',
                                                    backgroundColor: theme.colors.secondaryBg,
                                                    borderRadius: '6px',
                                                    border: `1px solid ${theme.colors.border}`,
                                                    fontSize: '0.8rem'
                                                }}>
                                                    {asset.type === 'SNSNeuron' && (
                                                        <>
                                                            <span style={{ position: 'relative', display: 'inline-flex', marginRight: '4px' }}>
                                                                <FaBrain style={{ color: feedGreen, fontSize: '16px' }} />
                                                                {snsNeuronLogo && (
                                                                    <img 
                                                                        src={snsNeuronLogo} 
                                                                        alt={snsNeuronInfo?.name || 'SNS'} 
                                                                        style={{ 
                                                                            width: 10, 
                                                                            height: 10, 
                                                                            borderRadius: '50%',
                                                                            position: 'absolute',
                                                                            bottom: -2,
                                                                            right: -4,
                                                                            border: `1px solid ${theme.colors.tertiaryBg}`,
                                                                            background: theme.colors.tertiaryBg,
                                                                        }}
                                                                    />
                                                                )}
                                                            </span>
                                                            <span style={{ color: theme.colors.primaryText }}>
                                                                {asset.cached_stake_e8s 
                                                                    ? `${formatAmount(asset.cached_stake_e8s)} ${snsTokenMeta?.symbol || snsNeuronInfo?.name || 'SNS'}`
                                                                    : `${snsNeuronInfo?.name || 'SNS'} Neuron`
                                                                }
                                                            </span>
                                                        </>
                                                    )}
                                                    {asset.type === 'Canister' && (
                                                        <>
                                                            {isNeuronManager ? (
                                                                <>
                                                                    <span style={{ position: 'relative', display: 'inline-flex', marginRight: '4px' }}>
                                                                        <FaRobot style={{ color: theme.colors.accent, fontSize: '16px' }} />
                                                                        <img 
                                                                            src={ICP_LOGO} 
                                                                            alt="ICP" 
                                                                            style={{ 
                                                                                width: 10, 
                                                                                height: 10, 
                                                                                borderRadius: '50%',
                                                                                position: 'absolute',
                                                                                bottom: -2,
                                                                                right: -4,
                                                                                border: `1px solid ${theme.colors.tertiaryBg}`,
                                                                                background: theme.colors.tertiaryBg,
                                                                            }}
                                                                        />
                                                                    </span>
                                                                    <span style={{ color: theme.colors.primaryText }}>
                                                                        {asset.cached_total_stake_e8s 
                                                                            ? `${formatAmount(asset.cached_total_stake_e8s)} ICP`
                                                                            : asset.title || 'ICP Staking Bot'
                                                                        }
                                                                    </span>
                                                                </>
                                                            ) : (
                                                                <>
                                                                    <FaCube style={{ color: feedBlue, fontSize: '14px' }} />
                                                                    <span style={{ color: theme.colors.primaryText }}>
                                                                        {asset.title || 'App'}
                                                                    </span>
                                                                </>
                                                            )}
                                                        </>
                                                    )}
                                                    {asset.type === 'ICRC1Token' && (
                                                        <>
                                                            {(() => {
                                                                const tokenLogo = assetTokenMeta?.logo || (asset.ledger_id === ICP_LEDGER ? ICP_LOGO : null);
                                                                const tokenSymbol = assetTokenMeta?.symbol || (asset.ledger_id === ICP_LEDGER ? 'ICP' : (isLoadingAssetToken ? '...' : 'tokens'));
                                                                const tokenDecimals = assetTokenMeta?.decimals ?? 8;
                                                                return (
                                                                    <>
                                                                        {tokenLogo ? (
                                                                            <TokenIcon logo={tokenLogo} size={18} borderRadius="4px" />
                                                                        ) : (
                                                                            <span style={{ color: feedAccent }}>🪙</span>
                                                                        )}
                                                                        <span style={{ color: theme.colors.primaryText }}>
                                                                            {formatAmount(asset.amount, tokenDecimals)} {tokenSymbol}
                                                                        </span>
                                                                    </>
                                                                );
                                                            })()}
                                                        </>
                                                    )}
                                                </div>
                                            );
                                        })}
                                    </div>
                                </div>
                            )}
                            
                            {/* Pricing info */}
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px' }}>
                                {(() => {
                                    const tokenMeta = item._priceTokenLedger ? auctionTokenMetadata.get(item._priceTokenLedger) : null;
                                    const isLoadingToken = item._priceTokenLedger ? loadingAuctionTokens.has(item._priceTokenLedger) : false;
                                    const isIcp = item._priceTokenLedger === ICP_LEDGER;
                                    const symbol = tokenMeta?.symbol || (isIcp ? 'ICP' : (isLoadingToken ? '...' : 'tokens'));
                                    const decimals = tokenMeta?.decimals ?? 8;
                                    const logo = tokenMeta?.logo;
                                    const displayLogo = logo || (isIcp ? ICP_LOGO : null);
                                    
                                    const formatPrice = (price) => {
                                        if (!price) return null;
                                        return formatAmount(price, decimals);
                                    };
                                    
                                    return (
                                        <>
                                            {item._buyoutPrice && (
                                                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                                    <span style={{ fontSize: '0.75rem', color: theme.colors.mutedText }}>Buyout:</span>
                                                    {displayLogo && (
                                                        <TokenIcon logo={displayLogo} size={16} borderRadius="4px" />
                                                    )}
                                                    <span style={{ fontSize: '0.85rem', fontWeight: '600', color: feedGreen }}>
                                                        {isLoadingToken ? '...' : formatPrice(item._buyoutPrice)} {symbol}
                                                    </span>
                                                </div>
                                            )}
                                            {item._minBidPrice && (
                                                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                                    <span style={{ fontSize: '0.75rem', color: theme.colors.mutedText }}>Min bid:</span>
                                                    {displayLogo && !item._buyoutPrice && (
                                                        <TokenIcon logo={displayLogo} size={16} borderRadius="4px" />
                                                    )}
                                                    <span style={{ fontSize: '0.85rem', fontWeight: '500', color: theme.colors.primaryText }}>
                                                        {isLoadingToken ? '...' : formatPrice(item._minBidPrice)} {symbol}
                                                    </span>
                                                </div>
                                            )}
                                            {(() => {
                                                const isInactive = item._offerState && 
                                                    ['Completed', 'Claimed', 'Expired', 'Cancelled', 'Reclaimed'].includes(item._offerState);
                                                
                                                if (isInactive) {
                                                    // Don't show time for inactive auctions
                                                    return null;
                                                }
                                                
                                                if (item._expiration) {
                                                    const timeRemaining = formatTimeRemaining(item._expiration);
                                                    return (
                                                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                                            <FaClock size={12} style={{ color: theme.colors.mutedText }} />
                                                            <span style={{ fontSize: '0.75rem', color: theme.colors.mutedText }}>Ends:</span>
                                                            <span style={{ 
                                                                fontSize: '0.85rem', 
                                                                fontWeight: '500', 
                                                                color: timeRemaining === 'Expired' ? '#ef4444' : feedPrimary 
                                                            }}>
                                                                {timeRemaining}
                                                            </span>
                                                        </div>
                                                    );
                                                }
                                                return null;
                                            })()}
                                        </>
                                    );
                                })()}
                            </div>
                        </div>
                    )}
                    
                    {/* Body preview */}
                    {item.body && item.body.length > 0 && !item._isAuction && (
                        <div style={getStyles(theme).feedItemBody}>
                            <MarkdownBody 
                                text={(() => {
                                const bodyText = Array.isArray(item.body) ? item.body[0] : item.body;
                                return bodyText.length > 250 ? `${bodyText.substring(0, 250)}...` : bodyText;
                            })()}
                            />
                            {/* Fade overlay */}
                            <div style={{
                                position: 'absolute',
                                bottom: 0,
                                left: 0,
                                right: 0,
                                height: '40px',
                                background: `linear-gradient(transparent, ${theme.colors.secondaryBg})`,
                                pointerEvents: 'none'
                            }} />
                        </div>
                    )}
                    
                    {/* Auction public note */}
                    {item._isAuction && item.body && item.body.length > 0 && (
                        <div style={{
                            fontSize: '0.85rem',
                            color: theme.colors.secondaryText,
                            lineHeight: '1.5',
                            marginBottom: '8px'
                        }}>
                            {item.body.length > 200 ? `${item.body.substring(0, 200)}...` : item.body}
                        </div>
                    )}

                    {/* Replied-to post information */}
                    {item.replied_to_post && item.replied_to_post.length > 0 && (
                        <div style={{
                            backgroundColor: theme.colors.tertiaryBg,
                            border: `1px solid ${theme.colors.border}`,
                            borderRadius: '10px',
                            padding: '12px',
                            margin: '12px 0',
                            borderLeft: `3px solid ${feedPrimary}`
                        }}>
                            <div style={{
                                fontSize: '0.75rem',
                                color: theme.colors.mutedText,
                                marginBottom: '6px',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '6px'
                            }}>
                                <FaReply size={10} style={{ color: feedPrimary }} />
                                Replying to:
                            </div>
                            {item.replied_to_post[0].title && item.replied_to_post[0].title.length > 0 && (
                                <div style={{
                                    fontSize: '13px',
                                    color: theme.colors.primaryText,
                                    fontWeight: '500',
                                    marginBottom: '4px'
                                }}>
                                    {Array.isArray(item.replied_to_post[0].title) ? item.replied_to_post[0].title[0] : item.replied_to_post[0].title}
                                </div>
                            )}
                            <div style={{
                                fontSize: '12px',
                                color: theme.colors.secondaryText,
                                lineHeight: '1.4'
                            }}>
                                <MarkdownBody 
                                    text={(() => {
                                    const replyBody = item.replied_to_post[0].body;
                                    return replyBody.length > 150 ? `${replyBody.substring(0, 150)}...` : replyBody;
                                })()}
                                />
                            </div>
                        </div>
                    )}

                    {/* Poll information */}
                    {item.poll_id && item.poll_id.length > 0 && (
                        <div style={{ margin: '12px 0' }}>
                            {(() => {
                                const pollId = Number(item.poll_id[0]);
                                const poll = pollsData.get(pollId);
                                
                                if (poll) {
                                    console.log('🗳️ Rendering poll in feed:', poll);
                                    // The poll data is wrapped in an array, extract the actual poll object
                                    const actualPoll = Array.isArray(poll) ? poll[0] : poll;
                                    console.log('🗳️ Extracted poll object:', actualPoll);
                                    return (
                                        <Poll 
                                            poll={actualPoll}
                                            showCreateForm={false}
                                            selectedNeurons={[]}
                                            allNeurons={[]}
                                            totalVotingPower={0}
                                        />
                                    );
                                } else {
                                    return (
                                        <div style={{
                                            backgroundColor: theme.colors.secondaryBg,
                                            borderRadius: '6px',
                                            padding: '16px',
                                            border: `1px solid ${theme.colors.border}`,
                                            fontSize: '12px',
                                            color: '#9b59b6'
                                        }}>
                                            📊 Poll (loading...)
                                        </div>
                                    );
                                }
                            })()}
                        </div>
                    )}
                    
                    {/* Context links - topic and thread */}
                    {(item.topic_title || item.thread_title) && (
                    <div style={getStyles(theme).feedItemContext}>
                        {item.topic_title && (Array.isArray(item.topic_title) ? item.topic_title.length > 0 : true) && (
                            <Link 
                                to={`/topic/${Array.isArray(item.topic_id) ? item.topic_id[0] : item.topic_id}`} 
                                    className="feed-context-tag"
                                style={getStyles(theme).contextLink}
                            >
                                    <FaLayerGroup size={10} />
                                    {Array.isArray(item.topic_title) ? item.topic_title[0] : item.topic_title}
                            </Link>
                        )}
                        
                        {item.thread_title && (Array.isArray(item.thread_title) ? item.thread_title.length > 0 : true) && (
                            <Link 
                                to={`/thread?threadid=${Array.isArray(item.thread_id) ? item.thread_id[0] : item.thread_id}`} 
                                    className="feed-context-tag"
                                style={getStyles(theme).contextLink}
                            >
                                    <FaStream size={10} />
                                    {Array.isArray(item.thread_title) ? item.thread_title[0] : item.thread_title}
                            </Link>
                        )}
                    </div>
                    )}
                </div>
            </div>
        );
    };

    return (
        <div>
            <Header showSnsDropdown={true} />
            
            {/* New Items Notification Overlay */}
            {showNewItemsNotification && (
                <div 
                    style={getStyles(theme).newItemsNotification}
                    onClick={handleShowNewItems}
                >
                    <FaRss style={{ marginRight: '8px' }} />
                    {newItemsCount === 1 
                        ? '1 new item' 
                        : `${newItemsCount} new items`
                    } • Click to view
                </div>
            )}
            
            <div 
                style={{
                    background: theme.colors.primaryGradient,
                    color: theme.colors.primaryText,
                    minHeight: '100vh'
                }}
            >
                {/* Hero Section */}
                <div style={{
                    background: `linear-gradient(135deg, ${theme.colors.primaryBg} 0%, ${feedPrimary}15 50%, ${feedSecondary}10 100%)`,
                    borderBottom: `1px solid ${theme.colors.border}`,
                    padding: '2rem 1.5rem',
                    position: 'relative',
                    overflow: 'hidden'
                }}>
                    {/* Background decorations */}
                    <div style={{
                        position: 'absolute',
                        top: '-50%',
                        right: '-10%',
                        width: '400px',
                        height: '400px',
                        background: `radial-gradient(circle, ${feedPrimary}20 0%, transparent 70%)`,
                        borderRadius: '50%',
                        pointerEvents: 'none'
                    }} />
                    <div style={{
                        position: 'absolute',
                        bottom: '-30%',
                        left: '-5%',
                        width: '300px',
                        height: '300px',
                        background: `radial-gradient(circle, ${feedSecondary}15 0%, transparent 70%)`,
                        borderRadius: '50%',
                        pointerEvents: 'none'
                    }} />
                    
                    <div style={{ maxWidth: '900px', margin: '0 auto', position: 'relative', zIndex: 1 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '1rem' }}>
                            <div style={{
                                width: '56px',
                                height: '56px',
                                borderRadius: '14px',
                                background: `linear-gradient(135deg, ${feedPrimary}, ${feedSecondary})`,
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                boxShadow: `0 4px 20px ${feedPrimary}40`,
                                flexShrink: 0
                            }}>
                                <FaRss size={24} color="white" />
                            </div>
                            <div>
                                <h1 style={{ 
                                    color: theme.colors.primaryText, 
                                    fontSize: '1.75rem', 
                                    fontWeight: '700', 
                                    margin: 0 
                                }}>
                                    Sneed's Feed
                                </h1>
                                <p style={{ 
                                    color: theme.colors.secondaryText, 
                                    fontSize: '0.95rem', 
                                    margin: '0.25rem 0 0 0' 
                                }}>
                                    {selectedSnsList.length > 0 
                                        ? `Filtering ${selectedSnsList.length} of ${snsInstances.length} SNS forums`
                                        : `Real-time activity from ${snsInstances.length} SNS forums`
                                    }
                                </p>
                            </div>
                        </div>

                        {/* SNS Avatars Row - Clickable to toggle filter */}
                    {(() => {
                            if (snsInstances.length === 0) return null;
                            
                            // Determine which SNSes to display
                            // When collapsed: show up to 10, prioritizing selected ones
                            // When expanded: show all
                            const maxCollapsed = 10;
                            let displaySnses;
                            
                            if (showAllSnses) {
                                // Show all SNSes when expanded
                                displaySnses = snsInstances;
                            } else {
                                // Create stable prioritized list for collapsed view
                                // Key includes selection state so list updates when selection changes significantly
                                const snsKey = `${snsInstances.length}-${selectedSnsList.length > 0 ? 'filtered' : 'all'}`;
                                
                                if (randomizedSnsDisplayRef.current.key !== snsKey) {
                                    // Prioritize selected SNSes, then fill with random others
                                    const selectedSet = new Set(selectedSnsList);
                                    const selected = snsInstances.filter(sns => selectedSet.has(sns.root_canister_id));
                                    const unselected = snsInstances.filter(sns => !selectedSet.has(sns.root_canister_id));
                                    
                                    // Shuffle unselected to get random sample
                                    const shuffledUnselected = [...unselected].sort(() => Math.random() - 0.5);
                                    
                                    // Take selected first, then fill remaining slots with unselected
                                    const combined = [
                                        ...selected.slice(0, maxCollapsed),
                                        ...shuffledUnselected.slice(0, Math.max(0, maxCollapsed - selected.length))
                                    ];
                                    
                                    randomizedSnsDisplayRef.current = { key: snsKey, list: combined };
                                }
                                
                                displaySnses = randomizedSnsDisplayRef.current.list;
                            }
                            
                            const hiddenCount = snsInstances.length - displaySnses.length;
                            const hasSelection = selectedSnsList.length > 0;
                            
                            return (
                                <div style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    gap: '6px',
                                    flexWrap: 'wrap',
                                    maxWidth: showAllSnses ? '100%' : '600px'
                                }}>
                                    {displaySnses.map((sns, index) => {
                                        const snsInfo = getSnsInfo(sns.root_canister_id);
                                        const snsLogo = snsInfo ? snsLogos.get(snsInfo.canisters.governance) : null;
                                        const isLoadingLogo = snsInfo ? loadingLogos.has(snsInfo.canisters.governance) : false;
                                        const isSelected = selectedSnsList.includes(sns.root_canister_id);
                                        
                                        // If there's a selection, unselected items appear faded
                                        // If no selection, all items appear fully opaque (showing all)
                                        const opacity = hasSelection && !isSelected ? 0.35 : 1;
                                        const borderColor = isSelected ? feedPrimary : theme.colors.border;
                                        
                                        return (
                                            <div
                                                key={sns.root_canister_id}
                                                className="feed-sns-avatar"
                                                onClick={() => toggleSnsSelection(sns.root_canister_id)}
                                                style={{
                                                    width: '32px',
                                                    height: '32px',
                                                    minWidth: '32px',
                                                    maxWidth: '32px',
                                                    flexShrink: 0,
                                                    borderRadius: '8px',
                                                    overflow: 'hidden',
                                                    cursor: 'pointer',
                                                    boxShadow: isSelected 
                                                        ? `0 2px 8px ${feedPrimary}50` 
                                                        : '0 2px 6px rgba(0, 0, 0, 0.2)',
                                                    border: `2px solid ${borderColor}`,
                                                    transition: 'all 0.2s ease',
                                                    opacity: opacity
                                                }}
                                                title={`${snsInfo?.name || sns.name || 'SNS'}${isSelected ? ' (selected)' : hasSelection ? ' (click to include)' : ' (click to filter)'}`}
                                            >
                                                {isLoadingLogo ? (
                                                    <div style={{
                                                        width: '100%',
                                                        height: '100%',
                                                        backgroundColor: theme.colors.tertiaryBg,
                                                        display: 'flex',
                                                        alignItems: 'center',
                                                        justifyContent: 'center',
                                                        fontSize: '9px',
                                                        color: theme.colors.mutedText,
                                                        animation: 'feedPulse 1.5s ease-in-out infinite'
                                                    }}>
                                                        ...
                                                    </div>
                                                ) : snsLogo ? (
                                                    <img
                                                        src={snsLogo}
                                                        alt={snsInfo?.name || sns.name}
                                                        style={{
                                                            width: '100%',
                                                            height: '100%',
                                                            objectFit: 'cover'
                                                        }}
                                                    />
                                                ) : (
                                                    <div style={{
                                                        width: '100%',
                                                        height: '100%',
                                                        backgroundColor: theme.colors.tertiaryBg,
                                                        display: 'flex',
                                                        alignItems: 'center',
                                                        justifyContent: 'center',
                                                        fontSize: '0.6rem',
                                                        fontWeight: '700',
                                                        color: theme.colors.secondaryText
                                                    }}>
                                                        {(snsInfo?.name || sns.name || 'SNS').substring(0, 2).toUpperCase()}
                                                    </div>
                                                )}
                                            </div>
                                        );
                                    })}
                                    
                                    {/* Expand/Collapse button */}
                                    {(hiddenCount > 0 || showAllSnses) && (
                                        <button
                                            onClick={() => setShowAllSnses(!showAllSnses)}
                                            style={{
                                                width: '32px',
                                                height: '32px',
                                                borderRadius: '8px',
                                                backgroundColor: theme.colors.tertiaryBg,
                                                border: `1.5px solid ${theme.colors.border}`,
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'center',
                                                fontSize: '0.6rem',
                                                fontWeight: '700',
                                                color: theme.colors.secondaryText,
                                                cursor: 'pointer',
                                                transition: 'all 0.2s ease'
                                            }}
                                            title={showAllSnses ? 'Show less' : `Show all ${snsInstances.length} SNSes`}
                                        >
                                            {showAllSnses ? <FaChevronUp size={10} /> : `+${hiddenCount}`}
                                        </button>
                                    )}
                                    
                                    {/* Clear selection button - only show when there's a selection */}
                                    {hasSelection && (
                                    <button 
                                            onClick={() => setSelectedSnsList([])}
                                        style={{
                                                width: '32px',
                                                height: '32px',
                                                borderRadius: '8px',
                                                backgroundColor: theme.colors.tertiaryBg,
                                                border: `1.5px solid ${theme.colors.border}`,
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'center',
                                                color: theme.colors.mutedText,
                                            cursor: 'pointer',
                                            transition: 'all 0.2s ease'
                                        }}
                                            title="Clear SNS filter (show all)"
                                        >
                                            <FaTimes size={10} />
                                        </button>
                                    )}
                                    
                                    {/* Auction Toggle */}
                                    <button 
                                        onClick={toggleShowAuctions}
                                        className="feed-filter-toggle"
                                        style={{
                                            width: '32px',
                                            height: '32px',
                                            borderRadius: '8px',
                                            backgroundColor: showAuctions ? feedAuction : theme.colors.secondaryBg,
                                            border: `1.5px solid ${showAuctions ? feedAuction : theme.colors.border}`,
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'center',
                                            color: showAuctions ? 'white' : theme.colors.mutedText,
                                            cursor: 'pointer',
                                            marginLeft: '4px'
                                        }}
                                        title={showAuctions ? 'Hide auctions from feed' : 'Show auctions in feed'}
                                    >
                                        <FaGavel size={10} />
                                    </button>
                                    
                                    {/* Advanced Filter Toggle */}
                                    <button 
                                        onClick={() => setShowFilters(!showFilters)}
                                        className="feed-filter-toggle"
                                        style={{
                                            width: '32px',
                                            height: '32px',
                                            borderRadius: '8px',
                                            backgroundColor: showFilters ? feedPrimary : theme.colors.secondaryBg,
                                            border: `1.5px solid ${showFilters ? feedPrimary : theme.colors.border}`,
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'center',
                                            color: showFilters ? 'white' : theme.colors.mutedText,
                                            cursor: 'pointer',
                                            marginLeft: '4px'
                                        }}
                                        title={showFilters ? 'Hide advanced filters' : 'Show advanced filters'}
                                    >
                                        <FaFilter size={10} />
                                    </button>
                            </div>
                        );
                    })()}
                    </div>
                </div>

            <div ref={scrollContainerRef} style={getStyles(theme).container}>
                {/* Filter Section */}
                {showFilters && (
                    <div style={getStyles(theme).filterSection}>
                        <div style={{ 
                            display: 'flex', 
                            alignItems: 'center', 
                            gap: '8px', 
                            marginBottom: '16px',
                            paddingBottom: '12px',
                            borderBottom: `1px solid ${theme.colors.border}`
                        }}>
                            <FaFilter size={14} style={{ color: feedPrimary }} />
                            <span style={{ 
                                fontSize: '0.9rem', 
                                fontWeight: '600', 
                                color: theme.colors.primaryText 
                            }}>
                                Filters
                            </span>
                            {(searchText || selectedCreator || selectedTypes.length > 0) && (
                                <span style={{
                                    fontSize: '0.7rem',
                                    backgroundColor: feedPrimary,
                                    color: 'white',
                                    padding: '2px 8px',
                                    borderRadius: '10px',
                                    fontWeight: '600'
                                }}>
                                    Active
                                </span>
                            )}
                        </div>
                        
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                            {/* Types filter - full width */}
                                    <div style={getStyles(theme).filterGroup}>
                                <label style={getStyles(theme).filterLabel}>
                                    <FaList size={10} style={{ marginRight: '6px' }} />
                                    Filter by Type {selectedTypes.length > 0 && `(${selectedTypes.length} selected)`}
                                </label>
                                <div style={{
                                    display: 'flex',
                                    flexWrap: 'wrap',
                                    gap: '8px',
                                    padding: '10px',
                                    backgroundColor: theme.colors.primaryBg,
                                    borderRadius: '10px',
                                    border: `1px solid ${theme.colors.border}`
                                }}>
                                    {allFeedTypes.map(type => {
                                        const isSelected = isTypeSelected(type.id);
                                        return (
                                            <button
                                                key={type.id}
                                                onClick={() => toggleTypeSelection(type.id)}
                                                className="feed-sns-avatar"
                                                style={{
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    gap: '6px',
                                                    padding: '6px 12px',
                                                    borderRadius: '8px',
                                                    border: `1.5px solid ${isSelected ? type.color : theme.colors.border}`,
                                                    backgroundColor: isSelected ? `${type.color}20` : theme.colors.secondaryBg,
                                                    color: isSelected ? type.color : theme.colors.mutedText,
                                                    cursor: 'pointer',
                                                    fontSize: '0.8rem',
                                                    fontWeight: '500',
                                                    opacity: isSelected ? 1 : 0.6,
                                                    transition: 'all 0.2s ease'
                                                }}
                                                title={isSelected ? `Hide ${type.label}s` : `Show ${type.label}s`}
                                            >
                                                <span style={{ 
                                                    display: 'flex', 
                                                    alignItems: 'center',
                                                    color: isSelected ? type.color : theme.colors.mutedText
                                                }}>
                                                    {type.icon}
                                                </span>
                                                {type.label}
                                            </button>
                                        );
                                    })}
                                    {selectedTypes.length > 0 && (
                                        <button
                                            onClick={() => setSelectedTypes([])}
                                            style={{
                                                display: 'flex',
                                                alignItems: 'center',
                                                gap: '4px',
                                                padding: '6px 10px',
                                                borderRadius: '8px',
                                                border: `1px dashed ${theme.colors.border}`,
                                                backgroundColor: 'transparent',
                                                color: theme.colors.mutedText,
                                                cursor: 'pointer',
                                                fontSize: '0.75rem',
                                                fontWeight: '400'
                                            }}
                                            title="Show all types"
                                        >
                                            <FaTimes size={10} />
                                            Clear
                                        </button>
                                    )}
                                </div>
                                <div style={{ 
                                    fontSize: '0.7rem', 
                                    color: theme.colors.mutedText, 
                                    marginTop: '4px' 
                                }}>
                                    {(() => {
                                        const activeForumTypes = selectedTypes.length === 0 
                                            ? allFeedTypes.filter(t => t.id !== 'auction').map(t => t.label)
                                            : selectedTypes.map(t => allFeedTypes.find(ft => ft.id === t)?.label).filter(Boolean);
                                        const parts = [];
                                        if (activeForumTypes.length > 0) parts.push(activeForumTypes.join(', '));
                                        if (showAuctions) parts.push('Auctions');
                                        return parts.length > 0 ? `Showing: ${parts.join(', ')}` : 'No types selected';
                                    })()}
                                </div>
                            </div>
                            
                            {/* User and Search filters - side by side on larger screens */}
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '14px' }}>
                                <div style={getStyles(theme).filterGroup}>
                                    <label style={getStyles(theme).filterLabel}>
                                        <FaUser size={10} style={{ marginRight: '6px' }} />
                                        User
                                    </label>
                                        <PrincipalInput
                                            value={selectedCreator}
                                            onChange={setSelectedCreator}
                                            placeholder="Enter principal ID or search by name"
                                            style={{ width: '100%' }}
                                        />
                                    </div>
                                    
                                    <div style={getStyles(theme).filterGroup}>
                                    <label style={getStyles(theme).filterLabel}>
                                        <FaSearch size={10} style={{ marginRight: '6px' }} />
                                        Search Text
                                    </label>
                                        <input
                                            type="text"
                                            value={searchText}
                                            onChange={(e) => setSearchText(e.target.value)}
                                            placeholder="Search in titles and content..."
                                            style={getStyles(theme).filterInput}
                                        />
                                </div>
                                    </div>
                                    
                                    {/* Filter Buttons */}
                            <div style={{ display: 'flex', gap: '10px' }}>
                                        <button onClick={applyFilters} style={getStyles(theme).applyButton}>
                                            Apply Filters
                                        </button>
                                        <button onClick={clearFilters} style={getStyles(theme).clearButton}>
                                            Clear Filters
                                        </button>
                                    </div>
                                </div>
                    </div>
                )}

                {/* Error Message */}
                {error && (
                    <div style={getStyles(theme).errorMessage}>
                        {error}
                    </div>
                )}

                {/* Loading State */}
                {loading && (
                    <div style={getStyles(theme).loadingSpinner}>
                        Loading feed...
                    </div>
                )}

                {/* Feed Items */}
                {!loading && (
                    <div style={getStyles(theme).feedContainer} data-feed-container>
                        {feedItems.length > 0 ? (
                            <>
                                {/* Load More Newer Items Button */}
                                {(hasNewer || loadingNewer) && (
                                    <div style={{
                                        textAlign: 'center',
                                        padding: '20px',
                                        marginBottom: '20px'
                                    }}>
                                        {loadingNewer ? (
                                            <div style={getStyles(theme).loadingSpinner}>
                                                Loading newer items...
                                            </div>
                                        ) : (
                                            <button
                                                onClick={() => {
                                                    setCanAutoLoadNewer(true);
                                                    loadFeed(prevStartId, 'newer');
                                                }}
                                                style={{
                                                    ...getStyles(theme).applyButton,
                                                    fontSize: '13px',
                                                    padding: '10px 20px'
                                                }}
                                                disabled={!prevStartId}
                                            >
                                                Load More Recent
                                            </button>
                                        )}
                                    </div>
                                )}

                                {feedItems && feedItems.map((item, index) => (
                                    <FeedItemCard
                                        key={item.id}
                                        item={item}
                                        index={index}
                                        compact={false}
                                        getSnsInfo={getSnsInfo}
                                        snsLogos={snsLogos}
                                        loadingLogos={loadingLogos}
                                        getPrincipalDisplayName={getPrincipalDisplayName}
                                        principalToText={principalToText}
                                        Principal={Principal}
                                        isAuthenticated={isAuthenticated}
                                        auctionTokenMetadata={auctionTokenMetadata}
                                        loadingAuctionTokens={loadingAuctionTokens}
                                        allSnses={allSnses}
                                        pollsData={pollsData}
                                    />
                                ))}
                                
                                {/* Load More Older Items - Loading indicator or manual button */}
                                {(loadingMore || (hasMore && !canAutoLoadOlder)) && (
                                    <div style={{
                                        textAlign: 'center',
                                        padding: '20px',
                                        marginTop: '20px'
                                    }}>
                                        {loadingMore ? (
                                            <div style={getStyles(theme).loadingSpinner}>
                                                Loading more items...
                                            </div>
                                        ) : hasMore && !canAutoLoadOlder ? (
                                            <button
                                                onClick={() => {
                                                    setCanAutoLoadOlder(true);
                                                    loadFeed(nextStartId, 'older');
                                                }}
                                                style={{
                                                    ...getStyles(theme).applyButton,
                                                    fontSize: '13px',
                                                    padding: '10px 20px'
                                                }}
                                                disabled={!nextStartId}
                                            >
                                                Load More Older
                                            </button>
                                        ) : null}
                                    </div>
                                )}
                                
                                {/* End of feed indicator */}
                                {!hasMore && feedItems.length > 0 && (
                                    <div style={{
                                        textAlign: 'center',
                                        padding: '30px 16px',
                                        color: theme.colors.mutedText,
                                        fontSize: '13px'
                                    }}>
                                        You've reached the end of the feed
                                    </div>
                                )}
                            </>
                        ) : (
                            <div style={getStyles(theme).emptyState}>
                                <h3 style={getStyles(theme).emptyStateTitle}>No Activity Yet</h3>
                                <p style={getStyles(theme).emptyStateDescription}>
                                    There's no activity to show yet. Check back later or try adjusting your filters.
                                </p>
                            </div>
                        )}
                    </div>
                )}
            </div>
            </div>
        </div>
    );
}

export default Feed;
