import React, { useState, useEffect, useRef } from 'react';
import { Link, useNavigate, useLocation, useSearchParams } from 'react-router-dom';
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
    },
    newItemsNotification: {
        position: 'fixed',
        top: '80px', // Below header
        left: '50%',
        transform: 'translateX(-50%)',
        backgroundColor: '#1DA1F2', // Twitter blue
        color: 'white',
        padding: '12px 24px',
        borderRadius: '25px',
        boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
        cursor: 'pointer',
        zIndex: 1000,
        fontSize: '0.95rem',
        fontWeight: '500',
        transition: 'all 0.3s ease',
        border: '1px solid rgba(255,255,255,0.1)'
    },
    checkboxContainer: {
        display: 'flex',
        flexDirection: 'column',
        gap: '8px',
        maxHeight: '200px',
        overflowY: 'auto',
        backgroundColor: '#1a1a1a',
        border: '1px solid #3a3a3a',
        borderRadius: '4px',
        padding: '8px'
    },
    checkboxLabel: {
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        cursor: 'pointer',
        padding: '4px',
        borderRadius: '4px',
        transition: 'background-color 0.2s ease'
    },
    checkbox: {
        cursor: 'pointer',
        accentColor: '#3498db'
    },
    checkboxText: {
        color: '#ccc',
        fontSize: '0.9rem',
        userSelect: 'none'
    }
};

function Feed() {
    const { identity } = useAuth();
    const { selectedSnsRoot } = useSns();
    const { getPrincipalDisplayName } = useNaming();
    const navigate = useNavigate();
    const location = useLocation();
    const [searchParams] = useSearchParams();
    const scrollContainerRef = useRef(null);
    const [feedItems, setFeedItems] = useState([]);
    const [loading, setLoading] = useState(true);
    const [loadingMore, setLoadingMore] = useState(false);
    const [loadingNewer, setLoadingNewer] = useState(false);
    const [error, setError] = useState(null);
    const [hasMore, setHasMore] = useState(true);
    const [hasNewer, setHasNewer] = useState(false);
    const [nextStartId, setNextStartId] = useState(null);
    const [prevStartId, setPrevStartId] = useState(null);
    const [canAutoLoadNewer, setCanAutoLoadNewer] = useState(true);
    const [canAutoLoadOlder, setCanAutoLoadOlder] = useState(true);
    
    // New items notification state
    const [newItemsCount, setNewItemsCount] = useState(0);
    const [showNewItemsNotification, setShowNewItemsNotification] = useState(false);
    const [lastSeenId, setLastSeenId] = useState(null);

    // Filter state
    const [showFilters, setShowFilters] = useState(false);
    const [searchText, setSearchText] = useState('');
    const [selectedSnsList, setSelectedSnsList] = useState([]);  // Changed to array for multiple selection
    const [selectedType, setSelectedType] = useState('');
    const [appliedFilters, setAppliedFilters] = useState({});

    // SNS logos state
    const [snsLogos, setSnsLogos] = useState(new Map());
    const [loadingLogos, setLoadingLogos] = useState(new Set());
    const [allSnses, setAllSnses] = useState([]);
    const [snsInstances, setSnsInstances] = useState([]);

    // Create forum actor
    const createForumActor = () => {
        return createActor(canisterId, {
            agentOptions: { identity }
        });
    };

    // Get/set last seen ID from localStorage
    const getLastSeenId = () => {
        try {
            const stored = localStorage.getItem('feedLastSeenId');
            return stored ? BigInt(stored) : null;
        } catch (e) {
            console.warn('Error reading last seen ID from localStorage:', e);
            return null;
        }
    };

    const saveLastSeenId = (id) => {
        try {
            if (id) {
                localStorage.setItem('feedLastSeenId', id.toString());
                setLastSeenId(id);
            }
        } catch (e) {
            console.warn('Error saving last seen ID to localStorage:', e);
        }
    };

    // Check for new items
    const checkForNewItems = async () => {
        try {
            const forumActor = createForumActor();
            const currentCounter = await forumActor.get_current_counter();
            const lastSeen = getLastSeenId();
            
            if (lastSeen) {
                // currentCounter is the next ID to be assigned, so the last created item has ID (currentCounter - 1)
                // We have new items if the last created item ID is greater than what we last saw
                const lastCreatedId = currentCounter - 1n;
                
                if (lastCreatedId > lastSeen) {
                    const newCount = Number(lastCreatedId - lastSeen);
                    setNewItemsCount(newCount);
                    setShowNewItemsNotification(true);
                    console.log(`Found ${newCount} new items. Last created ID: ${lastCreatedId}, last seen: ${lastSeen}`);
                } else {
                    console.log(`No new items. Last created ID: ${lastCreatedId}, last seen: ${lastSeen}`);
                }
            } else {
                console.log(`No last seen ID stored. Current counter: ${currentCounter}`);
            }
        } catch (error) {
            console.error('Error checking for new items:', error);
        }
    };

    // Handle clicking the new items notification
    const handleShowNewItems = () => {
        setShowNewItemsNotification(false);
        setNewItemsCount(0);
        // Reload feed from the top
        loadFeed(null, 'initial');
    };

    // Load SNS data and logos
    useEffect(() => {
        const loadSnsData = () => {
            const cachedData = getAllSnses();
            if (cachedData && cachedData.length > 0) {
                setAllSnses(cachedData);
                // Convert to the format expected by the dropdown
                setSnsInstances(cachedData.map(sns => ({
                    root_canister_id: sns.rootCanisterId,
                    name: sns.name
                })));
                
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

    // Load feed items (supports bidirectional loading)
    const loadFeed = async (startId = null, direction = 'initial') => {
        try {
            if (direction === 'initial') {
                setLoading(true);
                setError(null);
            } else if (direction === 'older') {
                setLoadingMore(true);
            } else if (direction === 'newer') {
                setLoadingNewer(true);
            }

            const forumActor = createForumActor();
            
            // Build filter object - use Motoko optional format ([] for null, [value] for present)
            let filter = null;
            if (Object.keys(appliedFilters).length > 0) {
                filter = {
                    creator_principals: [], // Empty array means null/none
                    topic_ids: [], // Empty array means null/none
                    search_text: [], // Empty array means null/none
                    sns_root_canister_ids: [] // Empty array means null/none
                };
                
                if (appliedFilters.searchText) {
                    filter.search_text = [appliedFilters.searchText]; // Array with value
                }
                if (appliedFilters.selectedSnsList && appliedFilters.selectedSnsList.length > 0) {
                    try {
                        const principalArray = appliedFilters.selectedSnsList.map(snsId => 
                            Principal.fromText(snsId)
                        );
                        filter.sns_root_canister_ids = [principalArray]; // Wrap array in optional
                    } catch (e) {
                        console.warn('Invalid SNS principal(s):', appliedFilters.selectedSnsList, e);
                    }
                }
                // Note: We don't have topic_ids or creator_principals filters in the UI yet
            }

            // For newer items, we need to work differently since the API only goes backwards
            let actualStartId = startId;
            let actualLength = 20;
            
            if (direction === 'newer') {
                // For newer items, don't provide a start_id to get the latest items
                // Then we'll filter out what we already have
                actualStartId = null;
                actualLength = 20; // Use standard page size
            }

            const input = {
                start_id: actualStartId ? [actualStartId] : [],
                length: actualLength,
                filter: filter ? [filter] : []
            };

            const response = await forumActor.get_feed(input);
            
            // Debug log to see the structure of the response
            if (response.items.length > 0) {
                console.log(`Feed ${direction} load - items:`, response.items.length, 'has_more:', response.has_more);
            }
            
            if (direction === 'initial') {
                setFeedItems(response.items);
                setHasMore(response.has_more);
                setNextStartId(response.next_start_id.length > 0 ? response.next_start_id[0] : null);
                
                // If we started from a specific item (either URL param or back button), we might have newer items available
                const startFromParam = searchParams.get('startFrom');
                const wasBackButtonNavigation = startId !== null; // startId is set when loading from specific item
                
                if ((startFromParam || wasBackButtonNavigation) && response.items.length > 0) {
                    setHasNewer(true);
                    setPrevStartId(response.items[0].id);
                    console.log('Set hasNewer=true for specific item loading, prevStartId:', response.items[0].id);
                } else {
                    setHasNewer(false);
                    setPrevStartId(null);
                    console.log('Set hasNewer=false for top-of-feed loading');
                    
                    // If loading from the top (no specific start item), save the highest ID as last seen
                    if (response.items.length > 0) {
                        saveLastSeenId(response.items[0].id);
                        console.log('Saved last seen ID:', response.items[0].id);
                    }
                }
            } else if (direction === 'older') {
                if (response.items.length > 0) {
                    setFeedItems(prev => [...prev, ...response.items]);
                    setHasMore(response.has_more);
                    setNextStartId(response.next_start_id.length > 0 ? response.next_start_id[0] : null);
                } else {
                    // No more older items available, disable auto-loading
                    setCanAutoLoadOlder(false);
                    setHasMore(false);
                }
            } else if (direction === 'newer') {
                if (response.items.length > 0) {
                    // Filter out items we already have (items with ID <= current first item ID)
                    const currentFirstId = feedItems.length > 0 ? feedItems[0].id : 0n;
                    const newerItems = response.items.filter(item => {
                        // Handle BigInt comparison
                        const itemId = typeof item.id === 'bigint' ? item.id : BigInt(item.id);
                        const currentId = typeof currentFirstId === 'bigint' ? currentFirstId : BigInt(currentFirstId);
                        return itemId > currentId;
                    });
                    
                    console.log('Filtered newer items:', newerItems.length, 'from', response.items.length, 'total. Current first ID:', currentFirstId);
                    
                    if (newerItems.length > 0) {
                        // Sort newer items in descending order (newest first) using BigInt comparison
                        newerItems.sort((a, b) => {
                            const aId = typeof a.id === 'bigint' ? a.id : BigInt(a.id);
                            const bId = typeof b.id === 'bigint' ? b.id : BigInt(b.id);
                            if (aId > bId) return -1;
                            if (aId < bId) return 1;
                            return 0;
                        });
                        
                        // Save current scroll position before adding newer items
                        const currentScrollTop = window.pageYOffset || document.documentElement.scrollTop;
                        const currentDocumentHeight = document.documentElement.scrollHeight;
                        
                        // Add newer items to the beginning
                        setFeedItems(prev => [...newerItems, ...prev]);
                        
                        // Restore scroll position after React re-renders
                        setTimeout(() => {
                            const newDocumentHeight = document.documentElement.scrollHeight;
                            const heightDifference = newDocumentHeight - currentDocumentHeight;
                            
                            // Adjust scroll position to account for new content added above
                            const newScrollTop = currentScrollTop + heightDifference;
                            window.scrollTo({
                                top: newScrollTop,
                                behavior: 'auto' // No smooth scrolling, instant adjustment
                            });
                            
                            console.log(`Scroll adjusted by ${heightDifference}px to maintain position`);
                        }, 0);
                        
                        // If we got a full page (20 items), there might be more newer items
                        // If we got less than 20, we've probably reached the newest items
                        const hasMoreNewer = newerItems.length >= 20;
                        setHasNewer(hasMoreNewer);
                        setPrevStartId(newerItems[0].id);
                        
                        // Re-enable auto-loading since we found newer items
                        setCanAutoLoadNewer(true);
                        
                        console.log(`Added ${newerItems.length} newer items. Has more newer: ${hasMoreNewer}`);
                    } else {
                        // No newer items found, disable auto-loading
                        setCanAutoLoadNewer(false);
                        setHasNewer(false);
                        console.log('No newer items found');
                    }
                } else {
                    // No more newer items available, disable auto-loading
                    setCanAutoLoadNewer(false);
                    setHasNewer(false);
                    console.log('No items returned for newer direction');
                }
            }

        } catch (err) {
            console.error(`Error loading feed (${direction}):`, err);
            if (direction === 'initial') {
                setError(formatError(err));
            }
            // For newer/older loads, disable auto-loading on error
            if (direction === 'newer') {
                setCanAutoLoadNewer(false);
            } else if (direction === 'older') {
                setCanAutoLoadOlder(false);
            }
        } finally {
            setLoading(false);
            setLoadingMore(false);
            setLoadingNewer(false);
        }
    };

    // Load initial feed
    useEffect(() => {
        if (identity) {
            // First check for back button navigation (sessionStorage)
            const savedItemId = sessionStorage.getItem('feedReturnToItem');
            
            if (savedItemId) {
                console.log('Loading feed from back button navigation, starting from item:', savedItemId);
                // Clear the saved item ID after using it
                sessionStorage.removeItem('feedReturnToItem');
                const startId = BigInt(savedItemId);
                loadFeed(startId, 'initial');
            } else {
                // Check for URL parameter (manual navigation)
                const startFromParam = searchParams.get('startFrom');
                if (startFromParam) {
                    console.log('Loading feed starting from URL parameter:', startFromParam);
                    const startId = BigInt(startFromParam);
                    loadFeed(startId, 'initial');
                } else {
                    // Default: load from the top
                    console.log('Loading feed from the top');
                    loadFeed(null, 'initial');
                }
            }
        }
    }, [identity, appliedFilters, searchParams]);

    // Initialize last seen ID from localStorage
    useEffect(() => {
        const storedLastSeen = getLastSeenId();
        if (storedLastSeen) {
            setLastSeenId(storedLastSeen);
            console.log('Initialized last seen ID from localStorage:', storedLastSeen);
        }
    }, []);

    // Periodic check for new items
    useEffect(() => {
        if (!identity) return;

        // Initial check after a short delay
        const initialTimer = setTimeout(() => {
            checkForNewItems();
        }, 5000); // 5 seconds after page load

        // Set up periodic checking every 30 seconds
        const interval = setInterval(() => {
            checkForNewItems();
        }, 30000); // 30 seconds

        return () => {
            clearTimeout(initialTimer);
            clearInterval(interval);
        };
    }, [identity, lastSeenId]);

    // Bidirectional infinite scroll effect
    useEffect(() => {
        const handleScroll = () => {
            const scrollTop = window.pageYOffset || document.documentElement.scrollTop;
            const windowHeight = window.innerHeight;
            const documentHeight = document.documentElement.scrollHeight;
            
            // Check if we're near the bottom (load older items)
            const isNearBottom = scrollTop + windowHeight >= documentHeight - 500;
            if (isNearBottom && hasMore && !loadingMore && !loading && nextStartId && canAutoLoadOlder) {
                console.log('Auto-loading older items');
                loadFeed(nextStartId, 'older');
            }
            
            // Check if we're near the top (load newer items)
            const isNearTop = scrollTop <= 500;
            if (isNearTop && hasNewer && !loadingNewer && !loading && prevStartId && canAutoLoadNewer) {
                console.log('Auto-loading newer items');
                loadFeed(prevStartId, 'newer');
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
    }, [hasMore, hasNewer, loadingMore, loadingNewer, loading, nextStartId, prevStartId, canAutoLoadOlder, canAutoLoadNewer]);

    // Apply filters
    const applyFilters = () => {
        const filters = {};
        if (searchText.trim()) filters.searchText = searchText.trim();
        if (selectedSnsList.length > 0) filters.selectedSnsList = selectedSnsList;
        if (selectedType) filters.selectedType = selectedType;
        
        setAppliedFilters(filters);
        setNextStartId(null);
    };

    // Clear filters
    const clearFilters = () => {
        setSearchText('');
        setSelectedSnsList([]);
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
            // Save item ID for back button functionality
            sessionStorage.setItem('feedReturnToItem', item.id.toString());
            console.log('Saved feed return item ID before SNS logo click:', item.id);
            
            const snsRootId = Array.isArray(item.sns_root_canister_id) ? item.sns_root_canister_id[0] : item.sns_root_canister_id;
            const snsRootStr = principalToText(snsRootId);
            navigate(`/forum?sns=${snsRootStr}`);
        };

        // Get navigation URL and display title
        const navigationUrl = getItemNavigationUrl(item);
        const displayTitle = getDisplayTitle(item);

        // Handle item navigation
        const handleItemClick = () => {
            // Save item ID for back button functionality
            sessionStorage.setItem('feedReturnToItem', item.id.toString());
            console.log('Saved feed return item ID before item click:', item.id);
            
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
            
            {/* New Items Notification Overlay */}
            {showNewItemsNotification && (
                <div 
                    style={styles.newItemsNotification}
                    onClick={handleShowNewItems}
                    onMouseEnter={(e) => {
                        e.target.style.backgroundColor = '#1991DA';
                        e.target.style.transform = 'translateX(-50%) translateY(-2px)';
                    }}
                    onMouseLeave={(e) => {
                        e.target.style.backgroundColor = '#1DA1F2';
                        e.target.style.transform = 'translateX(-50%) translateY(0)';
                    }}
                >
                    {newItemsCount === 1 
                        ? '1 new item' 
                        : `${newItemsCount} new items`
                    } • Click to view
                </div>
            )}
            
            <div ref={scrollContainerRef} style={styles.container}>
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
                                    <label style={styles.filterLabel}>SNS (Select Multiple)</label>
                                    <div style={styles.checkboxContainer}>
                                        {snsInstances && snsInstances.map((sns) => (
                                            <label 
                                                key={sns.root_canister_id} 
                                                style={styles.checkboxLabel}
                                                onMouseEnter={(e) => {
                                                    e.target.style.backgroundColor = '#2a2a2a';
                                                }}
                                                onMouseLeave={(e) => {
                                                    e.target.style.backgroundColor = 'transparent';
                                                }}
                                            >
                                                <input
                                                    type="checkbox"
                                                    checked={selectedSnsList.includes(sns.root_canister_id)}
                                                    onChange={(e) => {
                                                        if (e.target.checked) {
                                                            setSelectedSnsList(prev => [...prev, sns.root_canister_id]);
                                                        } else {
                                                            setSelectedSnsList(prev => prev.filter(id => id !== sns.root_canister_id));
                                                        }
                                                    }}
                                                    style={styles.checkbox}
                                                />
                                                <span style={styles.checkboxText}>
                                                    {sns.name || sns.root_canister_id.substring(0, 8) + '...'}
                                                </span>
                                            </label>
                                        ))}
                                    </div>
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
                                {/* Load More Newer Items Button */}
                                {(hasNewer || loadingNewer) && (
                                    <div style={{
                                        textAlign: 'center',
                                        padding: '20px',
                                        marginBottom: '20px'
                                    }}>
                                        {loadingNewer ? (
                                            <div style={styles.loadingSpinner}>
                                                Loading newer items...
                                            </div>
                                        ) : (
                                            <button
                                                onClick={() => {
                                                    setCanAutoLoadNewer(true);
                                                    loadFeed(prevStartId, 'newer');
                                                }}
                                                style={{
                                                    ...styles.applyButton,
                                                    fontSize: '1rem',
                                                    padding: '12px 24px'
                                                }}
                                                disabled={!prevStartId}
                                            >
                                                Load More Recent
                                            </button>
                                        )}
                                    </div>
                                )}

                                {feedItems && feedItems.map(renderFeedItem)}
                                
                                {/* Load More Older Items - Loading indicator or manual button */}
                                {(loadingMore || (hasMore && !canAutoLoadOlder)) && (
                                    <div style={{
                                        textAlign: 'center',
                                        padding: '20px',
                                        marginTop: '20px'
                                    }}>
                                        {loadingMore ? (
                                            <div style={styles.loadingSpinner}>
                                                Loading more items...
                                            </div>
                                        ) : hasMore && !canAutoLoadOlder ? (
                                            <button
                                                onClick={() => {
                                                    setCanAutoLoadOlder(true);
                                                    loadFeed(nextStartId, 'older');
                                                }}
                                                style={{
                                                    ...styles.applyButton,
                                                    fontSize: '1rem',
                                                    padding: '12px 24px'
                                                }}
                                                disabled={!nextStartId}
                                            >
                                                Load More Older
                                            </button>
                                        ) : null}
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
