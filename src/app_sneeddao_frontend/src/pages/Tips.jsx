import React, { useState, useEffect, useCallback } from 'react';
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
import './Tips.css';

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
            <div className="tips-page" style={{ background: theme.colors.primaryGradient, minHeight: '100vh' }}>
                <Header showSnsDropdown={false} />
                <div className="tips-container">
                    <div className="tips-content">
                        <div className="auth-required">
                            <p>Please log in to view your tips.</p>
                        </div>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="tips-page" style={{ background: theme.colors.primaryGradient, minHeight: '100vh' }}>
            <Header showSnsDropdown={false} />
            
            {/* Tips Tabs - SMS style */}
            <div style={{ 
                padding: '20px 20px 0 20px'
            }}>
                <div style={{ 
                    display: 'flex', 
                    gap: '10px', 
                    marginBottom: '20px',
                    borderBottom: '1px solid #3a3a3a',
                    paddingBottom: '0'
                }}>
                    {[
                        { key: 'received', label: '📥 Tips Received', count: tipsReceived.length },
                        { key: 'given', label: '📤 Tips Given', count: tipsGiven.length }
                    ].map(tab => (
                        <button
                            key={tab.key}
                            onClick={() => setActiveTab(tab.key)}
                            style={{
                                background: activeTab === tab.key ? '#3498db' : 'transparent',
                                color: activeTab === tab.key ? '#ffffff' : '#888',
                                border: 'none',
                                borderRadius: '4px 4px 0 0',
                                padding: '12px 20px',
                                cursor: 'pointer',
                                fontSize: '16px',
                                borderBottom: activeTab === tab.key ? '2px solid #3498db' : '2px solid transparent'
                            }}
                        >
                            {tab.label} ({tab.count})
                        </button>
                    ))}
                </div>
            </div>

            <div className="tips-container">

                <div className="tips-content">
                    {loading ? (
                        <div className="loading-state">
                            <div className="spinner"></div>
                            <p>Loading your tips...</p>
                        </div>
                    ) : error ? (
                        <div className="error-state">
                            <p>Error loading tips: {error}</p>
                            <button onClick={fetchTipsData} className="retry-button">
                                Try Again
                            </button>
                        </div>
                    ) : (
                        <div className="tips-list">
                            {activeTab === 'received' ? (
                                tipsReceived.length === 0 ? (
                                    <div className="empty-state">
                                        <p>🎁 You haven't received any tips yet.</p>
                                        <p>Create great content in the forum to start receiving tips!</p>
                                    </div>
                                ) : isNarrowScreen ? (
                                    <div className="tips-cards-container">
                                        {tipsReceived.map(tip => renderTipCard(tip, true))}
                                    </div>
                                ) : (
                                    <div className="tips-table-container">
                                        <table className="tips-table">
                                            <thead>
                                                <tr>
                                                    <th>Amount</th>
                                                    <th>From</th>
                                                    <th>Post</th>
                                                    <th>Date</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {tipsReceived.map(tip => renderTipRow(tip, true))}
                                            </tbody>
                                        </table>
                                    </div>
                                )
                            ) : (
                                tipsGiven.length === 0 ? (
                                    <div className="empty-state">
                                        <p>💸 You haven't given any tips yet.</p>
                                        <p>Support other users by tipping their great posts!</p>
                                    </div>
                                ) : isNarrowScreen ? (
                                    <div className="tips-cards-container">
                                        {tipsGiven.map(tip => renderTipCard(tip, false))}
                                    </div>
                                ) : (
                                    <div className="tips-table-container">
                                        <table className="tips-table">
                                            <thead>
                                                <tr>
                                                    <th>Amount</th>
                                                    <th>To</th>
                                                    <th>Post</th>
                                                    <th>Date</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {tipsGiven.map(tip => renderTipRow(tip, false))}
                                            </tbody>
                                        </table>
                                    </div>
                                )
                            )}
                        </div>
                    )}
                </div>

                <div className="tips-actions">
                    <button 
                        onClick={() => {
                            refreshNotifications();
                            fetchTipsData();
                        }}
                        className="refresh-button"
                        disabled={loading}
                    >
                        🔄 Refresh
                    </button>
                </div>
            </div>
        </div>
    );
};

export default Tips;
