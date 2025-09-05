import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useParams, Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Principal } from '@dfinity/principal';
import { useAuth } from '../AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import { useSns } from '../contexts/SnsContext';
import Header from '../components/Header';
import { createActor, canisterId } from 'declarations/sneed_sns_forum';
import { useTextLimits } from '../hooks/useTextLimits';
import { formatError } from '../utils/errorUtils';
import { createActor as createSnsGovernanceActor } from 'external/sns_governance';
import { getSnsById, fetchSnsLogo, getAllSnses } from '../utils/SnsUtils';
import { getPostsByThread } from '../utils/BackendUtils';
import { HttpAgent } from '@dfinity/agent';

const getStyles = (theme) => ({
    container: {
        maxWidth: '1200px',
        margin: '0 auto',
        padding: '20px'
    },
    breadcrumb: {
        marginBottom: '20px',
        fontSize: '0.9rem'
    },
    breadcrumbLink: {
        color: theme.colors.accent,
        textDecoration: 'none'
    },
    breadcrumbSeparator: {
        color: theme.colors.mutedText,
        margin: '0 8px'
    },
    currentPage: {
        color: '#ccc'
    },
    header: {
        marginBottom: '30px'
    },
    title: {
        color: theme.colors.primaryText,
        fontSize: '2.2rem',
        marginBottom: '10px',
        fontWeight: '600'
    },
    description: {
        color: theme.colors.secondaryText,
        fontSize: '1.1rem',
        lineHeight: '1.6',
        marginBottom: '20px'
    },
    meta: {
        color: theme.colors.mutedText,
        fontSize: '0.9rem'
    },
    section: {
        marginBottom: '40px'
    },
    sectionTitle: {
        color: theme.colors.primaryText,
        fontSize: '1.5rem',
        marginBottom: '20px',
        fontWeight: '500'
    },
    subtopicsGrid: {
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
        gap: '15px',
        marginBottom: '30px'
    },
    subtopicCard: {
        backgroundColor: theme.colors.secondaryBg,
        borderRadius: '6px',
        padding: '15px',
        border: `1px solid ${theme.colors.border}`,
        transition: 'all 0.2s ease',
        cursor: 'pointer',
        textDecoration: 'none',
        color: 'inherit'
    },
    subtopicCardHover: {
        borderColor: '#3498db',
        transform: 'translateY(-1px)'
    },
    subtopicTitle: {
        color: theme.colors.primaryText,
        fontSize: '1.1rem',
        fontWeight: '500',
        marginBottom: '8px'
    },
    subtopicDescription: {
        color: theme.colors.secondaryText,
        fontSize: '0.9rem',
        lineHeight: '1.4'
    },
    threadsContainer: {
        backgroundColor: theme.colors.secondaryBg,
        borderRadius: '8px',
        border: `1px solid ${theme.colors.border}`,
        overflow: 'hidden'
    },
    threadItem: {
        padding: '20px',
        borderBottom: `1px solid ${theme.colors.border}`,
        transition: 'background-color 0.2s ease',
        cursor: 'pointer'
    },
    threadItemHover: {
        backgroundColor: theme.colors.accentHover
    },
    threadTitle: {
        color: theme.colors.primaryText,
        fontSize: '1.1rem',
        fontWeight: '500',
        marginBottom: '8px'
    },
    threadBody: {
        color: theme.colors.secondaryText,
        fontSize: '0.95rem',
        lineHeight: '1.5',
        marginBottom: '10px',
        display: '-webkit-box',
        WebkitLineClamp: 2,
        WebkitBoxOrient: 'vertical',
        overflow: 'hidden'
    },
    threadMeta: {
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        fontSize: '0.85rem',
        color: '#888'
    },
    pagination: {
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        gap: '10px',
        padding: '20px',
        backgroundColor: '#2a2a2a'
    },
    pageButton: {
        backgroundColor: '#3498db',
        color: theme.colors.primaryText,
        border: 'none',
        borderRadius: '4px',
        padding: '8px 12px',
        cursor: 'pointer',
        fontSize: '0.9rem',
        transition: 'background-color 0.2s ease'
    },
    pageButtonDisabled: {
        backgroundColor: theme.colors.mutedText,
        cursor: 'not-allowed',
        opacity: 0.6
    },
    pageInfo: {
        color: theme.colors.secondaryText,
        fontSize: '0.9rem'
    },
    createThreadSection: {
        backgroundColor: theme.colors.secondaryBg,
        borderRadius: '8px',
        padding: '25px',
        border: `1px solid ${theme.colors.border}`,
        marginTop: '30px',
        boxShadow: '0 2px 8px rgba(0, 0, 0, 0.1)'
    },
    form: {
        display: 'flex',
        flexDirection: 'column',
        gap: '20px'
    },
    inputGroup: {
        display: 'flex',
        flexDirection: 'column',
        gap: '8px',
        width: '100%'
    },
    threadTitleInput: {
        backgroundColor: theme.colors.primaryBg,
        border: `1px solid ${theme.colors.border}`,
        borderRadius: '6px',
        padding: '14px 16px',
        color: theme.colors.primaryText,
        fontSize: '1rem',
        transition: 'border-color 0.2s ease, box-shadow 0.2s ease',
        fontFamily: 'inherit',
        width: '100%',
        boxSizing: 'border-box',
        display: 'block'
    },
    threadBodyTextarea: {
        backgroundColor: theme.colors.primaryBg,
        border: `1px solid ${theme.colors.border}`,
        borderRadius: '6px',
        padding: '14px 16px',
        color: theme.colors.primaryText,
        fontSize: '1rem',
        minHeight: '140px',
        resize: 'vertical',
        transition: 'border-color 0.2s ease, box-shadow 0.2s ease',
        fontFamily: 'inherit',
        lineHeight: '1.5',
        width: '100%',
        boxSizing: 'border-box',
        display: 'block'
    },
    threadInputFocus: {
        borderColor: '#3498db',
        boxShadow: '0 0 0 2px rgba(52, 152, 219, 0.2)',
        outline: 'none'
    },
    threadInputError: {
        borderColor: '#e74c3c',
        boxShadow: '0 0 0 2px rgba(231, 76, 60, 0.2)'
    },
    characterCounter: {
        fontSize: '0.85rem',
        textAlign: 'right',
        marginTop: '4px'
    },
    submitButton: {
        backgroundColor: '#3498db',
        color: theme.colors.primaryText,
        border: 'none',
        borderRadius: '6px',
        padding: '14px 28px',
        cursor: 'pointer',
        fontSize: '1rem',
        fontWeight: '600',
        alignSelf: 'flex-start',
        transition: 'all 0.2s ease',
        boxShadow: '0 2px 4px rgba(52, 152, 219, 0.2)',
        marginTop: '4px'
    },
    submitButtonHover: {
        backgroundColor: '#2980b9',
        transform: 'translateY(-1px)',
        boxShadow: '0 4px 8px rgba(52, 152, 219, 0.3)'
    },
    submitButtonDisabled: {
        backgroundColor: theme.colors.mutedText,
        cursor: 'not-allowed',
        opacity: 0.6,
        transform: 'none',
        boxShadow: 'none'
    },
    loading: {
        textAlign: 'center',
        color: theme.colors.mutedText,
        fontSize: '1.1rem',
        padding: '40px'
    },
    error: {
        backgroundColor: 'rgba(231, 76, 60, 0.2)',
        border: `1px solid ${theme.colors.error}`,
        color: theme.colors.error,
        padding: '15px',
        borderRadius: '6px',
        marginBottom: '20px',
        textAlign: 'center'
    },
    noContent: {
        textAlign: 'center',
        color: theme.colors.mutedText,
        fontSize: '1rem',
        padding: '30px'
    },
    preproposalsPrompt: {
        backgroundColor: theme.colors.secondaryBg,
        border: '1px solid #3498db',
        borderRadius: '8px',
        padding: '20px',
        marginTop: '30px',
        marginBottom: '30px',
        textAlign: 'center'
    },
    preproposalsPromptTitle: {
        color: theme.colors.accent,
        fontSize: '1.3rem',
        fontWeight: '600',
        marginBottom: '10px'
    },
    preproposalsPromptMessage: {
        color: theme.colors.secondaryText,
        fontSize: '1rem',
        marginBottom: '20px',
        lineHeight: '1.5'
    },
    preproposalsPromptButtons: {
        display: 'flex',
        gap: '15px',
        justifyContent: 'center',
        alignItems: 'center'
    },
    createPreproposalsButton: {
        backgroundColor: '#3498db',
        color: theme.colors.primaryText,
        border: 'none',
        borderRadius: '6px',
        padding: '10px 20px',
        fontSize: '0.95rem',
        fontWeight: '500',
        cursor: 'pointer',
        transition: 'all 0.2s ease'
    },
    dismissButton: {
        backgroundColor: 'transparent',
        color: theme.colors.mutedText,
        border: `1px solid ${theme.colors.border}`,
        borderRadius: '6px',
        padding: '10px 20px',
        fontSize: '0.95rem',
        cursor: 'pointer',
        transition: 'all 0.2s ease'
    },
    buttonDisabled: {
        opacity: 0.6,
        cursor: 'not-allowed'
    }
});

function Topic() {
    const { topicId } = useParams();
    const [searchParams, setSearchParams] = useSearchParams();
    const { identity } = useAuth();
    const { theme } = useTheme();
    const { selectedSnsRoot, updateSelectedSns, SNEED_SNS_ROOT } = useSns();
    const navigate = useNavigate();

    // Get SNS from URL params if provided, otherwise use selected SNS
    const snsParam = searchParams.get('sns');
    const currentSnsRoot = snsParam || selectedSnsRoot;
    
    const handleSnsChange = (newSnsRoot) => {
        console.log('Topic page: SNS change detected, navigating to forum. New SNS:', newSnsRoot);
        navigate('/forum');
    };
    
    const [topic, setTopic] = useState(null);
    const [forumInfo, setForumInfo] = useState(null);
    const [subtopics, setSubtopics] = useState([]);
    const [threads, setThreads] = useState([]);
    const [threadPostCounts, setThreadPostCounts] = useState(new Map());
    
    // SNS logo state
    const [snsLogo, setSnsLogo] = useState(null);
    const [loadingLogo, setLoadingLogo] = useState(false);
    const [snsInfo, setSnsInfo] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [breadcrumbLoading, setBreadcrumbLoading] = useState(true);
    const [hoveredCard, setHoveredCard] = useState(null);
    const [hoveredThread, setHoveredThread] = useState(null);
    const [currentPage, setCurrentPage] = useState(0);
    const [totalThreads, setTotalThreads] = useState(0);
    const [threadsPerPage, setThreadsPerPage] = useState(() => {
        try {
            const saved = localStorage.getItem('topicThreadsPerPage');
            return saved ? parseInt(saved) : 10;
        } catch (e) {
            return 10;
        }
    });
    const [sortBy, setSortBy] = useState(() => {
        try {
            const saved = localStorage.getItem('topicSortBy');
            return saved || 'newest';
        } catch (e) {
            return 'newest';
        }
    });
    const [createThreadTitle, setCreateThreadTitle] = useState('');
    const [createThreadBody, setCreateThreadBody] = useState('');
    const [submitting, setSubmitting] = useState(false);
    const [showPreproposalsPrompt, setShowPreproposalsPrompt] = useState(false);
    const [creatingPreproposals, setCreatingPreproposals] = useState(false);
    const [isMobile, setIsMobile] = useState(window.innerWidth <= 768);
    const [userThreadReads, setUserThreadReads] = useState(new Map()); // threadId -> lastReadPostId
    const [subtopicStatistics, setSubtopicStatistics] = useState(new Map()); // topicId -> {thread_count, total_unread_posts}
    
    // Poll creation state
    const [includePoll, setIncludePoll] = useState(false);
    const [pollTitle, setPollTitle] = useState('');
    const [pollBody, setPollBody] = useState('');
    const [pollOptions, setPollOptions] = useState([{ title: '', body: '' }, { title: '', body: '' }]);
    const [pollVpPower, setPollVpPower] = useState(1.0);
    
    // Set default poll expiration to exactly 5 days from now
    const getDefaultEndDateTime = () => {
        const now = new Date();
        const fiveDaysFromNow = new Date(now.getTime() + (5 * 24 * 60 * 60 * 1000)); // Add 5 days in milliseconds
        
        const dateStr = fiveDaysFromNow.toISOString().split('T')[0]; // YYYY-MM-DD format
        const timeStr = fiveDaysFromNow.toTimeString().slice(0, 5); // HH:MM format
        
        return { dateStr, timeStr };
    };
    
    const defaultDateTime = getDefaultEndDateTime();
    const [pollEndDate, setPollEndDate] = useState(defaultDateTime.dateStr);
    const [pollEndTime, setPollEndTime] = useState(defaultDateTime.timeStr);
    const [allowVoteChanges, setAllowVoteChanges] = useState(true);
    
    // State for thread proposal information
    const [threadProposals, setThreadProposals] = useState(new Map()); // Map<threadId, {proposalId, proposalData}>
    
    // Get forum actor for text limits (memoized to prevent repeated fetching)
    const forumActor = useMemo(() => {
        return identity ? createActor(canisterId, {
            agentOptions: {
                host: process.env.DFX_NETWORK === 'ic' ? 'https://icp0.io' : 'http://localhost:4943',
                identity: identity,
            },
        }) : null;
    }, [identity]);
    
    // Get text limits
    const { textLimits } = useTextLimits(forumActor);

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
            const host = process.env.DFX_NETWORK === 'ic' ? 'https://ic0.app' : 'http://localhost:4943';
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

    // Sync URL parameters with global state
    useEffect(() => {
        const snsParam = searchParams.get('sns');
        if (snsParam && snsParam !== selectedSnsRoot) {
            // URL parameter takes precedence (for direct links)
            updateSelectedSns(snsParam);
        } else if (!snsParam && selectedSnsRoot !== SNEED_SNS_ROOT) {
            // Update URL to match global state
            setSearchParams(prev => {
                prev.set('sns', selectedSnsRoot);
                return prev;
            });
        }
    }, [searchParams, selectedSnsRoot, updateSelectedSns, SNEED_SNS_ROOT, setSearchParams]);

    // Fetch user thread read status
    const fetchUserThreadReads = useCallback(async () => {
        if (!forumActor || !identity || !topicId) return;
        
        try {
            const reads = await forumActor.get_user_thread_reads_for_topic(parseInt(topicId));
            const readMap = new Map();
            reads.forEach(([threadId, lastReadPostId]) => {
                readMap.set(threadId.toString(), Number(lastReadPostId));
            });
            setUserThreadReads(readMap);
        } catch (error) {
            console.warn('Failed to fetch user thread reads:', error);
        }
    }, [forumActor, identity, topicId]);

    // Async function to check and fetch proposal data for threads
    const fetchProposalDataForThreads = useCallback(async (threads) => {
        if (!forumActor || !identity || !currentSnsRoot || !threads.length) return;
        
        // Only fetch for "Proposals" topic to avoid unnecessary API calls
        if (topic?.title !== "Proposals") return;

        console.log('Fetching proposal data for threads in Proposals topic');
        
        // Process threads in parallel, but limit concurrency to avoid overwhelming the API
        const batchSize = 5;
        const newProposalData = new Map();
        
        for (let i = 0; i < threads.length; i += batchSize) {
            const batch = threads.slice(i, i + batchSize);
            
            await Promise.allSettled(batch.map(async (thread) => {
                try {
                    // Check if thread is linked to proposal
                    const proposalLink = await forumActor.get_thread_proposal_id(Number(thread.id));
                    
                    if (proposalLink && Array.isArray(proposalLink) && proposalLink.length > 0) {
                        const tuple = proposalLink[0];
                        if (Array.isArray(tuple) && tuple.length === 2) {
                            const [snsRootIndex, proposalId] = tuple;
                            const proposalIdNum = Number(proposalId);
                            
                            console.log(`Thread ${thread.id} linked to proposal ${proposalIdNum}`);
                            
                            // Fetch proposal data from governance
                            try {
                                const selectedSns = getSnsById(currentSnsRoot);
                                if (selectedSns) {
                                    const snsGovActor = createSnsGovernanceActor(selectedSns.canisters.governance, {
                                        agentOptions: { identity },
                                    });

                                    const response = await snsGovActor.get_proposal({
                                        proposal_id: [{ id: BigInt(proposalIdNum) }]
                                    });

                                    if (response?.result?.[0]?.Proposal) {
                                        newProposalData.set(thread.id.toString(), {
                                            proposalId: proposalIdNum,
                                            proposalData: response.result[0].Proposal
                                        });
                                        console.log(`Fetched proposal data for thread ${thread.id}, proposal ${proposalIdNum}`);
                                    }
                                }
                            } catch (govError) {
                                console.warn(`Failed to fetch proposal ${proposalIdNum} for thread ${thread.id}:`, govError);
                            }
                        }
                    }
                } catch (error) {
                    console.warn(`Failed to check proposal link for thread ${thread.id}:`, error);
                }
            }));
        }
        
        // Update state with new proposal data
        if (newProposalData.size > 0) {
            setThreadProposals(prev => {
                const updated = new Map(prev);
                newProposalData.forEach((value, key) => {
                    updated.set(key, value);
                });
                return updated;
            });
        }
    }, [forumActor, identity, currentSnsRoot, topic?.title]);

    // Fetch post counts for threads asynchronously (non-blocking)
    const fetchThreadPostCounts = useCallback(async (threads) => {
        if (!forumActor || !threads.length) return;
        
        try {
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
    }, [forumActor]);

    // Fetch forum information for breadcrumb and SNS context
    useEffect(() => {
        const fetchForumInfo = async () => {
            if (!forumActor || !topicId) {
                setBreadcrumbLoading(false);
                return;
            }

            try {
                // First get the topic to find its forum_id
                const topicResponse = await forumActor.get_topic(Number(topicId));
                if (!topicResponse || topicResponse.length === 0) {
                    setBreadcrumbLoading(false);
                    return;
                }

                const topicData = topicResponse[0];
                
                // Then get the forum information
                const forumResponse = await forumActor.get_forum(Number(topicData.forum_id));
                if (forumResponse && forumResponse.length > 0) {
                    const forum = forumResponse[0];
                    setForumInfo(forum);
                    
                    // Update SNS context and URL based on forum's SNS root canister ID
                    if (forum.sns_root_canister_id && forum.sns_root_canister_id.length > 0) {
                        const forumSnsRoot = forum.sns_root_canister_id[0].toText();
                        
                        // Always update if the discovered SNS is different from current
                        if (forumSnsRoot !== selectedSnsRoot) {
                            console.log(`Topic page: Discovered SNS ${forumSnsRoot} from forum, updating context and URL`);
                            updateSelectedSns(forumSnsRoot);
                        }
                        
                        // Update URL parameter if it's missing or incorrect
                        const currentSnsParam = searchParams.get('sns');
                        if (!currentSnsParam || currentSnsParam !== forumSnsRoot) {
                            setSearchParams(prev => {
                                const newParams = new URLSearchParams(prev);
                                newParams.set('sns', forumSnsRoot);
                                return newParams;
                            });
                        }
                    }
                }
            } catch (error) {
                console.error('Error fetching forum info for breadcrumb:', error);
            } finally {
                setBreadcrumbLoading(false);
            }
        };

        fetchForumInfo();
    }, [forumActor, topicId, selectedSnsRoot, updateSelectedSns, searchParams, setSearchParams]);

    // Load SNS info and logo when SNS changes
    useEffect(() => {
        if (currentSnsRoot) {
            loadSnsInfo();
        }
    }, [currentSnsRoot, identity]);

    useEffect(() => {
        if (!topicId) {
            setError('Invalid topic ID');
            setLoading(false);
            return;
        }

        fetchTopicData();
    }, [topicId, identity, currentPage, threadsPerPage, sortBy]);

    // Save threadsPerPage to localStorage when it changes
    useEffect(() => {
        try {
            localStorage.setItem('topicThreadsPerPage', threadsPerPage.toString());
        } catch (e) {
            console.warn('Failed to save threadsPerPage to localStorage:', e);
        }
    }, [threadsPerPage]);

    // Save sortBy to localStorage when it changes
    useEffect(() => {
        try {
            localStorage.setItem('topicSortBy', sortBy);
        } catch (e) {
            console.warn('Failed to save sortBy to localStorage:', e);
        }
    }, [sortBy]);

    // Handle window resize for mobile detection
    useEffect(() => {
        const handleResize = () => {
            setIsMobile(window.innerWidth <= 768);
        };

        window.addEventListener('resize', handleResize);
        return () => window.removeEventListener('resize', handleResize);
    }, []);

    // Fetch proposal data for threads when threads are loaded (async, non-blocking)
    useEffect(() => {
        if (threads.length > 0) {
            // Run in background without blocking UI
            fetchProposalDataForThreads(threads);
        }
    }, [threads, fetchProposalDataForThreads]);

    // Fetch post counts for threads when threads are loaded (async, non-blocking)
    useEffect(() => {
        if (threads.length > 0) {
            fetchThreadPostCounts(threads);
        }
    }, [threads, fetchThreadPostCounts]);

    // Fetch user thread read status when topic is loaded
    useEffect(() => {
        if (!loading && topicId && identity) {
            fetchUserThreadReads();
        }
    }, [fetchUserThreadReads, loading, topicId, identity]);

    // Fetch subtopic statistics (async, non-blocking)
    const fetchSubtopicStatistics = useCallback(async (subtopicIds) => {
        if (!forumActor || !identity || subtopicIds.length === 0) return;
        
        // Fetch statistics for all subtopics in parallel
        const statisticsPromises = subtopicIds.map(async (topicId) => {
            try {
                const stats = await forumActor.get_topic_statistics(topicId);
                return { topicId, stats };
            } catch (error) {
                console.warn(`Failed to fetch statistics for subtopic ${topicId}:`, error);
                return { topicId, stats: null };
            }
        });
        
        try {
            const results = await Promise.allSettled(statisticsPromises);
            const statsMap = new Map();
            
            results.forEach((result) => {
                if (result.status === 'fulfilled' && result.value.stats) {
                    const { topicId, stats } = result.value;
                    statsMap.set(topicId, {
                        thread_count: Number(stats.thread_count),
                        total_unread_posts: Number(stats.total_unread_posts)
                    });
                }
            });
            
            setSubtopicStatistics(statsMap);
        } catch (error) {
            console.warn('Failed to fetch subtopic statistics:', error);
        }
    }, [forumActor, identity]);

    // Fetch subtopic statistics when subtopics are loaded
    useEffect(() => {
        if (subtopics.length > 0) {
            const subtopicIds = subtopics.map(subtopic => subtopic.id);
            fetchSubtopicStatistics(subtopicIds);
        }
    }, [subtopics, fetchSubtopicStatistics]);

    // Helper function to check if thread has unread posts
    const hasUnreadPosts = (thread) => {
        // Use the unread count from the backend if available
        if (thread.unread_posts_count !== undefined && thread.unread_posts_count !== null) {
            return Number(thread.unread_posts_count[0] || 0) > 0;
        }
        
        // Fallback to old heuristic if unread count not available
        const threadId = thread.id.toString();
        const lastReadPostId = userThreadReads.get(threadId) || 0;
        const postCount = threadPostCounts.get(threadId);
        
        if (postCount === undefined) return false;
        if (postCount > 0 && lastReadPostId === 0) return true;
        
        return false;
    };

    const isRootGovernanceTopic = (topic) => {
        return topic && 
               topic.title === "Governance" && 
               (!topic.parent_topic_id || topic.parent_topic_id.length === 0) &&
               !topic.deleted;
    };

    const checkForPreproposalsSubtopic = (subtopics) => {
        return subtopics.some(subtopic => 
            subtopic.title === "Preproposals" && !subtopic.deleted
        );
    };

    const handleCreatePreproposalsTopic = async () => {
        if (!identity || !currentSnsRoot || creatingPreproposals) return;

        setCreatingPreproposals(true);
        try {
            const forumActor = createActor(canisterId, {
                agentOptions: {
                    host: process.env.DFX_NETWORK === 'ic' ? 'https://icp0.io' : 'http://localhost:4943',
                    identity: identity,
                },
            });

            const snsRootPrincipal = Principal.fromText(currentSnsRoot);
            const result = await forumActor.create_special_topic({
                sns_root_canister_id: snsRootPrincipal,
                special_topic_type: { 'Preproposals': null }
            });

            if ('ok' in result) {
                console.log('Preproposals topic created successfully, topic ID:', result.ok);
                setShowPreproposalsPrompt(false);
                // Navigate to the new topic page
                navigate(`/topic/${result.ok}${currentSnsRoot ? `?sns=${currentSnsRoot}` : ''}`);
            } else {
                console.error('Error creating Preproposals topic:', result.err);
                setError('Failed to create Preproposals topic: ' + result.err);
            }
        } catch (err) {
            console.error('Error creating Preproposals topic:', err);
            setError('Failed to create Preproposals topic: ' + err.message);
        } finally {
            setCreatingPreproposals(false);
        }
    };

    const fetchTopicData = async () => {
        try {
            setLoading(true);
            setError(null);

            // Create forum actor
            const forumActor = createActor(canisterId, {
                agentOptions: {
                    host: process.env.DFX_NETWORK === 'ic' ? 'https://icp0.io' : 'http://localhost:4943',
                    identity: identity || undefined,
                },
            });

            // Get topic details - Motoko optionals are serialized as arrays
            const topicResponse = await forumActor.get_topic(parseInt(topicId));
            
            if (!topicResponse || topicResponse.length === 0) {
                setError('Topic not found');
                return;
            }

            const topic = topicResponse[0];
            setTopic(topic);

            // Get subtopics
            const subtopicsResponse = await forumActor.get_subtopics(parseInt(topicId));
            const activeSubtopics = subtopicsResponse.filter(subtopic => !subtopic.deleted);
            setSubtopics(activeSubtopics);

            // Check if we need to show Preproposals prompt
            if (isRootGovernanceTopic(topic)) {
                const hasPreproposals = checkForPreproposalsSubtopic(activeSubtopics);
                setShowPreproposalsPrompt(!hasPreproposals);
            } else {
                setShowPreproposalsPrompt(false);
            }

            let threadsResponse;
            let paginatedThreads;
            let totalCount;

            if (sortBy.startsWith('activity-')) {
                // Use activity-based sorting with backend pagination
                const reverse = sortBy === 'activity-newest';
                const startFrom = currentPage * threadsPerPage;
                
                const activityResponse = await forumActor.get_threads_by_activity_with_unread_counts(
                    parseInt(topicId),
                    [startFrom], // Optional Nat
                    threadsPerPage,
                    reverse
                );
                
                if (activityResponse) {
                    paginatedThreads = activityResponse.threads.filter(thread => !thread.deleted);
                    // For activity sorting, we need to get total count separately since backend does pagination
                    // For now, we'll use a simple approach - if has_more is false and this is first page, we know the total
                    if (currentPage === 0 && !activityResponse.has_more) {
                        totalCount = paginatedThreads.length;
                    } else {
                        // Estimate total - this is not perfect but workable
                        totalCount = activityResponse.has_more ? (currentPage + 2) * threadsPerPage : (currentPage * threadsPerPage) + paginatedThreads.length;
                    }
                } else {
                    paginatedThreads = [];
                    totalCount = 0;
                }
            } else {
                // Use creation time sorting with frontend pagination (existing logic)
                threadsResponse = await forumActor.get_threads_by_topic_with_unread_counts(parseInt(topicId));
                
                if (threadsResponse) {
                    // Filter out deleted threads
                    const activeThreads = threadsResponse.filter(thread => !thread.deleted);
                    
                    // Sort by created_at
                    if (sortBy === 'newest') {
                        activeThreads.sort((a, b) => Number(b.created_at - a.created_at));
                    } else { // oldest
                        activeThreads.sort((a, b) => Number(a.created_at - b.created_at));
                    }
                    
                    // Apply pagination on the frontend
                    const startIndex = currentPage * threadsPerPage;
                    const endIndex = startIndex + threadsPerPage;
                    paginatedThreads = activeThreads.slice(startIndex, endIndex);
                    totalCount = activeThreads.length;
                } else {
                    paginatedThreads = [];
                    totalCount = 0;
                }
            }
            
            setThreads(paginatedThreads);
            setTotalThreads(totalCount);

        } catch (err) {
            console.error('Error fetching topic data:', err);
            setError('Failed to load topic data');
        } finally {
            setLoading(false);
        }
    };

    const handleCreateThread = async (e) => {
        e.preventDefault();
        
        if (!identity) {
            setError('Please connect your wallet to create a thread');
            return;
        }

        if (!createThreadTitle.trim() || !createThreadBody.trim()) {
            setError('Please fill in both title and body');
            return;
        }

        // Validate poll if included
        if (includePoll) {
            if (!pollTitle.trim() || !pollBody.trim()) {
                setError('Please fill in poll title and body');
                return;
            }
            
            if (!pollEndDate || !pollEndTime) {
                setError('Please set poll end date and time');
                return;
            }
            
            const validOptions = pollOptions.filter(opt => opt.title.trim());
            if (validOptions.length < 2) {
                setError('Poll must have at least 2 options with titles');
                return;
            }
            
            // Check if end date is in the future
            const endDateTime = new Date(`${pollEndDate}T${pollEndTime}`);
            if (endDateTime <= new Date()) {
                setError('Poll end date must be in the future');
                return;
            }
        }

        try {
            setSubmitting(true);
            setError(null);

            const forumActor = createActor(canisterId, {
                agentOptions: {
                    host: process.env.DFX_NETWORK === 'ic' ? 'https://icp0.io' : 'http://localhost:4943',
                    identity: identity,
                },
            });

            // Step 1: Create the thread
            const threadResult = await forumActor.create_thread({
                topic_id: parseInt(topicId),
                title: [createThreadTitle.trim()], // Motoko optional: Some(value) = [value]
                body: createThreadBody.trim()
            });

            if (!('ok' in threadResult)) {
                setError('Failed to create thread: ' + formatError(threadResult.err, 'Unknown error'));
                return;
            }

            const newThreadId = threadResult.ok;

            // Step 2: Create the poll if requested
            if (includePoll) {
                const endDateTime = new Date(`${pollEndDate}T${pollEndTime}`);
                const endTimestamp = endDateTime.getTime() * 1000000; // Convert to nanoseconds

                const validOptions = pollOptions.filter(opt => opt.title.trim()).map(opt => ({
                    title: opt.title.trim(),
                    body: opt.body.trim() ? [opt.body.trim()] : [] // Motoko optional
                }));

                const pollResult = await forumActor.create_poll({
                    thread_id: parseInt(newThreadId),
                    post_id: [], // Empty for thread poll (Motoko optional)
                    title: pollTitle.trim(),
                    body: pollBody.trim(),
                    options: validOptions,
                    vp_power: pollVpPower === 1.0 ? [] : [pollVpPower], // Default to 1.0 if not specified
                    end_timestamp: endTimestamp,
                    allow_vote_changes: allowVoteChanges === true ? [] : [allowVoteChanges] // Default to true if not specified
                });

                if (!('ok' in pollResult)) {
                    console.warn('Thread created but poll creation failed:', pollResult.err);
                    setError('Thread created successfully, but poll creation failed: ' + formatError(pollResult.err, 'Unknown error'));
                    // Still navigate to thread even if poll failed
                    navigate(`/thread?threadid=${newThreadId}`);
                    return;
                }
            }

            // Clear forms
            setCreateThreadTitle('');
            setCreateThreadBody('');
            clearPollForm();
            
            // Navigate to the new thread
            navigate(`/thread?threadid=${newThreadId}`);

        } catch (err) {
            console.error('Error creating thread/poll:', err);
            setError('Failed to create thread: ' + formatError(err, 'Network or system error'));
        } finally {
            setSubmitting(false);
        }
    };

    const formatDate = (timestamp) => {
        return new Date(Number(timestamp / 1000000n)).toLocaleDateString();
    };

    const formatTimeAgo = (timestamp) => {
        const now = Date.now();
        const threadTime = Number(timestamp / 1000000n);
        const diffMs = now - threadTime;
        const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
        
        if (diffDays === 0) return 'Today';
        if (diffDays === 1) return '1 day ago';
        if (diffDays < 7) return `${diffDays} days ago`;
        if (diffDays < 30) return `${Math.floor(diffDays / 7)} weeks ago`;
        return `${Math.floor(diffDays / 30)} months ago`;
    };

    const totalPages = Math.ceil(totalThreads / threadsPerPage);

    const handleThreadsPerPageChange = (newThreadsPerPage) => {
        setThreadsPerPage(newThreadsPerPage);
        setCurrentPage(0); // Reset to first page when changing page size
    };

    // Poll option management functions
    const addPollOption = () => {
        if (pollOptions.length < 10) { // Reasonable limit
            setPollOptions([...pollOptions, { title: '', body: '' }]);
        }
    };

    const removePollOption = (index) => {
        if (pollOptions.length > 2) { // Minimum 2 options
            setPollOptions(pollOptions.filter((_, i) => i !== index));
        }
    };

    const updatePollOption = (index, field, value) => {
        const updated = pollOptions.map((option, i) => 
            i === index ? { ...option, [field]: value } : option
        );
        setPollOptions(updated);
    };

    const clearPollForm = () => {
        const defaultDateTime = getDefaultEndDateTime();
        setPollTitle('');
        setPollBody('');
        setPollOptions([{ title: '', body: '' }, { title: '', body: '' }]);
        setPollVpPower(1.0);
        setPollEndDate(defaultDateTime.dateStr);
        setPollEndTime(defaultDateTime.timeStr);
        setAllowVoteChanges(true);
        setIncludePoll(false);
    };

    if (loading) {
        return (
            <div style={{ background: theme.colors.primaryGradient, color: theme.colors.primaryText, minHeight: '100vh' }}>
                <Header showSnsDropdown={true} onSnsChange={handleSnsChange} />
                <main className="wallet-container">
                    <div style={getStyles(theme).loading}>Loading topic...</div>
                </main>
            </div>
        );
    }

    if (error && !topic) {
        return (
            <div style={{ background: theme.colors.primaryGradient, color: theme.colors.primaryText, minHeight: '100vh' }}>
                <Header showSnsDropdown={true} onSnsChange={handleSnsChange} />
                <main className="wallet-container">
                    <div style={getStyles(theme).error}>{error}</div>
                </main>
            </div>
        );
    }

    return (
        <div style={{ background: theme.colors.primaryGradient, color: theme.colors.primaryText, minHeight: '100vh' }}>
            <Header showSnsDropdown={true} onSnsChange={handleSnsChange} />
            
            {/* Header-like Forum Section - Looks like part of header but scrolls with page */}
            {forumInfo && (
                <div style={{
                    backgroundColor: theme.colors.headerBg, // Match header background
                    borderBottom: '1px solid rgba(255,255,255,0.1)',
                    padding: '12px 0',
                    position: 'sticky',
                    top: 0,
                    zIndex: 100
                }}>
                    <div style={{
                        maxWidth: '1200px',
                        margin: '0 auto',
                        padding: '0 20px',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '15px'
                    }}>
                        {/* SNS Logo */}
                        {loadingLogo ? (
                            <div style={{
                                width: '32px',
                                height: '32px',
                                borderRadius: '50%',
                                backgroundColor: theme.colors.border,
                                border: `2px solid ${theme.colors.border}`,
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                fontSize: '0.6rem',
                                color: theme.colors.mutedText,
                                fontWeight: '600'
                            }}>
                                ...
                            </div>
                        ) : snsLogo ? (
                            <img
                                src={snsLogo}
                                alt={snsInfo?.name || 'SNS Logo'}
                                style={{
                                    width: '32px',
                                    height: '32px',
                                    borderRadius: '50%',
                                    objectFit: 'cover',
                                    border: `2px solid ${theme.colors.border}`
                                }}
                            />
                        ) : (
                            <div style={{
                                width: '32px',
                                height: '32px',
                                borderRadius: '50%',
                                backgroundColor: theme.colors.border,
                                border: `2px solid ${theme.colors.border}`,
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                fontSize: '0.6rem',
                                color: theme.colors.mutedText,
                                fontWeight: '600'
                            }}>
                                {snsInfo?.name?.substring(0, 2).toUpperCase() || 'SNS'}
                            </div>
                        )}
                        
                        {/* Forum Title */}
                        <h1 style={{
                            color: theme.colors.primaryText,
                            fontSize: '1.5rem',
                            fontWeight: '600',
                            margin: 0,
                            flex: 1
                        }}>
                            {snsInfo?.name ? `${snsInfo.name} Forum` : (forumInfo.title || 'Forum')}
                        </h1>
                    </div>
                </div>
            )}
            
            <main className="wallet-container">
                <div style={getStyles(theme).container}>
                    {/* Breadcrumb */}
                    {!breadcrumbLoading && (
                        <div style={getStyles(theme).breadcrumb}>
                            <Link 
                                to={forumInfo?.sns_root_canister_id?.length > 0 
                                    ? `/forum?sns=${forumInfo.sns_root_canister_id[0].toText()}`
                                    : "/forum"
                                } 
                                style={getStyles(theme).breadcrumbLink}
                            >
                                Forum
                            </Link>
                            <span style={getStyles(theme).breadcrumbSeparator}>›</span>
                            <span style={getStyles(theme).currentPage}>{topic?.title}</span>
                        </div>
                    )}

                    {/* Topic Header */}
                    <div style={getStyles(theme).header}>
                        <h1 style={getStyles(theme).title}>{topic?.title}</h1>
                        <p style={getStyles(theme).description}>
                            {topic?.description || 'No description available'}
                        </p>
                        <div style={getStyles(theme).meta}>
                            Created {formatDate(topic?.created_at)} • Last updated {formatDate(topic?.updated_at)}
                        </div>
                    </div>

                    {/* Subtopics */}
                    {subtopics.length > 0 && (
                        <div style={getStyles(theme).section}>
                            <h2 style={getStyles(theme).sectionTitle}>Subtopics</h2>
                            <div style={getStyles(theme).subtopicsGrid}>
                                {subtopics.map((subtopic) => (
                                    <Link
                                        key={subtopic.id}
                                        to={`/topic/${subtopic.id}`}
                                        style={{
                                            ...getStyles(theme).subtopicCard,
                                            ...(hoveredCard === subtopic.id ? getStyles(theme).subtopicCardHover : {})
                                        }}
                                        onMouseEnter={() => setHoveredCard(subtopic.id)}
                                        onMouseLeave={() => setHoveredCard(null)}
                                    >
                                        <h4 style={getStyles(theme).subtopicTitle}>{subtopic.title}</h4>
                                        <p style={getStyles(theme).subtopicDescription}>
                                            {subtopic.description || 'No description available'}
                                        </p>

                                        {/* Subtopic Statistics */}
                                        {(() => {
                                            const stats = subtopicStatistics.get(subtopic.id);
                                            return stats ? (
                                                <div style={{
                                                    display: 'flex',
                                                    gap: '12px',
                                                    marginTop: '8px',
                                                    fontSize: '0.8rem',
                                                    color: theme.colors.mutedText
                                                }}>
                                                    <span>📋 {stats.thread_count} thread{stats.thread_count !== 1 ? 's' : ''}</span>
                                                    {stats.total_unread_posts > 0 && (
                                                        <span style={{
                                                            backgroundColor: theme.colors.error,
                                                            color: 'white',
                                                            padding: '2px 6px',
                                                            borderRadius: '8px',
                                                            fontSize: '0.7rem',
                                                            fontWeight: 'bold'
                                                        }}>
                                                            {stats.total_unread_posts} new
                                                        </span>
                                                    )}
                                                </div>
                                            ) : null;
                                        })()}
                                    </Link>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Preproposals Topic Prompt */}
                    {showPreproposalsPrompt && (
                        <div style={getStyles(theme).preproposalsPrompt}>
                            <h3 style={getStyles(theme).preproposalsPromptTitle}>Create Preproposals Topic?</h3>
                            <p style={getStyles(theme).preproposalsPromptMessage}>
                                This Governance topic does not have a "Preproposals" subtopic yet. Would you like to create it? 
                                This will provide a space for discussing potential proposals before formal submission.
                            </p>
                            <div style={getStyles(theme).preproposalsPromptButtons}>
                                <button 
                                    onClick={handleCreatePreproposalsTopic}
                                    disabled={creatingPreproposals}
                                    style={{
                                        ...getStyles(theme).createPreproposalsButton,
                                        ...(creatingPreproposals ? getStyles(theme).buttonDisabled : {})
                                    }}
                                >
                                    {creatingPreproposals ? 'Creating...' : 'Create Preproposals Topic'}
                                </button>
                                <button 
                                    onClick={() => setShowPreproposalsPrompt(false)}
                                    disabled={creatingPreproposals}
                                    style={{
                                        ...getStyles(theme).dismissButton,
                                        ...(creatingPreproposals ? getStyles(theme).buttonDisabled : {})
                                    }}
                                >
                                    Maybe Later
                                </button>
                            </div>
                        </div>
                    )}

                    {/* Threads */}
                    <div style={getStyles(theme).section}>
                        <h2 style={getStyles(theme).sectionTitle}>Threads ({totalThreads})</h2>
                        
                        {error && (
                            <div style={getStyles(theme).error}>{error}</div>
                        )}

                        {/* Filter Controls - Above threads */}
                        {(threads.length > 0 || totalThreads > 0) && (
                            <div style={{
                                padding: '15px 0',
                                borderBottom: `1px solid ${theme.colors.border}`,
                                marginBottom: '20px'
                            }}>
                                {!isMobile ? (
                                    /* Desktop Layout */
                                    <div style={{
                                        display: 'flex',
                                        justifyContent: 'space-between',
                                        alignItems: 'center',
                                        gap: '20px'
                                    }}>
                                        <div style={{
                                            display: 'flex',
                                            alignItems: 'center',
                                            gap: '20px',
                                            fontSize: '14px',
                                            color: theme.colors.secondaryText
                                        }}>
                                            <div style={{
                                                display: 'flex',
                                                alignItems: 'center',
                                                gap: '10px'
                                            }}>
                                                <span>Show:</span>
                                                <select
                                                    value={threadsPerPage}
                                                    onChange={(e) => handleThreadsPerPageChange(Number(e.target.value))}
                                                    style={{
                                                        backgroundColor: theme.colors.secondaryBg,
                                                        color: theme.colors.primaryText,
                                                        border: `1px solid ${theme.colors.border}`,
                                                        borderRadius: '4px',
                                                        padding: '4px 8px',
                                                        fontSize: '14px'
                                                    }}
                                                >
                                                    <option value={5}>5 threads</option>
                                                    <option value={10}>10 threads</option>
                                                    <option value={20}>20 threads</option>
                                                    <option value={50}>50 threads</option>
                                                </select>
                                                <span>per page</span>
                                            </div>
                                            
                                            <div style={{
                                                display: 'flex',
                                                alignItems: 'center',
                                                gap: '10px'
                                            }}>
                                                <span>Sort by:</span>
                                                <select
                                                    value={sortBy}
                                                    onChange={(e) => {
                                                        setSortBy(e.target.value);
                                                        setCurrentPage(0); // Reset to first page when sorting changes
                                                    }}
                                                    style={{
                                                        backgroundColor: theme.colors.secondaryBg,
                                                        color: theme.colors.primaryText,
                                                        border: `1px solid ${theme.colors.border}`,
                                                        borderRadius: '4px',
                                                        padding: '4px 8px',
                                                        fontSize: '14px'
                                                    }}
                                                >
                                                    <option value="newest">Newest</option>
                                                    <option value="oldest">Oldest</option>
                                                    <option value="activity-newest">Activity (Newest)</option>
                                                    <option value="activity-oldest">Activity (Oldest)</option>
                                                </select>
                                            </div>
                                        </div>

                                        {/* Pagination - Right side */}
                                        {totalPages > 1 && (
                                            <div style={getStyles(theme).pagination}>
                                                <button
                                                    style={{
                                                        ...getStyles(theme).pageButton,
                                                        ...(currentPage === 0 ? getStyles(theme).pageButtonDisabled : {})
                                                    }}
                                                    onClick={() => setCurrentPage(p => Math.max(0, p - 1))}
                                                    disabled={currentPage === 0}
                                                >
                                                    Previous
                                                </button>
                                                <span style={getStyles(theme).pageInfo}>
                                                    Page {currentPage + 1} of {totalPages}
                                                </span>
                                                <button
                                                    style={{
                                                        ...getStyles(theme).pageButton,
                                                        ...(currentPage >= totalPages - 1 ? getStyles(theme).pageButtonDisabled : {})
                                                    }}
                                                    onClick={() => setCurrentPage(p => Math.min(totalPages - 1, p + 1))}
                                                    disabled={currentPage >= totalPages - 1}
                                                >
                                                    Next
                                                </button>
                                            </div>
                                        )}
                                    </div>
                                ) : (
                                    /* Mobile Layout */
                                    <div>
                                        {/* Filter controls */}
                                        <div style={{
                                            display: 'flex',
                                            flexDirection: 'column',
                                            gap: '12px',
                                            marginBottom: totalPages > 1 ? '15px' : '0'
                                        }}>
                                            <div style={{
                                                display: 'flex',
                                                alignItems: 'center',
                                                gap: '8px',
                                                fontSize: '14px',
                                                color: theme.colors.secondaryText
                                            }}>
                                                <span style={{ minWidth: '45px', flexShrink: 0 }}>Show:</span>
                                                <select
                                                    value={threadsPerPage}
                                                    onChange={(e) => handleThreadsPerPageChange(Number(e.target.value))}
                                                    style={{
                                                        backgroundColor: theme.colors.secondaryBg,
                                                        color: theme.colors.primaryText,
                                                        border: `1px solid ${theme.colors.border}`,
                                                        borderRadius: '4px',
                                                        padding: '6px 8px',
                                                        fontSize: '14px',
                                                        flex: '1',
                                                        minWidth: '0'
                                                    }}
                                                >
                                                    <option value={5}>5 per page</option>
                                                    <option value={10}>10 per page</option>
                                                    <option value={20}>20 per page</option>
                                                    <option value={50}>50 per page</option>
                                                </select>
                                            </div>
                                            
                                            <div style={{
                                                display: 'flex',
                                                alignItems: 'center',
                                                gap: '8px',
                                                fontSize: '14px',
                                                color: theme.colors.secondaryText
                                            }}>
                                                <span style={{ minWidth: '45px', flexShrink: 0 }}>Sort:</span>
                                                <select
                                                    value={sortBy}
                                                    onChange={(e) => {
                                                        setSortBy(e.target.value);
                                                        setCurrentPage(0); // Reset to first page when sorting changes
                                                    }}
                                                    style={{
                                                        backgroundColor: theme.colors.secondaryBg,
                                                        color: theme.colors.primaryText,
                                                        border: `1px solid ${theme.colors.border}`,
                                                        borderRadius: '4px',
                                                        padding: '6px 8px',
                                                        fontSize: '14px',
                                                        flex: '1',
                                                        minWidth: '0'
                                                    }}
                                                >
                                                    <option value="newest">Newest</option>
                                                    <option value="oldest">Oldest</option>
                                                    <option value="activity-newest">Activity (Newest)</option>
                                                    <option value="activity-oldest">Activity (Oldest)</option>
                                                </select>
                                            </div>
                                        </div>

                                        {/* Pagination (mobile) */}
                                        {totalPages > 1 && (
                                            <div style={{
                                                display: 'flex',
                                                justifyContent: 'center',
                                                alignItems: 'center',
                                                gap: '8px',
                                                paddingTop: '15px',
                                                borderTop: `1px solid ${theme.colors.border}`
                                            }}>
                                                <button
                                                    style={{
                                                        ...getStyles(theme).pageButton,
                                                        ...(currentPage === 0 ? getStyles(theme).pageButtonDisabled : {}),
                                                        padding: '6px 10px',
                                                        fontSize: '13px'
                                                    }}
                                                    onClick={() => setCurrentPage(p => Math.max(0, p - 1))}
                                                    disabled={currentPage === 0}
                                                >
                                                    Prev
                                                </button>
                                                <span style={{
                                                    ...getStyles(theme).pageInfo,
                                                    fontSize: '13px',
                                                    whiteSpace: 'nowrap'
                                                }}>
                                                    {currentPage + 1}/{totalPages}
                                                </span>
                                                <button
                                                    style={{
                                                        ...getStyles(theme).pageButton,
                                                        ...(currentPage >= totalPages - 1 ? getStyles(theme).pageButtonDisabled : {}),
                                                        padding: '6px 10px',
                                                        fontSize: '13px'
                                                    }}
                                                    onClick={() => setCurrentPage(p => Math.min(totalPages - 1, p + 1))}
                                                    disabled={currentPage >= totalPages - 1}
                                                >
                                                    Next
                                                </button>
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>
                        )}

                        {threads.length > 0 ? (
                            <div style={getStyles(theme).threadsContainer}>
                                {threads.map((thread, index) => (
                                    <div
                                        key={thread.id}
                                        style={{
                                            ...getStyles(theme).threadItem,
                                            ...(hoveredThread === thread.id ? getStyles(theme).threadItemHover : {}),
                                            ...(index === threads.length - 1 ? { borderBottom: 'none' } : {})
                                        }}
                                        onMouseEnter={() => setHoveredThread(thread.id)}
                                        onMouseLeave={() => setHoveredThread(null)}
                                        onClick={() => {
                                            const threadIdStr = thread.id.toString();
                                            navigate(`/thread?threadid=${threadIdStr}`);
                                        }}
                                    >
                                        <h3 style={getStyles(theme).threadTitle}>
                                            {thread.title || `Thread #${thread.id}`}
                                            {hasUnreadPosts(thread) && (
                                                <span style={{
                                                    marginLeft: '8px',
                                                    backgroundColor: theme.colors.error,
                                                    color: 'white',
                                                    fontSize: '0.7rem',
                                                    padding: '2px 6px',
                                                    borderRadius: '10px',
                                                    fontWeight: 'bold'
                                                }}>
                                                    {(() => {
                                                        const unreadCount = thread.unread_posts_count && thread.unread_posts_count.length > 0 
                                                            ? Number(thread.unread_posts_count[0]) : 0;
                                                        const totalCount = thread.total_posts_count && thread.total_posts_count.length > 0 
                                                            ? Number(thread.total_posts_count[0]) : 0;
                                                        
                                                        // Debug logging for counting issues
                                                        if (unreadCount > totalCount && totalCount > 0) {
                                                            console.warn(`🐛 Counting bug in thread ${thread.id}:`, {
                                                                unreadCount,
                                                                totalCount,
                                                                threadTitle: thread.title
                                                            });
                                                        }
                                                        
                                                        return unreadCount > 0 ? unreadCount : 'NEW';
                                                    })()}
                                                </span>
                                            )}
                                        </h3>
                                        <p style={{...getStyles(theme).threadBody, whiteSpace: 'pre-wrap'}}>{thread.body}</p>
                                        
                                        {/* Show proposal link if this thread is linked to a proposal */}
                                        {threadProposals.has(thread.id.toString()) && (
                                            <div style={{
                                                marginTop: '10px',
                                                padding: '8px 12px',
                                                backgroundColor: 'rgba(52, 152, 219, 0.1)',
                                                border: '1px solid rgba(52, 152, 219, 0.3)',
                                                borderRadius: '4px',
                                                fontSize: '0.85rem'
                                            }}>
                                                <span style={{ color: '#3498db', fontWeight: '500' }}>
                                                    📋 Proposal Discussion:{' '}
                                                </span>
                                                <a 
                                                    href={`/proposal?proposalid=${threadProposals.get(thread.id.toString()).proposalId}&sns=${selectedSnsRoot || ''}`}
                                                    style={{
                                                        color: theme.colors.accent,
                                                        textDecoration: 'none',
                                                        fontWeight: '500'
                                                    }}
                                                    onClick={(e) => e.stopPropagation()} // Prevent thread click
                                                    onMouseEnter={(e) => e.target.style.textDecoration = 'underline'}
                                                    onMouseLeave={(e) => e.target.style.textDecoration = 'none'}
                                                >
                                                    {(() => {
                                                        const proposalInfo = threadProposals.get(thread.id.toString());
                                                        const proposalTitle = proposalInfo?.proposalData?.proposal?.[0]?.title;
                                                        return proposalTitle 
                                                            ? `Proposal #${proposalInfo.proposalId}: ${proposalTitle}`
                                                            : `Proposal #${proposalInfo.proposalId}`;
                                                    })()}
                                                </a>
                                            </div>
                                        )}
                                        
                                        <div style={getStyles(theme).threadMeta}>
                                            <span>Created {formatTimeAgo(thread.created_at)}</span>
                                            {(() => {
                                                // Use backend-provided total post count if available, fallback to async count
                                                const backendPostCount = thread.total_posts_count && thread.total_posts_count.length > 0 
                                                    ? Number(thread.total_posts_count[0]) : null;
                                                const asyncPostCount = threadPostCounts.get(thread.id.toString());
                                                const postCount = backendPostCount !== null ? backendPostCount : asyncPostCount;
                                                
                                                return postCount !== undefined ? (
                                                    <span style={{ color: '#888', fontSize: '0.9rem' }}>
                                                        • {postCount} post{postCount !== 1 ? 's' : ''}
                                                    </span>
                                                ) : (
                                                    <span style={{ color: '#666', fontSize: '0.8rem', fontStyle: 'italic' }}>
                                                        • Loading...
                                                    </span>
                                                );
                                            })()}
                                            <span>→</span>
                                        </div>
                                    </div>
                                ))}

                            </div>
                        ) : (
                            <div style={getStyles(theme).noContent}>
                                <p>No threads in this topic yet.</p>
                                <p>Be the first to start a discussion!</p>
                            </div>
                        )}
                    </div>

                    {/* Create Thread Form - Full Width Style like ThreadViewer */}
                    {/* Hide create thread form if we're in the Proposals topic */}
                    {topic?.title !== "Proposals" && (
                        <div style={{ marginBottom: '20px' }}>
                        <input
                            type="text"
                            value={createThreadTitle}
                            onChange={(e) => setCreateThreadTitle(e.target.value)}
                            placeholder="Thread title"
                            style={{
                                width: '100%',
                                backgroundColor: theme.colors.secondaryBg,
                                color: theme.colors.primaryText,
                                border: `1px solid ${textLimits && createThreadTitle.length > textLimits.thread_title_max_length ? '#e74c3c' : '#444'}`,
                                borderRadius: '4px',
                                padding: '10px',
                                marginBottom: '5px',
                                fontSize: '14px',
                                boxSizing: 'border-box'
                            }}
                            disabled={submitting}
                        />
                        {textLimits && (
                            <div style={{
                                fontSize: '12px',
                                color: createThreadTitle.length > textLimits.thread_title_max_length ? '#e74c3c' : 
                                       (textLimits.thread_title_max_length - createThreadTitle.length) < 20 ? '#f39c12' : '#888',
                                marginBottom: '10px'
                            }}>
                                Title: {createThreadTitle.length}/{textLimits.thread_title_max_length} characters
                                {createThreadTitle.length > textLimits.thread_title_max_length && 
                                    <span style={{ marginLeft: '10px' }}>({createThreadTitle.length - textLimits.thread_title_max_length} over limit)</span>
                                }
                            </div>
                        )}
                        <textarea
                            value={createThreadBody}
                            onChange={(e) => setCreateThreadBody(e.target.value)}
                            placeholder="What would you like to discuss?"
                            style={{
                                width: '100%',
                                backgroundColor: theme.colors.secondaryBg,
                                color: theme.colors.primaryText,
                                border: `1px solid ${textLimits && createThreadBody.length > textLimits.thread_body_max_length ? '#e74c3c' : '#444'}`,
                                borderRadius: '4px',
                                padding: '10px',
                                fontSize: '14px',
                                minHeight: '100px',
                                resize: 'vertical',
                                marginBottom: '5px',
                                boxSizing: 'border-box'
                            }}
                            disabled={submitting}
                        />
                        {textLimits && (
                            <div style={{
                                fontSize: '12px',
                                color: createThreadBody.length > textLimits.thread_body_max_length ? '#e74c3c' : 
                                       (textLimits.thread_body_max_length - createThreadBody.length) < 100 ? '#f39c12' : '#888',
                                marginBottom: '10px'
                            }}>
                                Body: {createThreadBody.length}/{textLimits.thread_body_max_length} characters
                                {createThreadBody.length > textLimits.thread_body_max_length && 
                                    <span style={{ marginLeft: '10px' }}>({createThreadBody.length - textLimits.thread_body_max_length} over limit)</span>
                                }
                            </div>
                        )}
                        
                        {/* Poll Creation Section */}
                        <div style={{ marginTop: '20px', borderTop: '1px solid #444', paddingTop: '20px' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '15px' }}>
                                <input
                                    type="checkbox"
                                    id="includePoll"
                                    checked={includePoll}
                                    onChange={(e) => setIncludePoll(e.target.checked)}
                                    style={{ 
                                        width: '16px', 
                                        height: '16px',
                                        accentColor: '#3498db'
                                    }}
                                />
                                <label htmlFor="includePoll" style={{ 
                                    color: theme.colors.primaryText, 
                                    fontSize: '16px', 
                                    fontWeight: '500',
                                    cursor: 'pointer'
                                }}>
                                    📊 Include a Poll with this Thread
                                </label>
                            </div>

                            {includePoll && (
                                <div style={{ 
                                    backgroundColor: theme.colors.accentHover, 
                                    borderRadius: '6px', 
                                    padding: '20px', 
                                    border: '1px solid #444',
                                    marginBottom: '15px'
                                }}>
                                    <h4 style={{ color: '#ffffff', marginBottom: '15px', fontSize: '16px' }}>Poll Details</h4>
                                    
                                    {/* Poll Title */}
                                    <input
                                        type="text"
                                        value={pollTitle}
                                        onChange={(e) => setPollTitle(e.target.value)}
                                        placeholder="Poll title (e.g., 'What should we prioritize next?')"
                                        style={{
                                            width: '100%',
                                            backgroundColor: theme.colors.secondaryBg,
                                            color: theme.colors.primaryText,
                                            border: `1px solid ${textLimits && pollTitle.length > textLimits.post_title_max_length ? '#e74c3c' : '#444'}`,
                                            borderRadius: '4px',
                                            padding: '10px',
                                            marginBottom: '5px',
                                            fontSize: '14px',
                                            boxSizing: 'border-box'
                                        }}
                                        disabled={submitting}
                                    />
                                    {textLimits && (
                                        <div style={{
                                            fontSize: '12px',
                                            color: pollTitle.length > textLimits.post_title_max_length ? '#e74c3c' : '#888',
                                            marginBottom: '10px'
                                        }}>
                                            Poll title: {pollTitle.length}/{textLimits.post_title_max_length} characters
                                        </div>
                                    )}

                                    {/* Poll Body */}
                                    <textarea
                                        value={pollBody}
                                        onChange={(e) => setPollBody(e.target.value)}
                                        placeholder="Poll description (optional - explain what this poll is about)"
                                        style={{
                                            width: '100%',
                                            backgroundColor: theme.colors.secondaryBg,
                                            color: theme.colors.primaryText,
                                            border: `1px solid ${textLimits && pollBody.length > textLimits.post_body_max_length ? '#e74c3c' : '#444'}`,
                                            borderRadius: '4px',
                                            padding: '10px',
                                            fontSize: '14px',
                                            minHeight: '80px',
                                            resize: 'vertical',
                                            marginBottom: '5px',
                                            boxSizing: 'border-box'
                                        }}
                                        disabled={submitting}
                                    />
                                    {textLimits && (
                                        <div style={{
                                            fontSize: '12px',
                                            color: pollBody.length > textLimits.post_body_max_length ? '#e74c3c' : '#888',
                                            marginBottom: '15px'
                                        }}>
                                            Poll body: {pollBody.length}/{textLimits.post_body_max_length} characters
                                        </div>
                                    )}

                                    {/* Poll Options */}
                                    <div style={{ marginBottom: '15px' }}>
                                        <h5 style={{ color: '#ffffff', marginBottom: '10px', fontSize: '14px' }}>Poll Options</h5>
                                        {pollOptions.map((option, index) => (
                                            <div key={index} style={{ 
                                                display: 'flex', 
                                                gap: '10px', 
                                                marginBottom: '10px',
                                                alignItems: 'flex-start'
                                            }}>
                                                <div style={{ flex: 1 }}>
                                                    <input
                                                        type="text"
                                                        value={option.title}
                                                        onChange={(e) => updatePollOption(index, 'title', e.target.value)}
                                                        placeholder={`Option ${index + 1} (e.g., 'Feature A', 'Yes', 'No')`}
                                                        style={{
                                                            width: '100%',
                                                            backgroundColor: theme.colors.secondaryBg,
                                                            color: theme.colors.primaryText,
                                                            border: `1px solid ${theme.colors.border}`,
                                                            borderRadius: '4px',
                                                            padding: '8px',
                                                            fontSize: '14px',
                                                            marginBottom: '5px',
                                                            boxSizing: 'border-box'
                                                        }}
                                                        disabled={submitting}
                                                    />
                                                    <textarea
                                                        value={option.body}
                                                        onChange={(e) => updatePollOption(index, 'body', e.target.value)}
                                                        placeholder="Optional description for this option"
                                                        style={{
                                                            width: '100%',
                                                            backgroundColor: theme.colors.secondaryBg,
                                                            color: theme.colors.primaryText,
                                                            border: `1px solid ${theme.colors.border}`,
                                                            borderRadius: '4px',
                                                            padding: '8px',
                                                            fontSize: '12px',
                                                            minHeight: '40px',
                                                            resize: 'vertical',
                                                            boxSizing: 'border-box'
                                                        }}
                                                        disabled={submitting}
                                                    />
                                                </div>
                                                {pollOptions.length > 2 && (
                                                    <button
                                                        onClick={() => removePollOption(index)}
                                                        disabled={submitting}
                                                        style={{
                                                            backgroundColor: theme.colors.error,
                                                            color: theme.colors.primaryText,
                                                            border: 'none',
                                                            borderRadius: '4px',
                                                            padding: '8px',
                                                            cursor: 'pointer',
                                                            fontSize: '12px',
                                                            marginTop: '5px'
                                                        }}
                                                        title="Remove this option"
                                                    >
                                                        ✕
                                                    </button>
                                                )}
                                            </div>
                                        ))}
                                        {pollOptions.length < 10 && (
                                            <button
                                                onClick={addPollOption}
                                                disabled={submitting}
                                                style={{
                                                    backgroundColor: '#3498db',
                                                    color: theme.colors.primaryText,
                                                    border: 'none',
                                                    borderRadius: '4px',
                                                    padding: '6px 12px',
                                                    cursor: 'pointer',
                                                    fontSize: '12px'
                                                }}
                                            >
                                                + Add Option
                                            </button>
                                        )}
                                    </div>

                                    {/* Poll Settings */}
                                    <div style={{ 
                                        display: 'grid', 
                                        gridTemplateColumns: '1fr 1fr 1fr', 
                                        gap: '15px',
                                        marginBottom: '15px'
                                    }}>
                                        <div>
                                            <label style={{ 
                                                color: theme.colors.secondaryText, 
                                                fontSize: '12px', 
                                                display: 'block', 
                                                marginBottom: '5px' 
                                            }}>
                                                End Date
                                            </label>
                                            <input
                                                type="date"
                                                value={pollEndDate}
                                                onChange={(e) => setPollEndDate(e.target.value)}
                                                min={new Date().toISOString().split('T')[0]}
                                                style={{
                                                    width: '100%',
                                                    backgroundColor: theme.colors.secondaryBg,
                                                    color: theme.colors.primaryText,
                                                    border: '1px solid #444',
                                                    borderRadius: '4px',
                                                    padding: '8px',
                                                    fontSize: '14px',
                                                    boxSizing: 'border-box'
                                                }}
                                                disabled={submitting}
                                            />
                                        </div>
                                        <div>
                                            <label style={{ 
                                                color: theme.colors.secondaryText, 
                                                fontSize: '12px', 
                                                display: 'block', 
                                                marginBottom: '5px' 
                                            }}>
                                                End Time
                                            </label>
                                            <input
                                                type="time"
                                                value={pollEndTime}
                                                onChange={(e) => setPollEndTime(e.target.value)}
                                                style={{
                                                    width: '100%',
                                                    backgroundColor: theme.colors.secondaryBg,
                                                    color: theme.colors.primaryText,
                                                    border: '1px solid #444',
                                                    borderRadius: '4px',
                                                    padding: '8px',
                                                    fontSize: '14px',
                                                    boxSizing: 'border-box'
                                                }}
                                                disabled={submitting}
                                            />
                                        </div>
                                        <div>
                                            <label style={{ 
                                                color: theme.colors.secondaryText, 
                                                fontSize: '12px', 
                                                display: 'block', 
                                                marginBottom: '5px' 
                                            }}>
                                                VP Power
                                            </label>
                                            <select
                                                value={pollVpPower}
                                                onChange={(e) => setPollVpPower(parseFloat(e.target.value))}
                                                style={{
                                                    width: '100%',
                                                    backgroundColor: theme.colors.secondaryBg,
                                                    color: theme.colors.primaryText,
                                                    border: '1px solid #444',
                                                    borderRadius: '4px',
                                                    padding: '8px',
                                                    fontSize: '14px',
                                                    boxSizing: 'border-box'
                                                }}
                                                disabled={submitting}
                                            >
                                                <option value={0}>Equal (0 - each vote = 1)</option>
                                                <option value={0.5}>Square Root (0.5)</option>
                                                <option value={1}>Linear (1 - default)</option>
                                                <option value={2}>Quadratic (2)</option>
                                            </select>
                                        </div>
                                    </div>

                                    <div style={{ fontSize: '12px', color: '#888', fontStyle: 'italic' }}>
                                        💡 VP Power determines how neuron voting power affects poll results. 
                                        Equal (0) makes each vote count as 1 regardless of VP. 
                                        Linear (1) uses normal VP. Higher values amplify VP differences.
                                    </div>

                                    {/* Allow Vote Changes */}
                                    <div style={{ marginTop: '15px' }}>
                                        <label style={{ 
                                            color: theme.colors.secondaryText, 
                                            fontSize: '14px', 
                                            display: 'flex', 
                                            alignItems: 'center',
                                            gap: '8px',
                                            cursor: 'pointer'
                                        }}>
                                            <input
                                                type="checkbox"
                                                checked={allowVoteChanges}
                                                onChange={(e) => setAllowVoteChanges(e.target.checked)}
                                                disabled={submitting}
                                                style={{
                                                    transform: 'scale(1.2)'
                                                }}
                                            />
                                            Allow voters to change their votes
                                        </label>
                                        <div style={{ 
                                            fontSize: '12px', 
                                            color: theme.colors.mutedText, 
                                            marginTop: '5px',
                                            marginLeft: '28px'
                                        }}>
                                            If unchecked, voters can only vote once and cannot change their choice
                                        </div>
                                    </div>
                                </div>
                            )}
                        </div>
                        
                        <div style={{ 
                            display: 'flex', 
                            gap: '10px', 
                            marginTop: '15px'
                        }}>
                            <button
                                onClick={handleCreateThread}
                                disabled={submitting || !createThreadTitle.trim() || !createThreadBody.trim() || 
                                         (textLimits && (createThreadTitle.length > textLimits.thread_title_max_length || 
                                                        createThreadBody.length > textLimits.thread_body_max_length))}
                                style={{
                                    backgroundColor: (submitting || !createThreadTitle.trim() || !createThreadBody.trim() || 
                                                     (textLimits && (createThreadTitle.length > textLimits.thread_title_max_length || 
                                                                    createThreadBody.length > textLimits.thread_body_max_length))) ? '#666' : '#2ecc71',
                                    color: theme.colors.primaryText,
                                    border: 'none',
                                    borderRadius: '4px',
                                    padding: '8px 16px',
                                    cursor: (submitting || !createThreadTitle.trim() || !createThreadBody.trim() || 
                                            (textLimits && (createThreadTitle.length > textLimits.thread_title_max_length || 
                                                           createThreadBody.length > textLimits.thread_body_max_length))) ? 'not-allowed' : 'pointer',
                                    fontSize: '14px',
                                    fontWeight: '500'
                                }}
                            >
                                {submitting ? 'Creating...' : (includePoll ? 'Create Thread & Poll' : 'Create Thread')}
                            </button>
                            {includePoll && (
                                <button
                                    onClick={clearPollForm}
                                    disabled={submitting}
                                    style={{
                                        backgroundColor: 'transparent',
                                        color: theme.colors.mutedText,
                                        border: `1px solid ${theme.colors.border}`,
                                        borderRadius: '4px',
                                        padding: '8px 16px',
                                        cursor: submitting ? 'not-allowed' : 'pointer',
                                        fontSize: '14px'
                                    }}
                                >
                                    Clear Poll
                                </button>
                            )}
                        </div>
                    </div>
                    )}
                </div>
            </main>
        </div>
    );
}

export default Topic;
