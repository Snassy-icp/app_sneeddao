import React, { useState, useEffect, useCallback, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import { Principal } from '@dfinity/principal';
import { PrincipalDisplay, getPrincipalDisplayInfoFromContext } from '../utils/PrincipalUtils';
import { useNaming } from '../NamingContext';
import { useWalletOptional } from '../contexts/WalletContext';
import { getSnsById } from '../utils/SnsUtils';
import { createActor as createRllActor, canisterId as rllCanisterId } from 'declarations/rll';
import { useAuth } from '../AuthContext';
import { useAdminCheck } from '../hooks/useAdminCheck';
import { useTextLimits } from '../hooks/useTextLimits';
import { calculateVotingPower, formatVotingPower } from '../utils/VotingPowerUtils';
import TipModal from './TipModal';
import TipDisplay from './TipDisplay';
import { createTip, getTipsByPost } from '../utils/BackendUtils';
import { useTokens } from '../hooks/useTokens';
import { formatError } from '../utils/errorUtils';
import { createActor as createLedgerActor } from 'external/icrc1_ledger';
import { useTheme } from '../contexts/ThemeContext';
import { FaCommentAlt, FaReply, FaEdit, FaTrash, FaCoins, FaArrowUp, FaArrowDown, FaUndo, FaSpinner, FaCheck, FaTimes, FaPlus, FaMinus, FaEye, FaSitemap, FaCheckCircle, FaKey } from 'react-icons/fa';

// Accent colors
const accentPrimary = '#06b6d4'; // Cyan to match discussion section in Proposal
const accentSecondary = '#0891b2';

// Add CSS for spinner animation
const spinnerStyles = `
@keyframes spin {
    0% { transform: rotate(0deg); }
    100% { transform: rotate(360deg); }
}
@keyframes fadeIn {
    from { opacity: 0; transform: translateY(10px); }
    to { opacity: 1; transform: translateY(0); }
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
const ReplyForm = ({ postId, onSubmit, onCancel, submittingComment, createdBy, principalDisplayInfo, textLimits, theme }) => {
    const [replyText, setReplyText] = useState('');
    
    const displayInfo = principalDisplayInfo?.get(createdBy?.toString());
    const displayName = displayInfo?.displayName || createdBy.toString().slice(0, 8) + '...';
    
    const maxLength = textLimits?.max_comment_length || 5000;
    const isOverLimit = replyText.length > maxLength;
    const remainingChars = maxLength - replyText.length;
    
    return (
        <div style={{ 
            marginTop: '1rem', 
            padding: '1rem', 
            background: theme.colors.primaryBg, 
            borderRadius: '10px',
            border: `1px solid ${theme.colors.border}`
        }}>
            <div style={{ 
                color: theme.colors.mutedText, 
                fontSize: '0.85rem', 
                marginBottom: '0.75rem',
                display: 'flex',
                alignItems: 'center',
                gap: '0.5rem'
            }}>
                <FaReply size={12} />
                Replying to {displayName}
            </div>
            <textarea
                value={replyText}
                onChange={(e) => setReplyText(e.target.value)}
                placeholder={`Write your reply...`}
                style={{
                    width: '100%',
                    minHeight: '80px',
                    background: theme.colors.secondaryBg,
                    border: `1px solid ${isOverLimit ? theme.colors.error : theme.colors.border}`,
                    borderRadius: '8px',
                    color: theme.colors.primaryText,
                    padding: '0.75rem',
                    fontSize: '0.9rem',
                    resize: 'vertical',
                    marginBottom: '0.5rem',
                    boxSizing: 'border-box'
                }}
            />
            <div style={{ 
                fontSize: '0.75rem', 
                color: isOverLimit ? theme.colors.error : remainingChars < 100 ? '#f39c12' : theme.colors.mutedText,
                marginBottom: '0.75rem',
                textAlign: 'right'
            }}>
                {replyText.length}/{maxLength} characters
                {isOverLimit && <span style={{ marginLeft: '0.5rem' }}>({Math.abs(remainingChars)} over limit)</span>}
            </div>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
                <button
                    onClick={() => onSubmit(replyText)}
                    disabled={!replyText.trim() || submittingComment || isOverLimit}
                    style={{
                        padding: '0.5rem 1rem',
                        background: (replyText.trim() && !submittingComment && !isOverLimit) 
                            ? `linear-gradient(135deg, ${accentPrimary}, ${accentSecondary})`
                            : theme.colors.mutedText,
                        color: 'white',
                        border: 'none',
                        borderRadius: '8px',
                        cursor: (replyText.trim() && !submittingComment && !isOverLimit) ? 'pointer' : 'not-allowed',
                        fontSize: '0.85rem',
                        fontWeight: '500',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.5rem'
                    }}
                >
                    {submittingComment ? <><FaSpinner className="spin" size={12} /> Submitting...</> : <><FaReply size={12} /> Submit Reply</>}
                </button>
                <button
                    onClick={onCancel}
                    style={{
                        padding: '0.5rem 1rem',
                        background: 'transparent',
                        color: theme.colors.secondaryText,
                        border: `1px solid ${theme.colors.border}`,
                        borderRadius: '8px',
                        cursor: 'pointer',
                        fontSize: '0.85rem'
                    }}
                >
                    Cancel
                </button>
            </div>
        </div>
    );
};

// Separate EditForm component to prevent PostComponent re-renders
const EditForm = ({ initialTitle, initialBody, onSubmit, onCancel, submittingEdit, textLimits, theme }) => {
    const [title, setTitle] = useState(initialTitle || '');
    const [body, setBody] = useState(initialBody || '');
    
    const maxTitleLength = textLimits?.max_title_length || 200;
    const maxBodyLength = textLimits?.max_body_length || 10000;
    const isTitleOverLimit = title.length > maxTitleLength;
    const isBodyOverLimit = body.length > maxBodyLength;
    const isOverLimit = isTitleOverLimit || isBodyOverLimit;
    
    return (
        <div style={{ 
            marginTop: '1rem', 
            padding: '1rem', 
            background: theme.colors.primaryBg, 
            borderRadius: '10px',
            border: `1px solid ${theme.colors.border}`
        }}>
            <div style={{ 
                color: '#f39c12', 
                fontSize: '0.9rem', 
                marginBottom: '0.75rem',
                fontWeight: '600',
                display: 'flex',
                alignItems: 'center',
                gap: '0.5rem'
            }}>
                <FaEdit size={14} />
                Edit Post
            </div>
            <input
                type="text"
                placeholder="Post Title (optional)"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                style={{
                    width: '100%',
                    background: theme.colors.secondaryBg,
                    border: `1px solid ${isTitleOverLimit ? theme.colors.error : theme.colors.border}`,
                    borderRadius: '8px',
                    color: theme.colors.primaryText,
                    padding: '0.75rem',
                    fontSize: '0.9rem',
                    marginBottom: '0.5rem',
                    boxSizing: 'border-box'
                }}
            />
            <div style={{ 
                fontSize: '0.75rem', 
                color: isTitleOverLimit ? theme.colors.error : (maxTitleLength - title.length) < 20 ? '#f39c12' : theme.colors.mutedText,
                marginBottom: '0.75rem',
                textAlign: 'right'
            }}>
                Title: {title.length}/{maxTitleLength}
                {isTitleOverLimit && <span style={{ marginLeft: '0.5rem' }}>({title.length - maxTitleLength} over)</span>}
            </div>
            <textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                placeholder="Post content..."
                style={{
                    width: '100%',
                    minHeight: '100px',
                    background: theme.colors.secondaryBg,
                    border: `1px solid ${isBodyOverLimit ? theme.colors.error : theme.colors.border}`,
                    borderRadius: '8px',
                    color: theme.colors.primaryText,
                    padding: '0.75rem',
                    fontSize: '0.9rem',
                    resize: 'vertical',
                    marginBottom: '0.5rem',
                    boxSizing: 'border-box'
                }}
            />
            <div style={{ 
                fontSize: '0.75rem', 
                color: isBodyOverLimit ? theme.colors.error : (maxBodyLength - body.length) < 100 ? '#f39c12' : theme.colors.mutedText,
                marginBottom: '0.75rem',
                textAlign: 'right'
            }}>
                Body: {body.length}/{maxBodyLength}
                {isBodyOverLimit && <span style={{ marginLeft: '0.5rem' }}>({body.length - maxBodyLength} over)</span>}
            </div>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
                <button
                    onClick={() => onSubmit(title, body)}
                    disabled={!body.trim() || submittingEdit || isOverLimit}
                    style={{
                        padding: '0.5rem 1rem',
                        background: (body.trim() && !submittingEdit && !isOverLimit) 
                            ? 'linear-gradient(135deg, #f39c12, #e67e22)'
                            : theme.colors.mutedText,
                        color: 'white',
                        border: 'none',
                        borderRadius: '8px',
                        cursor: (body.trim() && !submittingEdit && !isOverLimit) ? 'pointer' : 'not-allowed',
                        fontSize: '0.85rem',
                        fontWeight: '500',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.5rem'
                    }}
                >
                    {submittingEdit ? <><FaSpinner className="spin" size={12} /> Updating...</> : <><FaCheck size={12} /> Update Post</>}
                </button>
                <button
                    onClick={onCancel}
                    style={{
                        padding: '0.5rem 1rem',
                        background: 'transparent',
                        color: theme.colors.secondaryText,
                        border: `1px solid ${theme.colors.border}`,
                        borderRadius: '8px',
                        cursor: 'pointer',
                        fontSize: '0.85rem'
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
    onError,
    onThreadCreated 
}) {
    const { theme } = useTheme();
    const { principalNames, principalNicknames } = useNaming();
    const { identity } = useAuth();
    
    // Get user neurons from WalletContext's global cache
    const walletContext = useWalletOptional();
    const getCachedNeurons = walletContext?.getCachedNeurons;
    const neuronCacheInitialized = walletContext?.neuronCacheInitialized;
    
    // Get neurons for the selected SNS from the global cache
    const [userNeurons, setUserNeurons] = useState([]);
    const [neuronsLoading, setNeuronsLoading] = useState(true);
    
    useEffect(() => {
        if (!isAuthenticated || !identity || !selectedSnsRoot) {
            setUserNeurons([]);
            setNeuronsLoading(false);
            return;
        }
        
        const selectedSns = getSnsById(selectedSnsRoot);
        if (!selectedSns?.canisters?.governance) {
            setUserNeurons([]);
            setNeuronsLoading(false);
            return;
        }
        
        if (getCachedNeurons) {
            const neurons = getCachedNeurons(selectedSns.canisters.governance);
            setUserNeurons(neurons || []);
            setNeuronsLoading(!neuronCacheInitialized);
        } else {
            setUserNeurons([]);
            setNeuronsLoading(false);
        }
    }, [isAuthenticated, identity, selectedSnsRoot, getCachedNeurons, neuronCacheInitialized]);
    
    // Helper functions matching the old NeuronsContext API
    const getAllNeurons = useCallback(() => userNeurons, [userNeurons]);
    const getHotkeyNeurons = useCallback(() => {
        if (!identity) return [];
        return userNeurons.filter(neuron => 
            neuron.permissions?.some(p => 
                p.principal?.toString() === identity.getPrincipal().toString() &&
                p.permission_type?.includes(4) // Hotkey permission
            )
        );
    }, [identity, userNeurons]);
    
    const { textLimits, regularLimits, isPremium, loading: textLimitsLoading } = useTextLimits(forumActor);
    
    const { isAdmin } = useAdminCheck({
        identity,
        isAuthenticated,
        redirectPath: null
    });

    const { tokens: availableTokens, loading: tokensLoading, refreshTokenBalance } = useTokens(identity);
    
    const [discussionThread, setDiscussionThread] = useState(null);
    const [threadDetails, setThreadDetails] = useState(null);
    const [discussionPosts, setDiscussionPosts] = useState([]);
    const [loadingDiscussion, setLoadingDiscussion] = useState(false);
    const [commentText, setCommentText] = useState('');
    const [showCommentForm, setShowCommentForm] = useState(false);
    const [submittingComment, setSubmittingComment] = useState(false);
    const [commentTitle, setCommentTitle] = useState('');
    const [principalDisplayInfo, setPrincipalDisplayInfo] = useState(new Map());
    const [creatingFirstPost, setCreatingFirstPost] = useState(false);
    
    const [editingPost, setEditingPost] = useState(null);
    const [submittingEdit, setSubmittingEdit] = useState(false);
    
    const [viewMode, setViewMode] = useState(() => {
        try {
            return localStorage.getItem('discussionViewMode') || 'tree';
        } catch (error) {
            return 'tree';
        }
    });
    const [collapsedPosts, setCollapsedPosts] = useState(new Set());
    const [replyingTo, setReplyingTo] = useState(null);
    
    const [votingStates, setVotingStates] = useState({});
    const [userVotes, setUserVotes] = useState({});
    const [retractingStates, setRetractingStates] = useState({});

    const [tipModalOpen, setTipModalOpen] = useState(false);
    const [selectedPostForTip, setSelectedPostForTip] = useState(null);
    const [tippingState, setTippingState] = useState(false);
    const [postTips, setPostTips] = useState({});

    const hotkeyNeurons = getHotkeyNeurons() || [];
    const allNeurons = getAllNeurons() || [];

    const totalVotingPower = React.useMemo(() => {
        if (!allNeurons || allNeurons.length === 0) return 0;
        
        return allNeurons.reduce((total, neuron) => {
            try {
                const votingPower = calculateVotingPower(neuron);
                return total + votingPower;
            } catch (error) {
                return total;
            }
        }, 0);
    }, [allNeurons]);

    const formatVotingPowerDisplay = (votingPower) => {
        if (votingPower === 0) return '0';
        
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

    const fetchDiscussionThread = async () => {
        if (!forumActor || !currentProposalId || !selectedSnsRoot) return;
        
        setLoadingDiscussion(true);
        try {
            const threadMapping = await forumActor.get_proposal_thread(
                Principal.fromText(selectedSnsRoot),
                Number(currentProposalId)
            );
            
            if (threadMapping && threadMapping.length > 0) {
                const mapping = Array.isArray(threadMapping) ? threadMapping[0] : threadMapping;
                if (mapping && mapping.thread_id) {
                    setDiscussionThread(mapping);
                    
                    try {
                        const threadDetails = await forumActor.get_thread(Number(mapping.thread_id));
                        if (threadDetails && threadDetails.length > 0) {
                            setThreadDetails(threadDetails[0]);
                        } else {
                            setThreadDetails(null);
                        }
                    } catch (threadErr) {
                        setThreadDetails(null);
                    }
                    
                    await fetchDiscussionPosts(Number(mapping.thread_id));
                } else {
                    setDiscussionThread(null);
                    setThreadDetails(null);
                    setDiscussionPosts([]);
                }
            } else {
                setDiscussionThread(null);
                setThreadDetails(null);
                setDiscussionPosts([]);
            }
        } catch (err) {
            setDiscussionThread(null);
            setThreadDetails(null);
            setDiscussionPosts([]);
        } finally {
            setLoadingDiscussion(false);
        }
    };

    const fetchDiscussionPosts = async (threadId) => {
        if (!forumActor || !threadId) return;
        
        try {
            const posts = await forumActor.get_posts_by_thread(Number(threadId));
            setDiscussionPosts(posts || []);
            await fetchTipsForPosts(posts || []);
        } catch (err) {
            setDiscussionPosts([]);
        }
    };

    const fetchTipsForPosts = async (posts) => {
        if (!forumActor || !posts.length) return;
        
        try {
            const tipPromises = posts.map(async (post) => {
                try {
                    const tips = await getTipsByPost(forumActor, Number(post.id));
                    return { postId: post.id.toString(), tips };
                } catch (err) {
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

    const createProposalThread = async (firstCommentText) => {
        if (!forumActor || !currentProposalId || !selectedSnsRoot) return null;
        
        try {
            const threadInput = {
                proposal_id: Number(currentProposalId),
                sns_root_canister_id: Principal.fromText(selectedSnsRoot)
            };

            const result = await forumActor.create_proposal_thread_with_auto_setup(threadInput);
            if ('ok' in result) {
                return result.ok;
            } else {
                if (onError) onError('Failed to create discussion thread: ' + formatError(result.err));
                return null;
            }
        } catch (err) {
            if (onError) onError('Error creating proposal thread: ' + formatError(err));
            return null;
        }
    };

    const submitComment = async () => {
        if (!commentText.trim() || !forumActor) return;
        
        setSubmittingComment(true);
        try {
            let threadId = discussionThread?.thread_id;
            let newThreadCreated = false;
            
            if (!threadId) {
                threadId = await createProposalThread(commentText);
                if (!threadId) {
                    return;
                }
                newThreadCreated = true;
                
                await fetchDiscussionThread();
                
                if (onThreadCreated) {
                    onThreadCreated();
                }
                
                setCreatingFirstPost(true);
            }

            const shouldUseTitle = commentTitle && commentTitle.trim() && !commentTitle.trim().startsWith('Re: ');
            
            const result = await forumActor.create_post(
                Number(threadId),
                [],
                shouldUseTitle ? [commentTitle.trim()] : [],
                commentText
            );
            
            if ('ok' in result) {
                const postId = result.ok;
                
                setCommentText('');
                setCommentTitle('');
                setShowCommentForm(false);
                
                await fetchDiscussionPosts(Number(threadId));
                
                setCreatingFirstPost(false);
                
                if (totalVotingPower > 0) {
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
                            
                            await fetchDiscussionPosts(Number(threadId));
                            
                            setTimeout(() => {
                                setVotingStates(prev => {
                                    const newState = { ...prev };
                                    delete newState[postIdStr];
                                    return newState;
                                });
                            }, 2000);
                        } else {
                            setVotingStates(prev => {
                                const newState = { ...prev };
                                delete newState[postIdStr];
                                return newState;
                            });
                        }
                    } catch (voteErr) {
                        setVotingStates(prev => {
                            const newState = { ...prev };
                            delete newState[postIdStr];
                            return newState;
                        });
                    }
                }
            } else {
                if (onError) onError('Failed to create comment: ' + formatError(result.err));
                setCreatingFirstPost(false);
                return;
            }
        } catch (err) {
            if (onError) onError('Failed to submit comment: ' + err.message);
            setCreatingFirstPost(false);
        } finally {
            setSubmittingComment(false);
        }
    };

    const calculatePostScore = (post) => {
        const upvotes = Number(post.upvote_score);
        const downvotes = Number(post.downvote_score);
        return upvotes - downvotes;
    };

    const formatScore = (score) => {
        const scoreInTokens = score / 100000000;
        
        if (scoreInTokens === 0) {
            return '0';
        } else if (Math.abs(scoreInTokens) >= 1) {
            return scoreInTokens.toLocaleString('en-US', {
                minimumFractionDigits: 0,
                maximumFractionDigits: 2
            });
        } else {
            return scoreInTokens.toLocaleString('en-US', {
                minimumFractionDigits: 0,
                maximumFractionDigits: 8
            });
        }
    };

    const findPostById = (posts, postId) => {
        return posts.find(post => Number(post.id) === Number(postId));
    };

    const generateReplyTitle = (parentPost) => {
        return null;
    };

    const getDerivedTitle = (post, parentPost = null) => {
        if (post.title && post.title.length > 0) {
            return post.title[0];
        }
        
        if (post.reply_to_post_id && post.reply_to_post_id.length > 0) {
            if (parentPost) {
                if (parentPost.title && parentPost.title.length > 0) {
                    const parentTitle = parentPost.title[0];
                    if (parentTitle.startsWith('Re: ')) {
                        return parentTitle;
                    } else {
                        return `Re: ${parentTitle}`;
                    }
                } else {
                    const grandparentPost = parentPost.reply_to_post_id && parentPost.reply_to_post_id.length > 0
                        ? findPostById(discussionPosts, parentPost.reply_to_post_id[0])
                        : null;
                    
                    if (grandparentPost) {
                        const ancestorTitle = getDerivedTitle(parentPost, grandparentPost);
                        if (ancestorTitle.startsWith('Re: ')) {
                            return ancestorTitle;
                        } else {
                            return `Re: ${ancestorTitle}`;
                        }
                    } else {
                        if (threadDetails && threadDetails.title && threadDetails.title.length > 0) {
                            return `Re: ${threadDetails.title[0]}`;
                        } else {
                            return `Re: Thread #${threadDetails?.id || discussionThread?.thread_id || 'Unknown'}`;
                        }
                    }
                }
            } else {
                const foundParent = findPostById(discussionPosts, post.reply_to_post_id[0]);
                if (foundParent) {
                    return getDerivedTitle(post, foundParent);
                } else {
                    if (threadDetails && threadDetails.title && threadDetails.title.length > 0) {
                        return `Re: ${threadDetails.title[0]}`;
                    } else {
                        return `Re: Thread #${threadDetails?.id || discussionThread?.thread_id || 'Unknown'}`;
                    }
                }
            }
        }
        
        if (threadDetails && threadDetails.title && threadDetails.title.length > 0) {
            return `Re: ${threadDetails.title[0]}`;
        }
        
        return `Post #${post.id}`;
    };

    const organizePostsFlat = (posts) => {
        return [...posts].sort((a, b) => Number(a.id) - Number(b.id));
    };

    const organizePostsTree = (posts) => {
        const postMap = new Map();
        const rootPosts = [];
        
        posts.forEach(post => {
            postMap.set(Number(post.id), { ...post, replies: [] });
        });
        
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
        
        const sortRepliesByScore = (post) => {
            post.replies.sort((a, b) => calculatePostScore(b) - calculatePostScore(a));
            post.replies.forEach(sortRepliesByScore);
        };
        
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
            const parentPost = findPostById(discussionPosts, parentPostId);
            const replyTitle = generateReplyTitle(parentPost);
            
            const result = await forumActor.create_post(
                Number(discussionThread.thread_id),
                [Number(parentPostId)],
                [],
                replyText
            );
            
            if ('ok' in result) {
                const postId = result.ok;
                
                setReplyingTo(null);
                
                await fetchDiscussionPosts(Number(discussionThread.thread_id));
                
                if (totalVotingPower > 0) {
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
                            
                            await fetchDiscussionPosts(Number(discussionThread.thread_id));
                            
                            setTimeout(() => {
                                setVotingStates(prev => {
                                    const newState = { ...prev };
                                    delete newState[postIdStr];
                                    return newState;
                                });
                            }, 2000);
                        } else {
                            setVotingStates(prev => {
                                const newState = { ...prev };
                                delete newState[postIdStr];
                                return newState;
                            });
                        }
                    } catch (voteErr) {
                        setVotingStates(prev => {
                            const newState = { ...prev };
                            delete newState[postIdStr];
                            return newState;
                        });
                    }
                }
            } else {
                if (onError) onError('Failed to create reply: ' + formatError(result.err));
            }
        } catch (err) {
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
        
        const defaultCollapsed = isNegative;
        const isCollapsed = hasBeenManuallyToggled ? !defaultCollapsed : defaultCollapsed;
        
        const isReplying = replyingTo === Number(post.id);
        
        const parentPost = post.reply_to_post_id && post.reply_to_post_id.length > 0 
            ? findPostById(discussionPosts, post.reply_to_post_id[0])
            : null;
        
        const displayTitle = getDerivedTitle(post, parentPost);
        const hasExplicitTitle = post.title && post.title.length > 0;
        
        return (
            <div 
                key={post.id}
                style={{
                    marginBottom: '0.75rem',
                    animation: 'fadeIn 0.3s ease-out'
                }}
            >
                <div style={{
                    marginLeft: isFlat ? '0' : `${depth * 20}px`,
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: '0.5rem'
                }}>
                    {/* Collapse Button */}
                    <button
                        onClick={() => togglePostCollapse(Number(post.id))}
                        style={{
                            background: 'transparent',
                            border: `1px solid ${theme.colors.border}`,
                            color: theme.colors.mutedText,
                            borderRadius: '6px',
                            padding: '4px',
                            cursor: 'pointer',
                            width: '24px',
                            height: '24px',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            marginTop: '2px',
                            flexShrink: 0
                        }}
                    >
                        {isCollapsed ? <FaPlus size={10} /> : <FaMinus size={10} />}
                    </button>

                    <div style={{
                        background: isNegative ? `${theme.colors.error}10` : theme.colors.primaryBg,
                        border: `1px solid ${isNegative ? `${theme.colors.error}40` : theme.colors.border}`,
                        borderRadius: '12px',
                        padding: '1rem',
                        flex: 1
                    }}>
                        {/* Post Header */}
                        <div style={{ 
                            display: 'flex', 
                            justifyContent: 'space-between', 
                            alignItems: 'center',
                            marginBottom: isCollapsed ? '0' : '0.75rem',
                            flexWrap: 'wrap',
                            gap: '0.5rem'
                        }}>
                            <div style={{ 
                                color: theme.colors.mutedText, 
                                fontSize: '0.8rem',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '0.5rem',
                                flexWrap: 'wrap'
                            }}>
                                <PrincipalDisplay 
                                    principal={post.created_by} 
                                    displayInfo={principalDisplayInfo.get(post.created_by?.toString())}
                                    showCopyButton={false}
                                    isAuthenticated={isAuthenticated}
                                />
                                <span>•</span>
                                <span>{new Date(Number(post.created_at) / 1000000).toLocaleString()}</span>
                                {isFlat && parentPost && (
                                    <>
                                        <span>•</span>
                                        <span style={{ color: accentPrimary }}>
                                            Reply to #{Number(post.reply_to_post_id[0])}
                                        </span>
                                    </>
                                )}
                                {isNegative && (
                                    <span style={{ 
                                        color: theme.colors.error,
                                        background: `${theme.colors.error}20`,
                                        padding: '2px 6px',
                                        borderRadius: '4px',
                                        fontSize: '0.7rem'
                                    }}>Low Score</span>
                                )}
                                {isCollapsed && (
                                    <span style={{ 
                                        color: theme.colors.mutedText,
                                        fontStyle: 'italic',
                                        fontSize: '0.75rem'
                                    }}>
                                        {post.body.slice(0, 50)}...
                                    </span>
                                )}
                            </div>
                        </div>

                        {/* Post Content */}
                        {!isCollapsed && (
                            <>
                                {/* Title */}
                                {hasExplicitTitle ? (
                                    <div style={{ 
                                        color: theme.colors.primaryText, 
                                        fontSize: '1.1rem', 
                                        fontWeight: '600', 
                                        marginBottom: '0.75rem' 
                                    }}>
                                        {displayTitle}
                                    </div>
                                ) : (
                                    <div style={{ 
                                        color: accentPrimary, 
                                        fontSize: '0.95rem', 
                                        fontWeight: '500', 
                                        marginBottom: '0.5rem' 
                                    }}>
                                        {displayTitle}
                                    </div>
                                )}
                                
                                {/* Body */}
                                <div style={{ 
                                    color: theme.colors.primaryText, 
                                    lineHeight: '1.6', 
                                    marginBottom: '0.75rem',
                                    fontSize: '0.9rem'
                                }}>
                                    <ReactMarkdown>{post.body}</ReactMarkdown>
                                </div>

                                {/* Tips */}
                                <TipDisplay 
                                    tips={postTips[post.id.toString()] || []}
                                    tokenInfo={new Map(availableTokens.map(token => [token.principal, {
                                        symbol: token.symbol,
                                        decimals: token.decimals,
                                        logo: token.logo
                                    }]))}
                                    principalDisplayInfo={principalDisplayInfo}
                                />
                                
                                {/* Action Buttons */}
                                <div style={{ 
                                    display: 'flex', 
                                    gap: '0.5rem', 
                                    alignItems: 'center', 
                                    flexWrap: 'wrap',
                                    paddingTop: '0.5rem',
                                    borderTop: `1px solid ${theme.colors.border}`
                                }}>
                                    {/* Voting */}
                                    <div style={{ 
                                        display: 'flex', 
                                        gap: '4px', 
                                        alignItems: 'center',
                                        background: theme.colors.secondaryBg,
                                        borderRadius: '8px',
                                        padding: '4px'
                                    }}>
                                        <button
                                            onClick={isAuthenticated ? () => voteOnPost(post.id, 'upvote') : undefined}
                                            disabled={!isAuthenticated || votingStates[post.id.toString()] === 'voting' || totalVotingPower === 0}
                                            style={{
                                                background: userVotes[post.id.toString()]?.vote_type === 'upvote' ? theme.colors.success : 'transparent',
                                                border: 'none',
                                                color: userVotes[post.id.toString()]?.vote_type === 'upvote' ? 'white' : 
                                                       (!isAuthenticated || totalVotingPower === 0) ? theme.colors.mutedText : theme.colors.success,
                                                borderRadius: '6px',
                                                padding: '4px 8px',
                                                cursor: (!isAuthenticated || votingStates[post.id.toString()] === 'voting' || totalVotingPower === 0) ? 'not-allowed' : 'pointer',
                                                fontSize: '0.75rem',
                                                display: 'flex',
                                                alignItems: 'center',
                                                gap: '4px',
                                                opacity: (!isAuthenticated || totalVotingPower === 0) ? 0.5 : 1
                                            }}
                                            title={!isAuthenticated ? 'Connect to vote' : totalVotingPower === 0 ? 'Need hotkey neurons to vote' : `Vote with ${formatVotingPowerDisplay(totalVotingPower)} VP`}
                                        >
                                            <FaArrowUp size={10} />
                                        </button>

                                        <span style={{ 
                                            color: score > 0 ? theme.colors.success : score < 0 ? theme.colors.error : theme.colors.mutedText,
                                            fontSize: '0.85rem',
                                            fontWeight: '600',
                                            minWidth: '30px',
                                            textAlign: 'center'
                                        }}>
                                            {votingStates[post.id.toString()] === 'voting' ? (
                                                <FaSpinner className="spin" size={12} />
                                            ) : (
                                                (score > 0 ? '+' : '') + formatScore(score)
                                            )}
                                        </span>

                                        <button
                                            onClick={isAuthenticated ? () => voteOnPost(post.id, 'downvote') : undefined}
                                            disabled={!isAuthenticated || votingStates[post.id.toString()] === 'voting' || totalVotingPower === 0}
                                            style={{
                                                background: userVotes[post.id.toString()]?.vote_type === 'downvote' ? theme.colors.error : 'transparent',
                                                border: 'none',
                                                color: userVotes[post.id.toString()]?.vote_type === 'downvote' ? 'white' : 
                                                       (!isAuthenticated || totalVotingPower === 0) ? theme.colors.mutedText : theme.colors.error,
                                                borderRadius: '6px',
                                                padding: '4px 8px',
                                                cursor: (!isAuthenticated || votingStates[post.id.toString()] === 'voting' || totalVotingPower === 0) ? 'not-allowed' : 'pointer',
                                                fontSize: '0.75rem',
                                                display: 'flex',
                                                alignItems: 'center',
                                                gap: '4px',
                                                opacity: (!isAuthenticated || totalVotingPower === 0) ? 0.5 : 1
                                            }}
                                        >
                                            <FaArrowDown size={10} />
                                        </button>
                                    </div>

                                    {isAuthenticated && (
                                        <>
                                            <button
                                                onClick={() => isReplying ? setReplyingTo(null) : setReplyingTo(Number(post.id))}
                                                style={{
                                                    background: 'transparent',
                                                    border: 'none',
                                                    color: accentPrimary,
                                                    borderRadius: '6px',
                                                    padding: '6px 10px',
                                                    cursor: 'pointer',
                                                    fontSize: '0.8rem',
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    gap: '4px'
                                                }}
                                            >
                                                <FaReply size={12} /> {isReplying ? 'Cancel' : 'Reply'}
                                            </button>

                                            {userVotes[post.id.toString()] && (
                                                <button
                                                    onClick={() => retractVote(post.id)}
                                                    disabled={votingStates[post.id.toString()] === 'voting'}
                                                    style={{
                                                        background: 'transparent',
                                                        border: 'none',
                                                        color: '#f39c12',
                                                        borderRadius: '6px',
                                                        padding: '6px 10px',
                                                        cursor: 'pointer',
                                                        fontSize: '0.8rem',
                                                        display: 'flex',
                                                        alignItems: 'center',
                                                        gap: '4px'
                                                    }}
                                                >
                                                    <FaUndo size={12} /> Retract
                                                </button>
                                            )}

                                            {identity && (post.created_by.toString() === identity.getPrincipal().toString() || isAdmin) && (
                                                <>
                                                    <button
                                                        onClick={() => startEditPost(post)}
                                                        style={{
                                                            background: 'transparent',
                                                            border: 'none',
                                                            color: '#f39c12',
                                                            borderRadius: '6px',
                                                            padding: '6px 10px',
                                                            cursor: 'pointer',
                                                            fontSize: '0.8rem',
                                                            display: 'flex',
                                                            alignItems: 'center',
                                                            gap: '4px'
                                                        }}
                                                    >
                                                        <FaEdit size={12} /> Edit
                                                    </button>
                                                    <button
                                                        onClick={() => deletePost(post.id)}
                                                        style={{
                                                            background: 'transparent',
                                                            border: 'none',
                                                            color: theme.colors.error,
                                                            borderRadius: '6px',
                                                            padding: '6px 10px',
                                                            cursor: 'pointer',
                                                            fontSize: '0.8rem',
                                                            display: 'flex',
                                                            alignItems: 'center',
                                                            gap: '4px'
                                                        }}
                                                    >
                                                        <FaTrash size={12} /> Delete
                                                    </button>
                                                </>
                                            )}

                                            {identity && post.created_by.toString() !== identity.getPrincipal().toString() && (
                                                <button
                                                    onClick={() => openTipModal(post)}
                                                    style={{
                                                        background: 'transparent',
                                                        border: 'none',
                                                        color: '#ffd700',
                                                        borderRadius: '6px',
                                                        padding: '6px 10px',
                                                        cursor: 'pointer',
                                                        fontSize: '0.8rem',
                                                        display: 'flex',
                                                        alignItems: 'center',
                                                        gap: '4px'
                                                    }}
                                                >
                                                    <FaCoins size={12} /> Tip
                                                </button>
                                            )}

                                            {votingStates[post.id.toString()] === 'success' && (
                                                <span style={{ color: theme.colors.success, fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: '4px' }}>
                                                    <FaCheck size={12} /> Voted
                                                </span>
                                            )}
                                            {votingStates[post.id.toString()] === 'error' && (
                                                <span style={{ color: theme.colors.error, fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: '4px' }}>
                                                    <FaTimes size={12} /> Error
                                                </span>
                                            )}
                                        </>
                                    )}
                                </div>

                                {/* Reply Form */}
                                {isAuthenticated && isReplying && (
                                    <ReplyForm 
                                        postId={post.id}
                                        onSubmit={(replyText) => submitReply(post.id, replyText)}
                                        onCancel={() => setReplyingTo(null)}
                                        submittingComment={submittingComment}
                                        createdBy={post.created_by}
                                        principalDisplayInfo={principalDisplayInfo}
                                        textLimits={textLimits}
                                        theme={theme}
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
                                        theme={theme}
                                    />
                                )}
                            </>
                        )}
                    </div>
                </div>

                {/* Replies */}
                {!isFlat && !isCollapsed && post.replies && post.replies.length > 0 && (
                    <div style={{ marginTop: '0.5rem' }}>
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
    }, [collapsedPosts, replyingTo, discussionPosts, principalDisplayInfo, allNeurons, votingStates, userVotes, submittingComment, editingPost, submittingEdit, isAdmin, identity, textLimits, postTips, availableTokens, theme]);

    useEffect(() => {
        if (forumActor && currentProposalId && selectedSnsRoot) {
            fetchDiscussionThread();
        }
    }, [forumActor, currentProposalId, selectedSnsRoot]);

    useEffect(() => {
        const fetchPrincipalInfo = async () => {
            if (!principalNames || !principalNicknames) return;

            const uniquePrincipals = new Set();
            
            discussionPosts.forEach(post => {
                if (post.created_by) {
                    uniquePrincipals.add(post.created_by.toString());
                }
            });

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
                
                setUserVotes(prev => ({
                    ...prev,
                    [postIdStr]: {
                        vote_type: voteType,
                        voting_power: 1
                    }
                }));

                if (discussionThread) {
                    await fetchDiscussionPosts(Number(discussionThread.thread_id));
                }

                setTimeout(() => {
                    setVotingStates(prev => {
                        const newState = { ...prev };
                        delete newState[postIdStr];
                        return newState;
                    });
                }, 2000);
            } else {
                throw new Error(formatError(result.err));
            }
        } catch (error) {
            setVotingStates(prev => ({ ...prev, [postIdStr]: 'error' }));
            if (onError) onError('Failed to vote: ' + error.message);

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
                
                setUserVotes(prev => {
                    const newState = { ...prev };
                    delete newState[postIdStr];
                    return newState;
                });

                if (discussionThread) {
                    await fetchDiscussionPosts(Number(discussionThread.thread_id));
                }

                setTimeout(() => {
                    setVotingStates(prev => {
                        const newState = { ...prev };
                        delete newState[postIdStr];
                        return newState;
                    });
                }, 2000);
            } else {
                throw new Error(formatError(result.err));
            }
        } catch (error) {
            setVotingStates(prev => ({ ...prev, [postIdStr]: 'error' }));
            if (onError) onError('Failed to retract vote: ' + error.message);

            setTimeout(() => {
                setVotingStates(prev => {
                    const newState = { ...prev };
                    delete newState[postIdStr];
                    return newState;
                });
            }, 3000);
        }
    };

    const startEditPost = (post) => {
        setEditingPost(Number(post.id));
    };

    const cancelEditPost = () => {
        setEditingPost(null);
    };

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
                if (discussionThread) {
                    await fetchDiscussionPosts(Number(discussionThread.thread_id));
                }
                cancelEditPost();
            } else {
                if (onError) onError('Failed to edit post: ' + formatError(result.err));
            }
        } catch (err) {
            if (onError) onError('Failed to edit post: ' + err.message);
        } finally {
            setSubmittingEdit(false);
        }
    };

    const deletePost = async (postId) => {
        if (!forumActor) return;
        
        if (!confirm('Are you sure you want to delete this post?')) return;
        
        try {
            const result = await forumActor.delete_post(Number(postId));
            
            if ('ok' in result) {
                if (discussionThread) {
                    await fetchDiscussionPosts(Number(discussionThread.thread_id));
                }
            } else {
                if (onError) onError('Failed to delete post: ' + formatError(result.err));
            }
        } catch (err) {
            if (onError) onError('Failed to delete post: ' + err.message);
        }
    };

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
            const ledgerActor = createLedgerActor(tokenPrincipal, {
                agentOptions: { identity }
            });

            const tokenFee = await ledgerActor.icrc1_fee();

            const transferResult = await ledgerActor.icrc1_transfer({
                to: { 
                    owner: recipientPrincipal, 
                    subaccount: [] 
                },
                fee: [],
                memo: [],
                from_subaccount: [],
                created_at_time: [],
                amount: BigInt(amount)
            });

            let transactionBlockIndex = null;
            if ('Ok' in transferResult) {
                transactionBlockIndex = Number(transferResult.Ok);
            } else {
                const errorMsg = 'Err' in transferResult ? JSON.stringify(transferResult.Err) : 'Unknown transfer error';
                throw new Error(`ICRC1 transfer failed: ${errorMsg}`);
            }

            const tipResult = await createTip(forumActor, {
                to_principal: recipientPrincipal,
                post_id: Number(postId),
                token_ledger_principal: Principal.fromText(tokenPrincipal),
                amount: Number(amount),
                transaction_block_index: transactionBlockIndex
            });

            if ('ok' in tipResult) {
                const tips = await getTipsByPost(forumActor, Number(postId));
                setPostTips(prev => ({
                    ...prev,
                    [postId.toString()]: tips
                }));

                await refreshTokenBalance(tokenPrincipal);
                
                closeTipModal();
                
                if (onError) {
                    onError('');
                }
            } else {
                throw new Error('Failed to register tip: ' + JSON.stringify(tipResult.err));
            }
        } catch (error) {
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

    const handleViewModeChange = (newViewMode) => {
        setViewMode(newViewMode);
        try {
            localStorage.setItem('discussionViewMode', newViewMode);
        } catch (error) {
            console.warn('Could not save to localStorage:', error);
        }
    };

    return (
        <div>
            {loadingDiscussion ? (
                <div style={{ 
                    padding: '2rem', 
                    textAlign: 'center',
                    color: theme.colors.mutedText
                }}>
                    <FaSpinner className="spin" size={24} style={{ marginBottom: '0.5rem' }} />
                    <p style={{ margin: 0 }}>Loading discussion...</p>
                </div>
            ) : (
                <div>
                    {discussionThread && (
                        <div>
                            {/* Voting Status */}
                            {isAuthenticated && (
                                <div style={{ 
                                    background: theme.colors.primaryBg, 
                                    padding: '0.75rem 1rem', 
                                    borderRadius: '10px', 
                                    marginBottom: '1rem',
                                    border: `1px solid ${totalVotingPower > 0 ? `${theme.colors.success}40` : `${accentPrimary}40`}`
                                }}>
                                    <div style={{ 
                                        display: 'flex', 
                                        alignItems: 'center', 
                                        gap: '0.5rem',
                                        fontSize: '0.85rem',
                                        flexWrap: 'wrap'
                                    }}>
                                        {neuronsLoading ? (
                                            <span style={{ color: theme.colors.mutedText, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                                <FaSpinner className="spin" size={12} /> Loading voting neurons...
                                            </span>
                                        ) : totalVotingPower > 0 ? (
                                            <>
                                                <FaCheckCircle size={14} style={{ color: theme.colors.success }} />
                                                <span style={{ color: theme.colors.success }}>Forum voting enabled</span>
                                                <span style={{ color: theme.colors.mutedText }}>•</span>
                                                <span style={{ color: theme.colors.mutedText }}>
                                                    {allNeurons.length} neuron{allNeurons.length !== 1 ? 's' : ''}
                                                </span>
                                                <span style={{ color: theme.colors.mutedText }}>•</span>
                                                <span style={{ color: theme.colors.success, fontWeight: '600' }}>
                                                    {formatVotingPowerDisplay(totalVotingPower)} VP
                                                </span>
                                            </>
                                        ) : (
                                            <>
                                                <FaKey size={14} style={{ color: accentPrimary }} />
                                                <span style={{ color: accentPrimary }}>No voting power</span>
                                                <span style={{ color: theme.colors.mutedText }}>•</span>
                                                <span style={{ color: theme.colors.mutedText }}>
                                                    Add hotkey neurons to vote on posts
                                                </span>
                                            </>
                                        )}
                                    </div>
                                </div>
                            )}
                            
                            {/* Thread Title */}
                            {threadDetails && threadDetails.title && threadDetails.title.length > 0 && (
                                <div style={{ 
                                    background: theme.colors.primaryBg, 
                                    padding: '1rem', 
                                    borderRadius: '12px', 
                                    marginBottom: '1rem',
                                    border: `1px solid ${theme.colors.border}`
                                }}>
                                    <h3 style={{ 
                                        color: theme.colors.primaryText, 
                                        margin: '0 0 0.5rem 0', 
                                        fontSize: '1.1rem',
                                        fontWeight: '600'
                                    }}>
                                        {threadDetails.title[0]}
                                    </h3>
                                    {threadDetails.body && (
                                        <div style={{ 
                                            color: theme.colors.secondaryText, 
                                            fontSize: '0.9rem',
                                            lineHeight: '1.5'
                                        }}>
                                            {threadDetails.body}
                                        </div>
                                    )}
                                </div>
                            )}
                            
                            {/* View Mode Toggle */}
                            <div style={{ 
                                display: 'flex', 
                                gap: '0.5rem', 
                                marginBottom: '1rem',
                                alignItems: 'center'
                            }}>
                                <span style={{ color: theme.colors.mutedText, fontSize: '0.85rem' }}>View:</span>
                                <button
                                    onClick={() => handleViewModeChange('flat')}
                                    style={{
                                        background: viewMode === 'flat' ? `linear-gradient(135deg, ${accentPrimary}, ${accentSecondary})` : 'transparent',
                                        border: viewMode === 'flat' ? 'none' : `1px solid ${theme.colors.border}`,
                                        color: viewMode === 'flat' ? 'white' : theme.colors.secondaryText,
                                        borderRadius: '8px',
                                        padding: '0.4rem 0.75rem',
                                        cursor: 'pointer',
                                        fontSize: '0.8rem',
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: '0.4rem'
                                    }}
                                >
                                    <FaEye size={12} /> Flat
                                </button>
                                <button
                                    onClick={() => handleViewModeChange('tree')}
                                    style={{
                                        background: viewMode === 'tree' ? `linear-gradient(135deg, ${accentPrimary}, ${accentSecondary})` : 'transparent',
                                        border: viewMode === 'tree' ? 'none' : `1px solid ${theme.colors.border}`,
                                        color: viewMode === 'tree' ? 'white' : theme.colors.secondaryText,
                                        borderRadius: '8px',
                                        padding: '0.4rem 0.75rem',
                                        cursor: 'pointer',
                                        fontSize: '0.8rem',
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: '0.4rem'
                                    }}
                                >
                                    <FaSitemap size={12} /> Tree
                                </button>
                                <span style={{ 
                                    color: theme.colors.mutedText, 
                                    fontSize: '0.8rem', 
                                    marginLeft: '0.5rem' 
                                }}>
                                    {discussionPosts.length} comment{discussionPosts.length !== 1 ? 's' : ''}
                                </span>
                            </div>

                            {/* Posts */}
                            {discussionPosts.length > 0 ? (
                                <div style={{ marginBottom: '1.5rem' }}>
                                    {viewMode === 'flat' ? (
                                        organizePostsFlat(discussionPosts).map(post => (
                                            <PostComponent key={post.id} post={post} isFlat={true} />
                                        ))
                                    ) : (
                                        organizePostsTree(discussionPosts).map(post => (
                                            <PostComponent key={post.id} post={post} isFlat={false} />
                                        ))
                                    )}
                                </div>
                            ) : !creatingFirstPost ? (
                                <div style={{ 
                                    textAlign: 'center',
                                    padding: '2rem',
                                    background: theme.colors.primaryBg,
                                    borderRadius: '12px',
                                    marginBottom: '1.5rem',
                                    border: `1px solid ${theme.colors.border}`
                                }}>
                                    <FaCommentAlt size={32} style={{ color: theme.colors.mutedText, opacity: 0.5, marginBottom: '0.75rem' }} />
                                    <p style={{ color: theme.colors.mutedText, margin: 0 }}>
                                        No comments yet. Be the first to start the discussion!
                                    </p>
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
                                        width: '100%',
                                        background: `linear-gradient(135deg, ${accentPrimary}, ${accentSecondary})`,
                                        color: 'white',
                                        border: 'none',
                                        borderRadius: '12px',
                                        padding: '1rem 1.5rem',
                                        cursor: 'pointer',
                                        fontSize: '1rem',
                                        fontWeight: '500',
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                        gap: '0.5rem',
                                        transition: 'all 0.2s ease',
                                        boxShadow: `0 4px 15px ${accentPrimary}30`
                                    }}
                                >
                                    <FaCommentAlt size={16} />
                                    {discussionPosts.length === 0 ? 'Be the first to comment' : 'Add a comment'}
                                </button>
                            ) : (
                                <div style={{ 
                                    background: theme.colors.primaryBg,
                                    borderRadius: '12px',
                                    padding: '1.5rem',
                                    border: `1px solid ${theme.colors.border}`
                                }}>
                                    <div style={{
                                        color: accentPrimary,
                                        fontSize: '1rem',
                                        fontWeight: '600',
                                        marginBottom: '1rem',
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: '0.5rem'
                                    }}>
                                        <FaCommentAlt size={16} />
                                        {discussionPosts.length === 0 ? 'Start the Discussion' : 'Add Your Comment'}
                                    </div>
                                    <input
                                        type="text"
                                        value={commentTitle}
                                        onChange={(e) => setCommentTitle(e.target.value)}
                                        placeholder="Title (optional)"
                                        style={{
                                            width: '100%',
                                            background: theme.colors.secondaryBg,
                                            border: `1px solid ${textLimits && commentTitle.length > textLimits.max_title_length ? theme.colors.error : theme.colors.border}`,
                                            borderRadius: '10px',
                                            color: theme.colors.primaryText,
                                            padding: '0.75rem 1rem',
                                            fontSize: '0.95rem',
                                            marginBottom: '0.5rem',
                                            boxSizing: 'border-box'
                                        }}
                                    />
                                    {textLimits && (
                                        <div style={{ 
                                            fontSize: '0.75rem', 
                                            color: commentTitle.length > textLimits.max_title_length ? theme.colors.error : theme.colors.mutedText,
                                            marginBottom: '0.75rem',
                                            textAlign: 'right'
                                        }}>
                                            {commentTitle.length}/{textLimits.max_title_length}
                                        </div>
                                    )}
                                    <textarea
                                        value={commentText}
                                        onChange={(e) => setCommentText(e.target.value)}
                                        placeholder="Share your thoughts on this proposal..."
                                        style={{
                                            width: '100%',
                                            minHeight: '120px',
                                            background: theme.colors.secondaryBg,
                                            border: `1px solid ${textLimits && commentText.length > textLimits.max_body_length ? theme.colors.error : theme.colors.border}`,
                                            borderRadius: '10px',
                                            color: theme.colors.primaryText,
                                            padding: '0.75rem 1rem',
                                            fontSize: '0.95rem',
                                            resize: 'vertical',
                                            marginBottom: '0.5rem',
                                            boxSizing: 'border-box'
                                        }}
                                    />
                                    {textLimits && (
                                        <div style={{ 
                                            fontSize: '0.75rem', 
                                            color: commentText.length > textLimits.max_body_length ? theme.colors.error : theme.colors.mutedText,
                                            marginBottom: '1rem',
                                            textAlign: 'right',
                                            display: 'flex',
                                            justifyContent: 'flex-end',
                                            alignItems: 'center',
                                            gap: '0.5rem'
                                        }}>
                                            <span>{commentText.length}/{textLimits.max_body_length}</span>
                                            {isPremium && regularLimits && textLimits.max_body_length > regularLimits.max_body_length && (
                                                <span style={{
                                                    background: 'linear-gradient(135deg, #ffd700, #ffb347)',
                                                    color: '#000',
                                                    padding: '2px 6px',
                                                    borderRadius: '4px',
                                                    fontSize: '0.65rem',
                                                    fontWeight: 'bold'
                                                }}>
                                                    ⭐ PREMIUM
                                                </span>
                                            )}
                                        </div>
                                    )}
                                    <div style={{ display: 'flex', gap: '0.75rem' }}>
                                        <button
                                            onClick={submitComment}
                                            disabled={!commentText.trim() || submittingComment || 
                                                     (textLimits && (commentTitle.length > textLimits.max_title_length || 
                                                                    commentText.length > textLimits.max_body_length))}
                                            style={{
                                                background: (commentText.trim() && !submittingComment && 
                                                             (!textLimits || (commentTitle.length <= textLimits.max_title_length && 
                                                                              commentText.length <= textLimits.max_body_length)))
                                                    ? `linear-gradient(135deg, ${theme.colors.success}, #27ae60)`
                                                    : theme.colors.mutedText,
                                                color: 'white',
                                                border: 'none',
                                                borderRadius: '10px',
                                                padding: '0.75rem 1.5rem',
                                                cursor: (commentText.trim() && !submittingComment) ? 'pointer' : 'not-allowed',
                                                fontSize: '0.95rem',
                                                fontWeight: '500',
                                                display: 'flex',
                                                alignItems: 'center',
                                                gap: '0.5rem'
                                            }}
                                        >
                                            {submittingComment ? <><FaSpinner className="spin" size={14} /> Posting...</> : <><FaCheck size={14} /> Post Comment</>}
                                        </button>
                                        <button
                                            onClick={() => {
                                                setShowCommentForm(false);
                                                setCommentText('');
                                                setCommentTitle('');
                                            }}
                                            style={{
                                                background: 'transparent',
                                                color: theme.colors.secondaryText,
                                                border: `1px solid ${theme.colors.border}`,
                                                borderRadius: '10px',
                                                padding: '0.75rem 1.5rem',
                                                cursor: 'pointer',
                                                fontSize: '0.95rem'
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
                            padding: '1.5rem',
                            background: theme.colors.primaryBg,
                            borderRadius: '12px',
                            border: `1px solid ${theme.colors.border}`
                        }}>
                            <FaKey size={24} style={{ color: theme.colors.mutedText, marginBottom: '0.5rem' }} />
                            <p style={{ color: theme.colors.mutedText, margin: 0 }}>
                                Please connect your wallet to participate in the discussion.
                            </p>
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
            
            <style>
                {`
                    .spin {
                        animation: spin 1s linear infinite;
                    }
                `}
            </style>
        </div>
    );
}

export default Discussion;
