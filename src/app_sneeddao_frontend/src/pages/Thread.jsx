import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { useForum } from '../contexts/ForumContext';
import { useAuth } from '../AuthContext';
import { useSns } from '../contexts/SnsContext';
import ThreadViewer from '../components/ThreadViewer';
import Header from '../components/Header';
import './Thread.css';

const Thread = () => {
    const [searchParams] = useSearchParams();
    const threadId = searchParams.get('threadid'); // Get thread ID from query params
    const { createForumActor } = useForum();
    const { isAuthenticated, identity } = useAuth();
    const { selectedSnsRoot } = useSns();
    
    const [topicInfo, setTopicInfo] = useState(null);
    const [forumInfo, setForumInfo] = useState(null);
    const [breadcrumbLoading, setBreadcrumbLoading] = useState(true);

    // Get SNS from URL params if provided
    const snsParam = searchParams.get('sns');
    const currentSnsRoot = snsParam || selectedSnsRoot;

    // Memoize forumActor to prevent unnecessary re-renders
    const forumActor = useMemo(() => {
        return identity ? createForumActor(identity) : null;
    }, [identity, createForumActor]);

    // Fetch topic information for breadcrumb
    useEffect(() => {
        const fetchTopicInfo = async () => {
            if (!forumActor || !threadId) {
                setBreadcrumbLoading(false);
                return;
            }

            try {
                // First get the thread to find its topic_id
                const threadResponse = await forumActor.get_thread(Number(threadId));
                if (!threadResponse || threadResponse.length === 0) {
                    setBreadcrumbLoading(false);
                    return;
                }

                const thread = threadResponse[0];
                
                // Then get the topic information
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
            } catch (error) {
                console.error('Error fetching topic info for breadcrumb:', error);
            } finally {
                setBreadcrumbLoading(false);
            }
        };

        fetchTopicInfo();
    }, [forumActor, threadId]);

    const handleError = useCallback((error) => {
        console.error('Thread page error:', error);
    }, []);

    if (!threadId) {
        return (
            <div className="thread-page">
                <Header showSnsDropdown={true} />
                <div className="thread-container">
                    <div className="error-state">
                        <h2>Thread Not Found</h2>
                        <p>No thread ID provided in the URL. Please use ?threadid=123 format.</p>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="thread-page">
            <Header showSnsDropdown={true} />
            
            {/* Header-like Forum Section - Looks like part of header but scrolls with page */}
            {forumInfo && (
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
                        {/* SNS Logo Placeholder */}
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
                            SNS
                        </div>
                        
                        {/* Forum Title */}
                        <h1 style={{
                            color: '#ffffff',
                            fontSize: '1.5rem',
                            fontWeight: '600',
                            margin: 0,
                            flex: 1
                        }}>
                            {forumInfo.title}
                        </h1>
                    </div>
                </div>
            )}
            
            <div className="thread-container">
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
                        <span style={{
                            color: '#ccc'
                        }}>
                            Thread
                        </span>
                    </div>
                )}
                
                <ThreadViewer
                    forumActor={forumActor}
                    mode="thread"
                    threadId={Number(threadId)}
                    selectedSnsRoot={currentSnsRoot}
                    isAuthenticated={isAuthenticated}
                    onError={handleError}
                    showCreatePost={true}
                />
            </div>
        </div>
    );
};

export default Thread;
