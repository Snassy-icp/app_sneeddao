import React, { useState, useEffect, useCallback } from 'react';
import Header from '../components/Header';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import { FaGavel, FaHandHoldingUsd, FaClock, FaCheck, FaTimes, FaExternalLinkAlt, FaPlus, FaCubes, FaBrain, FaCoins, FaSync } from 'react-icons/fa';
import { 
    createSneedexActor, 
    formatAmount, 
    formatDate,
    formatTimeRemaining, 
    getOfferStateString,
    getBidStateString,
    getAssetType,
    getTokenInfo,
    getErrorMessage 
} from '../utils/SneedexUtils';

function SneedexMy() {
    const { identity, isAuthenticated } = useAuth();
    const { theme } = useTheme();
    const navigate = useNavigate();
    
    const [activeTab, setActiveTab] = useState('offers'); // 'offers' or 'bids'
    const [myOffers, setMyOffers] = useState([]);
    const [myBids, setMyBids] = useState([]);
    const [offersWithBids, setOffersWithBids] = useState({}); // Map of offerId to bid info
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [actionLoading, setActionLoading] = useState(null); // Track which item is loading
    
    const fetchData = useCallback(async () => {
        if (!identity) return;
        
        setLoading(true);
        setError('');
        try {
            const actor = createSneedexActor(identity);
            const principal = identity.getPrincipal();
            
            // Fetch offers created by the user
            const offers = await actor.getOffersByCreator(principal);
            setMyOffers(offers);
            
            // Fetch bids made by the user
            const bids = await actor.getBidsByBidder(principal);
            setMyBids(bids);
            
            // Fetch bid info for each offer
            const bidInfo = {};
            for (const offer of offers) {
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
            console.error('Failed to fetch data:', e);
            setError('Failed to load data. Please try again.');
        } finally {
            setLoading(false);
        }
    }, [identity]);
    
    useEffect(() => {
        if (isAuthenticated && identity) {
            fetchData();
        }
    }, [isAuthenticated, identity, fetchData]);
    
    const handleAcceptBid = async (offerId) => {
        if (!identity) return;
        
        setActionLoading(`accept-${offerId}`);
        try {
            const actor = createSneedexActor(identity);
            const result = await actor.acceptBid(BigInt(offerId));
            
            if ('err' in result) {
                throw new Error(getErrorMessage(result.err));
            }
            
            alert('Bid accepted successfully!');
            await fetchData();
        } catch (e) {
            console.error('Failed to accept bid:', e);
            alert(`Error: ${e.message}`);
        } finally {
            setActionLoading(null);
        }
    };
    
    const handleCancelOffer = async (offerId) => {
        if (!identity) return;
        
        if (!window.confirm('Are you sure you want to cancel this offer?')) return;
        
        setActionLoading(`cancel-${offerId}`);
        try {
            const actor = createSneedexActor(identity);
            const result = await actor.cancelOffer(BigInt(offerId));
            
            if ('err' in result) {
                throw new Error(getErrorMessage(result.err));
            }
            
            alert('Offer cancelled successfully!');
            await fetchData();
        } catch (e) {
            console.error('Failed to cancel offer:', e);
            alert(`Error: ${e.message}`);
        } finally {
            setActionLoading(null);
        }
    };
    
    const handleClaimPayment = async (offerId) => {
        if (!identity) return;
        
        setActionLoading(`claim-payment-${offerId}`);
        try {
            const actor = createSneedexActor(identity);
            const result = await actor.claimWinningBid(BigInt(offerId));
            
            if ('err' in result) {
                throw new Error(getErrorMessage(result.err));
            }
            
            alert('Payment claimed successfully!');
            await fetchData();
        } catch (e) {
            console.error('Failed to claim payment:', e);
            alert(`Error: ${e.message}`);
        } finally {
            setActionLoading(null);
        }
    };
    
    const handleClaimAssets = async (offerId) => {
        if (!identity) return;
        
        setActionLoading(`claim-assets-${offerId}`);
        try {
            const actor = createSneedexActor(identity);
            const result = await actor.claimAssets(BigInt(offerId));
            
            if ('err' in result) {
                throw new Error(getErrorMessage(result.err));
            }
            
            alert('Assets claimed successfully!');
            await fetchData();
        } catch (e) {
            console.error('Failed to claim assets:', e);
            alert(`Error: ${e.message}`);
        } finally {
            setActionLoading(null);
        }
    };
    
    const handleRefundBid = async (bidId) => {
        if (!identity) return;
        
        setActionLoading(`refund-${bidId}`);
        try {
            const actor = createSneedexActor(identity);
            const result = await actor.refundBid(BigInt(bidId));
            
            if ('err' in result) {
                throw new Error(getErrorMessage(result.err));
            }
            
            alert('Bid refunded successfully!');
            await fetchData();
        } catch (e) {
            console.error('Failed to refund bid:', e);
            alert(`Error: ${e.message}`);
        } finally {
            setActionLoading(null);
        }
    };
    
    const getStateBadgeStyle = (state) => {
        const baseStyle = {
            padding: '4px 12px',
            borderRadius: '6px',
            fontSize: '0.8rem',
            fontWeight: '600',
        };
        
        const stateStr = typeof state === 'string' ? state : getOfferStateString(state);
        
        switch (stateStr) {
            case 'Active':
            case 'Pending':
                return { ...baseStyle, background: `${theme.colors.success}20`, color: theme.colors.success };
            case 'Completed':
            case 'Won':
                return { ...baseStyle, background: `${theme.colors.accent}20`, color: theme.colors.accent };
            case 'Expired':
            case 'Lost':
                return { ...baseStyle, background: `${theme.colors.mutedText}20`, color: theme.colors.mutedText };
            case 'Cancelled':
            case 'Refunded':
                return { ...baseStyle, background: `${theme.colors.warning}20`, color: theme.colors.warning };
            case 'Draft':
            case 'Pending Escrow':
                return { ...baseStyle, background: `${theme.colors.warning}20`, color: theme.colors.warning };
            default:
                return { ...baseStyle, background: `${theme.colors.mutedText}20`, color: theme.colors.mutedText };
        }
    };
    
    const getAssetIcons = (assets) => {
        return assets.map((a, i) => {
            const type = getAssetType(a.asset);
            if (type === 'Canister') return <FaCubes key={i} style={{ color: theme.colors.accent }} />;
            if (type === 'SNSNeuron') return <FaBrain key={i} style={{ color: theme.colors.success }} />;
            if (type === 'ICRC1Token') return <FaCoins key={i} style={{ color: theme.colors.warning }} />;
            return null;
        });
    };

    const styles = {
        container: {
            maxWidth: '1200px',
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
        tabs: {
            display: 'flex',
            gap: '0.5rem',
            marginBottom: '2rem',
            background: theme.colors.secondaryBg,
            padding: '6px',
            borderRadius: '12px',
            width: 'fit-content',
        },
        tab: {
            padding: '12px 24px',
            borderRadius: '8px',
            border: 'none',
            fontSize: '1rem',
            fontWeight: '600',
            cursor: 'pointer',
            transition: 'all 0.3s ease',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
        },
        activeTab: {
            background: theme.colors.accent,
            color: theme.colors.primaryBg,
        },
        inactiveTab: {
            background: 'transparent',
            color: theme.colors.mutedText,
        },
        grid: {
            display: 'flex',
            flexDirection: 'column',
            gap: '1rem',
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
            alignItems: 'center',
            marginBottom: '1rem',
        },
        cardTitle: {
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
        },
        offerId: {
            fontSize: '1.1rem',
            fontWeight: '600',
            color: theme.colors.primaryText,
        },
        assetIcons: {
            display: 'flex',
            gap: '6px',
            fontSize: '1rem',
        },
        cardContent: {
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
            gap: '1rem',
        },
        infoItem: {
            padding: '0.75rem',
            background: theme.colors.tertiaryBg,
            borderRadius: '8px',
        },
        infoLabel: {
            fontSize: '0.75rem',
            color: theme.colors.mutedText,
            textTransform: 'uppercase',
            marginBottom: '4px',
        },
        infoValue: {
            fontSize: '1rem',
            fontWeight: '600',
            color: theme.colors.primaryText,
        },
        actionButtons: {
            display: 'flex',
            gap: '0.75rem',
            marginTop: '1rem',
            paddingTop: '1rem',
            borderTop: `1px solid ${theme.colors.border}`,
        },
        actionButton: {
            padding: '8px 16px',
            borderRadius: '8px',
            border: 'none',
            fontSize: '0.9rem',
            fontWeight: '600',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            transition: 'all 0.3s ease',
        },
        primaryAction: {
            background: `linear-gradient(135deg, ${theme.colors.accent}, ${theme.colors.accent}cc)`,
            color: theme.colors.primaryBg,
        },
        secondaryAction: {
            background: theme.colors.tertiaryBg,
            color: theme.colors.primaryText,
            border: `1px solid ${theme.colors.border}`,
        },
        successAction: {
            background: `linear-gradient(135deg, ${theme.colors.success}, ${theme.colors.success}cc)`,
            color: theme.colors.primaryBg,
        },
        warningAction: {
            background: `${theme.colors.warning}20`,
            color: theme.colors.warning,
            border: `1px solid ${theme.colors.warning}`,
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

    if (!isAuthenticated) {
        return (
            <div className='page-container' style={{ background: theme.colors.primaryGradient, minHeight: '100vh' }}>
                <Header />
                <main style={styles.container}>
                    <div style={styles.emptyState}>
                        <div style={styles.emptyIcon}>🔐</div>
                        <h3 style={styles.emptyTitle}>Connect Your Wallet</h3>
                        <p style={styles.emptyText}>Please connect your wallet to view your offers and bids.</p>
                    </div>
                </main>
            </div>
        );
    }

    return (
        <div className='page-container' style={{ background: theme.colors.primaryGradient, minHeight: '100vh' }}>
            <Header />
            <main style={styles.container}>
                <div style={styles.header}>
                    <h1 style={styles.title}>My Sneedex</h1>
                    <div style={styles.headerButtons}>
                        <button
                            style={styles.refreshButton}
                            onClick={fetchData}
                            disabled={loading}
                        >
                            <FaSync style={{ animation: loading ? 'spin 1s linear infinite' : 'none' }} />
                            {loading ? 'Loading...' : 'Refresh'}
                        </button>
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
                            <FaPlus /> Create Offer
                        </Link>
                    </div>
                </div>
                
                {error && (
                    <div style={styles.errorState}>
                        {error}
                    </div>
                )}
                
                <div style={styles.tabs}>
                    <button
                        style={{ ...styles.tab, ...(activeTab === 'offers' ? styles.activeTab : styles.inactiveTab) }}
                        onClick={() => setActiveTab('offers')}
                    >
                        <FaGavel /> My Offers ({myOffers.length})
                    </button>
                    <button
                        style={{ ...styles.tab, ...(activeTab === 'bids' ? styles.activeTab : styles.inactiveTab) }}
                        onClick={() => setActiveTab('bids')}
                    >
                        <FaHandHoldingUsd /> My Bids ({myBids.length})
                    </button>
                </div>
                
                {loading && myOffers.length === 0 && myBids.length === 0 ? (
                    <div style={styles.loadingState}>
                        <div style={{ fontSize: '2rem', marginBottom: '1rem' }}>⏳</div>
                        Loading your data...
                    </div>
                ) : activeTab === 'offers' ? (
                    <div style={styles.grid}>
                        {myOffers.length === 0 ? (
                            <div style={styles.emptyState}>
                                <div style={styles.emptyIcon}>📭</div>
                                <h3 style={styles.emptyTitle}>No Offers Yet</h3>
                                <p style={styles.emptyText}>You haven't created any offers. Start selling your assets!</p>
                                <Link to="/sneedex_create" style={styles.createButton}>
                                    <FaPlus /> Create Your First Offer
                                </Link>
                            </div>
                        ) : (
                            myOffers.map((offer) => {
                                const bidInfo = offersWithBids[Number(offer.id)] || {};
                                const tokenInfo = getTokenInfo(offer.price_token_ledger.toString());
                                const stateStr = getOfferStateString(offer.state);
                                const isActive = 'Active' in offer.state;
                                const isCompleted = 'Completed' in offer.state;
                                const isDraft = 'Draft' in offer.state || 'PendingEscrow' in offer.state;
                                
                                return (
                                    <div
                                        key={Number(offer.id)}
                                        style={styles.card}
                                        onClick={() => navigate(`/sneedex_offer/${offer.id}`)}
                                        onMouseEnter={(e) => {
                                            e.currentTarget.style.transform = 'translateY(-2px)';
                                            e.currentTarget.style.borderColor = theme.colors.accent;
                                        }}
                                        onMouseLeave={(e) => {
                                            e.currentTarget.style.transform = 'translateY(0)';
                                            e.currentTarget.style.borderColor = theme.colors.border;
                                        }}
                                    >
                                        <div style={styles.cardHeader}>
                                            <div style={styles.cardTitle}>
                                                <span style={styles.offerId}>Offer #{Number(offer.id)}</span>
                                                <div style={styles.assetIcons}>
                                                    {getAssetIcons(offer.assets)}
                                                </div>
                                            </div>
                                            <span style={getStateBadgeStyle(offer.state)}>{stateStr}</span>
                                        </div>
                                        
                                        <div style={styles.cardContent}>
                                            <div style={styles.infoItem}>
                                                <div style={styles.infoLabel}>Highest Bid</div>
                                                <div style={styles.infoValue}>
                                                    {bidInfo.highest_bid ? `${formatAmount(bidInfo.highest_bid.amount, tokenInfo.decimals)} ${tokenInfo.symbol}` : 'No bids'}
                                                </div>
                                            </div>
                                            <div style={styles.infoItem}>
                                                <div style={styles.infoLabel}>Total Bids</div>
                                                <div style={styles.infoValue}>{bidInfo.bids?.length || 0}</div>
                                            </div>
                                            <div style={styles.infoItem}>
                                                <div style={styles.infoLabel}>Time Left</div>
                                                <div style={styles.infoValue}>{formatTimeRemaining(offer.expiration[0])}</div>
                                            </div>
                                            <div style={styles.infoItem}>
                                                <div style={styles.infoLabel}>Created</div>
                                                <div style={styles.infoValue}>{formatDate(offer.created_at)}</div>
                                            </div>
                                        </div>
                                        
                                        {isCompleted && (
                                            <div style={styles.actionButtons} onClick={(e) => e.stopPropagation()}>
                                                <button 
                                                    style={{ ...styles.actionButton, ...styles.successAction }}
                                                    onClick={() => handleClaimPayment(offer.id)}
                                                    disabled={actionLoading === `claim-payment-${offer.id}`}
                                                >
                                                    <FaCheck /> {actionLoading === `claim-payment-${offer.id}` ? 'Processing...' : 'Claim Payment'}
                                                </button>
                                            </div>
                                        )}
                                        
                                        {isActive && (bidInfo.bids?.length || 0) > 0 && (
                                            <div style={styles.actionButtons} onClick={(e) => e.stopPropagation()}>
                                                <button 
                                                    style={{ ...styles.actionButton, ...styles.primaryAction }}
                                                    onClick={() => handleAcceptBid(offer.id)}
                                                    disabled={actionLoading === `accept-${offer.id}`}
                                                >
                                                    {actionLoading === `accept-${offer.id}` ? 'Processing...' : 'Accept Highest Bid'}
                                                </button>
                                            </div>
                                        )}
                                        
                                        {(isActive || isDraft) && (bidInfo.bids?.length || 0) === 0 && (
                                            <div style={styles.actionButtons} onClick={(e) => e.stopPropagation()}>
                                                <button 
                                                    style={{ ...styles.actionButton, ...styles.warningAction }}
                                                    onClick={() => handleCancelOffer(offer.id)}
                                                    disabled={actionLoading === `cancel-${offer.id}`}
                                                >
                                                    <FaTimes /> {actionLoading === `cancel-${offer.id}` ? 'Processing...' : 'Cancel Offer'}
                                                </button>
                                            </div>
                                        )}
                                    </div>
                                );
                            })
                        )}
                    </div>
                ) : (
                    <div style={styles.grid}>
                        {myBids.length === 0 ? (
                            <div style={styles.emptyState}>
                                <div style={styles.emptyIcon}>🎯</div>
                                <h3 style={styles.emptyTitle}>No Bids Yet</h3>
                                <p style={styles.emptyText}>You haven't placed any bids. Browse the marketplace to find offers!</p>
                                <Link to="/sneedex_offers" style={{ ...styles.createButton, background: `linear-gradient(135deg, ${theme.colors.accent}, ${theme.colors.accent}cc)` }}>
                                    <FaGavel /> Browse Marketplace
                                </Link>
                            </div>
                        ) : (
                            myBids.map((bid) => {
                                const stateStr = getBidStateString(bid.state);
                                const isWon = 'Won' in bid.state;
                                const isLost = 'Lost' in bid.state;
                                const isPending = 'Pending' in bid.state;
                                
                                return (
                                    <div
                                        key={Number(bid.id)}
                                        style={styles.card}
                                        onClick={() => navigate(`/sneedex_offer/${bid.offer_id}`)}
                                        onMouseEnter={(e) => {
                                            e.currentTarget.style.transform = 'translateY(-2px)';
                                            e.currentTarget.style.borderColor = theme.colors.accent;
                                        }}
                                        onMouseLeave={(e) => {
                                            e.currentTarget.style.transform = 'translateY(0)';
                                            e.currentTarget.style.borderColor = theme.colors.border;
                                        }}
                                    >
                                        <div style={styles.cardHeader}>
                                            <div style={styles.cardTitle}>
                                                <span style={styles.offerId}>Bid on Offer #{Number(bid.offer_id)}</span>
                                            </div>
                                            <span style={getStateBadgeStyle(stateStr)}>{stateStr}</span>
                                        </div>
                                        
                                        <div style={styles.cardContent}>
                                            <div style={styles.infoItem}>
                                                <div style={styles.infoLabel}>Your Bid</div>
                                                <div style={styles.infoValue}>
                                                    {formatAmount(bid.amount)} tokens
                                                </div>
                                            </div>
                                            <div style={styles.infoItem}>
                                                <div style={styles.infoLabel}>Escrowed</div>
                                                <div style={styles.infoValue}>{bid.tokens_escrowed ? 'Yes' : 'No'}</div>
                                            </div>
                                            <div style={styles.infoItem}>
                                                <div style={styles.infoLabel}>Placed</div>
                                                <div style={styles.infoValue}>{formatDate(bid.created_at)}</div>
                                            </div>
                                        </div>
                                        
                                        {isWon && (
                                            <div style={styles.actionButtons} onClick={(e) => e.stopPropagation()}>
                                                <button 
                                                    style={{ ...styles.actionButton, ...styles.successAction }}
                                                    onClick={() => handleClaimAssets(bid.offer_id)}
                                                    disabled={actionLoading === `claim-assets-${bid.offer_id}`}
                                                >
                                                    <FaCheck /> {actionLoading === `claim-assets-${bid.offer_id}` ? 'Processing...' : 'Claim Assets'}
                                                </button>
                                            </div>
                                        )}
                                        
                                        {isLost && bid.tokens_escrowed && (
                                            <div style={styles.actionButtons} onClick={(e) => e.stopPropagation()}>
                                                <button 
                                                    style={{ ...styles.actionButton, ...styles.primaryAction }}
                                                    onClick={() => handleRefundBid(bid.id)}
                                                    disabled={actionLoading === `refund-${bid.id}`}
                                                >
                                                    💸 {actionLoading === `refund-${bid.id}` ? 'Processing...' : 'Refund Bid'}
                                                </button>
                                            </div>
                                        )}
                                    </div>
                                );
                            })
                        )}
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

export default SneedexMy;
