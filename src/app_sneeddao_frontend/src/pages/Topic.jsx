import React, { useState, useEffect } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { Principal } from '@dfinity/principal';
import { useAuth } from '../AuthContext';
import { useSns } from '../contexts/SnsContext';
import Header from '../components/Header';
import { createActor, canisterId } from 'declarations/sneed_sns_forum';
import { useTextLimits } from '../hooks/useTextLimits';

const styles = {
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
        color: '#3498db',
        textDecoration: 'none'
    },
    breadcrumbSeparator: {
        color: '#888',
        margin: '0 8px'
    },
    currentPage: {
        color: '#ccc'
    },
    header: {
        marginBottom: '30px'
    },
    title: {
        color: '#ffffff',
        fontSize: '2.2rem',
        marginBottom: '10px',
        fontWeight: '600'
    },
    description: {
        color: '#ccc',
        fontSize: '1.1rem',
        lineHeight: '1.6',
        marginBottom: '20px'
    },
    meta: {
        color: '#888',
        fontSize: '0.9rem'
    },
    section: {
        marginBottom: '40px'
    },
    sectionTitle: {
        color: '#ffffff',
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
        backgroundColor: '#2a2a2a',
        borderRadius: '6px',
        padding: '15px',
        border: '1px solid #3a3a3a',
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
        color: '#ffffff',
        fontSize: '1.1rem',
        fontWeight: '500',
        marginBottom: '8px'
    },
    subtopicDescription: {
        color: '#ccc',
        fontSize: '0.9rem',
        lineHeight: '1.4'
    },
    threadsContainer: {
        backgroundColor: '#2a2a2a',
        borderRadius: '8px',
        border: '1px solid #3a3a3a',
        overflow: 'hidden'
    },
    threadItem: {
        padding: '20px',
        borderBottom: '1px solid #3a3a3a',
        transition: 'background-color 0.2s ease',
        cursor: 'pointer'
    },
    threadItemHover: {
        backgroundColor: '#333'
    },
    threadTitle: {
        color: '#ffffff',
        fontSize: '1.1rem',
        fontWeight: '500',
        marginBottom: '8px'
    },
    threadBody: {
        color: '#ccc',
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
        color: '#ffffff',
        border: 'none',
        borderRadius: '4px',
        padding: '8px 12px',
        cursor: 'pointer',
        fontSize: '0.9rem',
        transition: 'background-color 0.2s ease'
    },
    pageButtonDisabled: {
        backgroundColor: '#555',
        cursor: 'not-allowed',
        opacity: 0.6
    },
    pageInfo: {
        color: '#ccc',
        fontSize: '0.9rem'
    },
    createThreadSection: {
        backgroundColor: '#2a2a2a',
        borderRadius: '8px',
        padding: '25px',
        border: '1px solid #3a3a3a',
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
        backgroundColor: '#1a1a1a',
        border: '1px solid #4a4a4a',
        borderRadius: '6px',
        padding: '14px 16px',
        color: '#ffffff',
        fontSize: '1rem',
        transition: 'border-color 0.2s ease, box-shadow 0.2s ease',
        fontFamily: 'inherit',
        width: '100%',
        boxSizing: 'border-box',
        display: 'block'
    },
    threadBodyTextarea: {
        backgroundColor: '#1a1a1a',
        border: '1px solid #4a4a4a',
        borderRadius: '6px',
        padding: '14px 16px',
        color: '#ffffff',
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
        color: '#ffffff',
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
        backgroundColor: '#555',
        cursor: 'not-allowed',
        opacity: 0.6,
        transform: 'none',
        boxShadow: 'none'
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
    noContent: {
        textAlign: 'center',
        color: '#888',
        fontSize: '1rem',
        padding: '30px'
    }
};

const THREADS_PER_PAGE = 10;

function Topic() {
    const { topicId } = useParams();
    const { identity } = useAuth();
    const { selectedSnsRoot } = useSns();
    const navigate = useNavigate();
    const [topic, setTopic] = useState(null);
    const [subtopics, setSubtopics] = useState([]);
    const [threads, setThreads] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [hoveredCard, setHoveredCard] = useState(null);
    const [hoveredThread, setHoveredThread] = useState(null);
    const [currentPage, setCurrentPage] = useState(0);
    const [totalThreads, setTotalThreads] = useState(0);
    const [createThreadTitle, setCreateThreadTitle] = useState('');
    const [createThreadBody, setCreateThreadBody] = useState('');
    const [submitting, setSubmitting] = useState(false);
    
    // Get forum actor for text limits
    const forumActor = identity ? createActor(canisterId, {
        agentOptions: {
            host: process.env.DFX_NETWORK === 'ic' ? 'https://icp0.io' : 'http://localhost:4943',
            identity: identity,
        },
    }) : null;
    
    // Get text limits
    const { textLimits } = useTextLimits(forumActor);

    useEffect(() => {
        if (!topicId) {
            setError('Invalid topic ID');
            setLoading(false);
            return;
        }

        fetchTopicData();
    }, [topicId, identity, currentPage]);

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

            // Get threads for this topic
            const threadsResponse = await forumActor.get_threads_by_topic(parseInt(topicId));
            
            if (threadsResponse) {
                // Filter out deleted threads
                const activeThreads = threadsResponse.filter(thread => !thread.deleted);
                
                // Sort by created_at descending (newest first)
                activeThreads.sort((a, b) => Number(b.created_at - a.created_at));
                
                // Apply pagination on the frontend
                const startIndex = currentPage * THREADS_PER_PAGE;
                const endIndex = startIndex + THREADS_PER_PAGE;
                const paginatedThreads = activeThreads.slice(startIndex, endIndex);
                
                setThreads(paginatedThreads);
                setTotalThreads(activeThreads.length);
            } else {
                setThreads([]);
                setTotalThreads(0);
            }

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

        try {
            setSubmitting(true);
            setError(null);

            const forumActor = createActor(canisterId, {
                agentOptions: {
                    host: process.env.DFX_NETWORK === 'ic' ? 'https://icp0.io' : 'http://localhost:4943',
                    identity: identity,
                },
            });

            const result = await forumActor.create_thread({
                topic_id: parseInt(topicId),
                title: [createThreadTitle.trim()], // Motoko optional: Some(value) = [value]
                body: createThreadBody.trim()
            });

            if ('ok' in result) {
                // Clear form
                setCreateThreadTitle('');
                setCreateThreadBody('');
                
                // Navigate to the new thread
                const newThreadId = result.ok.toString();
                navigate(`/thread?threadid=${newThreadId}`);
            } else {
                setError('Failed to create thread: ' + (result.err || 'Unknown error'));
            }

        } catch (err) {
            console.error('Error creating thread:', err);
            setError('Failed to create thread');
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

    const totalPages = Math.ceil(totalThreads / THREADS_PER_PAGE);

    if (loading) {
        return (
            <div className='page-container'>
                <Header showSnsDropdown={true} />
                <main className="wallet-container">
                    <div style={styles.loading}>Loading topic...</div>
                </main>
            </div>
        );
    }

    if (error && !topic) {
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
                    {/* Breadcrumb */}
                    <div style={styles.breadcrumb}>
                        <Link to="/forum" style={styles.breadcrumbLink}>Forum</Link>
                        <span style={styles.breadcrumbSeparator}>›</span>
                        <span style={styles.currentPage}>{topic?.title}</span>
                    </div>

                    {/* Topic Header */}
                    <div style={styles.header}>
                        <h1 style={styles.title}>{topic?.title}</h1>
                        <p style={styles.description}>
                            {topic?.description || 'No description available'}
                        </p>
                        <div style={styles.meta}>
                            Created {formatDate(topic?.created_at)} • Last updated {formatDate(topic?.updated_at)}
                        </div>
                    </div>

                    {/* Subtopics */}
                    {subtopics.length > 0 && (
                        <div style={styles.section}>
                            <h2 style={styles.sectionTitle}>Subtopics</h2>
                            <div style={styles.subtopicsGrid}>
                                {subtopics.map((subtopic) => (
                                    <Link
                                        key={subtopic.id}
                                        to={`/topic/${subtopic.id}`}
                                        style={{
                                            ...styles.subtopicCard,
                                            ...(hoveredCard === subtopic.id ? styles.subtopicCardHover : {})
                                        }}
                                        onMouseEnter={() => setHoveredCard(subtopic.id)}
                                        onMouseLeave={() => setHoveredCard(null)}
                                    >
                                        <h4 style={styles.subtopicTitle}>{subtopic.title}</h4>
                                        <p style={styles.subtopicDescription}>
                                            {subtopic.description || 'No description available'}
                                        </p>
                                    </Link>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Threads */}
                    <div style={styles.section}>
                        <h2 style={styles.sectionTitle}>Threads ({totalThreads})</h2>
                        
                        {error && (
                            <div style={styles.error}>{error}</div>
                        )}

                        {threads.length > 0 ? (
                            <div style={styles.threadsContainer}>
                                {threads.map((thread, index) => (
                                    <div
                                        key={thread.id}
                                        style={{
                                            ...styles.threadItem,
                                            ...(hoveredThread === thread.id ? styles.threadItemHover : {}),
                                            ...(index === threads.length - 1 ? { borderBottom: 'none' } : {})
                                        }}
                                        onMouseEnter={() => setHoveredThread(thread.id)}
                                        onMouseLeave={() => setHoveredThread(null)}
                                        onClick={() => {
                                            const threadIdStr = thread.id.toString();
                                            navigate(`/thread?threadid=${threadIdStr}`);
                                        }}
                                    >
                                        <h3 style={styles.threadTitle}>
                                            {thread.title || `Thread #${thread.id}`}
                                        </h3>
                                        <p style={styles.threadBody}>{thread.body}</p>
                                        <div style={styles.threadMeta}>
                                            <span>Created {formatTimeAgo(thread.created_at)}</span>
                                            <span>→</span>
                                        </div>
                                    </div>
                                ))}
                                
                                {/* Pagination */}
                                {totalPages > 1 && (
                                    <div style={styles.pagination}>
                                        <button
                                            style={{
                                                ...styles.pageButton,
                                                ...(currentPage === 0 ? styles.pageButtonDisabled : {})
                                            }}
                                            onClick={() => setCurrentPage(p => Math.max(0, p - 1))}
                                            disabled={currentPage === 0}
                                        >
                                            Previous
                                        </button>
                                        <span style={styles.pageInfo}>
                                            Page {currentPage + 1} of {totalPages}
                                        </span>
                                        <button
                                            style={{
                                                ...styles.pageButton,
                                                ...(currentPage >= totalPages - 1 ? styles.pageButtonDisabled : {})
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
                            <div style={styles.noContent}>
                                <p>No threads in this topic yet.</p>
                                <p>Be the first to start a discussion!</p>
                            </div>
                        )}
                    </div>

                    {/* Create Thread Form */}
                    <div style={styles.createThreadSection}>
                        <h2 style={styles.sectionTitle}>Start a New Thread</h2>
                        <form style={styles.form} onSubmit={handleCreateThread}>
                            {/* Title Input */}
                            <div style={styles.inputGroup}>
                                <input
                                    type="text"
                                    placeholder="Thread title"
                                    value={createThreadTitle}
                                    onChange={(e) => setCreateThreadTitle(e.target.value)}
                                    style={{
                                        ...styles.threadTitleInput,
                                        ...(textLimits && createThreadTitle.length > textLimits.thread_title_max_length ? styles.threadInputError : {})
                                    }}
                                    disabled={submitting}
                                    onFocus={(e) => {
                                        e.target.style.borderColor = '#3498db';
                                        e.target.style.boxShadow = '0 0 0 2px rgba(52, 152, 219, 0.2)';
                                    }}
                                    onBlur={(e) => {
                                        e.target.style.borderColor = textLimits && createThreadTitle.length > textLimits.thread_title_max_length ? '#e74c3c' : '#4a4a4a';
                                        e.target.style.boxShadow = 'none';
                                    }}
                                />
                                {textLimits && (
                                    <div style={{
                                        ...styles.characterCounter,
                                        color: createThreadTitle.length > textLimits.thread_title_max_length ? '#e74c3c' : 
                                               (textLimits.thread_title_max_length - createThreadTitle.length) < 20 ? '#f39c12' : '#888'
                                    }}>
                                        {createThreadTitle.length}/{textLimits.thread_title_max_length} characters
                                        {createThreadTitle.length > textLimits.thread_title_max_length && 
                                            <span style={{ marginLeft: '10px' }}>({createThreadTitle.length - textLimits.thread_title_max_length} over limit)</span>
                                        }
                                    </div>
                                )}
                            </div>

                            {/* Body Textarea */}
                            <div style={styles.inputGroup}>
                                <textarea
                                    placeholder="What would you like to discuss?"
                                    value={createThreadBody}
                                    onChange={(e) => setCreateThreadBody(e.target.value)}
                                    style={{
                                        ...styles.threadBodyTextarea,
                                        ...(textLimits && createThreadBody.length > textLimits.thread_body_max_length ? styles.threadInputError : {})
                                    }}
                                    disabled={submitting}
                                    onFocus={(e) => {
                                        e.target.style.borderColor = '#3498db';
                                        e.target.style.boxShadow = '0 0 0 2px rgba(52, 152, 219, 0.2)';
                                    }}
                                    onBlur={(e) => {
                                        e.target.style.borderColor = textLimits && createThreadBody.length > textLimits.thread_body_max_length ? '#e74c3c' : '#4a4a4a';
                                        e.target.style.boxShadow = 'none';
                                    }}
                                />
                                {textLimits && (
                                    <div style={{
                                        ...styles.characterCounter,
                                        color: createThreadBody.length > textLimits.thread_body_max_length ? '#e74c3c' : 
                                               (textLimits.thread_body_max_length - createThreadBody.length) < 100 ? '#f39c12' : '#888'
                                    }}>
                                        {createThreadBody.length}/{textLimits.thread_body_max_length} characters
                                        {createThreadBody.length > textLimits.thread_body_max_length && 
                                            <span style={{ marginLeft: '10px' }}>({createThreadBody.length - textLimits.thread_body_max_length} over limit)</span>
                                        }
                                    </div>
                                )}
                            </div>

                            <button
                                type="submit"
                                style={{
                                    ...styles.submitButton,
                                    ...(submitting || !createThreadTitle.trim() || !createThreadBody.trim() || 
                                        (textLimits && (createThreadTitle.length > textLimits.thread_title_max_length || 
                                                       createThreadBody.length > textLimits.thread_body_max_length)) ? styles.submitButtonDisabled : {})
                                }}
                                disabled={submitting || !createThreadTitle.trim() || !createThreadBody.trim() || 
                                         (textLimits && (createThreadTitle.length > textLimits.thread_title_max_length || 
                                                        createThreadBody.length > textLimits.thread_body_max_length))}
                                onMouseEnter={(e) => {
                                    if (!e.target.disabled) {
                                        e.target.style.backgroundColor = '#2980b9';
                                        e.target.style.transform = 'translateY(-1px)';
                                        e.target.style.boxShadow = '0 4px 8px rgba(52, 152, 219, 0.3)';
                                    }
                                }}
                                onMouseLeave={(e) => {
                                    if (!e.target.disabled) {
                                        e.target.style.backgroundColor = '#3498db';
                                        e.target.style.transform = 'none';
                                        e.target.style.boxShadow = '0 2px 4px rgba(52, 152, 219, 0.2)';
                                    }
                                }}
                            >
                                {submitting ? 'Creating...' : 'Create Thread'}
                            </button>
                        </form>
                    </div>
                </div>
            </main>
        </div>
    );
}

export default Topic;
