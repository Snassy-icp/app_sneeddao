import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Principal } from '@dfinity/principal';
import { useAuth } from '../AuthContext';
import { useSns } from '../contexts/SnsContext';
import Header from '../components/Header';
import { createActor, canisterId } from 'declarations/sneed_sns_forum';
import { formatError } from '../utils/errorUtils';

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
        transition: 'all 0.2s ease'
    },
    feedItemHover: {
        borderColor: '#3498db',
        boxShadow: '0 2px 8px rgba(52, 152, 219, 0.2)'
    },
    feedItemHeader: {
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'flex-start',
        marginBottom: '15px'
    },
    feedItemType: {
        display: 'inline-block',
        backgroundColor: '#3498db',
        color: 'white',
        padding: '4px 8px',
        borderRadius: '4px',
        fontSize: '0.8rem',
        fontWeight: '500',
        textTransform: 'uppercase'
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
        lineHeight: '1.4'
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

    // Create forum actor
    const createForumActor = () => {
        return createActor(canisterId, {
            agentOptions: { identity }
        });
    };

    // Format date
    const formatDate = (timestamp) => {
        const date = new Date(Number(timestamp) / 1000000); // Convert nanoseconds to milliseconds
        return date.toLocaleString();
    };

    // Get type color
    const getTypeColor = (type) => {
        const colors = {
            forum: '#e67e22',
            topic: '#9b59b6',
            thread: '#2ecc71',
            post: '#3498db'
        };
        return colors[type] || '#3498db';
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
                    filter.sns_root_canister_ids = [Principal.fromText(appliedFilters.selectedSns)];
                }
                // Note: We don't have topic_ids or creator_principals filters in the UI yet
            }

            const input = {
                start_id: startId ? [startId] : [],
                length: 20,
                filter: filter ? [filter] : []
            };

            const response = await forumActor.get_feed(input);
            
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

    // Load more items
    const loadMore = () => {
        if (nextStartId && !loadingMore) {
            loadFeed(nextStartId, true);
        }
    };

    // Render feed item
    const renderFeedItem = (item) => {
        const typeColor = getTypeColor(item.item_type);
        
        return (
            <div key={item.id} style={styles.feedItem}>
                <div style={styles.feedItemHeader}>
                    <span style={{...styles.feedItemType, backgroundColor: typeColor}}>
                        {item.item_type}
                    </span>
                    <span style={styles.feedItemDate}>
                        {formatDate(item.created_at)}
                    </span>
                </div>
                
                {item.title && (
                    <h3 style={styles.feedItemTitle}>{item.title}</h3>
                )}
                
                {item.body && (
                    <div style={styles.feedItemBody}>
                        {item.body.length > 300 ? `${item.body.substring(0, 300)}...` : item.body}
                    </div>
                )}
                
                <div style={styles.feedItemContext}>
                    {item.sns_root_canister_id && (
                        <span style={styles.contextItem}>
                            SNS: {item.sns_root_canister_id.toText().substring(0, 8)}...
                        </span>
                    )}
                    
                    {item.forum_title && (
                        <Link 
                            to={`/forum`} 
                            style={styles.contextLink}
                        >
                            Forum: {item.forum_title}
                        </Link>
                    )}
                    
                    {item.topic_title && (
                        <Link 
                            to={`/topic/${item.topic_id}`} 
                            style={styles.contextLink}
                        >
                            Topic: {item.topic_title}
                        </Link>
                    )}
                    
                    {item.thread_title && (
                        <Link 
                            to={`/thread?id=${item.thread_id}`} 
                            style={styles.contextLink}
                        >
                            Thread: {item.thread_title}
                        </Link>
                    )}
                    
                    <span style={styles.contextItem}>
                        By: {item.created_by.toText().substring(0, 8)}...
                    </span>
                </div>
            </div>
        );
    };

    return (
        <div>
            <Header showSnsDropdown={true} />
            <div style={styles.container}>
                <div style={styles.header}>
                    <h1 style={styles.title}>Feed</h1>
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
                                
                                {hasMore && (
                                    <button 
                                        onClick={loadMore} 
                                        disabled={loadingMore}
                                        style={{
                                            ...styles.loadMoreButton,
                                            backgroundColor: loadingMore ? '#666' : '#3498db'
                                        }}
                                    >
                                        {loadingMore ? 'Loading...' : 'Load More'}
                                    </button>
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
