import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '../AuthContext';
import { useNaming } from '../NamingContext';
import { useNeurons } from '../contexts/NeuronsContext';
import { useAdminCheck } from '../hooks/useAdminCheck';
import { useTextLimits } from '../hooks/useTextLimits';
import { useTokens } from '../hooks/useTokens';
import { useTokenMetadata } from '../hooks/useTokenMetadata';
import { formatPrincipal, getPrincipalDisplayInfoFromContext } from '../utils/PrincipalUtils';
import { Principal } from '@dfinity/principal';
import { 
    getTipsByPost, 
    createTip, 
    createLedgerActor 
} from '../utils/BackendUtils';
import TipModal from './TipModal';
import TipDisplay from './TipDisplay';
import './ThreadViewer.css';

/**
 * Reusable ThreadViewer component that can display:
 * - Full thread discussions (mode: 'thread')
 * - Focused post view with ancestors/descendants (mode: 'post', focusedPostId)
 * - Filtered thread view (custom threadId, postFilter function)
 */
function ThreadViewer({ 
    forumActor,
    mode = 'thread', // 'thread' | 'post'
    threadId = null, // Direct thread ID (bypasses proposal lookup)
    focusedPostId = null, // For post mode - which post to focus on
    postFilter = null, // Optional function to filter posts
    selectedSnsRoot,
    isAuthenticated,
    onError,
    showCreatePost = true, // Whether to show create post form
    title = null // Optional title override
}) {
    const { principalNames, principalNicknames } = useNaming();
    const { identity } = useAuth();
    const { getHotkeyNeurons, getAllNeurons, loading: neuronsLoading, neuronsData } = useNeurons();
    
    // Text limits hook
    const { textLimits, loading: textLimitsLoading } = useTextLimits(forumActor);
    
    // Admin check
    const { isAdmin } = useAdminCheck({
        identity,
        isAuthenticated,
        redirectPath: null // Don't redirect, just check status
    });

    // Tokens hook for tipping
    const { tokens: availableTokens, loading: tokensLoading, refreshTokenBalance } = useTokens(identity);
    
    // State for discussion
    const [threadDetails, setThreadDetails] = useState(null);
    const [discussionPosts, setDiscussionPosts] = useState([]);
    const [loadingDiscussion, setLoadingDiscussion] = useState(false);
    const [commentText, setCommentText] = useState('');
    const [showCommentForm, setShowCommentForm] = useState(false);
    const [submittingComment, setSubmittingComment] = useState(false);
    const [commentTitle, setCommentTitle] = useState('');
    const [principalDisplayInfo, setPrincipalDisplayInfo] = useState(new Map());
    
    // State for editing posts
    const [editingPost, setEditingPost] = useState(null);
    const [submittingEdit, setSubmittingEdit] = useState(false);
    
    // State for view mode and interactions
    const [viewMode, setViewMode] = useState(() => {
        try {
            return localStorage.getItem('discussionViewMode') || 'tree';
        } catch (error) {
            console.warn('Could not access localStorage:', error);
            return 'tree';
        }
    });
    const [collapsedPosts, setCollapsedPosts] = useState(new Set());
    const [replyingTo, setReplyingTo] = useState(null);
    const [votingStates, setVotingStates] = useState(new Map());
    const [userVotes, setUserVotes] = useState(new Map());

    // Tipping state
    const [tipModalOpen, setTipModalOpen] = useState(false);
    const [selectedPostForTip, setSelectedPostForTip] = useState(null);
    const [tippingState, setTippingState] = useState('idle'); // 'idle', 'transferring', 'registering', 'success', 'error'
    const [postTips, setPostTips] = useState({});

    // Fetch thread details and posts
    const fetchThreadData = useCallback(async () => {
        if (!forumActor || !threadId) return;
        
        setLoadingDiscussion(true);
        try {
            console.log('Fetching thread data for thread ID:', threadId);
            
            // Fetch thread details
            const threadDetails = await forumActor.get_thread(Number(threadId));
            console.log('Thread details result:', threadDetails);
            if (threadDetails && threadDetails.length > 0) {
                setThreadDetails(threadDetails[0]);
            } else {
                setThreadDetails(null);
            }
            
            // Fetch posts
            const posts = await forumActor.get_posts_by_thread(Number(threadId));
            console.log('Posts result:', posts);
            
            let processedPosts = posts || [];
            
            // Apply post filter if provided
            if (postFilter) {
                processedPosts = processedPosts.filter(postFilter);
            }
            
            setDiscussionPosts(processedPosts);
            
            // Fetch tips for all posts
            await fetchTipsForPosts(processedPosts);
            
        } catch (err) {
            console.error('Error fetching thread data:', err);
            setThreadDetails(null);
            setDiscussionPosts([]);
            if (onError) onError(err);
        } finally {
            setLoadingDiscussion(false);
        }
    }, [forumActor, threadId, postFilter, onError]);

    // Fetch tips for posts
    const fetchTipsForPosts = async (posts) => {
        if (!forumActor || !posts || posts.length === 0) return;
        
        try {
            const tipPromises = posts.map(async (post) => {
                try {
                    const tips = await getTipsByPost(forumActor, Number(post.id));
                    return { postId: Number(post.id), tips };
                } catch (error) {
                    console.error(`Error fetching tips for post ${post.id}:`, error);
                    return { postId: Number(post.id), tips: [] };
                }
            });
            
            const tipResults = await Promise.all(tipPromises);
            const newPostTips = {};
            tipResults.forEach(({ postId, tips }) => {
                newPostTips[postId] = tips;
            });
            
            setPostTips(newPostTips);
        } catch (error) {
            console.error('Error fetching tips for posts:', error);
        }
    };

    // Effect to fetch data when threadId changes
    useEffect(() => {
        if (threadId) {
            fetchThreadData();
        }
    }, [fetchThreadData, threadId]);

    // Build hierarchical tree structure for posts
    const buildPostTree = useCallback((posts) => {
        if (!posts || posts.length === 0) return [];
        
        const postMap = new Map();
        posts.forEach(post => postMap.set(Number(post.id), { ...post, replies: [] }));
        
        const rootPosts = [];
        posts.forEach(post => {
            const postId = Number(post.id);
            const postWithReplies = postMap.get(postId);
            
            if (post.reply_to_post_id && post.reply_to_post_id.length > 0) {
                const parentId = Number(post.reply_to_post_id[0]);
                const parent = postMap.get(parentId);
                if (parent) {
                    parent.replies.push(postWithReplies);
                } else {
                    rootPosts.push(postWithReplies);
                }
            } else {
                rootPosts.push(postWithReplies);
            }
        });
        
        // Sort root posts by creation time
        rootPosts.sort((a, b) => Number(a.created_at) - Number(b.created_at));
        
        // Sort replies recursively
        const sortReplies = (post) => {
            if (post.replies && post.replies.length > 0) {
                post.replies.sort((a, b) => Number(a.created_at) - Number(b.created_at));
                post.replies.forEach(sortReplies);
            }
        };
        rootPosts.forEach(sortReplies);
        
        return rootPosts;
    }, []);

    // Get posts for display based on mode
    const getDisplayPosts = useCallback(() => {
        if (mode === 'post' && focusedPostId) {
            // For post mode, we want to show:
            // 1. All ancestors of the focused post
            // 2. The focused post itself
            // 3. All descendants of the focused post
            // 4. Collapse other branches initially
            
            const focusedPost = discussionPosts.find(p => Number(p.id) === Number(focusedPostId));
            if (!focusedPost) return buildPostTree(discussionPosts);
            
            const relevantPosts = new Set();
            
            // Add focused post
            relevantPosts.add(Number(focusedPostId));
            
            // Add all ancestors
            let currentPost = focusedPost;
            while (currentPost && currentPost.reply_to_post_id && currentPost.reply_to_post_id.length > 0) {
                const parentId = Number(currentPost.reply_to_post_id[0]);
                relevantPosts.add(parentId);
                currentPost = discussionPosts.find(p => Number(p.id) === parentId);
            }
            
            // Add all descendants
            const addDescendants = (postId) => {
                const children = discussionPosts.filter(p => 
                    p.reply_to_post_id && 
                    p.reply_to_post_id.length > 0 && 
                    Number(p.reply_to_post_id[0]) === postId
                );
                children.forEach(child => {
                    relevantPosts.add(Number(child.id));
                    addDescendants(Number(child.id));
                });
            };
            addDescendants(Number(focusedPostId));
            
            // Filter posts to relevant ones and build tree
            const filteredPosts = discussionPosts.filter(p => relevantPosts.has(Number(p.id)));
            return buildPostTree(filteredPosts);
        }
        
        // Default: show all posts in tree
        return buildPostTree(discussionPosts);
    }, [discussionPosts, mode, focusedPostId, buildPostTree]);

    // Effect to fetch principal display info
    useEffect(() => {
        const fetchPrincipalInfo = async () => {
            if (!principalNames || !principalNicknames) return;

            const uniquePrincipals = new Set();
            
            // Add principals from discussion posts
            discussionPosts.forEach(post => {
                if (post.created_by) {
                    uniquePrincipals.add(post.created_by.toString());
                }
            });

            // Add principals from tips
            Object.values(postTips).forEach(tips => {
                tips.forEach(tip => {
                    if (tip.from_principal) {
                        uniquePrincipals.add(tip.from_principal.toString());
                    }
                    if (tip.to_principal) {
                        uniquePrincipals.add(tip.to_principal.toString());
                    }
                });
            });

            const displayInfoMap = new Map();
            Array.from(uniquePrincipals).forEach(principal => {
                try {
                    const displayInfo = getPrincipalDisplayInfoFromContext(
                        Principal.fromText(principal), 
                        principalNames, 
                        principalNicknames
                    );
                    displayInfoMap.set(principal, displayInfo);
                } catch (error) {
                    console.error('Error processing principal:', principal, error);
                }
            });

            setPrincipalDisplayInfo(displayInfoMap);
        };

        fetchPrincipalInfo();
    }, [discussionPosts, postTips, principalNames, principalNicknames]);

    // Get display title
    const getDisplayTitle = () => {
        if (title) return title;
        if (mode === 'post' && focusedPostId) {
            const focusedPost = discussionPosts.find(p => Number(p.id) === Number(focusedPostId));
            if (focusedPost && focusedPost.title) {
                return `Post: ${focusedPost.title}`;
            }
            return `Post #${focusedPostId}`;
        }
        if (threadDetails && threadDetails.title) {
            return threadDetails.title;
        }
        return `Thread #${threadId}`;
    };

    // Render loading state
    if (loadingDiscussion) {
        return (
            <div className="discussion-container">
                <div className="loading-state">
                    <div className="spinner"></div>
                    <p>Loading thread...</p>
                </div>
            </div>
        );
    }

    // Render error state
    if (!threadDetails && !loadingDiscussion) {
        return (
            <div className="discussion-container">
                <div className="error-state">
                    <p>Thread not found or could not be loaded.</p>
                </div>
            </div>
        );
    }

    const displayPosts = getDisplayPosts();

    return (
        <div className="discussion-container">
            {/* Thread Header */}
            <div className="thread-header">
                <h2>{getDisplayTitle()}</h2>
                {threadDetails && threadDetails.body && (
                    <div className="thread-description">
                        <p>{threadDetails.body}</p>
                    </div>
                )}
                {mode === 'post' && focusedPostId && (
                    <div className="post-focus-info">
                        <p>📍 Focused on Post #{focusedPostId} and its context</p>
                    </div>
                )}
            </div>

            {/* View Controls */}
            <div className="discussion-controls">
                <div className="view-mode-controls">
                    <button 
                        onClick={() => setViewMode('tree')} 
                        className={viewMode === 'tree' ? 'active' : ''}
                    >
                        🌳 Tree View
                    </button>
                    <button 
                        onClick={() => setViewMode('flat')} 
                        className={viewMode === 'flat' ? 'active' : ''}
                    >
                        📋 Flat View
                    </button>
                </div>
            </div>

            {/* Posts Display */}
            <div className="discussion-posts">
                {displayPosts.length === 0 ? (
                    <div className="no-posts">
                        <p>No posts in this thread yet.</p>
                    </div>
                ) : (
                    <div className={`posts-container ${viewMode}`}>
                        {displayPosts.map(post => (
                            <PostComponent 
                                key={post.id} 
                                post={post} 
                                depth={0} 
                                isFlat={viewMode === 'flat'}
                                focusedPostId={focusedPostId}
                            />
                        ))}
                    </div>
                )}
            </div>

            {/* Tip Modal */}
            {tipModalOpen && selectedPostForTip && (
                <TipModal
                    isOpen={tipModalOpen}
                    onClose={() => {
                        setTipModalOpen(false);
                        setSelectedPostForTip(null);
                        setTippingState('idle');
                    }}
                    availableTokens={availableTokens}
                    onTip={handleTip}
                    isLoading={tippingState === 'transferring' || tippingState === 'registering'}
                    identity={identity}
                />
            )}
        </div>
    );

    // PostComponent would be extracted from Discussion.jsx and placed here
    // For now, I'll create a simplified placeholder that references the full implementation
    function PostComponent({ post, depth, isFlat, focusedPostId }) {
        const isFocused = focusedPostId && Number(post.id) === Number(focusedPostId);
        const isCollapsed = collapsedPosts.has(Number(post.id));
        
        return (
            <div 
                className={`post-item ${isFocused ? 'focused-post' : ''}`} 
                style={{ 
                    marginLeft: isFlat ? 0 : `${depth * 20}px`,
                    border: isFocused ? '2px solid #ffd700' : undefined,
                    backgroundColor: isFocused ? 'rgba(255, 215, 0, 0.1)' : undefined
                }}
            >
                {/* Post content - simplified for now */}
                <div className="post-content">
                    <div className="post-header">
                        <span className="post-id">#{post.id.toString()}</span>
                        {post.title && <h4>{post.title}</h4>}
                        <span className="post-author">
                            {formatPrincipal(post.created_by, principalDisplayInfo.get(post.created_by?.toString()))}
                        </span>
                    </div>
                    <div className="post-body">
                        <p>{post.body}</p>
                    </div>
                    
                    {/* Tips Display */}
                    {postTips[Number(post.id)] && postTips[Number(post.id)].length > 0 && (
                        <TipDisplay 
                            tips={postTips[Number(post.id)]}
                            principalDisplayInfo={principalDisplayInfo}
                        />
                    )}
                </div>
                
                {/* Replies in tree mode */}
                {!isFlat && !isCollapsed && post.replies && post.replies.length > 0 && (
                    <div style={{ marginTop: '10px' }}>
                        {post.replies.map(reply => (
                            <PostComponent 
                                key={reply.id} 
                                post={reply} 
                                depth={depth + 1} 
                                isFlat={false}
                                focusedPostId={focusedPostId}
                            />
                        ))}
                    </div>
                )}
            </div>
        );
    }

    // Placeholder for tip handling - would need full implementation
    async function handleTip(tokenPrincipal, amount, recipientPrincipal) {
        // Implementation would be similar to Discussion.jsx
        setTippingState('success');
    }
}

export default ThreadViewer;
