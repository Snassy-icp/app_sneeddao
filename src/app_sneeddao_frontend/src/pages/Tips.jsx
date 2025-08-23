import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../AuthContext';
import { useNavigate } from 'react-router-dom';
import { useForum } from '../contexts/ForumContext';
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
import { formatPrincipal, getPrincipalDisplayInfoFromContext } from '../utils/PrincipalUtils';
import { Principal } from '@dfinity/principal';
import Header from '../components/Header';
import './Tips.css';

const Tips = () => {
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
                    {typeof formattedPrincipal === 'string' ? (
                        formattedPrincipal
                    ) : formattedPrincipal?.name || formattedPrincipal?.nickname ? (
                        <div className="principal-with-name">
                            <div className="principal-name">
                                {formattedPrincipal.name && (
                                    <span className="name">{formattedPrincipal.name}</span>
                                )}
                                {formattedPrincipal.nickname && (
                                    <span className="nickname">"{formattedPrincipal.nickname}"</span>
                                )}
                            </div>
                            <div className="principal-id">{formattedPrincipal.truncatedId}</div>
                        </div>
                    ) : (
                        otherPrincipalStr.slice(0, 12) + '...'
                    )}
                </td>
                <td className="tip-post">
                    <div className="post-links">
                        <button 
                            className="post-link"
                            onClick={() => navigate(`/post?postid=${tip.post_id}`)}
                            title="View this post"
                        >
                            📄 Post #{tip.post_id?.toString() || 'N/A'}
                        </button>
                        {tip.thread_id && (
                            <button 
                                className="thread-link"
                                onClick={() => navigate(`/thread?threadid=${tip.thread_id}`)}
                                title="View full thread"
                            >
                                🧵 Thread #{tip.thread_id?.toString() || 'N/A'}
                            </button>
                        )}
                    </div>
                </td>
                <td className="tip-date">
                    {formatDate(tip.created_at)}
                </td>
            </tr>
        );
    };

    if (!isAuthenticated) {
        return (
            <div className="tips-page">
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
        <div className="tips-page">
            <Header showSnsDropdown={false} />
            
            {/* Tips Submenu Row - styled like Header submenu */}
            <div style={{ 
                display: 'flex', 
                alignItems: 'center', 
                justifyContent: 'flex-start',
                width: '100%',
                padding: '10px 20px',
                backgroundColor: '#1a1a1a',
                borderBottom: '1px solid rgba(255,255,255,0.1)'
            }}>
                <div style={{ 
                    display: 'flex', 
                    gap: '20px', 
                    alignItems: 'center',
                    flexWrap: 'wrap',
                    rowGap: '10px'
                }}>
                    <span
                        onClick={() => setActiveTab('received')}
                        style={{
                            color: activeTab === 'received' ? '#3498db' : '#888',
                            textDecoration: 'none',
                            fontSize: '14px',
                            fontWeight: activeTab === 'received' ? 'bold' : 'normal',
                            position: 'relative',
                            paddingBottom: '4px',
                            cursor: 'pointer'
                        }}
                    >
                        📥 Tips Received ({tipsReceived.length})
                        {activeTab === 'received' && (
                            <div style={{
                                position: 'absolute',
                                bottom: 0,
                                left: 0,
                                width: '100%',
                                height: '2px',
                                background: '#3498db',
                                borderRadius: '2px'
                            }} />
                        )}
                    </span>
                    <span
                        onClick={() => setActiveTab('given')}
                        style={{
                            color: activeTab === 'given' ? '#3498db' : '#888',
                            textDecoration: 'none',
                            fontSize: '14px',
                            fontWeight: activeTab === 'given' ? 'bold' : 'normal',
                            position: 'relative',
                            paddingBottom: '4px',
                            cursor: 'pointer'
                        }}
                    >
                        📤 Tips Given ({tipsGiven.length})
                        {activeTab === 'given' && (
                            <div style={{
                                position: 'absolute',
                                bottom: 0,
                                left: 0,
                                width: '100%',
                                height: '2px',
                                background: '#3498db',
                                borderRadius: '2px'
                            }} />
                        )}
                    </span>
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
