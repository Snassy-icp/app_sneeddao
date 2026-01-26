import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Link, useNavigate, useLocation, useSearchParams } from 'react-router-dom';
import { Principal } from '@dfinity/principal';
import { useAuth } from '../AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import { useSns } from '../contexts/SnsContext';
import { useNaming } from '../NamingContext';
import Header from '../components/Header';
import { createActor, canisterId } from 'declarations/sneed_sns_forum';
import { formatError } from '../utils/errorUtils';
import { fetchSnsLogo, getAllSnses, getSnsById } from '../utils/SnsUtils';
import { PrincipalDisplay } from '../utils/PrincipalUtils';
import { HttpAgent } from '@dfinity/agent';
import PrincipalInput from '../components/PrincipalInput';
import Poll from '../components/Poll';
import MarkdownBody from '../components/MarkdownBody';

// Format relative time (e.g., "5m", "2h", "3d")
const formatRelativeTime = (timestamp) => {
    const date = new Date(Number(timestamp) / 1000000); // Convert nanoseconds to milliseconds
    const now = new Date();
    const diffMs = now - date;
    const diffSeconds = Math.floor(diffMs / 1000);
    const diffMinutes = Math.floor(diffSeconds / 60);
    const diffHours = Math.floor(diffMinutes / 60);
    const diffDays = Math.floor(diffHours / 24);
    const diffWeeks = Math.floor(diffDays / 7);
    const diffMonths = Math.floor(diffDays / 30);
    const diffYears = Math.floor(diffDays / 365);

    if (diffSeconds < 60) return 'just now';
    if (diffMinutes < 60) return `${diffMinutes}m`;
    if (diffHours < 24) return `${diffHours}h`;
    if (diffDays < 7) return `${diffDays}d`;
    if (diffWeeks < 4) return `${diffWeeks}w`;
    if (diffMonths < 12) return `${diffMonths}mo`;
    return `${diffYears}y`;
};

// Get full date for tooltip
const getFullDate = (timestamp) => {
    const date = new Date(Number(timestamp) / 1000000);
    return date.toLocaleString();
};

const SYSTEM_FONT = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';

const getStyles = (theme) => ({
    container: {
        maxWidth: '1200px',
        margin: '0 auto',
        padding: '20px',
        fontFamily: SYSTEM_FONT,
        fontSize: '14px'
    },
    header: {
        marginBottom: '30px',
        textAlign: 'center'
    },
    title: {
        color: theme.colors.primaryText,
        fontSize: '1.8rem',
        marginBottom: '10px',
        fontWeight: '600',
        fontFamily: SYSTEM_FONT
    },
    description: {
        color: theme.colors.mutedText,
        fontSize: '14px',
        lineHeight: '1.5',
        fontFamily: SYSTEM_FONT
    },
    filterSection: {
        backgroundColor: theme.colors.secondaryBg,
        borderRadius: '8px',
        padding: '16px',
        marginBottom: '20px',
        border: `1px solid ${theme.colors.border}`,
        fontFamily: SYSTEM_FONT
    },
    filterTitle: {
        color: theme.colors.primaryText,
        fontSize: '14px',
        marginBottom: '12px',
        fontWeight: '500',
        fontFamily: SYSTEM_FONT
    },
    filterRow: {
        display: 'flex',
        flexWrap: 'wrap',
        gap: '12px',
        marginBottom: '12px'
    },
    filterGroup: {
        display: 'flex',
        flexDirection: 'column',
        gap: '4px',
        minWidth: '200px'
    },
    filterLabel: {
        color: theme.colors.secondaryText,
        fontSize: '12px',
        fontWeight: '500',
        fontFamily: SYSTEM_FONT
    },
    filterInput: {
        backgroundColor: theme.colors.primaryBg,
        border: `1px solid ${theme.colors.border}`,
        borderRadius: '4px',
        padding: '8px 12px',
        color: theme.colors.primaryText,
        fontSize: '13px',
        fontFamily: SYSTEM_FONT
    },
    filterSelect: {
        backgroundColor: theme.colors.primaryBg,
        border: `1px solid ${theme.colors.border}`,
        borderRadius: '4px',
        padding: '8px 12px',
        color: theme.colors.primaryText,
        fontSize: '13px',
        fontFamily: SYSTEM_FONT
    },
    applyButton: {
        backgroundColor: theme.colors.accent,
        color: theme.colors.primaryText,
        border: 'none',
        borderRadius: '4px',
        padding: '8px 16px',
        cursor: 'pointer',
        fontSize: '13px',
        fontWeight: '500',
        fontFamily: SYSTEM_FONT,
        transition: 'all 0.3s ease'
    },
    clearButton: {
        backgroundColor: theme.colors.mutedText,
        color: 'white',
        border: 'none',
        borderRadius: '4px',
        padding: '8px 16px',
        cursor: 'pointer',
        fontSize: '13px',
        fontWeight: '500',
        fontFamily: SYSTEM_FONT,
        marginLeft: '10px',
        transition: 'all 0.3s ease'
    },
    feedContainer: {
        display: 'flex',
        flexDirection: 'column',
        gap: '16px'
    },
    feedItem: {
        backgroundColor: theme.colors.secondaryBg,
        borderRadius: '8px',
        padding: '16px',
        border: `1px solid ${theme.colors.border}`,
        transition: 'all 0.2s ease',
        position: 'relative',
        fontFamily: SYSTEM_FONT
    },
    feedItemHover: {
        borderColor: theme.colors.borderHover,
        boxShadow: theme.colors.accentShadow
    },
    feedItemHeader: {
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'flex-start',
        marginBottom: '10px',
        flexWrap: 'wrap',
        gap: '8px'
    },
    feedItemHeaderLeft: {
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        flexWrap: 'wrap'
    },
    feedItemType: {
        display: 'inline-block',
        backgroundColor: theme.colors.accent,
        color: 'white',
        padding: '3px 6px',
        borderRadius: '4px',
        fontSize: '11px',
        fontWeight: '500',
        fontFamily: SYSTEM_FONT,
        textTransform: 'uppercase',
        cursor: 'pointer',
        textDecoration: 'none',
        transition: 'all 0.2s ease'
    },
    feedItemTypeHover: {
        backgroundColor: theme.colors.accentHover,
        transform: 'translateY(-1px)'
    },
    feedItemDate: {
        color: theme.colors.mutedText,
        fontSize: '12px',
        fontFamily: SYSTEM_FONT
    },
    feedItemTitle: {
        color: theme.colors.primaryText,
        fontSize: '16px',
        fontWeight: '600',
        fontFamily: SYSTEM_FONT,
        marginBottom: '8px',
        lineHeight: '1.4',
        cursor: 'pointer',
        textDecoration: 'none',
        transition: 'color 0.2s ease'
    },
    feedItemTitleHover: {
        color: theme.colors.accent
    },
    feedItemBody: {
        color: theme.colors.secondaryText,
        fontSize: '14px',
        fontFamily: SYSTEM_FONT,
        lineHeight: '1.5',
        marginBottom: '12px',
        maxHeight: '120px',
        overflow: 'hidden',
        position: 'relative'
    },
    feedItemContext: {
        display: 'flex',
        flexWrap: 'wrap',
        gap: '8px',
        marginTop: '12px',
        paddingTop: '12px',
        borderTop: `1px solid ${theme.colors.border}`
    },
    contextItem: {
        color: theme.colors.mutedText,
        fontSize: '12px',
        fontFamily: SYSTEM_FONT,
        backgroundColor: theme.colors.primaryBg,
        padding: '4px 8px',
        borderRadius: '4px',
        border: `1px solid ${theme.colors.border}`
    },
    contextLink: {
        color: theme.colors.accent,
        textDecoration: 'none',
        fontSize: '12px',
        fontFamily: SYSTEM_FONT,
        backgroundColor: theme.colors.primaryBg,
        padding: '4px 8px',
        borderRadius: '4px',
        border: `1px solid ${theme.colors.border}`,
        transition: 'all 0.2s ease'
    },
    snsLogo: {
        position: 'absolute',
        top: '16px',
        left: '16px',
        width: '40px',
        height: '40px',
        borderRadius: '50%',
        objectFit: 'cover',
        border: `2px solid ${theme.colors.border}`,
        cursor: 'pointer',
        transition: 'all 0.2s ease'
    },
    snsLogoHover: {
        border: '2px solid #3498db',
        transform: 'scale(1.05)'
    },
    snsLogoPlaceholder: {
        position: 'absolute',
        top: '16px',
        left: '16px',
        width: '40px',
        height: '40px',
        borderRadius: '50%',
        backgroundColor: theme.colors.border,
        border: `2px solid ${theme.colors.border}`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: '11px',
        fontFamily: SYSTEM_FONT,
        color: theme.colors.mutedText,
        cursor: 'pointer',
        transition: 'all 0.2s ease'
    },
    feedItemContent: {
        marginLeft: '56px' // Make room for the logo
    },
    loadMoreButton: {
        backgroundColor: theme.colors.accent,
        color: 'white',
        border: 'none',
        borderRadius: '8px',
        padding: '12px 24px',
        cursor: 'pointer',
        fontSize: '13px',
        fontWeight: '500',
        fontFamily: SYSTEM_FONT,
        alignSelf: 'center',
        marginTop: '20px',
        transition: 'background-color 0.2s ease'
    },
    loadingSpinner: {
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        padding: '30px',
        color: theme.colors.mutedText,
        fontSize: '13px',
        fontFamily: SYSTEM_FONT
    },
    errorMessage: {
        backgroundColor: theme.colors.error,
        color: 'white',
        padding: '12px',
        borderRadius: '8px',
        marginBottom: '16px',
        textAlign: 'center',
        fontSize: '13px',
        fontFamily: SYSTEM_FONT
    },
    emptyState: {
        textAlign: 'center',
        padding: '40px 20px',
        color: theme.colors.mutedText,
        fontFamily: SYSTEM_FONT
    },
    emptyStateTitle: {
        fontSize: '16px',
        marginBottom: '8px',
        color: theme.colors.secondaryText,
        fontFamily: SYSTEM_FONT
    },
    emptyStateDescription: {
        fontSize: '14px',
        lineHeight: '1.5',
        fontFamily: SYSTEM_FONT
    },
    newItemsNotification: {
        position: 'fixed',
        top: '80px', // Below header
        left: '50%',
        transform: 'translateX(-50%)',
        backgroundColor: theme.colors.accent,
        color: 'white',
        padding: '10px 20px',
        borderRadius: '20px',
        boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
        cursor: 'pointer',
        zIndex: 1000,
        fontSize: '13px',
        fontWeight: '500',
        fontFamily: SYSTEM_FONT,
        transition: 'all 0.3s ease',
        border: '1px solid rgba(255,255,255,0.1)'
    },
    checkboxContainer: {
        display: 'flex',
        flexDirection: 'column',
        gap: '4px',
        maxHeight: '200px',
        overflowY: 'auto',
        backgroundColor: theme.colors.primaryBg,
        border: `1px solid ${theme.colors.border}`,
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
        accentColor: theme.colors.accent,
        gridColumn: '1'
    },
    checkboxText: {
        color: theme.colors.secondaryText,
        fontSize: '12px',
        fontFamily: SYSTEM_FONT,
        userSelect: 'none',
        gridColumn: '3'
    },
    filterLayout: {
        display: 'flex',
        gap: '16px',
        alignItems: 'flex-start',
        '@media (max-width: 768px)': {
            flexDirection: 'column'
        }
    },
    filterLayoutResponsive: {
        display: 'flex',
        gap: '16px',
        alignItems: 'flex-start',
        flexDirection: 'row'
    },
    filterLayoutStacked: {
        display: 'flex',
        flexDirection: 'column',
        gap: '16px'
    },
    filterLeftColumn: {
        display: 'flex',
        flexDirection: 'column',
        gap: '12px',
        flex: '1',
        minWidth: '0'
    },
    filterRightColumn: {
        flex: '1',
        minWidth: '0'
    },
    snsFilterHeader: {
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: '8px'
    },
    snsToggleButton: {
        backgroundColor: 'transparent',
        border: 'none',
        color: theme.colors.accent,
        cursor: 'pointer',
        fontSize: '11px',
        fontFamily: SYSTEM_FONT,
        padding: '2px 4px'
    },
    clearAllButton: {
        backgroundColor: theme.colors.mutedText,
        color: 'white',
        border: 'none',
        borderRadius: '4px',
        padding: '4px 8px',
        cursor: 'pointer',
        fontSize: '11px',
        fontWeight: '500',
        fontFamily: SYSTEM_FONT,
        transition: 'background-color 0.2s ease'
    },
    snsCheckboxWithLogo: {
        display: 'grid',
        gridTemplateColumns: '20px 20px 1fr',
        gap: '6px',
        alignItems: 'center',
        cursor: 'pointer',
        padding: '2px 4px',
        borderRadius: '4px',
        transition: 'background-color 0.2s ease',
        width: '100%'
    },
    clearSnsButton: {
        backgroundColor: theme.colors.mutedText,
        color: theme.colors.secondaryText,
        border: 'none',
        borderRadius: '4px',
        padding: '6px 12px',
        cursor: 'pointer',
        fontSize: '11px',
        fontWeight: '400',
        fontFamily: SYSTEM_FONT,
        marginTop: '8px',
        transition: 'background-color 0.2s ease',
        width: '100%'
    },
    snsLogoSmall: {
        width: '18px',
        height: '18px',
        borderRadius: '50%',
        objectFit: 'cover',
        border: `1px solid ${theme.colors.border}`,
        gridColumn: '2'
    },
    snsLogoPlaceholderSmall: {
        width: '18px',
        height: '18px',
        borderRadius: '50%',
        backgroundColor: theme.colors.border,
        border: `1px solid ${theme.colors.border}`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: '9px',
        fontFamily: SYSTEM_FONT,
        color: theme.colors.mutedText,
        gridColumn: '2'
    }
});

function Feed() {
    const { identity, isAuthenticated } = useAuth();
    const { theme } = useTheme();
    const { selectedSnsRoot } = useSns();
    const { getPrincipalDisplayName } = useNaming();
    const navigate = useNavigate();
    const location = useLocation();
    const [searchParams] = useSearchParams();
    const scrollContainerRef = useRef(null);
    const [feedItems, setFeedItems] = useState([]);
    const [loading, setLoading] = useState(true);
    const [loadingMore, setLoadingMore] = useState(false);
    const [pollsData, setPollsData] = useState(new Map()); // pollId -> poll data
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
    const [showSnsList, setShowSnsList] = useState(true); // For collapsible SNS list
    const [isNarrowScreen, setIsNarrowScreen] = useState(window.innerWidth <= 768);
    const [searchText, setSearchText] = useState('');
    const [selectedCreator, setSelectedCreator] = useState('');
    const [selectedSnsList, setSelectedSnsList] = useState(() => {
        // Load SNS selection from localStorage
        try {
            const saved = localStorage.getItem('feedSnsSelection');
            return saved ? JSON.parse(saved) : [];
        } catch (e) {
            console.warn('Failed to load SNS selection from localStorage:', e);
            return [];
        }
    });
    const [selectedType, setSelectedType] = useState('');
    const [appliedFilters, setAppliedFilters] = useState({});

    // SNS logos state
    const [snsLogos, setSnsLogos] = useState(new Map());
    const [loadingLogos, setLoadingLogos] = useState(new Set());
    const [allSnses, setAllSnses] = useState([]);
    const [snsInstances, setSnsInstances] = useState([]);
    
    // Ref to store the randomized SNS display list - only computed once per data change
    const randomizedSnsDisplayRef = useRef({ key: '', list: [] });

    // Create forum actor
    const createForumActor = () => {
        return createActor(canisterId, {
            agentOptions: identity ? { identity } : {}
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

    // Get/set highest checked ID from localStorage (to avoid redundant queries)
    const getHighestCheckedId = () => {
        try {
            const stored = localStorage.getItem('feedHighestCheckedId');
            return stored ? BigInt(stored) : null;
        } catch (e) {
            console.warn('Error reading highest checked ID from localStorage:', e);
            return null;
        }
    };

    const saveHighestCheckedId = (id) => {
        try {
            if (id) {
                localStorage.setItem('feedHighestCheckedId', id.toString());
                console.log('Saved highest checked ID:', id);
            }
        } catch (e) {
            console.warn('Error saving highest checked ID to localStorage:', e);
        }
    };

    // Check for new items with SNS filtering
    const checkForNewItems = async () => {
        try {
            const forumActor = createForumActor();
            const currentCounter = await forumActor.get_current_counter();
            const lastSeen = getLastSeenId();
            const highestChecked = getHighestCheckedId();
            
            if (lastSeen) {
                // currentCounter is the next ID to be assigned, so the last created item has ID (currentCounter - 1)
                const lastCreatedId = currentCounter - 1n;
                
                // Skip checking if we've already checked up to this ID
                if (highestChecked && lastCreatedId <= highestChecked) {
                    console.log(`Already checked up to ID ${highestChecked}, last created: ${lastCreatedId}`);
                    return;
                }
                
                if (lastCreatedId > lastSeen) {
                    // Check if we have SNS filters - if not, use simple count
                    const hasSnsFilter = appliedFilters.selectedSnsList && appliedFilters.selectedSnsList.length > 0;
                    
                    if (!hasSnsFilter) {
                        // No SNS filter - simple count based on ID difference
                        // Count items with IDs greater than lastSeen (exclude lastSeen itself)
                        const newCount = Number(lastCreatedId - lastSeen);
                        setNewItemsCount(newCount);
                        setShowNewItemsNotification(true);
                        console.log(`🐛 Found ${newCount} new items (no SNS filter). Last created ID: ${lastCreatedId}, last seen: ${lastSeen}`);
                        saveHighestCheckedId(lastCreatedId);
                        return;
                    }
                    
                    // Query page by page from newest to lastSeen with SNS filter only
                    let newItemsCount = 0;
                    let currentId = lastCreatedId;
                    const pageSize = 20;
                    
                    // Build filter with only SNS selection (no text or type filters)
                    let snsOnlyFilter = {
                        creator_principals: [],
                        topic_ids: [],
                        search_text: [],
                        sns_root_canister_ids: []
                    };
                    
                    try {
                        const principalArray = appliedFilters.selectedSnsList.map(snsId => 
                            Principal.fromText(snsId)
                        );
                        snsOnlyFilter.sns_root_canister_ids = [principalArray];
                    } catch (e) {
                        console.warn('Invalid SNS principal(s) for new items check:', appliedFilters.selectedSnsList, e);
                        // Fall back to simple count if SNS filter is invalid
                        const newCount = Number(lastCreatedId - lastSeen);
                        setNewItemsCount(newCount);
                        setShowNewItemsNotification(true);
                        saveHighestCheckedId(lastCreatedId);
                        return;
                    }
                    
                    // Query pages until we reach lastSeen
                    while (currentId > lastSeen) {
                        const input = {
                            start_id: [currentId],
                            length: pageSize,
                            filter: [snsOnlyFilter]
                        };
                        
                        const response = await forumActor.get_feed(input);
                        if (response.items.length === 0) break;
                        
                        // Count items that are newer than lastSeen
                        const relevantItems = response.items.filter(item => {
                            const itemId = typeof item.id === 'bigint' ? item.id : BigInt(item.id);
                            return itemId > lastSeen;
                        });
                        
                        newItemsCount += relevantItems.length;
                        
                        // Update currentId for next iteration
                        if (response.next_start_id && response.next_start_id.length > 0) {
                            currentId = response.next_start_id[0];
                        } else {
                            break;
                        }
                        
                        // Safety check to prevent infinite loops
                        if (currentId <= lastSeen) break;
                    }
                    
                    if (newItemsCount > 0) {
                        setNewItemsCount(newItemsCount);
                        setShowNewItemsNotification(true);
                        console.log(`Found ${newItemsCount} new items matching SNS filter. Last created ID: ${lastCreatedId}, last seen: ${lastSeen}`);
                    } else {
                        console.log(`No new items matching SNS filter. Last created ID: ${lastCreatedId}, last seen: ${lastSeen}`);
                    }
                    
                    // Save the highest ID we've checked to avoid redundant queries
                    saveHighestCheckedId(lastCreatedId);
                } else {
                    console.log(`No new items. Last created ID: ${lastCreatedId}, last seen: ${lastSeen}`);
                    // Still save that we've checked up to this ID
                    saveHighestCheckedId(lastCreatedId);
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
        
        // Clear the highest checked ID so we can check for new items again
        try {
            localStorage.removeItem('feedHighestCheckedId');
            console.log('Cleared highest checked ID - will check for new items again');
        } catch (e) {
            console.warn('Error clearing highest checked ID:', e);
        }
        
        // Clear scroll position when clicking new items notification (start from top)
        try {
            sessionStorage.removeItem('feedScrollPositionId');
            console.log('Cleared scroll position for new items view');
        } catch (e) {
            console.warn('Error clearing scroll position:', e);
        }
        
        // Clear text, creator, and type filters but keep SNS selection
        setSearchText('');
        setSelectedCreator('');
        setSelectedType('');
        
        // Update applied filters to only include SNS selection
        const newFilters = {};
        if (selectedSnsList.length > 0) {
            newFilters.selectedSnsList = selectedSnsList;
        }
        setAppliedFilters(newFilters);
        
        // Reload feed from the top
        loadFeed(null, 'initial');
    };

    // Save SNS selection to localStorage
    useEffect(() => {
        try {
            localStorage.setItem('feedSnsSelection', JSON.stringify(selectedSnsList));
        } catch (e) {
            console.warn('Failed to save SNS selection to localStorage:', e);
        }
    }, [selectedSnsList]);

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
            } else {
                // Initialize empty array to prevent undefined errors
                setSnsInstances([]);
            }
        };
        
        loadSnsData();
    }, []);

    // Re-load SNS data when component becomes visible (e.g., after back button)
    useEffect(() => {
        const handleVisibilityChange = () => {
            if (!document.hidden && snsInstances.length === 0) {
                console.log('Page became visible and snsInstances is empty, reloading...');
                const cachedData = getAllSnses();
                if (cachedData && cachedData.length > 0) {
                    setSnsInstances(cachedData.map(sns => ({
                        root_canister_id: sns.rootCanisterId,
                        name: sns.name
                    })));
                }
            }
        };

        document.addEventListener('visibilitychange', handleVisibilityChange);
        return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
    }, [snsInstances]);

    // Handle window resize for responsive layout
    useEffect(() => {
        const handleResize = () => {
            setIsNarrowScreen(window.innerWidth <= 768);
        };

        window.addEventListener('resize', handleResize);
        return () => window.removeEventListener('resize', handleResize);
    }, []);

    // Function to load a single SNS logo
    const loadSnsLogo = async (governanceId) => {
        if (snsLogos.has(governanceId) || loadingLogos.has(governanceId)) return;
        
        setLoadingLogos(prev => new Set([...prev, governanceId]));
        
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

    // Format date - now using relative time from the top-level functions

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

    // Filter feed items by type (frontend filtering since backend doesn't support it)
    const filterFeedItemsByType = (items, typeFilter) => {
        if (!typeFilter) return items;
        return items.filter(item => {
            const itemType = extractVariant(item.item_type);
            return itemType === typeFilter;
        });
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
            forum: theme.colors.warning,
            topic: '#9b59b6',
            thread: theme.colors.success,
            post: theme.colors.accent
        };
        return colors[typeStr] || theme.colors.accent;
    };

    // Fetch polls async for feed items
    const fetchPollsForItems = async (items, actor) => {
        const pollIds = items
            .filter(item => item.poll_id && item.poll_id.length > 0)
            .map(item => Number(item.poll_id[0]));
        
        console.log('🗳️ Feed poll fetching:', { 
            totalItems: items.length, 
            itemsWithPolls: items.filter(item => item.poll_id && item.poll_id.length > 0).length,
            pollIds 
        });
        
        if (pollIds.length === 0) return;

        // Fetch polls in parallel
        const pollPromises = pollIds.map(async (pollId) => {
            try {
                const pollResponse = await actor.get_poll(pollId);
                console.log(`🗳️ Raw poll response for ${pollId}:`, pollResponse);
                if (pollResponse) {
                    // Handle Motoko optional: [] = null, [value] = Some(value)
                    const actualPoll = Array.isArray(pollResponse) && pollResponse.length > 0 ? pollResponse[0] : pollResponse;
                    return { pollId, poll: actualPoll };
                }
                return null;
            } catch (error) {
                console.warn(`Failed to fetch poll ${pollId}:`, error);
                return null;
            }
        });

        try {
            const results = await Promise.allSettled(pollPromises);
            const newPollsMap = new Map(pollsData);
            
            console.log('🗳️ Poll fetch results:', results);
            
            results.forEach((result) => {
                if (result.status === 'fulfilled' && result.value) {
                    const { pollId, poll } = result.value;
                    console.log(`🗳️ Successfully fetched poll ${pollId}:`, poll);
                    newPollsMap.set(pollId, poll);
                } else if (result.status === 'rejected') {
                    console.warn('🗳️ Poll fetch rejected:', result.reason);
                }
            });
            
            console.log('🗳️ Updated polls map:', newPollsMap);
            setPollsData(newPollsMap);
        } catch (error) {
            console.warn('Failed to fetch polls:', error);
        }
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
                if (appliedFilters.selectedCreator) {
                    try {
                        const creatorPrincipal = Principal.fromText(appliedFilters.selectedCreator);
                        filter.creator_principals = [[creatorPrincipal]]; // Array containing array of principals
                    } catch (e) {
                        console.warn('Invalid creator principal:', appliedFilters.selectedCreator, e);
                    }
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
                // Note: We don't have topic_ids filters in the UI yet
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
            
            // Apply frontend type filtering
            let filteredItems = response.items;
            if (appliedFilters.selectedType) {
                filteredItems = filterFeedItemsByType(response.items, appliedFilters.selectedType);
            }
            
            // Debug log to see the structure of the response
            if (response.items.length > 0) {
                console.log(`Feed ${direction} load - items:`, response.items.length, 'filtered:', filteredItems.length, 'has_more:', response.has_more);
            }
            
            if (direction === 'initial') {
                setFeedItems(filteredItems);
                setHasMore(response.has_more);
                setNextStartId(response.next_start_id.length > 0 ? response.next_start_id[0] : null);
                
                // Fetch polls for items with poll_id (async, non-blocking)
                if (filteredItems.length > 0) {
                    fetchPollsForItems(filteredItems, forumActor);
                }
                
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
                    if (filteredItems.length > 0) {
                        saveLastSeenId(filteredItems[0].id);
                        console.log('Saved last seen ID:', filteredItems[0].id);
                    }
                }
            } else if (direction === 'older') {
                if (filteredItems.length > 0) {
                    setFeedItems(prev => [...prev, ...filteredItems]);
                    setHasMore(response.has_more);
                    setNextStartId(response.next_start_id.length > 0 ? response.next_start_id[0] : null);
                    
                    // Fetch polls for new items (async, non-blocking)
                    fetchPollsForItems(filteredItems, forumActor);
                } else {
                    // No more older items available, disable auto-loading
                    setCanAutoLoadOlder(false);
                    setHasMore(false);
                }
            } else if (direction === 'newer') {
                if (filteredItems.length > 0) {
                    // Filter out items we already have (items with ID <= current first item ID)
                    const currentFirstId = feedItems.length > 0 ? feedItems[0].id : 0n;
                    const newerItems = filteredItems.filter(item => {
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
                        
                        // Fetch polls for new items (async, non-blocking)
                        fetchPollsForItems(newerItems, forumActor);
                        
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

    // Get/set scroll position cache (persists until browser refresh)
    const getScrollPositionId = () => {
        try {
            const stored = sessionStorage.getItem('feedScrollPositionId');
            return stored ? BigInt(stored) : null;
        } catch (e) {
            console.warn('Error reading scroll position ID from sessionStorage:', e);
            return null;
        }
    };

    const saveScrollPositionId = (id) => {
        try {
            if (id) {
                sessionStorage.setItem('feedScrollPositionId', id.toString());
                console.log('Saved scroll position ID:', id);
            }
        } catch (e) {
            console.warn('Error saving scroll position ID to sessionStorage:', e);
        }
    };

    // Clear text, creator, and type filters on page load (keep SNS selection)
    useEffect(() => {
        // Clear text, creator, and type filters but preserve SNS selection
        setSearchText('');
        setSelectedCreator('');
        setSelectedType('');
        
        // Set initial applied filters to only include SNS selection
        const initialFilters = {};
        if (selectedSnsList.length > 0) {
            initialFilters.selectedSnsList = selectedSnsList;
        }
        setAppliedFilters(initialFilters);
    }, []); // Run only once on mount

    // Load initial feed
    useEffect(() => {
        // Check for cached scroll position first
        const scrollPositionId = getScrollPositionId();
        
        if (scrollPositionId) {
            console.log('Loading feed from cached scroll position:', scrollPositionId);
            loadFeed(scrollPositionId, 'initial');
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
    }, [appliedFilters, searchParams]);

    // Initialize last seen ID from localStorage
    useEffect(() => {
        const storedLastSeen = getLastSeenId();
        if (storedLastSeen) {
            setLastSeenId(storedLastSeen);
            console.log('Initialized last seen ID from localStorage:', storedLastSeen);
        }
    }, []);

    // Periodic check for new items (only when authenticated)
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

    // Bidirectional infinite scroll effect with position caching
    useEffect(() => {
        const handleScroll = () => {
            const scrollTop = window.pageYOffset || document.documentElement.scrollTop;
            const windowHeight = window.innerHeight;
            const documentHeight = document.documentElement.scrollHeight;
            
            // Save scroll position based on visible items
            if (feedItems.length > 0) {
                // Find the item that's roughly in the middle of the viewport
                const viewportMiddle = scrollTop + windowHeight / 2;
                const feedContainer = document.querySelector('[data-feed-container]');
                
                if (feedContainer) {
                    const feedItemElements = feedContainer.querySelectorAll('[data-feed-item-id]');
                    let closestItem = null;
                    let closestDistance = Infinity;
                    
                    feedItemElements.forEach(element => {
                        const rect = element.getBoundingClientRect();
                        const elementTop = rect.top + scrollTop;
                        const elementMiddle = elementTop + rect.height / 2;
                        const distance = Math.abs(elementMiddle - viewportMiddle);
                        
                        if (distance < closestDistance) {
                            closestDistance = distance;
                            closestItem = element;
                        }
                    });
                    
                    if (closestItem) {
                        const itemId = closestItem.getAttribute('data-feed-item-id');
                        if (itemId) {
                            saveScrollPositionId(BigInt(itemId));
                        }
                    }
                }
            }
            
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

        // Throttle scroll events for better performance
        let scrollTimeout;
        const throttledScroll = () => {
            if (scrollTimeout) return;
            scrollTimeout = setTimeout(() => {
                handleScroll();
                scrollTimeout = null;
            }, 100); // Throttle to every 100ms
        };

        // Add scroll event listener
        window.addEventListener('scroll', throttledScroll);
        
        // Also check on resize in case content changes
        window.addEventListener('resize', handleScroll);

        // Cleanup
        return () => {
            window.removeEventListener('scroll', throttledScroll);
            window.removeEventListener('resize', handleScroll);
            if (scrollTimeout) {
                clearTimeout(scrollTimeout);
            }
        };
    }, [hasMore, hasNewer, loadingMore, loadingNewer, loading, nextStartId, prevStartId, canAutoLoadOlder, canAutoLoadNewer, feedItems]);

    // Apply filters
    const applyFilters = () => {
        const filters = {};
        if (searchText.trim()) filters.searchText = searchText.trim();
        if (selectedCreator.trim()) filters.selectedCreator = selectedCreator.trim();
        if (selectedSnsList.length > 0) filters.selectedSnsList = selectedSnsList;
        if (selectedType) filters.selectedType = selectedType;
        
        // Clear scroll position when manually applying filters (start from top)
        try {
            sessionStorage.removeItem('feedScrollPositionId');
            console.log('Cleared scroll position for manual filter application');
        } catch (e) {
            console.warn('Error clearing scroll position:', e);
        }
        
        setAppliedFilters(filters);
        setNextStartId(null);
    };

    // Clear filters (only clear principal, text, type - NOT SNS selection)
    const clearFilters = () => {
        // Clear scroll position when clearing filters (start from top)
        try {
            sessionStorage.removeItem('feedScrollPositionId');
            console.log('Cleared scroll position for filter clearing');
        } catch (e) {
            console.warn('Error clearing scroll position:', e);
        }
        
        setSearchText('');
        setSelectedCreator('');
        setSelectedType('');
        
        // Keep SNS selection but clear other filters
        const newFilters = {};
        if (selectedSnsList.length > 0) {
            newFilters.selectedSnsList = selectedSnsList;
        }
        setAppliedFilters(newFilters);
        setNextStartId(null);
    };

    // Clear all SNS selections
    const clearAllSns = () => {
        setSelectedSnsList([]);
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
            <div key={item.id} style={getStyles(theme).feedItem} data-feed-item-id={item.id.toString()}>
                {/* SNS Logo - Clickable link to forum */}
                {snsInfo && (
                    <>
                        {isLoadingLogo ? (
                            <div 
                                style={getStyles(theme).snsLogoPlaceholder}
                                onClick={handleSnsLogoClick}
                                title={`Go to ${snsInfo.name} Forum`}
                            >
                                ...
                            </div>
                        ) : snsLogo ? (
                            <img
                                src={snsLogo}
                                alt={snsInfo.name}
                                style={getStyles(theme).snsLogo}
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
                                style={getStyles(theme).snsLogoPlaceholder} 
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
                <div style={getStyles(theme).feedItemContent}>
                    <div style={getStyles(theme).feedItemHeader}>
                        <div style={getStyles(theme).feedItemHeaderLeft}>
                            <span 
                                style={{...getStyles(theme).feedItemType, backgroundColor: typeColor}}
                                onClick={handleItemClick}
                                onMouseEnter={(e) => {
                                    e.target.style.backgroundColor = theme.colors.accentHover;
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
                                    style={{ fontSize: '12px' }}
                                    isAuthenticated={isAuthenticated}
                                />
                            )}
                        </div>
                        <span 
                            style={{...getStyles(theme).feedItemDate, cursor: 'help'}}
                            title={getFullDate(item.created_at)}
                        >
                            {formatRelativeTime(item.created_at)}
                        </span>
                    </div>
                    
                    {/* Always show title (actual or fallback) */}
                    <h3 
                        style={getStyles(theme).feedItemTitle}
                        onClick={handleItemClick}
                        onMouseEnter={(e) => {
                            e.target.style.color = theme.colors.accent;
                        }}
                        onMouseLeave={(e) => {
                            e.target.style.color = theme.colors.primaryText;
                        }}
                        title={`Go to ${typeDisplayText.toLowerCase()}`}
                    >
                        {displayTitle}
                    </h3>
                    
                    {item.body && item.body.length > 0 && (
                        <div style={getStyles(theme).feedItemBody}>
                            <MarkdownBody 
                                text={(() => {
                                const bodyText = Array.isArray(item.body) ? item.body[0] : item.body;
                                return bodyText.length > 300 ? `${bodyText.substring(0, 300)}...` : bodyText;
                            })()}
                            />
                        </div>
                    )}

                    {/* Replied-to post information */}
                    {item.replied_to_post && item.replied_to_post.length > 0 && (
                        <div style={{
                            backgroundColor: theme.colors.secondaryBg,
                            border: `1px solid ${theme.colors.border}`,
                            borderRadius: '8px',
                            padding: '10px',
                            margin: '10px 0',
                            borderLeft: `4px solid ${theme.colors.accent}`
                        }}>
                            <div style={{
                                fontSize: '11px',
                                color: theme.colors.mutedText,
                                marginBottom: '4px'
                            }}>
                                💬 Replying to:
                            </div>
                            {item.replied_to_post[0].title && item.replied_to_post[0].title.length > 0 && (
                                <div style={{
                                    fontSize: '13px',
                                    color: theme.colors.primaryText,
                                    fontWeight: '500',
                                    marginBottom: '4px'
                                }}>
                                    {Array.isArray(item.replied_to_post[0].title) ? item.replied_to_post[0].title[0] : item.replied_to_post[0].title}
                                </div>
                            )}
                            <div style={{
                                fontSize: '12px',
                                color: theme.colors.secondaryText,
                                lineHeight: '1.4'
                            }}>
                                <MarkdownBody 
                                    text={(() => {
                                    const replyBody = item.replied_to_post[0].body;
                                    return replyBody.length > 150 ? `${replyBody.substring(0, 150)}...` : replyBody;
                                })()}
                                />
                            </div>
                        </div>
                    )}

                    {/* Poll information */}
                    {item.poll_id && item.poll_id.length > 0 && (
                        <div style={{ margin: '12px 0' }}>
                            {(() => {
                                const pollId = Number(item.poll_id[0]);
                                const poll = pollsData.get(pollId);
                                
                                if (poll) {
                                    console.log('🗳️ Rendering poll in feed:', poll);
                                    // The poll data is wrapped in an array, extract the actual poll object
                                    const actualPoll = Array.isArray(poll) ? poll[0] : poll;
                                    console.log('🗳️ Extracted poll object:', actualPoll);
                                    return (
                                        <Poll 
                                            poll={actualPoll}
                                            showCreateForm={false}
                                            selectedNeurons={[]}
                                            allNeurons={[]}
                                            totalVotingPower={0}
                                        />
                                    );
                                } else {
                                    return (
                                        <div style={{
                                            backgroundColor: theme.colors.secondaryBg,
                                            borderRadius: '6px',
                                            padding: '16px',
                                            border: `1px solid ${theme.colors.border}`,
                                            fontSize: '12px',
                                            color: '#9b59b6'
                                        }}>
                                            📊 Poll (loading...)
                                        </div>
                                    );
                                }
                            })()}
                        </div>
                    )}
                    
                    <div style={getStyles(theme).feedItemContext}>
                        {item.topic_title && (Array.isArray(item.topic_title) ? item.topic_title.length > 0 : true) && (
                            <Link 
                                to={`/topic/${Array.isArray(item.topic_id) ? item.topic_id[0] : item.topic_id}`} 
                                style={getStyles(theme).contextLink}
                            >
                                Topic: {Array.isArray(item.topic_title) ? item.topic_title[0] : item.topic_title}
                            </Link>
                        )}
                        
                        {item.thread_title && (Array.isArray(item.thread_title) ? item.thread_title.length > 0 : true) && (
                            <Link 
                                to={`/thread?threadid=${Array.isArray(item.thread_id) ? item.thread_id[0] : item.thread_id}`} 
                                style={getStyles(theme).contextLink}
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
                    style={getStyles(theme).newItemsNotification}
                    onClick={handleShowNewItems}
                    onMouseEnter={(e) => {
                        e.target.style.backgroundColor = theme.colors.accentHover;
                        e.target.style.transform = 'translateX(-50%) translateY(-2px)';
                    }}
                    onMouseLeave={(e) => {
                        e.target.style.backgroundColor = theme.colors.accent;
                        e.target.style.transform = 'translateX(-50%) translateY(0)';
                    }}
                >
                    {newItemsCount === 1 
                        ? '1 new item' 
                        : `${newItemsCount} new items`
                    } • Click to view
                </div>
            )}
            
            <div 
                style={{
                    background: theme.colors.primaryGradient,
                    color: theme.colors.primaryText,
                    minHeight: '100vh'
                }}
            >
            <div ref={scrollContainerRef} style={getStyles(theme).container}>
                {/* Header Card */}
                <div style={{
                    backgroundColor: theme.colors.secondaryBg,
                    borderRadius: '16px',
                    padding: '24px',
                    marginBottom: '24px',
                    border: `1px solid ${theme.colors.border}`,
                    boxShadow: theme.colors.cardShadow,
                    background: theme.colors.cardGradient,
                    position: 'relative'
                }}>
                    {/* Subtle joke quote in top right */}
                    <div style={{
                        position: 'absolute',
                        top: '12px',
                        right: '16px',
                        fontSize: '11px',
                        color: theme.colors.mutedText,
                        fontStyle: 'italic',
                        opacity: '0.7'
                    }}>
                        "The name is a subtle joke."
                    </div>
                    {/* Header Content */}
                    <div style={{
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        textAlign: 'center',
                        marginBottom: '20px'
                    }}>
                        {/* Logo and Title Row */}
                        <div style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            gap: '12px',
                            marginBottom: '16px',
                            flexWrap: 'wrap'
                        }}>
                            <img
                                src="sneed_logo.png"
                                alt="Sneed Logo"
                                style={{
                                    width: '48px',
                                    height: '48px',
                                    objectFit: 'cover',
                                    cursor: 'pointer',
                                    borderRadius: '8px',
                                    boxShadow: '0 2px 8px rgba(0, 0, 0, 0.3)'
                                }}
                            />
                            <h1 style={{
                                ...getStyles(theme).title,
                                margin: '0',
                                color: theme.colors.primaryText,
                                fontSize: 'clamp(1.5rem, 4vw, 1.8rem)'
                            }}>
                                Sneed's Feed
                            </h1>
                        </div>
                        
                        {/* Description */}
                        <p style={{
                            ...getStyles(theme).description,
                            margin: '0',
                            maxWidth: '600px',
                            fontSize: '14px',
                            lineHeight: '1.5'
                        }}>
                            Latest activity across all SNS forums - see new forums, topics, threads, and posts as they happen.
                        </p>
                    </div>

                    {/* SNS Logos Section */}
                    {(() => {
                        // Determine which SNSes to show
                        const selectedSnsIds = appliedFilters.selectedSnsList || [];
                        const snsesToShow = selectedSnsIds.length > 0 
                            ? snsInstances.filter(sns => selectedSnsIds.includes(sns.root_canister_id))
                            : snsInstances; // Show all if none selected
                        
                        if (snsesToShow.length === 0) return null;
                        
                        return (
                            <div style={{
                                borderTop: `1px solid ${theme.colors.border}`,
                                paddingTop: '20px',
                                display: 'flex',
                                flexDirection: 'column',
                                alignItems: 'center',
                                gap: '12px'
                            }}>

                                
                                <div style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    flexWrap: 'wrap',
                                    gap: '8px',
                                    maxWidth: '100%'
                                }}>
                                    {(() => {
                                        // Create a stable key from the SNS list to detect changes
                                        const snsKey = snsesToShow.map(s => s.root_canister_id).sort().join(',');
                                        
                                        // Only re-randomize if the source data has changed
                                        if (randomizedSnsDisplayRef.current.key !== snsKey) {
                                            const displaySnses = snsesToShow.length > 10 
                                                ? [...snsesToShow].sort(() => Math.random() - 0.5).slice(0, 10)
                                                : snsesToShow;
                                            randomizedSnsDisplayRef.current = { key: snsKey, list: displaySnses };
                                        }
                                        
                                        const displaySnses = randomizedSnsDisplayRef.current.list;
                                        
                                        return displaySnses.map((sns, index) => {
                                        const snsInfo = getSnsInfo(sns.root_canister_id);
                                        const snsLogo = snsInfo ? snsLogos.get(snsInfo.canisters.governance) : null;
                                        const isLoadingLogo = snsInfo ? loadingLogos.has(snsInfo.canisters.governance) : false;
                                        
                                        return (
                                            <div
                                                key={sns.root_canister_id}
                                                style={{
                                                    position: 'relative',
                                                    transition: 'transform 0.2s ease',
                                                    cursor: 'pointer'
                                                }}
                                                onMouseEnter={(e) => {
                                                    e.currentTarget.style.transform = 'scale(1.1) translateY(-2px)';
                                                }}
                                                onMouseLeave={(e) => {
                                                    e.currentTarget.style.transform = 'scale(1) translateY(0)';
                                                }}
                                                title={snsInfo?.name || sns.name || 'SNS'}
                                            >
                                                {isLoadingLogo ? (
                                                    <div style={{
                                                        width: '40px',
                                                        height: '40px',
                                                        borderRadius: '50%',
                                                        backgroundColor: theme.colors.border,
                                                        display: 'flex',
                                                        alignItems: 'center',
                                                        justifyContent: 'center',
                                                        fontSize: '12px',
                                                        color: theme.colors.secondaryText,
                                                        boxShadow: '0 2px 12px rgba(0, 0, 0, 0.4)',
                                                        border: '2px solid #3a3a3a'
                                                    }}>
                                                        ...
                                                    </div>
                                                ) : snsLogo ? (
                                                    <img
                                                        src={snsLogo}
                                                        alt={snsInfo?.name || sns.name}
                                                        style={{
                                                            width: '40px',
                                                            height: '40px',
                                                            borderRadius: '50%',
                                                            objectFit: 'cover',
                                                            boxShadow: '0 2px 12px rgba(0, 0, 0, 0.4)',
                                                            border: '2px solid #3a3a3a'
                                                        }}
                                                    />
                                                ) : (
                                                    <div style={{
                                                        width: '40px',
                                                        height: '40px',
                                                        borderRadius: '50%',
                                                        backgroundColor: theme.colors.border,
                                                        display: 'flex',
                                                        alignItems: 'center',
                                                        justifyContent: 'center',
                                                        fontSize: '11px',
                                                        color: theme.colors.primaryText,
                                                        fontWeight: 'bold',
                                                        boxShadow: '0 2px 12px rgba(0, 0, 0, 0.4)',
                                                        border: '2px solid #3a3a3a'
                                                    }}>
                                                        {(snsInfo?.name || sns.name || 'SNS').substring(0, 2).toUpperCase()}
                                                    </div>
                                                )}
                                            </div>
                                        );
                                        });
                                    })()}
                                    
                                    {/* Show "+X more" if there are more than 10 SNSes */}
                                    {snsesToShow.length > 10 && (
                                        <div style={{
                                            width: '40px',
                                            height: '40px',
                                            borderRadius: '50%',
                                            backgroundColor: theme.colors.mutedText,
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'center',
                                            fontSize: '11px',
                                            color: theme.colors.primaryText,
                                            fontWeight: 'bold',
                                            boxShadow: '0 2px 12px rgba(0, 0, 0, 0.4)',
                                            border: `2px solid ${theme.colors.border}`
                                        }}>
                                            +{snsesToShow.length - 10}
                                        </div>
                                    )}
                                    
                                    {/* Filter Toggle Button */}
                                    <button 
                                        onClick={() => setShowFilters(!showFilters)}
                                        style={{
                                            width: '40px',
                                            height: '40px',
                                            borderRadius: '50%',
                                            backgroundColor: showFilters ? theme.colors.accent : theme.colors.secondaryBg,
                                            border: `2px solid ${theme.colors.border}`,
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'center',
                                            fontSize: '16px',
                                            color: showFilters ? theme.colors.primaryText : theme.colors.mutedText,
                                            cursor: 'pointer',
                                            boxShadow: '0 2px 12px rgba(0, 0, 0, 0.1)',
                                            transition: 'all 0.2s ease'
                                        }}
                                        onMouseEnter={(e) => {
                                            e.target.style.backgroundColor = showFilters ? theme.colors.accentHover : theme.colors.border;
                                            e.target.style.transform = 'scale(1.05)';
                                        }}
                                        onMouseLeave={(e) => {
                                            e.target.style.backgroundColor = showFilters ? theme.colors.accent : theme.colors.secondaryBg;
                                            e.target.style.transform = 'scale(1)';
                                        }}
                                        title={showFilters ? 'Hide Filters' : 'Show Filters'}
                                    >
                                        {showFilters ? '✕' : '⚙'}
                                    </button>
                                </div>
                            </div>
                        );
                    })()}
                </div>

                {/* Filter Section */}
                {showFilters && (
                    <div style={getStyles(theme).filterSection}>
                            <div style={isNarrowScreen ? getStyles(theme).filterLayoutStacked : getStyles(theme).filterLayoutResponsive}>
                                {/* Left Column: User, Type, Text */}
                                <div style={getStyles(theme).filterLeftColumn}>
                                    <div style={getStyles(theme).filterGroup}>
                                        <label style={getStyles(theme).filterLabel}>User</label>
                                        <PrincipalInput
                                            value={selectedCreator}
                                            onChange={setSelectedCreator}
                                            placeholder="Enter principal ID or search by name"
                                            style={{ width: '100%' }}
                                        />
                                    </div>
                                    
                                    <div style={getStyles(theme).filterGroup}>
                                        <label style={getStyles(theme).filterLabel}>Type</label>
                                        <select
                                            value={selectedType}
                                            onChange={(e) => setSelectedType(e.target.value)}
                                            style={getStyles(theme).filterSelect}
                                        >
                                            <option value="">All Types</option>
                                            <option value="forum">Forums</option>
                                            <option value="topic">Topics</option>
                                            <option value="thread">Threads</option>
                                            <option value="post">Posts</option>
                                        </select>
                                    </div>
                                    
                                    <div style={getStyles(theme).filterGroup}>
                                        <label style={getStyles(theme).filterLabel}>Search Text</label>
                                        <input
                                            type="text"
                                            value={searchText}
                                            onChange={(e) => setSearchText(e.target.value)}
                                            placeholder="Search in titles and content..."
                                            style={getStyles(theme).filterInput}
                                        />
                                    </div>
                                    
                                    {/* Filter Buttons */}
                                    <div style={getStyles(theme).filterRow}>
                                        <button onClick={applyFilters} style={getStyles(theme).applyButton}>
                                            Apply Filters
                                        </button>
                                        <button onClick={clearFilters} style={getStyles(theme).clearButton}>
                                            Clear Filters
                                        </button>
                                    </div>
                                </div>
                                
                                {/* Right Column (or bottom on narrow): SNS List */}
                                <div style={getStyles(theme).filterRightColumn}>
                                    <div style={getStyles(theme).filterGroup}>
                                        <div style={getStyles(theme).snsFilterHeader}>
                                            <label style={getStyles(theme).filterLabel}>
                                                SNS (Select Multiple)
                                                {selectedSnsList.length > 0 && (
                                                    <span style={{ color: theme.colors.accent, marginLeft: '8px' }}>
                                                        ({selectedSnsList.length} selected)
                                                    </span>
                                                )}
                                            </label>
                                            <button
                                                onClick={() => setShowSnsList(!showSnsList)}
                                                style={getStyles(theme).snsToggleButton}
                                            >
                                                {showSnsList ? '▼ Hide' : '▶ Show'}
                                            </button>
                                        </div>
                                        
                                        {showSnsList && (
                                            <>
                                                <div style={getStyles(theme).checkboxContainer}>
                                                    {snsInstances && snsInstances.map((sns) => {
                                                        // Find the corresponding SNS info for logo
                                                        const snsInfo = allSnses.find(s => s.rootCanisterId === sns.root_canister_id);
                                                        const snsLogo = snsInfo ? snsLogos.get(snsInfo.canisters.governance) : null;
                                                        const isLoadingLogo = snsInfo ? loadingLogos.has(snsInfo.canisters.governance) : false;
                                                        
                                                        return (
                                                            <label 
                                                                key={sns.root_canister_id} 
                                                                style={getStyles(theme).snsCheckboxWithLogo}
                                                                onMouseEnter={(e) => {
                                                                    e.target.style.backgroundColor = theme.colors.secondaryBg;
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
                                                    style={getStyles(theme).checkbox}
                                                />
                                                
                                                {/* SNS Logo */}
                                                {snsInfo && (
                                                    <>
                                                        {isLoadingLogo ? (
                                                            <div style={getStyles(theme).snsLogoPlaceholderSmall}>
                                                                ...
                                                            </div>
                                                        ) : snsLogo ? (
                                                            <img
                                                                src={snsLogo}
                                                                alt={snsInfo.name}
                                                                style={getStyles(theme).snsLogoSmall}
                                                            />
                                                        ) : (
                                                            <div style={getStyles(theme).snsLogoPlaceholderSmall}>
                                                                {snsInfo.name.substring(0, 2).toUpperCase()}
                                                            </div>
                                                        )}
                                                    </>
                                                )}
                                                
                                                <span style={getStyles(theme).checkboxText}>
                                                    {sns.name || sns.root_canister_id.substring(0, 8) + '...'}
                                                </span>
                                                            </label>
                                                        );
                                                    })}
                                                </div>
                                                
                                                {/* Clear SNS Button - below the list */}
                                                {selectedSnsList.length > 0 && (
                                                    <button
                                                        onClick={clearAllSns}
                                                        style={getStyles(theme).clearSnsButton}
                                                        onMouseEnter={(e) => {
                                                            e.target.style.backgroundColor = theme.colors.mutedText;
                                                        }}
                                                        onMouseLeave={(e) => {
                                                            e.target.style.backgroundColor = theme.colors.mutedText;
                                                        }}
                                                    >
                                                        Clear SNS Selection
                                                    </button>
                                                )}
                                            </>
                                        )}
                                    </div>
                                </div>
                            </div>
                    </div>
                )}

                {/* Error Message */}
                {error && (
                    <div style={getStyles(theme).errorMessage}>
                        {error}
                    </div>
                )}

                {/* Loading State */}
                {loading && (
                    <div style={getStyles(theme).loadingSpinner}>
                        Loading feed...
                    </div>
                )}

                {/* Feed Items */}
                {!loading && (
                    <div style={getStyles(theme).feedContainer} data-feed-container>
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
                                            <div style={getStyles(theme).loadingSpinner}>
                                                Loading newer items...
                                            </div>
                                        ) : (
                                            <button
                                                onClick={() => {
                                                    setCanAutoLoadNewer(true);
                                                    loadFeed(prevStartId, 'newer');
                                                }}
                                                style={{
                                                    ...getStyles(theme).applyButton,
                                                    fontSize: '13px',
                                                    padding: '10px 20px'
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
                                            <div style={getStyles(theme).loadingSpinner}>
                                                Loading more items...
                                            </div>
                                        ) : hasMore && !canAutoLoadOlder ? (
                                            <button
                                                onClick={() => {
                                                    setCanAutoLoadOlder(true);
                                                    loadFeed(nextStartId, 'older');
                                                }}
                                                style={{
                                                    ...getStyles(theme).applyButton,
                                                    fontSize: '13px',
                                                    padding: '10px 20px'
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
                                        padding: '30px 16px',
                                        color: theme.colors.mutedText,
                                        fontSize: '13px'
                                    }}>
                                        You've reached the end of the feed
                                    </div>
                                )}
                            </>
                        ) : (
                            <div style={getStyles(theme).emptyState}>
                                <h3 style={getStyles(theme).emptyStateTitle}>No Activity Yet</h3>
                                <p style={getStyles(theme).emptyStateDescription}>
                                    There's no activity to show yet. Check back later or try adjusting your filters.
                                </p>
                            </div>
                        )}
                    </div>
                )}
            </div>
            </div>
        </div>
    );
}

export default Feed;
