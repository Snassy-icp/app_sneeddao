import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '../AuthContext';
import { useNavigate } from 'react-router-dom';
import { useForum } from '../contexts/ForumContext';
import { useTheme } from '../contexts/ThemeContext';
import { useTokenMetadata } from '../hooks/useTokenMetadata';
import { useNaming } from '../NamingContext';
import { useTipNotifications } from '../hooks/useTipNotifications';
import { 
    getTipsReceivedByUser, 
    getTipsGivenByUser,
    getRecentTipsCount,
    getLastSeenTipTimestamp,
    markTipsSeenUpTo
} from '../utils/BackendUtils';
import { getRelativeTime, getFullDate } from '../utils/DateUtils';
import { formatPrincipal, getPrincipalDisplayInfoFromContext, PrincipalDisplay } from '../utils/PrincipalUtils';
import { Principal } from '@dfinity/principal';
import Header from '../components/Header';
import TokenConfetti from '../components/TokenConfetti';
import { FaGift, FaArrowDown, FaArrowUp, FaSync, FaLock, FaExternalLinkAlt, FaComment } from 'react-icons/fa';

// Custom CSS for animations
const customStyles = `
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

@keyframes float {
    0%, 100% { transform: translateY(0px); }
    50% { transform: translateY(-5px); }
}

@keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.7; }
}

@keyframes spin {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
}

@keyframes newTipGlow {
    0%, 100% { box-shadow: 0 0 0 0 rgba(245, 158, 11, 0); }
    50% { box-shadow: 0 0 20px 5px rgba(245, 158, 11, 0.3); }
}

.tips-card-animate {
    animation: fadeInUp 0.5s ease-out forwards;
}

.tips-card {
    transition: all 0.3s ease;
}

.tips-card:hover {
    transform: translateY(-2px);
    box-shadow: 0 8px 30px rgba(245, 158, 11, 0.15);
}

.tips-float {
    animation: float 3s ease-in-out infinite;
}

.tips-pulse {
    animation: pulse 2s ease-in-out infinite;
}

.tips-new-glow {
    animation: fadeInUp 0.5s ease-out forwards, newTipGlow 2s ease-in-out 3;
}

.tips-tab {
    transition: all 0.2s ease;
}

.tips-tab:hover {
    transform: translateY(-1px);
}
`;

// Accent colors for this page
const tipsPrimary = '#f59e0b'; // Amber/Gold
const tipsSecondary = '#d97706'; // Darker amber
const tipsAccent = '#fbbf24'; // Light amber

const Tips = () => {
    const { theme } = useTheme();
    const navigate = useNavigate();
    const { isAuthenticated, identity } = useAuth();
    const { createForumActor } = useForum();
    const { getTokenMetadata, fetchTokenMetadata } = useTokenMetadata();
    const { principalNames, principalNicknames, fetchAllNames } = useNaming();
    const { refreshNotifications } = useTipNotifications();
    
    const [tipsReceived, setTipsReceived] = useState([]);
    const [tipsGiven, setTipsGiven] = useState([]);
    const [activeTab, setActiveTab] = useState('received');
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [loadingMetadata, setLoadingMetadata] = useState(new Set());
    const [principalDisplayInfo, setPrincipalDisplayInfo] = useState(new Map());
    const [capturedOldTimestamp, setCapturedOldTimestamp] = useState(0); // Captured ONCE for highlighting
    const [timestampProcessed, setTimestampProcessed] = useState(false); // Ensures single execution
    const [isNarrowScreen, setIsNarrowScreen] = useState(window.innerWidth < 768);
    
    // Confetti state
    const [confettiLogos, setConfettiLogos] = useState([]);
    const [triggerConfetti, setTriggerConfetti] = useState(0);
    const confettiTriggeredRef = useRef(false);
    
    // Debug: Press 'C' to test confetti (development only)
    useEffect(() => {
        const handleKeyPress = (e) => {
            if (e.key === 'c' || e.key === 'C') {
                // Gather all token logos from tips
                const allLogos = tipsReceived
                    .map(tip => {
                        const metadata = getTokenMetadata(tip.token_ledger_principal.toString());
                        return metadata?.logo;
                    })
                    .filter(logo => logo != null);
                
                const uniqueLogos = [...new Set(allLogos)];
                
                if (uniqueLogos.length > 0) {
                    console.log('🎉 Manual confetti trigger! Logos:', uniqueLogos);
                    setConfettiLogos(uniqueLogos);
                    setTimeout(() => setTriggerConfetti(prev => prev + 1), 100);
                } else {
                    console.log('⚠️ No token logos available for confetti');
                }
            }
        };
        
        window.addEventListener('keypress', handleKeyPress);
        return () => window.removeEventListener('keypress', handleKeyPress);
    }, [tipsReceived, getTokenMetadata]);

    // Handle window resize for responsive layout
    useEffect(() => {
        const handleResize = () => {
            setIsNarrowScreen(window.innerWidth < 768);
        };

        window.addEventListener('resize', handleResize);
        return () => window.removeEventListener('resize', handleResize);
    }, []);

    // Fetch tips data
    const fetchTipsData = useCallback(async () => {
        if (!isAuthenticated || !identity) {
            setLoading(false);
            return;
        }

        try {
            setLoading(true);
            setError(null);

            const forumActor = createForumActor(identity);
            const userPrincipal = identity.getPrincipal();

            // Fetch both received and given tips
            const [received, given] = await Promise.all([
                getTipsReceivedByUser(forumActor, userPrincipal),
                getTipsGivenByUser(forumActor, userPrincipal)
            ]);

            // Sort tips newest first
            const sortedReceived = received.sort((a, b) => Number(b.created_at) - Number(a.created_at));
            const sortedGiven = given.sort((a, b) => Number(b.created_at) - Number(a.created_at));
            
            console.log('📊 FETCHED TIPS DATA:', { receivedCount: sortedReceived.length, givenCount: sortedGiven.length });

            setTipsReceived(sortedReceived);
            setTipsGiven(sortedGiven);

            // Collect all unique principals and tokens for metadata fetching
            const allTips = [...sortedReceived, ...sortedGiven];
            const uniquePrincipals = new Set();
            const uniqueTokens = new Set();

            allTips.forEach(tip => {
                uniquePrincipals.add(tip.from_principal.toString());
                uniquePrincipals.add(tip.to_principal.toString());
                uniqueTokens.add(tip.token_ledger_principal.toString());
            });

            // Build principal display info map
            if (uniquePrincipals.size > 0) {
                const displayInfoMap = new Map();
                Array.from(uniquePrincipals).forEach(principalStr => {
                    try {
                        const principal = Principal.fromText(principalStr);
                        const displayInfo = getPrincipalDisplayInfoFromContext(
                            principal, 
                            principalNames, 
                            principalNicknames
                        );
                        displayInfoMap.set(principalStr, displayInfo);
                    } catch (error) {
                        console.error('Error processing principal:', principalStr, error);
                    }
                });
                setPrincipalDisplayInfo(displayInfoMap);
            }

            // Fetch token metadata for tokens we don't have
            for (const tokenId of uniqueTokens) {
                const existing = getTokenMetadata(tokenId);
                if (!existing) {
                    setLoadingMetadata(prev => new Set([...prev, tokenId]));
                    fetchTokenMetadata(tokenId).finally(() => {
                        setLoadingMetadata(prev => {
                            const newSet = new Set(prev);
                            newSet.delete(tokenId);
                            return newSet;
                        });
                    });
                }
            }

        } catch (err) {
            console.error('Error fetching tips data:', err);
            setError(err.message);
        } finally {
            setLoading(false);
        }
    }, [isAuthenticated, identity, createForumActor, principalNames, principalNicknames, getTokenMetadata, fetchTokenMetadata]);

    // ONE-TIME timestamp processing - executes ONCE per page load
    useEffect(() => {
        const processTimestamp = async () => {
            if (!isAuthenticated || !identity || timestampProcessed) {
                return;
            }

            try {                
                const forumActor = createForumActor(identity);
                const userPrincipal = identity.getPrincipal();

                // Step 1: Get old timestamp ONCE
                const oldTimestampResult = await getLastSeenTipTimestamp(forumActor, userPrincipal);
                const currentOldTimestamp = oldTimestampResult || 0;
                setCapturedOldTimestamp(currentOldTimestamp);
                
                // Step 2: Check if we have new tips
                const newTipsCount = await getRecentTipsCount(forumActor, userPrincipal);

                // Step 3: Update backend timestamp ONCE if we have new tips
                if (Number(newTipsCount) > 0) {
                    const currentTimestamp = Date.now() * 1_000_000;
                    await markTipsSeenUpTo(forumActor, currentTimestamp);
                } else {
                }

                // Mark as processed to prevent re-execution
                setTimestampProcessed(true);

            } catch (error) {
                console.error('Error in timestamp processing:', error);
                setTimestampProcessed(true); // Prevent infinite retries
            }
        };

        processTimestamp();
    }, [isAuthenticated, identity, createForumActor, timestampProcessed]);

    // Separate effect for data fetching (can run multiple times)
    useEffect(() => {
        if (timestampProcessed) {
            // Only fetch data after timestamp processing is complete
            fetchTipsData();
        }
    }, [timestampProcessed, fetchTipsData]);
    
    // Effect to trigger confetti when new tips are loaded
    useEffect(() => {
        // Only run once per page load, after tips are loaded
        if (confettiTriggeredRef.current || loading || tipsReceived.length === 0) {
            return;
        }
        
        // Find new tips (if capturedOldTimestamp is 0, all tips are "new" for first-time users)
        const newTips = capturedOldTimestamp > 0 
            ? tipsReceived.filter(tip => Number(tip.created_at) > capturedOldTimestamp)
            : []; // Don't show confetti for first-time users with no previous timestamp
        
        console.log('🎊 Checking for new tips:', { 
            total: tipsReceived.length, 
            newCount: newTips.length, 
            capturedOldTimestamp,
            loading,
            alreadyTriggered: confettiTriggeredRef.current
        });
        
        if (newTips.length === 0) {
            confettiTriggeredRef.current = true; // Mark as checked even if no new tips
            return;
        }
        
        // Collect unique token logos from new tips (use getTokenMetadata directly)
        const uniqueTokenIds = [...new Set(newTips.map(tip => tip.token_ledger_principal.toString()))];
        const logos = uniqueTokenIds
            .map(tokenId => {
                const metadata = getTokenMetadata(tokenId);
                return metadata?.logo;
            })
            .filter(logo => logo != null);
        
        console.log('🎊 Token logos found:', { uniqueTokenIds, logos });
        
        if (logos.length === 0) {
            // No logos loaded yet, wait for metadata to load
            // The effect will re-run when getTokenMetadata updates
            return;
        }
        
        // Preload images before triggering confetti
        const preloadPromises = logos.map(url => {
            return new Promise((resolve) => {
                const img = new Image();
                img.crossOrigin = 'anonymous';
                img.onload = () => resolve(true);
                img.onerror = () => resolve(false);
                img.src = url;
            });
        });
        
        Promise.all(preloadPromises).then(results => {
            console.log('🎊 Images preloaded:', results);
            // Only proceed if at least one image loaded
            if (results.some(loaded => loaded) && !confettiTriggeredRef.current) {
                confettiTriggeredRef.current = true;
                setConfettiLogos(logos);
                console.log('🎉🎉🎉 LAUNCHING CONFETTI! 🎉🎉🎉');
                // Small delay for dramatic effect
                setTimeout(() => {
                    setTriggerConfetti(prev => prev + 1);
                }, 300);
            }
        });
    }, [loading, tipsReceived, capturedOldTimestamp, getTokenMetadata, loadingMetadata]);

    // Helper function to check if a tip is new (for highlighting)
    const isTipNew = (tipTimestamp) => {
        const isNew = Number(tipTimestamp) > capturedOldTimestamp;
        return isNew;
    };

    // Helper functions for token display
    const getTokenSymbol = (tokenId) => {
        const metadata = getTokenMetadata(tokenId);
        return metadata?.symbol || 'Unknown';
    };

    const getTokenDecimals = (tokenId) => {
        const metadata = getTokenMetadata(tokenId);
        return metadata?.decimals || 8;
    };

    const getTokenLogo = (tokenId) => {
        const metadata = getTokenMetadata(tokenId);
        return metadata?.logo;
    };

    const formatTokenAmount = (amount, tokenId) => {
        const decimals = getTokenDecimals(tokenId);
        const symbol = getTokenSymbol(tokenId);
        const formattedAmount = (Number(amount) / Math.pow(10, decimals)).toLocaleString('en-US', {
            minimumFractionDigits: 0,
            maximumFractionDigits: Math.min(decimals, 8)
        });
        return `${formattedAmount} ${symbol}`;
    };

    const formatDate = (timestamp) => {
        const date = new Date(Number(timestamp) / 1_000_000); // Convert from nanoseconds
        return date.toLocaleString('en-US', {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
    };

    const renderTipRow = (tip, isReceived) => {
        const tokenId = tip.token_ledger_principal.toString();
        const otherPrincipal = isReceived ? tip.from_principal : tip.to_principal;
        const otherPrincipalStr = otherPrincipal.toString();
        const displayInfo = principalDisplayInfo.get(otherPrincipalStr);
        const formattedPrincipal = formatPrincipal(otherPrincipal, displayInfo);
        const isLoadingToken = loadingMetadata.has(tokenId);
        const logo = getTokenLogo(tokenId);
        
        // Check if this tip is new (only highlight received tips)
        const isNew = isReceived && isTipNew(tip.created_at);

        return (
            <tr key={tip.id} className={`tip-row ${isNew ? 'tip-new' : ''}`}>
                <td className="tip-amount">
                    <div className="tip-amount-container">
                        {isLoadingToken ? (
                            <span className="loading-indicator">⏳</span>
                        ) : logo ? (
                            <img src={logo} alt="" className="token-logo" />
                        ) : (
                            <span className="token-fallback">💎</span>
                        )}
                        <span className="amount-text">
                            {isLoadingToken ? 'Loading...' : formatTokenAmount(tip.amount, tokenId)}
                        </span>
                    </div>
                </td>
                <td className="tip-principal">
                    <PrincipalDisplay 
                        principal={otherPrincipalStr}
                        displayInfo={principalDisplayInfo.get(otherPrincipalStr)}
                        showCopyButton={true}
                        enableContextMenu={true}
                        short={true}
                        maxLength={20}
                        isAuthenticated={isAuthenticated}
                    />
                </td>
                <td className="tip-post">
                    <div className="post-links">
                        <button 
                            className="post-link"
                            onClick={() => navigate(`/post?postid=${tip.post_id}`)}
                            title="View this post"
                            style={{ whiteSpace: 'nowrap' }}
                        >
                            📄 Post #{tip.post_id?.toString() || 'N/A'}
                        </button>
                        {tip.thread_id && (
                            <button 
                                className="thread-link"
                                onClick={() => navigate(`/thread?threadid=${tip.thread_id}`)}
                                title="View full thread"
                                style={{ whiteSpace: 'nowrap' }}
                            >
                                🧵 Thread #{tip.thread_id?.toString() || 'N/A'}
                            </button>
                        )}
                    </div>
                </td>
                <td className="tip-date" style={{ color: theme.colors.secondaryText, cursor: 'default' }} title={getFullDate(tip.created_at)}>
                    {getRelativeTime(tip.created_at)}
                </td>
            </tr>
        );
    };

    const renderTipCard = (tip, isReceived) => {
        const tokenId = tip.token_ledger_principal.toString();
        const otherPrincipal = isReceived ? tip.from_principal : tip.to_principal;
        const otherPrincipalStr = otherPrincipal.toString();
        const displayInfo = principalDisplayInfo.get(otherPrincipalStr);
        const formattedPrincipal = formatPrincipal(otherPrincipal, displayInfo);
        const isLoadingToken = loadingMetadata.has(tokenId);
        const logo = getTokenLogo(tokenId);
        
        // Check if this tip is new (only highlight received tips)
        const isNew = isReceived && isTipNew(tip.created_at);

        return (
            <div key={tip.id} className={`tip-card ${isNew ? 'tip-new' : ''}`} style={{
                backgroundColor: theme.colors.secondaryBg,
                border: isNew ? `2px solid ${theme.colors.accent}` : `1px solid ${theme.colors.border}`,
                borderRadius: '8px',
                padding: '16px',
                marginBottom: '12px',
                display: 'flex',
                flexDirection: 'column',
                gap: '12px'
            }}>
                {/* Amount Row */}
                <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    fontSize: '14px'
                }}>
                    <span style={{ color: theme.colors.mutedText, minWidth: '40px' }}>Amount:</span>
                    <div style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px',
                        fontSize: '18px',
                        fontWeight: 'bold'
                    }}>
                        {isLoadingToken ? (
                            <span className="loading-indicator">⏳</span>
                        ) : logo ? (
                            <img src={logo} alt="" style={{ width: '24px', height: '24px', borderRadius: '50%' }} />
                        ) : (
                            <span style={{ fontSize: '20px' }}>💎</span>
                        )}
                                                 <span style={{ color: '#ffd700' }}>
                             {isLoadingToken ? 'Loading...' : formatTokenAmount(tip.amount, tokenId)}
                         </span>
                    </div>
                </div>

                {/* Principal Row */}
                <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    fontSize: '14px'
                }}>
                    <span style={{ color: theme.colors.mutedText, minWidth: '40px' }}>
                        {isReceived ? 'From:' : 'To:'}
                    </span>
                    <span style={{ color: theme.colors.primaryText }}>
                        {typeof formattedPrincipal === 'string' ? (
                            formattedPrincipal
                        ) : formattedPrincipal?.name || formattedPrincipal?.nickname ? (
                            <div>
                                {formattedPrincipal.name && (
                                    <span style={{ color: theme.colors.accent }}>{formattedPrincipal.name}</span>
                                )}
                                {formattedPrincipal.nickname && (
                                    <span style={{ color: theme.colors.accent, marginLeft: '4px' }}>"{formattedPrincipal.nickname}"</span>
                                )}
                            </div>
                        ) : (
                            otherPrincipalStr.slice(0, 12) + '...'
                        )}
                    </span>
                </div>

                {/* Post Links Row */}
                <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    fontSize: '14px'
                }}>
                    <span style={{ color: theme.colors.mutedText, minWidth: '40px' }}>Post:</span>
                    <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                        <button 
                            onClick={() => navigate(`/post?postid=${tip.post_id}`)}
                            style={{
                                background: 'none',
                                border: `1px solid ${theme.colors.accent}`,
                                color: theme.colors.accent,
                                padding: '4px 8px',
                                borderRadius: '4px',
                                fontSize: '12px',
                                cursor: 'pointer',
                                whiteSpace: 'nowrap'
                            }}
                            title="View this post"
                        >
                            📄 #{tip.post_id?.toString() || 'N/A'}
                        </button>
                        {tip.thread_id && (
                            <button 
                                onClick={() => navigate(`/thread?threadid=${tip.thread_id}`)}
                                style={{
                                    background: 'none',
                                    border: `1px solid ${theme.colors.success}`,
                                    color: theme.colors.success,
                                    padding: '4px 8px',
                                    borderRadius: '4px',
                                    fontSize: '12px',
                                    cursor: 'pointer',
                                    whiteSpace: 'nowrap'
                                }}
                                title="View thread"
                            >
                                🧵 Thread
                            </button>
                        )}
                    </div>
                </div>

                {/* Date Row */}
                <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    fontSize: '12px',
                    color: theme.colors.mutedText
                }}>
                    <span style={{ minWidth: '40px' }}>Date:</span>
                    <span style={{ cursor: 'default' }} title={getFullDate(tip.created_at)}>{getRelativeTime(tip.created_at)}</span>
                </div>
            </div>
        );
    };

    if (!isAuthenticated) {
        return (
            <div className="page-container">
                <style>{customStyles}</style>
                <Header showSnsDropdown={false} />
                <main style={{ background: theme.colors.primaryGradient, minHeight: '100vh' }}>
                    {/* Hero Section */}
                    <div style={{
                        background: `linear-gradient(135deg, ${theme.colors.primaryBg} 0%, ${tipsPrimary}15 50%, ${tipsSecondary}10 100%)`,
                        borderBottom: `1px solid ${theme.colors.border}`,
                        padding: '2rem 1.5rem',
                        position: 'relative',
                        overflow: 'hidden'
                    }}>
                        <div style={{
                            position: 'absolute',
                            top: '-50%',
                            right: '-10%',
                            width: '400px',
                            height: '400px',
                            background: `radial-gradient(circle, ${tipsPrimary}20 0%, transparent 70%)`,
                            borderRadius: '50%',
                            pointerEvents: 'none'
                        }} />
                        <div style={{ maxWidth: '900px', margin: '0 auto', position: 'relative', zIndex: 1 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '1.25rem' }}>
                                <div className="tips-float" style={{
                                    width: '64px',
                                    height: '64px',
                                    minWidth: '64px',
                                    borderRadius: '16px',
                                    background: `linear-gradient(135deg, ${tipsPrimary}, ${tipsSecondary})`,
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    boxShadow: `0 8px 30px ${tipsPrimary}40`
                                }}>
                                    <FaGift size={28} color="white" />
                                </div>
                                <div>
                                    <h1 style={{ color: theme.colors.primaryText, fontSize: '2rem', fontWeight: '700', margin: 0 }}>
                                        Tips
                                    </h1>
                                    <p style={{ color: theme.colors.secondaryText, fontSize: '1rem', margin: '0.35rem 0 0 0' }}>
                                        View tips you've received and given in the forum
                                    </p>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Login Required */}
                    <div style={{ maxWidth: '900px', margin: '0 auto', padding: '2rem 1.5rem' }}>
                        <div className="tips-card-animate" style={{
                            background: theme.colors.secondaryBg,
                            borderRadius: '20px',
                            padding: '3rem 2rem',
                            textAlign: 'center',
                            border: `1px solid ${theme.colors.border}`,
                            opacity: 0,
                            animationDelay: '0.1s'
                        }}>
                            <div className="tips-float" style={{
                                width: '80px',
                                height: '80px',
                                margin: '0 auto 1.5rem',
                                borderRadius: '50%',
                                background: `linear-gradient(135deg, ${tipsPrimary}, ${tipsSecondary})`,
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                boxShadow: `0 8px 30px ${tipsPrimary}40`
                            }}>
                                <FaLock size={32} color="white" />
                            </div>
                            <h2 style={{ color: theme.colors.primaryText, fontSize: '1.5rem', marginBottom: '1rem', fontWeight: '600' }}>
                                Connect to View Tips
                            </h2>
                            <p style={{ color: theme.colors.secondaryText, maxWidth: '400px', margin: '0 auto', lineHeight: '1.6' }}>
                                Connect your wallet to view tips you've received and given in the forum.
                            </p>
                        </div>
                    </div>
                </main>
            </div>
        );
    }

    return (
        <div className="page-container">
            <style>{customStyles}</style>
            <Header showSnsDropdown={false} />
            
            {/* Token Logo Confetti for new tips */}
            <TokenConfetti 
                tokenLogos={confettiLogos}
                trigger={triggerConfetti}
                duration={7000}
                particleCount={80}
            />
            
            <main style={{ background: theme.colors.primaryGradient, minHeight: '100vh' }}>
                {/* Hero Section */}
                <div style={{
                    background: `linear-gradient(135deg, ${theme.colors.primaryBg} 0%, ${tipsPrimary}15 50%, ${tipsSecondary}10 100%)`,
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
                        background: `radial-gradient(circle, ${tipsPrimary}20 0%, transparent 70%)`,
                        borderRadius: '50%',
                        pointerEvents: 'none'
                    }} />
                    <div style={{
                        position: 'absolute',
                        bottom: '-30%',
                        left: '-5%',
                        width: '300px',
                        height: '300px',
                        background: `radial-gradient(circle, ${tipsSecondary}15 0%, transparent 70%)`,
                        borderRadius: '50%',
                        pointerEvents: 'none'
                    }} />
                    
                    <div style={{ maxWidth: '900px', margin: '0 auto', position: 'relative', zIndex: 1 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '1.25rem', marginBottom: '1rem' }}>
                            <div className="tips-float" style={{
                                width: '64px',
                                height: '64px',
                                minWidth: '64px',
                                maxWidth: '64px',
                                flexShrink: 0,
                                borderRadius: '16px',
                                background: `linear-gradient(135deg, ${tipsPrimary}, ${tipsSecondary})`,
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                boxShadow: `0 8px 30px ${tipsPrimary}40`
                            }}>
                                <FaGift size={28} color="white" />
                            </div>
                            <div style={{ flex: 1, minWidth: 0 }}>
                                <h1 style={{ color: theme.colors.primaryText, fontSize: '2rem', fontWeight: '700', margin: 0, lineHeight: '1.2' }}>
                                    Tips
                                </h1>
                                <p style={{ color: theme.colors.secondaryText, fontSize: '1rem', margin: '0.35rem 0 0 0' }}>
                                    View tips you've received and given in the forum
                                </p>
                            </div>
                        </div>
                        
                        {/* Quick Stats */}
                        <div style={{ display: 'flex', gap: '1.5rem', flexWrap: 'wrap' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: theme.colors.secondaryText, fontSize: '0.9rem' }}>
                                <FaArrowDown size={14} style={{ color: theme.colors.success }} />
                                <span><strong style={{ color: theme.colors.success }}>{tipsReceived.length}</strong> received</span>
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: theme.colors.secondaryText, fontSize: '0.9rem' }}>
                                <FaArrowUp size={14} style={{ color: tipsPrimary }} />
                                <span><strong style={{ color: tipsPrimary }}>{tipsGiven.length}</strong> given</span>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Main Content */}
                <div style={{ maxWidth: '900px', margin: '0 auto', padding: '2rem 1.5rem' }}>
                    {/* Tab Buttons */}
                    <div style={{
                        display: 'flex',
                        gap: '0.75rem',
                        marginBottom: '1.5rem',
                        background: theme.colors.secondaryBg,
                        padding: '0.5rem',
                        borderRadius: '14px',
                        border: `1px solid ${theme.colors.border}`
                    }}>
                        {[
                            { key: 'received', label: 'Tips Received', count: tipsReceived.length, icon: <FaArrowDown size={14} />, color: theme.colors.success },
                            { key: 'given', label: 'Tips Given', count: tipsGiven.length, icon: <FaArrowUp size={14} />, color: tipsPrimary }
                        ].map(tab => (
                            <button
                                key={tab.key}
                                onClick={() => setActiveTab(tab.key)}
                                className="tips-tab"
                                style={{
                                    flex: 1,
                                    background: activeTab === tab.key 
                                        ? `linear-gradient(135deg, ${tab.color}, ${tab.color}cc)` 
                                        : 'transparent',
                                    color: activeTab === tab.key ? 'white' : theme.colors.secondaryText,
                                    border: 'none',
                                    borderRadius: '10px',
                                    padding: '0.75rem 1rem',
                                    cursor: 'pointer',
                                    fontSize: '0.95rem',
                                    fontWeight: '600',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    gap: '0.5rem',
                                    boxShadow: activeTab === tab.key ? `0 4px 15px ${tab.color}40` : 'none'
                                }}
                            >
                                {tab.icon}
                                {tab.label}
                                <span style={{
                                    background: activeTab === tab.key ? 'rgba(255,255,255,0.2)' : `${tab.color}20`,
                                    color: activeTab === tab.key ? 'white' : tab.color,
                                    padding: '0.15rem 0.5rem',
                                    borderRadius: '8px',
                                    fontSize: '0.8rem',
                                    fontWeight: '700'
                                }}>
                                    {tab.count}
                                </span>
                            </button>
                        ))}
                    </div>

                    {/* Refresh Button */}
                    <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '1rem' }}>
                        <button 
                            onClick={() => {
                                refreshNotifications();
                                fetchTipsData();
                            }}
                            disabled={loading}
                            style={{
                                background: theme.colors.tertiaryBg,
                                color: theme.colors.primaryText,
                                border: `1px solid ${theme.colors.border}`,
                                borderRadius: '10px',
                                padding: '0.6rem 1rem',
                                cursor: loading ? 'not-allowed' : 'pointer',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '0.5rem',
                                fontSize: '0.85rem',
                                fontWeight: '500',
                                opacity: loading ? 0.6 : 1,
                                transition: 'all 0.2s ease'
                            }}
                        >
                            <FaSync size={12} style={{ animation: loading ? 'spin 1s linear infinite' : 'none' }} />
                            Refresh
                        </button>
                    </div>

                    {/* Content */}
                    {loading ? (
                        <div style={{
                            background: theme.colors.secondaryBg,
                            borderRadius: '16px',
                            padding: '4rem 2rem',
                            textAlign: 'center',
                            border: `1px solid ${theme.colors.border}`
                        }}>
                            <div className="tips-pulse" style={{
                                width: '60px',
                                height: '60px',
                                borderRadius: '50%',
                                background: `linear-gradient(135deg, ${tipsPrimary}, ${tipsSecondary})`,
                                margin: '0 auto 1.5rem',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center'
                            }}>
                                <FaGift size={24} color="white" />
                            </div>
                            <p style={{ color: theme.colors.secondaryText, fontSize: '1.1rem' }}>
                                Loading your tips...
                            </p>
                        </div>
                    ) : error ? (
                        <div style={{
                            background: `linear-gradient(135deg, ${theme.colors.error}15, ${theme.colors.error}08)`,
                            border: `1px solid ${theme.colors.error}30`,
                            borderRadius: '16px',
                            padding: '2rem',
                            textAlign: 'center'
                        }}>
                            <p style={{ color: theme.colors.error, marginBottom: '1rem' }}>Error loading tips: {error}</p>
                            <button 
                                onClick={fetchTipsData}
                                style={{
                                    background: theme.colors.error,
                                    color: 'white',
                                    border: 'none',
                                    padding: '0.6rem 1.25rem',
                                    borderRadius: '8px',
                                    cursor: 'pointer',
                                    fontWeight: '600'
                                }}
                            >
                                Try Again
                            </button>
                        </div>
                    ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                            {activeTab === 'received' ? (
                                tipsReceived.length === 0 ? (
                                    <div className="tips-card-animate" style={{
                                        background: theme.colors.secondaryBg,
                                        borderRadius: '16px',
                                        padding: '3rem 2rem',
                                        textAlign: 'center',
                                        border: `1px solid ${theme.colors.border}`,
                                        opacity: 0,
                                        animationDelay: '0.1s'
                                    }}>
                                        <div className="tips-float" style={{
                                            width: '60px',
                                            height: '60px',
                                            borderRadius: '50%',
                                            background: `linear-gradient(135deg, ${theme.colors.success}30, ${theme.colors.success}20)`,
                                            margin: '0 auto 1rem',
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'center',
                                            color: theme.colors.success
                                        }}>
                                            <FaArrowDown size={24} />
                                        </div>
                                        <h3 style={{ color: theme.colors.primaryText, marginBottom: '0.75rem', fontWeight: '600' }}>
                                            No Tips Received Yet
                                        </h3>
                                        <p style={{ color: theme.colors.secondaryText, maxWidth: '400px', margin: '0 auto', lineHeight: '1.6' }}>
                                            Create great content in the forum to start receiving tips from other users!
                                        </p>
                                    </div>
                                ) : (
                                    tipsReceived.map((tip, index) => renderTipCardNew(tip, true, index))
                                )
                            ) : (
                                tipsGiven.length === 0 ? (
                                    <div className="tips-card-animate" style={{
                                        background: theme.colors.secondaryBg,
                                        borderRadius: '16px',
                                        padding: '3rem 2rem',
                                        textAlign: 'center',
                                        border: `1px solid ${theme.colors.border}`,
                                        opacity: 0,
                                        animationDelay: '0.1s'
                                    }}>
                                        <div className="tips-float" style={{
                                            width: '60px',
                                            height: '60px',
                                            borderRadius: '50%',
                                            background: `linear-gradient(135deg, ${tipsPrimary}30, ${tipsPrimary}20)`,
                                            margin: '0 auto 1rem',
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'center',
                                            color: tipsPrimary
                                        }}>
                                            <FaArrowUp size={24} />
                                        </div>
                                        <h3 style={{ color: theme.colors.primaryText, marginBottom: '0.75rem', fontWeight: '600' }}>
                                            No Tips Given Yet
                                        </h3>
                                        <p style={{ color: theme.colors.secondaryText, maxWidth: '400px', margin: '0 auto', lineHeight: '1.6' }}>
                                            Support other users by tipping their great posts in the forum!
                                        </p>
                                    </div>
                                ) : (
                                    tipsGiven.map((tip, index) => renderTipCardNew(tip, false, index))
                                )
                            )}
                        </div>
                    )}
                </div>
            </main>
        </div>
    );

    function renderTipCardNew(tip, isReceived, index) {
        const tokenId = tip.token_ledger_principal.toString();
        const otherPrincipal = isReceived ? tip.from_principal : tip.to_principal;
        const otherPrincipalStr = otherPrincipal.toString();
        const isLoadingToken = loadingMetadata.has(tokenId);
        const logo = getTokenLogo(tokenId);
        const isNew = isReceived && isTipNew(tip.created_at);

        return (
            <div 
                key={tip.id}
                className={`tips-card tips-card-animate ${isNew ? 'tips-new-glow' : ''}`}
                style={{
                    background: theme.colors.secondaryBg,
                    borderRadius: '14px',
                    padding: '1.25rem',
                    border: isNew 
                        ? `2px solid ${tipsPrimary}` 
                        : `1px solid ${theme.colors.border}`,
                    opacity: 0,
                    animationDelay: `${index * 0.05}s`,
                    display: 'flex',
                    alignItems: 'center',
                    gap: '1rem',
                    flexWrap: 'wrap'
                }}
            >
                {/* Token Logo & Amount */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', minWidth: '150px' }}>
                    {isLoadingToken ? (
                        <div style={{
                            width: '44px',
                            height: '44px',
                            borderRadius: '50%',
                            background: theme.colors.tertiaryBg,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center'
                        }}>
                            <span className="tips-pulse">⏳</span>
                        </div>
                    ) : logo ? (
                        <img 
                            src={logo} 
                            alt="" 
                            style={{ 
                                width: '44px', 
                                height: '44px', 
                                borderRadius: '50%',
                                border: `2px solid ${tipsPrimary}40`
                            }} 
                        />
                    ) : (
                        <div style={{
                            width: '44px',
                            height: '44px',
                            borderRadius: '50%',
                            background: `linear-gradient(135deg, ${tipsPrimary}, ${tipsSecondary})`,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            fontSize: '1.25rem'
                        }}>
                            💎
                        </div>
                    )}
                    <div>
                        <div style={{ 
                            color: tipsPrimary, 
                            fontWeight: '700', 
                            fontSize: '1.1rem' 
                        }}>
                            {isLoadingToken ? 'Loading...' : formatTokenAmount(tip.amount, tokenId)}
                        </div>
                        {isNew && (
                            <span style={{
                                background: `${tipsPrimary}20`,
                                color: tipsPrimary,
                                padding: '0.15rem 0.5rem',
                                borderRadius: '4px',
                                fontSize: '0.7rem',
                                fontWeight: '600',
                                textTransform: 'uppercase'
                            }}>
                                New
                            </span>
                        )}
                    </div>
                </div>

                {/* Principal */}
                <div style={{ flex: 1, minWidth: '180px' }}>
                    <div style={{ color: theme.colors.mutedText, fontSize: '0.75rem', marginBottom: '0.25rem' }}>
                        {isReceived ? 'From' : 'To'}
                    </div>
                    <PrincipalDisplay 
                        principal={otherPrincipalStr}
                        displayInfo={principalDisplayInfo.get(otherPrincipalStr)}
                        showCopyButton={true}
                        enableContextMenu={true}
                        short={true}
                        maxLength={20}
                        isAuthenticated={isAuthenticated}
                    />
                </div>

                {/* Post Links */}
                <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                    <button 
                        onClick={() => navigate(`/post?postid=${tip.post_id}`)}
                        style={{
                            background: `${theme.colors.accent}15`,
                            color: theme.colors.accent,
                            border: `1px solid ${theme.colors.accent}40`,
                            padding: '0.4rem 0.75rem',
                            borderRadius: '8px',
                            fontSize: '0.8rem',
                            fontWeight: '500',
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '0.35rem',
                            transition: 'all 0.2s ease'
                        }}
                        title="View post"
                    >
                        <FaComment size={10} />
                        Post #{tip.post_id?.toString() || 'N/A'}
                    </button>
                    {tip.thread_id && (
                        <button 
                            onClick={() => navigate(`/thread?threadid=${tip.thread_id}`)}
                            style={{
                                background: `${theme.colors.success}15`,
                                color: theme.colors.success,
                                border: `1px solid ${theme.colors.success}40`,
                                padding: '0.4rem 0.75rem',
                                borderRadius: '8px',
                                fontSize: '0.8rem',
                                fontWeight: '500',
                                cursor: 'pointer',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '0.35rem',
                                transition: 'all 0.2s ease'
                            }}
                            title="View thread"
                        >
                            <FaExternalLinkAlt size={10} />
                            Thread
                        </button>
                    )}
                </div>

                {/* Date */}
                <div 
                    style={{ 
                        color: theme.colors.mutedText, 
                        fontSize: '0.8rem',
                        minWidth: '80px',
                        textAlign: 'right'
                    }}
                    title={getFullDate(tip.created_at)}
                >
                    {getRelativeTime(tip.created_at)}
                </div>
            </div>
        );
    }
};

export default Tips;
