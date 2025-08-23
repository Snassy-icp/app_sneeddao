import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../AuthContext';
import { useNavigate } from 'react-router-dom';
import { useForum } from '../contexts/ForumContext';
import { useNaming } from '../NamingContext';
import { 
    getPostsByUser, 
    getRepliesToUser,
    getThreadsByUser,
    getPostsByThread,
    getRecentRepliesCount,
    markRepliesSeenUpTo,
    getLastSeenRepliesTimestamp
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
    const [myThreads, setMyThreads] = useState([]);
    const [threadPostCounts, setThreadPostCounts] = useState(new Map());
    const [activeTab, setActiveTab] = useState('my-posts');
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [principalDisplayInfo, setPrincipalDisplayInfo] = useState(new Map());
    
    // Reply highlighting state (using single-execution pattern like Tips)
    const [capturedOldRepliesTimestamp, setCapturedOldRepliesTimestamp] = useState(0);
    const [repliesTimestampProcessed, setRepliesTimestampProcessed] = useState(false);

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

                        // Fetch posts, replies, and threads
            const [myPostsData, repliesToMeData, myThreadsData] = await Promise.all([
                getPostsByUser(forumActor, userPrincipal),
                getRepliesToUser(forumActor, userPrincipal),
                getThreadsByUser(forumActor, userPrincipal)
            ]);
            
            console.log('My posts data:', myPostsData);
            console.log('Replies to me data:', repliesToMeData);
            console.log('My threads data:', myThreadsData);
            
            setMyPosts(myPostsData || []);
            setRepliesToMe(repliesToMeData || []);
            setMyThreads(myThreadsData || []);

        } catch (err) {
            console.error('Error fetching posts data:', err);
            setError(err.message || 'Failed to load posts');
        } finally {
            setLoading(false);
        }
    }, [isAuthenticated, identity, createForumActor]);

    // Fetch post counts for threads asynchronously (non-blocking)
    const fetchThreadPostCounts = useCallback(async (threads) => {
        if (!createForumActor || !identity || !threads.length) return;
        
        try {
            const forumActor = createForumActor(identity);
            
            // Fetch post counts for each thread in parallel
            const countPromises = threads.map(async (thread) => {
                try {
                    const posts = await getPostsByThread(forumActor, thread.id);
                    return { threadId: thread.id, count: posts.length };
                } catch (err) {
                    console.error(`Error fetching posts for thread ${thread.id}:`, err);
                    return { threadId: thread.id, count: 0 };
                }
            });
            
            const results = await Promise.all(countPromises);
            
            // Update the post counts map
            const newCounts = new Map();
            results.forEach(({ threadId, count }) => {
                newCounts.set(threadId.toString(), count);
            });
            
            setThreadPostCounts(newCounts);
            
        } catch (err) {
            console.error('Error fetching thread post counts:', err);
        }
    }, [createForumActor, identity]);

    // Fetch post counts when threads are loaded
    useEffect(() => {
        if (myThreads.length > 0) {
            fetchThreadPostCounts(myThreads);
        }
    }, [myThreads, fetchThreadPostCounts]);

    // ONE-TIME replies timestamp processing - executes ONCE per page load
    useEffect(() => {
        const processRepliesTimestamp = async () => {
            if (!isAuthenticated || !identity || repliesTimestampProcessed) {
                return;
            }

            try {
                const forumActor = createForumActor(identity);
                const userPrincipal = identity.getPrincipal();

                // Step 1: Get old timestamp ONCE
                const oldTimestampResult = await getLastSeenRepliesTimestamp(forumActor, userPrincipal);
                const currentOldTimestamp = oldTimestampResult || 0;
                setCapturedOldRepliesTimestamp(currentOldTimestamp);
                
                console.log(`🔥 REPLIES: CAPTURED OLD TIMESTAMP: ${currentOldTimestamp}`);

                // Step 2: Check if we have new replies
                const newRepliesCount = await getRecentRepliesCount(forumActor, userPrincipal);
                console.log(`🔥 REPLIES: NEW REPLIES COUNT: ${newRepliesCount}`);

                // Step 3: Update backend timestamp ONCE if we have new replies
                if (Number(newRepliesCount) > 0) {
                    const currentTimestamp = Date.now() * 1_000_000;
                    await markRepliesSeenUpTo(forumActor, currentTimestamp);
                    console.log(`🔥 REPLIES: UPDATED BACKEND TIMESTAMP ONCE: ${currentTimestamp}`);
                    
                    // Step 4: Default to replies tab if new replies > 0
                    setActiveTab('replies');
                    console.log(`🔥 REPLIES: DEFAULTED TO REPLIES TAB (${newRepliesCount} new replies)`);
                } else {
                    console.log('🔥 REPLIES: NO NEW REPLIES - NO BACKEND UPDATE');
                }

                // Mark as processed to prevent re-execution
                setRepliesTimestampProcessed(true);
                console.log('🔥 REPLIES: TIMESTAMP PROCESSING COMPLETE - WILL NOT RUN AGAIN');

            } catch (error) {
                console.error('Error in replies timestamp processing:', error);
                setRepliesTimestampProcessed(true); // Prevent infinite retries
            }
        };

        processRepliesTimestamp();
    }, [isAuthenticated, identity, createForumActor, repliesTimestampProcessed]);

    // Separate effect for data fetching (can run multiple times)
    useEffect(() => {
        if (repliesTimestampProcessed) {
            // Only fetch data after timestamp processing is complete
            fetchPostsData();
        }
    }, [repliesTimestampProcessed, fetchPostsData]);

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

    // Helper function to check if a reply is new (for highlighting)
    const isReplyNew = (replyTimestamp) => {
        const isNew = Number(replyTimestamp) > capturedOldRepliesTimestamp;
        console.log(`🔥 REPLY NEW CHECK: replyTimestamp=${replyTimestamp}, capturedOldRepliesTimestamp=${capturedOldRepliesTimestamp}, isNew=${isNew}`);
        return isNew;
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

    const navigateToThread = (thread) => {
        // Navigate to the thread
        navigate(`/thread?threadid=${thread.id}`);
    };

    const renderPost = (post, isReply = false) => {
        console.log('Rendering post:', { id: post.id, type: typeof post.id, reply_to: post.reply_to_post_id });
        const netScore = calculateNetScore(post);
        const isNegative = netScore < 0;
        
        // Check if this reply is new (only highlight replies, not my posts)
        const isNew = isReply && isReplyNew(post.created_at);
        
        return (
            <div 
                key={post.id} 
                className={`post-item ${isNegative ? 'negative-score' : ''} ${isNew ? 'reply-new' : ''}`}
                onClick={() => navigateToPost(post)}
            >
                <div className="post-header">
                    <div className="post-meta">
                        <a 
                            href={`/post?postid=${post.id}`}
                            className="post-id-link"
                            style={{
                                color: '#3c6382 !important',
                                textDecoration: 'none',
                                fontWeight: '600',
                                fontSize: '0.9rem',
                                display: 'inline-block',
                                padding: '2px 4px',
                                borderRadius: '3px',
                                backgroundColor: 'rgba(60, 99, 130, 0.1)',
                                border: '1px solid rgba(60, 99, 130, 0.3)'
                            }}
                            onMouseEnter={(e) => {
                                e.target.style.textDecoration = 'underline';
                                e.target.style.backgroundColor = 'rgba(60, 99, 130, 0.2)';
                            }}
                            onMouseLeave={(e) => {
                                e.target.style.textDecoration = 'none';
                                e.target.style.backgroundColor = 'rgba(60, 99, 130, 0.1)';
                            }}
                            onClick={(e) => e.stopPropagation()} // Prevent triggering the parent onClick
                        >
                            #{Number(post.id)}
                        </a>
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
                {post.reply_to_post_id && post.reply_to_post_id.length > 0 && (
                    <div className="reply-context">
                        <span>In reply to <a 
                            href={`/post?postid=${post.reply_to_post_id[0]}`}
                            style={{
                                color: '#3c6382',
                                textDecoration: 'none',
                                fontWeight: '500'
                            }}
                            onMouseEnter={(e) => e.target.style.textDecoration = 'underline'}
                            onMouseLeave={(e) => e.target.style.textDecoration = 'none'}
                            onClick={(e) => e.stopPropagation()} // Prevent triggering the parent onClick
                        >
                            post #{Number(post.reply_to_post_id[0])}
                        </a></span>
                    </div>
                )}
            </div>
        );
    };

    const renderThread = (thread) => {
        console.log('Rendering thread:', { id: thread.id, title: thread.title });
        const postCount = threadPostCounts.get(thread.id.toString());
        
        return (
            <div 
                key={thread.id} 
                className="post-item thread-item"
                onClick={() => navigateToThread(thread)}
            >
                <div className="post-header">
                    <div className="post-meta">
                        <a 
                            href={`/thread?threadid=${thread.id}`}
                            className="post-id-link"
                            style={{
                                color: '#27ae60 !important',
                                textDecoration: 'none',
                                fontWeight: '600',
                                fontSize: '0.9rem',
                                display: 'inline-block',
                                padding: '2px 4px',
                                borderRadius: '3px',
                                backgroundColor: 'rgba(39, 174, 96, 0.1)',
                                border: '1px solid rgba(39, 174, 96, 0.3)'
                            }}
                            onMouseEnter={(e) => {
                                e.target.style.textDecoration = 'underline';
                                e.target.style.backgroundColor = 'rgba(39, 174, 96, 0.2)';
                            }}
                            onMouseLeave={(e) => {
                                e.target.style.textDecoration = 'none';
                                e.target.style.backgroundColor = 'rgba(39, 174, 96, 0.1)';
                            }}
                            onClick={(e) => e.stopPropagation()}
                        >
                            Thread #{Number(thread.id)}
                        </a>
                        {thread.title && (
                            <span className="post-title">{thread.title}</span>
                        )}
                        <span className="post-date">{formatDate(thread.created_at)}</span>
                    </div>
                    <div className="post-scores">
                        {postCount !== undefined ? (
                            <span className="post-count" style={{ 
                                color: '#888', 
                                fontSize: '0.9rem',
                                fontWeight: '500'
                            }}>
                                {postCount} post{postCount !== 1 ? 's' : ''}
                            </span>
                        ) : (
                            <span className="post-count-loading" style={{ 
                                color: '#666', 
                                fontSize: '0.8rem',
                                fontStyle: 'italic'
                            }}>
                                Loading...
                            </span>
                        )}
                    </div>
                </div>
                <div className="post-body">
                    <p>{thread.body}</p>
                </div>
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
                        className={`tab ${activeTab === 'my-threads' ? 'active' : ''}`}
                        onClick={() => setActiveTab('my-threads')}
                    >
                        My Threads ({myThreads.length})
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
                            ) : activeTab === 'my-threads' ? (
                                myThreads.length === 0 ? (
                                    <div className="empty-state">
                                        <h3>No Threads Yet</h3>
                                        <p>You haven't created any threads yet. Start new discussions to see your threads here!</p>
                                    </div>
                                ) : (
                                    myThreads.map(thread => renderThread(thread))
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
