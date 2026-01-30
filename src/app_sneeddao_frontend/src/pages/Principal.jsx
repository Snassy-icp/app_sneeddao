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
import { getSnsById, fetchAndCacheSnsData, fetchSnsLogo, getAllSnses } from '../utils/SnsUtils';
import { formatE8s, getDissolveState, uint8ArrayToHex } from '../utils/NeuronUtils';
import { HttpAgent } from '@dfinity/agent';
import TransactionList from '../components/TransactionList';
import { useNaming } from '../NamingContext';
import usePremiumStatus, { PremiumBadge } from '../hooks/usePremiumStatus';
import MarkdownBody from '../components/MarkdownBody';
import { FaUser, FaSearch, FaEdit, FaPen, FaComments, FaNewspaper, FaCoins, FaExchangeAlt, FaChevronDown, FaChevronUp, FaEnvelope, FaCrown, FaKey, FaCheckCircle, FaTimesCircle, FaCopy, FaCheck, FaArrowUp, FaArrowDown, FaNetworkWired, FaCube, FaExternalLinkAlt, FaBrain } from 'react-icons/fa';

// Helper to determine if a principal is a canister (shorter) or user (longer)
const isCanisterPrincipal = (principalStr) => {
    if (!principalStr) return false;
    return principalStr.length <= 30;
};

// Custom CSS for animations
const customStyles = `
@keyframes shimmer {
    0% { background-position: -200% 0; }
    100% { background-position: 200% 0; }
}

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

@keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.7; }
}

@keyframes float {
    0%, 100% { transform: translateY(0px); }
    50% { transform: translateY(-6px); }
}

@keyframes spin {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
}

.principal-card-animate {
    animation: fadeInUp 0.5s ease-out forwards;
    opacity: 0;
}

.principal-shimmer {
    background: linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.08) 50%, transparent 100%);
    background-size: 200% 100%;
    animation: shimmer 2s infinite;
}

.principal-pulse {
    animation: pulse 2s ease-in-out infinite;
}

.principal-float {
    animation: float 4s ease-in-out infinite;
}

.principal-spin {
    animation: spin 1s linear infinite;
}
`;

// Accent colors for the Principal page
const principalPrimary = '#3b82f6'; // Blue
const principalSecondary = '#6366f1'; // Indigo
const principalAccent = '#8b5cf6'; // Purple

const validateNameInput = (input) => {
    if (!input.trim()) return 'Name cannot be empty';
    if (input.length > 32) return 'Name cannot be longer than 32 characters';
    const validPattern = /^[a-zA-Z0-9\s\-_.']+$/;
    if (!validPattern.test(input)) {
        return 'Name can only contain letters, numbers, spaces, hyphens (-), underscores (_), dots (.), and apostrophes (\')';
    }
    return '';
};

export default function PrincipalPage() {
    const { theme } = useTheme();
    const { identity, isAuthenticated } = useAuth();
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
    const [activeTab, setActiveTab] = useState('posts'); // 'posts', 'neurons', 'transactions'
    const [postsActiveTab, setPostsActiveTab] = useState('posts');
    const [userPosts, setUserPosts] = useState([]);
    const [userThreads, setUserThreads] = useState([]);
    const [loadingPosts, setLoadingPosts] = useState(false);
    const [postsError, setPostsError] = useState(null);
    const [expandedPosts, setExpandedPosts] = useState(new Set());
    const [threadPostCounts, setThreadPostCounts] = useState(new Map());
    const [copiedPrincipal, setCopiedPrincipal] = useState(false);
    
    // SNS Banner state
    const [snsInfo, setSnsInfo] = useState(null);
    const [snsLogo, setSnsLogo] = useState(null);
    const [loadingLogo, setLoadingLogo] = useState(false);
    
    // Search state
    const [searchInput, setSearchInput] = useState('');
    const [searchLoading, setSearchLoading] = useState(false);
    const [searchResults, setSearchResults] = useState([]);
    const [showSearchResults, setShowSearchResults] = useState(false);
    const [isSearchFocused, setIsSearchFocused] = useState(false);
    
    // Stable references
    const stableIdentity = useRef(identity);
    const stablePrincipalId = useRef(null);
    const searchContainerRef = useRef(null);

    const principalParam = searchParams.get('id');
    
    // Check premium status for the viewed principal
    const { isPremium: viewedUserIsPremium, loading: premiumLoading } = usePremiumStatus(
        identity, 
        principalParam ? Principal.fromText(principalParam) : null
    );
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

    // Click outside handler for search results
    useEffect(() => {
        const handleClickOutside = (event) => {
            if (searchContainerRef.current && !searchContainerRef.current.contains(event.target)) {
                setShowSearchResults(false);
            }
        };

        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    // Search function
    const searchPrincipals = async (query) => {
        if (!query.trim()) {
            setSearchResults([]);
            setShowSearchResults(false);
            return;
        }

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

            // Search through cached names and nicknames
            if (principalNames && principalNicknames) {
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
            }

            // Remove duplicates and sort by score
            const uniqueResults = results.reduce((acc, current) => {
                const existing = acc.find(item => item.principalId === current.principalId);
                if (!existing || current.score > existing.score) {
                    return acc.filter(item => item.principalId !== current.principalId).concat(current);
                }
                return acc;
            }, []);

            const sortedResults = uniqueResults
                .sort((a, b) => b.score - a.score)
                .slice(0, 10);

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

    // Load SNS info and logo for banner
    useEffect(() => {
        const loadSnsInfo = async () => {
            if (!selectedSnsRoot) {
                setSnsInfo(null);
                setSnsLogo(null);
                return;
            }

            try {
                const allSnses = getAllSnses();
                const currentSns = allSnses.find(sns => sns.rootCanisterId === selectedSnsRoot);
                
                if (currentSns) {
                    setSnsInfo(currentSns);
                    
                    if (currentSns.canisters?.governance) {
                        setLoadingLogo(true);
                        try {
                            const host = process.env.DFX_NETWORK === 'ic' || process.env.DFX_NETWORK === 'staging' ? 'https://ic0.app' : 'http://localhost:4943';
                            const agent = new HttpAgent({ host, ...(identity && { identity }) });
                            if (process.env.DFX_NETWORK !== 'ic') {
                                await agent.fetchRootKey();
                            }
                            const logo = await fetchSnsLogo(currentSns.canisters.governance, agent);
                            setSnsLogo(logo);
                        } catch (err) {
                            console.error('Error loading SNS logo:', err);
                        } finally {
                            setLoadingLogo(false);
                        }
                    }
                }
            } catch (error) {
                console.error('Error loading SNS info:', error);
            }
        };

        loadSnsInfo();
    }, [selectedSnsRoot, identity]);

    // Fetch initial principal info
    useEffect(() => {
        const fetchInitialPrincipalInfo = async () => {
            if (!stablePrincipalId.current) {
                setLoading(false);
                return;
            }

            try {
                const nameResponse = await getPrincipalName(null, stablePrincipalId.current);
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
                getOwnerPrincipals(neuron).forEach(p => uniquePrincipals.add(p));
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

    // Auto-expand neurons section if there are neurons
    useEffect(() => {
        if (neurons.length > 0) {
            setIsNeuronsCollapsed(false);
        }
    }, [neurons]);

    const handleNameSubmit = async () => {
        const error = validateNameInput(nameInput);
        if (error) {
            setInputError(error);
            return;
        }

        if (!nameInput.trim()) return;

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
            
            const [postsData, threadsData] = await Promise.all([
                getPostsByUser(forumActor, targetPrincipal),
                getThreadsByUser(forumActor, targetPrincipal)
            ]);
            
            setUserPosts(postsData || []);
            setUserThreads(threadsData || []);
            
        } catch (err) {
            console.error('Error fetching user posts:', err);
            setPostsError(err.message || 'Failed to load posts');
        } finally {
            setLoadingPosts(false);
        }
    }, [identity, createForumActor]);

    // Fetch post counts for threads asynchronously
    const fetchThreadPostCounts = useCallback(async (threads) => {
        if (!identity || !createForumActor || !threads.length) return;
        
        try {
            const forumActor = createForumActor(identity);
            
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

    // Format vote scores
    const formatScore = (score) => {
        const numericScore = typeof score === 'bigint' ? Number(score) : Number(score);
        const scoreInTokens = numericScore / 100000000;
        
        if (scoreInTokens >= 1 || scoreInTokens <= -1) {
            return scoreInTokens.toLocaleString('en-US', {
                minimumFractionDigits: 0,
                maximumFractionDigits: 2
            });
        } else {
            return scoreInTokens.toLocaleString('en-US', {
                minimumFractionDigits: 0,
                maximumFractionDigits: 8
            });
        }
    };

    // Copy principal to clipboard
    const copyPrincipal = async () => {
        if (!stablePrincipalId.current) return;
        try {
            await navigator.clipboard.writeText(stablePrincipalId.current.toString());
            setCopiedPrincipal(true);
            setTimeout(() => setCopiedPrincipal(false), 2000);
        } catch (err) {
            console.error('Failed to copy:', err);
        }
    };

    // Render search section
    const renderSearchSection = () => (
        <div 
            ref={searchContainerRef}
            className="principal-card-animate"
            style={{ 
                background: `linear-gradient(135deg, ${theme.colors.secondaryBg} 0%, ${principalPrimary}10 100%)`,
                borderRadius: '16px',
                padding: '1.5rem',
                marginBottom: '1.5rem',
                border: `1px solid ${theme.colors.border}`,
                position: 'relative',
                animationDelay: '0.1s'
            }}
        >
            <div style={{ 
                display: 'flex', 
                justifyContent: 'space-between', 
                alignItems: 'center',
                marginBottom: '1rem',
                flexWrap: 'wrap',
                gap: '1rem'
            }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <div style={{
                        width: '40px',
                        height: '40px',
                        borderRadius: '10px',
                        background: `linear-gradient(135deg, ${principalPrimary}30, ${principalSecondary}20)`,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        color: principalPrimary
                    }}>
                        <FaSearch size={18} />
                    </div>
                    <h2 style={{ 
                        color: theme.colors.primaryText,
                        margin: '0',
                        fontSize: '1.25rem',
                        fontWeight: '600'
                    }}>
                        Search Users
                    </h2>
                </div>
                {identity && (
                    <button
                        onClick={() => {
                            const myPrincipal = identity.getPrincipal().toString();
                            setSearchParams({ id: myPrincipal });
                            setSearchInput(myPrincipal);
                            setShowSearchResults(false);
                        }}
                        style={{
                            background: `linear-gradient(135deg, ${theme.colors.success}, ${theme.colors.success}dd)`,
                            color: 'white',
                            border: 'none',
                            borderRadius: '10px',
                            padding: '10px 16px',
                            cursor: 'pointer',
                            fontSize: '0.9rem',
                            fontWeight: '600',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '8px',
                            boxShadow: `0 4px 15px ${theme.colors.success}40`,
                            transition: 'all 0.2s ease'
                        }}
                    >
                        <FaUser size={14} />
                        My Principal
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
                                setSearchParams({ id: value.trim() });
                                setShowSearchResults(false);
                                setIsSearchFocused(false);
                            } catch (e) {
                                // Invalid principal, let user continue typing
                            }
                        }
                    }}
                    placeholder="Search users by name or principal ID"
                    isAuthenticated={isAuthenticated}
                    defaultPrincipalType="users"
                    onFocus={() => setIsSearchFocused(true)}
                    onBlur={() => setTimeout(() => setIsSearchFocused(false), 200)}
                />
            </div>
        </div>
    );

    // Render icon with SNS logo badge in corner (like sneedex_offers)
    const renderOverlappedIcon = (icon, size = 36, iconSize = 16, color = principalPrimary) => (
        <div style={{ 
            position: 'relative', 
            width: `${size}px`, 
            height: `${size}px`,
            borderRadius: '10px',
            background: `linear-gradient(135deg, ${color}30, ${color}15)`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: color
        }}>
            {/* Main icon */}
            {icon}
            {/* SNS Logo badge in corner */}
            {snsLogo && (
                <img 
                    src={snsLogo} 
                    alt="" 
                    style={{
                        position: 'absolute',
                        bottom: -3,
                        right: -3,
                        width: '16px',
                        height: '16px',
                        borderRadius: '50%',
                        objectFit: 'cover',
                        border: `2px solid ${theme.colors.secondaryBg}`,
                        boxShadow: '0 1px 3px rgba(0,0,0,0.2)'
                    }}
                />
            )}
        </div>
    );

    // Render collapsible section header
    // If icon is a React element with position:relative (overlapped icon), render it directly
    // Otherwise wrap it in a styled container
    const renderSectionHeader = (title, icon, isCollapsed, onToggle, count = null, color = principalPrimary, isOverlappedIcon = false) => (
        <button
            onClick={onToggle}
            style={{
                width: '100%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '1rem 1.25rem',
                background: `linear-gradient(135deg, ${theme.colors.secondaryBg} 0%, ${color}10 100%)`,
                border: `1px solid ${theme.colors.border}`,
                borderRadius: isCollapsed ? '16px' : '16px 16px 0 0',
                cursor: 'pointer',
                color: theme.colors.primaryText,
                transition: 'all 0.2s ease'
            }}
        >
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                {isOverlappedIcon ? icon : (
                    <div style={{
                        width: '36px',
                        height: '36px',
                        borderRadius: '10px',
                        background: `linear-gradient(135deg, ${color}30, ${color}15)`,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        color: color
                    }}>
                        {icon}
                    </div>
                )}
                <div style={{ textAlign: 'left' }}>
                    <div style={{ fontWeight: '600', fontSize: '1rem' }}>{title}</div>
                    {count !== null && (
                        <div style={{ color: theme.colors.mutedText, fontSize: '0.8rem' }}>
                            {count} item{count !== 1 ? 's' : ''}
                        </div>
                    )}
                </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ color: theme.colors.mutedText, fontSize: '0.8rem' }}>
                    {isCollapsed ? 'Show' : 'Hide'}
                </span>
                {isCollapsed ? <FaChevronDown size={14} /> : <FaChevronUp size={14} />}
            </div>
        </button>
    );

    // Render the hero banner
    const renderHeroBanner = () => (
        <div style={{
            background: `linear-gradient(135deg, ${theme.colors.primaryBg} 0%, ${principalPrimary}15 50%, ${principalSecondary}10 100%)`,
            borderBottom: `1px solid ${theme.colors.border}`,
            padding: '2rem',
            position: 'relative',
            overflow: 'hidden'
        }}>
            {/* Background decorations */}
            <div style={{
                position: 'absolute',
                top: '-50%',
                right: '-10%',
                width: '400px',
                height: '400px',
                background: `radial-gradient(circle, ${principalPrimary}20 0%, transparent 70%)`,
                borderRadius: '50%',
                pointerEvents: 'none'
            }} />
            <div style={{
                position: 'absolute',
                bottom: '-30%',
                left: '-5%',
                width: '300px',
                height: '300px',
                background: `radial-gradient(circle, ${principalSecondary}15 0%, transparent 70%)`,
                borderRadius: '50%',
                pointerEvents: 'none'
            }} />
            
            <div style={{ maxWidth: '1200px', margin: '0 auto', position: 'relative', zIndex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '1.25rem', marginBottom: '1rem' }}>
                    {/* SNS Logo */}
                    <div style={{
                        width: '56px',
                        height: '56px',
                        minWidth: '56px',
                        maxWidth: '56px',
                        flexShrink: 0,
                        borderRadius: '14px',
                        overflow: 'hidden'
                    }}>
                        {loadingLogo ? (
                            <div style={{
                                width: '100%',
                                height: '100%',
                                background: theme.colors.tertiaryBg,
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center'
                            }}>
                                <span className="principal-pulse" style={{ color: theme.colors.mutedText }}>...</span>
                            </div>
                        ) : snsLogo ? (
                            <img 
                                src={snsLogo} 
                                alt={snsInfo?.name || 'SNS'} 
                                style={{ width: '100%', height: '100%', objectFit: 'cover' }} 
                            />
                        ) : (
                            <div style={{
                                width: '100%',
                                height: '100%',
                                background: `linear-gradient(135deg, ${principalPrimary}, ${principalSecondary})`,
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                boxShadow: `0 4px 20px ${principalPrimary}40`
                            }}>
                                <FaUser size={24} color="white" />
                            </div>
                        )}
                    </div>
                    
                    <div style={{ flex: 1, minWidth: 0 }}>
                        <h1 style={{ 
                            color: theme.colors.primaryText, 
                            fontSize: '1.75rem', 
                            fontWeight: '700', 
                            margin: 0,
                            display: 'flex',
                            alignItems: 'center',
                            gap: '12px',
                            flexWrap: 'wrap'
                        }}>
                            {snsInfo ? `${snsInfo.name}` : ''} User Explorer
                        </h1>
                        <p style={{ 
                            color: theme.colors.secondaryText, 
                            fontSize: '0.95rem', 
                            margin: '0.35rem 0 0 0' 
                        }}>
                            Search for any user to view their profile, neurons, posts, and transactions
                        </p>
                    </div>
                </div>
                
                {/* Quick Stats Row */}
                <div style={{ display: 'flex', gap: '1.5rem', flexWrap: 'wrap', marginTop: '0.75rem' }}>
                    {snsInfo && (
                        <div style={{ 
                            display: 'flex', 
                            alignItems: 'center', 
                            gap: '8px',
                            color: theme.colors.secondaryText,
                            fontSize: '0.9rem'
                        }}>
                            <FaNetworkWired style={{ color: principalPrimary }} />
                            <span>Viewing <strong style={{ color: theme.colors.primaryText }}>{snsInfo.name}</strong> context</span>
                        </div>
                    )}
                    {tokenSymbol && tokenSymbol !== 'SNS' && (
                        <div style={{ 
                            display: 'flex', 
                            alignItems: 'center', 
                            gap: '8px',
                            color: theme.colors.secondaryText,
                            fontSize: '0.9rem'
                        }}>
                            <FaCoins style={{ color: principalAccent }} />
                            <span><strong style={{ color: theme.colors.primaryText }}>{tokenSymbol}</strong> token</span>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );

    // No principal selected view
    if (!stablePrincipalId.current) {
        return (
            <div className='page-container' style={{ background: theme.colors.primaryGradient, minHeight: '100vh' }}>
                <style>{customStyles}</style>
                <Header showSnsDropdown={true} />
                
                <main style={{ minHeight: '100vh' }}>
                    {renderHeroBanner()}
                    
                    <div style={{ maxWidth: '1200px', margin: '0 auto', padding: '2rem' }}>
                        {renderSearchSection()}

                        <div style={{
                            textAlign: 'center',
                            padding: '3rem',
                            background: theme.colors.secondaryBg,
                            borderRadius: '16px',
                            border: `1px solid ${theme.colors.border}`
                        }}>
                            <FaSearch size={48} style={{ color: theme.colors.mutedText, marginBottom: '1rem', opacity: 0.5 }} />
                            <h2 style={{ color: theme.colors.primaryText, marginBottom: '0.5rem', fontSize: '1.25rem' }}>No Principal Selected</h2>
                            <p style={{ color: theme.colors.mutedText }}>Use the search box above to find a principal.</p>
                        </div>
                    </div>
                </main>
            </div>
        );
    }

    return (
        <div className='page-container' style={{ background: theme.colors.primaryGradient, minHeight: '100vh' }}>
            <style>{customStyles}</style>
            <Header showSnsDropdown={true} />
            
            <main style={{ minHeight: '100vh' }}>
                {renderHeroBanner()}
                
                <div style={{ maxWidth: '1200px', margin: '0 auto', padding: '2rem' }}>
                    {/* Search Section - only show when focused or no principal selected */}
                    {(isSearchFocused || !stablePrincipalId.current) && renderSearchSection()}

                    {/* Search Another button - show when principal selected and search hidden */}
                    {stablePrincipalId.current && !isSearchFocused && (
                        <button
                            onClick={() => {
                                setSearchInput('');
                                setSearchParams({});
                            }}
                            style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '8px',
                                background: `${principalPrimary}15`,
                                color: principalPrimary,
                                border: `1px solid ${principalPrimary}30`,
                                borderRadius: '10px',
                                padding: '10px 16px',
                                fontSize: '0.9rem',
                                fontWeight: '500',
                                cursor: 'pointer',
                                marginBottom: '1rem',
                                transition: 'all 0.2s ease'
                            }}
                            onMouseOver={(e) => {
                                e.currentTarget.style.background = `${principalPrimary}25`;
                                e.currentTarget.style.borderColor = `${principalPrimary}50`;
                            }}
                            onMouseOut={(e) => {
                                e.currentTarget.style.background = `${principalPrimary}15`;
                                e.currentTarget.style.borderColor = `${principalPrimary}30`;
                            }}
                        >
                            <FaSearch size={14} />
                            Search Another User
                        </button>
                    )}

                {/* Principal Profile Card */}
                <div
                    className="principal-card-animate"
                    style={{ 
                        background: `linear-gradient(135deg, ${theme.colors.secondaryBg} 0%, ${principalPrimary}08 100%)`,
                        borderRadius: '20px',
                        padding: '2rem',
                        marginBottom: '1.5rem',
                        border: `1px solid ${theme.colors.border}`,
                        position: 'relative',
                        overflow: 'hidden',
                        animationDelay: '0.2s'
                    }}
                >
                    {/* Background decoration */}
                    <div style={{
                        position: 'absolute',
                        top: '-30%',
                        right: '-5%',
                        width: '300px',
                        height: '300px',
                        background: `radial-gradient(circle, ${principalPrimary}15 0%, transparent 70%)`,
                        borderRadius: '50%',
                        pointerEvents: 'none'
                    }} />

                    {loading ? (
                        <div style={{ textAlign: 'center', padding: '2rem', color: theme.colors.mutedText }}>
                            <div className="principal-spin" style={{
                                width: '40px',
                                height: '40px',
                                border: `3px solid ${theme.colors.border}`,
                                borderTopColor: principalPrimary,
                                borderRadius: '50%',
                                margin: '0 auto 1rem'
                            }} />
                            Loading profile...
                        </div>
                    ) : error ? (
                        <div style={{ 
                            background: `${theme.colors.error}15`,
                            border: `1px solid ${theme.colors.error}40`,
                            color: theme.colors.error,
                            padding: '1rem',
                            borderRadius: '12px'
                        }}>
                            {error}
                        </div>
                    ) : (
                        <div style={{ position: 'relative', zIndex: 1 }}>
                            {/* Profile Header */}
                            <div style={{ 
                                display: 'flex', 
                                justifyContent: 'space-between', 
                                alignItems: 'flex-start',
                                flexWrap: 'wrap',
                                gap: '1.5rem',
                                marginBottom: '1.5rem'
                            }}>
                                <div style={{ display: 'flex', alignItems: 'flex-start', gap: '1.25rem' }}>
                                    {/* Avatar - show crown for premium, user icon, or canister icon */}
                                    {(() => {
                                        const principalStr = stablePrincipalId.current.toString();
                                        const isCanister = isCanisterPrincipal(principalStr);
                                        const isPremium = viewedUserIsPremium && !premiumLoading;
                                        
                                        // Premium users get a golden gradient
                                        const bgGradient = isPremium && !isCanister
                                            ? 'linear-gradient(135deg, #f59e0b, #d97706)'
                                            : `linear-gradient(135deg, ${getPrincipalColor(principalStr)}, ${getPrincipalColor(principalStr)}aa)`;
                                        const shadowColor = isPremium && !isCanister
                                            ? 'rgba(245, 158, 11, 0.4)'
                                            : `${getPrincipalColor(principalStr)}40`;
                                        
                                        return (
                                            <div style={{
                                                width: '72px',
                                                height: '72px',
                                                minWidth: '72px',
                                                borderRadius: isCanister ? '12px' : '18px',
                                                background: bgGradient,
                                                display: 'flex',
                                                alignItems: 'center',
                                                justifyContent: 'center',
                                                color: 'white',
                                                boxShadow: `0 4px 20px ${shadowColor}`
                                            }}>
                                                {isCanister ? <FaCube size={32} /> : (isPremium ? <FaCrown size={32} /> : <FaUser size={32} />)}
                                            </div>
                                        );
                                    })()}
                                    
                                    <div style={{ flex: 1, minWidth: 0 }}>
                                        {/* Public Name / Canister Type Badge */}
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '6px', flexWrap: 'wrap' }}>
                                            <h2 style={{ 
                                                color: theme.colors.primaryText,
                                                margin: '0',
                                                fontSize: '1.5rem',
                                                fontWeight: '700',
                                                lineHeight: '1.2'
                                            }}>
                                                {principalInfo?.name || (isCanisterPrincipal(stablePrincipalId.current.toString()) ? 'Canister' : 'Anonymous')}
                                            </h2>
                                            {isCanisterPrincipal(stablePrincipalId.current.toString()) && (
                                                <span style={{
                                                    background: `${principalAccent}20`,
                                                    color: principalAccent,
                                                    padding: '4px 10px',
                                                    borderRadius: '12px',
                                                    fontSize: '0.75rem',
                                                    fontWeight: '600',
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    gap: '4px'
                                                }}>
                                                    <FaCube size={10} />
                                                    Canister
                                                </span>
                                            )}
                                            {viewedUserIsPremium && !premiumLoading && (
                                                <PremiumBadge size="small" />
                                            )}
                                            {principalInfo?.isVerified && (
                                                <FaCheckCircle size={16} color={theme.colors.success} title="Verified" />
                                            )}
                                        </div>
                                        
                                        {/* Link to /canister page for canisters */}
                                        {isCanisterPrincipal(stablePrincipalId.current.toString()) && (
                                            <Link
                                                to={`/canister?id=${stablePrincipalId.current.toString()}`}
                                                style={{
                                                    display: 'inline-flex',
                                                    alignItems: 'center',
                                                    gap: '6px',
                                                    color: principalPrimary,
                                                    fontSize: '0.85rem',
                                                    textDecoration: 'none',
                                                    marginBottom: '8px',
                                                    padding: '4px 0'
                                                }}
                                            >
                                                <FaExternalLinkAlt size={10} />
                                                View Canister Details
                                            </Link>
                                        )}
                                        
                                        {/* Private Nickname - only show if different from name */}
                                        {principalInfo?.nickname && principalInfo.nickname !== principalInfo?.name && (
                                            <div style={{ 
                                                color: theme.colors.mutedText, 
                                                fontSize: '0.85rem', 
                                                marginBottom: '8px',
                                                display: 'flex',
                                                alignItems: 'center',
                                                gap: '6px'
                                            }}>
                                                <span style={{ opacity: 0.7 }}>Your nickname:</span>
                                                <span style={{ 
                                                    color: theme.colors.secondaryText,
                                                    fontWeight: '500',
                                                    background: `${principalPrimary}15`,
                                                    padding: '2px 8px',
                                                    borderRadius: '4px'
                                                }}>
                                                    {principalInfo.nickname}
                                                </span>
                                            </div>
                                        )}
                                        
                                        {/* Principal ID with copy */}
                                        <div style={{ 
                                            display: 'inline-flex', 
                                            alignItems: 'center', 
                                            gap: '8px',
                                            background: theme.colors.primaryBg,
                                            padding: '6px 12px',
                                            borderRadius: '8px'
                                        }}>
                                            <code style={{ 
                                                color: theme.colors.secondaryText, 
                                                fontSize: '0.8rem'
                                            }}>
                                                {stablePrincipalId.current.toString().slice(0, 12)}...{stablePrincipalId.current.toString().slice(-8)}
                                            </code>
                                            <button
                                                onClick={copyPrincipal}
                                                style={{
                                                    background: 'none',
                                                    border: 'none',
                                                    cursor: 'pointer',
                                                    color: copiedPrincipal ? theme.colors.success : theme.colors.mutedText,
                                                    padding: '4px',
                                                    display: 'flex',
                                                    alignItems: 'center'
                                                }}
                                                title="Copy principal ID"
                                            >
                                                {copiedPrincipal ? <FaCheck size={12} /> : <FaCopy size={12} />}
                                            </button>
                                        </div>
                                    </div>
                                </div>

                                {/* Action Buttons */}
                                <div style={{ 
                                    display: 'flex', 
                                    gap: '0.5rem',
                                    flexWrap: 'wrap'
                                }}>
                                    {!editingName && !editingNickname && (
                                        <>
                                            <button
                                                onClick={() => setEditingNickname(true)}
                                                style={{
                                                    background: theme.colors.primaryBg,
                                                    color: theme.colors.primaryText,
                                                    border: `1px solid ${theme.colors.border}`,
                                                    borderRadius: '10px',
                                                    padding: '10px 16px',
                                                    cursor: 'pointer',
                                                    fontSize: '0.9rem',
                                                    fontWeight: '500',
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    gap: '8px',
                                                    transition: 'all 0.2s ease'
                                                }}
                                            >
                                                <FaPen size={12} />
                                                {principalInfo?.nickname ? 'Edit Nickname' : 'Set Nickname'}
                                            </button>
                                            {identity?.getPrincipal().toString() === stablePrincipalId.current.toString() ? (
                                                <button
                                                    onClick={() => setEditingName(true)}
                                                    style={{
                                                        background: `linear-gradient(135deg, ${principalPrimary}, ${principalSecondary})`,
                                                        color: 'white',
                                                        border: 'none',
                                                        borderRadius: '10px',
                                                        padding: '10px 16px',
                                                        cursor: 'pointer',
                                                        fontSize: '0.9rem',
                                                        fontWeight: '600',
                                                        display: 'flex',
                                                        alignItems: 'center',
                                                        gap: '8px',
                                                        boxShadow: `0 4px 15px ${principalPrimary}40`
                                                    }}
                                                >
                                                    <FaEdit size={12} />
                                                    {principalInfo?.name ? 'Change Name' : 'Set Name'}
                                                </button>
                                            ) : (
                                                identity && (
                                                    <button
                                                        onClick={() => {
                                                            const recipientPrincipal = stablePrincipalId.current.toString();
                                                            navigate(`/sms?recipient=${encodeURIComponent(recipientPrincipal)}`);
                                                        }}
                                                        style={{
                                                            background: `linear-gradient(135deg, ${theme.colors.success}, ${theme.colors.success}dd)`,
                                                            color: 'white',
                                                            border: 'none',
                                                            borderRadius: '10px',
                                                            padding: '10px 16px',
                                                            cursor: 'pointer',
                                                            fontSize: '0.9rem',
                                                            fontWeight: '600',
                                                            display: 'flex',
                                                            alignItems: 'center',
                                                            gap: '8px',
                                                            boxShadow: `0 4px 15px ${theme.colors.success}40`
                                                        }}
                                                    >
                                                        <FaEnvelope size={12} />
                                                        Send Message
                                                    </button>
                                                )
                                            )}
                                        </>
                                    )}
                                </div>
                            </div>

                            {/* Nickname Editing Form */}
                            {editingNickname && (
                                <div style={{ 
                                    background: theme.colors.primaryBg,
                                    borderRadius: '12px',
                                    padding: '1.25rem',
                                    marginTop: '1rem'
                                }}>
                                    <div style={{ marginBottom: '1rem' }}>
                                        <label style={{ color: theme.colors.secondaryText, fontSize: '0.85rem', marginBottom: '6px', display: 'block' }}>
                                            Private Nickname (only visible to you)
                                        </label>
                                        <input
                                            type="text"
                                            value={nicknameInput}
                                            onChange={(e) => {
                                                setNicknameInput(e.target.value);
                                                setNicknameError(validateNameInput(e.target.value));
                                            }}
                                            maxLength={32}
                                            placeholder="Enter private nickname (max 32 chars)"
                                            style={{
                                                width: '100%',
                                                background: theme.colors.secondaryBg,
                                                border: `1px solid ${nicknameError ? theme.colors.error : theme.colors.border}`,
                                                borderRadius: '8px',
                                                color: theme.colors.primaryText,
                                                padding: '10px 14px',
                                                fontSize: '0.95rem',
                                                boxSizing: 'border-box'
                                            }}
                                        />
                                        {nicknameError && (
                                            <div style={{ color: theme.colors.error, fontSize: '0.8rem', marginTop: '6px' }}>
                                                {nicknameError}
                                            </div>
                                        )}
                                    </div>
                                    <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
                                        <button
                                            onClick={() => {
                                                setEditingNickname(false);
                                                setNicknameInput('');
                                                setNicknameError('');
                                            }}
                                            style={{
                                                background: theme.colors.secondaryBg,
                                                color: theme.colors.primaryText,
                                                border: `1px solid ${theme.colors.border}`,
                                                borderRadius: '8px',
                                                padding: '8px 16px',
                                                cursor: 'pointer',
                                                fontSize: '0.9rem'
                                            }}
                                        >
                                            Cancel
                                        </button>
                                        <button
                                            onClick={handleNicknameSubmit}
                                            disabled={isSubmittingNickname || nicknameError}
                                            style={{
                                                background: principalPrimary,
                                                color: 'white',
                                                border: 'none',
                                                borderRadius: '8px',
                                                padding: '8px 16px',
                                                cursor: isSubmittingNickname ? 'not-allowed' : 'pointer',
                                                fontSize: '0.9rem',
                                                fontWeight: '600',
                                                opacity: isSubmittingNickname ? 0.7 : 1
                                            }}
                                        >
                                            {isSubmittingNickname ? 'Saving...' : 'Save Nickname'}
                                        </button>
                                    </div>
                                </div>
                            )}

                            {/* Name Editing Form */}
                            {editingName && (
                                <div style={{ 
                                    background: theme.colors.primaryBg,
                                    borderRadius: '12px',
                                    padding: '1.25rem',
                                    marginTop: '1rem'
                                }}>
                                    <div style={{ marginBottom: '1rem' }}>
                                        <label style={{ color: theme.colors.secondaryText, fontSize: '0.85rem', marginBottom: '6px', display: 'block' }}>
                                            Public Name (visible to everyone)
                                        </label>
                                        <input
                                            type="text"
                                            value={nameInput}
                                            onChange={(e) => {
                                                setNameInput(e.target.value);
                                                setInputError(validateNameInput(e.target.value));
                                            }}
                                            maxLength={32}
                                            placeholder="Enter public name (max 32 chars)"
                                            style={{
                                                width: '100%',
                                                background: theme.colors.secondaryBg,
                                                border: `1px solid ${inputError ? theme.colors.error : theme.colors.border}`,
                                                borderRadius: '8px',
                                                color: theme.colors.primaryText,
                                                padding: '10px 14px',
                                                fontSize: '0.95rem',
                                                boxSizing: 'border-box'
                                            }}
                                        />
                                        {inputError && (
                                            <div style={{ color: theme.colors.error, fontSize: '0.8rem', marginTop: '6px' }}>
                                                {inputError}
                                            </div>
                                        )}
                                        <div style={{ color: theme.colors.mutedText, fontSize: '0.75rem', marginTop: '6px' }}>
                                            Allowed: letters, numbers, spaces, hyphens (-), underscores (_), dots (.), apostrophes (')
                                        </div>
                                    </div>
                                    <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
                                        <button
                                            onClick={() => {
                                                setEditingName(false);
                                                setNameInput('');
                                                setInputError('');
                                            }}
                                            style={{
                                                background: theme.colors.secondaryBg,
                                                color: theme.colors.primaryText,
                                                border: `1px solid ${theme.colors.border}`,
                                                borderRadius: '8px',
                                                padding: '8px 16px',
                                                cursor: 'pointer',
                                                fontSize: '0.9rem'
                                            }}
                                        >
                                            Cancel
                                        </button>
                                        <button
                                            onClick={handleNameSubmit}
                                            disabled={isSubmitting || inputError}
                                            style={{
                                                background: `linear-gradient(135deg, ${principalPrimary}, ${principalSecondary})`,
                                                color: 'white',
                                                border: 'none',
                                                borderRadius: '8px',
                                                padding: '8px 16px',
                                                cursor: isSubmitting ? 'not-allowed' : 'pointer',
                                                fontSize: '0.9rem',
                                                fontWeight: '600',
                                                opacity: isSubmitting ? 0.7 : 1
                                            }}
                                        >
                                            {isSubmitting ? 'Saving...' : 'Set Name'}
                                        </button>
                                    </div>
                                </div>
                            )}
                        </div>
                    )}
                </div>

                {/* Tab Navigation */}
                <div 
                    className="principal-card-animate"
                    style={{
                        display: 'flex',
                        flexWrap: 'wrap',
                        gap: '0.5rem',
                        marginBottom: '1.5rem',
                        background: theme.colors.secondaryBg,
                        borderRadius: '16px',
                        padding: '0.5rem',
                        border: `1px solid ${theme.colors.border}`,
                        animationDelay: '0.3s'
                    }}
                >
                    <button
                        onClick={() => setActiveTab('posts')}
                        style={{
                            flex: '1 1 auto',
                            minWidth: '100px',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            gap: '0.5rem',
                            padding: '0.75rem 0.75rem',
                            borderRadius: '12px',
                            border: 'none',
                            cursor: 'pointer',
                            fontWeight: '600',
                            fontSize: '0.9rem',
                            transition: 'all 0.2s ease',
                            background: activeTab === 'posts' 
                                ? `linear-gradient(135deg, ${theme.colors.success}, ${principalPrimary})`
                                : 'transparent',
                            color: activeTab === 'posts' 
                                ? 'white' 
                                : theme.colors.secondaryText,
                        }}
                    >
                        <FaComments size={14} />
                        <span>Posts & Threads</span>
                    </button>
                    <button
                        onClick={() => setActiveTab('neurons')}
                        style={{
                            flex: '1 1 auto',
                            minWidth: '100px',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            gap: '0.5rem',
                            padding: '0.75rem 0.75rem',
                            borderRadius: '12px',
                            border: 'none',
                            cursor: 'pointer',
                            fontWeight: '600',
                            fontSize: '0.9rem',
                            transition: 'all 0.2s ease',
                            background: activeTab === 'neurons' 
                                ? `linear-gradient(135deg, ${principalAccent}, ${principalSecondary})`
                                : 'transparent',
                            color: activeTab === 'neurons' 
                                ? 'white' 
                                : theme.colors.secondaryText,
                        }}
                    >
                        <FaBrain size={14} />
                        <span>Hotkeyed Neurons</span>
                    </button>
                    <button
                        onClick={() => setActiveTab('transactions')}
                        style={{
                            flex: '1 1 auto',
                            minWidth: '100px',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            gap: '0.5rem',
                            padding: '0.75rem 0.75rem',
                            borderRadius: '12px',
                            border: 'none',
                            cursor: 'pointer',
                            fontWeight: '600',
                            fontSize: '0.9rem',
                            transition: 'all 0.2s ease',
                            background: activeTab === 'transactions' 
                                ? `linear-gradient(135deg, ${principalSecondary}, ${principalPrimary})`
                                : 'transparent',
                            color: activeTab === 'transactions' 
                                ? 'white' 
                                : theme.colors.secondaryText,
                        }}
                    >
                        <FaExchangeAlt size={14} />
                        <span>Transactions</span>
                    </button>
                </div>

                {/* Tab Content */}
                <div 
                    className="principal-card-animate"
                    style={{
                        background: theme.colors.secondaryBg,
                        borderRadius: '16px',
                        border: `1px solid ${theme.colors.border}`,
                        overflow: 'hidden',
                        transition: 'all 0.3s ease',
                        animationDelay: '0.4s'
                    }}
                >
                    {/* Posts & Threads Tab */}
                    {activeTab === 'posts' && (
                        <div style={{ padding: '1.25rem' }}>
                            {/* Sub-tab Navigation */}
                            <div style={{
                                display: 'flex',
                                borderBottom: `1px solid ${theme.colors.border}`,
                                marginBottom: '1.25rem'
                            }}>
                                <button
                                    onClick={() => setPostsActiveTab('posts')}
                                    style={{
                                        background: 'transparent',
                                        border: 'none',
                                        color: postsActiveTab === 'posts' ? principalPrimary : theme.colors.mutedText,
                                        fontSize: '0.95rem',
                                        fontWeight: '600',
                                        padding: '12px 20px',
                                        cursor: 'pointer',
                                        borderBottom: postsActiveTab === 'posts' ? `2px solid ${principalPrimary}` : '2px solid transparent',
                                        transition: 'all 0.2s'
                                    }}
                                >
                                    Posts ({userPosts.length})
                                </button>
                                <button
                                    onClick={() => setPostsActiveTab('threads')}
                                    style={{
                                        background: 'transparent',
                                        border: 'none',
                                        color: postsActiveTab === 'threads' ? principalPrimary : theme.colors.mutedText,
                                        fontSize: '0.95rem',
                                        fontWeight: '600',
                                        padding: '12px 20px',
                                        cursor: 'pointer',
                                        borderBottom: postsActiveTab === 'threads' ? `2px solid ${principalPrimary}` : '2px solid transparent',
                                        transition: 'all 0.2s'
                                    }}
                                >
                                    Threads ({userThreads.length})
                                </button>
                            </div>

                            {loadingPosts ? (
                                <div style={{ textAlign: 'center', padding: '2rem', color: theme.colors.mutedText }}>
                                    <div className="principal-spin" style={{
                                        width: '30px',
                                        height: '30px',
                                        border: `3px solid ${theme.colors.border}`,
                                        borderTopColor: principalPrimary,
                                        borderRadius: '50%',
                                        margin: '0 auto 1rem'
                                    }} />
                                    Loading posts...
                                </div>
                            ) : postsError ? (
                                <div style={{ 
                                    background: `${theme.colors.error}15`,
                                    border: `1px solid ${theme.colors.error}40`,
                                    color: theme.colors.error,
                                    padding: '1rem',
                                    borderRadius: '10px'
                                }}>
                                    {postsError}
                                </div>
                            ) : (
                                <div>
                                    {postsActiveTab === 'posts' ? (
                                        userPosts.length === 0 ? (
                                            <div style={{ textAlign: 'center', padding: '2rem', color: theme.colors.mutedText }}>
                                                No posts found
                                            </div>
                                        ) : (
                                            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                                                {userPosts.map((post) => {
                                                    const isExpanded = expandedPosts.has(post.id);
                                                    const shouldTruncate = post.body && post.body.length > 300;
                                                    const displayBody = shouldTruncate && !isExpanded 
                                                        ? post.body.substring(0, 300) + '...' 
                                                        : post.body;
                                                    const netScore = Number(post.upvote_score) - Number(post.downvote_score);

                                                    return (
                                                        <div key={post.id} style={{
                                                            background: theme.colors.primaryBg,
                                                            border: `1px solid ${theme.colors.border}`,
                                                            borderRadius: '12px',
                                                            padding: '1rem'
                                                        }}>
                                                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.75rem' }}>
                                                                <Link 
                                                                    to={`/post?postid=${post.id}`}
                                                                    style={{
                                                                        color: principalPrimary,
                                                                        textDecoration: 'none',
                                                                        fontWeight: '600',
                                                                        fontSize: '0.9rem',
                                                                        padding: '4px 10px',
                                                                        borderRadius: '6px',
                                                                        background: `${principalPrimary}15`,
                                                                        transition: 'all 0.2s'
                                                                    }}
                                                                >
                                                                    #{Number(post.id)}
                                                                </Link>
                                                                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                                                                    <span style={{ 
                                                                        color: netScore >= 0 ? theme.colors.success : theme.colors.error,
                                                                        fontWeight: '600',
                                                                        fontSize: '0.9rem',
                                                                        display: 'flex',
                                                                        alignItems: 'center',
                                                                        gap: '4px'
                                                                    }}>
                                                                        {netScore >= 0 ? <FaArrowUp size={12} /> : <FaArrowDown size={12} />}
                                                                        {formatScore(netScore)}
                                                                    </span>
                                                                    <span style={{ color: theme.colors.mutedText, fontSize: '0.8rem' }}>
                                                                        {new Date(Number(post.created_at) / 1000000).toLocaleDateString()}
                                                                    </span>
                                                                </div>
                                                            </div>
                                                            {post.title && post.title.length > 0 && (
                                                                <div style={{ 
                                                                    color: theme.colors.primaryText, 
                                                                    fontSize: '1rem',
                                                                    fontWeight: '600',
                                                                    marginBottom: '0.5rem'
                                                                }}>
                                                                    {post.title[0]}
                                                                </div>
                                                            )}
                                                            <div style={{ color: theme.colors.secondaryText, fontSize: '0.9rem', lineHeight: '1.6' }}>
                                                                <MarkdownBody text={displayBody} style={{ fontSize: '0.9rem' }} />
                                                                {shouldTruncate && (
                                                                    <button
                                                                        onClick={() => setExpandedPosts(prev => {
                                                                            const newSet = new Set(prev);
                                                                            if (newSet.has(post.id)) newSet.delete(post.id);
                                                                            else newSet.add(post.id);
                                                                            return newSet;
                                                                        })}
                                                                        style={{
                                                                            background: 'none',
                                                                            border: 'none',
                                                                            color: principalPrimary,
                                                                            cursor: 'pointer',
                                                                            fontSize: '0.85rem',
                                                                            fontWeight: '500',
                                                                            marginLeft: '4px'
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
                                            <div style={{ textAlign: 'center', padding: '2rem', color: theme.colors.mutedText }}>
                                                No threads found
                                            </div>
                                        ) : (
                                            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                                                {userThreads.map((thread) => {
                                                    const isExpanded = expandedPosts.has(`thread-${thread.id}`);
                                                    const shouldTruncate = thread.body && thread.body.length > 300;
                                                    const displayBody = shouldTruncate && !isExpanded 
                                                        ? thread.body.substring(0, 300) + '...' 
                                                        : thread.body;
                                                    const postCount = threadPostCounts.get(thread.id.toString());

                                                    return (
                                                        <div key={thread.id} style={{
                                                            background: theme.colors.primaryBg,
                                                            border: `1px solid ${theme.colors.border}`,
                                                            borderRadius: '12px',
                                                            padding: '1rem'
                                                        }}>
                                                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.75rem' }}>
                                                                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                                                                    <Link 
                                                                        to={`/thread?threadid=${thread.id}`}
                                                                        style={{
                                                                            color: principalPrimary,
                                                                            textDecoration: 'none',
                                                                            fontWeight: '600',
                                                                            fontSize: '0.9rem',
                                                                            padding: '4px 10px',
                                                                            borderRadius: '6px',
                                                                            background: `${principalPrimary}15`
                                                                        }}
                                                                    >
                                                                        Thread #{Number(thread.id)}
                                                                    </Link>
                                                                    <span style={{ 
                                                                        color: theme.colors.success, 
                                                                        fontSize: '0.75rem',
                                                                        fontWeight: '600',
                                                                        background: `${theme.colors.success}15`,
                                                                        padding: '2px 8px',
                                                                        borderRadius: '4px'
                                                                    }}>
                                                                        Created
                                                                    </span>
                                                                </div>
                                                                <div style={{ textAlign: 'right' }}>
                                                                    <div style={{ color: theme.colors.mutedText, fontSize: '0.8rem' }}>
                                                                        {new Date(Number(thread.created_at) / 1000000).toLocaleDateString()}
                                                                    </div>
                                                                    <div style={{ color: theme.colors.secondaryText, fontSize: '0.75rem' }}>
                                                                        {postCount !== undefined ? `${postCount} post${postCount !== 1 ? 's' : ''}` : 'Loading...'}
                                                                    </div>
                                                                </div>
                                                            </div>
                                                            {thread.title && (
                                                                <div style={{ 
                                                                    color: theme.colors.primaryText, 
                                                                    fontSize: '1rem',
                                                                    fontWeight: '600',
                                                                    marginBottom: '0.5rem'
                                                                }}>
                                                                    {thread.title}
                                                                </div>
                                                            )}
                                                            <div style={{ color: theme.colors.secondaryText, fontSize: '0.9rem', lineHeight: '1.6' }}>
                                                                <MarkdownBody text={displayBody} style={{ fontSize: '0.9rem' }} />
                                                                {shouldTruncate && (
                                                                    <button
                                                                        onClick={() => setExpandedPosts(prev => {
                                                                            const newSet = new Set(prev);
                                                                            const key = `thread-${thread.id}`;
                                                                            if (newSet.has(key)) newSet.delete(key);
                                                                            else newSet.add(key);
                                                                            return newSet;
                                                                        })}
                                                                        style={{
                                                                            background: 'none',
                                                                            border: 'none',
                                                                            color: principalPrimary,
                                                                            cursor: 'pointer',
                                                                            fontSize: '0.85rem',
                                                                            fontWeight: '500',
                                                                            marginLeft: '4px'
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
                        </div>
                    )}

                    {/* Neurons Tab */}
                    {activeTab === 'neurons' && (
                        <div style={{ padding: '1.25rem' }}>
                            {loadingNeurons ? (
                                <div style={{ textAlign: 'center', padding: '2rem', color: theme.colors.mutedText }}>
                                    <div className="principal-spin" style={{
                                        width: '30px',
                                        height: '30px',
                                        border: `3px solid ${theme.colors.border}`,
                                        borderTopColor: principalAccent,
                                        borderRadius: '50%',
                                        margin: '0 auto 1rem'
                                    }} />
                                    Loading neurons...
                                </div>
                            ) : neuronError ? (
                                <div style={{ 
                                    background: `${theme.colors.error}15`,
                                    border: `1px solid ${theme.colors.error}40`,
                                    color: theme.colors.error,
                                    padding: '1rem',
                                    borderRadius: '10px'
                                }}>
                                    {neuronError}
                                </div>
                            ) : neurons.length === 0 ? (
                                <div style={{ textAlign: 'center', padding: '2rem', color: theme.colors.mutedText }}>
                                    No neurons found where this principal is a hotkey.
                                </div>
                            ) : (
                                <div style={{ 
                                    display: 'grid',
                                    gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))',
                                    gap: '1rem'
                                }}>
                                    {neurons.map((neuron) => {
                                        const neuronId = uint8ArrayToHex(neuron.id[0]?.id);
                                        if (!neuronId) return null;

                                        return (
                                            <div
                                                key={neuronId}
                                                style={{
                                                    background: `linear-gradient(135deg, ${theme.colors.primaryBg} 0%, ${principalAccent}08 100%)`,
                                                    borderRadius: '14px',
                                                    padding: '1.25rem',
                                                    border: `1px solid ${theme.colors.border}`
                                                }}
                                            >
                                                <div style={{ marginBottom: '1rem' }}>
                                                    {formatNeuronIdLink(neuronId, searchParams.get('sns') || selectedSnsRoot || SNEED_SNS_ROOT)}
                                                </div>

                                                <div style={{ 
                                                    fontSize: '1.5rem',
                                                    fontWeight: '700',
                                                    color: principalAccent,
                                                    marginBottom: '1rem'
                                                }}>
                                                    {formatE8s(neuron.cached_neuron_stake_e8s)} {tokenSymbol}
                                                </div>

                                                <div style={{ 
                                                    display: 'grid',
                                                    gridTemplateColumns: '1fr 1fr',
                                                    gap: '1rem',
                                                    fontSize: '0.85rem'
                                                }}>
                                                    <div>
                                                        <div style={{ color: theme.colors.mutedText, marginBottom: '2px' }}>Created</div>
                                                        <div style={{ color: theme.colors.primaryText, fontWeight: '500' }}>
                                                            {new Date(Number(neuron.created_timestamp_seconds) * 1000).toLocaleDateString()}
                                                        </div>
                                                    </div>
                                                    <div>
                                                        <div style={{ color: theme.colors.mutedText, marginBottom: '2px' }}>Dissolve State</div>
                                                        <div style={{ color: theme.colors.primaryText, fontWeight: '500' }}>{getDissolveState(neuron)}</div>
                                                    </div>
                                                    <div>
                                                        <div style={{ color: theme.colors.mutedText, marginBottom: '2px' }}>Maturity</div>
                                                        <div style={{ color: theme.colors.primaryText, fontWeight: '500' }}>{formatE8s(neuron.maturity_e8s_equivalent)} {tokenSymbol}</div>
                                                    </div>
                                                    <div>
                                                        <div style={{ color: theme.colors.mutedText, marginBottom: '2px' }}>Voting Power</div>
                                                        <div style={{ color: theme.colors.primaryText, fontWeight: '500' }}>{(Number(neuron.voting_power_percentage_multiplier) / 100).toFixed(2)}x</div>
                                                    </div>
                                                </div>

                                                {/* Permissions */}
                                                <div style={{ marginTop: '1rem', paddingTop: '1rem', borderTop: `1px solid ${theme.colors.border}` }}>
                                                    <div style={{ color: theme.colors.mutedText, fontSize: '0.8rem', marginBottom: '0.5rem' }}>Permissions</div>
                                                    {getOwnerPrincipals(neuron).length > 0 && (
                                                        <div style={{ 
                                                            display: 'flex',
                                                            alignItems: 'center',
                                                            gap: '8px',
                                                            marginBottom: '6px'
                                                        }}>
                                                            <FaCrown size={12} color={principalAccent} title="Owner" />
                                                            <PrincipalDisplay 
                                                                principal={Principal.fromText(getOwnerPrincipals(neuron)[0])}
                                                                displayInfo={principalDisplayInfo.get(getOwnerPrincipals(neuron)[0])}
                                                                showCopyButton={false}
                                                                isAuthenticated={isAuthenticated}
                                                            />
                                                        </div>
                                                    )}
                                                    {neuron.permissions
                                                        .filter(p => !getOwnerPrincipals(neuron).includes(p.principal?.toString()))
                                                        .map((p, index) => (
                                                            <div key={index} style={{ 
                                                                display: 'flex',
                                                                alignItems: 'center',
                                                                gap: '8px',
                                                                marginBottom: '6px'
                                                            }}>
                                                                <FaKey size={12} color={theme.colors.success} title="Hotkey" />
                                                                <PrincipalDisplay 
                                                                    principal={p.principal}
                                                                    displayInfo={principalDisplayInfo.get(p.principal?.toString())}
                                                                    showCopyButton={false}
                                                                    isAuthenticated={isAuthenticated}
                                                                />
                                                            </div>
                                                        ))
                                                    }
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                        </div>
                    )}

                    {/* Transactions Tab */}
                    {activeTab === 'transactions' && (
                        <div style={{ padding: '1rem' }}>
                            <TransactionList 
                                snsRootCanisterId={searchParams.get('sns') || selectedSnsRoot || SNEED_SNS_ROOT}
                                principalId={stablePrincipalId.current?.toString()}
                                showHeader={false}
                                embedded={true}
                            />
                        </div>
                    )}
                </div>
                </div>
            </main>
            
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
