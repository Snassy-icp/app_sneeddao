import React, { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Principal } from '@dfinity/principal';
import { useAuth } from '../AuthContext';
import { useSns } from '../contexts/SnsContext';
import { useNaming } from '../NamingContext';
import Header from '../components/Header';
import { createActor, canisterId } from 'declarations/sneed_sns_forum';
import { formatError } from '../utils/errorUtils';
import { fetchSnsLogo, getAllSnses, getSnsById } from '../utils/SnsUtils';
import { PrincipalDisplay } from '../utils/PrincipalUtils';
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
    filterSection: {
        backgroundColor: '#2a2a2a',
        borderRadius: '8px',
        padding: '20px',
        marginBottom: '30px',
        border: '1px solid #3a3a3a'
    },
    filterTitle: {
        color: '#ffffff',
        fontSize: '1.2rem',
        marginBottom: '15px',
        fontWeight: '500'
    },
    filterRow: {
        display: 'flex',
        flexWrap: 'wrap',
        gap: '15px',
        marginBottom: '15px'
    },
    filterGroup: {
        display: 'flex',
        flexDirection: 'column',
        gap: '5px',
        minWidth: '200px'
    },
    filterLabel: {
        color: '#ccc',
        fontSize: '0.9rem',
        fontWeight: '500'
    },
    filterInput: {
        backgroundColor: '#1a1a1a',
        border: '1px solid #3a3a3a',
        borderRadius: '4px',
        padding: '8px 12px',
        color: '#ffffff',
        fontSize: '0.9rem'
    },
    filterSelect: {
        backgroundColor: '#1a1a1a',
        border: '1px solid #3a3a3a',
        borderRadius: '4px',
        padding: '8px 12px',
        color: '#ffffff',
        fontSize: '0.9rem'
    },
    applyButton: {
        backgroundColor: '#3498db',
        color: 'white',
        border: 'none',
        borderRadius: '4px',
        padding: '8px 16px',
        cursor: 'pointer',
        fontSize: '0.9rem',
        fontWeight: '500',
        transition: 'background-color 0.2s ease'
    },
    clearButton: {
        backgroundColor: '#666',
        color: 'white',
        border: 'none',
        borderRadius: '4px',
        padding: '8px 16px',
        cursor: 'pointer',
        fontSize: '0.9rem',
        fontWeight: '500',
        marginLeft: '10px',
        transition: 'background-color 0.2s ease'
    },
    feedContainer: {
        display: 'flex',
        flexDirection: 'column',
        gap: '20px'
    },
    feedItem: {
        backgroundColor: '#2a2a2a',
        borderRadius: '8px',
        padding: '20px',
        border: '1px solid #3a3a3a',
        transition: 'all 0.2s ease',
        position: 'relative'
    },
    feedItemHover: {
        borderColor: '#3498db',
        boxShadow: '0 2px 8px rgba(52, 152, 219, 0.2)'
    },
    feedItemHeader: {
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'flex-start',
        marginBottom: '15px',
        flexWrap: 'wrap',
        gap: '10px'
    },
    feedItemHeaderLeft: {
        display: 'flex',
        alignItems: 'center',
        gap: '10px',
        flexWrap: 'wrap'
    },
    feedItemType: {
        display: 'inline-block',
        backgroundColor: '#3498db',
        color: 'white',
        padding: '4px 8px',
        borderRadius: '4px',
        fontSize: '0.8rem',
        fontWeight: '500',
        textTransform: 'uppercase',
        cursor: 'pointer',
        textDecoration: 'none',
        transition: 'all 0.2s ease'
    },
    feedItemTypeHover: {
        backgroundColor: '#2980b9',
        transform: 'translateY(-1px)'
    },
    feedItemDate: {
        color: '#888',
        fontSize: '0.9rem'
    },
    feedItemTitle: {
        color: '#ffffff',
        fontSize: '1.3rem',
        fontWeight: '600',
        marginBottom: '10px',
        lineHeight: '1.4',
        cursor: 'pointer',
        textDecoration: 'none',
        transition: 'color 0.2s ease'
    },
    feedItemTitleHover: {
        color: '#3498db'
    },
    feedItemBody: {
        color: '#ccc',
        fontSize: '1rem',
        lineHeight: '1.6',
        marginBottom: '15px',
        maxHeight: '150px',
        overflow: 'hidden',
        position: 'relative'
    },
    feedItemContext: {
        display: 'flex',
        flexWrap: 'wrap',
        gap: '10px',
        marginTop: '15px',
        paddingTop: '15px',
        borderTop: '1px solid #3a3a3a'
    },
    contextItem: {
        color: '#888',
        fontSize: '0.9rem',
        backgroundColor: '#1a1a1a',
        padding: '4px 8px',
        borderRadius: '4px',
        border: '1px solid #333'
    },
    contextLink: {
        color: '#3498db',
        textDecoration: 'none',
        fontSize: '0.9rem',
        backgroundColor: '#1a1a1a',
        padding: '4px 8px',
        borderRadius: '4px',
        border: '1px solid #333',
        transition: 'all 0.2s ease'
    },
    snsLogo: {
        position: 'absolute',
        top: '20px',
        left: '20px',
        width: '48px',
        height: '48px',
        borderRadius: '50%',
        objectFit: 'cover',
        border: '2px solid #3a3a3a',
        cursor: 'pointer',
        transition: 'all 0.2s ease'
    },
    snsLogoHover: {
        border: '2px solid #3498db',
        transform: 'scale(1.05)'
    },
    snsLogoPlaceholder: {
        position: 'absolute',
        top: '20px',
        left: '20px',
        width: '48px',
        height: '48px',
        borderRadius: '50%',
        backgroundColor: '#4a4a4a',
        border: '2px solid #3a3a3a',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: '0.8rem',
        color: '#888',
        cursor: 'pointer',
        transition: 'all 0.2s ease'
    },
    feedItemContent: {
        marginLeft: '68px' // Make room for the logo
    },
    loadMoreButton: {
        backgroundColor: '#3498db',
        color: 'white',
        border: 'none',
        borderRadius: '8px',
        padding: '15px 30px',
        cursor: 'pointer',
        fontSize: '1rem',
        fontWeight: '500',
        alignSelf: 'center',
        marginTop: '30px',
        transition: 'background-color 0.2s ease'
    },
    loadingSpinner: {
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        padding: '40px',
        color: '#888'
    },
    errorMessage: {
        backgroundColor: '#e74c3c',
        color: 'white',
        padding: '15px',
        borderRadius: '8px',
        marginBottom: '20px',
        textAlign: 'center'
    },
    emptyState: {
        textAlign: 'center',
        padding: '60px 20px',
        color: '#888'
    },
    emptyStateTitle: {
        fontSize: '1.5rem',
        marginBottom: '10px',
        color: '#ccc'
    },
    emptyStateDescription: {
        fontSize: '1rem',
        lineHeight: '1.6'
    }
};

function Feed() {
    const { identity } = useAuth();
    const { selectedSnsRoot, snsInstances } = useSns();
    const { getPrincipalDisplayName } = useNaming();
    const navigate = useNavigate();
    const [feedItems, setFeedItems] = useState([]);
    const [loading, setLoading] = useState(true);
    const [loadingMore, setLoadingMore] = useState(false);
    const [error, setError] = useState(null);
    const [hasMore, setHasMore] = useState(true);
    const [nextStartId, setNextStartId] = useState(null);

    // Filter state
    const [showFilters, setShowFilters] = useState(false);
    const [searchText, setSearchText] = useState('');
    const [selectedSns, setSelectedSns] = useState('');
    const [selectedType, setSelectedType] = useState('');
    const [appliedFilters, setAppliedFilters] = useState({});

    // SNS logos state
    const [snsLogos, setSnsLogos] = useState(new Map());
    const [loadingLogos, setLoadingLogos] = useState(new Set());
    const [allSnses, setAllSnses] = useState([]);

    // Create forum actor
    const createForumActor = () => {
        return createActor(canisterId, {
            agentOptions: { identity }
        });
    };

    // Load SNS data and logos
    useEffect(() => {
        const loadSnsData = () => {
            const cachedData = getAllSnses();
            if (cachedData && cachedData.length > 0) {
                setAllSnses(cachedData);
                
                // Start loading logos for all SNSes
                cachedData.forEach(sns => {
                    if (sns.canisters.governance) {
                        loadSnsLogo(sns.canisters.governance);
                    }
                });
            }
        };
        
        loadSnsData();
    }, []);

    // Function to load a single SNS logo
    const loadSnsLogo = async (governanceId) => {
        if (snsLogos.has(governanceId) || loadingLogos.has(governanceId)) return;
        
        setLoadingLogos(prev => new Set([...prev, governanceId]));
        
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
            setSnsLogos(prev => new Map(prev).set(governanceId, logo));
        } catch (error) {
            console.error(`Error loading logo for SNS ${governanceId}:`, error);
        } finally {
            setLoadingLogos(prev => {
                const next = new Set(prev);
                next.delete(governanceId);
                return next;
            });
        }
    };

    // Get SNS info by root canister ID
    const getSnsInfo = (rootCanisterId) => {
        if (!rootCanisterId) return null;
        const rootStr = principalToText(rootCanisterId);
        return allSnses.find(sns => sns.rootCanisterId === rootStr);
    };

    // Format date
    const formatDate = (timestamp) => {
        const date = new Date(Number(timestamp) / 1000000); // Convert nanoseconds to milliseconds
        return date.toLocaleString();
    };

    // Helper function to extract variant value from Motoko variant
    const extractVariant = (variant) => {
        if (typeof variant === 'string') return variant;
        if (typeof variant === 'object' && variant !== null) {
            const keys = Object.keys(variant);
            if (keys.length > 0) {
                return keys[0]; // Return the first (and usually only) key
            }
        }
        return String(variant);
    };

    // Get display text for type (NEW FORUM, NEW TOPIC, etc.)
    const getTypeDisplayText = (type) => {
        const typeStr = extractVariant(type);
        switch (typeStr) {
            case 'forum':
                return 'NEW FORUM';
            case 'topic':
                return 'NEW TOPIC';
            case 'thread':
                return 'THREAD';
            case 'post':
                return 'POST';
            default:
                return typeStr.toUpperCase();
        }
    };

    // Get type color
    const getTypeColor = (type) => {
        const typeStr = extractVariant(type);
        const colors = {
            forum: '#e67e22',
            topic: '#9b59b6',
            thread: '#2ecc71',
            post: '#3498db'
        };
        return colors[typeStr] || '#3498db';
    };

    // Load feed items
    const loadFeed = async (startId = null, isLoadMore = false) => {
        try {
            if (!isLoadMore) {
                setLoading(true);
                setError(null);
            } else {
                setLoadingMore(true);
            }

            const forumActor = createForumActor();
            
            // Build filter object
            let filter = null;
            if (Object.keys(appliedFilters).length > 0) {
                filter = {};
                if (appliedFilters.searchText) {
                    filter.search_text = [appliedFilters.searchText];
                }
                if (appliedFilters.selectedSns) {
                    try {
                        filter.sns_root_canister_ids = [Principal.fromText(appliedFilters.selectedSns)];
                    } catch (e) {
                        console.warn('Invalid SNS principal:', appliedFilters.selectedSns, e);
                    }
                }
                // Note: We don't have topic_ids or creator_principals filters in the UI yet
            }

            const input = {
                start_id: startId ? [startId] : [],
                length: 20,
                filter: filter ? [filter] : []
            };

            const response = await forumActor.get_feed(input);
            
            // Debug log to see the structure of the response
            if (response.items.length > 0) {
                console.log('Feed item sample:', response.items[0]);
            }
            
            if (isLoadMore) {
                setFeedItems(prev => [...prev, ...response.items]);
            } else {
                setFeedItems(response.items);
            }
            
            setHasMore(response.has_more);
            setNextStartId(response.next_start_id.length > 0 ? response.next_start_id[0] : null);

        } catch (err) {
            console.error('Error loading feed:', err);
            setError(formatError(err));
        } finally {
            setLoading(false);
            setLoadingMore(false);
        }
    };

    // Load initial feed
    useEffect(() => {
        if (identity) {
            loadFeed();
        }
    }, [identity, appliedFilters]);

    // Infinite scroll effect
    useEffect(() => {
        const handleScroll = () => {
            // Check if we're near the bottom of the page
            const scrollTop = window.pageYOffset || document.documentElement.scrollTop;
            const windowHeight = window.innerHeight;
            const documentHeight = document.documentElement.scrollHeight;
            
            // Trigger load more when we're within 500px of the bottom
            const isNearBottom = scrollTop + windowHeight >= documentHeight - 500;
            
            if (isNearBottom && hasMore && !loadingMore && !loading && nextStartId) {
                loadFeed(nextStartId, true);
            }
        };

        // Add scroll event listener
        window.addEventListener('scroll', handleScroll);
        
        // Also check on resize in case content changes
        window.addEventListener('resize', handleScroll);

        // Cleanup
        return () => {
            window.removeEventListener('scroll', handleScroll);
            window.removeEventListener('resize', handleScroll);
        };
    }, [hasMore, loadingMore, loading, nextStartId]);

    // Apply filters
    const applyFilters = () => {
        const filters = {};
        if (searchText.trim()) filters.searchText = searchText.trim();
        if (selectedSns) filters.selectedSns = selectedSns;
        if (selectedType) filters.selectedType = selectedType;
        
        setAppliedFilters(filters);
        setNextStartId(null);
    };

    // Clear filters
    const clearFilters = () => {
        setSearchText('');
        setSelectedSns('');
        setSelectedType('');
        setAppliedFilters({});
        setNextStartId(null);
    };

    // Helper function to safely convert Principal to text
    const principalToText = (principal) => {
        if (!principal) return '';
        
        // If it's already a string
        if (typeof principal === 'string') return principal;
        
        // If it has toText method
        if (principal.toText && typeof principal.toText === 'function') {
            return principal.toText();
        }
        
        // If it's a Principal object with _arr property
        if (principal._arr) {
            try {
                return Principal.fromUint8Array(principal._arr).toText();
            } catch (e) {
                console.warn('Failed to convert principal with _arr:', e);
            }
        }
        
        // If it's an array (Uint8Array representation)
        if (Array.isArray(principal) || principal instanceof Uint8Array) {
            try {
                return Principal.fromUint8Array(principal).toText();
            } catch (e) {
                console.warn('Failed to convert principal array:', e);
            }
        }
        
        // Fallback - convert to string
        return String(principal);
    };

    // Convert principal to Principal object for PrincipalDisplay component
    const getPrincipalObject = (principal) => {
        try {
            const principalStr = principalToText(principal);
            return Principal.fromText(principalStr);
        } catch (e) {
            console.warn('Failed to convert principal:', principal, e);
            return null;
        }
    };

    // Get navigation URL for item type
    const getItemNavigationUrl = (item) => {
        const typeStr = extractVariant(item.item_type);
        const snsRootId = Array.isArray(item.sns_root_canister_id) ? item.sns_root_canister_id[0] : item.sns_root_canister_id;
        const snsRootStr = principalToText(snsRootId);
        
        switch (typeStr) {
            case 'forum':
                return `/forum?sns=${snsRootStr}`;
            case 'topic':
                const topicId = Array.isArray(item.topic_id) ? item.topic_id[0] : item.topic_id;
                return `/topic/${topicId || item.id}?sns=${snsRootStr}`;
            case 'thread':
                const threadId = Array.isArray(item.thread_id) ? item.thread_id[0] : item.thread_id;
                return `/thread?threadid=${threadId || item.id}`;
            case 'post':
                return `/post?postid=${item.id}`;
            default:
                return '#';
        }
    };

    // Get fallback title for items without titles
    const getFallbackTitle = (item) => {
        const typeStr = extractVariant(item.item_type);
        const capitalizedType = typeStr.charAt(0).toUpperCase() + typeStr.slice(1);
        return `${capitalizedType} #${item.id}`;
    };

    // Get display title (actual title or fallback)
    const getDisplayTitle = (item) => {
        const actualTitle = Array.isArray(item.title) ? item.title[0] : item.title;
        if (actualTitle && actualTitle.trim().length > 0) {
            return actualTitle;
        }
        return getFallbackTitle(item);
    };

    // Render feed item
    const renderFeedItem = (item) => {
        const typeColor = getTypeColor(item.item_type);
        const typeDisplayText = getTypeDisplayText(item.item_type);
        
        // Get SNS info and logo
        const snsRootId = Array.isArray(item.sns_root_canister_id) ? item.sns_root_canister_id[0] : item.sns_root_canister_id;
        const snsInfo = getSnsInfo(snsRootId);
        const snsLogo = snsInfo ? snsLogos.get(snsInfo.canisters.governance) : null;
        const isLoadingLogo = snsInfo ? loadingLogos.has(snsInfo.canisters.governance) : false;
        
        // Get creator principal object
        const creatorPrincipal = getPrincipalObject(item.created_by);
        const creatorDisplayInfo = creatorPrincipal ? getPrincipalDisplayName(creatorPrincipal) : null;
        
        // Handle SNS logo click to navigate to forum
        const handleSnsLogoClick = () => {
            const snsRootId = Array.isArray(item.sns_root_canister_id) ? item.sns_root_canister_id[0] : item.sns_root_canister_id;
            const snsRootStr = principalToText(snsRootId);
            navigate(`/forum?sns=${snsRootStr}`);
        };

        // Get navigation URL and display title
        const navigationUrl = getItemNavigationUrl(item);
        const displayTitle = getDisplayTitle(item);

        // Handle item navigation
        const handleItemClick = () => {
            navigate(navigationUrl);
        };
        
        return (
            <div key={item.id} style={styles.feedItem}>
                {/* SNS Logo - Clickable link to forum */}
                {snsInfo && (
                    <>
                        {isLoadingLogo ? (
                            <div 
                                style={styles.snsLogoPlaceholder}
                                onClick={handleSnsLogoClick}
                                title={`Go to ${snsInfo.name} Forum`}
                            >
                                ...
                            </div>
                        ) : snsLogo ? (
                            <img
                                src={snsLogo}
                                alt={snsInfo.name}
                                style={styles.snsLogo}
                                title={`Go to ${snsInfo.name} Forum`}
                                onClick={handleSnsLogoClick}
                                onMouseEnter={(e) => {
                                    e.target.style.border = '2px solid #3498db';
                                    e.target.style.transform = 'scale(1.05)';
                                }}
                                onMouseLeave={(e) => {
                                    e.target.style.border = '2px solid #3a3a3a';
                                    e.target.style.transform = 'scale(1)';
                                }}
                            />
                        ) : (
                            <div 
                                style={styles.snsLogoPlaceholder} 
                                title={`Go to ${snsInfo.name} Forum`}
                                onClick={handleSnsLogoClick}
                                onMouseEnter={(e) => {
                                    e.target.style.border = '2px solid #3498db';
                                    e.target.style.transform = 'scale(1.05)';
                                }}
                                onMouseLeave={(e) => {
                                    e.target.style.border = '2px solid #3a3a3a';
                                    e.target.style.transform = 'scale(1)';
                                }}
                            >
                                {snsInfo.name.substring(0, 2).toUpperCase()}
                            </div>
                        )}
                    </>
                )}
                
                {/* Content with margin for logo */}
                <div style={styles.feedItemContent}>
                    <div style={styles.feedItemHeader}>
                        <div style={styles.feedItemHeaderLeft}>
                            <span 
                                style={{...styles.feedItemType, backgroundColor: typeColor}}
                                onClick={handleItemClick}
                                onMouseEnter={(e) => {
                                    e.target.style.backgroundColor = '#2980b9';
                                    e.target.style.transform = 'translateY(-1px)';
                                }}
                                onMouseLeave={(e) => {
                                    e.target.style.backgroundColor = typeColor;
                                    e.target.style.transform = 'translateY(0)';
                                }}
                                title={`Go to ${typeDisplayText.toLowerCase()}`}
                            >
                                {typeDisplayText}
                            </span>
                            {creatorPrincipal && (
                                <PrincipalDisplay
                                    principal={creatorPrincipal}
                                    displayInfo={creatorDisplayInfo}
                                    short={true}
                                    style={{ fontSize: '0.9rem' }}
                                />
                            )}
                        </div>
                        <span style={styles.feedItemDate}>
                            {formatDate(item.created_at)}
                        </span>
                    </div>
                    
                    {/* Always show title (actual or fallback) */}
                    <h3 
                        style={styles.feedItemTitle}
                        onClick={handleItemClick}
                        onMouseEnter={(e) => {
                            e.target.style.color = '#3498db';
                        }}
                        onMouseLeave={(e) => {
                            e.target.style.color = '#ffffff';
                        }}
                        title={`Go to ${typeDisplayText.toLowerCase()}`}
                    >
                        {displayTitle}
                    </h3>
                    
                    {item.body && item.body.length > 0 && (
                        <div style={styles.feedItemBody}>
                            {(() => {
                                const bodyText = Array.isArray(item.body) ? item.body[0] : item.body;
                                return bodyText.length > 300 ? `${bodyText.substring(0, 300)}...` : bodyText;
                            })()}
                        </div>
                    )}
                    
                    <div style={styles.feedItemContext}>
                        {item.topic_title && (Array.isArray(item.topic_title) ? item.topic_title.length > 0 : true) && (
                            <Link 
                                to={`/topic/${Array.isArray(item.topic_id) ? item.topic_id[0] : item.topic_id}`} 
                                style={styles.contextLink}
                            >
                                Topic: {Array.isArray(item.topic_title) ? item.topic_title[0] : item.topic_title}
                            </Link>
                        )}
                        
                        {item.thread_title && (Array.isArray(item.thread_title) ? item.thread_title.length > 0 : true) && (
                            <Link 
                                to={`/thread?id=${Array.isArray(item.thread_id) ? item.thread_id[0] : item.thread_id}`} 
                                style={styles.contextLink}
                            >
                                Thread: {Array.isArray(item.thread_title) ? item.thread_title[0] : item.thread_title}
                            </Link>
                        )}
                    </div>
                </div>
            </div>
        );
    };

    return (
        <div>
            <Header showSnsDropdown={true} />
            <div style={styles.container}>
                <div style={styles.header}>
                    <h1 style={styles.title}>Sneed's Feed</h1>
                    <p style={styles.description}>
                        Latest activity across all SNS forums - see new forums, topics, threads, and posts as they happen.
                    </p>
                </div>

                {/* Filter Section */}
                <div style={styles.filterSection}>
                    <div style={styles.filterTitle}>
                        Filters
                        <button 
                            onClick={() => setShowFilters(!showFilters)}
                            style={{...styles.applyButton, marginLeft: '10px', fontSize: '0.8rem', padding: '4px 8px'}}
                        >
                            {showFilters ? 'Hide' : 'Show'}
                        </button>
                    </div>
                    
                    {showFilters && (
                        <>
                            <div style={styles.filterRow}>
                                <div style={styles.filterGroup}>
                                    <label style={styles.filterLabel}>Search Text</label>
                                    <input
                                        type="text"
                                        value={searchText}
                                        onChange={(e) => setSearchText(e.target.value)}
                                        placeholder="Search in titles and content..."
                                        style={styles.filterInput}
                                    />
                                </div>
                                
                                <div style={styles.filterGroup}>
                                    <label style={styles.filterLabel}>SNS</label>
                                    <select
                                        value={selectedSns}
                                        onChange={(e) => setSelectedSns(e.target.value)}
                                        style={styles.filterSelect}
                                    >
                                        <option value="">All SNS</option>
                                        {snsInstances.map((sns) => (
                                            <option key={sns.root_canister_id} value={sns.root_canister_id}>
                                                {sns.name || sns.root_canister_id.substring(0, 8)}...
                                            </option>
                                        ))}
                                    </select>
                                </div>
                                
                                <div style={styles.filterGroup}>
                                    <label style={styles.filterLabel}>Type</label>
                                    <select
                                        value={selectedType}
                                        onChange={(e) => setSelectedType(e.target.value)}
                                        style={styles.filterSelect}
                                    >
                                        <option value="">All Types</option>
                                        <option value="forum">Forums</option>
                                        <option value="topic">Topics</option>
                                        <option value="thread">Threads</option>
                                        <option value="post">Posts</option>
                                    </select>
                                </div>
                            </div>
                            
                            <div style={styles.filterRow}>
                                <button onClick={applyFilters} style={styles.applyButton}>
                                    Apply Filters
                                </button>
                                <button onClick={clearFilters} style={styles.clearButton}>
                                    Clear Filters
                                </button>
                            </div>
                        </>
                    )}
                </div>

                {/* Error Message */}
                {error && (
                    <div style={styles.errorMessage}>
                        {error}
                    </div>
                )}

                {/* Loading State */}
                {loading && (
                    <div style={styles.loadingSpinner}>
                        Loading feed...
                    </div>
                )}

                {/* Feed Items */}
                {!loading && (
                    <div style={styles.feedContainer}>
                        {feedItems.length > 0 ? (
                            <>
                                {feedItems.map(renderFeedItem)}
                                
                                {/* Loading indicator for infinite scroll */}
                                {loadingMore && (
                                    <div style={styles.loadingSpinner}>
                                        Loading more items...
                                    </div>
                                )}
                                
                                {/* End of feed indicator */}
                                {!hasMore && feedItems.length > 0 && (
                                    <div style={{
                                        textAlign: 'center',
                                        padding: '40px 20px',
                                        color: '#888',
                                        fontSize: '1rem'
                                    }}>
                                        You've reached the end of the feed
                                    </div>
                                )}
                            </>
                        ) : (
                            <div style={styles.emptyState}>
                                <h3 style={styles.emptyStateTitle}>No Activity Yet</h3>
                                <p style={styles.emptyStateDescription}>
                                    There's no activity to show yet. Check back later or try adjusting your filters.
                                </p>
                            </div>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}

export default Feed;
