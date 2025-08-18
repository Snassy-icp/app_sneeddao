import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../AuthContext';
import { useNavigate } from 'react-router-dom';
import { useForum } from '../contexts/ForumContext';
import { useTokenMetadata } from '../hooks/useTokenMetadata';
import { useNaming } from '../NamingContext';
import { useTipNotifications } from '../hooks/useTipNotifications';
import { 
    getTipsReceivedByUser, 
    getTipsGivenByUser 
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
    const { markAsViewed, refreshNotifications } = useTipNotifications();
    
    const [tipsReceived, setTipsReceived] = useState([]);
    const [tipsGiven, setTipsGiven] = useState([]);
    const [activeTab, setActiveTab] = useState('received');
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [loadingMetadata, setLoadingMetadata] = useState(new Set());
    const [principalDisplayInfo, setPrincipalDisplayInfo] = useState(new Map());

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

            setTipsReceived(received);
            setTipsGiven(given);

            // Collect all unique principals and tokens for metadata fetching
            const allTips = [...received, ...given];
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

    // Mark tips as viewed when component mounts
    useEffect(() => {
        markAsViewed();
        fetchTipsData();
    }, [markAsViewed, fetchTipsData]);

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

        return (
            <tr key={tip.id} className="tip-row">
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
                            onClick={() => navigate(`/post/${tip.post_id}`)}
                            title="View this post"
                        >
                            📄 Post #{tip.post_id}
                        </button>
                        {tip.thread_id && (
                            <button 
                                className="thread-link"
                                onClick={() => navigate(`/thread/${tip.thread_id}`)}
                                title="View full thread"
                            >
                                🧵 Thread #{tip.thread_id}
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
                    <div className="tips-header">
                        <h1>💰 My Tips</h1>
                    </div>
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
            <div className="tips-container">
                <div className="tips-header">
                    <h1>💰 My Tips</h1>
                    <div className="tips-tabs">
                        <button 
                            className={`tab-button ${activeTab === 'received' ? 'active' : ''}`}
                            onClick={() => setActiveTab('received')}
                        >
                            📥 Tips Received ({tipsReceived.length})
                        </button>
                        <button 
                            className={`tab-button ${activeTab === 'given' ? 'active' : ''}`}
                            onClick={() => setActiveTab('given')}
                        >
                            📤 Tips Given ({tipsGiven.length})
                        </button>
                    </div>
                </div>

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
