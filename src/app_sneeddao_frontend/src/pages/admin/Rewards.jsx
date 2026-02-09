import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useAuth } from '../../AuthContext';
import { useTheme } from '../../contexts/ThemeContext';
import Header from '../../components/Header';
import { Principal } from '@dfinity/principal';
import { createActor as createRllActor, canisterId as rllCanisterId } from 'declarations/rll';
import { createActor as createLedgerActor } from 'external/icrc1_ledger';
import { getTokenLogo } from '../../utils/TokenUtils';
import { PrincipalDisplay } from '../../utils/PrincipalUtils';
import PrincipalInput from '../../components/PrincipalInput';
import InfoModal from '../../components/InfoModal';
import ConfirmationModal from '../../ConfirmationModal';
import { useNavigate } from 'react-router-dom';
import { 
    FaSync, FaPlus, FaTrash, FaSpinner, FaCoins, FaSearch,
    FaCheckCircle, FaExclamationTriangle, FaPlay, FaStop,
    FaChartBar, FaUsers, FaHistory, FaCog, FaDatabase,
    FaClock, FaBalanceScale, FaDownload, FaExclamationCircle,
    FaUserShield, FaFileImport, FaTimes, FaChevronDown, FaChevronUp,
    FaInfoCircle, FaChevronLeft, FaChevronRight, FaWallet, FaQuestion
} from 'react-icons/fa';

// Gold theme for rewards
const goldPrimary = '#d4af37';
const goldLight = '#f4d03f';
const goldDark = '#aa8c2c';

// Pagination constants
const ITEMS_PER_PAGE = 20;

export default function RewardsAdmin() {
    const { isAuthenticated, identity } = useAuth();
    const { theme } = useTheme();
    const navigate = useNavigate();
    
    // Admin state
    const [isAdmin, setIsAdmin] = useState(false);
    const [adminLoading, setAdminLoading] = useState(true);
    const [admins, setAdmins] = useState([]);
    const [newAdminPrincipal, setNewAdminPrincipal] = useState('');
    const [addingAdmin, setAddingAdmin] = useState(false);
    const [removingAdmin, setRemovingAdmin] = useState(null);
    
    // Loading states
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    
    // Main loop status
    const [mainLoopStatus, setMainLoopStatus] = useState(null);
    const [togglingMainLoop, setTogglingMainLoop] = useState(false);
    
    // Stats
    const [neuronsCount, setNeuronsCount] = useState(0);
    const [ownersCount, setOwnersCount] = useState(0);
    const [propsCount, setPropsCount] = useState(0);
    const [balancesCount, setBalancesCount] = useState(0);
    const [highestProposalId, setHighestProposalId] = useState(0);
    
    // Token balances
    const [tokenBalances, setTokenBalances] = useState([]);
    const [loadingBalances, setLoadingBalances] = useState(false);
    const [reconciliation, setReconciliation] = useState([]);
    const [loadingReconciliation, setLoadingReconciliation] = useState(false);
    
    // User/Owner balance lookup
    const [userBalanceLookup, setUserBalanceLookup] = useState('');
    const [userBalances, setUserBalances] = useState([]);
    const [loadingUserBalances, setLoadingUserBalances] = useState(false);
    
    // All user balances
    const [allUserBalances, setAllUserBalances] = useState([]);
    const [loadingAllUserBalances, setLoadingAllUserBalances] = useState(false);
    const [userBalancesPage, setUserBalancesPage] = useState(1);
    const [userBalancesFilter, setUserBalancesFilter] = useState('');
    
    // Neuron statistics
    const [neuronStats, setNeuronStats] = useState(null);
    const [loadingNeuronStats, setLoadingNeuronStats] = useState(false);
    
    // Event statistics
    const [eventStats, setEventStats] = useState(null);
    const [loadingEventStats, setLoadingEventStats] = useState(false);
    
    // Distribution events with pagination
    const [distributionEvents, setDistributionEvents] = useState([]);
    const [loadingDistributions, setLoadingDistributions] = useState(false);
    const [distributionPage, setDistributionPage] = useState(1);
    
    // Claim events with pagination
    const [claimEvents, setClaimEvents] = useState([]);
    const [loadingClaims, setLoadingClaims] = useState(false);
    const [claimPage, setClaimPage] = useState(1);
    const [errorClaimEvents, setErrorClaimEvents] = useState([]);
    const [loadingErrorClaims, setLoadingErrorClaims] = useState(false);
    const [claimFilter, setClaimFilter] = useState(''); // Filter by principal/hotkey
    
    // Known and whitelisted tokens (for metadata lookup)
    const [knownTokens, setKnownTokens] = useState([]);
    const [whitelistedTokens, setWhitelistedTokens] = useState([]);
    const [loadingTokens, setLoadingTokens] = useState(false);
    const [tokenLogos, setTokenLogos] = useState({});
    const [tokensLoaded, setTokensLoaded] = useState(false);
    
    // Token distribution limits
    const [minDistributions, setMinDistributions] = useState([]);
    const [maxDistributions, setMaxDistributions] = useState([]);
    const [loadingDistLimits, setLoadingDistLimits] = useState(false);
    
    // Total distributions
    const [totalDistributions, setTotalDistributions] = useState([]);
    const [loadingTotalDist, setLoadingTotalDist] = useState(false);
    
    // Import status
    const [neuronImportStatus, setNeuronImportStatus] = useState(null);
    const [proposalImportStatus, setProposalImportStatus] = useState(null);
    const [importStage, setImportStage] = useState('');
    const [importing, setImporting] = useState(false);
    
    // Token check status
    const [tokenCheckStatus, setTokenCheckStatus] = useState(null);
    const [walletTokenCheckStatus, setWalletTokenCheckStatus] = useState(null);
    
    // Section expansion states
    const [expandedSections, setExpandedSections] = useState({
        mainLoop: true,
        stats: true,
        balances: false,
        userBalances: false,
        neuronStats: false,
        eventStats: false,
        distributions: false,
        claims: false,
        tokens: false,
        distLimits: false,
        imports: false,
        admins: false
    });
    
    // Modals
    const [infoModal, setInfoModal] = useState({ show: false, title: '', message: '', type: 'info' });
    const [confirmModal, setConfirmModal] = useState({ show: false, title: '', message: '', onConfirm: null });
    
    // Build token metadata map from known and whitelisted tokens
    const tokenMetadataMap = useMemo(() => {
        const map = {};
        for (const [tokenId, metadata] of knownTokens) {
            const key = tokenId.toString();
            map[key] = {
                symbol: metadata.symbol,
                name: metadata.name,
                decimals: Number(metadata.decimals),
                fee: Number(metadata.fee)
            };
        }
        for (const [tokenId, metadata] of whitelistedTokens) {
            const key = tokenId.toString();
            if (!map[key]) {
                map[key] = {
                    symbol: metadata.symbol,
                    name: metadata.name,
                    decimals: Number(metadata.decimals),
                    fee: Number(metadata.fee)
                };
            }
        }
        return map;
    }, [knownTokens, whitelistedTokens]);
    
    // Helper to get token display name
    const getTokenDisplay = (tokenId) => {
        const key = tokenId?.toString();
        if (!key) return { symbol: '?', name: 'Unknown', decimals: 8 };
        const meta = tokenMetadataMap[key];
        if (meta) {
            return meta;
        }
        // Fallback to shortened principal
        return { 
            symbol: `${key.slice(0, 5)}...`, 
            name: key,
            decimals: 8 
        };
    };
    
    const showInfo = (title, message, type = 'info') => {
        setInfoModal({ show: true, title, message, type });
    };
    
    const closeInfoModal = () => {
        setInfoModal({ ...infoModal, show: false });
    };
    
    const showConfirm = (title, message, onConfirm) => {
        setConfirmModal({ show: true, title, message, onConfirm });
    };
    
    const closeConfirmModal = () => {
        setConfirmModal({ ...confirmModal, show: false });
    };
    
    const toggleSection = (section) => {
        setExpandedSections(prev => ({
            ...prev,
            [section]: !prev[section]
        }));
    };
    
    const getRllActor = useCallback(() => {
        if (!identity) return null;
        return createRllActor(rllCanisterId, {
            agentOptions: { identity, host: 'https://ic0.app' }
        });
    }, [identity]);
    
    // Check if user is admin
    useEffect(() => {
        const checkAdmin = async () => {
            if (!isAuthenticated || !identity) {
                setAdminLoading(false);
                setTimeout(() => navigate('/admin'), 2000);
                return;
            }
            
            try {
                const actor = getRllActor();
                const isAdminResult = await actor.caller_is_admin();
                setIsAdmin(isAdminResult);
                
                if (!isAdminResult) {
                    setError('You do not have admin privileges for the RLL canister.');
                    setTimeout(() => navigate('/admin'), 2000);
                }
            } catch (err) {
                console.error('Error checking admin status:', err);
                setError('Error checking admin status: ' + err.message);
            } finally {
                setAdminLoading(false);
            }
        };
        
        checkAdmin();
    }, [isAuthenticated, identity, getRllActor, navigate]);
    
    // Fetch tokens on initial load (needed for metadata lookup)
    const fetchTokensInitial = useCallback(async () => {
        if (!isAdmin || tokensLoaded) return;
        
        try {
            const actor = getRllActor();
            const [known, whitelisted] = await Promise.all([
                actor.get_known_tokens(),
                actor.get_whitelisted_tokens()
            ]);
            setKnownTokens(known);
            setWhitelistedTokens(whitelisted);
            setTokensLoaded(true);
            
            // Fetch logos in background
            const logos = {};
            for (const [tokenId, metadata] of [...known, ...whitelisted]) {
                const tokenIdStr = tokenId.toString();
                if (!logos[tokenIdStr]) {
                    try {
                        const ledgerActor = createLedgerActor(tokenId, {
                            agentOptions: { identity }
                        });
                        const tokenMetadata = await ledgerActor.icrc1_metadata();
                        logos[tokenIdStr] = getTokenLogo(tokenMetadata);
                    } catch (e) {
                        logos[tokenIdStr] = '';
                    }
                }
            }
            setTokenLogos(logos);
        } catch (err) {
            console.error('Error fetching tokens:', err);
        }
    }, [isAdmin, tokensLoaded, getRllActor, identity]);
    
    // Fetch basic stats
    const fetchStats = useCallback(async () => {
        if (!isAdmin) return;
        
        setLoading(true);
        try {
            const actor = getRllActor();
            
            const [
                neurons,
                owners,
                props,
                balances,
                highestProp
            ] = await Promise.all([
                actor.imported_neurons_count(),
                actor.imported_owners_count(),
                actor.imported_props_count(),
                actor.balances_count(),
                actor.get_highest_closed_proposal_id()
            ]);
            
            setNeuronsCount(Number(neurons));
            setOwnersCount(Number(owners));
            setPropsCount(Number(props));
            setBalancesCount(Number(balances));
            setHighestProposalId(Number(highestProp));
        } catch (err) {
            console.error('Error fetching stats:', err);
            setError('Failed to fetch stats: ' + err.message);
        } finally {
            setLoading(false);
        }
    }, [isAdmin, getRllActor]);
    
    // Fetch main loop status
    const fetchMainLoopStatus = useCallback(async () => {
        if (!isAdmin) return;
        
        try {
            const actor = getRllActor();
            const status = await actor.get_main_loop_status();
            setMainLoopStatus(status);
        } catch (err) {
            console.error('Error fetching main loop status:', err);
        }
    }, [isAdmin, getRllActor]);
    
    // Fetch distribution cycle status (import stage, balance checks, import statuses)
    const fetchCycleStatus = useCallback(async () => {
        if (!isAdmin) return;
        
        try {
            const actor = getRllActor();
            const [stage, tokenCheck, walletCheck, neuronStatus, proposalStatus] = await Promise.all([
                actor.get_import_stage(),
                actor.get_token_balance_check_status(),
                actor.get_wallet_token_check_status(),
                actor.get_neuron_import_status(),
                actor.get_proposal_import_status()
            ]);
            
            setImportStage(stage);
            setTokenCheckStatus(tokenCheck);
            setWalletTokenCheckStatus(walletCheck);
            setNeuronImportStatus(neuronStatus);
            setProposalImportStatus(proposalStatus);
        } catch (err) {
            console.error('Error fetching cycle status:', err);
        }
    }, [isAdmin, getRllActor]);
    
    // Fetch admins
    const fetchAdmins = useCallback(async () => {
        if (!isAdmin) return;
        
        try {
            const actor = getRllActor();
            const adminList = await actor.list_admins();
            setAdmins(adminList);
        } catch (err) {
            console.error('Error fetching admins:', err);
        }
    }, [isAdmin, getRllActor]);
    
    // Initial data fetch
    useEffect(() => {
        if (isAdmin) {
            fetchStats();
            fetchMainLoopStatus();
            fetchCycleStatus();
            fetchAdmins();
            fetchTokensInitial();
        }
    }, [isAdmin, fetchStats, fetchMainLoopStatus, fetchCycleStatus, fetchAdmins, fetchTokensInitial]);
    
    // Auto-poll cycle status when distribution is active (every 5s), slower when idle (every 30s)
    useEffect(() => {
        if (!isAdmin) return;
        
        const isActive = importStage && !importStage.includes('idle');
        const intervalMs = isActive ? 5000 : 30000;
        
        const intervalId = setInterval(() => {
            fetchCycleStatus();
            if (isActive) {
                fetchMainLoopStatus();
                fetchStats();
            }
        }, intervalMs);
        
        return () => clearInterval(intervalId);
    }, [isAdmin, importStage, fetchCycleStatus, fetchMainLoopStatus, fetchStats]);
    
    // Toggle main loop
    const handleToggleMainLoop = async () => {
        setTogglingMainLoop(true);
        try {
            const actor = getRllActor();
            
            if (mainLoopStatus?.is_running) {
                await actor.stop_rll_main_loop();
                showInfo('Success', 'Main loop stopped successfully.', 'success');
            } else {
                await actor.start_rll_main_loop();
                showInfo('Success', 'Main loop started successfully.', 'success');
            }
            
            await fetchMainLoopStatus();
        } catch (err) {
            console.error('Error toggling main loop:', err);
            showInfo('Error', 'Failed to toggle main loop: ' + err.message, 'error');
        } finally {
            setTogglingMainLoop(false);
        }
    };
    
    // Fetch token balances
    const fetchTokenBalances = async () => {
        setLoadingBalances(true);
        try {
            const actor = getRllActor();
            const balances = await actor.all_token_balances();
            setTokenBalances(balances);
        } catch (err) {
            console.error('Error fetching token balances:', err);
            showInfo('Error', 'Failed to fetch token balances: ' + err.message, 'error');
        } finally {
            setLoadingBalances(false);
        }
    };
    
    // Fetch reconciliation
    const fetchReconciliation = async () => {
        setLoadingReconciliation(true);
        try {
            const actor = getRllActor();
            const recon = await actor.balance_reconciliation();
            setReconciliation(recon);
        } catch (err) {
            console.error('Error fetching reconciliation:', err);
            showInfo('Error', 'Failed to fetch reconciliation: ' + err.message, 'error');
        } finally {
            setLoadingReconciliation(false);
        }
    };
    
    // Lookup user/owner balances
    const handleLookupUserBalances = async () => {
        if (!userBalanceLookup.trim()) {
            showInfo('Error', 'Please enter a principal ID', 'error');
            return;
        }
        
        let principal;
        try {
            principal = Principal.fromText(userBalanceLookup.trim());
        } catch (err) {
            showInfo('Error', 'Invalid principal ID format', 'error');
            return;
        }
        
        setLoadingUserBalances(true);
        try {
            const actor = getRllActor();
            const distributions = await actor.get_user_distributions(principal);
            setUserBalances(distributions);
        } catch (err) {
            console.error('Error fetching user balances:', err);
            showInfo('Error', 'Failed to fetch user balances: ' + err.message, 'error');
        } finally {
            setLoadingUserBalances(false);
        }
    };
    
    // Fetch all user balances
    const fetchAllUserBalances = async () => {
        setLoadingAllUserBalances(true);
        try {
            const actor = getRllActor();
            const balances = await actor.get_all_user_balances();
            setAllUserBalances(balances);
            setUserBalancesPage(1);
        } catch (err) {
            console.error('Error fetching all user balances:', err);
            showInfo('Error', 'Failed to fetch all user balances: ' + err.message, 'error');
        } finally {
            setLoadingAllUserBalances(false);
        }
    };
    
    // Fetch neuron statistics
    const fetchNeuronStats = async () => {
        setLoadingNeuronStats(true);
        try {
            const actor = getRllActor();
            const stats = await actor.get_neuron_statistics();
            setNeuronStats(stats);
        } catch (err) {
            console.error('Error fetching neuron stats:', err);
            showInfo('Error', 'Failed to fetch neuron statistics: ' + err.message, 'error');
        } finally {
            setLoadingNeuronStats(false);
        }
    };
    
    // Fetch event statistics
    const fetchEventStats = async () => {
        setLoadingEventStats(true);
        try {
            const actor = getRllActor();
            const stats = await actor.get_event_statistics();
            setEventStats(stats);
        } catch (err) {
            console.error('Error fetching event stats:', err);
            showInfo('Error', 'Failed to fetch event statistics: ' + err.message, 'error');
        } finally {
            setLoadingEventStats(false);
        }
    };
    
    // Fetch distribution events
    const fetchDistributionEvents = async () => {
        setLoadingDistributions(true);
        try {
            const actor = getRllActor();
            const events = await actor.get_distribution_events();
            setDistributionEvents(events);
            setDistributionPage(1); // Reset to first page
        } catch (err) {
            console.error('Error fetching distribution events:', err);
            showInfo('Error', 'Failed to fetch distribution events: ' + err.message, 'error');
        } finally {
            setLoadingDistributions(false);
        }
    };
    
    // Fetch claim events
    const fetchClaimEvents = async () => {
        setLoadingClaims(true);
        try {
            const actor = getRllActor();
            const events = await actor.get_claim_events();
            setClaimEvents(events);
            setClaimPage(1); // Reset to first page
        } catch (err) {
            console.error('Error fetching claim events:', err);
            showInfo('Error', 'Failed to fetch claim events: ' + err.message, 'error');
        } finally {
            setLoadingClaims(false);
        }
    };
    
    // Fetch error claim events
    const fetchErrorClaimEvents = async () => {
        setLoadingErrorClaims(true);
        try {
            const actor = getRllActor();
            const result = await actor.get_error_claim_events();
            if ('ok' in result) {
                setErrorClaimEvents(result.ok);
            } else {
                showInfo('Error', result.err, 'error');
            }
        } catch (err) {
            console.error('Error fetching error claim events:', err);
            showInfo('Error', 'Failed to fetch error claim events: ' + err.message, 'error');
        } finally {
            setLoadingErrorClaims(false);
        }
    };
    
    // Fetch tokens (full refresh)
    const fetchTokens = async () => {
        setLoadingTokens(true);
        try {
            const actor = getRllActor();
            const [known, whitelisted] = await Promise.all([
                actor.get_known_tokens(),
                actor.get_whitelisted_tokens()
            ]);
            setKnownTokens(known);
            setWhitelistedTokens(whitelisted);
            
            // Fetch logos
            const logos = {};
            for (const [tokenId, metadata] of [...known, ...whitelisted]) {
                const tokenIdStr = tokenId.toString();
                if (!logos[tokenIdStr]) {
                    try {
                        const ledgerActor = createLedgerActor(tokenId, {
                            agentOptions: { identity }
                        });
                        const tokenMetadata = await ledgerActor.icrc1_metadata();
                        logos[tokenIdStr] = getTokenLogo(tokenMetadata);
                    } catch (e) {
                        logos[tokenIdStr] = '';
                    }
                }
            }
            setTokenLogos(logos);
        } catch (err) {
            console.error('Error fetching tokens:', err);
            showInfo('Error', 'Failed to fetch tokens: ' + err.message, 'error');
        } finally {
            setLoadingTokens(false);
        }
    };
    
    // Fetch distribution limits
    const fetchDistributionLimits = async () => {
        setLoadingDistLimits(true);
        try {
            const actor = getRllActor();
            const [mins, maxs, totals] = await Promise.all([
                actor.get_all_token_min_distributions(),
                actor.get_all_token_max_distributions(),
                actor.get_total_distributions()
            ]);
            setMinDistributions(mins);
            setMaxDistributions(maxs);
            setTotalDistributions(totals);
        } catch (err) {
            console.error('Error fetching distribution limits:', err);
            showInfo('Error', 'Failed to fetch distribution limits: ' + err.message, 'error');
        } finally {
            setLoadingDistLimits(false);
        }
    };
    
    // Import neurons
    const handleImportNeurons = async (importNew = false) => {
        setImporting(true);
        try {
            const actor = getRllActor();
            const result = importNew 
                ? await actor.import_all_new_neurons()
                : await actor.import_all_neurons();
            
            if ('ok' in result) {
                showInfo('Success', result.ok, 'success');
            } else {
                showInfo('Error', result.err, 'error');
            }
            
            await fetchStats();
        } catch (err) {
            console.error('Error importing neurons:', err);
            showInfo('Error', 'Failed to import neurons: ' + err.message, 'error');
        } finally {
            setImporting(false);
        }
    };
    
    // Import proposals
    const handleImportProposals = async (importNew = false) => {
        setImporting(true);
        try {
            const actor = getRllActor();
            const result = importNew 
                ? await actor.import_all_new_proposals()
                : await actor.import_all_proposals();
            
            if ('ok' in result) {
                showInfo('Success', result.ok, 'success');
            } else {
                showInfo('Error', result.err, 'error');
            }
            
            await fetchStats();
        } catch (err) {
            console.error('Error importing proposals:', err);
            showInfo('Error', 'Failed to import proposals: ' + err.message, 'error');
        } finally {
            setImporting(false);
        }
    };
    
    // Import whitelisted tokens
    const handleImportWhitelistedTokens = async () => {
        setImporting(true);
        try {
            const actor = getRllActor();
            await actor.import_whitelisted_tokens_from_swaprunner();
            showInfo('Success', 'Tokens imported from SwapRunner successfully.', 'success');
            await fetchTokens();
        } catch (err) {
            console.error('Error importing whitelisted tokens:', err);
            showInfo('Error', 'Failed to import tokens: ' + err.message, 'error');
        } finally {
            setImporting(false);
        }
    };
    
    // Start distribution cycle
    const handleStartDistributionCycle = async () => {
        try {
            const actor = getRllActor();
            const result = await actor.start_distribution_cycle();
            
            if ('ok' in result) {
                showInfo('Success', result.ok, 'success');
            } else {
                showInfo('Error', result.err, 'error');
            }
        } catch (err) {
            console.error('Error starting distribution cycle:', err);
            showInfo('Error', 'Failed to start distribution cycle: ' + err.message, 'error');
        }
    };
    
    // Add admin
    const handleAddAdmin = async () => {
        if (!newAdminPrincipal.trim()) return;
        
        setAddingAdmin(true);
        try {
            const principal = Principal.fromText(newAdminPrincipal.trim());
            const actor = getRllActor();
            const result = await actor.add_admin(principal);
            
            if ('ok' in result) {
                showInfo('Success', `Admin added: ${principal.toString()}`, 'success');
                setNewAdminPrincipal('');
                await fetchAdmins();
            } else {
                showInfo('Error', result.err, 'error');
            }
        } catch (err) {
            console.error('Error adding admin:', err);
            showInfo('Error', 'Invalid principal or failed to add admin: ' + err.message, 'error');
        } finally {
            setAddingAdmin(false);
        }
    };
    
    // Remove admin
    const handleRemoveAdmin = async (principal) => {
        showConfirm(
            'Remove Admin',
            `Are you sure you want to remove admin: ${principal.toString()}?`,
            async () => {
                closeConfirmModal();
                setRemovingAdmin(principal.toString());
                
                try {
                    const actor = getRllActor();
                    const result = await actor.remove_admin(principal);
                    
                    if ('ok' in result) {
                        showInfo('Success', 'Admin removed successfully.', 'success');
                        await fetchAdmins();
                    } else {
                        showInfo('Error', result.err, 'error');
                    }
                } catch (err) {
                    console.error('Error removing admin:', err);
                    showInfo('Error', 'Failed to remove admin: ' + err.message, 'error');
                } finally {
                    setRemovingAdmin(null);
                }
            }
        );
    };
    
    // Clear functions
    const handleClearBalances = async () => {
        showConfirm(
            'Clear All Balances',
            'This will clear ALL user balances. This action cannot be undone. Are you sure?',
            async () => {
                closeConfirmModal();
                try {
                    const actor = getRllActor();
                    await actor.clear_balances();
                    showInfo('Success', 'All balances cleared.', 'success');
                    await fetchStats();
                } catch (err) {
                    showInfo('Error', 'Failed to clear balances: ' + err.message, 'error');
                }
            }
        );
    };
    
    const handleClearClaimEvents = async () => {
        showConfirm(
            'Clear Claim Events',
            'This will clear all claim event history. Are you sure?',
            async () => {
                closeConfirmModal();
                try {
                    const actor = getRllActor();
                    await actor.clear_claim_events();
                    showInfo('Success', 'Claim events cleared.', 'success');
                    setClaimEvents([]);
                } catch (err) {
                    showInfo('Error', 'Failed to clear claim events: ' + err.message, 'error');
                }
            }
        );
    };
    
    const handleClearDistributionEvents = async () => {
        showConfirm(
            'Clear Distribution Events',
            'This will clear all distribution event history. Are you sure?',
            async () => {
                closeConfirmModal();
                try {
                    const actor = getRllActor();
                    await actor.clear_distribution_events();
                    showInfo('Success', 'Distribution events cleared.', 'success');
                    setDistributionEvents([]);
                } catch (err) {
                    showInfo('Error', 'Failed to clear distribution events: ' + err.message, 'error');
                }
            }
        );
    };
    
    // Format helpers
    const formatTimestamp = (timestamp) => {
        if (!timestamp) return 'N/A';
        const ts = typeof timestamp === 'bigint' ? Number(timestamp) : timestamp;
        // Handle nanoseconds vs milliseconds
        const ms = ts > 1e15 ? ts / 1e6 : ts > 1e12 ? ts : ts * 1000;
        return new Date(ms).toLocaleString();
    };
    
    const formatAmount = (amount, decimals = 8) => {
        if (!amount) return '0';
        const num = typeof amount === 'bigint' ? Number(amount) : amount;
        return (num / Math.pow(10, decimals)).toLocaleString(undefined, {
            minimumFractionDigits: 0,
            maximumFractionDigits: Math.min(decimals, 6)
        });
    };
    
    const shortenPrincipal = (principal) => {
        const str = principal.toString();
        if (str.length <= 15) return str;
        return `${str.slice(0, 8)}...${str.slice(-5)}`;
    };
    
    // Pagination helpers
    const getPaginatedData = (data, page) => {
        const start = (page - 1) * ITEMS_PER_PAGE;
        const end = start + ITEMS_PER_PAGE;
        return data.slice(start, end);
    };
    
    const getTotalPages = (data) => {
        return Math.ceil(data.length / ITEMS_PER_PAGE);
    };
    
    // Pagination component
    const Pagination = ({ currentPage, totalPages, onPageChange, totalItems }) => {
        if (totalPages <= 1) return null;
        
        return (
            <div style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                marginTop: '16px',
                padding: '12px 16px',
                backgroundColor: theme.colors.tertiaryBg,
                borderRadius: '8px',
                flexWrap: 'wrap',
                gap: '12px'
            }}>
                <span style={{ color: theme.colors.secondaryText, fontSize: '0.85rem' }}>
                    Showing {((currentPage - 1) * ITEMS_PER_PAGE) + 1} - {Math.min(currentPage * ITEMS_PER_PAGE, totalItems)} of {totalItems}
                </span>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <button
                        onClick={() => onPageChange(1)}
                        disabled={currentPage === 1}
                        style={{
                            padding: '6px 10px',
                            borderRadius: '6px',
                            border: `1px solid ${theme.colors.border}`,
                            backgroundColor: currentPage === 1 ? theme.colors.tertiaryBg : theme.colors.secondaryBg,
                            color: currentPage === 1 ? theme.colors.mutedText : theme.colors.primaryText,
                            cursor: currentPage === 1 ? 'not-allowed' : 'pointer',
                            fontSize: '0.85rem'
                        }}
                    >
                        First
                    </button>
                    <button
                        onClick={() => onPageChange(currentPage - 1)}
                        disabled={currentPage === 1}
                        style={{
                            padding: '6px 10px',
                            borderRadius: '6px',
                            border: `1px solid ${theme.colors.border}`,
                            backgroundColor: currentPage === 1 ? theme.colors.tertiaryBg : theme.colors.secondaryBg,
                            color: currentPage === 1 ? theme.colors.mutedText : theme.colors.primaryText,
                            cursor: currentPage === 1 ? 'not-allowed' : 'pointer',
                            display: 'flex',
                            alignItems: 'center'
                        }}
                    >
                        <FaChevronLeft size={12} />
                    </button>
                    <span style={{ 
                        padding: '6px 12px', 
                        color: theme.colors.primaryText,
                        fontWeight: '600'
                    }}>
                        Page {currentPage} of {totalPages}
                    </span>
                    <button
                        onClick={() => onPageChange(currentPage + 1)}
                        disabled={currentPage === totalPages}
                        style={{
                            padding: '6px 10px',
                            borderRadius: '6px',
                            border: `1px solid ${theme.colors.border}`,
                            backgroundColor: currentPage === totalPages ? theme.colors.tertiaryBg : theme.colors.secondaryBg,
                            color: currentPage === totalPages ? theme.colors.mutedText : theme.colors.primaryText,
                            cursor: currentPage === totalPages ? 'not-allowed' : 'pointer',
                            display: 'flex',
                            alignItems: 'center'
                        }}
                    >
                        <FaChevronRight size={12} />
                    </button>
                    <button
                        onClick={() => onPageChange(totalPages)}
                        disabled={currentPage === totalPages}
                        style={{
                            padding: '6px 10px',
                            borderRadius: '6px',
                            border: `1px solid ${theme.colors.border}`,
                            backgroundColor: currentPage === totalPages ? theme.colors.tertiaryBg : theme.colors.secondaryBg,
                            color: currentPage === totalPages ? theme.colors.mutedText : theme.colors.primaryText,
                            cursor: currentPage === totalPages ? 'not-allowed' : 'pointer',
                            fontSize: '0.85rem'
                        }}
                    >
                        Last
                    </button>
                </div>
            </div>
        );
    };
    
    // Token display component
    const TokenDisplay = ({ tokenId, showLogo = true }) => {
        const tokenIdStr = tokenId?.toString();
        const meta = getTokenDisplay(tokenId);
        const logo = tokenLogos[tokenIdStr];
        
        return (
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                {showLogo && (
                    <div style={{
                        width: '24px',
                        height: '24px',
                        borderRadius: '50%',
                        backgroundColor: theme.colors.tertiaryBg,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        overflow: 'hidden',
                        flexShrink: 0
                    }}>
                        {logo ? (
                            <img src={logo} alt={meta.symbol} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                        ) : (
                            <span style={{ fontSize: '0.7rem', color: theme.colors.secondaryText }}>{meta.symbol?.charAt(0) || '?'}</span>
                        )}
                    </div>
                )}
                <div>
                    <span style={{ fontWeight: '600', color: goldPrimary }}>{meta.symbol}</span>
                    {meta.name !== meta.symbol && (
                        <span style={{ color: theme.colors.secondaryText, fontSize: '0.8rem', marginLeft: '6px' }}>
                            ({meta.name})
                        </span>
                    )}
                </div>
            </div>
        );
    };
    
    // Filter and pair claim events (must be before any conditional returns)
    const processedClaimEvents = useMemo(() => {
        // First, filter by principal if filter is set
        let filtered = claimEvents;
        if (claimFilter.trim()) {
            const filterTrimmed = claimFilter.trim();
            const filterLower = filterTrimmed.toLowerCase();
            
            // Check if filter is a valid principal (exact match mode)
            let filterPrincipal = null;
            try {
                filterPrincipal = Principal.fromText(filterTrimmed);
            } catch (e) {
                // Not a valid principal, use partial matching
            }
            
            filtered = claimEvents.filter(event => {
                const hotkeyStr = event.hotkey?.toString() || '';
                
                // If filter is a valid principal, do exact match
                if (filterPrincipal) {
                    return hotkeyStr === filterPrincipal.toString();
                }
                
                // Otherwise do partial/contains match for searching
                return hotkeyStr.toLowerCase().includes(filterLower);
            });
        }
        
        // Sort by sequence number descending (newest first)
        const sorted = [...filtered].sort((a, b) => 
            Number(b.sequence_number) - Number(a.sequence_number)
        );
        
        // Pair pending + success events into single rows
        const paired = [];
        
        for (const event of sorted) {
            if ('Pending' in event.status) {
                // Check if we have a matching success for this pending
                const existingSuccess = paired.find(e => 
                    e.hotkey?.toString() === event.hotkey?.toString() &&
                    e.token_id?.toString() === event.token_id?.toString() &&
                    e.amount?.toString() === event.amount?.toString() &&
                    'Success' in e.status &&
                    !e._paired
                );
                
                if (existingSuccess) {
                    // Mark the success as paired and add pending info
                    existingSuccess._paired = true;
                    existingSuccess._pendingTimestamp = event.timestamp;
                    existingSuccess._pendingSeq = event.sequence_number;
                } else {
                    // No matching success, add pending as standalone
                    paired.push({ ...event });
                }
            } else if ('Success' in event.status) {
                // Check if there's a pending event that will come later
                paired.push({ ...event, _paired: false });
            } else {
                // Failed events - show as is
                paired.push({ ...event });
            }
        }
        
        return paired;
    }, [claimEvents, claimFilter]);
    
    // Filter all user balances (must be before any conditional returns)
    const filteredUserBalances = useMemo(() => {
        if (!userBalancesFilter.trim()) return allUserBalances;
        const filterTrimmed = userBalancesFilter.trim();
        const filterLower = filterTrimmed.toLowerCase();
        
        // Check if filter is a valid principal (exact match mode)
        let filterPrincipal = null;
        try {
            filterPrincipal = Principal.fromText(filterTrimmed);
        } catch (e) {
            // Not a valid principal, use partial matching
        }
        
        return allUserBalances.filter(([principal, _]) => {
            const principalStr = principal.toString();
            
            // If filter is a valid principal, do exact match
            if (filterPrincipal) {
                return principalStr === filterPrincipal.toString();
            }
            
            // Otherwise do partial/contains match
            return principalStr.toLowerCase().includes(filterLower);
        });
    }, [allUserBalances, userBalancesFilter]);
    
    const styles = {
        container: {
            maxWidth: '1400px',
            margin: '0 auto',
            padding: '20px',
        },
        header: {
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: '30px',
            flexWrap: 'wrap',
            gap: '15px',
        },
        title: {
            color: theme.colors.primaryText,
            margin: 0,
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
        },
        titleIcon: {
            color: goldPrimary,
            fontSize: '1.5rem',
        },
        section: {
            backgroundColor: theme.colors.secondaryBg,
            borderRadius: '12px',
            marginBottom: '20px',
            border: `1px solid ${theme.colors.border}`,
            overflow: 'hidden',
        },
        sectionHeader: {
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            padding: '16px 20px',
            cursor: 'pointer',
            borderBottom: `1px solid ${theme.colors.border}`,
            transition: 'background-color 0.2s ease',
        },
        sectionTitle: {
            color: theme.colors.primaryText,
            fontSize: '1.1rem',
            fontWeight: '600',
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
            margin: 0,
        },
        sectionIcon: {
            color: goldPrimary,
        },
        sectionContent: {
            padding: '20px',
        },
        statsGrid: {
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
            gap: '16px',
        },
        statCard: {
            backgroundColor: theme.colors.tertiaryBg,
            borderRadius: '10px',
            padding: '16px',
            border: `1px solid ${theme.colors.border}`,
            textAlign: 'center',
        },
        statValue: {
            fontSize: '1.8rem',
            fontWeight: '700',
            color: goldPrimary,
            marginBottom: '4px',
        },
        statLabel: {
            color: theme.colors.secondaryText,
            fontSize: '0.85rem',
        },
        button: {
            padding: '10px 18px',
            borderRadius: '8px',
            border: 'none',
            cursor: 'pointer',
            fontWeight: '600',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            transition: 'all 0.2s ease',
            fontSize: '0.9rem',
        },
        primaryButton: {
            backgroundColor: goldPrimary,
            color: '#000',
        },
        secondaryButton: {
            backgroundColor: theme.colors.tertiaryBg,
            color: theme.colors.primaryText,
            border: `1px solid ${theme.colors.border}`,
        },
        dangerButton: {
            backgroundColor: '#e74c3c',
            color: '#fff',
        },
        successButton: {
            backgroundColor: '#2ecc71',
            color: '#fff',
        },
        buttonGroup: {
            display: 'flex',
            flexWrap: 'wrap',
            gap: '10px',
            marginTop: '16px',
        },
        input: {
            padding: '12px 16px',
            borderRadius: '8px',
            border: `1px solid ${theme.colors.border}`,
            backgroundColor: theme.colors.primaryBg,
            color: theme.colors.primaryText,
            fontSize: '0.95rem',
            width: '100%',
            outline: 'none',
        },
        table: {
            width: '100%',
            borderCollapse: 'collapse',
        },
        tableHead: {
            backgroundColor: theme.colors.tertiaryBg,
        },
        th: {
            padding: '12px 16px',
            textAlign: 'left',
            color: theme.colors.secondaryText,
            fontSize: '0.85rem',
            fontWeight: '600',
            borderBottom: `1px solid ${theme.colors.border}`,
        },
        td: {
            padding: '12px 16px',
            borderBottom: `1px solid ${theme.colors.border}`,
            color: theme.colors.primaryText,
            fontSize: '0.9rem',
        },
        statusBadge: {
            padding: '4px 10px',
            borderRadius: '12px',
            fontSize: '0.8rem',
            fontWeight: '600',
            display: 'inline-flex',
            alignItems: 'center',
            gap: '4px',
        },
        statusRunning: {
            backgroundColor: 'rgba(46, 204, 113, 0.15)',
            color: '#2ecc71',
        },
        statusStopped: {
            backgroundColor: 'rgba(231, 76, 60, 0.15)',
            color: '#e74c3c',
        },
        statusPending: {
            backgroundColor: 'rgba(241, 196, 15, 0.15)',
            color: '#f1c40f',
        },
        statusSuccess: {
            backgroundColor: 'rgba(46, 204, 113, 0.15)',
            color: '#2ecc71',
        },
        statusFailed: {
            backgroundColor: 'rgba(231, 76, 60, 0.15)',
            color: '#e74c3c',
        },
        tokenLogo: {
            width: '28px',
            height: '28px',
            borderRadius: '50%',
            backgroundColor: theme.colors.primaryBg,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            overflow: 'hidden',
            flexShrink: 0,
        },
        emptyState: {
            textAlign: 'center',
            padding: '40px',
            color: theme.colors.secondaryText,
        },
        loadingOverlay: {
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '40px',
            color: theme.colors.secondaryText,
        },
        infoRow: {
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            padding: '10px 0',
            borderBottom: `1px solid ${theme.colors.border}`,
        },
        infoLabel: {
            color: theme.colors.secondaryText,
            fontSize: '0.9rem',
        },
        infoValue: {
            color: theme.colors.primaryText,
            fontWeight: '500',
            fontFamily: 'monospace',
        },
        subSection: {
            marginTop: '20px',
            paddingTop: '20px',
            borderTop: `1px solid ${theme.colors.border}`,
        },
        subSectionTitle: {
            color: theme.colors.primaryText,
            fontSize: '1rem',
            fontWeight: '600',
            marginBottom: '12px',
        },
        helpText: {
            backgroundColor: theme.colors.tertiaryBg,
            padding: '12px 16px',
            borderRadius: '8px',
            marginBottom: '16px',
            display: 'flex',
            alignItems: 'flex-start',
            gap: '10px',
        },
        helpIcon: {
            color: goldPrimary,
            flexShrink: 0,
            marginTop: '2px',
        },
        helpContent: {
            color: theme.colors.secondaryText,
            fontSize: '0.9rem',
            lineHeight: '1.5',
        },
    };

    if (adminLoading) {
        return (
            <div className='page-container'>
                <Header />
                <main className="wallet-container">
                    <div style={styles.loadingOverlay}>
                        <FaSpinner className="spin" style={{ fontSize: '2rem', marginRight: '12px' }} />
                        <span>Checking admin status...</span>
                    </div>
                </main>
            </div>
        );
    }

    if (error && !isAdmin) {
        return (
            <div className='page-container'>
                <Header />
                <main className="wallet-container">
                    <div style={{
                        backgroundColor: 'rgba(231, 76, 60, 0.1)',
                        border: '1px solid #e74c3c',
                        color: '#e74c3c',
                        padding: '20px',
                        borderRadius: '8px',
                        textAlign: 'center',
                    }}>
                        {error}
                    </div>
                </main>
            </div>
        );
    }

    if (!isAdmin) {
        return null;
    }

    // Paginated data (computed from memoized values above)
    const paginatedDistributions = getPaginatedData(distributionEvents, distributionPage);
    const distributionTotalPages = getTotalPages(distributionEvents);
    const paginatedClaims = getPaginatedData(processedClaimEvents, claimPage);
    const claimTotalPages = getTotalPages(processedClaimEvents);
    const paginatedUserBalances = getPaginatedData(filteredUserBalances, userBalancesPage);
    const userBalancesTotalPages = getTotalPages(filteredUserBalances);

    return (
        <div className='page-container'>
            <Header />
            <main className="wallet-container">
                <div style={styles.container}>
                    <div style={styles.header}>
                        <h1 style={styles.title}>
                            <FaCoins style={styles.titleIcon} />
                            Rewards (RLL) Administration
                        </h1>
                        <button
                            onClick={() => {
                                fetchStats();
                                fetchMainLoopStatus();
                            }}
                            style={{ ...styles.button, ...styles.secondaryButton }}
                            disabled={loading}
                        >
                            <FaSync className={loading ? 'spin' : ''} /> Refresh All
                        </button>
                    </div>

                    {/* Main Loop Status */}
                    <div style={styles.section}>
                        <div 
                            style={styles.sectionHeader}
                            onClick={() => toggleSection('mainLoop')}
                        >
                            <h2 style={styles.sectionTitle}>
                                <FaCog style={styles.sectionIcon} />
                                Main Loop Status
                            </h2>
                            {expandedSections.mainLoop ? <FaChevronUp /> : <FaChevronDown />}
                        </div>
                        {expandedSections.mainLoop && (
                            <div style={styles.sectionContent}>
                                {mainLoopStatus ? (
                                    <>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '16px', marginBottom: '20px' }}>
                                            <span style={{
                                                ...styles.statusBadge,
                                                ...(mainLoopStatus.is_running ? styles.statusRunning : styles.statusStopped)
                                            }}>
                                                {mainLoopStatus.is_running ? (
                                                    <><FaCheckCircle /> Running</>
                                                ) : (
                                                    <><FaTimes /> Stopped</>
                                                )}
                                            </span>
                                            <button
                                                onClick={handleToggleMainLoop}
                                                style={{
                                                    ...styles.button,
                                                    ...(mainLoopStatus.is_running ? styles.dangerButton : styles.successButton)
                                                }}
                                                disabled={togglingMainLoop}
                                            >
                                                {togglingMainLoop ? (
                                                    <FaSpinner className="spin" />
                                                ) : mainLoopStatus.is_running ? (
                                                    <><FaStop /> Stop Main Loop</>
                                                ) : (
                                                    <><FaPlay /> Start Main Loop</>
                                                )}
                                            </button>
                                        </div>
                                        <div style={styles.statsGrid}>
                                            <div style={styles.statCard}>
                                                <div style={styles.statValue}>{mainLoopStatus.frequency_seconds?.toString() || '0'}s</div>
                                                <div style={styles.statLabel}>Frequency</div>
                                            </div>
                                            <div style={styles.statCard}>
                                                <div style={{ ...styles.statValue, fontSize: '0.9rem' }}>
                                                    {mainLoopStatus.last_cycle_started?.[0] 
                                                        ? formatTimestamp(mainLoopStatus.last_cycle_started[0])
                                                        : 'Never'}
                                                </div>
                                                <div style={styles.statLabel}>Last Cycle Started</div>
                                            </div>
                                            <div style={styles.statCard}>
                                                <div style={{ ...styles.statValue, fontSize: '0.9rem' }}>
                                                    {mainLoopStatus.last_cycle_ended?.[0]
                                                        ? formatTimestamp(mainLoopStatus.last_cycle_ended[0])
                                                        : 'Never'}
                                                </div>
                                                <div style={styles.statLabel}>Last Cycle Ended</div>
                                            </div>
                                            <div style={styles.statCard}>
                                                <div style={{ ...styles.statValue, fontSize: '0.9rem' }}>
                                                    {mainLoopStatus.next_scheduled?.[0]
                                                        ? formatTimestamp(mainLoopStatus.next_scheduled[0])
                                                        : 'N/A'}
                                                </div>
                                                <div style={styles.statLabel}>Next Scheduled</div>
                                            </div>
                                        </div>
                                        <div style={styles.buttonGroup}>
                                            <button
                                                onClick={handleStartDistributionCycle}
                                                style={{ ...styles.button, ...styles.primaryButton }}
                                            >
                                                <FaPlay /> Run Distribution Cycle Now
                                            </button>
                                        </div>
                                        
                                        {/* Distribution Cycle Live Status */}
                                        <div style={{ ...styles.subSection }}>
                                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
                                                <h3 style={{ ...styles.subSectionTitle, margin: 0, display: 'flex', alignItems: 'center', gap: '8px' }}>
                                                    <FaClock style={{ color: goldPrimary }} />
                                                    Distribution Cycle Status
                                                </h3>
                                                <button
                                                    onClick={fetchCycleStatus}
                                                    style={{ ...styles.button, ...styles.secondaryButton, padding: '4px 12px', fontSize: '0.8rem' }}
                                                >
                                                    <FaSync /> Refresh
                                                </button>
                                            </div>
                                            
                                            {/* Current Stage Badge */}
                                            <div style={{ marginBottom: '16px' }}>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                                                    <span style={styles.infoLabel}>Current Stage:</span>
                                                    <span style={{
                                                        ...styles.statusBadge,
                                                        ...(importStage.includes('idle') ? styles.statusPending : styles.statusRunning),
                                                        fontSize: '0.8rem',
                                                        padding: '4px 12px'
                                                    }}>
                                                        {importStage.includes('idle') ? (
                                                            <><FaClock /> Idle</>
                                                        ) : (
                                                            <><FaSpinner className="spin" /> Active</>
                                                        )}
                                                    </span>
                                                </div>
                                                {importStage && (
                                                    <div style={{ 
                                                        fontFamily: 'monospace', 
                                                        fontSize: '0.85rem', 
                                                        color: theme.colors.secondaryText,
                                                        background: theme.colors.tertiaryBg,
                                                        padding: '8px 12px',
                                                        borderRadius: '6px',
                                                        wordBreak: 'break-all'
                                                    }}>
                                                        {importStage}
                                                    </div>
                                                )}
                                            </div>
                                            
                                            {/* Stage Pipeline */}
                                            {importStage && !importStage.includes('idle') && (
                                                <div style={{ marginBottom: '20px' }}>
                                                    <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap', alignItems: 'center' }}>
                                                        {['importing whitelist', 'checking balances', 'importing neurons', 'importing proposals', 'distributing tokens'].map((step, idx, arr) => {
                                                            const stageText = importStage.toLowerCase();
                                                            const isActive = stageText.includes(step);
                                                            const stageOrder = ['importing whitelist', 'checking balances', 'importing neurons', 'importing proposals', 'distributing tokens'];
                                                            const currentIdx = stageOrder.findIndex(s => stageText.includes(s));
                                                            const stepIdx = stageOrder.indexOf(step);
                                                            const isCompleted = currentIdx > stepIdx;
                                                            return (
                                                                <React.Fragment key={step}>
                                                                    <span style={{
                                                                        padding: '6px 12px',
                                                                        borderRadius: '20px',
                                                                        fontSize: '0.75rem',
                                                                        fontWeight: '600',
                                                                        background: isActive ? `${goldPrimary}30` : isCompleted ? 'rgba(46, 204, 113, 0.15)' : theme.colors.tertiaryBg,
                                                                        color: isActive ? goldPrimary : isCompleted ? '#2ecc71' : theme.colors.secondaryText,
                                                                        border: `1px solid ${isActive ? goldPrimary + '50' : isCompleted ? '#2ecc7130' : theme.colors.border}`,
                                                                        display: 'flex',
                                                                        alignItems: 'center',
                                                                        gap: '4px',
                                                                        whiteSpace: 'nowrap'
                                                                    }}>
                                                                        {isCompleted ? <FaCheckCircle size={10} /> : isActive ? <FaSpinner className="spin" size={10} /> : null}
                                                                        {step.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')}
                                                                    </span>
                                                                    {idx < arr.length - 1 && (
                                                                        <span style={{ color: theme.colors.secondaryText, fontSize: '0.7rem' }}>→</span>
                                                                    )}
                                                                </React.Fragment>
                                                            );
                                                        })}
                                                    </div>
                                                </div>
                                            )}
                                            
                                            {/* Token Balance Check Progress */}
                                            {tokenCheckStatus && (tokenCheckStatus.is_running || Number(tokenCheckStatus.total) > 0) && (
                                                <div style={{ marginBottom: '16px', padding: '12px', background: theme.colors.tertiaryBg, borderRadius: '8px' }}>
                                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                                                        <span style={{ fontSize: '0.9rem', fontWeight: '600', color: theme.colors.primaryText, display: 'flex', alignItems: 'center', gap: '6px' }}>
                                                            {tokenCheckStatus.is_running ? <FaSpinner className="spin" size={12} style={{ color: goldPrimary }} /> : <FaCheckCircle size={12} style={{ color: '#2ecc71' }} />}
                                                            Canister Token Balance Check
                                                        </span>
                                                        <span style={{ fontFamily: 'monospace', fontSize: '0.85rem', color: goldPrimary, fontWeight: '600' }}>
                                                            {Number(tokenCheckStatus.processed)} / {Number(tokenCheckStatus.total)}
                                                        </span>
                                                    </div>
                                                    <div style={{
                                                        width: '100%',
                                                        height: '8px',
                                                        background: theme.colors.primaryBg,
                                                        borderRadius: '4px',
                                                        overflow: 'hidden'
                                                    }}>
                                                        <div style={{
                                                            width: Number(tokenCheckStatus.total) > 0 
                                                                ? `${(Number(tokenCheckStatus.processed) / Number(tokenCheckStatus.total)) * 100}%` 
                                                                : '0%',
                                                            height: '100%',
                                                            background: tokenCheckStatus.is_running 
                                                                ? `linear-gradient(90deg, ${goldPrimary}, ${goldLight})` 
                                                                : '#2ecc71',
                                                            borderRadius: '4px',
                                                            transition: 'width 0.5s ease'
                                                        }} />
                                                    </div>
                                                    <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '4px' }}>
                                                        <span style={{ fontSize: '0.75rem', color: theme.colors.secondaryText }}>
                                                            {tokenCheckStatus.is_running ? 'In progress...' : 'Complete'}
                                                        </span>
                                                        <span style={{ fontSize: '0.75rem', color: theme.colors.secondaryText }}>
                                                            {Number(tokenCheckStatus.ticks)} ticks
                                                            {Number(tokenCheckStatus.total) > 0 && ` · ${Math.round((Number(tokenCheckStatus.processed) / Number(tokenCheckStatus.total)) * 100)}%`}
                                                        </span>
                                                    </div>
                                                </div>
                                            )}
                                            
                                            {/* Wallet Token Check Progress */}
                                            {walletTokenCheckStatus && (walletTokenCheckStatus.is_running || Number(walletTokenCheckStatus.total) > 0) && (
                                                <div style={{ marginBottom: '16px', padding: '12px', background: theme.colors.tertiaryBg, borderRadius: '8px' }}>
                                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                                                        <span style={{ fontSize: '0.9rem', fontWeight: '600', color: theme.colors.primaryText, display: 'flex', alignItems: 'center', gap: '6px' }}>
                                                            {walletTokenCheckStatus.is_running ? <FaSpinner className="spin" size={12} style={{ color: goldPrimary }} /> : <FaCheckCircle size={12} style={{ color: '#2ecc71' }} />}
                                                            Wallet Token Balance Check
                                                            {walletTokenCheckStatus.wallet?.[0] && (
                                                                <span style={{ fontFamily: 'monospace', fontSize: '0.75rem', color: theme.colors.secondaryText }}>
                                                                    ({walletTokenCheckStatus.wallet[0].toString().slice(0, 12)}...)
                                                                </span>
                                                            )}
                                                        </span>
                                                        <span style={{ fontFamily: 'monospace', fontSize: '0.85rem', color: goldPrimary, fontWeight: '600' }}>
                                                            {Number(walletTokenCheckStatus.processed)} / {Number(walletTokenCheckStatus.total)}
                                                        </span>
                                                    </div>
                                                    <div style={{
                                                        width: '100%',
                                                        height: '8px',
                                                        background: theme.colors.primaryBg,
                                                        borderRadius: '4px',
                                                        overflow: 'hidden'
                                                    }}>
                                                        <div style={{
                                                            width: Number(walletTokenCheckStatus.total) > 0 
                                                                ? `${(Number(walletTokenCheckStatus.processed) / Number(walletTokenCheckStatus.total)) * 100}%` 
                                                                : '0%',
                                                            height: '100%',
                                                            background: walletTokenCheckStatus.is_running 
                                                                ? `linear-gradient(90deg, ${goldPrimary}, ${goldLight})` 
                                                                : '#2ecc71',
                                                            borderRadius: '4px',
                                                            transition: 'width 0.5s ease'
                                                        }} />
                                                    </div>
                                                    <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '4px' }}>
                                                        <span style={{ fontSize: '0.75rem', color: theme.colors.secondaryText }}>
                                                            {walletTokenCheckStatus.is_running ? 'In progress...' : 'Complete'}
                                                        </span>
                                                        <span style={{ fontSize: '0.75rem', color: theme.colors.secondaryText }}>
                                                            {Number(walletTokenCheckStatus.ticks)} ticks
                                                            {Number(walletTokenCheckStatus.total) > 0 && ` · ${Math.round((Number(walletTokenCheckStatus.processed) / Number(walletTokenCheckStatus.total)) * 100)}%`}
                                                        </span>
                                                    </div>
                                                </div>
                                            )}
                                            
                                            {/* Distribution Token Progress (parsed from import stage string) */}
                                            {importStage && importStage.includes('distributing tokens') && importStage.includes('/') && (
                                                <div style={{ marginBottom: '16px', padding: '12px', background: theme.colors.tertiaryBg, borderRadius: '8px' }}>
                                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                                                        <span style={{ fontSize: '0.9rem', fontWeight: '600', color: theme.colors.primaryText, display: 'flex', alignItems: 'center', gap: '6px' }}>
                                                            <FaSpinner className="spin" size={12} style={{ color: goldPrimary }} />
                                                            Token Distribution
                                                        </span>
                                                        <span style={{ fontFamily: 'monospace', fontSize: '0.85rem', color: goldPrimary, fontWeight: '600' }}>
                                                            {(() => {
                                                                const match = importStage.match(/(\d+)\/(\d+)/);
                                                                return match ? `${match[1]} / ${match[2]}` : '';
                                                            })()}
                                                        </span>
                                                    </div>
                                                    <div style={{
                                                        width: '100%',
                                                        height: '8px',
                                                        background: theme.colors.primaryBg,
                                                        borderRadius: '4px',
                                                        overflow: 'hidden'
                                                    }}>
                                                        <div style={{
                                                            width: (() => {
                                                                const match = importStage.match(/(\d+)\/(\d+)/);
                                                                if (match) {
                                                                    const pct = (parseInt(match[1]) / parseInt(match[2])) * 100;
                                                                    return `${Math.min(pct, 100)}%`;
                                                                }
                                                                return '0%';
                                                            })(),
                                                            height: '100%',
                                                            background: `linear-gradient(90deg, ${goldPrimary}, ${goldLight})`,
                                                            borderRadius: '4px',
                                                            transition: 'width 0.5s ease'
                                                        }} />
                                                    </div>
                                                    {/* Show which token is being processed */}
                                                    {importStage.includes('processing') && (
                                                        <div style={{ marginTop: '6px', fontSize: '0.75rem', color: theme.colors.secondaryText }}>
                                                            <span>Processing: </span>
                                                            <span style={{ fontFamily: 'monospace' }}>
                                                                {(() => {
                                                                    const match = importStage.match(/processing\s+([a-z0-9-]+)/i);
                                                                    return match ? match[1].slice(0, 16) + '...' : '';
                                                                })()}
                                                            </span>
                                                        </div>
                                                    )}
                                                </div>
                                            )}
                                            
                                            {/* Import Statuses */}
                                            <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
                                                {neuronImportStatus && (
                                                    <div style={{ 
                                                        flex: '1', 
                                                        minWidth: '180px',
                                                        padding: '10px 14px', 
                                                        background: theme.colors.tertiaryBg, 
                                                        borderRadius: '8px',
                                                        display: 'flex',
                                                        alignItems: 'center',
                                                        gap: '8px'
                                                    }}>
                                                        <FaDatabase size={14} style={{ color: goldPrimary, flexShrink: 0 }} />
                                                        <div>
                                                            <div style={{ fontSize: '0.75rem', color: theme.colors.secondaryText }}>Neuron Import</div>
                                                            <div style={{ fontSize: '0.85rem', fontWeight: '600', color: theme.colors.primaryText }}>
                                                                {'ok' in neuronImportStatus 
                                                                    ? (neuronImportStatus.ok.includes('running') 
                                                                        ? <span style={{ color: '#2ecc71' }}>Running</span> 
                                                                        : <span style={{ color: theme.colors.secondaryText }}>Idle</span>)
                                                                    : <span style={{ color: '#e74c3c' }}>Error</span>
                                                                }
                                                            </div>
                                                        </div>
                                                    </div>
                                                )}
                                                {proposalImportStatus && (
                                                    <div style={{ 
                                                        flex: '1', 
                                                        minWidth: '180px',
                                                        padding: '10px 14px', 
                                                        background: theme.colors.tertiaryBg, 
                                                        borderRadius: '8px',
                                                        display: 'flex',
                                                        alignItems: 'center',
                                                        gap: '8px'
                                                    }}>
                                                        <FaFileImport size={14} style={{ color: goldPrimary, flexShrink: 0 }} />
                                                        <div>
                                                            <div style={{ fontSize: '0.75rem', color: theme.colors.secondaryText }}>Proposal Import</div>
                                                            <div style={{ fontSize: '0.85rem', fontWeight: '600', color: theme.colors.primaryText }}>
                                                                {'ok' in proposalImportStatus 
                                                                    ? (proposalImportStatus.ok.includes('running') 
                                                                        ? <span style={{ color: '#2ecc71' }}>Running</span> 
                                                                        : <span style={{ color: theme.colors.secondaryText }}>Idle</span>)
                                                                    : <span style={{ color: '#e74c3c' }}>Error</span>
                                                                }
                                                            </div>
                                                        </div>
                                                    </div>
                                                )}
                                            </div>
                                            
                                            {/* Idle state message */}
                                            {(!importStage || importStage.includes('idle')) && 
                                             !tokenCheckStatus?.is_running && 
                                             !walletTokenCheckStatus?.is_running && (
                                                <div style={{ 
                                                    textAlign: 'center', 
                                                    padding: '20px', 
                                                    color: theme.colors.secondaryText,
                                                    fontSize: '0.9rem'
                                                }}>
                                                    <FaClock size={24} style={{ color: theme.colors.secondaryText, opacity: 0.5, marginBottom: '8px', display: 'block', margin: '0 auto 8px' }} />
                                                    No distribution cycle currently running.
                                                    {mainLoopStatus?.next_scheduled?.[0] && (
                                                        <div style={{ marginTop: '4px', fontSize: '0.8rem' }}>
                                                            Next scheduled: {formatTimestamp(mainLoopStatus.next_scheduled[0])}
                                                        </div>
                                                    )}
                                                </div>
                                            )}
                                        </div>
                                    </>
                                ) : (
                                    <div style={styles.loadingOverlay}>
                                        <FaSpinner className="spin" /> Loading...
                                    </div>
                                )}
                            </div>
                        )}
                    </div>

                    {/* Overview Stats */}
                    <div style={styles.section}>
                        <div 
                            style={styles.sectionHeader}
                            onClick={() => toggleSection('stats')}
                        >
                            <h2 style={styles.sectionTitle}>
                                <FaChartBar style={styles.sectionIcon} />
                                Overview Statistics
                            </h2>
                            {expandedSections.stats ? <FaChevronUp /> : <FaChevronDown />}
                        </div>
                        {expandedSections.stats && (
                            <div style={styles.sectionContent}>
                                <div style={styles.statsGrid}>
                                    <div style={styles.statCard}>
                                        <div style={styles.statValue}>{neuronsCount.toLocaleString()}</div>
                                        <div style={styles.statLabel}>Imported Neurons</div>
                                    </div>
                                    <div style={styles.statCard}>
                                        <div style={styles.statValue}>{ownersCount.toLocaleString()}</div>
                                        <div style={styles.statLabel}>Unique Owners</div>
                                    </div>
                                    <div style={styles.statCard}>
                                        <div style={styles.statValue}>{propsCount.toLocaleString()}</div>
                                        <div style={styles.statLabel}>Imported Proposals</div>
                                    </div>
                                    <div style={styles.statCard}>
                                        <div style={styles.statValue}>{balancesCount.toLocaleString()}</div>
                                        <div style={styles.statLabel}>Balance Entries</div>
                                    </div>
                                    <div style={styles.statCard}>
                                        <div style={styles.statValue}>{highestProposalId.toLocaleString()}</div>
                                        <div style={styles.statLabel}>Highest Closed Proposal</div>
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>

                    {/* Token Balances & Reconciliation */}
                    <div style={styles.section}>
                        <div 
                            style={styles.sectionHeader}
                            onClick={() => toggleSection('balances')}
                        >
                            <h2 style={styles.sectionTitle}>
                                <FaBalanceScale style={styles.sectionIcon} />
                                Token Balances & Reconciliation
                            </h2>
                            {expandedSections.balances ? <FaChevronUp /> : <FaChevronDown />}
                        </div>
                        {expandedSections.balances && (
                            <div style={styles.sectionContent}>
                                <div style={styles.helpText}>
                                    <FaInfoCircle style={styles.helpIcon} />
                                    <div style={styles.helpContent}>
                                        <strong>What does reconciliation do?</strong><br />
                                        Reconciliation compares the <em>local balance records</em> (what the RLL canister tracks as owed to users) 
                                        against the <em>actual token balances</em> held by the RLL canister on each token's ledger. 
                                        This helps identify discrepancies:
                                        <ul style={{ margin: '8px 0 0 0', paddingLeft: '20px' }}>
                                            <li><strong>Remaining:</strong> Tokens in the canister not yet allocated to users (available for distribution)</li>
                                            <li><strong>Underflow:</strong> If positive, indicates the canister owes more than it holds (potential issue)</li>
                                        </ul>
                                    </div>
                                </div>
                                
                                <div style={styles.buttonGroup}>
                                    <button
                                        onClick={fetchTokenBalances}
                                        style={{ ...styles.button, ...styles.secondaryButton }}
                                        disabled={loadingBalances}
                                    >
                                        {loadingBalances ? <FaSpinner className="spin" /> : <FaSync />}
                                        Load Token Balances
                                    </button>
                                    <button
                                        onClick={fetchReconciliation}
                                        style={{ ...styles.button, ...styles.secondaryButton }}
                                        disabled={loadingReconciliation}
                                    >
                                        {loadingReconciliation ? <FaSpinner className="spin" /> : <FaBalanceScale />}
                                        Run Reconciliation
                                    </button>
                                </div>
                                
                                {tokenBalances.length > 0 && (
                                    <div style={styles.subSection}>
                                        <h3 style={styles.subSectionTitle}>Token Balances (Total Owed to Users)</h3>
                                        <div style={{ overflowX: 'auto' }}>
                                            <table style={styles.table}>
                                                <thead style={styles.tableHead}>
                                                    <tr>
                                                        <th style={styles.th}>Token</th>
                                                        <th style={styles.th}>Total Owed</th>
                                                        <th style={styles.th}>Ledger ID</th>
                                                    </tr>
                                                </thead>
                                                <tbody>
                                                    {tokenBalances.map(([tokenId, balance]) => {
                                                        const meta = getTokenDisplay(tokenId);
                                                        return (
                                                            <tr key={tokenId.toString()}>
                                                                <td style={styles.td}>
                                                                    <TokenDisplay tokenId={tokenId} />
                                                                </td>
                                                                <td style={styles.td}>
                                                                    <span style={{ color: goldPrimary, fontWeight: '600' }}>
                                                                        {formatAmount(balance, meta.decimals)} {meta.symbol}
                                                                    </span>
                                                                </td>
                                                                <td style={{ ...styles.td, fontFamily: 'monospace', fontSize: '0.8rem', color: theme.colors.secondaryText }}>
                                                                    {shortenPrincipal(tokenId)}
                                                                </td>
                                                            </tr>
                                                        );
                                                    })}
                                                </tbody>
                                            </table>
                                        </div>
                                    </div>
                                )}
                                
                                {reconciliation.length > 0 && (
                                    <div style={styles.subSection}>
                                        <h3 style={styles.subSectionTitle}>Balance Reconciliation</h3>
                                        <div style={{ overflowX: 'auto' }}>
                                            <table style={styles.table}>
                                                <thead style={styles.tableHead}>
                                                    <tr>
                                                        <th style={styles.th}>Token</th>
                                                        <th style={styles.th}>Local Total (Owed)</th>
                                                        <th style={styles.th}>Server Balance (Held)</th>
                                                        <th style={styles.th}>Remaining (Available)</th>
                                                        <th style={styles.th}>Underflow</th>
                                                    </tr>
                                                </thead>
                                                <tbody>
                                                    {reconciliation.map((item) => {
                                                        const meta = getTokenDisplay(item.token_id);
                                                        return (
                                                            <tr key={item.token_id.toString()}>
                                                                <td style={styles.td}>
                                                                    <TokenDisplay tokenId={item.token_id} />
                                                                </td>
                                                                <td style={styles.td}>{formatAmount(item.local_total, meta.decimals)}</td>
                                                                <td style={styles.td}>{formatAmount(item.server_balance, meta.decimals)}</td>
                                                                <td style={styles.td}>
                                                                    <span style={{ color: '#2ecc71' }}>
                                                                        {formatAmount(item.remaining, meta.decimals)}
                                                                    </span>
                                                                </td>
                                                                <td style={styles.td}>
                                                                    <span style={{ color: Number(item.underflow) > 0 ? '#e74c3c' : theme.colors.secondaryText }}>
                                                                        {formatAmount(item.underflow, meta.decimals)}
                                                                        {Number(item.underflow) > 0 && (
                                                                            <FaExclamationTriangle style={{ marginLeft: '6px' }} />
                                                                        )}
                                                                    </span>
                                                                </td>
                                                            </tr>
                                                        );
                                                    })}
                                                </tbody>
                                            </table>
                                        </div>
                                    </div>
                                )}
                            </div>
                        )}
                    </div>

                    {/* User Balances */}
                    <div style={styles.section}>
                        <div 
                            style={styles.sectionHeader}
                            onClick={() => toggleSection('userBalances')}
                        >
                            <h2 style={styles.sectionTitle}>
                                <FaWallet style={styles.sectionIcon} />
                                User Balances {allUserBalances.length > 0 && `(${allUserBalances.length} users)`}
                            </h2>
                            {expandedSections.userBalances ? <FaChevronUp /> : <FaChevronDown />}
                        </div>
                        {expandedSections.userBalances && (
                            <div style={styles.sectionContent}>
                                <div style={styles.helpText}>
                                    <FaInfoCircle style={styles.helpIcon} />
                                    <div style={styles.helpContent}>
                                        View all user claimable reward balances. Load all balances to see everyone, 
                                        or use the filter to search for a specific principal.
                                    </div>
                                </div>
                                
                                <div style={styles.buttonGroup}>
                                    <button
                                        onClick={fetchAllUserBalances}
                                        style={{ ...styles.button, ...styles.primaryButton }}
                                        disabled={loadingAllUserBalances}
                                    >
                                        {loadingAllUserBalances ? <FaSpinner className="spin" /> : <FaSync />}
                                        Load All User Balances
                                    </button>
                                </div>
                                
                                {allUserBalances.length > 0 && (
                                    <div style={{ ...styles.subSection, marginTop: '20px' }}>
                                        <div style={{ display: 'flex', gap: '12px', alignItems: 'center', marginBottom: '15px', flexWrap: 'wrap' }}>
                                            <h3 style={{ ...styles.subSectionTitle, marginBottom: 0 }}>
                                                All User Balances
                                            </h3>
                                            <div style={{ flex: 1, minWidth: '250px', maxWidth: '400px' }}>
                                                <PrincipalInput
                                                    value={userBalancesFilter}
                                                    onChange={(value) => {
                                                        setUserBalancesFilter(value);
                                                        setUserBalancesPage(1);
                                                    }}
                                                    placeholder="Filter by principal..."
                                                    isAuthenticated={isAuthenticated}
                                                    defaultPrincipalType="users"
                                                    style={{ maxWidth: '100%' }}
                                                />
                                            </div>
                                            {userBalancesFilter && (
                                                <span style={{ color: '#888', fontSize: '0.9rem' }}>
                                                    Showing {filteredUserBalances.length} of {allUserBalances.length} users
                                                </span>
                                            )}
                                        </div>
                                        <div style={{ overflowX: 'auto' }}>
                                            <table style={styles.table}>
                                                <thead style={styles.tableHead}>
                                                    <tr>
                                                        <th style={styles.th}>User Principal</th>
                                                        <th style={styles.th}>Token Balances</th>
                                                    </tr>
                                                </thead>
                                                <tbody>
                                                    {paginatedUserBalances.map(([principal, tokenBalances]) => (
                                                        <tr key={principal.toString()}>
                                                            <td style={styles.td}>
                                                                <PrincipalDisplay 
                                                                    principal={principal} 
                                                                    showCopyButton={false}
                                                                    short={true}
                                                                    enableContextMenu={true}
                                                                    isAuthenticated={isAuthenticated}
                                                                />
                                                            </td>
                                                            <td style={styles.td}>
                                                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                                                                    {tokenBalances.map(([tokenId, balance]) => {
                                                                        const meta = getTokenDisplay(tokenId);
                                                                        return (
                                                                            <span 
                                                                                key={tokenId.toString()}
                                                                                style={{
                                                                                    background: 'rgba(212, 175, 55, 0.1)',
                                                                                    border: '1px solid rgba(212, 175, 55, 0.3)',
                                                                                    borderRadius: '4px',
                                                                                    padding: '2px 8px',
                                                                                    fontSize: '0.85rem',
                                                                                    color: goldPrimary,
                                                                                    fontWeight: '500'
                                                                                }}
                                                                            >
                                                                                {formatAmount(balance, meta.decimals)} {meta.symbol}
                                                                            </span>
                                                                        );
                                                                    })}
                                                                </div>
                                                            </td>
                                                        </tr>
                                                    ))}
                                                </tbody>
                                            </table>
                                        </div>
                                        <Pagination
                                            currentPage={userBalancesPage}
                                            totalPages={userBalancesTotalPages}
                                            onPageChange={setUserBalancesPage}
                                            totalItems={filteredUserBalances.length}
                                        />
                                    </div>
                                )}
                                
                                {allUserBalances.length === 0 && !loadingAllUserBalances && (
                                    <div style={styles.emptyState}>
                                        Click "Load All User Balances" to view all users with claimable rewards.
                                    </div>
                                )}
                            </div>
                        )}
                    </div>

                    {/* Neuron Statistics */}
                    <div style={styles.section}>
                        <div 
                            style={styles.sectionHeader}
                            onClick={() => toggleSection('neuronStats')}
                        >
                            <h2 style={styles.sectionTitle}>
                                <FaUsers style={styles.sectionIcon} />
                                Neuron Statistics
                            </h2>
                            {expandedSections.neuronStats ? <FaChevronUp /> : <FaChevronDown />}
                        </div>
                        {expandedSections.neuronStats && (
                            <div style={styles.sectionContent}>
                                <button
                                    onClick={fetchNeuronStats}
                                    style={{ ...styles.button, ...styles.secondaryButton, marginBottom: '20px' }}
                                    disabled={loadingNeuronStats}
                                >
                                    {loadingNeuronStats ? <FaSpinner className="spin" /> : <FaSync />}
                                    Load Neuron Statistics
                                </button>
                                
                                {neuronStats && (
                                    <>
                                        <div style={styles.statsGrid}>
                                            <div style={styles.statCard}>
                                                <div style={styles.statValue}>{Number(neuronStats.total_neurons).toLocaleString()}</div>
                                                <div style={styles.statLabel}>Total Neurons</div>
                                            </div>
                                            <div style={styles.statCard}>
                                                <div style={styles.statValue}>{Number(neuronStats.active_neurons).toLocaleString()}</div>
                                                <div style={styles.statLabel}>Active Neurons</div>
                                            </div>
                                            <div style={styles.statCard}>
                                                <div style={styles.statValue}>{formatAmount(neuronStats.total_stake)}</div>
                                                <div style={styles.statLabel}>Total Stake</div>
                                            </div>
                                            <div style={styles.statCard}>
                                                <div style={styles.statValue}>{formatAmount(neuronStats.voting_power?.total || 0)}</div>
                                                <div style={styles.statLabel}>Total Voting Power</div>
                                            </div>
                                        </div>
                                        
                                        {neuronStats.dissolve_state && (
                                            <div style={styles.subSection}>
                                                <h3 style={styles.subSectionTitle}>Dissolve State Distribution</h3>
                                                <div style={styles.statsGrid}>
                                                    <div style={styles.statCard}>
                                                        <div style={styles.statValue}>{Number(neuronStats.dissolve_state.not_dissolving).toLocaleString()}</div>
                                                        <div style={styles.statLabel}>Not Dissolving</div>
                                                    </div>
                                                    <div style={styles.statCard}>
                                                        <div style={styles.statValue}>{Number(neuronStats.dissolve_state.dissolving).toLocaleString()}</div>
                                                        <div style={styles.statLabel}>Dissolving</div>
                                                    </div>
                                                    <div style={styles.statCard}>
                                                        <div style={styles.statValue}>{Number(neuronStats.dissolve_state.dissolved).toLocaleString()}</div>
                                                        <div style={styles.statLabel}>Dissolved</div>
                                                    </div>
                                                </div>
                                            </div>
                                        )}
                                        
                                        {neuronStats.permissions && (
                                            <div style={styles.subSection}>
                                                <h3 style={styles.subSectionTitle}>Permissions</h3>
                                                <div style={styles.statsGrid}>
                                                    <div style={styles.statCard}>
                                                        <div style={styles.statValue}>{Number(neuronStats.permissions.total_hotkeys).toLocaleString()}</div>
                                                        <div style={styles.statLabel}>Total Hotkeys</div>
                                                    </div>
                                                    <div style={styles.statCard}>
                                                        <div style={styles.statValue}>{Number(neuronStats.permissions.multi_hotkey_neurons).toLocaleString()}</div>
                                                        <div style={styles.statLabel}>Multi-Hotkey Neurons</div>
                                                    </div>
                                                </div>
                                            </div>
                                        )}
                                    </>
                                )}
                            </div>
                        )}
                    </div>

                    {/* Event Statistics */}
                    <div style={styles.section}>
                        <div 
                            style={styles.sectionHeader}
                            onClick={() => toggleSection('eventStats')}
                        >
                            <h2 style={styles.sectionTitle}>
                                <FaChartBar style={styles.sectionIcon} />
                                Event Statistics
                            </h2>
                            {expandedSections.eventStats ? <FaChevronUp /> : <FaChevronDown />}
                        </div>
                        {expandedSections.eventStats && (
                            <div style={styles.sectionContent}>
                                <button
                                    onClick={fetchEventStats}
                                    style={{ ...styles.button, ...styles.secondaryButton, marginBottom: '20px' }}
                                    disabled={loadingEventStats}
                                >
                                    {loadingEventStats ? <FaSpinner className="spin" /> : <FaSync />}
                                    Load Event Statistics
                                </button>
                                
                                {eventStats && (
                                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '20px' }}>
                                        {/* Last 24h */}
                                        <div style={{ ...styles.statCard, textAlign: 'left' }}>
                                            <h4 style={{ color: goldPrimary, marginBottom: '16px' }}>Last 24 Hours</h4>
                                            <div style={styles.infoRow}>
                                                <span style={styles.infoLabel}>Total Claims</span>
                                                <span style={styles.infoValue}>{Number(eventStats.last_24h?.claims?.total || 0).toLocaleString()}</span>
                                            </div>
                                            <div style={styles.infoRow}>
                                                <span style={styles.infoLabel}>Successful</span>
                                                <span style={{ ...styles.infoValue, color: '#2ecc71' }}>{Number(eventStats.last_24h?.claims?.successful || 0).toLocaleString()}</span>
                                            </div>
                                            <div style={styles.infoRow}>
                                                <span style={styles.infoLabel}>Failed</span>
                                                <span style={{ ...styles.infoValue, color: '#e74c3c' }}>{Number(eventStats.last_24h?.claims?.failed || 0).toLocaleString()}</span>
                                            </div>
                                            <div style={styles.infoRow}>
                                                <span style={styles.infoLabel}>Unique Users</span>
                                                <span style={styles.infoValue}>{Number(eventStats.last_24h?.claims?.unique_users || 0).toLocaleString()}</span>
                                            </div>
                                            <div style={styles.infoRow}>
                                                <span style={styles.infoLabel}>Distributions</span>
                                                <span style={styles.infoValue}>{Number(eventStats.last_24h?.user_distributions?.total || 0).toLocaleString()}</span>
                                            </div>
                                        </div>
                                        
                                        {/* All Time */}
                                        <div style={{ ...styles.statCard, textAlign: 'left' }}>
                                            <h4 style={{ color: goldPrimary, marginBottom: '16px' }}>All Time</h4>
                                            <div style={styles.infoRow}>
                                                <span style={styles.infoLabel}>Total Claims</span>
                                                <span style={styles.infoValue}>{Number(eventStats.all_time?.claims?.total || 0).toLocaleString()}</span>
                                            </div>
                                            <div style={styles.infoRow}>
                                                <span style={styles.infoLabel}>Successful</span>
                                                <span style={{ ...styles.infoValue, color: '#2ecc71' }}>{Number(eventStats.all_time?.claims?.successful || 0).toLocaleString()}</span>
                                            </div>
                                            <div style={styles.infoRow}>
                                                <span style={styles.infoLabel}>Failed</span>
                                                <span style={{ ...styles.infoValue, color: '#e74c3c' }}>{Number(eventStats.all_time?.claims?.failed || 0).toLocaleString()}</span>
                                            </div>
                                            <div style={styles.infoRow}>
                                                <span style={styles.infoLabel}>Unique Users</span>
                                                <span style={styles.infoValue}>{Number(eventStats.all_time?.claims?.unique_users || 0).toLocaleString()}</span>
                                            </div>
                                            <div style={styles.infoRow}>
                                                <span style={styles.infoLabel}>Distributions</span>
                                                <span style={styles.infoValue}>{Number(eventStats.all_time?.user_distributions?.total || 0).toLocaleString()}</span>
                                            </div>
                                        </div>
                                    </div>
                                )}
                            </div>
                        )}
                    </div>

                    {/* Distribution Events */}
                    <div style={styles.section}>
                        <div 
                            style={styles.sectionHeader}
                            onClick={() => toggleSection('distributions')}
                        >
                            <h2 style={styles.sectionTitle}>
                                <FaHistory style={styles.sectionIcon} />
                                Distribution Events ({distributionEvents.length})
                            </h2>
                            {expandedSections.distributions ? <FaChevronUp /> : <FaChevronDown />}
                        </div>
                        {expandedSections.distributions && (
                            <div style={styles.sectionContent}>
                                <div style={styles.buttonGroup}>
                                    <button
                                        onClick={fetchDistributionEvents}
                                        style={{ ...styles.button, ...styles.secondaryButton }}
                                        disabled={loadingDistributions}
                                    >
                                        {loadingDistributions ? <FaSpinner className="spin" /> : <FaSync />}
                                        Load Distribution Events
                                    </button>
                                    <button
                                        onClick={handleClearDistributionEvents}
                                        style={{ ...styles.button, ...styles.dangerButton }}
                                    >
                                        <FaTrash /> Clear Events
                                    </button>
                                </div>
                                
                                {distributionEvents.length > 0 && (
                                    <div style={{ ...styles.subSection, marginTop: '20px' }}>
                                        <div style={{ overflowX: 'auto' }}>
                                            <table style={styles.table}>
                                                <thead style={styles.tableHead}>
                                                    <tr>
                                                        <th style={styles.th}>Timestamp</th>
                                                        <th style={styles.th}>Token</th>
                                                        <th style={styles.th}>Amount</th>
                                                        <th style={styles.th}>Proposal Range</th>
                                                    </tr>
                                                </thead>
                                                <tbody>
                                                    {paginatedDistributions.map((event, idx) => {
                                                        const meta = getTokenDisplay(event.token_id);
                                                        return (
                                                            <tr key={idx}>
                                                                <td style={styles.td}>{formatTimestamp(event.timestamp)}</td>
                                                                <td style={styles.td}>
                                                                    <TokenDisplay tokenId={event.token_id} />
                                                                </td>
                                                                <td style={styles.td}>
                                                                    <span style={{ color: goldPrimary, fontWeight: '600' }}>
                                                                        {formatAmount(event.amount, meta.decimals)} {meta.symbol}
                                                                    </span>
                                                                </td>
                                                                <td style={styles.td}>
                                                                    {event.proposal_range?.first?.toString()} - {event.proposal_range?.last?.toString()}
                                                                </td>
                                                            </tr>
                                                        );
                                                    })}
                                                </tbody>
                                            </table>
                                        </div>
                                        <Pagination
                                            currentPage={distributionPage}
                                            totalPages={distributionTotalPages}
                                            onPageChange={setDistributionPage}
                                            totalItems={distributionEvents.length}
                                        />
                                    </div>
                                )}
                            </div>
                        )}
                    </div>

                    {/* Claim Events */}
                    <div style={styles.section}>
                        <div 
                            style={styles.sectionHeader}
                            onClick={() => toggleSection('claims')}
                        >
                            <h2 style={styles.sectionTitle}>
                                <FaHistory style={styles.sectionIcon} />
                                Claim Events ({claimEvents.length})
                            </h2>
                            {expandedSections.claims ? <FaChevronUp /> : <FaChevronDown />}
                        </div>
                        {expandedSections.claims && (
                            <div style={styles.sectionContent}>
                                <div style={styles.buttonGroup}>
                                    <button
                                        onClick={fetchClaimEvents}
                                        style={{ ...styles.button, ...styles.secondaryButton }}
                                        disabled={loadingClaims}
                                    >
                                        {loadingClaims ? <FaSpinner className="spin" /> : <FaSync />}
                                        Load All Claim Events
                                    </button>
                                    <button
                                        onClick={fetchErrorClaimEvents}
                                        style={{ ...styles.button, ...styles.secondaryButton }}
                                        disabled={loadingErrorClaims}
                                    >
                                        {loadingErrorClaims ? <FaSpinner className="spin" /> : <FaExclamationTriangle />}
                                        Load Error Claims
                                    </button>
                                    <button
                                        onClick={handleClearClaimEvents}
                                        style={{ ...styles.button, ...styles.dangerButton }}
                                    >
                                        <FaTrash /> Clear Events
                                    </button>
                                </div>
                                
                                {claimEvents.length > 0 && (
                                    <div style={{ ...styles.subSection, marginTop: '20px' }}>
                                        <div style={{ display: 'flex', gap: '12px', alignItems: 'center', marginBottom: '15px', flexWrap: 'wrap' }}>
                                            <h3 style={{ ...styles.subSectionTitle, marginBottom: 0 }}>
                                                Claim Events
                                            </h3>
                                            <div style={{ flex: 1, minWidth: '250px', maxWidth: '400px' }}>
                                                <PrincipalInput
                                                    value={claimFilter}
                                                    onChange={(value) => {
                                                        setClaimFilter(value);
                                                        setClaimPage(1);
                                                    }}
                                                    placeholder="Filter by hotkey/principal..."
                                                    isAuthenticated={isAuthenticated}
                                                    defaultPrincipalType="users"
                                                    style={{ maxWidth: '100%' }}
                                                />
                                            </div>
                                            {claimFilter && (
                                                <span style={{ color: '#888', fontSize: '0.9rem' }}>
                                                    Showing {processedClaimEvents.length} of {claimEvents.length} events
                                                </span>
                                            )}
                                        </div>
                                        <div style={styles.helpText}>
                                            <FaInfoCircle style={styles.helpIcon} />
                                            <div style={styles.helpContent}>
                                                Successful claims are shown as single rows (pending + success merged). 
                                                Pending claims without a matching success are shown separately.
                                            </div>
                                        </div>
                                        <div style={{ overflowX: 'auto' }}>
                                            <table style={styles.table}>
                                                <thead style={styles.tableHead}>
                                                    <tr>
                                                        <th style={styles.th}>Seq</th>
                                                        <th style={styles.th}>Timestamp</th>
                                                        <th style={styles.th}>Hotkey</th>
                                                        <th style={styles.th}>Token</th>
                                                        <th style={styles.th}>Amount</th>
                                                        <th style={styles.th}>Status</th>
                                                    </tr>
                                                </thead>
                                                <tbody>
                                                    {paginatedClaims.map((event, idx) => {
                                                        const meta = getTokenDisplay(event.token_id);
                                                        const isPaired = event._paired && 'Success' in event.status;
                                                        return (
                                                            <tr key={idx}>
                                                                <td style={styles.td}>
                                                                    {isPaired ? (
                                                                        <span title={`Pending: #${event._pendingSeq?.toString()}, Success: #${event.sequence_number?.toString()}`}>
                                                                            #{event.sequence_number?.toString()}
                                                                        </span>
                                                                    ) : (
                                                                        `#${event.sequence_number?.toString()}`
                                                                    )}
                                                                </td>
                                                                <td style={styles.td}>
                                                                    {isPaired ? (
                                                                        <span title={`Started: ${formatTimestamp(event._pendingTimestamp)}`}>
                                                                            {formatTimestamp(event.timestamp)}
                                                                        </span>
                                                                    ) : (
                                                                        formatTimestamp(event.timestamp)
                                                                    )}
                                                                </td>
                                                                <td style={styles.td}>
                                                                    <PrincipalDisplay 
                                                                        principal={event.hotkey} 
                                                                        showCopyButton={false}
                                                                        short={true}
                                                                        enableContextMenu={true}
                                                                        isAuthenticated={isAuthenticated}
                                                                    />
                                                                </td>
                                                                <td style={styles.td}>
                                                                    <TokenDisplay tokenId={event.token_id} showLogo={false} />
                                                                </td>
                                                                <td style={styles.td}>
                                                                    <span style={{ color: goldPrimary, fontWeight: '600' }}>
                                                                        {formatAmount(event.amount, meta.decimals)}
                                                                    </span>
                                                                </td>
                                                                <td style={styles.td}>
                                                                    <span style={{
                                                                        ...styles.statusBadge,
                                                                        ...('Success' in event.status ? styles.statusSuccess :
                                                                            'Pending' in event.status ? styles.statusPending :
                                                                            styles.statusFailed)
                                                                    }}>
                                                                        {'Success' in event.status ? (isPaired ? 'Completed' : 'Success') :
                                                                         'Pending' in event.status ? 'Pending' : 'Failed'}
                                                                    </span>
                                                                    {event.tx_index && event.tx_index[0] !== undefined && (
                                                                        <span style={{ marginLeft: '8px', fontSize: '0.75rem', color: '#888' }}>
                                                                            tx:{event.tx_index[0].toString()}
                                                                        </span>
                                                                    )}
                                                                </td>
                                                            </tr>
                                                        );
                                                    })}
                                                </tbody>
                                            </table>
                                        </div>
                                        <Pagination
                                            currentPage={claimPage}
                                            totalPages={claimTotalPages}
                                            onPageChange={setClaimPage}
                                            totalItems={processedClaimEvents.length}
                                        />
                                    </div>
                                )}
                                
                                {errorClaimEvents.length > 0 && (
                                    <div style={{ ...styles.subSection, marginTop: '20px' }}>
                                        <h3 style={{ ...styles.subSectionTitle, color: '#e74c3c' }}>
                                            <FaExclamationTriangle style={{ marginRight: '8px' }} />
                                            Error Claim Events ({errorClaimEvents.length})
                                        </h3>
                                        <div style={{ overflowX: 'auto' }}>
                                            <table style={styles.table}>
                                                <thead style={styles.tableHead}>
                                                    <tr>
                                                        <th style={styles.th}>Seq</th>
                                                        <th style={styles.th}>Timestamp</th>
                                                        <th style={styles.th}>Hotkey</th>
                                                        <th style={styles.th}>Token</th>
                                                        <th style={styles.th}>Amount</th>
                                                        <th style={styles.th}>Error</th>
                                                    </tr>
                                                </thead>
                                                <tbody>
                                                    {errorClaimEvents.map((event, idx) => {
                                                        const meta = getTokenDisplay(event.token_id);
                                                        return (
                                                            <tr key={idx}>
                                                                <td style={styles.td}>{event.sequence_number?.toString()}</td>
                                                                <td style={styles.td}>{formatTimestamp(event.timestamp)}</td>
                                                                <td style={styles.td}>
                                                                    <PrincipalDisplay 
                                                                        principal={event.hotkey} 
                                                                        showCopyButton={false}
                                                                        short={true}
                                                                        enableContextMenu={true}
                                                                        isAuthenticated={isAuthenticated}
                                                                    />
                                                                </td>
                                                                <td style={styles.td}>
                                                                    <TokenDisplay tokenId={event.token_id} showLogo={false} />
                                                                </td>
                                                                <td style={styles.td}>{formatAmount(event.amount, meta.decimals)}</td>
                                                                <td style={{ ...styles.td, color: '#e74c3c', maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                                                    {event.error_message?.[0] || 'Unknown error'}
                                                                </td>
                                                            </tr>
                                                        );
                                                    })}
                                                </tbody>
                                            </table>
                                        </div>
                                    </div>
                                )}
                            </div>
                        )}
                    </div>

                    {/* Known & Whitelisted Tokens */}
                    <div style={styles.section}>
                        <div 
                            style={styles.sectionHeader}
                            onClick={() => toggleSection('tokens')}
                        >
                            <h2 style={styles.sectionTitle}>
                                <FaCoins style={styles.sectionIcon} />
                                Token Management
                            </h2>
                            {expandedSections.tokens ? <FaChevronUp /> : <FaChevronDown />}
                        </div>
                        {expandedSections.tokens && (
                            <div style={styles.sectionContent}>
                                <div style={styles.buttonGroup}>
                                    <button
                                        onClick={fetchTokens}
                                        style={{ ...styles.button, ...styles.secondaryButton }}
                                        disabled={loadingTokens}
                                    >
                                        {loadingTokens ? <FaSpinner className="spin" /> : <FaSync />}
                                        Load Tokens
                                    </button>
                                    <button
                                        onClick={handleImportWhitelistedTokens}
                                        style={{ ...styles.button, ...styles.primaryButton }}
                                        disabled={importing}
                                    >
                                        {importing ? <FaSpinner className="spin" /> : <FaFileImport />}
                                        Import from SwapRunner
                                    </button>
                                </div>
                                
                                {knownTokens.length > 0 && (
                                    <div style={styles.subSection}>
                                        <h3 style={styles.subSectionTitle}>Known Tokens ({knownTokens.length})</h3>
                                        <div style={{ overflowX: 'auto' }}>
                                            <table style={styles.table}>
                                                <thead style={styles.tableHead}>
                                                    <tr>
                                                        <th style={styles.th}>Token</th>
                                                        <th style={styles.th}>Symbol</th>
                                                        <th style={styles.th}>Name</th>
                                                        <th style={styles.th}>Decimals</th>
                                                        <th style={styles.th}>Fee</th>
                                                        <th style={styles.th}>Ledger ID</th>
                                                    </tr>
                                                </thead>
                                                <tbody>
                                                    {knownTokens.map(([tokenId, metadata]) => (
                                                        <tr key={tokenId.toString()}>
                                                            <td style={styles.td}>
                                                                <TokenDisplay tokenId={tokenId} />
                                                            </td>
                                                            <td style={styles.td}><strong>{metadata.symbol}</strong></td>
                                                            <td style={styles.td}>{metadata.name}</td>
                                                            <td style={styles.td}>{metadata.decimals?.toString()}</td>
                                                            <td style={styles.td}>{metadata.fee?.toString()}</td>
                                                            <td style={{ ...styles.td, fontFamily: 'monospace', fontSize: '0.75rem', color: theme.colors.secondaryText }}>
                                                                {shortenPrincipal(tokenId)}
                                                            </td>
                                                        </tr>
                                                    ))}
                                                </tbody>
                                            </table>
                                        </div>
                                    </div>
                                )}
                                
                                {whitelistedTokens.length > 0 && (
                                    <div style={styles.subSection}>
                                        <h3 style={styles.subSectionTitle}>Whitelisted Tokens ({whitelistedTokens.length})</h3>
                                        <div style={{ overflowX: 'auto' }}>
                                            <table style={styles.table}>
                                                <thead style={styles.tableHead}>
                                                    <tr>
                                                        <th style={styles.th}>Token</th>
                                                        <th style={styles.th}>Symbol</th>
                                                        <th style={styles.th}>Name</th>
                                                        <th style={styles.th}>Decimals</th>
                                                        <th style={styles.th}>Fee</th>
                                                        <th style={styles.th}>Ledger ID</th>
                                                    </tr>
                                                </thead>
                                                <tbody>
                                                    {whitelistedTokens.map(([tokenId, metadata]) => (
                                                        <tr key={tokenId.toString()}>
                                                            <td style={styles.td}>
                                                                <TokenDisplay tokenId={tokenId} />
                                                            </td>
                                                            <td style={styles.td}><strong>{metadata.symbol}</strong></td>
                                                            <td style={styles.td}>{metadata.name}</td>
                                                            <td style={styles.td}>{metadata.decimals?.toString()}</td>
                                                            <td style={styles.td}>{metadata.fee?.toString()}</td>
                                                            <td style={{ ...styles.td, fontFamily: 'monospace', fontSize: '0.75rem', color: theme.colors.secondaryText }}>
                                                                {shortenPrincipal(tokenId)}
                                                            </td>
                                                        </tr>
                                                    ))}
                                                </tbody>
                                            </table>
                                        </div>
                                    </div>
                                )}
                            </div>
                        )}
                    </div>

                    {/* Distribution Limits */}
                    <div style={styles.section}>
                        <div 
                            style={styles.sectionHeader}
                            onClick={() => toggleSection('distLimits')}
                        >
                            <h2 style={styles.sectionTitle}>
                                <FaBalanceScale style={styles.sectionIcon} />
                                Distribution Limits & Totals
                            </h2>
                            {expandedSections.distLimits ? <FaChevronUp /> : <FaChevronDown />}
                        </div>
                        {expandedSections.distLimits && (
                            <div style={styles.sectionContent}>
                                <button
                                    onClick={fetchDistributionLimits}
                                    style={{ ...styles.button, ...styles.secondaryButton, marginBottom: '20px' }}
                                    disabled={loadingDistLimits}
                                >
                                    {loadingDistLimits ? <FaSpinner className="spin" /> : <FaSync />}
                                    Load Distribution Limits
                                </button>
                                
                                {(minDistributions.length > 0 || maxDistributions.length > 0 || totalDistributions.length > 0) && (
                                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '20px' }}>
                                        {minDistributions.length > 0 && (
                                            <div style={{ ...styles.statCard, textAlign: 'left' }}>
                                                <h4 style={{ color: goldPrimary, marginBottom: '16px' }}>Minimum Distributions</h4>
                                                {minDistributions.map(([tokenId, amount]) => {
                                                    const meta = getTokenDisplay(tokenId);
                                                    return (
                                                        <div key={tokenId.toString()} style={styles.infoRow}>
                                                            <span style={styles.infoLabel}>{meta.symbol}</span>
                                                            <span style={styles.infoValue}>{formatAmount(amount, meta.decimals)}</span>
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        )}
                                        
                                        {maxDistributions.length > 0 && (
                                            <div style={{ ...styles.statCard, textAlign: 'left' }}>
                                                <h4 style={{ color: goldPrimary, marginBottom: '16px' }}>Maximum Distributions</h4>
                                                {maxDistributions.map(([tokenId, amount]) => {
                                                    const meta = getTokenDisplay(tokenId);
                                                    return (
                                                        <div key={tokenId.toString()} style={styles.infoRow}>
                                                            <span style={styles.infoLabel}>{meta.symbol}</span>
                                                            <span style={styles.infoValue}>{formatAmount(amount, meta.decimals)}</span>
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        )}
                                        
                                        {totalDistributions.length > 0 && (
                                            <div style={{ ...styles.statCard, textAlign: 'left' }}>
                                                <h4 style={{ color: goldPrimary, marginBottom: '16px' }}>Total Distributed</h4>
                                                {totalDistributions.map(([tokenId, amount]) => {
                                                    const meta = getTokenDisplay(tokenId);
                                                    return (
                                                        <div key={tokenId.toString()} style={styles.infoRow}>
                                                            <span style={styles.infoLabel}>{meta.symbol}</span>
                                                            <span style={{ ...styles.infoValue, color: '#2ecc71' }}>{formatAmount(amount, meta.decimals)}</span>
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>
                        )}
                    </div>

                    {/* Import Controls */}
                    <div style={styles.section}>
                        <div 
                            style={styles.sectionHeader}
                            onClick={() => toggleSection('imports')}
                        >
                            <h2 style={styles.sectionTitle}>
                                <FaFileImport style={styles.sectionIcon} />
                                Import Controls
                            </h2>
                            {expandedSections.imports ? <FaChevronUp /> : <FaChevronDown />}
                        </div>
                        {expandedSections.imports && (
                            <div style={styles.sectionContent}>
                                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '20px' }}>
                                    {/* Neuron Imports */}
                                    <div style={{ ...styles.statCard, textAlign: 'left' }}>
                                        <h4 style={{ color: goldPrimary, marginBottom: '16px' }}>
                                            <FaUsers style={{ marginRight: '8px' }} />
                                            Neuron Import
                                        </h4>
                                        <p style={{ color: theme.colors.secondaryText, fontSize: '0.9rem', marginBottom: '16px' }}>
                                            Import neurons from SNS governance.
                                        </p>
                                        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                                            <button
                                                onClick={() => handleImportNeurons(false)}
                                                style={{ ...styles.button, ...styles.primaryButton }}
                                                disabled={importing}
                                            >
                                                {importing ? <FaSpinner className="spin" /> : <FaFileImport />}
                                                Import All Neurons
                                            </button>
                                            <button
                                                onClick={() => handleImportNeurons(true)}
                                                style={{ ...styles.button, ...styles.secondaryButton }}
                                                disabled={importing}
                                            >
                                                {importing ? <FaSpinner className="spin" /> : <FaPlus />}
                                                Import New Neurons Only
                                            </button>
                                        </div>
                                    </div>
                                    
                                    {/* Proposal Imports */}
                                    <div style={{ ...styles.statCard, textAlign: 'left' }}>
                                        <h4 style={{ color: goldPrimary, marginBottom: '16px' }}>
                                            <FaDatabase style={{ marginRight: '8px' }} />
                                            Proposal Import
                                        </h4>
                                        <p style={{ color: theme.colors.secondaryText, fontSize: '0.9rem', marginBottom: '16px' }}>
                                            Import proposals from SNS governance.
                                        </p>
                                        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                                            <button
                                                onClick={() => handleImportProposals(false)}
                                                style={{ ...styles.button, ...styles.primaryButton }}
                                                disabled={importing}
                                            >
                                                {importing ? <FaSpinner className="spin" /> : <FaFileImport />}
                                                Import All Proposals
                                            </button>
                                            <button
                                                onClick={() => handleImportProposals(true)}
                                                style={{ ...styles.button, ...styles.secondaryButton }}
                                                disabled={importing}
                                            >
                                                {importing ? <FaSpinner className="spin" /> : <FaPlus />}
                                                Import New Proposals Only
                                            </button>
                                        </div>
                                    </div>
                                </div>
                                
                                {/* Danger Zone */}
                                <div style={{ ...styles.subSection, marginTop: '30px' }}>
                                    <h3 style={{ ...styles.subSectionTitle, color: '#e74c3c' }}>
                                        <FaExclamationTriangle style={{ marginRight: '8px' }} />
                                        Danger Zone
                                    </h3>
                                    <p style={{ color: theme.colors.secondaryText, fontSize: '0.9rem', marginBottom: '16px' }}>
                                        These actions are destructive and cannot be undone. Use with extreme caution.
                                    </p>
                                    <div style={styles.buttonGroup}>
                                        <button
                                            onClick={handleClearBalances}
                                            style={{ ...styles.button, ...styles.dangerButton }}
                                        >
                                            <FaTrash /> Clear All Balances
                                        </button>
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>

                    {/* Admin Management */}
                    <div style={styles.section}>
                        <div 
                            style={styles.sectionHeader}
                            onClick={() => toggleSection('admins')}
                        >
                            <h2 style={styles.sectionTitle}>
                                <FaUserShield style={styles.sectionIcon} />
                                Admin Management
                            </h2>
                            {expandedSections.admins ? <FaChevronUp /> : <FaChevronDown />}
                        </div>
                        {expandedSections.admins && (
                            <div style={styles.sectionContent}>
                                {/* Add Admin */}
                                <div style={{ display: 'flex', gap: '12px', alignItems: 'flex-start', flexWrap: 'wrap', marginBottom: '24px' }}>
                                    <div style={{ flex: 1, minWidth: '300px' }}>
                                        <input
                                            type="text"
                                            placeholder="Enter principal ID to add as admin"
                                            value={newAdminPrincipal}
                                            onChange={(e) => setNewAdminPrincipal(e.target.value)}
                                            style={styles.input}
                                        />
                                    </div>
                                    <button
                                        onClick={handleAddAdmin}
                                        style={{ ...styles.button, ...styles.primaryButton }}
                                        disabled={addingAdmin || !newAdminPrincipal.trim()}
                                    >
                                        {addingAdmin ? <FaSpinner className="spin" /> : <FaPlus />}
                                        Add Admin
                                    </button>
                                </div>
                                
                                {/* Admin List */}
                                <h3 style={styles.subSectionTitle}>Current Admins ({admins.length})</h3>
                                <div style={{ overflowX: 'auto' }}>
                                    <table style={styles.table}>
                                        <thead style={styles.tableHead}>
                                            <tr>
                                                <th style={styles.th}>Principal</th>
                                                <th style={styles.th}>Actions</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {admins.map((admin) => (
                                                <tr key={admin.toString()}>
                                                    <td style={styles.td}>
                                                        <code>{admin.toString()}</code>
                                                    </td>
                                                    <td style={styles.td}>
                                                        <button
                                                            onClick={() => handleRemoveAdmin(admin)}
                                                            style={{ ...styles.button, ...styles.dangerButton, padding: '6px 12px' }}
                                                            disabled={removingAdmin === admin.toString()}
                                                        >
                                                            {removingAdmin === admin.toString() ? (
                                                                <FaSpinner className="spin" />
                                                            ) : (
                                                                <FaTrash />
                                                            )}
                                                        </button>
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            </main>

            {/* Modals */}
            <InfoModal
                isOpen={infoModal.show}
                onClose={closeInfoModal}
                title={infoModal.title}
                message={infoModal.message}
                type={infoModal.type}
            />
            
            <ConfirmationModal
                isOpen={confirmModal.show}
                onClose={closeConfirmModal}
                onConfirm={confirmModal.onConfirm}
                title={confirmModal.title}
                message={confirmModal.message}
            />

            <style>{`
                .spin {
                    animation: spin 1s linear infinite;
                }
                @keyframes spin {
                    from { transform: rotate(0deg); }
                    to { transform: rotate(360deg); }
                }
            `}</style>
        </div>
    );
}
