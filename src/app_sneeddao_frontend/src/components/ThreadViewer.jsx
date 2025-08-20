import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../AuthContext';
import { useNaming } from '../NamingContext';
import { useNeurons } from '../contexts/NeuronsContext';
import { useAdminCheck } from '../hooks/useAdminCheck';
import { useTextLimits } from '../hooks/useTextLimits';
import { calculateVotingPower } from '../utils/VotingPowerUtils';
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
    deleteThread,
    getThreadContext
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
    
    // Text limits hook
    const { textLimits, loading: textLimitsLoading } = useTextLimits(forumActor);
    
    // Admin check
    const { isAdmin } = useAdminCheck({
        identity,
        isAuthenticated,
        redirectPath: null // Don't redirect, just check status
    });

    // URL parameter management
    const [searchParams, setSearchParams] = useSearchParams();
    const navigate = useNavigate();

    // Tokens hook for tipping
    const { tokens: availableTokens, loading: tokensLoading, refreshTokenBalance } = useTokens(identity);
    
    // Get neurons from global context
    const { getHotkeyNeurons, getAllNeurons, loading: neuronsLoading, neuronsData } = useNeurons();
    const hotkeyNeurons = getHotkeyNeurons() || [];
    const allNeurons = getAllNeurons() || [];
    
    // Calculate post score (upvotes - downvotes) like Discussion.jsx
    const calculatePostScore = (post) => {
        const upvotes = Number(post.upvote_score);
        const downvotes = Number(post.downvote_score);
        return upvotes - downvotes;
    };

    // Format vote scores like Discussion.jsx
    const formatScore = (score) => {
        // Convert from e8s (divide by 10^8)
        const scoreInTokens = score / 100000000;
        
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



    // Format voting power for display like Discussion.jsx
    const formatVotingPowerDisplay = (votingPower) => {
        if (votingPower === 0) return '0';
        
        // Convert from e8s to display units
        const displayValue = votingPower / 100_000_000;
        
        if (displayValue >= 1) {
            return displayValue.toLocaleString(undefined, {
                minimumFractionDigits: 0,
                maximumFractionDigits: 2
            });
        } else {
            return displayValue.toLocaleString(undefined, {
                minimumFractionDigits: 0,
                maximumFractionDigits: 8
            });
        }
    };
    
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
    const [threadVotes, setThreadVotes] = useState(new Map()); // Map<postId, {upvoted_neurons: [], downvoted_neurons: []}>

    // Tipping state
    const [tipModalOpen, setTipModalOpen] = useState(false);
    const [selectedPostForTip, setSelectedPostForTip] = useState(null);
    const [tippingState, setTippingState] = useState('idle'); // 'idle', 'transferring', 'registering', 'success', 'error'

    // Edit/Delete states
    const [editingPost, setEditingPost] = useState(null); // postId being edited
    const [updatingPost, setUpdatingPost] = useState(false);
    const [deletingPost, setDeletingPost] = useState(null); // postId being deleted
    const [postTips, setPostTips] = useState({});

    // SNS context state
    const [threadContext, setThreadContext] = useState(null);
    const [snsRootCanisterId, setSnsRootCanisterId] = useState(null);

    // Helper function to find a post by ID
    const findPostById = (postsList, postId) => {
        return postsList.find(p => Number(p.id) === Number(postId));
    };

    // Helper function to derive display title for presentation (from original Discussion.jsx)
    const getDerivedTitle = (post, parentPost = null) => {
        // If post has an explicit title, use it
        if (post.title && post.title.length > 0) {
            return post.title[0];
        }
        
        // If it's a reply to a post, recursively find the first ancestor with a title
        if (post.reply_to_post_id && post.reply_to_post_id.length > 0) {
            // If we have a parent post, check if it has a title
            if (parentPost) {
                if (parentPost.title && parentPost.title.length > 0) {
                    const parentTitle = parentPost.title[0];
                    // Check if parent title already starts with "Re: "
                    if (parentTitle.startsWith('Re: ')) {
                        return parentTitle; // Don't add another "Re: "
                    } else {
                        return `Re: ${parentTitle}`;
                    }
                } else {
                    // Parent has no title, so recursively check the parent's parent
                    const grandparentPost = parentPost.reply_to_post_id && parentPost.reply_to_post_id.length > 0
                        ? findPostById(discussionPosts, parentPost.reply_to_post_id[0])
                        : null;
                    
                    if (grandparentPost) {
                        // Recursively get the derived title from the grandparent
                        const ancestorTitle = getDerivedTitle(parentPost, grandparentPost);
                        // If the ancestor title already starts with "Re: ", use it as is
                        if (ancestorTitle.startsWith('Re: ')) {
                            return ancestorTitle;
                        } else {
                            return `Re: ${ancestorTitle}`;
                        }
                    } else {
                        // No grandparent found, fall back to thread title
                        if (threadDetails && threadDetails.title && threadDetails.title.length > 0) {
                            return `Re: ${threadDetails.title[0]}`;
                        } else {
                            return `Re: Thread #${threadDetails?.id || threadId || 'Unknown'}`;
                        }
                    }
                }
            } else {
                // No parent post provided, try to find it
                const foundParent = findPostById(discussionPosts, post.reply_to_post_id[0]);
                if (foundParent) {
                    return getDerivedTitle(post, foundParent);
                } else {
                    // Parent not found, fall back to thread title
                    if (threadDetails && threadDetails.title && threadDetails.title.length > 0) {
                        return `Re: ${threadDetails.title[0]}`;
                    } else {
                        return `Re: Thread #${threadDetails?.id || threadId || 'Unknown'}`;
                    }
                }
            }
        }
        
        // If it's a top-level post in a thread, use thread title
        if (threadDetails && threadDetails.title && threadDetails.title.length > 0) {
            return threadDetails.title[0];
        } else {
            return `Thread #${threadDetails?.id || threadId || 'Unknown'}`;
        }
    };

    // Calculate total reachable voting power from SNS-specific neurons (for forum voting)
    const totalVotingPower = React.useMemo(() => {
        if (!allNeurons || allNeurons.length === 0 || !snsRootCanisterId) return 0;
        
        // Filter neurons for the specific SNS
        const snsNeurons = allNeurons.filter(neuron => {
            try {
                // Check if neuron belongs to this SNS by comparing root canister ID
                const neuronSnsRoot = neuron.sns_root_canister_id;
                return neuronSnsRoot && neuronSnsRoot.toString() === snsRootCanisterId.toString();
            } catch (error) {
                console.warn('Error checking neuron SNS:', neuron.id, error);
                return false;
            }
        });

        console.log(`Found ${snsNeurons.length} neurons for SNS ${snsRootCanisterId}`);
        
        return snsNeurons.reduce((total, neuron) => {
            try {
                const votingPower = calculateVotingPower(neuron);
                return total + votingPower;
            } catch (error) {
                console.warn('Error calculating voting power for neuron:', neuron.id, error);
                return total;
            }
        }, 0);
    }, [allNeurons, snsRootCanisterId]);

    // Fetch thread details and posts
    const fetchThreadData = useCallback(async () => {
        if (!forumActor || !threadId) return;
        
        setLoadingDiscussion(true);
        try {
            console.log('Fetching thread data for thread ID:', threadId);
            
            // Fetch thread context (thread -> topic -> forum -> SNS)
            const contextResult = await getThreadContext(forumActor, threadId);
            console.log('Thread context result:', contextResult);
            
            if (contextResult && contextResult.length > 0) {
                const context = contextResult[0];
                setThreadContext(context);
                setSnsRootCanisterId(context.sns_root_canister_id?.[0] || null);
                console.log('SNS Root Canister ID:', context.sns_root_canister_id?.[0]);
            } else {
                setThreadContext(null);
                setSnsRootCanisterId(null);
            }
            
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

    // Fetch only posts (for refreshing after votes, like Discussion.jsx)
    const fetchPosts = useCallback(async () => {
        if (!forumActor || !threadId) return;
        
        try {
            console.log('Fetching posts for thread ID:', threadId);
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
            console.error('Error fetching posts:', err);
            setDiscussionPosts([]);
        }
    }, [forumActor, threadId]);

    // Submit comment function (simplified from Discussion.jsx)
    const submitComment = async () => {
        if (!commentText.trim() || !forumActor || !threadId) return;
        
        setSubmittingComment(true);
        try {
            // Only use the title if it's explicitly provided
            const shouldUseTitle = commentTitle && commentTitle.trim();
            
            const result = await forumActor.create_post(
                Number(threadId),
                [], // reply_to_post_id - empty for top-level posts
                shouldUseTitle ? [commentTitle.trim()] : [], // title
                commentText // body
            );
            
            if ('ok' in result) {
                console.log('Comment created successfully, post ID:', result.ok);
                const postId = result.ok;
                
                // Clear form immediately
                setCommentText('');
                setCommentTitle('');
                setShowCommentForm(false);
                
                // Refresh posts to show the new post
                await fetchPosts();
                
                // Auto-upvote if user has voting power
                if (allNeurons && allNeurons.length > 0 && totalVotingPower > 0) {
                    try {
                        // Set voting state to show spinner
                        const postIdStr = postId.toString();
                        setVotingStates(prev => new Map(prev.set(postIdStr, 'voting')));
                        
                        await forumActor.vote_on_post(Number(postId), { upvote: null });
                        
                        // Set success state and user vote
                        setVotingStates(prev => new Map(prev.set(postIdStr, 'success')));
                        setUserVotes(prev => new Map(prev.set(postIdStr, { vote_type: 'up', voting_power: totalVotingPower })));
                        
                        // Refresh again to show the upvote
                        await fetchPosts();
                        
                        // Clear voting state after a delay
                        setTimeout(() => {
                            setVotingStates(prev => {
                                const newState = new Map(prev);
                                newState.delete(postIdStr);
                                return newState;
                            });
                        }, 2000);
                    } catch (voteError) {
                        console.error('Error auto-upvoting new post:', voteError);
                        // Set error state
                        const postIdStr = postId.toString();
                        setVotingStates(prev => new Map(prev.set(postIdStr, 'error')));
                        
                        // Clear error state after a delay
                        setTimeout(() => {
                            setVotingStates(prev => {
                                const newState = new Map(prev);
                                newState.delete(postIdStr);
                                return newState;
                            });
                        }, 3000);
                    }
                }
            } else {
                throw new Error(JSON.stringify(result.err));
            }
        } catch (error) {
            console.error('Error creating comment:', error);
            if (onError) onError('Failed to create comment: ' + error.message);
        } finally {
            setSubmittingComment(false);
        }
    };

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
                
                // Refresh posts to get updated scores (same as original Discussion.jsx)
                await fetchPosts();
                
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
                
                // Clear error state after a delay
                setTimeout(() => {
                    setVotingStates(prev => {
                        const newState = new Map(prev);
                        newState.delete(postIdStr);
                        return newState;
                    });
                }, 3000);
            }
        } catch (error) {
            console.error('Error voting on post:', error);
            setVotingStates(prev => new Map(prev.set(postIdStr, 'error')));
            
            // Clear error state after a delay
            setTimeout(() => {
                setVotingStates(prev => {
                    const newState = new Map(prev);
                    newState.delete(postIdStr);
                    return newState;
                });
            }, 3000);
        }
    }, [forumActor, allNeurons, totalVotingPower]);

    const handleRetractVote = useCallback(async (postId) => {
        if (!forumActor) return;

        const postIdStr = postId.toString();
        setVotingStates(prev => new Map(prev.set(postIdStr, 'voting')));

        try {
            const result = await forumActor.retract_vote(Number(postId));
            if ('ok' in result) {
                setVotingStates(prev => new Map(prev.set(postIdStr, 'success')));
                
                // Clear user votes for this post
                setUserVotes(prev => {
                    const newState = new Map(prev);
                    newState.delete(postIdStr);
                    return newState;
                });
                
                // Refresh posts to get updated scores
                await fetchPosts();
                
                // Clear voting state after a delay
                setTimeout(() => {
                    setVotingStates(prev => {
                        const newState = new Map(prev);
                        newState.delete(postIdStr);
                        return newState;
                    });
                }, 2000);
            } else {
                console.error('Retract vote failed:', result.err);
                setVotingStates(prev => new Map(prev.set(postIdStr, 'error')));
                
                // Clear error state after a delay
                setTimeout(() => {
                    setVotingStates(prev => {
                        const newState = new Map(prev);
                        newState.delete(postIdStr);
                        return newState;
                    });
                }, 3000);
            }
        } catch (error) {
            console.error('Error retracting vote:', error);
            setVotingStates(prev => new Map(prev.set(postIdStr, 'error')));
            
            // Clear error state after a delay
            setTimeout(() => {
                setVotingStates(prev => {
                    const newState = new Map(prev);
                    newState.delete(postIdStr);
                    return newState;
                });
            }, 3000);
        }
    }, [forumActor, fetchPosts]);

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
                const postId = result.ok;
                
                // Clear form immediately
                setReplyingTo(null);
                
                // Refresh posts to show the new reply
                await fetchPosts();
                
                // Auto-upvote if user has voting power
                if (allNeurons && allNeurons.length > 0 && totalVotingPower > 0) {
                    try {
                        // Set voting state to show spinner
                        const postIdStr = postId.toString();
                        setVotingStates(prev => new Map(prev.set(postIdStr, 'voting')));
                        
                        await forumActor.vote_on_post(Number(postId), { upvote: null });
                        
                        // Set success state and user vote
                        setVotingStates(prev => new Map(prev.set(postIdStr, 'success')));
                        setUserVotes(prev => new Map(prev.set(postIdStr, { vote_type: 'up', voting_power: totalVotingPower })));
                        
                        // Refresh again to show the upvote
                        await fetchPosts();
                        
                        // Clear voting state after a delay
                        setTimeout(() => {
                            setVotingStates(prev => {
                                const newState = new Map(prev);
                                newState.delete(postIdStr);
                                return newState;
                            });
                        }, 2000);
                    } catch (voteError) {
                        console.error('Error auto-upvoting new reply:', voteError);
                        // Set error state
                        const postIdStr = postId.toString();
                        setVotingStates(prev => new Map(prev.set(postIdStr, 'error')));
                        
                        // Clear error state after a delay
                        setTimeout(() => {
                            setVotingStates(prev => {
                                const newState = new Map(prev);
                                newState.delete(postIdStr);
                                return newState;
                            });
                        }, 3000);
                    }
                }
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
    }, [forumActor, threadId, onError, fetchPosts, allNeurons, totalVotingPower]);

    const openTipModal = useCallback((post) => {
        setSelectedPostForTip(post);
        setTipModalOpen(true);
    }, []);

    const closeTipModal = useCallback(() => {
        setTipModalOpen(false);
        setSelectedPostForTip(null);
        setTippingState('idle');
    }, []);

    const handleTip = useCallback(async ({ tokenPrincipal, amount, recipientPrincipal, postId }) => {
        if (!forumActor || !selectedPostForTip) return;

        try {
            setTippingState('transferring');
            console.log('handleTip called with:', { tokenPrincipal, amount, recipientPrincipal, postId });

            // Create ledger actor for the selected token
            const ledgerActor = createLedgerActor(tokenPrincipal, {
                agentOptions: { identity }
            });

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
                amount: BigInt(amount) // Ensure amount is BigInt
            });

            if ('Err' in transferResult) {
                console.error('Transfer failed:', transferResult.Err);
                setTippingState('error');
                return;
            }

            console.log('Transfer successful, block index:', transferResult.Ok);
            setTippingState('registering');

            // Register the tip in the backend
            const tipResult = await createTip(forumActor, {
                to_principal: recipientPrincipal,
                post_id: Number(postId),
                token_ledger_principal: Principal.fromText(tokenPrincipal), // Convert string to Principal
                amount: Number(amount), // Convert BigInt to Number to avoid serialization issues
                transaction_block_index: Number(transferResult.Ok) // Convert BigInt to Number
            });

            if ('ok' in tipResult) {
                console.log('Tip registered successfully:', tipResult.ok);
                setTippingState('success');
                
                // Refresh tips for this post
                await fetchTipsForPosts([selectedPostForTip]);
                
                // Refresh token balance
                if (refreshTokenBalance) {
                    refreshTokenBalance(tokenPrincipal.toString());
                }
                
                // Don't auto-close modal - let user close it manually from the success screen
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
            // Debug logging to see what we're getting
            console.log('submitEditPost called with:', { title, body, titleType: typeof title });
            
            // Handle the title exactly like Discussion.jsx does
            // If title is an array (empty array = []), convert to empty string, then to null if empty
            let processedTitle = title;
            if (Array.isArray(title)) {
                processedTitle = title.length > 0 ? title[0] : '';
            }
            
            // Convert empty strings to [] (None), but keep non-empty strings as [string] (Some)
            const finalTitle = (processedTitle && processedTitle.trim()) ? [processedTitle.trim()] : [];
            
            console.log('Processed title:', { processedTitle, finalTitle });
            
            // Call update_post directly like Discussion.jsx does - pass title as string or null
            const result = await forumActor.update_post(
                Number(editingPost),
                finalTitle,
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

    // Effect to fetch thread votes when neurons become available
    useEffect(() => {
        if (discussionPosts.length > 0 && allNeurons && allNeurons.length > 0 && forumActor && threadId) {
            const fetchVotes = async () => {
                try {
                    const neuronIds = allNeurons.map(neuron => ({
                        id: neuron.id[0].id
                    }));

                    const voteResults = await forumActor.get_thread_votes_for_neurons(Number(threadId), neuronIds);

                    const votesMap = new Map();
                    voteResults.forEach(postVotes => {
                        const postIdStr = postVotes.post_id.toString();
                        const upvotedNeurons = [];
                        const downvotedNeurons = [];

                        postVotes.neuron_votes.forEach(neuronVote => {
                            const neuronData = {
                                neuron_id: neuronVote.neuron_id,
                                voting_power: neuronVote.voting_power,
                                created_at: neuronVote.created_at,
                                updated_at: neuronVote.updated_at
                            };

                            if (neuronVote.vote_type.upvote !== undefined) {
                                upvotedNeurons.push(neuronData);
                            } else if (neuronVote.vote_type.downvote !== undefined) {
                                downvotedNeurons.push(neuronData);
                            }
                        });

                        votesMap.set(postIdStr, {
                            upvoted_neurons: upvotedNeurons,
                            downvoted_neurons: downvotedNeurons
                        });
                    });

                    setThreadVotes(votesMap);
                } catch (error) {
                    console.error('Error fetching thread votes:', error);
                }
            };
            
            fetchVotes();
        }
    }, [discussionPosts.length, allNeurons?.length, threadId, forumActor]);

    // Memoize vote button styles to prevent re-renders
    const getVoteButtonStyles = useCallback((postId, voteType) => {
        const postIdStr = postId.toString();
        const postVotes = threadVotes.get(postIdStr);
        const hasUpvotes = postVotes?.upvoted_neurons?.length > 0;
        const hasDownvotes = postVotes?.downvoted_neurons?.length > 0;
        const isVoting = votingStates.get(postIdStr) === 'voting';
        const hasNoVP = totalVotingPower === 0;
        
        const isUpvote = voteType === 'up';
        const hasVotes = isUpvote ? hasUpvotes : hasDownvotes;
        const activeColor = isUpvote ? '#2ecc71' : '#e74c3c';
        const defaultColor = '#6b8eb8';
        
        return {
            backgroundColor: 'transparent',
            border: hasVotes ? `1px solid ${activeColor}` : '1px solid transparent',
            color: hasVotes ? activeColor : defaultColor,
            borderRadius: '4px',
            padding: '4px 8px',
            cursor: (isVoting || hasNoVP) ? 'not-allowed' : 'pointer',
            fontSize: '12px',
            display: 'flex',
            alignItems: 'center',
            gap: '3px',
            opacity: (isVoting || hasNoVP) ? 0.6 : 1,
            fontWeight: 'bold'
        };
    }, [threadVotes, votingStates, totalVotingPower]);

    // Memoize vote button tooltips
    const getVoteButtonTooltip = useCallback((postId, voteType) => {
        if (totalVotingPower === 0) return 'You must have neurons with voting power to vote on posts';
        
        const postIdStr = postId.toString();
        const postVotes = threadVotes.get(postIdStr);
        const isUpvote = voteType === 'up';
        const votedNeurons = isUpvote ? postVotes?.upvoted_neurons : postVotes?.downvoted_neurons;
        
        if (votedNeurons && votedNeurons.length > 0) {
            const voteTypeText = isUpvote ? 'upvotes' : 'downvotes';
            return `Recant ${voteTypeText} from ${votedNeurons.length} neuron${votedNeurons.length > 1 ? 's' : ''}`;
        }
        
        return `Vote with ${formatVotingPowerDisplay(totalVotingPower)} VP`;
    }, [threadVotes, totalVotingPower, formatVotingPowerDisplay]);

    // Effect to update URL parameter when SNS is detected
    useEffect(() => {
        if (snsRootCanisterId && threadContext) {
            const currentSnsParam = searchParams.get('sns');
            if (currentSnsParam !== snsRootCanisterId.toString()) {
                console.log('Updating URL with SNS parameter:', snsRootCanisterId.toString());
                const newParams = new URLSearchParams(searchParams);
                newParams.set('sns', snsRootCanisterId.toString());
                setSearchParams(newParams, { replace: true });
            }
        }
    }, [snsRootCanisterId, threadContext, searchParams, setSearchParams]);

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
            if (focusedPost) {
                const posterInfo = principalDisplayInfo.get(focusedPost.created_by?.toString());
                const posterName = posterInfo?.nickname || posterInfo?.name || 
                                 `${focusedPost.created_by.toString().slice(0, 8)}...`;
                
                if (focusedPost.title && focusedPost.title.length > 0) {
                    return `${focusedPost.title[0]} by ${posterName}`;
                }
                return `Post #${focusedPostId} by ${posterName}`;
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
                    <div className="post-focus-info" style={{
                        backgroundColor: '#2c3e50',
                        border: '1px solid #34495e',
                        borderRadius: '4px',
                        padding: '8px 12px',
                        marginTop: '10px',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center'
                    }}>
                        <p style={{
                            margin: 0,
                            color: '#95a5a6',
                            fontSize: '13px',
                            fontWeight: '500'
                        }}>
                            Viewing <a 
                                href={`/post?postid=${focusedPostId}${selectedSnsRoot ? `&sns=${selectedSnsRoot}` : ''}`}
                                style={{
                                    color: '#3498db',
                                    textDecoration: 'none',
                                    fontWeight: '500'
                                }}
                                onMouseEnter={(e) => e.target.style.textDecoration = 'underline'}
                                onMouseLeave={(e) => e.target.style.textDecoration = 'none'}
                            >
                                Post #{focusedPostId}
                            </a> in context
                        </p>
                        <a 
                            href={`/thread?threadid=${threadId}${selectedSnsRoot ? `&sns=${selectedSnsRoot}` : ''}`}
                            style={{
                                color: '#3498db',
                                fontSize: '13px',
                                textDecoration: 'none',
                                fontWeight: '500',
                                padding: '4px 8px',
                                borderRadius: '3px',
                                backgroundColor: '#34495e',
                                transition: 'background-color 0.2s'
                            }}
                            onMouseEnter={(e) => e.target.style.backgroundColor = '#4a5f7a'}
                            onMouseLeave={(e) => e.target.style.backgroundColor = '#34495e'}
                        >
                            View Full Thread →
                        </a>
                    </div>
                )}
            </div>

            {/* Create Comment Form */}
            {isAuthenticated && showCreatePost && (
                <div style={{ marginBottom: '20px' }}>
                    {!showCommentForm ? (
                        <button
                            onClick={() => setShowCommentForm(true)}
                            style={{
                                backgroundColor: '#3498db',
                                color: '#ffffff',
                                border: 'none',
                                borderRadius: '4px',
                                padding: '10px 20px',
                                cursor: 'pointer',
                                fontSize: '14px',
                                width: '100%'
                            }}
                        >
                            {discussionPosts.length === 0 ? 'Be the first to comment' : 'Add a comment'}
                        </button>
                    ) : (
                        <div style={{ marginTop: '15px' }}>
                            <input
                                type="text"
                                value={commentTitle}
                                onChange={(e) => setCommentTitle(e.target.value)}
                                placeholder="Title (optional)"
                                style={{
                                    width: '100%',
                                    backgroundColor: '#2a2a2a',
                                    color: '#ffffff',
                                    border: `1px solid ${textLimits && commentTitle.length > textLimits.max_title_length ? '#e74c3c' : '#444'}`,
                                    borderRadius: '4px',
                                    padding: '10px',
                                    marginBottom: '5px',
                                    fontSize: '14px'
                                }}
                            />
                            {textLimits && (
                                <div style={{
                                    fontSize: '12px',
                                    color: commentTitle.length > textLimits.max_title_length ? '#e74c3c' : 
                                           (textLimits.max_title_length - commentTitle.length) < 20 ? '#f39c12' : '#888',
                                    marginBottom: '10px'
                                }}>
                                    Title: {commentTitle.length}/{textLimits.max_title_length} characters
                                    {commentTitle.length > textLimits.max_title_length && 
                                        <span style={{ marginLeft: '10px' }}>({commentTitle.length - textLimits.max_title_length} over limit)</span>
                                    }
                                </div>
                            )}
                            <textarea
                                value={commentText}
                                onChange={(e) => setCommentText(e.target.value)}
                                placeholder="Write your comment here..."
                                style={{
                                    width: '100%',
                                    backgroundColor: '#2a2a2a',
                                    color: '#ffffff',
                                    border: `1px solid ${textLimits && commentText.length > textLimits.max_body_length ? '#e74c3c' : '#444'}`,
                                    borderRadius: '4px',
                                    padding: '10px',
                                    fontSize: '14px',
                                    minHeight: '100px',
                                    resize: 'vertical',
                                    marginBottom: '5px'
                                }}
                            />
                            {textLimits && (
                                <div style={{
                                    fontSize: '12px',
                                    color: commentText.length > textLimits.max_body_length ? '#e74c3c' : 
                                           (textLimits.max_body_length - commentText.length) < 100 ? '#f39c12' : '#888',
                                    marginBottom: '10px'
                                }}>
                                    Body: {commentText.length}/{textLimits.max_body_length} characters
                                    {commentText.length > textLimits.max_body_length && 
                                        <span style={{ marginLeft: '10px' }}>({commentText.length - textLimits.max_body_length} over limit)</span>
                                    }
                                </div>
                            )}
                            <div style={{ 
                                display: 'flex', 
                                gap: '10px', 
                                marginTop: '10px',
                                justifyContent: 'flex-end'
                            }}>
                                <button
                                    onClick={() => {
                                        setShowCommentForm(false);
                                        setCommentText('');
                                        setCommentTitle('');
                                    }}
                                    style={{
                                        backgroundColor: '#666',
                                        color: '#ffffff',
                                        border: 'none',
                                        borderRadius: '4px',
                                        padding: '8px 16px',
                                        cursor: 'pointer',
                                        fontSize: '14px'
                                    }}
                                >
                                    Cancel
                                </button>
                                <button
                                    onClick={submitComment}
                                    disabled={submittingComment || !commentText.trim() || 
                                             (textLimits && (commentTitle.length > textLimits.max_title_length || 
                                                            commentText.length > textLimits.max_body_length))}
                                    style={{
                                        backgroundColor: (submittingComment || !commentText.trim() || 
                                                         (textLimits && (commentTitle.length > textLimits.max_title_length || 
                                                                        commentText.length > textLimits.max_body_length))) ? '#666' : '#2ecc71',
                                        color: '#ffffff',
                                        border: 'none',
                                        borderRadius: '4px',
                                        padding: '8px 16px',
                                        cursor: (submittingComment || !commentText.trim() || 
                                                (textLimits && (commentTitle.length > textLimits.max_title_length || 
                                                               commentText.length > textLimits.max_body_length))) ? 'not-allowed' : 'pointer',
                                        fontSize: '14px'
                                    }}
                                >
                                    {submittingComment ? 'Posting...' : 'Post Comment'}
                                </button>
                            </div>
                        </div>
                    )}
                </div>
            )}

            {/* View Controls */}
            <div className="discussion-controls">
                <div className="view-mode-controls">
                    <button 
                        onClick={() => {
                            setViewMode('tree');
                            try {
                                localStorage.setItem('discussionViewMode', 'tree');
                            } catch (error) {
                                console.warn('Could not save to localStorage:', error);
                            }
                        }} 
                        className={viewMode === 'tree' ? 'active' : ''}
                    >
                        🌳 Tree View
                    </button>
                    <button 
                        onClick={() => {
                            setViewMode('flat');
                            try {
                                localStorage.setItem('discussionViewMode', 'flat');
                            } catch (error) {
                                console.warn('Could not save to localStorage:', error);
                            }
                        }} 
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
                    post={selectedPostForTip}
                    availableTokens={availableTokens}
                    onTip={handleTip}
                    isSubmitting={tippingState === 'transferring' || tippingState === 'registering'}
                    identity={identity}
                    tippingState={tippingState}
                />
            )}
        </div>
    );

    // PostComponent would be extracted from Discussion.jsx and placed here
    // For now, I'll create a simplified placeholder that references the full implementation
    function PostComponent({ post, depth, isFlat, focusedPostId }) {
        const isFocused = focusedPostId && Number(post.id) === Number(focusedPostId);
        const score = calculatePostScore(post);
        const isNegative = score < 0;
        const hasBeenManuallyToggled = collapsedPosts.has(Number(post.id));
        
        // Default state: negative posts are collapsed, positive posts are expanded
        // If manually toggled, use the opposite of the default state
        const defaultCollapsed = isNegative;
        const isCollapsed = hasBeenManuallyToggled ? !defaultCollapsed : defaultCollapsed;
        
        return (
            <div 
                className={`post-item ${isFocused ? 'focused-post' : ''}`} 
                style={{ 
                    marginLeft: isFlat ? 0 : `${depth * 20}px`,
                    backgroundColor: isNegative ? '#3a2a2a' : (isFocused ? '#2f3542' : '#2a2a2a'),
                    borderColor: isFocused ? '#3c6382' : (isNegative ? '#8b4513' : '#4a4a4a'),
                    borderWidth: isFocused ? '2px' : '1px',
                    borderStyle: 'solid',
                    borderRadius: '6px',
                    padding: '15px',
                    marginBottom: '10px',
                    position: 'relative'
                }}
            >

                {/* Post content - simplified for now */}
                <div className="post-content">
                    <div className="post-header">
                        {/* Collapse button - always show for tree view */}
                        {!isFlat && (
                            <button
                                onClick={() => {
                                    const newCollapsed = new Set(collapsedPosts);
                                    if (hasBeenManuallyToggled) {
                                        newCollapsed.delete(Number(post.id));
                                    } else {
                                        newCollapsed.add(Number(post.id));
                                    }
                                    setCollapsedPosts(newCollapsed);
                                }}
                                style={{
                                    backgroundColor: 'transparent',
                                    border: '1px solid #666',
                                    color: '#888',
                                    borderRadius: '4px',
                                    padding: '4px 8px',
                                    cursor: 'pointer',
                                    fontSize: '14px',
                                    minWidth: '28px',
                                    height: '28px',
                                    marginRight: '8px',
                                    flexShrink: 0
                                }}
                                title={isCollapsed ? 'Expand post' : 'Collapse post'}
                            >
                                {isCollapsed ? '+' : '−'}
                            </button>
                        )}
                        <a 
                            href={`/post?postid=${post.id}${selectedSnsRoot ? `&sns=${selectedSnsRoot}` : ''}`}
                            className="post-id"
                            style={{
                                color: '#3498db',
                                textDecoration: 'none',
                                fontWeight: '500'
                            }}
                            onMouseEnter={(e) => e.target.style.textDecoration = 'underline'}
                            onMouseLeave={(e) => e.target.style.textDecoration = 'none'}
                        >
                            #{post.id.toString()}
                        </a>
                        {post.title && <h4>{post.title}</h4>}
                        <span>By: <PrincipalDisplay 
                            principal={post.created_by} 
                            displayInfo={principalDisplayInfo.get(post.created_by?.toString())}
                            showCopyButton={false} 
                        /></span>
                        <span>•</span>
                        <span>{new Date(Number(post.created_at) / 1000000).toLocaleString()}</span>
                        {viewMode === 'flat' && post.reply_to_post_id && post.reply_to_post_id.length > 0 && (() => {
                            const parentPost = findPostById(discussionPosts, post.reply_to_post_id[0]);
                            if (parentPost) {
                                const parentParentPost = parentPost.reply_to_post_id && parentPost.reply_to_post_id.length > 0 
                                    ? findPostById(discussionPosts, parentPost.reply_to_post_id[0])
                                    : null;
                                const parentDerivedTitle = getDerivedTitle(parentPost, parentParentPost);
                                return (
                                    <>
                                        <span>•</span>
                                        <a 
                                            href={`/post?postid=${Number(post.reply_to_post_id[0])}${selectedSnsRoot ? `&sns=${selectedSnsRoot}` : ''}`}
                                            style={{
                                                color: '#3498db',
                                                textDecoration: 'none',
                                                fontWeight: '500'
                                            }}
                                            onMouseEnter={(e) => e.target.style.textDecoration = 'underline'}
                                            onMouseLeave={(e) => e.target.style.textDecoration = 'none'}
                                        >
                                            Reply to #{Number(post.reply_to_post_id[0])}: {parentDerivedTitle}
                                        </a>
                                    </>
                                );
                            }
                            return null;
                        })()}
                    </div>
                    
                    {/* Post content - hide when collapsed */}
                    {!isCollapsed && (
                        <>
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

                            {/* Voting Section - Layout like Discussion.jsx */}
                            <div style={{ 
                                display: 'flex', 
                                alignItems: 'center', 
                                gap: '8px',
                                marginTop: '5px' 
                            }}>
                                {/* Upvote Button - Shows voting power */}
                                <button
                                    onClick={() => {
                                        const postIdStr = post.id.toString();
                                        const postVotes = threadVotes.get(postIdStr);
                                        const hasUpvotes = postVotes?.upvoted_neurons?.length > 0;
                                        
                                        if (hasUpvotes) {
                                            // Recant upvotes for neurons that upvoted
                                            handleRetractVote(post.id);
                                        } else {
                                            // Regular upvote
                                            handleVote(post.id, 'up');
                                        }
                                    }}
                                    disabled={votingStates.get(post.id.toString()) === 'voting' || totalVotingPower === 0}
                                    style={getVoteButtonStyles(post.id, 'up')}
                                    title={getVoteButtonTooltip(post.id, 'up')}
                                >
                                    ▲ {votingStates.get(post.id.toString()) === 'voting' ? '...' : 
                                        totalVotingPower === 0 ? 'No VP' : 
                                        `${formatVotingPowerDisplay(totalVotingPower)}`}
                                </button>

                                {/* Score Display - Shows total post score */}
                                <span style={{ 
                                    color: (Number(post.upvote_score) - Number(post.downvote_score)) > 0 ? '#6b8e6b' : 
                                           (Number(post.upvote_score) - Number(post.downvote_score)) < 0 ? '#b85c5c' : '#888',
                                    fontSize: '14px',
                                    fontWeight: 'bold',
                                    minWidth: '60px',
                                    textAlign: 'center',
                                    padding: '0 4px'
                                }}>
                                    {votingStates.get(post.id.toString()) === 'voting' ? (
                                        <div style={{ 
                                            display: 'inline-block',
                                            width: '12px',
                                            height: '12px',
                                            border: '2px solid #f3f3f3',
                                            borderTop: '2px solid #3498db',
                                            borderRadius: '50%',
                                            animation: 'spin 1s linear infinite'
                                        }} />
                                    ) : (
                                        (() => {
                                            const score = Number(post.upvote_score) - Number(post.downvote_score);
                                            return (score > 0 ? '+' : '') + formatScore(score);
                                        })()
                                    )}
                                </span>

                                {/* Downvote Button - Shows voting power */}
                                <button
                                    onClick={() => {
                                        const postIdStr = post.id.toString();
                                        const postVotes = threadVotes.get(postIdStr);
                                        const hasDownvotes = postVotes?.downvoted_neurons?.length > 0;
                                        
                                        if (hasDownvotes) {
                                            // Recant downvotes for neurons that downvoted
                                            handleRetractVote(post.id);
                                        } else {
                                            // Regular downvote
                                            handleVote(post.id, 'down');
                                        }
                                    }}
                                    disabled={votingStates.get(post.id.toString()) === 'voting' || totalVotingPower === 0}
                                    style={getVoteButtonStyles(post.id, 'down')}
                                    title={getVoteButtonTooltip(post.id, 'down')}
                                >
                                    ▼ {votingStates.get(post.id.toString()) === 'voting' ? '...' : 
                                        totalVotingPower === 0 ? 'No VP' : 
                                        `${formatVotingPowerDisplay(totalVotingPower)}`}
                                </button>
                            </div>

                            {/* Tip Button - Only show for posts by other users */}
                            {identity && post.created_by.toString() !== identity.getPrincipal().toString() && (
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
                            )}

                            {/* Edit Button - Show for post owner or admin */}
                            {identity && (post.created_by.toString() === identity.getPrincipal().toString() || isAdmin) && (
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

                            {/* Delete Button - Show for post owner or admin */}
                            {identity && (post.created_by.toString() === identity.getPrincipal().toString() || isAdmin) && (
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
                        </>
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
