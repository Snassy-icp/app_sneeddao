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
import { FaComments, FaHome, FaChevronRight, FaExclamationTriangle, FaSpinner } from 'react-icons/fa';

// Custom CSS for animations
const customAnimations = `
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

@keyframes spin {
    0% { transform: rotate(0deg); }
    100% { transform: rotate(360deg); }
}

.thread-fade-in {
    animation: fadeInUp 0.4s ease-out forwards;
}

.thread-spin {
    animation: spin 1s linear infinite;
}
`;

// Page accent colors - purple theme for forum/discussion
const forumPrimary = '#8b5cf6';
const forumSecondary = '#a78bfa';

const getStyles = (theme) => ({
    pageContainer: {
        background: theme.colors.primaryGradient,
        color: theme.colors.primaryText,
        minHeight: '100vh',
    },
    forumHeader: {
        background: `linear-gradient(135deg, ${forumPrimary}15 0%, ${forumSecondary}10 50%, transparent 100%)`,
        borderBottom: `1px solid ${theme.colors.border}`,
        padding: '16px 0',
        position: 'sticky',
        top: 0,
        zIndex: 100,
        backdropFilter: 'blur(12px)',
    },
    forumHeaderInner: {
        maxWidth: '1200px',
        margin: '0 auto',
        padding: '0 1.25rem',
        display: 'flex',
        alignItems: 'center',
        gap: '15px',
    },
    snsLogoWrapper: {
        width: '40px',
        height: '40px',
        borderRadius: '12px',
        background: theme.colors.secondaryBg,
        border: `2px solid ${theme.colors.border}`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
        flexShrink: 0,
    },
    snsLogo: {
        width: '100%',
        height: '100%',
        objectFit: 'cover',
    },
    snsLogoPlaceholder: {
        fontSize: '0.7rem',
        color: theme.colors.mutedText,
        fontWeight: '700',
    },
    forumTitle: {
        color: theme.colors.primaryText,
        fontSize: 'clamp(1.25rem, 3vw, 1.5rem)',
        fontWeight: '700',
        margin: 0,
        flex: 1,
    },
    container: {
        maxWidth: '1200px',
        margin: '0 auto',
        padding: '1.25rem',
    },
    breadcrumb: {
        display: 'flex',
        alignItems: 'center',
        flexWrap: 'wrap',
        gap: '8px',
        marginBottom: '1.25rem',
        padding: '12px 16px',
        background: theme.colors.cardGradient,
        border: `1px solid ${theme.colors.border}`,
        borderRadius: '12px',
        fontSize: '0.9rem',
    },
    breadcrumbLink: {
        color: theme.colors.accent,
        textDecoration: 'none',
        display: 'flex',
        alignItems: 'center',
        gap: '6px',
        fontWeight: '500',
        transition: 'opacity 0.2s ease',
    },
    breadcrumbSeparator: {
        color: theme.colors.mutedText,
        fontSize: '0.7rem',
    },
    breadcrumbCurrent: {
        color: theme.colors.secondaryText,
        fontWeight: '500',
    },
    errorCard: {
        background: theme.colors.cardGradient,
        border: `1px solid ${theme.colors.border}`,
        borderRadius: '16px',
        padding: '3rem 2rem',
        textAlign: 'center',
        boxShadow: theme.colors.cardShadow,
    },
    errorIcon: {
        width: '64px',
        height: '64px',
        borderRadius: '16px',
        background: `linear-gradient(135deg, ${theme.colors.error}20, ${theme.colors.error}10)`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        margin: '0 auto 1rem',
    },
    errorTitle: {
        fontSize: '1.5rem',
        fontWeight: '700',
        color: theme.colors.primaryText,
        marginBottom: '0.75rem',
    },
    errorText: {
        color: theme.colors.secondaryText,
        fontSize: '1rem',
        lineHeight: '1.6',
    },
    loadingCard: {
        background: theme.colors.cardGradient,
        border: `1px solid ${theme.colors.border}`,
        borderRadius: '16px',
        padding: '3rem 2rem',
        textAlign: 'center',
        boxShadow: theme.colors.cardShadow,
    },
    loadingIcon: {
        width: '64px',
        height: '64px',
        borderRadius: '16px',
        background: `linear-gradient(135deg, ${forumPrimary}20, ${forumPrimary}10)`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        margin: '0 auto 1rem',
    },
    loadingText: {
        color: theme.colors.secondaryText,
        fontSize: '1rem',
    },
});

const Thread = () => {
    const [searchParams] = useSearchParams();
    const threadId = searchParams.get('threadid'); // Get thread ID from query params
    const { createForumActor } = useForum();
    const { isAuthenticated, identity } = useAuth();
    const { theme } = useTheme();
    const { selectedSnsRoot } = useSns();
    const styles = getStyles(theme);
    
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

    // Load SNS info and logo when SNS changes
    useEffect(() => {
        if (currentSnsRoot) {
            loadSnsInfo();
        }
    }, [currentSnsRoot, identity]);

    if (!threadId) {
        return (
            <div style={styles.pageContainer}>
                <style>{customAnimations}</style>
                <Header showSnsDropdown={true} />
                <div style={styles.container}>
                    <div style={styles.errorCard} className="thread-fade-in">
                        <div style={styles.errorIcon}>
                            <FaExclamationTriangle size={28} color={theme.colors.error} />
                        </div>
                        <h2 style={styles.errorTitle}>Thread Not Found</h2>
                        <p style={styles.errorText}>
                            No thread ID provided in the URL. Please use ?threadid=123 format.
                        </p>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div style={styles.pageContainer}>
            <style>{customAnimations}</style>
            <Header showSnsDropdown={true} />
            
            {/* Forum Header */}
            {forumInfo && (
                <div style={styles.forumHeader}>
                    <div style={styles.forumHeaderInner}>
                        {/* SNS Logo */}
                        <div style={styles.snsLogoWrapper}>
                            {loadingLogo ? (
                                <span style={styles.snsLogoPlaceholder}>...</span>
                            ) : snsLogo ? (
                                <img
                                    src={snsLogo}
                                    alt={snsInfo?.name || 'SNS Logo'}
                                    style={styles.snsLogo}
                                />
                            ) : (
                                <span style={styles.snsLogoPlaceholder}>
                                    {snsInfo?.name?.substring(0, 2).toUpperCase() || 'SNS'}
                                </span>
                            )}
                        </div>
                        
                        {/* Forum Title */}
                        <h1 style={styles.forumTitle}>
                            {snsInfo?.name ? `${snsInfo.name} Forum` : (forumInfo.title || 'Forum')}
                        </h1>
                        
                        {/* Discussion Icon */}
                        <FaComments size={24} color={forumPrimary} style={{ opacity: 0.6 }} />
                    </div>
                </div>
            )}
            
            <div style={styles.container}>
                {/* Breadcrumb */}
                {!breadcrumbLoading && topicInfo && (
                    <div style={styles.breadcrumb} className="thread-fade-in">
                        <Link to="/forum" style={styles.breadcrumbLink}>
                            <FaHome size={14} />
                            Forum
                        </Link>
                        <FaChevronRight size={10} style={styles.breadcrumbSeparator} />
                        <Link to={`/topic/${topicInfo.id}`} style={styles.breadcrumbLink}>
                            {topicInfo.title}
                        </Link>
                        <FaChevronRight size={10} style={styles.breadcrumbSeparator} />
                        <span style={styles.breadcrumbCurrent}>
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
