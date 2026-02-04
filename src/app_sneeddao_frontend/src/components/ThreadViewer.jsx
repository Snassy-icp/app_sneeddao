import React, { useState, useEffect, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import { useNaming } from '../NamingContext';
import { useWalletOptional } from '../contexts/WalletContext';
import { useAdminCheck } from '../hooks/useAdminCheck';
import { useTextLimits } from '../hooks/useTextLimits';
import { calculateVotingPower } from '../utils/VotingPowerUtils';
import { useTokens } from '../hooks/useTokens';
import { useTokenMetadata } from '../hooks/useTokenMetadata';
import { formatError } from '../utils/errorUtils';
import { formatPrincipal, getPrincipalDisplayInfoFromContext, PrincipalDisplay } from '../utils/PrincipalUtils';
import { createActor as createSnsGovernanceActor } from 'external/sns_governance';
import { getSnsById } from '../utils/SnsUtils';
import { safePrincipalString, safePermissionType } from '../utils/NeuronUtils';
import { Principal } from '@dfinity/principal';
import { FaThumbsUp, FaThumbsDown, FaReply, FaCoins, FaEnvelope, FaEdit, FaTrash, FaPoll } from 'react-icons/fa';
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
import MessageDialog from './MessageDialog';
import Poll from './Poll';
import EmojiPicker from './EmojiPicker';
import MarkdownButtons from './MarkdownButtons';
import MarkdownBody from './MarkdownBody';
import './ThreadViewer.css';

// Separate EditForm component to prevent PostComponent re-renders
const EditForm = ({ initialTitle, initialBody, onSubmit, onCancel, submittingEdit, textLimits, regularLimits, isPremium }) => {
    const { theme } = useTheme();
    const [title, setTitle] = useState(initialTitle || '');
    const [body, setBody] = useState(initialBody || '');
    const bodyRef = useRef(null);
    
    // Character limit validation
    const maxTitleLength = textLimits?.post_title_max_length || 200;
    const maxBodyLength = textLimits?.post_body_max_length || 10000;
    const regularMaxBodyLength = regularLimits?.post_body_max_length || maxBodyLength;
    const hasPremiumBodyLimit = isPremium && maxBodyLength > regularMaxBodyLength;
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
            <EmojiPicker
                targetRef={bodyRef}
                getValue={() => body}
                setValue={setBody}
                ariaLabel="Insert emoji into post body"
                rightSlot={
                    <MarkdownButtons
                        targetRef={bodyRef}
                        getValue={() => body}
                        setValue={setBody}
                    />
                }
            />
            <textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                placeholder="Post body"
                ref={bodyRef}
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
                textAlign: 'right',
                display: 'flex',
                justifyContent: 'flex-end',
                alignItems: 'center',
                gap: '8px'
            }}>
                <span>Body: {body.length}/{maxBodyLength} characters</span>
                {isBodyOverLimit && <span>({body.length - maxBodyLength} over limit)</span>}
                {hasPremiumBodyLimit && (
                    <span style={{
                        backgroundColor: 'rgba(255, 215, 0, 0.2)',
                        color: '#ffd700',
                        padding: '2px 6px',
                        borderRadius: '4px',
                        fontSize: '10px',
                        fontWeight: 'bold'
                    }}>
                        ⭐ PREMIUM
                    </span>
                )}
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

// ThreadEditForm component for editing threads
const ThreadEditForm = ({ initialTitle, initialBody, onSubmit, onCancel, submittingEdit, textLimits, regularLimits, isPremium }) => {
    const { theme } = useTheme();
    const [title, setTitle] = useState(initialTitle || '');
    const [body, setBody] = useState(initialBody || '');
    const bodyRef = useRef(null);
    
    // Character limit validation using thread-specific limits
    const maxTitleLength = textLimits?.thread_title_max_length || 200;
    const maxBodyLength = textLimits?.thread_body_max_length || 10000;
    const regularMaxBodyLength = regularLimits?.thread_body_max_length || maxBodyLength;
    const hasPremiumBodyLimit = isPremium && maxBodyLength > regularMaxBodyLength;
    const isTitleOverLimit = title.length > maxTitleLength;
    const isBodyOverLimit = body.length > maxBodyLength;
    const isOverLimit = isTitleOverLimit || isBodyOverLimit;
    
    return (
        <div style={{ marginTop: '15px', padding: '15px', backgroundColor: theme.colors.primaryBg, borderRadius: '4px', border: `1px solid ${theme.colors.border}` }}>
            <h4 style={{ color: theme.colors.accent, marginBottom: '10px' }}>Edit Thread</h4>
            <input
                type="text"
                placeholder="Thread Title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                style={{
                    width: '100%',
                    backgroundColor: theme.colors.secondaryBg,
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
            <EmojiPicker
                targetRef={bodyRef}
                getValue={() => body}
                setValue={setBody}
                ariaLabel="Insert emoji into thread body"
                rightSlot={
                    <MarkdownButtons
                        targetRef={bodyRef}
                        getValue={() => body}
                        setValue={setBody}
                    />
                }
            />
            <textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                placeholder="Thread body"
                ref={bodyRef}
                style={{
                    width: '100%',
                    minHeight: '150px',
                    backgroundColor: theme.colors.secondaryBg,
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
                textAlign: 'right',
                display: 'flex',
                justifyContent: 'flex-end',
                alignItems: 'center',
                gap: '8px'
            }}>
                <span>Body: {body.length}/{maxBodyLength} characters</span>
                {isBodyOverLimit && <span>({body.length - maxBodyLength} over limit)</span>}
                {hasPremiumBodyLimit && (
                    <span style={{
                        backgroundColor: 'rgba(255, 215, 0, 0.2)',
                        color: '#ffd700',
                        padding: '2px 6px',
                        borderRadius: '4px',
                        fontSize: '10px',
                        fontWeight: 'bold'
                    }}>
                        ⭐ PREMIUM
                    </span>
                )}
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
                    {submittingEdit ? 'Updating...' : 'Update Thread'}
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
const ReplyForm = ({ postId, onSubmit, onCancel, submittingComment, createdBy, principalDisplayInfo, textLimits, regularLimits, isPremium }) => {
    const { theme } = useTheme();
    const [replyText, setReplyText] = useState('');
    const replyRef = useRef(null);
    
    // Get display name for the user being replied to
    const displayInfo = principalDisplayInfo?.get(createdBy?.toString());
    const displayName = displayInfo?.name || displayInfo?.nickname || createdBy.toString().slice(0, 8) + '...';
    
    // Character limit validation
    const maxLength = textLimits?.max_comment_length || 5000;
    const regularMaxLength = regularLimits?.max_comment_length || maxLength;
    const isOverLimit = replyText.length > maxLength;
    const remainingChars = maxLength - replyText.length;
    const hasPremiumLimit = isPremium && maxLength > regularMaxLength;
    
    return (
        <div style={{ marginTop: '15px', padding: '15px', backgroundColor: theme.colors.primaryBg, borderRadius: '4px' }}>
            <EmojiPicker
                targetRef={replyRef}
                getValue={() => replyText}
                setValue={setReplyText}
                ariaLabel="Insert emoji into reply"
                rightSlot={
                    <MarkdownButtons
                        targetRef={replyRef}
                        getValue={() => replyText}
                        setValue={setReplyText}
                    />
                }
            />
            <textarea
                value={replyText}
                onChange={(e) => setReplyText(e.target.value)}
                placeholder={`Reply to ${displayName}`}
                ref={replyRef}
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
                    color: isOverLimit ? theme.colors.error : theme.colors.mutedText,
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px'
                }}>
                    <span>{remainingChars} characters remaining</span>
                    {hasPremiumLimit && (
                        <span style={{
                            backgroundColor: 'rgba(255, 215, 0, 0.2)',
                            color: '#ffd700',
                            padding: '2px 6px',
                            borderRadius: '4px',
                            fontSize: '10px',
                            fontWeight: 'bold'
                        }}>
                            ⭐ PREMIUM
                        </span>
                    )}
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
    
    // Text limits hook (includes premium-aware limits if user is premium)
    const { textLimits, regularLimits, isPremium, loading: textLimitsLoading } = useTextLimits(forumActor);
    
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
        const userPrincipalStr = identity.getPrincipal().toString();
        return userNeurons.filter(neuron => 
            neuron.permissions?.some(p => {
                const permPrincipal = safePrincipalString(p.principal);
                if (!permPrincipal || permPrincipal !== userPrincipalStr) return false;
                // Safe array check for cached data
                const permTypes = safePermissionType(p);
                return permTypes.includes(4); // Hotkey permission
            })
        );
    }, [identity, userNeurons]);
    
    const hotkeyNeurons = getHotkeyNeurons() || [];
    const allNeurons = getAllNeurons() || [];
    
    // Calculate post score (upvotes - downvotes) like Discussion.jsx
    const calculatePostScore = (post) => {
        const upvotes = Number(post.upvote_score);
        const downvotes = Number(post.downvote_score);
        return upvotes - downvotes;
    };

    // Format vote scores with compact notation for large numbers
    const formatScore = (score) => {
        // Convert from e8s (divide by 10^8)
        const scoreInTokens = score / 100000000;
        const absScore = Math.abs(scoreInTokens);
        
        if (scoreInTokens === 0) {
            return '0';
        } else if (absScore >= 1000000) {
            // Millions: 1.2M, 3.5M, etc.
            const millions = scoreInTokens / 1000000;
            return millions.toFixed(1).replace(/\.0$/, '') + 'M';
        } else if (absScore >= 1000) {
            // Thousands: 1.1K, 238K, etc.
            const thousands = scoreInTokens / 1000;
            return thousands.toFixed(1).replace(/\.0$/, '') + 'K';
        } else if (absScore >= 1) {
            // For values >= 1, show up to 1 decimal place
            return scoreInTokens.toFixed(1).replace(/\.0$/, '');
        } else {
            // For values < 1, show up to 2 decimal places
            return scoreInTokens.toFixed(2).replace(/\.?0+$/, '');
        }
    };

    // Format relative time (e.g., "2h ago", "3d ago")
    const formatRelativeTime = (timestamp) => {
        const now = Date.now();
        const postTime = Number(timestamp) / 1000000; // Convert from nanoseconds
        const diffMs = now - postTime;
        const diffSec = Math.floor(diffMs / 1000);
        const diffMin = Math.floor(diffSec / 60);
        const diffHour = Math.floor(diffMin / 60);
        const diffDay = Math.floor(diffHour / 24);
        const diffWeek = Math.floor(diffDay / 7);
        const diffMonth = Math.floor(diffDay / 30);
        const diffYear = Math.floor(diffDay / 365);
        
        if (diffSec < 60) return 'just now';
        if (diffMin < 60) return `${diffMin}m`;
        if (diffHour < 24) return `${diffHour}h`;
        if (diffDay < 7) return `${diffDay}d`;
        if (diffWeek < 5) return `${diffWeek}w`;
        if (diffMonth < 12) return `${diffMonth}mo`;
        return `${diffYear}y`;
    };

    // Get full date string for tooltip
    const getFullDate = (timestamp) => {
        return new Date(Number(timestamp) / 1000000).toLocaleString();
    };

    // Thumb icons for voting (using react-icons)



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
    const hasLoadedDataRef = useRef(false); // Track if we've loaded data at least once (prevents loading spinner on refreshes)
    const [commentText, setCommentText] = useState('');
    const commentBodyRef = useRef(null);
    
    // Responsive state for narrow screens
    const [isNarrowScreen, setIsNarrowScreen] = useState(false);
    const [showCommentForm, setShowCommentForm] = useState(false);
    const [openOverflowMenu, setOpenOverflowMenu] = useState(null); // Track which post's overflow menu is open
    const [overflowMenuPosition, setOverflowMenuPosition] = useState({ x: 0, y: 0 }); // Position for the overflow menu
    
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
    const [optimisticScores, setOptimisticScores] = useState(new Map()); // Map<postId, {upvote_score: number, downvote_score: number}>
    const [optimisticEdits, setOptimisticEdits] = useState(new Map()); // Map<postId, {title: string|null, body: string}>
    const [optimisticPosts, setOptimisticPosts] = useState([]); // Array of optimistic posts pending server confirmation
    const [voteAnimations, setVoteAnimations] = useState(new Map()); // Map<postId, 'upvote' | 'downvote' | 'score'>
    const optimisticPostIdRef = useRef(-1); // For generating unique negative temporary IDs
    
    // Settings panel state
    const [showSettings, setShowSettings] = useState(false);
    const [isThreadHeaderExpanded, setIsThreadHeaderExpanded] = useState(true);
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

    // Helper to compare neuron IDs
    const neuronIdsMatch = useCallback((id1, id2) => {
        if (!id1 || !id2) return false;
        return Array.from(id1).join(',') === Array.from(id2).join(',');
    }, []);

    // Calculate optimistic state after a vote action
    // Returns both predicted scores AND predicted neuron vote states
    const calculateOptimisticState = useCallback((post, voteType, isRetraction) => {
        const postIdStr = post.id.toString();
        const currentVotes = threadVotes.get(postIdStr) || { upvoted_neurons: [], downvoted_neurons: [] };
        const currentUpvoteScore = Number(post.upvote_score || 0);
        const currentDownvoteScore = Number(post.downvote_score || 0);
        
        const selectedNeurons = getSelectedNeurons();
        
        // Start with copies of current neuron vote lists
        let newUpvotedNeurons = [...(currentVotes.upvoted_neurons || [])];
        let newDownvotedNeurons = [...(currentVotes.downvoted_neurons || [])];
        
        // Track score changes
        let upvoteScoreChange = 0;
        let downvoteScoreChange = 0;
        
        selectedNeurons.forEach(neuron => {
            const neuronVP = calculateVotingPower(neuron);
            const neuronIdBytes = neuron.id[0].id;
            
            // Find if this neuron currently has upvoted or downvoted
            const upvoteIndex = newUpvotedNeurons.findIndex(v => 
                neuronIdsMatch(v.neuron_id?.id, neuronIdBytes)
            );
            const downvoteIndex = newDownvotedNeurons.findIndex(v => 
                neuronIdsMatch(v.neuron_id?.id, neuronIdBytes)
            );
            
            const isCurrentlyUpvoted = upvoteIndex !== -1;
            const isCurrentlyDownvoted = downvoteIndex !== -1;
            
            if (isRetraction) {
                // Retraction: Remove the neuron's vote regardless of type
                if (isCurrentlyUpvoted) {
                    newUpvotedNeurons.splice(upvoteIndex, 1);
                    upvoteScoreChange -= neuronVP;
                } else if (isCurrentlyDownvoted) {
                    newDownvotedNeurons.splice(downvoteIndex, 1);
                    downvoteScoreChange -= neuronVP;
                }
                // If not voted, retraction does nothing for this neuron
            } else if (voteType === 'up') {
                if (isCurrentlyUpvoted) {
                    // Already upvoted - no change
                } else if (isCurrentlyDownvoted) {
                    // Was downvoted - switch to upvote
                    newDownvotedNeurons.splice(downvoteIndex, 1);
                    downvoteScoreChange -= neuronVP;
                    newUpvotedNeurons.push({
                        neuron_id: { id: neuronIdBytes },
                        voting_power: neuronVP
                    });
                    upvoteScoreChange += neuronVP;
                } else {
                    // Not voted - add upvote
                    newUpvotedNeurons.push({
                        neuron_id: { id: neuronIdBytes },
                        voting_power: neuronVP
                    });
                    upvoteScoreChange += neuronVP;
                }
            } else { // voteType === 'down'
                if (isCurrentlyDownvoted) {
                    // Already downvoted - no change
                } else if (isCurrentlyUpvoted) {
                    // Was upvoted - switch to downvote
                    newUpvotedNeurons.splice(upvoteIndex, 1);
                    upvoteScoreChange -= neuronVP;
                    newDownvotedNeurons.push({
                        neuron_id: { id: neuronIdBytes },
                        voting_power: neuronVP
                    });
                    downvoteScoreChange += neuronVP;
                } else {
                    // Not voted - add downvote
                    newDownvotedNeurons.push({
                        neuron_id: { id: neuronIdBytes },
                        voting_power: neuronVP
                    });
                    downvoteScoreChange += neuronVP;
                }
            }
        });
        
        return {
            scores: {
                upvote_score: Math.max(0, currentUpvoteScore + upvoteScoreChange),
                downvote_score: Math.max(0, currentDownvoteScore + downvoteScoreChange)
            },
            votes: {
                upvoted_neurons: newUpvotedNeurons,
                downvoted_neurons: newDownvotedNeurons
            }
        };
    }, [threadVotes, getSelectedNeurons, neuronIdsMatch]);

    // Helper to get the effective score for a post (optimistic if available, otherwise actual)
    const getEffectiveScore = useCallback((post) => {
        const postIdStr = post.id.toString();
        const optimistic = optimisticScores.get(postIdStr);
        
        if (optimistic) {
            return {
                upvote_score: optimistic.upvote_score,
                downvote_score: optimistic.downvote_score
            };
        }
        
        return {
            upvote_score: Number(post.upvote_score || 0),
            downvote_score: Number(post.downvote_score || 0)
        };
    }, [optimisticScores]);

    // Helper to get the effective vote state for a post (optimistic if available, otherwise actual)
    const getEffectiveVotes = useCallback((postId) => {
        const postIdStr = postId.toString();
        const optimistic = optimisticScores.get(postIdStr);
        
        // Check if we have optimistic vote state stored (we store it alongside scores)
        if (optimistic && optimistic.votes) {
            return optimistic.votes;
        }
        
        // Fall back to actual threadVotes
        return threadVotes.get(postIdStr) || { upvoted_neurons: [], downvoted_neurons: [] };
    }, [optimisticScores, threadVotes]);

    // Helper to get the effective post content (optimistic edit if available, otherwise actual)
    const getEffectivePostContent = useCallback((post) => {
        const postIdStr = post.id.toString();
        const optimisticEdit = optimisticEdits.get(postIdStr);
        
        if (optimisticEdit) {
            return {
                title: optimisticEdit.title,
                body: optimisticEdit.body
            };
        }
        
        return {
            title: post.title,
            body: post.body
        };
    }, [optimisticEdits]);

    // Helper to create an optimistic post object
    const createOptimisticPost = useCallback((title, body, parentPostId = null) => {
        const tempId = optimisticPostIdRef.current;
        optimisticPostIdRef.current -= 1; // Decrement for next use (negative IDs to avoid collision)
        
        return {
            id: BigInt(tempId),
            thread_id: BigInt(threadId),
            reply_to_post_id: parentPostId ? [BigInt(parentPostId)] : [],
            title: title ? [title] : [],
            body: body,
            created_by: identity?.getPrincipal() || Principal.anonymous(),
            created_at: BigInt(Date.now() * 1000000), // nanoseconds
            upvote_score: BigInt(0),
            downvote_score: BigInt(0),
            replies: [],
            _isOptimistic: true, // Flag to identify optimistic posts
            _tempId: tempId // Store the temp ID for later removal
        };
    }, [threadId, identity]);

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
    
    // Message dialog state
    const [messageDialogOpen, setMessageDialogOpen] = useState(false);
    const [messageRecipient, setMessageRecipient] = useState('');
    const [defaultTipToken, setDefaultTipToken] = useState(null); // Preselected token for tip modal
    const [lastTippedInfo, setLastTippedInfo] = useState(null); // { postId, tokenPrincipal } - for animation
    const [animatingTipToken, setAnimatingTipToken] = useState(null); // Token to animate after tip success

    // Edit/Delete states
    const [editingPost, setEditingPost] = useState(null); // postId being edited
    const [updatingPost, setUpdatingPost] = useState(false);
    const [deletingPost, setDeletingPost] = useState(null); // postId being deleted
    const [postTips, setPostTips] = useState({});
    
    // Thread Edit states
    const [editingThread, setEditingThread] = useState(false);
    const [updatingThread, setUpdatingThread] = useState(false);

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
        
        // Only show loading spinner on initial load, not on refreshes (voting, editing)
        // This prevents the page from replacing content with a spinner which causes scroll-to-top
        if (!hasLoadedDataRef.current) {
            setLoadingDiscussion(true);
        }
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
                
                // Fetch tips for all posts (replace all since we're loading everything)
                await fetchTipsForPosts(posts, true);
            } else {
                setDiscussionPosts([]);
            }
            
            // Mark that we've loaded data at least once
            hasLoadedDataRef.current = true;
            
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
                
                // Fetch tips for all posts (replace all since we're loading everything)
                await fetchTipsForPosts(posts, true);
            } else {
                setDiscussionPosts([]);
            }
        } catch (err) {
            console.error('Error fetching posts:', err);
            setDiscussionPosts([]);
        }
    }, [forumActor, threadId]);

    // Submit comment function with optimistic updates
    const submitComment = async () => {
        if (!commentText.trim() || !forumActor || !threadId) return;
        
        const scrollY = window.scrollY;
        
        // Capture the values before clearing the form
        const titleValue = commentTitle?.trim() || null;
        const bodyValue = commentText.trim();
        const shouldUseTitle = titleValue && titleValue.length > 0;
        
        // Create optimistic post immediately
        const optimisticPost = createOptimisticPost(
            shouldUseTitle ? titleValue : null,
            bodyValue,
            null // No parent for top-level comments
        );
        const tempId = optimisticPost._tempId;
        
        // Add optimistic post to the list immediately
        setOptimisticPosts(prev => [...prev, optimisticPost]);
        
        // Clear form and close it immediately
        setCommentText('');
        setCommentTitle('');
        setShowCommentForm(false);
        
        // Restore scroll position after React renders
        requestAnimationFrame(() => {
            window.scrollTo(0, scrollY);
        });
        
        // Now call the API in the background
        try {
            const result = await forumActor.create_post(
                Number(threadId),
                [], // reply_to_post_id - empty for top-level posts
                shouldUseTitle ? [titleValue] : [], // title
                bodyValue // body
            );
            
            if ('ok' in result) {
                console.log('Comment created successfully, post ID:', result.ok);
                const postId = result.ok;
                
                // Remove optimistic post
                setOptimisticPosts(prev => prev.filter(p => p._tempId !== tempId));
                
                // Refresh posts to get the real post from server
                await fetchPosts();
                
                // Auto-upvote if user has selected neurons with voting power
                const selectedNeurons = getSelectedNeurons();
                if (selectedNeurons && selectedNeurons.length > 0 && totalVotingPower > 0) {
                    try {
                        // Set voting state to show spinner
                        const postIdStr = postId.toString();
                        setVotingStates(prev => new Map(prev.set(postIdStr, 'voting')));
                        
                        // Convert selected neurons to the format expected by backend
                        const neuronIds = selectedNeurons.map(neuron => ({
                            id: neuron.id[0].id
                        }));
                        
                        await forumActor.vote_on_post_with_neurons(Number(postId), { upvote: null }, neuronIds);
                        
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
                // Remove optimistic post on error
                setOptimisticPosts(prev => prev.filter(p => p._tempId !== tempId));
                throw new Error(formatError(result.err));
            }
        } catch (error) {
            console.error('Error creating comment:', error);
            // Remove optimistic post on error
            setOptimisticPosts(prev => prev.filter(p => p._tempId !== tempId));
            if (onError) onError('Failed to create comment: ' + error.message);
        }
    };

    // Fetch tips for posts - merges with existing tips instead of replacing
    const fetchTipsForPosts = async (posts, replaceAll = false) => {
        if (!forumActor || !posts || posts.length === 0) return;

        try {
            const tipsPromises = posts.map(async (post) => {
                const tips = await getTipsByPost(forumActor, Number(post.id));
                return { postId: Number(post.id), tips };
            });

            const tipsResults = await Promise.all(tipsPromises);

            setPostTips(prev => {
                // If replaceAll, start fresh; otherwise merge with existing
                const merged = replaceAll ? {} : { ...prev };
                
                tipsResults.forEach(({ postId, tips }) => {
                    if (tips && tips.length > 0) {
                        merged[postId] = tips;
                    } else if (replaceAll) {
                        // Only clear if we're replacing all - post might have no tips
                        delete merged[postId];
                    }
                });
                
                return merged;
            });
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
        
        // Find the post to calculate optimistic state
        const post = discussionPosts.find(p => Number(p.id) === Number(postId));
        
        // Apply optimistic state update immediately (both scores AND vote states)
        if (post) {
            const optimisticState = calculateOptimisticState(post, voteType, false);
            // Store both scores and votes together
            setOptimisticScores(prev => new Map(prev.set(postIdStr, {
                ...optimisticState.scores,
                votes: optimisticState.votes
            })));
        }
        
        // Trigger satisfying animation
        setVoteAnimations(prev => new Map(prev.set(postIdStr, voteType === 'up' ? 'upvote' : 'downvote')));
        // Also trigger score animation
        setTimeout(() => {
            setVoteAnimations(prev => new Map(prev.set(postIdStr + '_score', 'score')));
        }, 50);
        // Clear animations after they complete
        setTimeout(() => {
            setVoteAnimations(prev => {
                const newState = new Map(prev);
                newState.delete(postIdStr);
                newState.delete(postIdStr + '_score');
                return newState;
            });
        }, 400);
        
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
                
                // Clear optimistic score now that real data is loaded
                setOptimisticScores(prev => {
                    const newState = new Map(prev);
                    newState.delete(postIdStr);
                    return newState;
                });
                
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
                
                // Clear optimistic score on error (revert to actual)
                setOptimisticScores(prev => {
                    const newState = new Map(prev);
                    newState.delete(postIdStr);
                    return newState;
                });
                
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
            
            // Clear optimistic score on error (revert to actual)
            setOptimisticScores(prev => {
                const newState = new Map(prev);
                newState.delete(postIdStr);
                return newState;
            });
            
            // Clear error state after a delay
            setTimeout(() => {
                setVotingStates(prev => {
                    const newState = new Map(prev);
                    newState.delete(postIdStr);
                    return newState;
                });
            }, 3000);
        }
    }, [forumActor, getSelectedNeurons, totalVotingPower, fetchPosts, refreshPostVotes, discussionPosts, calculateOptimisticState]);

    const handleRetractVote = useCallback(async (postId) => {
        const selectedNeurons = getSelectedNeurons();
        if (!forumActor || !selectedNeurons || selectedNeurons.length === 0) return;

        const postIdStr = postId.toString();
        
        // Find the post to calculate optimistic state
        const post = discussionPosts.find(p => Number(p.id) === Number(postId));
        
        // Apply optimistic state update immediately (both scores AND vote states for retraction)
        // Detect which type of vote is being retracted for animation
        const currentVotes = threadVotes.get(postIdStr) || { upvoted_neurons: [], downvoted_neurons: [] };
        const isRetractingUpvote = currentVotes.upvoted_neurons?.length > 0;
        
        if (post) {
            const optimisticState = calculateOptimisticState(post, null, true);
            setOptimisticScores(prev => new Map(prev.set(postIdStr, {
                ...optimisticState.scores,
                votes: optimisticState.votes
            })));
        }
        
        // Trigger satisfying animation (use the type being retracted)
        setVoteAnimations(prev => new Map(prev.set(postIdStr, isRetractingUpvote ? 'upvote' : 'downvote')));
        setTimeout(() => {
            setVoteAnimations(prev => new Map(prev.set(postIdStr + '_score', 'score')));
        }, 50);
        // Clear animations after they complete
        setTimeout(() => {
            setVoteAnimations(prev => {
                const newState = new Map(prev);
                newState.delete(postIdStr);
                newState.delete(postIdStr + '_score');
                return newState;
            });
        }, 400);
        
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
                
                // Clear optimistic score now that real data is loaded
                setOptimisticScores(prev => {
                    const newState = new Map(prev);
                    newState.delete(postIdStr);
                    return newState;
                });
                
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
                
                // Clear optimistic score on error (revert to actual)
                setOptimisticScores(prev => {
                    const newState = new Map(prev);
                    newState.delete(postIdStr);
                    return newState;
                });
                
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
            
            // Clear optimistic score on error (revert to actual)
            setOptimisticScores(prev => {
                const newState = new Map(prev);
                newState.delete(postIdStr);
                return newState;
            });
            
            // Clear error state after a delay
            setTimeout(() => {
                setVotingStates(prev => {
                    const newState = new Map(prev);
                    newState.delete(postIdStr);
                    return newState;
                });
            }, 3000);
        }
    }, [forumActor, getSelectedNeurons, fetchPosts, refreshPostVotes, discussionPosts, calculateOptimisticState]);

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
        
        const scrollY = window.scrollY;
        
        // Create optimistic reply immediately
        const optimisticPost = createOptimisticPost(
            null, // No title for replies
            replyText.trim(),
            parentPostId
        );
        const tempId = optimisticPost._tempId;
        
        // Add optimistic post to the list immediately
        setOptimisticPosts(prev => [...prev, optimisticPost]);
        
        // Clear form immediately
        setReplyingTo(null);
        
        // Restore scroll position after React renders
        requestAnimationFrame(() => {
            window.scrollTo(0, scrollY);
        });
        
        // Now call the API in the background
        try {
            const result = await forumActor.create_post(
                Number(threadId),
                [Number(parentPostId)],
                [], // Empty title for replies
                replyText.trim()
            );
            
            if ('ok' in result) {
                console.log('Reply created successfully, post ID:', result.ok);
                const postId = result.ok;
                
                // Remove optimistic post
                setOptimisticPosts(prev => prev.filter(p => p._tempId !== tempId));
                
                // Refresh posts to get the real post from server
                await fetchPosts();
                
                // Auto-upvote if user has selected neurons with voting power
                const selectedNeurons = getSelectedNeurons();
                if (selectedNeurons && selectedNeurons.length > 0 && totalVotingPower > 0) {
                    try {
                        // Set voting state to show spinner
                        const postIdStr = postId.toString();
                        setVotingStates(prev => new Map(prev.set(postIdStr, 'voting')));
                        
                        // Convert selected neurons to the format expected by backend
                        const neuronIds = selectedNeurons.map(neuron => ({
                            id: neuron.id[0].id
                        }));
                        
                        await forumActor.vote_on_post_with_neurons(Number(postId), { upvote: null }, neuronIds);
                        
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
                // Remove optimistic post on error
                setOptimisticPosts(prev => prev.filter(p => p._tempId !== tempId));
                if (onError) onError('Failed to create reply: ' + result.err);
            }
        } catch (error) {
            console.error('Error creating reply:', error);
            // Remove optimistic post on error
            setOptimisticPosts(prev => prev.filter(p => p._tempId !== tempId));
            if (onError) onError('Failed to create reply: ' + error.message);
        }
    }, [forumActor, threadId, onError, fetchPosts, getSelectedNeurons, totalVotingPower, createOptimisticPost]);

    const openTipModal = useCallback((post, defaultToken = null) => {
        const scrollY = window.scrollY;
        setSelectedPostForTip(post);
        setDefaultTipToken(defaultToken);
        setTipModalOpen(true);
        // Restore scroll position after React renders
        requestAnimationFrame(() => {
            window.scrollTo(0, scrollY);
        });
    }, []);

    const closeTipModal = useCallback(() => {
        setTipModalOpen(false);
        setSelectedPostForTip(null);
        setDefaultTipToken(null);
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
                
                const postIdNum = Number(selectedPostForTip.id);
                const tokenPrincipalStr = tokenPrincipal.toString();
                
                // If this post doesn't have a tip pill for this token yet,
                // add a placeholder so the animation has somewhere to fly to
                setPostTips(prev => {
                    const existingTips = prev[postIdNum] || [];
                    const hasExistingTokenTip = existingTips.some(
                        t => t.token_ledger_principal.toString() === tokenPrincipalStr
                    );
                    
                    if (!hasExistingTokenTip) {
                        // Add a placeholder tip
                        const placeholderTip = {
                            token_ledger_principal: Principal.fromText(tokenPrincipal),
                            from_principal: identity.getPrincipal(),
                            amount: BigInt(amount),
                            created_at: BigInt(Date.now() * 1000000),
                            _isPlaceholder: true
                        };
                        return {
                            ...prev,
                            [postIdNum]: [...existingTips, placeholderTip]
                        };
                    }
                    return prev;
                });
                
                setTippingState('success');
                
                // Store the tipped info for animation when modal closes
                // The real tips will be fetched after animation completes (in onAnimationComplete)
                setLastTippedInfo({
                    postId: postIdNum,
                    tokenPrincipal: tokenPrincipalStr,
                    post: selectedPostForTip // Store post reference for delayed fetch
                });
                
                // DON'T fetch tips here - wait for animation to complete
                // fetchTipsForPosts will be called in onAnimationComplete
                
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

    // Edit handlers - preserve scroll position to prevent unwanted scroll
    const startEditPost = useCallback((post) => {
        const scrollY = window.scrollY;
        setEditingPost(Number(post.id));
        // Restore scroll position after React renders
        requestAnimationFrame(() => {
            window.scrollTo(0, scrollY);
        });
    }, []);

    const cancelEditPost = useCallback(() => {
        const scrollY = window.scrollY;
        setEditingPost(null);
        // Restore scroll position after React renders
        requestAnimationFrame(() => {
            window.scrollTo(0, scrollY);
        });
    }, []);

    const submitEditPost = useCallback(async (title, body) => {
        if (!forumActor || !editingPost) return;

        const postIdStr = editingPost.toString();
        
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
        
        // Apply optimistic update immediately - show the new content right away
        setOptimisticEdits(prev => new Map(prev.set(postIdStr, {
            title: finalTitle.length > 0 ? finalTitle[0] : null,
            body: body
        })));
        
        // Close the edit form immediately (optimistic)
        cancelEditPost();
        
        setUpdatingPost(true);
        try {
            // Call update_post directly like Discussion.jsx does - pass title as string or null
            const result = await forumActor.update_post(
                Number(editingPost),
                finalTitle,
                body
            );

            if ('ok' in result) {
                console.log('Post updated successfully');
                // Refresh thread data to get the server's version (clears optimistic edit)
                await fetchThreadData();
                // Clear optimistic edit now that real data is loaded
                setOptimisticEdits(prev => {
                    const newState = new Map(prev);
                    newState.delete(postIdStr);
                    return newState;
                });
            } else {
                console.error('Failed to update post:', result.err);
                // Clear optimistic edit on error (revert to original)
                setOptimisticEdits(prev => {
                    const newState = new Map(prev);
                    newState.delete(postIdStr);
                    return newState;
                });
                alert('Failed to update post: ' + (result.err?.InvalidInput || result.err?.Unauthorized || 'Unknown error'));
            }
        } catch (error) {
            console.error('Error updating post:', error);
            // Clear optimistic edit on error (revert to original)
            setOptimisticEdits(prev => {
                const newState = new Map(prev);
                newState.delete(postIdStr);
                return newState;
            });
            alert('Error updating post: ' + error.message);
        } finally {
            setUpdatingPost(false);
        }
    }, [forumActor, editingPost, fetchThreadData, cancelEditPost]);

    // Thread Edit handlers
    const startEditThread = useCallback(() => {
        const scrollY = window.scrollY;
        setEditingThread(true);
        requestAnimationFrame(() => {
            window.scrollTo(0, scrollY);
        });
    }, []);

    const cancelEditThread = useCallback(() => {
        const scrollY = window.scrollY;
        setEditingThread(false);
        requestAnimationFrame(() => {
            window.scrollTo(0, scrollY);
        });
    }, []);

    const submitEditThread = useCallback(async (title, body) => {
        if (!forumActor || !threadId) return;

        // Handle the title - convert empty strings to [] (None), keep non-empty as [string] (Some)
        let processedTitle = title;
        if (Array.isArray(title)) {
            processedTitle = title.length > 0 ? title[0] : '';
        }
        const finalTitle = (processedTitle && processedTitle.trim()) ? [processedTitle.trim()] : [];

        setUpdatingThread(true);
        try {
            const result = await forumActor.update_thread(
                Number(threadId),
                finalTitle,
                body
            );

            if ('ok' in result) {
                console.log('Thread updated successfully');
                cancelEditThread();
                // Refresh thread data to get the updated content
                await fetchThreadData();
            } else {
                console.error('Failed to update thread:', result.err);
                alert('Failed to update thread: ' + (result.err?.InvalidInput || result.err?.Unauthorized || JSON.stringify(result.err) || 'Unknown error'));
            }
        } catch (error) {
            console.error('Error updating thread:', error);
            alert('Error updating thread: ' + error.message);
        } finally {
            setUpdatingThread(false);
        }
    }, [forumActor, threadId, fetchThreadData, cancelEditThread]);

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

    // Effect to close overflow menu when clicking outside
    useEffect(() => {
        if (openOverflowMenu === null) return;
        
        const handleClickOutside = (e) => {
            // Close menu if clicking outside the portal menu
            if (!e.target.closest('[data-overflow-portal]')) {
                setOpenOverflowMenu(null);
            }
        };
        
        // Use mousedown to catch clicks before they propagate
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [openOverflowMenu]);

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
        // Use effective votes (optimistic if available, otherwise actual)
        const postVotes = getEffectiveVotes(postId);
        const hasUpvotes = postVotes?.upvoted_neurons?.length > 0;
        const hasDownvotes = postVotes?.downvoted_neurons?.length > 0;
        const isVoting = votingStates.get(postIdStr) === 'voting';
        const hasNoVP = totalVotingPower === 0;
        
        const isUpvote = voteType === 'up';
        const hasVotes = isUpvote ? hasUpvotes : hasDownvotes;
        const activeColor = isUpvote ? theme.colors.success : theme.colors.error;
        const defaultColor = theme.colors.mutedText;
        
        return {
            backgroundColor: 'transparent',
            border: 'none',
            color: hasVotes ? activeColor : defaultColor,
            borderRadius: '4px',
            padding: '4px 8px',
            cursor: (isVoting || hasNoVP) ? 'not-allowed' : 'pointer',
            fontSize: '12px',
            fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
            display: 'flex',
            alignItems: 'center',
            gap: '3px',
            opacity: hasNoVP ? 0.6 : 1, // Only dim if no VP, not during voting
            fontWeight: 'bold'
        };
    }, [getEffectiveVotes, votingStates, totalVotingPower]);

    // Memoize vote button tooltips
    const getVoteButtonTooltip = useCallback((postId, voteType) => {
        if (totalVotingPower === 0) return 'You must have neurons with voting power to vote on posts';
        
        // Use effective votes (optimistic if available, otherwise actual)
        const postVotes = getEffectiveVotes(postId);
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
    }, [getEffectiveVotes, totalVotingPower, formatVotingPowerDisplay]);

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
        
        // Sort root posts: optimistic posts first (at top), then by creation time
        rootPosts.sort((a, b) => {
            // Optimistic posts should appear first (at the top)
            if (a._isOptimistic && !b._isOptimistic) return -1;
            if (!a._isOptimistic && b._isOptimistic) return 1;
            // Both optimistic or both real: sort by creation time
            return Number(a.created_at) - Number(b.created_at);
        });
        
        // Sort replies recursively (optimistic replies at the end of their parent's replies)
        const sortReplies = (post) => {
            if (post.replies && post.replies.length > 0) {
                post.replies.sort((a, b) => {
                    // Optimistic replies should appear last (at the bottom, since they're newest)
                    if (a._isOptimistic && !b._isOptimistic) return 1;
                    if (!a._isOptimistic && b._isOptimistic) return -1;
                    // Both optimistic or both real: sort by creation time
                    return Number(a.created_at) - Number(b.created_at);
                });
                post.replies.forEach(sortReplies);
            }
        };
        rootPosts.forEach(sortReplies);
        
        return rootPosts;
    }, []);

    // Get posts for display based on mode (including optimistic posts)
    const getDisplayPosts = useCallback(() => {
        // Merge real posts with optimistic posts
        const allPosts = [...discussionPosts, ...optimisticPosts];
        
        if (mode === 'post' && focusedPostId) {
            // For post mode, we want to show:
            // 1. All ancestors of the focused post
            // 2. The focused post itself
            // 3. All descendants of the focused post
            // 4. Direct children of ancestors that were created by the current user
            // 5. Optimistic posts that are replies to any ancestor (so new replies don't disappear)
            
            const focusedPost = allPosts.find(p => Number(p.id) === Number(focusedPostId));
            if (!focusedPost) return buildPostTree(allPosts);
            
            const relevantPosts = new Set();
            const ancestorIds = new Set(); // Track ancestor IDs
            const currentUserPrincipal = identity?.getPrincipal()?.toString();
            
            // Add focused post
            relevantPosts.add(Number(focusedPostId));
            
            // Add all ancestors
            let currentPost = focusedPost;
            while (currentPost && currentPost.reply_to_post_id && currentPost.reply_to_post_id.length > 0) {
                const parentId = Number(currentPost.reply_to_post_id[0]);
                relevantPosts.add(parentId);
                ancestorIds.add(parentId);
                currentPost = allPosts.find(p => Number(p.id) === parentId);
            }
            
            // Helper to add all descendants recursively
            const addDescendants = (postId) => {
                const children = allPosts.filter(p => 
                    p.reply_to_post_id && 
                    p.reply_to_post_id.length > 0 && 
                    Number(p.reply_to_post_id[0]) === postId
                );
                children.forEach(child => {
                    relevantPosts.add(Number(child.id));
                    addDescendants(Number(child.id));
                });
            };
            
            // Add all descendants of the focused post
            addDescendants(Number(focusedPostId));
            
            // For each ancestor, also include:
            // - Direct children created by the current user (and their descendants)
            // - Optimistic posts (and their descendants)
            ancestorIds.forEach(ancestorId => {
                const ancestorChildren = allPosts.filter(p => 
                    p.reply_to_post_id && 
                    p.reply_to_post_id.length > 0 && 
                    Number(p.reply_to_post_id[0]) === ancestorId
                );
                
                ancestorChildren.forEach(child => {
                    const childId = Number(child.id);
                    // Skip if already included (e.g., the focused post itself or another ancestor)
                    if (relevantPosts.has(childId)) return;
                    
                    // Include if it's the current user's post
                    const isCurrentUserPost = currentUserPrincipal && 
                        child.created_by?.toString() === currentUserPrincipal;
                    
                    // Include if it's an optimistic post (negative ID or in optimisticPosts array)
                    const isOptimisticPost = childId < 0 || 
                        optimisticPosts.some(op => Number(op.id) === childId);
                    
                    if (isCurrentUserPost || isOptimisticPost) {
                        relevantPosts.add(childId);
                        // Also add descendants of this post
                        addDescendants(childId);
                    }
                });
            });
            
            // Filter posts to relevant ones and build tree
            const filteredPosts = allPosts.filter(p => relevantPosts.has(Number(p.id)));
            return buildPostTree(filteredPosts);
        }
        
        // Default: show all posts in tree
        return buildPostTree(allPosts);
    }, [discussionPosts, optimisticPosts, mode, focusedPostId, buildPostTree, identity]);

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
            {/* Thread Header - Expandable */}
            <div style={{
                backgroundColor: theme.colors.secondaryBg,
                borderRadius: '8px',
                border: `1px solid ${theme.colors.border}`,
                marginBottom: '6px',
                overflow: 'hidden'
            }}>
                {/* Thread Title Header - Always visible, clickable */}
                <div 
                    onClick={() => setIsThreadHeaderExpanded(!isThreadHeaderExpanded)}
                    style={{
                        padding: '12px 16px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        cursor: 'pointer',
                        borderBottom: isThreadHeaderExpanded ? `1px solid ${theme.colors.border}` : 'none'
                    }}
                >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flex: 1, minWidth: 0 }}>
                        <span style={{ 
                            fontSize: '14px',
                            color: theme.colors.mutedText,
                            transition: 'transform 0.2s',
                            transform: isThreadHeaderExpanded ? 'none' : 'rotate(-90deg)',
                            flexShrink: 0
                        }}>▼</span>
                        <h2 style={{ 
                            margin: 0, 
                            fontSize: '16px', 
                            fontWeight: '600',
                            color: theme.colors.primaryText,
                            fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: isThreadHeaderExpanded ? 'normal' : 'nowrap'
                        }}>{getDisplayTitle()}</h2>
                    </div>
                    {threadDetails && threadDetails.created_by && !isThreadHeaderExpanded && (
                        <div style={{ 
                            display: 'flex', 
                            alignItems: 'center', 
                            gap: '8px',
                            fontSize: '12px',
                            color: theme.colors.mutedText,
                            flexShrink: 0
                        }}>
                            <PrincipalDisplay 
                                principal={threadDetails.created_by}
                                displayInfo={principalDisplayInfo.get(threadDetails.created_by.toString())}
                                showCopyButton={false}
                                short={true}
                                style={{ fontSize: '12px' }}
                                isAuthenticated={isAuthenticated}
                            />
                            {threadDetails.created_at && (
                                <span title={new Date(Number(threadDetails.created_at / 1000000n)).toLocaleString()}>
                                    {formatRelativeTime(threadDetails.created_at)}
                                </span>
                            )}
                        </div>
                    )}
                </div>
                
                {/* Expanded Content */}
                {isThreadHeaderExpanded && (
                    <div style={{ padding: '16px' }}>
                        {/* Thread body - hide when editing */}
                        {!editingThread && threadDetails && threadDetails.body && (
                            <div className="thread-description" style={{ marginBottom: '12px' }}>
                                <MarkdownBody text={threadDetails.body} style={{ color: theme.colors.secondaryText }} />
                            </div>
                        )}
                        
                        {/* Edit Thread Button - show for thread owner or admin when not editing */}
                        {!editingThread && identity && threadDetails && threadDetails.created_by && 
                         (threadDetails.created_by.toString() === identity.getPrincipal().toString() || isAdmin) && (
                            <button
                                onClick={(e) => {
                                    e.stopPropagation();
                                    startEditThread();
                                }}
                                style={{
                                    backgroundColor: 'transparent',
                                    color: theme.colors.mutedText,
                                    border: `1px solid ${theme.colors.border}`,
                                    borderRadius: '4px',
                                    padding: '6px 12px',
                                    cursor: 'pointer',
                                    fontSize: '12px',
                                    marginBottom: '12px',
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '6px'
                                }}
                            >
                                <FaEdit size={12} /> Edit Thread
                            </button>
                        )}
                        
                        {/* Thread Edit Form */}
                        {editingThread && threadDetails && (
                            <ThreadEditForm
                                initialTitle={threadDetails.title || ''}
                                initialBody={threadDetails.body || ''}
                                onSubmit={submitEditThread}
                                onCancel={cancelEditThread}
                                submittingEdit={updatingThread}
                                textLimits={textLimits}
                                regularLimits={regularLimits}
                                isPremium={isPremium}
                            />
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
                                onClick={(e) => {
                                    e.stopPropagation();
                                    setShowPollForm(prev => new Map(prev.set('thread', true)));
                                }}
                                style={{
                                    backgroundColor: theme.colors.accent,
                                    color: theme.colors.primaryText,
                                    border: 'none',
                                    borderRadius: '4px',
                                    padding: '8px 16px',
                                    cursor: 'pointer',
                                    fontSize: '13px',
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
                                marginTop: '12px',
                                padding: '8px 0',
                                borderTop: `1px solid ${theme.colors.border}`,
                                fontSize: '12px',
                                color: theme.colors.secondaryText
                            }}>
                                <span>Created by: </span>
                                <PrincipalDisplay 
                                    principal={threadDetails.created_by}
                                    displayInfo={principalDisplayInfo.get(threadDetails.created_by.toString())}
                                    showCopyButton={false}
                                    short={true}
                                    style={{ color: theme.colors.accent, fontWeight: '500', fontSize: '12px' }}
                                    isAuthenticated={isAuthenticated}
                                />
                                {threadDetails.created_at && (
                                    <span 
                                        style={{ marginLeft: '12px', color: theme.colors.mutedText, cursor: 'help' }}
                                        title={new Date(Number(threadDetails.created_at / 1000000n)).toLocaleString()}
                                    >
                                        {formatRelativeTime(threadDetails.created_at)}
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
                                fontSize: '12px'
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
                                            onClick={(e) => e.stopPropagation()}
                                            onMouseEnter={(e) => e.target.style.textDecoration = 'underline'}
                                            onMouseLeave={(e) => e.target.style.textDecoration = 'none'}
                                        >
                                            Proposal #{proposalInfo.proposalId}
                                            {proposalInfo.proposalData?.proposal?.[0]?.title && 
                                                `: ${proposalInfo.proposalData.proposal[0].title}`}
                                        </a>
                                    )}
                                    {!proposalInfo.proposalData && (
                                        <span style={{ color: theme.colors.mutedText, fontSize: '11px', marginLeft: '8px' }}>
                                            (Loading proposal details...)
                                        </span>
                                    )}
                                </div>
                            </div>
                        )}
                        
                        {mode === 'post' && focusedPostId && (
                            <div className="post-focus-info" style={{
                                backgroundColor: theme.colors.tertiaryBg,
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
                                    color: theme.colors.mutedText,
                                    fontSize: '12px',
                                    fontWeight: '500'
                                }}>
                                    Viewing <a 
                                        href={`/post?postid=${focusedPostId}${selectedSnsRoot ? `&sns=${selectedSnsRoot}` : ''}`}
                                        style={{
                                            color: theme.colors.accent,
                                            textDecoration: 'none',
                                            fontWeight: '500'
                                        }}
                                        onClick={(e) => e.stopPropagation()}
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
                                        fontSize: '12px',
                                        textDecoration: 'none',
                                        fontWeight: '500',
                                        padding: '4px 8px',
                                        borderRadius: '3px',
                                        backgroundColor: theme.colors.primaryBg,
                                        transition: 'background-color 0.2s'
                                    }}
                                    onClick={(e) => e.stopPropagation()}
                                    onMouseEnter={(e) => e.target.style.backgroundColor = theme.colors.accentHover}
                                    onMouseLeave={(e) => e.target.style.backgroundColor = theme.colors.primaryBg}
                                >
                                    View Full Thread →
                                </a>
                            </div>
                        )}
                    </div>
                )}
            </div>

            {/* Create Comment Form */}
            {isAuthenticated && showCreatePost && (
                <div style={{ marginBottom: '8px' }}>
                    {!showCommentForm ? (
                        <button
                            onClick={() => setShowCommentForm(true)}
                            className="add-comment-button"
                            style={{
                                width: '100%',
                                background: 'linear-gradient(135deg, #06b6d4, #0891b2)',
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
                                boxShadow: '0 4px 15px rgba(6, 182, 212, 0.3)'
                            }}
                        >
                            💬 {discussionPosts.length === 0 ? 'Be the first to comment' : 'Add a comment'}
                        </button>
                    ) : (
                        <div style={{ 
                            background: theme.colors.primaryBg,
                            borderRadius: '12px',
                            padding: '1.5rem',
                            border: `1px solid ${theme.colors.border}`
                        }}>
                            <div style={{
                                color: '#06b6d4',
                                fontSize: '1rem',
                                fontWeight: '600',
                                marginBottom: '1rem',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '0.5rem'
                            }}>
                                💬 {discussionPosts.length === 0 ? 'Start the Discussion' : 'Add Your Comment'}
                            </div>
                            <input
                                type="text"
                                value={commentTitle}
                                onChange={(e) => setCommentTitle(e.target.value)}
                                placeholder="Title (optional)"
                                style={{
                                    width: '100%',
                                    background: theme.colors.secondaryBg,
                                    color: theme.colors.primaryText,
                                    border: `1px solid ${textLimits && commentTitle.length > textLimits.max_title_length ? theme.colors.error : theme.colors.border}`,
                                    borderRadius: '10px',
                                    padding: '0.75rem 1rem',
                                    fontSize: '0.95rem',
                                    marginBottom: '0.5rem',
                                    boxSizing: 'border-box'
                                }}
                            />
                            {textLimits && (
                                <div style={{
                                    fontSize: '0.75rem',
                                    color: commentTitle.length > textLimits.max_title_length ? theme.colors.error : 
                                           (textLimits.max_title_length - commentTitle.length) < 20 ? '#f39c12' : theme.colors.mutedText,
                                    marginBottom: '0.75rem',
                                    textAlign: 'right'
                                }}>
                                    {commentTitle.length}/{textLimits.max_title_length}
                                </div>
                            )}
                            <EmojiPicker
                                targetRef={commentBodyRef}
                                getValue={() => commentText}
                                setValue={setCommentText}
                                ariaLabel="Insert emoji into comment body"
                                rightSlot={
                                    <MarkdownButtons
                                        targetRef={commentBodyRef}
                                        getValue={() => commentText}
                                        setValue={setCommentText}
                                    />
                                }
                            />
                            <textarea
                                value={commentText}
                                onChange={(e) => setCommentText(e.target.value)}
                                placeholder="Share your thoughts..."
                                ref={commentBodyRef}
                                style={{
                                    width: '100%',
                                    background: theme.colors.secondaryBg,
                                    color: theme.colors.primaryText,
                                    border: `1px solid ${textLimits && commentText.length > textLimits.max_body_length ? theme.colors.error : theme.colors.border}`,
                                    borderRadius: '10px',
                                    padding: '0.75rem 1rem',
                                    fontSize: '0.95rem',
                                    minHeight: '120px',
                                    resize: 'vertical',
                                    marginBottom: '0.5rem',
                                    boxSizing: 'border-box'
                                }}
                            />
                            {textLimits && (
                                <div style={{
                                    fontSize: '0.75rem',
                                    color: commentText.length > textLimits.max_body_length ? theme.colors.error : 
                                           (textLimits.max_body_length - commentText.length) < 100 ? '#f39c12' : theme.colors.mutedText,
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
                            <div style={{ 
                                display: 'flex', 
                                gap: '0.75rem', 
                                justifyContent: 'flex-start'
                            }}>
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
                                <button
                                    onClick={submitComment}
                                    disabled={submittingComment || !commentText.trim() || 
                                             (textLimits && (commentTitle.length > textLimits.max_title_length || 
                                                            commentText.length > textLimits.max_body_length))}
                                    style={{
                                        background: (submittingComment || !commentText.trim() || 
                                                     (textLimits && (commentTitle.length > textLimits.max_title_length || 
                                                                    commentText.length > textLimits.max_body_length))) 
                                            ? theme.colors.mutedText 
                                            : `linear-gradient(135deg, ${theme.colors.success}, #27ae60)`,
                                        color: 'white',
                                        border: 'none',
                                        borderRadius: '10px',
                                        padding: '0.75rem 1.5rem',
                                        cursor: (submittingComment || !commentText.trim() || 
                                                (textLimits && (commentTitle.length > textLimits.max_title_length || 
                                                               commentText.length > textLimits.max_body_length))) ? 'not-allowed' : 'pointer',
                                        fontSize: '0.95rem',
                                        fontWeight: '500',
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: '0.5rem'
                                    }}
                                >
                                    {submittingComment ? '⏳ Posting...' : '✓ Post Comment'}
                                </button>
                            </div>
                        </div>
                    )}
                </div>
            )}

            {/* Display Options Bar */}
            <div style={{
                background: theme.colors.cardGradient,
                border: `1px solid ${theme.colors.border}`,
                borderRadius: '12px',
                marginBottom: '12px',
                overflow: 'hidden',
            }}>
                <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    flexWrap: 'wrap',
                    gap: '12px',
                    padding: '12px 16px',
                }}>
                    {/* View Mode Toggle */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span style={{ fontSize: '0.8rem', color: theme.colors.mutedText, fontWeight: '500' }}>View:</span>
                        <div style={{ display: 'flex', gap: '4px' }}>
                            <button 
                                onClick={() => {
                                    setViewMode('tree');
                                    try {
                                        localStorage.setItem('discussionViewMode', 'tree');
                                    } catch (error) {
                                        console.warn('Could not save to localStorage:', error);
                                    }
                                }} 
                                style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '4px',
                                    padding: '6px 12px',
                                    borderRadius: '8px',
                                    border: `1px solid ${viewMode === 'tree' ? theme.colors.accent : theme.colors.border}`,
                                    background: viewMode === 'tree' ? `${theme.colors.accent}15` : 'transparent',
                                    color: viewMode === 'tree' ? theme.colors.accent : theme.colors.secondaryText,
                                    fontSize: '0.85rem',
                                    fontWeight: viewMode === 'tree' ? '600' : '400',
                                    cursor: 'pointer',
                                    transition: 'all 0.2s ease',
                                }}
                            >
                                🌳 Tree
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
                                style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '4px',
                                    padding: '6px 12px',
                                    borderRadius: '8px',
                                    border: `1px solid ${viewMode === 'flat' ? theme.colors.accent : theme.colors.border}`,
                                    background: viewMode === 'flat' ? `${theme.colors.accent}15` : 'transparent',
                                    color: viewMode === 'flat' ? theme.colors.accent : theme.colors.secondaryText,
                                    fontSize: '0.85rem',
                                    fontWeight: viewMode === 'flat' ? '600' : '400',
                                    cursor: 'pointer',
                                    transition: 'all 0.2s ease',
                                }}
                            >
                                📋 Flat
                            </button>
                        </div>
                    </div>

                    {/* Sort Options */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span style={{ fontSize: '0.8rem', color: theme.colors.mutedText, fontWeight: '500' }}>Sort:</span>
                        <select
                            value={sortBy}
                            onChange={(e) => {
                                setSortBy(e.target.value);
                                try {
                                    localStorage.setItem('threadSortBy', e.target.value);
                                } catch (error) {
                                    console.warn('Could not save sort preference to localStorage:', error);
                                }
                            }}
                            style={{
                                padding: '6px 12px',
                                borderRadius: '8px',
                                border: `1px solid ${theme.colors.border}`,
                                background: theme.colors.secondaryBg,
                                color: theme.colors.primaryText,
                                fontSize: '0.85rem',
                                cursor: 'pointer',
                                outline: 'none',
                            }}
                        >
                            <option value="score-best">⭐ Best Score</option>
                            <option value="age-newest">📅 Newest First</option>
                            <option value="age-oldest">📅 Oldest First</option>
                            <option value="score-worst">👎 Worst Score</option>
                            <option value="score-controversial">🔥 Most Active</option>
                        </select>
                    </div>

                    {/* Voting Settings Toggle */}
                    <button
                        onClick={() => setShowSettings(!showSettings)}
                        style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '6px',
                            padding: '6px 12px',
                            borderRadius: '8px',
                            border: `1px solid ${showSettings ? theme.colors.accent : theme.colors.border}`,
                            background: showSettings ? `${theme.colors.accent}15` : 'transparent',
                            color: showSettings ? theme.colors.accent : theme.colors.secondaryText,
                            fontSize: '0.85rem',
                            fontWeight: showSettings ? '600' : '400',
                            cursor: 'pointer',
                            transition: 'all 0.2s ease',
                        }}
                    >
                        🗳️ Voting
                        <span style={{ 
                            fontSize: '10px',
                            transition: 'transform 0.2s',
                            transform: showSettings ? 'rotate(180deg)' : 'rotate(0deg)'
                        }}>▼</span>
                    </button>
                </div>

                {/* Voting Settings Content - Expandable below the bar */}
                {showSettings && (
                    <div style={{ 
                        padding: '16px',
                        borderTop: `1px solid ${theme.colors.border}`,
                        backgroundColor: theme.colors.secondaryBg,
                    }}>
                        {/* Voting Neurons Section */}
                        <div>
                            <h4 style={{
                                color: theme.colors.primaryText,
                                fontSize: '13px',
                                fontWeight: '500',
                                marginBottom: '10px',
                                margin: '0 0 10px 0',
                                fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif'
                            }}>
                                Voting Neurons
                            </h4>
                            <p style={{
                                color: theme.colors.secondaryText,
                                fontSize: '12px',
                                marginBottom: '15px',
                                margin: '0 0 15px 0',
                                fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif'
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
                                                backgroundColor: isSelected ? theme.colors.accentHover : theme.colors.primaryBg,
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
                                                    e.target.style.backgroundColor = theme.colors.primaryBg;
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
                                fontSize: '12px',
                                textAlign: 'center',
                                padding: '20px',
                                fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif'
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
                            fontSize: '12px',
                            color: theme.colors.primaryText,
                            fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif'
                        }}>
                            <strong>Total Selected Voting Power:</strong> {formatVotingPowerDisplay(totalVotingPower)}
                        </div>
                    </div>
                )}
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
                        setDefaultTipToken(null);
                        setTippingState('idle');
                        setLastTippedInfo(null);
                    }}
                    post={selectedPostForTip}
                    availableTokens={availableTokens}
                    onTip={handleTip}
                    isSubmitting={tippingState === 'transferring' || tippingState === 'registering'}
                    identity={identity}
                    tippingState={tippingState}
                    defaultToken={defaultTipToken}
                    targetPillSelector={
                        lastTippedInfo 
                            ? `[data-tip-pill="${lastTippedInfo.postId}-${lastTippedInfo.tokenPrincipal}"]`
                            : null
                    }
                    onAnimationComplete={() => {
                        // Trigger tip pill animation when flying logo arrives
                        if (lastTippedInfo) {
                            setAnimatingTipToken({
                                postId: lastTippedInfo.postId,
                                tokenPrincipal: lastTippedInfo.tokenPrincipal
                            });
                            
                            // Now fetch the real tips (replaces placeholder)
                            // Small delay so the logo fade-in animation can play first
                            setTimeout(() => {
                                if (lastTippedInfo.post) {
                                    fetchTipsForPosts([lastTippedInfo.post]);
                                }
                            }, 400);
                            
                            setTimeout(() => {
                                setAnimatingTipToken(null);
                            }, 900);
                        }
                    }}
                />
            )}
            
            {/* Message Dialog */}
            <MessageDialog
                isOpen={messageDialogOpen}
                onClose={() => {
                    setMessageDialogOpen(false);
                    setMessageRecipient('');
                }}
                initialRecipient={messageRecipient}
            />
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
        
        // Get effective post content (optimistic edit if available, otherwise actual)
        const effectiveContent = getEffectivePostContent(post);
        
        // Default state: negative posts are collapsed, positive posts are expanded
        // If manually toggled, use the opposite of the default state
        const defaultCollapsed = isNegative;
        const isCollapsed = hasBeenManuallyToggled ? !defaultCollapsed : defaultCollapsed;
        
        // Determine special styling states
        const needsBorder = isFocused || isUnread;
        const needsBackground = isNegative || isFocused || isUnread;
        const isOptimistic = post._isOptimistic;
        
        return (
            <div 
                className={`post-item ${isFocused ? 'focused-post' : ''} ${isOptimistic ? 'optimistic-post' : ''}`} 
                data-depth={depth}
                style={{ 
                    // Minimal indentation - CSS will handle the actual value via custom property
                    marginLeft: isFlat ? 0 : `calc(var(--post-indent, 8px) * ${depth})`,
                    // No right margin - all posts flush on right
                    marginRight: 0,
                    // Minimal padding - no right padding for nested flush layout
                    padding: needsBorder ? '10px' : '6px 0 6px 8px',
                    paddingRight: 0,
                    // Reduced vertical spacing
                    marginBottom: '2px',
                    marginTop: depth === 0 ? '8px' : '2px',
                    // Background only for special states (optimistic posts get a subtle highlight)
                    backgroundColor: isOptimistic 
                        ? 'rgba(255, 215, 0, 0.05)'
                        : (needsBackground 
                            ? (isUnread ? theme.colors.accentHover : (isNegative ? theme.colors.primaryBg : theme.colors.accentHover))
                            : 'transparent'),
                    // Border only for focused/unread posts
                    border: needsBorder 
                        ? `2px solid ${isUnread ? theme.colors.accent : theme.colors.accent}` 
                        : 'none',
                    // Left border for nesting indication (not for top-level or bordered posts)
                    // Optimistic posts get a gold left border
                    borderLeft: isOptimistic 
                        ? '3px solid rgba(255, 215, 0, 0.5)'
                        : (!needsBorder && depth > 0 
                            ? `2px solid ${isNegative ? theme.colors.error : theme.colors.border}` 
                            : (needsBorder ? undefined : 'none')),
                    borderRadius: needsBorder ? '6px' : '0',
                    position: 'relative',
                    // Add subtle opacity for optimistic posts
                    opacity: isOptimistic ? 0.85 : 1,
                    transition: 'opacity 0.3s ease, background-color 0.3s ease'
                }}
            >

                {/* Post content - simplified for now */}
                <div className="post-content">
                    <div className="thread-post-header" style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'flex-start',
                        gap: '6px',
                        flexWrap: 'wrap',
                        wordBreak: 'break-word',
                        overflowWrap: 'anywhere',
                        fontSize: '12px',
                        lineHeight: '1.4'
                    }}>
                        {/* Collapse button - flows inline with other elements */}
                        {!isFlat && (
                            <span
                                onClick={() => {
                                    const scrollY = window.scrollY;
                                    const newCollapsed = new Set(collapsedPosts);
                                    if (hasBeenManuallyToggled) {
                                        newCollapsed.delete(Number(post.id));
                                    } else {
                                        newCollapsed.add(Number(post.id));
                                    }
                                    setCollapsedPosts(newCollapsed);
                                    // Restore scroll position after React renders
                                    requestAnimationFrame(() => {
                                        window.scrollTo(0, scrollY);
                                    });
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
                        {isOptimistic ? (
                            <span
                                style={{
                                    color: '#ffd700',
                                    fontSize: '12px',
                                    fontWeight: '500',
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '4px',
                                    flexShrink: 0
                                }}
                            >
                                <span style={{ 
                                    display: 'inline-block',
                                    width: '8px',
                                    height: '8px',
                                    borderRadius: '50%',
                                    backgroundColor: '#ffd700',
                                    animation: 'pulse 1.5s ease-in-out infinite'
                                }} />
                                Sending...
                            </span>
                        ) : (
                            <a 
                                href={`/post?postid=${post.id}${selectedSnsRoot ? `&sns=${selectedSnsRoot}` : ''}`}
                                className="post-id"
                                style={{
                                    color: theme.colors.mutedText,
                                    textDecoration: 'none',
                                    fontWeight: '400',
                                    fontSize: '12px',
                                    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
                                    flexShrink: 0
                                }}
                                onMouseEnter={(e) => e.target.style.textDecoration = 'underline'}
                                onMouseLeave={(e) => e.target.style.textDecoration = 'none'}
                            >
                                #{isNarrowScreen ? '' : post.id.toString()}
                            </a>
                        )}
                        {effectiveContent.title && <span style={{ 
                            margin: 0, 
                            wordBreak: 'break-word', 
                            overflowWrap: 'anywhere',
                            fontWeight: '600',
                            fontSize: '13px',
                            color: theme.colors.primaryText
                        }}>{effectiveContent.title}</span>}
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
                        <PrincipalDisplay 
                            principal={post.created_by} 
                            displayInfo={principalDisplayInfo.get(post.created_by?.toString())}
                            showCopyButton={false}
                            short={true}
                            isAuthenticated={isAuthenticated}
                            style={{ fontSize: '12px' }}
                        />
                        <span 
                            style={{ color: theme.colors.mutedText, cursor: 'help', fontSize: '12px' }}
                            title={getFullDate(post.created_at)}
                        >
                            {formatRelativeTime(post.created_at)}
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
                            {/* Tips Display - between header and body */}
                            {postTips[Number(post.id)] && postTips[Number(post.id)].length > 0 && (
                                <TipDisplay 
                                    tips={postTips[Number(post.id)]}
                                    principalDisplayInfo={principalDisplayInfo}
                                    isNarrowScreen={isNarrowScreen}
                                    onTip={identity && post.created_by.toString() !== identity.getPrincipal().toString() 
                                        ? (tokenPrincipal) => openTipModal(post, tokenPrincipal ? tokenPrincipal.toString() : null)
                                        : null
                                    }
                                    animateToken={
                                        animatingTipToken && 
                                        animatingTipToken.postId === Number(post.id) 
                                            ? animatingTipToken.tokenPrincipal 
                                            : null
                                    }
                                    postId={Number(post.id)}
                                />
                            )}
                            
                            {/* Post body - hide when editing */}
                            {editingPost !== Number(post.id) && (
                                <div className="post-body">
                                    <MarkdownBody text={effectiveContent.body} style={{ color: theme.colors.primaryText }} />
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

                            {/* Action Buttons - Only show for authenticated users and real posts (not optimistic) */}
                            {isAuthenticated && !isOptimistic && (
                        <div style={{
                            display: 'flex',
                            gap: '8px',
                            marginTop: '8px',
                            flexWrap: 'wrap',
                            alignItems: 'center'
                        }}>
                            {/* Voting Section - Layout like Discussion.jsx */}
                            <div style={{ 
                                display: 'flex', 
                                alignItems: 'center', 
                                gap: '4px'
                            }}>
                                {/* Upvote Button - Shows voting power */}
                                <button
                                    type="button"
                                    className={`vote-btn ${voteAnimations.get(post.id.toString()) === 'upvote' ? 'vote-upvote-animate' : ''}`}
                                    onClick={(e) => {
                                        e.preventDefault();
                                        e.stopPropagation();
                                        const scrollY = window.scrollY;
                                        const postIdStr = post.id.toString();
                                        const postVotes = threadVotes.get(postIdStr);
                                        const hasUpvotes = postVotes?.upvoted_neurons?.length > 0;
                                        
                                        if (hasUpvotes) {
                                            handleRetractVote(post.id);
                                        } else {
                                            handleVote(post.id, 'up');
                                        }
                                        // Restore scroll position after React renders
                                        requestAnimationFrame(() => {
                                            window.scrollTo(0, scrollY);
                                        });
                                    }}
                                    disabled={votingStates.get(post.id.toString()) === 'voting' || totalVotingPower === 0}
                                    style={getVoteButtonStyles(post.id, 'up')}
                                    title={getVoteButtonTooltip(post.id, 'up')}
                                >
                                    <FaThumbsUp size={14} />
                                    {!isNarrowScreen && totalVotingPower > 0 && (
                                        <span style={{ marginLeft: '2px' }}>
                                            {formatVotingPowerDisplay(totalVotingPower)}
                                        </span>
                                    )}
                                </button>

                                {/* Score Display - Shows total post score (optimistic when voting) */}
                                {(() => {
                                    const effectiveScores = getEffectiveScore(post);
                                    const score = effectiveScores.upvote_score - effectiveScores.downvote_score;
                                    const isOptimistic = optimisticScores.has(post.id.toString());
                                    const hasScoreAnimation = voteAnimations.get(post.id.toString() + '_score') === 'score';
                                    
                                    return (
                                        <span 
                                            className={`vote-score ${hasScoreAnimation ? 'score-animate' : ''}`}
                                            style={{ 
                                                color: score > 0 ? '#6b8e6b' : 
                                                       score < 0 ? '#b85c5c' : theme.colors.mutedText,
                                                fontSize: '12px',
                                                fontWeight: '600',
                                                fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
                                                minWidth: '24px',
                                                textAlign: 'center',
                                                padding: '0 2px',
                                                display: 'inline-block'
                                            }}
                                            title={isOptimistic ? 'Updating score...' : undefined}
                                        >
                                            {(score > 0 ? '+' : '') + formatScore(score)}
                                        </span>
                                    );
                                })()}

                                {/* Downvote Button - Shows voting power */}
                                <button
                                    type="button"
                                    className={`vote-btn ${voteAnimations.get(post.id.toString()) === 'downvote' ? 'vote-downvote-animate' : ''}`}
                                    onClick={(e) => {
                                        e.preventDefault();
                                        e.stopPropagation();
                                        const scrollY = window.scrollY;
                                        const postIdStr = post.id.toString();
                                        const postVotes = threadVotes.get(postIdStr);
                                        const hasDownvotes = postVotes?.downvoted_neurons?.length > 0;
                                        
                                        if (hasDownvotes) {
                                            handleRetractVote(post.id);
                                        } else {
                                            handleVote(post.id, 'down');
                                        }
                                        // Restore scroll position after React renders
                                        requestAnimationFrame(() => {
                                            window.scrollTo(0, scrollY);
                                        });
                                    }}
                                    disabled={votingStates.get(post.id.toString()) === 'voting' || totalVotingPower === 0}
                                    style={getVoteButtonStyles(post.id, 'down')}
                                    title={getVoteButtonTooltip(post.id, 'down')}
                                >
                                    <FaThumbsDown size={14} />
                                    {!isNarrowScreen && totalVotingPower > 0 && (
                                        <span style={{ marginLeft: '2px' }}>
                                            {formatVotingPowerDisplay(totalVotingPower)}
                                        </span>
                                    )}
                                </button>
                            </div>

                            {/* Reply Button */}
                            <button
                                type="button"
                                className="post-action-btn"
                                onClick={(e) => {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    const scrollY = window.scrollY;
                                    const isReplying = replyingTo === Number(post.id);
                                    if (isReplying) {
                                        setReplyingTo(null);
                                    } else {
                                        setReplyingTo(Number(post.id));
                                    }
                                    // Restore scroll position after React renders
                                    requestAnimationFrame(() => {
                                        window.scrollTo(0, scrollY);
                                    });
                                }}
                                title={replyingTo === Number(post.id) ? 'Cancel reply' : 'Reply to this post'}
                            >
                                <FaReply size={12} style={{ opacity: 0.7 }} /> {isNarrowScreen ? '' : (replyingTo === Number(post.id) ? 'Cancel' : 'Reply')}
                            </button>

                            {/* Desktop: Show all buttons directly */}
                            {!isNarrowScreen && (
                                <>
                                    {/* Tip Button - Only show for posts by other users */}
                                    {identity && post.created_by.toString() !== identity.getPrincipal().toString() && (
                                        <button
                                            type="button"
                                            className="post-action-btn"
                                            onClick={(e) => {
                                                e.preventDefault();
                                                e.stopPropagation();
                                                openTipModal(post);
                                            }}
                                            title="Send a tip to the post author"
                                        >
                                            <FaCoins size={12} style={{ opacity: 0.7 }} /> Tip
                                        </button>
                                    )}

                                    {/* Send Message Button - Only show for posts by other users */}
                                    {identity && post.created_by.toString() !== identity.getPrincipal().toString() && (
                                        <button
                                            type="button"
                                            className="post-action-btn"
                                            onClick={(e) => {
                                                e.preventDefault();
                                                e.stopPropagation();
                                                setMessageRecipient(post.created_by.toString());
                                                setMessageDialogOpen(true);
                                            }}
                                            title="Send a private message to the post author"
                                        >
                                            <FaEnvelope size={12} style={{ opacity: 0.7 }} /> Message
                                        </button>
                                    )}

                                    {/* Edit Button - Show for post owner or admin */}
                                    {identity && (post.created_by.toString() === identity.getPrincipal().toString() || isAdmin) && (
                                        <button
                                            type="button"
                                            className="post-action-btn"
                                            onClick={(e) => {
                                                e.preventDefault();
                                                e.stopPropagation();
                                                startEditPost(post);
                                            }}
                                            title="Edit this post"
                                        >
                                            <FaEdit size={12} style={{ opacity: 0.7 }} /> Edit
                                        </button>
                                    )}

                                    {/* Delete Button - Show for post owner or admin */}
                                    {identity && (post.created_by.toString() === identity.getPrincipal().toString() || isAdmin) && (
                                        <button
                                            type="button"
                                            className="post-action-btn"
                                            onClick={(e) => {
                                                e.preventDefault();
                                                e.stopPropagation();
                                                handleDeletePost(post.id);
                                            }}
                                            disabled={deletingPost === Number(post.id)}
                                            style={{
                                                cursor: deletingPost === Number(post.id) ? 'not-allowed' : 'pointer',
                                                opacity: deletingPost === Number(post.id) ? 0.5 : 1
                                            }}
                                            title={deletingPost === Number(post.id) ? 'Deleting post...' : 'Delete this post'}
                                        >
                                            <FaTrash size={12} style={{ opacity: 0.7 }} /> {deletingPost === Number(post.id) ? 'Deleting...' : 'Delete'}
                                        </button>
                                    )}

                                    {/* Add Poll Button - Show for post owner if no poll exists */}
                                    {identity && post.created_by.toString() === identity.getPrincipal().toString() && 
                                     !postPolls.get(Number(post.id))?.length && !showPollForm.get(Number(post.id)) && (
                                        <button
                                            type="button"
                                            className="post-action-btn"
                                            onClick={(e) => {
                                                e.preventDefault();
                                                e.stopPropagation();
                                                setShowPollForm(prev => new Map(prev.set(Number(post.id), true)));
                                            }}
                                            title="Add a poll to this post"
                                        >
                                            <FaPoll size={12} style={{ opacity: 0.7 }} /> Add Poll
                                        </button>
                                    )}
                                </>
                            )}

                            {/* Mobile: Show overflow menu for extra buttons */}
                            {isNarrowScreen && (
                                <>
                                    <button
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            if (openOverflowMenu === Number(post.id)) {
                                                setOpenOverflowMenu(null);
                                            } else {
                                                // Calculate position based on button click
                                                const rect = e.currentTarget.getBoundingClientRect();
                                                setOverflowMenuPosition({ 
                                                    x: rect.right, 
                                                    y: rect.bottom + 4 
                                                });
                                                setOpenOverflowMenu(Number(post.id));
                                    }
                                }}
                                style={{
                                    backgroundColor: 'transparent',
                                    border: 'none',
                                            color: theme.colors.secondaryText,
                                    borderRadius: '4px',
                                    padding: '4px 8px',
                                    cursor: 'pointer',
                                            fontSize: '16px',
                                    display: 'flex',
                                    alignItems: 'center',
                                            fontWeight: 'bold',
                                            letterSpacing: '2px'
                                }}
                                        title="More actions"
                            >
                                        •••
                            </button>

                                    {/* Overflow Menu Dropdown - rendered via portal */}
                                    {openOverflowMenu === Number(post.id) && createPortal(
                                        <div 
                                            data-overflow-portal
                                            onClick={(e) => e.stopPropagation()}
                                            style={{
                                                position: 'fixed',
                                                left: Math.min(overflowMenuPosition.x - 150, window.innerWidth - 160),
                                                top: Math.min(overflowMenuPosition.y, window.innerHeight - 250),
                                                backgroundColor: theme.colors.secondaryBg,
                                                border: `1px solid ${theme.colors.border}`,
                                                borderRadius: '8px',
                                                padding: '4px 0',
                                                minWidth: '150px',
                                                boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
                                                zIndex: 10000
                                            }}>
                                            {/* Tip Option */}
                            {identity && post.created_by.toString() !== identity.getPrincipal().toString() && (
                                <button
                                                    type="button"
                                                    onClick={(e) => {
                                                        e.preventDefault();
                                                        e.stopPropagation();
                                                        openTipModal(post);
                                                        setOpenOverflowMenu(null);
                                                    }}
                                    style={{
                                                        display: 'flex',
                                                        alignItems: 'center',
                                                        gap: '8px',
                                                        width: '100%',
                                                        padding: '10px 14px',
                                        backgroundColor: 'transparent',
                                        border: 'none',
                                        color: theme.colors.mutedText,
                                        cursor: 'pointer',
                                                        fontSize: '14px',
                                                        textAlign: 'left'
                                    }}
                                >
                                                    <FaCoins size={14} style={{ opacity: 0.7 }} /> Tip
                                </button>
                            )}

                                            {/* Message Option */}
                            {identity && post.created_by.toString() !== identity.getPrincipal().toString() && (
                                <button
                                    type="button"
                                    onClick={(e) => {
                                        e.preventDefault();
                                        e.stopPropagation();
                                        setMessageRecipient(post.created_by.toString());
                                        setMessageDialogOpen(true);
                                        setOpenOverflowMenu(null);
                                    }}
                                    style={{
                                                        display: 'flex',
                                                        alignItems: 'center',
                                                        gap: '8px',
                                                        width: '100%',
                                                        padding: '10px 14px',
                                        backgroundColor: 'transparent',
                                        border: 'none',
                                        color: theme.colors.mutedText,
                                        cursor: 'pointer',
                                                        fontSize: '14px',
                                                        textAlign: 'left'
                                    }}
                                >
                                                    <FaEnvelope size={14} style={{ opacity: 0.7 }} /> Message
                                </button>
                            )}

                                            {/* Edit Option */}
                            {identity && (post.created_by.toString() === identity.getPrincipal().toString() || isAdmin) && (
                                <button
                                                    type="button"
                                                    onClick={(e) => {
                                                        e.preventDefault();
                                                        e.stopPropagation();
                                                        startEditPost(post);
                                                        setOpenOverflowMenu(null);
                                                    }}
                                    style={{
                                                        display: 'flex',
                                                        alignItems: 'center',
                                                        gap: '8px',
                                                        width: '100%',
                                                        padding: '10px 14px',
                                        backgroundColor: 'transparent',
                                        border: 'none',
                                        color: theme.colors.mutedText,
                                        cursor: 'pointer',
                                                        fontSize: '14px',
                                                        textAlign: 'left'
                                    }}
                                >
                                                    <FaEdit size={14} style={{ opacity: 0.7 }} /> Edit
                                </button>
                            )}

                                            {/* Delete Option */}
                            {identity && (post.created_by.toString() === identity.getPrincipal().toString() || isAdmin) && (
                                <button
                                                    type="button"
                                                    onClick={(e) => {
                                                        e.preventDefault();
                                                        e.stopPropagation();
                                                        handleDeletePost(post.id);
                                                        setOpenOverflowMenu(null);
                                                    }}
                                    disabled={deletingPost === Number(post.id)}
                                    style={{
                                                        display: 'flex',
                                                        alignItems: 'center',
                                                        gap: '8px',
                                                        width: '100%',
                                                        padding: '10px 14px',
                                        backgroundColor: 'transparent',
                                        border: 'none',
                                        color: theme.colors.mutedText,
                                        cursor: deletingPost === Number(post.id) ? 'not-allowed' : 'pointer',
                                        opacity: deletingPost === Number(post.id) ? 0.5 : 1,
                                                        fontSize: '14px',
                                                        textAlign: 'left'
                                    }}
                                >
                                                    <FaTrash size={14} style={{ opacity: 0.7 }} /> {deletingPost === Number(post.id) ? 'Deleting...' : 'Delete'}
                                </button>
                            )}

                                            {/* Add Poll Option */}
                            {identity && post.created_by.toString() === identity.getPrincipal().toString() && 
                             !postPolls.get(Number(post.id))?.length && !showPollForm.get(Number(post.id)) && (
                                <button
                                                    onClick={() => {
                                                        setShowPollForm(prev => new Map(prev.set(Number(post.id), true)));
                                                        setOpenOverflowMenu(null);
                                                    }}
                                    style={{
                                                        display: 'flex',
                                                        alignItems: 'center',
                                                        gap: '8px',
                                                        width: '100%',
                                                        padding: '10px 14px',
                                        backgroundColor: 'transparent',
                                        border: 'none',
                                        color: theme.colors.mutedText,
                                        cursor: 'pointer',
                                                        fontSize: '14px',
                                                        textAlign: 'left'
                                    }}
                                >
                                                    <FaPoll size={14} style={{ opacity: 0.7 }} /> Add Poll
                                </button>
                                            )}
                                        </div>,
                                        document.body
                                    )}
                                </>
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
                            regularLimits={regularLimits}
                            isPremium={isPremium}
                        />
                    )}

                    {/* Edit Form */}
                    {editingPost === Number(post.id) && (
                        <EditForm 
                            initialTitle={effectiveContent.title || ''}
                            initialBody={effectiveContent.body || ''}
                            onSubmit={submitEditPost}
                            onCancel={cancelEditPost}
                            submittingEdit={updatingPost}
                            textLimits={textLimits}
                            regularLimits={regularLimits}
                            isPremium={isPremium}
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
                    <div style={{ marginTop: '4px' }}>
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
