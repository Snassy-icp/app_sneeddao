import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { useForum } from '../contexts/ForumContext';
import { useAuth } from '../AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import { useSns } from '../contexts/SnsContext';
import ThreadViewer from '../components/ThreadViewer';
import Header from '../components/Header';
import { fetchSnsLogo, getAllSnses } from '../utils/SnsUtils';
import { HttpAgent } from '@dfinity/agent';
import './Thread.css';

const Thread = () => {
    const [searchParams] = useSearchParams();
    const threadId = searchParams.get('threadid'); // Get thread ID from query params
    const { createForumActor } = useForum();
    const { isAuthenticated, identity } = useAuth();
    const { theme } = useTheme();
    const { selectedSnsRoot } = useSns();
    
    const [topicInfo, setTopicInfo] = useState(null);
    const [forumInfo, setForumInfo] = useState(null);
    const [breadcrumbLoading, setBreadcrumbLoading] = useState(true);
    
    // SNS logo state
    const [snsLogo, setSnsLogo] = useState(null);
    const [loadingLogo, setLoadingLogo] = useState(false);
    const [snsInfo, setSnsInfo] = useState(null);

    // Get SNS from URL params if provided
    const snsParam = searchParams.get('sns');
    const currentSnsRoot = snsParam || selectedSnsRoot;

    // Memoize forumActor to prevent unnecessary re-renders
    const forumActor = useMemo(() => {
        return createForumActor(identity);
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

    // Load SNS information and logo
    const loadSnsInfo = async () => {
        if (!currentSnsRoot) return;

        // Reset logo state when SNS changes
        setSnsLogo(null);
        setLoadingLogo(false);
        setSnsInfo(null);

        try {
            // Get SNS info from cache
            const allSnses = getAllSnses();
            const currentSnsInfo = allSnses.find(sns => sns.rootCanisterId === currentSnsRoot);
            
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

    // Load SNS info and logo when SNS changes
    useEffect(() => {
        if (currentSnsRoot) {
            loadSnsInfo();
        }
    }, [currentSnsRoot, identity]);

    if (!threadId) {
        return (
            <div style={{ background: theme.colors.primaryGradient, color: theme.colors.primaryText, minHeight: '100vh' }}>
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
        <div style={{ background: theme.colors.primaryGradient, color: theme.colors.primaryText, minHeight: '100vh' }}>
            <Header showSnsDropdown={true} />
            
            {/* Header-like Forum Section - Looks like part of header but scrolls with page */}
            {forumInfo && (
                <div style={{
                    backgroundColor: theme.colors.headerBg, // Match header background
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
                                backgroundColor: theme.colors.border,
                                border: '2px solid #3a3a3a',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                fontSize: '0.6rem',
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
                                backgroundColor: theme.colors.border,
                                border: '2px solid #3a3a3a',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                fontSize: '0.6rem',
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
                            {snsInfo?.name ? `${snsInfo.name} Forum` : (forumInfo.title || 'Forum')}
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
