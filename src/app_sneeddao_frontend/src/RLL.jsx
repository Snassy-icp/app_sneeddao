import React, { useState, useEffect } from 'react';
import { Link, useSearchParams, useNavigate } from 'react-router-dom';
import { Principal } from '@dfinity/principal';
import { useAuth } from './AuthContext';
import { createActor as createLedgerActor } from 'external/icrc1_ledger';
import { createActor as createRllActor, canisterId as rllCanisterId } from 'external/rll';
import { createActor as createBackendActor, canisterId as backendCanisterId } from 'declarations/app_sneeddao_backend';
import { getTokenLogo } from './utils/TokenUtils';
import ConfirmationModal from './ConfirmationModal';
import Notification from './Notification';
import './RLL.css';
import './Notification.css';
import { Actor, HttpAgent } from '@dfinity/agent';
import { createActor as createSnsGovernanceActor, canisterId as snsGovernanceCanisterId } from 'external/sns_governance';
import PrincipalBox from './PrincipalBox';
import { headerStyles } from './styles/HeaderStyles';
import Header from './components/Header';
import { fetchUserNeurons, fetchUserNeuronsForSns } from './utils/NeuronUtils';
import { useTheme } from './contexts/ThemeContext';

// Styles
const getStyles = (theme) => ({
    tokenBalances: {
        background: theme.colors.cardGradient,
        border: `1px solid ${theme.colors.border}`,
        borderRadius: '8px',
        padding: '20px',
        marginTop: '20px',
        color: theme.colors.primaryText,
        boxShadow: theme.colors.cardShadow
    },
    tokenList: {
        display: 'flex',
        flexDirection: 'column',
        gap: '15px'
    },
    tokenItem: {
        display: 'flex',
        alignItems: 'center',
        padding: '15px',
        background: theme.colors.tertiaryBg,
        border: `1px solid ${theme.colors.border}`,
        borderRadius: '8px',
        boxShadow: theme.colors.cardShadow,
        color: theme.colors.primaryText,
        transition: 'all 0.3s ease'
    },
    tokenSymbol: {
        fontWeight: 'bold',
        marginRight: 'auto',
        color: theme.colors.primaryText
    },
    tokenBalance: {
        fontFamily: 'monospace',
        fontSize: '1.1em',
        color: theme.colors.primaryText,
        display: 'flex',
        alignItems: 'center',
        gap: '10px'
    },
    heading: {
        color: theme.colors.primaryText,
        marginBottom: '15px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: '8px'
    },
    infoIcon: {
        color: theme.colors.accent,
        cursor: 'help',
        fontSize: '16px',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: '20px',
        height: '20px',
        borderRadius: '50%',
        border: `1px solid ${theme.colors.accent}`,
        marginLeft: 'auto',
        transition: 'all 0.3s ease'
    },
    spinner: {
        width: '20px',
        height: '20px',
        border: `2px solid ${theme.colors.border}`,
        borderTop: `2px solid ${theme.colors.accent}`,
        borderRadius: '50%',
        animation: 'spin 1s linear infinite',
    },
    controls: {
        marginBottom: '15px',
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        color: theme.colors.primaryText
    },
    checkbox: {
        cursor: 'pointer',
        width: '16px',
        height: '16px',
        accentColor: theme.colors.accent
    },
    section: {
        background: theme.colors.cardGradient,
        border: `1px solid ${theme.colors.border}`,
        borderRadius: '8px',
        padding: '20px',
        marginTop: '20px',
        color: theme.colors.primaryText,
        boxShadow: theme.colors.cardShadow
    },
    distributionItem: {
        display: 'flex',
        alignItems: 'center',
        padding: '15px',
        background: theme.colors.tertiaryBg,
        border: `1px solid ${theme.colors.border}`,
        borderRadius: '8px',
        boxShadow: theme.colors.cardShadow,
        color: theme.colors.primaryText,
        marginBottom: '10px',
        transition: 'all 0.3s ease'
    },
    distributionLabel: {
        fontWeight: 'bold',
        marginRight: 'auto',
        color: theme.colors.primaryText
    },
    distributionValue: {
        fontFamily: 'monospace',
        fontSize: '1.1em',
        color: theme.colors.primaryText
    },
    eventList: {
        display: 'flex',
        flexDirection: 'column',
        gap: '15px'
    },
    eventItem: {
        display: 'flex',
        flexDirection: 'column',
        padding: '15px',
        background: theme.colors.tertiaryBg,
        border: `1px solid ${theme.colors.border}`,
        borderRadius: '8px',
        boxShadow: theme.colors.cardShadow,
        color: theme.colors.primaryText,
        transition: 'all 0.3s ease'
    },
    eventHeader: {
        display: 'flex',
        justifyContent: 'space-between',
        marginBottom: '10px'
    },
    eventDetails: {
        display: 'flex',
        flexDirection: 'column',
        gap: '5px'
    },
    sectionHeader: {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: '15px'
    },
    statusGrid: {
        display: 'flex',
        flexDirection: 'column',
        gap: '10px'
    },
    statusItem: {
        display: 'flex',
        justifyContent: 'space-between',
        color: theme.colors.primaryText
    },
    cycleInfo: {
        display: 'flex',
        flexDirection: 'column',
        gap: '10px'
    },
    progressInfo: {
        display: 'flex',
        flexDirection: 'column',
        gap: '10px'
    },
    proposalInfo: {
        display: 'flex',
        flexDirection: 'column',
        gap: '10px'
    },
    reconciliationList: {
        display: 'flex',
        flexDirection: 'column',
        gap: '10px'
    },
    reconciliationItem: {
        display: 'flex',
        justifyContent: 'space-between',
        color: theme.colors.primaryText
    },
    adminControls: {
        display: 'flex',
        flexDirection: 'column',
        gap: '10px'
    },
    adminButton: {
        background: `linear-gradient(135deg, ${theme.colors.accent}, ${theme.colors.accent}dd)`,
        color: theme.colors.primaryBg,
        border: 'none',
        borderRadius: '6px',
        padding: '10px 18px',
        cursor: 'pointer',
        fontSize: '16px',
        fontWeight: '600',
        transition: 'all 0.3s ease',
        boxShadow: theme.colors.accentShadow
    },
    noNeuronsMessage: {
        background: theme.colors.cardGradient,
        border: `1px solid ${theme.colors.border}`,
        padding: '20px',
        borderRadius: '8px',
        color: theme.colors.primaryText,
        boxShadow: theme.colors.cardShadow
    },
    instructionsList: {
        marginTop: '15px',
        paddingLeft: '20px',
        lineHeight: '1.6'
    },
    principalCode: {
        background: theme.colors.tertiaryBg,
        border: `1px solid ${theme.colors.border}`,
        padding: '6px 10px',
        borderRadius: '6px',
        fontFamily: 'monospace',
        wordBreak: 'break-all',
        color: theme.colors.primaryText
    },
    expandButton: {
        background: 'none',
        border: 'none',
        color: theme.colors.accent,
        cursor: 'pointer',
        fontSize: '20px',
        padding: '0 10px',
        transition: 'all 0.3s ease'
    },
    rllLogo: {
        fontSize: '2.5em',
        fontWeight: 'bold',
        color: theme.colors.primaryText,
        textDecoration: 'none',
        marginLeft: '20px',
        display: 'flex',
        alignItems: 'center'
    },
    logoContainer: {
        display: 'flex',
        alignItems: 'center'
    },
    claimButton: {
        background: `linear-gradient(135deg, ${theme.colors.success}, ${theme.colors.success}dd)`,
        color: theme.colors.primaryBg,
        border: 'none',
        borderRadius: '6px',
        padding: '10px 18px',
        cursor: 'pointer',
        fontSize: '16px',
        fontWeight: '600',
        transition: 'all 0.3s ease',
        boxShadow: theme.colors.accentShadow
    },
    eventActions: {
        display: 'flex',
        justifyContent: 'flex-end',
        marginTop: '10px'
    },
    claimHistory: {
        display: 'flex',
        flexDirection: 'column',
        gap: '15px'
    }
});

// Token configurations
const TOKENS = [
    {
        canisterId: 'ryjl3-tyaaa-aaaaa-aaaba-cai',
        symbol: 'ICP',
        decimals: 8,
        fee: 0.0001,
        standard: 'ICRC2'
    },
    {
        canisterId: 'hvgxa-wqaaa-aaaaq-aacia-cai',
        symbol: 'SNEED',
        decimals: 8,
        fee: 0.00001,
        standard: 'ICRC2'
    }
];

const SNEED_GOVERNANCE_CANISTER_ID = 'fi3zi-fyaaa-aaaaq-aachq-cai';

// Helper function to format timestamps (for seconds)
const formatTimestamp = (timestamp) => {
    if (!timestamp) return '';
    const date = new Date(Number(timestamp) * 1000); // Convert seconds to milliseconds
    return date.toLocaleString();
};

// Helper function for nanosecond timestamps
const formatNanoTimestamp = (timestamp) => {
    if (!timestamp) return '';
    const date = new Date(Number(timestamp) / 1_000_000); // Convert nanoseconds to milliseconds
    return date.toLocaleString();
};

// Add utility function for hex conversion
function uint8ArrayToHex(array) {
    return Array.from(array)
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');
}

// Helper function to calculate age from timestamp
const calculateAge = (timestamp) => {
    if (!timestamp) return '';
    const ageInSeconds = Math.floor(Date.now() / 1000) - Number(timestamp);
    
    const years = Math.floor(ageInSeconds / (365 * 24 * 60 * 60));
    const months = Math.floor((ageInSeconds % (365 * 24 * 60 * 60)) / (30 * 24 * 60 * 60));
    const days = Math.floor((ageInSeconds % (30 * 24 * 60 * 60)) / (24 * 60 * 60));
    const hours = Math.floor((ageInSeconds % (24 * 60 * 60)) / (60 * 60));
    
    const parts = [];
    if (years > 0) parts.push(`${years}y`);
    if (months > 0) parts.push(`${months}m`);
    if (days > 0) parts.push(`${days}d`);
    if (hours > 0 && years === 0) parts.push(`${hours}h`); // Only show hours if less than a year old
    
    return parts.join(' ') || 'Less than an hour';
};

// Helper function to format e8s to token amount
const formatE8s = (e8s) => {
    if (!e8s) return '0';
    return (Number(e8s) / 1e8).toLocaleString(undefined, {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    });
};

// Helper function to format duration in seconds to human readable format
const formatDuration = (seconds) => {
    if (!seconds) return '0 seconds';
    const years = Math.floor(seconds / (365 * 24 * 60 * 60));
    const months = Math.floor((seconds % (365 * 24 * 60 * 60)) / (30 * 24 * 60 * 60));
    const days = Math.floor((seconds % (30 * 24 * 60 * 60)) / (24 * 60 * 60));
    
    const parts = [];
    if (years > 0) parts.push(`${years} year${years > 1 ? 's' : ''}`);
    if (months > 0) parts.push(`${months} month${months > 1 ? 's' : ''}`);
    if (days > 0) parts.push(`${days} day${days > 1 ? 's' : ''}`);
    
    return parts.join(', ') || '< 1 day';
};

function RLL() {
    const { identity, isAuthenticated, logout, login } = useAuth();
    const { theme } = useTheme();
    const styles = getStyles(theme);
    const [tokens, setTokens] = useState([]);
    const [balances, setBalances] = useState({});
    const [loadingTokens, setLoadingTokens] = useState(true);
    const [loadingBalances, setLoadingBalances] = useState({});
    const [distributions, setDistributions] = useState(null);
    const [loadingDistributions, setLoadingDistributions] = useState(true);
    const [distributionEvents, setDistributionEvents] = useState([]);
    const [claimEvents, setClaimEvents] = useState([]);
    const [loadingEvents, setLoadingEvents] = useState(true);
    const [userClaimEvents, setUserClaimEvents] = useState([]);
    const [loadingUserEvents, setLoadingUserEvents] = useState(true);
    const [userBalances, setUserBalances] = useState([]);
    const [loadingUserBalances, setLoadingUserBalances] = useState(true);
    const [showConfirmModal, setShowConfirmModal] = useState(false);
    const [confirmMessage, setConfirmMessage] = useState('');
    const [confirmAction, setConfirmAction] = useState(null);
    const [isClaimHistoryExpanded, setIsClaimHistoryExpanded] = useState(false);
    const [isHotkeyNeuronsExpanded, setIsHotkeyNeuronsExpanded] = useState(false);
    
    // Section expansion state
    const [expandedSections, setExpandedSections] = useState({
        rewardsStatistics: true, // Expanded by default
        balanceReconciliation: false,
        distributionLimits: false,
        distributionCycle: false,
        importStatus: false,
        distributionEvents: false,
        claimEvents: false,
        adminControls: false,
        manageDistributionLimits: false,
        errorClaims: false
    });
    
    // New state variables for enhanced features
    const [importedNeuronsCount, setImportedNeuronsCount] = useState(0);
    const [importedOwnersCount, setImportedOwnersCount] = useState(0);
    const [importedPropsCount, setImportedPropsCount] = useState(0);
    const [importStage, setImportStage] = useState('');
    const [orchestratorStage, setOrchestratorStage] = useState('');
    const [mainLoopStatus, setMainLoopStatus] = useState({
        isRunning: null,
        lastStarted: null,
        lastStopped: null,
        lastCycleStarted: null,
        lastCycleEnded: null,
        nextScheduled: null,
        frequencySeconds: null,
        currentTime: null
    });
    const [reconciliation, setReconciliation] = useState([]);
    const [loadingReconciliation, setLoadingReconciliation] = useState(true);
    const [isAdmin, setIsAdmin] = useState(false);
    const [highestClosedProposalId, setHighestClosedProposalId] = useState(null);
    const [tokenDistributionLimits, setTokenDistributionLimits] = useState({});
    const [loadingDistributionLimits, setLoadingDistributionLimits] = useState(true);
    const [newMinAmount, setNewMinAmount] = useState('');
    const [newMaxAmount, setNewMaxAmount] = useState('');
    const [selectedToken, setSelectedToken] = useState(null);
    const [eventStats, setEventStats] = useState(null);
    const [loadingEventStats, setLoadingEventStats] = useState(true);
    const [errorClaims, setErrorClaims] = useState([]);
    const [unmatchedPendingClaims, setUnmatchedPendingClaims] = useState([]);
    const [loadingErrorClaims, setLoadingErrorClaims] = useState(true);
    const [loadingUnmatchedClaims, setLoadingUnmatchedClaims] = useState(true);

    // New state for hotkey neurons
    const [hotkeyNeurons, setHotkeyNeurons] = useState({
        neurons_by_owner: [],
        total_voting_power: 0,
        distribution_voting_power: 0
    });
    const [loadingHotkeyNeurons, setLoadingHotkeyNeurons] = useState(true);

    // New state for claiming tokens
    const [claimingTokens, setClaimingTokens] = useState({});
    const [notification, setNotification] = useState(null);

    // Fetch whitelisted tokens
    useEffect(() => {
        const fetchTokens = async () => {
            console.log('Starting to fetch whitelisted tokens...');
            try {
                const agent = new HttpAgent({
                    host: 'https://ic0.app'
                });
                await agent.fetchRootKey();
                
                const backendActor = createBackendActor(backendCanisterId, {
                    agentOptions: { agent }
                });
                console.log('Created backend actor, fetching tokens...');
                const whitelistedTokens = await backendActor.get_whitelisted_tokens();
                console.log('Received whitelisted tokens:', whitelistedTokens);
                setTokens(whitelistedTokens);
            } catch (error) {
                console.error('Error fetching whitelisted tokens:', error);
            } finally {
                setLoadingTokens(false);
            }
        };

        fetchTokens();
    }, []);

    // Fetch total distributions
    useEffect(() => {
        const fetchDistributions = async () => {
            console.log('Starting to fetch total distributions...');
            setLoadingDistributions(true);
            try {
                const agent = new HttpAgent({
                    host: 'https://ic0.app'
                });
                await agent.fetchRootKey();
                
                const rllActor = createRllActor(rllCanisterId, {
                    agentOptions: { agent }
                });
                console.log('Created RLL actor, fetching distributions...');
                const totalDistributions = await rllActor.get_total_distributions();
                console.log('Received total distributions:', totalDistributions);
                
                // Transform the data into a more usable format
                const formattedDistributions = totalDistributions.reduce((acc, [principal, amount]) => {
                    acc[principal.toText()] = amount;
                    return acc;
                }, {});
                
                setDistributions(formattedDistributions);
            } catch (error) {
                console.error('Error fetching total distributions:', error);
            } finally {
                setLoadingDistributions(false);
            }
        };

        fetchDistributions();
    }, []);

    // Fetch events
    useEffect(() => {
        const fetchEvents = async () => {
            console.log('Starting to fetch events...');
            setLoadingEvents(true);
            try {
                const agent = new HttpAgent({
                    host: 'https://ic0.app'
                });
                await agent.fetchRootKey();
                
                const rllActor = createRllActor(rllCanisterId, {
                    agentOptions: { agent }
                });
                console.log('Created RLL actor, fetching events...');
                const [distributions, claims] = await Promise.all([
                    rllActor.get_distribution_events(),
                    rllActor.get_claim_events()
                ]);
                
                console.log('Received distribution events:', distributions);
                console.log('Received claim events:', claims);
                
                setDistributionEvents(distributions);
                setClaimEvents(claims);
            } catch (error) {
                console.error('Error fetching events:', error);
            } finally {
                setLoadingEvents(false);
            }
        };

        fetchEvents();
    }, []);

    // Fetch user's claim events
    useEffect(() => {
        const fetchUserEvents = async () => {
            if (!isAuthenticated || !identity) {
                console.log('Skipping user events fetch - not authenticated or no identity');
                return;
            }
            
            console.log('Starting to fetch user claim events...');
            setLoadingUserEvents(true);
            try {
                const rllActor = createRllActor(rllCanisterId, {
                    agentOptions: {
                        identity,
                    },
                });
                console.log('Created RLL actor, fetching user claims...');
                const claims = await rllActor.get_claim_events_for_hotkey(identity.getPrincipal());
                console.log('Received user claim events:', claims);
                setUserClaimEvents(claims);
            } catch (error) {
                console.error('Error fetching user claim events:', error);
            } finally {
                setLoadingUserEvents(false);
            }
        };

        fetchUserEvents();
    }, [isAuthenticated, identity]);

    // Fetch user's balances
    useEffect(() => {
        const fetchUserBalances = async () => {
            if (!isAuthenticated || !identity) {
                console.log('Skipping user balances fetch - not authenticated or no identity');
                return;
            }
            
            console.log('Starting to fetch user balances...');
            setLoadingUserBalances(true);
            try {
                // First get neurons from SNS
                const neurons = await fetchNeuronsFromSns();
                
                const rllActor = createRllActor(rllCanisterId, {
                    agentOptions: {
                        identity,
                    },
                });
                console.log('Created RLL actor, fetching user balances...');
                const balances = await rllActor.balances_of_hotkey_neurons(neurons);
                console.log('Received user balances:', balances);
                setUserBalances(balances);
            } catch (error) {
                console.error('Error fetching user balances:', error);
            } finally {
                setLoadingUserBalances(false);
            }
        };

        fetchUserBalances();
    }, [isAuthenticated, identity]);

    // Fetch import status
    useEffect(() => {
        const fetchImportStatus = async () => {
            console.log('Starting to fetch import status...');
            try {
                const agent = new HttpAgent({
                    host: 'https://ic0.app'
                });
                await agent.fetchRootKey();
                
                const rllActor = createRllActor(rllCanisterId, {
                    agentOptions: { agent }
                });
                
                const [
                    neurons,
                    owners,
                    props,
                    stage,
                    proposalId,
                    loopStatus
                ] = await Promise.all([
                    rllActor.imported_neurons_count(),
                    rllActor.imported_owners_count(),
                    rllActor.imported_props_count(),
                    rllActor.get_import_stage(),
                    rllActor.get_highest_closed_proposal_id(),
                    rllActor.get_main_loop_status()
                ]);

                console.log('Received import status:', {
                    neurons,
                    owners,
                    props,
                    stage,
                    proposalId,
                    loopStatus
                });

                setImportedNeuronsCount(neurons);
                setImportedOwnersCount(owners);
                setImportedPropsCount(props);
                setImportStage(stage);
                setHighestClosedProposalId(proposalId);
                setMainLoopStatus({
                    isRunning: loopStatus.is_running,
                    lastStarted: loopStatus.last_started,
                    lastStopped: loopStatus.last_stopped,
                    lastCycleStarted: loopStatus.last_cycle_started,
                    lastCycleEnded: loopStatus.last_cycle_ended,
                    nextScheduled: loopStatus.next_scheduled,
                    frequencySeconds: loopStatus.frequency_seconds,
                    currentTime: loopStatus.current_time
                });

            } catch (error) {
                console.error('Error fetching import status:', error);
                // Set default values on error
                setImportedNeuronsCount(0);
                setImportedOwnersCount(0);
                setImportedPropsCount(0);
                setImportStage('');
                setHighestClosedProposalId(null);
                setMainLoopStatus({
                    isRunning: null,
                    lastStarted: null,
                    lastStopped: null,
                    lastCycleStarted: null,
                    lastCycleEnded: null,
                    nextScheduled: null,
                    frequencySeconds: null,
                    currentTime: null
                });
            }
        };

        fetchImportStatus();
        
        // Set up periodic refresh
        const intervalId = setInterval(fetchImportStatus, 30000); // Refresh every 30 seconds
        
        return () => clearInterval(intervalId);
    }, []);

    // Fetch balance reconciliation
    useEffect(() => {
        const fetchReconciliation = async () => {
            console.log('Starting to fetch balance reconciliation...');
            setLoadingReconciliation(true);
            try {
                const agent = new HttpAgent({
                    host: 'https://ic0.app'
                });
                await agent.fetchRootKey();
                
                const rllActor = createRllActor(rllCanisterId, {
                    agentOptions: { agent }
                });
                
                // First get known tokens
                const knownTokens = await rllActor.get_known_tokens();
                console.log('Known tokens:', knownTokens);

                // For each token, get its balance - extract just the principal from each token entry
                const balances = await Promise.all(knownTokens.map(async ([tokenId]) => {
                    const ledgerActor = createLedgerActor(tokenId.toString(), {
                        agentOptions: { agent }
                    });

                    const balance = await ledgerActor.icrc1_balance_of({
                        owner: Principal.fromText(rllCanisterId),
                        subaccount: []
                    });
                    return [tokenId, balance];
                }));

                // Call balance_reconciliation_from_balances with the fetched balances
                const reconciliationData = await rllActor.balance_reconciliation_from_balances(balances);
                console.log('Received reconciliation data:', reconciliationData);
                setReconciliation(reconciliationData);

            } catch (error) {
                console.error('Error fetching reconciliation:', error);
            } finally {
                setLoadingReconciliation(false);
            }
        };

        fetchReconciliation();
    }, []);

    // Function to fetch neurons directly from SNS
    const fetchNeuronsFromSns = async () => {
        const sneedGovernanceCanisterId = 'fi3zi-fyaaa-aaaaq-aachq-cai'; // Sneed governance canister
        return await fetchUserNeuronsForSns(identity, sneedGovernanceCanisterId);
    };

    // Updated function to fetch hotkey neurons data
    const fetchHotkeyNeuronsData = async () => {
        if (!identity) {
            setLoadingHotkeyNeurons(false);
            return;
        }
        
        setLoadingHotkeyNeurons(true);
        try {
            // First get neurons from SNS
            const neurons = await fetchNeuronsFromSns();
            
            // Then get voting power data from RLL
            const rllActor = createRllActor(rllCanisterId, { agentOptions: { identity } });
            const result = await rllActor.get_hotkey_voting_power(neurons);
            
            setHotkeyNeurons(result);
        } catch (error) {
            console.error('Error fetching hotkey neurons:', error);
            // Set empty state on error
            setHotkeyNeurons({
                neurons_by_owner: [],
                total_voting_power: 0,
                distribution_voting_power: 0
            });
        } finally {
            setLoadingHotkeyNeurons(false);
        }
    };

    // Update useEffect to use new function and handle authentication changes
    useEffect(() => {
        if (isAuthenticated && identity) {
            fetchHotkeyNeuronsData();
        } else {
            setLoadingHotkeyNeurons(false);
        }
    }, [isAuthenticated, identity]);

    const formatBalance = (balance, decimals) => {
        if (!balance) return '0';
        return (Number(balance) / Math.pow(10, decimals)).toFixed(decimals);
    };

    const getTokenDecimals = (symbol) => {
        const token = tokens.find(t => t.symbol === symbol);
        return token ? token.decimals : 8; // fallback to 8 decimals if token not found
    };

    const formatProposalRange = (range) => {
        return `${range.first} - ${range.last}`;
    };

    const getTokenSymbolByPrincipal = (principalId) => {
        const token = tokens.find(t => t.ledger_id.toText() === principalId);
        return token ? token.symbol : 'Unknown';
    };

    const getTokenDecimalsByPrincipal = (principalId) => {
        const token = tokens.find(t => t.ledger_id.toText() === principalId);
        return token ? token.decimals : 8; // fallback to 8 decimals
    };

    const handleClaimRewards = async (tokenId, balance, token) => {
        console.log('Setting up claim action...');
        console.log('Current auth state:', { isAuthenticated, hasIdentity: !!identity });
        
        // Check if balance is 0
        if (balance <= 0n) {
            setNotification({
                type: 'error',
                message: `No ${token.symbol} rewards available to claim`
            });
            return;
        }

        // Check if balance is less than or equal to fee
        if (balance <= token.fee) {
            setNotification({
                type: 'error',
                message: `Your ${token.symbol} rewards (${formatBalance(balance, token.decimals)} ${token.symbol}) are less than the transaction fee (${formatBalance(token.fee, token.decimals)} ${token.symbol}). Please wait until you have accumulated more rewards before claiming.`
            });
            return;
        }
        
        // Store a direct function that will be executed when confirmed
        setConfirmAction(async () => {
            console.log('Executing claim action...');
            setClaimingTokens(prev => ({ ...prev, [tokenId.toString()]: true }));
            try {
                const rllActor = createRllActor(rllCanisterId, { agentOptions: { identity } });
                console.log('Created RLL actor, calling claim_full_balance_of_hotkey...');
                
                const claim_results = await rllActor.claim_full_balance_of_hotkey(
                    tokenId,
                    token.fee
                );
                console.log('Claim results:', claim_results);

                // Check the TransferResult variant
                if ('Ok' in claim_results) {
                    // Only refresh data and show success notification if the claim was successful
                    console.log('Claim successful, refreshing data...');
                    const [balances, claims] = await Promise.all([
                        rllActor.balances_of_hotkey(),
                        rllActor.get_claim_events_for_hotkey(identity.getPrincipal())
                    ]);
                    
                    setUserBalances(balances);
                    setUserClaimEvents(claims);
                    console.log('Data refreshed successfully');
                    
                    setNotification({
                        type: 'success',
                        message: `Successfully claimed ${formatBalance(balance, token.decimals)} ${token.symbol}`
                    });
                } else if (claim_results.Err) {
                    // Handle specific transfer errors
                    const error = claim_results.Err;
                    let errorMessage = '';
                    
                    if (error.InsufficientFunds) {
                        const availableBalance = error.InsufficientFunds.balance;
                        errorMessage = `Insufficient funds. Available balance: ${formatBalance(availableBalance, token.decimals)} ${token.symbol}`;
                    } else if (error.BadFee) {
                        const expectedFee = error.BadFee.expected_fee;
                        errorMessage = `Your ${token.symbol} rewards are less than the transaction fee (${formatBalance(expectedFee, token.decimals)} ${token.symbol}). Please wait until you have accumulated more rewards before claiming.`;
                    } else if (error.GenericError) {
                        errorMessage = error.GenericError.message;
                    } else {
                        errorMessage = `Transfer failed: ${Object.keys(error)[0]}`;
                    }
                    
                    console.error('Claim failed:', errorMessage);
                    setNotification({
                        type: 'error',
                        message: `Failed to claim ${token.symbol}: ${errorMessage}`
                    });
                }
            } catch (error) {
                console.error('Error during claim process:', error);
                setNotification({
                    type: 'error',
                    message: `Failed to claim ${token.symbol}: ${error.message}`
                });
            } finally {
                setClaimingTokens(prev => ({ ...prev, [tokenId.toString()]: false }));
            }
        });
        
        setConfirmMessage(`Do you want to claim your balance of ${formatBalance(balance, token.decimals)} ${token.symbol}?`);
        setShowConfirmModal(true);
    };

    // Add this function to group events by sequence number
    const groupEventsBySequence = (events) => {
        const grouped = {};
        events.forEach(event => {
            const seqNum = event.sequence_number.toString();
            if (!grouped[seqNum]) {
                grouped[seqNum] = [];
            }
            grouped[seqNum].push(event);
        });
        return grouped;
    };

    // Add this function to get the latest status from a group of events
    // Priority order: Success > Failed > Pending > Unknown
    // Success takes highest priority as it's a final positive state
    // Failed takes priority over Pending as it's a final negative state
    // Pending is shown only if there are no final states
    const getGroupStatus = (events) => {
        if (events.some(e => 'Success' in e.status)) return 'Success';
        if (events.some(e => 'Failed' in e.status)) return 'Failed';
        if (events.some(e => 'Pending' in e.status)) return 'Pending';
        return 'Unknown';
    };

    // Admin action handlers
    const handleStartDistributionCycle = async () => {
        if (!isAdmin) return;
        try {
            const rllActor = createRllActor(rllCanisterId, { agentOptions: { identity } });
            const result = await rllActor.start_distribution_cycle();
            console.log('Distribution cycle started:', result);
            // Refresh status
            await fetchImportStatus();
        } catch (error) {
            console.error('Error starting distribution cycle:', error);
        }
    };

    const handleStopDistributionCycle = async () => {
        if (!isAdmin) return;
        try {
            const rllActor = createRllActor(rllCanisterId, { agentOptions: { identity } });
            const result = await rllActor.stop_distribution_cycle();
            console.log('Distribution cycle stopped:', result);
            // Refresh status
            await fetchImportStatus();
        } catch (error) {
            console.error('Error stopping distribution cycle:', error);
        }
    };

    const handleImportAllNeurons = async () => {
        if (!isAdmin) return;
        try {
            const rllActor = createRllActor(rllCanisterId, { agentOptions: { identity } });
            const result = await rllActor.import_all_neurons();
            console.log('Started importing all neurons:', result);
            // Refresh status
            await fetchImportStatus();
        } catch (error) {
            console.error('Error importing neurons:', error);
        }
    };

    const handleImportAllProposals = async () => {
        if (!isAdmin) return;
        try {
            const rllActor = createRllActor(rllCanisterId, { agentOptions: { identity } });
            const result = await rllActor.import_all_proposals();
            console.log('Started importing all proposals:', result);
            // Refresh status
            await fetchImportStatus();
        } catch (error) {
            console.error('Error importing proposals:', error);
        }
    };

    const handleStartMainLoop = async () => {
        if (!isAdmin) return;
        try {
            const rllActor = createRllActor(rllCanisterId, { agentOptions: { identity } });
            const result = await rllActor.start_rll_main_loop();
            console.log('Main loop started:', result);
            // Refresh status
            await fetchImportStatus();
        } catch (error) {
            console.error('Error starting main loop:', error);
        }
    };

    const handleStopMainLoop = async () => {
        if (!isAdmin) return;
        try {
            const rllActor = createRllActor(rllCanisterId, { agentOptions: { identity } });
            const result = await rllActor.stop_rll_main_loop();
            console.log('Main loop stopped:', result);
            // Refresh status
            await fetchImportStatus();
        } catch (error) {
            console.error('Error stopping main loop:', error);
        }
    };

    // Add function to fetch token distribution limits
    const fetchTokenDistributionLimits = async () => {
        if (!tokens.length) return;
        setLoadingDistributionLimits(true);
        try {
            const agent = new HttpAgent({
                host: 'https://ic0.app'
            });
            await agent.fetchRootKey();
            
            const rllActor = createRllActor(rllCanisterId, {
                agentOptions: { agent }
            });

            // Get all min and max distributions in parallel
            const [allMinDist, allMaxDist] = await Promise.all([
                rllActor.get_all_token_min_distributions(),
                rllActor.get_all_token_max_distributions()
            ]);

            // Convert arrays to maps for easier lookup
            const minDistMap = new Map(allMinDist.map(([principal, amount]) => [principal.toString(), amount]));
            const maxDistMap = new Map(allMaxDist.map(([principal, amount]) => [principal.toString(), amount]));

            // Create limits object only for tokens that have either min or max set
            const limits = {};
            for (const token of tokens) {
                const tokenId = token.ledger_id.toString();
                const min = minDistMap.get(tokenId);
                const max = maxDistMap.get(tokenId);
                
                if (min || max) {
                    limits[tokenId] = {
                        min: min ? [min] : null,
                        max: max ? [max] : null
                    };
                }
            }
            
            setTokenDistributionLimits(limits);
        } catch (error) {
            console.error('Error fetching token distribution limits:', error);
        } finally {
            setLoadingDistributionLimits(false);
        }
    };

    // Add function to set token distribution limits
    const handleSetDistributionLimits = async (tokenId) => {
        if (!isAdmin || !tokenId) return;
        try {
            const rllActor = createRllActor(rllCanisterId, { agentOptions: { identity } });
            
            if (newMinAmount) {
                const minAmount = BigInt(Math.floor(Number(newMinAmount) * Math.pow(10, 8)));
                await rllActor.set_token_min_distribution(Principal.fromText(tokenId), minAmount);
            }
            
            if (newMaxAmount) {
                const maxAmount = BigInt(Math.floor(Number(newMaxAmount) * Math.pow(10, 8)));
                await rllActor.set_token_max_distribution(Principal.fromText(tokenId), maxAmount);
            }
            
            // Refresh the limits
            await fetchTokenDistributionLimits();
            
            // Clear the input fields
            setNewMinAmount('');
            setNewMaxAmount('');
            setSelectedToken(null);
        } catch (error) {
            console.error('Error setting distribution limits:', error);
        }
    };

    // Add function to remove token distribution limits
    const handleRemoveDistributionLimits = async (tokenId) => {
        if (!isAdmin || !tokenId) return;
        try {
            const rllActor = createRllActor(rllCanisterId, { agentOptions: { identity } });
            
            // Remove both min and max limits
            await rllActor.remove_token_min_distribution(Principal.fromText(tokenId));
            await rllActor.remove_token_max_distribution(Principal.fromText(tokenId));
            
            // Refresh the limits
            await fetchTokenDistributionLimits();
        } catch (error) {
            console.error('Error removing distribution limits:', error);
        }
    };

    // Add useEffect to fetch token distribution limits when tokens are loaded
    useEffect(() => {
        if (tokens.length > 0) {
            fetchTokenDistributionLimits();
        }
    }, [tokens]);

    // Add function to check admin status
    const checkAdminStatus = async () => {
        if (!identity) {
            setIsAdmin(false);
            return;
        }
        try {
            const rllActor = createRllActor(rllCanisterId, { agentOptions: { identity } });
            const isAdminResult = await rllActor.principal_is_admin(identity.getPrincipal());
            console.log('Admin check result:', isAdminResult);
            setIsAdmin(isAdminResult);
        } catch (error) {
            console.error('Error checking admin status:', error);
            setIsAdmin(false);
        }
    };

    // Add useEffect to check admin status when identity changes
    useEffect(() => {
        if (identity) {
            checkAdminStatus();
        } else {
            setIsAdmin(false);
        }
    }, [identity]);

    useEffect(() => {
        const fetchEventStats = async () => {
            try {
                const agent = new HttpAgent({
                    host: 'https://ic0.app'
                });
                await agent.fetchRootKey();
                
                const rllActor = createRllActor(rllCanisterId, {
                    agentOptions: { agent }
                });

                const stats = await rllActor.get_event_statistics();
                console.log('Event statistics:', stats);
                
                // Enhanced debugging to compare all_time vs last_24h
                console.log('=== EVENT STATISTICS DEBUGGING ===');
                console.log('All Time Claims Total:', stats.all_time.claims.total.toString());
                console.log('Last 24h Claims Total:', stats.last_24h.claims.total.toString());
                console.log('All Time Claims Successful:', stats.all_time.claims.successful.toString());
                console.log('Last 24h Claims Successful:', stats.last_24h.claims.successful.toString());
                console.log('All Time Claims Failed:', stats.all_time.claims.failed.toString());
                console.log('Last 24h Claims Failed:', stats.last_24h.claims.failed.toString());
                console.log('All Time Claims Pending:', stats.all_time.claims.pending.toString());
                console.log('Last 24h Claims Pending:', stats.last_24h.claims.pending.toString());
                console.log('All Time Claims Unique Users:', stats.all_time.claims.unique_users.toString());
                console.log('Last 24h Claims Unique Users:', stats.last_24h.claims.unique_users.toString());
                
                // Check if values are identical
                const allTimeTotal = stats.all_time.claims.total.toString();
                const last24hTotal = stats.last_24h.claims.total.toString();
                const allTimeSuccessful = stats.all_time.claims.successful.toString();
                const last24hSuccessful = stats.last_24h.claims.successful.toString();
                
                if (allTimeTotal === last24hTotal && allTimeSuccessful === last24hSuccessful) {
                    console.warn('⚠️ ISSUE DETECTED: All-time and 24h statistics are identical!');
                    console.warn('This suggests the backend RLL canister is not calculating 24h statistics correctly.');
                } else {
                    console.log('✅ All-time and 24h statistics appear to be different as expected.');
                }
                console.log('=== END DEBUGGING ===');
                
                setEventStats(stats);
            } catch (error) {
                console.error('Error fetching event statistics:', error);
            } finally {
                setLoadingEventStats(false);
            }
        };

        fetchEventStats();
        // Refresh every minute
        const interval = setInterval(fetchEventStats, 60000);
        return () => clearInterval(interval);
    }, []);

    useEffect(() => {
        const fetchErrorAndUnmatchedClaims = async () => {
            if (!isAdmin) return;
            
            try {
                const rllActor = createRllActor(rllCanisterId, { agentOptions: { identity } });
                
                setLoadingErrorClaims(true);
                setLoadingUnmatchedClaims(true);
                
                const [errorResult, unmatchedResult] = await Promise.all([
                    rllActor.get_error_claim_events(),
                    rllActor.get_unmatched_pending_claims()
                ]);

                if ('ok' in errorResult) {
                    setErrorClaims(errorResult.ok);
                } else {
                    console.error('Error fetching error claims:', errorResult.err);
                }

                if ('ok' in unmatchedResult) {
                    setUnmatchedPendingClaims(unmatchedResult.ok);
                } else {
                    console.error('Error fetching unmatched claims:', unmatchedResult.err);
                }
            } catch (error) {
                console.error('Error fetching claims data:', error);
            } finally {
                setLoadingErrorClaims(false);
                setLoadingUnmatchedClaims(false);
            }
        };

        if (isAdmin && identity) {
            fetchErrorAndUnmatchedClaims();
            // Refresh every minute
            const interval = setInterval(fetchErrorAndUnmatchedClaims, 60000);
            return () => clearInterval(interval);
        }
    }, [isAdmin, identity]);

    const formatTokenAmount = (amount, tokenId) => {
        const token = tokens.find(t => t.ledger_id.toString() === tokenId.toString());
        if (!token) return amount.toString();
        return (Number(amount) / Math.pow(10, token.decimals)).toFixed(token.decimals);
    };

    const getTokenSymbol = (tokenId) => {
        const token = tokens.find(t => t.ledger_id.toString() === tokenId.toString());
        return token ? token.symbol : tokenId.toString().slice(0, 10) + '...';
    };

    // Helper function to check if 24h data is identical to all-time data
    const isDataIdentical = () => {
        if (!eventStats) return false;
        
        const allTime = eventStats.all_time.claims;
        const last24h = eventStats.last_24h.claims;
        
        return (
            allTime.total.toString() === last24h.total.toString() &&
            allTime.successful.toString() === last24h.successful.toString() &&
            allTime.failed.toString() === last24h.failed.toString() &&
            allTime.pending.toString() === last24h.pending.toString() &&
            allTime.unique_users.toString() === last24h.unique_users.toString()
        );
    };

    return (
        <div className='page-container' style={{ background: theme.colors.primaryGradient, minHeight: '100vh' }}>
            <Header />
            <main className="rll-container">
                <h1 style={{ color: theme.colors.primaryText, display: 'flex', alignItems: 'center', gap: '8px' }}>
                    Rewards Distribution Server
                    <span 
                        style={styles.infoIcon} 
                        title="The Rewards Distribution Server manages token rewards for Sneed DAO participants based on their voting activity and neuron holdings"
                    >
                        i
                    </span>
                </h1>
                
                <section style={styles.section}>
                    <div style={styles.sectionHeader}>
                        <h2 style={styles.heading}>
                            Rewards Statistics
                            <span 
                                style={styles.infoIcon} 
                                title="Overview of all Reward events including distributions and claims per token"
                            >
                                i
                            </span>
                        </h2>
                        <button 
                            onClick={() => setExpandedSections(prev => ({ ...prev, rewardsStatistics: !prev.rewardsStatistics }))}
                            style={styles.expandButton}
                        >
                            {expandedSections.rewardsStatistics ? '▼' : '▶'}
                        </button>
                    </div>
                    {expandedSections.rewardsStatistics && (loadingEventStats || loadingTokens ? (
                        <div style={styles.spinner} />
                    ) : eventStats && (
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
                            {/* All Time Stats */}
                            <div style={{ background: theme.colors.tertiaryBg, border: `1px solid ${theme.colors.border}`, padding: '20px', borderRadius: '8px', boxShadow: theme.colors.cardShadow }}>
                                <h3 style={{ color: theme.colors.accent, marginBottom: '15px' }}>All Time Statistics</h3>
                                
                                <div style={{ marginBottom: '20px' }}>
                                    <h4 style={{ color: theme.colors.success, marginBottom: '10px' }}>Server Distributions</h4>
                                    <div style={styles.statusItem}>
                                        <span>Total Count:</span>
                                        <span>{eventStats.all_time.server_distributions.total.toString()}</span>
                                    </div>
                                    {eventStats.all_time.server_distributions.per_token.map(([tokenId, amount]) => (
                                        <div key={tokenId.toString()} style={styles.statusItem}>
                                            <span>{getTokenSymbol(tokenId)}:</span>
                                            <span>{formatTokenAmount(amount, tokenId)}</span>
                                        </div>
                                    ))}
                                </div>

                                <div style={{ marginBottom: '20px' }}>
                                    <h4 style={{ color: theme.colors.error, marginBottom: '10px' }}>User Distributions</h4>
                                    <div style={styles.statusItem}>
                                        <span>Total Count:</span>
                                        <span>{eventStats.all_time.user_distributions.total.toString()}</span>
                                    </div>
                                    {eventStats.all_time.user_distributions.per_token.map(([tokenId, amount]) => (
                                        <div key={tokenId.toString()} style={styles.statusItem}>
                                            <span>{getTokenSymbol(tokenId)}:</span>
                                            <span>{formatTokenAmount(amount, tokenId)}</span>
                                        </div>
                                    ))}
                                    <div style={styles.statusItem}>
                                        <span>Unique Users:</span>
                                        <span>{eventStats.all_time.user_distributions.unique_users.toString()}</span>
                                    </div>
                                </div>

                                <div>
                                    <h4 style={{ color: theme.colors.warning, marginBottom: '10px' }}>Claims</h4>
                                    <div style={styles.statusItem}>
                                        <span>Total Count:</span>
                                        <span>{eventStats.all_time.claims.pending.toString()}</span>
                                    </div>
                                    {eventStats.all_time.claims.per_token.map(([tokenId, amount]) => (
                                        <div key={tokenId.toString()} style={styles.statusItem}>
                                            <span>{getTokenSymbol(tokenId)}:</span>
                                            <span>{formatTokenAmount(amount, tokenId)}</span>
                                        </div>
                                    ))}
                                    <div style={styles.statusItem}>
                                        <span>Successful:</span>
                                        <span style={{ color: theme.colors.success }}>{eventStats.all_time.claims.successful.toString()}</span>
                                    </div>
                                    <div style={styles.statusItem}>
                                        <span>Failed:</span>
                                        <span style={{ color: theme.colors.error }}>{eventStats.all_time.claims.failed.toString()}</span>
                                    </div>
                                    {(eventStats.all_time.claims.pending - eventStats.all_time.claims.successful - eventStats.all_time.claims.failed) > 0 && (
                                        <div style={styles.statusItem}>
                                            <span>Pending:</span>
                                            <span style={{ color: theme.colors.warning }}>
                                                {(eventStats.all_time.claims.pending - eventStats.all_time.claims.successful - eventStats.all_time.claims.failed).toString()}
                                            </span>
                                        </div>
                                    )}
                                    <div style={styles.statusItem}>
                                        <span>Unique Users:</span>
                                        <span>{eventStats.all_time.claims.unique_users.toString()}</span>
                                    </div>
                                </div>
                            </div>

                            {/* Last 24h Stats */}
                            <div style={{ background: theme.colors.tertiaryBg, border: `1px solid ${theme.colors.border}`, boxShadow: theme.colors.cardShadow, padding: '20px', borderRadius: '8px' }}>
                                <h3 style={{ 
                                    color: theme.colors.accent, 
                                    marginBottom: '15px',
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '10px'
                                }}>
                                    Last 24 Hours
                                    {isDataIdentical() && (
                                        <span 
                                            style={{
                                                background: `linear-gradient(135deg, ${theme.colors.error}, ${theme.colors.error}dd)`,
                                                color: theme.colors.primaryBg,
                                                fontSize: '12px',
                                                padding: '4px 8px',
                                                borderRadius: '4px',
                                                fontWeight: 'normal'
                                            }}
                                            title="Warning: 24h data appears identical to all-time data. This indicates a backend issue with the Rewards Distribution canister's 24h statistics calculation."
                                        >
                                            ⚠️ Data Issue
                                        </span>
                                    )}
                                </h3>
                                
                                <div style={{ marginBottom: '20px' }}>
                                    <h4 style={{ color: theme.colors.success, marginBottom: '10px' }}>Server Distributions</h4>
                                    <div style={styles.statusItem}>
                                        <span>Total Count:</span>
                                        <span>{eventStats.last_24h.server_distributions.total.toString()}</span>
                                    </div>
                                    {eventStats.last_24h.server_distributions.per_token.map(([tokenId, amount]) => (
                                        <div key={tokenId.toString()} style={styles.statusItem}>
                                            <span>{getTokenSymbol(tokenId)}:</span>
                                            <span>{formatTokenAmount(amount, tokenId)}</span>
                                        </div>
                                    ))}
                                </div>

                                <div style={{ marginBottom: '20px' }}>
                                    <h4 style={{ color: theme.colors.error, marginBottom: '10px' }}>User Distributions</h4>
                                    <div style={styles.statusItem}>
                                        <span>Total Count:</span>
                                        <span>{eventStats.last_24h.user_distributions.total.toString()}</span>
                                    </div>
                                    {eventStats.last_24h.user_distributions.per_token.map(([tokenId, amount]) => (
                                        <div key={tokenId.toString()} style={styles.statusItem}>
                                            <span>{getTokenSymbol(tokenId)}:</span>
                                            <span>{formatTokenAmount(amount, tokenId)}</span>
                                        </div>
                                    ))}
                                    <div style={styles.statusItem}>
                                        <span>Unique Users:</span>
                                        <span>{eventStats.last_24h.user_distributions.unique_users.toString()}</span>
                                    </div>
                                </div>

                                <div>
                                    <h4 style={{ color: theme.colors.warning, marginBottom: '10px' }}>Claims</h4>
                                    <div style={styles.statusItem}>
                                        <span>Total Count:</span>
                                        <span>{eventStats.last_24h.claims.pending.toString()}</span>
                                    </div>
                                    {eventStats.last_24h.claims.per_token.map(([tokenId, amount]) => (
                                        <div key={tokenId.toString()} style={styles.statusItem}>
                                            <span>{getTokenSymbol(tokenId)}:</span>
                                            <span>{formatTokenAmount(amount, tokenId)}</span>
                                        </div>
                                    ))}
                                    <div style={styles.statusItem}>
                                        <span>Successful:</span>
                                        <span style={{ color: theme.colors.success }}>{eventStats.last_24h.claims.successful.toString()}</span>
                                    </div>
                                    <div style={styles.statusItem}>
                                        <span>Failed:</span>
                                        <span style={{ color: theme.colors.error }}>{eventStats.last_24h.claims.failed.toString()}</span>
                                    </div>
                                    {(eventStats.last_24h.claims.pending - eventStats.last_24h.claims.successful - eventStats.last_24h.claims.failed) > 0 && (
                                        <div style={styles.statusItem}>
                                            <span>Pending:</span>
                                            <span style={{ color: theme.colors.warning }}>
                                                {(eventStats.last_24h.claims.pending - eventStats.last_24h.claims.successful - eventStats.last_24h.claims.failed).toString()}
                                            </span>
                                        </div>
                                    )}
                                    <div style={styles.statusItem}>
                                        <span>Unique Users:</span>
                                        <span>{eventStats.last_24h.claims.unique_users.toString()}</span>
                                    </div>
                                </div>
                            </div>
                        </div>
                    ))}
                </section>

                {/* Data Issue Warning */}
                {eventStats && isDataIdentical() && (
                    <div style={{
                        background: `linear-gradient(135deg, ${theme.colors.error}, ${theme.colors.error}dd)`,
                        borderRadius: '8px',
                        padding: '15px',
                        marginTop: '20px',
                        color: theme.colors.primaryBg
                    }}>
                        <h3 style={{ margin: '0 0 10px 0', display: 'flex', alignItems: 'center', gap: '8px' }}>
                            ⚠️ Data Issue Detected
                        </h3>
                        <p style={{ margin: '0 0 10px 0' }}>
                            The "Last 24 Hours" statistics are showing identical values to the "All Time" statistics. 
                            This indicates an issue with the RLL canister's 24-hour statistics calculation.
                        </p>
                        <p style={{ margin: '0', fontSize: '14px', opacity: '0.9' }}>
                            <strong>Technical Details:</strong> The backend RLL canister's <code>get_event_statistics()</code> function 
                            should return different values for <code>last_24h</code> and <code>all_time</code> periods, but they are currently identical. 
                            Check the browser console for detailed debugging information.
                        </p>
                    </div>
                )}

                {/* Balance Reconciliation */}
                <section style={styles.section}>
                    <div style={styles.sectionHeader}>
                        <h2 style={styles.heading}>
                            Balance Reconciliation
                            <span 
                                style={styles.infoIcon} 
                                title="Overview of token balances held by the Rewards Distribution Server for distribution, including total distributed amounts and currently claimable rewards"
                            >
                                i
                            </span>
                        </h2>
                        <button 
                            onClick={() => setExpandedSections(prev => ({ ...prev, balanceReconciliation: !prev.balanceReconciliation }))}
                            style={styles.expandButton}
                        >
                            {expandedSections.balanceReconciliation ? '▼' : '▶'}
                        </button>
                    </div>
                    {expandedSections.balanceReconciliation && (loadingReconciliation ? (
                        <div style={styles.spinner} />
                    ) : (
                    <div style={styles.reconciliationList}>
                        {reconciliation.map(item => {
                            const token = tokens.find(t => t.ledger_id.toString() === item.token_id.toString());
                            const symbol = token ? token.symbol : 'Unknown';
                            const decimals = token ? token.decimals : 8;
                            const totalDistributed = distributions && distributions[item.token_id.toString()];
                            return (
                                <div key={item.token_id.toText()} style={{
                                    background: theme.colors.tertiaryBg, border: `1px solid ${theme.colors.border}`, boxShadow: theme.colors.cardShadow,
                                    borderRadius: '6px',
                                    padding: '15px',
                                    marginBottom: '10px'
                                }}>
                                    <div style={{ fontWeight: 'bold', marginBottom: '10px' }}>{symbol}</div>
                                    <div style={styles.statusItem}>
                                        <span>Token:</span>
                                        <span style={{fontWeight: 'bold'}}>{symbol}</span>
                                    </div>
                                    {totalDistributed !== undefined && (
                                        <div style={styles.statusItem}>
                                            <span>All-Time Distributed:</span>
                                            <span style={{fontFamily: 'monospace'}}>{formatBalance(totalDistributed, decimals)} {symbol}</span>
                                        </div>
                                    )}
                                    <div style={styles.statusItem}>
                                        <span>Currently Claimable:</span>
                                        <span style={{fontFamily: 'monospace'}}>{formatBalance(item.local_total, decimals)} {symbol}</span>
                                    </div>
                                    <div style={styles.statusItem}>
                                        <span>Server Balance:</span>
                                        <span style={{fontFamily: 'monospace'}}>{formatBalance(item.server_balance, decimals)} {symbol}</span>
                                    </div>
                                    <div style={styles.statusItem}>
                                        <span>Remaining:</span>
                                        <span style={{
                                            fontFamily: 'monospace',
                                            color: Number(item.remaining) > 0 ? '#2ecc71' : '#ffffff'
                                        }}>{formatBalance(item.remaining, decimals)} {symbol}</span>
                                    </div>
                                    {Number(item.underflow) > 0 && (
                                        <div style={{...styles.statusItem, color: theme.colors.error}}>
                                            <span>Underflow:</span>
                                            <span style={{fontFamily: 'monospace'}}>{formatBalance(item.underflow, decimals)} {symbol}</span>
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                    ))}
                </section>

                {/* Token Distribution Limits */}
                <section style={styles.section}>
                    <div style={styles.sectionHeader}>
                        <h2 style={styles.heading}>
                            Token Distribution Limits
                            <span 
                                style={styles.infoIcon} 
                                title="Distribution limits control token rewards: Min ensures users receive meaningful amounts (smaller rewards accumulate until min is reached), while Max caps the reward size per cycle (excess rewards carry over to future cycles)"
                            >
                                i
                            </span>
                        </h2>
                        <button 
                            onClick={() => setExpandedSections(prev => ({ ...prev, distributionLimits: !prev.distributionLimits }))}
                            style={styles.expandButton}
                        >
                            {expandedSections.distributionLimits ? '▼' : '▶'}
                        </button>
                    </div>
                    {expandedSections.distributionLimits && (loadingDistributionLimits ? (
                        <div style={styles.spinner} />
                    ) : (
                        <div style={styles.tokenList}>
                            {tokens
                                .filter(token => {
                                    const limits = tokenDistributionLimits[token.ledger_id.toString()];
                                    return limits && (limits.min?.[0] || limits.max?.[0]);
                                })
                                .map(token => {
                                    const limits = tokenDistributionLimits[token.ledger_id.toString()];
                                    return (
                                        <div key={token.ledger_id.toString()} style={styles.tokenItem}>
                                            <div style={styles.tokenSymbol}>{token.symbol}</div>
                                            <div style={styles.tokenBalance}>
                                                <div>
                                                    Min: {limits?.min?.[0] ? (Number(limits.min[0]) / Math.pow(10, token.decimals)).toFixed(token.decimals) : 'Not set'}
                                                    {' | '}
                                                    Max: {limits?.max?.[0] ? (Number(limits.max[0]) / Math.pow(10, token.decimals)).toFixed(token.decimals) : 'Not set'}
                                                </div>
                                            </div>
                                        </div>
                                    );
                                })
                            }
                        </div>
                    ))}
                </section>

                {/* Distribution Cycle Status */}
                <section style={styles.section}>
                    <div style={styles.sectionHeader}>
                        <h2 style={styles.heading}>
                            Distribution Cycle Status
                            <span 
                                style={styles.infoIcon} 
                                title="Current status of the Rewards distribution cycle, including timing information and cycle frequency"
                            >
                                i
                            </span>
                        </h2>
                        <button 
                            onClick={() => setExpandedSections(prev => ({ ...prev, distributionCycle: !prev.distributionCycle }))}
                            style={styles.expandButton}
                        >
                            {expandedSections.distributionCycle ? '▼' : '▶'}
                        </button>
                    </div>
                    {expandedSections.distributionCycle && <div style={styles.cycleInfo}>
                        <div style={styles.statusItem}>
                            <span>Status:</span>
                            <span style={{
                                color: mainLoopStatus?.isRunning ? '#2ecc71' : '#e74c3c'
                            }}>
                                {mainLoopStatus?.isRunning ? 'Running' : 'Stopped'}
                            </span>
                        </div>
                        <div style={styles.statusItem}>
                            <span>Current Stage:</span>
                            <span style={{
                                color: importStage.includes('idle') ? '#f1c40f' : '#2ecc71',
                                fontFamily: 'monospace'
                            }}>
                                {importStage}
                            </span>
                        </div>
                        <div style={styles.statusItem}>
                            <span>Last Started:</span>
                            <span>{mainLoopStatus?.lastStarted ? formatNanoTimestamp(mainLoopStatus.lastStarted) : 'Never'}</span>
                        </div>
                        <div style={styles.statusItem}>
                            <span>Last Stopped:</span>
                            <span>{mainLoopStatus?.lastStopped ? formatNanoTimestamp(mainLoopStatus.lastStopped) : 'Never'}</span>
                        </div>
                        <div style={styles.statusItem}>
                            <span>Last Cycle Started:</span>
                            <span>{mainLoopStatus?.lastCycleStarted ? formatNanoTimestamp(mainLoopStatus.lastCycleStarted) : 'Never'}</span>
                        </div>
                        <div style={styles.statusItem}>
                            <span>Last Cycle Ended:</span>
                            <span>{mainLoopStatus?.lastCycleEnded ? formatNanoTimestamp(mainLoopStatus.lastCycleEnded) : 'Never'}</span>
                        </div>
                        <div style={styles.statusItem}>
                            <span>Next Scheduled:</span>
                            <span>{mainLoopStatus?.nextScheduled ? formatNanoTimestamp(mainLoopStatus.nextScheduled) : 'Not scheduled'}</span>
                        </div>
                        <div style={styles.statusItem}>
                            <span>Frequency:</span>
                            <span>{mainLoopStatus?.frequencySeconds ? formatDuration(Number(mainLoopStatus.frequencySeconds)) : 'Unknown'}</span>
                        </div>
                    </div>}
                </section>


                {/* Import Status Section */}
                <section style={styles.section}>
                    <div style={styles.sectionHeader}>
                        <h2 style={styles.heading}>
                            Import Status
                            <span 
                                style={styles.infoIcon} 
                                title="Statistics about imported data from the Sneed governance system, including neurons, owners, and proposals"
                            >
                                i
                            </span>
                        </h2>
                        <button 
                            onClick={() => setExpandedSections(prev => ({ ...prev, importStatus: !prev.importStatus }))}
                            style={styles.expandButton}
                        >
                            {expandedSections.importStatus ? '▼' : '▶'}
                        </button>
                    </div>
                    {expandedSections.importStatus && <div style={styles.statusGrid}>
                        <div style={styles.statusItem}>
                            <span>Imported Neurons:</span>
                            <span>{Number(importedNeuronsCount).toLocaleString()}</span>
                        </div>
                        <div style={styles.statusItem}>
                            <span>Imported Owners:</span>
                            <span>{Number(importedOwnersCount).toLocaleString()}</span>
                        </div>
                        <div style={styles.statusItem}>
                            <span>Imported Proposals:</span>
                            <span>{Number(importedPropsCount).toLocaleString()}</span>
                        </div>
                        <div style={styles.statusItem}>
                            <span>Highest Closed Proposal:</span>
                            <span>{Number(highestClosedProposalId).toLocaleString()}</span>
                        </div>
                    </div>}
                </section>
                {/* Admin Controls */}
                {isAdmin && (
                    <>
                        <section style={styles.section}>
                            <div style={styles.sectionHeader}>
                                <h2 style={styles.heading}>
                                    Admin Controls
                                    <span 
                                        style={styles.infoIcon} 
                                        title="Administrative functions for managing the Rewards Distribution system, including cycle control and data import operations"
                                    >
                                        i
                                    </span>
                                </h2>
                                <button 
                                    onClick={() => setExpandedSections(prev => ({ ...prev, adminControls: !prev.adminControls }))}
                                    style={styles.expandButton}
                                >
                                    {expandedSections.adminControls ? '▼' : '▶'}
                                </button>
                            </div>
                            {expandedSections.adminControls && <div style={styles.adminControls}>
                                <button 
                                    onClick={handleStartDistributionCycle}
                                    style={styles.adminButton}
                                >
                                    Start Distribution Cycle
                                </button>
                                <button 
                                    onClick={handleStopDistributionCycle}
                                    style={styles.adminButton}
                                >
                                    Stop Distribution Cycle
                                </button>
                                <button 
                                    onClick={handleImportAllNeurons}
                                    style={styles.adminButton}
                                >
                                    Import All Neurons
                                </button>
                                <button 
                                    onClick={handleImportAllProposals}
                                    style={styles.adminButton}
                                >
                                    Import All Proposals
                                </button>
                                <button 
                                    onClick={handleStartMainLoop}
                                    style={styles.adminButton}
                                >
                                    Start Main Loop
                                </button>
                                <button 
                                    onClick={handleStopMainLoop}
                                    style={styles.adminButton}
                                >
                                    Stop Main Loop
                                </button>
                            </div>}
                        </section>

                        {/* Token Distribution Limits Admin Section */}
                        <section style={styles.section}>
                            <div style={styles.sectionHeader}>
                                <h2 style={styles.heading}>
                                    Manage Token Distribution Limits
                                    <span 
                                        style={styles.infoIcon} 
                                        title="Set or remove minimum and maximum distribution limits for each token"
                                    >
                                        i
                                    </span>
                                </h2>
                                <button 
                                    onClick={() => setExpandedSections(prev => ({ ...prev, manageDistributionLimits: !prev.manageDistributionLimits }))}
                                    style={styles.expandButton}
                                >
                                    {expandedSections.manageDistributionLimits ? '▼' : '▶'}
                                </button>
                            </div>
                            {expandedSections.manageDistributionLimits && <div style={{
                                background: theme.colors.tertiaryBg, border: `1px solid ${theme.colors.border}`, boxShadow: theme.colors.cardShadow,
                                borderRadius: '6px',
                                padding: '20px',
                                marginBottom: '20px'
                            }}>
                                <div style={{ marginBottom: '15px' }}>
                                    <label style={{ display: 'block', marginBottom: '5px' }}>Select Token:</label>
                                    <select 
                                        value={selectedToken || ''}
                                        onChange={(e) => setSelectedToken(e.target.value)}
                                        style={{
                                            width: '100%',
                                            padding: '8px',
                                            background: theme.colors.cardGradient, 
                                            boxShadow: theme.colors.cardShadow,
                                            color: theme.colors.primaryBg,
                                            border: `1px solid ${theme.colors.border}`,
                                            borderRadius: '4px',
                                            marginBottom: '10px'
                                        }}
                                    >
                                        <option value="">Select a token</option>
                                        {tokens.map(token => (
                                            <option key={token.ledger_id.toString()} value={token.ledger_id.toString()}>
                                                {token.symbol}
                                            </option>
                                        ))}
                                    </select>
                                </div>

                                <div style={{ marginBottom: '15px' }}>
                                    <label style={{ display: 'block', marginBottom: '5px' }}>Minimum Distribution:</label>
                                    <input
                                        type="number"
                                        value={newMinAmount}
                                        onChange={(e) => setNewMinAmount(e.target.value)}
                                        placeholder="Enter minimum amount"
                                        style={{
                                            width: '100%',
                                            padding: '8px',
                                            background: theme.colors.cardGradient, 
                                            boxShadow: theme.colors.cardShadow,
                                            color: theme.colors.primaryBg,
                                            border: `1px solid ${theme.colors.border}`,
                                            borderRadius: '4px'
                                        }}
                                    />
                                </div>

                                <div style={{ marginBottom: '15px' }}>
                                    <label style={{ display: 'block', marginBottom: '5px' }}>Maximum Distribution:</label>
                                    <input
                                        type="number"
                                        value={newMaxAmount}
                                        onChange={(e) => setNewMaxAmount(e.target.value)}
                                        placeholder="Enter maximum amount"
                                        style={{
                                            width: '100%',
                                            padding: '8px',
                                            background: theme.colors.cardGradient, 
                                            boxShadow: theme.colors.cardShadow,
                                            color: theme.colors.primaryBg,
                                            border: `1px solid ${theme.colors.border}`,
                                            borderRadius: '4px'
                                        }}
                                    />
                                </div>

                                <div style={{ display: 'flex', gap: '10px' }}>
                                    <button
                                        onClick={() => handleSetDistributionLimits(selectedToken)}
                                        disabled={!selectedToken}
                                        style={{
                                            ...styles.adminButton,
                                            opacity: !selectedToken ? 0.5 : 1
                                        }}
                                    >
                                        Set Limits
                                    </button>
                                    <button
                                        onClick={() => handleRemoveDistributionLimits(selectedToken)}
                                        disabled={!selectedToken}
                                        style={{
                                            ...styles.adminButton,
                                            background: `linear-gradient(135deg, ${theme.colors.error}, ${theme.colors.error}dd)`,
                                            opacity: !selectedToken ? 0.5 : 1
                                        }}
                                    >
                                        Remove Limits
                                    </button>
                                </div>
                            </div>}
                        </section>

                        <section style={styles.section}>
                            <div style={styles.sectionHeader}>
                                <h2 style={styles.heading}>
                                    Error Claims & Unmatched Pending Claims
                                    <span 
                                        style={styles.infoIcon} 
                                        title="List of claims that encountered errors or are pending without matches"
                                    >
                                        i
                                    </span>
                                </h2>
                                <button 
                                    onClick={() => setExpandedSections(prev => ({ ...prev, errorClaims: !prev.errorClaims }))}
                                    style={styles.expandButton}
                                >
                                    {expandedSections.errorClaims ? '▼' : '▶'}
                                </button>
                            </div>
                            {expandedSections.errorClaims && (loadingErrorClaims || loadingUnmatchedClaims ? (
                                <div style={styles.spinner} />
                            ) : (
                                <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '20px' }}>
                                    {/* Error Claims */}
                                    <div>
                                        <h3 style={{ color: theme.colors.error, marginBottom: '15px' }}>Error Claims</h3>
                                        {errorClaims.length > 0 ? (
                                            <div style={styles.eventList}>
                                                {errorClaims.map((event, index) => (
                                                    <div key={index} style={styles.eventItem}>
                                                        <div style={styles.eventHeader}>
                                                            <span>Sequence: {event.sequence_number.toString()}</span>
                                                            <span>{formatNanoTimestamp(event.timestamp)}</span>
                                                        </div>
                                                        <div style={styles.eventDetails}>
                                                            <span>Token: {getTokenSymbol(event.token_id)}</span>
                                                            <span>Amount: {formatTokenAmount(event.amount, event.token_id)}</span>
                                                            <span>Fee: {formatTokenAmount(event.fee, event.token_id)}</span>
                                                            <span>Hotkey: {event.hotkey.toString()}</span>
                                                            {event.error_message && (
                                                                <span style={{ color: theme.colors.error }}>
                                                                    Error: {event.error_message[0]}
                                                                </span>
                                                            )}
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                        ) : (
                                            <p>No error claims found</p>
                                        )}
                                    </div>

                                    {/* Unmatched Pending Claims */}
                                    <div>
                                        <h3 style={{ color: theme.colors.warning, marginBottom: '15px' }}>Unmatched Pending Claims</h3>
                                        {unmatchedPendingClaims.length > 0 ? (
                                            <div style={styles.eventList}>
                                                {unmatchedPendingClaims.map((event, index) => (
                                                    <div key={index} style={styles.eventItem}>
                                                        <div style={styles.eventHeader}>
                                                            <span>Sequence: {event.sequence_number.toString()}</span>
                                                            <span>{formatNanoTimestamp(event.timestamp)}</span>
                                                        </div>
                                                        <div style={styles.eventDetails}>
                                                            <span>Token: {getTokenSymbol(event.token_id)}</span>
                                                            <span>Amount: {formatTokenAmount(event.amount, event.token_id)}</span>
                                                            <span>Fee: {formatTokenAmount(event.fee, event.token_id)}</span>
                                                            <span>Hotkey: {event.hotkey.toString()}</span>
                                                            {event.tx_index && event.tx_index.length > 0 && (
                                                                <span>Transaction ID: {event.tx_index[0].toString()}</span>
                                                            )}
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                        ) : (
                                            <p>No unmatched pending claims found</p>
                                        )}
                                    </div>
                                </div>
                            ))}
                        </section>
                    </>
                )}

                <section style={styles.section}>
                    <div style={styles.sectionHeader}>
                        <h2 style={styles.heading}>
                            Recent Distribution Events
                            <span 
                                style={styles.infoIcon} 
                                title="History of recent token distributions, showing proposal ranges, timestamps, and distributed amounts"
                            >
                                i
                            </span>
                        </h2>
                        <button 
                            onClick={() => setExpandedSections(prev => ({ ...prev, distributionEvents: !prev.distributionEvents }))}
                            style={styles.expandButton}
                        >
                            {expandedSections.distributionEvents ? '▼' : '▶'}
                        </button>
                    </div>
                    {expandedSections.distributionEvents && (loadingEvents ? (
                        <div style={styles.spinner} />
                    ) : (
                        <div style={styles.eventList}>
                            {[...distributionEvents].reverse().slice(0, 5).map((event, index) => (
                                <div key={index} style={styles.eventItem}>
                                    <div style={styles.eventHeader}>
                                        <span>Proposals: {formatProposalRange(event.proposal_range)}</span>
                                        <span>{formatNanoTimestamp(event.timestamp)}</span>
                                    </div>
                                    <div style={styles.eventDetails}>
                                        <span>Amount: {formatBalance(event.amount, getTokenDecimalsByPrincipal(event.token_id.toString()))} {getTokenSymbolByPrincipal(event.token_id.toString())}</span>
                                    </div>
                                </div>
                            ))}
                        </div>
                    ))}
                </section>

                <section style={styles.section}>
                    <div style={styles.sectionHeader}>
                        <h2 style={styles.heading}>
                            Recent Claim Events
                            <span 
                                style={styles.infoIcon} 
                                title="History of recent token claims by users, including timestamps and claimed amounts"
                            >
                                i
                            </span>
                        </h2>
                        <button 
                            onClick={() => setExpandedSections(prev => ({ ...prev, claimEvents: !prev.claimEvents }))}
                            style={styles.expandButton}
                        >
                            {expandedSections.claimEvents ? '▼' : '▶'}
                        </button>
                    </div>
                    {expandedSections.claimEvents && (loadingEvents ? (
                        <div style={styles.spinner} />
                    ) : (
                        <div style={styles.eventList}>
                            {[...claimEvents].reverse().slice(0, 5).map((event, index) => (
                                <div key={index} style={styles.eventItem}>
                                    <div style={styles.eventHeader}>
                                        <span>{
                                            'Success' in event.status ? 'Success' :
                                            'Pending' in event.status ? 'Pending' :
                                            'Failed' in event.status ? 'Failed' :
                                            'Unknown'
                                        }</span>
                                        <span>{formatNanoTimestamp(event.timestamp)}</span>
                                    </div>
                                    <div style={styles.eventDetails}>
                                        <span>Hotkey: {event.hotkey.toString()}</span>
                                        <span>Amount: {formatBalance(event.amount, getTokenDecimalsByPrincipal(event.token_id.toString()))} {getTokenSymbolByPrincipal(event.token_id.toString())}</span>
                                        <span>Fee: {formatBalance(event.fee, getTokenDecimalsByPrincipal(event.token_id.toString()))} {getTokenSymbolByPrincipal(event.token_id.toString())}</span>
                                        <span>Sequence: {event.sequence_number.toString()}</span>
                                        {event.tx_index && event.tx_index.length > 0 && <span>Transaction ID: {event.tx_index[0].toString()}</span>}
                                        {event.error_message && event.error_message.length > 0 && <span>Message: {event.error_message[0]}</span>}
                                    </div>
                                </div>
                            ))}
                        </div>
                    ))}
                </section>

            </main>

            <ConfirmationModal
                show={showConfirmModal}
                message={confirmMessage}
                onConfirm={async () => {
                    console.log('Confirmation dialog OK clicked');
                    try {
                        if (confirmAction) {
                            await confirmAction();
                        }
                    } catch (error) {
                        console.error('Error executing confirm action:', error);
                    } finally {
                        setShowConfirmModal(false);
                    }
                }}
                onCancel={() => setShowConfirmModal(false)}
                onClose={() => setShowConfirmModal(false)}
            />

            {/* Add notification */}
            {notification && (
                <Notification
                    type={notification.type}
                    message={notification.message}
                    onClose={() => setNotification(null)}
                />
            )}

            <style>
                {`
                    @keyframes spin {
                        0% { transform: rotate(0deg); }
                        100% { transform: rotate(360deg); }
                    }
                `}
            </style>
        </div>
    );
}

export default RLL; 