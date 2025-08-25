import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Principal } from '@dfinity/principal';
import { useAuth } from '../AuthContext';
import { useSns } from '../contexts/SnsContext';
import Header from '../components/Header';
import { createActor, canisterId } from 'declarations/sneed_sns_forum';
import { formatError } from '../utils/errorUtils';
import { fetchSnsLogo, getAllSnses, getSnsById } from '../utils/SnsUtils';
import { HttpAgent } from '@dfinity/agent';

const styles = {
    container: {
        maxWidth: '1200px',
        margin: '0 auto',
        padding: '20px'
    },
    header: {
        marginBottom: '30px',
        textAlign: 'center'
    },
    title: {
        color: '#ffffff',
        fontSize: '2.5rem',
        marginBottom: '10px',
        fontWeight: '600'
    },
    description: {
        color: '#888',
        fontSize: '1.1rem',
        lineHeight: '1.6'
    },
    topicsGrid: {
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))',
        gap: '20px',
        marginTop: '30px'
    },
    topicCard: {
        backgroundColor: '#2a2a2a',
        borderRadius: '8px',
        padding: '20px',
        border: '1px solid #3a3a3a',
        transition: 'all 0.2s ease',
        cursor: 'pointer',
        textDecoration: 'none',
        color: 'inherit'
    },
    topicCardHover: {
        borderColor: '#3498db',
        transform: 'translateY(-2px)',
        boxShadow: '0 4px 12px rgba(52, 152, 219, 0.2)'
    },
    topicTitle: {
        color: '#ffffff',
        fontSize: '1.3rem',
        fontWeight: '500',
        marginBottom: '10px'
    },
    topicDescription: {
        color: '#ccc',
        fontSize: '0.95rem',
        lineHeight: '1.5',
        marginBottom: '15px'
    },
    topicMeta: {
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        fontSize: '0.85rem',
        color: '#888'
    },
    loading: {
        textAlign: 'center',
        color: '#888',
        fontSize: '1.1rem',
        padding: '40px'
    },
    error: {
        backgroundColor: 'rgba(231, 76, 60, 0.2)',
        border: '1px solid #e74c3c',
        color: '#e74c3c',
        padding: '15px',
        borderRadius: '6px',
        marginBottom: '20px',
        textAlign: 'center'
    },
    subtopicsList: {
        marginBottom: '12px',
        padding: '10px',
        backgroundColor: '#1a1a1a',
        borderRadius: '4px',
        border: '1px solid #333'
    },
    subtopicsText: {
        color: '#ccc',
        fontSize: '0.9rem',
        lineHeight: '1.4'
    },
    subtopicLink: {
        color: '#3498db',
        cursor: 'pointer',
        textDecoration: 'none',
        transition: 'color 0.2s ease',
        ':hover': {
            color: '#5dade2',
            textDecoration: 'underline'
        }
    },
    noTopics: {
        textAlign: 'center',
        color: '#888',
        fontSize: '1.1rem',
        padding: '40px',
        backgroundColor: '#2a2a2a',
        borderRadius: '8px',
        border: '1px solid #3a3a3a'
    },
    noForumContainer: {
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        minHeight: '60vh',
        padding: '40px'
    },
    noForumContent: {
        textAlign: 'center',
        backgroundColor: '#2a2a2a',
        borderRadius: '12px',
        padding: '40px',
        border: '1px solid #3a3a3a',
        maxWidth: '500px',
        boxShadow: '0 4px 12px rgba(0, 0, 0, 0.1)'
    },
    noForumTitle: {
        color: '#ffffff',
        fontSize: '2rem',
        fontWeight: '600',
        marginBottom: '20px'
    },
    noForumMessage: {
        color: '#ccc',
        fontSize: '1.1rem',
        marginBottom: '15px',
        lineHeight: '1.5'
    },
    noForumDescription: {
        color: '#888',
        fontSize: '0.95rem',
        marginBottom: '30px',
        lineHeight: '1.4'
    },
    createForumButton: {
        backgroundColor: '#3498db',
        color: '#ffffff',
        border: 'none',
        borderRadius: '8px',
        padding: '14px 28px',
        fontSize: '1rem',
        fontWeight: '600',
        cursor: 'pointer',
        transition: 'all 0.2s ease',
        boxShadow: '0 2px 8px rgba(52, 152, 219, 0.3)'
    },
    createForumButtonDisabled: {
        backgroundColor: '#555',
        cursor: 'not-allowed',
        opacity: 0.6,
        boxShadow: 'none'
    },
    generalPrompt: {
        backgroundColor: '#2a2a2a',
        border: '1px solid #3498db',
        borderRadius: '8px',
        padding: '20px',
        marginTop: '40px',
        marginBottom: '30px',
        textAlign: 'center'
    },
    generalPromptTitle: {
        color: '#3498db',
        fontSize: '1.3rem',
        fontWeight: '600',
        marginBottom: '10px'
    },
    generalPromptMessage: {
        color: '#ccc',
        fontSize: '1rem',
        marginBottom: '20px',
        lineHeight: '1.5'
    },
    generalPromptButtons: {
        display: 'flex',
        gap: '15px',
        justifyContent: 'center',
        alignItems: 'center'
    },
    createGeneralButton: {
        backgroundColor: '#3498db',
        color: '#ffffff',
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
        color: '#888',
        border: '1px solid #555',
        borderRadius: '6px',
        padding: '10px 20px',
        fontSize: '0.95rem',
        cursor: 'pointer',
        transition: 'all 0.2s ease'
    },
    buttonDisabled: {
        opacity: 0.6,
        cursor: 'not-allowed'
    },
    forumHeader: {
        backgroundColor: '#2a2a2a',
        borderRadius: '12px',
        padding: '24px',
        marginBottom: '24px',
        border: '1px solid #3a3a3a',
        display: 'flex',
        alignItems: 'center',
        gap: '20px',
        boxShadow: '0 2px 8px rgba(0, 0, 0, 0.1)'
    },
    forumLogo: {
        width: '64px',
        height: '64px',
        borderRadius: '50%',
        objectFit: 'cover',
        border: '2px solid #3a3a3a',
        flexShrink: 0
    },
    forumLogoPlaceholder: {
        width: '64px',
        height: '64px',
        borderRadius: '50%',
        backgroundColor: '#4a4a4a',
        border: '2px solid #3a3a3a',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: '1.2rem',
        color: '#888',
        fontWeight: '600',
        flexShrink: 0
    },
    forumHeaderContent: {
        flex: 1,
        minWidth: 0
    },
    forumHeaderTitle: {
        color: '#ffffff',
        fontSize: '2rem',
        fontWeight: '600',
        marginBottom: '8px',
        lineHeight: '1.2'
    },
    forumHeaderDescription: {
        color: '#ccc',
        fontSize: '1rem',
        lineHeight: '1.5',
        marginBottom: '0'
    }
};

function Forum() {
    const { identity } = useAuth();
    const { selectedSnsRoot } = useSns();
    const [forum, setForum] = useState(null);
    const [topics, setTopics] = useState([]);
    const [topicHierarchy, setTopicHierarchy] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [creatingForum, setCreatingForum] = useState(false);
    const [hoveredCard, setHoveredCard] = useState(null);
    const [showGeneralPrompt, setShowGeneralPrompt] = useState(false);
    const [topicStatistics, setTopicStatistics] = useState(new Map()); // topicId -> {thread_count, total_unread_posts}
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

        // Reset logo state when SNS changes
        setSnsLogo(null);
        setLoadingLogo(false);
        setSnsInfo(null);

        try {
            // Get SNS info from cache
            const allSnses = getAllSnses();
            const currentSnsInfo = allSnses.find(sns => sns.rootCanisterId === selectedSnsRoot);
            
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
                    host: process.env.DFX_NETWORK === 'ic' ? 'https://icp0.io' : 'http://localhost:4943',
                    identity: identity,
                },
            });

            const snsRootPrincipal = Principal.fromText(selectedSnsRoot);
            const result = await forumActor.create_special_topic({
                sns_root_canister_id: snsRootPrincipal,
                special_topic_type: { 'General': null }
            });

            if ('ok' in result) {
                console.log('General topic created successfully, topic ID:', result.ok);
                setShowGeneralPrompt(false);
                // Refresh the forum data to show the new topic
                await fetchForumData();
            } else {
                console.error('Error creating General topic:', result.err);
                setError('Failed to create General topic: ' + formatError(result.err));
            }
        } catch (err) {
            console.error('Error creating General topic:', err);
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
                    host: process.env.DFX_NETWORK === 'ic' ? 'https://icp0.io' : 'http://localhost:4943',
                    identity: identity,
                },
            });

            const snsRootPrincipal = Principal.fromText(selectedSnsRoot);
            const result = await forumActor.create_special_topic({
                sns_root_canister_id: snsRootPrincipal,
                special_topic_type: { 'Governance': null }
            });

            if ('ok' in result) {
                console.log('Governance topic created successfully, topic ID:', result.ok);
                setShowGovernancePrompt(false);
                // Refresh the forum data to show the new topic
                await fetchForumData();
            } else {
                console.error('Error creating Governance topic:', result.err);
                setError('Failed to create Governance topic: ' + formatError(result.err));
            }
        } catch (err) {
            console.error('Error creating Governance topic:', err);
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
                    host: process.env.DFX_NETWORK === 'ic' ? 'https://icp0.io' : 'http://localhost:4943',
                    identity: identity,
                },
            });

            const snsRootPrincipal = Principal.fromText(selectedSnsRoot);
            const result = await forumActor.create_sns_forum_setup(snsRootPrincipal);

            if ('ok' in result) {
                console.log('Forum created successfully, proposals topic ID:', result.ok);
                // Refresh the forum data
                setError(null);
                setLoading(true);
                // Re-fetch forum data to show the newly created forum
                const forumResponse = await forumActor.get_forum_by_sns_root(snsRootPrincipal);
                if (forumResponse && forumResponse.length > 0) {
                    const forum = forumResponse[0];
                    setForum(forum);
                    
                    // Fetch topics for the new forum
                    const forumIdNumber = typeof forum.id === 'bigint' ? Number(forum.id) : forum.id;
                    const topicsResponse = await forumActor.get_topics_by_forum(forumIdNumber);
                    
                    if (topicsResponse) {
                        setTopics(topicsResponse);
                        
                        // Build topic hierarchy
                        const hierarchy = buildTopicHierarchy(topicsResponse);
                        setTopicHierarchy(hierarchy);
                    }
                }
            } else {
                console.error('Error creating forum:', result.err);
                setError('Failed to create forum: ' + formatError(result.err));
            }
        } catch (err) {
            console.error('Error creating forum:', err);
            setError('Failed to create forum: ' + err.message);
        } finally {
            setCreatingForum(false);
            setLoading(false);
        }
    };

    // Helper function to extract all topic IDs from hierarchy
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

    // Fetch topic statistics (async, non-blocking)
    const fetchTopicStatistics = async (topicIds, actor) => {
        if (!actor || !identity || topicIds.length === 0) return;
        
        // Fetch statistics for all topics in parallel
        const statisticsPromises = topicIds.map(async (topicId) => {
            try {
                const stats = await actor.get_topic_statistics(topicId);
                return { topicId, stats };
            } catch (error) {
                console.warn(`Failed to fetch statistics for topic ${topicId}:`, error);
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

            // Create forum actor
            const forumActor = createActor(canisterId, {
                agentOptions: {
                    host: process.env.DFX_NETWORK === 'ic' ? 'https://icp0.io' : 'http://localhost:4943',
                    identity: identity || undefined,
                },
            });

            // Get forum by SNS root - convert string to Principal
            const snsRootPrincipal = Principal.fromText(selectedSnsRoot);
            const forumResponse = await forumActor.get_forum_by_sns_root(snsRootPrincipal);
            
            // Motoko optionals are serialized as arrays: [] for null, [value] for Some(value)
            if (!forumResponse || forumResponse.length === 0) {
                setError('NO_FORUM'); // Special error code to show create forum UI
                return;
            }

            const forum = forumResponse[0];
            setForum(forum);

            // Get topics for this forum
            console.log('Forum ID raw:', forum.id);
            console.log('Forum ID type:', typeof forum.id);
            const forumIdNumber = typeof forum.id === 'bigint' ? Number(forum.id) : forum.id;
            console.log('Calling get_topics_by_forum with forum ID:', forumIdNumber);
            const topicsResponse = await forumActor.get_topics_by_forum(forumIdNumber);
            console.log('Topics response:', topicsResponse);
            console.log('Topics response length:', topicsResponse?.length);
            
            // Build topic hierarchy using the shared function
            const hierarchyTopics = buildTopicHierarchy(topicsResponse);
            console.log('Hierarchical topics:', hierarchyTopics);
            
            // Extract root topics for backward compatibility
            const rootTopics = hierarchyTopics.map(topic => ({ ...topic, children: undefined }));
            setTopics(rootTopics);
            setTopicHierarchy(hierarchyTopics);

            // Fetch topic statistics asynchronously (non-blocking)
            const allTopicIds = getAllTopicIds(hierarchyTopics);
            if (allTopicIds.length > 0) {
                fetchTopicStatistics(allTopicIds, forumActor);
            }

            // Check if General and Governance topics exist and show prompts if not
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
        // Filter only active (non-deleted) topics
        const activeTopics = topics.filter(topic => !topic.deleted);
        
        // Separate root and child topics
        const rootTopics = [];
        const childTopicsMap = new Map();
        
        activeTopics.forEach(topic => {
            const isRootLevel = !topic.parent_topic_id || topic.parent_topic_id.length === 0;
            
            if (isRootLevel) {
                rootTopics.push({ ...topic, children: [] });
            } else {
                // It's a child topic
                const parentId = topic.parent_topic_id[0]; // Get parent ID from array
                const parentIdStr = parentId.toString(); // Convert BigInt to string for Map key
                
                if (!childTopicsMap.has(parentIdStr)) {
                    childTopicsMap.set(parentIdStr, []);
                }
                childTopicsMap.get(parentIdStr).push(topic);
            }
        });
        
        // Add children to their parent topics
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

    if (loading) {
        return (
            <div className='page-container'>
                <Header showSnsDropdown={true} />
                <main className="wallet-container">
                    <div style={styles.loading}>Loading forum...</div>
                </main>
            </div>
        );
    }

    if (error) {
        if (error === 'NO_FORUM') {
            return (
                <div className='page-container'>
                    <Header showSnsDropdown={true} />
                    <main className="wallet-container">
                        <div style={styles.noForumContainer}>
                            <div style={styles.noForumContent}>
                                <h1 style={styles.noForumTitle}>Forum Not Available</h1>
                                <p style={styles.noForumMessage}>
                                    This SNS doesn't have a forum yet. Would you like to create one?
                                </p>
                                <p style={styles.noForumDescription}>
                                    Creating a forum will set up discussion spaces for governance topics and proposals.
                                </p>
                                <button 
                                    onClick={handleCreateForum}
                                    disabled={creatingForum}
                                    style={{
                                        ...styles.createForumButton,
                                        ...(creatingForum ? styles.createForumButtonDisabled : {})
                                    }}
                                >
                                    {creatingForum ? 'Creating Forum...' : 'Create Forum'}
                                </button>
                            </div>
                        </div>
                    </main>
                </div>
            );
        }
        
        return (
            <div className='page-container'>
                <Header showSnsDropdown={true} />
                <main className="wallet-container">
                    <div style={styles.error}>{error}</div>
                </main>
            </div>
        );
    }

    return (
        <div className='page-container'>
            <Header showSnsDropdown={true} />
            
            {/* Header-like Forum Section - Looks like part of header but scrolls with page */}
            {forum && (
                <div style={{
                    backgroundColor: '#1a1a1a', // Match header background
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
                                backgroundColor: '#4a4a4a',
                                border: '2px solid #3a3a3a',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                fontSize: '0.8rem',
                                color: '#888',
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
                                    border: '2px solid #3a3a3a'
                                }}
                            />
                        ) : (
                            <div style={{
                                width: '32px',
                                height: '32px',
                                borderRadius: '50%',
                                backgroundColor: '#4a4a4a',
                                border: '2px solid #3a3a3a',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                fontSize: '0.8rem',
                                color: '#888',
                                fontWeight: '600'
                            }}>
                                {snsInfo?.name?.substring(0, 2).toUpperCase() || 'SNS'}
                            </div>
                        )}
                        
                        {/* Forum Title */}
                        <h1 style={{
                            color: '#ffffff',
                            fontSize: '1.5rem',
                            fontWeight: '600',
                            margin: 0,
                            flex: 1
                        }}>
                            {snsInfo?.name ? `${snsInfo.name} Forum` : (forum.title || 'Forum')}
                        </h1>
                    </div>
                </div>
            )}
            
            <main className="wallet-container">
                <div style={styles.container}>
                    {/* Welcome Section */}
                    <div style={{
                        backgroundColor: '#2a2a2a',
                        borderRadius: '12px',
                        padding: '2rem',
                        marginBottom: '2rem',
                        border: '1px solid #4a4a4a',
                        textAlign: 'center'
                    }}>
                        <h1 style={{
                            fontSize: '2.5rem',
                            color: '#ffffff',
                            marginBottom: '1rem',
                            fontWeight: 'bold'
                        }}>
                            Welcome to the Sneed Hub SNS Forum
                        </h1>
                        <p style={{
                            color: '#ccc',
                            fontSize: '1.1rem',
                            lineHeight: '1.6',
                            maxWidth: '800px',
                            margin: '0 auto 1rem auto'
                        }}>
                            This is your community space for discussions, governance participation, and connecting with other members. 
                            Use the SNS dropdown in the header above to select which SNS forum you want to explore.
                        </p>
                        
                        {!identity && (
                            <p style={{
                                color: '#f39c12',
                                fontSize: '1rem',
                                lineHeight: '1.6',
                                maxWidth: '800px',
                                margin: '0 auto 1rem auto',
                                backgroundColor: 'rgba(243, 156, 18, 0.1)',
                                padding: '0.75rem',
                                borderRadius: '6px',
                                border: '1px solid rgba(243, 156, 18, 0.3)'
                            }}>
                                📝 <strong>Please log in to participate:</strong> You need to be logged in to create posts, comment, and vote.
                            </p>
                        )}
                        
                        <div style={{
                            display: 'grid',
                            gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))',
                            gap: '1rem',
                            marginTop: '1.5rem',
                            textAlign: 'left'
                        }}>
                            <div style={{
                                backgroundColor: '#3a3a3a',
                                padding: '1rem',
                                borderRadius: '8px',
                                border: '1px solid #4a4a4a'
                            }}>
                                <h3 style={{ color: '#3498db', marginBottom: '0.5rem', fontSize: '1.1rem' }}>🗳️ Voting Power</h3>
                                <p style={{ color: '#ccc', fontSize: '0.9rem', lineHeight: '1.4', margin: 0 }}>
                                    Hotkey your SNS neurons to gain voting power for upvoting/downvoting posts and participating in polls.
                                </p>
                            </div>
                            
                            <div style={{
                                backgroundColor: '#3a3a3a',
                                padding: '1rem',
                                borderRadius: '8px',
                                border: '1px solid #4a4a4a'
                            }}>
                                <h3 style={{ color: '#27ae60', marginBottom: '0.5rem', fontSize: '1.1rem' }}>💬 Direct Messages</h3>
                                <p style={{ color: '#ccc', fontSize: '0.9rem', lineHeight: '1.4', margin: 0 }}>
                                    Send private messages to other users to have one-on-one conversations.
                                </p>
                            </div>
                            
                            <div style={{
                                backgroundColor: '#3a3a3a',
                                padding: '1rem',
                                borderRadius: '8px',
                                border: '1px solid #4a4a4a'
                            }}>
                                <h3 style={{ color: '#9b59b6', marginBottom: '0.5rem', fontSize: '1.1rem' }}>🏛️ Governance</h3>
                                <p style={{ color: '#ccc', fontSize: '0.9rem', lineHeight: '1.4', margin: 0 }}>
                                    Discuss proposals, share insights, and participate in the democratic governance of your chosen SNS.
                                </p>
                            </div>
                        </div>
                    </div>

                    {/* Forum Header Section - Updated to match welcome design */}
                    {forum && (
                        <div style={{
                            backgroundColor: '#2a2a2a',
                            borderRadius: '12px',
                            padding: '2rem',
                            marginBottom: '2rem',
                            border: '1px solid #4a4a4a'
                        }}>
                            {/* Top row: Logo and Title */}
                            <div style={{ 
                                display: 'flex', 
                                alignItems: 'center', 
                                gap: '20px', 
                                marginBottom: '1rem'
                            }}>
                                {/* SNS Logo */}
                                <div style={{ flexShrink: 0 }}>
                                    {loadingLogo ? (
                                        <div style={styles.forumLogoPlaceholder}>
                                            ...
                                        </div>
                                    ) : snsLogo ? (
                                        <img
                                            src={snsLogo}
                                            alt={snsInfo?.name || 'SNS Logo'}
                                            style={styles.forumLogo}
                                        />
                                    ) : (
                                        <div style={styles.forumLogoPlaceholder}>
                                            {snsInfo?.name?.substring(0, 2).toUpperCase() || 'SNS'}
                                        </div>
                                    )}
                                </div>
                                
                                {/* Forum Title */}
                                <h1 style={{
                                    fontSize: '2.5rem',
                                    color: '#ffffff',
                                    margin: '0',
                                    fontWeight: 'bold',
                                    lineHeight: '1.2',
                                    flex: 1
                                }}>
                                    {snsInfo?.name ? `${snsInfo.name} Forum` : (forum.title || 'Forum')}
                                </h1>
                            </div>
                            
                            {/* Forum Description - Full width below */}
                            <p style={{
                                color: '#ccc',
                                fontSize: '1.1rem',
                                lineHeight: '1.6',
                                margin: '0',
                                textAlign: 'left'
                            }}>
                                Discussion forum for {snsInfo?.name || 'SNS'} governance and community topics
                            </p>
                        </div>
                    )}



                    {/* Topics Grid */}
                    {topicHierarchy.length > 0 ? (
                        <div style={styles.topicsGrid}>
                            {topicHierarchy.map((rootTopic) => (
                                <Link
                                    key={rootTopic.id}
                                    to={`/topic/${rootTopic.id}`}
                                    style={{
                                        ...styles.topicCard,
                                        ...(hoveredCard === rootTopic.id ? styles.topicCardHover : {})
                                    }}
                                    onMouseEnter={() => setHoveredCard(rootTopic.id)}
                                    onMouseLeave={() => setHoveredCard(null)}
                                >
                                    <h3 style={styles.topicTitle}>{rootTopic.title}</h3>
                                    <p style={styles.topicDescription}>
                                        {rootTopic.description || 'No description available'}
                                    </p>

                                    {/* Topic Statistics */}
                                    {(() => {
                                        const stats = topicStatistics.get(rootTopic.id);
                                        return stats ? (
                                            <div style={{
                                                display: 'flex',
                                                gap: '12px',
                                                marginTop: '12px',
                                                fontSize: '0.85rem',
                                                color: '#888'
                                            }}>
                                                <span>📋 {stats.thread_count} thread{stats.thread_count !== 1 ? 's' : ''}</span>
                                                {stats.total_unread_posts > 0 && (
                                                    <span style={{
                                                        backgroundColor: '#e74c3c',
                                                        color: 'white',
                                                        padding: '2px 6px',
                                                        borderRadius: '8px',
                                                        fontSize: '0.75rem',
                                                        fontWeight: 'bold'
                                                    }}>
                                                        {stats.total_unread_posts} new
                                                    </span>
                                                )}
                                            </div>
                                        ) : null;
                                    })()}
                                    
                                    {/* Subtopics List */}
                                    {rootTopic.children.length > 0 && (
                                        <div style={styles.subtopicsList}>
                                            <span style={styles.subtopicsText}>
                                                {rootTopic.children.map((child, index) => (
                                                    <span key={child.id}>
                                                        <span 
                                                            style={styles.subtopicLink}
                                                            onClick={(e) => {
                                                                e.preventDefault();
                                                                e.stopPropagation();
                                                                window.location.href = `/topic/${child.id}`;
                                                            }}
                                                        >
                                                            {child.title}
                                                            {(() => {
                                                                const childStats = topicStatistics.get(child.id);
                                                                if (childStats && childStats.total_unread_posts > 0) {
                                                                    return (
                                                                        <span style={{
                                                                            marginLeft: '4px',
                                                                            backgroundColor: '#e74c3c',
                                                                            color: 'white',
                                                                            padding: '1px 4px',
                                                                            borderRadius: '6px',
                                                                            fontSize: '0.7rem',
                                                                            fontWeight: 'bold'
                                                                        }}>
                                                                            {childStats.total_unread_posts}
                                                                        </span>
                                                                    );
                                                                }
                                                                return null;
                                                            })()}
                                                        </span>
                                                        {index < rootTopic.children.length - 1 && ', '}
                                                    </span>
                                                ))}
                                            </span>
                                        </div>
                                    )}
                                    
                                    <div style={styles.topicMeta}>
                                        <span>Created {formatDate(rootTopic.created_at)}</span>
                                        {rootTopic.children.length > 0 && (
                                            <span>{rootTopic.children.length} subtopic{rootTopic.children.length !== 1 ? 's' : ''}</span>
                                        )}
                                        <span>→</span>
                                    </div>
                                </Link>
                            ))}
                        </div>
                    ) : (
                        <div style={styles.noTopics}>
                            <p>No topics available in this forum yet.</p>
                            <p>Topics will be created automatically as the community grows.</p>
                        </div>
                    )}

                    {/* Special Topic Prompts */}
                    {showGeneralPrompt && (
                        <div style={styles.generalPrompt}>
                            <h3 style={styles.generalPromptTitle}>Create General Topic?</h3>
                            <p style={styles.generalPromptMessage}>
                                This SNS does not have a "General" topic yet. Would you like to create it? 
                                This will provide a space for general community discussions.
                            </p>
                            <div style={styles.generalPromptButtons}>
                                <button 
                                    onClick={handleCreateGeneralTopic}
                                    disabled={creatingGeneral}
                                    style={{
                                        ...styles.createGeneralButton,
                                        ...(creatingGeneral ? styles.buttonDisabled : {})
                                    }}
                                >
                                    {creatingGeneral ? 'Creating...' : 'Create General Topic'}
                                </button>
                                <button 
                                    onClick={() => setShowGeneralPrompt(false)}
                                    disabled={creatingGeneral}
                                    style={{
                                        ...styles.dismissButton,
                                        ...(creatingGeneral ? styles.buttonDisabled : {})
                                    }}
                                >
                                    Maybe Later
                                </button>
                            </div>
                        </div>
                    )}

                    {showGovernancePrompt && (
                        <div style={styles.generalPrompt}>
                            <h3 style={styles.generalPromptTitle}>Create Governance Topic?</h3>
                            <p style={styles.generalPromptMessage}>
                                This SNS does not have a "Governance" topic yet. Would you like to create it? 
                                This will provide a space for governance discussions and decision-making.
                            </p>
                            <div style={styles.generalPromptButtons}>
                                <button 
                                    onClick={handleCreateGovernanceTopic}
                                    disabled={creatingGovernance}
                                    style={{
                                        ...styles.createGeneralButton,
                                        ...(creatingGovernance ? styles.buttonDisabled : {})
                                    }}
                                >
                                    {creatingGovernance ? 'Creating...' : 'Create Governance Topic'}
                                </button>
                                <button 
                                    onClick={() => setShowGovernancePrompt(false)}
                                    disabled={creatingGovernance}
                                    style={{
                                        ...styles.dismissButton,
                                        ...(creatingGovernance ? styles.buttonDisabled : {})
                                    }}
                                >
                                    Maybe Later
                                </button>
                            </div>
                        </div>
                    )}
                </div>
            </main>
        </div>
    );
}

export default Forum;
