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
                    setTopicInfo(topicResponse[0]);
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
