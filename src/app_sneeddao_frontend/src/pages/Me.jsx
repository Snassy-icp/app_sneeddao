import React, { useState, useEffect } from 'react';
import { useAuth } from '../AuthContext';
import { useNavigate, useSearchParams } from 'react-router-dom';
import Header from '../components/Header';
import { useTheme } from '../contexts/ThemeContext';
import { fetchAndCacheSnsData, getSnsById, fetchSnsLogo } from '../utils/SnsUtils';
import { createActor as createIcrc1Actor } from 'external/icrc1_ledger';
import { createActor as createSnsGovernanceActor } from 'external/sns_governance';
import { HttpAgent } from '@dfinity/agent';
import { 
    fetchUserNeuronsForSns, 
    formatE8s, 
    getDissolveState, 
    formatNeuronIdLink,
    uint8ArrayToHex,
    getOwnerPrincipals,
    safePrincipalString,
    safePermissionType
} from '../utils/NeuronUtils';
import { useWalletOptional } from '../contexts/WalletContext';
import {
    setNeuronName,
    setNeuronNickname,
    getNeuronName,
    getNeuronNickname,
    getAllNeuronNames,
    getAllNeuronNicknames,
    setPrincipalName,
    getPrincipalName,
    getPostsByUser,
    getThreadsByUser,
    getTipsGivenByUser,
    getTipsReceivedByUser
} from '../utils/BackendUtils';
import { useForum } from '../contexts/ForumContext';
import { useNaming } from '../NamingContext';
import { Link } from 'react-router-dom';
import ConfirmationModal from '../ConfirmationModal';
import { PrincipalDisplay, getPrincipalDisplayInfoFromContext } from '../utils/PrincipalUtils';
import TransactionList from '../components/TransactionList';
import { useSns } from '../contexts/SnsContext';
import { calculateVotingPower, formatVotingPower } from '../utils/VotingPowerUtils';
import { 
    getNeuronManagerSettings, 
    saveNeuronManagerSettings, 
    getCanisterManagerSettings,
    saveCanisterManagerSettings,
    formatCyclesCompact, 
    parseCyclesInput, 
    getCyclesColor 
} from '../utils/NeuronManagerSettings';
import usePremiumStatus, { PremiumBadge } from '../hooks/usePremiumStatus';
import ThemeToggle from '../components/ThemeToggle';
import TokenIcon from '../components/TokenIcon';
import { Principal } from '@dfinity/principal';
import { createSneedexActor } from '../utils/SneedexUtils';
import { FaUser, FaCrown, FaWallet, FaComments, FaCoins, FaEnvelope, FaGift, FaLock, FaServer, FaAddressBook, FaCog, FaChevronRight, FaChevronDown, FaBrain, FaExchangeAlt, FaCheckCircle, FaBell, FaPalette, FaGavel, FaShareAlt, FaExternalLinkAlt } from 'react-icons/fa';

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

@keyframes spin {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
}

.me-card-animate {
    animation: fadeInUp 0.5s ease-out forwards;
}

.me-shimmer {
    background: linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.1) 50%, transparent 100%);
    background-size: 200% 100%;
    animation: shimmer 2s infinite;
}

.me-pulse {
    animation: pulse 2s ease-in-out infinite;
}

.quick-nav-item {
    transition: all 0.3s ease;
}

.quick-nav-item:hover {
    transform: translateY(-3px);
}

.settings-card:hover {
    transform: translateY(-2px);
}
`;

// Accent colors
const mePrimary = '#6366f1'; // Indigo
const meSecondary = '#8b5cf6'; // Purple
const meAccent = '#06b6d4'; // Cyan

export default function Me() {
    const { theme } = useTheme();
    const { identity } = useAuth();
    const { selectedSnsRoot, updateSelectedSns } = useSns();
    const { createForumActor } = useForum();
    
    // Use WalletContext's global neuron cache for user neurons
    const walletContext = useWalletOptional();
    const getNeuronsForGovernance = walletContext?.getNeuronsForGovernance;
    const navigate = useNavigate();
    const [searchParams, setSearchParams] = useSearchParams();
    const [snsList, setSnsList] = useState([]);
    const [neurons, setNeurons] = useState([]);
    const [error, setError] = useState(null);
    const [loading, setLoading] = useState(false);
    const [loadingSnses, setLoadingSnses] = useState(true);
    const [activeTab, setActiveTab] = useState('neurons'); // 'neurons', 'transactions', 'settings'
    const [expandedGroups, setExpandedGroups] = useState(new Set(['self']));
    const [activeNeuronGroup, setActiveNeuronGroup] = useState('self'); // Track active neuron group tab
    const [tokenSymbol, setTokenSymbol] = useState('SNS');
    const [editingName, setEditingName] = useState(null);
    const [nameInput, setNameInput] = useState('');
    const [inputError, setInputError] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [showConfirmModal, setShowConfirmModal] = useState(false);
    const [confirmAction, setConfirmAction] = useState(null);
    const [confirmMessage, setConfirmMessage] = useState('');
    const [principalName, setPrincipalNameState] = useState(null);
    const [isVerified, setIsVerified] = useState(false);
    const [editingPrincipalName, setEditingPrincipalName] = useState(false);
    const [principalNameInput, setPrincipalNameInput] = useState('');
    const [principalNameError, setPrincipalNameError] = useState('');
    const [isSubmittingPrincipalName, setIsSubmittingPrincipalName] = useState(false);
    const [principalDisplayInfo, setPrincipalDisplayInfo] = useState(new Map());
    const [nervousSystemParameters, setNervousSystemParameters] = useState(null);
    const [hideEmptyNeurons, setHideEmptyNeurons] = useState(() => {
        try {
            const saved = localStorage.getItem('hideEmptyNeurons_Me');
            return saved !== null ? JSON.parse(saved) : false;
        } catch (error) {
            return false;
        }
    });
    
    // Settings section
    const [generalSettingsExpanded, setGeneralSettingsExpanded] = useState(false);
    const [neuronManagerSettingsExpanded, setNeuronManagerSettingsExpanded] = useState(false);
    const [cycleThresholdRed, setCycleThresholdRed] = useState('');
    const [cycleThresholdOrange, setCycleThresholdOrange] = useState('');
    const [settingsSaved, setSettingsSaved] = useState(false);
    
    // Sneedex notification settings
    const [sneedexNotificationsExpanded, setSneedexNotificationsExpanded] = useState(false);
    const [notifyOnBid, setNotifyOnBid] = useState(true);
    const [notifyOnOutbid, setNotifyOnOutbid] = useState(true);
    const [notifyOnSale, setNotifyOnSale] = useState(true);
    const [notifyOnExpiration, setNotifyOnExpiration] = useState(true);
    const [notifyOnWin, setNotifyOnWin] = useState(true);
    const [notifyOnCancellation, setNotifyOnCancellation] = useState(true);
    const [notifyOnPrivateInvite, setNotifyOnPrivateInvite] = useState(true);
    const [loadingNotificationSettings, setLoadingNotificationSettings] = useState(false);
    const [notificationSettingsSaved, setNotificationSettingsSaved] = useState(false);

    // Color coding settings
    const [principalColorCoding, setPrincipalColorCoding] = useState(() => {
        try {
            const saved = localStorage.getItem('principalColorCoding');
            return saved !== null ? JSON.parse(saved) : true;
        } catch (error) {
            return true;
        }
    });
    const [neuronColorCoding, setNeuronColorCoding] = useState(() => {
        try {
            const saved = localStorage.getItem('neuronColorCoding');
            return saved !== null ? JSON.parse(saved) : true;
        } catch (error) {
            return true;
        }
    });
    const [showVpBar, setShowVpBar] = useState(() => {
        try {
            const saved = localStorage.getItem('showVpBar');
            return saved !== null ? JSON.parse(saved) : true;
        } catch (error) {
            return true;
        }
    });
    const [showHeaderNotifications, setShowHeaderNotifications] = useState(() => {
        try {
            const saved = localStorage.getItem('showHeaderNotifications');
            return saved !== null ? JSON.parse(saved) : true;
        } catch (error) {
            return true;
        }
    });
    const [collectiblesThreshold, setCollectiblesThreshold] = useState(() => {
        try {
            const saved = localStorage.getItem('collectiblesThreshold');
            return saved !== null ? parseFloat(saved) : 1.0;
        } catch (error) {
            return 1.0;
        }
    });
    const [expandQuickLinksOnDesktop, setExpandQuickLinksOnDesktop] = useState(() => {
        try {
            const saved = localStorage.getItem('expandQuickLinksOnDesktop');
            return saved !== null ? JSON.parse(saved) : false;
        } catch (error) {
            return false;
        }
    });
    
    // Particle effects setting (sparkles on tips, fireworks on /tips page)
    const [particleEffectsEnabled, setParticleEffectsEnabled] = useState(() => {
        try {
            const saved = localStorage.getItem('particleEffectsEnabled');
            return saved !== null ? JSON.parse(saved) : true; // Default ON
        } catch (error) {
            return true;
        }
    });

    const [canisterManagerSettingsExpanded, setCanisterManagerSettingsExpanded] = useState(false);
    const [canisterCycleThresholdRed, setCanisterCycleThresholdRed] = useState('');
    const [canisterCycleThresholdOrange, setCanisterCycleThresholdOrange] = useState('');
    const [canisterSettingsSaved, setCanisterSettingsSaved] = useState(false);
    
    // Cache management
    const [cacheManagementExpanded, setCacheManagementExpanded] = useState(false);
    const [clearingCache, setClearingCache] = useState(false);
    const [cacheCleared, setCacheCleared] = useState(false);
    
    // Quick access expanded state (persisted) - must be before any early returns
    const [quickAccessExpanded, setQuickAccessExpanded] = useState(() => {
        try {
            const saved = localStorage.getItem('quickAccessExpanded');
            return saved !== null ? JSON.parse(saved) : true;
        } catch (error) {
            return true;
        }
    });
    
    // User activity stats
    const [userStats, setUserStats] = useState({
        postsCount: 0,
        threadsCount: 0,
        tipsGivenCount: 0,
        tipsReceivedCount: 0,
        loadingStats: false
    });
    
    // Load neuron manager settings on mount
    useEffect(() => {
        const settings = getNeuronManagerSettings();
        setCycleThresholdRed(formatCyclesCompact(settings.cycleThresholdRed));
        setCycleThresholdOrange(formatCyclesCompact(settings.cycleThresholdOrange));
    }, []);

    // Load canister manager settings on mount
    useEffect(() => {
        const settings = getCanisterManagerSettings();
        setCanisterCycleThresholdRed(formatCyclesCompact(settings.cycleThresholdRed));
        setCanisterCycleThresholdOrange(formatCyclesCompact(settings.cycleThresholdOrange));
    }, []);
    
    // Load Sneedex notification settings when identity is available
    useEffect(() => {
        const loadNotificationSettings = async () => {
            if (!identity) return;
            
            setLoadingNotificationSettings(true);
            try {
                const actor = await createSneedexActor(identity);
                const settings = await actor.getMyNotificationSettings();
                setNotifyOnBid(settings.notify_on_bid);
                setNotifyOnOutbid(settings.notify_on_outbid);
                setNotifyOnSale(settings.notify_on_sale);
                setNotifyOnExpiration(settings.notify_on_expiration);
                setNotifyOnWin(settings.notify_on_win);
                setNotifyOnCancellation(settings.notify_on_cancellation ?? true);
                setNotifyOnPrivateInvite(settings.notify_on_private_invite ?? true);
            } catch (err) {
                console.error('Failed to load notification settings:', err);
            } finally {
                setLoadingNotificationSettings(false);
            }
        };
        
        loadNotificationSettings();
    }, [identity]);
    
    // Load user activity stats
    useEffect(() => {
        const fetchUserStats = async () => {
            if (!identity || !createForumActor) return;
            
            setUserStats(prev => ({ ...prev, loadingStats: true }));
            try {
                const forumActor = createForumActor(identity);
                const userPrincipal = identity.getPrincipal();
                
                const [posts, threads, tipsGiven, tipsReceived] = await Promise.all([
                    getPostsByUser(forumActor, userPrincipal).catch(() => []),
                    getThreadsByUser(forumActor, userPrincipal).catch(() => []),
                    getTipsGivenByUser(forumActor, userPrincipal).catch(() => []),
                    getTipsReceivedByUser(forumActor, userPrincipal).catch(() => [])
                ]);
                
                setUserStats({
                    postsCount: posts?.length || 0,
                    threadsCount: threads?.length || 0,
                    tipsGivenCount: tipsGiven?.length || 0,
                    tipsReceivedCount: tipsReceived?.length || 0,
                    loadingStats: false
                });
            } catch (err) {
                console.error('Failed to load user stats:', err);
                setUserStats(prev => ({ ...prev, loadingStats: false }));
            }
        };
        
        fetchUserStats();
    }, [identity, createForumActor]);
    
    // Save Sneedex notification settings
    const saveNotificationSettings = async () => {
        if (!identity) return;
        
        setLoadingNotificationSettings(true);
        try {
            const actor = await createSneedexActor(identity);
            const result = await actor.setMyNotificationSettings({
                notify_on_bid: notifyOnBid,
                notify_on_outbid: notifyOnOutbid,
                notify_on_sale: notifyOnSale,
                notify_on_expiration: notifyOnExpiration,
                notify_on_win: notifyOnWin,
                notify_on_cancellation: notifyOnCancellation,
                notify_on_private_invite: notifyOnPrivateInvite,
            });
            
            if ('ok' in result) {
                setNotificationSettingsSaved(true);
                setTimeout(() => setNotificationSettingsSaved(false), 3000);
            } else {
                console.error('Failed to save notification settings:', result.err);
                alert('Failed to save notification settings');
            }
        } catch (err) {
            console.error('Failed to save notification settings:', err);
            alert('Failed to save notification settings');
        } finally {
            setLoadingNotificationSettings(false);
        }
    };
    
    // Clear all IndexedDB caches
    const clearAllCaches = async () => {
        setClearingCache(true);
        try {
            const dbNames = [
                'sneed_wallet_cache',
                'sneed_logo_cache', 
                'sneed_token_cache',
                'NeuronsDB'  // Shared neurons cache from useNeuronsCache.js
            ];
            
            for (const dbName of dbNames) {
                try {
                    await new Promise((resolve, reject) => {
                        const request = indexedDB.deleteDatabase(dbName);
                        request.onsuccess = () => {
                            console.log(`[Cache] Deleted ${dbName}`);
                            resolve();
                        };
                        request.onerror = () => reject(request.error);
                        request.onblocked = () => {
                            console.warn(`[Cache] Delete blocked for ${dbName}`);
                            resolve(); // Continue anyway
                        };
                    });
                } catch (e) {
                    console.warn(`[Cache] Failed to delete ${dbName}:`, e);
                }
            }
            
            // Also clear localStorage caches
            const keysToRemove = [];
            for (let i = 0; i < localStorage.length; i++) {
                const key = localStorage.key(i);
                if (key && (
                    key.includes('wallet_cache') || 
                    key.includes('sns_cache') || 
                    key.includes('sneed_') ||
                    key.startsWith('neuronsCache_')  // Old NeuronsContext localStorage cache
                )) {
                    keysToRemove.push(key);
                }
            }
            keysToRemove.forEach(key => localStorage.removeItem(key));
            
            setCacheCleared(true);
            setTimeout(() => setCacheCleared(false), 3000);
            
            // Offer to reload the page
            if (window.confirm('Cache cleared! Reload page to start fresh?')) {
                window.location.reload();
            }
        } catch (err) {
            console.error('Failed to clear caches:', err);
            alert('Failed to clear some caches. Try refreshing the page.');
        } finally {
            setClearingCache(false);
        }
    };
    
    // Get naming context
    const { neuronNames, neuronNicknames, fetchAllNames, verifiedNames, principalNames, principalNicknames } = useNaming();
    
    // Check premium status
    const { isPremium, loading: premiumLoading } = usePremiumStatus(identity);

    // Listen for URL parameter changes and sync with global state
    useEffect(() => {
        const snsParam = searchParams.get('sns');
        if (snsParam && snsParam !== selectedSnsRoot) {
            updateSelectedSns(snsParam);
        }
    }, [searchParams, selectedSnsRoot, updateSelectedSns]);

    // Handle tab parameter to switch to settings tab
    useEffect(() => {
        const tabParam = searchParams.get('tab');
        if (tabParam === 'settings') {
            setActiveTab('settings');
            setCanisterManagerSettingsExpanded(true);
        }
    }, [searchParams]);

    // Add validation function
    const validateNameInput = (input) => {
        if (input.length > 32) {
            return "Name must not exceed 32 characters";
        }
        
        const validPattern = /^[a-zA-Z0-9\s\-_.']*$/;
        if (!validPattern.test(input)) {
            return "Only alphanumeric characters, spaces, hyphens, underscores, dots, and apostrophes are allowed";
        }
        
        return "";
    };

    // Helper to check if a neuron is empty (0 stake and 0 maturity)
    const isNeuronEmpty = (neuron) => {
        const stake = BigInt(neuron.cached_neuron_stake_e8s || 0);
        const maturity = BigInt(neuron.maturity_e8s_equivalent || 0);
        return stake === 0n && maturity === 0n;
    };

    // Save hideEmptyNeurons preference to localStorage
    useEffect(() => {
        try {
            localStorage.setItem('hideEmptyNeurons_Me', JSON.stringify(hideEmptyNeurons));
        } catch (error) {
            console.warn('Could not save hideEmptyNeurons preference:', error);
        }
    }, [hideEmptyNeurons]);

    const selectedSnsInfo = React.useMemo(() => {
        try {
            return selectedSnsRoot ? getSnsById(selectedSnsRoot) : null;
        } catch (e) {
            return null;
        }
    }, [selectedSnsRoot]);

    const [selectedSnsLogo, setSelectedSnsLogo] = useState('');

    useEffect(() => {
        const loadLogo = async () => {
            try {
                const governanceId = selectedSnsInfo?.canisters?.governance;
                if (!governanceId) {
                    setSelectedSnsLogo('');
                    return;
                }

                const host = process.env.DFX_NETWORK === 'ic' || process.env.DFX_NETWORK === 'staging'
                    ? 'https://ic0.app'
                    : 'http://localhost:4943';

                const agent = new HttpAgent({
                    host,
                    ...(identity && { identity })
                });

                if (process.env.DFX_NETWORK !== 'ic') {
                    await agent.fetchRootKey().catch(() => {});
                }

                const logo = await fetchSnsLogo(governanceId, agent);
                setSelectedSnsLogo(logo || '');
            } catch (e) {
                setSelectedSnsLogo('');
            }
        };

        loadLogo();
    }, [selectedSnsInfo?.canisters?.governance, identity]);

    // Group neurons by owner
    // If user has MANAGE_PRINCIPALS permission on a neuron, it's considered "owned" by the user
    const groupedNeurons = React.useMemo(() => {
        const groups = new Map();
        const userPrincipal = identity?.getPrincipal().toString();
        const MANAGE_PRINCIPALS = 2; // Permission type for managing principals

        const neuronsByOwner = new Map();
        neurons.forEach(neuron => {
            // Check if user has MANAGE_PRINCIPALS permission on this neuron
            const userHasManagePermissions = neuron.permissions?.some(p => {
                const permPrincipal = safePrincipalString(p.principal);
                if (!permPrincipal || permPrincipal !== userPrincipal) return false;
                // Safe array check for cached data
                const permTypes = safePermissionType(p);
                return permTypes.includes(MANAGE_PRINCIPALS);
            });

            let effectiveOwner;
            if (userHasManagePermissions) {
                // If user has manage permissions, consider them the owner
                effectiveOwner = userPrincipal;
            } else {
                // Otherwise, use the first owner from getOwnerPrincipals
                const ownerPrincipals = getOwnerPrincipals(neuron);
                effectiveOwner = ownerPrincipals.length > 0 ? ownerPrincipals[0] : null;
            }

            if (effectiveOwner) {
                if (!neuronsByOwner.has(effectiveOwner)) {
                    neuronsByOwner.set(effectiveOwner, []);
                }
                neuronsByOwner.get(effectiveOwner).push(neuron);
            }
        });

        neuronsByOwner.forEach((ownerNeurons, owner) => {
            const hasAccess = ownerNeurons.some(neuron => 
                neuron.permissions.some(p => safePrincipalString(p.principal) === userPrincipal)
            );

            if (hasAccess) {
                const filteredNeurons = hideEmptyNeurons 
                    ? ownerNeurons.filter(n => !isNeuronEmpty(n))
                    : ownerNeurons;
                
                const totalStake = filteredNeurons.reduce(
                    (sum, n) => sum + BigInt(n.cached_neuron_stake_e8s || 0), 
                    BigInt(0)
                );

                groups.set(owner, {
                    isMy: owner === userPrincipal,
                    ownerPrincipal: owner,
                    neurons: filteredNeurons,
                    totalStake
                });
            }
        });

        return groups;
    }, [neurons, identity, hideEmptyNeurons]);

    // Fetch SNS data on component mount
    useEffect(() => {
        const fetchSnsData = async () => {
            try {
                const data = await fetchAndCacheSnsData();
                setSnsList(data);
            } catch (err) {
                console.error('Error fetching SNS data:', err);
                setError('Failed to load SNS data');
            } finally {
                setLoadingSnses(false);
            }
        };
        fetchSnsData();
    }, [identity]);

    // Fetch neurons when selected SNS changes - uses global cache
    useEffect(() => {
        const fetchNeurons = async () => {
            if (!identity || !selectedSnsRoot) return;
            
            setLoading(true);
            setError(null);
            try {
                const selectedSns = getSnsById(selectedSnsRoot);
                if (!selectedSns) {
                    throw new Error('Selected SNS not found');
                }
                
                // Use global cache from WalletContext if available
                let neuronsList;
                if (getNeuronsForGovernance) {
                    neuronsList = await getNeuronsForGovernance(selectedSns.canisters.governance);
                } else {
                    // Fallback to direct fetch
                    neuronsList = await fetchUserNeuronsForSns(identity, selectedSns.canisters.governance);
                }
                setNeurons(neuronsList);

                const icrc1Actor = createIcrc1Actor(selectedSns.canisters.ledger, {
                    agentOptions: { identity }
                });
                const metadata = await icrc1Actor.icrc1_metadata();
                const symbolEntry = metadata.find(entry => entry[0] === 'icrc1:symbol');
                if (symbolEntry && symbolEntry[1]) {
                    setTokenSymbol(symbolEntry[1].Text);
                }
            } catch (err) {
                console.error('Error fetching neurons:', err);
                setError('Failed to load neurons');
            } finally {
                setLoading(false);
            }
        };
        fetchNeurons();
    }, [identity, selectedSnsRoot, getNeuronsForGovernance]);

    useEffect(() => {
        if (identity) {
            const fetchPrincipalName = async () => {
                try {
                    const response = await getPrincipalName(identity, identity.getPrincipal());
                    if (response) {
                        setPrincipalNameState(response[0]);
                        setIsVerified(response[1]);
                    }
                } catch (error) {
                    console.error('Error fetching principal name:', error);
                }
            };
            fetchPrincipalName();
        }
    }, [identity]);

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
                const displayInfo = getPrincipalDisplayInfoFromContext(principal, principalNames, principalNicknames);
                displayInfoMap.set(principal.toString(), displayInfo);
            });

            setPrincipalDisplayInfo(displayInfoMap);
        };

        fetchPrincipalInfo();
    }, [neurons, principalNames, principalNicknames]);

    // Fetch nervous system parameters for voting power calculation
    useEffect(() => {
        const fetchNervousSystemParameters = async () => {
            if (!selectedSnsRoot || !identity) return;
            
            try {
                const selectedSns = getSnsById(selectedSnsRoot);
                if (!selectedSns) return;

                const snsGovActor = createSnsGovernanceActor(selectedSns.canisters.governance, {
                    agentOptions: { identity }
                });
                
                const params = await snsGovActor.get_nervous_system_parameters(null);
                setNervousSystemParameters(params);
            } catch (error) {
                console.error('Error fetching nervous system parameters:', error);
            }
        };

        fetchNervousSystemParameters();
    }, [selectedSnsRoot, identity]);

    const handleSnsChange = (newSnsRoot) => {
        // The global context and URL sync is handled by SnsDropdown component
    };

    const toggleGroup = (groupId) => {
        setExpandedGroups(prev => {
            const newSet = new Set(prev);
            if (newSet.has(groupId)) {
                newSet.delete(groupId);
            } else {
                newSet.add(groupId);
            }
            return newSet;
        });
    };

    const handleNameSubmit = async (neuronId, isNickname = false) => {
        const error = validateNameInput(nameInput);
        if (error) {
            setInputError(error);
            return;
        }

        if (!nameInput.trim()) return;

        if (!isNickname) {
            setConfirmAction(() => async () => {
                setIsSubmitting(true);
                try {
                    const response = await setNeuronName(identity, selectedSnsRoot, neuronId, nameInput);
                    if ('ok' in response) {
                        await fetchAllNames();
                        setInputError('');
                    } else {
                        setError(response.err);
                    }
                } catch (err) {
                    console.error('Error setting neuron name:', err);
                    setError('Failed to set neuron name');
                } finally {
                    setIsSubmitting(false);
                    setEditingName(null);
                    setNameInput('');
                }
            });
            setConfirmMessage(
                "You are about to set a public name for this neuron. Please note:\n\n" +
                "• This name will be visible to everyone\n" +
                "• Only set a name if you want to help others track your neuron\n" +
                "• Inappropriate names can result in a user ban\n\n" +
                "Are you sure you want to proceed?"
            );
            setShowConfirmModal(true);
            return;
        }

        setIsSubmitting(true);
        try {
            const response = await setNeuronNickname(identity, selectedSnsRoot, neuronId, nameInput);
            if ('ok' in response) {
                await fetchAllNames();
                setInputError('');
            } else {
                setError(response.err);
            }
        } catch (err) {
            console.error('Error setting neuron nickname:', err);
            setError('Failed to set neuron nickname');
        } finally {
            setIsSubmitting(false);
            setEditingName(null);
            setNameInput('');
        }
    };

    const getDisplayName = (neuronId) => {
        const mapKey = `${selectedSnsRoot}:${neuronId}`;
        const name = neuronNames.get(mapKey);
        const nickname = neuronNicknames.get(mapKey);
        const isVerified = verifiedNames.get(mapKey);
        return { name, nickname, isVerified };
    };

    const handlePrincipalNameSubmit = async () => {
        const error = validateNameInput(principalNameInput);
        if (error) {
            setPrincipalNameError(error);
            return;
        }

        if (!principalNameInput.trim()) return;

        setConfirmAction(() => async () => {
            setIsSubmittingPrincipalName(true);
            try {
                const response = await setPrincipalName(identity, principalNameInput);
                if ('ok' in response) {
                    const newName = await getPrincipalName(identity, identity.getPrincipal());
                    if (newName) {
                        setPrincipalNameState(newName[0]);
                        setIsVerified(newName[1]);
                    }
                    setPrincipalNameError('');
                } else {
                    setError(response.err);
                }
            } catch (err) {
                console.error('Error setting principal name:', err);
                setError('Failed to set principal name');
            } finally {
                setIsSubmittingPrincipalName(false);
                setEditingPrincipalName(false);
                setPrincipalNameInput('');
            }
        });
        setConfirmMessage(
            "You are about to set a public name for your principal. Please note:\n\n" +
            "• This name will be visible to everyone\n" +
            "• Only set a name if you want to help others identify you\n" +
            "• Inappropriate names can result in a user ban\n\n" +
            "Are you sure you want to proceed?"
        );
        setShowConfirmModal(true);
    };

    // Toggle switch component
    const ToggleSwitch = ({ checked, onChange, disabled = false }) => (
        <label style={{ position: 'relative', display: 'inline-block', width: '50px', height: '28px' }}>
            <input
                type="checkbox"
                checked={checked}
                onChange={onChange}
                disabled={disabled}
                style={{ opacity: 0, width: 0, height: 0 }}
            />
            <span style={{
                position: 'absolute',
                cursor: disabled ? 'not-allowed' : 'pointer',
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                backgroundColor: checked ? mePrimary : theme.colors.border,
                transition: '0.3s',
                borderRadius: '28px',
                opacity: disabled ? 0.5 : 1,
            }}>
                <span style={{
                    position: 'absolute',
                    content: '',
                    height: '22px',
                    width: '22px',
                    left: checked ? '25px' : '3px',
                    bottom: '3px',
                    backgroundColor: 'white',
                    transition: '0.3s',
                    borderRadius: '50%',
                }}></span>
            </span>
        </label>
    );

    if (!identity) {
        return (
            <div className='page-container'>
                <style>{customStyles}</style>
                <Header showSnsDropdown={true} onSnsChange={handleSnsChange} />
                <main style={{
                    background: theme.colors.primaryGradient,
                    minHeight: '100vh',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center'
                }}>
                    <div style={{
                        textAlign: 'center',
                        background: theme.colors.secondaryBg,
                        borderRadius: '24px',
                        padding: '3rem',
                        border: `1px solid ${theme.colors.border}`,
                        maxWidth: '500px',
                        boxShadow: '0 20px 60px rgba(0, 0, 0, 0.3)'
                    }}>
                        <div className="me-pulse" style={{
                            width: '80px',
                            height: '80px',
                            borderRadius: '50%',
                            background: `linear-gradient(135deg, ${mePrimary}, ${meSecondary})`,
                            margin: '0 auto 1.5rem',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center'
                        }}>
                            <FaUser size={32} color="white" />
                        </div>
                        <h1 style={{
                            color: theme.colors.primaryText,
                            fontSize: '2rem',
                            fontWeight: '700',
                            marginBottom: '1rem'
                        }}>
                            Connect Your Wallet
                        </h1>
                        <p style={{
                            color: theme.colors.secondaryText,
                            fontSize: '1.1rem',
                            lineHeight: '1.6'
                        }}>
                            Connect your wallet to view your profile, manage neurons, and access settings.
                        </p>
                    </div>
                </main>
            </div>
        );
    }

    // Quick navigation items
    const quickNavItems = [
        { icon: <FaShareAlt size={20} />, label: 'My Public Page', to: `/principal?id=${identity?.getPrincipal().toString()}`, color: '#3b82f6' },
        { icon: <FaWallet size={20} />, label: 'My Wallet', to: '/wallet', color: mePrimary },
        { icon: <FaGavel size={20} />, label: 'My Trades', to: '/sneedex_my', color: '#6366f1' },
        { icon: <FaComments size={20} />, label: 'My Posts', to: '/posts', color: '#10b981' },
        { icon: <FaCoins size={20} />, label: 'My Tips', to: '/tips', color: '#f59e0b' },
        { icon: <FaEnvelope size={20} />, label: 'My Messages', to: '/sms', color: '#ec4899' },
        { icon: <FaGift size={20} />, label: 'My Rewards', to: '/rewards', color: '#8b5cf6' },
        { icon: <FaLock size={20} />, label: 'My Locks', to: `/sneedlock_info?owner=${identity?.getPrincipal().toString()}`, color: '#06b6d4' },
        { icon: <FaServer size={20} />, label: 'My Canisters', to: '/canisters', color: '#14b8a6' },
        { icon: <FaAddressBook size={20} />, label: 'My Contacts', to: '/names', color: '#f97316' },
    ];

    return (
        <div className='page-container'>
            <style>{customStyles}</style>
            <Header showSnsDropdown={true} onSnsChange={handleSnsChange} />
            
            <main style={{
                background: theme.colors.primaryGradient,
                minHeight: '100vh'
            }}>
                {/* Hero Section */}
                <div style={{
                    background: `linear-gradient(135deg, ${theme.colors.primaryBg} 0%, ${mePrimary}15 50%, ${meSecondary}10 100%)`,
                    borderBottom: `1px solid ${theme.colors.border}`,
                    padding: '2.5rem 1.5rem',
                    position: 'relative',
                    overflow: 'hidden'
                }}>
                    {/* Background decoration */}
                    <div style={{
                        position: 'absolute',
                        top: '-50%',
                        right: '-10%',
                        width: '400px',
                        height: '400px',
                        background: `radial-gradient(circle, ${mePrimary}20 0%, transparent 70%)`,
                        borderRadius: '50%',
                        pointerEvents: 'none'
                    }} />
                    <div style={{
                        position: 'absolute',
                        bottom: '-30%',
                        left: '-5%',
                        width: '300px',
                        height: '300px',
                        background: `radial-gradient(circle, ${meSecondary}15 0%, transparent 70%)`,
                        borderRadius: '50%',
                        pointerEvents: 'none'
                    }} />
                    
                    <div style={{
                        maxWidth: '1000px',
                        margin: '0 auto',
                        position: 'relative',
                        zIndex: 1
                    }}>
                        {/* Profile Card - Modern Design */}
                        <div className="me-card-animate" style={{
                            background: `linear-gradient(135deg, ${theme.colors.secondaryBg} 0%, ${theme.colors.primaryBg} 100%)`,
                            borderRadius: '24px',
                            padding: '0',
                            border: `1px solid ${theme.colors.border}`,
                            boxShadow: '0 20px 60px rgba(0, 0, 0, 0.3)',
                            overflow: 'hidden'
                        }}>
                            {/* Top Banner */}
                            <div style={{
                                height: '80px',
                                background: isPremium && !premiumLoading 
                                    ? `linear-gradient(135deg, #f59e0b 0%, #eab308 50%, #f59e0b 100%)`
                                    : `linear-gradient(135deg, ${mePrimary} 0%, ${meSecondary} 50%, ${meAccent} 100%)`,
                                position: 'relative'
                            }}>
                                {/* Decorative pattern */}
                                <div style={{
                                    position: 'absolute',
                                    inset: 0,
                                    opacity: 0.1,
                                    backgroundImage: 'radial-gradient(circle at 20% 50%, white 1px, transparent 1px), radial-gradient(circle at 80% 50%, white 1px, transparent 1px)',
                                    backgroundSize: '40px 40px'
                                }} />
                                
                                {/* Premium Badge - top right corner */}
                                {isPremium && !premiumLoading && (
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
                            </div>
                            
                            {/* Profile Content */}
                            <div style={{ padding: '0 2rem 1.5rem', marginTop: '-40px', position: 'relative' }}>
                                <div style={{
                                    display: 'flex',
                                    alignItems: 'flex-end',
                                    gap: '1.25rem',
                                    marginBottom: '1rem',
                                    flexWrap: 'wrap'
                                }}>
                                    {/* Avatar */}
                                    <div style={{
                                        width: '88px',
                                        height: '88px',
                                        borderRadius: '20px',
                                        background: isPremium && !premiumLoading 
                                            ? `linear-gradient(135deg, #f59e0b, #eab308)` 
                                            : `linear-gradient(135deg, ${mePrimary}, ${meSecondary})`,
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                        flexShrink: 0,
                                        boxShadow: isPremium && !premiumLoading 
                                            ? `0 8px 32px #f59e0b50` 
                                            : `0 8px 32px ${mePrimary}50`,
                                        border: `4px solid ${theme.colors.secondaryBg}`
                                    }}>
                                        {isPremium && !premiumLoading ? (
                                            <FaCrown size={36} color="white" />
                                        ) : (
                                            <FaUser size={36} color="white" />
                                        )}
                                    </div>
                                    
                                    {/* Name & Badge Row */}
                                    <div style={{ flex: 1, minWidth: '200px', paddingBottom: '4px' }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
                                            {principalName && !editingPrincipalName ? (
                                                <h1 style={{
                                                    color: theme.colors.primaryText,
                                                    fontSize: '1.5rem',
                                                    fontWeight: '700',
                                                    margin: 0,
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    gap: '0.5rem'
                                                }}>
                                                    {principalName}
                                                    {isVerified && (
                                                        <FaCheckCircle size={16} color={mePrimary} title="Verified name" />
                                                    )}
                                                </h1>
                                            ) : (
                                                <h1 style={{
                                                    color: theme.colors.primaryText,
                                                    fontSize: '1.5rem',
                                                    fontWeight: '700',
                                                    margin: 0
                                                }}>
                                                    My Profile
                                                </h1>
                                            )}
                                        </div>
                                    </div>
                                </div>

                                {/* Activity Stats */}
                                <div style={{
                                    display: 'grid',
                                    gridTemplateColumns: 'repeat(4, 1fr)',
                                    gap: '0.75rem',
                                    marginBottom: '1rem'
                                }}>
                                    <Link to="/posts" style={{
                                        background: theme.colors.tertiaryBg,
                                        borderRadius: '12px',
                                        padding: '0.75rem',
                                        textAlign: 'center',
                                        textDecoration: 'none',
                                        transition: 'all 0.2s ease',
                                        border: `1px solid transparent`
                                    }}
                                    onMouseEnter={(e) => e.currentTarget.style.borderColor = mePrimary}
                                    onMouseLeave={(e) => e.currentTarget.style.borderColor = 'transparent'}
                                    >
                                        <div style={{ 
                                            color: mePrimary, 
                                            fontSize: '1.25rem', 
                                            fontWeight: '700',
                                            marginBottom: '0.25rem'
                                        }}>
                                            {userStats.loadingStats ? '...' : userStats.postsCount}
                                        </div>
                                        <div style={{ 
                                            color: theme.colors.mutedText, 
                                            fontSize: '0.7rem', 
                                            textTransform: 'uppercase',
                                            letterSpacing: '0.5px'
                                        }}>
                                            Posts
                                        </div>
                                    </Link>
                                    <Link to="/posts?tab=my-threads" style={{
                                        background: theme.colors.tertiaryBg,
                                        borderRadius: '12px',
                                        padding: '0.75rem',
                                        textAlign: 'center',
                                        textDecoration: 'none',
                                        transition: 'all 0.2s ease',
                                        border: `1px solid transparent`
                                    }}
                                    onMouseEnter={(e) => e.currentTarget.style.borderColor = meSecondary}
                                    onMouseLeave={(e) => e.currentTarget.style.borderColor = 'transparent'}
                                    >
                                        <div style={{ 
                                            color: meSecondary, 
                                            fontSize: '1.25rem', 
                                            fontWeight: '700',
                                            marginBottom: '0.25rem'
                                        }}>
                                            {userStats.loadingStats ? '...' : userStats.threadsCount}
                                        </div>
                                        <div style={{ 
                                            color: theme.colors.mutedText, 
                                            fontSize: '0.7rem', 
                                            textTransform: 'uppercase',
                                            letterSpacing: '0.5px'
                                        }}>
                                            Threads
                                        </div>
                                    </Link>
                                    <Link to="/tips?tab=received" style={{
                                        background: theme.colors.tertiaryBg,
                                        borderRadius: '12px',
                                        padding: '0.75rem',
                                        textAlign: 'center',
                                        textDecoration: 'none',
                                        transition: 'all 0.2s ease',
                                        border: `1px solid transparent`
                                    }}
                                    onMouseEnter={(e) => e.currentTarget.style.borderColor = theme.colors.success}
                                    onMouseLeave={(e) => e.currentTarget.style.borderColor = 'transparent'}
                                    >
                                        <div style={{ 
                                            color: theme.colors.success, 
                                            fontSize: '1.25rem', 
                                            fontWeight: '700',
                                            marginBottom: '0.25rem'
                                        }}>
                                            {userStats.loadingStats ? '...' : userStats.tipsReceivedCount}
                                        </div>
                                        <div style={{ 
                                            color: theme.colors.mutedText, 
                                            fontSize: '0.7rem', 
                                            textTransform: 'uppercase',
                                            letterSpacing: '0.5px'
                                        }}>
                                            Tips ↓
                                        </div>
                                    </Link>
                                    <Link to="/tips?tab=given" style={{
                                        background: theme.colors.tertiaryBg,
                                        borderRadius: '12px',
                                        padding: '0.75rem',
                                        textAlign: 'center',
                                        textDecoration: 'none',
                                        transition: 'all 0.2s ease',
                                        border: `1px solid transparent`
                                    }}
                                    onMouseEnter={(e) => e.currentTarget.style.borderColor = meAccent}
                                    onMouseLeave={(e) => e.currentTarget.style.borderColor = 'transparent'}
                                    >
                                        <div style={{ 
                                            color: meAccent, 
                                            fontSize: '1.25rem', 
                                            fontWeight: '700',
                                            marginBottom: '0.25rem'
                                        }}>
                                            {userStats.loadingStats ? '...' : userStats.tipsGivenCount}
                                        </div>
                                        <div style={{ 
                                            color: theme.colors.mutedText, 
                                            fontSize: '0.7rem', 
                                            textTransform: 'uppercase',
                                            letterSpacing: '0.5px'
                                        }}>
                                            Tips ↑
                                        </div>
                                    </Link>
                                </div>

                                {/* Name Edit Section */}
                                {!editingPrincipalName ? (
                                    <button
                                        onClick={() => setEditingPrincipalName(true)}
                                        style={{
                                            background: `linear-gradient(135deg, ${mePrimary}, ${meSecondary})`,
                                            color: 'white',
                                            border: 'none',
                                            borderRadius: '12px',
                                            padding: '0.75rem 1.5rem',
                                            cursor: 'pointer',
                                            fontWeight: '600',
                                            fontSize: '0.9rem',
                                            transition: 'all 0.3s ease',
                                            boxShadow: `0 4px 20px ${mePrimary}40`,
                                            display: 'flex',
                                            alignItems: 'center',
                                            gap: '0.5rem'
                                        }}
                                    >
                                        <FaUser size={14} />
                                        {principalName ? 'Change Display Name' : 'Set Display Name'}
                                    </button>
                                ) : (
                                    <div style={{
                                        background: theme.colors.tertiaryBg,
                                        borderRadius: '12px',
                                        padding: '1rem',
                                        display: 'flex',
                                        flexDirection: 'column',
                                        gap: '0.75rem'
                                    }}>
                                        <label style={{
                                            fontSize: '0.8rem',
                                            fontWeight: '600',
                                            color: theme.colors.secondaryText
                                        }}>
                                            Display Name
                                        </label>
                                        <input
                                            type="text"
                                            value={principalNameInput}
                                            onChange={(e) => {
                                                const newValue = e.target.value;
                                                setPrincipalNameInput(newValue);
                                                setPrincipalNameError(validateNameInput(newValue));
                                            }}
                                            maxLength={32}
                                            placeholder="Enter your name (max 32 chars)"
                                            style={{
                                                backgroundColor: theme.colors.secondaryBg,
                                                border: `1px solid ${principalNameError ? theme.colors.error : theme.colors.border}`,
                                                borderRadius: '10px',
                                                color: theme.colors.primaryText,
                                                padding: '0.75rem 1rem',
                                                width: '100%',
                                                maxWidth: '300px',
                                                fontSize: '0.95rem',
                                                boxSizing: 'border-box'
                                            }}
                                        />
                                        {principalNameError && (
                                            <div style={{
                                                color: theme.colors.error,
                                                fontSize: '0.8rem'
                                            }}>
                                                {principalNameError}
                                            </div>
                                        )}
                                        <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.25rem' }}>
                                            <button
                                                onClick={handlePrincipalNameSubmit}
                                                disabled={isSubmittingPrincipalName}
                                                style={{
                                                    background: `linear-gradient(135deg, ${mePrimary}, ${meSecondary})`,
                                                    color: 'white',
                                                    border: 'none',
                                                    borderRadius: '8px',
                                                    padding: '0.6rem 1.25rem',
                                                    cursor: isSubmittingPrincipalName ? 'not-allowed' : 'pointer',
                                                    fontWeight: '600',
                                                    fontSize: '0.85rem',
                                                    opacity: isSubmittingPrincipalName ? 0.7 : 1
                                                }}
                                            >
                                                {isSubmittingPrincipalName ? 'Saving...' : 'Save'}
                                            </button>
                                            <button
                                                onClick={() => {
                                                    setEditingPrincipalName(false);
                                                    setPrincipalNameInput('');
                                                }}
                                                disabled={isSubmittingPrincipalName}
                                                style={{
                                                    background: 'transparent',
                                                    color: theme.colors.mutedText,
                                                    border: `1px solid ${theme.colors.border}`,
                                                    borderRadius: '8px',
                                                    padding: '0.6rem 1.25rem',
                                                    cursor: isSubmittingPrincipalName ? 'not-allowed' : 'pointer',
                                                    fontWeight: '500',
                                                    fontSize: '0.85rem'
                                                }}
                                            >
                                                Cancel
                                            </button>
                                        </div>
                                    </div>
                                )}

                                {/* Public Page Link */}
                                <Link
                                    to={`/principal?id=${identity?.getPrincipal().toString()}`}
                                    style={{
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: '1rem',
                                        background: theme.colors.tertiaryBg,
                                        borderRadius: '12px',
                                        padding: '1rem 1.25rem',
                                        marginTop: '1rem',
                                        textDecoration: 'none',
                                        border: `1px solid ${theme.colors.border}`,
                                        transition: 'all 0.2s ease'
                                    }}
                                    onMouseEnter={(e) => {
                                        e.currentTarget.style.borderColor = '#3b82f6';
                                        e.currentTarget.style.background = `${theme.colors.tertiaryBg}`;
                                    }}
                                    onMouseLeave={(e) => {
                                        e.currentTarget.style.borderColor = theme.colors.border;
                                        e.currentTarget.style.background = theme.colors.tertiaryBg;
                                    }}
                                >
                                    <div style={{
                                        width: '40px',
                                        height: '40px',
                                        borderRadius: '10px',
                                        background: 'linear-gradient(135deg, #3b82f6, #2563eb)',
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                        flexShrink: 0
                                    }}>
                                        <FaShareAlt size={18} color="white" />
                                    </div>
                                    <div style={{ flex: 1 }}>
                                        <div style={{
                                            color: theme.colors.primaryText,
                                            fontWeight: '600',
                                            fontSize: '0.95rem',
                                            marginBottom: '0.25rem',
                                            display: 'flex',
                                            alignItems: 'center',
                                            gap: '0.5rem'
                                        }}>
                                            View My Public Page
                                            <FaExternalLinkAlt size={12} color={theme.colors.mutedText} />
                                        </div>
                                        <div style={{
                                            color: theme.colors.mutedText,
                                            fontSize: '0.8rem',
                                            lineHeight: '1.4'
                                        }}>
                                            Your shareable profile page that others can view — share the URL with friends!
                                        </div>
                                    </div>
                                </Link>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Main Content */}
                <div style={{
                    maxWidth: '1000px',
                    margin: '0 auto',
                    padding: '1.5rem 1rem'
                }}>
                    {/* Quick Navigation Grid */}
                    <div style={{ marginBottom: '2rem' }}>
                        <h2 
                            onClick={() => {
                                const newValue = !quickAccessExpanded;
                                setQuickAccessExpanded(newValue);
                                localStorage.setItem('quickAccessExpanded', JSON.stringify(newValue));
                            }}
                            style={{
                                color: theme.colors.primaryText,
                                fontSize: '1.25rem',
                                fontWeight: '600',
                                marginBottom: quickAccessExpanded ? '1rem' : '0',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '0.75rem',
                                cursor: 'pointer',
                                userSelect: 'none',
                                transition: 'margin-bottom 0.3s ease'
                            }}
                        >
                            <span style={{
                                width: '32px',
                                height: '32px',
                                borderRadius: '8px',
                                background: `linear-gradient(135deg, ${mePrimary}, ${meSecondary})`,
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                transition: 'transform 0.3s ease'
                            }}>
                                <FaChevronRight 
                                    size={14} 
                                    color="white" 
                                    style={{
                                        transition: 'transform 0.3s ease',
                                        transform: quickAccessExpanded ? 'rotate(90deg)' : 'rotate(0deg)'
                                    }}
                                />
                            </span>
                            Quick Access
                        </h2>
                        
                        <div style={{
                            display: 'grid',
                            gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))',
                            gap: '0.75rem',
                            maxHeight: quickAccessExpanded ? '600px' : '0',
                            overflow: 'hidden',
                            opacity: quickAccessExpanded ? 1 : 0,
                            transition: 'max-height 0.3s ease, opacity 0.3s ease',
                            paddingBottom: quickAccessExpanded ? '0.25rem' : '0'
                        }}>
                            {quickNavItems.map((item, idx) => (
                                <Link
                                    key={idx}
                                    to={item.to}
                                    className="quick-nav-item"
                                    style={{
                                        background: theme.colors.secondaryBg,
                                        borderRadius: '12px',
                                        padding: '0.75rem',
                                        border: `1px solid ${theme.colors.border}`,
                                        textDecoration: 'none',
                                        display: 'flex',
                                        flexDirection: 'column',
                                        alignItems: 'center',
                                        gap: '0.4rem',
                                        textAlign: 'center'
                                    }}
                                >
                                    <div style={{
                                        width: '36px',
                                        height: '36px',
                                        borderRadius: '10px',
                                        background: `${item.color}15`,
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                        color: item.color
                                    }}>
                                        {item.icon}
                                    </div>
                                    <span style={{
                                        color: theme.colors.primaryText,
                                        fontSize: '0.8rem',
                                        fontWeight: '500'
                                    }}>
                                        {item.label}
                                    </span>
                                </Link>
                            ))}
                        </div>
                    </div>

                    {/* Error Display */}
                    {error && (
                        <div style={{
                            background: `linear-gradient(135deg, ${theme.colors.error}15, ${theme.colors.error}08)`,
                            border: `1px solid ${theme.colors.error}30`,
                            borderRadius: '12px',
                            padding: '1rem 1.25rem',
                            marginBottom: '1.5rem',
                            color: theme.colors.error,
                            display: 'flex',
                            alignItems: 'center',
                            gap: '0.75rem'
                        }}>
                            ⚠️ {error}
                        </div>
                    )}

                    {/* Tab Navigation */}
                    <div 
                        className="me-card-animate"
                        style={{
                            display: 'flex',
                            flexWrap: 'wrap',
                            gap: '0.5rem',
                            marginBottom: '1.5rem',
                            background: theme.colors.secondaryBg,
                            borderRadius: '16px',
                            padding: '0.5rem',
                            border: `1px solid ${theme.colors.border}`,
                        }}
                    >
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
                                    ? `linear-gradient(135deg, ${mePrimary}, ${meSecondary})`
                                    : 'transparent',
                                color: activeTab === 'neurons' 
                                    ? 'white' 
                                    : theme.colors.secondaryText,
                            }}
                        >
                            <TokenIcon 
                                logo={selectedSnsLogo} 
                                size={18} 
                                fallbackIcon={<FaBrain size={14} />}
                                fallbackColor={activeTab === 'neurons' ? 'white' : theme.colors.secondaryText}
                                rounded={false}
                            />
                            <span>Neurons</span>
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
                                    ? `linear-gradient(135deg, ${meAccent}, ${mePrimary})`
                                    : 'transparent',
                                color: activeTab === 'transactions' 
                                    ? 'white' 
                                    : theme.colors.secondaryText,
                            }}
                        >
                            <TokenIcon 
                                logo={selectedSnsLogo} 
                                size={18} 
                                fallbackIcon={<FaExchangeAlt size={14} />}
                                fallbackColor={activeTab === 'transactions' ? 'white' : theme.colors.secondaryText}
                                rounded={false}
                            />
                            <span>Transactions</span>
                        </button>
                        <button
                            onClick={() => setActiveTab('settings')}
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
                                background: activeTab === 'settings' 
                                    ? `linear-gradient(135deg, ${mePrimary}, ${meSecondary})`
                                    : 'transparent',
                                color: activeTab === 'settings' 
                                    ? 'white' 
                                    : theme.colors.secondaryText,
                            }}
                        >
                            <FaCog size={14} />
                            <span>Settings</span>
                        </button>
                    </div>

                    {/* Tab Content */}
                    <div 
                        className="me-card-animate settings-card"
                        style={{
                            background: theme.colors.secondaryBg,
                            borderRadius: '16px',
                            border: `1px solid ${theme.colors.border}`,
                            overflow: 'hidden',
                            transition: 'all 0.3s ease'
                        }}
                    >
                        {/* Settings Tab */}
                        {activeTab === 'settings' && (
                            <div id="settings-section" style={{ padding: '1rem' }}>
                                {/* General Settings */}
                                <SettingsSection
                                    title="General Settings"
                                    icon={<FaPalette size={16} />}
                                    expanded={generalSettingsExpanded}
                                    onToggle={() => setGeneralSettingsExpanded(!generalSettingsExpanded)}
                                    theme={theme}
                                >
                                    <SettingItem
                                        title="Theme"
                                        description="Switch between dark and light mode"
                                        theme={theme}
                                    >
                                        <ThemeToggle size="medium" showLabel={true} />
                                    </SettingItem>
                                    
                                    <SettingItem
                                        title="Principal Color Coding"
                                        description="Display principals with unique colors based on their ID"
                                        theme={theme}
                                    >
                                        <ToggleSwitch
                                            checked={principalColorCoding}
                                            onChange={(e) => {
                                                const newValue = e.target.checked;
                                                setPrincipalColorCoding(newValue);
                                                localStorage.setItem('principalColorCoding', JSON.stringify(newValue));
                                            }}
                                        />
                                    </SettingItem>
                                    
                                    <SettingItem
                                        title="Neuron Color Coding"
                                        description="Display neurons with unique colors based on their ID"
                                        theme={theme}
                                    >
                                        <ToggleSwitch
                                            checked={neuronColorCoding}
                                            onChange={(e) => {
                                                const newValue = e.target.checked;
                                                setNeuronColorCoding(newValue);
                                                localStorage.setItem('neuronColorCoding', JSON.stringify(newValue));
                                            }}
                                        />
                                    </SettingItem>
                                    
                                    <SettingItem
                                        title="Show Voting Power Bar"
                                        description="Display the voting power bar in the header"
                                        theme={theme}
                                    >
                                        <ToggleSwitch
                                            checked={showVpBar}
                                            onChange={(e) => {
                                                const newValue = e.target.checked;
                                                setShowVpBar(newValue);
                                                localStorage.setItem('showVpBar', JSON.stringify(newValue));
                                                window.dispatchEvent(new CustomEvent('showVpBarChanged', { detail: newValue }));
                                            }}
                                        />
                                    </SettingItem>

                                    <SettingItem
                                        title="Show Header Notifications"
                                        description="Display the notification bar in the header"
                                        theme={theme}
                                    >
                                        <ToggleSwitch
                                            checked={showHeaderNotifications}
                                            onChange={(e) => {
                                                const newValue = e.target.checked;
                                                setShowHeaderNotifications(newValue);
                                                localStorage.setItem('showHeaderNotifications', JSON.stringify(newValue));
                                                window.dispatchEvent(new CustomEvent('showHeaderNotificationsChanged', { detail: newValue }));
                                            }}
                                        />
                                    </SettingItem>
                                    
                                    <SettingItem
                                        title="Collectibles Threshold"
                                        description="Minimum USD value to show collectibles notifications (fees, rewards, maturity) in the header and wallet"
                                        theme={theme}
                                    >
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                            <span style={{ color: theme.colors.secondaryText }}>$</span>
                                            <input
                                                type="number"
                                                min="0"
                                                step="0.01"
                                                value={collectiblesThreshold}
                                                onChange={(e) => {
                                                    const newValue = Math.max(0, parseFloat(e.target.value) || 0);
                                                    setCollectiblesThreshold(newValue);
                                                    localStorage.setItem('collectiblesThreshold', newValue.toString());
                                                    window.dispatchEvent(new CustomEvent('collectiblesThresholdChanged', { detail: newValue }));
                                                }}
                                                style={{
                                                    width: '80px',
                                                    padding: '6px 10px',
                                                    borderRadius: '8px',
                                                    border: `1px solid ${theme.colors.border}`,
                                                    backgroundColor: theme.colors.tertiaryBg,
                                                    color: theme.colors.primaryText,
                                                    fontSize: '14px',
                                                    textAlign: 'right'
                                                }}
                                            />
                                            <span style={{ color: theme.colors.mutedText, fontSize: '12px' }}>USD</span>
                                        </div>
                                    </SettingItem>
                                    
                                    <SettingItem
                                        title="Expand Quick Links on Desktop"
                                        description="Show individual quick link buttons on desktop instead of hamburger menu"
                                        theme={theme}
                                    >
                                        <ToggleSwitch
                                            checked={expandQuickLinksOnDesktop}
                                            onChange={(e) => {
                                                const newValue = e.target.checked;
                                                setExpandQuickLinksOnDesktop(newValue);
                                                localStorage.setItem('expandQuickLinksOnDesktop', JSON.stringify(newValue));
                                                window.dispatchEvent(new CustomEvent('expandQuickLinksOnDesktopChanged', { detail: newValue }));
                                            }}
                                        />
                                    </SettingItem>
                                    
                                    <SettingItem
                                        title="Particle Effects"
                                        description="Show sparkle trails when tipping and fireworks on the Tips page for new tips"
                                        theme={theme}
                                        isLast={true}
                                    >
                                        <ToggleSwitch
                                            checked={particleEffectsEnabled}
                                            onChange={(e) => {
                                                const newValue = e.target.checked;
                                                setParticleEffectsEnabled(newValue);
                                                localStorage.setItem('particleEffectsEnabled', JSON.stringify(newValue));
                                            }}
                                        />
                                    </SettingItem>
                                </SettingsSection>

                                {/* ICP Neuron Manager Settings */}
                                <SettingsSection
                                    title="ICP Neuron Manager Settings"
                                    icon={<FaBrain size={16} />}
                                    expanded={neuronManagerSettingsExpanded}
                                    onToggle={() => setNeuronManagerSettingsExpanded(!neuronManagerSettingsExpanded)}
                                    theme={theme}
                                >
                                    <CycleThresholdSettings
                                        theme={theme}
                                        title="ICP Neuron Manager Cycle Thresholds"
                                        description="Configure cycle warning thresholds for your ICP Neuron Manager canisters."
                                        redValue={cycleThresholdRed}
                                        orangeValue={cycleThresholdOrange}
                                        onRedChange={(v) => { setCycleThresholdRed(v); setSettingsSaved(false); }}
                                        onOrangeChange={(v) => { setCycleThresholdOrange(v); setSettingsSaved(false); }}
                                        onSave={() => {
                                            const redValue = parseCyclesInput(cycleThresholdRed);
                                            const orangeValue = parseCyclesInput(cycleThresholdOrange);
                                            
                                            if (redValue === null || orangeValue === null) {
                                                alert('Invalid input. Please use format like "1T", "500B", or "1000000000000"');
                                                return;
                                            }
                                            
                                            if (redValue >= orangeValue) {
                                                alert('Critical threshold must be lower than warning threshold');
                                                return;
                                            }
                                            
                                            saveNeuronManagerSettings({
                                                cycleThresholdRed: redValue,
                                                cycleThresholdOrange: orangeValue,
                                            });
                                            
                                            setCycleThresholdRed(formatCyclesCompact(redValue));
                                            setCycleThresholdOrange(formatCyclesCompact(orangeValue));
                                            setSettingsSaved(true);
                                            setTimeout(() => setSettingsSaved(false), 3000);
                                        }}
                                        onReset={() => {
                                            setCycleThresholdRed('1.0T');
                                            setCycleThresholdOrange('5.0T');
                                            saveNeuronManagerSettings({
                                                cycleThresholdRed: 1_000_000_000_000,
                                                cycleThresholdOrange: 5_000_000_000_000,
                                            });
                                            setSettingsSaved(true);
                                            setTimeout(() => setSettingsSaved(false), 3000);
                                        }}
                                        saved={settingsSaved}
                                    />
                                </SettingsSection>

                                {/* Dapp Manager Settings */}
                                <SettingsSection
                                    title="Dapp Manager Settings"
                                    icon={<FaServer size={16} />}
                                    expanded={canisterManagerSettingsExpanded}
                                    onToggle={() => setCanisterManagerSettingsExpanded(!canisterManagerSettingsExpanded)}
                                    theme={theme}
                                >
                                    <CycleThresholdSettings
                                        theme={theme}
                                        title="Canister Cycle Thresholds"
                                        description="Configure cycle warning thresholds for canisters in Wallet and Dapp Manager."
                                        redValue={canisterCycleThresholdRed}
                                        orangeValue={canisterCycleThresholdOrange}
                                        onRedChange={(v) => { setCanisterCycleThresholdRed(v); setCanisterSettingsSaved(false); }}
                                        onOrangeChange={(v) => { setCanisterCycleThresholdOrange(v); setCanisterSettingsSaved(false); }}
                                        onSave={() => {
                                            const redValue = parseCyclesInput(canisterCycleThresholdRed);
                                            const orangeValue = parseCyclesInput(canisterCycleThresholdOrange);
                                            
                                            if (redValue === null || orangeValue === null) {
                                                alert('Invalid input. Please use format like "1T", "500B", or "1000000000000"');
                                                return;
                                            }
                                            
                                            if (redValue >= orangeValue) {
                                                alert('Critical threshold must be lower than warning threshold');
                                                return;
                                            }
                                            
                                            saveCanisterManagerSettings({
                                                cycleThresholdRed: redValue,
                                                cycleThresholdOrange: orangeValue,
                                            });
                                            
                                            setCanisterCycleThresholdRed(formatCyclesCompact(redValue));
                                            setCanisterCycleThresholdOrange(formatCyclesCompact(orangeValue));
                                            setCanisterSettingsSaved(true);
                                            setTimeout(() => setCanisterSettingsSaved(false), 3000);
                                        }}
                                        onReset={() => {
                                            setCanisterCycleThresholdRed('1.0T');
                                            setCanisterCycleThresholdOrange('5.0T');
                                            saveCanisterManagerSettings({
                                                cycleThresholdRed: 1_000_000_000_000,
                                                cycleThresholdOrange: 5_000_000_000_000,
                                            });
                                            setCanisterSettingsSaved(true);
                                            setTimeout(() => setCanisterSettingsSaved(false), 3000);
                                        }}
                                        saved={canisterSettingsSaved}
                                    />
                                </SettingsSection>

                                {/* Sneedex Notifications */}
                                <SettingsSection
                                    title="Sneedex Notifications"
                                    icon={<FaBell size={16} />}
                                    expanded={sneedexNotificationsExpanded}
                                    onToggle={() => setSneedexNotificationsExpanded(!sneedexNotificationsExpanded)}
                                    theme={theme}
                                >
                                    <p style={{ color: theme.colors.mutedText, fontSize: '0.9rem', marginBottom: '1rem' }}>
                                        Choose which Sneedex events you want to receive notifications for via <Link to="/sms" style={{ color: mePrimary }}>direct message</Link>.
                                    </p>
                                    
                                    {loadingNotificationSettings ? (
                                        <div style={{ textAlign: 'center', padding: '1.5rem', color: theme.colors.mutedText }}>
                                            Loading notification settings...
                                        </div>
                                    ) : (
                                        <>
                                            <NotificationToggle
                                                icon="🔔"
                                                title="New Bids"
                                                description="Notify me when someone bids on my offers"
                                                checked={notifyOnBid}
                                                onChange={(e) => setNotifyOnBid(e.target.checked)}
                                                theme={theme}
                                            />
                                            <NotificationToggle
                                                icon="⚠️"
                                                title="Outbid"
                                                description="Notify me when I've been outbid on an auction"
                                                checked={notifyOnOutbid}
                                                onChange={(e) => setNotifyOnOutbid(e.target.checked)}
                                                theme={theme}
                                            />
                                            <NotificationToggle
                                                icon="🎉"
                                                title="Offer Sold"
                                                description="Notify me when my offer is completed (sold)"
                                                checked={notifyOnSale}
                                                onChange={(e) => setNotifyOnSale(e.target.checked)}
                                                theme={theme}
                                            />
                                            <NotificationToggle
                                                icon="🏆"
                                                title="Auction Won"
                                                description="Notify me when I win an auction"
                                                checked={notifyOnWin}
                                                onChange={(e) => setNotifyOnWin(e.target.checked)}
                                                theme={theme}
                                            />
                                            <NotificationToggle
                                                icon="⏰"
                                                title="Offer Expired"
                                                description="Notify me when my offer expires without bids"
                                                checked={notifyOnExpiration}
                                                onChange={(e) => setNotifyOnExpiration(e.target.checked)}
                                                theme={theme}
                                            />
                                            <NotificationToggle
                                                icon="❌"
                                                title="Offer Cancelled"
                                                description="Notify me when an offer I bid on is cancelled"
                                                checked={notifyOnCancellation}
                                                onChange={(e) => setNotifyOnCancellation(e.target.checked)}
                                                theme={theme}
                                            />
                                            <NotificationToggle
                                                icon="🔒"
                                                title="Private Auction Invite"
                                                description="Notify me when I'm invited to a private auction"
                                                checked={notifyOnPrivateInvite}
                                                onChange={(e) => setNotifyOnPrivateInvite(e.target.checked)}
                                                theme={theme}
                                            />
                                            
                                            <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', marginTop: '1rem' }}>
                                                <button
                                                    onClick={saveNotificationSettings}
                                                    disabled={loadingNotificationSettings}
                                                    style={{
                                                        background: `linear-gradient(135deg, ${mePrimary}, ${meSecondary})`,
                                                        color: 'white',
                                                        border: 'none',
                                                        borderRadius: '10px',
                                                        padding: '0.75rem 1.5rem',
                                                        cursor: loadingNotificationSettings ? 'not-allowed' : 'pointer',
                                                        fontWeight: '600',
                                                        fontSize: '0.9rem',
                                                        opacity: loadingNotificationSettings ? 0.6 : 1,
                                                    }}
                                                >
                                                    {loadingNotificationSettings ? 'Saving...' : 'Save Settings'}
                                                </button>
                                                
                                                {notificationSettingsSaved && (
                                                    <span style={{ color: '#22c55e', fontSize: '0.9rem', display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                                                        <FaCheckCircle size={14} /> Settings saved!
                                                    </span>
                                                )}
                                            </div>
                                        </>
                                    )}
                                </SettingsSection>

                                {/* Cache Management */}
                                <SettingsSection
                                    title="Cache Management"
                                    icon={<FaServer size={16} />}
                                    expanded={cacheManagementExpanded}
                                    onToggle={() => setCacheManagementExpanded(!cacheManagementExpanded)}
                                    theme={theme}
                                >
                                    <div style={{ padding: '0.5rem 0' }}>
                                        <p style={{ 
                                            color: theme.colors.secondaryText, 
                                            fontSize: '0.85rem', 
                                            marginBottom: '1rem',
                                            lineHeight: '1.5'
                                        }}>
                                            If you're experiencing issues with duplicate tokens, positions, or stale data, 
                                            clearing the cache will reset all locally stored data and fetch fresh data on next load.
                                        </p>
                                        
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
                                            <button
                                                onClick={clearAllCaches}
                                                disabled={clearingCache}
                                                style={{
                                                    padding: '0.6rem 1.2rem',
                                                    background: clearingCache ? theme.colors.border : '#dc2626',
                                                    color: '#fff',
                                                    border: 'none',
                                                    borderRadius: '8px',
                                                    cursor: clearingCache ? 'not-allowed' : 'pointer',
                                                    fontWeight: '600',
                                                    fontSize: '0.9rem',
                                                    opacity: clearingCache ? 0.6 : 1,
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    gap: '0.5rem'
                                                }}
                                            >
                                                <FaServer size={14} />
                                                {clearingCache ? 'Clearing...' : 'Clear All Caches'}
                                            </button>
                                            
                                            {cacheCleared && (
                                                <span style={{ color: '#22c55e', fontSize: '0.9rem', display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                                                    <FaCheckCircle size={14} /> Cache cleared!
                                                </span>
                                            )}
                                        </div>
                                        
                                        <p style={{ 
                                            color: theme.colors.secondaryText, 
                                            fontSize: '0.75rem', 
                                            marginTop: '0.75rem',
                                            opacity: 0.7
                                        }}>
                                            This clears: wallet data, token metadata, logos, neurons cache
                                        </p>
                                    </div>
                                </SettingsSection>
                            </div>
                        )}

                        {/* Neurons Tab */}
                        {activeTab === 'neurons' && (
                            <div style={{ padding: '1rem' }}>
                                {/* Neurons Header */}
                                <div style={{ 
                                    display: 'flex', 
                                    alignItems: 'center', 
                                    justifyContent: 'space-between',
                                    marginBottom: '1rem',
                                    flexWrap: 'wrap',
                                    gap: '0.75rem'
                                }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                                        <div style={{
                                            width: '40px',
                                            height: '40px',
                                            borderRadius: '10px',
                                            background: selectedSnsLogo ? 'transparent' : `linear-gradient(135deg, ${mePrimary}30, ${meSecondary}20)`,
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'center',
                                            color: mePrimary,
                                            overflow: 'hidden'
                                        }}>
                                            {selectedSnsLogo ? (
                                                <img src={selectedSnsLogo} alt="DAO" style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: '10px' }} />
                                            ) : (
                                                <FaBrain size={18} />
                                            )}
                                        </div>
                                        <span style={{ color: theme.colors.primaryText, fontWeight: '600', fontSize: '1.1rem' }}>
                                            My {selectedSnsInfo?.name || 'DAO'} Neurons
                                        </span>
                                    </div>
                                    <Link
                                        to="/help/neurons"
                                        style={{
                                            color: mePrimary,
                                            textDecoration: 'none',
                                            fontSize: '0.85rem',
                                            padding: '0.35rem 0.75rem',
                                            borderRadius: '6px',
                                            background: `${mePrimary}15`,
                                            fontWeight: '500'
                                        }}
                                    >
                                        ❓ Help
                                    </Link>
                                </div>
                                {neurons.length > 0 && (
                                    <div style={{ marginBottom: '1rem' }}>
                                        <label style={{
                                            display: 'flex',
                                            alignItems: 'center',
                                            gap: '0.5rem',
                                            cursor: 'pointer',
                                            color: theme.colors.secondaryText,
                                            fontSize: '0.9rem',
                                            userSelect: 'none',
                                        }}>
                                            <input
                                                type="checkbox"
                                                checked={hideEmptyNeurons}
                                                onChange={(e) => setHideEmptyNeurons(e.target.checked)}
                                                style={{ cursor: 'pointer', accentColor: mePrimary, width: '16px', height: '16px' }}
                                            />
                                            Hide empty neurons
                                        </label>
                                    </div>
                                )}
                                
                                {loading ? (
                                    <div style={{ textAlign: 'center', padding: '2rem', color: theme.colors.mutedText }}>
                                        <div className="me-pulse" style={{
                                            width: '48px',
                                            height: '48px',
                                            borderRadius: '50%',
                                            background: `linear-gradient(135deg, ${mePrimary}30, ${meSecondary}20)`,
                                            margin: '0 auto 1rem',
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'center',
                                            color: mePrimary
                                        }}>
                                            <FaBrain size={20} />
                                        </div>
                                        Loading neurons...
                                    </div>
                                ) : neurons.length === 0 ? (
                                    <div style={{ textAlign: 'center', padding: '2rem', color: theme.colors.mutedText }}>
                                        <div style={{
                                            width: '60px',
                                            height: '60px',
                                            borderRadius: '50%',
                                            background: `${mePrimary}15`,
                                            margin: '0 auto 1rem',
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'center',
                                            color: mePrimary
                                        }}>
                                            <FaBrain size={24} />
                                        </div>
                                        <p style={{ fontSize: '1rem', marginBottom: '0.5rem' }}>No neurons found for this SNS.</p>
                                        <p style={{ fontSize: '0.9rem', color: theme.colors.mutedText }}>
                                            Try selecting a different SNS or stake tokens to create neurons.
                                        </p>
                                    </div>
                                ) : (
                                    <div>
                                        {/* Neuron Group Tabs */}
                                        {Array.from(groupedNeurons.entries()).length > 1 && (
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
                                                {Array.from(groupedNeurons.entries()).map(([groupId, group]) => {
                                                    const isMyNeurons = Boolean(group.isMy);
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
                                                                    ? `linear-gradient(135deg, ${mePrimary}, ${meSecondary})`
                                                                    : 'transparent',
                                                                color: isActive ? 'white' : theme.colors.secondaryText,
                                                                boxShadow: isActive ? `0 2px 8px ${mePrimary}30` : 'none'
                                                            }}
                                                        >
                                                            <span>{isMyNeurons ? '👑' : '🔑'}</span>
                                                            <span style={{ 
                                                                overflow: 'hidden', 
                                                                textOverflow: 'ellipsis',
                                                                whiteSpace: 'nowrap',
                                                                maxWidth: '150px'
                                                            }}>
                                                                {isMyNeurons ? 'My Neurons' : (
                                                                    principalDisplayInfo.get(group.ownerPrincipal)?.display || 
                                                                    `${group.ownerPrincipal.slice(0, 8)}...`
                                                                )}
                                                            </span>
                                                            <span style={{ 
                                                                background: isActive ? 'rgba(255,255,255,0.2)' : `${mePrimary}20`,
                                                                padding: '0.15rem 0.4rem',
                                                                borderRadius: '6px',
                                                                fontSize: '0.75rem',
                                                                color: isActive ? 'white' : mePrimary
                                                            }}>
                                                                {group.neurons.length}
                                                            </span>
                                                        </button>
                                                    );
                                                })}
                                            </div>
                                        )}

                                        {/* Active Group Content */}
                                        {(() => {
                                            // Get the active group, fallback to first group if activeNeuronGroup not found
                                            const entries = Array.from(groupedNeurons.entries());
                                            let activeGroup = entries.find(([id]) => id === activeNeuronGroup);
                                            if (!activeGroup && entries.length > 0) {
                                                activeGroup = entries[0];
                                            }
                                            if (!activeGroup) return null;
                                            
                                            const [groupId, group] = activeGroup;
                                            const isMyNeurons = Boolean(group.isMy);
                                            
                                            return (
                                                <div>
                                                    {/* Group Header */}
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
                                                            {isMyNeurons ? (
                                                                <span>Neurons you own</span>
                                                            ) : (
                                                                <span style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap' }}>
                                                                    <span>Hotkey access to</span>
                                                                    <PrincipalDisplay
                                                                        principal={Principal.fromText(group.ownerPrincipal)}
                                                                        displayInfo={principalDisplayInfo.get(group.ownerPrincipal)}
                                                                        showCopyButton={false}
                                                                        short={true}
                                                                        noLink={true}
                                                                        isAuthenticated={true}
                                                                    />
                                                                </span>
                                                            )}
                                                        </div>
                                                        <div style={{
                                                            color: mePrimary,
                                                            fontSize: '1rem',
                                                            fontWeight: '700',
                                                            whiteSpace: 'nowrap'
                                                        }}>
                                                            {formatE8s(group.totalStake)} {tokenSymbol}
                                                        </div>
                                                    </div>

                                                    {/* Neuron Cards Grid */}
                                                    <div style={{
                                                        display: 'grid',
                                                        gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
                                                        gap: '1rem'
                                                    }}>
                                                        {group.neurons.map((neuron) => {
                                                            const neuronId = uint8ArrayToHex(neuron.id[0]?.id);
                                                            if (!neuronId) return null;

                                                            const hasHotkeyAccess = neuron.permissions?.some(p => {
                                                                const permPrincipal = safePrincipalString(p.principal);
                                                                if (!permPrincipal || permPrincipal !== identity.getPrincipal().toString()) return false;
                                                                const permTypes = safePermissionType(p);
                                                                return permTypes.includes(4);
                                                            });

                                                            const { name, nickname, isVerified } = getDisplayName(neuronId);

                                                            return (
                                                                <NeuronCard
                                                                    key={neuronId}
                                                                    neuron={neuron}
                                                                    neuronId={neuronId}
                                                                    name={name}
                                                                    nickname={nickname}
                                                                    isVerified={isVerified}
                                                                    hasHotkeyAccess={hasHotkeyAccess}
                                                                    theme={theme}
                                                                    tokenSymbol={tokenSymbol}
                                                                    selectedSnsRoot={selectedSnsRoot}
                                                                    identity={identity}
                                                                    principalDisplayInfo={principalDisplayInfo}
                                                                    editingName={editingName}
                                                                    setEditingName={setEditingName}
                                                                    nameInput={nameInput}
                                                                    setNameInput={setNameInput}
                                                                    inputError={inputError}
                                                                    setInputError={setInputError}
                                                                    validateNameInput={validateNameInput}
                                                                    handleNameSubmit={handleNameSubmit}
                                                                    isSubmitting={isSubmitting}
                                                                    nervousSystemParameters={nervousSystemParameters}
                                                                />
                                                            );
                                                        })}
                                                    </div>
                                                </div>
                                            );
                                        })()}
                                    </div>
                                )}
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
                                        background: selectedSnsLogo ? 'transparent' : `linear-gradient(135deg, ${meAccent}30, ${mePrimary}20)`,
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                        color: meAccent,
                                        overflow: 'hidden'
                                    }}>
                                        {selectedSnsLogo ? (
                                            <img src={selectedSnsLogo} alt="DAO" style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: '10px' }} />
                                        ) : (
                                            <FaExchangeAlt size={18} />
                                        )}
                                    </div>
                                    <span style={{ color: theme.colors.primaryText, fontWeight: '600', fontSize: '1.1rem' }}>
                                        My {selectedSnsInfo?.name || 'DAO'} Transactions
                                    </span>
                                </div>
                                
                                {selectedSnsRoot ? (
                                    <TransactionList 
                                        snsRootCanisterId={selectedSnsRoot}
                                        principalId={identity?.getPrincipal().toString()}
                                        isCollapsed={false}
                                        onToggleCollapse={() => {}}
                                        showHeader={false}
                                        embedded={true}
                                    />
                                ) : (
                                    <div style={{ 
                                        textAlign: 'center', 
                                        padding: '2rem', 
                                        color: theme.colors.mutedText 
                                    }}>
                                        Select a DAO to view transactions
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
        </div>
    );
}

// Helper Components
function SettingsSection({ title, icon, expanded, onToggle, children, theme }) {
    return (
        <div style={{
            background: theme.colors.tertiaryBg,
            borderRadius: '12px',
            border: `1px solid ${theme.colors.border}`,
            marginBottom: '1rem',
            overflow: 'hidden',
        }}>
            <div 
                onClick={onToggle}
                style={{
                    padding: '1rem 1.25rem',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    cursor: 'pointer',
                    borderBottom: expanded ? `1px solid ${theme.colors.border}` : 'none',
                }}
            >
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                    <span style={{ color: mePrimary }}>{icon}</span>
                    <span style={{ color: theme.colors.primaryText, fontWeight: '500', fontSize: '0.95rem' }}>
                        {title}
                    </span>
                </div>
                <FaChevronDown 
                    size={14} 
                    color={theme.colors.mutedText}
                    style={{
                        transition: 'transform 0.3s ease',
                        transform: expanded ? 'rotate(0deg)' : 'rotate(-90deg)'
                    }}
                />
            </div>
            
            {expanded && (
                <div style={{ padding: '1rem 1.25rem' }}>
                    {children}
                </div>
            )}
        </div>
    );
}

function SettingItem({ title, description, children, theme, isLast = false }) {
    return (
        <div style={{ 
            display: 'flex', 
            alignItems: 'center', 
            justifyContent: 'space-between',
            padding: '0.75rem 0',
            borderBottom: isLast ? 'none' : `1px solid ${theme.colors.border}`,
            gap: '1rem',
            flexWrap: 'wrap'
        }}>
            <div style={{ flex: 1, minWidth: '200px' }}>
                <div style={{ color: theme.colors.primaryText, fontWeight: '500', marginBottom: '0.25rem', fontSize: '0.95rem' }}>
                    {title}
                </div>
                <div style={{ color: theme.colors.mutedText, fontSize: '0.85rem' }}>
                    {description}
                </div>
            </div>
            {children}
        </div>
    );
}

function NotificationToggle({ icon, title, description, checked, onChange, theme }) {
    return (
        <div style={{ 
            display: 'flex', 
            alignItems: 'center', 
            justifyContent: 'space-between',
            padding: '0.75rem 1rem',
            background: theme.colors.secondaryBg,
            borderRadius: '10px',
            marginBottom: '0.5rem',
            gap: '1rem'
        }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flex: 1 }}>
                <span style={{ fontSize: '1.1rem' }}>{icon}</span>
                <div>
                    <div style={{ color: theme.colors.primaryText, fontWeight: '500', fontSize: '0.9rem' }}>
                        {title}
                    </div>
                    <div style={{ color: theme.colors.mutedText, fontSize: '0.8rem' }}>
                        {description}
                    </div>
                </div>
            </div>
            <label style={{ position: 'relative', display: 'inline-block', width: '50px', height: '28px', flexShrink: 0 }}>
                <input
                    type="checkbox"
                    checked={checked}
                    onChange={onChange}
                    style={{ opacity: 0, width: 0, height: 0 }}
                />
                <span style={{
                    position: 'absolute',
                    cursor: 'pointer',
                    top: 0,
                    left: 0,
                    right: 0,
                    bottom: 0,
                    backgroundColor: checked ? mePrimary : theme.colors.border,
                    transition: '0.3s',
                    borderRadius: '28px',
                }}>
                    <span style={{
                        position: 'absolute',
                        content: '',
                        height: '22px',
                        width: '22px',
                        left: checked ? '25px' : '3px',
                        bottom: '3px',
                        backgroundColor: 'white',
                        transition: '0.3s',
                        borderRadius: '50%',
                    }}></span>
                </span>
            </label>
        </div>
    );
}

function CycleThresholdSettings({ theme, title, description, redValue, orangeValue, onRedChange, onOrangeChange, onSave, onReset, saved }) {
    return (
        <div>
            <p style={{ color: theme.colors.mutedText, fontSize: '0.9rem', marginBottom: '1.25rem' }}>
                {description}
            </p>
            
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                <div>
                    <label style={{ 
                        color: theme.colors.mutedText, 
                        fontSize: '0.85rem', 
                        display: 'block', 
                        marginBottom: '0.5rem' 
                    }}>
                        🔴 Critical Threshold (Red)
                    </label>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                        <input
                            type="text"
                            value={redValue}
                            onChange={(e) => onRedChange(e.target.value)}
                            placeholder="e.g., 1T, 500B"
                            style={{
                                backgroundColor: theme.colors.secondaryBg,
                                border: `1px solid ${theme.colors.border}`,
                                borderRadius: '8px',
                                color: theme.colors.primaryText,
                                padding: '0.6rem 1rem',
                                width: '140px',
                                fontSize: '0.9rem'
                            }}
                        />
                        <span style={{ 
                            color: '#ef4444', 
                            fontSize: '1.25rem',
                            padding: '0.35rem 0.75rem',
                            background: '#ef444420',
                            borderRadius: '8px',
                        }}>
                            ⚡
                        </span>
                    </div>
                </div>
                
                <div>
                    <label style={{ 
                        color: theme.colors.mutedText, 
                        fontSize: '0.85rem', 
                        display: 'block', 
                        marginBottom: '0.5rem' 
                    }}>
                        🟠 Warning Threshold (Orange)
                    </label>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                        <input
                            type="text"
                            value={orangeValue}
                            onChange={(e) => onOrangeChange(e.target.value)}
                            placeholder="e.g., 5T, 2T"
                            style={{
                                backgroundColor: theme.colors.secondaryBg,
                                border: `1px solid ${theme.colors.border}`,
                                borderRadius: '8px',
                                color: theme.colors.primaryText,
                                padding: '0.6rem 1rem',
                                width: '140px',
                                fontSize: '0.9rem'
                            }}
                        />
                        <span style={{ 
                            color: '#f59e0b', 
                            fontSize: '1.25rem',
                            padding: '0.35rem 0.75rem',
                            background: '#f59e0b20',
                            borderRadius: '8px',
                        }}>
                            ⚡
                        </span>
                    </div>
                </div>
                
                <div style={{ 
                    color: theme.colors.mutedText, 
                    fontSize: '0.8rem', 
                    padding: '0.75rem',
                    background: theme.colors.secondaryBg,
                    borderRadius: '8px',
                }}>
                    💡 Use suffixes: <strong>T</strong> (trillion), <strong>B</strong> (billion), <strong>M</strong> (million)
                </div>
                
                <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap' }}>
                    <button
                        onClick={onSave}
                        style={{
                            background: `linear-gradient(135deg, ${mePrimary}, ${meSecondary})`,
                            color: 'white',
                            border: 'none',
                            borderRadius: '10px',
                            padding: '0.75rem 1.5rem',
                            cursor: 'pointer',
                            fontWeight: '600',
                            fontSize: '0.9rem',
                        }}
                    >
                        Save Settings
                    </button>
                    
                    <button
                        onClick={onReset}
                        style={{
                            backgroundColor: 'transparent',
                            color: theme.colors.mutedText,
                            border: `1px solid ${theme.colors.border}`,
                            borderRadius: '10px',
                            padding: '0.75rem 1.5rem',
                            cursor: 'pointer',
                            fontSize: '0.9rem',
                        }}
                    >
                        Reset to Defaults
                    </button>
                    
                    {saved && (
                        <span style={{ color: '#22c55e', fontSize: '0.9rem', display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                            <FaCheckCircle size={14} /> Settings saved!
                        </span>
                    )}
                </div>
            </div>
        </div>
    );
}

function NeuronGroup({ 
    group, 
    isExpanded, 
    isMyNeurons, 
    onToggle, 
    theme, 
    tokenSymbol, 
    principalDisplayInfo, 
    selectedSnsRoot, 
    identity, 
    getDisplayName, 
    editingName, 
    setEditingName, 
    nameInput, 
    setNameInput, 
    inputError, 
    setInputError, 
    validateNameInput, 
    handleNameSubmit, 
    isSubmitting,
    nervousSystemParameters 
}) {
    return (
        <div style={{
            background: theme.colors.tertiaryBg,
            borderRadius: '14px',
            border: `1px solid ${theme.colors.border}`,
            overflow: 'hidden',
        }}>
            <div
                onClick={onToggle}
                style={{
                    padding: '1rem 1.25rem',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    cursor: 'pointer',
                    borderBottom: isExpanded ? `1px solid ${theme.colors.border}` : 'none',
                }}
            >
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', minWidth: 0 }}>
                    <FaChevronDown 
                        size={14} 
                        color={theme.colors.mutedText}
                        style={{
                            transition: 'transform 0.3s ease',
                            transform: isExpanded ? 'rotate(0deg)' : 'rotate(-90deg)'
                        }}
                    />
                    {isMyNeurons ? (
                        <span style={{
                            color: theme.colors.primaryText,
                            fontWeight: '600',
                            fontSize: '0.95rem',
                        }}>
                            👑 Owned Neurons ({group.neurons.length})
                        </span>
                    ) : (
                        <span style={{
                            color: theme.colors.primaryText,
                            fontWeight: '500',
                            fontSize: '0.95rem',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '0.5rem',
                            flexWrap: 'wrap'
                        }}>
                            <span>🔑 Hotkey access to</span>
                            <PrincipalDisplay
                                principal={Principal.fromText(group.ownerPrincipal)}
                                displayInfo={principalDisplayInfo.get(group.ownerPrincipal)}
                                showCopyButton={false}
                                short={true}
                                noLink={true}
                                isAuthenticated={true}
                            />
                            <span style={{ color: theme.colors.mutedText }}>({group.neurons.length})</span>
                        </span>
                    )}
                </div>

                <div style={{
                    color: mePrimary,
                    fontSize: '1rem',
                    fontWeight: '700',
                    whiteSpace: 'nowrap'
                }}>
                    {formatE8s(group.totalStake)} {tokenSymbol}
                </div>
            </div>

            {isExpanded && (
                <div style={{ padding: '1rem 1.25rem' }}>
                    <div style={{
                        display: 'grid',
                        gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))',
                        gap: '1rem'
                    }}>
                        {group.neurons.map((neuron) => {
                            const neuronId = uint8ArrayToHex(neuron.id[0]?.id);
                            if (!neuronId) return null;

                            const hasHotkeyAccess = neuron.permissions?.some(p => {
                                const permPrincipal = safePrincipalString(p.principal);
                                if (!permPrincipal || permPrincipal !== identity.getPrincipal().toString()) return false;
                                const permTypes = safePermissionType(p);
                                return permTypes.includes(4);
                            });

                            const { name, nickname, isVerified } = getDisplayName(neuronId);

                            return (
                                <NeuronCard
                                    key={neuronId}
                                    neuron={neuron}
                                    neuronId={neuronId}
                                    name={name}
                                    nickname={nickname}
                                    isVerified={isVerified}
                                    hasHotkeyAccess={hasHotkeyAccess}
                                    theme={theme}
                                    tokenSymbol={tokenSymbol}
                                    selectedSnsRoot={selectedSnsRoot}
                                    identity={identity}
                                    principalDisplayInfo={principalDisplayInfo}
                                    editingName={editingName}
                                    setEditingName={setEditingName}
                                    nameInput={nameInput}
                                    setNameInput={setNameInput}
                                    inputError={inputError}
                                    setInputError={setInputError}
                                    validateNameInput={validateNameInput}
                                    handleNameSubmit={handleNameSubmit}
                                    isSubmitting={isSubmitting}
                                    nervousSystemParameters={nervousSystemParameters}
                                />
                            );
                        })}
                    </div>
                </div>
            )}
        </div>
    );
}

function NeuronCard({ 
    neuron, 
    neuronId, 
    name, 
    nickname, 
    isVerified, 
    hasHotkeyAccess, 
    theme, 
    tokenSymbol, 
    selectedSnsRoot, 
    identity, 
    principalDisplayInfo, 
    editingName, 
    setEditingName, 
    nameInput, 
    setNameInput, 
    inputError, 
    setInputError, 
    validateNameInput, 
    handleNameSubmit, 
    isSubmitting,
    nervousSystemParameters 
}) {
    const displayName = name || nickname;

    return (
        <div style={{
            background: `linear-gradient(135deg, ${theme.colors.primaryBg} 0%, ${mePrimary}08 100%)`,
            borderRadius: '14px',
            padding: '1rem',
            border: `1px solid ${theme.colors.border}`,
            transition: 'all 0.3s ease',
            minWidth: 0,
            overflow: 'hidden'
        }}>
            {/* Header */}
            <div style={{ marginBottom: '1rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem', flexWrap: 'wrap' }}>
                    <Link
                        to={`/neuron?neuronid=${neuronId}&sns=${selectedSnsRoot}`}
                        style={{ 
                            fontFamily: 'monospace',
                            color: theme.colors.mutedText,
                            fontSize: '0.85rem',
                            textDecoration: 'none'
                        }}
                        title={neuronId}
                    >
                        {`${neuronId.slice(0, 6)}...${neuronId.slice(-6)}`}
                    </Link>
                    <button
                        onClick={(e) => {
                            e.stopPropagation();
                            navigator.clipboard.writeText(neuronId);
                        }}
                        style={{
                            background: 'none',
                            border: 'none',
                            padding: '0.25rem',
                            cursor: 'pointer',
                            color: theme.colors.mutedText,
                            fontSize: '0.85rem'
                        }}
                        title="Copy neuron ID"
                    >
                        📋
                    </button>
                    {hasHotkeyAccess && (
                        <button
                            onClick={(e) => {
                                e.stopPropagation();
                                setEditingName(neuronId);
                                setNameInput(displayName || '');
                            }}
                            style={{
                                background: 'none',
                                border: 'none',
                                padding: '0.25rem',
                                cursor: 'pointer',
                                color: theme.colors.mutedText,
                                fontSize: '0.85rem'
                            }}
                            title="Edit neuron name"
                        >
                            ✏️
                        </button>
                    )}
                    <Link
                        to={`/neuron?neuronid=${neuronId}&sns=${selectedSnsRoot}`}
                        style={{
                            marginLeft: 'auto',
                            background: `${mePrimary}15`,
                            color: mePrimary,
                            border: 'none',
                            borderRadius: '8px',
                            padding: '0.4rem 0.75rem',
                            cursor: 'pointer',
                            fontSize: '0.8rem',
                            fontWeight: '600',
                            textDecoration: 'none',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '0.35rem',
                        }}
                    >
                        ⚙️ Manage
                    </Link>
                </div>
                
                {name && (
                    <div style={{ 
                        color: mePrimary,
                        fontSize: '1.1rem',
                        fontWeight: '600',
                        marginBottom: '0.25rem',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.35rem'
                    }}>
                        {name}
                        {isVerified && <FaCheckCircle size={14} color={mePrimary} title="Verified name" />}
                    </div>
                )}
                {nickname && (
                    <div style={{ 
                        color: theme.colors.mutedText,
                        fontSize: '0.95rem',
                        fontStyle: 'italic',
                        marginBottom: '0.25rem'
                    }}>
                        {nickname}
                    </div>
                )}
                
                {editingName === neuronId && (
                    <div style={{ 
                        marginTop: '0.75rem',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '0.5rem'
                    }}>
                        <input
                            type="text"
                            value={nameInput}
                            onChange={(e) => {
                                const newValue = e.target.value;
                                setNameInput(newValue);
                                setInputError(validateNameInput(newValue));
                            }}
                            maxLength={32}
                            placeholder="Enter neuron name (max 32 chars)"
                            style={{
                                backgroundColor: theme.colors.tertiaryBg,
                                border: `1px solid ${inputError ? theme.colors.error : theme.colors.border}`,
                                borderRadius: '8px',
                                color: theme.colors.primaryText,
                                padding: '0.6rem 0.75rem',
                                width: '100%',
                                fontSize: '0.9rem',
                                boxSizing: 'border-box'
                            }}
                        />
                        {inputError && (
                            <div style={{ color: theme.colors.error, fontSize: '0.8rem' }}>
                                {inputError}
                            </div>
                        )}
                        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                            <button
                                onClick={() => handleNameSubmit(neuronId, true)}
                                disabled={isSubmitting}
                                style={{
                                    backgroundColor: theme.colors.mutedText,
                                    color: 'white',
                                    border: 'none',
                                    borderRadius: '6px',
                                    padding: '0.4rem 0.75rem',
                                    cursor: isSubmitting ? 'not-allowed' : 'pointer',
                                    fontSize: '0.8rem',
                                    fontWeight: '500',
                                    opacity: isSubmitting ? 0.7 : 1
                                }}
                            >
                                Set Nickname
                            </button>
                            {hasHotkeyAccess && (
                                <button
                                    onClick={() => handleNameSubmit(neuronId, false)}
                                    disabled={isSubmitting}
                                    style={{
                                        background: `linear-gradient(135deg, ${mePrimary}, ${meSecondary})`,
                                        color: 'white',
                                        border: 'none',
                                        borderRadius: '6px',
                                        padding: '0.4rem 0.75rem',
                                        cursor: isSubmitting ? 'not-allowed' : 'pointer',
                                        fontSize: '0.8rem',
                                        fontWeight: '500',
                                        opacity: isSubmitting ? 0.7 : 1
                                    }}
                                >
                                    Set Name
                                </button>
                            )}
                            <button
                                onClick={() => {
                                    setEditingName(null);
                                    setNameInput('');
                                }}
                                disabled={isSubmitting}
                                style={{
                                    backgroundColor: theme.colors.error,
                                    color: 'white',
                                    border: 'none',
                                    borderRadius: '6px',
                                    padding: '0.4rem 0.75rem',
                                    cursor: isSubmitting ? 'not-allowed' : 'pointer',
                                    fontSize: '0.8rem',
                                    fontWeight: '500'
                                }}
                            >
                                Cancel
                            </button>
                        </div>
                    </div>
                )}
                
                <div style={{ 
                    fontSize: '1.5rem',
                    fontWeight: '700',
                    color: mePrimary,
                    marginTop: '0.5rem'
                }}>
                    {formatE8s(neuron.cached_neuron_stake_e8s)} {tokenSymbol}
                </div>
            </div>

            {/* Stats Grid */}
            <div style={{ 
                display: 'grid',
                gridTemplateColumns: '1fr 1fr',
                gap: '0.75rem',
                fontSize: '0.85rem'
            }}>
                <div>
                    <div style={{ color: theme.colors.mutedText, marginBottom: '0.2rem' }}>Created</div>
                    <div style={{ color: theme.colors.primaryText, fontWeight: '500' }}>
                        {new Date(Number(neuron.created_timestamp_seconds) * 1000).toLocaleDateString()}
                    </div>
                </div>
                <div>
                    <div style={{ color: theme.colors.mutedText, marginBottom: '0.2rem' }}>Dissolve State</div>
                    <div style={{ color: theme.colors.primaryText, fontWeight: '500' }}>{getDissolveState(neuron)}</div>
                </div>
                <div>
                    <div style={{ color: theme.colors.mutedText, marginBottom: '0.2rem' }}>Maturity</div>
                    <div style={{ color: theme.colors.primaryText, fontWeight: '500' }}>{formatE8s(neuron.maturity_e8s_equivalent)} {tokenSymbol}</div>
                </div>
                <div>
                    <div style={{ color: theme.colors.mutedText, marginBottom: '0.2rem' }}>Voting Power</div>
                    <div style={{ color: mePrimary, fontWeight: '600' }}>
                        {nervousSystemParameters ? 
                            formatVotingPower(calculateVotingPower(neuron, nervousSystemParameters)) :
                            (Number(neuron.voting_power_percentage_multiplier) / 100).toFixed(2) + 'x'
                        }
                    </div>
                </div>
            </div>

            {/* Permissions */}
            <div style={{ marginTop: '1rem', paddingTop: '0.75rem', borderTop: `1px solid ${theme.colors.border}` }}>
                <div style={{ color: theme.colors.mutedText, fontSize: '0.8rem', marginBottom: '0.5rem' }}>Permissions</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                    {getOwnerPrincipals(neuron).map((ownerStr) => (
                        <div key={ownerStr} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.85rem' }}>
                            <span title="Owner">👑</span>
                            <PrincipalDisplay
                                principal={Principal.fromText(ownerStr)}
                                displayInfo={principalDisplayInfo.get(ownerStr)}
                                showCopyButton={false}
                            />
                        </div>
                    ))}
                    {neuron.permissions
                        .filter(p => !getOwnerPrincipals(neuron).includes(safePrincipalString(p.principal)))
                        .map((p, index) => {
                            const principalStr = safePrincipalString(p.principal);
                            return (
                                <div key={index} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.85rem' }}>
                                    <span title="Hotkey">🔑</span>
                                    <PrincipalDisplay 
                                        principal={p.principal}
                                        displayInfo={principalDisplayInfo.get(principalStr)}
                                        showCopyButton={false}
                                    />
                                </div>
                            );
                        })
                    }
                </div>
            </div>
        </div>
    );
}
