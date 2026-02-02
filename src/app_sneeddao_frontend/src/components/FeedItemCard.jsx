import React from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTheme } from '../contexts/ThemeContext';
import { FaComments, FaLayerGroup, FaStream, FaReply, FaGavel, FaBrain, FaRobot, FaCube, FaClock } from 'react-icons/fa';
import { PrincipalDisplay } from '../utils/PrincipalUtils';
import { formatAmount, formatTimeRemaining } from '../utils/SneedexUtils';
import TokenIcon from './TokenIcon';
import MarkdownBody from './MarkdownBody';
import Poll from './Poll';

// Accent colors
const feedPrimary = '#f97316';
const feedSecondary = '#fb923c';
const feedAccent = '#fbbf24';
const feedGreen = '#22c55e';
const feedBlue = '#3b82f6';
const feedPurple = '#a855f7';
const feedAuction = '#8b5cf6';

const ICP_LEDGER = 'ryjl3-tyaaa-aaaaa-aaaba-cai';
const ICP_LOGO = '/icp_symbol.svg';

// Format relative time (e.g., "5m", "2h", "3d")
const formatRelativeTime = (timestamp) => {
    const date = new Date(Number(timestamp) / 1000000);
    const now = new Date();
    const diffMs = now - date;
    const diffSeconds = Math.floor(diffMs / 1000);
    const diffMinutes = Math.floor(diffSeconds / 60);
    const diffHours = Math.floor(diffMinutes / 60);
    const diffDays = Math.floor(diffHours / 24);
    const diffWeeks = Math.floor(diffDays / 7);
    const diffMonths = Math.floor(diffDays / 30);
    const diffYears = Math.floor(diffDays / 365);

    if (diffYears >= 1) return `${diffYears}y`;
    if (diffMonths >= 1) return `${diffMonths}mo`;
    if (diffWeeks >= 1) return `${diffWeeks}w`;
    if (diffDays >= 1) return `${diffDays}d`;
    if (diffHours >= 1) return `${diffHours}h`;
    if (diffMinutes >= 1) return `${diffMinutes}m`;
    return 'now';
};

// Get full date for tooltip
const getFullDate = (timestamp) => {
    const date = new Date(Number(timestamp) / 1000000);
    return date.toLocaleString();
};

// Extract variant from type enum
const extractVariant = (type) => {
    if (!type) return 'unknown';
    if (typeof type === 'string') return type.toLowerCase();
    if (typeof type === 'object') {
        const keys = Object.keys(type);
        if (keys.length > 0) return keys[0].toLowerCase();
    }
    return 'unknown';
};

// Get display text for item type
const getTypeDisplayText = (type) => {
    if (type && type.auction !== undefined) return 'Auction';
    const typeStr = extractVariant(type);
    switch (typeStr) {
        case 'forum': return 'Forum';
        case 'topic': return 'Topic';
        case 'thread': return 'Thread';
        case 'post': return 'Post';
        default: return typeStr.charAt(0).toUpperCase() + typeStr.slice(1);
    }
};

// Get type style (color and icon)
const getTypeStyle = (type) => {
    switch (type) {
        case 'Forum': return { bg: feedBlue, icon: <FaComments size={10} /> };
        case 'Topic': return { bg: feedGreen, icon: <FaLayerGroup size={10} /> };
        case 'Thread': return { bg: feedPurple, icon: <FaStream size={10} /> };
        case 'Post': return { bg: feedPrimary, icon: <FaReply size={10} /> };
        case 'Auction': return { bg: feedAuction, icon: <FaGavel size={10} /> };
        default: return { bg: feedPrimary, icon: null };
    }
};

// Get feed type color (for Hub compact mode)
const getFeedTypeColor = (itemType) => {
    switch (itemType) {
        case 'forum': return feedBlue;
        case 'topic': return feedGreen;
        case 'thread': return feedPurple;
        case 'post': return feedPrimary;
        case 'auction': return feedAuction;
        default: return feedPrimary;
    }
};

// Get feed type icon (for Hub compact mode)
const getFeedTypeIcon = (itemType) => {
    switch (itemType) {
        case 'forum': return <FaComments size={16} />;
        case 'topic': return <FaLayerGroup size={16} />;
        case 'thread': return <FaStream size={16} />;
        case 'post': return <FaReply size={16} />;
        case 'auction': return <FaGavel size={16} />;
        default: return <FaComments size={16} />;
    }
};

/**
 * Reusable Feed Item Card component
 * 
 * @param {Object} props
 * @param {Object} props.item - The feed item data
 * @param {number} props.index - Item index for animation delay
 * @param {boolean} props.compact - Use compact display mode (for Hub)
 * @param {Function} props.getSnsInfo - Function to get SNS info by root ID
 * @param {Object} props.snsLogos - Map of SNS logos by governance ID or root ID
 * @param {Set} props.loadingLogos - Set of governance IDs currently loading logos
 * @param {Function} props.getPrincipalDisplayName - Function to get principal display name
 * @param {Function} props.principalToText - Function to convert principal to text
 * @param {Object} props.Principal - Principal class for creating principal objects
 * @param {boolean} props.isAuthenticated - Whether user is authenticated
 * @param {Map} props.auctionTokenMetadata - Map of token metadata by ledger ID (for auctions)
 * @param {Set} props.loadingAuctionTokens - Set of ledger IDs currently loading metadata
 * @param {Array} props.allSnses - All SNS instances for looking up neuron info
 * @param {Map} props.pollsData - Map of poll data by poll ID
 */
function FeedItemCard({
    item,
    index = 0,
    compact = false,
    getSnsInfo,
    snsLogos = {},
    loadingLogos = new Set(),
    getPrincipalDisplayName,
    principalToText,
    Principal,
    isAuthenticated = false,
    auctionTokenMetadata = new Map(),
    loadingAuctionTokens = new Set(),
    allSnses = [],
    pollsData = new Map(),
}) {
    const { theme } = useTheme();
    const navigate = useNavigate();

    const typeDisplayText = getTypeDisplayText(item.item_type);
    const typeStyle = getTypeStyle(typeDisplayText);
    const itemType = extractVariant(item.item_type);
    const typeColor = getFeedTypeColor(itemType);

    // Helper to convert principal to text
    const convertPrincipalToText = (principal) => {
        if (!principal) return null;
        if (principalToText) return principalToText(principal);
        // Default implementation
        if (typeof principal === 'string') return principal;
        if (principal.toText) return principal.toText();
        if (principal.toString) {
            const str = principal.toString();
            if (!str.includes('[object')) return str;
        }
        return null;
    };

    // Get SNS info
    const snsRootId = Array.isArray(item.sns_root_canister_id) 
        ? item.sns_root_canister_id[0] 
        : item.sns_root_canister_id;
    const snsRootStr = convertPrincipalToText(snsRootId);
    const snsInfo = getSnsInfo ? getSnsInfo(snsRootStr) : null;
    
    // Get SNS logo - check both Map and object formats
    const snsLogo = (() => {
        if (!snsInfo) return null;
        if (snsLogos instanceof Map) {
            return snsLogos.get(snsInfo.canisters?.governance) || null;
        }
        return snsLogos[snsRootStr] || null;
    })();
    const isLoadingLogo = snsInfo && loadingLogos instanceof Set 
        ? loadingLogos.has(snsInfo.canisters?.governance) 
        : false;

    // Get creator info
    const creatorPrincipal = (() => {
        if (!item.created_by || !principalToText || !Principal) return null;
        try {
            const principalStr = principalToText(item.created_by);
            return Principal.fromText(principalStr);
        } catch (e) {
            return null;
        }
    })();
    const creatorDisplayInfo = creatorPrincipal && getPrincipalDisplayName 
        ? getPrincipalDisplayName(creatorPrincipal) 
        : null;

    // Navigation URL
    const navigationUrl = (() => {
        if (item._isAuction) return `/sneedex_offer/${item._offerId}`;
        
        const typeStr = extractVariant(item.item_type);
        
        switch (typeStr) {
            case 'topic':
                return `/topic/${Array.isArray(item.topic_id) ? item.topic_id[0] : item.topic_id || item.id}`;
            case 'thread':
                return `/thread?threadid=${Array.isArray(item.thread_id) ? item.thread_id[0] : item.thread_id || item.id}`;
            case 'post':
                return `/post?postid=${item.id}`;
            default:
                return '/feed';
        }
    })();

    // Display title
    const displayTitle = (() => {
        const actualTitle = Array.isArray(item.title) ? item.title[0] : item.title;
        if (actualTitle && actualTitle.trim().length > 0) return actualTitle;
        
        // Fallback - but posts without titles should have no title
        const typeStr = extractVariant(item.item_type);
        if (item._isAuction) return `Auction #${item._offerId}`;
        if (typeStr === 'post') return null; // Posts without titles don't need a fallback
        return `New ${typeStr}`;
    })();

    const handleItemClick = (e) => {
        if (e) e.stopPropagation();
        navigate(navigationUrl);
    };
    
    const handleSnsLogoClick = (e) => {
        if (e) e.stopPropagation();
        if (snsRootStr) navigate(`/forum?sns=${snsRootStr}`);
    };

    // Styles
    const styles = {
        card: {
            backgroundColor: theme.colors.secondaryBg,
            borderRadius: '16px',
            border: `1px solid ${theme.colors.border}`,
            overflow: 'hidden',
            position: 'relative',
            transition: 'transform 0.2s ease, box-shadow 0.2s ease, border-color 0.2s ease',
            display: 'flex',
            gap: compact ? '12px' : '16px',
            padding: compact ? '14px 16px' : '1rem',
            cursor: 'pointer',
        },
        logoPlaceholder: {
            width: compact ? '44px' : '48px',
            height: compact ? '44px' : '48px',
            borderRadius: compact ? '12px' : '10px',
            background: `linear-gradient(135deg, ${typeColor}30, ${typeColor}15)`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
            overflow: 'hidden',
            border: `1px solid ${typeColor}30`,
            cursor: 'pointer',
            color: typeColor,
            fontWeight: 600,
            fontSize: '14px',
        },
        content: {
            flex: 1,
            minWidth: 0,
            display: 'flex',
            flexDirection: 'column',
            gap: compact ? '6px' : '8px',
        },
        header: {
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            flexWrap: 'wrap',
        },
        typeBadge: {
            display: 'inline-flex',
            alignItems: 'center',
            gap: '4px',
            padding: '4px 10px',
            borderRadius: '8px',
            background: typeStyle.bg,
            color: 'white',
            fontSize: '0.7rem',
            fontWeight: '700',
            textTransform: 'uppercase',
            letterSpacing: '0.3px',
            cursor: 'pointer',
        },
        snsBadge: {
            fontSize: '0.75rem',
            color: theme.colors.secondaryText,
            background: theme.colors.tertiaryBg,
            padding: compact ? '4px 10px' : '3px 8px',
            borderRadius: compact ? '8px' : '6px',
            fontWeight: '500',
        },
        time: {
            fontSize: '0.75rem',
            color: theme.colors.mutedText,
            marginLeft: 'auto',
            fontWeight: '500',
            cursor: 'help',
        },
        title: {
            color: theme.colors.primaryText,
            fontSize: compact ? '0.95rem' : '1rem',
            fontWeight: '600',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: compact ? 'nowrap' : 'normal',
            cursor: 'pointer',
            margin: 0,
        },
        body: {
            color: theme.colors.secondaryText,
            fontSize: compact ? '0.8rem' : '0.85rem',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: compact ? 'nowrap' : 'normal',
            position: compact ? 'static' : 'relative',
            maxHeight: compact ? 'none' : '60px',
            lineHeight: '1.5',
        },
    };

    // Compact mode for Hub
    if (compact) {
        // Safety check for required data
        if (!item) {
            console.warn('FeedItemCard: No item provided');
            return null;
        }
        
        const bodyText = item.body ? (Array.isArray(item.body) ? item.body[0] : item.body) : '';
        
        return (
            <Link
                to={navigationUrl}
                style={{
                    ...styles.card,
                    textDecoration: 'none',
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
                <div style={styles.logoPlaceholder}>
                    {snsLogo ? (
                        <img src={snsLogo} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    ) : (
                        <span style={{ color: typeColor }}>{getFeedTypeIcon(itemType)}</span>
                    )}
                </div>
                
                <div style={styles.content}>
                    {/* Header row */}
                    <div style={styles.header}>
                        <span style={styles.typeBadge}>
                            {typeStyle.icon}
                            {typeDisplayText}
                        </span>
                        {snsInfo && (
                            <span style={styles.snsBadge}>
                                {snsInfo.name}
                            </span>
                        )}
                        <span style={styles.time} title={item.created_at ? getFullDate(item.created_at) : ''}>
                            {item.created_at ? formatRelativeTime(item.created_at) : ''}
                        </span>
                    </div>
                    
                    {/* Title */}
                    {displayTitle && (
                        <div style={styles.title}>
                            {displayTitle}
                        </div>
                    )}
                    
                    {/* Body preview */}
                    {bodyText && (
                        <div style={styles.body}>
                            {bodyText.slice(0, 80)}
                            {bodyText.length > 80 ? '...' : ''}
                        </div>
                    )}
                </div>
            </Link>
        );
    }

    // Full mode for Feed page
    return (
        <div 
            className="feed-card feed-item-animate" 
            style={{
                ...styles.card,
                animationDelay: `${Math.min(index * 0.05, 0.5)}s`,
                cursor: 'pointer',
            }} 
            data-feed-item-id={item.id?.toString()}
            onClick={handleItemClick}
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
                        ...styles.logoPlaceholder,
                        background: (() => {
                            const state = item._offerState;
                            if (state === 'Completed' || state === 'Claimed') {
                                return 'linear-gradient(135deg, #6b7280, #4b5563)';
                            } else if (state === 'Expired' || state === 'Cancelled' || state === 'Reclaimed') {
                                return 'linear-gradient(135deg, #9ca3af, #6b7280)';
                            }
                            return `linear-gradient(135deg, ${feedAuction}, #7c3aed)`;
                        })(),
                    }}
                    onClick={handleItemClick}
                    title="View Auction on Sneedex"
                >
                    <FaGavel size={20} style={{ color: 'white' }} />
                </div>
            ) : snsInfo && (
                <div 
                    style={styles.logoPlaceholder}
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
                        <span>{snsInfo.name?.substring(0, 2).toUpperCase()}</span>
                    )}
                </div>
            )}
            
            {/* Content */}
            <div style={styles.content}>
                <div style={styles.header}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', flex: 1 }}>
                        <span 
                            className="feed-type-badge"
                            style={styles.typeBadge}
                            onClick={handleItemClick}
                            title={`Go to ${typeDisplayText.toLowerCase()}`}
                        >
                            {typeStyle.icon}
                            {typeDisplayText}
                        </span>
                        {creatorPrincipal && (
                            <span onClick={(e) => e.stopPropagation()}>
                                <PrincipalDisplay
                                    principal={creatorPrincipal}
                                    displayInfo={creatorDisplayInfo}
                                    short={true}
                                    style={{ fontSize: '0.8rem' }}
                                    isAuthenticated={isAuthenticated}
                                />
                            </span>
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
                            <span style={styles.snsBadge}>
                                {snsInfo.name}
                            </span>
                        )}
                    </div>
                    <span 
                        style={styles.time}
                        title={getFullDate(item.created_at)}
                    >
                        {formatRelativeTime(item.created_at)}
                    </span>
                </div>
                
                {/* Title */}
                {displayTitle && (
                    <h3 
                        className="feed-title-link"
                        style={styles.title}
                        onClick={handleItemClick}
                        title={`Go to ${typeDisplayText.toLowerCase()}`}
                    >
                        {displayTitle}
                    </h3>
                )}
                
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
                                        const assetTokenMeta = asset.ledger_id ? auctionTokenMetadata.get(asset.ledger_id) : null;
                                        const isLoadingAssetToken = asset.ledger_id ? loadingAuctionTokens.has(asset.ledger_id) : false;
                                        
                                        const snsNeuronInfo = asset.type === 'SNSNeuron' && asset.governance_id 
                                            ? allSnses.find(s => s.canisters?.governance === asset.governance_id)
                                            : null;
                                        const snsNeuronLogo = snsNeuronInfo && snsLogos instanceof Map
                                            ? snsLogos.get(snsNeuronInfo.canisters?.governance) 
                                            : null;
                                        const snsTokenMeta = snsNeuronInfo?.canisters?.ledger 
                                            ? auctionTokenMetadata.get(snsNeuronInfo.canisters.ledger) 
                                            : null;
                                        
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
                                                                        : asset.title || 'ICP Neuron Manager'
                                                                    }
                                                                </span>
                                                            </>
                                                        ) : (
                                                            <>
                                                                <FaCube style={{ color: feedBlue, fontSize: '14px' }} />
                                                                <span style={{ color: theme.colors.primaryText }}>
                                                                    {asset.title || 'Canister'}
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
                                            
                                            if (isInactive) return null;
                                            
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
                {item.body && item.body.length > 0 && !item._isAuction && (() => {
                    const bodyText = Array.isArray(item.body) ? item.body[0] : item.body;
                    const isLongText = bodyText.length > 120; // Only fade if text is long enough to likely overflow
                    return (
                        <div style={{
                            ...styles.body,
                            position: 'relative',
                            maxHeight: '60px',
                        }}>
                            <MarkdownBody 
                                text={bodyText.length > 250 ? `${bodyText.substring(0, 250)}...` : bodyText}
                            />
                            {isLongText && (
                                <div style={{
                                    position: 'absolute',
                                    bottom: 0,
                                    left: 0,
                                    right: 0,
                                    height: '40px',
                                    background: `linear-gradient(transparent, ${theme.colors.secondaryBg})`,
                                    pointerEvents: 'none'
                                }} />
                            )}
                        </div>
                    );
                })()}
                
                {/* Auction public note */}
                {item._isAuction && item.body && item.body.length > 0 && (
                    <div style={{
                        fontSize: '0.85rem',
                        color: theme.colors.secondaryText,
                        lineHeight: '1.5',
                        marginBottom: '8px',
                        maxHeight: '60px',
                        overflow: 'hidden',
                        position: 'relative',
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
                            lineHeight: '1.4',
                            maxHeight: '48px',
                            overflow: 'hidden',
                            position: 'relative',
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
                                const actualPoll = Array.isArray(poll) ? poll[0] : poll;
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
                    <div style={{
                        display: 'flex',
                        flexWrap: 'wrap',
                        gap: '8px',
                        marginTop: '8px'
                    }}>
                        {item.topic_title && (Array.isArray(item.topic_title) ? item.topic_title.length > 0 : true) && (
                            <Link 
                                to={`/topic/${Array.isArray(item.topic_id) ? item.topic_id[0] : item.topic_id}`} 
                                className="feed-context-tag"
                                onClick={(e) => e.stopPropagation()}
                                style={{
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: '6px',
                                    padding: '6px 12px',
                                    backgroundColor: theme.colors.tertiaryBg,
                                    borderRadius: '8px',
                                    fontSize: '0.75rem',
                                    color: theme.colors.secondaryText,
                                    textDecoration: 'none',
                                    border: `1px solid ${theme.colors.border}`,
                                    transition: 'all 0.2s ease'
                                }}
                            >
                                <FaLayerGroup size={10} />
                                {Array.isArray(item.topic_title) ? item.topic_title[0] : item.topic_title}
                            </Link>
                        )}
                        
                        {item.thread_title && (Array.isArray(item.thread_title) ? item.thread_title.length > 0 : true) && (
                            <Link 
                                to={`/thread?threadid=${Array.isArray(item.thread_id) ? item.thread_id[0] : item.thread_id}`} 
                                className="feed-context-tag"
                                onClick={(e) => e.stopPropagation()}
                                style={{
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: '6px',
                                    padding: '6px 12px',
                                    backgroundColor: theme.colors.tertiaryBg,
                                    borderRadius: '8px',
                                    fontSize: '0.75rem',
                                    color: theme.colors.secondaryText,
                                    textDecoration: 'none',
                                    border: `1px solid ${theme.colors.border}`,
                                    transition: 'all 0.2s ease'
                                }}
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
}

export default FeedItemCard;
