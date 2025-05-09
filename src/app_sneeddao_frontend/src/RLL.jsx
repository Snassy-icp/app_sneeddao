import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Principal } from '@dfinity/principal';
import { useAuth } from './AuthContext';
import { createActor as createLedgerActor } from 'external/icrc1_ledger';
import { createActor as createRllActor, canisterId as rllCanisterId } from 'external/rll';
import { createActor as createBackendActor, canisterId as backendCanisterId } from 'declarations/app_sneeddao_backend';
import { getTokenLogo } from './utils/TokenUtils';
import ConfirmationModal from './ConfirmationModal';
import './Help.css'; // We'll reuse the Help page styling for now
import { Actor, HttpAgent } from '@dfinity/agent';
import { createActor as createSnsGovernanceActor, canisterId as snsGovernanceCanisterId } from 'external/sns_governance';

// Styles
const styles = {
    tokenBalances: {
        backgroundColor: '#2a2a2a',
        borderRadius: '8px',
        padding: '20px',
        marginTop: '20px',
        color: '#ffffff'
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
        backgroundColor: '#3a3a3a',
        borderRadius: '6px',
        boxShadow: '0 2px 4px rgba(0,0,0,0.2)',
        color: '#ffffff'
    },
    tokenSymbol: {
        fontWeight: 'bold',
        marginRight: 'auto',
        color: '#ffffff'
    },
    tokenBalance: {
        fontFamily: 'monospace',
        fontSize: '1.1em',
        color: '#ffffff',
        display: 'flex',
        alignItems: 'center',
        gap: '10px'
    },
    heading: {
        color: '#ffffff',
        marginBottom: '15px'
    },
    spinner: {
        width: '20px',
        height: '20px',
        border: '2px solid #f3f3f3',
        borderTop: '2px solid #3498db',
        borderRadius: '50%',
        animation: 'spin 1s linear infinite',
    },
    controls: {
        marginBottom: '15px',
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        color: '#ffffff'
    },
    checkbox: {
        cursor: 'pointer',
        width: '16px',
        height: '16px',
        accentColor: '#3498db'
    },
    section: {
        backgroundColor: '#2a2a2a',
        borderRadius: '8px',
        padding: '20px',
        marginTop: '20px',
        color: '#ffffff'
    },
    distributionItem: {
        display: 'flex',
        alignItems: 'center',
        padding: '15px',
        backgroundColor: '#3a3a3a',
        borderRadius: '6px',
        boxShadow: '0 2px 4px rgba(0,0,0,0.2)',
        color: '#ffffff',
        marginBottom: '10px'
    },
    distributionLabel: {
        fontWeight: 'bold',
        marginRight: 'auto',
        color: '#ffffff'
    },
    distributionValue: {
        fontFamily: 'monospace',
        fontSize: '1.1em',
        color: '#ffffff'
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
        backgroundColor: '#3a3a3a',
        borderRadius: '6px',
        boxShadow: '0 2px 4px rgba(0,0,0,0.2)',
        color: '#ffffff'
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
        color: '#ffffff'
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
        color: '#ffffff'
    },
    adminControls: {
        display: 'flex',
        flexDirection: 'column',
        gap: '10px'
    },
    adminButton: {
        backgroundColor: '#3498db',
        color: '#ffffff',
        border: 'none',
        borderRadius: '4px',
        padding: '8px 16px',
        cursor: 'pointer',
        fontSize: '16px'
    },
    noNeuronsMessage: {
        backgroundColor: '#2a2a2a',
        padding: '20px',
        borderRadius: '8px',
        color: '#ffffff'
    },
    instructionsList: {
        marginTop: '15px',
        paddingLeft: '20px',
        lineHeight: '1.6'
    },
    principalCode: {
        backgroundColor: '#3a3a3a',
        padding: '4px 8px',
        borderRadius: '4px',
        fontFamily: 'monospace',
        wordBreak: 'break-all'
    },
    expandButton: {
        background: 'none',
        border: 'none',
        color: '#3498db',
        cursor: 'pointer',
        fontSize: '20px',
        padding: '0 10px'
    }
};

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
    const { isAuthenticated, identity } = useAuth();
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
    const [isAdmin, setIsAdmin] = useState(false);
    const [highestClosedProposalId, setHighestClosedProposalId] = useState(null);


    // New state for hotkey neurons
    const [hotkeyNeurons, setHotkeyNeurons] = useState({
        neurons_by_owner: [],
        total_voting_power: 0,
        distribution_voting_power: 0
    });
    const [loadingHotkeyNeurons, setLoadingHotkeyNeurons] = useState(true);

    // Fetch whitelisted tokens
    useEffect(() => {
        const fetchTokens = async () => {
            console.log('Starting to fetch whitelisted tokens...');
            try {
                const backendActor = createBackendActor(backendCanisterId, {
                    agentOptions: {
                        identity,
                    },
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

        if (isAuthenticated) {
            console.log('User is authenticated, fetching tokens...');
            fetchTokens();
        } else {
            console.log('User is not authenticated, skipping token fetch');
        }
    }, [isAuthenticated, identity]);

    // Fetch total distributions
    useEffect(() => {
        const fetchDistributions = async () => {
            if (!isAuthenticated) {
                console.log('Skipping distributions fetch - not authenticated');
                return;
            }
            
            console.log('Starting to fetch total distributions...');
            setLoadingDistributions(true);
            try {
                const rllActor = createRllActor(rllCanisterId, {
                    agentOptions: {
                        identity,
                    },
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
    }, [isAuthenticated, identity]);

    // Fetch events
    useEffect(() => {
        const fetchEvents = async () => {
            if (!isAuthenticated) {
                console.log('Skipping events fetch - not authenticated');
                return;
            }
            
            console.log('Starting to fetch events...');
            setLoadingEvents(true);
            try {
                const rllActor = createRllActor(rllCanisterId, {
                    agentOptions: {
                        identity,
                    },
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
    }, [isAuthenticated, identity]);

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
                const rllActor = createRllActor(rllCanisterId, {
                    agentOptions: {
                        identity,
                    },
                });
                console.log('Created RLL actor, fetching user balances...');
                const balances = await rllActor.balances_of_hotkey();
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
            if (!isAuthenticated) {
                console.log('Skipping import status fetch - not authenticated');
                return;
            }
            
            console.log('Starting to fetch import status...');
            try {
                const rllActor = createRllActor(rllCanisterId, {
                    agentOptions: { identity }
                });
                
                const [
                    neurons,
                    owners,
                    props,
                    stage,
                    adminStatus,
                    proposalId,
                    loopStatus
                ] = await Promise.all([
                    rllActor.imported_neurons_count(),
                    rllActor.imported_owners_count(),
                    rllActor.imported_props_count(),
                    rllActor.get_import_stage(),
                    rllActor.caller_is_admin(),
                    rllActor.get_highest_closed_proposal_id(),
                    rllActor.get_main_loop_status()
                ]);

                console.log('Received import status:', {
                    neurons,
                    owners,
                    props,
                    stage,
                    adminStatus,
                    proposalId,
                    loopStatus
                });

                setImportedNeuronsCount(neurons);
                setImportedOwnersCount(owners);
                setImportedPropsCount(props);
                setImportStage(stage);
                setIsAdmin(adminStatus);
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
            }
        };

        fetchImportStatus();
    }, [isAuthenticated, identity]);

    // Fetch balance reconciliation
    useEffect(() => {
        const fetchReconciliation = async () => {
            if (!isAuthenticated) {
                console.log('Skipping reconciliation fetch - not authenticated');
                return;
            }
            
            console.log('Starting to fetch balance reconciliation...');
            try {
                const rllActor = createRllActor(rllCanisterId, {
                    agentOptions: { identity }
                });
                
                const reconciliationData = await rllActor.balance_reconciliation();
                console.log('Received reconciliation data:', reconciliationData);
                setReconciliation(reconciliationData);

            } catch (error) {
                console.error('Error fetching reconciliation:', error);
            }
        };

        fetchReconciliation();
    }, [isAuthenticated, identity]);

    // Function to fetch neurons directly from SNS
    const fetchNeuronsFromSns = async () => {
        if (!identity) return [];
        
        try {
            const snsGovActor = createSnsGovernanceActor(snsGovernanceCanisterId, {
              agentOptions: {
                  identity,
              },
          });
            const result = await snsGovActor.list_neurons({
                of_principal: [identity.getPrincipal()],
                limit: 100,
                start_page_at: []
            });
            return result.neurons;
        } catch (error) {
            console.error('Error fetching neurons from SNS:', error);
            return [];
        }
    };

    // Updated function to fetch hotkey neurons data
    const fetchHotkeyNeuronsData = async () => {
        if (!identity) return;
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
        } finally {
            setLoadingHotkeyNeurons(false);
        }
    };

    // Update useEffect to use new function
    useEffect(() => {
        if (isAuthenticated) {
            fetchHotkeyNeuronsData();
        }
    }, [isAuthenticated]);

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
        
        // Store a direct function that will be executed when confirmed
        setConfirmAction(async () => {
            console.log('Executing claim action...');
            try {
                const rllActor = createRllActor(rllCanisterId, { agentOptions: { identity } });
                console.log('Created RLL actor, calling claim_full_balance_of_hotkey...');
                
                const claim_results = await rllActor.claim_full_balance_of_hotkey(
                    tokenId,
                    token.fee
                );
                console.log('Claim results:', claim_results);

                // Refresh all relevant data
                console.log('Refreshing data...');
                const [balances, claims] = await Promise.all([
                    rllActor.balances_of_hotkey(),
                    rllActor.get_claim_events_for_hotkey(identity.getPrincipal())
                ]);
                
                setUserBalances(balances);
                setUserClaimEvents(claims);
                console.log('Data refreshed successfully');
            } catch (error) {
                console.error('Error during claim process:', error);
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
    const getGroupStatus = (events) => {
        if (events.some(e => 'Success' in e.status)) return 'Success';
        if (events.some(e => 'Pending' in e.status)) return 'Pending';
        if (events.some(e => 'Failed' in e.status)) return 'Failed';
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

    return (
        <div className='page-container'>
            <header className="site-header">
                <div className="logo">
                    <Link to="/wallet">
                        <img src="sneedlock-logo-cropped.png" alt="Sneedlock" />
                    </Link>
                </div>
                <nav className="nav-links">
                    <Link to="/help">Help</Link>
                    <Link to="/rll" className="active">RLL</Link>
                </nav>
            </header>
            <main className="help-container">
                <h1 style={{ color: '#ffffff' }}>RLL</h1>
                
                {hotkeyNeurons.neurons_by_owner.length > 0 ? (
                    <>
                        {/* Your Token Balances */}
                        <section style={styles.section}>
                            <h2 style={styles.heading}>Your Token Balances</h2>
                            {loadingUserBalances ? (
                                <div style={styles.spinner} />
                            ) : userBalances.length > 0 ? (
                                <div style={styles.eventList}>
                                    {userBalances.map(([tokenId, balance], index) => {
                                        const token = tokens.find(t => t.ledger_id.toString() === tokenId.toString());
                                        if (!token) return null;
                                        
                                        return (
                                            <div key={index} style={styles.eventItem}>
                                                <div style={styles.eventHeader}>
                                                    <span>{token.symbol}</span>
                                                    {Number(balance) > 0 && (
                                                        <button
                                                            onClick={() => handleClaimRewards(tokenId, balance, token)}
                                                            style={{
                                                                backgroundColor: '#3498db',
                                                                color: '#ffffff',
                                                                border: 'none',
                                                                borderRadius: '4px',
                                                                padding: '4px 8px',
                                                                cursor: 'pointer',
                                                                fontSize: '12px'
                                                            }}
                                                        >
                                                            Claim
                                                        </button>
                                                    )}
                                                </div>
                                                <div style={styles.eventDetails}>
                                                    <span>Balance: {formatBalance(balance, token.decimals)} {token.symbol}</span>
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            ) : (
                                <p style={{ color: '#ffffff' }}>No token balances found</p>
                            )}
                        </section>

                        {/* Your Claim History */}
                        <section style={styles.section}>
                            <div style={styles.sectionHeader}>
                                <h2 style={styles.heading}>Your Claim History</h2>
                                <button 
                                    onClick={() => setIsClaimHistoryExpanded(!isClaimHistoryExpanded)}
                                    style={{
                                        background: 'none',
                                        border: 'none',
                                        color: '#3498db',
                                        cursor: 'pointer',
                                        fontSize: '20px',
                                        padding: '0 10px'
                                    }}
                                >
                                    {isClaimHistoryExpanded ? '▼' : '▶'}
                                </button>
                            </div>
                            {isClaimHistoryExpanded && (
                                loadingUserEvents ? (
                                    <div style={styles.spinner} />
                                ) : userClaimEvents.length > 0 ? (
                                    <div style={styles.claimHistory}>
                                        {Object.entries(groupEventsBySequence(userClaimEvents))
                                            .sort((a, b) => Number(b[0]) - Number(a[0])) // Sort by sequence number descending
                                            .slice(0, 5) // Take only the 5 most recent sequence groups
                                            .map(([seqNum, events]) => {
                                                const status = getGroupStatus(events);
                                                const latestEvent = events[events.length - 1];
                                                const token = tokens.find(t => t.ledger_id.toString() === latestEvent.token_id.toString());
                                                const symbol = token ? token.symbol : 'Unknown';

                                                return (
                                                    <div key={seqNum} style={styles.eventItem}>
                                                        <div style={styles.eventHeader}>
                                                            <span style={{
                                                                color: status === 'Success' ? '#2ecc71' : 
                                                                       status === 'Pending' ? '#f1c40f' : 
                                                                       status === 'Failed' ? '#e74c3c' : '#ffffff'
                                                            }}>
                                                                {status}
                                                            </span>
                                                            <span>{formatNanoTimestamp(latestEvent.timestamp)}</span>
                                                        </div>
                                                        <div style={styles.eventDetails}>
                                                            <span>Sequence: {seqNum}</span>
                                                            <span>Amount: {formatBalance(latestEvent.amount, getTokenDecimals(latestEvent.token_id.toString()))} {symbol}</span>
                                                            <span>Fee: {formatBalance(latestEvent.fee, getTokenDecimals(latestEvent.token_id.toString()))} {symbol}</span>
                                                            {events.some(e => e.tx_index && e.tx_index.length > 0) && (
                                                                <span>Transaction ID: {events.find(e => e.tx_index && e.tx_index.length > 0).tx_index[0].toString()}</span>
                                                            )}
                                                            {events.map((event, idx) => (
                                                                event.error_message && event.error_message.length > 0 && (
                                                                    <span key={idx} style={{ color: '#e74c3c' }}>
                                                                        Message: {event.error_message[0]}
                                                                    </span>
                                                                )
                                                            ))}
                                                        </div>
                                                    </div>
                                                );
                                            })}
                                    </div>
                                ) : (
                                    <p style={{ color: '#ffffff' }}>No claim history found</p>
                                )
                            )}
                        </section>

                        {/* Your Hotkey Neurons */}
                        <section style={styles.section}>
                            <div style={styles.sectionHeader}>
                                <h2 style={styles.heading}>Your Hotkey Neurons</h2>
                                <button 
                                    onClick={() => setIsHotkeyNeuronsExpanded(!isHotkeyNeuronsExpanded)}
                                    style={{
                                        background: 'none',
                                        border: 'none',
                                        color: '#3498db',
                                        cursor: 'pointer',
                                        fontSize: '20px',
                                        padding: '0 10px'
                                    }}
                                >
                                    {isHotkeyNeuronsExpanded ? '▼' : '▶'}
                                </button>
                            </div>
                            {isHotkeyNeuronsExpanded && (
                                loadingHotkeyNeurons ? (
                                    <div style={styles.spinner} />
                                ) : (
                                    <div>
                                        <div style={styles.statusGrid}>
                                            <div style={styles.statusItem}>
                                                <span title="The sum of all voting power you have cast across all Sneed proposals through your hotkey neurons">Total Voting Power:</span>
                                                <span title="Your total voting power used across all Sneed proposals">{Number(hotkeyNeurons.total_voting_power).toLocaleString()}</span>
                                            </div>
                                            <div style={styles.statusItem}>
                                                <span title="The sum of all voting power cast by all users across all Sneed proposals">Distribution Voting Power:</span>
                                                <span title="Total voting power from all users participating in Sneed proposals">{Number(hotkeyNeurons.distribution_voting_power).toLocaleString()}</span>
                                            </div>
                                            <div style={styles.statusItem}>
                                                <span title="Your percentage share of the total distribution voting power, which determines your share of distributed rewards">Your Voting Share:</span>
                                                <span title="This percentage represents your share of distributed rewards based on your voting participation">{((Number(hotkeyNeurons.total_voting_power) / Number(hotkeyNeurons.distribution_voting_power)) * 100).toFixed(2)}%</span>
                                            </div>
                                        </div>
                                        
                                        <div style={{marginTop: '20px'}}>
                                            {hotkeyNeurons.neurons_by_owner.map(([owner, neurons], index) => (
                                                <div key={owner.toText()} style={{
                                                    backgroundColor: '#3a3a3a',
                                                    borderRadius: '6px',
                                                    padding: '15px',
                                                    marginBottom: '15px'
                                                }}>
                                                    <div style={{
                                                        ...styles.statusItem,
                                                        borderBottom: '1px solid #4a4a4a',
                                                        paddingBottom: '10px',
                                                        marginBottom: '10px'
                                                    }}>
                                                        <span>Owner:</span>
                                                        <span style={{fontFamily: 'monospace'}}>{owner.toText()}</span>
                                                    </div>
                                                    <div style={{display: 'flex', flexDirection: 'column', gap: '10px'}}>
                                                        {neurons.map((neuron, neuronIndex) => (
                                                            <div key={neuronIndex} style={{
                                                                backgroundColor: '#2a2a2a',
                                                                borderRadius: '4px',
                                                                padding: '10px'
                                                            }}>
                                                                <div style={styles.statusItem}>
                                                                    <span>Neuron ID:</span>
                                                                    <span style={{
                                                                        fontFamily: 'monospace',
                                                                        wordBreak: 'break-all',
                                                                        maxWidth: '100%'
                                                                    }}>
                                                                        {neuron.id && neuron.id[0] && neuron.id[0].id ? 
                                                                            uint8ArrayToHex(neuron.id[0].id)
                                                                            : 'Unknown'}
                                                                    </span>
                                                                </div>
                                                                <div style={styles.statusItem}>
                                                                    <span>Stake:</span>
                                                                    <span title={`${Number(neuron.cached_neuron_stake_e8s).toLocaleString()} e8s`}>
                                                                        {formatE8s(neuron.cached_neuron_stake_e8s)} SNEED
                                                                    </span>
                                                                </div>
                                                                <div style={styles.statusItem}>
                                                                    <span>Dissolve State:</span>
                                                                    <span>{neuron.dissolve_state ? 
                                                                        (neuron.dissolve_state[0].WhenDissolvedTimestampSeconds ? 
                                                                            `Dissolving until: ${formatTimestamp(neuron.dissolve_state[0].WhenDissolvedTimestampSeconds)}` : 
                                                                            neuron.dissolve_state[0].DissolveDelaySeconds ? 
                                                                                `Not dissolving (delay: ${formatDuration(Number(neuron.dissolve_state[0].DissolveDelaySeconds))})` :
                                                                                'Not dissolving') 
                                                                        : 'Not dissolving'}</span>
                                                                </div>
                                                                <div style={styles.statusItem}>
                                                                    <span>Age:</span>
                                                                    <span title={`Aging since: ${formatTimestamp(neuron.aging_since_timestamp_seconds)}`}>
                                                                        {calculateAge(neuron.aging_since_timestamp_seconds)}
                                                                    </span>
                                                                </div>
                                                            </div>
                                                        ))}
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                )
                            )}
                        </section>
                    </>
                ) : (
                    <section style={styles.section}>
                        <h2 style={styles.heading}>Add Your Principal as a Hotkey</h2>
                        <div style={styles.noNeuronsMessage}>
                            <p>To participate in Sneed DAO and earn rewards:</p>
                            <ol style={styles.instructionsList}>
                                <li>First, you need to have a Sneed neuron</li>
                                <li>Add this principal as a hotkey to your neuron</li>
                                <li>Your current principal is: <code style={styles.principalCode}>{identity?.getPrincipal().toString()}</code></li>
                                <li>Once added as a hotkey, you'll be able to see your balances, claim history, and neurons here</li>
                            </ol>
                        </div>
                    </section>
                )}

                <section style={styles.section}>
                    <h2 style={styles.heading}>RLL Canister Token Balances</h2>
                    <div style={styles.controls}>
                        <Link 
                            to={`/scan_wallet?principal=${rllCanisterId}`}
                            style={{
                                color: '#3498db',
                                textDecoration: 'none',
                                marginBottom: '15px',
                                display: 'inline-block'
                            }}
                        >
                            View in Token Scanner
                        </Link>
                    </div>
                </section>

                {/* Import Status Section */}
                <section style={styles.section}>
                    <h2 style={styles.heading}>Import Status</h2>
                    <div style={styles.statusGrid}>
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
                        <div style={styles.statusItem}>
                            <span>Current Stage:</span>
                            <span style={{
                                color: importStage.includes('idle') ? '#f1c40f' : '#2ecc71',
                                fontFamily: 'monospace'
                            }}>
                                {importStage}
                            </span>
                        </div>
                    </div>
                </section>

                {/* Distribution Cycle Status */}
                <section style={styles.section}>
                    <h2 style={styles.heading}>Distribution Cycle</h2>
                    <div style={styles.cycleInfo}>
                        <div style={styles.statusItem}>
                            <span>Status:</span>
                            <span style={{
                                color: mainLoopStatus?.isRunning ? '#2ecc71' : '#e74c3c'
                            }}>
                                {mainLoopStatus?.isRunning ? 'Running' : 'Stopped'}
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
                    </div>
                </section>

                {/* Balance Reconciliation */}
                <section style={styles.section}>
                    <h2 style={styles.heading}>Balance Reconciliation</h2>
                    <div style={styles.reconciliationList}>
                        {reconciliation.map(item => {
                            const token = tokens.find(t => t.ledger_id.toString() === item.token_id.toString());
                            const symbol = token ? token.symbol : 'Unknown';
                            const decimals = token ? token.decimals : 8;
                            return (
                                <div key={item.token_id.toText()} style={{
                                    backgroundColor: '#3a3a3a',
                                    borderRadius: '6px',
                                    padding: '15px',
                                    marginBottom: '10px'
                                }}>
                                    <div style={styles.statusItem}>
                                        <span>Token:</span>
                                        <span style={{fontWeight: 'bold'}}>{symbol}</span>
                                    </div>
                                    <div style={styles.statusItem}>
                                        <span>Currently Distributed:</span>
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
                                        <div style={{...styles.statusItem, color: '#e74c3c'}}>
                                            <span>Underflow:</span>
                                            <span style={{fontFamily: 'monospace'}}>{formatBalance(item.underflow, decimals)} {symbol}</span>
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                </section>

                {/* Admin Controls */}
                {isAdmin && (
                    <section style={styles.section}>
                        <h2 style={styles.heading}>Admin Controls</h2>
                        <div style={styles.adminControls}>
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
                        </div>
                    </section>
                )}

                <section style={styles.section}>
                    <h2 style={styles.heading}>Total Distributions</h2>
                    {loadingDistributions ? (
                        <div style={styles.spinner} />
                    ) : distributions ? (
                        <div style={styles.tokenList}>
                            {Object.entries(distributions).map(([principalId, amount]) => {
                                const symbol = getTokenSymbolByPrincipal(principalId);
                                const decimals = getTokenDecimalsByPrincipal(principalId);
                                return (
                                    <div key={principalId} style={styles.distributionItem}>
                                        <span style={styles.distributionLabel}>Total {symbol} Distributed</span>
                                        <span style={styles.distributionValue}>
                                            {formatBalance(amount, decimals)} {symbol}
                                        </span>
                                    </div>
                                );
                            })}
                        </div>
                    ) : (
                        <p style={{ color: '#ffffff' }}>No distributions found</p>
                    )}
                </section>

                <section style={styles.section}>
                    <h2 style={styles.heading}>Recent Distribution Events</h2>
                    {loadingEvents ? (
                        <div style={styles.spinner} />
                    ) : (
                        <div style={styles.eventList}>
                            {distributionEvents.slice(0, 5).map((event, index) => (
                                <div key={index} style={styles.eventItem}>
                                    <div style={styles.eventHeader}>
                                        <span>Proposals: {formatProposalRange(event.proposal_range)}</span>
                                        <span>{formatNanoTimestamp(event.timestamp)}</span>
                                    </div>
                                    <div style={styles.eventDetails}>
                                        <span>Amount: {formatBalance(event.amount, getTokenDecimals(event.token_id.toString()))} tokens</span>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </section>

                <section style={styles.section}>
                    <h2 style={styles.heading}>Recent Claim Events</h2>
                    {loadingEvents ? (
                        <div style={styles.spinner} />
                    ) : (
                        <div style={styles.eventList}>
                            {claimEvents.slice(0, 5).map((event, index) => (
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
                                        <span>Amount: {formatBalance(event.amount, getTokenDecimals(event.token_id.toString()))} tokens</span>
                                        <span>Fee: {formatBalance(event.fee, getTokenDecimals(event.token_id.toString()))} tokens</span>
                                        <span>Sequence: {event.sequence_number.toString()}</span>
                                        {event.tx_index && event.tx_index.length > 0 && <span>Transaction ID: {event.tx_index[0].toString()}</span>}
                                        {event.error_message && event.error_message.length > 0 && <span>Message: {event.error_message[0]}</span>}
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
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