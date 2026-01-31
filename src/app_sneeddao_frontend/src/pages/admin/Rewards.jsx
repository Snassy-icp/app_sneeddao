import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../../AuthContext';
import { useTheme } from '../../contexts/ThemeContext';
import Header from '../../components/Header';
import { Principal } from '@dfinity/principal';
import { createActor as createRllActor, canisterId as rllCanisterId } from 'declarations/rll';
import { createActor as createLedgerActor } from 'external/icrc1_ledger';
import { getTokenLogo } from '../../utils/TokenUtils';
import InfoModal from '../../components/InfoModal';
import ConfirmationModal from '../../ConfirmationModal';
import { useNavigate } from 'react-router-dom';
import { 
    FaSync, FaPlus, FaTrash, FaSpinner, FaCoins, FaSearch,
    FaCheckCircle, FaExclamationTriangle, FaPlay, FaStop,
    FaChartBar, FaUsers, FaHistory, FaCog, FaDatabase,
    FaClock, FaBalanceScale, FaDownload, FaExclamationCircle,
    FaUserShield, FaFileImport, FaTimes, FaChevronDown, FaChevronUp
} from 'react-icons/fa';

// Gold theme for rewards
const goldPrimary = '#d4af37';
const goldLight = '#f4d03f';
const goldDark = '#aa8c2c';

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
    
    // Neuron statistics
    const [neuronStats, setNeuronStats] = useState(null);
    const [loadingNeuronStats, setLoadingNeuronStats] = useState(false);
    
    // Event statistics
    const [eventStats, setEventStats] = useState(null);
    const [loadingEventStats, setLoadingEventStats] = useState(false);
    
    // Distribution events
    const [distributionEvents, setDistributionEvents] = useState([]);
    const [loadingDistributions, setLoadingDistributions] = useState(false);
    const [showAllDistributions, setShowAllDistributions] = useState(false);
    
    // Claim events
    const [claimEvents, setClaimEvents] = useState([]);
    const [loadingClaims, setLoadingClaims] = useState(false);
    const [showAllClaims, setShowAllClaims] = useState(false);
    const [errorClaimEvents, setErrorClaimEvents] = useState([]);
    const [loadingErrorClaims, setLoadingErrorClaims] = useState(false);
    
    // Known and whitelisted tokens
    const [knownTokens, setKnownTokens] = useState([]);
    const [whitelistedTokens, setWhitelistedTokens] = useState([]);
    const [loadingTokens, setLoadingTokens] = useState(false);
    const [tokenLogos, setTokenLogos] = useState({});
    
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
            fetchAdmins();
        }
    }, [isAdmin, fetchStats, fetchMainLoopStatus, fetchAdmins]);
    
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
    
    // Fetch tokens
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
            maximumFractionDigits: decimals
        });
    };
    
    const shortenPrincipal = (principal) => {
        const str = principal.toString();
        if (str.length <= 15) return str;
        return `${str.slice(0, 8)}...${str.slice(-5)}`;
    };
    
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

                    {/* Token Balances */}
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
                                        <h3 style={styles.subSectionTitle}>Token Balances (Owed to Users)</h3>
                                        <div style={{ overflowX: 'auto' }}>
                                            <table style={styles.table}>
                                                <thead style={styles.tableHead}>
                                                    <tr>
                                                        <th style={styles.th}>Token</th>
                                                        <th style={styles.th}>Total Owed</th>
                                                    </tr>
                                                </thead>
                                                <tbody>
                                                    {tokenBalances.map(([tokenId, balance]) => (
                                                        <tr key={tokenId.toString()}>
                                                            <td style={styles.td}>
                                                                <code>{shortenPrincipal(tokenId)}</code>
                                                            </td>
                                                            <td style={styles.td}>
                                                                <span style={{ color: goldPrimary, fontWeight: '600' }}>
                                                                    {formatAmount(balance)}
                                                                </span>
                                                            </td>
                                                        </tr>
                                                    ))}
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
                                                        <th style={styles.th}>Local Total</th>
                                                        <th style={styles.th}>Server Balance</th>
                                                        <th style={styles.th}>Remaining</th>
                                                        <th style={styles.th}>Underflow</th>
                                                    </tr>
                                                </thead>
                                                <tbody>
                                                    {reconciliation.map((item) => (
                                                        <tr key={item.token_id.toString()}>
                                                            <td style={styles.td}>
                                                                <code>{shortenPrincipal(item.token_id)}</code>
                                                            </td>
                                                            <td style={styles.td}>{formatAmount(item.local_total)}</td>
                                                            <td style={styles.td}>{formatAmount(item.server_balance)}</td>
                                                            <td style={styles.td}>
                                                                <span style={{ color: '#2ecc71' }}>
                                                                    {formatAmount(item.remaining)}
                                                                </span>
                                                            </td>
                                                            <td style={styles.td}>
                                                                <span style={{ color: Number(item.underflow) > 0 ? '#e74c3c' : theme.colors.secondaryText }}>
                                                                    {formatAmount(item.underflow)}
                                                                </span>
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
                                Distribution Events
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
                                                    {(showAllDistributions ? distributionEvents : distributionEvents.slice(-20)).map((event, idx) => (
                                                        <tr key={idx}>
                                                            <td style={styles.td}>{formatTimestamp(event.timestamp)}</td>
                                                            <td style={styles.td}>
                                                                <code>{shortenPrincipal(event.token_id)}</code>
                                                            </td>
                                                            <td style={styles.td}>
                                                                <span style={{ color: goldPrimary, fontWeight: '600' }}>
                                                                    {formatAmount(event.amount)}
                                                                </span>
                                                            </td>
                                                            <td style={styles.td}>
                                                                {event.proposal_range?.first?.toString()} - {event.proposal_range?.last?.toString()}
                                                            </td>
                                                        </tr>
                                                    ))}
                                                </tbody>
                                            </table>
                                        </div>
                                        {distributionEvents.length > 20 && (
                                            <button
                                                onClick={() => setShowAllDistributions(!showAllDistributions)}
                                                style={{ ...styles.button, ...styles.secondaryButton, marginTop: '16px' }}
                                            >
                                                {showAllDistributions ? 'Show Last 20' : `Show All ${distributionEvents.length}`}
                                            </button>
                                        )}
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
                                Claim Events
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
                                        <h3 style={styles.subSectionTitle}>All Claim Events ({claimEvents.length})</h3>
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
                                                    {(showAllClaims ? claimEvents : claimEvents.slice(-30)).map((event, idx) => (
                                                        <tr key={idx}>
                                                            <td style={styles.td}>{event.sequence_number?.toString()}</td>
                                                            <td style={styles.td}>{formatTimestamp(event.timestamp)}</td>
                                                            <td style={styles.td}>
                                                                <code>{shortenPrincipal(event.hotkey)}</code>
                                                            </td>
                                                            <td style={styles.td}>
                                                                <code>{shortenPrincipal(event.token_id)}</code>
                                                            </td>
                                                            <td style={styles.td}>
                                                                <span style={{ color: goldPrimary, fontWeight: '600' }}>
                                                                    {formatAmount(event.amount)}
                                                                </span>
                                                            </td>
                                                            <td style={styles.td}>
                                                                <span style={{
                                                                    ...styles.statusBadge,
                                                                    ...('Success' in event.status ? styles.statusSuccess :
                                                                        'Pending' in event.status ? styles.statusPending :
                                                                        styles.statusFailed)
                                                                }}>
                                                                    {'Success' in event.status ? 'Success' :
                                                                     'Pending' in event.status ? 'Pending' : 'Failed'}
                                                                </span>
                                                            </td>
                                                        </tr>
                                                    ))}
                                                </tbody>
                                            </table>
                                        </div>
                                        {claimEvents.length > 30 && (
                                            <button
                                                onClick={() => setShowAllClaims(!showAllClaims)}
                                                style={{ ...styles.button, ...styles.secondaryButton, marginTop: '16px' }}
                                            >
                                                {showAllClaims ? 'Show Last 30' : `Show All ${claimEvents.length}`}
                                            </button>
                                        )}
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
                                                        <th style={styles.th}>Amount</th>
                                                        <th style={styles.th}>Error</th>
                                                    </tr>
                                                </thead>
                                                <tbody>
                                                    {errorClaimEvents.map((event, idx) => (
                                                        <tr key={idx}>
                                                            <td style={styles.td}>{event.sequence_number?.toString()}</td>
                                                            <td style={styles.td}>{formatTimestamp(event.timestamp)}</td>
                                                            <td style={styles.td}>
                                                                <code>{shortenPrincipal(event.hotkey)}</code>
                                                            </td>
                                                            <td style={styles.td}>{formatAmount(event.amount)}</td>
                                                            <td style={{ ...styles.td, color: '#e74c3c' }}>
                                                                {event.error_message?.[0] || 'Unknown error'}
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
                                                    </tr>
                                                </thead>
                                                <tbody>
                                                    {knownTokens.map(([tokenId, metadata]) => (
                                                        <tr key={tokenId.toString()}>
                                                            <td style={styles.td}>
                                                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                                                    <div style={styles.tokenLogo}>
                                                                        {tokenLogos[tokenId.toString()] ? (
                                                                            <img 
                                                                                src={tokenLogos[tokenId.toString()]} 
                                                                                alt={metadata.symbol}
                                                                                style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                                                                            />
                                                                        ) : (
                                                                            <span style={{ fontSize: '0.8rem' }}>{metadata.symbol?.charAt(0) || '?'}</span>
                                                                        )}
                                                                    </div>
                                                                    <code>{shortenPrincipal(tokenId)}</code>
                                                                </div>
                                                            </td>
                                                            <td style={styles.td}><strong>{metadata.symbol}</strong></td>
                                                            <td style={styles.td}>{metadata.name}</td>
                                                            <td style={styles.td}>{metadata.decimals?.toString()}</td>
                                                            <td style={styles.td}>{metadata.fee?.toString()}</td>
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
                                                    </tr>
                                                </thead>
                                                <tbody>
                                                    {whitelistedTokens.map(([tokenId, metadata]) => (
                                                        <tr key={tokenId.toString()}>
                                                            <td style={styles.td}>
                                                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                                                    <div style={styles.tokenLogo}>
                                                                        {tokenLogos[tokenId.toString()] ? (
                                                                            <img 
                                                                                src={tokenLogos[tokenId.toString()]} 
                                                                                alt={metadata.symbol}
                                                                                style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                                                                            />
                                                                        ) : (
                                                                            <span style={{ fontSize: '0.8rem' }}>{metadata.symbol?.charAt(0) || '?'}</span>
                                                                        )}
                                                                    </div>
                                                                    <code>{shortenPrincipal(tokenId)}</code>
                                                                </div>
                                                            </td>
                                                            <td style={styles.td}><strong>{metadata.symbol}</strong></td>
                                                            <td style={styles.td}>{metadata.name}</td>
                                                            <td style={styles.td}>{metadata.decimals?.toString()}</td>
                                                            <td style={styles.td}>{metadata.fee?.toString()}</td>
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
                                                {minDistributions.map(([tokenId, amount]) => (
                                                    <div key={tokenId.toString()} style={styles.infoRow}>
                                                        <span style={styles.infoLabel}>
                                                            <code>{shortenPrincipal(tokenId)}</code>
                                                        </span>
                                                        <span style={styles.infoValue}>{formatAmount(amount)}</span>
                                                    </div>
                                                ))}
                                            </div>
                                        )}
                                        
                                        {maxDistributions.length > 0 && (
                                            <div style={{ ...styles.statCard, textAlign: 'left' }}>
                                                <h4 style={{ color: goldPrimary, marginBottom: '16px' }}>Maximum Distributions</h4>
                                                {maxDistributions.map(([tokenId, amount]) => (
                                                    <div key={tokenId.toString()} style={styles.infoRow}>
                                                        <span style={styles.infoLabel}>
                                                            <code>{shortenPrincipal(tokenId)}</code>
                                                        </span>
                                                        <span style={styles.infoValue}>{formatAmount(amount)}</span>
                                                    </div>
                                                ))}
                                            </div>
                                        )}
                                        
                                        {totalDistributions.length > 0 && (
                                            <div style={{ ...styles.statCard, textAlign: 'left' }}>
                                                <h4 style={{ color: goldPrimary, marginBottom: '16px' }}>Total Distributed</h4>
                                                {totalDistributions.map(([tokenId, amount]) => (
                                                    <div key={tokenId.toString()} style={styles.infoRow}>
                                                        <span style={styles.infoLabel}>
                                                            <code>{shortenPrincipal(tokenId)}</code>
                                                        </span>
                                                        <span style={{ ...styles.infoValue, color: '#2ecc71' }}>{formatAmount(amount)}</span>
                                                    </div>
                                                ))}
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
