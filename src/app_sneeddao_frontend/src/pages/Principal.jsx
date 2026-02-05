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
import { fetchPrincipalNeuronsForSns, getOwnerPrincipals, formatNeuronIdLink, safePrincipalString, safePermissionType } from '../utils/NeuronUtils';
import { createActor as createIcrc1Actor } from 'external/icrc1_ledger';
import { getSnsById, fetchAndCacheSnsData, fetchSnsLogo, getAllSnses } from '../utils/SnsUtils';
import { formatE8s, getDissolveState, uint8ArrayToHex } from '../utils/NeuronUtils';
import { HttpAgent } from '@dfinity/agent';
import TransactionList from '../components/TransactionList';
import TokenIcon from '../components/TokenIcon';
import { useNaming } from '../NamingContext';
import usePremiumStatus, { PremiumBadge } from '../hooks/usePremiumStatus';
import MarkdownBody from '../components/MarkdownBody';
import MessageDialog from '../components/MessageDialog';
import { FaUser, FaSearch, FaEdit, FaPen, FaComments, FaNewspaper, FaCoins, FaExchangeAlt, FaChevronDown, FaChevronUp, FaEnvelope, FaCrown, FaKey, FaCheckCircle, FaTimesCircle, FaCopy, FaCheck, FaArrowUp, FaArrowDown, FaNetworkWired, FaCube, FaExternalLinkAlt, FaBrain, FaGavel, FaHandHoldingUsd, FaClock, FaTimes } from 'react-icons/fa';
import { 
    createSneedexActor, 
    formatAmount, 
    formatTimeRemaining,
    isOfferPastExpiration,
    getOfferStateString,
    getBidStateString,
    getAssetType,
    formatUsd,
    calculateUsdValue
} from '../utils/SneedexUtils';
import { createActor as createBackendActor } from 'declarations/app_sneeddao_backend';
import { get_token_conversion_rate } from '../utils/TokenUtils';

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
    
    // Multi-SNS neuron support (like /me page)
    const [principalNeuronCache, setPrincipalNeuronCache] = useState(new Map()); // Map<governanceId, neurons[]>
    const [activeNeuronSns, setActiveNeuronSns] = useState(null);
    const [loadingAllNeurons, setLoadingAllNeurons] = useState(false);
    const [allNeuronsLoaded, setAllNeuronsLoaded] = useState(false);
    const [includeReachable, setIncludeReachable] = useState(false); // Default to false for principal page
    const [loadingReachable, setLoadingReachable] = useState(false);
    const [activeNeuronGroup, setActiveNeuronGroup] = useState(null); // Track active neuron group tab
    const [activeTab, setActiveTab] = useState(() => {
        // Default to transactions tab if a subaccount is in the URL
        const urlSubaccount = new URLSearchParams(window.location.search).get('subaccount');
        return urlSubaccount ? 'transactions' : 'posts';
    }); // 'posts', 'neurons', 'transactions', 'trades', 'balances'
    const [postsActiveTab, setPostsActiveTab] = useState('posts');
    const [tradesActiveTab, setTradesActiveTab] = useState('offers'); // 'offers' or 'bids'
    const [showOnlyActiveOffers, setShowOnlyActiveOffers] = useState(false);
    const [showOnlyActiveBids, setShowOnlyActiveBids] = useState(false);
    
    // Trades state (Sneedex offers & bids)
    const [userOffers, setUserOffers] = useState([]);
    const [userBids, setUserBids] = useState([]);
    const [loadingTrades, setLoadingTrades] = useState(false);
    const [tradesError, setTradesError] = useState(null);
    const [whitelistedTokens, setWhitelistedTokens] = useState([]);
    const [userPosts, setUserPosts] = useState([]);
    const [userThreads, setUserThreads] = useState([]);
    const [loadingPosts, setLoadingPosts] = useState(false);
    const [scanningTokens, setScanningTokens] = useState(false);
    const [scanProgress, setScanProgress] = useState({ current: 0, total: 0, found: 0 });
    const [scanError, setScanError] = useState('');
    const [scannedTokens, setScannedTokens] = useState([]);
    const [neuronUsdTotal, setNeuronUsdTotal] = useState(0);
    const [neuronUsdRates, setNeuronUsdRates] = useState({});
    const [neuronUsdLoading, setNeuronUsdLoading] = useState(false);
    const [expandedNeuronCards, setExpandedNeuronCards] = useState(new Set());
    
    // Message dialog state
    const [messageDialogOpen, setMessageDialogOpen] = useState(false);
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
    const autoScanKeyRef = useRef(null);

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

    // Reset scan state when principal changes
    useEffect(() => {
        setScanProgress({ current: 0, total: 0, found: 0 });
        setScanError('');
        setScannedTokens([]);
        setScanningTokens(false);
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

    // Compute list of SNSes with neurons from the principal's neuron cache
    const snsesWithNeurons = React.useMemo(() => {
        if (!principalNeuronCache || principalNeuronCache.size === 0) return [];
        
        const allSnses = getAllSnses();
        const result = [];
        
        principalNeuronCache.forEach((neuronsList, governanceId) => {
            if (!neuronsList || neuronsList.length === 0) return;
            
            // Find SNS info for this governance canister
            const snsInfo = allSnses.find(sns => 
                sns.canisters?.governance === governanceId
            );
            
            if (snsInfo) {
                result.push({
                    rootCanisterId: snsInfo.rootCanisterId,
                    governanceId: governanceId,
                    ledgerId: snsInfo.canisters?.ledger,
                    name: snsInfo.name || 'Unknown SNS',
                    logo: snsInfo.logo,
                    neuronCount: neuronsList.length,
                    totalStake: neuronsList.reduce((sum, n) => sum + BigInt(n.cached_neuron_stake_e8s || 0), BigInt(0))
                });
            }
        });
        
        // Sort by total stake (descending)
        result.sort((a, b) => {
            if (b.totalStake > a.totalStake) return 1;
            if (b.totalStake < a.totalStake) return -1;
            return 0;
        });
        
        return result;
    }, [principalNeuronCache]);

    const tokenUsdTotal = React.useMemo(() => {
        return scannedTokens.reduce((sum, token) => sum + (token.usdValue || 0), 0);
    }, [scannedTokens]);

    const grandTotalUsd = tokenUsdTotal + neuronUsdTotal;
    const neuronsLoading = loadingAllNeurons || loadingNeurons || loadingReachable || neuronUsdLoading;
    const walletLoading = scanningTokens;

    const activeSnsSummary = React.useMemo(() => {
        const active = snsesWithNeurons.find(sns => sns.rootCanisterId === activeNeuronSns);
        if (!active) return null;
        const ledgerId = active.ledgerId?.toString?.() || active.ledgerId;
        const rate = ledgerId ? (neuronUsdRates[ledgerId] || 0) : 0;
        const usdValue = active.totalStake ? calculateUsdValue(active.totalStake, 8, rate) : 0;
        return { ...active, usdValue };
    }, [snsesWithNeurons, activeNeuronSns, neuronUsdRates]);

    const activeNeuronLedgerId = React.useMemo(() => {
        const active = snsesWithNeurons.find(sns => sns.rootCanisterId === activeNeuronSns);
        return active?.ledgerId?.toString?.() || active?.ledgerId || '';
    }, [snsesWithNeurons, activeNeuronSns]);

    const activeNeuronUsdRate = activeNeuronLedgerId ? (neuronUsdRates[activeNeuronLedgerId] || 0) : 0;

    useEffect(() => {
        let cancelled = false;

        const computeNeuronUsdTotals = async () => {
            if (!principalNeuronCache || principalNeuronCache.size === 0) {
                setNeuronUsdTotal(0);
                setNeuronUsdRates({});
                setNeuronUsdLoading(false);
                return;
            }

            setNeuronUsdLoading(true);

            const allSnses = getAllSnses();
            const govToLedger = new Map();
            allSnses.forEach(sns => {
                const govId = sns.canisters?.governance?.toString?.() || sns.canisters?.governance;
                const ledgerId = sns.canisters?.ledger?.toString?.() || sns.canisters?.ledger;
                if (govId && ledgerId) {
                    govToLedger.set(govId, ledgerId);
                }
            });

            const totalsByLedger = new Map();
            principalNeuronCache.forEach((neuronsList, governanceId) => {
                if (!neuronsList || neuronsList.length === 0) return;
                const govId = governanceId?.toString?.() || governanceId;
                const ledgerId = govToLedger.get(govId);
                if (!ledgerId) return;

                const totalStake = neuronsList.reduce(
                    (sum, n) => sum + BigInt(n.cached_neuron_stake_e8s || 0),
                    0n
                );

                if (totalStake > 0n) {
                    totalsByLedger.set(
                        ledgerId,
                        (totalsByLedger.get(ledgerId) || 0n) + totalStake
                    );
                }
            });

            if (totalsByLedger.size === 0) {
                if (!cancelled) {
                    setNeuronUsdRates({});
                    setNeuronUsdTotal(0);
                    setNeuronUsdLoading(false);
                }
                return;
            }

            const rateMap = {};
            let runningTotal = 0;

            for (const [ledgerId, amount] of totalsByLedger.entries()) {
                try {
                    const rate = await get_token_conversion_rate(ledgerId, 8);
                    if (cancelled) return;
                    rateMap[ledgerId] = rate;
                    runningTotal += calculateUsdValue(amount, 8, rate);
                    setNeuronUsdRates({ ...rateMap });
                    setNeuronUsdTotal(runningTotal);
                } catch (error) {
                    console.warn(`[Principal Neurons] Failed USD rate for ${ledgerId}:`, error?.message || error);
                }
            }

            if (!cancelled) {
                setNeuronUsdLoading(false);
            }
        };

        computeNeuronUsdTotals();
        return () => { cancelled = true; };
    }, [principalNeuronCache]);

    // Helper to check if a neuron is empty (0 stake and 0 maturity)
    const isNeuronEmpty = useCallback((neuron) => {
        const stake = BigInt(neuron.cached_neuron_stake_e8s || 0);
        const maturity = BigInt(neuron.maturity_e8s_equivalent || 0);
        return stake === 0n && maturity === 0n;
    }, []);

    const toggleNeuronCard = useCallback((neuronId) => {
        setExpandedNeuronCards(prev => {
            const next = new Set(prev);
            if (next.has(neuronId)) {
                next.delete(neuronId);
            } else {
                next.add(neuronId);
            }
            return next;
        });
    }, []);

    // Group neurons by owner (for reachable neurons display)
    const groupedNeurons = React.useMemo(() => {
        const groups = new Map();
        const viewedPrincipal = stablePrincipalId.current?.toString();
        const MANAGE_PRINCIPALS = 2; // Permission type for managing principals

        if (!viewedPrincipal || !neurons.length) return groups;

        const neuronsByOwner = new Map();
        neurons.forEach(neuron => {
            // Check if viewed principal has MANAGE_PRINCIPALS permission on this neuron
            const viewedHasManagePermissions = neuron.permissions?.some(p => {
                const permPrincipal = safePrincipalString(p.principal);
                if (!permPrincipal || permPrincipal !== viewedPrincipal) return false;
                const permTypes = safePermissionType(p);
                return permTypes.includes(MANAGE_PRINCIPALS);
            });

            // Check if viewed principal has any direct permission on this neuron
            const viewedHasDirectPermission = neuron.permissions?.some(p => 
                safePrincipalString(p.principal) === viewedPrincipal
            );

            let effectiveOwner;
            if (viewedHasManagePermissions) {
                // If viewed principal has manage permissions, consider them the owner
                effectiveOwner = viewedPrincipal;
            } else if (viewedHasDirectPermission) {
                // Has direct permission but not manage - still "their" neuron
                effectiveOwner = viewedPrincipal;
            } else {
                // Otherwise, use the first owner from getOwnerPrincipals
                const ownerPrincipals = getOwnerPrincipals(neuron);
                effectiveOwner = ownerPrincipals.length > 0 ? ownerPrincipals[0] : null;
            }

            const ownerKey = effectiveOwner || 'unknown';
            if (!neuronsByOwner.has(ownerKey)) {
                neuronsByOwner.set(ownerKey, []);
            }
            neuronsByOwner.get(ownerKey).push(neuron);
        });

        neuronsByOwner.forEach((ownerNeurons, owner) => {
            if (ownerNeurons.length === 0) return;
            
            const totalStake = ownerNeurons.reduce(
                (sum, n) => sum + BigInt(n.cached_neuron_stake_e8s || 0), 
                BigInt(0)
            );

            groups.set(owner || 'unknown', {
                isDirect: owner === viewedPrincipal,
                ownerPrincipal: owner || 'unknown',
                neurons: ownerNeurons,
                totalStake
            });
        });

        return groups;
    }, [neurons]);

    // Set initial active neuron group when neurons change
    useEffect(() => {
        if (groupedNeurons.size > 0 && !activeNeuronGroup) {
            // Default to direct neurons group (the viewed principal)
            const viewedPrincipal = stablePrincipalId.current?.toString();
            if (viewedPrincipal && groupedNeurons.has(viewedPrincipal)) {
                setActiveNeuronGroup(viewedPrincipal);
            } else {
                // Fallback to first group
                setActiveNeuronGroup(Array.from(groupedNeurons.keys())[0]);
            }
        }
    }, [groupedNeurons, activeNeuronGroup]);

    // Set initial active SNS when snsesWithNeurons loads
    useEffect(() => {
        if (snsesWithNeurons.length > 0 && !activeNeuronSns) {
            // Try to select the currently selected SNS if user has neurons there
            const matchingSns = snsesWithNeurons.find(s => s.rootCanisterId === selectedSnsRoot);
            if (matchingSns) {
                setActiveNeuronSns(matchingSns.rootCanisterId);
            } else {
                // Otherwise select the first SNS with most stake
                setActiveNeuronSns(snsesWithNeurons[0].rootCanisterId);
            }
        }
    }, [snsesWithNeurons, selectedSnsRoot, activeNeuronSns]);

    // Store both direct neurons and all reachable neurons separately
    const [directNeuronCache, setDirectNeuronCache] = useState(new Map()); // Only neurons with direct permissions
    const [reachableNeuronCache, setReachableNeuronCache] = useState(new Map()); // All reachable neurons (including through owners)
    const [reachableLoaded, setReachableLoaded] = useState(false);

    // Load direct neurons across all SNSes when principal changes
    useEffect(() => {
        let mounted = true;
        const currentPrincipalId = stablePrincipalId.current;

        if (!currentPrincipalId) {
            setDirectNeuronCache(new Map());
            setPrincipalNeuronCache(new Map());
            setAllNeuronsLoaded(false);
            setActiveNeuronSns(null);
            setReachableLoaded(false);
            return;
        }

        const fetchDirectNeurons = async () => {
            setLoadingAllNeurons(true);
            setAllNeuronsLoaded(false);
            setActiveNeuronSns(null); // Reset when starting new fetch
            setReachableLoaded(false);
            
            const allSnses = getAllSnses();
            const newCache = new Map();
            const targetPrincipal = currentPrincipalId.toString();
            
            // Fetch neurons from all SNSes in parallel - but only keep those with direct permissions
            const fetchPromises = allSnses.map(async (sns) => {
                if (!sns.canisters?.governance) return null;
                
                try {
                    const neuronsList = await fetchPrincipalNeuronsForSns(null, sns.canisters.governance, targetPrincipal);
                    // Only keep neurons where the principal has DIRECT permissions
                    const directNeurons = neuronsList.filter(neuron => 
                        neuron.permissions.some(p => 
                            safePrincipalString(p.principal) === targetPrincipal
                        )
                    );
                    
                    if (directNeurons.length > 0 && mounted) {
                        return { governanceId: sns.canisters.governance, neurons: directNeurons };
                    }
                } catch (err) {
                    console.error(`Error fetching neurons for ${sns.name}:`, err);
                }
                return null;
            });
            
            const results = await Promise.all(fetchPromises);
            
            if (mounted) {
                results.forEach(result => {
                    if (result) {
                        newCache.set(result.governanceId, result.neurons);
                    }
                });
                
                setDirectNeuronCache(newCache);
                setPrincipalNeuronCache(newCache); // Initially use direct neurons
                setLoadingAllNeurons(false);
                setAllNeuronsLoaded(true);
            }
        };
        
        fetchDirectNeurons();
        
        return () => { mounted = false; };
    }, [principalParam]);

    // Load reachable neurons on demand when includeReachable is toggled
    useEffect(() => {
        if (!includeReachable || reachableLoaded) {
            // If toggling off, switch back to direct neurons only
            if (!includeReachable && allNeuronsLoaded) {
                setPrincipalNeuronCache(directNeuronCache);
            }
            return;
        }

        let mounted = true;
        const currentPrincipalId = stablePrincipalId.current;

        if (!currentPrincipalId) return;

        const fetchReachableNeurons = async () => {
            setLoadingReachable(true);
            
            const allSnses = getAllSnses();
            const newCache = new Map();
            const targetPrincipal = currentPrincipalId.toString();
            
            // Fetch ALL reachable neurons (including through owners)
            const fetchPromises = allSnses.map(async (sns) => {
                if (!sns.canisters?.governance) return null;
                
                try {
                    const neuronsList = await fetchPrincipalNeuronsForSns(null, sns.canisters.governance, targetPrincipal);
                    // Keep ALL neurons returned (not filtered to direct only)
                    if (neuronsList.length > 0 && mounted) {
                        return { governanceId: sns.canisters.governance, neurons: neuronsList };
                    }
                } catch (err) {
                    console.error(`Error fetching reachable neurons for ${sns.name}:`, err);
                }
                return null;
            });
            
            const results = await Promise.all(fetchPromises);
            
            if (mounted) {
                results.forEach(result => {
                    if (result) {
                        newCache.set(result.governanceId, result.neurons);
                    }
                });
                
                setReachableNeuronCache(newCache);
                setPrincipalNeuronCache(newCache);
                setLoadingReachable(false);
                setReachableLoaded(true);
            }
        };
        
        fetchReachableNeurons();
        
        return () => { mounted = false; };
    }, [includeReachable, reachableLoaded, allNeuronsLoaded, directNeuronCache]);

    // Load neurons for the selected SNS tab and update token symbol
    useEffect(() => {
        let mounted = true;

        const loadSelectedSnsNeurons = async () => {
            if (!activeNeuronSns) {
                setNeurons([]);
                return;
            }

            setLoadingNeurons(true);
            setNeuronError(null);
            setActiveNeuronGroup(null); // Reset group selection when switching SNS

            try {
                const selectedSns = getSnsById(activeNeuronSns);
                if (!selectedSns) {
                    throw new Error('Selected SNS not found');
                }

                // Get neurons from cache
                const cachedNeurons = principalNeuronCache.get(selectedSns.canisters.governance) || [];
                
                if (mounted) {
                    setNeurons(cachedNeurons);

                    // Fetch token symbol
                    try {
                        const icrc1Actor = createIcrc1Actor(selectedSns.canisters.ledger, {
                            agentOptions: { agent: new HttpAgent() }
                        });
                        const metadata = await icrc1Actor.icrc1_metadata();
                        const symbolEntry = metadata.find(entry => entry[0] === 'icrc1:symbol');
                        if (symbolEntry && symbolEntry[1]) {
                            setTokenSymbol(symbolEntry[1].Text);
                        }
                    } catch (err) {
                        console.error('Error fetching token symbol:', err);
                    }
                }
            } catch (err) {
                console.error('Error loading neurons:', err);
                if (mounted) {
                    setNeuronError('Failed to load neurons');
                }
            } finally {
                if (mounted) {
                    setLoadingNeurons(false);
                }
            }
        };

        loadSelectedSnsNeurons();
        return () => { mounted = false; };
    }, [activeNeuronSns, principalNeuronCache]);

    // Fetch principal display info for all unique principals
    useEffect(() => {
        const fetchPrincipalInfo = async () => {
            if (!neurons.length || !principalNames || !principalNicknames) return;

            const uniquePrincipals = new Set();
            neurons.forEach(neuron => {
                getOwnerPrincipals(neuron).forEach(p => uniquePrincipals.add(p));
                neuron.permissions.forEach(p => {
                    const principalStr = safePrincipalString(p.principal);
                    if (principalStr) uniquePrincipals.add(principalStr);
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
        if (!createForumActor || !stablePrincipalId.current) return;
        
        setLoadingPosts(true);
        setPostsError(null);
        
        try {
            const forumActor = createForumActor(identity || null);
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
        if (!createForumActor || !threads.length) return;
        
        try {
            const forumActor = createForumActor(identity || null);
            
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
        if (stablePrincipalId.current && createForumActor) {
            fetchUserPosts();
        }
    }, [searchParams.get('id'), fetchUserPosts]);

    // Fetch post counts when threads are loaded
    useEffect(() => {
        if (userThreads.length > 0) {
            fetchThreadPostCounts(userThreads);
        }
    }, [userThreads, fetchThreadPostCounts]);

    // Fetch trades (Sneedex offers and bids) for the user
    const fetchUserTrades = useCallback(async () => {
        if (!stablePrincipalId.current) return;
        
        setLoadingTrades(true);
        setTradesError(null);
        
        try {
            const actor = createSneedexActor(identity || null);
            const targetPrincipal = stablePrincipalId.current;
            
            // Fetch offers created by this principal and bids made by this principal
            const [offersData, bidsData] = await Promise.all([
                actor.getOffersByCreator(targetPrincipal),
                actor.getBidsByBidder(targetPrincipal)
            ]);
            
            setUserOffers(offersData || []);
            setUserBids(bidsData || []);
            
        } catch (err) {
            console.error('Error fetching user trades:', err);
            setTradesError(err.message || 'Failed to load trades');
        } finally {
            setLoadingTrades(false);
        }
    }, [identity]);

    // Fetch whitelisted tokens for trade metadata
    useEffect(() => {
        const fetchTokens = async () => {
            try {
                const backendCanisterId = process.env.CANISTER_ID_APP_SNEEDDAO_BACKEND || process.env.REACT_APP_BACKEND_CANISTER_ID;
                const agentOptions = identity ? { identity } : {};
                const backendActor = createBackendActor(backendCanisterId, {
                    agentOptions
                });
                const tokens = await backendActor.get_whitelisted_tokens();
                setWhitelistedTokens(tokens);
            } catch (e) {
                console.error('Failed to fetch whitelisted tokens:', e);
            }
        };
        fetchTokens();
    }, [identity]);

    // Auto-fetch trades when principal changes
    useEffect(() => {
        if (stablePrincipalId.current) {
            fetchUserTrades();
        }
    }, [searchParams.get('id'), fetchUserTrades]);

    // Helper to get token info for trades
    const getTradeTokenInfo = useCallback((ledgerId) => {
        const token = whitelistedTokens.find(t => t.ledger_id.toString() === ledgerId);
        if (token) {
            return {
                symbol: token.symbol || 'TOKEN',
                decimals: token.decimals || 8
            };
        }
        return { symbol: 'TOKEN', decimals: 8 };
    }, [whitelistedTokens]);

    const getWhitelistedTokenInfo = useCallback((ledgerId) => {
        const token = whitelistedTokens.find(t => t.ledger_id.toString() === ledgerId);
        if (token) {
            return {
                ledgerId,
                name: token.name || token.token_name || '',
                symbol: token.symbol || 'TOKEN',
                decimals: token.decimals || 8,
                logo: token.logo || token.logo_url || token.icon || ''
            };
        }
        return { ledgerId, name: '', symbol: 'TOKEN', decimals: 8, logo: '' };
    }, [whitelistedTokens]);

    const parseIcrcMetadata = useCallback((metadata) => {
        const findMeta = (keys) => metadata.find(([key]) => keys.includes(key))?.[1];
        const toText = (val) => (val && typeof val === 'object' && 'Text' in val ? val.Text : null);
        const toNat = (val) => (val && typeof val === 'object' && 'Nat' in val ? Number(val.Nat) : null);

        const symbolVal = findMeta(['icrc1:symbol', 'symbol']);
        const decimalsVal = findMeta(['icrc1:decimals', 'decimals']);
        const nameVal = findMeta(['icrc1:name', 'name']);
        const logoVal = findMeta(['icrc1:logo', 'logo']);

        return {
            symbol: toText(symbolVal),
            decimals: toNat(decimalsVal),
            name: toText(nameVal),
            logo: toText(logoVal)
        };
    }, []);

    // Scan for tokens - check all whitelisted tokens for balances
    const handleScanForTokens = async () => {
        if (!stablePrincipalId.current || scanningTokens) return;
        if (!whitelistedTokens || whitelistedTokens.length === 0) {
            setScanError('No whitelisted tokens available to scan yet.');
            return;
        }

        setScanningTokens(true);
        setScanError('');
        setScanProgress({ current: 0, total: whitelistedTokens.length, found: 0 });

        try {
            const host = process.env.DFX_NETWORK === 'ic' || process.env.DFX_NETWORK === 'staging' 
                ? 'https://icp0.io' 
                : 'http://localhost:4943';
            const agent = new HttpAgent({ 
                host,
                ...(identity ? { identity } : {})
            });
            if (process.env.DFX_NETWORK !== 'ic' && process.env.DFX_NETWORK !== 'staging') {
                await agent.fetchRootKey();
            }

            let foundCount = 0;
            let completedCount = 0;
            const queue = whitelistedTokens.map(t => t.ledger_id?.toString?.() || String(t.ledger_id));
            const maxConcurrency = 8;

            const runScanForLedger = async (ledgerId) => {
                try {
                    const ledgerActor = createIcrc1Actor(ledgerId, { agent });
                    const balance = await ledgerActor.icrc1_balance_of({ 
                        owner: stablePrincipalId.current, 
                        subaccount: [] 
                    });

                    if (BigInt(balance) > 0n) {
                        const baseInfo = getWhitelistedTokenInfo(ledgerId);
                        let metadataInfo = {};
                        try {
                            const metadata = await ledgerActor.icrc1_metadata();
                            metadataInfo = parseIcrcMetadata(metadata);
                        } catch (err) {
                            console.warn(`[Principal Scan] Failed to read metadata for ${ledgerId}:`, err?.message || err);
                        }

                        let symbol = metadataInfo.symbol || baseInfo.symbol;
                        let decimals = Number.isFinite(metadataInfo.decimals) ? metadataInfo.decimals : baseInfo.decimals;
                        let name = metadataInfo.name || baseInfo.name;
                        let logo = metadataInfo.logo || baseInfo.logo;
                        if (symbol?.toLowerCase() === 'icp' && !logo) {
                            logo = 'icp_symbol.svg';
                        }

                        const usdRate = await get_token_conversion_rate(ledgerId, decimals);
                        const usdValue = calculateUsdValue(balance, decimals, usdRate);

                        foundCount++;
                        setScannedTokens(prev => {
                            if (prev.some(token => token.ledgerId === ledgerId)) return prev;
                            return [
                                ...prev,
                                { ledgerId, symbol, decimals, name, logo, balance: BigInt(balance), usdValue }
                            ];
                        });
                    }
                } catch (err) {
                    console.warn(`[Principal Scan] Failed to check ${ledgerId}:`, err?.message || err);
                } finally {
                    completedCount++;
                    setScanProgress(prev => ({ 
                        ...prev, 
                        current: completedCount, 
                        found: foundCount 
                    }));
                }
            };

            const workerCount = Math.min(maxConcurrency, queue.length);
            const workers = Array.from({ length: workerCount }, async () => {
                while (queue.length > 0) {
                    const ledgerId = queue.shift();
                    if (!ledgerId) break;
                    await runScanForLedger(ledgerId);
                }
            });

            await Promise.all(workers);
        } catch (error) {
            console.error('Error scanning for tokens:', error);
            setScanError(error?.message || 'Error scanning for tokens');
        } finally {
            setScanningTokens(false);
        }
    };

    useEffect(() => {
        const principalKey = principalParam || '';
        if (activeTab !== 'balances') return;
        if (!principalKey || scanningTokens) return;
        if (!whitelistedTokens || whitelistedTokens.length === 0) return;
        if (scannedTokens.length > 0) return;
        if (autoScanKeyRef.current === principalKey) return;

        autoScanKeyRef.current = principalKey;
        handleScanForTokens();
    }, [
        activeTab,
        principalParam,
        scannedTokens.length,
        scanningTokens,
        whitelistedTokens,
        handleScanForTokens
    ]);

    // Get asset icons for offer display
    const getOfferAssetIcons = (assets) => {
        const icons = [];
        assets.forEach((assetEntry, idx) => {
            const assetType = getAssetType(assetEntry);
            if (assetType === 'Canister') icons.push(<FaCube key={idx} size={12} title="Canister" />);
            else if (assetType === 'SNSNeuron') icons.push(<FaBrain key={idx} size={12} title="SNS Neuron" />);
            else if (assetType === 'ICRC1Token') icons.push(<FaCoins key={idx} size={12} title="Token" />);
        });
        return icons.length > 0 ? icons : null;
    };

    // Get state badge style for offers/bids
    const getTradeStateBadgeStyle = (state, isOffer = true) => {
        let bgColor = principalPrimary;
        let textColor = 'white';
        
        if (isOffer) {
            if ('Active' in state) { bgColor = '#22c55e'; }
            else if ('Completed' in state || 'Claimed' in state) { bgColor = '#3b82f6'; }
            else if ('Cancelled' in state) { bgColor = '#f59e0b'; }
            else if ('Expired' in state || 'Reclaimed' in state) { bgColor = '#6b7280'; }
            else if ('Draft' in state || 'PendingEscrow' in state) { bgColor = '#8b5cf6'; }
        } else {
            if ('Pending' in state) { bgColor = '#f59e0b'; }
            else if ('Won' in state) { bgColor = '#22c55e'; }
            else if ('Lost' in state) { bgColor = '#ef4444'; }
            else if ('Refunded' in state) { bgColor = '#6b7280'; }
        }
        
        return {
            padding: '4px 10px',
            borderRadius: '6px',
            fontSize: '0.75rem',
            fontWeight: '600',
            background: bgColor,
            color: textColor
        };
    };

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
                        background: `linear-gradient(135deg, ${theme.colors.secondaryBg} 0%, ${theme.colors.primaryBg} 100%)`,
                        borderRadius: '24px',
                        padding: '0',
                        marginBottom: '1.5rem',
                        border: `1px solid ${theme.colors.border}`,
                        boxShadow: '0 20px 60px rgba(0, 0, 0, 0.3)',
                        overflow: 'hidden',
                        animationDelay: '0.2s'
                    }}
                >
                    {loading ? (
                        <div style={{ textAlign: 'center', padding: '3rem', color: theme.colors.mutedText }}>
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
                            margin: '1.5rem',
                            borderRadius: '12px'
                        }}>
                            {error}
                        </div>
                    ) : (
                        <>
                            {/* Top Banner */}
                            <div style={{
                                height: '80px',
                                background: (() => {
                                    const principalStr = stablePrincipalId.current?.toString() || '';
                                    const isCanister = isCanisterPrincipal(principalStr);
                                    const isPremium = viewedUserIsPremium && !premiumLoading;
                                    if (isPremium && !isCanister) {
                                        return `linear-gradient(135deg, #f59e0b 0%, #eab308 50%, #f59e0b 100%)`;
                                    }
                                    return `linear-gradient(135deg, ${principalPrimary} 0%, ${principalSecondary} 50%, ${principalAccent} 100%)`;
                                })(),
                                position: 'relative'
                            }}>
                                {/* Decorative pattern */}
                                <div style={{
                                    position: 'absolute',
                                    inset: 0,
                                    opacity: 0.1,
                                    backgroundImage: 'radial-gradient(circle at 20% 50%, white 1px, transparent 1px), radial-gradient(circle at 80% 50%, white 1px, transparent 1px)',
                                    backgroundSize: '40px 40px',
                                    pointerEvents: 'none'
                                }} />
                                
                                {/* Nickname - top of banner */}
                                {principalInfo?.nickname && (
                                    <div style={{
                                        position: 'absolute',
                                        top: '12px',
                                        left: '16px',
                                        color: 'white',
                                        fontSize: '0.95rem',
                                        fontWeight: '600',
                                        fontStyle: 'italic',
                                        textShadow: '0 2px 8px rgba(0,0,0,0.3)',
                                        opacity: 0.95,
                                        whiteSpace: 'nowrap',
                                        maxWidth: 'calc(100% - 120px)',
                                        overflow: 'hidden',
                                        textOverflow: 'ellipsis'
                                    }}>
                                        "{principalInfo.nickname}"
                                    </div>
                                )}
                                
                                {/* Premium Badge - top right corner */}
                                {viewedUserIsPremium && !premiumLoading && !isCanisterPrincipal(stablePrincipalId.current?.toString() || '') && (
                                    <div style={{
                                        position: 'absolute',
                                        top: '12px',
                                        right: '12px',
                                        background: 'linear-gradient(135deg, #fbbf24, #f59e0b)',
                                        color: '#1a1a2e',
                                        padding: '6px 14px',
                                        borderRadius: '20px',
                                        fontSize: '0.8rem',
                                        fontWeight: '700',
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: '6px',
                                        boxShadow: `0 0 0 3px ${theme.colors.secondaryBg}, 0 4px 12px rgba(245, 158, 11, 0.4)`,
                                        zIndex: 2
                                    }}>
                                        <FaCrown size={12} />
                                        Premium
                                    </div>
                                )}
                                
                                {/* Principal ID & Subaccount - bottom right of banner */}
                                <div style={{
                                    position: 'absolute',
                                    bottom: '8px',
                                    right: '12px',
                                    display: 'flex',
                                    flexDirection: 'column',
                                    alignItems: 'flex-end',
                                    gap: '4px',
                                    zIndex: 2
                                }}>
                                    <div style={{
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: '6px',
                                        background: 'rgba(0,0,0,0.25)',
                                        backdropFilter: 'blur(4px)',
                                        padding: '4px 10px',
                                        borderRadius: '6px'
                                    }}>
                                        <code style={{ 
                                            color: 'rgba(255,255,255,0.9)', 
                                            fontSize: '0.75rem',
                                            fontWeight: '500'
                                        }}>
                                            {stablePrincipalId.current?.toString().slice(0, 10)}...{stablePrincipalId.current?.toString().slice(-6)}
                                        </code>
                                        <button
                                            onClick={copyPrincipal}
                                            style={{
                                                background: 'none',
                                                border: 'none',
                                                cursor: 'pointer',
                                                padding: '2px',
                                                display: 'flex',
                                                alignItems: 'center'
                                            }}
                                            title="Copy principal"
                                        >
                                            {copiedPrincipal ? (
                                                <FaCheck size={11} color="rgba(255,255,255,0.9)" />
                                            ) : (
                                                <FaCopy size={11} color="rgba(255,255,255,0.7)" />
                                            )}
                                        </button>
                                    </div>
                                    {/* Subaccount display when filtered */}
                                    {searchParams.get('subaccount') && (
                                        <div style={{
                                            display: 'flex',
                                            alignItems: 'center',
                                            gap: '6px',
                                            background: 'rgba(0,0,0,0.25)',
                                            backdropFilter: 'blur(4px)',
                                            padding: '4px 10px',
                                            borderRadius: '6px'
                                        }}>
                                            <span style={{ 
                                                color: 'rgba(255,255,255,0.7)', 
                                                fontSize: '0.65rem',
                                                fontWeight: '500'
                                            }}>
                                                Sub:
                                            </span>
                                            <code style={{ 
                                                color: 'rgba(255,255,255,0.9)', 
                                                fontSize: '0.7rem',
                                                fontWeight: '500'
                                            }}>
                                                {searchParams.get('subaccount').slice(0, 8)}...{searchParams.get('subaccount').slice(-8)}
                                            </code>
                                            <button
                                                onClick={async () => {
                                                    try {
                                                        await navigator.clipboard.writeText(searchParams.get('subaccount'));
                                                    } catch (err) {
                                                        console.error('Failed to copy:', err);
                                                    }
                                                }}
                                                style={{
                                                    background: 'none',
                                                    border: 'none',
                                                    cursor: 'pointer',
                                                    padding: '2px',
                                                    display: 'flex',
                                                    alignItems: 'center'
                                                }}
                                                title="Copy subaccount"
                                            >
                                                <FaCopy size={10} color="rgba(255,255,255,0.7)" />
                                            </button>
                                            <button
                                                onClick={() => {
                                                    const newParams = new URLSearchParams(searchParams);
                                                    newParams.delete('subaccount');
                                                    setSearchParams(newParams, { replace: true });
                                                }}
                                                style={{
                                                    background: 'none',
                                                    border: 'none',
                                                    cursor: 'pointer',
                                                    padding: '2px',
                                                    display: 'flex',
                                                    alignItems: 'center'
                                                }}
                                                title="Clear subaccount filter"
                                            >
                                                <FaTimes size={10} color="rgba(255,255,255,0.7)" />
                                            </button>
                                        </div>
                                    )}
                                </div>
                            </div>
                            
                            {/* Profile Content */}
                            <div style={{ padding: '0 2rem 1.5rem', marginTop: '-40px', position: 'relative', zIndex: 1 }}>
                                <div style={{
                                    display: 'flex',
                                    alignItems: 'flex-end',
                                    gap: '1.25rem',
                                    marginBottom: '1rem',
                                    flexWrap: 'wrap'
                                }}>
                                    {/* Avatar */}
                                    {(() => {
                                        const principalStr = stablePrincipalId.current?.toString() || '';
                                        const isCanister = isCanisterPrincipal(principalStr);
                                        const isPremium = viewedUserIsPremium && !premiumLoading;
                                        
                                        const bgGradient = isPremium && !isCanister
                                            ? 'linear-gradient(135deg, #f59e0b, #eab308)'
                                            : `linear-gradient(135deg, ${principalPrimary}, ${principalSecondary})`;
                                        const shadowColor = isPremium && !isCanister
                                            ? '#f59e0b50'
                                            : `${principalPrimary}50`;
                                        
                                        return (
                                            <div style={{
                                                width: '88px',
                                                height: '88px',
                                                borderRadius: isCanister ? '16px' : '20px',
                                                background: bgGradient,
                                                display: 'flex',
                                                alignItems: 'center',
                                                justifyContent: 'center',
                                                flexShrink: 0,
                                                boxShadow: `0 8px 32px ${shadowColor}`,
                                                border: `4px solid ${theme.colors.secondaryBg}`
                                            }}>
                                                {isCanister ? <FaCube size={36} color="white" /> : (isPremium ? <FaCrown size={36} color="white" /> : <FaUser size={36} color="white" />)}
                                            </div>
                                        );
                                    })()}
                                    
                                    {/* Name & Badge Row */}
                                    <div style={{ flex: 1, minWidth: '150px', paddingBottom: '4px' }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
                                            <h2 style={{ 
                                                color: theme.colors.primaryText,
                                                margin: '0',
                                                fontSize: '1.5rem',
                                                fontWeight: '700',
                                                display: 'flex',
                                                alignItems: 'center',
                                                gap: '0.5rem'
                                            }}>
                                                {principalInfo?.name || (isCanisterPrincipal(stablePrincipalId.current?.toString() || '') ? 'Canister' : 'Anonymous')}
                                                {principalInfo?.isVerified && (
                                                    <FaCheckCircle size={16} color={principalPrimary} title="Verified name" />
                                                )}
                                            </h2>
                                            {isCanisterPrincipal(stablePrincipalId.current?.toString() || '') && (
                                                <span style={{
                                                    background: `${principalAccent}20`,
                                                    color: principalAccent,
                                                    padding: '4px 10px',
                                                    borderRadius: '12px',
                                                    fontSize: '0.75rem',
                                                    fontWeight: '600',
                                                    display: 'inline-flex',
                                                    alignItems: 'center',
                                                    gap: '4px'
                                                }}>
                                                    <FaCube size={10} />
                                                    Canister
                                                </span>
                                            )}
                                        </div>
                                    </div>
                                </div>
                                
                                {/* Activity Stats */}
                                <div style={{
                                    display: 'grid',
                                    gridTemplateColumns: 'repeat(auto-fit, minmax(70px, 1fr))',
                                    gap: '0.75rem',
                                    marginBottom: '1rem'
                                }}>
                                    <div style={{
                                        background: theme.colors.tertiaryBg,
                                        borderRadius: '12px',
                                        padding: '0.75rem',
                                        textAlign: 'center',
                                        transition: 'all 0.2s ease',
                                        border: `1px solid transparent`,
                                        cursor: 'pointer'
                                    }}
                                    onClick={() => setActiveTab('posts')}
                                    onMouseEnter={(e) => e.currentTarget.style.borderColor = principalPrimary}
                                    onMouseLeave={(e) => e.currentTarget.style.borderColor = 'transparent'}
                                    >
                                        <div style={{ 
                                            color: principalPrimary, 
                                            fontSize: '1.25rem', 
                                            fontWeight: '700',
                                            marginBottom: '0.25rem'
                                        }}>
                                            {loadingPosts ? '...' : userPosts.length}
                                        </div>
                                        <div style={{ 
                                            color: theme.colors.mutedText, 
                                            fontSize: '0.7rem', 
                                            textTransform: 'uppercase',
                                            letterSpacing: '0.5px'
                                        }}>
                                            Posts
                                        </div>
                                    </div>
                                    <div style={{
                                        background: theme.colors.tertiaryBg,
                                        borderRadius: '12px',
                                        padding: '0.75rem',
                                        textAlign: 'center',
                                        transition: 'all 0.2s ease',
                                        border: `1px solid transparent`,
                                        cursor: 'pointer'
                                    }}
                                    onClick={() => setActiveTab('posts')}
                                    onMouseEnter={(e) => e.currentTarget.style.borderColor = principalSecondary}
                                    onMouseLeave={(e) => e.currentTarget.style.borderColor = 'transparent'}
                                    >
                                        <div style={{ 
                                            color: principalSecondary, 
                                            fontSize: '1.25rem', 
                                            fontWeight: '700',
                                            marginBottom: '0.25rem'
                                        }}>
                                            {loadingPosts ? '...' : userThreads.length}
                                        </div>
                                        <div style={{ 
                                            color: theme.colors.mutedText, 
                                            fontSize: '0.7rem', 
                                            textTransform: 'uppercase',
                                            letterSpacing: '0.5px'
                                        }}>
                                            Threads
                                        </div>
                                    </div>
                                    <div style={{
                                        background: theme.colors.tertiaryBg,
                                        borderRadius: '12px',
                                        padding: '0.75rem',
                                        textAlign: 'center',
                                        transition: 'all 0.2s ease',
                                        border: `1px solid transparent`,
                                        cursor: 'pointer'
                                    }}
                                    onClick={() => setActiveTab('trades')}
                                    onMouseEnter={(e) => e.currentTarget.style.borderColor = theme.colors.success}
                                    onMouseLeave={(e) => e.currentTarget.style.borderColor = 'transparent'}
                                    >
                                        <div style={{ 
                                            color: theme.colors.success, 
                                            fontSize: '1.25rem', 
                                            fontWeight: '700',
                                            marginBottom: '0.25rem'
                                        }}>
                                            {loadingTrades ? '...' : userOffers.length}
                                        </div>
                                        <div style={{ 
                                            color: theme.colors.mutedText, 
                                            fontSize: '0.7rem', 
                                            textTransform: 'uppercase',
                                            letterSpacing: '0.5px'
                                        }}>
                                            Offers
                                        </div>
                                    </div>
                                    <div style={{
                                        background: theme.colors.tertiaryBg,
                                        borderRadius: '12px',
                                        padding: '0.75rem',
                                        textAlign: 'center',
                                        transition: 'all 0.2s ease',
                                        border: `1px solid transparent`,
                                        cursor: 'pointer'
                                    }}
                                    onClick={() => setActiveTab('neurons')}
                                    onMouseEnter={(e) => e.currentTarget.style.borderColor = principalAccent}
                                    onMouseLeave={(e) => e.currentTarget.style.borderColor = 'transparent'}
                                    >
                                        <div style={{ 
                                            color: principalAccent, 
                                            fontSize: '1.25rem', 
                                            fontWeight: '700',
                                            marginBottom: '0.25rem'
                                        }}>
                                            {loadingNeurons ? '...' : neurons.length}
                                        </div>
                                        <div style={{ 
                                            color: theme.colors.mutedText, 
                                            fontSize: '0.7rem', 
                                            textTransform: 'uppercase',
                                            letterSpacing: '0.5px'
                                        }}>
                                            Neurons
                                        </div>
                                    </div>
                                    <div style={{
                                        background: theme.colors.tertiaryBg,
                                        borderRadius: '12px',
                                        padding: '0.75rem',
                                        textAlign: 'center',
                                        transition: 'all 0.2s ease',
                                        border: `1px solid transparent`,
                                        cursor: 'pointer'
                                    }}
                                    onClick={() => setActiveTab('balances')}
                                    onMouseEnter={(e) => e.currentTarget.style.borderColor = principalPrimary}
                                    onMouseLeave={(e) => e.currentTarget.style.borderColor = 'transparent'}
                                    >
                                        <div style={{ 
                                            color: principalPrimary, 
                                            fontSize: '1.1rem', 
                                            fontWeight: '700',
                                            marginBottom: '0.25rem'
                                        }}>
                                            {formatUsd(grandTotalUsd)}
                                        </div>
                                        <div style={{ 
                                            color: theme.colors.mutedText, 
                                            fontSize: '0.7rem', 
                                            textTransform: 'uppercase',
                                            letterSpacing: '0.5px'
                                        }}>
                                            Total Value
                                        </div>
                                    </div>
                                </div>
                                
                                {/* Link to /canister page for canisters */}
                                {isCanisterPrincipal(stablePrincipalId.current?.toString() || '') && (
                                    <Link
                                        to={`/canister?id=${stablePrincipalId.current?.toString()}`}
                                        style={{
                                            display: 'inline-flex',
                                            alignItems: 'center',
                                            gap: '6px',
                                            color: principalPrimary,
                                            fontSize: '0.85rem',
                                            textDecoration: 'none',
                                            marginBottom: '1rem',
                                            padding: '8px 14px',
                                            background: `${principalPrimary}10`,
                                            borderRadius: '8px',
                                            border: `1px solid ${principalPrimary}30`,
                                            transition: 'all 0.2s ease'
                                        }}
                                    >
                                        <FaExternalLinkAlt size={10} />
                                        View Canister Details
                                    </Link>
                                )}

                                {/* Action Buttons */}
                                <div style={{ 
                                    display: 'flex', 
                                    gap: '0.5rem',
                                    flexWrap: 'wrap'
                                }}>
                                    {!editingName && !editingNickname && (
                                        <>
                                            {isAuthenticated && (
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
                                            )}
                                            {identity?.getPrincipal().toString() === stablePrincipalId.current?.toString() ? (
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
                                                        onClick={() => setMessageDialogOpen(true)}
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
                        </>
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
                        onClick={() => setActiveTab('trades')}
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
                            background: activeTab === 'trades' 
                                ? `linear-gradient(135deg, #8b5cf6, #a78bfa)`
                                : 'transparent',
                            color: activeTab === 'trades' 
                                ? 'white' 
                                : theme.colors.secondaryText,
                        }}
                    >
                        <FaGavel size={14} />
                        <span>Trades</span>
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
                        <span>Neurons</span>
                        {neuronsLoading && (
                            <span
                                className="principal-spin"
                                style={{
                                    width: '12px',
                                    height: '12px',
                                    border: `2px solid ${activeTab === 'neurons' ? 'rgba(255,255,255,0.6)' : theme.colors.border}`,
                                    borderTopColor: activeTab === 'neurons' ? 'white' : principalAccent,
                                    borderRadius: '50%',
                                    display: 'inline-block'
                                }}
                                title="Loading neurons"
                            />
                        )}
                        {snsesWithNeurons.length > 0 && (
                            <span style={{
                                fontSize: '0.75rem',
                                background: activeTab === 'neurons' ? 'rgba(255,255,255,0.2)' : theme.colors.tertiaryBg,
                                padding: '0.1rem 0.4rem',
                                borderRadius: '6px',
                                fontWeight: '500'
                            }}>
                                {snsesWithNeurons.reduce((sum, s) => sum + s.neuronCount, 0)}
                            </span>
                        )}
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
                        <TokenIcon 
                            logo={snsLogo} 
                            size={18} 
                            fallbackIcon={<FaExchangeAlt size={14} />}
                            fallbackColor={activeTab === 'transactions' ? 'white' : theme.colors.secondaryText}
                            rounded={false}
                        />
                        <span>Transactions</span>
                    </button>
                    <button
                        onClick={() => setActiveTab('balances')}
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
                            background: activeTab === 'balances' 
                                ? `linear-gradient(135deg, ${principalPrimary}, ${principalAccent})`
                                : 'transparent',
                            color: activeTab === 'balances' 
                                ? 'white' 
                                : theme.colors.secondaryText,
                        }}
                    >
                        <FaCoins size={14} />
                        <span>Wallet</span>
                        {walletLoading && (
                            <span
                                className="principal-spin"
                                style={{
                                    width: '12px',
                                    height: '12px',
                                    border: `2px solid ${activeTab === 'balances' ? 'rgba(255,255,255,0.6)' : theme.colors.border}`,
                                    borderTopColor: activeTab === 'balances' ? 'white' : principalPrimary,
                                    borderRadius: '50%',
                                    display: 'inline-block'
                                }}
                                title="Loading balances"
                            />
                        )}
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
                            {/* Neurons Header */}
                            <div style={{ 
                                display: 'flex', 
                                alignItems: 'center', 
                                justifyContent: 'space-between',
                                gap: '0.75rem',
                                marginBottom: '1rem',
                                flexWrap: 'wrap'
                            }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                                    <div style={{
                                        width: '40px',
                                        height: '40px',
                                        borderRadius: '10px',
                                        background: `linear-gradient(135deg, ${principalAccent}30, ${principalSecondary}20)`,
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                        color: principalAccent,
                                        overflow: 'hidden'
                                    }}>
                                        <FaBrain size={18} />
                                    </div>
                                    <span style={{ color: theme.colors.primaryText, fontWeight: '600', fontSize: '1.1rem' }}>
                                        {includeReachable ? 'Reachable Neurons' : 'Direct Neurons'}
                                    </span>
                                </div>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
                                    {/* Include reachable toggle */}
                                    <label style={{
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: '0.5rem',
                                        cursor: 'pointer',
                                        color: theme.colors.secondaryText,
                                        fontSize: '0.85rem',
                                        userSelect: 'none',
                                    }}>
                                        <input
                                            type="checkbox"
                                            checked={includeReachable}
                                            onChange={(e) => setIncludeReachable(e.target.checked)}
                                            disabled={loadingReachable}
                                            style={{ cursor: 'pointer', accentColor: principalAccent, width: '14px', height: '14px' }}
                                        />
                                        Include reachable
                                        {loadingReachable && (
                                            <span className="principal-spin" style={{
                                                width: '12px',
                                                height: '12px',
                                                border: `2px solid ${theme.colors.border}`,
                                                borderTopColor: principalAccent,
                                                borderRadius: '50%',
                                                display: 'inline-block'
                                            }} />
                                        )}
                                    </label>
                                    {snsesWithNeurons.length > 0 && (
                                        <div style={{ 
                                            fontSize: '0.85rem', 
                                            color: theme.colors.mutedText,
                                            background: theme.colors.tertiaryBg,
                                            padding: '0.35rem 0.75rem',
                                            borderRadius: '8px'
                                        }}>
                                            {snsesWithNeurons.reduce((sum, s) => sum + s.neuronCount, 0)} total
                                        </div>
                                    )}
                                    <div style={{ 
                                        fontSize: '0.85rem', 
                                        color: theme.colors.secondaryText,
                                        background: theme.colors.tertiaryBg,
                                        padding: '0.35rem 0.75rem',
                                        borderRadius: '8px',
                                        fontWeight: '600',
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: '0.4rem'
                                    }}>
                                        {formatUsd(neuronUsdTotal)}
                                        {neuronUsdLoading && (
                                            <span
                                                className="principal-spin"
                                                style={{
                                                    width: '12px',
                                                    height: '12px',
                                                    border: `2px solid ${theme.colors.border}`,
                                                    borderTopColor: principalAccent,
                                                    borderRadius: '50%',
                                                    display: 'inline-block'
                                                }}
                                                title="Updating USD total"
                                            />
                                        )}
                                    </div>
                                </div>
                            </div>

                            {/* SNS Subtabs */}
                            {snsesWithNeurons.length > 0 && (
                                <div style={{ 
                                    display: 'flex',
                                    flexWrap: 'wrap',
                                    gap: '0.5rem',
                                    marginBottom: '1rem',
                                    background: theme.colors.tertiaryBg,
                                    padding: '0.5rem',
                                    borderRadius: '12px',
                                    border: `1px solid ${theme.colors.border}`
                                }}>
                                    {snsesWithNeurons.map(sns => {
                                        const isActive = activeNeuronSns === sns.rootCanisterId;
                                        const snsLedgerId = sns.ledgerId?.toString?.() || sns.ledgerId;
                                        const snsUsdRate = snsLedgerId ? (neuronUsdRates[snsLedgerId] || 0) : 0;
                                        const snsUsdValue = sns.totalStake ? calculateUsdValue(sns.totalStake, 8, snsUsdRate) : 0;
                                        return (
                                            <button
                                                key={sns.rootCanisterId}
                                                onClick={() => setActiveNeuronSns(sns.rootCanisterId)}
                                                style={{
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    gap: '0.4rem',
                                                    padding: '0.5rem 0.75rem',
                                                    borderRadius: '8px',
                                                    border: 'none',
                                                    cursor: 'pointer',
                                                    fontWeight: '500',
                                                    fontSize: '0.85rem',
                                                    transition: 'all 0.2s ease',
                                                    background: isActive 
                                                        ? `linear-gradient(135deg, ${principalAccent}, ${principalSecondary})`
                                                        : 'transparent',
                                                    color: isActive ? 'white' : theme.colors.secondaryText,
                                                    boxShadow: isActive ? `0 2px 8px ${principalAccent}30` : 'none'
                                                }}
                                            >
                                                <TokenIcon 
                                                    logo={sns.logo} 
                                                    size={18} 
                                                    fallbackIcon={<FaBrain size={12} />}
                                                    fallbackColor={isActive ? 'white' : theme.colors.secondaryText}
                                                    rounded={false}
                                                />
                                                <span>{sns.name}</span>
                                                <span style={{ 
                                                    opacity: 0.8, 
                                                    fontSize: '0.75rem',
                                                    background: isActive ? 'rgba(255,255,255,0.2)' : theme.colors.primaryBg,
                                                    padding: '0.1rem 0.35rem',
                                                    borderRadius: '4px'
                                                }}>
                                                    {sns.neuronCount}
                                                </span>
                                                <span style={{ 
                                                    fontSize: '0.75rem',
                                                    fontWeight: '600',
                                                    color: isActive ? 'rgba(255,255,255,0.9)' : theme.colors.mutedText
                                                }}>
                                                    {formatUsd(snsUsdValue)}
                                                </span>
                                            </button>
                                        );
                                    })}
                                </div>
                            )}

                            {activeSnsSummary && (
                                <div style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'space-between',
                                    gap: '0.75rem',
                                    flexWrap: 'wrap',
                                    marginBottom: '1rem',
                                    padding: '0.75rem 1rem',
                                    borderRadius: '12px',
                                    border: `1px solid ${theme.colors.border}`,
                                    background: theme.colors.primaryBg
                                }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                                        <TokenIcon 
                                            logo={activeSnsSummary.logo} 
                                            size={18} 
                                            fallbackIcon={<FaBrain size={12} />}
                                            fallbackColor={principalAccent}
                                            rounded={false}
                                        />
                                        <span style={{ color: theme.colors.primaryText, fontWeight: '600' }}>
                                            {activeSnsSummary.name}
                                        </span>
                                    </div>
                                    <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.6rem' }}>
                                        <span style={{ 
                                            color: theme.colors.secondaryText, 
                                            fontSize: '0.95rem',
                                            fontWeight: '700'
                                        }}>
                                            {formatAmount(activeSnsSummary.totalStake, 8)} {tokenSymbol}
                                        </span>
                                        <span style={{ 
                                            color: theme.colors.mutedText, 
                                            fontSize: '0.85rem',
                                            fontWeight: '600'
                                        }}>
                                            {formatUsd(activeSnsSummary.usdValue || 0)}
                                        </span>
                                    </div>
                                </div>
                            )}

                            {/* No neurons message */}
                            {snsesWithNeurons.length === 0 && allNeuronsLoaded && (
                                <div style={{ textAlign: 'center', padding: '2rem', color: theme.colors.mutedText }}>
                                    <div style={{
                                        width: '60px',
                                        height: '60px',
                                        borderRadius: '50%',
                                        background: `${principalAccent}15`,
                                        margin: '0 auto 1rem',
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                        color: principalAccent
                                    }}>
                                        <FaBrain size={24} />
                                    </div>
                                    <p style={{ fontSize: '1rem', marginBottom: '0.5rem' }}>No neurons found.</p>
                                    <p style={{ fontSize: '0.9rem', color: theme.colors.mutedText }}>
                                        This principal doesn't have any reachable neurons in any SNS DAO.
                                    </p>
                                </div>
                            )}

                            {/* Loading state for initial fetch */}
                            {loadingAllNeurons && (
                                <div style={{ textAlign: 'center', padding: '2rem', color: theme.colors.mutedText }}>
                                    <div className="principal-pulse" style={{
                                        width: '48px',
                                        height: '48px',
                                        borderRadius: '50%',
                                        background: `linear-gradient(135deg, ${principalAccent}30, ${principalSecondary}20)`,
                                        margin: '0 auto 1rem',
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                        color: principalAccent
                                    }}>
                                        <FaBrain size={20} />
                                    </div>
                                    Scanning all DAOs for neurons...
                                </div>
                            )}

                            {/* Show neuron content only when we have SNS tabs and an active SNS selected */}
                            {snsesWithNeurons.length > 0 && activeNeuronSns && (loadingNeurons ? (
                                <div style={{ textAlign: 'center', padding: '2rem', color: theme.colors.mutedText }}>
                                    <div className="principal-spin" style={{
                                        width: '30px',
                                        height: '30px',
                                        border: `3px solid ${theme.colors.border}`,
                                        borderTopColor: principalAccent,
                                        borderRadius: '50%',
                                        margin: '0 auto 1rem'
                                    }} />
                                    Loading {snsesWithNeurons.find(s => s.rootCanisterId === activeNeuronSns)?.name || 'SNS'} neurons...
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
                                    No neurons found for this SNS.
                                </div>
                            ) : (
                                <div>
                                    {/* Neuron Group Tabs - only show if includeReachable is true and more than one group */}
                                    {includeReachable && groupedNeurons.size > 1 && (
                                        <div style={{ 
                                            display: 'flex',
                                            flexWrap: 'wrap',
                                            gap: '0.5rem',
                                            marginBottom: '1rem',
                                            background: theme.colors.tertiaryBg,
                                            padding: '0.5rem',
                                            borderRadius: '12px',
                                            border: `1px solid ${theme.colors.border}`
                                        }}>
                                            {Array.from(groupedNeurons.entries())
                                                .sort((a, b) => {
                                                    if (a[1].isDirect && !b[1].isDirect) return -1;
                                                    if (!a[1].isDirect && b[1].isDirect) return 1;
                                                    return 0;
                                                })
                                                .map(([groupId, group]) => {
                                                    const isDirect = Boolean(group.isDirect);
                                                    const isActive = activeNeuronGroup === groupId;
                                                    return (
                                                        <button
                                                            key={groupId}
                                                            onClick={() => setActiveNeuronGroup(groupId)}
                                                            style={{
                                                                flex: '1 1 auto',
                                                                minWidth: '120px',
                                                                display: 'flex',
                                                                alignItems: 'center',
                                                                justifyContent: 'center',
                                                                gap: '0.4rem',
                                                                padding: '0.6rem 0.75rem',
                                                                borderRadius: '10px',
                                                                border: 'none',
                                                                cursor: 'pointer',
                                                                fontWeight: '600',
                                                                fontSize: '0.85rem',
                                                                transition: 'all 0.2s ease',
                                                                background: isActive 
                                                                    ? `linear-gradient(135deg, ${principalAccent}, ${principalSecondary})`
                                                                    : 'transparent',
                                                                color: isActive ? 'white' : theme.colors.secondaryText,
                                                                boxShadow: isActive ? `0 2px 8px ${principalAccent}30` : 'none'
                                                            }}
                                                        >
                                                            <span>{isDirect ? <FaCrown size={12} /> : <FaKey size={12} />}</span>
                                                            <span style={{ 
                                                                overflow: 'hidden', 
                                                                textOverflow: 'ellipsis',
                                                                whiteSpace: 'nowrap',
                                                                maxWidth: '150px'
                                                            }}>
                                                                {isDirect ? 'Direct Access' : (
                                                                    principalDisplayInfo.get(group.ownerPrincipal)?.display || 
                                                                    `${group.ownerPrincipal.slice(0, 8)}...`
                                                                )}
                                                            </span>
                                                            <span style={{ 
                                                                background: isActive ? 'rgba(255,255,255,0.2)' : `${principalAccent}20`,
                                                                padding: '0.15rem 0.4rem',
                                                                borderRadius: '6px',
                                                                fontSize: '0.75rem',
                                                                color: isActive ? 'white' : principalAccent
                                                            }}>
                                                                {group.neurons.length}
                                                            </span>
                                                        </button>
                                                    );
                                                })}
                                        </div>
                                    )}

                                    {/* Neuron Cards - show based on grouping when includeReachable is true */}
                                    {(() => {
                                        // Determine which neurons to show
                                        let neuronsToShow = neurons;
                                        let groupHeader = null;

                                        if (includeReachable && groupedNeurons.size > 1 && activeNeuronGroup) {
                                            const activeGroup = groupedNeurons.get(activeNeuronGroup);
                                            if (activeGroup) {
                                                neuronsToShow = activeGroup.neurons;
                                                const isDirect = activeGroup.isDirect;
                                                groupHeader = (
                                                    <div style={{
                                                        display: 'flex',
                                                        alignItems: 'center',
                                                        justifyContent: 'space-between',
                                                        marginBottom: '1rem',
                                                        flexWrap: 'wrap',
                                                        gap: '0.5rem'
                                                    }}>
                                                        <div style={{ 
                                                            display: 'flex', 
                                                            alignItems: 'center', 
                                                            gap: '0.5rem',
                                                            color: theme.colors.secondaryText,
                                                            fontSize: '0.9rem'
                                                        }}>
                                                            {isDirect ? (
                                                                <span>Neurons with direct permissions</span>
                                                            ) : (
                                                                <span style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap' }}>
                                                                    <span>Reachable via</span>
                                                                    {activeGroup.ownerPrincipal && activeGroup.ownerPrincipal.includes('-') ? (
                                                                        <PrincipalDisplay
                                                                            principal={Principal.fromText(activeGroup.ownerPrincipal)}
                                                                            displayInfo={principalDisplayInfo.get(activeGroup.ownerPrincipal)}
                                                                            showCopyButton={false}
                                                                            short={true}
                                                                            noLink={true}
                                                                            isAuthenticated={isAuthenticated}
                                                                        />
                                                                    ) : (
                                                                        <span style={{ color: theme.colors.mutedText }}>{activeGroup.ownerPrincipal?.slice(0, 8) || 'Unknown'}...</span>
                                                                    )}
                                                                </span>
                                                            )}
                                                        </div>
                                                        <div style={{
                                                            color: principalAccent,
                                                            fontSize: '1rem',
                                                            fontWeight: '700',
                                                            whiteSpace: 'nowrap'
                                                        }}>
                                                            {formatE8s(activeGroup.totalStake)} {tokenSymbol}
                                                            <span style={{ 
                                                                marginLeft: '0.5rem',
                                                                color: theme.colors.mutedText,
                                                                fontSize: '0.85rem',
                                                                fontWeight: '600'
                                                            }}>
                                                                {formatUsd(calculateUsdValue(activeGroup.totalStake, 8, activeNeuronUsdRate))}
                                                            </span>
                                                        </div>
                                                    </div>
                                                );
                                            }
                                        }

                                        return (
                                            <>
                                                {groupHeader}
                                                <div style={{ 
                                                    display: 'grid',
                                                    gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))',
                                                    gap: '1rem'
                                                }}>
                                                    {neuronsToShow.map((neuron) => {
                                                        const neuronId = uint8ArrayToHex(neuron.id[0]?.id);
                                                        if (!neuronId) return null;
                                                        const isExpanded = expandedNeuronCards.has(neuronId);

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
                                                                <div style={{ 
                                                                    display: 'flex',
                                                                    alignItems: 'flex-start',
                                                                    justifyContent: 'space-between',
                                                                    gap: '0.75rem',
                                                                    marginBottom: '0.75rem'
                                                                }}>
                                                                    <div>
                                                                        <div style={{ 
                                                                            fontSize: '1.5rem',
                                                                            fontWeight: '700',
                                                                            color: principalAccent,
                                                                            marginBottom: '0.4rem'
                                                                        }}>
                                                                            {formatE8s(neuron.cached_neuron_stake_e8s)} {tokenSymbol}
                                                                        </div>
                                                                        <div style={{
                                                                            color: theme.colors.mutedText,
                                                                            fontSize: '0.9rem',
                                                                            fontWeight: '600'
                                                                        }}>
                                                                            {formatUsd(calculateUsdValue(neuron.cached_neuron_stake_e8s || 0, 8, activeNeuronUsdRate))}
                                                                        </div>
                                                                    </div>
                                                                    <button
                                                                        onClick={() => toggleNeuronCard(neuronId)}
                                                                        style={{
                                                                            background: 'none',
                                                                            border: 'none',
                                                                            padding: '0.25rem',
                                                                            cursor: 'pointer',
                                                                            color: theme.colors.secondaryText
                                                                        }}
                                                                        aria-label={isExpanded ? 'Collapse neuron card' : 'Expand neuron card'}
                                                                    >
                                                                        {isExpanded ? <FaChevronDown size={14} /> : <FaChevronRight size={14} />}
                                                                    </button>
                                                                </div>

                                                                <div style={{ marginBottom: isExpanded ? '1rem' : 0 }}>
                                                                    {formatNeuronIdLink(neuronId, activeNeuronSns || selectedSnsRoot || SNEED_SNS_ROOT)}
                                                                </div>

                                                                {isExpanded && (
                                                                    <>
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
                                                                                    <FaCrown size={12} style={{ color: theme.colors.secondaryText }} title="Owner" />
                                                                                    <PrincipalDisplay 
                                                                                        principal={Principal.fromText(getOwnerPrincipals(neuron)[0])}
                                                                                        displayInfo={principalDisplayInfo.get(getOwnerPrincipals(neuron)[0])}
                                                                                        showCopyButton={false}
                                                                                        isAuthenticated={isAuthenticated}
                                                                                    />
                                                                                </div>
                                                                            )}
                                                                            {neuron.permissions
                                                                                .filter(p => !getOwnerPrincipals(neuron).includes(safePrincipalString(p.principal)))
                                                                                .map((p, index) => {
                                                                                    const principalStr = safePrincipalString(p.principal);
                                                                                    return (
                                                                                        <div key={index} style={{ 
                                                                                            display: 'flex',
                                                                                            alignItems: 'center',
                                                                                            gap: '8px',
                                                                                            marginBottom: '6px'
                                                                                        }}>
                                                                                            <FaKey size={12} style={{ color: theme.colors.secondaryText }} title="Hotkey" />
                                                                                            <PrincipalDisplay 
                                                                                                principal={p.principal}
                                                                                                displayInfo={principalDisplayInfo.get(principalStr)}
                                                                                                showCopyButton={false}
                                                                                                isAuthenticated={isAuthenticated}
                                                                                            />
                                                                                        </div>
                                                                                    );
                                                                                })
                                                                            }
                                                                        </div>
                                                                    </>
                                                                )}
                                                            </div>
                                                        );
                                                    })}
                                                </div>
                                            </>
                                        );
                                    })()}
                                </div>
                            ))}
                        </div>
                    )}

                    {/* Transactions Tab */}
                    {activeTab === 'transactions' && (
                        <div style={{ padding: '1rem' }}>
                            {/* Transactions Header */}
                            <div style={{ 
                                display: 'flex', 
                                alignItems: 'center', 
                                gap: '0.75rem',
                                marginBottom: '1rem'
                            }}>
                                <div style={{
                                    width: '40px',
                                    height: '40px',
                                    borderRadius: '10px',
                                    background: snsLogo ? 'transparent' : `linear-gradient(135deg, ${principalSecondary}30, ${principalPrimary}20)`,
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    color: principalSecondary,
                                    overflow: 'hidden'
                                }}>
                                    {snsLogo ? (
                                        <img src={snsLogo} alt="DAO" style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: '10px' }} />
                                    ) : (
                                        <FaExchangeAlt size={18} />
                                    )}
                                </div>
                                <span style={{ color: theme.colors.primaryText, fontWeight: '600', fontSize: '1.1rem' }}>
                                    {snsInfo?.name || 'DAO'} Transactions
                                </span>
                            </div>

                            <TransactionList 
                                snsRootCanisterId={searchParams.get('sns') || selectedSnsRoot || SNEED_SNS_ROOT}
                                principalId={stablePrincipalId.current?.toString()}
                                showHeader={false}
                                embedded={true}
                                showSubaccountFilter={true}
                                initialSubaccountFilter={searchParams.get('subaccount') || null}
                                onSubaccountFilterChange={(subaccountHex) => {
                                    // Update URL with subaccount param for shareability
                                    const newParams = new URLSearchParams(searchParams);
                                    if (subaccountHex) {
                                        newParams.set('subaccount', subaccountHex);
                                    } else {
                                        newParams.delete('subaccount');
                                    }
                                    setSearchParams(newParams, { replace: true });
                                }}
                            />
                        </div>
                    )}

                    {/* Wallet Tab */}
                    {activeTab === 'balances' && (
                        <div style={{ padding: '1rem' }}>
                            <div style={{ 
                                display: 'flex', 
                                alignItems: 'center', 
                                gap: '0.75rem',
                                marginBottom: '1rem'
                            }}>
                                <div style={{
                                    width: '40px',
                                    height: '40px',
                                    borderRadius: '12px',
                                    background: `linear-gradient(135deg, ${principalPrimary}25, ${principalAccent}15)`,
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    color: principalPrimary
                                }}>
                                    <FaCoins size={18} />
                                </div>
                                <span style={{ color: theme.colors.primaryText, fontWeight: '600', fontSize: '1.1rem' }}>
                                    Wallet
                                </span>
                                <span style={{ 
                                    marginLeft: 'auto',
                                    color: theme.colors.secondaryText, 
                                    fontSize: '0.95rem',
                                    fontWeight: '600'
                                }}>
                                    {formatUsd(tokenUsdTotal)}
                                </span>
                            </div>

                            <div style={{
                                display: 'flex',
                                flexWrap: 'wrap',
                                alignItems: 'center',
                                gap: '0.75rem',
                                marginBottom: '1rem',
                                padding: '0.75rem 0.9rem',
                                borderRadius: '12px',
                                border: `1px solid ${theme.colors.border}`,
                                background: theme.colors.tertiaryBg
                            }}>
                                <button
                                    onClick={handleScanForTokens}
                                    disabled={scanningTokens || !stablePrincipalId.current}
                                    style={{
                                        background: `linear-gradient(135deg, ${principalPrimary}25, ${principalAccent}20)`,
                                        color: principalPrimary,
                                        border: `1px solid ${principalPrimary}30`,
                                        borderRadius: '999px',
                                        padding: '0.45rem 0.9rem',
                                        cursor: scanningTokens ? 'not-allowed' : 'pointer',
                                        fontSize: '0.85rem',
                                        fontWeight: '600',
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: '0.4rem',
                                        transition: 'all 0.2s ease',
                                        opacity: scanningTokens ? 0.6 : 1
                                    }}
                                    title="Scan all whitelisted tokens for balances"
                                >
                                    <FaSearch size={12} style={{ animation: scanningTokens ? 'spin 1s linear infinite' : 'none' }} />
                                    {scanningTokens 
                                        ? `Scanning ${scanProgress.current}/${scanProgress.total}${scanProgress.found > 0 ? ` (${scanProgress.found} found)` : ''}`
                                        : 'Scan Tokens'
                                    }
                                </button>
                                {scanError && (
                                    <span style={{ color: '#ef4444', fontSize: '0.85rem' }}>{scanError}</span>
                                )}
                                {!scanningTokens && scannedTokens.length > 0 && (
                                    <span style={{ color: theme.colors.mutedText, fontSize: '0.85rem' }}>
                                        Found {scannedTokens.length} token{scannedTokens.length === 1 ? '' : 's'} with balance
                                    </span>
                                )}
                            </div>

                            {scannedTokens.length > 0 && (
                                <div style={{
                                    display: 'grid',
                                    gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
                                    gap: '0.7rem',
                                    marginBottom: '1.25rem',
                                    alignItems: 'stretch'
                                }}>
                                    {scannedTokens.map(token => (
                                        <div
                                            key={token.ledgerId}
                                            style={{
                                                display: 'flex',
                                                alignItems: 'center',
                                                gap: '0.7rem',
                                                padding: '0.65rem 0.9rem',
                                                borderRadius: '999px',
                                                border: `1px solid ${theme.colors.border}`,
                                                background: `linear-gradient(135deg, ${theme.colors.secondaryBg}, ${theme.colors.tertiaryBg})`,
                                                width: '100%',
                                                boxSizing: 'border-box'
                                            }}
                                        >
                                            <TokenIcon 
                                                logo={token.logo} 
                                                alt={token.symbol} 
                                                size={22} 
                                                fallbackColor={principalPrimary} 
                                            />
                                            <div style={{ minWidth: 0, flex: 1 }}>
                                                <div style={{ 
                                                    display: 'flex', 
                                                    alignItems: 'center', 
                                                    gap: '0.45rem',
                                                    flexWrap: 'wrap'
                                                }}>
                                                    <span style={{ 
                                                        fontWeight: '700', 
                                                        color: theme.colors.primaryText,
                                                        fontSize: '0.92rem',
                                                        letterSpacing: '0.2px'
                                                    }}>
                                                        {token.symbol}
                                                    </span>
                                                    {token.name && (
                                                        <span style={{ 
                                                            color: theme.colors.mutedText, 
                                                            fontSize: '0.75rem'
                                                        }}>
                                                            {token.name}
                                                        </span>
                                                    )}
                                                </div>
                                                <div style={{ 
                                                    display: 'flex',
                                                    alignItems: 'baseline',
                                                    gap: '0.4rem'
                                                }}>
                                                    <span style={{ 
                                                        color: theme.colors.secondaryText, 
                                                        fontSize: '0.9rem',
                                                        fontWeight: '700'
                                                    }}>
                                                        {formatAmount(token.balance, token.decimals)}
                                                    </span>
                                                    <span style={{ 
                                                        marginLeft: 'auto',
                                                        color: theme.colors.primaryText, 
                                                        fontSize: '0.8rem',
                                                        fontWeight: '600'
                                                    }}>
                                                        {formatUsd(token.usdValue || 0)}
                                                    </span>
                                                </div>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    )}

                    {/* Trades Tab */}
                    {activeTab === 'trades' && (
                        <div style={{ padding: '1.25rem' }}>
                            {/* Sub-tab Navigation for Offers/Bids */}
                            <div style={{
                                display: 'flex',
                                justifyContent: 'space-between',
                                alignItems: 'center',
                                borderBottom: `1px solid ${theme.colors.border}`,
                                marginBottom: '1.25rem',
                                flexWrap: 'wrap',
                                gap: '0.5rem'
                            }}>
                                <div style={{ display: 'flex' }}>
                                    <button
                                        onClick={() => setTradesActiveTab('offers')}
                                        style={{
                                            background: 'transparent',
                                            border: 'none',
                                            color: tradesActiveTab === 'offers' ? '#8b5cf6' : theme.colors.mutedText,
                                            fontSize: '0.95rem',
                                            fontWeight: '600',
                                            padding: '12px 20px',
                                            cursor: 'pointer',
                                            borderBottom: tradesActiveTab === 'offers' ? '2px solid #8b5cf6' : '2px solid transparent',
                                            transition: 'all 0.2s',
                                            display: 'flex',
                                            alignItems: 'center',
                                            gap: '8px'
                                        }}
                                    >
                                        <FaGavel size={12} />
                                        Offers ({userOffers.length})
                                    </button>
                                    <button
                                        onClick={() => setTradesActiveTab('bids')}
                                        style={{
                                            background: 'transparent',
                                            border: 'none',
                                            color: tradesActiveTab === 'bids' ? '#8b5cf6' : theme.colors.mutedText,
                                            fontSize: '0.95rem',
                                            fontWeight: '600',
                                            padding: '12px 20px',
                                            cursor: 'pointer',
                                            borderBottom: tradesActiveTab === 'bids' ? '2px solid #8b5cf6' : '2px solid transparent',
                                            transition: 'all 0.2s',
                                            display: 'flex',
                                            alignItems: 'center',
                                            gap: '8px'
                                        }}
                                    >
                                        <FaHandHoldingUsd size={12} />
                                        Bids ({userBids.length})
                                    </button>
                                </div>
                                
                                {/* Active Only Toggle */}
                                <div style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '0.5rem',
                                    padding: '0.5rem 0.75rem',
                                    marginBottom: '2px'
                                }}>
                                    <span style={{
                                        fontSize: '0.8rem',
                                        color: theme.colors.mutedText,
                                        fontWeight: '500'
                                    }}>
                                        Active only
                                    </span>
                                    <button
                                        onClick={() => {
                                            if (tradesActiveTab === 'offers') {
                                                setShowOnlyActiveOffers(!showOnlyActiveOffers);
                                            } else {
                                                setShowOnlyActiveBids(!showOnlyActiveBids);
                                            }
                                        }}
                                        style={{
                                            width: '40px',
                                            height: '22px',
                                            borderRadius: '11px',
                                            border: 'none',
                                            cursor: 'pointer',
                                            padding: '2px',
                                            background: (tradesActiveTab === 'offers' ? showOnlyActiveOffers : showOnlyActiveBids)
                                                ? 'linear-gradient(135deg, #22c55e, #16a34a)'
                                                : theme.colors.tertiaryBg,
                                            transition: 'all 0.2s ease',
                                            position: 'relative'
                                        }}
                                    >
                                        <div style={{
                                            width: '18px',
                                            height: '18px',
                                            borderRadius: '50%',
                                            background: 'white',
                                            boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
                                            transition: 'transform 0.2s ease',
                                            transform: (tradesActiveTab === 'offers' ? showOnlyActiveOffers : showOnlyActiveBids)
                                                ? 'translateX(18px)'
                                                : 'translateX(0)'
                                        }} />
                                    </button>
                                </div>
                            </div>

                            {loadingTrades ? (
                                <div style={{ textAlign: 'center', padding: '2rem', color: theme.colors.mutedText }}>
                                    <div className="principal-spin" style={{
                                        width: '30px',
                                        height: '30px',
                                        border: `3px solid ${theme.colors.border}`,
                                        borderTopColor: '#8b5cf6',
                                        borderRadius: '50%',
                                        margin: '0 auto 1rem'
                                    }} />
                                    Loading trades...
                                </div>
                            ) : tradesError ? (
                                <div style={{ 
                                    background: `${theme.colors.error}15`,
                                    border: `1px solid ${theme.colors.error}40`,
                                    color: theme.colors.error,
                                    padding: '1rem',
                                    borderRadius: '10px'
                                }}>
                                    {tradesError}
                                </div>
                            ) : (
                                <div>
                                    {tradesActiveTab === 'offers' ? (
                                        (() => {
                                            const filteredOffers = showOnlyActiveOffers 
                                                ? userOffers.filter(o => 'Active' in o.state)
                                                : userOffers;
                                            
                                            return filteredOffers.length === 0 ? (
                                                <div style={{ textAlign: 'center', padding: '2rem', color: theme.colors.mutedText }}>
                                                    {showOnlyActiveOffers && userOffers.length > 0 
                                                        ? 'No active offers found'
                                                        : 'No offers found'}
                                                </div>
                                            ) : (
                                                <div style={{ 
                                                    display: 'grid',
                                                    gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
                                                    gap: '1rem'
                                                }}>
                                                    {filteredOffers.map((offer) => {
                                                        const tokenInfo = getTradeTokenInfo(offer.price_token_ledger.toString());
                                                        const stateStr = getOfferStateString(offer.state);
                                                        const isActive = 'Active' in offer.state;
                                                        
                                                        return (
                                                        <Link
                                                            key={Number(offer.id)}
                                                            to={`/sneedex_offer/${offer.id}`}
                                                            style={{
                                                                textDecoration: 'none',
                                                                color: 'inherit'
                                                            }}
                                                        >
                                                            <div
                                                                style={{
                                                                    background: theme.colors.primaryBg,
                                                                    border: `1px solid ${theme.colors.border}`,
                                                                    borderRadius: '12px',
                                                                    padding: '1rem',
                                                                    cursor: 'pointer',
                                                                    transition: 'all 0.2s ease',
                                                                    position: 'relative',
                                                                    overflow: 'hidden'
                                                                }}
                                                                onMouseEnter={(e) => {
                                                                    e.currentTarget.style.transform = 'translateY(-2px)';
                                                                    e.currentTarget.style.borderColor = '#8b5cf6';
                                                                }}
                                                                onMouseLeave={(e) => {
                                                                    e.currentTarget.style.transform = 'translateY(0)';
                                                                    e.currentTarget.style.borderColor = theme.colors.border;
                                                                }}
                                                            >
                                                                {/* Status Banner for inactive offers */}
                                                                {(() => {
                                                                    let bannerText = null;
                                                                    let bannerColor = null;
                                                                    
                                                                    if ('Completed' in offer.state || 'Claimed' in offer.state) {
                                                                        bannerText = 'SOLD';
                                                                        bannerColor = 'linear-gradient(135deg, #22c55e, #16a34a)';
                                                                    } else if ('Expired' in offer.state || 'Reclaimed' in offer.state) {
                                                                        bannerText = 'EXPIRED';
                                                                        bannerColor = 'linear-gradient(135deg, #6b7280, #4b5563)';
                                                                    } else if ('Cancelled' in offer.state) {
                                                                        bannerText = 'CANCELLED';
                                                                        bannerColor = 'linear-gradient(135deg, #f59e0b, #d97706)';
                                                                    }
                                                                    
                                                                    return bannerText ? (
                                                                        <div style={{
                                                                            position: 'absolute',
                                                                            top: '12px',
                                                                            right: '-28px',
                                                                            background: bannerColor,
                                                                            color: '#fff',
                                                                            padding: '3px 35px',
                                                                            fontWeight: '700',
                                                                            fontSize: '0.6rem',
                                                                            transform: 'rotate(45deg)',
                                                                            boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
                                                                            zIndex: 10,
                                                                            letterSpacing: '0.5px',
                                                                        }}>
                                                                            {bannerText}
                                                                        </div>
                                                                    ) : null;
                                                                })()}
                                                                
                                                                <div style={{ 
                                                                    display: 'flex', 
                                                                    justifyContent: 'space-between', 
                                                                    alignItems: 'flex-start', 
                                                                    marginBottom: '0.75rem' 
                                                                }}>
                                                                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                                                        <span style={{
                                                                            color: '#8b5cf6',
                                                                            fontWeight: '600',
                                                                            fontSize: '0.9rem'
                                                                        }}>
                                                                            Offer #{Number(offer.id)}
                                                                        </span>
                                                                        <div style={{ display: 'flex', gap: '4px', color: theme.colors.mutedText }}>
                                                                            {getOfferAssetIcons(offer.assets)}
                                                                        </div>
                                                                    </div>
                                                                    <span style={getTradeStateBadgeStyle(offer.state, true)}>
                                                                        {stateStr}
                                                                    </span>
                                                                </div>
                                                                
                                                                <div style={{ 
                                                                    display: 'grid', 
                                                                    gridTemplateColumns: '1fr 1fr', 
                                                                    gap: '0.5rem',
                                                                    fontSize: '0.85rem'
                                                                }}>
                                                                    <div>
                                                                        <div style={{ color: theme.colors.mutedText, fontSize: '0.75rem' }}>Min Bid</div>
                                                                        <div style={{ color: theme.colors.primaryText, fontWeight: '500' }}>
                                                                            {offer.min_bid_price[0] 
                                                                                ? `${formatAmount(offer.min_bid_price[0], tokenInfo.decimals)} ${tokenInfo.symbol}`
                                                                                : '—'}
                                                                        </div>
                                                                    </div>
                                                                    <div>
                                                                        <div style={{ color: theme.colors.mutedText, fontSize: '0.75rem' }}>Buyout</div>
                                                                        <div style={{ color: theme.colors.primaryText, fontWeight: '500' }}>
                                                                            {offer.buyout_price[0] 
                                                                                ? `${formatAmount(offer.buyout_price[0], tokenInfo.decimals)} ${tokenInfo.symbol}`
                                                                                : '—'}
                                                                        </div>
                                                                    </div>
                                                                    <div style={{ gridColumn: '1 / -1' }}>
                                                                        <div style={{ color: theme.colors.mutedText, fontSize: '0.75rem' }}>
                                                                            {isActive ? 'Time Left' : 'Status'}
                                                                        </div>
                                                                        <div style={{ 
                                                                            color: isActive && isOfferPastExpiration(offer.expiration[0]) 
                                                                                ? theme.colors.warning 
                                                                                : theme.colors.primaryText, 
                                                                            fontWeight: '500',
                                                                            display: 'flex',
                                                                            alignItems: 'center',
                                                                            gap: '4px'
                                                                        }}>
                                                                            {isActive && <FaClock size={10} />}
                                                                            {isActive ? formatTimeRemaining(offer.expiration[0]) : stateStr}
                                                                        </div>
                                                                    </div>
                                                                </div>
                                                            </div>
                                                        </Link>
                                                    );
                                                })}
                                            </div>
                                            );
                                        })()
                                    ) : (
                                        (() => {
                                            const filteredBids = showOnlyActiveBids 
                                                ? userBids.filter(b => 'Pending' in b.state)
                                                : userBids;
                                            
                                            return filteredBids.length === 0 ? (
                                                <div style={{ textAlign: 'center', padding: '2rem', color: theme.colors.mutedText }}>
                                                    {showOnlyActiveBids && userBids.length > 0 
                                                        ? 'No active bids found'
                                                        : 'No bids found'}
                                                </div>
                                            ) : (
                                                <div style={{ 
                                                    display: 'grid',
                                                    gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
                                                    gap: '1rem'
                                                }}>
                                                    {filteredBids.map((bid) => {
                                                        const stateStr = getBidStateString(bid.state);
                                                        const isWon = 'Won' in bid.state;
                                                        const isLost = 'Lost' in bid.state;
                                                        const isPending = 'Pending' in bid.state;
                                                        
                                                        return (
                                                        <Link
                                                            key={Number(bid.id)}
                                                            to={`/sneedex_offer/${bid.offer_id}`}
                                                            style={{
                                                                textDecoration: 'none',
                                                                color: 'inherit'
                                                            }}
                                                        >
                                                            <div
                                                                style={{
                                                                    background: theme.colors.primaryBg,
                                                                    border: `1px solid ${theme.colors.border}`,
                                                                    borderRadius: '12px',
                                                                    padding: '1rem',
                                                                    cursor: 'pointer',
                                                                    transition: 'all 0.2s ease'
                                                                }}
                                                                onMouseEnter={(e) => {
                                                                    e.currentTarget.style.transform = 'translateY(-2px)';
                                                                    e.currentTarget.style.borderColor = '#8b5cf6';
                                                                }}
                                                                onMouseLeave={(e) => {
                                                                    e.currentTarget.style.transform = 'translateY(0)';
                                                                    e.currentTarget.style.borderColor = theme.colors.border;
                                                                }}
                                                            >
                                                                <div style={{ 
                                                                    display: 'flex', 
                                                                    justifyContent: 'space-between', 
                                                                    alignItems: 'flex-start', 
                                                                    marginBottom: '0.75rem' 
                                                                }}>
                                                                    <span style={{
                                                                        color: '#8b5cf6',
                                                                        fontWeight: '600',
                                                                        fontSize: '0.9rem'
                                                                    }}>
                                                                        Bid on Offer #{Number(bid.offer_id)}
                                                                    </span>
                                                                    <span style={getTradeStateBadgeStyle(bid.state, false)}>
                                                                        {stateStr}
                                                                    </span>
                                                                </div>
                                                                
                                                                <div style={{ 
                                                                    fontSize: '0.85rem'
                                                                }}>
                                                                    <div style={{ marginBottom: '0.5rem' }}>
                                                                        <div style={{ color: theme.colors.mutedText, fontSize: '0.75rem' }}>Bid Amount</div>
                                                                        <div style={{ 
                                                                            color: isWon ? theme.colors.success : isLost ? theme.colors.error : theme.colors.primaryText, 
                                                                            fontWeight: '600',
                                                                            fontSize: '1rem'
                                                                        }}>
                                                                            {formatAmount(bid.amount, 8)} tokens
                                                                        </div>
                                                                    </div>
                                                                    <div>
                                                                        <div style={{ color: theme.colors.mutedText, fontSize: '0.75rem' }}>Status</div>
                                                                        <div style={{ 
                                                                            color: isWon ? theme.colors.success : isLost ? theme.colors.error : isPending ? theme.colors.warning : theme.colors.primaryText, 
                                                                            fontWeight: '500',
                                                                            display: 'flex',
                                                                            alignItems: 'center',
                                                                            gap: '4px'
                                                                        }}>
                                                                            {isWon && <FaCheckCircle size={10} />}
                                                                            {isLost && <FaTimes size={10} />}
                                                                            {isPending && <FaClock size={10} />}
                                                                            {stateStr}
                                                                        </div>
                                                                    </div>
                                                                </div>
                                                            </div>
                                                        </Link>
                                                        );
                                                    })}
                                                </div>
                                            );
                                        })()
                                    )}
                                </div>
                            )}
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
            
            {/* Message Dialog */}
            <MessageDialog
                isOpen={messageDialogOpen}
                onClose={() => setMessageDialogOpen(false)}
                initialRecipient={stablePrincipalId.current?.toString() || ''}
            />
        </div>
    );
}
