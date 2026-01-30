import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useSearchParams, Link, useNavigate } from 'react-router-dom';
import { useForum } from '../contexts/ForumContext';
import { useAuth } from '../AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import { useSns } from '../contexts/SnsContext';
import { useNaming } from '../NamingContext';
import ThreadViewer from '../components/ThreadViewer';
import Header from '../components/Header';
import { PrincipalDisplay, getPrincipalDisplayInfoFromContext } from '../utils/PrincipalUtils';
import { formatNeuronIdLink } from '../utils/NeuronUtils';
import { fetchSnsLogo, getAllSnses } from '../utils/SnsUtils';
import { HttpAgent } from '@dfinity/agent';
import { 
    FaComments, FaHome, FaChevronRight, FaExclamationTriangle, FaSpinner,
    FaThumbsUp, FaThumbsDown, FaChevronDown, FaChevronUp, FaBrain, FaUser, FaClock
} from 'react-icons/fa';

// Custom CSS for animations
const customAnimations = `
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

@keyframes spin {
    0% { transform: rotate(0deg); }
    100% { transform: rotate(360deg); }
}

.post-fade-in {
    animation: fadeInUp 0.4s ease-out forwards;
}

.post-spin {
    animation: spin 1s linear infinite;
}
`;

// Page accent colors - purple theme for forum/discussion
const forumPrimary = '#8b5cf6';
const forumSecondary = '#a78bfa';

const getStyles = (theme) => ({
    pageContainer: {
        background: theme.colors.primaryGradient,
        color: theme.colors.primaryText,
        minHeight: '100vh',
    },
    forumHeader: {
        background: `linear-gradient(135deg, ${forumPrimary}15 0%, ${forumSecondary}10 50%, transparent 100%)`,
        borderBottom: `1px solid ${theme.colors.border}`,
        padding: '16px 0',
        position: 'sticky',
        top: 0,
        zIndex: 100,
        backdropFilter: 'blur(12px)',
    },
    forumHeaderInner: {
        maxWidth: '1200px',
        margin: '0 auto',
        padding: '0 1.25rem',
        display: 'flex',
        alignItems: 'center',
        gap: '15px',
    },
    snsLogoWrapper: {
        width: '40px',
        height: '40px',
        borderRadius: '12px',
        background: theme.colors.secondaryBg,
        border: `2px solid ${theme.colors.border}`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
        flexShrink: 0,
    },
    snsLogo: {
        width: '100%',
        height: '100%',
        objectFit: 'cover',
    },
    snsLogoPlaceholder: {
        fontSize: '0.7rem',
        color: theme.colors.mutedText,
        fontWeight: '700',
    },
    forumTitle: {
        color: theme.colors.primaryText,
        fontSize: 'clamp(1.25rem, 3vw, 1.5rem)',
        fontWeight: '700',
        margin: 0,
        flex: 1,
    },
    container: {
        maxWidth: '1200px',
        margin: '0 auto',
        padding: '1.25rem',
    },
    breadcrumb: {
        display: 'flex',
        alignItems: 'center',
        flexWrap: 'wrap',
        gap: '8px',
        marginBottom: '1.25rem',
        padding: '12px 16px',
        background: theme.colors.cardGradient,
        border: `1px solid ${theme.colors.border}`,
        borderRadius: '12px',
        fontSize: '0.9rem',
    },
    breadcrumbLink: {
        color: theme.colors.accent,
        textDecoration: 'none',
        display: 'flex',
        alignItems: 'center',
        gap: '6px',
        fontWeight: '500',
        transition: 'opacity 0.2s ease',
    },
    breadcrumbSeparator: {
        color: theme.colors.mutedText,
        fontSize: '0.7rem',
    },
    breadcrumbCurrent: {
        color: theme.colors.secondaryText,
        fontWeight: '500',
    },
    errorCard: {
        background: theme.colors.cardGradient,
        border: `1px solid ${theme.colors.border}`,
        borderRadius: '16px',
        padding: '3rem 2rem',
        textAlign: 'center',
        boxShadow: theme.colors.cardShadow,
    },
    errorIcon: {
        width: '64px',
        height: '64px',
        borderRadius: '16px',
        background: `linear-gradient(135deg, ${theme.colors.error}20, ${theme.colors.error}10)`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        margin: '0 auto 1rem',
    },
    errorTitle: {
        fontSize: '1.5rem',
        fontWeight: '700',
        color: theme.colors.primaryText,
        marginBottom: '0.75rem',
    },
    errorText: {
        color: theme.colors.secondaryText,
        fontSize: '1rem',
        lineHeight: '1.6',
    },
    loadingCard: {
        background: theme.colors.cardGradient,
        border: `1px solid ${theme.colors.border}`,
        borderRadius: '16px',
        padding: '3rem 2rem',
        textAlign: 'center',
        boxShadow: theme.colors.cardShadow,
    },
    loadingIcon: {
        width: '64px',
        height: '64px',
        borderRadius: '16px',
        background: `linear-gradient(135deg, ${forumPrimary}20, ${forumPrimary}10)`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        margin: '0 auto 1rem',
    },
    loadingText: {
        color: theme.colors.secondaryText,
        fontSize: '1rem',
    },
    votesSection: {
        background: theme.colors.cardGradient,
        border: `1px solid ${theme.colors.border}`,
        borderRadius: '16px',
        padding: '1.25rem',
        marginTop: '1.25rem',
        boxShadow: theme.colors.cardShadow,
    },
    votesHeader: {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: '1rem',
        flexWrap: 'wrap',
        gap: '12px',
    },
    votesTitle: {
        display: 'flex',
        alignItems: 'center',
        gap: '10px',
        margin: 0,
        fontSize: '1.1rem',
        fontWeight: '700',
        color: theme.colors.primaryText,
    },
    votesTitleIcon: {
        width: '36px',
        height: '36px',
        borderRadius: '10px',
        background: `linear-gradient(135deg, ${forumPrimary}20, ${forumPrimary}10)`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
    },
    toggleButton: {
        display: 'flex',
        alignItems: 'center',
        gap: '6px',
        background: theme.colors.secondaryBg,
        border: `1px solid ${theme.colors.border}`,
        borderRadius: '8px',
        color: theme.colors.accent,
        padding: '8px 14px',
        fontSize: '0.85rem',
        fontWeight: '500',
        cursor: 'pointer',
        transition: 'all 0.2s ease',
    },
    summaryRow: {
        display: 'flex',
        alignItems: 'center',
        flexWrap: 'wrap',
        gap: '20px',
        marginBottom: '12px',
    },
    summaryItem: (color) => ({
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        padding: '8px 14px',
        background: `${color}15`,
        border: `1px solid ${color}30`,
        borderRadius: '10px',
        fontSize: '0.9rem',
        fontWeight: '500',
        color: color,
    }),
    netScoreBox: (color) => ({
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        padding: '10px 16px',
        background: `${color}15`,
        border: `1px solid ${color}40`,
        borderRadius: '10px',
        fontSize: '1rem',
        fontWeight: '700',
        color: color,
    }),
    votesGrid: {
        display: 'grid',
        gap: '12px',
        maxHeight: '400px',
        overflowY: 'auto',
        marginTop: '1rem',
        paddingRight: '4px',
    },
    voteCard: (isUpvote, theme) => ({
        padding: '1rem',
        background: theme.colors.secondaryBg,
        borderRadius: '12px',
        border: `1px solid ${isUpvote ? theme.colors.success : theme.colors.error}30`,
    }),
    voteCardHeader: {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: '12px',
    },
    voteType: (isUpvote, theme) => ({
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        color: isUpvote ? theme.colors.success : theme.colors.error,
        fontWeight: '700',
        fontSize: '1rem',
    }),
    votePower: {
        fontWeight: '700',
        fontSize: '1rem',
        color: theme.colors.primaryText,
    },
    voteDetail: {
        display: 'flex',
        alignItems: 'center',
        gap: '10px',
        marginBottom: '8px',
        fontSize: '0.9rem',
    },
    voteDetailLabel: {
        color: theme.colors.mutedText,
        minWidth: '60px',
        fontSize: '0.85rem',
    },
    voteDetailValue: {
        flex: 1,
        color: theme.colors.secondaryText,
    },
    emptyState: {
        textAlign: 'center',
        padding: '1.5rem',
        color: theme.colors.mutedText,
        fontSize: '0.95rem',
    },
});

const Post = () => {
    const [searchParams] = useSearchParams();
    const postId = searchParams.get('postid'); // Get post ID from query params
    const { createForumActor } = useForum();
    const { isAuthenticated, identity } = useAuth();
    const { theme } = useTheme();
    const { selectedSnsRoot } = useSns();
    const { principalNames, principalNicknames } = useNaming();
    const navigate = useNavigate();
    const styles = getStyles(theme);
    
    const handleSnsChange = () => {
        navigate('/forum');
    };

    const [threadId, setThreadId] = useState(null);
    const [threadDetails, setThreadDetails] = useState(null);
    const [postDetails, setPostDetails] = useState(null);
    const [topicInfo, setTopicInfo] = useState(null);
    const [forumInfo, setForumInfo] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [breadcrumbLoading, setBreadcrumbLoading] = useState(true);
    const [postVotes, setPostVotes] = useState([]);
    const [votesLoading, setVotesLoading] = useState(false);
    const [votesExpanded, setVotesExpanded] = useState(false);
    
    // SNS logo state
    const [snsLogo, setSnsLogo] = useState(null);
    const [loadingLogo, setLoadingLogo] = useState(false);
    const [snsInfo, setSnsInfo] = useState(null);

    // Get SNS from URL params if provided
    const snsParam = searchParams.get('sns');
    const currentSnsRoot = snsParam || selectedSnsRoot;

    // Memoize forumActor to prevent unnecessary re-renders
    const forumActor = useMemo(() => {
        return identity ? createForumActor(identity) : null;
    }, [identity, createForumActor]);

    // Format voting power for display (same as ThreadViewer)
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

    // Load SNS information and logo
    const loadSnsInfo = async () => {
        if (!currentSnsRoot) return;

        // Reset logo state when SNS changes
        setSnsLogo(null);
        setLoadingLogo(false);
        setSnsInfo(null);

        try {
            // Get SNS info from cache
            const allSnses = getAllSnses();
            const currentSnsInfo = allSnses.find(sns => sns.rootCanisterId === currentSnsRoot);
            
            if (currentSnsInfo) {
                setSnsInfo(currentSnsInfo);
                
                // Load logo if we have governance canister ID
                if (currentSnsInfo.canisters.governance) {
                    await loadSnsLogo(currentSnsInfo.canisters.governance, currentSnsInfo.name);
                }
            }
        } catch (error) {
            console.error('Error loading SNS info:', error);
        }
    };

    // Load SNS logo
    const loadSnsLogo = async (governanceId, snsName) => {
        if (loadingLogo) return;
        
        setLoadingLogo(true);
        
        try {
            const host = process.env.DFX_NETWORK === 'ic' || process.env.DFX_NETWORK === 'staging' ? 'https://ic0.app' : 'http://localhost:4943';
            const agent = new HttpAgent({
                host,
                ...(identity && { identity })
            });

            if (process.env.DFX_NETWORK !== 'ic') {
                await agent.fetchRootKey();
            }

            const logo = await fetchSnsLogo(governanceId, agent);
            setSnsLogo(logo);
        } catch (error) {
            console.error(`Error loading logo for SNS ${snsName}:`, error);
        } finally {
            setLoadingLogo(false);
        }
    };

    // Fetch post details to get the thread ID
    useEffect(() => {
        const fetchPostDetails = async () => {
            if (!forumActor || !postId) return;

            try {
                setLoading(true);
                setBreadcrumbLoading(true);
                setError(null);

                console.log('Fetching post details for post ID:', postId);
                const postResponse = await forumActor.get_post(Number(postId));
                
                if (postResponse && postResponse.length > 0) {
                    const post = postResponse[0];
                    console.log('Post details:', post);
                    setPostDetails(post);
                    setThreadId(Number(post.thread_id));

                    // Fetch thread to get topic_id, then fetch topic info
                    try {
                        const threadResponse = await forumActor.get_thread(Number(post.thread_id));
                        if (threadResponse && threadResponse.length > 0) {
                            const thread = threadResponse[0];
                            setThreadDetails(thread);
                            
                            // Get topic information
                            const topicResponse = await forumActor.get_topic(Number(thread.topic_id));
                            if (topicResponse && topicResponse.length > 0) {
                                const topic = topicResponse[0];
                                setTopicInfo(topic);
                                
                                // Get forum information
                                const forumResponse = await forumActor.get_forum(Number(topic.forum_id));
                                if (forumResponse && forumResponse.length > 0) {
                                    setForumInfo(forumResponse[0]);
                                }
                            }
                        }
                    } catch (topicError) {
                        console.error('Error fetching topic info for breadcrumb:', topicError);
                    }
                } else {
                    setError('Post not found');
                }
            } catch (err) {
                console.error('Error fetching post details:', err);
                setError(err.message || 'Failed to load post');
            } finally {
                setLoading(false);
                setBreadcrumbLoading(false);
            }
        };

        fetchPostDetails();
    }, [forumActor, postId]);

    // Load SNS info and logo when SNS changes
    useEffect(() => {
        if (currentSnsRoot) {
            loadSnsInfo();
        }
    }, [currentSnsRoot, identity]);

    // Auto-scroll to the focused post when page loads (with delay for expansion)
    useEffect(() => {
        if (!loading && threadId && postId) {
            // Wait a bit longer for ThreadViewer to expand ancestor posts
            const timer = setTimeout(() => {
                                 const scrollToPost = () => {
                     console.log(`🎯 DEBUG: Looking for focused post #${postId}`);
                     
                     // Debug: Check what's in the DOM
                     const allPostItems = document.querySelectorAll('.post-item');
                     console.log(`🎯 DEBUG: Found ${allPostItems.length} .post-item elements`);
                     
                     const focusedPosts = document.querySelectorAll('.focused-post');
                     console.log(`🎯 DEBUG: Found ${focusedPosts.length} .focused-post elements`);
                     
                     const dataPostElements = document.querySelectorAll(`[data-post-id]`);
                     console.log(`🎯 DEBUG: Found ${dataPostElements.length} elements with data-post-id`);
                     
                     const postLinks = document.querySelectorAll(`a[href*="postid="]`);
                     console.log(`🎯 DEBUG: Found ${postLinks.length} links with postid in href`);
                     
                     // Try each selector individually with debug info
                     let focusedPostElement = document.querySelector('.focused-post');
                     console.log(`🎯 DEBUG: .focused-post query result:`, focusedPostElement);
                     
                     if (!focusedPostElement) {
                         focusedPostElement = document.querySelector(`[data-post-id="${postId}"]`);
                         console.log(`🎯 DEBUG: [data-post-id="${postId}"] query result:`, focusedPostElement);
                     }
                     
                     if (!focusedPostElement) {
                         const linkElement = document.querySelector(`a[href*="postid=${postId}"]`);
                         console.log(`🎯 DEBUG: Link element with postid=${postId}:`, linkElement);
                         if (linkElement) {
                             focusedPostElement = linkElement.closest('.post-item');
                             console.log(`🎯 DEBUG: Closest .post-item to link:`, focusedPostElement);
                         }
                     }
                     
                     if (focusedPostElement) {
                         console.log(`🎯 DEBUG: Found focused post element:`, focusedPostElement);
                         console.log(`🎯 DEBUG: Element classes:`, focusedPostElement.className);
                         console.log(`🎯 DEBUG: Element position:`, focusedPostElement.getBoundingClientRect());
                         
                         focusedPostElement.scrollIntoView({ 
                             behavior: 'smooth', 
                             block: 'center' 
                         });
                         console.log(`Post page: Scrolled to focused post #${postId}`);
                         return true;
                     } else {
                         console.log(`DEBUG: No focused post element found for post #${postId}`);
                         
                         // Debug: Log some sample post items to see their structure
                         if (allPostItems.length > 0) {
                             console.log(`DEBUG: Sample post item HTML:`, allPostItems[0].outerHTML.substring(0, 500));
                         }
                         
                         return false;
                     }
                 };

                // Try to scroll with multiple retries
                const attemptScroll = (attempt = 1, maxAttempts = 5) => {
                    console.log(`🎯 DEBUG: Scroll attempt ${attempt}/${maxAttempts}`);
                    
                    if (scrollToPost()) {
                        console.log(`🎯 SUCCESS: Scroll succeeded on attempt ${attempt}`);
                        return;
                    }
                    
                    // If no posts rendered yet and we have attempts left
                    const postCount = document.querySelectorAll('.post-item').length;
                    console.log(`🎯 DEBUG: Post count on attempt ${attempt}: ${postCount}`);
                    
                    if (attempt < maxAttempts) {
                        const delay = attempt * 500; // Increasing delay: 500ms, 1000ms, 1500ms, 2000ms
                        console.log(`🎯 DEBUG: Retrying in ${delay}ms...`);
                        setTimeout(() => attemptScroll(attempt + 1, maxAttempts), delay);
                    } else {
                        console.log(`🎯 FAILED: Could not find focused post element for post #${postId} after ${maxAttempts} attempts`);
                    }
                };
                
                attemptScroll();
            }, 1200); // Wait longer for ThreadViewer to render posts
            
            return () => clearTimeout(timer);
        }
    }, [loading, threadId, postId]);

    // Fetch all votes for the focused post
    const fetchPostVotes = useCallback(async () => {
        if (!forumActor || !postId) return;

        try {
            setVotesLoading(true);
            console.log('Fetching all votes for post:', postId);
            
            const votes = await forumActor.get_post_votes(Number(postId));
            console.log('Post votes:', votes);
            
            setPostVotes(votes || []);
        } catch (error) {
            console.error('Error fetching post votes:', error);
        } finally {
            setVotesLoading(false);
        }
    }, [forumActor, postId]);

    // Fetch votes when post details are loaded
    useEffect(() => {
        if (postDetails) {
            fetchPostVotes();
        }
    }, [postDetails, fetchPostVotes]);

    const handleError = useCallback((error) => {
        console.error('Post page error:', error);
        setError(error.message || 'An error occurred');
    }, []);

    // Render forum header
    const renderForumHeader = () => {
        if (!forumInfo) return null;
        
        return (
            <div style={styles.forumHeader}>
                <div style={styles.forumHeaderInner}>
                    {/* SNS Logo */}
                    <div style={styles.snsLogoWrapper}>
                        {loadingLogo ? (
                            <span style={styles.snsLogoPlaceholder}>...</span>
                        ) : snsLogo ? (
                            <img
                                src={snsLogo}
                                alt={snsInfo?.name || 'SNS Logo'}
                                style={styles.snsLogo}
                            />
                        ) : (
                            <span style={styles.snsLogoPlaceholder}>
                                {snsInfo?.name?.substring(0, 2).toUpperCase() || 'SNS'}
                            </span>
                        )}
                    </div>
                    
                    {/* Forum Title */}
                    <h1 style={styles.forumTitle}>
                        {snsInfo?.name ? `${snsInfo.name} Forum` : (forumInfo.title || 'Forum')}
                    </h1>
                    
                    {/* Discussion Icon */}
                    <FaComments size={24} color={forumPrimary} style={{ opacity: 0.6 }} />
                </div>
            </div>
        );
    };

    // Render votes section
    const renderVotesSection = () => {
        if (!postDetails) return null;
        
        const upvotes = postVotes.filter(v => v.vote_type.upvote !== undefined);
        const downvotes = postVotes.filter(v => v.vote_type.downvote !== undefined);
        const totalUpVP = upvotes.reduce((sum, v) => sum + Number(v.voting_power || 0), 0);
        const totalDownVP = downvotes.reduce((sum, v) => sum + Number(v.voting_power || 0), 0);
        const netScore = totalUpVP - totalDownVP;
        const netColor = netScore > 0 ? theme.colors.success : netScore < 0 ? theme.colors.error : theme.colors.mutedText;
        
        return (
            <div style={styles.votesSection} className="post-fade-in">
                <div style={styles.votesHeader}>
                    <h3 style={styles.votesTitle}>
                        <div style={styles.votesTitleIcon}>
                            <FaThumbsUp size={18} color={forumPrimary} />
                        </div>
                        All Votes for This Post
                    </h3>
                    {postVotes.length > 0 && (
                        <button
                            onClick={() => setVotesExpanded(!votesExpanded)}
                            style={styles.toggleButton}
                            onMouseEnter={(e) => {
                                e.target.style.borderColor = theme.colors.accent;
                                e.target.style.background = theme.colors.tertiaryBg;
                            }}
                            onMouseLeave={(e) => {
                                e.target.style.borderColor = theme.colors.border;
                                e.target.style.background = theme.colors.secondaryBg;
                            }}
                        >
                            {votesExpanded ? 'Hide Details' : 'Show Details'}
                            {votesExpanded ? <FaChevronUp size={12} /> : <FaChevronDown size={12} />}
                        </button>
                    )}
                </div>
                
                {votesLoading ? (
                    <div style={styles.emptyState}>
                        <FaSpinner className="post-spin" size={20} style={{ marginRight: '8px' }} />
                        Loading votes...
                    </div>
                ) : postVotes.length === 0 ? (
                    <div style={styles.emptyState}>No votes yet</div>
                ) : (
                    <>
                        {/* Summary */}
                        <div style={styles.summaryRow}>
                            <div style={styles.summaryItem(theme.colors.success)}>
                                <FaThumbsUp size={14} />
                                {upvotes.length} upvotes ({formatVotingPowerDisplay(totalUpVP)} VP)
                            </div>
                            <div style={styles.summaryItem(theme.colors.error)}>
                                <FaThumbsDown size={14} />
                                {downvotes.length} downvotes ({formatVotingPowerDisplay(totalDownVP)} VP)
                            </div>
                        </div>
                        <div style={styles.netScoreBox(netColor)}>
                            Net Score: {netScore >= 0 ? '+' : ''}{formatVotingPowerDisplay(netScore)} VP
                        </div>
                        
                        {/* Individual Votes */}
                        {votesExpanded && (
                            <div style={styles.votesGrid}>
                                {postVotes
                                    .sort((a, b) => Number(b.voting_power || 0) - Number(a.voting_power || 0))
                                    .map((vote, index) => {
                                        const isUpvote = vote.vote_type.upvote !== undefined;
                                        const neuronId = vote.neuron_id?.id;
                                        const votingPower = Number(vote.voting_power || 0);
                                        
                                        const principalDisplayInfo = getPrincipalDisplayInfoFromContext(
                                            vote.voter_principal, 
                                            principalNames, 
                                            principalNicknames
                                        );
                                        
                                        const neuronLink = formatNeuronIdLink(neuronId, currentSnsRoot);
                                        
                                        return (
                                            <div key={index} style={styles.voteCard(isUpvote, theme)}>
                                                <div style={styles.voteCardHeader}>
                                                    <div style={styles.voteType(isUpvote, theme)}>
                                                        {isUpvote ? <FaThumbsUp size={16} /> : <FaThumbsDown size={16} />}
                                                        {isUpvote ? 'Upvote' : 'Downvote'}
                                                    </div>
                                                    <span style={styles.votePower}>
                                                        {formatVotingPowerDisplay(votingPower)} VP
                                                    </span>
                                                </div>
                                                
                                                <div style={styles.voteDetail}>
                                                    <FaBrain size={14} color={theme.colors.mutedText} />
                                                    <span style={styles.voteDetailLabel}>Neuron:</span>
                                                    <div style={styles.voteDetailValue}>
                                                        {neuronLink}
                                                    </div>
                                                </div>
                                                
                                                <div style={styles.voteDetail}>
                                                    <FaUser size={14} color={theme.colors.mutedText} />
                                                    <span style={styles.voteDetailLabel}>Voter:</span>
                                                    <div style={styles.voteDetailValue}>
                                                        <PrincipalDisplay 
                                                            principal={vote.voter_principal}
                                                            displayInfo={principalDisplayInfo}
                                                            showCopyButton={false}
                                                            style={{ fontSize: '0.9rem' }}
                                                        />
                                                    </div>
                                                </div>
                                                
                                                <div style={{ ...styles.voteDetail, marginBottom: 0 }}>
                                                    <FaClock size={14} color={theme.colors.mutedText} />
                                                    <span style={styles.voteDetailLabel}>When:</span>
                                                    <span style={{ color: theme.colors.secondaryText, fontSize: '0.85rem' }}>
                                                        {new Date(Number(vote.created_at) / 1000000).toLocaleString()}
                                                    </span>
                                                </div>
                                            </div>
                                        );
                                    })
                                }
                            </div>
                        )}
                    </>
                )}
            </div>
        );
    };

    if (!postId) {
        return (
            <div style={styles.pageContainer}>
                <style>{customAnimations}</style>
                <Header showSnsDropdown={true} onSnsChange={handleSnsChange} />
                <div style={styles.container}>
                    <div style={styles.errorCard} className="post-fade-in">
                        <div style={styles.errorIcon}>
                            <FaExclamationTriangle size={28} color={theme.colors.error} />
                        </div>
                        <h2 style={styles.errorTitle}>Post Not Found</h2>
                        <p style={styles.errorText}>
                            No post ID provided in the URL. Please use ?postid=123 format.
                        </p>
                    </div>
                </div>
            </div>
        );
    }

    if (loading) {
        return (
            <div style={styles.pageContainer}>
                <style>{customAnimations}</style>
                <Header showSnsDropdown={true} onSnsChange={handleSnsChange} />
                <div style={styles.container}>
                    <div style={styles.loadingCard} className="post-fade-in">
                        <div style={styles.loadingIcon}>
                            <FaSpinner size={28} color={forumPrimary} className="post-spin" />
                        </div>
                        <p style={styles.loadingText}>Loading post...</p>
                    </div>
                </div>
            </div>
        );
    }

    if (error) {
        return (
            <div style={styles.pageContainer}>
                <style>{customAnimations}</style>
                <Header showSnsDropdown={true} onSnsChange={handleSnsChange} />
                <div style={styles.container}>
                    <div style={styles.errorCard} className="post-fade-in">
                        <div style={styles.errorIcon}>
                            <FaExclamationTriangle size={28} color={theme.colors.error} />
                        </div>
                        <h2 style={styles.errorTitle}>Error Loading Post</h2>
                        <p style={styles.errorText}>{error}</p>
                    </div>
                </div>
            </div>
        );
    }

    // Only render ThreadViewer when we have successfully loaded the threadId
    if (!threadId) {
        // If we're not loading and have no error, but still no threadId, then post wasn't found
        if (!loading && !error) {
            return (
                <div style={styles.pageContainer}>
                    <style>{customAnimations}</style>
                    <Header showSnsDropdown={true} onSnsChange={handleSnsChange} />
                    <div style={styles.container}>
                        <div style={styles.errorCard} className="post-fade-in">
                            <div style={styles.errorIcon}>
                                <FaExclamationTriangle size={28} color={theme.colors.error} />
                            </div>
                            <h2 style={styles.errorTitle}>Post Not Found</h2>
                            <p style={styles.errorText}>
                                Could not find the requested post or determine its thread.
                            </p>
                        </div>
                    </div>
                </div>
            );
        }
        return null;
    }

    return (
        <div style={styles.pageContainer}>
            <style>{customAnimations}</style>
            <Header showSnsDropdown={true} onSnsChange={handleSnsChange} />
            
            {renderForumHeader()}
            
            <div style={styles.container}>
                {/* Breadcrumb */}
                {!breadcrumbLoading && topicInfo && (
                    <div style={styles.breadcrumb} className="post-fade-in">
                        <Link to="/forum" style={styles.breadcrumbLink}>
                            <FaHome size={14} />
                            Forum
                        </Link>
                        <FaChevronRight size={10} style={styles.breadcrumbSeparator} />
                        <Link to={`/topic/${topicInfo.id}`} style={styles.breadcrumbLink}>
                            {topicInfo.title}
                        </Link>
                        <FaChevronRight size={10} style={styles.breadcrumbSeparator} />
                        <Link to={`/thread?threadid=${threadId}`} style={styles.breadcrumbLink}>
                            Thread
                        </Link>
                        <FaChevronRight size={10} style={styles.breadcrumbSeparator} />
                        <span style={styles.breadcrumbCurrent}>
                            Post
                        </span>
                    </div>
                )}
                
                <ThreadViewer
                    forumActor={forumActor}
                    mode="post"
                    threadId={threadId}
                    focusedPostId={Number(postId)}
                    selectedSnsRoot={currentSnsRoot}
                    isAuthenticated={isAuthenticated}
                    onError={handleError}
                    showCreatePost={true}
                />

                {renderVotesSection()}
            </div>
        </div>
    );
};

export default Post;
