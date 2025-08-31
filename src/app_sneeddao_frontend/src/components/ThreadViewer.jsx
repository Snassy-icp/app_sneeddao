import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import { useNaming } from '../NamingContext';
import { useNeurons } from '../contexts/NeuronsContext';
import { useAdminCheck } from '../hooks/useAdminCheck';
import { useTextLimits } from '../hooks/useTextLimits';
import { calculateVotingPower } from '../utils/VotingPowerUtils';
import { useTokens } from '../hooks/useTokens';
import { useTokenMetadata } from '../hooks/useTokenMetadata';
import { formatError } from '../utils/errorUtils';
import { formatPrincipal, getPrincipalDisplayInfoFromContext, PrincipalDisplay } from '../utils/PrincipalUtils';
import { createActor as createSnsGovernanceActor } from 'external/sns_governance';
import { getSnsById } from '../utils/SnsUtils';
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
import Poll from './Poll';
import './ThreadViewer.css';

// Separate EditForm component to prevent PostComponent re-renders
const EditForm = ({ initialTitle, initialBody, onSubmit, onCancel, submittingEdit, textLimits }) => {
    const { theme } = useTheme();
    const [title, setTitle] = useState(initialTitle || '');
    const [body, setBody] = useState(initialBody || '');
    
    // Character limit validation
    const maxTitleLength = textLimits?.post_title_max_length || 200;
    const maxBodyLength = textLimits?.post_body_max_length || 10000;
    const isTitleOverLimit = title.length > maxTitleLength;
    const isBodyOverLimit = body.length > maxBodyLength;
    const isOverLimit = isTitleOverLimit || isBodyOverLimit;
    
    return (
        <div style={{ marginTop: '15px', padding: '15px', backgroundColor: theme.colors.secondaryBg, borderRadius: '4px' }}>
            <h4 style={{ color: theme.colors.accent, marginBottom: '10px' }}>Edit Post</h4>
            <input
                type="text"
                placeholder="Post Title (optional)"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                style={{
                    width: '100%',
                    backgroundColor: theme.colors.primaryBg,
                    border: `1px solid ${isTitleOverLimit ? theme.colors.error : theme.colors.border}`,
                    borderRadius: '4px',
                    color: theme.colors.primaryText,
                    padding: '10px',
                    fontSize: '14px',
                    marginBottom: '5px'
                }}
            />
            <div style={{ 
                fontSize: '12px', 
                color: isTitleOverLimit ? theme.colors.error : (maxTitleLength - title.length) < 20 ? theme.colors.warning : theme.colors.mutedText,
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
                    backgroundColor: theme.colors.primaryBg,
                    border: `1px solid ${isBodyOverLimit ? theme.colors.error : theme.colors.border}`,
                    borderRadius: '4px',
                    color: theme.colors.primaryText,
                    padding: '10px',
                    fontSize: '14px',
                    resize: 'vertical',
                    marginBottom: '5px'
                }}
            />
            <div style={{ 
                fontSize: '12px', 
                color: isBodyOverLimit ? theme.colors.error : (maxBodyLength - body.length) < 100 ? theme.colors.warning : theme.colors.mutedText,
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
                        backgroundColor: (body.trim() && !submittingEdit && !isOverLimit) ? theme.colors.accent : theme.colors.mutedText,
                        color: theme.colors.primaryText,
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
                        backgroundColor: theme.colors.mutedText,
                        color: theme.colors.primaryText,
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
    const { theme } = useTheme();
    const [replyText, setReplyText] = useState('');
    
    // Get display name for the user being replied to
    const displayInfo = principalDisplayInfo?.get(createdBy?.toString());
    const displayName = displayInfo?.name || displayInfo?.nickname || createdBy.toString().slice(0, 8) + '...';
    
    // Character limit validation
    const maxLength = textLimits?.max_comment_length || 5000;
    const isOverLimit = replyText.length > maxLength;
    const remainingChars = maxLength - replyText.length;
    
    return (
        <div style={{ marginTop: '15px', padding: '15px', backgroundColor: theme.colors.primaryBg, borderRadius: '4px' }}>
            <textarea
                value={replyText}
                onChange={(e) => setReplyText(e.target.value)}
                placeholder={`Reply to ${displayName}`}
                style={{
                    width: '100%',
                    minHeight: '80px',
                    backgroundColor: theme.colors.secondaryBg,
                    border: `1px solid ${isOverLimit ? theme.colors.error : '#4a4a4a'}`,
                    borderRadius: '4px',
                    color: theme.colors.primaryText,
                    padding: '10px',
                    fontSize: '14px',
                    resize: 'vertical',
                    fontFamily: 'inherit',
                    boxSizing: 'border-box'
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
                    color: isOverLimit ? theme.colors.error : theme.colors.mutedText
                }}>
                    {remainingChars} characters remaining
                </div>
                
                <div style={{ display: 'flex', gap: '8px' }}>
                    <button
                        onClick={() => onSubmit(postId, replyText)}
                        disabled={!replyText.trim() || submittingComment || isOverLimit}
                        style={{
                            padding: '8px 16px',
                            backgroundColor: (replyText.trim() && !submittingComment && !isOverLimit) ? theme.colors.accent : '#666',
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
    title = null, // Optional title override
    hideProposalLink = false // Whether to hide the proposal link (when already on proposal page)
}) {
    const { principalNames, principalNicknames } = useNaming();
    const { identity } = useAuth();
    const { theme } = useTheme();
    
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
    const [proposalInfo, setProposalInfo] = useState(null); // {proposalId, snsRoot, proposalData}
    const [discussionPosts, setDiscussionPosts] = useState([]);
    const [loadingDiscussion, setLoadingDiscussion] = useState(false);
    const [commentText, setCommentText] = useState('');
    
    // Responsive state for narrow screens
    const [isNarrowScreen, setIsNarrowScreen] = useState(false);
    const [showCommentForm, setShowCommentForm] = useState(false);
    
    // Poll state
    const [threadPolls, setThreadPolls] = useState([]); // Polls for the thread
    const [lastReadPostId, setLastReadPostId] = useState(0); // Track last read post ID for highlighting
    const [stashedLastReadPostId, setStashedLastReadPostId] = useState(0); // Stashed user's last read position
    const [stashedHighestPostId, setStashedHighestPostId] = useState(0); // Stashed highest post ID before update
    const [postPolls, setPostPolls] = useState(new Map()); // Map<postId, Poll[]>
    const [showPollForm, setShowPollForm] = useState(new Map()); // Map<postId|'thread', boolean>
    const [loadingPolls, setLoadingPolls] = useState(false);
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
    
    // Settings panel state
    const [showSettings, setShowSettings] = useState(false);
    const [selectedNeuronIds, setSelectedNeuronIds] = useState(new Set());
    const [sortBy, setSortBy] = useState(() => {
        try {
            return localStorage.getItem('threadSortBy') || 'score-best';
        } catch (error) {
            console.warn('Could not access localStorage:', error);
            return 'score-best';
        }
    }); // age-newest, age-oldest, score-best, score-worst, score-controversial

    // Get filtered neurons for voting (only selected ones) - defined after state to avoid hoisting issues
    const getSelectedNeurons = useCallback(() => {
        if (!allNeurons || allNeurons.length === 0) return [];
        
        return allNeurons.filter(neuron => {
            const neuronId = neuron.id[0].id ? Array.from(neuron.id[0].id).join(',') : '';
            return selectedNeuronIds.has(neuronId);
        });
    }, [allNeurons, selectedNeuronIds]);

    // Sort posts based on selected criteria
    const sortPosts = useCallback((posts) => {
        if (!posts || posts.length === 0) return posts;
        
        const sorted = [...posts].sort((a, b) => {
            switch (sortBy) {
                case 'age-newest':
                    return Number(b.id) - Number(a.id); // Higher ID = newer
                    
                case 'age-oldest':
                    return Number(a.id) - Number(b.id); // Lower ID = older
                    
                case 'score-best':
                    const scoreA = Number(a.upvote_score || 0) - Number(a.downvote_score || 0);
                    const scoreB = Number(b.upvote_score || 0) - Number(b.downvote_score || 0);
                    return scoreB - scoreA; // Higher score first
                    
                case 'score-worst':
                    const scoreA2 = Number(a.upvote_score || 0) - Number(a.downvote_score || 0);
                    const scoreB2 = Number(b.upvote_score || 0) - Number(b.downvote_score || 0);
                    return scoreA2 - scoreB2; // Lower score first
                    
                case 'score-controversial':
                    const upA = Number(a.upvote_score || 0);
                    const downA = Number(a.downvote_score || 0);
                    const upB = Number(b.upvote_score || 0);
                    const downB = Number(b.downvote_score || 0);
                    
                    // Controversial = total engagement (up + down)
                    const controversyA = upA + downA;
                    const controversyB = upB + downB;
                    return controversyB - controversyA; // More engagement first
                    
                default:
                    return Number(b.id) - Number(a.id); // Default to newest
            }
        });
        
        return sorted;
    }, [sortBy]);

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

    // Read tracking functions
    const fetchLastReadPost = useCallback(async (currentThreadId) => {
        if (!forumActor || !identity || !currentThreadId) return 0;
        
        try {
            const response = await forumActor.get_last_read_post({ thread_id: parseInt(currentThreadId) });
            
            // Handle Motoko optional type: null/undefined means no record exists
            if (!response.last_read_post_id || response.last_read_post_id.length === 0) {
                return 0; // No previous read record, treat as never read
            }
            
            const lastRead = Number(response.last_read_post_id[0]);
            return isNaN(lastRead) ? 0 : lastRead; // Ensure we return 0 if conversion fails
        } catch (error) {
            console.warn('Failed to fetch last read post:', error);
            return 0;
        }
    }, [forumActor, identity]);

    const updateLastReadPost = useCallback(async (currentThreadId, postId) => {
        if (!forumActor || !identity || !currentThreadId || !postId) return;
        
        try {
            await forumActor.set_last_read_post({ 
                thread_id: parseInt(currentThreadId), 
                last_read_post_id: Number(postId) 
            });
        } catch (error) {
            console.warn('Failed to update last read post:', error);
        }
    }, [forumActor, identity]);

    // Helper function to check if a post is unread (new since last visit)
    const isPostUnread = (post) => {
        const postId = Number(post.id);
        // A post is unread if:
        // 1. It's newer than the user's last read position, AND
        // 2. It was present when we loaded the thread (not added during this session)
        return postId > stashedLastReadPostId && postId <= stashedHighestPostId;
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

    // Calculate total reachable voting power from selected SNS-specific neurons (for forum voting)
    const totalVotingPower = React.useMemo(() => {
        const selectedNeurons = getSelectedNeurons();
        if (!selectedNeurons || selectedNeurons.length === 0 || !snsRootCanisterId) return 0;
        
        // Filter selected neurons for the specific SNS
        const snsNeurons = selectedNeurons.filter(neuron => {
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
    }, [getSelectedNeurons, snsRootCanisterId]);

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

    // Fetch polls for thread and posts
    const fetchPolls = useCallback(async () => {
        if (!forumActor || !threadId) return;
        
        setLoadingPolls(true);
        try {
            // Fetch thread polls
            const threadPollsResult = await forumActor.get_polls_by_thread(Number(threadId));
            
            // Validate thread polls data
            const validThreadPolls = Array.isArray(threadPollsResult) ? 
                threadPollsResult.filter(poll => poll && typeof poll === 'object') : [];
            setThreadPolls(validThreadPolls);
            
            // Fetch post polls if we have posts
            if (discussionPosts.length > 0) {
                const postPollsMap = new Map();
                
                // Fetch polls for each post
                await Promise.all(discussionPosts.map(async (post) => {
                    try {
                        const postPollsResult = await forumActor.get_polls_by_post(Number(post.id));
                        if (postPollsResult && postPollsResult.length > 0) {
                            // Validate post polls data
                            const validPostPolls = postPollsResult.filter(poll => poll && typeof poll === 'object');
                            if (validPostPolls.length > 0) {
                                postPollsMap.set(Number(post.id), validPostPolls);
                            }
                        }
                    } catch (error) {
                        console.warn(`Failed to fetch polls for post ${post.id}:`, error);
                    }
                }));
                
                setPostPolls(postPollsMap);
            }
        } catch (error) {
            console.error('Error fetching polls:', error);
            // Set empty arrays on error to prevent crashes
            setThreadPolls([]);
            setPostPolls(new Map());
        } finally {
            setLoadingPolls(false);
        }
    }, [forumActor, threadId, discussionPosts]);

    // Refresh a specific poll (after voting)
    const refreshPoll = useCallback(async (pollId) => {
        if (!forumActor) return;
        
        try {
            const pollResult = await forumActor.get_poll(pollId);
            if (pollResult && pollResult.length > 0) {
                const poll = pollResult[0];
                
                // Update thread polls
                if (!poll.post_id || poll.post_id.length === 0) {
                    setThreadPolls(prev => prev.map(p => p.id === pollId ? poll : p));
                } else {
                    // Update post polls
                    const postId = Number(poll.post_id[0]); // Ensure consistent number type
                    setPostPolls(prev => {
                        const newMap = new Map(prev);
                        const postPolls = newMap.get(postId) || [];
                        newMap.set(postId, postPolls.map(p => p.id === pollId ? poll : p));
                        return newMap;
                    });
                }
            }
        } catch (error) {
            console.error('Error refreshing poll:', error);
        }
    }, [forumActor]);

    // Handle poll creation
    const handlePollCreated = useCallback(async (pollId) => {
        // Refresh polls to get the new poll
        await fetchPolls();
        
        // Hide the poll form
        setShowPollForm(prev => {
            const newMap = new Map(prev);
            newMap.clear(); // Clear all poll forms
            return newMap;
        });
    }, [fetchPolls]);

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
                throw new Error(formatError(result.err));
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

    // Function to refresh votes for a single post (efficient)
    const refreshPostVotes = useCallback(async (postId) => {
        if (!forumActor || !allNeurons || allNeurons.length === 0) {
            return;
        }

        try {
            const neuronIds = allNeurons.map(neuron => ({
                id: neuron.id[0].id
            }));

            const voteResult = await forumActor.get_post_votes_for_neurons(Number(postId), neuronIds);
            
            // voteResult is an optional, so check if it exists and extract from array
            if (voteResult && voteResult.length > 0) {
                const postVotes = voteResult[0]; // Extract from Motoko optional array
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

                // Update only this post's votes in the state
                setThreadVotes(prev => new Map(prev.set(postIdStr, {
                    upvoted_neurons: upvotedNeurons,
                    downvoted_neurons: downvotedNeurons
                })));
            } else {
                // No votes found, clear the votes for this post
                const postIdStr = postId.toString();
                setThreadVotes(prev => new Map(prev.set(postIdStr, {
                    upvoted_neurons: [],
                    downvoted_neurons: []
                })));
            }
        } catch (error) {
            console.error('Error refreshing post votes:', error);
        }
    }, [forumActor, allNeurons]);

    // Handler functions
    const handleVote = useCallback(async (postId, voteType) => {
        const selectedNeurons = getSelectedNeurons();
        if (!forumActor || !selectedNeurons || selectedNeurons.length === 0) {
            return;
        }

        const postIdStr = postId.toString();
        setVotingStates(prev => new Map(prev.set(postIdStr, 'voting')));

        try {
            // Convert vote type to proper Candid variant format
            const voteVariant = voteType === 'up' ? { upvote: null } : { downvote: null };
            
            // Convert selected neurons to the format expected by backend
            const neuronIds = selectedNeurons.map(neuron => ({
                id: neuron.id[0].id
            }));
            
            const result = await forumActor.vote_on_post_with_neurons(Number(postId), voteVariant, neuronIds);
            if ('ok' in result) {
                setVotingStates(prev => new Map(prev.set(postIdStr, 'success')));
                setUserVotes(prev => new Map(prev.set(postIdStr, { vote_type: voteType, voting_power: totalVotingPower })));
                
                // Refresh posts to get updated scores (same as original Discussion.jsx)
                await fetchPosts();
                
                // Refresh vote button states for this specific post
                await refreshPostVotes(postId);
                
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
    }, [forumActor, getSelectedNeurons, totalVotingPower, fetchPosts, refreshPostVotes]);

    const handleRetractVote = useCallback(async (postId) => {
        const selectedNeurons = getSelectedNeurons();
        if (!forumActor || !selectedNeurons || selectedNeurons.length === 0) return;

        const postIdStr = postId.toString();
        setVotingStates(prev => new Map(prev.set(postIdStr, 'voting')));

        try {
            // Convert selected neurons to the format expected by backend
            const neuronIds = selectedNeurons.map(neuron => ({
                id: neuron.id[0].id
            }));
            
            const result = await forumActor.retract_vote_with_neurons(Number(postId), neuronIds);
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
                
                // Refresh vote button states for this specific post
                await refreshPostVotes(postId);
                
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
    }, [forumActor, getSelectedNeurons, fetchPosts, refreshPostVotes]);

    // Check if thread is linked to a proposal and fetch proposal info
    const checkProposalLink = useCallback(async () => {
        if (!forumActor || !threadId || !identity) return;

        try {
            console.log('Checking if thread is linked to proposal:', threadId);
            const proposalLink = await forumActor.get_thread_proposal_id(Number(threadId));
            console.log('get_thread_proposal_id result:', proposalLink, 'type:', typeof proposalLink, 'keys:', Object.keys(proposalLink || {}));
            
            // Handle Motoko optional tuple serialization
            // Motoko ?(Nat32, Nat) becomes [[snsRootIndex, proposalId]] in JavaScript
            if (proposalLink && Array.isArray(proposalLink) && proposalLink.length > 0) {
                let snsRootIndex, proposalId;
                
                // Extract the tuple from the optional wrapper
                const tuple = proposalLink[0];
                
                if (Array.isArray(tuple) && tuple.length === 2) {
                    [snsRootIndex, proposalId] = tuple;
                    
                    // Convert BigInt to Number if needed
                    snsRootIndex = Number(snsRootIndex);
                    proposalId = Number(proposalId);
                    
                    console.log('Parsed proposal data:', { snsRootIndex, proposalId });
                } else {
                    console.warn('Unexpected tuple format:', tuple);
                    setProposalInfo(null);
                    return;
                }
                
                if (snsRootIndex !== undefined && proposalId !== undefined) {
                    console.log('Thread is linked to proposal:', { snsRootIndex, proposalId });
                    
                    // We need to get the SNS root Principal. Since we have selectedSnsRoot in context,
                    // let's use that as it should match the current thread's SNS
                    const snsRoot = selectedSnsRoot;
                    if (!snsRoot) {
                        console.warn('No SNS root available to fetch proposal data');
                        setProposalInfo({
                            proposalId: Number(proposalId),
                            snsRoot: null,
                            proposalData: null
                        });
                        return;
                    }

                    // Fetch proposal data from governance canister
                    try {
                        const selectedSns = getSnsById(snsRoot);
                        if (!selectedSns) {
                            console.error('Selected SNS not found');
                            setProposalInfo({
                                proposalId: Number(proposalId),
                                snsRoot: snsRoot,
                                proposalData: null
                            });
                            return;
                        }

                        const snsGovActor = createSnsGovernanceActor(selectedSns.canisters.governance, {
                            agentOptions: {
                                identity,
                            },
                        });

                        const proposalIdArg = {
                            proposal_id: [{ id: BigInt(proposalId) }]
                        };

                        const response = await snsGovActor.get_proposal(proposalIdArg);
                        let proposalData = null;
                        
                        if (response?.result?.[0]?.Proposal) {
                            proposalData = response.result[0].Proposal;
                            console.log('Fetched proposal data:', proposalData);
                        } else {
                            console.warn('Proposal not found or error:', response?.result?.[0]);
                        }

                        setProposalInfo({
                            proposalId: Number(proposalId),
                            snsRoot: snsRoot,
                            proposalData: proposalData
                        });

                    } catch (govError) {
                        console.error('Error fetching proposal from governance:', govError);
                        setProposalInfo({
                            proposalId: Number(proposalId),
                            snsRoot: snsRoot,
                            proposalData: null
                        });
                    }
                } else {
                    console.log('Could not parse proposal link data:', proposalLink);
                    setProposalInfo(null);
                }
            } else {
                console.log('Thread is not linked to any proposal via get_thread_proposal_id');
                
                // Alternative approach: Check if this thread was created as a proposal thread
                // by examining the thread title/body for proposal patterns
                if (threadDetails && selectedSnsRoot) {
                    console.log('Checking thread details for proposal patterns:', {
                        title: threadDetails.title,
                        body: threadDetails.body
                    });
                    
                    // Look for proposal patterns in thread title/body
                    const titleStr = Array.isArray(threadDetails.title) && threadDetails.title.length > 0 
                        ? threadDetails.title[0] 
                        : (threadDetails.title || '');
                    const bodyStr = threadDetails.body || '';
                    
                    // Check if title matches proposal thread pattern: "SNS Name Proposal #123"
                    const proposalTitleMatch = titleStr.match(/Proposal #(\d+)/i);
                    const proposalBodyMatch = bodyStr.match(/Discussion thread for .* Proposal #(\d+)/i);
                    
                    if (proposalTitleMatch || proposalBodyMatch) {
                        const proposalId = proposalTitleMatch?.[1] || proposalBodyMatch?.[1];
                        console.log('Found proposal pattern, proposalId:', proposalId);
                        
                        if (proposalId) {
                            // Try to verify this proposal exists and fetch its data
                            try {
                                const selectedSns = getSnsById(selectedSnsRoot);
                                if (selectedSns) {
                                    const snsGovActor = createSnsGovernanceActor(selectedSns.canisters.governance, {
                                        agentOptions: { identity },
                                    });

                                    const proposalIdArg = {
                                        proposal_id: [{ id: BigInt(proposalId) }]
                                    };

                                    const response = await snsGovActor.get_proposal(proposalIdArg);
                                    if (response?.result?.[0]?.Proposal) {
                                        console.log('Confirmed proposal exists, setting proposal info');
                                        setProposalInfo({
                                            proposalId: Number(proposalId),
                                            snsRoot: selectedSnsRoot,
                                            proposalData: response.result[0].Proposal
                                        });
                                        return; // Exit early since we found it
                                    }
                                }
                            } catch (govError) {
                                console.warn('Could not verify proposal exists:', govError);
                            }
                        }
                    }
                }
                
                setProposalInfo(null);
            }
        } catch (error) {
            console.error('Error checking proposal link:', error);
            setProposalInfo(null);
        }
    }, [forumActor, threadId, identity, selectedSnsRoot]);

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

    // Effect to fetch polls when thread data is loaded
    useEffect(() => {
        if (threadId && discussionPosts.length >= 0) { // >= 0 to load even if no posts
            fetchPolls();
        }
    }, [fetchPolls, threadId, discussionPosts]);

    // Effect to handle read tracking when thread is loaded
    useEffect(() => {
        const handleReadTracking = async () => {
            if (!threadId || !identity || discussionPosts.length === 0) return;
            
            // Find the highest post ID that the user can see (current state of thread)
            const visiblePosts = discussionPosts.filter(post => !post.deleted || post.author === identity.getPrincipal().toText());
            if (visiblePosts.length === 0) return;
            
            const currentHighestPostId = Math.max(...visiblePosts.map(post => Number(post.id)));
            
            // Fetch user's last read position and stash both values for highlighting
            const userLastReadPostId = await fetchLastReadPost(threadId);
            
            // Stash both values BEFORE updating anything
            setStashedLastReadPostId(userLastReadPostId);
            setStashedHighestPostId(currentHighestPostId);
            
            console.log(`🔖 Read tracking for thread ${threadId}:`, {
                userLastRead: userLastReadPostId,
                currentHighest: currentHighestPostId,
                isFirstVisit: userLastReadPostId === 0,
                willHighlight: currentHighestPostId > userLastReadPostId ? `posts ${userLastReadPostId + 1}-${currentHighestPostId}` : 'no posts'
            });
            
            // Update the user's read position to the current highest visible post
            if (currentHighestPostId > userLastReadPostId) {
                await updateLastReadPost(threadId, currentHighestPostId);
                setLastReadPostId(currentHighestPostId);
            } else {
                setLastReadPostId(userLastReadPostId);
            }
        };
        
        handleReadTracking();
    }, [threadId, identity, discussionPosts, fetchLastReadPost, updateLastReadPost]);

    // Effect to handle responsive screen width
    useEffect(() => {
        const handleResize = () => {
            setIsNarrowScreen(window.innerWidth < 768); // Breakpoint at 768px
        };
        
        // Set initial value
        handleResize();
        
        // Add event listener
        window.addEventListener('resize', handleResize);
        
        // Cleanup
        return () => window.removeEventListener('resize', handleResize);
    }, []);

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

    // Initialize selected neurons from localStorage when neurons load
    useEffect(() => {
        if (allNeurons && allNeurons.length > 0 && selectedNeuronIds.size === 0) {
            try {
                const storageKey = `selectedNeurons_${threadId}`;
                const savedSelection = localStorage.getItem(storageKey);
                
                if (savedSelection) {
                    const savedIds = JSON.parse(savedSelection);
                    setSelectedNeuronIds(new Set(savedIds));
                } else {
                    // Default to all neurons selected
                    const allNeuronIds = allNeurons.map(neuron => {
                        // Create a unique identifier for the neuron
                        return neuron.id[0].id ? Array.from(neuron.id[0].id).join(',') : '';
                    }).filter(id => id);
                    setSelectedNeuronIds(new Set(allNeuronIds));
                }
            } catch (error) {
                console.warn('Could not load neuron selection from localStorage:', error);
                // Fallback to all neurons selected
                const allNeuronIds = allNeurons.map(neuron => {
                    return neuron.id[0].id ? Array.from(neuron.id[0].id).join(',') : '';
                }).filter(id => id);
                setSelectedNeuronIds(new Set(allNeuronIds));
            }
        }
    }, [allNeurons, threadId, selectedNeuronIds.size]);

    // Handle neuron selection changes
    const handleNeuronToggle = useCallback((neuronId) => {
        setSelectedNeuronIds(prev => {
            const newSet = new Set(prev);
            if (newSet.has(neuronId)) {
                newSet.delete(neuronId);
            } else {
                newSet.add(neuronId);
            }
            
            // Save to localStorage
            try {
                const storageKey = `selectedNeurons_${threadId}`;
                localStorage.setItem(storageKey, JSON.stringify(Array.from(newSet)));
            } catch (error) {
                console.warn('Could not save neuron selection to localStorage:', error);
            }
            
            return newSet;
        });
    }, [threadId]);

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
        const activeColor = isUpvote ? theme.colors.success : theme.colors.error;
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
            
            // Show each neuron on its own line with voting power
            const neuronLines = votedNeurons.map(vote => {
                const neuronId = vote.neuron_id?.id;
                const votingPower = vote.voting_power ? Number(vote.voting_power) : 0;
                
                let neuronIdStr = 'unknown';
                if (neuronId && neuronId.length > 0) {
                    // Convert Uint8Array to hex string and truncate for display
                    const idStr = Array.from(neuronId).map(b => b.toString(16).padStart(2, '0')).join('');
                    neuronIdStr = idStr.length > 8 ? idStr.substring(0, 8) + '...' : idStr;
                }
                
                return `${neuronIdStr}: ${formatVotingPowerDisplay(votingPower)} VP`;
            });
            
            const neuronList = neuronLines.join('\n');
            return `Recant ${voteTypeText} from ${votedNeurons.length} neuron${votedNeurons.length > 1 ? 's' : ''}:\n${neuronList}`;
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

    // Ensure ancestor posts are expanded when in post mode
    useEffect(() => {
        if (mode === 'post' && focusedPostId && discussionPosts.length > 0) {
            const focusedPost = discussionPosts.find(p => Number(p.id) === Number(focusedPostId));
            if (!focusedPost) return;
            
            console.log('ThreadViewer: Ensuring ancestors are expanded for focused post:', focusedPostId);
            
            // Find all ancestor post IDs and include the focused post itself
            const postsToExpand = new Set();
            
            // Always expand the focused post itself
            postsToExpand.add(Number(focusedPostId));
            
            // Add all ancestors
            let currentPost = focusedPost;
            while (currentPost && currentPost.reply_to_post_id && currentPost.reply_to_post_id.length > 0) {
                const parentId = Number(currentPost.reply_to_post_id[0]);
                postsToExpand.add(parentId);
                currentPost = discussionPosts.find(p => Number(p.id) === parentId);
            }
            
            console.log('Posts to expand:', Array.from(postsToExpand));
            
            // Force expand focused post and all ancestor posts
            if (postsToExpand.size > 0) {
                setCollapsedPosts(prevCollapsed => {
                    const newCollapsed = new Set(prevCollapsed);
                    let changed = false;
                    
                    postsToExpand.forEach(postId => {
                        const post = discussionPosts.find(p => Number(p.id) === postId);
                        if (post) {
                            const score = Number(post.upvote_score || 0) - Number(post.downvote_score || 0);
                            const isNegative = score < 0;
                            
                            console.log(`Post ${postId}: score=${score}, isNegative=${isNegative}, wasToggled=${newCollapsed.has(postId)}`);
                            
                            if (isNegative) {
                                // For negative posts, add to collapsed set to expand them (opposite of default)
                                if (!newCollapsed.has(postId)) {
                                    newCollapsed.add(postId);
                                    changed = true;
                                    console.log(`Added negative post ${postId} to collapsed set to expand it`);
                                }
                            } else {
                                // For positive posts, remove from collapsed set to expand them (same as default)
                                if (newCollapsed.has(postId)) {
                                    newCollapsed.delete(postId);
                                    changed = true;
                                    console.log(`Removed positive post ${postId} from collapsed set to expand it`);
                                }
                            }
                        }
                    });
                    
                    return changed ? newCollapsed : prevCollapsed;
                });
            }
        }
    }, [mode, focusedPostId, discussionPosts]);

    // Get posts for display based on view mode
    const displayPosts = React.useMemo(() => {
        const posts = getDisplayPosts();
        
        if (viewMode === 'flat') {
            // For flat view, flatten all posts and apply sorting
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
            
            // Apply sorting to flattened posts
            return sortPosts(flattenPosts(posts));
        }
        
        // For tree view, apply sorting to each level of the hierarchy
        const applySortingToTree = (posts) => {
            if (!posts || posts.length === 0) return posts;
            
            // Sort posts at current level
            const sortedPosts = sortPosts(posts);
            
            // Recursively sort replies
            return sortedPosts.map(post => ({
                ...post,
                replies: post.replies && post.replies.length > 0 
                    ? applySortingToTree(post.replies)
                    : post.replies
            }));
        };
        
        return applySortingToTree(posts);
    }, [getDisplayPosts, viewMode, sortPosts]);

    // Effect to fetch principal display info
    useEffect(() => {
        const fetchPrincipalInfo = async () => {
            if (!principalNames || !principalNicknames) return;

            const uniquePrincipals = new Set();
            
            // Add thread creator principal
            if (threadDetails && threadDetails.created_by) {
                uniquePrincipals.add(threadDetails.created_by.toString());
            }
            
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
    }, [discussionPosts, postTips, principalNames, principalNicknames, threadDetails]);

    // Check for proposal link when thread details are loaded
    useEffect(() => {
        if (threadDetails && threadId) {
            checkProposalLink();
        }
    }, [threadDetails, threadId, checkProposalLink]);

    // Get display title
    const getDisplayTitle = () => {
        if (title) return title;
        if (mode === 'post' && focusedPostId) {
            // For post mode, show the thread title instead of the post title
            if (threadDetails && threadDetails.title) {
                return threadDetails.title;
            }
            return `Thread #${threadId}`;
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
                        <p style={{ whiteSpace: 'pre-wrap', color: theme.colors.secondaryText }}>{threadDetails.body}</p>
                    </div>
                )}
                
                {/* Thread Polls */}
                {threadPolls.length > 0 && threadPolls.map(poll => (
                    <Poll
                        key={poll.id}
                        poll={poll}
                        onPollUpdate={async () => await refreshPoll(poll.id)}
                        textLimits={textLimits}
                        selectedNeurons={getSelectedNeurons()}
                        allNeurons={allNeurons}
                        totalVotingPower={totalVotingPower}
                    />
                ))}
                
                {/* Create Poll for Thread Button */}
                {identity && threadDetails && threadDetails.created_by && 
                 threadDetails.created_by.toString() === identity.getPrincipal().toString() && 
                 threadPolls.length === 0 && !showPollForm.get('thread') && (
                    <button
                        onClick={() => setShowPollForm(prev => new Map(prev.set('thread', true)))}
                        style={{
                            backgroundColor: theme.colors.accent,
                            color: theme.colors.primaryText,
                            border: 'none',
                            borderRadius: '4px',
                            padding: '8px 16px',
                            cursor: 'pointer',
                            fontSize: '14px',
                            marginTop: '10px',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '8px'
                        }}
                    >
                        📊 Add Poll to Thread
                    </button>
                )}
                
                {/* Create Poll Form for Thread */}
                {showPollForm.get('thread') && (
                    <Poll
                        showCreateForm={true}
                        onCreatePoll={handlePollCreated}
                        onCancelCreate={() => setShowPollForm(prev => {
                            const newMap = new Map(prev);
                            newMap.delete('thread');
                            return newMap;
                        })}
                        threadId={threadId}
                        textLimits={textLimits}
                        selectedNeurons={getSelectedNeurons()}
                        allNeurons={allNeurons}
                        totalVotingPower={totalVotingPower}
                    />
                )}
                {threadDetails && threadDetails.created_by && (
                    <div className="thread-creator" style={{
                        marginTop: '10px',
                        padding: '8px 0',
                        borderTop: '1px solid #3a3a3a',
                        fontSize: '0.9rem',
                        color: theme.colors.secondaryText
                    }}>
                        <span>Created by: </span>
                        <PrincipalDisplay 
                            principal={threadDetails.created_by}
                            displayInfo={principalDisplayInfo.get(threadDetails.created_by.toString())}
                            showCopyButton={false}
                            short={true}
                            style={{ color: theme.colors.accent, fontWeight: '500' }}
                            isAuthenticated={isAuthenticated}
                        />
                        {threadDetails.created_at && (
                            <span style={{ marginLeft: '12px', color: theme.colors.mutedText }}>
                                {new Date(Number(threadDetails.created_at / 1000000n)).toLocaleDateString()}
                            </span>
                        )}
                    </div>
                )}
                {proposalInfo && (
                    <div className="proposal-info" style={{
                        marginTop: '10px',
                        padding: '12px',
                        backgroundColor: 'rgba(52, 152, 219, 0.1)',
                        border: '1px solid rgba(52, 152, 219, 0.3)',
                        borderRadius: '6px',
                        fontSize: '0.9rem'
                    }}>
                        <div style={{ 
                            color: theme.colors.accent,
                            fontWeight: '600',
                            marginBottom: '4px',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '8px'
                        }}>
                            <span>📋</span>
                            <span>Proposal Discussion</span>
                        </div>
                        <div style={{ color: theme.colors.secondaryText }}>
                            This thread is discussing{' '}
                            {hideProposalLink ? (
                                <span style={{
                                    color: theme.colors.accent,
                                    fontWeight: '500'
                                }}>
                                    Proposal #{proposalInfo.proposalId}
                                    {proposalInfo.proposalData?.proposal?.[0]?.title && 
                                        `: ${proposalInfo.proposalData.proposal[0].title}`}
                                </span>
                            ) : (
                                <a 
                                    href={`/proposal?proposalid=${proposalInfo.proposalId}&sns=${proposalInfo.snsRoot || selectedSnsRoot || ''}`}
                                    style={{
                                        color: theme.colors.accent,
                                        textDecoration: 'none',
                                        fontWeight: '500'
                                    }}
                                    onMouseEnter={(e) => e.target.style.textDecoration = 'underline'}
                                    onMouseLeave={(e) => e.target.style.textDecoration = 'none'}
                                >
                                    Proposal #{proposalInfo.proposalId}
                                    {proposalInfo.proposalData?.proposal?.[0]?.title && 
                                        `: ${proposalInfo.proposalData.proposal[0].title}`}
                                </a>
                            )}
                            {!proposalInfo.proposalData && (
                                <span style={{ color: theme.colors.mutedText, fontSize: '0.8rem', marginLeft: '8px' }}>
                                    (Loading proposal details...)
                                </span>
                            )}
                        </div>
                    </div>
                )}
                {mode === 'post' && focusedPostId && (
                    <div className="post-focus-info" style={{
                        backgroundColor: theme.colors.secondaryBg,
                        border: `1px solid ${theme.colors.border}`,
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
                                    color: theme.colors.accent,
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
                                color: theme.colors.accent,
                                fontSize: '13px',
                                textDecoration: 'none',
                                fontWeight: '500',
                                padding: '4px 8px',
                                borderRadius: '3px',
                                backgroundColor: theme.colors.primaryBg,
                                transition: 'background-color 0.2s'
                            }}
                            onMouseEnter={(e) => e.target.style.backgroundColor = theme.colors.accentHover}
                            onMouseLeave={(e) => e.target.style.backgroundColor = theme.colors.primaryBg}
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
                                backgroundColor: theme.colors.accent,
                                color: theme.colors.primaryText,
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
                                    backgroundColor: theme.colors.secondaryBg,
                                    color: theme.colors.primaryText,
                                    border: `1px solid ${textLimits && commentTitle.length > textLimits.max_title_length ? theme.colors.error : '#444'}`,
                                    borderRadius: '4px',
                                    padding: '10px',
                                    marginBottom: '5px',
                                    fontSize: '14px'
                                }}
                            />
                            {textLimits && (
                                <div style={{
                                    fontSize: '12px',
                                    color: commentTitle.length > textLimits.max_title_length ? theme.colors.error : 
                                           (textLimits.max_title_length - commentTitle.length) < 20 ? theme.colors.warning : theme.colors.mutedText,
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
                                    backgroundColor: theme.colors.secondaryBg,
                                    color: theme.colors.primaryText,
                                    border: `1px solid ${textLimits && commentText.length > textLimits.max_body_length ? theme.colors.error : '#444'}`,
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
                                    color: commentText.length > textLimits.max_body_length ? theme.colors.error : 
                                           (textLimits.max_body_length - commentText.length) < 100 ? theme.colors.warning : theme.colors.mutedText,
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
                                        color: theme.colors.primaryText,
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
                                                                        commentText.length > textLimits.max_body_length))) ? '#666' : theme.colors.success,
                                        color: theme.colors.primaryText,
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
                    <button 
                        onClick={() => setShowSettings(!showSettings)}
                        className={showSettings ? 'active' : ''}
                        style={{ marginLeft: '10px' }}
                    >
                        ⚙️ Settings
                    </button>
                </div>
            </div>

            {/* Settings Panel */}
            {showSettings && (
                <div style={{
                    backgroundColor: theme.colors.secondaryBg,
                    border: `1px solid ${theme.colors.border}`,
                    borderRadius: '10px',
                    padding: '20px',
                    marginBottom: '20px',
                    backdropFilter: 'blur(10px)'
                }}>
                    <h3 style={{
                        color: theme.colors.accent,
                        fontSize: '1.2rem',
                        fontWeight: '600',
                        marginBottom: '20px',
                        margin: 0
                    }}>
                        Thread Settings
                    </h3>
                    
                    {/* Sorting Options */}
                    <div style={{ marginBottom: '25px' }}>
                        <h4 style={{
                            color: theme.colors.primaryText,
                            fontSize: '1rem',
                            fontWeight: '500',
                            marginBottom: '10px',
                            margin: '0 0 10px 0'
                        }}>
                            Sort Posts By
                        </h4>
                        <div style={{
                            display: 'grid',
                            gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
                            gap: '8px'
                        }}>
                            {[
                                { value: 'age-newest', label: '📅 Newest First' },
                                { value: 'age-oldest', label: '📅 Oldest First' },
                                { value: 'score-best', label: '⭐ Best Score' },
                                { value: 'score-worst', label: '👎 Worst Score' },
                                { value: 'score-controversial', label: '🔥 Most Active' }
                            ].map(option => (
                                <label 
                                    key={option.value}
                                    style={{
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: '6px',
                                        padding: '8px 12px',
                                        backgroundColor: sortBy === option.value ? theme.colors.accentHover : theme.colors.secondaryBg,
                                        border: `1px solid ${sortBy === option.value ? theme.colors.accent : theme.colors.border}`,
                                        borderRadius: '6px',
                                        cursor: 'pointer',
                                        fontSize: '0.85rem',
                                        transition: 'all 0.2s ease'
                                    }}
                                    onMouseEnter={(e) => {
                                        if (sortBy !== option.value) {
                                            e.target.style.backgroundColor = theme.colors.accentHover;
                                        }
                                    }}
                                    onMouseLeave={(e) => {
                                        if (sortBy !== option.value) {
                                            e.target.style.backgroundColor = theme.colors.secondaryBg;
                                        }
                                    }}
                                >
                                    <input
                                        type="radio"
                                        name="sortBy"
                                        value={option.value}
                                        checked={sortBy === option.value}
                                        onChange={(e) => {
                                            setSortBy(e.target.value);
                                            try {
                                                localStorage.setItem('threadSortBy', e.target.value);
                                            } catch (error) {
                                                console.warn('Could not save sort preference to localStorage:', error);
                                            }
                                        }}
                                        style={{
                                            margin: 0,
                                            accentColor: theme.colors.accent
                                        }}
                                    />
                                    <span style={{ 
                                        color: sortBy === option.value ? theme.colors.primaryText : theme.colors.secondaryText,
                                        fontWeight: sortBy === option.value ? '500' : '400'
                                    }}>
                                        {option.label}
                                    </span>
                                </label>
                            ))}
                        </div>
                    </div>
                    
                    {/* Voting Neurons Section */}
                    <div style={{ borderTop: `1px solid ${theme.colors.border}`, paddingTop: '20px' }}>
                        <h4 style={{
                            color: theme.colors.primaryText,
                            fontSize: '1rem',
                            fontWeight: '500',
                            marginBottom: '10px',
                            margin: '0 0 10px 0'
                        }}>
                            Voting Neurons
                        </h4>
                        <p style={{
                            color: theme.colors.secondaryText,
                            fontSize: '0.9rem',
                            marginBottom: '15px',
                            margin: '0 0 15px 0'
                        }}>
                            Select which neurons to use when voting on posts
                        </p>
                    </div>
                    
                    {allNeurons && allNeurons.length > 0 ? (
                        <div style={{
                            display: 'grid',
                            gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
                            gap: '10px'
                        }}>
                            {allNeurons.map(neuron => {
                                const neuronId = neuron.id[0].id ? Array.from(neuron.id[0].id).join(',') : '';
                                const isSelected = selectedNeuronIds.has(neuronId);
                                const neuronVotingPower = calculateVotingPower(neuron);
                                
                                return (
                                    <label 
                                        key={neuronId}
                                        style={{
                                            display: 'flex',
                                            alignItems: 'center',
                                            gap: '8px',
                                            padding: '8px 12px',
                                            backgroundColor: isSelected ? theme.colors.accentHover : theme.colors.secondaryBg,
                                            border: `1px solid ${isSelected ? theme.colors.warning : theme.colors.border}`,
                                            borderRadius: '6px',
                                            cursor: 'pointer',
                                            transition: 'all 0.2s ease'
                                        }}
                                        onMouseEnter={(e) => {
                                            if (!isSelected) {
                                                e.target.style.backgroundColor = theme.colors.accentHover;
                                            }
                                        }}
                                        onMouseLeave={(e) => {
                                            if (!isSelected) {
                                                e.target.style.backgroundColor = theme.colors.secondaryBg;
                                            }
                                        }}
                                    >
                                        <input
                                            type="checkbox"
                                            checked={isSelected}
                                            onChange={() => handleNeuronToggle(neuronId)}
                                            style={{
                                                accentColor: '#ffd700',
                                                width: '16px',
                                                height: '16px'
                                            }}
                                        />
                                        <div style={{ flex: 1 }}>
                                            <div style={{
                                                color: theme.colors.primaryText,
                                                fontSize: '0.9rem',
                                                fontWeight: '500'
                                            }}>
                                                Neuron {neuron.id[0].id ? 
                                                    Array.from(neuron.id[0].id).slice(0, 8).map(b => b.toString(16).padStart(2, '0')).join('') 
                                                    : 'Unknown'
                                                }...
                                            </div>
                                            <div style={{
                                                color: theme.colors.mutedText,
                                                fontSize: '0.8rem'
                                            }}>
                                                {formatVotingPowerDisplay(neuronVotingPower)} VP
                                            </div>
                                        </div>
                                    </label>
                                );
                            })}
                        </div>
                    ) : (
                        <div style={{
                            color: theme.colors.mutedText,
                            fontSize: '0.9rem',
                            textAlign: 'center',
                            padding: '20px'
                        }}>
                            No neurons available for voting
                        </div>
                    )}
                    
                    <div style={{
                        marginTop: '15px',
                        padding: '10px',
                        backgroundColor: 'rgba(255, 215, 0, 0.1)',
                        border: '1px solid rgba(255, 215, 0, 0.3)',
                        borderRadius: '6px',
                        fontSize: '0.85rem',
                        color: theme.colors.primaryText
                    }}>
                        <strong>Total Selected Voting Power:</strong> {formatVotingPowerDisplay(totalVotingPower)}
                    </div>
                </div>
            )}

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
        const isUnread = isPostUnread(post);
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
                    backgroundColor: isUnread ? theme.colors.accentHover : (isNegative ? theme.colors.primaryBg : (isFocused ? theme.colors.accentHover : theme.colors.secondaryBg)),
                    borderColor: isUnread ? theme.colors.accent : (isFocused ? theme.colors.accent : (isNegative ? theme.colors.error : theme.colors.border)),
                    borderWidth: isUnread ? '2px' : (isFocused ? '2px' : '1px'),
                    borderStyle: 'solid',
                    borderRadius: '6px',
                    padding: '15px',
                    marginBottom: '10px',
                    position: 'relative'
                }}
            >

                {/* Post content - simplified for now */}
                <div className="post-content">
                    <div className="thread-post-header" style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'flex-start',
                        gap: '8px',
                        flexWrap: 'wrap',
                        wordBreak: 'break-word',
                        overflowWrap: 'anywhere'
                    }}>
                        {/* Collapse button - flows inline with other elements */}
                        {!isFlat && (
                            <span
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
                                    color: theme.colors.mutedText,
                                    cursor: 'pointer',
                                    fontSize: '12px',
                                    userSelect: 'none',
                                    flexShrink: 0
                                }}
                                title={isCollapsed ? 'Expand post' : 'Collapse post'}
                            >
                                {isCollapsed ? '▶' : '▼'}
                            </span>
                        )}
                        <a 
                            href={`/post?postid=${post.id}${selectedSnsRoot ? `&sns=${selectedSnsRoot}` : ''}`}
                            className="post-id"
                            style={{
                                color: theme.colors.accent,
                                textDecoration: 'none',
                                fontWeight: '500',
                                flexShrink: 0
                            }}
                            onMouseEnter={(e) => e.target.style.textDecoration = 'underline'}
                            onMouseLeave={(e) => e.target.style.textDecoration = 'none'}
                        >
                            #{isNarrowScreen ? '' : post.id.toString()}
                        </a>
                        {post.title && <h4 style={{ margin: 0, wordBreak: 'break-word', overflowWrap: 'anywhere' }}>{post.title}</h4>}
                        {isUnread && (
                            <span style={{
                                backgroundColor: theme.colors.error,
                                color: 'white',
                                fontSize: '0.65rem',
                                padding: '2px 6px',
                                borderRadius: '10px',
                                fontWeight: 'bold',
                                flexShrink: 0
                            }}>
                                UNREAD
                            </span>
                        )}
                        <span style={{ wordBreak: 'break-word', overflowWrap: 'anywhere' }}><PrincipalDisplay 
                            principal={post.created_by} 
                            displayInfo={principalDisplayInfo.get(post.created_by?.toString())}
                            showCopyButton={false}
                            short={true}
                            isAuthenticated={isAuthenticated}
                        /></span>
                        <span style={{ wordBreak: 'break-word', overflowWrap: 'anywhere' }}>
                            {isNarrowScreen 
                                ? new Date(Number(post.created_at) / 1000000).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
                                : new Date(Number(post.created_at) / 1000000).toLocaleString()
                            }
                        </span>
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
                                        <button 
                                            onClick={() => {
                                                const parentPostId = Number(post.reply_to_post_id[0]);
                                                // First try to find by data attribute or class
                                                let parentElement = document.querySelector(`[data-post-id="${parentPostId}"]`) ||
                                                                  document.querySelector(`a[href*="postid=${parentPostId}"]`)?.closest('.post-item');
                                                
                                                // If not found, look through all post items for one containing a link to this post
                                                if (!parentElement) {
                                                    const postItems = document.querySelectorAll('.post-item');
                                                    for (const item of postItems) {
                                                        const postLink = item.querySelector(`a[href*="postid=${parentPostId}"]`);
                                                        if (postLink) {
                                                            parentElement = item;
                                                            break;
                                                        }
                                                    }
                                                }
                                                
                                                if (parentElement) {
                                                    parentElement.scrollIntoView({ 
                                                        behavior: 'smooth', 
                                                        block: 'center' 
                                                    });
                                                    console.log(`Scrolled to parent post #${parentPostId}`);
                                                } else {
                                                    console.log(`Could not find parent post #${parentPostId} to scroll to`);
                                                    // Fallback: navigate to post page
                                                    window.location.href = `/post?postid=${parentPostId}${selectedSnsRoot ? `&sns=${selectedSnsRoot}` : ''}`;
                                                }
                                            }}
                                            style={{
                                                background: 'none',
                                                border: 'none',
                                                color: theme.colors.accent,
                                                textDecoration: 'none',
                                                fontWeight: '500',
                                                cursor: 'pointer',
                                                padding: 0,
                                                font: 'inherit'
                                            }}
                                            onMouseEnter={(e) => e.target.style.textDecoration = 'underline'}
                                            onMouseLeave={(e) => e.target.style.textDecoration = 'none'}
                                        >
                                            Reply to #{Number(post.reply_to_post_id[0])}: {parentDerivedTitle}
                                        </button>
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
                                    <p style={{ whiteSpace: 'pre-wrap', color: theme.colors.primaryText }}>{post.body}</p>
                                </div>
                            )}
                            
                            {/* Post Polls */}
                            {postPolls.get(Number(post.id))?.map(poll => (
                                <Poll
                                    key={poll.id}
                                    poll={poll}
                                    onPollUpdate={async () => await refreshPoll(poll.id)}
                                    textLimits={textLimits}
                                    selectedNeurons={getSelectedNeurons()}
                                    allNeurons={allNeurons}
                                    totalVotingPower={totalVotingPower}
                                />
                            ))}
                            
                            {/* Tips Display */}
                            {postTips[Number(post.id)] && postTips[Number(post.id)].length > 0 && (
                                <TipDisplay 
                                    tips={postTips[Number(post.id)]}
                                    principalDisplayInfo={principalDisplayInfo}
                                    isNarrowScreen={isNarrowScreen}
                                />
                            )}

                            {/* Action Buttons - Only show for authenticated users */}
                            {isAuthenticated && (
                        <div style={{
                            display: 'flex',
                            gap: '8px',
                            marginTop: '10px',
                            paddingTop: '10px',
                            borderTop: '1px solid #333',
                            flexWrap: 'wrap'
                        }}>
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
                                    ▲{isNarrowScreen ? '' : ` ${votingStates.get(post.id.toString()) === 'voting' ? '...' : 
                                        totalVotingPower === 0 ? 'No VP' : 
                                        `${formatVotingPowerDisplay(totalVotingPower)}`}`}
                                </button>

                                {/* Score Display - Shows total post score */}
                                <span style={{ 
                                    color: (Number(post.upvote_score) - Number(post.downvote_score)) > 0 ? '#6b8e6b' : 
                                           (Number(post.upvote_score) - Number(post.downvote_score)) < 0 ? '#b85c5c' : theme.colors.mutedText,
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
                                    ▼{isNarrowScreen ? '' : ` ${votingStates.get(post.id.toString()) === 'voting' ? '...' : 
                                        totalVotingPower === 0 ? 'No VP' : 
                                        `${formatVotingPowerDisplay(totalVotingPower)}`}`}
                                </button>
                            </div>

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
                                title={replyingTo === Number(post.id) ? 'Cancel reply' : 'Reply to this post'}
                            >
                                💬 {isNarrowScreen ? '' : (replyingTo === Number(post.id) ? ' Cancel Reply' : ' Reply')}
                            </button>

                            {/* Tip Button - Only show for posts by other users */}
                            {identity && post.created_by.toString() !== identity.getPrincipal().toString() && (
                                <button
                                    onClick={() => openTipModal(post)}
                                    style={{
                                        backgroundColor: 'transparent',
                                        border: 'none',
                                        color: theme.colors.warning,
                                        borderRadius: '4px',
                                        padding: '4px 8px',
                                        cursor: 'pointer',
                                        fontSize: '12px',
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: '4px'
                                    }}
                                    title="Send a tip to the post author"
                                >
                                    💰{isNarrowScreen ? '' : ' Tip'}
                                </button>
                            )}

                            {/* Send Message Button - Only show for posts by other users */}
                            {identity && post.created_by.toString() !== identity.getPrincipal().toString() && (
                                <button
                                    onClick={() => {
                                        const recipientPrincipal = post.created_by.toString();
                                        navigate(`/sms?recipient=${encodeURIComponent(recipientPrincipal)}`);
                                    }}
                                    style={{
                                        backgroundColor: 'transparent',
                                        border: 'none',
                                        color: theme.colors.success,
                                        borderRadius: '4px',
                                        padding: '4px 8px',
                                        cursor: 'pointer',
                                        fontSize: '12px',
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: '4px'
                                    }}
                                    title="Send a private message to the post author"
                                >
                                    📨{isNarrowScreen ? '' : ' Message'}
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
                                    title="Edit this post"
                                >
                                    ✏️{isNarrowScreen ? '' : ' Edit'}
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
                                        color: deletingPost === Number(post.id) ? theme.colors.mutedText : theme.colors.error,
                                        borderRadius: '4px',
                                        padding: '4px 8px',
                                        cursor: deletingPost === Number(post.id) ? 'not-allowed' : 'pointer',
                                        fontSize: '12px',
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: '4px'
                                    }}
                                    title={deletingPost === Number(post.id) ? 'Deleting post...' : 'Delete this post'}
                                >
                                    🗑️{isNarrowScreen ? '' : ` ${deletingPost === Number(post.id) ? 'Deleting...' : 'Delete'}`}
                                </button>
                            )}

                            {/* Add Poll Button - Show for post owner if no poll exists */}
                            {identity && post.created_by.toString() === identity.getPrincipal().toString() && 
                             !postPolls.get(Number(post.id))?.length && !showPollForm.get(Number(post.id)) && (
                                <button
                                    onClick={() => setShowPollForm(prev => new Map(prev.set(Number(post.id), true)))}
                                    style={{
                                        backgroundColor: 'transparent',
                                        border: 'none',
                                        color: theme.colors.accent,
                                        borderRadius: '4px',
                                        padding: '4px 8px',
                                        cursor: 'pointer',
                                        fontSize: '12px',
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: '4px'
                                    }}
                                    title="Add a poll to this post"
                                >
                                    📊{isNarrowScreen ? '' : ' Add Poll'}
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

                    {/* Poll Creation Form */}
                    {showPollForm.get(Number(post.id)) && (
                        <Poll
                            showCreateForm={true}
                            onCreatePoll={handlePollCreated}
                            onCancelCreate={() => setShowPollForm(prev => {
                                const newMap = new Map(prev);
                                newMap.delete(Number(post.id));
                                return newMap;
                            })}
                            threadId={threadId}
                            postId={Number(post.id)}
                            textLimits={textLimits}
                            selectedNeurons={getSelectedNeurons()}
                            allNeurons={allNeurons}
                            totalVotingPower={totalVotingPower}
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
