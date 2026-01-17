import React, { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { HttpAgent, Actor } from '@dfinity/agent';
import { Principal } from '@dfinity/principal';
import { IDL } from '@dfinity/candid';
import { createActor as createFactoryActor, canisterId as factoryCanisterId } from 'declarations/sneed_icp_neuron_manager_factory';
import { createActor as createManagerActor } from 'declarations/sneed_icp_neuron_manager';
import { createActor as createLedgerActor } from 'external/icrc1_ledger';
import { createActor as createCmcActor, CMC_CANISTER_ID } from 'external/cmc';
import Header from '../components/Header';
import { useTheme } from '../contexts/ThemeContext';
import { useAuth } from '../AuthContext';
import { useNaming } from '../NamingContext';
import { PrincipalDisplay, getPrincipalDisplayInfoFromContext } from '../utils/PrincipalUtils';
import { FaCheckCircle, FaExclamationTriangle, FaArrowRight } from 'react-icons/fa';
import { getCyclesColor, formatCyclesCompact, getNeuronManagerSettings } from '../utils/NeuronManagerSettings';
import { useSneedMembership } from '../hooks/useSneedMembership';
import { SneedMemberGateMessage, SneedMemberGateLoading, SneedMemberBadge, BetaWarningBanner, GATE_TYPES } from '../components/SneedMemberGate';

const ICP_LEDGER_CANISTER_ID = 'ryjl3-tyaaa-aaaaa-aaaba-cai';
const E8S = 100_000_000;
const ICP_FEE = 10_000;
const MANAGEMENT_CANISTER_ID = Principal.fromText('aaaaa-aa');

// Management canister IDL factory for canister_status
const managementCanisterIdlFactory = ({ IDL }) => {
    const definite_canister_settings = IDL.Record({
        'controllers': IDL.Vec(IDL.Principal),
        'freezing_threshold': IDL.Nat,
        'memory_allocation': IDL.Nat,
        'compute_allocation': IDL.Nat,
        'reserved_cycles_limit': IDL.Nat,
        'log_visibility': IDL.Variant({
            'controllers': IDL.Null,
            'public': IDL.Null,
        }),
        'wasm_memory_limit': IDL.Nat,
    });
    const canister_status_result = IDL.Record({
        'status': IDL.Variant({
            'running': IDL.Null,
            'stopping': IDL.Null,
            'stopped': IDL.Null,
        }),
        'settings': definite_canister_settings,
        'module_hash': IDL.Opt(IDL.Vec(IDL.Nat8)),
        'memory_size': IDL.Nat,
        'cycles': IDL.Nat,
        'idle_cycles_burned_per_day': IDL.Nat,
        'query_stats': IDL.Record({
            'num_calls_total': IDL.Nat,
            'num_instructions_total': IDL.Nat,
            'request_payload_bytes_total': IDL.Nat,
            'response_payload_bytes_total': IDL.Nat,
        }),
        'reserved_cycles': IDL.Nat,
    });
    return IDL.Service({
        'canister_status': IDL.Func(
            [IDL.Record({ 'canister_id': IDL.Principal })],
            [canister_status_result],
            []
        ),
    });
};

function CreateIcpNeuron() {
    const { theme } = useTheme();
    const { identity, isAuthenticated, login } = useAuth();
    const { principalNames, principalNicknames } = useNaming();
    
    // Sneed membership for beta access
    const { 
        isSneedMember, 
        sneedNeurons, 
        sneedVotingPower, 
        loading: loadingSneedVP 
    } = useSneedMembership();
    
    const [managers, setManagers] = useState([]);
    const [neuronCounts, setNeuronCounts] = useState({}); // canisterId -> neuron count
    const [managerVersions, setManagerVersions] = useState({}); // canisterId -> version object
    const [managerCycles, setManagerCycles] = useState({}); // canisterId -> cycles
    const [latestOfficialVersion, setLatestOfficialVersion] = useState(null);
    const [cycleSettings, setCycleSettings] = useState(() => getNeuronManagerSettings());
    const [loading, setLoading] = useState(false);
    const [creating, setCreating] = useState(false);
    const [error, setError] = useState('');
    const [success, setSuccess] = useState('');
    const [factoryInfo, setFactoryInfo] = useState(null);
    
    // Payment state
    const [paymentConfig, setPaymentConfig] = useState(null);
    const [userIcpBalance, setUserIcpBalance] = useState(null);
    const [paymentBalance, setPaymentBalance] = useState(null);
    const [conversionRate, setConversionRate] = useState(null);
    const [sendingPayment, setSendingPayment] = useState(false);
    const [paymentSubaccount, setPaymentSubaccount] = useState(null);
    
    // Creation step: 'idle' | 'payment' | 'creating' | 'done'
    const [creationStep, setCreationStep] = useState('idle');

    const getAgent = useCallback(() => {
        const host = process.env.DFX_NETWORK === 'ic' || process.env.DFX_NETWORK === 'staging' 
            ? 'https://ic0.app' 
            : 'http://localhost:4943';
        return new HttpAgent({ identity, host });
    }, [identity]);

    const fetchFactoryInfo = useCallback(async () => {
        try {
            const agent = getAgent();
            if (process.env.DFX_NETWORK !== 'ic' && process.env.DFX_NETWORK !== 'staging') {
                await agent.fetchRootKey();
            }
            const factory = createFactoryActor(factoryCanisterId, { agent });
            
            const [version, cyclesBalance, managerCount, config] = await Promise.all([
                factory.getCurrentVersion(),
                factory.getCyclesBalance(),
                factory.getManagerCount(),
                factory.getPaymentConfig(),
            ]);
            
            setFactoryInfo({
                version: `${version.major}.${version.minor}.${version.patch}`,
                cyclesBalance: Number(cyclesBalance),
                managerCount: Number(managerCount),
            });
            
            setPaymentConfig({
                creationFeeE8s: Number(config.creationFeeE8s),
                targetCyclesAmount: Number(config.targetCyclesAmount),
                feeDestination: config.feeDestination,
                paymentRequired: config.paymentRequired,
            });
            
            // Also get the user's payment subaccount
            if (identity) {
                const subaccount = await factory.getPaymentSubaccount(identity.getPrincipal());
                setPaymentSubaccount(Array.from(subaccount));
            }
        } catch (err) {
            console.error('Error fetching factory info:', err);
        }
    }, [getAgent, identity]);

    const fetchUserBalances = useCallback(async () => {
        if (!identity) return;
        
        try {
            const agent = getAgent();
            if (process.env.DFX_NETWORK !== 'ic' && process.env.DFX_NETWORK !== 'staging') {
                await agent.fetchRootKey();
            }
            
            const ledger = createLedgerActor(ICP_LEDGER_CANISTER_ID, { agent });
            const factory = createFactoryActor(factoryCanisterId, { agent });
            
            // Fetch user's wallet balance
            const walletBalance = await ledger.icrc1_balance_of({
                owner: identity.getPrincipal(),
                subaccount: [],
            });
            setUserIcpBalance(Number(walletBalance));
            
            // Fetch user's payment balance at factory
            const payBalance = await factory.getUserPaymentBalance(identity.getPrincipal());
            setPaymentBalance(Number(payBalance));
        } catch (err) {
            console.error('Error fetching user balances:', err);
        }
    }, [identity, getAgent]);

    const fetchConversionRate = useCallback(async () => {
        try {
            const host = 'https://ic0.app';
            const agent = HttpAgent.createSync({ host });
            
            const cmc = createCmcActor(CMC_CANISTER_ID, { agent });
            const response = await cmc.get_icp_xdr_conversion_rate();
            
            const xdrPerIcp = Number(response.data.xdr_permyriad_per_icp) / 10000;
            const cyclesPerIcp = xdrPerIcp * 1_000_000_000_000;
            
            setConversionRate({
                xdrPerIcp,
                cyclesPerIcp,
            });
        } catch (err) {
            console.error('Error fetching conversion rate:', err);
        }
    }, []);

    // Helper to compare versions
    const compareVersions = (a, b) => {
        const aMajor = Number(a.major), aMinor = Number(a.minor), aPatch = Number(a.patch);
        const bMajor = Number(b.major), bMinor = Number(b.minor), bPatch = Number(b.patch);
        if (aMajor !== bMajor) return aMajor - bMajor;
        if (aMinor !== bMinor) return aMinor - bMinor;
        return aPatch - bPatch;
    };

    // Check if a version is outdated compared to latest
    const isVersionOutdated = (version) => {
        if (!latestOfficialVersion || !version) return false;
        return compareVersions(version, latestOfficialVersion) < 0;
    };

    const fetchMyManagers = useCallback(async () => {
        setLoading(true);
        try {
            const agent = getAgent();
            if (process.env.DFX_NETWORK !== 'ic' && process.env.DFX_NETWORK !== 'staging') {
                await agent.fetchRootKey();
            }
            const factory = createFactoryActor(factoryCanisterId, { agent });
            
            // Fetch managers and official versions in parallel
            const [canisterIds, officialVersions] = await Promise.all([
                factory.getMyManagers(),
                factory.getOfficialVersions(),
            ]);
            
            // Find latest official version
            if (officialVersions && officialVersions.length > 0) {
                const sorted = [...officialVersions].sort((a, b) => compareVersions(b, a));
                setLatestOfficialVersion(sorted[0]);
            }
            
            // Convert to manager objects with canisterId field
            const managerList = canisterIds.map(canisterIdPrincipal => ({
                canisterId: canisterIdPrincipal
            }));
            
            setManagers(managerList);
            setError('');
            
            // Fetch neuron counts, versions, and cycles for all managers
            if (managerList.length > 0) {
                fetchNeuronCounts(managerList, agent);
                fetchManagerVersions(managerList, agent);
                fetchManagerCycles(managerList, agent);
            }
        } catch (err) {
            console.error('Error fetching managers:', err);
            setError('Failed to load your neuron managers');
        } finally {
            setLoading(false);
        }
    }, [getAgent]);

    useEffect(() => {
        if (isAuthenticated && identity) {
            fetchMyManagers();
            fetchFactoryInfo();
            fetchUserBalances();
            fetchConversionRate();
        }
    }, [isAuthenticated, identity, fetchMyManagers, fetchFactoryInfo, fetchUserBalances, fetchConversionRate]);

    const fetchNeuronCounts = async (managerList, agent) => {
        try {
            const counts = {};
            
            const countPromises = managerList.map(async (manager) => {
                try {
                    const managerActor = createManagerActor(manager.canisterId, { agent });
                    const count = await managerActor.getNeuronCount();
                    return { canisterId: manager.canisterId.toText(), count: Number(count) };
                } catch (err) {
                    console.error(`Error fetching neuron count for ${manager.canisterId.toText()}:`, err);
                    return { canisterId: manager.canisterId.toText(), count: null };
                }
            });
            
            const results = await Promise.all(countPromises);
            results.forEach(({ canisterId, count }) => {
                counts[canisterId] = count;
            });
            
            setNeuronCounts(counts);
        } catch (err) {
            console.error('Error fetching neuron counts:', err);
        }
    };

    const fetchManagerVersions = async (managerList, agent) => {
        try {
            const versions = {};
            
            const versionPromises = managerList.map(async (manager) => {
                try {
                    const managerActor = createManagerActor(manager.canisterId, { agent });
                    const version = await managerActor.getVersion();
                    return { canisterId: manager.canisterId.toText(), version };
                } catch (err) {
                    console.error(`Error fetching version for ${manager.canisterId.toText()}:`, err);
                    return { canisterId: manager.canisterId.toText(), version: null };
                }
            });
            
            const results = await Promise.all(versionPromises);
            results.forEach(({ canisterId, version }) => {
                versions[canisterId] = version;
            });
            
            setManagerVersions(versions);
        } catch (err) {
            console.error('Error fetching manager versions:', err);
        }
    };

    const fetchManagerCycles = async (managerList, agent) => {
        try {
            const cycles = {};
            
            const cyclesPromises = managerList.map(async (manager) => {
                try {
                    // Need to create actor with effectiveCanisterId for management canister
                    const mgmtActor = Actor.createActor(managementCanisterIdlFactory, {
                        agent,
                        canisterId: MANAGEMENT_CANISTER_ID,
                        callTransform: (methodName, args, callConfig) => ({
                            ...callConfig,
                            effectiveCanisterId: manager.canisterId,
                        }),
                    });
                    const status = await mgmtActor.canister_status({ canister_id: manager.canisterId });
                    return { canisterId: manager.canisterId.toText(), cycles: Number(status.cycles) };
                } catch (err) {
                    // Not a controller, can't get cycles
                    return { canisterId: manager.canisterId.toText(), cycles: null };
                }
            });
            
            const results = await Promise.all(cyclesPromises);
            results.forEach(({ canisterId, cycles: c }) => {
                cycles[canisterId] = c;
            });
            
            setManagerCycles(cycles);
        } catch (err) {
            console.error('Error fetching manager cycles:', err);
        }
    };

    // Send payment to factory
    const handleSendPayment = async () => {
        if (!identity || !paymentConfig || !paymentSubaccount) return;
        
        setSendingPayment(true);
        setError('');
        
        try {
            const agent = getAgent();
            if (process.env.DFX_NETWORK !== 'ic' && process.env.DFX_NETWORK !== 'staging') {
                await agent.fetchRootKey();
            }
            
            const ledger = createLedgerActor(ICP_LEDGER_CANISTER_ID, { agent });
            
            // Transfer creation fee to factory's subaccount for this user
            const result = await ledger.icrc1_transfer({
                to: {
                    owner: Principal.fromText(factoryCanisterId),
                    subaccount: [new Uint8Array(paymentSubaccount)],
                },
                amount: BigInt(paymentConfig.creationFeeE8s),
                fee: [BigInt(ICP_FEE)],
                memo: [],
                from_subaccount: [],
                created_at_time: [],
            });
            
            if ('Ok' in result) {
                setSuccess('✅ Payment sent! You can now create your neuron manager.');
                await fetchUserBalances();
                setCreationStep('payment');
            } else {
                const err = result.Err;
                if ('InsufficientFunds' in err) {
                    setError(`Insufficient funds: ${formatIcp(Number(err.InsufficientFunds.balance))} ICP available`);
                } else {
                    setError(`Payment failed: ${JSON.stringify(err)}`);
                }
            }
        } catch (err) {
            console.error('Error sending payment:', err);
            setError(`Payment error: ${err.message}`);
        } finally {
            setSendingPayment(false);
        }
    };

    const handleCreateManager = async () => {
        if (!isAuthenticated) {
            login();
            return;
        }

        setCreating(true);
        setError('');
        setSuccess('');
        setCreationStep('creating');
        
        try {
            const agent = getAgent();
            if (process.env.DFX_NETWORK !== 'ic' && process.env.DFX_NETWORK !== 'staging') {
                await agent.fetchRootKey();
            }
            const factory = createFactoryActor(factoryCanisterId, { agent });
            
            // Backend now calculates ICP for cycles dynamically based on CMC rate
            const result = await factory.createNeuronManager();
            
            if ('Ok' in result) {
                const { canisterId } = result.Ok;
                setSuccess(`🎉 Neuron Manager Created!\n\nCanister ID: ${canisterId.toText()}`);
                setCreationStep('done');
                fetchMyManagers();
                fetchFactoryInfo();
                fetchUserBalances();
            } else if ('Err' in result) {
                const err = result.Err;
                if ('InsufficientCycles' in err) {
                    setError('Factory has insufficient cycles to create a new canister. Please try again later.');
                } else if ('CanisterCreationFailed' in err) {
                    setError(`Canister creation failed: ${err.CanisterCreationFailed}`);
                } else if ('NotAuthorized' in err) {
                    setError('Not authorized to create a neuron manager.');
                } else if ('InsufficientPayment' in err) {
                    setError(`Insufficient payment: Required ${formatIcp(Number(err.InsufficientPayment.required))} ICP, provided ${formatIcp(Number(err.InsufficientPayment.provided))} ICP`);
                } else if ('TransferFailed' in err) {
                    setError(`Transfer failed: ${err.TransferFailed}`);
                } else if ('CyclesTopUpFailed' in err) {
                    setError(`Cycles top-up failed: ${err.CyclesTopUpFailed}`);
                } else {
                    setError('Failed to create neuron manager');
                }
                setCreationStep('payment');
            }
        } catch (err) {
            console.error('Error creating manager:', err);
            setError(`Error: ${err.message || 'Failed to create neuron manager'}`);
            setCreationStep('payment');
        } finally {
            setCreating(false);
        }
    };

    const formatIcp = (e8s) => {
        if (e8s === null || e8s === undefined) return '...';
        const icp = e8s / E8S;
        return icp.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 });
    };

    const formatCycles = (cycles) => {
        if (cycles >= 1_000_000_000_000) {
            return (cycles / 1_000_000_000_000).toFixed(2) + ' T';
        } else if (cycles >= 1_000_000_000) {
            return (cycles / 1_000_000_000).toFixed(2) + ' B';
        }
        return cycles.toLocaleString();
    };

    const copyToClipboard = (text) => {
        navigator.clipboard.writeText(text);
    };

    // Check if user has enough payment balance
    const hasEnoughPayment = paymentConfig && paymentBalance !== null && 
        paymentBalance >= paymentConfig.creationFeeE8s;
    
    // Check if user has enough in wallet to send payment
    const canSendPayment = paymentConfig && userIcpBalance !== null &&
        userIcpBalance >= paymentConfig.creationFeeE8s + ICP_FEE;

    const cardStyle = {
        background: theme.colors.cardBackground,
        borderRadius: '12px',
        padding: '20px',
        marginBottom: '20px',
        border: `1px solid ${theme.colors.border}`,
    };

    const buttonStyle = {
        background: theme.colors.accent,
        color: '#fff',
        border: 'none',
        borderRadius: '8px',
        padding: '12px 24px',
        fontSize: '16px',
        fontWeight: '600',
        cursor: 'pointer',
        transition: 'opacity 0.2s',
    };

    const smallButtonStyle = {
        background: 'transparent',
        color: theme.colors.accent,
        border: `1px solid ${theme.colors.accent}`,
        borderRadius: '4px',
        padding: '4px 8px',
        fontSize: '12px',
        cursor: 'pointer',
        marginLeft: '8px',
    };

    return (
        <div className='page-container' style={{ background: theme.colors.primaryGradient, minHeight: '100vh' }}>
            <Header />
            <main className="wallet-container">
                <h1 style={{ color: theme.colors.primaryText, marginBottom: '10px', textAlign: 'center', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '12px' }}>
                    <span style={{ fontSize: '2.5rem' }}>🧠</span>
                    ICP Neuron Manager
                </h1>
                <p style={{ color: theme.colors.mutedText, textAlign: 'center', marginBottom: '10px' }}>
                    Create dedicated canisters to manage your ICP NNS neurons
                </p>
                <div style={{ textAlign: 'center', marginBottom: '30px' }}>
                    <Link 
                        to="/help/icp-neuron-manager" 
                        style={{ color: theme.colors.accent, fontSize: '14px', textDecoration: 'none' }}
                        onMouseEnter={(e) => e.target.style.textDecoration = 'underline'}
                        onMouseLeave={(e) => e.target.style.textDecoration = 'none'}
                    >
                        Learn how it works →
                    </Link>
                </div>

                {/* Factory Info */}
                {factoryInfo && (
                    <div style={{ ...cardStyle, textAlign: 'center', marginBottom: '30px' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-around', flexWrap: 'wrap', gap: '20px' }}>
                            <div>
                                <div style={{ color: theme.colors.mutedText, fontSize: '12px' }}>Version</div>
                                <div style={{ color: theme.colors.primaryText, fontSize: '18px', fontWeight: '600' }}>
                                    v{factoryInfo.version}
                                </div>
                            </div>
                            <div>
                                <div style={{ color: theme.colors.mutedText, fontSize: '12px' }}>Total Managers</div>
                                <div style={{ color: theme.colors.primaryText, fontSize: '18px', fontWeight: '600' }}>
                                    {factoryInfo.managerCount}
                                </div>
                            </div>
                            <div>
                                <div style={{ color: theme.colors.mutedText, fontSize: '12px' }}>Factory Cycles</div>
                                <div style={{ color: theme.colors.primaryText, fontSize: '18px', fontWeight: '600' }}>
                                    {(factoryInfo.cyclesBalance / 1_000_000_000_000).toFixed(2)}T
                                </div>
                            </div>
                        </div>
                    </div>
                )}

                {/* Not authenticated message */}
                {!isAuthenticated && (
                    <div style={{ ...cardStyle, textAlign: 'center' }}>
                        <p style={{ color: theme.colors.mutedText, marginBottom: '20px' }}>
                            Please log in to create and manage your ICP neuron managers.
                        </p>
                        <button style={buttonStyle} onClick={login}>
                            Login with Internet Identity
                        </button>
                    </div>
                )}

                {/* Sneed DAO Membership Gating */}
                {isAuthenticated && loadingSneedVP && (
                    <SneedMemberGateLoading />
                )}

                {isAuthenticated && !loadingSneedVP && !isSneedMember && (
                    <SneedMemberGateMessage 
                        gateType={GATE_TYPES.BETA}
                        featureName="The ICP Neuron Manager"
                    />
                )}

                {/* Sneed Member Badge */}
                {isAuthenticated && !loadingSneedVP && isSneedMember && (
                    <SneedMemberBadge 
                        sneedNeurons={sneedNeurons}
                        sneedVotingPower={sneedVotingPower}
                    />
                )}

                {/* Beta Warning Banner */}
                {isAuthenticated && !loadingSneedVP && isSneedMember && (
                    <BetaWarningBanner featureName="The ICP Neuron Manager" />
                )}

                {/* Create Manager Section with Payment Flow */}
                {isAuthenticated && paymentConfig && isSneedMember && (
                    <div style={{ ...cardStyle, marginBottom: '30px' }}>
                        <h3 style={{ color: theme.colors.primaryText, marginBottom: '20px', textAlign: 'center' }}>
                            ➕ Create New Neuron Manager
                        </h3>
                        
                        {/* Payment Required Info */}
                        {paymentConfig.paymentRequired && (
                            <div style={{ 
                                background: `${theme.colors.accent}15`,
                                borderRadius: '8px',
                                padding: '16px',
                                marginBottom: '20px'
                            }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '15px' }}>
                                    <div>
                                        <div style={{ color: theme.colors.mutedText, fontSize: '12px' }}>Creation Fee</div>
                                        <div style={{ color: theme.colors.primaryText, fontSize: '24px', fontWeight: '700' }}>
                                            {formatIcp(paymentConfig.creationFeeE8s)} ICP
                                        </div>
                                    </div>
                                    <div style={{ textAlign: 'right' }}>
                                        <div style={{ color: theme.colors.mutedText, fontSize: '12px' }}>Your Wallet Balance</div>
                                        <div style={{ color: theme.colors.primaryText, fontSize: '18px', fontWeight: '600' }}>
                                            {formatIcp(userIcpBalance)} ICP
                                        </div>
                                    </div>
                                </div>
                                
                                {/* Conversion rate info */}
                                {conversionRate && (
                                    <div style={{ 
                                        marginTop: '12px', 
                                        paddingTop: '12px', 
                                        borderTop: `1px solid ${theme.colors.border}`,
                                        color: theme.colors.mutedText,
                                        fontSize: '12px'
                                    }}>
                                        Current rate: 1 ICP ≈ {formatCycles(conversionRate.cyclesPerIcp)} cycles
                                    </div>
                                )}
                            </div>
                        )}
                        
                        {/* Payment Status Steps */}
                        {paymentConfig.paymentRequired && (
                            <div style={{ 
                                display: 'flex', 
                                alignItems: 'center', 
                                justifyContent: 'center',
                                gap: '10px',
                                marginBottom: '20px',
                                flexWrap: 'wrap'
                            }}>
                                {/* Step 1: Payment */}
                                <div style={{ 
                                    display: 'flex', 
                                    alignItems: 'center', 
                                    gap: '8px',
                                    padding: '8px 16px',
                                    borderRadius: '20px',
                                    background: hasEnoughPayment ? `${theme.colors.success || '#22c55e'}20` : `${theme.colors.warning || '#f59e0b'}20`,
                                    border: `1px solid ${hasEnoughPayment ? (theme.colors.success || '#22c55e') : (theme.colors.warning || '#f59e0b')}`
                                }}>
                                    {hasEnoughPayment ? (
                                        <FaCheckCircle color={theme.colors.success || '#22c55e'} />
                                    ) : (
                                        <FaExclamationTriangle color={theme.colors.warning || '#f59e0b'} />
                                    )}
                                    <span style={{ 
                                        color: hasEnoughPayment ? (theme.colors.success || '#22c55e') : (theme.colors.warning || '#f59e0b'),
                                        fontSize: '13px',
                                        fontWeight: '500'
                                    }}>
                                        {hasEnoughPayment ? 'Payment Ready' : 'Payment Required'}
                                    </span>
                                </div>
                                
                                <FaArrowRight style={{ color: theme.colors.mutedText }} />
                                
                                {/* Step 2: Create */}
                                <div style={{ 
                                    display: 'flex', 
                                    alignItems: 'center', 
                                    gap: '8px',
                                    padding: '8px 16px',
                                    borderRadius: '20px',
                                    background: creationStep === 'done' ? `${theme.colors.success || '#22c55e'}20` : `${theme.colors.border}50`,
                                    border: `1px solid ${creationStep === 'done' ? (theme.colors.success || '#22c55e') : theme.colors.border}`
                                }}>
                                    {creationStep === 'done' ? (
                                        <FaCheckCircle color={theme.colors.success || '#22c55e'} />
                                    ) : (
                                        <span style={{ 
                                            width: '16px', 
                                            height: '16px', 
                                            borderRadius: '50%', 
                                            border: `2px solid ${theme.colors.mutedText}`,
                                            display: 'inline-block'
                                        }} />
                                    )}
                                    <span style={{ 
                                        color: creationStep === 'done' ? (theme.colors.success || '#22c55e') : theme.colors.mutedText,
                                        fontSize: '13px',
                                        fontWeight: '500'
                                    }}>
                                        Create Manager
                                    </span>
                                </div>
                            </div>
                        )}
                        
                        {/* Deposited Payment Balance */}
                        {paymentConfig.paymentRequired && (
                            <div style={{ 
                                background: theme.colors.tertiaryBg || theme.colors.secondaryBg,
                                borderRadius: '8px',
                                padding: '12px 16px',
                                marginBottom: '16px',
                                display: 'flex',
                                justifyContent: 'space-between',
                                alignItems: 'center'
                            }}>
                                <span style={{ color: theme.colors.mutedText, fontSize: '13px' }}>
                                    Your Deposited Payment:
                                </span>
                                <span style={{ 
                                    color: hasEnoughPayment ? (theme.colors.success || '#22c55e') : theme.colors.primaryText,
                                    fontWeight: '600',
                                    fontSize: '14px'
                                }}>
                                    {formatIcp(paymentBalance)} ICP
                                    {hasEnoughPayment && ' ✓'}
                                </span>
                            </div>
                        )}
                        
                        {/* Action Buttons */}
                        <div style={{ display: 'flex', gap: '12px', justifyContent: 'center', flexWrap: 'wrap' }}>
                            {/* Send Payment Button */}
                            {paymentConfig.paymentRequired && !hasEnoughPayment && (
                                <button
                                    style={{ 
                                        ...buttonStyle,
                                        opacity: (!canSendPayment || sendingPayment) ? 0.6 : 1,
                                        cursor: (!canSendPayment || sendingPayment) ? 'not-allowed' : 'pointer',
                                    }}
                                    onClick={handleSendPayment}
                                    disabled={!canSendPayment || sendingPayment}
                                >
                                    {sendingPayment ? '⏳ Sending Payment...' : `💰 Send ${formatIcp(paymentConfig.creationFeeE8s)} ICP`}
                                </button>
                            )}
                            
                            {/* Create Manager Button */}
                            {(!paymentConfig.paymentRequired || hasEnoughPayment) && (
                                <button 
                                    style={{ 
                                        ...buttonStyle, 
                                        opacity: creating ? 0.7 : 1,
                                        cursor: creating ? 'not-allowed' : 'pointer',
                                    }} 
                                    onClick={handleCreateManager}
                                    disabled={creating}
                                >
                                    {creating ? '⏳ Creating...' : '🚀 Create Neuron Manager'}
                                </button>
                            )}
                        </div>
                        
                        {/* Help text */}
                        <p style={{ color: theme.colors.mutedText, fontSize: '12px', marginTop: '15px', textAlign: 'center' }}>
                            {paymentConfig.paymentRequired ? (
                                hasEnoughPayment 
                                    ? 'Payment received! Click "Create Neuron Manager" to proceed.'
                                    : `Send ${formatIcp(paymentConfig.creationFeeE8s)} ICP to deposit your payment, then create your manager.`
                            ) : (
                                'Creating a neuron manager is currently free!'
                            )}
                        </p>
                    </div>
                )}

                {/* Success message */}
                {success && (
                    <div style={{ 
                        backgroundColor: `${theme.colors.success || '#22c55e'}20`, 
                        border: `1px solid ${theme.colors.success || '#22c55e'}`,
                        color: theme.colors.success || '#22c55e',
                        padding: '20px',
                        borderRadius: '8px',
                        marginBottom: '20px',
                        whiteSpace: 'pre-line',
                        fontFamily: 'monospace',
                    }}>
                        {success}
                    </div>
                )}

                {/* Error message */}
                {error && (
                    <div style={{ 
                        backgroundColor: `${theme.colors.error}20`, 
                        border: `1px solid ${theme.colors.error}`,
                        color: theme.colors.error,
                        padding: '15px',
                        borderRadius: '8px',
                        marginBottom: '20px',
                        textAlign: 'center'
                    }}>
                        {error}
                    </div>
                )}

                {/* My Managers List */}
                {isAuthenticated && (
                    <>
                        <h2 style={{ color: theme.colors.primaryText, marginBottom: '20px' }}>
                            Your Neuron Managers {managers.length > 0 && `(${managers.length})`}
                        </h2>

                        {loading ? (
                            <div style={{ textAlign: 'center', padding: '40px', color: theme.colors.primaryText }}>
                                Loading your managers...
                            </div>
                        ) : managers.length === 0 ? (
                            <div style={{ ...cardStyle, textAlign: 'center' }}>
                                <p style={{ color: theme.colors.mutedText }}>
                                    You haven't created any neuron managers yet.
                                </p>
                                <p style={{ color: theme.colors.mutedText, fontSize: '14px', marginTop: '10px' }}>
                                    Use the form above to create your first neuron manager!
                                </p>
                            </div>
                        ) : (
                            <div>
                                {managers.map((manager) => {
                                    const canisterIdText = manager.canisterId.toText();
                                    const displayInfo = getPrincipalDisplayInfoFromContext(canisterIdText, principalNames, principalNicknames);
                                    return (
                                        <div key={canisterIdText} style={cardStyle}>
                                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '10px' }}>
                                                <div style={{ flex: 1, minWidth: '250px' }}>
                                                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                                                        <span style={{ fontSize: '20px' }}>🧠</span>
                                                        <PrincipalDisplay
                                                            principal={canisterIdText}
                                                            displayInfo={displayInfo}
                                                            showCopyButton={true}
                                                            isAuthenticated={isAuthenticated}
                                                            noLink={true}
                                                        />
                                                    </div>
                                                </div>
                                            </div>
                                            
                                            <div style={{ marginTop: '15px', paddingTop: '15px', borderTop: `1px solid ${theme.colors.border}` }}>
                                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px' }}>
                                                    <div>
                                                        <span style={{ color: theme.colors.mutedText, fontSize: '12px' }}>Neurons: </span>
                                                        {(() => {
                                                            const count = neuronCounts[manager.canisterId.toText()];
                                                            if (count === undefined || count === null) {
                                                                return <span style={{ color: theme.colors.mutedText }}>...</span>;
                                                            } else if (count === 0) {
                                                                return <span style={{ color: theme.colors.warning || '#f59e0b' }}>None yet</span>;
                                                            } else {
                                                                return <span style={{ color: theme.colors.success || '#22c55e' }}>{count}</span>;
                                                            }
                                                        })()}
                                                    </div>
                                                    <div style={{ display: 'flex', alignItems: 'center', gap: '15px' }}>
                                                        {managerCycles[canisterIdText] !== undefined && managerCycles[canisterIdText] !== null && (
                                                            <span 
                                                                style={{ 
                                                                    color: getCyclesColor(managerCycles[canisterIdText], cycleSettings), 
                                                                    fontSize: '12px', 
                                                                    flexShrink: 0,
                                                                    display: 'flex',
                                                                    alignItems: 'center',
                                                                    gap: '4px',
                                                                }}
                                                                title={`${managerCycles[canisterIdText].toLocaleString()} cycles`}
                                                            >
                                                                ⚡ {formatCyclesCompact(managerCycles[canisterIdText])}
                                                            </span>
                                                        )}
                                                        {managerVersions[canisterIdText] && (
                                                            <span 
                                                                style={{ 
                                                                    color: isVersionOutdated(managerVersions[canisterIdText]) ? '#f59e0b' : theme.colors.mutedText, 
                                                                    fontSize: '12px', 
                                                                    flexShrink: 0,
                                                                    display: 'flex',
                                                                    alignItems: 'center',
                                                                    gap: '4px',
                                                                }}
                                                                title={isVersionOutdated(managerVersions[canisterIdText]) 
                                                                    ? `Newer version available: v${Number(latestOfficialVersion.major)}.${Number(latestOfficialVersion.minor)}.${Number(latestOfficialVersion.patch)}`
                                                                    : undefined
                                                                }
                                                            >
                                                                {isVersionOutdated(managerVersions[canisterIdText]) && '⚠️ '}
                                                                Version {Number(managerVersions[canisterIdText].major)}.{Number(managerVersions[canisterIdText].minor)}.{Number(managerVersions[canisterIdText].patch)}
                                                            </span>
                                                        )}
                                                        <Link 
                                                            to={`/icp_neuron_manager/${canisterIdText}`}
                                                            style={{
                                                                background: theme.colors.accent,
                                                                color: '#fff',
                                                                padding: '8px 16px',
                                                                borderRadius: '6px',
                                                                textDecoration: 'none',
                                                                fontSize: '13px',
                                                                fontWeight: '600',
                                                            }}
                                                        >
                                                            Manage →
                                                        </Link>
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        )}

                        {managers.length > 0 && (
                            <div style={{ textAlign: 'center', marginTop: '20px' }}>
                                <button 
                                    style={{ ...smallButtonStyle, marginLeft: 0 }}
                                    onClick={fetchMyManagers}
                                    disabled={loading}
                                >
                                    🔄 Refresh List
                                </button>
                            </div>
                        )}
                    </>
                )}

                {/* Info section */}
                <div style={{ ...cardStyle, marginTop: '40px' }}>
                    <h3 style={{ color: theme.colors.primaryText, marginBottom: '15px' }}>How It Works</h3>
                    <ol style={{ color: theme.colors.mutedText, lineHeight: '1.8', paddingLeft: '20px' }}>
                        <li><strong>Pay the Creation Fee:</strong> Send ICP to cover the cost of creating your dedicated canister.</li>
                        <li><strong>Create a Manager:</strong> Each manager is a dedicated canister that can control multiple ICP neurons.</li>
                        <li><strong>Stake Neurons:</strong> Use the manager to stake ICP directly from your wallet and create NNS neurons.</li>
                        <li><strong>Manage Your Neurons:</strong> Vote, set dissolve delay, manage maturity, and more.</li>
                        <li><strong>Transfer Ownership:</strong> Transfer neuron ownership by transferring control of the canister.</li>
                    </ol>
                </div>
            </main>
        </div>
    );
}

export default CreateIcpNeuron;
