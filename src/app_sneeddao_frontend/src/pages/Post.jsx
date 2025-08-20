import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { useForum } from '../contexts/ForumContext';
import { useAuth } from '../AuthContext';
import { useSns } from '../contexts/SnsContext';
import { useNaming } from '../NamingContext';
import ThreadViewer from '../components/ThreadViewer';
import Header from '../components/Header';
import { PrincipalDisplay, getPrincipalDisplayInfoFromContext } from '../utils/PrincipalUtils';
import { formatNeuronIdLink } from '../utils/NeuronUtils';
import './Post.css';

const Post = () => {
    const [searchParams] = useSearchParams();
    const postId = searchParams.get('postid'); // Get post ID from query params
    const { createForumActor } = useForum();
    const { isAuthenticated, identity } = useAuth();
    const { selectedSnsRoot } = useSns();
    const { principalNames, principalNicknames } = useNaming();

    const [threadId, setThreadId] = useState(null);
    const [postDetails, setPostDetails] = useState(null);
    const [topicInfo, setTopicInfo] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [breadcrumbLoading, setBreadcrumbLoading] = useState(true);
    const [postVotes, setPostVotes] = useState([]);
    const [votesLoading, setVotesLoading] = useState(false);
    const [votesExpanded, setVotesExpanded] = useState(false);

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
                            
                            // Get topic information
                            const topicResponse = await forumActor.get_topic(Number(thread.topic_id));
                            if (topicResponse && topicResponse.length > 0) {
                                setTopicInfo(topicResponse[0]);
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

    if (!postId) {
        return (
            <div className="post-page">
                <Header showSnsDropdown={true} />
                <div className="post-container">
                    <div className="error-state">
                        <h2>Post Not Found</h2>
                        <p>No post ID provided in the URL. Please use ?postid=123 format.</p>
                    </div>
                </div>
            </div>
        );
    }

    if (loading) {
        return (
            <div className="post-page">
                <Header showSnsDropdown={true} />
                <div className="post-container">
                    <div className="loading-state">
                        <div className="spinner"></div>
                        <p>Loading post...</p>
                    </div>
                </div>
            </div>
        );
    }

    if (error) {
        return (
            <div className="post-page">
                <Header showSnsDropdown={true} />
                <div className="post-container">
                    <div className="error-state">
                        <h2>Error Loading Post</h2>
                        <p>{error}</p>
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
                <div className="post-page">
                    <Header showSnsDropdown={true} />
                    <div className="post-container">
                        <div className="error-state">
                            <h2>Post Not Found</h2>
                            <p>Could not find the requested post or determine its thread.</p>
                        </div>
                    </div>
                </div>
            );
        }
        // Otherwise, we're still loading or there's an error (handled above)
        return null;
    }

    return (
        <div className="post-page">
            <Header showSnsDropdown={true} />
            <div className="post-container">
                {/* Breadcrumb */}
                {!breadcrumbLoading && topicInfo && (
                    <div style={{
                        marginBottom: '20px',
                        fontSize: '0.9rem'
                    }}>
                        <Link 
                            to="/forum" 
                            style={{
                                color: '#3498db',
                                textDecoration: 'none'
                            }}
                        >
                            Forum
                        </Link>
                        <span style={{
                            color: '#888',
                            margin: '0 8px'
                        }}>›</span>
                        <Link 
                            to={`/topic/${topicInfo.id}`}
                            style={{
                                color: '#3498db',
                                textDecoration: 'none'
                            }}
                        >
                            {topicInfo.title}
                        </Link>
                        <span style={{
                            color: '#888',
                            margin: '0 8px'
                        }}>›</span>
                        <Link 
                            to={`/thread?threadid=${threadId}`}
                            style={{
                                color: '#3498db',
                                textDecoration: 'none'
                            }}
                        >
                            Thread
                        </Link>
                        <span style={{
                            color: '#888',
                            margin: '0 8px'
                        }}>›</span>
                        <span style={{
                            color: '#ccc'
                        }}>
                            Post
                        </span>
                    </div>
                )}
                
                {/* Post Votes Display */}
                {postDetails && (
                    <div style={{
                        marginBottom: '20px',
                        padding: '15px',
                        backgroundColor: 'rgba(255, 255, 255, 0.05)',
                        borderRadius: '8px',
                        border: '1px solid rgba(255, 255, 255, 0.1)'
                    }}>
                        <div style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            marginBottom: '15px'
                        }}>
                            <h3 style={{ 
                                margin: '0', 
                                color: '#fff',
                                fontSize: '1.1rem'
                            }}>
                                All Votes for This Post
                            </h3>
                            {postVotes.length > 0 && (
                                <button
                                    onClick={() => setVotesExpanded(!votesExpanded)}
                                    style={{
                                        background: 'none',
                                        border: '1px solid rgba(255, 255, 255, 0.2)',
                                        borderRadius: '4px',
                                        color: '#3498db',
                                        padding: '4px 8px',
                                        fontSize: '0.8rem',
                                        cursor: 'pointer',
                                        transition: 'all 0.2s ease'
                                    }}
                                    onMouseEnter={(e) => {
                                        e.target.style.borderColor = '#3498db';
                                        e.target.style.backgroundColor = 'rgba(52, 152, 219, 0.1)';
                                    }}
                                    onMouseLeave={(e) => {
                                        e.target.style.borderColor = 'rgba(255, 255, 255, 0.2)';
                                        e.target.style.backgroundColor = 'transparent';
                                    }}
                                >
                                    {votesExpanded ? 'Hide Details' : 'Show Details'} {votesExpanded ? '▲' : '▼'}
                                </button>
                            )}
                        </div>
                        
                        {votesLoading ? (
                            <div style={{ color: '#888' }}>Loading votes...</div>
                        ) : postVotes.length === 0 ? (
                            <div style={{ color: '#888' }}>No votes yet</div>
                        ) : (
                            <div>
                                {/* Summary */}
                                <div style={{ 
                                    marginBottom: '15px',
                                    fontSize: '0.9rem',
                                    color: '#ccc'
                                }}>
                                    {(() => {
                                        const upvotes = postVotes.filter(v => v.vote_type.upvote !== undefined);
                                        const downvotes = postVotes.filter(v => v.vote_type.downvote !== undefined);
                                        const totalUpVP = upvotes.reduce((sum, v) => sum + Number(v.voting_power || 0), 0);
                                        const totalDownVP = downvotes.reduce((sum, v) => sum + Number(v.voting_power || 0), 0);
                                        
                                        const netScore = totalUpVP - totalDownVP;
                                        const netColor = netScore > 0 ? '#4CAF50' : netScore < 0 ? '#f44336' : '#888';
                                        
                                        return (
                                            <div>
                                                <div style={{ marginBottom: '8px' }}>
                                                    <span style={{ color: '#4CAF50' }}>
                                                        ▲ {upvotes.length} upvotes ({formatVotingPowerDisplay(totalUpVP)} VP)
                                                    </span>
                                                    <span style={{ margin: '0 15px', color: '#666' }}>•</span>
                                                    <span style={{ color: '#f44336' }}>
                                                        ▼ {downvotes.length} downvotes ({formatVotingPowerDisplay(totalDownVP)} VP)
                                                    </span>
                                                </div>
                                                <div style={{ 
                                                    fontSize: '0.95rem',
                                                    fontWeight: 'bold',
                                                    color: netColor
                                                }}>
                                                    Net Score: {netScore >= 0 ? '+' : ''}{formatVotingPowerDisplay(netScore)} VP
                                                </div>
                                            </div>
                                        );
                                    })()}
                                </div>
                                {/* Individual Votes - Only show when expanded */}
                                {votesExpanded && (
                                    <div style={{ 
                                        display: 'grid', 
                                        gap: '8px',
                                        maxHeight: '300px',
                                        overflowY: 'auto',
                                        marginTop: '15px'
                                    }}>
                                    {postVotes
                                        .sort((a, b) => Number(b.voting_power || 0) - Number(a.voting_power || 0)) // Sort by voting power desc
                                        .map((vote, index) => {
                                            const isUpvote = vote.vote_type.upvote !== undefined;
                                            const neuronId = vote.neuron_id?.id;
                                            const votingPower = Number(vote.voting_power || 0);
                                            
                                            // Get principal display info
                                            const principalDisplayInfo = getPrincipalDisplayInfoFromContext(
                                                vote.voter_principal, 
                                                principalNames, 
                                                principalNicknames
                                            );
                                            
                                            // Create neuron link using proper utility
                                            const neuronLink = formatNeuronIdLink(neuronId, currentSnsRoot);
                                            
                                            return (
                                                <div key={index} style={{
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    gap: '10px',
                                                    padding: '8px 12px',
                                                    backgroundColor: 'rgba(255, 255, 255, 0.03)',
                                                    borderRadius: '4px',
                                                    fontSize: '0.85rem'
                                                }}>
                                                    <span style={{
                                                        color: isUpvote ? '#4CAF50' : '#f44336',
                                                        fontWeight: 'bold',
                                                        minWidth: '20px'
                                                    }}>
                                                        {isUpvote ? '▲' : '▼'}
                                                    </span>
                                                    
                                                    {/* Neuron ID with proper link and formatting */}
                                                    <div style={{ minWidth: '80px' }}>
                                                        {neuronLink}
                                                    </div>
                                                    
                                                    <span style={{ 
                                                        color: '#fff',
                                                        fontWeight: 'bold',
                                                        minWidth: '80px',
                                                        textAlign: 'right'
                                                    }}>
                                                        {formatVotingPowerDisplay(votingPower)} VP
                                                    </span>
                                                    
                                                    {/* Principal with name/link */}
                                                    <div style={{ minWidth: '120px' }}>
                                                        <PrincipalDisplay 
                                                            principal={vote.voter_principal}
                                                            displayInfo={principalDisplayInfo}
                                                            showCopyButton={false}
                                                            style={{ fontSize: '0.85rem' }}
                                                        />
                                                    </div>
                                                    
                                                    <span style={{ 
                                                        color: '#888',
                                                        fontSize: '0.8rem',
                                                        flex: 1
                                                    }}>
                                                        {new Date(Number(vote.created_at) / 1000000).toLocaleString()}
                                                    </span>
                                                </div>
                                            );
                                        })
                                    }
                                    </div>
                                )}
                            </div>
                        )}
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
            </div>
        </div>
    );
};

export default Post;
