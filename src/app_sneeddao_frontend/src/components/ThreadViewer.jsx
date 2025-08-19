import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '../AuthContext';
import { useNaming } from '../NamingContext';
import { useNeurons } from '../contexts/NeuronsContext';
import { useAdminCheck } from '../hooks/useAdminCheck';
import { useTextLimits } from '../hooks/useTextLimits';
import { useTokens } from '../hooks/useTokens';
import { useTokenMetadata } from '../hooks/useTokenMetadata';
import { formatPrincipal, getPrincipalDisplayInfoFromContext, PrincipalDisplay } from '../utils/PrincipalUtils';
import { Principal } from '@dfinity/principal';
import { 
    getTipsByPost, 
    createTip,
    updatePost,
    deletePost,
    updateThread,
    deleteThread
} from '../utils/BackendUtils';
import { createActor as createLedgerActor } from 'external/icrc1_ledger';
import TipModal from './TipModal';
import TipDisplay from './TipDisplay';
import './ThreadViewer.css';

// Separate EditForm component to prevent PostComponent re-renders
const EditForm = ({ initialTitle, initialBody, onSubmit, onCancel, submittingEdit, textLimits }) => {
    const [title, setTitle] = useState(initialTitle || '');
    const [body, setBody] = useState(initialBody || '');
    
    // Character limit validation
    const maxTitleLength = textLimits?.post_title_max_length || 200;
    const maxBodyLength = textLimits?.post_body_max_length || 10000;
    const isTitleOverLimit = title.length > maxTitleLength;
    const isBodyOverLimit = body.length > maxBodyLength;
    const isOverLimit = isTitleOverLimit || isBodyOverLimit;
    
    return (
        <div style={{ marginTop: '15px', padding: '15px', backgroundColor: '#1a1a1a', borderRadius: '4px' }}>
            <h4 style={{ color: '#9b59b6', marginBottom: '10px' }}>Edit Post</h4>
            <input
                type="text"
                placeholder="Post Title (optional)"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                style={{
                    width: '100%',
                    backgroundColor: '#2a2a2a',
                    border: `1px solid ${isTitleOverLimit ? '#e74c3c' : '#4a4a4a'}`,
                    borderRadius: '4px',
                    color: '#ffffff',
                    padding: '10px',
                    fontSize: '14px',
                    marginBottom: '5px'
                }}
            />
            <div style={{ 
                fontSize: '12px', 
                color: isTitleOverLimit ? '#e74c3c' : (maxTitleLength - title.length) < 20 ? '#f39c12' : '#888',
                marginBottom: '10px',
                textAlign: 'right'
            }}>
                Title: {title.length}/{maxTitleLength} characters
                {isTitleOverLimit && <span style={{ marginLeft: '10px' }}>({title.length - maxTitleLength} over limit)</span>}
            </div>
            <textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                placeholder="Post body"
                style={{
                    width: '100%',
                    minHeight: '120px',
                    backgroundColor: '#2a2a2a',
                    border: `1px solid ${isBodyOverLimit ? '#e74c3c' : '#4a4a4a'}`,
                    borderRadius: '4px',
                    color: '#ffffff',
                    padding: '10px',
                    fontSize: '14px',
                    resize: 'vertical',
                    marginBottom: '5px'
                }}
            />
            <div style={{ 
                fontSize: '12px', 
                color: isBodyOverLimit ? '#e74c3c' : (maxBodyLength - body.length) < 100 ? '#f39c12' : '#888',
                marginBottom: '10px',
                textAlign: 'right'
            }}>
                Body: {body.length}/{maxBodyLength} characters
                {isBodyOverLimit && <span style={{ marginLeft: '10px' }}>({body.length - maxBodyLength} over limit)</span>}
            </div>
            <div style={{ display: 'flex', gap: '10px' }}>
                <button
                    onClick={() => onSubmit(title, body)}
                    disabled={!body.trim() || submittingEdit || isOverLimit}
                    style={{
                        padding: '8px 16px',
                        backgroundColor: (body.trim() && !submittingEdit && !isOverLimit) ? '#9b59b6' : '#333',
                        color: (body.trim() && !submittingEdit && !isOverLimit) ? 'white' : '#666',
                        border: 'none',
                        borderRadius: '4px',
                        cursor: (body.trim() && !submittingEdit && !isOverLimit) ? 'pointer' : 'not-allowed'
                    }}
                >
                    {submittingEdit ? 'Updating...' : 'Update Post'}
                </button>
                <button
                    onClick={onCancel}
                    style={{
                        padding: '8px 16px',
                        backgroundColor: '#666',
                        color: 'white',
                        border: 'none',
                        borderRadius: '4px',
                        cursor: 'pointer'
                    }}
                >
                    Cancel
                </button>
            </div>
        </div>
    );
};

// ReplyForm component
const ReplyForm = ({ postId, onSubmit, onCancel, submittingComment, createdBy, principalDisplayInfo, textLimits }) => {
    const [replyText, setReplyText] = useState('');
    
    // Get display name for the user being replied to
    const displayInfo = principalDisplayInfo?.get(createdBy?.toString());
    const displayName = displayInfo?.name || displayInfo?.nickname || createdBy.toString().slice(0, 8) + '...';
    
    // Character limit validation
    const maxLength = textLimits?.max_comment_length || 5000;
    const isOverLimit = replyText.length > maxLength;
    const remainingChars = maxLength - replyText.length;
    
    return (
        <div style={{ marginTop: '15px', padding: '15px', backgroundColor: '#1a1a1a', borderRadius: '4px' }}>
            <textarea
                value={replyText}
                onChange={(e) => setReplyText(e.target.value)}
                placeholder={`Reply to ${displayName}`}
                style={{
                    width: '100%',
                    minHeight: '80px',
                    backgroundColor: '#2a2a2a',
                    border: `1px solid ${isOverLimit ? '#e74c3c' : '#4a4a4a'}`,
                    borderRadius: '4px',
                    color: '#ffffff',
                    padding: '10px',
                    fontSize: '14px',
                    resize: 'vertical',
                    fontFamily: 'inherit'
                }}
            />
            
            <div style={{ 
                marginTop: '8px', 
                display: 'flex', 
                justifyContent: 'space-between',
                alignItems: 'center'
            }}>
                <div style={{ 
                    fontSize: '12px', 
                    color: isOverLimit ? '#e74c3c' : '#888'
                }}>
                    {remainingChars} characters remaining
                </div>
                
                <div style={{ display: 'flex', gap: '8px' }}>
                    <button
                        onClick={() => onSubmit(postId, replyText)}
                        disabled={!replyText.trim() || submittingComment || isOverLimit}
                        style={{
                            padding: '8px 16px',
                            backgroundColor: (replyText.trim() && !submittingComment && !isOverLimit) ? '#3498db' : '#666',
                            color: 'white',
                            border: 'none',
                            borderRadius: '4px',
                            cursor: (replyText.trim() && !submittingComment && !isOverLimit) ? 'pointer' : 'not-allowed'
                        }}
                    >
                        {submittingComment ? 'Submitting...' : 'Submit Reply'}
                    </button>
                    <button
                        onClick={onCancel}
                        style={{
                            padding: '8px 16px',
                            backgroundColor: '#666',
                            color: 'white',
                            border: 'none',
                            borderRadius: '4px',
                            cursor: 'pointer'
                        }}
                    >
                        Cancel
                    </button>
                </div>
            </div>
        </div>
    );
};

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
    
    // Get neurons and calculate voting power
    const allNeurons = getAllNeurons();
    const totalVotingPower = allNeurons.reduce((total, neuron) => {
        return total + Number(neuron.cached_neuron_stake_e8s || 0);
    }, 0);
    
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
    
    // State for editing posts (moved to Edit/Delete states section)
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

    // Edit/Delete states
    const [editingPost, setEditingPost] = useState(null); // postId being edited
    const [updatingPost, setUpdatingPost] = useState(false);
    const [deletingPost, setDeletingPost] = useState(null); // postId being deleted
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
            
            if (posts && posts.length > 0) {
                console.log('Posts with scores:', posts.map(p => ({
                    id: p.id,
                    upvote_score: p.upvote_score,
                    downvote_score: p.downvote_score,
                    title: p.title
                })));
                setDiscussionPosts(posts);
                
                // Fetch tips for all posts
                await fetchTipsForPosts(posts);
            } else {
                setDiscussionPosts([]);
            }
            
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
            const tipsPromises = posts.map(async (post) => {
                const tips = await getTipsByPost(forumActor, Number(post.id));
                return { postId: Number(post.id), tips };
            });

            const tipsResults = await Promise.all(tipsPromises);
            const newPostTips = {};

            tipsResults.forEach(({ postId, tips }) => {
                if (tips && tips.length > 0) {
                    newPostTips[postId] = tips;
                }
            });

            setPostTips(newPostTips);
        } catch (error) {
            console.error('Error fetching tips for posts:', error);
        }
    };

    // Handler functions
    const handleVote = useCallback(async (postId, voteType) => {
        if (!forumActor || !allNeurons || allNeurons.length === 0) return;

        const postIdStr = postId.toString();
        setVotingStates(prev => new Map(prev.set(postIdStr, 'voting')));

        try {
            // Convert vote type to proper Candid variant format
            const voteVariant = voteType === 'up' ? { upvote: null } : { downvote: null };
            const result = await forumActor.vote_on_post(Number(postId), voteVariant);
            if ('ok' in result) {
                setVotingStates(prev => new Map(prev.set(postIdStr, 'success')));
                setUserVotes(prev => new Map(prev.set(postIdStr, { vote_type: voteType, voting_power: totalVotingPower })));
                
                // Refresh thread data to get updated scores
                await fetchThreadData();
                
                // Clear voting state after a delay
                setTimeout(() => {
                    setVotingStates(prev => {
                        const newState = new Map(prev);
                        newState.delete(postIdStr);
                        return newState;
                    });
                }, 2000);
            } else {
                console.error('Vote failed:', result.err);
                setVotingStates(prev => new Map(prev.set(postIdStr, 'error')));
            }
        } catch (error) {
            console.error('Error voting on post:', error);
            setVotingStates(prev => new Map(prev.set(postIdStr, 'error')));
        }
    }, [forumActor, allNeurons, totalVotingPower, fetchThreadData]);

    const submitReply = useCallback(async (parentPostId, replyText) => {
        if (!replyText.trim() || !forumActor || !threadId) return;
        
        setSubmittingComment(true);
        try {
            const result = await forumActor.create_post(
                Number(threadId),
                [Number(parentPostId)],
                [], // Empty title for replies
                replyText
            );
            
            if ('ok' in result) {
                console.log('Reply created successfully, post ID:', result.ok);
                
                // Clear form immediately
                setReplyingTo(null);
                
                // Refresh thread data to show the new post
                await fetchThreadData();
            } else {
                console.error('Failed to create reply:', result.err);
                if (onError) onError('Failed to create reply: ' + result.err);
            }
        } catch (error) {
            console.error('Error creating reply:', error);
            if (onError) onError('Failed to create reply: ' + error.message);
        } finally {
            setSubmittingComment(false);
        }
    }, [forumActor, threadId, onError, fetchThreadData]);

    const openTipModal = useCallback((post) => {
        setSelectedPostForTip(post);
        setTipModalOpen(true);
    }, []);

    const closeTipModal = useCallback(() => {
        setTipModalOpen(false);
        setSelectedPostForTip(null);
        setTippingState('idle');
    }, []);

    const handleTip = useCallback(async (tokenLedgerPrincipal, amount, recipientPrincipal) => {
        if (!forumActor || !selectedPostForTip) return;

        try {
            setTippingState('transferring');

            // Create ledger actor for the selected token
            const ledgerActor = createLedgerActor(tokenLedgerPrincipal, identity);

            // Perform the icrc1_transfer
            const transferResult = await ledgerActor.icrc1_transfer({
                to: {
                    owner: recipientPrincipal,
                    subaccount: []
                },
                fee: [],
                memo: [],
                from_subaccount: [],
                created_at_time: [],
                amount: amount
            });

            if ('Err' in transferResult) {
                console.error('Transfer failed:', transferResult.Err);
                setTippingState('error');
                return;
            }

            console.log('Transfer successful, block index:', transferResult.Ok);
            setTippingState('registering');

            // Register the tip in the backend
            const tipResult = await createTip(
                forumActor,
                recipientPrincipal,
                amount,
                tokenLedgerPrincipal,
                Number(selectedPostForTip.id),
                selectedPostForTip.thread_id ? Number(selectedPostForTip.thread_id) : null
            );

            if ('ok' in tipResult) {
                console.log('Tip registered successfully:', tipResult.ok);
                setTippingState('success');
                
                // Refresh tips for this post
                await fetchTipsForPosts([selectedPostForTip]);
                
                // Refresh token balance
                if (refreshTokenBalance) {
                    refreshTokenBalance(tokenLedgerPrincipal.toString());
                }
                
                // Close modal after a short delay
                setTimeout(() => {
                    closeTipModal();
                }, 1500);
            } else {
                console.error('Failed to register tip:', tipResult.err);
                setTippingState('error');
            }
        } catch (error) {
            console.error('Error in tip process:', error);
            setTippingState('error');
        }
    }, [forumActor, selectedPostForTip, identity, refreshTokenBalance, closeTipModal]);

    // Edit handlers
    const startEditPost = useCallback((post) => {
        setEditingPost(Number(post.id));
    }, []);

    const cancelEditPost = useCallback(() => {
        setEditingPost(null);
    }, []);

    const submitEditPost = useCallback(async (title, body) => {
        if (!forumActor || !editingPost) return;

        setUpdatingPost(true);
        try {
            const result = await updatePost(
                forumActor,
                editingPost,
                title || null,
                body
            );

            if ('ok' in result) {
                console.log('Post updated successfully');
                // Refresh thread data to show updated post
                await fetchThreadData();
                cancelEditPost();
            } else {
                console.error('Failed to update post:', result.err);
                alert('Failed to update post: ' + (result.err?.InvalidInput || result.err?.Unauthorized || 'Unknown error'));
            }
        } catch (error) {
            console.error('Error updating post:', error);
            alert('Error updating post: ' + error.message);
        } finally {
            setUpdatingPost(false);
        }
    }, [forumActor, editingPost, fetchThreadData, cancelEditPost]);

    // Delete handlers
    const handleDeletePost = useCallback(async (postId) => {
        if (!forumActor) return;

        const confirmed = window.confirm('Are you sure you want to delete this post? This action cannot be undone.');
        if (!confirmed) return;

        setDeletingPost(Number(postId));
        try {
            const result = await deletePost(forumActor, postId);

            if ('ok' in result) {
                console.log('Post deleted successfully');
                // Refresh thread data to remove deleted post
                await fetchThreadData();
            } else {
                console.error('Failed to delete post:', result.err);
                alert('Failed to delete post: ' + (result.err?.InvalidInput || result.err?.Unauthorized || 'Unknown error'));
            }
        } catch (error) {
            console.error('Error deleting post:', error);
            alert('Error deleting post: ' + error.message);
        } finally {
            setDeletingPost(null);
        }
    }, [forumActor, fetchThreadData]);

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

    // Get posts for display based on view mode
    const displayPosts = React.useMemo(() => {
        const posts = getDisplayPosts();
        
        if (viewMode === 'flat') {
            // For flat view, flatten all posts and sort by creation time
            const flattenPosts = (posts) => {
                let result = [];
                posts.forEach(post => {
                    result.push(post);
                    if (post.replies && post.replies.length > 0) {
                        result = result.concat(flattenPosts(post.replies));
                    }
                });
                return result;
            };
            
            return flattenPosts(posts).sort((a, b) => 
                Number(a.created_at) - Number(b.created_at)
            );
        }
        
        // For tree view, return hierarchical structure
        return posts;
    }, [getDisplayPosts, viewMode]);

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
                        {/* Collapse button for posts with replies */}
                        {!isFlat && post.replies && post.replies.length > 0 && (
                            <button
                                onClick={() => {
                                    const newCollapsed = new Set(collapsedPosts);
                                    if (isCollapsed) {
                                        newCollapsed.delete(Number(post.id));
                                    } else {
                                        newCollapsed.add(Number(post.id));
                                    }
                                    setCollapsedPosts(newCollapsed);
                                }}
                                style={{
                                    background: 'none',
                                    border: 'none',
                                    color: '#888',
                                    cursor: 'pointer',
                                    fontSize: '12px',
                                    marginRight: '8px'
                                }}
                                title={isCollapsed ? 'Expand replies' : 'Collapse replies'}
                            >
                                {isCollapsed ? '▶' : '▼'}
                            </button>
                        )}
                        <span className="post-id">#{post.id.toString()}</span>
                        {post.title && <h4>{post.title}</h4>}
                        <span>By: <PrincipalDisplay 
                            principal={post.created_by} 
                            displayInfo={principalDisplayInfo.get(post.created_by?.toString())}
                            showCopyButton={false} 
                        /></span>
                    </div>
                    {/* Post body - hide when editing */}
                    {editingPost !== Number(post.id) && (
                        <div className="post-body">
                            <p>{post.body}</p>
                        </div>
                    )}
                    
                    {/* Tips Display */}
                    {postTips[Number(post.id)] && postTips[Number(post.id)].length > 0 && (
                        <TipDisplay 
                            tips={postTips[Number(post.id)]}
                            principalDisplayInfo={principalDisplayInfo}
                        />
                    )}

                    {/* Action Buttons - Only show for authenticated users */}
                    {isAuthenticated && (
                        <div style={{
                            display: 'flex',
                            gap: '8px',
                            marginTop: '10px',
                            paddingTop: '10px',
                            borderTop: '1px solid #333'
                        }}>
                            {/* Reply Button */}
                            <button
                                onClick={() => {
                                    const isReplying = replyingTo === Number(post.id);
                                    if (isReplying) {
                                        setReplyingTo(null);
                                    } else {
                                        setReplyingTo(Number(post.id));
                                    }
                                }}
                                style={{
                                    backgroundColor: 'transparent',
                                    border: 'none',
                                    color: '#6b8eb8',
                                    borderRadius: '4px',
                                    padding: '4px 8px',
                                    cursor: 'pointer',
                                    fontSize: '12px',
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '4px'
                                }}
                            >
                                💬 {replyingTo === Number(post.id) ? 'Cancel Reply' : 'Reply'}
                            </button>

                            {/* Vote Buttons */}
                            <button
                                onClick={() => handleVote(post.id, 'up')}
                                disabled={votingStates.get(post.id.toString()) === 'voting'}
                                style={{
                                    backgroundColor: 'transparent',
                                    border: 'none',
                                    color: userVotes.get(post.id.toString())?.vote_type === 'up' ? '#2ecc71' : '#6b8eb8',
                                    borderRadius: '4px',
                                    padding: '4px 8px',
                                    cursor: 'pointer',
                                    fontSize: '12px',
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '4px'
                                }}
                            >
                                👍 {Number(post.upvote_score) || 0}
                            </button>

                            <button
                                onClick={() => handleVote(post.id, 'down')}
                                disabled={votingStates.get(post.id.toString()) === 'voting'}
                                style={{
                                    backgroundColor: 'transparent',
                                    border: 'none',
                                    color: userVotes.get(post.id.toString())?.vote_type === 'down' ? '#e74c3c' : '#6b8eb8',
                                    borderRadius: '4px',
                                    padding: '4px 8px',
                                    cursor: 'pointer',
                                    fontSize: '12px',
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '4px'
                                }}
                            >
                                👎 {Number(post.downvote_score) || 0}
                            </button>

                            {/* Tip Button */}
                            <button
                                onClick={() => openTipModal(post)}
                                style={{
                                    backgroundColor: 'transparent',
                                    border: 'none',
                                    color: '#f39c12',
                                    borderRadius: '4px',
                                    padding: '4px 8px',
                                    cursor: 'pointer',
                                    fontSize: '12px',
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '4px'
                                }}
                            >
                                💰 Tip
                            </button>

                            {/* Edit Button - Only show for post owner */}
                            {identity && post.created_by.toString() === identity.getPrincipal().toString() && (
                                <button
                                    onClick={() => startEditPost(post)}
                                    style={{
                                        backgroundColor: 'transparent',
                                        border: 'none',
                                        color: '#9b59b6',
                                        borderRadius: '4px',
                                        padding: '4px 8px',
                                        cursor: 'pointer',
                                        fontSize: '12px',
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: '4px'
                                    }}
                                >
                                    ✏️ Edit
                                </button>
                            )}

                            {/* Delete Button - Only show for post owner */}
                            {identity && post.created_by.toString() === identity.getPrincipal().toString() && (
                                <button
                                    onClick={() => handleDeletePost(post.id)}
                                    disabled={deletingPost === Number(post.id)}
                                    style={{
                                        backgroundColor: 'transparent',
                                        border: 'none',
                                        color: deletingPost === Number(post.id) ? '#888' : '#e74c3c',
                                        borderRadius: '4px',
                                        padding: '4px 8px',
                                        cursor: deletingPost === Number(post.id) ? 'not-allowed' : 'pointer',
                                        fontSize: '12px',
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: '4px'
                                    }}
                                >
                                    🗑️ {deletingPost === Number(post.id) ? 'Deleting...' : 'Delete'}
                                </button>
                            )}
                        </div>
                    )}

                    {/* Reply Form */}
                    {replyingTo === Number(post.id) && (
                        <ReplyForm 
                            postId={Number(post.id)}
                            onSubmit={submitReply}
                            onCancel={() => setReplyingTo(null)}
                            submittingComment={submittingComment}
                            createdBy={post.created_by}
                            principalDisplayInfo={principalDisplayInfo}
                            textLimits={textLimits}
                        />
                    )}

                    {/* Edit Form */}
                    {editingPost === Number(post.id) && (
                        <EditForm 
                            initialTitle={post.title || ''}
                            initialBody={post.body || ''}
                            onSubmit={submitEditPost}
                            onCancel={cancelEditPost}
                            submittingEdit={updatingPost}
                            textLimits={textLimits}
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


}

export default ThreadViewer;
