import React, { useState, useEffect, useCallback } from 'react';
import Header from '../components/Header';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import { FaSearch, FaFilter, FaGavel, FaClock, FaTag, FaCubes, FaBrain, FaCoins, FaArrowRight, FaSync, FaGlobe, FaLock } from 'react-icons/fa';
import { 
    createSneedexActor, 
    formatAmount, 
    formatTimeRemaining, 
    getOfferStateString,
    getAssetType,
    getAssetDetails
} from '../utils/SneedexUtils';
import { createActor as createBackendActor } from 'declarations/app_sneeddao_backend';

const backendCanisterId = process.env.CANISTER_ID_APP_SNEEDDAO_BACKEND || process.env.REACT_APP_BACKEND_CANISTER_ID;

function SneedexOffers() {
    const { identity, isAuthenticated, principal } = useAuth();
    const { theme } = useTheme();
    const navigate = useNavigate();
    
    const [offers, setOffers] = useState([]);
    const [offersWithBids, setOffersWithBids] = useState({}); // Map of offerId to bid info
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [searchTerm, setSearchTerm] = useState('');
    const [filterType, setFilterType] = useState('all'); // all, canister, neuron, token
    const [sortBy, setSortBy] = useState('newest'); // newest, ending_soon, highest_bid, lowest_price
    const [whitelistedTokens, setWhitelistedTokens] = useState([]);
    const [offerTab, setOfferTab] = useState('public'); // 'public' or 'private'
    
    // Fetch whitelisted tokens for metadata lookup
    useEffect(() => {
        const fetchTokens = async () => {
            try {
                const backendActor = createBackendActor(backendCanisterId, {
                    agentOptions: { identity }
                });
                const tokens = await backendActor.get_whitelisted_tokens();
                setWhitelistedTokens(tokens);
            } catch (e) {
                console.error('Failed to fetch whitelisted tokens:', e);
            }
        };
        fetchTokens();
    }, [identity]);
    
    // Helper to get token info from whitelisted tokens
    const getTokenInfo = useCallback((ledgerId) => {
        const token = whitelistedTokens.find(t => t.ledger_id.toString() === ledgerId);
        if (token) {
            return { symbol: token.symbol, decimals: Number(token.decimals), name: token.name };
        }
        // Fallback for known tokens
        if (ledgerId === 'ryjl3-tyaaa-aaaaa-aaaba-cai') return { symbol: 'ICP', decimals: 8 };
        return { symbol: 'TOKEN', decimals: 8 };
    }, [whitelistedTokens]);
    
    const fetchOffers = useCallback(async () => {
        setLoading(true);
        setError('');
        try {
            const actor = createSneedexActor(identity);
            let activeOffers;
            
            if (offerTab === 'public') {
                // Fetch public offers (no approved bidders list)
                activeOffers = await actor.getPublicOffers();
            } else {
                // Fetch private offers where user is creator or in approved bidders list
                if (principal) {
                    activeOffers = await actor.getPrivateOffers(principal);
                } else {
                    activeOffers = [];
                }
            }
            
            setOffers(activeOffers);
            
            // Fetch bid info for each offer
            const bidInfo = {};
            for (const offer of activeOffers) {
                try {
                    const offerView = await actor.getOfferView(offer.id);
                    if (offerView && offerView.length > 0) {
                        bidInfo[Number(offer.id)] = {
                            bids: offerView[0].bids,
                            highest_bid: offerView[0].highest_bid[0] || null,
                        };
                    }
                } catch (e) {
                    console.warn(`Failed to fetch bid info for offer ${offer.id}:`, e);
                }
            }
            setOffersWithBids(bidInfo);
        } catch (e) {
            console.error('Failed to fetch offers:', e);
            setError('Failed to load offers. Please try again.');
        } finally {
            setLoading(false);
        }
    }, [identity, offerTab, principal]);
    
    useEffect(() => {
        fetchOffers();
    }, [fetchOffers]);
    
    const getAssetTypeIcon = (type) => {
        switch (type) {
            case 'Canister': return <FaCubes style={{ color: theme.colors.accent }} />;
            case 'SNSNeuron': return <FaBrain style={{ color: theme.colors.success }} />;
            case 'ICRC1Token': return <FaCoins style={{ color: theme.colors.warning }} />;
            default: return <FaCubes />;
        }
    };
    
    const getAssetSummary = (assets) => {
        const counts = { Canister: 0, SNSNeuron: 0, ICRC1Token: 0 };
        assets.forEach(a => {
            const type = getAssetType(a.asset);
            counts[type]++;
        });
        
        const parts = [];
        if (counts.Canister > 0) parts.push(`${counts.Canister} Canister${counts.Canister > 1 ? 's' : ''}`);
        if (counts.SNSNeuron > 0) parts.push(`${counts.SNSNeuron} Neuron${counts.SNSNeuron > 1 ? 's' : ''}`);
        if (counts.ICRC1Token > 0) parts.push(`${counts.ICRC1Token} Token${counts.ICRC1Token > 1 ? 's' : ''}`);
        
        return parts.join(', ');
    };
    
    const filteredOffers = offers.filter(offer => {
        if (filterType !== 'all') {
            const hasType = offer.assets.some(a => {
                const type = getAssetType(a.asset);
                if (filterType === 'canister') return type === 'Canister';
                if (filterType === 'neuron') return type === 'SNSNeuron';
                if (filterType === 'token') return type === 'ICRC1Token';
                return true;
            });
            if (!hasType) return false;
        }
        
        // Search by offer ID or creator
        if (searchTerm) {
            const term = searchTerm.toLowerCase();
            const matchId = offer.id.toString().includes(term);
            const matchCreator = offer.creator.toString().toLowerCase().includes(term);
            if (!matchId && !matchCreator) return false;
        }
        
        return true;
    }).sort((a, b) => {
        const aBids = offersWithBids[Number(a.id)] || {};
        const bBids = offersWithBids[Number(b.id)] || {};
        
        switch (sortBy) {
            case 'newest': 
                return Number(b.created_at) - Number(a.created_at);
            case 'ending_soon': 
                if (!a.expiration[0]) return 1;
                if (!b.expiration[0]) return -1;
                return Number(a.expiration[0]) - Number(b.expiration[0]);
            case 'highest_bid':
                const aHighest = aBids.highest_bid?.amount || 0n;
                const bHighest = bBids.highest_bid?.amount || 0n;
                return Number(bHighest) - Number(aHighest);
            case 'lowest_price':
                const aPrice = a.min_bid_price[0] || a.buyout_price[0] || 0n;
                const bPrice = b.min_bid_price[0] || b.buyout_price[0] || 0n;
                return Number(aPrice) - Number(bPrice);
            default: return 0;
        }
    });

    const styles = {
        container: {
            maxWidth: '1400px',
            margin: '0 auto',
            padding: '2rem',
            color: theme.colors.primaryText,
        },
        header: {
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: '2rem',
            flexWrap: 'wrap',
            gap: '1rem',
        },
        title: {
            fontSize: '2.5rem',
            fontWeight: '700',
            color: theme.colors.accent,
            margin: 0,
        },
        headerButtons: {
            display: 'flex',
            gap: '1rem',
        },
        createButton: {
            background: `linear-gradient(135deg, ${theme.colors.success}, ${theme.colors.success}cc)`,
            color: theme.colors.primaryBg,
            padding: '12px 24px',
            borderRadius: '10px',
            border: 'none',
            fontSize: '1rem',
            fontWeight: '600',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            textDecoration: 'none',
            transition: 'all 0.3s ease',
        },
        refreshButton: {
            background: theme.colors.tertiaryBg,
            color: theme.colors.primaryText,
            padding: '12px 16px',
            borderRadius: '10px',
            border: `1px solid ${theme.colors.border}`,
            fontSize: '1rem',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            transition: 'all 0.3s ease',
        },
        tabContainer: {
            display: 'flex',
            gap: '8px',
            marginBottom: '1.5rem',
            background: theme.colors.tertiaryBg,
            padding: '6px',
            borderRadius: '12px',
            width: 'fit-content',
        },
        tab: {
            padding: '10px 20px',
            borderRadius: '8px',
            border: 'none',
            background: 'transparent',
            color: theme.colors.mutedText,
            cursor: 'pointer',
            fontSize: '0.95rem',
            fontWeight: '500',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            transition: 'all 0.2s ease',
        },
        tabActive: {
            background: theme.colors.secondaryBg,
            color: theme.colors.primaryText,
            boxShadow: `0 2px 8px ${theme.colors.shadow}`,
        },
        controls: {
            display: 'flex',
            gap: '1rem',
            marginBottom: '2rem',
            flexWrap: 'wrap',
            alignItems: 'center',
        },
        searchBox: {
            flex: '1',
            minWidth: '250px',
            position: 'relative',
        },
        searchInput: {
            width: '100%',
            padding: '12px 16px 12px 44px',
            borderRadius: '10px',
            border: `1px solid ${theme.colors.border}`,
            background: theme.colors.secondaryBg,
            color: theme.colors.primaryText,
            fontSize: '1rem',
            outline: 'none',
            transition: 'border-color 0.3s ease',
            boxSizing: 'border-box',
        },
        searchIcon: {
            position: 'absolute',
            left: '14px',
            top: '50%',
            transform: 'translateY(-50%)',
            color: theme.colors.mutedText,
        },
        select: {
            padding: '12px 16px',
            borderRadius: '10px',
            border: `1px solid ${theme.colors.border}`,
            background: theme.colors.secondaryBg,
            color: theme.colors.primaryText,
            fontSize: '0.95rem',
            cursor: 'pointer',
            outline: 'none',
            minWidth: '150px',
        },
        grid: {
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(380px, 1fr))',
            gap: '1.5rem',
        },
        card: {
            background: theme.colors.cardGradient,
            border: `1px solid ${theme.colors.border}`,
            borderRadius: '16px',
            padding: '1.5rem',
            transition: 'all 0.3s ease',
            cursor: 'pointer',
        },
        cardHeader: {
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-start',
            marginBottom: '1rem',
        },
        offerId: {
            fontSize: '0.85rem',
            color: theme.colors.mutedText,
            fontFamily: 'monospace',
        },
        cardBadge: {
            background: `${theme.colors.success}20`,
            color: theme.colors.success,
            padding: '4px 10px',
            borderRadius: '6px',
            fontSize: '0.8rem',
            fontWeight: '600',
        },
        assetsRow: {
            display: 'flex',
            gap: '0.5rem',
            marginBottom: '1rem',
            flexWrap: 'wrap',
        },
        assetBadge: {
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            background: theme.colors.tertiaryBg,
            padding: '6px 12px',
            borderRadius: '8px',
            fontSize: '0.85rem',
            color: theme.colors.secondaryText,
        },
        priceSection: {
            display: 'grid',
            gridTemplateColumns: 'repeat(2, 1fr)',
            gap: '1rem',
            marginBottom: '1rem',
            padding: '1rem',
            background: theme.colors.tertiaryBg,
            borderRadius: '10px',
        },
        priceItem: {
            textAlign: 'center',
        },
        priceLabel: {
            fontSize: '0.75rem',
            color: theme.colors.mutedText,
            textTransform: 'uppercase',
            letterSpacing: '0.5px',
            marginBottom: '4px',
        },
        priceValue: {
            fontSize: '1.2rem',
            fontWeight: '700',
            color: theme.colors.primaryText,
        },
        priceToken: {
            fontSize: '0.85rem',
            color: theme.colors.mutedText,
        },
        cardFooter: {
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            paddingTop: '1rem',
            borderTop: `1px solid ${theme.colors.border}`,
        },
        timeInfo: {
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            fontSize: '0.9rem',
            color: theme.colors.mutedText,
        },
        bidInfo: {
            textAlign: 'right',
        },
        bidCount: {
            fontSize: '0.85rem',
            color: theme.colors.mutedText,
        },
        highestBid: {
            fontSize: '1rem',
            fontWeight: '600',
            color: theme.colors.success,
        },
        emptyState: {
            textAlign: 'center',
            padding: '4rem 2rem',
            background: theme.colors.cardGradient,
            borderRadius: '16px',
            border: `1px solid ${theme.colors.border}`,
        },
        emptyIcon: {
            fontSize: '4rem',
            marginBottom: '1rem',
        },
        emptyTitle: {
            fontSize: '1.5rem',
            fontWeight: '600',
            color: theme.colors.primaryText,
            marginBottom: '0.5rem',
        },
        emptyText: {
            color: theme.colors.mutedText,
            marginBottom: '1.5rem',
        },
        loadingState: {
            textAlign: 'center',
            padding: '4rem 2rem',
            color: theme.colors.mutedText,
        },
        errorState: {
            textAlign: 'center',
            padding: '2rem',
            background: `${theme.colors.error || '#ff4444'}15`,
            border: `1px solid ${theme.colors.error || '#ff4444'}`,
            borderRadius: '12px',
            color: theme.colors.error || '#ff4444',
            marginBottom: '2rem',
        },
    };

    return (
        <div className='page-container' style={{ background: theme.colors.primaryGradient, minHeight: '100vh' }}>
            <Header />
            <main style={styles.container}>
                <div style={styles.header}>
                    <h1 style={styles.title}>Marketplace</h1>
                    <div style={styles.headerButtons}>
                        <button
                            style={styles.refreshButton}
                            onClick={fetchOffers}
                            disabled={loading}
                        >
                            <FaSync style={{ animation: loading ? 'spin 1s linear infinite' : 'none' }} />
                            {loading ? 'Loading...' : 'Refresh'}
                        </button>
                        {isAuthenticated && (
                            <Link
                                to="/sneedex_create"
                                style={styles.createButton}
                                onMouseEnter={(e) => {
                                    e.target.style.transform = 'translateY(-2px)';
                                    e.target.style.boxShadow = `0 6px 20px ${theme.colors.success}40`;
                                }}
                                onMouseLeave={(e) => {
                                    e.target.style.transform = 'translateY(0)';
                                    e.target.style.boxShadow = 'none';
                                }}
                            >
                                <FaGavel /> Create Offer
                            </Link>
                        )}
                    </div>
                </div>
                
                {error && (
                    <div style={styles.errorState}>
                        {error}
                    </div>
                )}
                
                {/* Public/Private tabs */}
                <div style={styles.tabContainer}>
                    <button
                        style={{
                            ...styles.tab,
                            ...(offerTab === 'public' ? styles.tabActive : {})
                        }}
                        onClick={() => setOfferTab('public')}
                    >
                        <FaGlobe /> Public Offers
                    </button>
                    <button
                        style={{
                            ...styles.tab,
                            ...(offerTab === 'private' ? styles.tabActive : {})
                        }}
                        onClick={() => setOfferTab('private')}
                        disabled={!isAuthenticated}
                        title={!isAuthenticated ? 'Connect wallet to view private offers' : ''}
                    >
                        <FaLock /> Private (OTC)
                    </button>
                </div>
                
                <div style={styles.controls}>
                    <div style={styles.searchBox}>
                        <FaSearch style={styles.searchIcon} />
                        <input
                            type="text"
                            placeholder="Search by offer ID or creator..."
                            style={styles.searchInput}
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            onFocus={(e) => e.target.style.borderColor = theme.colors.accent}
                            onBlur={(e) => e.target.style.borderColor = theme.colors.border}
                        />
                    </div>
                    <select
                        style={styles.select}
                        value={filterType}
                        onChange={(e) => setFilterType(e.target.value)}
                    >
                        <option value="all">All Assets</option>
                        <option value="canister">Canisters</option>
                        <option value="neuron">SNS Neurons</option>
                        <option value="token">ICRC1 Tokens</option>
                    </select>
                    <select
                        style={styles.select}
                        value={sortBy}
                        onChange={(e) => setSortBy(e.target.value)}
                    >
                        <option value="newest">Newest First</option>
                        <option value="ending_soon">Ending Soon</option>
                        <option value="highest_bid">Highest Bid</option>
                        <option value="lowest_price">Lowest Price</option>
                    </select>
                </div>
                
                {loading && offers.length === 0 ? (
                    <div style={styles.loadingState}>
                        <div style={{ fontSize: '2rem', marginBottom: '1rem' }}>⏳</div>
                        Loading offers...
                    </div>
                ) : filteredOffers.length === 0 ? (
                    <div style={styles.emptyState}>
                        <div style={styles.emptyIcon}>{offerTab === 'public' ? '📭' : '🔐'}</div>
                        <h3 style={styles.emptyTitle}>
                            {offerTab === 'public' ? 'No Public Offers' : 'No Private Offers'}
                        </h3>
                        <p style={styles.emptyText}>
                            {offerTab === 'public' 
                                ? 'There are no public offers matching your criteria. Be the first to create one!'
                                : isAuthenticated 
                                    ? 'You have no private offers available. Private offers are only visible to you if you created them or were added as an approved bidder.'
                                    : 'Connect your wallet to view private offers where you are an approved bidder.'
                            }
                        </p>
                        {isAuthenticated && (
                            <Link to="/sneedex_create" style={styles.createButton}>
                                <FaGavel /> Create Offer
                            </Link>
                        )}
                    </div>
                ) : (
                    <div style={styles.grid}>
                        {filteredOffers.map((offer) => {
                            const bidInfo = offersWithBids[Number(offer.id)] || {};
                            const tokenInfo = getTokenInfo(offer.price_token_ledger.toString());
                            
                            return (
                                <div
                                    key={Number(offer.id)}
                                    style={styles.card}
                                    onClick={() => navigate(`/sneedex_offer/${offer.id}`)}
                                    onMouseEnter={(e) => {
                                        e.currentTarget.style.transform = 'translateY(-4px)';
                                        e.currentTarget.style.borderColor = theme.colors.accent;
                                        e.currentTarget.style.boxShadow = `0 12px 40px ${theme.colors.accent}15`;
                                    }}
                                    onMouseLeave={(e) => {
                                        e.currentTarget.style.transform = 'translateY(0)';
                                        e.currentTarget.style.borderColor = theme.colors.border;
                                        e.currentTarget.style.boxShadow = 'none';
                                    }}
                                >
                                    <div style={styles.cardHeader}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                            <span style={styles.offerId}>Offer #{Number(offer.id)}</span>
                                            {offer.approved_bidders && offer.approved_bidders[0] && offer.approved_bidders[0].length > 0 && (
                                                <span style={{
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    gap: '4px',
                                                    background: `${theme.colors.warning}20`,
                                                    color: theme.colors.warning,
                                                    padding: '2px 8px',
                                                    borderRadius: '4px',
                                                    fontSize: '0.75rem',
                                                    fontWeight: '500',
                                                }}>
                                                    <FaLock size={10} />
                                                    {offer.approved_bidders[0].length} bidder{offer.approved_bidders[0].length !== 1 ? 's' : ''}
                                                </span>
                                            )}
                                        </div>
                                        <span style={styles.cardBadge}>{getOfferStateString(offer.state)}</span>
                                    </div>
                                    
                                    <div style={styles.assetsRow}>
                                        {offer.assets.map((assetEntry, idx) => {
                                            const details = getAssetDetails(assetEntry);
                                            return (
                                                <span key={idx} style={styles.assetBadge}>
                                                    {getAssetTypeIcon(details.type)}
                                                    {details.type === 'Canister' && 'Canister'}
                                                    {details.type === 'SNSNeuron' && 'Neuron'}
                                                    {details.type === 'ICRC1Token' && `${formatAmount(details.amount)} Tokens`}
                                                </span>
                                            );
                                        })}
                                    </div>
                                    
                                    <div style={styles.priceSection}>
                                        <div style={styles.priceItem}>
                                            <div style={styles.priceLabel}>Min Bid</div>
                                            <div style={styles.priceValue}>
                                                {offer.min_bid_price[0] ? formatAmount(offer.min_bid_price[0], tokenInfo.decimals) : '—'}
                                            </div>
                                            <div style={styles.priceToken}>{tokenInfo.symbol}</div>
                                        </div>
                                        <div style={styles.priceItem}>
                                            <div style={styles.priceLabel}>Buyout</div>
                                            <div style={styles.priceValue}>
                                                {offer.buyout_price[0] ? formatAmount(offer.buyout_price[0], tokenInfo.decimals) : '—'}
                                            </div>
                                            <div style={styles.priceToken}>{tokenInfo.symbol}</div>
                                        </div>
                                    </div>
                                    
                                    <div style={styles.cardFooter}>
                                        <div style={styles.timeInfo}>
                                            <FaClock />
                                            {formatTimeRemaining(offer.expiration[0])}
                                        </div>
                                        <div style={styles.bidInfo}>
                                            <div style={styles.bidCount}>
                                                {bidInfo.bids?.length || 0} bid{(bidInfo.bids?.length || 0) !== 1 ? 's' : ''}
                                            </div>
                                            {bidInfo.highest_bid && (
                                                <div style={styles.highestBid}>
                                                    {formatAmount(bidInfo.highest_bid.amount, tokenInfo.decimals)} {tokenInfo.symbol}
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}
            </main>
            
            <style>{`
                @keyframes spin {
                    from { transform: rotate(0deg); }
                    to { transform: rotate(360deg); }
                }
            `}</style>
        </div>
    );
}

export default SneedexOffers;
