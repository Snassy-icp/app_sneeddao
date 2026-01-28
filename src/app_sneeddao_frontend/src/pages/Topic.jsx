import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useParams, Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Principal } from '@dfinity/principal';
import { useAuth } from '../AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import { useSns } from '../contexts/SnsContext';
import Header from '../components/Header';
import EmojiPicker from '../components/EmojiPicker';
import MarkdownButtons from '../components/MarkdownButtons';
import MarkdownBody from '../components/MarkdownBody';
import { createActor, canisterId } from 'declarations/sneed_sns_forum';
import { useTextLimits } from '../hooks/useTextLimits';
import { formatError } from '../utils/errorUtils';
import { createActor as createSnsGovernanceActor } from 'external/sns_governance';
import { getSnsById, fetchSnsLogo, getAllSnses } from '../utils/SnsUtils';
import { getPostsByThread } from '../utils/BackendUtils';
import { HttpAgent } from '@dfinity/agent';
import { FaComments, FaChevronRight, FaPlus, FaRegClock, FaSort, FaList, FaChevronLeft, FaGavel, FaRegLightbulb, FaFire, FaPoll, FaArrowRight } from 'react-icons/fa';
import { getRelativeTime, getFullDate } from '../utils/DateUtils';

// Custom CSS for animations
const customStyles = `
@keyframes shimmer {
    0% { background-position: -200% 0; }
    100% { background-position: 200% 0; }
}

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

@keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.7; }
}

@keyframes float {
    0%, 100% { transform: translateY(0px); }
    50% { transform: translateY(-5px); }
}

.topic-card-animate {
    animation: fadeInUp 0.5s ease-out forwards;
}

.topic-shimmer {
    background: linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.1) 50%, transparent 100%);
    background-size: 200% 100%;
    animation: shimmer 2s infinite;
}

.topic-pulse {
    animation: pulse 2s ease-in-out infinite;
}

.topic-float {
    animation: float 3s ease-in-out infinite;
}
`;

// Accent colors - matching Forum page
const forumPrimary = '#6366f1'; // Indigo
const forumSecondary = '#8b5cf6'; // Purple
const forumAccent = '#06b6d4'; // Cyan

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
    const createThreadBodyRef = useRef(null);
    const [submitting, setSubmitting] = useState(false);
    const [showPreproposalsPrompt, setShowPreproposalsPrompt] = useState(false);
    const [creatingPreproposals, setCreatingPreproposals] = useState(false);
    const [isMobile, setIsMobile] = useState(window.innerWidth <= 768);
    const [userThreadReads, setUserThreadReads] = useState(new Map());
    const [subtopicStatistics, setSubtopicStatistics] = useState(new Map());
    
    // Poll creation state
    const [includePoll, setIncludePoll] = useState(false);
    const [pollTitle, setPollTitle] = useState('');
    const [pollBody, setPollBody] = useState('');
    const [pollOptions, setPollOptions] = useState([{ title: '', body: '' }, { title: '', body: '' }]);
    const [pollVpPower, setPollVpPower] = useState(1.0);
    
    const getDefaultEndDateTime = () => {
        const now = new Date();
        const fiveDaysFromNow = new Date(now.getTime() + (5 * 24 * 60 * 60 * 1000));
        const dateStr = fiveDaysFromNow.toISOString().split('T')[0];
        const timeStr = fiveDaysFromNow.toTimeString().slice(0, 5);
        return { dateStr, timeStr };
    };
    
    const defaultDateTime = getDefaultEndDateTime();
    const [pollEndDate, setPollEndDate] = useState(defaultDateTime.dateStr);
    const [pollEndTime, setPollEndTime] = useState(defaultDateTime.timeStr);
    const [allowVoteChanges, setAllowVoteChanges] = useState(true);
    
    const [threadProposals, setThreadProposals] = useState(new Map());
    
    const forumActor = useMemo(() => {
        return identity ? createActor(canisterId, {
            agentOptions: {
                host: process.env.DFX_NETWORK === 'ic' || process.env.DFX_NETWORK === 'staging' ? 'https://icp0.io' : 'http://localhost:4943',
                identity: identity,
            },
        }) : null;
    }, [identity]);
    
    const { textLimits, regularLimits, isPremium } = useTextLimits(forumActor);

    const loadSnsInfo = async () => {
        if (!currentSnsRoot) return;
        setSnsLogo(null);
        setLoadingLogo(false);
        setSnsInfo(null);

        try {
            const allSnses = getAllSnses();
            const currentSnsInfo = allSnses.find(sns => sns.rootCanisterId === currentSnsRoot);
            
            if (currentSnsInfo) {
                setSnsInfo(currentSnsInfo);
                if (currentSnsInfo.canisters.governance) {
                    await loadSnsLogo(currentSnsInfo.canisters.governance, currentSnsInfo.name);
                }
            }
        } catch (error) {
            console.error('Error loading SNS info:', error);
        }
    };

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

    useEffect(() => {
        const snsParam = searchParams.get('sns');
        if (snsParam && snsParam !== selectedSnsRoot) {
            updateSelectedSns(snsParam);
        } else if (!snsParam && selectedSnsRoot !== SNEED_SNS_ROOT) {
            setSearchParams(prev => {
                prev.set('sns', selectedSnsRoot);
                return prev;
            });
        }
    }, [searchParams, selectedSnsRoot, updateSelectedSns, SNEED_SNS_ROOT, setSearchParams]);

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

    const fetchProposalDataForThreads = useCallback(async (threads) => {
        if (!forumActor || !identity || !currentSnsRoot || !threads.length) return;
        if (topic?.title !== "Proposals") return;

        const batchSize = 5;
        const newProposalData = new Map();
        
        for (let i = 0; i < threads.length; i += batchSize) {
            const batch = threads.slice(i, i + batchSize);
            
            await Promise.allSettled(batch.map(async (thread) => {
                try {
                    const proposalLink = await forumActor.get_thread_proposal_id(Number(thread.id));
                    
                    if (proposalLink && Array.isArray(proposalLink) && proposalLink.length > 0) {
                        const tuple = proposalLink[0];
                        if (Array.isArray(tuple) && tuple.length === 2) {
                            const [snsRootIndex, proposalId] = tuple;
                            const proposalIdNum = Number(proposalId);
                            
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

    const fetchThreadPostCounts = useCallback(async (threads) => {
        if (!forumActor || !threads.length) return;
        
        try {
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
            
            const newCounts = new Map();
            results.forEach(({ threadId, count }) => {
                newCounts.set(threadId.toString(), count);
            });
            
            setThreadPostCounts(newCounts);
        } catch (err) {
            console.error('Error fetching thread post counts:', err);
        }
    }, [forumActor]);

    const fetchSubtopicStatistics = useCallback(async (subtopicIds) => {
        if (!forumActor || !subtopicIds.length) return;
        
        try {
            const statsPromises = subtopicIds.map(async (id) => {
                try {
                    const stats = await forumActor.get_topic_statistics(id);
                    return { id, stats };
                } catch (err) {
                    return { id, stats: null };
                }
            });
            
            const results = await Promise.all(statsPromises);
            const newStats = new Map();
            results.forEach(({ id, stats }) => {
                if (stats) {
                    newStats.set(id, {
                        thread_count: Number(stats.thread_count),
                        total_unread_posts: Number(stats.total_unread_posts)
                    });
                }
            });
            setSubtopicStatistics(newStats);
        } catch (err) {
            console.error('Error fetching subtopic statistics:', err);
        }
    }, [forumActor]);

    const fetchTopicData = useCallback(async () => {
        if (!topicId) return;
        
        setLoading(true);
        setError(null);
        
        try {
            const actor = createActor(canisterId, {
                agentOptions: {
                    host: process.env.DFX_NETWORK === 'ic' || process.env.DFX_NETWORK === 'staging' ? 'https://icp0.io' : 'http://localhost:4943',
                    identity: identity || undefined,
                },
            });
            
            const topicResponse = await actor.get_topic(parseInt(topicId));
            if (!topicResponse || topicResponse.length === 0) {
                setError('Topic not found');
                return;
            }
            
            const topicData = topicResponse[0];
            setTopic(topicData);
            
            // Load SNS info
            loadSnsInfo();
            
            // Fetch forum info for breadcrumb
            try {
                const forumResponse = await actor.get_forum(Number(topicData.forum_id));
                if (forumResponse && forumResponse.length > 0) {
                    setForumInfo(forumResponse[0]);
                }
            } catch (e) {
                console.warn('Could not fetch forum info:', e);
            }
            setBreadcrumbLoading(false);
            
            // Fetch subtopics
            const subtopicsResponse = await actor.get_subtopics(parseInt(topicId));
            const activeSubtopics = subtopicsResponse.filter(s => !s.deleted);
            setSubtopics(activeSubtopics);
            
            // Fetch subtopic statistics asynchronously
            if (activeSubtopics.length > 0) {
                fetchSubtopicStatistics(activeSubtopics.map(s => s.id));
            }
            
            // Check for Preproposals subtopic
            if (topicData.title === "Governance") {
                const hasPreproposals = subtopicsResponse.some(s => s.title === "Preproposals" && !s.deleted);
                setShowPreproposalsPrompt(!hasPreproposals);
            }
            
            // Fetch threads with sorting
            await fetchThreads(actor, parseInt(topicId));
            
        } catch (err) {
            console.error('Error fetching topic data:', err);
            setError('Failed to load topic data');
        } finally {
            setLoading(false);
        }
    }, [topicId, identity, currentPage, threadsPerPage, sortBy]);

    const fetchThreads = async (actor, topicIdNum) => {
        try {
            // Determine sort parameters based on sortBy state
            let sortField = 'created_at';
            let sortOrder = 'desc';
            
            switch (sortBy) {
                case 'newest':
                    sortField = 'created_at';
                    sortOrder = 'desc';
                    break;
                case 'oldest':
                    sortField = 'created_at';
                    sortOrder = 'asc';
                    break;
                case 'activity-newest':
                    sortField = 'last_activity';
                    sortOrder = 'desc';
                    break;
                case 'activity-oldest':
                    sortField = 'last_activity';
                    sortOrder = 'asc';
                    break;
            }
            
            // Try paginated endpoint first
            try {
                const paginatedResponse = await actor.get_threads_paginated({
                    topic_id: topicIdNum,
                    page: currentPage,
                    page_size: threadsPerPage,
                    sort_by: [sortField],
                    sort_order: [sortOrder]
                });
                
                if (paginatedResponse) {
                    setThreads(paginatedResponse.threads);
                    setTotalThreads(Number(paginatedResponse.total_count));
                    
                    // Fetch post counts asynchronously
                    fetchThreadPostCounts(paginatedResponse.threads);
                    fetchProposalDataForThreads(paginatedResponse.threads);
                    fetchUserThreadReads();
                    return;
                }
            } catch (paginationError) {
                console.warn('Paginated endpoint failed, falling back:', paginationError);
            }
            
            // Fallback to simple endpoint
            const threadsResponse = await actor.get_threads_by_topic(topicIdNum);
            const activeThreads = threadsResponse.filter(t => !t.deleted);
            
            // Sort threads
            activeThreads.sort((a, b) => {
                const aTime = sortField === 'last_activity' ? (a.last_activity?.[0] || a.created_at) : a.created_at;
                const bTime = sortField === 'last_activity' ? (b.last_activity?.[0] || b.created_at) : b.created_at;
                return sortOrder === 'desc' ? Number(bTime - aTime) : Number(aTime - bTime);
            });
            
            setTotalThreads(activeThreads.length);
            
            // Apply pagination
            const startIdx = currentPage * threadsPerPage;
            const paginatedThreads = activeThreads.slice(startIdx, startIdx + threadsPerPage);
            setThreads(paginatedThreads);
            
            fetchThreadPostCounts(paginatedThreads);
            fetchProposalDataForThreads(paginatedThreads);
            fetchUserThreadReads();
            
        } catch (err) {
            console.error('Error fetching threads:', err);
            setError('Failed to load threads');
        }
    };

    useEffect(() => {
        fetchTopicData();
    }, [fetchTopicData]);

    useEffect(() => {
        const handleResize = () => {
            setIsMobile(window.innerWidth <= 768);
        };
        window.addEventListener('resize', handleResize);
        return () => window.removeEventListener('resize', handleResize);
    }, []);

    useEffect(() => {
        try {
            localStorage.setItem('topicThreadsPerPage', threadsPerPage.toString());
        } catch (e) {}
    }, [threadsPerPage]);

    useEffect(() => {
        try {
            localStorage.setItem('topicSortBy', sortBy);
        } catch (e) {}
    }, [sortBy]);

    const hasUnreadPosts = (thread) => {
        if (!identity) return false;
        const unreadCount = thread.unread_posts_count && thread.unread_posts_count.length > 0 
            ? Number(thread.unread_posts_count[0]) : 0;
        return unreadCount > 0;
    };

    const handleCreatePreproposalsTopic = async () => {
        if (!forumActor || !identity || !currentSnsRoot || creatingPreproposals) return;
        
        setCreatingPreproposals(true);
        try {
            const result = await forumActor.create_special_topic({
                sns_root_canister_id: Principal.fromText(currentSnsRoot),
                special_topic_type: { 'Preproposals': null }
            });
            
            if ('ok' in result) {
                setShowPreproposalsPrompt(false);
                navigate(`/topic/${result.ok}${currentSnsRoot ? `?sns=${currentSnsRoot}` : ''}`);
            } else {
                setError('Failed to create Preproposals topic: ' + formatError(result.err));
            }
        } catch (err) {
            setError('Failed to create Preproposals topic: ' + err.message);
        } finally {
            setCreatingPreproposals(false);
        }
    };

    const handleCreateThread = async () => {
        if (!forumActor || !identity || submitting) return;
        if (!createThreadTitle.trim() || !createThreadBody.trim()) return;
        
        if (textLimits) {
            if (createThreadTitle.length > textLimits.thread_title_max_length) return;
            if (createThreadBody.length > textLimits.thread_body_max_length) return;
        }
        
        if (includePoll) {
            if (!pollTitle.trim()) {
                setError('Poll title is required when creating a poll');
                return;
            }
            const validOptions = pollOptions.filter(opt => opt.title.trim());
            if (validOptions.length < 2) {
                setError('At least 2 poll options are required');
                return;
            }
        }
        
        setSubmitting(true);
        setError(null);
        
        try {
            const threadResult = await forumActor.create_thread({
                topic_id: parseInt(topicId),
                title: [createThreadTitle.trim()],
                body: createThreadBody.trim()
            });

            if (!('ok' in threadResult)) {
                setError('Failed to create thread: ' + formatError(threadResult.err, 'Unknown error'));
                return;
            }

            const newThreadId = threadResult.ok;

            if (includePoll) {
                const endDateTime = new Date(`${pollEndDate}T${pollEndTime}`);
                const endTimestamp = endDateTime.getTime() * 1000000;

                const validOptions = pollOptions.filter(opt => opt.title.trim()).map(opt => ({
                    title: opt.title.trim(),
                    body: opt.body.trim() ? [opt.body.trim()] : []
                }));

                const pollResult = await forumActor.create_poll({
                    thread_id: parseInt(newThreadId),
                    post_id: [],
                    title: pollTitle.trim(),
                    body: pollBody.trim(),
                    options: validOptions,
                    vp_power: pollVpPower === 1.0 ? [] : [pollVpPower],
                    end_timestamp: endTimestamp,
                    allow_vote_changes: allowVoteChanges === true ? [] : [allowVoteChanges]
                });

                if (!('ok' in pollResult)) {
                    setError('Thread created successfully, but poll creation failed: ' + formatError(pollResult.err, 'Unknown error'));
                    navigate(`/thread?threadid=${newThreadId}`);
                    return;
                }
            }

            setCreateThreadTitle('');
            setCreateThreadBody('');
            clearPollForm();
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

    const totalPages = Math.ceil(totalThreads / threadsPerPage);

    const handleThreadsPerPageChange = (newThreadsPerPage) => {
        setThreadsPerPage(newThreadsPerPage);
        setCurrentPage(0);
    };

    const addPollOption = () => {
        if (pollOptions.length < 10) {
            setPollOptions([...pollOptions, { title: '', body: '' }]);
        }
    };

    const removePollOption = (index) => {
        if (pollOptions.length > 2) {
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

    // Get icon for topic
    const getTopicIcon = (title) => {
        const lowerTitle = title?.toLowerCase() || '';
        if (lowerTitle.includes('governance') || lowerTitle.includes('proposal')) return <FaGavel size={20} />;
        if (lowerTitle.includes('general')) return <FaComments size={20} />;
        if (lowerTitle.includes('idea') || lowerTitle.includes('preproposal')) return <FaRegLightbulb size={20} />;
        if (lowerTitle.includes('announce') || lowerTitle.includes('news')) return <FaFire size={20} />;
        return <FaComments size={20} />;
    };

    if (loading) {
        return (
            <div className='page-container'>
                <style>{customStyles}</style>
                <Header showSnsDropdown={true} onSnsChange={handleSnsChange} />
                <main style={{
                    background: theme.colors.primaryGradient,
                    minHeight: '100vh',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center'
                }}>
                    <div style={{ textAlign: 'center', color: theme.colors.mutedText }}>
                        <div className="topic-pulse" style={{
                            width: '60px',
                            height: '60px',
                            borderRadius: '50%',
                            background: `linear-gradient(135deg, ${forumPrimary}, ${forumSecondary})`,
                            margin: '0 auto 1rem',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center'
                        }}>
                            <FaComments size={28} color="white" />
                        </div>
                        <p style={{ fontSize: '1.1rem' }}>Loading topic...</p>
                    </div>
                </main>
            </div>
        );
    }

    if (error && !topic) {
        return (
            <div className='page-container'>
                <style>{customStyles}</style>
                <Header showSnsDropdown={true} onSnsChange={handleSnsChange} />
                <main style={{
                    background: theme.colors.primaryGradient,
                    minHeight: '100vh',
                    padding: '2rem'
                }}>
                    <div style={{
                        maxWidth: '600px',
                        margin: '4rem auto',
                        background: 'rgba(231, 76, 60, 0.1)',
                        border: '1px solid rgba(231, 76, 60, 0.3)',
                        borderRadius: '12px',
                        padding: '2rem',
                        textAlign: 'center',
                        color: theme.colors.error
                    }}>
                        <p style={{ fontSize: '1.1rem' }}>{error}</p>
                    </div>
                </main>
            </div>
        );
    }

    return (
        <div className='page-container'>
            <style>{customStyles}</style>
            <Header showSnsDropdown={true} onSnsChange={handleSnsChange} />
            
            <main style={{
                background: theme.colors.primaryGradient,
                minHeight: '100vh'
            }}>
                {/* Hero Section */}
                <div style={{
                    background: `linear-gradient(135deg, ${theme.colors.primaryBg} 0%, ${forumPrimary}15 50%, ${forumSecondary}10 100%)`,
                    borderBottom: `1px solid ${theme.colors.border}`,
                    padding: '2.5rem 1.5rem',
                    position: 'relative',
                    overflow: 'hidden'
                }}>
                    {/* Background decoration */}
                    <div style={{
                        position: 'absolute',
                        top: '-50%',
                        right: '-10%',
                        width: '400px',
                        height: '400px',
                        background: `radial-gradient(circle, ${forumPrimary}20 0%, transparent 70%)`,
                        borderRadius: '50%',
                        pointerEvents: 'none'
                    }} />
                    
                    <div style={{
                        maxWidth: '900px',
                        margin: '0 auto',
                        position: 'relative',
                        zIndex: 1
                    }}>
                        {/* Breadcrumb */}
                        {!breadcrumbLoading && (
                            <div style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: '0.5rem',
                                marginBottom: '1.5rem',
                                fontSize: '0.9rem'
                            }}>
                                <Link 
                                    to={forumInfo?.sns_root_canister_id?.length > 0 
                                        ? `/forum?sns=${forumInfo.sns_root_canister_id[0].toText()}`
                                        : "/forum"
                                    } 
                                    style={{
                                        color: forumPrimary,
                                        textDecoration: 'none',
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: '4px'
                                    }}
                                >
                                    <FaChevronLeft size={12} />
                                    {snsInfo?.name ? `${snsInfo.name} Forum` : 'Forum'}
                                </Link>
                                <span style={{ color: theme.colors.mutedText }}>›</span>
                                <span style={{ color: theme.colors.secondaryText }}>{topic?.title}</span>
                            </div>
                        )}
                        
                        {/* Topic Header */}
                        <div style={{
                            display: 'flex',
                            alignItems: 'flex-start',
                            gap: '1.25rem'
                        }}>
                            {/* Topic Icon */}
                            <div style={{
                                width: '56px',
                                height: '56px',
                                borderRadius: '16px',
                                background: `linear-gradient(135deg, ${forumPrimary}, ${forumSecondary})`,
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                color: 'white',
                                flexShrink: 0,
                                boxShadow: `0 4px 20px ${forumPrimary}40`
                            }}>
                                {getTopicIcon(topic?.title)}
                            </div>
                            
                            <div style={{ flex: 1 }}>
                                <h1 style={{
                                    color: theme.colors.primaryText,
                                    fontSize: '2rem',
                                    fontWeight: '700',
                                    margin: '0 0 0.5rem 0',
                                    lineHeight: '1.2'
                                }}>
                                    {topic?.title}
                                </h1>
                                <p style={{
                                    color: theme.colors.secondaryText,
                                    fontSize: '1rem',
                                    margin: '0 0 0.75rem 0',
                                    lineHeight: '1.5'
                                }}>
                                    {topic?.description || 'Explore discussions in this topic'}
                                </p>
                                <div style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '1rem',
                                    flexWrap: 'wrap',
                                    fontSize: '0.85rem',
                                    color: theme.colors.mutedText
                                }}>
                                    <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                        <FaList size={12} />
                                        {totalThreads} thread{totalThreads !== 1 ? 's' : ''}
                                    </span>
                                    {subtopics.length > 0 && (
                                        <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                            <FaComments size={12} />
                                            {subtopics.length} subtopic{subtopics.length !== 1 ? 's' : ''}
                                        </span>
                                    )}
                                    <span 
                                        style={{ display: 'flex', alignItems: 'center', gap: '4px' }}
                                        title={getFullDate(topic?.created_at)}
                                    >
                                        <FaRegClock size={12} />
                                        Created {getRelativeTime(topic?.created_at)}
                                    </span>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Main Content */}
                <div style={{
                    maxWidth: '900px',
                    margin: '0 auto',
                    padding: '2rem 1.5rem'
                }}>
                    {/* Error Display */}
                    {error && (
                        <div style={{
                            background: 'rgba(231, 76, 60, 0.1)',
                            border: '1px solid rgba(231, 76, 60, 0.3)',
                            borderRadius: '12px',
                            padding: '1rem 1.5rem',
                            marginBottom: '1.5rem',
                            color: theme.colors.error
                        }}>
                            {error}
                        </div>
                    )}

                    {/* Subtopics Section */}
                    {subtopics.length > 0 && (
                        <div style={{ marginBottom: '2rem' }}>
                            <h2 style={{
                                color: theme.colors.primaryText,
                                fontSize: '1.25rem',
                                fontWeight: '600',
                                marginBottom: '1rem',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '0.5rem'
                            }}>
                                <span style={{
                                    width: '32px',
                                    height: '32px',
                                    borderRadius: '8px',
                                    background: `linear-gradient(135deg, ${forumAccent}30, ${forumPrimary}20)`,
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    color: forumAccent
                                }}>
                                    <FaComments size={14} />
                                </span>
                                Subtopics
                            </h2>
                            
                            <div style={{
                                display: 'grid',
                                gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
                                gap: '1rem'
                            }}>
                                {subtopics.map((subtopic, index) => {
                                    const stats = subtopicStatistics.get(subtopic.id);
                                    const isHovered = hoveredCard === subtopic.id;
                                    
                                    return (
                                        <Link
                                            key={subtopic.id}
                                            to={`/topic/${subtopic.id}`}
                                            className="topic-card-animate"
                                            style={{
                                                background: `linear-gradient(135deg, ${forumPrimary}10 0%, ${forumSecondary}05 100%)`,
                                                borderRadius: '14px',
                                                padding: '1.25rem',
                                                border: `1px solid ${isHovered ? forumPrimary : theme.colors.border}`,
                                                textDecoration: 'none',
                                                transition: 'all 0.3s ease',
                                                transform: isHovered ? 'translateY(-3px)' : 'translateY(0)',
                                                boxShadow: isHovered 
                                                    ? `0 8px 30px ${forumPrimary}20`
                                                    : '0 2px 8px rgba(0,0,0,0.1)',
                                                display: 'flex',
                                                alignItems: 'flex-start',
                                                gap: '1rem',
                                                animationDelay: `${index * 0.05}s`,
                                                opacity: 0
                                            }}
                                            onMouseEnter={() => setHoveredCard(subtopic.id)}
                                            onMouseLeave={() => setHoveredCard(null)}
                                        >
                                            <div style={{
                                                width: '40px',
                                                height: '40px',
                                                borderRadius: '10px',
                                                background: `${forumPrimary}20`,
                                                display: 'flex',
                                                alignItems: 'center',
                                                justifyContent: 'center',
                                                color: forumPrimary,
                                                flexShrink: 0
                                            }}>
                                                {getTopicIcon(subtopic.title)}
                                            </div>
                                            
                                            <div style={{ flex: 1, minWidth: 0 }}>
                                                <div style={{
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    gap: '0.5rem',
                                                    marginBottom: '0.35rem'
                                                }}>
                                                    <h4 style={{
                                                        color: theme.colors.primaryText,
                                                        fontSize: '1.05rem',
                                                        fontWeight: '600',
                                                        margin: 0
                                                    }}>
                                                        {subtopic.title}
                                                    </h4>
                                                    {stats?.total_unread_posts > 0 && (
                                                        <span style={{
                                                            background: theme.colors.error,
                                                            color: 'white',
                                                            padding: '2px 6px',
                                                            borderRadius: '8px',
                                                            fontSize: '0.7rem',
                                                            fontWeight: '600'
                                                        }}>
                                                            {stats.total_unread_posts} new
                                                        </span>
                                                    )}
                                                </div>
                                                <p style={{
                                                    color: theme.colors.mutedText,
                                                    fontSize: '0.85rem',
                                                    margin: 0,
                                                    lineHeight: '1.4'
                                                }}>
                                                    {subtopic.description || 'No description'}
                                                </p>
                                                {stats && (
                                                    <div style={{
                                                        marginTop: '0.5rem',
                                                        fontSize: '0.8rem',
                                                        color: theme.colors.mutedText
                                                    }}>
                                                        📋 {stats.thread_count} thread{stats.thread_count !== 1 ? 's' : ''}
                                                    </div>
                                                )}
                                            </div>
                                            
                                            <FaChevronRight 
                                                size={14} 
                                                style={{
                                                    color: isHovered ? forumPrimary : theme.colors.mutedText,
                                                    transition: 'all 0.3s ease',
                                                    transform: isHovered ? 'translateX(3px)' : 'translateX(0)',
                                                    flexShrink: 0,
                                                    marginTop: '0.25rem'
                                                }}
                                            />
                                        </Link>
                                    );
                                })}
                            </div>
                        </div>
                    )}

                    {/* Preproposals Prompt */}
                    {showPreproposalsPrompt && (
                        <div style={{
                            background: `linear-gradient(135deg, ${theme.colors.secondaryBg} 0%, ${forumAccent}10 100%)`,
                            border: `1px solid ${forumAccent}40`,
                            borderRadius: '16px',
                            padding: '1.5rem',
                            marginBottom: '2rem',
                            textAlign: 'center'
                        }}>
                            <h3 style={{
                                color: forumAccent,
                                fontSize: '1.2rem',
                                fontWeight: '600',
                                marginBottom: '0.75rem'
                            }}>
                                💡 Create Preproposals Topic?
                            </h3>
                            <p style={{
                                color: theme.colors.secondaryText,
                                fontSize: '0.95rem',
                                marginBottom: '1.25rem',
                                lineHeight: '1.5'
                            }}>
                                This Governance topic doesn't have a "Preproposals" subtopic yet. Create one to discuss potential proposals before formal submission.
                            </p>
                            <div style={{
                                display: 'flex',
                                gap: '0.75rem',
                                justifyContent: 'center',
                                flexWrap: 'wrap'
                            }}>
                                <button 
                                    onClick={handleCreatePreproposalsTopic}
                                    disabled={creatingPreproposals}
                                    style={{
                                        background: creatingPreproposals 
                                            ? theme.colors.mutedText 
                                            : `linear-gradient(135deg, ${forumAccent}, ${forumPrimary})`,
                                        color: 'white',
                                        border: 'none',
                                        borderRadius: '10px',
                                        padding: '0.75rem 1.5rem',
                                        fontSize: '0.95rem',
                                        fontWeight: '600',
                                        cursor: creatingPreproposals ? 'not-allowed' : 'pointer',
                                        transition: 'all 0.3s ease'
                                    }}
                                >
                                    {creatingPreproposals ? 'Creating...' : 'Create Preproposals Topic'}
                                </button>
                                <button 
                                    onClick={() => setShowPreproposalsPrompt(false)}
                                    style={{
                                        background: 'transparent',
                                        color: theme.colors.mutedText,
                                        border: `1px solid ${theme.colors.border}`,
                                        borderRadius: '10px',
                                        padding: '0.75rem 1.5rem',
                                        fontSize: '0.95rem',
                                        cursor: 'pointer'
                                    }}
                                >
                                    Maybe Later
                                </button>
                            </div>
                        </div>
                    )}

                    {/* Threads Section */}
                    <div style={{ marginBottom: '2rem' }}>
                        <div style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            marginBottom: '1rem',
                            flexWrap: 'wrap',
                            gap: '1rem'
                        }}>
                            <h2 style={{
                                color: theme.colors.primaryText,
                                fontSize: '1.25rem',
                                fontWeight: '600',
                                margin: 0,
                                display: 'flex',
                                alignItems: 'center',
                                gap: '0.5rem'
                            }}>
                                <span style={{
                                    width: '32px',
                                    height: '32px',
                                    borderRadius: '8px',
                                    background: `linear-gradient(135deg, ${forumPrimary}30, ${forumSecondary}20)`,
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    color: forumPrimary
                                }}>
                                    <FaList size={14} />
                                </span>
                                Threads
                                <span style={{
                                    fontSize: '0.9rem',
                                    fontWeight: '400',
                                    color: theme.colors.mutedText
                                }}>
                                    ({totalThreads})
                                </span>
                            </h2>
                            
                            {/* Controls */}
                            <div style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: '1rem',
                                flexWrap: 'wrap'
                            }}>
                                <div style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '0.5rem',
                                    fontSize: '0.85rem',
                                    color: theme.colors.secondaryText
                                }}>
                                    <FaSort size={12} />
                                    <select
                                        value={sortBy}
                                        onChange={(e) => {
                                            setSortBy(e.target.value);
                                            setCurrentPage(0);
                                        }}
                                        style={{
                                            background: theme.colors.secondaryBg,
                                            color: theme.colors.primaryText,
                                            border: `1px solid ${theme.colors.border}`,
                                            borderRadius: '8px',
                                            padding: '0.4rem 0.75rem',
                                            fontSize: '0.85rem',
                                            cursor: 'pointer'
                                        }}
                                    >
                                        <option value="newest">Newest</option>
                                        <option value="oldest">Oldest</option>
                                        <option value="activity-newest">Recent Activity</option>
                                        <option value="activity-oldest">Oldest Activity</option>
                                    </select>
                                </div>
                                
                                <select
                                    value={threadsPerPage}
                                    onChange={(e) => handleThreadsPerPageChange(Number(e.target.value))}
                                    style={{
                                        background: theme.colors.secondaryBg,
                                        color: theme.colors.primaryText,
                                        border: `1px solid ${theme.colors.border}`,
                                        borderRadius: '8px',
                                        padding: '0.4rem 0.75rem',
                                        fontSize: '0.85rem',
                                        cursor: 'pointer'
                                    }}
                                >
                                    <option value={5}>5 per page</option>
                                    <option value={10}>10 per page</option>
                                    <option value={20}>20 per page</option>
                                    <option value={50}>50 per page</option>
                                </select>
                            </div>
                        </div>

                        {/* Thread List */}
                        {threads.length > 0 ? (
                            <div style={{
                                display: 'flex',
                                flexDirection: 'column',
                                gap: '0.75rem'
                            }}>
                                {threads.map((thread, index) => {
                                    const isHovered = hoveredThread === thread.id;
                                    const hasUnread = hasUnreadPosts(thread);
                                    const proposalInfo = threadProposals.get(thread.id.toString());
                                    
                                    // Get post count
                                    const backendPostCount = thread.total_posts_count && thread.total_posts_count.length > 0 
                                        ? Number(thread.total_posts_count[0]) : null;
                                    const asyncPostCount = threadPostCounts.get(thread.id.toString());
                                    const postCount = backendPostCount !== null ? backendPostCount : asyncPostCount;
                                    
                                    return (
                                        <div
                                            key={thread.id}
                                            className="topic-card-animate"
                                            style={{
                                                background: hasUnread 
                                                    ? `linear-gradient(135deg, ${forumPrimary}15 0%, ${theme.colors.secondaryBg} 100%)`
                                                    : theme.colors.secondaryBg,
                                                borderRadius: '14px',
                                                padding: '1.25rem',
                                                border: `1px solid ${hasUnread ? forumPrimary : (isHovered ? forumPrimary : theme.colors.border)}`,
                                                cursor: 'pointer',
                                                transition: 'all 0.3s ease',
                                                transform: isHovered ? 'translateX(4px)' : 'translateX(0)',
                                                boxShadow: isHovered 
                                                    ? `0 4px 20px ${forumPrimary}15`
                                                    : 'none',
                                                animationDelay: `${index * 0.05}s`,
                                                opacity: 0
                                            }}
                                            onMouseEnter={() => setHoveredThread(thread.id)}
                                            onMouseLeave={() => setHoveredThread(null)}
                                            onClick={() => navigate(`/thread?threadid=${thread.id.toString()}`)}
                                        >
                                            <div style={{
                                                display: 'flex',
                                                alignItems: 'flex-start',
                                                gap: '1rem'
                                            }}>
                                                <div style={{ flex: 1, minWidth: 0 }}>
                                                    {/* Thread Title */}
                                                    <div style={{
                                                        display: 'flex',
                                                        alignItems: 'center',
                                                        gap: '0.5rem',
                                                        marginBottom: '0.5rem',
                                                        flexWrap: 'wrap'
                                                    }}>
                                                        <h3 style={{
                                                            color: theme.colors.primaryText,
                                                            fontSize: '1.1rem',
                                                            fontWeight: '600',
                                                            margin: 0
                                                        }}>
                                                            {thread.title || `Thread #${thread.id}`}
                                                        </h3>
                                                        {hasUnread && (
                                                            <span style={{
                                                                background: theme.colors.error,
                                                                color: 'white',
                                                                padding: '2px 8px',
                                                                borderRadius: '10px',
                                                                fontSize: '0.7rem',
                                                                fontWeight: '600'
                                                            }}>
                                                                {(() => {
                                                                    const unreadCount = thread.unread_posts_count && thread.unread_posts_count.length > 0 
                                                                        ? Number(thread.unread_posts_count[0]) : 0;
                                                                    return unreadCount > 0 ? `${unreadCount} new` : 'NEW';
                                                                })()}
                                                            </span>
                                                        )}
                                                    </div>
                                                    
                                                    {/* Thread Body Preview */}
                                                    <div style={{
                                                        color: theme.colors.secondaryText,
                                                        fontSize: '0.9rem',
                                                        lineHeight: '1.5',
                                                        marginBottom: '0.75rem',
                                                        display: '-webkit-box',
                                                        WebkitLineClamp: 2,
                                                        WebkitBoxOrient: 'vertical',
                                                        overflow: 'hidden'
                                                    }}>
                                                        <MarkdownBody text={thread.body} />
                                                    </div>
                                                    
                                                    {/* Proposal Link */}
                                                    {proposalInfo && (
                                                        <div 
                                                            style={{
                                                                marginBottom: '0.75rem',
                                                                padding: '0.5rem 0.75rem',
                                                                background: `${forumPrimary}15`,
                                                                border: `1px solid ${forumPrimary}30`,
                                                                borderRadius: '8px',
                                                                fontSize: '0.85rem',
                                                                display: 'inline-flex',
                                                                alignItems: 'center',
                                                                gap: '0.5rem'
                                                            }}
                                                            onClick={(e) => e.stopPropagation()}
                                                        >
                                                            <span style={{ color: forumPrimary }}>📋</span>
                                                            <a 
                                                                href={`/proposal?proposalid=${proposalInfo.proposalId}&sns=${selectedSnsRoot || ''}`}
                                                                style={{
                                                                    color: forumPrimary,
                                                                    textDecoration: 'none',
                                                                    fontWeight: '500'
                                                                }}
                                                            >
                                                                {proposalInfo.proposalData?.proposal?.[0]?.title 
                                                                    ? `Proposal #${proposalInfo.proposalId}: ${proposalInfo.proposalData.proposal[0].title}`
                                                                    : `Proposal #${proposalInfo.proposalId}`}
                                                            </a>
                                                        </div>
                                                    )}
                                                    
                                                    {/* Thread Meta */}
                                                    <div style={{
                                                        display: 'flex',
                                                        alignItems: 'center',
                                                        gap: '1rem',
                                                        flexWrap: 'wrap',
                                                        fontSize: '0.8rem',
                                                        color: theme.colors.mutedText
                                                    }}>
                                                        <span 
                                                            style={{ display: 'flex', alignItems: 'center', gap: '4px' }}
                                                            title={getFullDate(thread.created_at)}
                                                        >
                                                            <FaRegClock size={11} />
                                                            {getRelativeTime(thread.created_at)}
                                                        </span>
                                                        {postCount !== undefined ? (
                                                            <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                                                <FaComments size={11} />
                                                                {postCount} post{postCount !== 1 ? 's' : ''}
                                                            </span>
                                                        ) : (
                                                            <span style={{ fontStyle: 'italic' }}>Loading...</span>
                                                        )}
                                                    </div>
                                                </div>
                                                
                                                {/* Arrow */}
                                                <FaArrowRight 
                                                    size={16} 
                                                    style={{
                                                        color: isHovered ? forumPrimary : theme.colors.mutedText,
                                                        transition: 'all 0.3s ease',
                                                        transform: isHovered ? 'translateX(3px)' : 'translateX(0)',
                                                        flexShrink: 0,
                                                        marginTop: '0.25rem'
                                                    }}
                                                />
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        ) : (
                            <div style={{
                                textAlign: 'center',
                                padding: '3rem 2rem',
                                background: theme.colors.secondaryBg,
                                borderRadius: '16px',
                                border: `1px solid ${theme.colors.border}`
                            }}>
                                <div className="topic-float" style={{
                                    width: '60px',
                                    height: '60px',
                                    borderRadius: '50%',
                                    background: `linear-gradient(135deg, ${forumPrimary}30, ${forumSecondary}20)`,
                                    margin: '0 auto 1rem',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    color: forumPrimary
                                }}>
                                    <FaComments size={24} />
                                </div>
                                <p style={{
                                    color: theme.colors.secondaryText,
                                    fontSize: '1.1rem',
                                    marginBottom: '0.5rem'
                                }}>
                                    No threads yet
                                </p>
                                <p style={{
                                    color: theme.colors.mutedText,
                                    fontSize: '0.95rem'
                                }}>
                                    Be the first to start a discussion!
                                </p>
                            </div>
                        )}

                        {/* Pagination */}
                        {totalPages > 1 && (
                            <div style={{
                                display: 'flex',
                                justifyContent: 'center',
                                alignItems: 'center',
                                gap: '0.75rem',
                                marginTop: '1.5rem'
                            }}>
                                <button
                                    onClick={() => setCurrentPage(p => Math.max(0, p - 1))}
                                    disabled={currentPage === 0}
                                    style={{
                                        background: currentPage === 0 
                                            ? theme.colors.mutedText 
                                            : `linear-gradient(135deg, ${forumPrimary}, ${forumSecondary})`,
                                        color: 'white',
                                        border: 'none',
                                        borderRadius: '8px',
                                        padding: '0.5rem 1rem',
                                        fontSize: '0.9rem',
                                        fontWeight: '500',
                                        cursor: currentPage === 0 ? 'not-allowed' : 'pointer',
                                        opacity: currentPage === 0 ? 0.5 : 1,
                                        transition: 'all 0.3s ease'
                                    }}
                                >
                                    Previous
                                </button>
                                <span style={{
                                    color: theme.colors.secondaryText,
                                    fontSize: '0.9rem'
                                }}>
                                    Page {currentPage + 1} of {totalPages}
                                </span>
                                <button
                                    onClick={() => setCurrentPage(p => Math.min(totalPages - 1, p + 1))}
                                    disabled={currentPage >= totalPages - 1}
                                    style={{
                                        background: currentPage >= totalPages - 1 
                                            ? theme.colors.mutedText 
                                            : `linear-gradient(135deg, ${forumPrimary}, ${forumSecondary})`,
                                        color: 'white',
                                        border: 'none',
                                        borderRadius: '8px',
                                        padding: '0.5rem 1rem',
                                        fontSize: '0.9rem',
                                        fontWeight: '500',
                                        cursor: currentPage >= totalPages - 1 ? 'not-allowed' : 'pointer',
                                        opacity: currentPage >= totalPages - 1 ? 0.5 : 1,
                                        transition: 'all 0.3s ease'
                                    }}
                                >
                                    Next
                                </button>
                            </div>
                        )}
                    </div>

                    {/* Create Thread Section */}
                    {topic?.title !== "Proposals" && (
                        <div style={{
                            background: theme.colors.secondaryBg,
                            borderRadius: '16px',
                            padding: '1.5rem',
                            border: `1px solid ${theme.colors.border}`
                        }}>
                            <h3 style={{
                                color: theme.colors.primaryText,
                                fontSize: '1.1rem',
                                fontWeight: '600',
                                marginBottom: '1rem',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '0.5rem'
                            }}>
                                <FaPlus size={14} style={{ color: forumPrimary }} />
                                Start a New Thread
                            </h3>
                            
                            {/* Thread Title */}
                            <input
                                type="text"
                                value={createThreadTitle}
                                onChange={(e) => setCreateThreadTitle(e.target.value)}
                                placeholder="Thread title"
                                style={{
                                    width: '100%',
                                    background: theme.colors.primaryBg,
                                    color: theme.colors.primaryText,
                                    border: `1px solid ${textLimits && createThreadTitle.length > textLimits.thread_title_max_length ? theme.colors.error : theme.colors.border}`,
                                    borderRadius: '10px',
                                    padding: '0.75rem 1rem',
                                    marginBottom: '0.5rem',
                                    fontSize: '0.95rem',
                                    boxSizing: 'border-box',
                                    transition: 'border-color 0.2s ease'
                                }}
                                disabled={submitting}
                            />
                            {textLimits && (
                                <div style={{
                                    fontSize: '0.8rem',
                                    color: createThreadTitle.length > textLimits.thread_title_max_length ? theme.colors.error : 
                                           (textLimits.thread_title_max_length - createThreadTitle.length) < 20 ? '#f39c12' : theme.colors.mutedText,
                                    marginBottom: '0.75rem'
                                }}>
                                    {createThreadTitle.length}/{textLimits.thread_title_max_length} characters
                                </div>
                            )}
                            
                            {/* Emoji & Markdown Buttons */}
                            <EmojiPicker
                                targetRef={createThreadBodyRef}
                                getValue={() => createThreadBody}
                                setValue={setCreateThreadBody}
                                ariaLabel="Insert emoji into thread body"
                                rightSlot={
                                    <MarkdownButtons
                                        targetRef={createThreadBodyRef}
                                        getValue={() => createThreadBody}
                                        setValue={setCreateThreadBody}
                                    />
                                }
                            />
                            
                            {/* Thread Body */}
                            <textarea
                                value={createThreadBody}
                                onChange={(e) => setCreateThreadBody(e.target.value)}
                                placeholder="What would you like to discuss?"
                                ref={createThreadBodyRef}
                                style={{
                                    width: '100%',
                                    background: theme.colors.primaryBg,
                                    color: theme.colors.primaryText,
                                    border: `1px solid ${textLimits && createThreadBody.length > textLimits.thread_body_max_length ? theme.colors.error : theme.colors.border}`,
                                    borderRadius: '10px',
                                    padding: '0.75rem 1rem',
                                    fontSize: '0.95rem',
                                    minHeight: '120px',
                                    resize: 'vertical',
                                    marginBottom: '0.5rem',
                                    boxSizing: 'border-box',
                                    lineHeight: '1.5',
                                    transition: 'border-color 0.2s ease'
                                }}
                                disabled={submitting}
                            />
                            {textLimits && (
                                <div style={{
                                    fontSize: '0.8rem',
                                    color: createThreadBody.length > textLimits.thread_body_max_length ? theme.colors.error : 
                                           (textLimits.thread_body_max_length - createThreadBody.length) < 100 ? '#f39c12' : theme.colors.mutedText,
                                    marginBottom: '1rem',
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '0.5rem'
                                }}>
                                    <span>{createThreadBody.length}/{textLimits.thread_body_max_length} characters</span>
                                    {isPremium && regularLimits && textLimits.thread_body_max_length > regularLimits.thread_body_max_length && (
                                        <span style={{
                                            background: 'rgba(255, 215, 0, 0.2)',
                                            color: '#ffd700',
                                            padding: '2px 6px',
                                            borderRadius: '4px',
                                            fontSize: '0.7rem',
                                            fontWeight: '600'
                                        }}>
                                            ⭐ PREMIUM
                                        </span>
                                    )}
                                </div>
                            )}
                            
                            {/* Poll Section */}
                            <div style={{
                                borderTop: `1px solid ${theme.colors.border}`,
                                paddingTop: '1rem',
                                marginTop: '0.5rem'
                            }}>
                                <label style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '0.5rem',
                                    cursor: 'pointer',
                                    marginBottom: '1rem'
                                }}>
                                    <input
                                        type="checkbox"
                                        checked={includePoll}
                                        onChange={(e) => setIncludePoll(e.target.checked)}
                                        style={{
                                            width: '18px',
                                            height: '18px',
                                            accentColor: forumPrimary
                                        }}
                                    />
                                    <FaPoll size={16} style={{ color: forumPrimary }} />
                                    <span style={{
                                        color: theme.colors.primaryText,
                                        fontSize: '0.95rem',
                                        fontWeight: '500'
                                    }}>
                                        Include a Poll
                                    </span>
                                </label>

                                {includePoll && (
                                    <div style={{
                                        background: `${forumPrimary}10`,
                                        borderRadius: '12px',
                                        padding: '1.25rem',
                                        border: `1px solid ${forumPrimary}30`,
                                        marginBottom: '1rem'
                                    }}>
                                        <h4 style={{
                                            color: theme.colors.primaryText,
                                            marginBottom: '1rem',
                                            fontSize: '1rem',
                                            fontWeight: '600'
                                        }}>
                                            Poll Details
                                        </h4>
                                        
                                        {/* Poll Title */}
                                        <input
                                            type="text"
                                            value={pollTitle}
                                            onChange={(e) => setPollTitle(e.target.value)}
                                            placeholder="Poll title"
                                            style={{
                                                width: '100%',
                                                background: theme.colors.primaryBg,
                                                color: theme.colors.primaryText,
                                                border: `1px solid ${theme.colors.border}`,
                                                borderRadius: '8px',
                                                padding: '0.6rem 0.75rem',
                                                marginBottom: '0.75rem',
                                                fontSize: '0.9rem',
                                                boxSizing: 'border-box'
                                            }}
                                            disabled={submitting}
                                        />

                                        {/* Poll Body */}
                                        <textarea
                                            value={pollBody}
                                            onChange={(e) => setPollBody(e.target.value)}
                                            placeholder="Poll description (optional)"
                                            style={{
                                                width: '100%',
                                                background: theme.colors.primaryBg,
                                                color: theme.colors.primaryText,
                                                border: `1px solid ${theme.colors.border}`,
                                                borderRadius: '8px',
                                                padding: '0.6rem 0.75rem',
                                                fontSize: '0.9rem',
                                                minHeight: '60px',
                                                resize: 'vertical',
                                                marginBottom: '1rem',
                                                boxSizing: 'border-box'
                                            }}
                                            disabled={submitting}
                                        />

                                        {/* Poll Options */}
                                        <div style={{ marginBottom: '1rem' }}>
                                            <h5 style={{
                                                color: theme.colors.secondaryText,
                                                marginBottom: '0.5rem',
                                                fontSize: '0.85rem',
                                                fontWeight: '500'
                                            }}>
                                                Options
                                            </h5>
                                            {pollOptions.map((option, index) => (
                                                <div key={index} style={{
                                                    display: 'flex',
                                                    gap: '0.5rem',
                                                    marginBottom: '0.5rem',
                                                    alignItems: 'flex-start'
                                                }}>
                                                    <div style={{ flex: 1 }}>
                                                        <input
                                                            type="text"
                                                            value={option.title}
                                                            onChange={(e) => updatePollOption(index, 'title', e.target.value)}
                                                            placeholder={`Option ${index + 1}`}
                                                            style={{
                                                                width: '100%',
                                                                background: theme.colors.primaryBg,
                                                                color: theme.colors.primaryText,
                                                                border: `1px solid ${theme.colors.border}`,
                                                                borderRadius: '6px',
                                                                padding: '0.5rem 0.6rem',
                                                                fontSize: '0.85rem',
                                                                marginBottom: '0.25rem',
                                                                boxSizing: 'border-box'
                                                            }}
                                                            disabled={submitting}
                                                        />
                                                        <textarea
                                                            value={option.body}
                                                            onChange={(e) => updatePollOption(index, 'body', e.target.value)}
                                                            placeholder="Description (optional)"
                                                            style={{
                                                                width: '100%',
                                                                background: theme.colors.primaryBg,
                                                                color: theme.colors.primaryText,
                                                                border: `1px solid ${theme.colors.border}`,
                                                                borderRadius: '6px',
                                                                padding: '0.4rem 0.6rem',
                                                                fontSize: '0.8rem',
                                                                minHeight: '35px',
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
                                                                background: theme.colors.error,
                                                                color: 'white',
                                                                border: 'none',
                                                                borderRadius: '6px',
                                                                padding: '0.5rem',
                                                                cursor: 'pointer',
                                                                fontSize: '0.8rem',
                                                                marginTop: '2px'
                                                            }}
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
                                                        background: `${forumPrimary}20`,
                                                        color: forumPrimary,
                                                        border: `1px solid ${forumPrimary}40`,
                                                        borderRadius: '6px',
                                                        padding: '0.4rem 0.75rem',
                                                        cursor: 'pointer',
                                                        fontSize: '0.8rem',
                                                        fontWeight: '500'
                                                    }}
                                                >
                                                    + Add Option
                                                </button>
                                            )}
                                        </div>

                                        {/* Poll Settings */}
                                        <div style={{
                                            display: 'grid',
                                            gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr 1fr',
                                            gap: '0.75rem',
                                            marginBottom: '1rem'
                                        }}>
                                            <div>
                                                <label style={{
                                                    color: theme.colors.mutedText,
                                                    fontSize: '0.8rem',
                                                    display: 'block',
                                                    marginBottom: '0.25rem'
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
                                                        background: theme.colors.primaryBg,
                                                        color: theme.colors.primaryText,
                                                        border: `1px solid ${theme.colors.border}`,
                                                        borderRadius: '6px',
                                                        padding: '0.5rem',
                                                        fontSize: '0.85rem',
                                                        boxSizing: 'border-box'
                                                    }}
                                                    disabled={submitting}
                                                />
                                            </div>
                                            <div>
                                                <label style={{
                                                    color: theme.colors.mutedText,
                                                    fontSize: '0.8rem',
                                                    display: 'block',
                                                    marginBottom: '0.25rem'
                                                }}>
                                                    End Time
                                                </label>
                                                <input
                                                    type="time"
                                                    value={pollEndTime}
                                                    onChange={(e) => setPollEndTime(e.target.value)}
                                                    style={{
                                                        width: '100%',
                                                        background: theme.colors.primaryBg,
                                                        color: theme.colors.primaryText,
                                                        border: `1px solid ${theme.colors.border}`,
                                                        borderRadius: '6px',
                                                        padding: '0.5rem',
                                                        fontSize: '0.85rem',
                                                        boxSizing: 'border-box'
                                                    }}
                                                    disabled={submitting}
                                                />
                                            </div>
                                            <div>
                                                <label style={{
                                                    color: theme.colors.mutedText,
                                                    fontSize: '0.8rem',
                                                    display: 'block',
                                                    marginBottom: '0.25rem'
                                                }}>
                                                    VP Power
                                                </label>
                                                <select
                                                    value={pollVpPower}
                                                    onChange={(e) => setPollVpPower(parseFloat(e.target.value))}
                                                    style={{
                                                        width: '100%',
                                                        background: theme.colors.primaryBg,
                                                        color: theme.colors.primaryText,
                                                        border: `1px solid ${theme.colors.border}`,
                                                        borderRadius: '6px',
                                                        padding: '0.5rem',
                                                        fontSize: '0.85rem',
                                                        boxSizing: 'border-box'
                                                    }}
                                                    disabled={submitting}
                                                >
                                                    <option value={0}>Equal (0)</option>
                                                    <option value={0.5}>Square Root (0.5)</option>
                                                    <option value={1}>Linear (1)</option>
                                                    <option value={2}>Quadratic (2)</option>
                                                </select>
                                            </div>
                                        </div>

                                        <label style={{
                                            display: 'flex',
                                            alignItems: 'center',
                                            gap: '0.5rem',
                                            cursor: 'pointer',
                                            color: theme.colors.secondaryText,
                                            fontSize: '0.85rem'
                                        }}>
                                            <input
                                                type="checkbox"
                                                checked={allowVoteChanges}
                                                onChange={(e) => setAllowVoteChanges(e.target.checked)}
                                                disabled={submitting}
                                                style={{ accentColor: forumPrimary }}
                                            />
                                            Allow voters to change their votes
                                        </label>
                                    </div>
                                )}
                            </div>
                            
                            {/* Submit Buttons */}
                            <div style={{
                                display: 'flex',
                                gap: '0.75rem',
                                flexWrap: 'wrap'
                            }}>
                                <button
                                    onClick={handleCreateThread}
                                    disabled={submitting || !createThreadTitle.trim() || !createThreadBody.trim() || 
                                             (textLimits && (createThreadTitle.length > textLimits.thread_title_max_length || 
                                                            createThreadBody.length > textLimits.thread_body_max_length))}
                                    style={{
                                        background: (submitting || !createThreadTitle.trim() || !createThreadBody.trim()) 
                                            ? theme.colors.mutedText 
                                            : `linear-gradient(135deg, ${theme.colors.success}, #27ae60)`,
                                        color: 'white',
                                        border: 'none',
                                        borderRadius: '10px',
                                        padding: '0.75rem 1.5rem',
                                        cursor: (submitting || !createThreadTitle.trim() || !createThreadBody.trim()) ? 'not-allowed' : 'pointer',
                                        fontSize: '0.95rem',
                                        fontWeight: '600',
                                        transition: 'all 0.3s ease'
                                    }}
                                >
                                    {submitting ? 'Creating...' : (includePoll ? 'Create Thread & Poll' : 'Create Thread')}
                                </button>
                                {includePoll && (
                                    <button
                                        onClick={clearPollForm}
                                        disabled={submitting}
                                        style={{
                                            background: 'transparent',
                                            color: theme.colors.mutedText,
                                            border: `1px solid ${theme.colors.border}`,
                                            borderRadius: '10px',
                                            padding: '0.75rem 1.5rem',
                                            cursor: submitting ? 'not-allowed' : 'pointer',
                                            fontSize: '0.95rem'
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
