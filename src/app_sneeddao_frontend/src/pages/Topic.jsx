import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { Principal } from '@dfinity/principal';
import { useAuth } from '../AuthContext';
import { useSns } from '../contexts/SnsContext';
import Header from '../components/Header';
import { createActor, canisterId } from 'declarations/sneed_sns_forum';
import { useTextLimits } from '../hooks/useTextLimits';
import { formatError } from '../utils/errorUtils';
import { createActor as createSnsGovernanceActor } from 'external/sns_governance';
import { getSnsById } from '../utils/SnsUtils';

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
    },
    preproposalsPrompt: {
        backgroundColor: '#2a2a2a',
        border: '1px solid #3498db',
        borderRadius: '8px',
        padding: '20px',
        marginTop: '30px',
        marginBottom: '30px',
        textAlign: 'center'
    },
    preproposalsPromptTitle: {
        color: '#3498db',
        fontSize: '1.3rem',
        fontWeight: '600',
        marginBottom: '10px'
    },
    preproposalsPromptMessage: {
        color: '#ccc',
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
    }
};

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
    const [threadsPerPage, setThreadsPerPage] = useState(10);
    const [createThreadTitle, setCreateThreadTitle] = useState('');
    const [createThreadBody, setCreateThreadBody] = useState('');
    const [submitting, setSubmitting] = useState(false);
    const [showPreproposalsPrompt, setShowPreproposalsPrompt] = useState(false);
    const [creatingPreproposals, setCreatingPreproposals] = useState(false);
    
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

    // Async function to check and fetch proposal data for threads
    const fetchProposalDataForThreads = useCallback(async (threads) => {
        if (!forumActor || !identity || !selectedSnsRoot || !threads.length) return;
        
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
                                const selectedSns = getSnsById(selectedSnsRoot);
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
    }, [forumActor, identity, selectedSnsRoot, topic?.title]);

    useEffect(() => {
        if (!topicId) {
            setError('Invalid topic ID');
            setLoading(false);
            return;
        }

        fetchTopicData();
    }, [topicId, identity, currentPage, threadsPerPage]);

    // Fetch proposal data for threads when threads are loaded (async, non-blocking)
    useEffect(() => {
        if (threads.length > 0) {
            // Run in background without blocking UI
            fetchProposalDataForThreads(threads);
        }
    }, [threads, fetchProposalDataForThreads]);

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
        if (!identity || !selectedSnsRoot || creatingPreproposals) return;

        setCreatingPreproposals(true);
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
                special_topic_type: { 'Preproposals': null }
            });

            if ('ok' in result) {
                console.log('Preproposals topic created successfully, topic ID:', result.ok);
                setShowPreproposalsPrompt(false);
                // Refresh the topic data to show the new subtopic
                await fetchTopicData();
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

            // Get threads for this topic
            const threadsResponse = await forumActor.get_threads_by_topic(parseInt(topicId));
            
            if (threadsResponse) {
                // Filter out deleted threads
                const activeThreads = threadsResponse.filter(thread => !thread.deleted);
                
                // Sort by created_at descending (newest first)
                activeThreads.sort((a, b) => Number(b.created_at - a.created_at));
                
                // Apply pagination on the frontend
                const startIndex = currentPage * threadsPerPage;
                const endIndex = startIndex + threadsPerPage;
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
                setError('Failed to create thread: ' + formatError(result.err, 'Unknown error'));
            }

        } catch (err) {
            console.error('Error creating thread:', err);
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

                    {/* Preproposals Topic Prompt */}
                    {showPreproposalsPrompt && (
                        <div style={styles.preproposalsPrompt}>
                            <h3 style={styles.preproposalsPromptTitle}>Create Preproposals Topic?</h3>
                            <p style={styles.preproposalsPromptMessage}>
                                This Governance topic does not have a "Preproposals" subtopic yet. Would you like to create it? 
                                This will provide a space for discussing potential proposals before formal submission.
                            </p>
                            <div style={styles.preproposalsPromptButtons}>
                                <button 
                                    onClick={handleCreatePreproposalsTopic}
                                    disabled={creatingPreproposals}
                                    style={{
                                        ...styles.createPreproposalsButton,
                                        ...(creatingPreproposals ? styles.buttonDisabled : {})
                                    }}
                                >
                                    {creatingPreproposals ? 'Creating...' : 'Create Preproposals Topic'}
                                </button>
                                <button 
                                    onClick={() => setShowPreproposalsPrompt(false)}
                                    disabled={creatingPreproposals}
                                    style={{
                                        ...styles.dismissButton,
                                        ...(creatingPreproposals ? styles.buttonDisabled : {})
                                    }}
                                >
                                    Maybe Later
                                </button>
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
                                                        color: '#3498db',
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
                                        
                                        <div style={styles.threadMeta}>
                                            <span>Created {formatTimeAgo(thread.created_at)}</span>
                                            <span>→</span>
                                        </div>
                                    </div>
                                ))}
                                
                                {/* Threads Per Page Selector */}
                                <div style={{
                                    display: 'flex',
                                    justifyContent: 'space-between',
                                    alignItems: 'center',
                                    padding: '15px 0',
                                    borderTop: '1px solid #333',
                                    marginTop: '20px'
                                }}>
                                    <div style={{
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: '10px',
                                        fontSize: '14px',
                                        color: '#ccc'
                                    }}>
                                        <span>Show:</span>
                                        <select
                                            value={threadsPerPage}
                                            onChange={(e) => handleThreadsPerPageChange(Number(e.target.value))}
                                            style={{
                                                backgroundColor: '#2a2a2a',
                                                color: '#ffffff',
                                                border: '1px solid #444',
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
                            </div>
                        ) : (
                            <div style={styles.noContent}>
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
                                backgroundColor: '#2a2a2a',
                                color: '#ffffff',
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
                                backgroundColor: '#2a2a2a',
                                color: '#ffffff',
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
                        <div style={{ 
                            display: 'flex', 
                            gap: '10px', 
                            marginTop: '10px'
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
                                    color: '#ffffff',
                                    border: 'none',
                                    borderRadius: '4px',
                                    padding: '8px 16px',
                                    cursor: (submitting || !createThreadTitle.trim() || !createThreadBody.trim() || 
                                            (textLimits && (createThreadTitle.length > textLimits.thread_title_max_length || 
                                                           createThreadBody.length > textLimits.thread_body_max_length))) ? 'not-allowed' : 'pointer',
                                    fontSize: '14px'
                                }}
                            >
                                {submitting ? 'Creating...' : 'Create Thread'}
                            </button>
                        </div>
                    </div>
                    )}
                </div>
            </main>
        </div>
    );
}

export default Topic;
