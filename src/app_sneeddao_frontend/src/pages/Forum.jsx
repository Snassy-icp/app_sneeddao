import React, { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Principal } from '@dfinity/principal';
import { useAuth } from '../AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import { useSns } from '../contexts/SnsContext';
import Header from '../components/Header';
import { createActor, canisterId } from 'declarations/sneed_sns_forum';
import { formatError } from '../utils/errorUtils';
import { fetchSnsLogo, getAllSnses, getSnsById } from '../utils/SnsUtils';
import { HttpAgent } from '@dfinity/agent';
import { FaComments, FaUsers, FaLock, FaPlus, FaChevronRight, FaFire, FaRegLightbulb, FaGavel, FaRegClock } from 'react-icons/fa';
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

.forum-card-animate {
    animation: fadeInUp 0.5s ease-out forwards;
}

.forum-shimmer {
    background: linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.1) 50%, transparent 100%);
    background-size: 200% 100%;
    animation: shimmer 2s infinite;
}

.forum-pulse {
    animation: pulse 2s ease-in-out infinite;
}

.forum-float {
    animation: float 3s ease-in-out infinite;
}
`;

// Accent colors
const forumPrimary = '#6366f1'; // Indigo
const forumSecondary = '#8b5cf6'; // Purple
const forumAccent = '#06b6d4'; // Cyan

function Forum() {
    const { identity } = useAuth();
    const { theme } = useTheme();
    const { selectedSnsRoot } = useSns();
    const navigate = useNavigate();
    const [forum, setForum] = useState(null);
    const [topics, setTopics] = useState([]);
    const [topicHierarchy, setTopicHierarchy] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [creatingForum, setCreatingForum] = useState(false);
    const [hoveredCard, setHoveredCard] = useState(null);
    const [showGeneralPrompt, setShowGeneralPrompt] = useState(false);
    const [topicStatistics, setTopicStatistics] = useState(new Map());
    const [creatingGeneral, setCreatingGeneral] = useState(false);
    const [showGovernancePrompt, setShowGovernancePrompt] = useState(false);
    const [creatingGovernance, setCreatingGovernance] = useState(false);

    // SNS logo state
    const [snsLogo, setSnsLogo] = useState(null);
    const [loadingLogo, setLoadingLogo] = useState(false);
    const [snsInfo, setSnsInfo] = useState(null);

    useEffect(() => {
        if (!selectedSnsRoot) {
            setError('No SNS selected');
            setLoading(false);
            return;
        }

        fetchForumData();
        loadSnsInfo();
    }, [selectedSnsRoot, identity]);

    // Load SNS information and logo
    const loadSnsInfo = async () => {
        if (!selectedSnsRoot) return;

        setSnsLogo(null);
        setLoadingLogo(false);
        setSnsInfo(null);

        try {
            const allSnses = getAllSnses();
            const currentSnsInfo = allSnses.find(sns => sns.rootCanisterId === selectedSnsRoot);
            
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

    const checkForGeneralTopic = (topics) => {
        return topics.some(topic => 
            topic.title === "General" && 
            (!topic.parent_topic_id || topic.parent_topic_id.length === 0) &&
            !topic.deleted
        );
    };

    const checkForGovernanceTopic = (topics) => {
        return topics.some(topic => 
            topic.title === "Governance" && 
            (!topic.parent_topic_id || topic.parent_topic_id.length === 0) &&
            !topic.deleted
        );
    };

    const handleCreateGeneralTopic = async () => {
        if (!identity || !selectedSnsRoot || creatingGeneral) return;

        setCreatingGeneral(true);
        try {
            const forumActor = createActor(canisterId, {
                agentOptions: {
                    host: process.env.DFX_NETWORK === 'ic' || process.env.DFX_NETWORK === 'staging' ? 'https://icp0.io' : 'http://localhost:4943',
                    identity: identity,
                },
            });

            const snsRootPrincipal = Principal.fromText(selectedSnsRoot);
            const result = await forumActor.create_special_topic({
                sns_root_canister_id: snsRootPrincipal,
                special_topic_type: { 'General': null }
            });

            if ('ok' in result) {
                setShowGeneralPrompt(false);
                navigate(`/topic/${result.ok}${selectedSnsRoot ? `?sns=${selectedSnsRoot}` : ''}`);
            } else {
                setError('Failed to create General topic: ' + formatError(result.err));
            }
        } catch (err) {
            setError('Failed to create General topic: ' + err.message);
        } finally {
            setCreatingGeneral(false);
        }
    };

    const handleCreateGovernanceTopic = async () => {
        if (!identity || !selectedSnsRoot || creatingGovernance) return;

        setCreatingGovernance(true);
        try {
            const forumActor = createActor(canisterId, {
                agentOptions: {
                    host: process.env.DFX_NETWORK === 'ic' || process.env.DFX_NETWORK === 'staging' ? 'https://icp0.io' : 'http://localhost:4943',
                    identity: identity,
                },
            });

            const snsRootPrincipal = Principal.fromText(selectedSnsRoot);
            const result = await forumActor.create_special_topic({
                sns_root_canister_id: snsRootPrincipal,
                special_topic_type: { 'Governance': null }
            });

            if ('ok' in result) {
                setShowGovernancePrompt(false);
                navigate(`/topic/${result.ok}${selectedSnsRoot ? `?sns=${selectedSnsRoot}` : ''}`);
            } else {
                setError('Failed to create Governance topic: ' + formatError(result.err));
            }
        } catch (err) {
            setError('Failed to create Governance topic: ' + err.message);
        } finally {
            setCreatingGovernance(false);
        }
    };

    const handleCreateForum = async () => {
        if (!identity || !selectedSnsRoot || creatingForum) return;

        setCreatingForum(true);
        try {
            const forumActor = createActor(canisterId, {
                agentOptions: {
                    host: process.env.DFX_NETWORK === 'ic' || process.env.DFX_NETWORK === 'staging' ? 'https://icp0.io' : 'http://localhost:4943',
                    identity: identity,
                },
            });

            const snsRootPrincipal = Principal.fromText(selectedSnsRoot);
            const result = await forumActor.create_sns_forum_setup(snsRootPrincipal);

            if ('ok' in result) {
                setError(null);
                setLoading(true);
                const forumResponse = await forumActor.get_forum_by_sns_root(snsRootPrincipal);
                if (forumResponse && forumResponse.length > 0) {
                    const forum = forumResponse[0];
                    setForum(forum);
                    
                    const forumIdNumber = typeof forum.id === 'bigint' ? Number(forum.id) : forum.id;
                    const topicsResponse = await forumActor.get_topics_by_forum(forumIdNumber);
                    
                    if (topicsResponse) {
                        setTopics(topicsResponse);
                        const hierarchy = buildTopicHierarchy(topicsResponse);
                        setTopicHierarchy(hierarchy);
                    }
                }
            } else {
                setError('Failed to create forum: ' + formatError(result.err));
            }
        } catch (err) {
            setError('Failed to create forum: ' + err.message);
        } finally {
            setCreatingForum(false);
            setLoading(false);
        }
    };

    const getAllTopicIds = (hierarchyTopics) => {
        const ids = [];
        const extractIds = (topics) => {
            topics.forEach(topic => {
                ids.push(topic.id);
                if (topic.children && topic.children.length > 0) {
                    extractIds(topic.children);
                }
            });
        };
        extractIds(hierarchyTopics);
        return ids;
    };

    const fetchTopicStatistics = async (topicIds, actor) => {
        if (!actor || !identity || topicIds.length === 0) return;
        
        const statisticsPromises = topicIds.map(async (topicId) => {
            try {
                const stats = await actor.get_topic_statistics(topicId);
                return { topicId, stats };
            } catch (error) {
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
            
            setTopicStatistics(statsMap);
        } catch (error) {
            console.warn('Failed to fetch topic statistics:', error);
        }
    };

    const fetchForumData = async () => {
        try {
            setLoading(true);
            setError(null);

            const forumActor = createActor(canisterId, {
                agentOptions: {
                    host: process.env.DFX_NETWORK === 'ic' || process.env.DFX_NETWORK === 'staging' ? 'https://icp0.io' : 'http://localhost:4943',
                    identity: identity || undefined,
                },
            });

            const snsRootPrincipal = Principal.fromText(selectedSnsRoot);
            const forumResponse = await forumActor.get_forum_by_sns_root(snsRootPrincipal);
            
            if (!forumResponse || forumResponse.length === 0) {
                setError('NO_FORUM');
                return;
            }

            const forum = forumResponse[0];
            setForum(forum);

            const forumIdNumber = typeof forum.id === 'bigint' ? Number(forum.id) : forum.id;
            const topicsResponse = await forumActor.get_topics_by_forum(forumIdNumber);
            
            const hierarchyTopics = buildTopicHierarchy(topicsResponse);
            
            const rootTopics = hierarchyTopics.map(topic => ({ ...topic, children: undefined }));
            setTopics(rootTopics);
            setTopicHierarchy(hierarchyTopics);

            const allTopicIds = getAllTopicIds(hierarchyTopics);
            if (allTopicIds.length > 0) {
                fetchTopicStatistics(allTopicIds, forumActor);
            }

            const hasGeneralTopic = checkForGeneralTopic(topicsResponse);
            const hasGovernanceTopic = checkForGovernanceTopic(topicsResponse);
            setShowGeneralPrompt(!hasGeneralTopic && topicsResponse.length >= 0);
            setShowGovernancePrompt(!hasGovernanceTopic && topicsResponse.length >= 0);

        } catch (err) {
            console.error('Error fetching forum data:', err);
            setError('Failed to load forum data');
        } finally {
            setLoading(false);
        }
    };

    const buildTopicHierarchy = (topics) => {
        const activeTopics = topics.filter(topic => !topic.deleted);
        
        const rootTopics = [];
        const childTopicsMap = new Map();
        
        activeTopics.forEach(topic => {
            const isRootLevel = !topic.parent_topic_id || topic.parent_topic_id.length === 0;
            
            if (isRootLevel) {
                rootTopics.push({ ...topic, children: [] });
            } else {
                const parentId = topic.parent_topic_id[0];
                const parentIdStr = parentId.toString();
                
                if (!childTopicsMap.has(parentIdStr)) {
                    childTopicsMap.set(parentIdStr, []);
                }
                childTopicsMap.get(parentIdStr).push(topic);
            }
        });
        
        const hierarchyTopics = rootTopics.map(rootTopic => {
            const rootIdStr = rootTopic.id.toString();
            const children = childTopicsMap.get(rootIdStr) || [];
            return { ...rootTopic, children };
        });
        
        return hierarchyTopics;
    };

    const formatDate = (timestamp) => {
        return new Date(Number(timestamp / 1000000n)).toLocaleDateString();
    };

    // Get icon for topic based on title
    const getTopicIcon = (title) => {
        const lowerTitle = title.toLowerCase();
        if (lowerTitle.includes('governance') || lowerTitle.includes('proposal')) return <FaGavel size={24} />;
        if (lowerTitle.includes('general')) return <FaComments size={24} />;
        if (lowerTitle.includes('idea') || lowerTitle.includes('suggestion')) return <FaRegLightbulb size={24} />;
        if (lowerTitle.includes('announce') || lowerTitle.includes('news')) return <FaFire size={24} />;
        return <FaComments size={24} />;
    };

    // Get gradient for topic card based on index
    const getTopicGradient = (index) => {
        const gradients = [
            `linear-gradient(135deg, ${forumPrimary}15 0%, ${forumSecondary}10 100%)`,
            `linear-gradient(135deg, ${forumAccent}15 0%, ${forumPrimary}10 100%)`,
            `linear-gradient(135deg, ${forumSecondary}15 0%, ${forumAccent}10 100%)`,
            `linear-gradient(135deg, #10b98115 0%, #14b8a610 100%)`,
            `linear-gradient(135deg, #f59e0b15 0%, #ef444410 100%)`,
        ];
        return gradients[index % gradients.length];
    };

    if (loading) {
        return (
            <div className='page-container'>
                <style>{customStyles}</style>
                <Header showSnsDropdown={true} />
                <main style={{
                    background: theme.colors.primaryGradient,
                    minHeight: '100vh',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center'
                }}>
                    <div style={{
                        textAlign: 'center',
                        color: theme.colors.mutedText
                    }}>
                        <div className="forum-pulse" style={{
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
                        <p style={{ fontSize: '1.1rem' }}>Loading forum...</p>
                    </div>
                </main>
            </div>
        );
    }

    if (error) {
        if (error === 'NO_FORUM') {
            return (
                <div className='page-container'>
                    <style>{customStyles}</style>
                    <Header showSnsDropdown={true} />
                    <main style={{
                        background: theme.colors.primaryGradient,
                        minHeight: '100vh',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        padding: '2rem'
                    }}>
                        <div style={{
                            textAlign: 'center',
                            background: theme.colors.secondaryBg,
                            borderRadius: '24px',
                            padding: '3rem',
                            border: `1px solid ${theme.colors.border}`,
                            maxWidth: '500px',
                            boxShadow: '0 20px 60px rgba(0, 0, 0, 0.3)'
                        }}>
                            <div className="forum-float" style={{
                                width: '80px',
                                height: '80px',
                                borderRadius: '50%',
                                background: `linear-gradient(135deg, ${forumPrimary}, ${forumSecondary})`,
                                margin: '0 auto 1.5rem',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center'
                            }}>
                                <FaPlus size={32} color="white" />
                            </div>
                            <h1 style={{
                                color: theme.colors.primaryText,
                                fontSize: '2rem',
                                fontWeight: '700',
                                marginBottom: '1rem'
                            }}>
                                Create Your Forum
                            </h1>
                            <p style={{
                                color: theme.colors.secondaryText,
                                fontSize: '1.1rem',
                                marginBottom: '1rem',
                                lineHeight: '1.6'
                            }}>
                                This SNS doesn't have a forum yet. Be the first to create one!
                                </p>
                            <p style={{
                                color: theme.colors.mutedText,
                                fontSize: '0.95rem',
                                marginBottom: '2rem',
                                lineHeight: '1.5'
                            }}>
                                    Creating a forum will set up discussion spaces for governance topics and proposals.
                                </p>
                                <button 
                                    onClick={handleCreateForum}
                                    disabled={creatingForum}
                                    style={{
                                    background: creatingForum 
                                        ? theme.colors.mutedText 
                                        : `linear-gradient(135deg, ${forumPrimary}, ${forumSecondary})`,
                                    color: 'white',
                                    border: 'none',
                                    borderRadius: '12px',
                                    padding: '1rem 2.5rem',
                                    fontSize: '1.1rem',
                                    fontWeight: '600',
                                    cursor: creatingForum ? 'not-allowed' : 'pointer',
                                    transition: 'all 0.3s ease',
                                    boxShadow: creatingForum ? 'none' : `0 4px 20px ${forumPrimary}40`
                                    }}
                                >
                                    {creatingForum ? 'Creating Forum...' : 'Create Forum'}
                                </button>
                        </div>
                    </main>
                </div>
            );
        }
        
        return (
            <div className='page-container'>
                <style>{customStyles}</style>
                <Header showSnsDropdown={true} />
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
            <Header showSnsDropdown={true} />
            
            <main style={{
                background: theme.colors.primaryGradient,
                minHeight: '100vh'
            }}>
                {/* Hero Section */}
                <div style={{
                    background: `linear-gradient(135deg, ${theme.colors.primaryBg} 0%, ${forumPrimary}15 50%, ${forumSecondary}10 100%)`,
                    borderBottom: `1px solid ${theme.colors.border}`,
                    padding: '3rem 1.5rem',
                    position: 'relative',
                    overflow: 'hidden',
                    width: '100%',
                    boxSizing: 'border-box'
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
                        position: 'absolute',
                        bottom: '-30%',
                        left: '-5%',
                        width: '300px',
                        height: '300px',
                        background: `radial-gradient(circle, ${forumSecondary}15 0%, transparent 70%)`,
                        borderRadius: '50%',
                        pointerEvents: 'none'
                    }} />
                    
                    <div style={{
                        maxWidth: '900px',
                        margin: '0 auto',
                        position: 'relative',
                        zIndex: 1
                    }}>
                        {/* SNS Logo and Title */}
                        <div style={{
                        display: 'flex',
                        alignItems: 'center',
                            gap: '1.5rem',
                            marginBottom: '1.5rem'
                    }}>
                        {loadingLogo ? (
                            <div style={{
                                width: '72px',
                                height: '72px',
                                minWidth: '72px',
                                maxWidth: '72px',
                                flexShrink: 0,
                                borderRadius: '50%',
                                background: theme.colors.tertiaryBg,
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center'
                            }}>
                                <span className="forum-pulse" style={{ color: theme.colors.mutedText }}>...</span>
                            </div>
                        ) : snsLogo ? (
                            <img
                                src={snsLogo}
                                alt={snsInfo?.name || 'SNS Logo'}
                                style={{
                                    width: '72px',
                                    height: '72px',
                                    minWidth: '72px',
                                    maxWidth: '72px',
                                    flexShrink: 0,
                                    borderRadius: '50%',
                                    objectFit: 'cover',
                                    border: `3px solid ${forumPrimary}40`,
                                    boxShadow: `0 4px 20px ${forumPrimary}30`
                                }}
                            />
                        ) : (
                            <div style={{
                                width: '72px',
                                height: '72px',
                                minWidth: '72px',
                                maxWidth: '72px',
                                flexShrink: 0,
                                borderRadius: '50%',
                                background: `linear-gradient(135deg, ${forumPrimary}, ${forumSecondary})`,
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                fontSize: '1.5rem',
                                color: 'white',
                                fontWeight: '700'
                            }}>
                                {snsInfo?.name?.substring(0, 2).toUpperCase() || 'SN'}
                            </div>
                        )}
                        
                            <div style={{ flex: 1, minWidth: 0 }}>
                        <h1 style={{
                            color: theme.colors.primaryText,
                                    fontSize: '2.5rem',
                                    fontWeight: '700',
                            margin: 0,
                                    lineHeight: '1.2'
                        }}>
                                    {snsInfo?.name ? `${snsInfo.name} Forum` : (forum?.title || 'Community Forum')}
                        </h1>
                        <p style={{
                            color: theme.colors.secondaryText,
                            fontSize: '1.1rem',
                                    margin: '0.5rem 0 0 0'
                        }}>
                                    Discuss, govern, and connect with your community
                                </p>
                            </div>
                        </div>
                        
                        {/* Quick Stats */}
                        <div style={{
                            display: 'flex',
                            gap: '2rem',
                            flexWrap: 'wrap'
                        }}>
                            <div style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: '0.5rem',
                                color: theme.colors.secondaryText
                            }}>
                                <FaComments size={16} style={{ color: forumPrimary }} />
                                <span>{topicHierarchy.length} Topic{topicHierarchy.length !== 1 ? 's' : ''}</span>
                            </div>
                        {!identity && (
                                <div style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '0.5rem',
                                    color: '#f39c12',
                                    background: 'rgba(243, 156, 18, 0.1)',
                                    padding: '0.5rem 1rem',
                                    borderRadius: '20px',
                                    fontSize: '0.9rem'
                            }}>
                                    <FaLock size={14} />
                                    <span>Log in to participate</span>
                                </div>
                            )}
                        </div>
                    </div>
                </div>

                {/* Main Content */}
                <div style={{
                    maxWidth: '900px',
                    margin: '0 auto',
                    padding: '2rem 1.5rem'
                }}>
                    {/* Feature Cards */}
                        <div style={{
                            display: 'grid',
                            gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))',
                            gap: '1rem',
                        marginBottom: '2.5rem'
                    }}>
                        {[
                            {
                                icon: '🗳️',
                                title: 'Voting Power',
                                description: 'Hotkey your SNS neurons to gain voting power for posts and polls.',
                                color: forumPrimary
                            },
                            {
                                icon: '💬',
                                title: 'Direct Messages',
                                description: 'Send private messages for one-on-one conversations.',
                                color: theme.colors.success
                            },
                            {
                                icon: '🏛️',
                                title: 'Governance',
                                description: 'Discuss proposals and participate in democratic governance.',
                                color: '#9b59b6'
                            }
                        ].map((feature, idx) => (
                            <div 
                                key={idx}
                                className="forum-card-animate"
                                style={{
                                    background: theme.colors.secondaryBg,
                                    borderRadius: '16px',
                                    padding: '1.25rem',
                                    border: `1px solid ${theme.colors.border}`,
                                    animationDelay: `${idx * 0.1}s`,
                                    opacity: 0
                                }}
                            >
                            <div style={{
                                    fontSize: '1.5rem',
                                    marginBottom: '0.75rem'
                                }}>
                                    {feature.icon}
                            </div>
                                <h3 style={{
                                    color: feature.color,
                                    fontSize: '1rem',
                                    fontWeight: '600',
                                    marginBottom: '0.5rem'
                                }}>
                                    {feature.title}
                                </h3>
                                <p style={{
                                    color: theme.colors.mutedText,
                                    fontSize: '0.85rem',
                                    lineHeight: '1.5',
                                    margin: 0
                                }}>
                                    {feature.description}
                                </p>
                            </div>
                        ))}
                    </div>

                    {/* Topics Section */}
                        <div style={{
                        marginBottom: '2rem'
                    }}>
                        <h2 style={{
                            color: theme.colors.primaryText,
                            fontSize: '1.5rem',
                            fontWeight: '600',
                            marginBottom: '1.5rem',
                                display: 'flex', 
                                alignItems: 'center', 
                            gap: '0.75rem'
                            }}>
                            <span style={{
                                width: '36px',
                                height: '36px',
                                borderRadius: '10px',
                                background: `linear-gradient(135deg, ${forumPrimary}, ${forumSecondary})`,
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center'
                            }}>
                                <FaComments size={18} color="white" />
                            </span>
                            Discussion Topics
                        </h2>

                    {topicHierarchy.length > 0 ? (
                            <div style={{
                                display: 'flex',
                                flexDirection: 'column',
                                gap: '1rem'
                            }}>
                                {topicHierarchy.map((topic, index) => {
                                    const stats = topicStatistics.get(topic.id);
                                    const isHovered = hoveredCard === topic.id;
                                    
                                    return (
                                <Link
                                            key={topic.id}
                                            to={`/topic/${topic.id}`}
                                            className="forum-card-animate"
                                    style={{
                                                background: getTopicGradient(index),
                                                borderRadius: '16px',
                                                padding: '1.5rem',
                                                border: `1px solid ${isHovered ? forumPrimary : theme.colors.border}`,
                                                textDecoration: 'none',
                                                transition: 'all 0.3s ease',
                                                transform: isHovered ? 'translateY(-4px)' : 'translateY(0)',
                                                boxShadow: isHovered 
                                                    ? `0 12px 40px ${forumPrimary}25`
                                                    : '0 2px 10px rgba(0,0,0,0.1)',
                                                display: 'flex',
                                                alignItems: 'flex-start',
                                                gap: '1.25rem',
                                                animationDelay: `${index * 0.1}s`,
                                                opacity: 0
                                    }}
                                            onMouseEnter={() => setHoveredCard(topic.id)}
                                    onMouseLeave={() => setHoveredCard(null)}
                                >
                                            {/* Topic Icon */}
                                            <div style={{
                                                width: '52px',
                                                height: '52px',
                                                borderRadius: '14px',
                                                background: `linear-gradient(135deg, ${forumPrimary}30, ${forumSecondary}20)`,
                                                display: 'flex',
                                                alignItems: 'center',
                                                justifyContent: 'center',
                                                color: forumPrimary,
                                                flexShrink: 0,
                                                transition: 'all 0.3s ease',
                                                transform: isHovered ? 'scale(1.05)' : 'scale(1)'
                                            }}>
                                                {getTopicIcon(topic.title)}
                                            </div>

                                            {/* Topic Content */}
                                            <div style={{ flex: 1, minWidth: 0 }}>
                                            <div style={{
                                                display: 'flex',
                                                    alignItems: 'center',
                                                    gap: '0.75rem',
                                                    marginBottom: '0.5rem',
                                                    flexWrap: 'wrap'
                                                }}>
                                                    <h3 style={{
                                                        color: theme.colors.primaryText,
                                                        fontSize: '1.25rem',
                                                        fontWeight: '600',
                                                        margin: 0
                                                    }}>
                                                        {topic.title}
                                                    </h3>
                                                    {stats?.total_unread_posts > 0 && (
                                                    <span style={{
                                                            background: theme.colors.error,
                                                        color: 'white',
                                                            padding: '2px 8px',
                                                            borderRadius: '10px',
                                                        fontSize: '0.75rem',
                                                            fontWeight: '600'
                                                    }}>
                                                        {stats.total_unread_posts} new
                                                    </span>
                                                )}
                                            </div>
                                                
                                                <p style={{
                                                    color: theme.colors.secondaryText,
                                                    fontSize: '0.95rem',
                                                    lineHeight: '1.5',
                                                    margin: '0 0 0.75rem 0'
                                                }}>
                                                    {topic.description || 'Explore discussions in this topic'}
                                                </p>
                                                
                                                {/* Stats & Subtopics Row */}
                                                <div style={{
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    gap: '1rem',
                                                    flexWrap: 'wrap',
                                                    fontSize: '0.85rem',
                                                    color: theme.colors.mutedText
                                                }}>
                                                    {stats && (
                                                        <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                                            📋 {stats.thread_count} thread{stats.thread_count !== 1 ? 's' : ''}
                                                        </span>
                                                    )}
                                                        <span 
                                                        style={{ display: 'flex', alignItems: 'center', gap: '4px' }}
                                                        title={getFullDate(topic.created_at)}
                                                    >
                                                        <FaRegClock size={12} />
                                                        {getRelativeTime(topic.created_at)}
                                                    </span>
                                                    {topic.children.length > 0 && (
                                                        <span>{topic.children.length} subtopic{topic.children.length !== 1 ? 's' : ''}</span>
                                                    )}
                                                </div>
                                                
                                                {/* Subtopics */}
                                                {topic.children.length > 0 && (
                                                    <div style={{
                                                        marginTop: '0.75rem',
                                                        padding: '0.75rem',
                                                        background: theme.colors.primaryBg,
                                                        borderRadius: '8px',
                                                        border: `1px solid ${theme.colors.border}`
                                                    }}>
                                                        <div style={{
                                                            display: 'flex',
                                                            flexWrap: 'wrap',
                                                            gap: '0.5rem'
                                                        }}>
                                                            {topic.children.map((child) => {
                                                                const childStats = topicStatistics.get(child.id);
                                                                return (
                                                                    <span
                                                                        key={child.id}
                                                            onClick={(e) => {
                                                                e.preventDefault();
                                                                e.stopPropagation();
                                                                window.location.href = `/topic/${child.id}`;
                                                            }}
                                                                        style={{
                                                                            color: forumPrimary,
                                                                            fontSize: '0.85rem',
                                                                            cursor: 'pointer',
                                                                            padding: '4px 10px',
                                                                            background: `${forumPrimary}15`,
                                                                            borderRadius: '6px',
                                                                            display: 'flex',
                                                                            alignItems: 'center',
                                                                            gap: '4px',
                                                                            transition: 'all 0.2s ease'
                                                            }}
                                                        >
                                                            {child.title}
                                                                        {childStats?.total_unread_posts > 0 && (
                                                                        <span style={{
                                                                                background: theme.colors.error,
                                                                            color: 'white',
                                                                                padding: '1px 5px',
                                                                            borderRadius: '6px',
                                                                            fontSize: '0.7rem',
                                                                                fontWeight: '600'
                                                                        }}>
                                                                            {childStats.total_unread_posts}
                                                                        </span>
                                                                        )}
                                                        </span>
                                                                );
                                                            })}
                                                        </div>
                                        </div>
                                    )}
                                    </div>
                                            
                                            {/* Arrow */}
                                            <FaChevronRight 
                                                size={20} 
                                                style={{
                                                    color: isHovered ? forumPrimary : theme.colors.mutedText,
                                                    transition: 'all 0.3s ease',
                                                    transform: isHovered ? 'translateX(4px)' : 'translateX(0)',
                                                    flexShrink: 0
                                                }}
                                            />
                                </Link>
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
                                <div className="forum-float" style={{
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
                                    No topics available yet
                                </p>
                                <p style={{
                                    color: theme.colors.mutedText,
                                    fontSize: '0.95rem'
                                }}>
                                    Topics will be created automatically as the community grows.
                                </p>
                        </div>
                    )}
                    </div>

                    {/* Special Topic Prompts */}
                    {(showGeneralPrompt || showGovernancePrompt) && (
                        <div style={{
                            display: 'flex',
                            flexDirection: 'column',
                            gap: '1rem',
                            marginTop: '2rem'
                        }}>
                    {showGeneralPrompt && (
                                <div style={{
                                    background: `linear-gradient(135deg, ${theme.colors.secondaryBg} 0%, ${forumPrimary}10 100%)`,
                                    border: `1px solid ${forumPrimary}40`,
                                    borderRadius: '16px',
                                    padding: '1.5rem',
                                    textAlign: 'center'
                                }}>
                                    <h3 style={{
                                        color: forumPrimary,
                                        fontSize: '1.2rem',
                                        fontWeight: '600',
                                        marginBottom: '0.75rem'
                                    }}>
                                        💬 Create General Topic?
                                    </h3>
                                    <p style={{
                                        color: theme.colors.secondaryText,
                                        fontSize: '0.95rem',
                                        marginBottom: '1.25rem',
                                        lineHeight: '1.5'
                                    }}>
                                        This SNS doesn't have a "General" topic yet. Create one for general community discussions.
                            </p>
                                    <div style={{
                                        display: 'flex',
                                        gap: '0.75rem',
                                        justifyContent: 'center',
                                        flexWrap: 'wrap'
                                    }}>
                                <button 
                                    onClick={handleCreateGeneralTopic}
                                    disabled={creatingGeneral}
                                    style={{
                                                background: creatingGeneral 
                                                    ? theme.colors.mutedText 
                                                    : `linear-gradient(135deg, ${forumPrimary}, ${forumSecondary})`,
                                                color: 'white',
                                                border: 'none',
                                                borderRadius: '10px',
                                                padding: '0.75rem 1.5rem',
                                                fontSize: '0.95rem',
                                                fontWeight: '600',
                                                cursor: creatingGeneral ? 'not-allowed' : 'pointer',
                                                transition: 'all 0.3s ease'
                                    }}
                                >
                                    {creatingGeneral ? 'Creating...' : 'Create General Topic'}
                                </button>
                                <button 
                                    onClick={() => setShowGeneralPrompt(false)}
                                    disabled={creatingGeneral}
                                    style={{
                                                background: 'transparent',
                                                color: theme.colors.mutedText,
                                                border: `1px solid ${theme.colors.border}`,
                                                borderRadius: '10px',
                                                padding: '0.75rem 1.5rem',
                                                fontSize: '0.95rem',
                                                cursor: creatingGeneral ? 'not-allowed' : 'pointer',
                                                transition: 'all 0.3s ease'
                                    }}
                                >
                                    Maybe Later
                                </button>
                            </div>
                        </div>
                    )}

                    {showGovernancePrompt && (
                                <div style={{
                                    background: `linear-gradient(135deg, ${theme.colors.secondaryBg} 0%, #9b59b615 100%)`,
                                    border: `1px solid rgba(155, 89, 182, 0.4)`,
                                    borderRadius: '16px',
                                    padding: '1.5rem',
                                    textAlign: 'center'
                                }}>
                                    <h3 style={{
                                        color: '#9b59b6',
                                        fontSize: '1.2rem',
                                        fontWeight: '600',
                                        marginBottom: '0.75rem'
                                    }}>
                                        🏛️ Create Governance Topic?
                                    </h3>
                                    <p style={{
                                        color: theme.colors.secondaryText,
                                        fontSize: '0.95rem',
                                        marginBottom: '1.25rem',
                                        lineHeight: '1.5'
                                    }}>
                                        This SNS doesn't have a "Governance" topic yet. Create one for governance discussions and decision-making.
                            </p>
                                    <div style={{
                                        display: 'flex',
                                        gap: '0.75rem',
                                        justifyContent: 'center',
                                        flexWrap: 'wrap'
                                    }}>
                                <button 
                                    onClick={handleCreateGovernanceTopic}
                                    disabled={creatingGovernance}
                                    style={{
                                                background: creatingGovernance 
                                                    ? theme.colors.mutedText 
                                                    : 'linear-gradient(135deg, #9b59b6, #8e44ad)',
                                                color: 'white',
                                                border: 'none',
                                                borderRadius: '10px',
                                                padding: '0.75rem 1.5rem',
                                                fontSize: '0.95rem',
                                                fontWeight: '600',
                                                cursor: creatingGovernance ? 'not-allowed' : 'pointer',
                                                transition: 'all 0.3s ease'
                                    }}
                                >
                                    {creatingGovernance ? 'Creating...' : 'Create Governance Topic'}
                                </button>
                                <button 
                                    onClick={() => setShowGovernancePrompt(false)}
                                    disabled={creatingGovernance}
                                    style={{
                                                background: 'transparent',
                                                color: theme.colors.mutedText,
                                                border: `1px solid ${theme.colors.border}`,
                                                borderRadius: '10px',
                                                padding: '0.75rem 1.5rem',
                                                fontSize: '0.95rem',
                                                cursor: creatingGovernance ? 'not-allowed' : 'pointer',
                                                transition: 'all 0.3s ease'
                                    }}
                                >
                                    Maybe Later
                                </button>
                            </div>
                                </div>
                            )}
                        </div>
                    )}
                </div>
            </main>
        </div>
    );
}

export default Forum;
