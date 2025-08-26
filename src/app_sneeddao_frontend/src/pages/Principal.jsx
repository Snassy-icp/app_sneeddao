import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useAuth } from '../AuthContext';
import { useSns } from '../contexts/SnsContext';
import { useForum } from '../contexts/ForumContext';
import { useSearchParams, Link, useNavigate } from 'react-router-dom';
import Header from '../components/Header';
import { useTheme } from '../contexts/ThemeContext';
import { getPrincipalName, setPrincipalName, setPrincipalNickname, getPrincipalNickname, getPostsByUser, getRepliesToUser, getThreadsByUser, getPostsByThread } from '../utils/BackendUtils';
import PrincipalInput from '../components/PrincipalInput';
import { Principal } from '@dfinity/principal';
import { PrincipalDisplay, getPrincipalColor, getPrincipalDisplayInfoFromContext } from '../utils/PrincipalUtils';
import ConfirmationModal from '../ConfirmationModal';
import { fetchPrincipalNeuronsForSns, getOwnerPrincipals, formatNeuronIdLink } from '../utils/NeuronUtils';
import { createActor as createIcrc1Actor } from 'external/icrc1_ledger';
import { getSnsById, fetchAndCacheSnsData } from '../utils/SnsUtils';
import { formatE8s, getDissolveState, uint8ArrayToHex } from '../utils/NeuronUtils';
import { HttpAgent } from '@dfinity/agent';
import TransactionList from '../components/TransactionList';
import { useNaming } from '../NamingContext';

const validateNameInput = (input) => {
    if (!input.trim()) return 'Name cannot be empty';
    if (input.length > 32) return 'Name cannot be longer than 32 characters';
    // Only allow letters, numbers, spaces, hyphens, underscores, dots, and apostrophes
    const validPattern = /^[a-zA-Z0-9\s\-_.']+$/;
    if (!validPattern.test(input)) {
        return 'Name can only contain letters, numbers, spaces, hyphens (-), underscores (_), dots (.), and apostrophes (\')';
    }
    return '';
};

const spinKeyframes = `
@keyframes spin {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
}
`;

export default function PrincipalPage() {
    const { theme } = useTheme();
    const { identity } = useAuth();
    const { selectedSnsRoot, SNEED_SNS_ROOT } = useSns();
    const { principalNames, principalNicknames } = useNaming();
    const { createForumActor } = useForum();
    const [searchParams, setSearchParams] = useSearchParams();
    const navigate = useNavigate();
    const [principalInfo, setPrincipalInfo] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [editingName, setEditingName] = useState(false);
    const [editingNickname, setEditingNickname] = useState(false);
    const [nameInput, setNameInput] = useState('');
    const [nicknameInput, setNicknameInput] = useState('');
    const [inputError, setInputError] = useState('');
    const [nicknameError, setNicknameError] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [isSubmittingNickname, setIsSubmittingNickname] = useState(false);
    const [showConfirmModal, setShowConfirmModal] = useState(false);
    const [confirmAction, setConfirmAction] = useState(null);
    const [confirmMessage, setConfirmMessage] = useState('');
    const [neurons, setNeurons] = useState([]);
    const [loadingNeurons, setLoadingNeurons] = useState(false);
    const [neuronError, setNeuronError] = useState(null);
    const [tokenSymbol, setTokenSymbol] = useState('SNS');
    const [principalDisplayInfo, setPrincipalDisplayInfo] = useState(new Map());
    const [isNeuronsCollapsed, setIsNeuronsCollapsed] = useState(true);
    const [isTransactionsCollapsed, setIsTransactionsCollapsed] = useState(true);
    const [isPostsCollapsed, setIsPostsCollapsed] = useState(true);
    const [postsActiveTab, setPostsActiveTab] = useState('posts');
    const [userPosts, setUserPosts] = useState([]);
    const [userThreads, setUserThreads] = useState([]);
    const [loadingPosts, setLoadingPosts] = useState(false);
    const [postsError, setPostsError] = useState(null);
    const [expandedPosts, setExpandedPosts] = useState(new Set());
    const [threadPostCounts, setThreadPostCounts] = useState(new Map());
    
    // Add search state
    const [searchInput, setSearchInput] = useState('');
    const [searchLoading, setSearchLoading] = useState(false);
    const [searchResults, setSearchResults] = useState([]);
    const [showSearchResults, setShowSearchResults] = useState(false);
    
    // Keep stable references to dependencies
    const stableIdentity = useRef(identity);
    const stablePrincipalId = useRef(null);
    const searchContainerRef = useRef(null);

    const principalParam = searchParams.get('id');
    try {
        stablePrincipalId.current = principalParam ? Principal.fromText(principalParam) : null;
    } catch (e) {
        console.error('Invalid principal ID:', e);
    }

    // Initialize search input from URL parameter
    useEffect(() => {
        if (principalParam) {
            setSearchInput(principalParam);
        }
    }, [principalParam]);

    // Add click outside handler for search results
    useEffect(() => {
        const handleClickOutside = (event) => {
            if (searchContainerRef.current && !searchContainerRef.current.contains(event.target)) {
                setShowSearchResults(false);
            }
        };

        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    // Search function that can search by principal ID, name, or nickname
    const searchPrincipals = async (query) => {
        if (!query.trim()) {
            setSearchResults([]);
            setShowSearchResults(false);
            return;
        }

        console.log('Searching for:', query);
        console.log('principalNames available:', principalNames ? principalNames.size : 'undefined');
        console.log('principalNicknames available:', principalNicknames ? principalNicknames.size : 'undefined');

        setSearchLoading(true);
        try {
            const results = [];
            const searchLower = query.toLowerCase();

            // Check if it's a direct principal ID
            if (query.length >= 27 && query.includes('-')) {
                results.push({
                    type: 'direct',
                    principalId: query,
                    displayText: query,
                    score: 100
                });
            }

            // Search through cached names and nicknames only if they exist
            if (principalNames && principalNicknames) {
                console.log('Searching through cached data...');
                // Search through principal names
                for (const [principalId, name] of principalNames.entries()) {
                    if (name.toLowerCase().includes(searchLower)) {
                        const score = name.toLowerCase() === searchLower ? 100 : 
                                     name.toLowerCase().startsWith(searchLower) ? 90 : 50;
                        results.push({
                            type: 'name',
                            principalId,
                            name,
                            displayText: name,
                            score
                        });
                    }
                }

                // Search through principal nicknames
                for (const [principalId, nickname] of principalNicknames.entries()) {
                    if (nickname.toLowerCase().includes(searchLower)) {
                        const score = nickname.toLowerCase() === searchLower ? 95 : 
                                     nickname.toLowerCase().startsWith(searchLower) ? 85 : 45;
                        results.push({
                            type: 'nickname',
                            principalId,
                            nickname,
                            displayText: nickname,
                            score
                        });
                    }
                }
            } else {
                console.log('principalNames or principalNicknames not available yet');
            }

            // Remove duplicates and sort by score
            const uniqueResults = results.reduce((acc, current) => {
                const existing = acc.find(item => item.principalId === current.principalId);
                if (!existing || current.score > existing.score) {
                    return acc.filter(item => item.principalId !== current.principalId).concat(current);
                }
                return acc;
            }, []);

            // Sort by score (highest first) and limit to 10 results
            const sortedResults = uniqueResults
                .sort((a, b) => b.score - a.score)
                .slice(0, 10);

            console.log('Search results:', sortedResults);
            setSearchResults(sortedResults);
            setShowSearchResults(sortedResults.length > 0);
        } catch (error) {
            console.error('Error searching principals:', error);
            setSearchResults([]);
            setShowSearchResults(false);
        } finally {
            setSearchLoading(false);
        }
    };

    // Handle search input changes with debouncing
    useEffect(() => {
        const timeoutId = setTimeout(() => {
            if (searchInput.trim()) {
                searchPrincipals(searchInput);
            } else {
                setSearchResults([]);
                setShowSearchResults(false);
            }
        }, 300);

        return () => clearTimeout(timeoutId);
    }, [searchInput, principalNames, principalNicknames]);

    // Handle search result selection
    const handleSearchResultSelect = (result) => {
        setSearchParams({ id: result.principalId });
        setSearchInput(result.principalId);
        setShowSearchResults(false);
    };

    // Handle search form submission
    const handleSearchSubmit = (e) => {
        e.preventDefault();
        if (searchInput.trim()) {
            try {
                // Validate principal ID
                Principal.fromText(searchInput.trim());
                setSearchParams({ id: searchInput.trim() });
                setShowSearchResults(false);
            } catch (err) {
                setError('Invalid principal ID format');
            }
        }
    };

    // Update stable refs when values change
    useEffect(() => {
        stableIdentity.current = identity;
    }, [identity]);

    // Fetch initial principal info
    useEffect(() => {
        const fetchInitialPrincipalInfo = async () => {
            if (!stablePrincipalId.current) {
                setLoading(false);
                return;
            }

            try {
                // Always fetch public name, even when not logged in
                const nameResponse = await getPrincipalName(null, stablePrincipalId.current);
                console.log("NAME RESPONSE", nameResponse, stablePrincipalId.current);
                // Only fetch nickname if user is logged in
                let nicknameResponse = null;
                if (identity) {
                    nicknameResponse = await getPrincipalNickname(identity, stablePrincipalId.current);
                }

                setPrincipalInfo({
                    name: nameResponse ? nameResponse[0] : null,
                    isVerified: nameResponse ? nameResponse[1] : false,
                    nickname: nicknameResponse ? nicknameResponse[0] : null
                });
            } catch (err) {
                console.error('Error fetching principal info:', err);
                setError('Failed to load principal information');
            } finally {
                setLoading(false);
            }
        };

        fetchInitialPrincipalInfo();
    }, [identity, principalParam]);

    // Load neurons when dependencies change
    useEffect(() => {
        let mounted = true;
        let currentFetchKey = null;

        const fetchNeurons = async () => {
            const currentSnsRoot = searchParams.get('sns') || selectedSnsRoot || SNEED_SNS_ROOT;
            const currentPrincipalId = stablePrincipalId.current;

            if (!currentSnsRoot || !currentPrincipalId) {
                if (mounted) {
                    setLoadingNeurons(false);
                    setNeurons([]);
                }
                return;
            }

            const fetchKey = `${currentSnsRoot}-${currentPrincipalId.toString()}`;
            if (fetchKey === currentFetchKey) {
                return;
            }
            currentFetchKey = fetchKey;

            if (mounted) {
                setLoadingNeurons(true);
                setNeuronError(null);
            }

            try {
                const selectedSns = getSnsById(currentSnsRoot);
                if (!selectedSns) {
                    throw new Error('Selected SNS not found');
                }

                const neuronsList = await fetchPrincipalNeuronsForSns(null, selectedSns.canisters.governance, currentPrincipalId.toString());
                const relevantNeurons = neuronsList.filter(neuron => 
                    neuron.permissions.some(p => 
                        p.principal?.toString() === currentPrincipalId.toString()
                    )
                );

                if (mounted) {
                    setNeurons(relevantNeurons);

                    // Get token symbol - we can do this anonymously
                    const icrc1Actor = createIcrc1Actor(selectedSns.canisters.ledger, {
                        agentOptions: { agent: new HttpAgent() }
                    });
                    const metadata = await icrc1Actor.icrc1_metadata();
                    const symbolEntry = metadata.find(entry => entry[0] === 'icrc1:symbol');
                    if (symbolEntry && symbolEntry[1]) {
                        setTokenSymbol(symbolEntry[1].Text);
                    }
                }
            } catch (err) {
                console.error('Error fetching neurons:', err);
                if (mounted) {
                    setNeuronError('Failed to load neurons');
                }
            } finally {
                if (mounted) {
                    setLoadingNeurons(false);
                }
            }
        };

        fetchNeurons();
        return () => { mounted = false; };
    }, [identity, searchParams, principalParam, selectedSnsRoot, SNEED_SNS_ROOT]);

    // Fetch principal display info for all unique principals
    useEffect(() => {
        const fetchPrincipalInfo = async () => {
            if (!neurons.length || !principalNames || !principalNicknames) return;

            const uniquePrincipals = new Set();
            neurons.forEach(neuron => {
                // Add owner principals
                getOwnerPrincipals(neuron).forEach(p => uniquePrincipals.add(p));
                // Add all principals with permissions
                neuron.permissions.forEach(p => {
                    if (p.principal) uniquePrincipals.add(p.principal.toString());
                });
            });

            const displayInfoMap = new Map();
            Array.from(uniquePrincipals).forEach(principal => {
                const displayInfo = getPrincipalDisplayInfoFromContext(Principal.fromText(principal), principalNames, principalNicknames);
                displayInfoMap.set(principal, displayInfo);
            });

            setPrincipalDisplayInfo(displayInfoMap);
        };

        fetchPrincipalInfo();
    }, [neurons, principalNames, principalNicknames]);

    // Add effect to auto-expand neurons section if there are neurons
    useEffect(() => {
        if (neurons.length > 0) {
            setIsNeuronsCollapsed(false);  // Auto-expand if neurons exist
        }
    }, [neurons]);

    const handleNameSubmit = async () => {
        const error = validateNameInput(nameInput);
        if (error) {
            setInputError(error);
            return;
        }

        if (!nameInput.trim()) return;

        // Show confirmation dialog
        setConfirmAction(() => async () => {
            setIsSubmitting(true);
            try {
                const response = await setPrincipalName(identity, nameInput);
                if ('ok' in response) {
                    const newInfo = await getPrincipalName(identity, stablePrincipalId.current);
                    setPrincipalInfo(prev => ({
                        ...prev,
                        name: newInfo ? newInfo[0] : null,
                        isVerified: newInfo ? newInfo[1] : false
                    }));
                    setInputError('');
                } else {
                    setError(response.err);
                }
            } catch (err) {
                console.error('Error setting principal name:', err);
                setError('Failed to set principal name');
            } finally {
                setIsSubmitting(false);
                setEditingName(false);
                setNameInput('');
            }
        });
        setConfirmMessage(
            "You are about to set a public name for this principal. Please note:\n\n" +
            "• This name will be visible to everyone\n" +
            "• Only set a name if you want to help others identify you\n" +
            "• Inappropriate names can result in a user ban\n\n" +
            "Are you sure you want to proceed?"
        );
        setShowConfirmModal(true);
    };

    const handleNicknameSubmit = async () => {
        const error = validateNameInput(nicknameInput);
        if (error) {
            setNicknameError(error);
            return;
        }

        if (!nicknameInput.trim()) return;

        setIsSubmittingNickname(true);
        try {
            const response = await setPrincipalNickname(identity, stablePrincipalId.current, nicknameInput);
            if ('ok' in response) {
                // Fetch the updated nickname to ensure consistency
                const nicknameResponse = await getPrincipalNickname(identity, stablePrincipalId.current);
                setPrincipalInfo(prev => ({
                    ...prev,
                    nickname: nicknameResponse ? nicknameResponse[0] : null
                }));
                setNicknameError('');
            } else {
                setError(response.err);
            }
        } catch (err) {
            console.error('Error setting principal nickname:', err);
            setError('Failed to set principal nickname');
        } finally {
            setIsSubmittingNickname(false);
            setEditingNickname(false);
            setNicknameInput('');
        }
    };

    // Fetch posts and threads for the user
    const fetchUserPosts = useCallback(async () => {
        if (!identity || !createForumActor || !stablePrincipalId.current) return;
        
        setLoadingPosts(true);
        setPostsError(null);
        
        try {
            const forumActor = createForumActor(identity);
            const targetPrincipal = stablePrincipalId.current;
            
            // Fetch posts and threads separately
            const [postsData, threadsData] = await Promise.all([
                getPostsByUser(forumActor, targetPrincipal),
                getThreadsByUser(forumActor, targetPrincipal)
            ]);
            
            console.log('User posts:', postsData);
            console.log('User threads:', threadsData);
            
            setUserPosts(postsData || []);
            setUserThreads(threadsData || []);
            
        } catch (err) {
            console.error('Error fetching user posts:', err);
            setPostsError(err.message || 'Failed to load posts');
        } finally {
            setLoadingPosts(false);
        }
    }, [identity, createForumActor]);

    // Fetch post counts for threads asynchronously (non-blocking)
    const fetchThreadPostCounts = useCallback(async (threads) => {
        if (!identity || !createForumActor || !threads.length) return;
        
        try {
            const forumActor = createForumActor(identity);
            
            // Fetch post counts for each thread in parallel
            const countPromises = threads.map(async (thread) => {
                try {
                    const posts = await getPostsByThread(forumActor, thread.id);
                    return { threadId: thread.id, count: posts.length };
                } catch (err) {
                    console.error(`Error fetching posts for thread ${thread.id}:`, err);
                    return { threadId: thread.id, count: 0 };
                }
            });
            
            const results = await Promise.all(countPromises);
            
            // Update the post counts map
            const newCounts = new Map();
            results.forEach(({ threadId, count }) => {
                newCounts.set(threadId.toString(), count);
            });
            
            setThreadPostCounts(newCounts);
            
        } catch (err) {
            console.error('Error fetching thread post counts:', err);
        }
    }, [identity, createForumActor]);

    // Auto-fetch posts when principal changes
    useEffect(() => {
        if (stablePrincipalId.current && identity && createForumActor) {
            fetchUserPosts();
        }
    }, [searchParams.get('id'), fetchUserPosts]);

    // Fetch post counts when threads are loaded
    useEffect(() => {
        if (userThreads.length > 0) {
            fetchThreadPostCounts(userThreads);
        }
    }, [userThreads, fetchThreadPostCounts]);

    // Format vote scores (from e8s to tokens with up to 8 decimals)
    const formatScore = (score) => {
        // Convert BigInt to Number first, then convert from e8s (divide by 10^8)
        const numericScore = typeof score === 'bigint' ? Number(score) : Number(score);
        const scoreInTokens = numericScore / 100000000;
        
        if (scoreInTokens >= 1 || scoreInTokens <= -1) {
            // For values >= 1 or <= -1, show up to 2 decimal places
            return scoreInTokens.toLocaleString('en-US', {
                minimumFractionDigits: 0,
                maximumFractionDigits: 2
            });
        } else {
            // For values < 1, show up to 8 decimal places, removing trailing zeros
            return scoreInTokens.toLocaleString('en-US', {
                minimumFractionDigits: 0,
                maximumFractionDigits: 8
            });
        }
    };

    if (!stablePrincipalId.current) {
        return (
            <div className='page-container' style={{ background: theme.colors.primaryGradient, minHeight: '100vh' }}>
                <Header showSnsDropdown={true} />
                <main className="wallet-container">
                    {/* Search Section */}
                    <div 
                        ref={searchContainerRef}
                        style={{ 
                            backgroundColor: theme.colors.secondaryBg,
                            borderRadius: '8px',
                            padding: '20px',
                            marginBottom: '20px',
                            border: `1px solid ${theme.colors.border}`,
                            position: 'relative'
                        }}
                    >
                        <div style={{ 
                            display: 'flex', 
                            justifyContent: 'space-between', 
                            alignItems: 'center',
                            marginBottom: '15px'
                        }}>
                            <h2 style={{ 
                                color: theme.colors.primaryText,
                                margin: '0',
                                fontSize: '18px',
                                fontWeight: '500'
                            }}>
                                Search Principal
                            </h2>
                            {identity && (
                                <button
                                    onClick={() => {
                                        const myPrincipal = identity.getPrincipal().toString();
                                        setSearchParams({ id: myPrincipal });
                                        setSearchInput(myPrincipal);
                                        setShowSearchResults(false);
                                    }}
                                    style={{
                                        backgroundColor: theme.colors.success,
                                        color: theme.colors.primaryText,
                                        border: 'none',
                                        borderRadius: '4px',
                                        padding: '8px 12px',
                                        cursor: 'pointer',
                                        fontSize: '14px',
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: '6px'
                                    }}
                                >
                                    👤 My Principal
                                </button>
                            )}
                        </div>
                        <div style={{ maxWidth: '600px' }}>
                            <PrincipalInput
                                value={searchInput}
                                onChange={(value) => {
                                    setSearchInput(value);
                                    if (value.trim()) {
                                        try {
                                            Principal.fromText(value.trim());
                                            // Valid principal, navigate immediately
                                            setSearchParams({ id: value.trim() });
                                            setShowSearchResults(false);
                                        } catch (e) {
                                            // Invalid principal, let user continue typing or use dropdown
                                        }
                                    }
                                }}
                                placeholder="Enter principal ID or search by name"
                            />
                        </div>

                    </div>

                    <div style={{ textAlign: 'center', padding: '40px 20px' }}>
                        <h1 style={{ color: theme.colors.primaryText, marginBottom: '20px' }}>No Principal Selected</h1>
                        <p style={{ color: theme.colors.mutedText }}>Use the search box above to find a principal.</p>
                    </div>
                </main>
            </div>
        );
    }

    return (
        <div className='page-container' style={{ background: theme.colors.primaryGradient, minHeight: '100vh' }}>
            <Header showSnsDropdown={true} />
            <main className="wallet-container">
                {/* Search Section */}
                <div 
                    ref={searchContainerRef}
                    style={{ 
                        backgroundColor: theme.colors.secondaryBg,
                        borderRadius: '8px',
                        padding: '20px',
                        marginBottom: '20px',
                        border: `1px solid ${theme.colors.border}`,
                        position: 'relative'
                    }}
                >
                    <div style={{ 
                        display: 'flex', 
                        justifyContent: 'space-between', 
                        alignItems: 'center',
                        marginBottom: '15px'
                    }}>
                        <h2 style={{ 
                            color: theme.colors.primaryText,
                            margin: '0',
                            fontSize: '18px',
                            fontWeight: '500'
                        }}>
                            Search Principal
                        </h2>
                        {identity && (
                            <button
                                onClick={() => {
                                    const myPrincipal = identity.getPrincipal().toString();
                                    setSearchParams({ id: myPrincipal });
                                    setSearchInput(myPrincipal);
                                    setShowSearchResults(false);
                                }}
                                style={{
                                    backgroundColor: theme.colors.success,
                                    color: theme.colors.primaryText,
                                    border: 'none',
                                    borderRadius: '4px',
                                    padding: '8px 12px',
                                    cursor: 'pointer',
                                    fontSize: '14px',
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '6px'
                                }}
                            >
                                👤 My Principal
                            </button>
                        )}
                    </div>
                    <div style={{ maxWidth: '600px' }}>
                        <PrincipalInput
                            value={searchInput}
                            onChange={(value) => {
                                setSearchInput(value);
                                if (value.trim()) {
                                    try {
                                        Principal.fromText(value.trim());
                                        // Valid principal, navigate immediately
                                        setSearchParams({ id: value.trim() });
                                        setShowSearchResults(false);
                                    } catch (e) {
                                        // Invalid principal, let user continue typing or use dropdown
                                    }
                                }
                            }}
                            placeholder="Enter principal ID or search by name"
                        />
                    </div>

                </div>

                {!stablePrincipalId.current ? (
                    <div style={{ textAlign: 'center', padding: '40px 20px' }}>
                        <h1 style={{ color: theme.colors.primaryText, marginBottom: '20px' }}>No Principal Selected</h1>
                        <p style={{ color: theme.colors.mutedText }}>Use the search box above to find a principal.</p>
                    </div>
                ) : (
                    <>
                        <div style={{ 
                            backgroundColor: theme.colors.secondaryBg,
                            borderRadius: '8px',
                            padding: '20px',
                            marginBottom: '30px',
                            border: `1px solid ${theme.colors.border}`
                        }}>
                            {loading ? (
                                <div style={{ textAlign: 'center', padding: '20px', color: theme.colors.mutedText }}>
                                    Loading...
                                </div>
                            ) : error ? (
                                <div style={{ 
                                    backgroundColor: `${theme.colors.error}20`, 
                                    border: `1px solid ${theme.colors.error}`,
                                    color: theme.colors.error,
                                    padding: '15px',
                                    borderRadius: '6px',
                                    marginBottom: '20px'
                                }}>
                                    {error}
                                </div>
                            ) : (
                                <>
                                    <div style={{ 
                                        display: 'flex', 
                                        justifyContent: 'space-between', 
                                        alignItems: 'flex-start',
                                        flexWrap: 'wrap',
                                        gap: '15px',
                                        marginBottom: '15px'
                                    }}>
                                        <div>
                                            <h2 style={{ 
                                                color: theme.colors.primaryText,
                                                margin: '0 0 5px 0',
                                                fontSize: '18px',
                                                fontWeight: '500'
                                            }}>
                                                User Details
                                            </h2>
                                            <PrincipalDisplay 
                                                principal={stablePrincipalId.current}
                                                displayInfo={{
                                                    name: principalInfo?.name,
                                                    nickname: principalInfo?.nickname,
                                                    isVerified: principalInfo?.isVerified
                                                }}
                                                style={{
                                                    fontSize: '16px'
                                                }}
                                            />
                                        </div>
                                        <div style={{ 
                                            display: 'flex', 
                                            gap: '8px',
                                            flexWrap: 'wrap',
                                            alignItems: 'center'
                                        }}>
                                            {!editingName && !editingNickname && (
                                                <>
                                                    <button
                                                        onClick={() => setEditingNickname(true)}
                                                        style={{
                                                            backgroundColor: theme.colors.mutedText,
                                                            color: theme.colors.primaryText,
                                                            border: 'none',
                                                            borderRadius: '4px',
                                                            padding: '8px 12px',
                                                            cursor: 'pointer'
                                                        }}
                                                    >
                                                        {principalInfo?.nickname ? 'Change Nickname' : 'Set Nickname'}
                                                    </button>
                                                    {identity?.getPrincipal().toString() === stablePrincipalId.current.toString() ? (
                                                        <button
                                                            onClick={() => setEditingName(true)}
                                                            style={{
                                                                backgroundColor: '#3498db',
                                                                color: '#ffffff',
                                                                border: 'none',
                                                                borderRadius: '4px',
                                                                padding: '8px 12px',
                                                                cursor: 'pointer'
                                                            }}
                                                        >
                                                            {principalInfo?.name ? 'Change Name' : 'Set Name'}
                                                        </button>
                                                    ) : (
                                                        identity && (
                                                            <button
                                                                onClick={() => {
                                                                    // Navigate to SMS with recipient pre-filled
                                                                    const recipientPrincipal = stablePrincipalId.current.toString();
                                                                    navigate(`/sms?recipient=${encodeURIComponent(recipientPrincipal)}`);
                                                                }}
                                                                style={{
                                                                    backgroundColor: '#2ecc71',
                                                                    color: '#ffffff',
                                                                    border: 'none',
                                                                    borderRadius: '4px',
                                                                    padding: '8px 12px',
                                                                    cursor: 'pointer'
                                                                }}
                                                            >
                                                                💬 Send Message
                                                            </button>
                                                        )
                                                    )}
                                                </>
                                            )}
                                        </div>
                                    </div>

                                    {editingName && (
                                        <div style={{ 
                                            marginTop: '20px',
                                            display: 'flex',
                                            flexDirection: 'column',
                                            gap: '10px'
                                        }}>
                                            <div>
                                                <input
                                                    type="text"
                                                    value={nameInput}
                                                    onChange={(e) => {
                                                        const newValue = e.target.value;
                                                        setNameInput(newValue);
                                                        setInputError(validateNameInput(newValue));
                                                    }}
                                                    maxLength={32}
                                                    placeholder="Enter public name (max 32 chars)"
                                                    style={{
                                                        backgroundColor: '#3a3a3a',
                                                        border: `1px solid ${inputError ? '#e74c3c' : '#4a4a4a'}`,
                                                        borderRadius: '4px',
                                                        color: '#ffffff',
                                                        padding: '8px',
                                                        width: '100%'
                                                    }}
                                                />
                                                {inputError && (
                                                    <div style={{
                                                        color: '#e74c3c',
                                                        fontSize: '12px',
                                                        marginTop: '4px'
                                                    }}>
                                                        {inputError}
                                                    </div>
                                                )}
                                                <div style={{
                                                    color: '#888',
                                                    fontSize: '12px',
                                                    marginTop: '4px'
                                                }}>
                                                    Allowed: letters, numbers, spaces, hyphens (-), underscores (_), dots (.), apostrophes (')
                                                </div>
                                            </div>
                                            <div style={{
                                                display: 'flex',
                                                gap: '8px',
                                                justifyContent: 'flex-end'
                                            }}>
                                                <button
                                                    onClick={handleNameSubmit}
                                                    disabled={isSubmitting}
                                                    style={{
                                                        backgroundColor: '#3498db',
                                                        color: '#ffffff',
                                                        border: 'none',
                                                        borderRadius: '4px',
                                                        padding: '8px 12px',
                                                        cursor: isSubmitting ? 'not-allowed' : 'pointer',
                                                        opacity: isSubmitting ? 0.7 : 1,
                                                        display: 'flex',
                                                        alignItems: 'center',
                                                        gap: '6px'
                                                    }}
                                                >
                                                    {isSubmitting ? (
                                                        <>
                                                            <span style={{ 
                                                                display: 'inline-block',
                                                                animation: 'spin 1s linear infinite',
                                                                fontSize: '14px'
                                                            }}>⟳</span>
                                                            Setting...
                                                        </>
                                                    ) : (
                                                        'Set Name'
                                                    )}
                                                </button>
                                                <button
                                                    onClick={() => {
                                                        setEditingName(false);
                                                        setNameInput('');
                                                        setInputError('');
                                                    }}
                                                    disabled={isSubmitting}
                                                    style={{
                                                        backgroundColor: '#e74c3c',
                                                        color: '#ffffff',
                                                        border: 'none',
                                                        borderRadius: '4px',
                                                        padding: '8px 12px',
                                                        cursor: isSubmitting ? 'not-allowed' : 'pointer',
                                                        opacity: isSubmitting ? 0.7 : 1
                                                    }}
                                                >
                                                    Cancel
                                                </button>
                                            </div>
                                        </div>
                                    )}

                                    {editingNickname && (
                                        <div style={{ 
                                            marginTop: '20px',
                                            display: 'flex',
                                            flexDirection: 'column',
                                            gap: '10px'
                                        }}>
                                            <div>
                                                <input
                                                    type="text"
                                                    value={nicknameInput}
                                                    onChange={(e) => {
                                                        const newValue = e.target.value;
                                                        setNicknameInput(newValue);
                                                        setNicknameError(validateNameInput(newValue));
                                                    }}
                                                    maxLength={32}
                                                    placeholder="Enter private nickname (max 32 chars)"
                                                    style={{
                                                        backgroundColor: '#3a3a3a',
                                                        border: `1px solid ${nicknameError ? '#e74c3c' : '#4a4a4a'}`,
                                                        borderRadius: '4px',
                                                        color: '#ffffff',
                                                        padding: '8px',
                                                        width: '100%'
                                                    }}
                                                />
                                                {nicknameError && (
                                                    <div style={{
                                                        color: '#e74c3c',
                                                        fontSize: '12px',
                                                        marginTop: '4px'
                                                    }}>
                                                        {nicknameError}
                                                    </div>
                                                )}
                                                <div style={{
                                                    color: '#888',
                                                    fontSize: '12px',
                                                    marginTop: '4px'
                                                }}>
                                                    Allowed: letters, numbers, spaces, hyphens (-), underscores (_), dots (.), apostrophes (')
                                                </div>
                                            </div>
                                            <div style={{
                                                display: 'flex',
                                                gap: '8px',
                                                justifyContent: 'flex-end'
                                            }}>
                                                <button
                                                    onClick={handleNicknameSubmit}
                                                    disabled={isSubmittingNickname}
                                                    style={{
                                                        backgroundColor: '#95a5a6',
                                                        color: '#ffffff',
                                                        border: 'none',
                                                        borderRadius: '4px',
                                                        padding: '8px 12px',
                                                        cursor: isSubmittingNickname ? 'not-allowed' : 'pointer',
                                                        opacity: isSubmittingNickname ? 0.7 : 1,
                                                        display: 'flex',
                                                        alignItems: 'center',
                                                        gap: '6px'
                                                    }}
                                                >
                                                    {isSubmittingNickname ? (
                                                        <>
                                                            <span style={{ 
                                                                display: 'inline-block',
                                                                animation: 'spin 1s linear infinite',
                                                                fontSize: '14px'
                                                            }}>⟳</span>
                                                            Setting...
                                                        </>
                                                    ) : (
                                                        'Set Nickname'
                                                    )}
                                                </button>
                                                <button
                                                    onClick={() => {
                                                        setEditingNickname(false);
                                                        setNicknameInput('');
                                                        setNicknameError('');
                                                    }}
                                                    disabled={isSubmittingNickname}
                                                    style={{
                                                        backgroundColor: '#e74c3c',
                                                        color: '#ffffff',
                                                        border: 'none',
                                                        borderRadius: '4px',
                                                        padding: '8px 12px',
                                                        cursor: isSubmittingNickname ? 'not-allowed' : 'pointer',
                                                        opacity: isSubmittingNickname ? 0.7 : 1
                                                    }}
                                                >
                                                    Cancel
                                                </button>
                                            </div>
                                        </div>
                                    )}
                                </>
                            )}
                        </div>

                        {/* Posts & Threads Section */}
                        <div style={{ 
                            backgroundColor: '#2a2a2a',
                            borderRadius: '8px',
                            padding: '20px',
                            marginBottom: '30px',
                            border: '1px solid #3a3a3a'
                        }}>
                            <div 
                                style={{ 
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '10px',
                                    cursor: 'pointer',
                                    userSelect: 'none',
                                    marginBottom: isPostsCollapsed ? 0 : '20px'
                                }}
                                onClick={() => setIsPostsCollapsed(!isPostsCollapsed)}
                            >
                                <span style={{
                                    fontSize: '18px',
                                    color: '#888',
                                    transition: 'transform 0.2s',
                                    transform: isPostsCollapsed ? 'rotate(-90deg)' : 'none'
                                }}>
                                    ▼
                                </span>
                                <h2 style={{ 
                                    color: '#ffffff',
                                    fontSize: '18px',
                                    fontWeight: '500',
                                    margin: 0
                                }}>
                                    Posts & Threads
                                </h2>
                            </div>

                            {!isPostsCollapsed && (
                                <>
                                    {/* Tab Navigation */}
                                    <div style={{
                                        display: 'flex',
                                        borderBottom: '1px solid #3a3a3a',
                                        marginBottom: '20px'
                                    }}>
                                        <button
                                            onClick={() => setPostsActiveTab('posts')}
                                            style={{
                                                backgroundColor: 'transparent',
                                                border: 'none',
                                                color: postsActiveTab === 'posts' ? '#3498db' : '#888',
                                                fontSize: '16px',
                                                fontWeight: '500',
                                                padding: '10px 20px',
                                                cursor: 'pointer',
                                                borderBottom: postsActiveTab === 'posts' ? '2px solid #3498db' : '2px solid transparent',
                                                transition: 'all 0.2s'
                                            }}
                                        >
                                            Posts ({userPosts.length})
                                        </button>
                                        <button
                                            onClick={() => setPostsActiveTab('threads')}
                                            style={{
                                                backgroundColor: 'transparent',
                                                border: 'none',
                                                color: postsActiveTab === 'threads' ? '#3498db' : '#888',
                                                fontSize: '16px',
                                                fontWeight: '500',
                                                padding: '10px 20px',
                                                cursor: 'pointer',
                                                borderBottom: postsActiveTab === 'threads' ? '2px solid #3498db' : '2px solid transparent',
                                                transition: 'all 0.2s'
                                            }}
                                        >
                                            Threads ({userThreads.length})
                                        </button>
                                    </div>

                                    {/* Content */}
                                    {loadingPosts ? (
                                        <div style={{ textAlign: 'center', padding: '20px', color: '#888' }}>
                                            Loading posts...
                                        </div>
                                    ) : postsError ? (
                                        <div style={{ 
                                            backgroundColor: 'rgba(231, 76, 60, 0.2)', 
                                            border: '1px solid #e74c3c',
                                            color: '#e74c3c',
                                            padding: '15px',
                                            borderRadius: '6px',
                                            marginBottom: '20px'
                                        }}>
                                            Error: {postsError}
                                        </div>
                                    ) : (
                                        <div>
                                            {postsActiveTab === 'posts' ? (
                                                userPosts.length === 0 ? (
                                                    <div style={{ textAlign: 'center', padding: '20px', color: '#888' }}>
                                                        No posts found
                                                    </div>
                                                ) : (
                                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
                                                        {userPosts.map((post) => {
                                                            const isExpanded = expandedPosts.has(post.id);
                                                            const shouldTruncate = post.body && post.body.length > 300;
                                                            const displayBody = shouldTruncate && !isExpanded 
                                                                ? post.body.substring(0, 300) + '...' 
                                                                : post.body;

                                                            const toggleExpanded = (postId) => {
                                                                setExpandedPosts(prev => {
                                                                    const newSet = new Set(prev);
                                                                    if (newSet.has(postId)) {
                                                                        newSet.delete(postId);
                                                                    } else {
                                                                        newSet.add(postId);
                                                                    }
                                                                    return newSet;
                                                                });
                                                            };

                                                            return (
                                                                <div key={post.id} style={{
                                                                    backgroundColor: '#1a1a1a',
                                                                    border: '1px solid #3a3a3a',
                                                                    borderRadius: '6px',
                                                                    padding: '15px'
                                                                }}>
                                                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '10px' }}>
                                                                        <Link 
                                                                            to={`/post?postid=${post.id}`}
                                                                            style={{
                                                                                color: '#3c6382',
                                                                                textDecoration: 'none',
                                                                                fontWeight: '600',
                                                                                fontSize: '14px',
                                                                                padding: '2px 4px',
                                                                                borderRadius: '3px',
                                                                                backgroundColor: 'rgba(60, 99, 130, 0.1)',
                                                                                border: '1px solid rgba(60, 99, 130, 0.3)'
                                                                            }}
                                                                            onMouseEnter={(e) => {
                                                                                e.target.style.textDecoration = 'underline';
                                                                                e.target.style.backgroundColor = 'rgba(60, 99, 130, 0.2)';
                                                                            }}
                                                                            onMouseLeave={(e) => {
                                                                                e.target.style.textDecoration = 'none';
                                                                                e.target.style.backgroundColor = 'rgba(60, 99, 130, 0.1)';
                                                                            }}
                                                                        >
                                                                            #{Number(post.id)}
                                                                        </Link>
                                                                        <div style={{ color: '#888', fontSize: '12px', textAlign: 'right' }}>
                                                                            {new Date(Number(post.created_at) / 1000000).toLocaleDateString()}
                                                                            <br />
                                                                            <span style={{ color: Number(post.upvote_score) - Number(post.downvote_score) >= 0 ? '#27ae60' : '#e74c3c' }}>
                                                                                {Number(post.upvote_score) - Number(post.downvote_score) >= 0 ? '+' : ''}{formatScore(Number(post.upvote_score) - Number(post.downvote_score))}
                                                                            </span>
                                                                            {' '}
                                                                            <span style={{ color: '#666' }}>
                                                                                (↑{formatScore(post.upvote_score)} ↓{formatScore(post.downvote_score)})
                                                                            </span>
                                                                        </div>
                                                                    </div>
                                                                    {post.title && post.title.length > 0 && (
                                                                        <div style={{ 
                                                                            color: '#fff', 
                                                                            fontSize: '16px',
                                                                            fontWeight: '500',
                                                                            marginBottom: '10px'
                                                                        }}>
                                                                            {post.title[0]}
                                                                        </div>
                                                                    )}
                                                                    <div style={{ color: '#ccc', fontSize: '14px', lineHeight: '1.5' }}>
                                                                        {displayBody}
                                                                        {shouldTruncate && (
                                                                            <button
                                                                                onClick={() => toggleExpanded(post.id)}
                                                                                style={{
                                                                                    background: 'none',
                                                                                    border: 'none',
                                                                                    color: '#3498db',
                                                                                    cursor: 'pointer',
                                                                                    fontSize: '14px',
                                                                                    marginLeft: '5px',
                                                                                    textDecoration: 'underline'
                                                                                }}
                                                                            >
                                                                                {isExpanded ? 'Show Less' : 'Show More'}
                                                                            </button>
                                                                        )}
                                                                    </div>
                                                                </div>
                                                            );
                                                        })}
                                                    </div>
                                                )
                                            ) : (
                                                userThreads.length === 0 ? (
                                                    <div style={{ textAlign: 'center', padding: '20px', color: '#888' }}>
                                                        No threads found
                                                    </div>
                                                ) : (
                                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
                                                        {userThreads.map((thread) => {
                                                            const isExpanded = expandedPosts.has(`thread-${thread.id}`);
                                                            const shouldTruncate = thread.body && thread.body.length > 300;
                                                            const displayBody = shouldTruncate && !isExpanded 
                                                                ? thread.body.substring(0, 300) + '...' 
                                                                : thread.body;

                                                            const toggleExpanded = (threadId) => {
                                                                setExpandedPosts(prev => {
                                                                    const newSet = new Set(prev);
                                                                    if (newSet.has(threadId)) {
                                                                        newSet.delete(threadId);
                                                                    } else {
                                                                        newSet.add(threadId);
                                                                    }
                                                                    return newSet;
                                                                });
                                                            };

                                                            return (
                                                                <div key={thread.id} style={{
                                                                    backgroundColor: '#1a1a1a',
                                                                    border: '1px solid #3a3a3a',
                                                                    borderRadius: '6px',
                                                                    padding: '15px'
                                                                }}>
                                                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '10px' }}>
                                                                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                                                            <Link 
                                                                                to={`/thread?threadid=${thread.id}`}
                                                                                style={{
                                                                                    color: '#3c6382',
                                                                                    textDecoration: 'none',
                                                                                    fontWeight: '600',
                                                                                    fontSize: '14px',
                                                                                    padding: '2px 4px',
                                                                                    borderRadius: '3px',
                                                                                    backgroundColor: 'rgba(60, 99, 130, 0.1)',
                                                                                    border: '1px solid rgba(60, 99, 130, 0.3)'
                                                                                }}
                                                                                onMouseEnter={(e) => {
                                                                                    e.target.style.textDecoration = 'underline';
                                                                                    e.target.style.backgroundColor = 'rgba(60, 99, 130, 0.2)';
                                                                                }}
                                                                                onMouseLeave={(e) => {
                                                                                    e.target.style.textDecoration = 'none';
                                                                                    e.target.style.backgroundColor = 'rgba(60, 99, 130, 0.1)';
                                                                                }}
                                                                            >
                                                                                Thread #{Number(thread.id)}
                                                                            </Link>
                                                                            <span style={{ color: '#27ae60', fontSize: '12px' }}>Created</span>
                                                                        </div>
                                                                        <div style={{ color: '#888', fontSize: '12px', textAlign: 'right' }}>
                                                                            {new Date(Number(thread.created_at) / 1000000).toLocaleDateString()}
                                                                            <br />
                                                                            {(() => {
                                                                                const postCount = threadPostCounts.get(thread.id.toString());
                                                                                return postCount !== undefined ? (
                                                                                    <span style={{ color: '#888', fontSize: '11px' }}>
                                                                                        {postCount} post{postCount !== 1 ? 's' : ''}
                                                                                    </span>
                                                                                ) : (
                                                                                    <span style={{ color: '#666', fontSize: '10px', fontStyle: 'italic' }}>
                                                                                        Loading...
                                                                                    </span>
                                                                                );
                                                                            })()}
                                                                        </div>
                                                                    </div>
                                                                    {thread.title && (
                                                                        <div style={{ 
                                                                            color: '#fff', 
                                                                            fontSize: '16px',
                                                                            fontWeight: '500',
                                                                            marginBottom: '10px'
                                                                        }}>
                                                                            {thread.title}
                                                                        </div>
                                                                    )}
                                                                    <div style={{ color: '#ccc', fontSize: '14px', lineHeight: '1.5' }}>
                                                                        {displayBody}
                                                                        {shouldTruncate && (
                                                                            <button
                                                                                onClick={() => toggleExpanded(`thread-${thread.id}`)}
                                                                                style={{
                                                                                    background: 'none',
                                                                                    border: 'none',
                                                                                    color: '#3498db',
                                                                                    cursor: 'pointer',
                                                                                    fontSize: '14px',
                                                                                    marginLeft: '5px',
                                                                                    textDecoration: 'underline'
                                                                                }}
                                                                            >
                                                                                {isExpanded ? 'Show Less' : 'Show More'}
                                                                            </button>
                                                                        )}
                                                                    </div>
                                                                </div>
                                                            );
                                                        })}
                                                    </div>
                                                )
                                            )}
                                        </div>
                                    )}
                                </>
                            )}
                        </div>

                        <div style={{ 
                            backgroundColor: '#2a2a2a',
                            borderRadius: '8px',
                            padding: '20px',
                            marginBottom: '30px',
                            border: '1px solid #3a3a3a'
                        }}>
                            <div 
                                style={{ 
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '10px',
                                    cursor: 'pointer',
                                    userSelect: 'none',
                                    marginBottom: isNeuronsCollapsed ? 0 : '20px'
                                }}
                                onClick={() => setIsNeuronsCollapsed(!isNeuronsCollapsed)}
                            >
                                <span style={{
                                    fontSize: '18px',
                                    color: '#888',
                                    transition: 'transform 0.2s',
                                    transform: isNeuronsCollapsed ? 'rotate(-90deg)' : 'none'
                                }}>
                                    ▼
                                </span>
                                <h2 style={{ 
                                    color: '#ffffff',
                                    fontSize: '18px',
                                    fontWeight: '500',
                                    margin: 0
                                }}>
                                    Hotkeyed Neurons
                                </h2>
                            </div>

                            {!isNeuronsCollapsed && (
                                <>
                                    {loadingNeurons ? (
                                        <div style={{ textAlign: 'center', padding: '20px', color: '#888' }}>
                                            Loading neurons...
                                        </div>
                                    ) : neuronError ? (
                                        <div style={{ 
                                            backgroundColor: 'rgba(231, 76, 60, 0.2)', 
                                            border: '1px solid #e74c3c',
                                            color: '#e74c3c',
                                            padding: '15px',
                                            borderRadius: '6px',
                                            marginBottom: '20px'
                                        }}>
                                            {neuronError}
                                        </div>
                                    ) : neurons.length === 0 ? (
                                        <div style={{ textAlign: 'center', padding: '20px', color: '#888' }}>
                                            No neurons found where this principal is a hotkey.
                                        </div>
                                    ) : (
                                        <div style={{ 
                                            display: 'grid',
                                            gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))',
                                            gap: '20px'
                                        }}>
                                            {neurons.map((neuron) => {
                                                const neuronId = uint8ArrayToHex(neuron.id[0]?.id);
                                                if (!neuronId) return null;

                                                return (
                                                    <div
                                                        key={neuronId}
                                                        style={{
                                                            backgroundColor: '#2a2a2a',
                                                            borderRadius: '8px',
                                                            padding: '20px',
                                                            border: '1px solid #3a3a3a'
                                                        }}
                                                    >
                                                        <div style={{ marginBottom: '15px' }}>
                                                            <div style={{ 
                                                                display: 'flex', 
                                                                alignItems: 'flex-start',
                                                                gap: '8px',
                                                                marginBottom: '10px',
                                                                flexWrap: 'wrap'
                                                            }}>
                                                                {formatNeuronIdLink(neuronId, searchParams.get('sns') || selectedSnsRoot || SNEED_SNS_ROOT)}
                                                            </div>
                                                        </div>

                                                        <div style={{ marginBottom: '20px' }}>
                                                            <div style={{ 
                                                                fontSize: '24px',
                                                                fontWeight: 'bold',
                                                                color: '#3498db'
                                                            }}>
                                                                {formatE8s(neuron.cached_neuron_stake_e8s)} {tokenSymbol}
                                                            </div>
                                                        </div>

                                                        <div style={{ 
                                                            display: 'grid',
                                                            gridTemplateColumns: '1fr 1fr',
                                                            gap: '15px',
                                                            fontSize: '14px'
                                                        }}>
                                                            <div>
                                                                <div style={{ color: '#888' }}>Created</div>
                                                                <div style={{ color: '#ffffff' }}>
                                                                    {new Date(Number(neuron.created_timestamp_seconds) * 1000).toLocaleDateString()}
                                                                </div>
                                                            </div>
                                                            <div>
                                                                <div style={{ color: '#888' }}>Dissolve State</div>
                                                                <div style={{ color: '#ffffff' }}>{getDissolveState(neuron)}</div>
                                                            </div>
                                                            <div>
                                                                <div style={{ color: '#888' }}>Maturity</div>
                                                                <div style={{ color: '#ffffff' }}>{formatE8s(neuron.maturity_e8s_equivalent)} {tokenSymbol}</div>
                                                            </div>
                                                            <div>
                                                                <div style={{ color: '#888' }}>Voting Power</div>
                                                                <div style={{ color: '#ffffff' }}>{(Number(neuron.voting_power_percentage_multiplier) / 100).toFixed(2)}x</div>
                                                            </div>
                                                            {/* Add permissions section */}
                                                            <div style={{ gridColumn: '1 / -1' }}>
                                                                <div style={{ color: '#888', marginBottom: '8px' }}>Permissions</div>
                                                                {/* Owner */}
                                                                {getOwnerPrincipals(neuron).length > 0 && (
                                                                    <div style={{ 
                                                                        marginBottom: '8px',
                                                                        display: 'flex',
                                                                        alignItems: 'center',
                                                                        gap: '8px'
                                                                    }}>
                                                                        <span style={{ color: '#888' }}>Owner:</span>
                                                                        <PrincipalDisplay 
                                                                            principal={Principal.fromText(getOwnerPrincipals(neuron)[0])}
                                                                            displayInfo={principalDisplayInfo.get(getOwnerPrincipals(neuron)[0])}
                                                                            showCopyButton={false}
                                                                        />
                                                                    </div>
                                                                )}
                                                                {/* Hotkeys */}
                                                                {neuron.permissions
                                                                    .filter(p => !getOwnerPrincipals(neuron).includes(p.principal?.toString()))
                                                                    .map((p, index) => (
                                                                        <div key={index} style={{ 
                                                                            display: 'flex',
                                                                            alignItems: 'center',
                                                                            gap: '8px',
                                                                            marginBottom: index < neuron.permissions.length - 1 ? '8px' : 0
                                                                        }}>
                                                                            <span style={{ color: '#888', display: 'flex', alignItems: 'center', gap: '4px' }}>
                                                                                🔑 Hotkey:
                                                                            </span>
                                                                            <PrincipalDisplay 
                                                                                principal={p.principal}
                                                                                displayInfo={principalDisplayInfo.get(p.principal?.toString())}
                                                                                showCopyButton={false}
                                                                            />
                                                                        </div>
                                                                    ))
                                                                }
                                                            </div>
                                                        </div>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    )}
                                </>
                            )}
                        </div>

                        {/* Wrap TransactionList with collapse state */}
                        <TransactionList 
                            snsRootCanisterId={searchParams.get('sns') || selectedSnsRoot || SNEED_SNS_ROOT}
                            principalId={stablePrincipalId.current?.toString()}
                            isCollapsed={isTransactionsCollapsed}
                            onToggleCollapse={() => setIsTransactionsCollapsed(!isTransactionsCollapsed)}
                        />
                    </>
                )}
            </main>
            <style>{spinKeyframes}</style>
            <ConfirmationModal
                show={showConfirmModal}
                onClose={() => setShowConfirmModal(false)}
                onSubmit={confirmAction}
                message={confirmMessage}
                doAwait={true}
            />
        </div>
    );
} 