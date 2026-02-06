import React from 'react';
import { Link } from 'react-router-dom';
import { useTheme } from '../contexts/ThemeContext';
import { FaClock, FaGavel, FaRobot, FaCubes, FaBrain, FaCoins, FaLock } from 'react-icons/fa';
import { 
    formatAmount, 
    formatTimeRemaining,
    isOfferPastExpiration,
    getOfferStateString,
    getAssetDetails,
    CANISTER_KIND_ICP_NEURON_MANAGER,
    formatUsd,
    calculateUsdValue
} from '../utils/SneedexUtils';
import { PrincipalDisplay } from '../utils/PrincipalUtils';

// Accent colors
const sneedexPrimary = '#8b5cf6';
const sneedexSecondary = '#a78bfa';

/**
 * Reusable Offer Card component for displaying Sneedex offers
 * 
 * @param {Object} props
 * @param {Object} props.offer - The offer data
 * @param {Object} props.bidInfo - Bid information for this offer (optional)
 * @param {Function} props.getTokenInfo - Function to get token metadata by ledger ID
 * @param {Function} props.getSnsInfo - Function to get SNS info by governance ID (optional)
 * @param {Function} props.getSnsLogo - Function to get SNS logo by governance ID (optional)
 * @param {Object} props.neuronInfo - Map of neuron info by key (optional)
 * @param {Object} props.neuronManagerInfo - Map of neuron manager info by canister ID (optional)
 * @param {Object} props.tokenPrices - Map of token prices by ledger ID (optional)
 * @param {number} props.icpPrice - ICP price in USD (optional)
 * @param {Function} props.getOfferEstimatedValue - Function to calculate estimated value (optional)
 * @param {boolean} props.isAuthenticated - Whether user is authenticated (optional)
 * @param {boolean} props.compact - Use compact display mode (optional)
 * @param {string} props.variant - Card variant: 'default' | 'hub' (optional)
 */
function OfferCard({
    offer,
    bidInfo = {},
    getTokenInfo,
    getSnsInfo,
    getSnsLogo,
    neuronInfo = {},
    neuronManagerInfo = {},
    tokenPrices = {},
    icpPrice = 0,
    getOfferEstimatedValue,
    isAuthenticated = false,
    compact = false,
    variant = 'default',
}) {
    const { theme } = useTheme();
    
    // Get token info for the payment token
    const tokenInfo = getTokenInfo ? getTokenInfo(offer.price_token_ledger?.toString()) : { symbol: 'TOKEN', decimals: 8, fee: null };
    const paymentTokenPrice = tokenPrices[offer.price_token_ledger?.toString()];
    
    // Calculate minimum next bid (what a bidder actually needs to pay)
    const getMinimumNextBid = () => {
        if (bidInfo.highest_bid) {
            // Calculate minimum increment
            let minIncrement = BigInt(1); // Default: 1 smallest unit
            if (offer.min_bid_increment_fee_multiple?.[0] && tokenInfo.fee) {
                minIncrement = BigInt(offer.min_bid_increment_fee_multiple[0]) * BigInt(tokenInfo.fee);
            }
            const nextBid = BigInt(bidInfo.highest_bid.amount) + minIncrement;
            // Cap at buyout if set
            if (offer.buyout_price?.[0] && nextBid > BigInt(offer.buyout_price[0])) {
                return BigInt(offer.buyout_price[0]);
            }
            return nextBid;
        }
        // No bids yet - use min_bid_price or fallback to buyout
        if (offer.min_bid_price?.[0]) {
            return BigInt(offer.min_bid_price[0]);
        }
        if (offer.buyout_price?.[0]) {
            return BigInt(offer.buyout_price[0]);
        }
        return BigInt(0);
    };
    
    const minimumNextBid = getMinimumNextBid();
    
    // Check if this is effectively a buyout-only situation
    // True if: no min_bid_price, OR min next bid >= buyout price
    const isBuyoutOnly = (() => {
        // If there's no buyout price, can't be buyout-only
        if (!offer.buyout_price?.[0]) return false;
        // If there's no min_bid_price, it's buyout-only
        if (!offer.min_bid_price?.[0]) return true;
        // If min next bid >= buyout, it's effectively buyout-only
        return minimumNextBid >= BigInt(offer.buyout_price[0]);
    })();
    
    // Calculate prices in USD
    const minBidUsd = minimumNextBid > 0n && paymentTokenPrice
        ? calculateUsdValue(minimumNextBid, tokenInfo.decimals, paymentTokenPrice)
        : null;
    const buyoutUsd = offer.buyout_price?.[0] && paymentTokenPrice
        ? calculateUsdValue(offer.buyout_price[0], tokenInfo.decimals, paymentTokenPrice)
        : null;
    const highestBidUsd = bidInfo.highest_bid?.amount && paymentTokenPrice
        ? calculateUsdValue(bidInfo.highest_bid.amount, tokenInfo.decimals, paymentTokenPrice)
        : null;
    
    // Calculate estimated value
    const estimatedValue = getOfferEstimatedValue ? getOfferEstimatedValue(offer) : 0;
    
    // Determine if this is a "good deal"
    const currentEffectivePrice = highestBidUsd || minBidUsd;
    const isGoodDeal = estimatedValue > 0 && currentEffectivePrice && estimatedValue > currentEffectivePrice;
    
    // Check if there's exactly one canister asset with a title
    const canisterAssets = offer.assets?.filter(a => a.asset && a.asset.Canister) || [];
    const singleCanisterTitle = canisterAssets.length === 1 && 
        canisterAssets[0].asset.Canister.title && 
        canisterAssets[0].asset.Canister.title[0]
            ? canisterAssets[0].asset.Canister.title[0]
            : null;
    
    // Check offer state
    const isActive = 'Active' in (offer.state || {});
    const isCompleted = 'Completed' in (offer.state || {}) || 'Claimed' in (offer.state || {});
    const isExpired = 'Expired' in (offer.state || {});
    const isCancelled = 'Cancelled' in (offer.state || {});
    const isReclaimed = 'Reclaimed' in (offer.state || {});
    const isInactive = isCompleted || isExpired || isCancelled || isReclaimed;
    
    // Get status banner info
    const getStatusBanner = () => {
        if (isCompleted) return { text: 'SOLD', color: 'linear-gradient(135deg, #22c55e, #16a34a)' };
        if (isExpired || isReclaimed) return { text: 'EXPIRED', color: 'linear-gradient(135deg, #6b7280, #4b5563)' };
        if (isCancelled) return { text: 'CANCELLED', color: 'linear-gradient(135deg, #f59e0b, #d97706)' };
        return null;
    };
    const statusBanner = getStatusBanner();
    
    // Styles
    const styles = {
        card: {
            background: `linear-gradient(145deg, ${theme.colors.secondaryBg} 0%, ${theme.colors.primaryBg} 100%)`,
            border: `1px solid ${theme.colors.border}`,
            borderRadius: '20px',
            overflow: 'hidden',
            transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
            cursor: 'pointer',
            width: '100%',
            maxWidth: compact ? '100%' : '450px',
            boxSizing: 'border-box',
            boxShadow: '0 4px 20px rgba(0,0,0,0.15)',
            position: 'relative',
            textDecoration: 'none',
            display: 'block',
        },
        cardHeaderSection: {
            background: `linear-gradient(135deg, ${sneedexPrimary}15, ${sneedexSecondary}08)`,
            padding: compact ? '0.875rem 1rem' : '1rem 1.25rem',
            borderBottom: `1px solid ${theme.colors.border}`,
        },
        cardHeader: {
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: '0.75rem',
        },
        offerIdContainer: {
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem',
            flex: 1,
            minWidth: 0,
        },
        offerId: {
            fontSize: compact ? '0.9rem' : '0.95rem',
            fontWeight: '700',
            color: sneedexPrimary,
            fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
        },
        offerTitle: {
            fontSize: '0.85rem',
            fontWeight: '600',
            color: theme.colors.primaryText,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            opacity: 0.9,
        },
        cardBadge: {
            background: isActive
                ? `linear-gradient(135deg, ${theme.colors.success}, ${theme.colors.success}dd)`
                : isCompleted
                    ? `linear-gradient(135deg, ${sneedexPrimary}, ${sneedexSecondary})`
                    : `linear-gradient(135deg, ${theme.colors.mutedText}, ${theme.colors.mutedText}dd)`,
            color: '#fff',
            padding: '5px 12px',
            borderRadius: '20px',
            fontSize: '0.7rem',
            fontWeight: '700',
            textTransform: 'uppercase',
            letterSpacing: '0.5px',
            boxShadow: isActive 
                ? `0 2px 8px ${theme.colors.success}40`
                : isCompleted
                    ? `0 2px 8px ${sneedexPrimary}40`
                    : 'none',
            flexShrink: 0,
        },
        cardBody: {
            padding: compact ? '1rem' : '1.25rem',
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
            background: `linear-gradient(135deg, ${theme.colors.tertiaryBg}, ${theme.colors.secondaryBg})`,
            border: `1px solid ${theme.colors.border}`,
            padding: '8px 12px',
            borderRadius: '10px',
            fontSize: '0.85rem',
            fontWeight: '500',
            color: theme.colors.primaryText,
            transition: 'all 0.2s ease',
        },
        priceSection: {
            display: 'grid',
            gridTemplateColumns: 'repeat(2, 1fr)',
            gap: '0.75rem',
            marginBottom: '1rem',
        },
        priceItem: {
            background: theme.colors.primaryBg,
            border: `1px solid ${theme.colors.border}`,
            borderRadius: '12px',
            padding: '0.875rem',
            textAlign: 'center',
            transition: 'all 0.2s ease',
        },
        priceLabel: {
            fontSize: '0.7rem',
            color: theme.colors.mutedText,
            textTransform: 'uppercase',
            letterSpacing: '0.8px',
            fontWeight: '600',
            marginBottom: '6px',
        },
        priceValue: {
            fontSize: compact ? '1rem' : '1.15rem',
            fontWeight: '700',
            color: theme.colors.primaryText,
            lineHeight: 1.2,
        },
        priceToken: {
            fontSize: '0.8rem',
            color: theme.colors.mutedText,
            fontWeight: '500',
            marginTop: '2px',
        },
        cardFooter: {
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-start',
            paddingTop: '1rem',
            borderTop: `1px solid ${theme.colors.border}`,
            gap: '1rem',
        },
        timeInfo: {
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            fontSize: '0.85rem',
            color: theme.colors.mutedText,
            fontWeight: '500',
        },
        bidInfo: {
            textAlign: 'right',
            flex: 1,
        },
        bidCount: {
            fontSize: '0.8rem',
            color: theme.colors.mutedText,
            fontWeight: '500',
        },
        highestBid: {
            fontSize: '1.05rem',
            fontWeight: '700',
            color: theme.colors.success,
            marginTop: '2px',
        },
    };
    
    // Render asset badges
    const renderAssetBadges = () => {
        return (offer.assets || []).map((assetEntry, idx) => {
            const details = getAssetDetails(assetEntry);
            
            // Get token info for ICRC1Token assets
            const assetTokenInfo = details.type === 'ICRC1Token' && getTokenInfo
                ? getTokenInfo(details.ledger_id)
                : null;
            
            // Get SNS info for SNSNeuron assets
            const snsInfo = details.type === 'SNSNeuron' && getSnsInfo
                ? getSnsInfo(details.governance_id)
                : null;
            const snsLogo = details.type === 'SNSNeuron' && getSnsLogo
                ? getSnsLogo(details.governance_id)
                : null;
            const neuronInfoKey = details.type === 'SNSNeuron' && details.neuron_id
                ? `${details.governance_id}_${details.neuron_id}`
                : null;
            const nInfo = neuronInfoKey ? neuronInfo[neuronInfoKey] : null;
            
            // Generate tooltip text
            const getTooltip = () => {
                if (details.type === 'Canister' && details.canister_kind === CANISTER_KIND_ICP_NEURON_MANAGER) {
                    const titleLine = details.title ? `${details.title}\n` : '';
                    if (details.cached_total_stake_e8s !== null) {
                        return `${titleLine}ICP Staking Bot\nApp canister id: ${details.canister_id}\nStaked: ${(details.cached_total_stake_e8s / 1e8).toFixed(4)} ICP`;
                    }
                    const mInfo = neuronManagerInfo[details.canister_id];
                    if (mInfo) {
                        return `${titleLine}ICP Staking Bot\nApp canister id: ${details.canister_id}\n\nStake: ${mInfo.totalStake.toFixed(4)} ICP\nMaturity: ${mInfo.totalMaturity.toFixed(4)} ICP\nStaked Maturity: ${mInfo.totalStakedMaturity.toFixed(4)} ICP\nTotal: ${mInfo.totalIcp.toFixed(4)} ICP\n\nNeurons: ${mInfo.neuronCount}`;
                    }
                    return `${titleLine}ICP Staking Bot\nApp canister id: ${details.canister_id}`;
                }
                if (details.type === 'Canister') {
                    const titleLine = details.title ? `${details.title}\n` : '';
                    return `${titleLine}App canister id: ${details.canister_id}`;
                }
                if (details.type === 'SNSNeuron') {
                    const stakeValue = details.cached_stake_e8s !== null 
                        ? (details.cached_stake_e8s / 1e8)
                        : nInfo?.stake;
                    const stakeText = stakeValue !== undefined ? `\nStake: ${stakeValue.toFixed(4)} ${snsInfo?.symbol || 'tokens'}` : '';
                    return `${snsInfo?.name || 'SNS'} Neuron\nGovernance: ${details.governance_id}\nNeuron ID: ${details.neuron_id?.slice(0, 16)}...${stakeText}`;
                }
                if (details.type === 'ICRC1Token') {
                    return `${assetTokenInfo?.name || assetTokenInfo?.symbol || 'Token'}\nLedger: ${details.ledger_id}\nAmount: ${formatAmount(details.amount, assetTokenInfo?.decimals || 8)} ${assetTokenInfo?.symbol || 'tokens'}`;
                }
                return '';
            };
            
            return (
                <span key={idx} style={styles.assetBadge} title={getTooltip()}>
                    {details.type === 'Canister' && details.canister_kind === CANISTER_KIND_ICP_NEURON_MANAGER && (
                        <>
                            <span style={{ position: 'relative', display: 'inline-flex', marginRight: '2px' }}>
                                <FaRobot style={{ color: theme.colors.accent, fontSize: '16px' }} />
                                <img 
                                    src="/icp_symbol.svg" 
                                    alt="ICP" 
                                    style={{ 
                                        width: 12, 
                                        height: 12, 
                                        borderRadius: '50%',
                                        position: 'absolute',
                                        bottom: -2,
                                        right: -4,
                                        border: `1px solid ${theme.colors.tertiaryBg}`,
                                        background: theme.colors.tertiaryBg,
                                    }}
                                />
                            </span>
                            {details.cached_total_stake_e8s !== null
                                ? `${(details.cached_total_stake_e8s / 1e8).toFixed(2)} ICP`
                                : neuronManagerInfo[details.canister_id] 
                                    ? `${neuronManagerInfo[details.canister_id].totalIcp.toFixed(2)} ICP`
                                    : details.escrowed 
                                        ? 'Loading...'
                                        : 'Staking Bot'
                            }
                        </>
                    )}
                    {details.type === 'Canister' && details.canister_kind !== CANISTER_KIND_ICP_NEURON_MANAGER && (
                        <>
                            <FaCubes style={{ color: theme.colors.accent }} />
                            {details.title 
                                ? (details.title.length > 12 
                                    ? details.title.slice(0, 12) + '…' 
                                    : details.title)
                                : 'Canister'
                            }
                        </>
                    )}
                    {details.type === 'SNSNeuron' && (
                        <>
                            <span style={{ position: 'relative', display: 'inline-flex', marginRight: '2px' }}>
                                <FaBrain style={{ color: theme.colors.success, fontSize: '16px' }} />
                                {snsLogo && (
                                    <img 
                                        src={snsLogo} 
                                        alt={snsInfo?.name || 'SNS'} 
                                        style={{ 
                                            width: 12, 
                                            height: 12, 
                                            borderRadius: '50%',
                                            position: 'absolute',
                                            bottom: -2,
                                            right: -4,
                                            border: `1px solid ${theme.colors.tertiaryBg}`,
                                        }}
                                    />
                                )}
                            </span>
                            {details.cached_stake_e8s !== null
                                ? `${(details.cached_stake_e8s / 1e8).toFixed(2)} ${snsInfo?.symbol || 'Neuron'}`
                                : nInfo 
                                    ? `${nInfo.stake.toFixed(2)} ${snsInfo?.symbol || 'Neuron'}` 
                                    : snsInfo?.symbol || 'Neuron'
                            }
                        </>
                    )}
                    {details.type === 'ICRC1Token' && (
                        <>
                            {assetTokenInfo?.logo ? (
                                <img 
                                    src={assetTokenInfo.logo} 
                                    alt={assetTokenInfo?.symbol || 'Token'} 
                                    style={{ width: 18, height: 18, borderRadius: '50%' }}
                                    onError={(e) => { e.target.style.display = 'none'; }}
                                />
                            ) : (
                                <FaCoins style={{ color: theme.colors.warning }} />
                            )}
                            {formatAmount(details.amount, assetTokenInfo?.decimals || 8)} {assetTokenInfo?.symbol || 'TOKEN'}
                        </>
                    )}
                </span>
            );
        });
    };
    
    // Check if past expiration
    const isPastExpiration = offer.expiration?.[0] && isOfferPastExpiration(offer.expiration[0]);

    return (
        <Link
            to={`/sneedex_offer/${offer.id}`}
            style={styles.card}
            onMouseEnter={(e) => {
                e.currentTarget.style.transform = 'translateY(-6px)';
                e.currentTarget.style.borderColor = sneedexPrimary;
                e.currentTarget.style.boxShadow = `0 20px 50px rgba(0,0,0,0.25), 0 0 0 1px ${sneedexPrimary}30`;
            }}
            onMouseLeave={(e) => {
                e.currentTarget.style.transform = 'translateY(0)';
                e.currentTarget.style.borderColor = theme.colors.border;
                e.currentTarget.style.boxShadow = '0 4px 20px rgba(0,0,0,0.15)';
            }}
        >
            {/* Status Banner for inactive offers */}
            {statusBanner && (
                <div style={{
                    position: 'absolute',
                    top: '18px',
                    right: '-30px',
                    background: statusBanner.color,
                    color: '#fff',
                    padding: '5px 45px',
                    fontWeight: '700',
                    fontSize: '0.6rem',
                    transform: 'rotate(45deg)',
                    boxShadow: '0 2px 10px rgba(0,0,0,0.4)',
                    zIndex: 10,
                    letterSpacing: '0.8px',
                    textTransform: 'uppercase',
                }}>
                    {statusBanner.text}
                </div>
            )}
            
            {/* Card Header Section */}
            <div style={styles.cardHeaderSection}>
                <div style={styles.cardHeader}>
                    <div style={styles.offerIdContainer}>
                        <span style={styles.offerId}>#{Number(offer.id)}</span>
                        {singleCanisterTitle && (
                            <span style={styles.offerTitle}>
                                {singleCanisterTitle}
                            </span>
                        )}
                        {offer.approved_bidders && offer.approved_bidders[0] && offer.approved_bidders[0].length > 0 && (
                            <span style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '3px',
                                background: `linear-gradient(135deg, ${theme.colors.warning}25, ${theme.colors.warning}15)`,
                                color: theme.colors.warning,
                                padding: '3px 8px',
                                borderRadius: '6px',
                                fontSize: '0.7rem',
                                fontWeight: '600',
                                border: `1px solid ${theme.colors.warning}30`,
                            }}>
                                <FaLock size={8} />
                                {offer.approved_bidders[0].length}
                            </span>
                        )}
                    </div>
                    <span style={styles.cardBadge}>
                        {getOfferStateString(offer.state)}
                    </span>
                </div>
            </div>
            
            {/* Card Body */}
            <div style={styles.cardBody}>
                {/* Asset Badges */}
                <div style={styles.assetsRow}>
                    {renderAssetBadges()}
                </div>
                
                {/* Price Section */}
                <div style={styles.priceSection}>
                    {/* Show min bid only if not buyout-only */}
                    {!isBuyoutOnly && (
                        <div style={{
                            ...styles.priceItem,
                            background: `linear-gradient(135deg, ${theme.colors.primaryBg}, ${sneedexPrimary}05)`,
                        }}>
                            <div style={{
                                ...styles.priceLabel,
                                color: sneedexPrimary,
                            }}>{bidInfo.highest_bid ? 'Min Next Bid' : 'Min Bid'}</div>
                            <div style={styles.priceValue}>
                                {minimumNextBid > 0n ? formatAmount(minimumNextBid, tokenInfo.decimals) : '—'}
                            </div>
                            <div style={styles.priceToken}>{tokenInfo.symbol}</div>
                            {minBidUsd > 0 && (
                                <div style={{ 
                                    fontSize: '0.75rem', 
                                    color: theme.colors.mutedText, 
                                    marginTop: '4px',
                                    fontWeight: '500',
                                }}>
                                    {formatUsd(minBidUsd)}
                                </div>
                            )}
                        </div>
                    )}
                    {/* Show buyout - full width if buyout-only */}
                    <div style={{
                        ...styles.priceItem,
                        background: `linear-gradient(135deg, ${theme.colors.primaryBg}, ${theme.colors.success}08)`,
                        ...(isBuyoutOnly ? { gridColumn: '1 / -1' } : {}),
                    }}>
                        <div style={{
                            ...styles.priceLabel,
                            color: theme.colors.success,
                        }}>{isBuyoutOnly ? 'Buyout Only' : 'Buyout'}</div>
                        <div style={{
                            ...styles.priceValue,
                            color: offer.buyout_price?.[0] ? theme.colors.success : theme.colors.mutedText,
                        }}>
                            {offer.buyout_price?.[0] ? formatAmount(offer.buyout_price[0], tokenInfo.decimals) : '—'}
                        </div>
                        <div style={styles.priceToken}>{tokenInfo.symbol}</div>
                        {buyoutUsd > 0 && (
                            <div style={{ 
                                fontSize: '0.75rem', 
                                color: theme.colors.mutedText, 
                                marginTop: '4px',
                                fontWeight: '500',
                            }}>
                                {formatUsd(buyoutUsd)}
                            </div>
                        )}
                    </div>
                </div>
                
                {/* Estimated Value and Good Deal badge */}
                {estimatedValue > 0 && (
                    <div style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '10px',
                        marginBottom: '0.875rem',
                        padding: '8px 12px',
                        background: isGoodDeal 
                            ? `linear-gradient(135deg, ${theme.colors.success}18, ${theme.colors.success}08)`
                            : `linear-gradient(135deg, ${sneedexPrimary}12, ${sneedexPrimary}06)`,
                        borderRadius: '10px',
                        border: `1px solid ${isGoodDeal ? theme.colors.success : sneedexPrimary}20`,
                    }}>
                        <span style={{ 
                            color: theme.colors.mutedText, 
                            fontSize: '0.8rem',
                            fontWeight: '500'
                        }}>
                            Est. Value: <strong style={{ 
                                color: isGoodDeal ? theme.colors.success : theme.colors.primaryText,
                                fontWeight: '700'
                            }}>{formatUsd(estimatedValue)}</strong>
                        </span>
                        {isGoodDeal && (
                            <span style={{
                                background: `linear-gradient(135deg, ${theme.colors.success}, ${theme.colors.success}dd)`,
                                color: '#fff',
                                padding: '4px 10px',
                                borderRadius: '6px',
                                fontWeight: '700',
                                fontSize: '0.65rem',
                                letterSpacing: '0.3px',
                                boxShadow: `0 2px 8px ${theme.colors.success}40`,
                            }}>
                                🔥 GOOD DEAL
                            </span>
                        )}
                    </div>
                )}
                
                {/* Min bid increment (only on full view) */}
                {!compact && offer.min_bid_increment_fee_multiple?.[0] && tokenInfo.fee && (
                    <div style={{ 
                        fontSize: '0.75rem', 
                        color: theme.colors.mutedText,
                        marginBottom: '0.875rem',
                        textAlign: 'center',
                        fontWeight: '500',
                        opacity: 0.8
                    }}>
                        Min increment: {formatAmount(BigInt(Number(offer.min_bid_increment_fee_multiple[0])) * tokenInfo.fee, tokenInfo.decimals)} {tokenInfo.symbol}
                    </div>
                )}
                
                {/* Seller info (only on full view) */}
                {!compact && offer.creator && (
                    <div style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px',
                        fontSize: '0.8rem',
                        color: theme.colors.mutedText,
                        marginBottom: '0.75rem',
                        padding: '8px 12px',
                        background: theme.colors.primaryBg,
                        borderRadius: '8px',
                        border: `1px solid ${theme.colors.border}`,
                    }}>
                        <span style={{ fontWeight: '500' }}>Seller:</span>
                        <span onClick={(e) => e.preventDefault()}>
                            <PrincipalDisplay 
                                principal={offer.creator}
                                short={true}
                                showCopyButton={false}
                                enableContextMenu={true}
                                isAuthenticated={isAuthenticated}
                                style={{ fontSize: '0.8rem' }}
                            />
                        </span>
                    </div>
                )}
                
                {/* Footer */}
                <div style={styles.cardFooter}>
                    {isInactive ? (
                        <div style={{
                            ...styles.timeInfo,
                            color: theme.colors.mutedText,
                            background: theme.colors.primaryBg,
                            padding: '6px 10px',
                            borderRadius: '8px',
                        }}>
                            <FaClock size={12} />
                            <span>{getOfferStateString(offer.state)}</span>
                        </div>
                    ) : (
                        <div style={{
                            ...styles.timeInfo,
                            color: isPastExpiration ? theme.colors.warning : theme.colors.mutedText,
                            background: isPastExpiration 
                                ? `${theme.colors.warning}15` 
                                : theme.colors.primaryBg,
                            padding: '6px 10px',
                            borderRadius: '8px',
                            border: isPastExpiration ? `1px solid ${theme.colors.warning}30` : 'none',
                        }}>
                            <FaClock size={12} />
                            <span>{formatTimeRemaining(offer.expiration?.[0])}</span>
                            {isPastExpiration && (
                                <span style={{ 
                                    fontSize: '0.7rem',
                                    background: theme.colors.warning,
                                    color: '#fff',
                                    padding: '2px 6px',
                                    borderRadius: '4px',
                                    fontWeight: '600',
                                    marginLeft: '4px',
                                }}>
                                    !
                                </span>
                            )}
                        </div>
                    )}
                    <div style={styles.bidInfo}>
                        <div style={{
                            ...styles.bidCount,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'flex-end',
                            gap: '4px',
                        }}>
                            <FaGavel size={10} style={{ opacity: 0.6 }} />
                            {bidInfo.bids?.length || 0} bid{(bidInfo.bids?.length || 0) !== 1 ? 's' : ''}
                        </div>
                        {bidInfo.highest_bid && (
                            <>
                                <div style={{
                                    ...styles.highestBid,
                                    display: 'flex',
                                    alignItems: 'baseline',
                                    justifyContent: 'flex-end',
                                    gap: '4px',
                                }}>
                                    <span>{formatAmount(bidInfo.highest_bid.amount, tokenInfo.decimals)}</span>
                                    <span style={{ 
                                        fontSize: '0.8rem', 
                                        color: theme.colors.mutedText,
                                        fontWeight: '500',
                                    }}>
                                        {tokenInfo.symbol}
                                    </span>
                                    {highestBidUsd > 0 && (
                                        <span style={{ 
                                            fontSize: '0.75rem', 
                                            color: theme.colors.mutedText, 
                                            fontWeight: '400',
                                        }}>
                                            ({formatUsd(highestBidUsd)})
                                        </span>
                                    )}
                                </div>
                                {!compact && bidInfo.highest_bid.bidder && (
                                    <div style={{
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'flex-end',
                                        gap: '4px',
                                        fontSize: '0.75rem',
                                        color: theme.colors.mutedText,
                                        marginTop: '4px',
                                        fontWeight: '500',
                                    }}>
                                        <span>by</span>
                                        <span onClick={(e) => e.preventDefault()}>
                                            <PrincipalDisplay 
                                                principal={bidInfo.highest_bid.bidder}
                                                short={true}
                                                showCopyButton={false}
                                                enableContextMenu={true}
                                                isAuthenticated={isAuthenticated}
                                                style={{ fontSize: '0.75rem' }}
                                            />
                                        </span>
                                    </div>
                                )}
                            </>
                        )}
                    </div>
                </div>
            </div>
        </Link>
    );
}

export default OfferCard;
