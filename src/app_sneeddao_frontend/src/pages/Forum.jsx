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
            
            console.log('Forum response:', forumResponse);
            
            if (!forumResponse) {
                setError('This SNS does not have a forum yet. Forums are created automatically when needed.');
                return;
            }

            // Check if forum response has valid id
            if (forumResponse.id === undefined || forumResponse.id === null) {
                console.error('Forum response missing id:', forumResponse);
                setError('Invalid forum data received');
                return;
            }

            setForum(forumResponse);

            // Get topics for this forum
            console.log('Fetching topics for forum ID:', forumResponse.id);
            const topicsResponse = await forumActor.get_topics_by_forum(forumResponse.id);
            
            // Filter out deleted topics and only show root-level topics (no parent)
            const rootTopics = topicsResponse.filter(topic => !topic.deleted && !topic.parent_topic_id);
            setTopics(rootTopics);

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
                    {topics.length > 0 ? (
                        <div style={styles.topicsGrid}>
                            {topics.map((topic) => (
                                <Link
                                    key={topic.id}
                                    to={`/topic/${topic.id}`}
                                    style={{
                                        ...styles.topicCard,
                                        ...(hoveredCard === topic.id ? styles.topicCardHover : {})
                                    }}
                                    onMouseEnter={() => setHoveredCard(topic.id)}
                                    onMouseLeave={() => setHoveredCard(null)}
                                >
                                    <h3 style={styles.topicTitle}>{topic.title}</h3>
                                    <p style={styles.topicDescription}>
                                        {topic.description || 'No description available'}
                                    </p>
                                    <div style={styles.topicMeta}>
                                        <span>Created {formatDate(topic.created_at)}</span>
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
