import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../AuthContext';
import { useNavigate } from 'react-router-dom';
import { useForum } from '../contexts/ForumContext';
import { useNaming } from '../NamingContext';
import { 
    getPostsByUser, 
    getRepliesToUser 
} from '../utils/BackendUtils';
import { formatPrincipal, getPrincipalDisplayInfoFromContext } from '../utils/PrincipalUtils';
import Header from '../components/Header';
import './Posts.css';

const Posts = () => {
    const navigate = useNavigate();
    const { isAuthenticated, identity } = useAuth();
    const { createForumActor } = useForum();
    const { principalNames, principalNicknames, fetchAllNames } = useNaming();
    
    const [myPosts, setMyPosts] = useState([]);
    const [repliesToMe, setRepliesToMe] = useState([]);
    const [activeTab, setActiveTab] = useState('my-posts');
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [principalDisplayInfo, setPrincipalDisplayInfo] = useState(new Map());

    // Fetch posts data
    const fetchPostsData = useCallback(async () => {
        if (!isAuthenticated || !identity) {
            setLoading(false);
            return;
        }

        try {
            setLoading(true);
            setError(null);

            const forumActor = createForumActor(identity);
            const userPrincipal = identity.getPrincipal();

            // Fetch both my posts and replies to me
            const [myPostsData, repliesToMeData] = await Promise.all([
                getPostsByUser(forumActor, userPrincipal),
                getRepliesToUser(forumActor, userPrincipal)
            ]);

            console.log('My posts data:', myPostsData);
            console.log('Replies to me data:', repliesToMeData);

            setMyPosts(myPostsData || []);
            setRepliesToMe(repliesToMeData || []);

        } catch (err) {
            console.error('Error fetching posts data:', err);
            setError(err.message || 'Failed to load posts');
        } finally {
            setLoading(false);
        }
    }, [isAuthenticated, identity, createForumActor]);

    useEffect(() => {
        if (isAuthenticated) {
            fetchPostsData();
        } else {
            navigate('/');
        }
    }, [isAuthenticated, fetchPostsData, navigate]);

    // Separate effect to update principal display info when naming context changes
    useEffect(() => {
        if (!myPosts.length && !repliesToMe.length) return;

        // Collect all unique principals from posts for display info
        const allPrincipals = new Set();
        
        // Add principals from my posts
        myPosts.forEach(post => {
            if (post.created_by) {
                allPrincipals.add(post.created_by.toString());
            }
        });

        // Add principals from replies to me
        repliesToMe.forEach(post => {
            if (post.created_by) {
                allPrincipals.add(post.created_by.toString());
            }
        });

        // Build display info map
        const displayInfo = new Map();
        Array.from(allPrincipals).forEach(principalStr => {
            const info = getPrincipalDisplayInfoFromContext(
                principalStr, 
                principalNames, 
                principalNicknames
            );
            displayInfo.set(principalStr, info);
        });
        
        setPrincipalDisplayInfo(displayInfo);
    }, [myPosts, repliesToMe, principalNames, principalNicknames]);

    const formatDate = (timestamp) => {
        try {
            const date = new Date(Number(timestamp) / 1000000);
            return date.toLocaleDateString('en-US', {
                year: 'numeric',
                month: 'short',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit'
            });
        } catch (error) {
            return 'Invalid date';
        }
    };

    const formatScore = (score) => {
        // Handle BigInt values by converting to Number first
        const numericScore = typeof score === 'bigint' ? Number(score) : score;
        // Convert from e8s (divide by 10^8)
        const scoreInTokens = numericScore / 100000000;
        
        // Format with commas and only necessary decimal places
        if (scoreInTokens === 0) {
            return '0';
        } else if (Math.abs(scoreInTokens) >= 1) {
            // For values >= 1, show up to 2 decimal places, removing trailing zeros
            return scoreInTokens.toLocaleString('en-US', {
                minimumFractionDigits: 0,
                maximumFractionDigits: 2
            });
        } else {
            // For values < 1, show up to 8 decimal places, removing trailing zeros
            return scoreInTokens.toLocaleString('en-US', {
                minimumFractionDigits: 0,
                maximumFractionDigits: 8
            });
        }
    };

    const calculateNetScore = (post) => {
        // Handle BigInt values by converting to Number
        const upvotes = typeof post.upvote_score === 'bigint' 
            ? Number(post.upvote_score) 
            : (Number(post.upvote_score) || 0);
        const downvotes = typeof post.downvote_score === 'bigint'
            ? Number(post.downvote_score)
            : (Number(post.downvote_score) || 0);
        return upvotes - downvotes;
    };

    const getPrincipalDisplay = (principal) => {
        const principalStr = principal.toString();
        const displayInfo = principalDisplayInfo.get(principalStr);
        
        if (displayInfo?.nickname) {
            return displayInfo.nickname;
        } else if (displayInfo?.name) {
            return displayInfo.name;
        } else {
            return formatPrincipal(principalStr);
        }
    };

    const navigateToPost = (post) => {
        // Navigate to the post in context
        navigate(`/post?postid=${post.id}`);
    };

    const renderPost = (post, isReply = false) => {
        const netScore = calculateNetScore(post);
        const isNegative = netScore < 0;
        
        return (
            <div 
                key={post.id} 
                className={`post-item ${isNegative ? 'negative-score' : ''}`}
                onClick={() => navigateToPost(post)}
            >
                <div className="post-header">
                    <div className="post-meta">
                        <span className="post-id">#{post.id}</span>
                        {isReply && (
                            <span className="reply-indicator">Reply from {getPrincipalDisplay(post.created_by)}</span>
                        )}
                        {!isReply && post.title && post.title.length > 0 && (
                            <span className="post-title">{post.title[0]}</span>
                        )}
                        <span className="post-date">{formatDate(post.created_at)}</span>
                    </div>
                    <div className="post-scores">
                        <span className={`score ${isNegative ? 'negative' : 'positive'}`}>
                            {netScore >= 0 ? '+' : ''}{formatScore(netScore)}
                        </span>
                        <span className="vote-breakdown">
                            ↑{formatScore(post.upvote_score)} ↓{formatScore(post.downvote_score)}
                        </span>
                    </div>
                </div>
                <div className="post-body">
                    <p>{post.body}</p>
                </div>
                {post.reply_to_post_id && (
                    <div className="reply-context">
                        <span>In reply to post #{post.reply_to_post_id}</span>
                    </div>
                )}
            </div>
        );
    };

    if (!isAuthenticated) {
        return (
            <div className="posts-page">
                <Header />
                <div className="posts-container">
                    <div className="auth-required">
                        <h2>Authentication Required</h2>
                        <p>Please connect your wallet to view your posts.</p>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="posts-page">
            <Header />
            <div className="posts-container">
                <div className="posts-header">
                    <h1>My Posts</h1>
                    <p>View your posts and replies to your content</p>
                </div>

                <div className="posts-tabs">
                    <button
                        className={`tab ${activeTab === 'my-posts' ? 'active' : ''}`}
                        onClick={() => setActiveTab('my-posts')}
                    >
                        My Posts ({myPosts.length})
                    </button>
                    <button
                        className={`tab ${activeTab === 'replies-to-me' ? 'active' : ''}`}
                        onClick={() => setActiveTab('replies-to-me')}
                    >
                        Replies to Me ({repliesToMe.length})
                    </button>
                </div>

                <div className="posts-content">
                    {loading ? (
                        <div className="loading-state">
                            <div className="spinner"></div>
                            <p>Loading posts...</p>
                        </div>
                    ) : error ? (
                        <div className="error-state">
                            <h3>Error Loading Posts</h3>
                            <p>{error}</p>
                            <button onClick={fetchPostsData} className="retry-button">
                                Try Again
                            </button>
                        </div>
                    ) : (
                        <div className="posts-list">
                            {activeTab === 'my-posts' ? (
                                myPosts.length === 0 ? (
                                    <div className="empty-state">
                                        <h3>No Posts Yet</h3>
                                        <p>You haven't created any posts yet. Start participating in discussions to see your posts here!</p>
                                    </div>
                                ) : (
                                    myPosts.map(post => renderPost(post, false))
                                )
                            ) : (
                                repliesToMe.length === 0 ? (
                                    <div className="empty-state">
                                        <h3>No Replies Yet</h3>
                                        <p>No one has replied to your posts yet. Keep participating in discussions!</p>
                                    </div>
                                ) : (
                                    repliesToMe.map(post => renderPost(post, true))
                                )
                            )}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default Posts;
