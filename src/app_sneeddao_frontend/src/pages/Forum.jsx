import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Principal } from '@dfinity/principal';
import { useAuth } from '../AuthContext';
import { useSns } from '../contexts/SnsContext';
import Header from '../components/Header';
import { createActor, canisterId } from 'declarations/sneed_sns_forum';

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
    subtopicsLabel: {
        color: '#888',
        fontSize: '0.9rem',
        fontWeight: '500'
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
    const [hoveredCard, setHoveredCard] = useState(null);

    useEffect(() => {
        if (!selectedSnsRoot) {
            setError('No SNS selected');
            setLoading(false);
            return;
        }

        fetchForumData();
    }, [selectedSnsRoot, identity]);

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
                setError('This SNS does not have a forum yet. Forums are created automatically when needed.');
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
            
            // Filter out deleted topics and organize into hierarchy
            // Note: parent_topic_id is a Motoko optional, so null = [], Some(value) = [value]
            const activeTopics = topicsResponse.filter(topic => !topic.deleted);
            console.log('Active topics:', activeTopics);
            
            // Separate root and child topics
            const rootTopics = [];
            const childTopicsMap = new Map();
            
            activeTopics.forEach(topic => {
                const isRootLevel = !topic.parent_topic_id || topic.parent_topic_id.length === 0;
                console.log(`Topic "${topic.title}": deleted=${topic.deleted}, parent_topic_id=`, topic.parent_topic_id, `isRootLevel=${isRootLevel}`);
                
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
            
            console.log('Hierarchical topics:', hierarchyTopics);
            setTopics(rootTopics); // Keep for backward compatibility
            setTopicHierarchy(hierarchyTopics);

        } catch (err) {
            console.error('Error fetching forum data:', err);
            setError('Failed to load forum data');
        } finally {
            setLoading(false);
        }
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
            <main className="wallet-container">
                <div style={styles.container}>
                    {/* Forum Header */}
                    <div style={styles.header}>
                        <h1 style={styles.title}>{forum?.title || 'Forum'}</h1>
                        <p style={styles.description}>
                            {forum?.description || 'Community discussion and governance topics'}
                        </p>
                    </div>

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
                                    
                                    {/* Subtopics List */}
                                    {rootTopic.children.length > 0 && (
                                        <div style={styles.subtopicsList}>
                                            <span style={styles.subtopicsLabel}>Subtopics: </span>
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
                </div>
            </main>
        </div>
    );
}

export default Forum;
