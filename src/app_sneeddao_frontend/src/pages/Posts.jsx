import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../AuthContext';
import { useNavigate } from 'react-router-dom';
import { useForum } from '../contexts/ForumContext';
import { useTheme } from '../contexts/ThemeContext';
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
import { getRelativeTime, getFullDate } from '../utils/DateUtils';
import { formatPrincipal, getPrincipalDisplayInfoFromContext, PrincipalDisplay } from '../utils/PrincipalUtils';
import Header from '../components/Header';
import MarkdownBody from '../components/MarkdownBody';
import { FaComments, FaReply, FaEdit, FaList, FaSync, FaLock, FaArrowUp, FaArrowDown, FaExternalLinkAlt } from 'react-icons/fa';

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

@keyframes newReplyGlow {
    0%, 100% { box-shadow: 0 0 0 0 rgba(99, 102, 241, 0); }
    50% { box-shadow: 0 0 20px 5px rgba(99, 102, 241, 0.3); }
}

.posts-card-animate {
    animation: fadeInUp 0.5s ease-out forwards;
}

.posts-card {
    transition: all 0.3s ease;
}

.posts-card:hover {
    transform: translateY(-2px);
    box-shadow: 0 8px 30px rgba(99, 102, 241, 0.15);
}

.posts-float {
    animation: float 3s ease-in-out infinite;
}

.posts-pulse {
    animation: pulse 2s ease-in-out infinite;
}

.posts-new-glow {
    animation: newReplyGlow 2s ease-in-out 3;
}

.posts-tab {
    transition: all 0.2s ease;
}

.posts-tab:hover {
    transform: translateY(-1px);
}
`;

// Accent colors for this page
const postsPrimary = '#6366f1'; // Indigo
const postsSecondary = '#4f46e5'; // Darker indigo
const postsAccent = '#818cf8'; // Light indigo

const Posts = () => {
    const { theme } = useTheme();
    const navigate = useNavigate();
    const { isAuthenticated, identity } = useAuth();
    const { createForumActor } = useForum();
    const { principalNames, principalNicknames, fetchAllNames } = useNaming();
    
    const [myPosts, setMyPosts] = useState([]);
    const [repliesToMe, setRepliesToMe] = useState([]);
    const [myThreads, setMyThreads] = useState([]);
    const [threadPostCounts, setThreadPostCounts] = useState(new Map());
    const [activeTab, setActiveTab] = useState('replies-to-me');
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
                    setActiveTab('replies-to-me');
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
                style={{
                    backgroundColor: theme.colors.secondaryBg,
                    border: `1px solid ${theme.colors.border}`,
                    color: theme.colors.primaryText
                }}
            >
                <div className="post-header">
                    <div className="post-meta">
                        <a 
                            href={`/post?postid=${post.id}`}
                            className="post-id-link"
                            style={{
                                color: `${theme.colors.accent} !important`,
                                textDecoration: 'none',
                                fontWeight: '600',
                                fontSize: '0.9rem',
                                display: 'inline-block',
                                padding: '2px 4px',
                                borderRadius: '3px',
                                backgroundColor: `${theme.colors.accent}20`,
                                border: '1px solid rgba(60, 99, 130, 0.3)'
                            }}
                            onMouseEnter={(e) => {
                                e.target.style.textDecoration = 'underline';
                                e.target.style.backgroundColor = `${theme.colors.accent}30`;
                            }}
                            onMouseLeave={(e) => {
                                e.target.style.textDecoration = 'none';
                                e.target.style.backgroundColor = `${theme.colors.accent}20`;
                            }}
                            onClick={(e) => e.stopPropagation()} // Prevent triggering the parent onClick
                        >
                            #{Number(post.id)}
                        </a>
                        {isReply && (
                            <span className="reply-indicator" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                Reply from 
                                <div onClick={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()}>
                                    <PrincipalDisplay 
                                        principal={post.created_by.toString()}
                                        displayInfo={principalDisplayInfo.get(post.created_by.toString())}
                                        showCopyButton={true}
                                        short={true}
                                        enableContextMenu={true}
                                        maxLength={20}
                                        isAuthenticated={isAuthenticated}
                                    />
                                </div>
                            </span>
                        )}
                        {!isReply && post.title && post.title.length > 0 && (
                            <span className="post-title" style={{ color: theme.colors.primaryText }}>{post.title[0]}</span>
                        )}
                        <span className="post-date" style={{ color: theme.colors.secondaryText, cursor: 'default' }} title={getFullDate(post.created_at)}>{getRelativeTime(post.created_at)}</span>
                    </div>
                    <div className="post-scores">
                        <span className={`score ${isNegative ? 'negative' : 'positive'}`}>
                            {netScore >= 0 ? '+' : ''}{formatScore(netScore)}
                        </span>
                        <span className="vote-breakdown" style={{ color: theme.colors.secondaryText }}>
                            ↑{formatScore(post.upvote_score)} ↓{formatScore(post.downvote_score)}
                        </span>
                    </div>
                </div>
                <div className="post-body">
                    <MarkdownBody 
                        text={post.body} 
                        style={{ color: theme.colors.secondaryText }}
                    />
                </div>
                {post.reply_to_post_id && post.reply_to_post_id.length > 0 && (
                    <div className="reply-context" style={{ color: theme.colors.secondaryText }}>
                        <span>In reply to <a 
                            href={`/post?postid=${post.reply_to_post_id[0]}`}
                            style={{
                                color: theme.colors.accent,
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
                style={{
                    backgroundColor: theme.colors.secondaryBg,
                    border: `1px solid ${theme.colors.border}`,
                    color: theme.colors.primaryText
                }}
            >
                <div className="post-header">
                    <div className="post-meta">
                        <a 
                            href={`/thread?threadid=${thread.id}`}
                            className="post-id-link"
                            style={{
                                color: `${theme.colors.success} !important`,
                                textDecoration: 'none',
                                fontWeight: '600',
                                fontSize: '0.9rem',
                                display: 'inline-block',
                                padding: '2px 4px',
                                borderRadius: '3px',
                                backgroundColor: `${theme.colors.success}20`,
                                border: '1px solid rgba(39, 174, 96, 0.3)'
                            }}
                            onMouseEnter={(e) => {
                                e.target.style.textDecoration = 'underline';
                                e.target.style.backgroundColor = `${theme.colors.success}30`;
                            }}
                            onMouseLeave={(e) => {
                                e.target.style.textDecoration = 'none';
                                e.target.style.backgroundColor = `${theme.colors.success}20`;
                            }}
                            onClick={(e) => e.stopPropagation()}
                        >
                            Thread #{Number(thread.id)}
                        </a>
                        {thread.title && (
                            <span className="post-title" style={{ color: theme.colors.primaryText }}>{thread.title}</span>
                        )}
                        <span className="post-date" style={{ color: theme.colors.secondaryText, cursor: 'default' }} title={getFullDate(thread.created_at)}>{getRelativeTime(thread.created_at)}</span>
                    </div>
                    <div className="post-scores">
                        {postCount !== undefined ? (
                            <span className="post-count" style={{ 
                                color: theme.colors.mutedText, 
                                fontSize: '0.9rem',
                                fontWeight: '500'
                            }}>
                                {postCount} post{postCount !== 1 ? 's' : ''}
                            </span>
                        ) : (
                            <span className="post-count-loading" style={{ 
                                color: theme.colors.mutedText, 
                                fontSize: '0.8rem',
                                fontStyle: 'italic'
                            }}>
                                Loading...
                            </span>
                        )}
                    </div>
                </div>
                <div className="post-body">
                    <MarkdownBody 
                        text={thread.body} 
                        style={{ color: theme.colors.secondaryText }}
                    />
                </div>
            </div>
        );
    };

    if (!isAuthenticated) {
        return (
            <div className="page-container">
                <style>{customStyles}</style>
                <Header />
                <main style={{ background: theme.colors.primaryGradient, minHeight: '100vh' }}>
                    {/* Hero Section */}
                    <div style={{
                        background: `linear-gradient(135deg, ${theme.colors.primaryBg} 0%, ${postsPrimary}15 50%, ${postsSecondary}10 100%)`,
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
                            background: `radial-gradient(circle, ${postsPrimary}20 0%, transparent 70%)`,
                            borderRadius: '50%',
                            pointerEvents: 'none'
                        }} />
                        <div style={{ maxWidth: '900px', margin: '0 auto', position: 'relative', zIndex: 1 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '1.25rem' }}>
                                <div className="posts-float" style={{
                                    width: '64px',
                                    height: '64px',
                                    minWidth: '64px',
                                    borderRadius: '16px',
                                    background: `linear-gradient(135deg, ${postsPrimary}, ${postsSecondary})`,
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    boxShadow: `0 8px 30px ${postsPrimary}40`
                                }}>
                                    <FaComments size={28} color="white" />
                                </div>
                                <div>
                                    <h1 style={{ color: theme.colors.primaryText, fontSize: '2rem', fontWeight: '700', margin: 0 }}>
                                        My Posts
                                    </h1>
                                    <p style={{ color: theme.colors.secondaryText, fontSize: '1rem', margin: '0.35rem 0 0 0' }}>
                                        View your posts, replies, and threads
                                    </p>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Login Required */}
                    <div style={{ maxWidth: '900px', margin: '0 auto', padding: '2rem 1.5rem' }}>
                        <div className="posts-card-animate" style={{
                            background: theme.colors.secondaryBg,
                            borderRadius: '20px',
                            padding: '3rem 2rem',
                            textAlign: 'center',
                            border: `1px solid ${theme.colors.border}`,
                            opacity: 0,
                            animationDelay: '0.1s'
                        }}>
                            <div className="posts-float" style={{
                                width: '80px',
                                height: '80px',
                                margin: '0 auto 1.5rem',
                                borderRadius: '50%',
                                background: `linear-gradient(135deg, ${postsPrimary}, ${postsSecondary})`,
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                boxShadow: `0 8px 30px ${postsPrimary}40`
                            }}>
                                <FaLock size={32} color="white" />
                            </div>
                            <h2 style={{ color: theme.colors.primaryText, fontSize: '1.5rem', marginBottom: '1rem', fontWeight: '600' }}>
                                Connect to View Posts
                            </h2>
                            <p style={{ color: theme.colors.secondaryText, maxWidth: '400px', margin: '0 auto', lineHeight: '1.6' }}>
                                Connect your wallet to view your posts, replies to your content, and threads you've created.
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
            <Header />
            <main style={{ background: theme.colors.primaryGradient, minHeight: '100vh' }}>
                {/* Hero Section */}
                <div style={{
                    background: `linear-gradient(135deg, ${theme.colors.primaryBg} 0%, ${postsPrimary}15 50%, ${postsSecondary}10 100%)`,
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
                        background: `radial-gradient(circle, ${postsPrimary}20 0%, transparent 70%)`,
                        borderRadius: '50%',
                        pointerEvents: 'none'
                    }} />
                    <div style={{
                        position: 'absolute',
                        bottom: '-30%',
                        left: '-5%',
                        width: '300px',
                        height: '300px',
                        background: `radial-gradient(circle, ${postsSecondary}15 0%, transparent 70%)`,
                        borderRadius: '50%',
                        pointerEvents: 'none'
                    }} />
                    
                    <div style={{ maxWidth: '900px', margin: '0 auto', position: 'relative', zIndex: 1 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '1.25rem', marginBottom: '1rem' }}>
                            <div className="posts-float" style={{
                                width: '64px',
                                height: '64px',
                                minWidth: '64px',
                                maxWidth: '64px',
                                flexShrink: 0,
                                borderRadius: '16px',
                                background: `linear-gradient(135deg, ${postsPrimary}, ${postsSecondary})`,
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                boxShadow: `0 8px 30px ${postsPrimary}40`
                            }}>
                                <FaComments size={28} color="white" />
                            </div>
                            <div style={{ flex: 1, minWidth: 0 }}>
                                <h1 style={{ color: theme.colors.primaryText, fontSize: '2rem', fontWeight: '700', margin: 0, lineHeight: '1.2' }}>
                                    My Posts
                                </h1>
                                <p style={{ color: theme.colors.secondaryText, fontSize: '1rem', margin: '0.35rem 0 0 0' }}>
                                    View your posts, replies, and threads
                                </p>
                            </div>
                        </div>
                        
                        {/* Quick Stats */}
                        <div style={{ display: 'flex', gap: '1.5rem', flexWrap: 'wrap' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: theme.colors.secondaryText, fontSize: '0.9rem' }}>
                                <FaReply size={14} style={{ color: theme.colors.accent }} />
                                <span><strong style={{ color: theme.colors.accent }}>{repliesToMe.length}</strong> replies</span>
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: theme.colors.secondaryText, fontSize: '0.9rem' }}>
                                <FaEdit size={14} style={{ color: postsPrimary }} />
                                <span><strong style={{ color: postsPrimary }}>{myPosts.length}</strong> posts</span>
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: theme.colors.secondaryText, fontSize: '0.9rem' }}>
                                <FaList size={14} style={{ color: theme.colors.success }} />
                                <span><strong style={{ color: theme.colors.success }}>{myThreads.length}</strong> threads</span>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Main Content */}
                <div style={{ maxWidth: '900px', margin: '0 auto', padding: '2rem 1.5rem' }}>
                    {/* Tab Buttons */}
                    <div style={{
                        display: 'flex',
                        gap: '0.5rem',
                        marginBottom: '1.5rem',
                        background: theme.colors.secondaryBg,
                        padding: '0.5rem',
                        borderRadius: '14px',
                        border: `1px solid ${theme.colors.border}`,
                        flexWrap: 'wrap'
                    }}>
                        {[
                            { key: 'replies-to-me', label: 'Replies to Me', count: repliesToMe.length, icon: <FaReply size={14} />, color: theme.colors.accent },
                            { key: 'my-posts', label: 'My Posts', count: myPosts.length, icon: <FaEdit size={14} />, color: postsPrimary },
                            { key: 'my-threads', label: 'My Threads', count: myThreads.length, icon: <FaList size={14} />, color: theme.colors.success }
                        ].map(tab => (
                            <button
                                key={tab.key}
                                onClick={() => setActiveTab(tab.key)}
                                className="posts-tab"
                                style={{
                                    flex: '1 1 auto',
                                    minWidth: '120px',
                                    background: activeTab === tab.key 
                                        ? `linear-gradient(135deg, ${tab.color}, ${tab.color}cc)` 
                                        : 'transparent',
                                    color: activeTab === tab.key ? 'white' : theme.colors.secondaryText,
                                    border: 'none',
                                    borderRadius: '10px',
                                    padding: '0.65rem 0.75rem',
                                    cursor: 'pointer',
                                    fontSize: '0.9rem',
                                    fontWeight: '600',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    gap: '0.4rem',
                                    boxShadow: activeTab === tab.key ? `0 4px 15px ${tab.color}40` : 'none'
                                }}
                            >
                                {tab.icon}
                                <span style={{ display: window.innerWidth > 480 ? 'inline' : 'none' }}>{tab.label}</span>
                                <span style={{
                                    background: activeTab === tab.key ? 'rgba(255,255,255,0.2)' : `${tab.color}20`,
                                    color: activeTab === tab.key ? 'white' : tab.color,
                                    padding: '0.1rem 0.4rem',
                                    borderRadius: '6px',
                                    fontSize: '0.75rem',
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
                            onClick={fetchPostsData}
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
                            <div className="posts-pulse" style={{
                                width: '60px',
                                height: '60px',
                                borderRadius: '50%',
                                background: `linear-gradient(135deg, ${postsPrimary}, ${postsSecondary})`,
                                margin: '0 auto 1.5rem',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center'
                            }}>
                                <FaComments size={24} color="white" />
                            </div>
                            <p style={{ color: theme.colors.secondaryText, fontSize: '1.1rem' }}>
                                Loading your posts...
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
                            <p style={{ color: theme.colors.error, marginBottom: '1rem' }}>Error: {error}</p>
                            <button 
                                onClick={fetchPostsData}
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
                            {activeTab === 'replies-to-me' ? (
                                repliesToMe.length === 0 ? (
                                    renderEmptyState('replies')
                                ) : (
                                    repliesToMe.map((post, index) => renderPostCard(post, true, index))
                                )
                            ) : activeTab === 'my-posts' ? (
                                myPosts.length === 0 ? (
                                    renderEmptyState('posts')
                                ) : (
                                    myPosts.map((post, index) => renderPostCard(post, false, index))
                                )
                            ) : (
                                myThreads.length === 0 ? (
                                    renderEmptyState('threads')
                                ) : (
                                    myThreads.map((thread, index) => renderThreadCard(thread, index))
                                )
                            )}
                        </div>
                    )}
                </div>
            </main>
        </div>
    );

    function renderEmptyState(type) {
        const configs = {
            replies: {
                icon: <FaReply size={24} />,
                color: theme.colors.accent,
                title: 'No Replies Yet',
                message: 'No one has replied to your posts or threads yet. Keep participating in discussions!'
            },
            posts: {
                icon: <FaEdit size={24} />,
                color: postsPrimary,
                title: 'No Posts Yet',
                message: 'You haven\'t created any posts yet. Start participating in discussions!'
            },
            threads: {
                icon: <FaList size={24} />,
                color: theme.colors.success,
                title: 'No Threads Yet',
                message: 'You haven\'t created any threads yet. Start a new discussion!'
            }
        };
        const config = configs[type];

        return (
            <div className="posts-card-animate" style={{
                background: theme.colors.secondaryBg,
                borderRadius: '16px',
                padding: '3rem 2rem',
                textAlign: 'center',
                border: `1px solid ${theme.colors.border}`,
                opacity: 0,
                animationDelay: '0.1s'
            }}>
                <div className="posts-float" style={{
                    width: '60px',
                    height: '60px',
                    borderRadius: '50%',
                    background: `linear-gradient(135deg, ${config.color}30, ${config.color}20)`,
                    margin: '0 auto 1rem',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: config.color
                }}>
                    {config.icon}
                </div>
                <h3 style={{ color: theme.colors.primaryText, marginBottom: '0.75rem', fontWeight: '600' }}>
                    {config.title}
                </h3>
                <p style={{ color: theme.colors.secondaryText, maxWidth: '400px', margin: '0 auto', lineHeight: '1.6' }}>
                    {config.message}
                </p>
            </div>
        );
    }

    function renderPostCard(post, isReply, index) {
        const netScore = calculateNetScore(post);
        const isNegative = netScore < 0;
        const isNew = isReply && isReplyNew(post.created_at);

        return (
            <div 
                key={post.id}
                className={`posts-card posts-card-animate ${isNew ? 'posts-new-glow' : ''}`}
                onClick={() => navigateToPost(post)}
                style={{
                    background: theme.colors.secondaryBg,
                    borderRadius: '14px',
                    padding: '1.25rem',
                    border: isNew 
                        ? `2px solid ${theme.colors.accent}` 
                        : `1px solid ${theme.colors.border}`,
                    cursor: 'pointer',
                    opacity: 0,
                    animationDelay: `${index * 0.05}s`
                }}
            >
                {/* Header */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.75rem', flexWrap: 'wrap', gap: '0.5rem' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
                        <span 
                            onClick={(e) => { e.stopPropagation(); navigate(`/post?postid=${post.id}`); }}
                            style={{
                                color: theme.colors.accent,
                                fontWeight: '600',
                                fontSize: '0.9rem',
                                padding: '0.25rem 0.5rem',
                                borderRadius: '6px',
                                background: `${theme.colors.accent}15`,
                                cursor: 'pointer'
                            }}
                        >
                            #{Number(post.id)}
                        </span>
                        {isReply && (
                            <span style={{ color: theme.colors.mutedText, fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                Reply from
                                <span onClick={(e) => e.stopPropagation()}>
                                    <PrincipalDisplay 
                                        principal={post.created_by.toString()}
                                        displayInfo={principalDisplayInfo.get(post.created_by.toString())}
                                        showCopyButton={true}
                                        short={true}
                                        enableContextMenu={true}
                                        maxLength={16}
                                        isAuthenticated={isAuthenticated}
                                    />
                                </span>
                            </span>
                        )}
                        {!isReply && post.title && post.title.length > 0 && (
                            <span style={{ color: theme.colors.primaryText, fontWeight: '500' }}>{post.title[0]}</span>
                        )}
                        {isNew && (
                            <span style={{
                                background: `${theme.colors.accent}20`,
                                color: theme.colors.accent,
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
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                        <span style={{
                            color: isNegative ? theme.colors.error : theme.colors.success,
                            fontWeight: '600',
                            fontSize: '0.95rem'
                        }}>
                            {netScore >= 0 ? '+' : ''}{formatScore(netScore)}
                        </span>
                        <span style={{ color: theme.colors.mutedText, fontSize: '0.8rem' }}>
                            <FaArrowUp size={10} style={{ color: theme.colors.success }} /> {formatScore(post.upvote_score)}
                            {' '}
                            <FaArrowDown size={10} style={{ color: theme.colors.error }} /> {formatScore(post.downvote_score)}
                        </span>
                    </div>
                </div>

                {/* Body */}
                <div style={{ 
                    color: theme.colors.secondaryText, 
                    fontSize: '0.95rem', 
                    lineHeight: '1.6',
                    marginBottom: '0.75rem',
                    maxHeight: '120px',
                    overflow: 'hidden'
                }}>
                    <MarkdownBody text={post.body} />
                </div>

                {/* Footer */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem' }}>
                    {post.reply_to_post_id && post.reply_to_post_id.length > 0 && (
                        <span 
                            onClick={(e) => { e.stopPropagation(); navigate(`/post?postid=${post.reply_to_post_id[0]}`); }}
                            style={{ 
                                color: theme.colors.mutedText, 
                                fontSize: '0.8rem',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '0.35rem',
                                cursor: 'pointer'
                            }}
                        >
                            <FaExternalLinkAlt size={10} />
                            Reply to #{Number(post.reply_to_post_id[0])}
                        </span>
                    )}
                    <span 
                        style={{ color: theme.colors.mutedText, fontSize: '0.8rem', marginLeft: 'auto' }}
                        title={getFullDate(post.created_at)}
                    >
                        {getRelativeTime(post.created_at)}
                    </span>
                </div>
            </div>
        );
    }

    function renderThreadCard(thread, index) {
        const postCount = threadPostCounts.get(thread.id.toString());

        return (
            <div 
                key={thread.id}
                className="posts-card posts-card-animate"
                onClick={() => navigateToThread(thread)}
                style={{
                    background: theme.colors.secondaryBg,
                    borderRadius: '14px',
                    padding: '1.25rem',
                    border: `1px solid ${theme.colors.border}`,
                    cursor: 'pointer',
                    opacity: 0,
                    animationDelay: `${index * 0.05}s`
                }}
            >
                {/* Header */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.75rem', flexWrap: 'wrap', gap: '0.5rem' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
                        <span 
                            onClick={(e) => { e.stopPropagation(); navigate(`/thread?threadid=${thread.id}`); }}
                            style={{
                                color: theme.colors.success,
                                fontWeight: '600',
                                fontSize: '0.9rem',
                                padding: '0.25rem 0.5rem',
                                borderRadius: '6px',
                                background: `${theme.colors.success}15`,
                                cursor: 'pointer'
                            }}
                        >
                            Thread #{Number(thread.id)}
                        </span>
                        {thread.title && (
                            <span style={{ color: theme.colors.primaryText, fontWeight: '500' }}>{thread.title}</span>
                        )}
                    </div>
                    <span style={{ color: theme.colors.mutedText, fontSize: '0.85rem' }}>
                        {postCount !== undefined ? (
                            <>{postCount} post{postCount !== 1 ? 's' : ''}</>
                        ) : (
                            <span style={{ fontStyle: 'italic' }}>Loading...</span>
                        )}
                    </span>
                </div>

                {/* Body */}
                <div style={{ 
                    color: theme.colors.secondaryText, 
                    fontSize: '0.95rem', 
                    lineHeight: '1.6',
                    marginBottom: '0.75rem',
                    maxHeight: '120px',
                    overflow: 'hidden'
                }}>
                    <MarkdownBody text={thread.body} />
                </div>

                {/* Footer */}
                <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                    <span 
                        style={{ color: theme.colors.mutedText, fontSize: '0.8rem' }}
                        title={getFullDate(thread.created_at)}
                    >
                        {getRelativeTime(thread.created_at)}
                    </span>
                </div>
            </div>
        );
    }
};

export default Posts;
