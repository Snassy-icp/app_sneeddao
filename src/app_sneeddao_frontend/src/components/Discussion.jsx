import React, { useState, useEffect, useCallback, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import { Principal } from '@dfinity/principal';
import { PrincipalDisplay, getPrincipalDisplayInfoFromContext } from '../utils/PrincipalUtils';
import { useNaming } from '../NamingContext';
import { useNeurons } from '../contexts/NeuronsContext';
import { createActor as createRllActor, canisterId as rllCanisterId } from 'external/rll';
import { useAuth } from '../AuthContext';
import { useAdminCheck } from '../hooks/useAdminCheck';
import { useTextLimits } from '../hooks/useTextLimits';
import { calculateVotingPower, formatVotingPower } from '../utils/VotingPowerUtils';
import TipModal from './TipModal';
import TipDisplay from './TipDisplay';
import { createTip, getTipsByPost } from '../utils/BackendUtils';
import { useTokens } from '../hooks/useTokens';
import { createActor as createLedgerActor } from 'external/icrc1_ledger';

// Add CSS for spinner animation
const spinnerStyles = `
@keyframes spin {
    0% { transform: rotate(0deg); }
    100% { transform: rotate(360deg); }
}
`;

// Inject styles into document head
if (typeof document !== 'undefined') {
    const styleSheet = document.createElement('style');
    styleSheet.type = 'text/css';
    styleSheet.innerText = spinnerStyles;
    document.head.appendChild(styleSheet);
}

// Separate ReplyForm component to prevent PostComponent re-renders
const ReplyForm = ({ postId, onSubmit, onCancel, submittingComment, createdBy, principalDisplayInfo, textLimits }) => {
    const [replyText, setReplyText] = useState('');
    
    // Get display name for the user being replied to
    const displayInfo = principalDisplayInfo?.get(createdBy?.toString());
    const displayName = displayInfo?.displayName || createdBy.toString().slice(0, 8) + '...';
    
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
                    marginBottom: '5px'
                }}
            />
            <div style={{ 
                fontSize: '12px', 
                color: isOverLimit ? '#e74c3c' : remainingChars < 100 ? '#f39c12' : '#888',
                marginBottom: '10px',
                textAlign: 'right'
            }}>
                {replyText.length}/{maxLength} characters
                {isOverLimit && <span style={{ marginLeft: '10px' }}>({Math.abs(remainingChars)} over limit)</span>}
            </div>
            <div style={{ marginTop: '10px', display: 'flex', gap: '10px' }}>
                <button
                    onClick={() => onSubmit(replyText)}
                    disabled={!replyText.trim() || submittingComment || isOverLimit}
                    style={{
                        padding: '8px 16px',
                        backgroundColor: (replyText.trim() && !submittingComment && !isOverLimit) ? '#4CAF50' : '#333',
                        color: (replyText.trim() && !submittingComment && !isOverLimit) ? 'white' : '#666',
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
    );
};

// Separate EditForm component to prevent PostComponent re-renders
const EditForm = ({ initialTitle, initialBody, onSubmit, onCancel, submittingEdit, textLimits }) => {
    const [title, setTitle] = useState(initialTitle || '');
    const [body, setBody] = useState(initialBody || '');
    
    // Character limit validation
    const maxTitleLength = textLimits?.max_title_length || 200;
    const maxBodyLength = textLimits?.max_body_length || 10000;
    const isTitleOverLimit = title.length > maxTitleLength;
    const isBodyOverLimit = body.length > maxBodyLength;
    const isOverLimit = isTitleOverLimit || isBodyOverLimit;
    
    return (
        <div style={{ marginTop: '15px', padding: '15px', backgroundColor: '#1a1a1a', borderRadius: '4px' }}>
            <h4 style={{ color: '#f39c12', marginBottom: '10px' }}>Edit Post</h4>
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
                placeholder="Post content..."
                style={{
                    width: '100%',
                    minHeight: '100px',
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
                        backgroundColor: (body.trim() && !submittingEdit && !isOverLimit) ? '#f39c12' : '#333',
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

function Discussion({ 
    forumActor, 
    currentProposalId, 
    selectedSnsRoot, 
    isAuthenticated,
    onError 
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
    const [discussionThread, setDiscussionThread] = useState(null); // Thread mapping
    const [threadDetails, setThreadDetails] = useState(null); // Actual thread details
    const [discussionPosts, setDiscussionPosts] = useState([]);
    const [loadingDiscussion, setLoadingDiscussion] = useState(false);
    const [commentText, setCommentText] = useState('');
    const [showCommentForm, setShowCommentForm] = useState(false);
    const [submittingComment, setSubmittingComment] = useState(false);
    const [commentTitle, setCommentTitle] = useState('');
    const [principalDisplayInfo, setPrincipalDisplayInfo] = useState(new Map());
    const [creatingFirstPost, setCreatingFirstPost] = useState(false); // Track when creating first post after new thread
    
    // State for editing posts
    const [editingPost, setEditingPost] = useState(null);
    const [submittingEdit, setSubmittingEdit] = useState(false);
    
    // State for view mode and interactions
    const [viewMode, setViewMode] = useState(() => {
        // Get saved preference from localStorage, default to 'tree'
        try {
            return localStorage.getItem('discussionViewMode') || 'tree';
        } catch (error) {
            console.warn('Could not access localStorage:', error);
            return 'tree';
        }
    });
    const [collapsedPosts, setCollapsedPosts] = useState(new Set());
    const [replyingTo, setReplyingTo] = useState(null);
    
    // State for voting
    const [votingStates, setVotingStates] = useState({}); // postId -> 'voting' | 'success' | 'error'
    const [userVotes, setUserVotes] = useState({}); // postId -> { vote_type, voting_power }
    const [retractingStates, setRetractingStates] = useState({});

    // State for tipping
    const [tipModalOpen, setTipModalOpen] = useState(false);
    const [selectedPostForTip, setSelectedPostForTip] = useState(null);
    const [tippingState, setTippingState] = useState(false);
    const [postTips, setPostTips] = useState({}); // postId -> [tips]

    // Get neurons from global context
    const hotkeyNeurons = getHotkeyNeurons() || [];
    const allNeurons = getAllNeurons() || [];

    // Calculate total reachable voting power from all neurons (for forum voting)
    const totalVotingPower = React.useMemo(() => {
        if (!allNeurons || allNeurons.length === 0) return 0;
        
        return allNeurons.reduce((total, neuron) => {
            try {
                const votingPower = calculateVotingPower(neuron);
                return total + votingPower;
            } catch (error) {
                console.warn('Error calculating voting power for neuron:', neuron.id, error);
                return total;
            }
        }, 0);
    }, [allNeurons]);

    // Format voting power for display
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

    // Fetch discussion thread and thread details
    const fetchDiscussionThread = async () => {
        if (!forumActor || !currentProposalId || !selectedSnsRoot) return;
        
        setLoadingDiscussion(true);
        try {
            console.log('Fetching discussion thread with params:', {
                currentProposalId,
                selectedSnsRoot,
                forumActor: !!forumActor
            });
            
            const threadMapping = await forumActor.get_proposal_thread(
                Principal.fromText(selectedSnsRoot),
                Number(currentProposalId)
            );
            
            console.log('Thread mapping result:', threadMapping);
            
            if (threadMapping && threadMapping.length > 0) {
                const mapping = Array.isArray(threadMapping) ? threadMapping[0] : threadMapping;
                if (mapping && mapping.thread_id) {
                    console.log('Found thread mapping:', mapping);
                    setDiscussionThread(mapping);
                    
                    // Fetch the actual thread details
                    try {
                        const threadDetails = await forumActor.get_thread(Number(mapping.thread_id));
                        console.log('Thread details result:', threadDetails);
                        if (threadDetails && threadDetails.length > 0) {
                            setThreadDetails(threadDetails[0]);
                        } else {
                            setThreadDetails(null);
                        }
                    } catch (threadErr) {
                        console.error('Error fetching thread details:', threadErr);
                        setThreadDetails(null);
                    }
                    
                    await fetchDiscussionPosts(Number(mapping.thread_id));
                } else {
                    console.log('No valid thread mapping found');
                    setDiscussionThread(null);
                    setThreadDetails(null);
                    setDiscussionPosts([]);
                }
            } else {
                console.log('No thread mapping found for proposal ID:', currentProposalId);
                setDiscussionThread(null);
                setThreadDetails(null);
                setDiscussionPosts([]);
            }
        } catch (err) {
            console.error('Error fetching discussion thread:', err);
            setDiscussionThread(null);
            setThreadDetails(null);
            setDiscussionPosts([]);
        } finally {
            setLoadingDiscussion(false);
        }
    };

    // Fetch discussion posts
    const fetchDiscussionPosts = async (threadId) => {
        if (!forumActor || !threadId) return;
        
        try {
            console.log('Fetching posts for thread ID:', threadId);
            const posts = await forumActor.get_posts_by_thread(Number(threadId));
            console.log('Posts result:', posts);
            console.log('Posts length:', posts.length);
            console.log('Posts type:', typeof posts);
            
            // Handle BigInt serialization for logging
            try {
                const postsForLogging = posts.map(post => ({
                    ...post,
                    id: post.id.toString(),
                    created_at: post.created_at.toString(),
                    upvote_score: post.upvote_score.toString(),
                    downvote_score: post.downvote_score.toString()
                }));
                console.log('Posts data:', JSON.stringify(postsForLogging, null, 2));
            } catch (serializationError) {
                console.log('Could not serialize posts for logging, but posts were fetched');
                console.log('Posts count:', posts.length);
            }
            
            setDiscussionPosts(posts || []);
            
            // Fetch tips for all posts
            await fetchTipsForPosts(posts || []);
        } catch (err) {
            console.error('Error fetching discussion posts:', err);
            setDiscussionPosts([]);
        }
    };

    // Fetch tips for posts
    const fetchTipsForPosts = async (posts) => {
        if (!forumActor || !posts.length) return;
        
        try {
            const tipPromises = posts.map(async (post) => {
                try {
                    const tips = await getTipsByPost(forumActor, Number(post.id));
                    return { postId: post.id.toString(), tips };
                } catch (err) {
                    console.error(`Error fetching tips for post ${post.id}:`, err);
                    return { postId: post.id.toString(), tips: [] };
                }
            });
            
            const tipsResults = await Promise.all(tipPromises);
            const newPostTips = {};
            
            tipsResults.forEach(({ postId, tips }) => {
                newPostTips[postId] = tips;
            });
            
            setPostTips(newPostTips);
        } catch (err) {
            console.error('Error fetching tips for posts:', err);
        }
    };

    // Create proposal thread
    const createProposalThread = async (firstCommentText) => {
        if (!forumActor || !currentProposalId || !selectedSnsRoot) return null;
        
        try {
            const threadInput = {
                proposal_id: Number(currentProposalId),
                sns_root_canister_id: Principal.fromText(selectedSnsRoot)
            };

            const result = await forumActor.create_proposal_thread_with_auto_setup(threadInput);
            if ('ok' in result) {
                console.log('Thread created successfully with auto-setup, thread ID:', result.ok);
                return result.ok;
            } else {
                console.error('Failed to create thread with auto-setup:', result.err);
                if (onError) onError('Failed to create discussion thread: ' + JSON.stringify(result.err));
                return null;
            }
        } catch (err) {
            console.error('Error creating proposal thread with auto-setup:', err);
            if (onError) onError('Error creating proposal thread: ' + err.message);
            return null;
        }
    };

    // Submit comment
    const submitComment = async () => {
        if (!commentText.trim() || !forumActor) return;
        
        setSubmittingComment(true);
        try {
            let threadId = discussionThread?.thread_id;
            let newThreadCreated = false;
            
            // Create thread if it doesn't exist
            if (!threadId) {
                threadId = await createProposalThread(commentText);
                if (!threadId) {
                    return; // Error already handled in createProposalThread
                }
                newThreadCreated = true;
                
                // Immediately refresh thread data to update UI state
                await fetchDiscussionThread();
                
                // Set flag to indicate we're creating the first post
                setCreatingFirstPost(true);
            }

            // Create post - always create a post whether thread existed or was just created
            // Only use the title if it's explicitly provided and not a "Re:" title
            const shouldUseTitle = commentTitle && commentTitle.trim() && !commentTitle.trim().startsWith('Re: ');
            
            const result = await forumActor.create_post(
                Number(threadId),
                [],
                shouldUseTitle ? [commentTitle.trim()] : [],
                commentText
            );
            
            if ('ok' in result) {
                console.log('Comment created successfully, post ID:', result.ok);
                const postId = result.ok;
                
                // Clear form immediately
                setCommentText('');
                setCommentTitle('');
                setShowCommentForm(false);
                
                // Refresh posts immediately to show the new post with 0 score
                await fetchDiscussionPosts(Number(threadId));
                
                // Clear the first post creation flag
                setCreatingFirstPost(false);
                
                // Only auto-upvote if user has voting power
                if (totalVotingPower > 0) {
                    // Now automatically upvote the newly created post with spinner
                    const postIdStr = postId.toString();
                    setVotingStates(prev => ({ ...prev, [postIdStr]: 'voting' }));
                    
                    try {
                        const voteResult = await forumActor.vote_on_post(
                            Number(postId),
                            { upvote: null }
                        );
                        
                        if ('ok' in voteResult) {
                            setVotingStates(prev => ({ ...prev, [postIdStr]: 'success' }));
                            setUserVotes(prev => ({
                                ...prev,
                                [postIdStr]: {
                                    vote_type: 'upvote',
                                    voting_power: 1
                                }
                            }));
                            
                            // Refresh posts again to show updated score
                            await fetchDiscussionPosts(Number(threadId));
                            
                            // Clear voting state after a delay
                            setTimeout(() => {
                                setVotingStates(prev => {
                                    const newState = { ...prev };
                                    delete newState[postIdStr];
                                    return newState;
                                });
                            }, 2000);
                        } else {
                            console.warn('Failed to auto-upvote post:', voteResult.err);
                            setVotingStates(prev => {
                                const newState = { ...prev };
                                delete newState[postIdStr];
                                return newState;
                            });
                        }
                    } catch (voteErr) {
                        console.warn('Error auto-upvoting post:', voteErr);
                        setVotingStates(prev => {
                            const newState = { ...prev };
                            delete newState[postIdStr];
                            return newState;
                        });
                    }
                }
            } else {
                console.error('Failed to create comment:', result.err);
                if (onError) onError('Failed to create comment: ' + JSON.stringify(result.err));
                // Clear the first post creation flag on error
                setCreatingFirstPost(false);
                return;
            }
        } catch (err) {
            console.error('Error submitting comment:', err);
            if (onError) onError('Failed to submit comment: ' + err.message);
            // Clear the first post creation flag on error
            setCreatingFirstPost(false);
        } finally {
            setSubmittingComment(false);
        }
    };

    // Helper functions for post organization
    const calculatePostScore = (post) => {
        const upvotes = Number(post.upvote_score);
        const downvotes = Number(post.downvote_score);
        return upvotes - downvotes;
    };

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

    // Helper function to find a post by ID
    const findPostById = (posts, postId) => {
        return posts.find(post => Number(post.id) === Number(postId));
    };

    // Helper function to generate reply title - now returns null for "Re:" cases
    const generateReplyTitle = (parentPost) => {
        // Always return null for replies - we'll derive the title in presentation
        return null;
    };

    // Helper function to derive display title for presentation
    const getDerivedTitle = (post, parentPost = null) => {
        // Debug logging
        console.log('getDerivedTitle called with:', {
            postId: post.id,
            postTitle: post.title,
            hasParentPost: !!parentPost,
            parentPostId: parentPost?.id,
            threadDetailsTitle: threadDetails?.title,
            threadDetailsId: threadDetails?.id,
            fullThreadDetails: threadDetails
        });
        
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
                            return `Re: Thread #${threadDetails?.id || discussionThread?.thread_id || 'Unknown'}`;
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
                        return `Re: Thread #${threadDetails?.id || discussionThread?.thread_id || 'Unknown'}`;
                    }
                }
            }
        }
        
        // If it's a top-level post in a thread
        if (threadDetails && threadDetails.title && threadDetails.title.length > 0) {
            return `Re: ${threadDetails.title[0]}`;
        }
        
        // Fallback
        console.log('Falling back to Post #' + post.id);
        return `Post #${post.id}`;
    };

    const organizePostsFlat = (posts) => {
        // Sort by post ID (chronological)
        return [...posts].sort((a, b) => Number(a.id) - Number(b.id));
    };

    const organizePostsTree = (posts) => {
        const postMap = new Map();
        const rootPosts = [];
        
        // Create a map of all posts
        posts.forEach(post => {
            postMap.set(Number(post.id), { ...post, replies: [] });
        });
        
        // Organize into tree structure
        posts.forEach(post => {
            const postData = postMap.get(Number(post.id));
            if (post.reply_to_post_id && post.reply_to_post_id.length > 0) {
                const parentId = Number(post.reply_to_post_id[0]);
                const parent = postMap.get(parentId);
                if (parent) {
                    parent.replies.push(postData);
                } else {
                    rootPosts.push(postData);
                }
            } else {
                rootPosts.push(postData);
            }
        });
        
        // Sort replies by score (highest first)
        const sortRepliesByScore = (post) => {
            post.replies.sort((a, b) => calculatePostScore(b) - calculatePostScore(a));
            post.replies.forEach(sortRepliesByScore);
        };
        
        // Sort root posts by ID (chronological) and then sort all replies by score
        rootPosts.sort((a, b) => Number(a.id) - Number(b.id));
        rootPosts.forEach(sortRepliesByScore);
        
        return rootPosts;
    };

    const togglePostCollapse = (postId) => {
        const newCollapsed = new Set(collapsedPosts);
        if (newCollapsed.has(postId)) {
            newCollapsed.delete(postId);
        } else {
            newCollapsed.add(postId);
        }
        setCollapsedPosts(newCollapsed);
    };

    const submitReply = async (parentPostId, replyText) => {
        if (!replyText.trim() || !forumActor || !discussionThread) return;
        
        setSubmittingComment(true);
        try {
            // Find the parent post to generate reply title
            const parentPost = findPostById(discussionPosts, parentPostId);
            const replyTitle = generateReplyTitle(parentPost);
            
            const result = await forumActor.create_post(
                Number(discussionThread.thread_id),
                [Number(parentPostId)],
                [], // Always pass empty array for title since we derive it in presentation
                replyText
            );
            
            if ('ok' in result) {
                console.log('Reply created successfully, post ID:', result.ok);
                const postId = result.ok;
                
                // Clear form immediately
                setReplyingTo(null);
                
                // Refresh posts immediately to show the new post with 0 score
                await fetchDiscussionPosts(Number(discussionThread.thread_id));
                
                // Only auto-upvote if user has voting power
                if (totalVotingPower > 0) {
                    // Now automatically upvote the newly created post with spinner
                    const postIdStr = postId.toString();
                    setVotingStates(prev => ({ ...prev, [postIdStr]: 'voting' }));
                    
                    try {
                        const voteResult = await forumActor.vote_on_post(
                            Number(postId),
                            { upvote: null }
                        );
                        
                        if ('ok' in voteResult) {
                            setVotingStates(prev => ({ ...prev, [postIdStr]: 'success' }));
                            setUserVotes(prev => ({
                                ...prev,
                                [postIdStr]: {
                                    vote_type: 'upvote',
                                    voting_power: 1
                                }
                            }));
                            
                            // Refresh posts again to show updated score
                            await fetchDiscussionPosts(Number(discussionThread.thread_id));
                            
                            // Clear voting state after a delay
                            setTimeout(() => {
                                setVotingStates(prev => {
                                    const newState = { ...prev };
                                    delete newState[postIdStr];
                                    return newState;
                                });
                            }, 2000);
                        } else {
                            console.warn('Failed to auto-upvote reply:', voteResult.err);
                            setVotingStates(prev => {
                                const newState = { ...prev };
                                delete newState[postIdStr];
                                return newState;
                            });
                        }
                    } catch (voteErr) {
                        console.warn('Error auto-upvoting reply:', voteErr);
                        setVotingStates(prev => {
                            const newState = { ...prev };
                            delete newState[postIdStr];
                            return newState;
                        });
                    }
                }
            } else {
                console.error('Failed to create reply:', result.err);
                if (onError) onError('Failed to create reply: ' + JSON.stringify(result.err));
            }
        } catch (err) {
            console.error('Error submitting reply:', err);
            if (onError) onError('Failed to submit reply: ' + err.message);
        } finally {
            setSubmittingComment(false);
        }
    };

    // Component to render individual posts
    const PostComponent = useCallback(({ post, depth = 0, isFlat = false }) => {
        const score = calculatePostScore(post);
        const isNegative = score < 0;
        const hasBeenManuallyToggled = collapsedPosts.has(Number(post.id));
        
        // Default state: negative posts are collapsed, positive posts are expanded
        // If manually toggled, use the opposite of the default state
        const defaultCollapsed = isNegative;
        const isCollapsed = hasBeenManuallyToggled ? !defaultCollapsed : defaultCollapsed;
        
        const isReplying = replyingTo === Number(post.id);
        
        // Find parent post if this is a reply
        const parentPost = post.reply_to_post_id && post.reply_to_post_id.length > 0 
            ? findPostById(discussionPosts, post.reply_to_post_id[0])
            : null;
        
        // Get the derived display title for this post
        const displayTitle = getDerivedTitle(post, parentPost);
        const hasExplicitTitle = post.title && post.title.length > 0;
        
        return (
            <div 
                key={post.id}
                style={{
                    marginBottom: '10px'
                }}
            >
                <div style={{
                    marginLeft: isFlat ? '0' : `${depth * 20}px`,
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: '8px'
                }}>
                    {/* +/- Collapse Button */}
                    <button
                        onClick={() => togglePostCollapse(Number(post.id))}
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
                            marginTop: '0',
                            flexShrink: 0
                        }}
                    >
                        {isCollapsed ? '+' : '−'}
                    </button>

                    <div style={{
                        backgroundColor: isNegative ? '#3a2a2a' : '#2a2a2a',
                        border: isNegative ? '1px solid #8b4513' : '1px solid #4a4a4a',
                        borderRadius: '6px',
                        padding: '15px',
                        flex: 1
                    }}>
                        {/* Post Header */}
                        <div style={{ 
                            display: 'flex', 
                            justifyContent: 'space-between', 
                            alignItems: 'center',
                            marginBottom: isCollapsed ? '0' : '10px'
                        }}>
                            <div style={{ 
                                color: '#888', 
                                fontSize: '14px',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '10px'
                            }}>
                                <span>By: <PrincipalDisplay 
                                    principal={post.created_by} 
                                    displayInfo={principalDisplayInfo.get(post.created_by?.toString())}
                                    showCopyButton={false} 
                                /></span>
                                <span>•</span>
                                <span>{new Date(Number(post.created_at) / 1000000).toLocaleString()}</span>
                                {isFlat && parentPost && (
                                    <>
                                        <span>•</span>
                                        <span style={{ color: '#3498db' }}>
                                            Reply to #{Number(post.reply_to_post_id[0])}
                                            {(() => {
                                                // Find the parent's parent if it exists
                                                const parentParentPost = parentPost.reply_to_post_id && parentPost.reply_to_post_id.length > 0 
                                                    ? findPostById(discussionPosts, parentPost.reply_to_post_id[0])
                                                    : null;
                                                const parentDerivedTitle = getDerivedTitle(parentPost, parentParentPost);
                                                return <span>: {parentDerivedTitle}</span>;
                                            })()}
                                        </span>
                                    </>
                                )}
                                {isNegative && (
                                    <>
                                        <span>•</span>
                                        <span style={{ color: '#ff6b6b' }}>Low Score</span>
                                    </>
                                )}
                                {isCollapsed && (
                                    <>
                                        <span>•</span>
                                        <span style={{ color: '#888' }}>[Collapsed]</span>
                                        <span>•</span>
                                        <span style={{ color: '#666', fontStyle: 'italic' }}>
                                            {post.body.slice(0, 50)}...
                                        </span>
                                    </>
                                )}
                            </div>
                            <div style={{ 
                                display: 'flex', 
                                alignItems: 'center', 
                                gap: '10px'
                            }}>
                                {/* Removed voting display from header - moved to action buttons below */}
                            </div>
                        </div>

                        {/* Post Content */}
                        {!isCollapsed && (
                            <>
                                {/* Show post title */}
                                {hasExplicitTitle ? (
                                    <div style={{ 
                                        color: '#ffffff', 
                                        fontSize: '18px', 
                                        fontWeight: 'bold', 
                                        marginBottom: '10px' 
                                    }}>
                                        {displayTitle}
                                    </div>
                                ) : (
                                    <div style={{ 
                                        color: '#ffc107', 
                                        fontSize: '16px', 
                                        fontWeight: 'bold', 
                                        marginBottom: '8px' 
                                    }}>
                                        {displayTitle}
                                    </div>
                                )}
                                
                                <div style={{ color: '#ffffff', lineHeight: '1.6', marginBottom: '10px' }}>
                                    <ReactMarkdown>{post.body}</ReactMarkdown>
                                </div>

                                {/* Tip Display */}
                                <TipDisplay 
                                    tips={postTips[post.id.toString()] || []}
                                    tokenInfo={new Map(availableTokens.map(token => [token.principal, {
                                        symbol: token.symbol,
                                        decimals: token.decimals,
                                        logo: token.logo
                                    }]))}
                                />
                                
                                {/* Action Buttons */}
                                <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                                    {/* Voting Buttons - Always show, but disable for unauthenticated users */}
                                    <div style={{ display: 'flex', gap: '2px', alignItems: 'center' }}>
                                        {/* Upvote Button */}
                                        <button
                                            onClick={isAuthenticated ? () => voteOnPost(post.id, 'upvote') : undefined}
                                            disabled={!isAuthenticated || votingStates[post.id.toString()] === 'voting' || totalVotingPower === 0}
                                            style={{
                                                backgroundColor: userVotes[post.id.toString()]?.vote_type === 'upvote' ? '#6b8e6b' : 'transparent',
                                                border: 'none',
                                                color: userVotes[post.id.toString()]?.vote_type === 'upvote' ? '#ffffff' : 
                                                       (!isAuthenticated ? '#888' : (totalVotingPower === 0 ? '#666' : '#6b8e6b')),
                                                borderRadius: '4px',
                                                padding: '4px 6px',
                                                cursor: (!isAuthenticated || votingStates[post.id.toString()] === 'voting' || totalVotingPower === 0) ? 'not-allowed' : 'pointer',
                                                fontSize: '12px',
                                                display: 'flex',
                                                alignItems: 'center',
                                                gap: '3px',
                                                opacity: (!isAuthenticated || votingStates[post.id.toString()] === 'voting' || totalVotingPower === 0) ? 0.6 : 1,
                                                fontWeight: 'bold'
                                            }}
                                            title={!isAuthenticated ? 'Connect your wallet to vote' : 
                                                   totalVotingPower === 0 ? 'You must have hotkey neurons with voting power to vote on posts' : 
                                                   `Vote with ${formatVotingPowerDisplay(totalVotingPower)} VP`}
                                        >
                                            ▲ {!isAuthenticated ? 'Up' :
                                                votingStates[post.id.toString()] === 'voting' ? '...' : 
                                                neuronsLoading ? 'Loading...' : 
                                                totalVotingPower === 0 ? 'No VP' :
                                                totalVotingPower > 0 ? `${formatVotingPowerDisplay(totalVotingPower)}` : 'Up'}
                                        </button>

                                        {/* Score Display - Always show */}
                                        <span style={{ 
                                            color: score > 0 ? '#6b8e6b' : score < 0 ? '#b85c5c' : '#888',
                                            fontSize: '14px',
                                            fontWeight: 'bold',
                                            minWidth: '40px',
                                            textAlign: 'center',
                                            padding: '0 4px'
                                        }}>
                                            {isAuthenticated && votingStates[post.id.toString()] === 'voting' ? (
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
                                                (score > 0 ? '+' : '') + formatScore(score)
                                            )}
                                        </span>

                                        {/* Downvote Button */}
                                        <button
                                            onClick={isAuthenticated ? () => voteOnPost(post.id, 'downvote') : undefined}
                                            disabled={!isAuthenticated || votingStates[post.id.toString()] === 'voting' || totalVotingPower === 0}
                                            style={{
                                                backgroundColor: userVotes[post.id.toString()]?.vote_type === 'downvote' ? '#b85c5c' : 'transparent',
                                                border: 'none',
                                                color: userVotes[post.id.toString()]?.vote_type === 'downvote' ? '#ffffff' : 
                                                       (!isAuthenticated ? '#888' : (totalVotingPower === 0 ? '#666' : '#b85c5c')),
                                                borderRadius: '4px',
                                                padding: '4px 6px',
                                                cursor: (!isAuthenticated || votingStates[post.id.toString()] === 'voting' || totalVotingPower === 0) ? 'not-allowed' : 'pointer',
                                                fontSize: '12px',
                                                display: 'flex',
                                                alignItems: 'center',
                                                gap: '3px',
                                                opacity: (!isAuthenticated || votingStates[post.id.toString()] === 'voting' || totalVotingPower === 0) ? 0.6 : 1,
                                                fontWeight: 'bold'
                                            }}
                                            title={!isAuthenticated ? 'Connect your wallet to vote' : 
                                                   totalVotingPower === 0 ? 'You must have hotkey neurons with voting power to vote on posts' : 
                                                   `Vote with ${formatVotingPowerDisplay(totalVotingPower)} VP`}
                                        >
                                            ▼ {!isAuthenticated ? 'Down' :
                                                votingStates[post.id.toString()] === 'voting' ? '...' : 
                                                neuronsLoading ? 'Loading...' : 
                                                totalVotingPower === 0 ? 'No VP' :
                                                totalVotingPower > 0 ? `${formatVotingPowerDisplay(totalVotingPower)}` : 'Down'}
                                        </button>
                                    </div>

                                    {/* Interactive buttons - Only show for authenticated users */}
                                    {isAuthenticated && (
                                        <>
                                            {/* Reply Button */}
                                            <button
                                                onClick={() => {
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
                                                💬 {isReplying ? 'Cancel Reply' : 'Reply'}
                                            </button>

                                            {/* Retract Vote Button */}
                                            {userVotes[post.id.toString()] && (
                                                <button
                                                    onClick={() => retractVote(post.id)}
                                                    disabled={votingStates[post.id.toString()] === 'voting'}
                                                    style={{
                                                        backgroundColor: 'transparent',
                                                        border: 'none',
                                                        color: '#b8956b',
                                                        borderRadius: '4px',
                                                        padding: '4px 8px',
                                                        cursor: votingStates[post.id.toString()] === 'voting' ? 'not-allowed' : 'pointer',
                                                        fontSize: '12px',
                                                        opacity: votingStates[post.id.toString()] === 'voting' ? 0.6 : 1,
                                                        display: 'flex',
                                                        alignItems: 'center',
                                                        gap: '4px'
                                                    }}
                                                >
                                                    ↩️ {votingStates[post.id.toString()] === 'voting' ? 'Retracting...' : 'Retract'}
                                                </button>
                                            )}

                                            {/* Edit Button - show if user owns the post or is admin */}
                                            {(identity && (post.created_by.toString() === identity.getPrincipal().toString() || isAdmin)) && (
                                                <button
                                                    onClick={() => startEditPost(post)}
                                                    style={{
                                                        backgroundColor: 'transparent',
                                                        border: 'none',
                                                        color: '#b8956b',
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

                                            {/* Delete Button - show if user owns the post or is admin */}
                                            {(identity && (post.created_by.toString() === identity.getPrincipal().toString() || isAdmin)) && (
                                                <button
                                                    onClick={() => deletePost(post.id)}
                                                    style={{
                                                        backgroundColor: 'transparent',
                                                        border: 'none',
                                                        color: '#b85c5c',
                                                        borderRadius: '4px',
                                                        padding: '4px 8px',
                                                        cursor: 'pointer',
                                                        fontSize: '12px',
                                                        display: 'flex',
                                                        alignItems: 'center',
                                                        gap: '4px'
                                                    }}
                                                >
                                                    🗑️ Delete
                                                </button>
                                            )}

                                            {/* Tip Button - show for authenticated users (but not for own posts) */}
                                            {isAuthenticated && identity && post.created_by.toString() !== identity.getPrincipal().toString() && (
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

                                            {/* Voting Status */}
                                            {votingStates[post.id.toString()] === 'success' && (
                                                <span style={{ color: '#6b8e6b', fontSize: '12px' }}>✓ Voted</span>
                                            )}
                                            {votingStates[post.id.toString()] === 'error' && (
                                                <span style={{ color: '#b85c5c', fontSize: '12px' }}>✗ Error</span>
                                            )}
                                        </>
                                    )}
                                </div>

                                {/* Reply Form - Only show for authenticated users */}
                                {isAuthenticated && isReplying && (
                                    <ReplyForm 
                                        postId={post.id}
                                        onSubmit={(replyText) => submitReply(post.id, replyText)}
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
                                        submittingEdit={submittingEdit}
                                        textLimits={textLimits}
                                    />
                                )}
                            </>
                        )}
                    </div>
                </div>

                {/* Render replies in tree mode */}
                {!isFlat && !isCollapsed && post.replies && post.replies.length > 0 && (
                    <div style={{ marginTop: '10px' }}>
                        {post.replies.map(reply => (
                            <PostComponent 
                                key={reply.id} 
                                post={reply} 
                                depth={depth + 1} 
                                isFlat={false}
                            />
                        ))}
                    </div>
                )}
            </div>
        );
    }, [collapsedPosts, replyingTo, discussionPosts, principalDisplayInfo, allNeurons, votingStates, userVotes, submittingComment, editingPost, submittingEdit, isAdmin, identity, textLimits, postTips, availableTokens]);

    // Effect to fetch discussion when props change
    useEffect(() => {
        if (forumActor && currentProposalId && selectedSnsRoot) {
            fetchDiscussionThread();
        }
    }, [forumActor, currentProposalId, selectedSnsRoot]);

    // Effect to fetch principal display info
    useEffect(() => {
        const fetchPrincipalInfo = async () => {
            if (!discussionPosts.length || !principalNames || !principalNicknames) return;

            const uniquePrincipals = new Set();
            discussionPosts.forEach(post => {
                if (post.created_by) {
                    uniquePrincipals.add(post.created_by.toString());
                }
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
    }, [discussionPosts, principalNames, principalNicknames]);

    // Voting functions
    const voteOnPost = async (postId, voteType) => {
        if (!identity || !forumActor) {
            if (onError) onError('Please connect your wallet to vote');
            return;
        }

        const postIdStr = postId.toString();
        setVotingStates(prev => ({ ...prev, [postIdStr]: 'voting' }));

        try {
            const result = await forumActor.vote_on_post(
                Number(postId),
                voteType === 'upvote' ? { upvote: null } : { downvote: null }
            );

            if ('ok' in result) {
                setVotingStates(prev => ({ ...prev, [postIdStr]: 'success' }));
                
                // Update user votes state
                setUserVotes(prev => ({
                    ...prev,
                    [postIdStr]: {
                        vote_type: voteType,
                        voting_power: 1 // Since we don't know the exact power, use 1 as placeholder
                    }
                }));

                // Refresh posts to get updated scores
                if (discussionThread) {
                    await fetchDiscussionPosts(Number(discussionThread.thread_id));
                }

                // Clear voting state after a delay
                setTimeout(() => {
                    setVotingStates(prev => {
                        const newState = { ...prev };
                        delete newState[postIdStr];
                        return newState;
                    });
                }, 2000);
            } else {
                throw new Error(JSON.stringify(result.err));
            }
        } catch (error) {
            console.error('Error voting on post:', error);
            setVotingStates(prev => ({ ...prev, [postIdStr]: 'error' }));
            if (onError) onError('Failed to vote: ' + error.message);

            // Clear error state after a delay
            setTimeout(() => {
                setVotingStates(prev => {
                    const newState = { ...prev };
                    delete newState[postIdStr];
                    return newState;
                });
            }, 3000);
        }
    };

    const retractVote = async (postId) => {
        if (!identity || !forumActor) {
            if (onError) onError('Please connect your wallet to retract vote');
            return;
        }

        const postIdStr = postId.toString();
        setVotingStates(prev => ({ ...prev, [postIdStr]: 'voting' }));

        try {
            const result = await forumActor.retract_vote(Number(postId));

            if ('ok' in result) {
                setVotingStates(prev => ({ ...prev, [postIdStr]: 'success' }));
                
                // Remove from user votes state
                setUserVotes(prev => {
                    const newState = { ...prev };
                    delete newState[postIdStr];
                    return newState;
                });

                // Refresh posts to get updated scores
                if (discussionThread) {
                    await fetchDiscussionPosts(Number(discussionThread.thread_id));
                }

                // Clear voting state after a delay
                setTimeout(() => {
                    setVotingStates(prev => {
                        const newState = { ...prev };
                        delete newState[postIdStr];
                        return newState;
                    });
                }, 2000);
            } else {
                throw new Error(JSON.stringify(result.err));
            }
        } catch (error) {
            console.error('Error retracting vote:', error);
            setVotingStates(prev => ({ ...prev, [postIdStr]: 'error' }));
            if (onError) onError('Failed to retract vote: ' + error.message);

            // Clear error state after a delay
            setTimeout(() => {
                setVotingStates(prev => {
                    const newState = { ...prev };
                    delete newState[postIdStr];
                    return newState;
                });
            }, 3000);
        }
    };

    // Function to start editing a post
    const startEditPost = (post) => {
        setEditingPost(Number(post.id));
    };

    // Function to cancel editing
    const cancelEditPost = () => {
        setEditingPost(null);
    };

    // Function to submit post edit
    const submitEditPost = async (title, body) => {
        if (!forumActor || !editingPost) return;
        
        setSubmittingEdit(true);
        try {
            const result = await forumActor.update_post(
                Number(editingPost),
                title,
                body
            );
            
            if ('ok' in result) {
                // Refresh posts to show updated content
                if (discussionThread) {
                    await fetchDiscussionPosts(Number(discussionThread.thread_id));
                }
                cancelEditPost();
            } else {
                console.error('Failed to edit post:', result.err);
                if (onError) onError('Failed to edit post: ' + JSON.stringify(result.err));
            }
        } catch (err) {
            console.error('Error editing post:', err);
            if (onError) onError('Failed to edit post: ' + err.message);
        } finally {
            setSubmittingEdit(false);
        }
    };

    // Function to delete a post
    const deletePost = async (postId) => {
        if (!forumActor) return;
        
        if (!confirm('Are you sure you want to delete this post?')) return;
        
        try {
            const result = await forumActor.delete_post(Number(postId));
            
            if ('ok' in result) {
                // Refresh posts to show updated content
                if (discussionThread) {
                    await fetchDiscussionPosts(Number(discussionThread.thread_id));
                }
            } else {
                console.error('Failed to delete post:', result.err);
                if (onError) onError('Failed to delete post: ' + JSON.stringify(result.err));
            }
        } catch (err) {
            console.error('Error deleting post:', err);
            if (onError) onError('Failed to delete post: ' + err.message);
        }
    };

    // Tip handling functions
    const openTipModal = (post) => {
        setSelectedPostForTip(post);
        setTipModalOpen(true);
    };

    const closeTipModal = () => {
        setTipModalOpen(false);
        setSelectedPostForTip(null);
    };

    const handleTip = async ({ tokenPrincipal, amount, recipientPrincipal, postId }) => {
        if (!identity || !forumActor) {
            throw new Error('Please connect your wallet to send tips');
        }

        setTippingState(true);
        try {
            console.log('Starting ICRC1 tip transfer:', {
                from: identity.getPrincipal().toString(),
                to: recipientPrincipal.toString(),
                amount: amount.toString(),
                token: tokenPrincipal
            });

            // Step 1: Perform actual ICRC1 transfer
            const ledgerActor = createLedgerActor(tokenPrincipal, {
                agentOptions: { identity }
            });

            // Get token fee for validation
            const tokenFee = await ledgerActor.icrc1_fee();
            console.log('Token fee:', tokenFee.toString());

            // Perform the transfer
            const transferResult = await ledgerActor.icrc1_transfer({
                to: { 
                    owner: recipientPrincipal, 
                    subaccount: [] 
                },
                fee: [], // Let the ledger use default fee
                memo: [], // Optional memo
                from_subaccount: [], // Transfer from main account
                created_at_time: [], // Let ledger set timestamp
                amount: BigInt(amount)
            });

            console.log('ICRC1 transfer result:', transferResult);

            // Check if transfer was successful
            let transactionBlockIndex = null;
            if ('Ok' in transferResult) {
                transactionBlockIndex = Number(transferResult.Ok);
                console.log('Transfer successful, block index:', transactionBlockIndex);
            } else {
                // Handle transfer error
                const errorMsg = 'Err' in transferResult ? JSON.stringify(transferResult.Err) : 'Unknown transfer error';
                throw new Error(`ICRC1 transfer failed: ${errorMsg}`);
            }

            // Step 2: Register the tip in the forum backend
            const tipResult = await createTip(forumActor, {
                to_principal: recipientPrincipal,
                post_id: Number(postId),
                token_ledger_principal: Principal.fromText(tokenPrincipal),
                amount: Number(amount),
                transaction_block_index: transactionBlockIndex
            });

            if ('ok' in tipResult) {
                console.log('Tip registered successfully:', tipResult.ok);
                
                // Refresh tips for this post
                const tips = await getTipsByPost(forumActor, Number(postId));
                setPostTips(prev => ({
                    ...prev,
                    [postId.toString()]: tips
                }));

                // Refresh the token balance to show updated amount
                await refreshTokenBalance(tokenPrincipal);
                
                closeTipModal();
                
                if (onError) {
                    // Clear any existing errors to show success
                    onError('');
                }
            } else {
                throw new Error('Failed to register tip: ' + JSON.stringify(tipResult.err));
            }
        } catch (error) {
            console.error('Error sending tip:', error);
            
            // Provide user-friendly error messages
            let userMessage = error.message;
            if (error.message.includes('InsufficientFunds')) {
                userMessage = 'Insufficient funds for this transfer including transaction fees';
            } else if (error.message.includes('BadFee')) {
                userMessage = 'Invalid transaction fee. Please try again.';
            } else if (error.message.includes('TooOld')) {
                userMessage = 'Transaction expired. Please try again.';
            } else if (error.message.includes('Duplicate')) {
                userMessage = 'Duplicate transaction detected. Please wait and try again.';
            }
            
            throw new Error(userMessage);
        } finally {
            setTippingState(false);
        }
    };

    // Save view mode preference to localStorage when it changes
    const handleViewModeChange = (newViewMode) => {
        setViewMode(newViewMode);
        try {
            localStorage.setItem('discussionViewMode', newViewMode);
        } catch (error) {
            console.warn('Could not save to localStorage:', error);
        }
    };

    return (
        <div style={{ marginTop: '20px' }}>
            
            {loadingDiscussion ? (
                <div style={{ 
                    backgroundColor: '#3a3a3a', 
                    padding: '20px', 
                    borderRadius: '6px',
                    textAlign: 'center',
                    color: '#888'
                }}>
                    Loading discussion...
                </div>
            ) : (
                <div style={{ backgroundColor: '#3a3a3a', padding: '15px', borderRadius: '6px' }}>
                    {discussionThread && (
                        <div style={{ marginBottom: '20px' }}>
                            
                            {/* Voting Status Indicator */}
                            {isAuthenticated && (
                                <div style={{ 
                                    backgroundColor: '#1a1a1a', 
                                    padding: '10px', 
                                    borderRadius: '4px', 
                                    marginBottom: '15px',
                                    border: `1px solid ${totalVotingPower > 0 ? '#2ecc71' : '#f39c12'}`
                                }}>
                                    <div style={{ 
                                        display: 'flex', 
                                        alignItems: 'center', 
                                        gap: '8px',
                                        fontSize: '12px'
                                    }}>
                                        {neuronsLoading ? (
                                            <>
                                                <span style={{ color: '#888' }}>⏳ Loading voting neurons...</span>
                                            </>
                                        ) : totalVotingPower > 0 ? (
                                            <>
                                                <span style={{ color: '#2ecc71' }}>✓ Forum voting enabled</span>
                                                <span style={{ color: '#888' }}>•</span>
                                                <span style={{ color: '#888' }}>
                                                    {allNeurons.length} reachable neuron{allNeurons.length !== 1 ? 's' : ''}
                                                </span>
                                                <span style={{ color: '#888' }}>•</span>
                                                <span style={{ color: '#2ecc71' }}>
                                                    {formatVotingPowerDisplay(totalVotingPower)} VP
                                                </span>
                                            </>
                                        ) : (
                                            <>
                                                <span style={{ color: '#f39c12' }}>⚠ No voting power</span>
                                                <span style={{ color: '#888' }}>•</span>
                                                <span style={{ color: '#888' }}>
                                                    You need hotkey neurons with voting power to vote on posts
                                                </span>
                                            </>
                                        )}
                                    </div>
                                </div>
                            )}
                            
                            {/* Thread Title and Description */}
                            {threadDetails && (
                                <div style={{ 
                                    backgroundColor: '#1a1a1a', 
                                    padding: '15px', 
                                    borderRadius: '6px', 
                                    marginBottom: '20px',
                                    border: '1px solid #4a4a4a'
                                }}>
                                    {threadDetails.title && threadDetails.title.length > 0 && (
                                        <h3 style={{ 
                                            color: '#ffffff', 
                                            margin: '0 0 10px 0', 
                                            fontSize: '18px',
                                            fontWeight: 'bold'
                                        }}>
                                            {threadDetails.title[0]}
                                        </h3>
                                    )}
                                    {threadDetails.body && (
                                        <div style={{ 
                                            color: '#cccccc', 
                                            fontSize: '14px',
                                            lineHeight: '1.5',
                                            whiteSpace: 'pre-wrap'
                                        }}>
                                            {threadDetails.body}
                                        </div>
                                    )}
                                </div>
                            )}
                            
                            {/* View Mode Toggle */}
                            <div style={{ 
                                display: 'flex', 
                                gap: '10px', 
                                marginBottom: '20px',
                                alignItems: 'center'
                            }}>
                                <span style={{ color: '#888', fontSize: '14px' }}>View:</span>
                                <button
                                    onClick={() => handleViewModeChange('flat')}
                                    style={{
                                        backgroundColor: viewMode === 'flat' ? '#3498db' : 'transparent',
                                        border: '1px solid #3498db',
                                        color: viewMode === 'flat' ? '#ffffff' : '#3498db',
                                        borderRadius: '4px',
                                        padding: '6px 12px',
                                        cursor: 'pointer',
                                        fontSize: '12px'
                                    }}
                                >
                                    Flat
                                </button>
                                <button
                                    onClick={() => handleViewModeChange('tree')}
                                    style={{
                                        backgroundColor: viewMode === 'tree' ? '#3498db' : 'transparent',
                                        border: '1px solid #3498db',
                                        color: viewMode === 'tree' ? '#ffffff' : '#3498db',
                                        borderRadius: '4px',
                                        padding: '6px 12px',
                                        cursor: 'pointer',
                                        fontSize: '12px'
                                    }}
                                >
                                    Tree
                                </button>
                                <span style={{ color: '#666', fontSize: '12px', marginLeft: '10px' }}>
                                    {discussionPosts.length} {discussionPosts.length === 1 ? 'comment' : 'comments'}
                                </span>
                            </div>

                            {/* Posts Display */}
                            {discussionPosts.length > 0 ? (
                                <div style={{ marginBottom: '20px' }}>
                                    {viewMode === 'flat' ? (
                                        // Flat view - chronological order
                                        organizePostsFlat(discussionPosts).map(post => (
                                            <PostComponent 
                                                key={post.id} 
                                                post={post} 
                                                isFlat={true}
                                            />
                                        ))
                                    ) : (
                                        // Tree view - hierarchical with score sorting
                                        organizePostsTree(discussionPosts).map(post => (
                                            <PostComponent 
                                                key={post.id} 
                                                post={post} 
                                                isFlat={false}
                                            />
                                        ))
                                    )}
                                </div>
                            ) : !creatingFirstPost ? (
                                <div style={{ 
                                    color: '#888', 
                                    fontStyle: 'italic', 
                                    textAlign: 'center',
                                    padding: '20px',
                                    backgroundColor: '#1a1a1a',
                                    borderRadius: '6px',
                                    marginBottom: '20px'
                                }}>
                                    No comments yet. Be the first to start the discussion!
                                </div>
                            ) : null}
                        </div>
                    )}

                    {/* Comment Form */}
                    {isAuthenticated ? (
                        <div>
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
                                            border: `1px solid ${textLimits && commentTitle.length > textLimits.max_title_length ? '#e74c3c' : '#4a4a4a'}`,
                                            borderRadius: '4px',
                                            color: '#ffffff',
                                            padding: '10px',
                                            fontSize: '14px',
                                            marginBottom: '5px'
                                        }}
                                    />
                                    {textLimits && (
                                        <div style={{ 
                                            fontSize: '12px', 
                                            color: commentTitle.length > textLimits.max_title_length ? '#e74c3c' : 
                                                   (textLimits.max_title_length - commentTitle.length) < 20 ? '#f39c12' : '#888',
                                            marginBottom: '10px',
                                            textAlign: 'right'
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
                                        placeholder="Share your thoughts on this proposal..."
                                        style={{
                                            width: '100%',
                                            minHeight: '100px',
                                            backgroundColor: '#2a2a2a',
                                            border: `1px solid ${textLimits && commentText.length > textLimits.max_body_length ? '#e74c3c' : '#4a4a4a'}`,
                                            borderRadius: '4px',
                                            color: '#ffffff',
                                            padding: '10px',
                                            fontSize: '14px',
                                            resize: 'vertical',
                                            marginBottom: '5px'
                                        }}
                                    />
                                    {textLimits && (
                                        <div style={{ 
                                            fontSize: '12px', 
                                            color: commentText.length > textLimits.max_body_length ? '#e74c3c' : 
                                                   (textLimits.max_body_length - commentText.length) < 100 ? '#f39c12' : '#888',
                                            marginBottom: '10px',
                                            textAlign: 'right'
                                        }}>
                                            Body: {commentText.length}/{textLimits.max_body_length} characters
                                            {commentText.length > textLimits.max_body_length && 
                                                <span style={{ marginLeft: '10px' }}>({commentText.length - textLimits.max_body_length} over limit)</span>
                                            }
                                        </div>
                                    )}
                                    <div style={{ display: 'flex', gap: '10px' }}>
                                        <button
                                            onClick={submitComment}
                                            disabled={!commentText.trim() || submittingComment || 
                                                     (textLimits && (commentTitle.length > textLimits.max_title_length || 
                                                                    commentText.length > textLimits.max_body_length))}
                                            style={{
                                                backgroundColor: (commentText.trim() && !submittingComment && 
                                                                 (!textLimits || (commentTitle.length <= textLimits.max_title_length && 
                                                                                  commentText.length <= textLimits.max_body_length))) ? '#2ecc71' : '#666',
                                                color: '#ffffff',
                                                border: 'none',
                                                borderRadius: '4px',
                                                padding: '8px 16px',
                                                cursor: (commentText.trim() && !submittingComment && 
                                                        (!textLimits || (commentTitle.length <= textLimits.max_title_length && 
                                                                         commentText.length <= textLimits.max_body_length))) ? 'pointer' : 'not-allowed',
                                                fontSize: '14px'
                                            }}
                                        >
                                            {submittingComment ? 'Posting...' : 'Post Comment'}
                                        </button>
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
                                    </div>
                                </div>
                            )}
                        </div>
                    ) : (
                        <div style={{ 
                            textAlign: 'center', 
                            color: '#888', 
                            padding: '20px',
                            backgroundColor: '#2a2a2a',
                            borderRadius: '4px'
                        }}>
                            Please connect your wallet to participate in the discussion.
                        </div>
                    )}
                </div>
            )}

            {/* Tip Modal */}
            <TipModal
                isOpen={tipModalOpen}
                onClose={closeTipModal}
                onTip={handleTip}
                post={selectedPostForTip}
                isSubmitting={tippingState}
                availableTokens={availableTokens}
                userPrincipal={identity?.getPrincipal()}
                identity={identity}
            />
        </div>
    );
}

export default Discussion; 