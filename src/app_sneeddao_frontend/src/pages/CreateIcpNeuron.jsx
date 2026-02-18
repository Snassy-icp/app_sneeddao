import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { HttpAgent, Actor } from '@dfinity/agent';
import { Principal } from '@dfinity/principal';
import { IDL } from '@dfinity/candid';
import { createActor as createFactoryActor, canisterId as factoryCanisterId } from 'declarations/sneedapp';
import { createActor as createManagerActor } from 'declarations/sneed_icp_neuron_manager';
import { createActor as createLedgerActor } from 'external/icrc1_ledger';
import { createActor as createCmcActor, CMC_CANISTER_ID } from 'external/cmc';
import { createActor as createBackendActor, canisterId as backendCanisterId } from 'declarations/app_sneeddao_backend';
import Header from '../components/Header';
import CreateIcpNeuronWizard from '../components/CreateIcpNeuronWizard';
import { useTheme } from '../contexts/ThemeContext';
import { useAuth } from '../AuthContext';
import { useNaming } from '../NamingContext';
import { PrincipalDisplay, getPrincipalDisplayInfoFromContext, computeAccountId } from '../utils/PrincipalUtils';
import { FaCheckCircle, FaExclamationTriangle, FaArrowRight, FaWallet, FaPlus, FaChevronDown, FaChevronUp, FaBrain, FaSync, FaCog, FaShieldAlt, FaExternalLinkAlt } from 'react-icons/fa';
import { getCyclesColor, formatCyclesCompact, getNeuronManagerSettings } from '../utils/NeuronManagerSettings';
import { useSneedMembership } from '../hooks/useSneedMembership';
import { SneedMemberGateMessage, SneedMemberGateLoading, SneedMemberBadge, BetaWarningBanner, GATE_TYPES } from '../components/SneedMemberGate';
import { usePremiumStatus } from '../hooks/usePremiumStatus';

// Custom CSS for animations
const customStyles = `
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

@keyframes float {
    0%, 100% { transform: translateY(0px); }
    50% { transform: translateY(-8px); }
}

@keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.7; }
}

.neuron-float {
    animation: float 3s ease-in-out infinite;
}

.neuron-fade-in {
    animation: fadeInUp 0.5s ease-out forwards;
}

.neuron-card-animate {
    animation: fadeInUp 0.4s ease-out forwards;
}
`;

// Page accent colors - purple/violet theme for neurons/brain
const neuronPrimary = '#8b5cf6';
const neuronSecondary = '#a78bfa';
const neuronAccent = '#c4b5fd';

const ICP_LEDGER_CANISTER_ID = 'ryjl3-tyaaa-aaaaa-aaaba-cai';
const E8S = 100_000_000;
const ICP_FEE = 10_000;
const MANAGEMENT_CANISTER_ID = Principal.fromText('aaaaa-aa');
const CANISTER_CREATION_OVERHEAD = 500_000_000_000; // ~500B cycles used for canister creation

// Beta end date - feature becomes available to everyone after this date
const BETA_END_DATE = new Date('2026-01-24T00:00:00Z');

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
    const navigate = useNavigate();
    const [copiedDeposit, setCopiedDeposit] = useState(false);
    const [copiedAccountId, setCopiedAccountId] = useState(false);
    
    // Wizard state
    const [showWizard, setShowWizard] = useState(false);
    const [lastCreatedCanisterId, setLastCreatedCanisterId] = useState(null);
    const [copiedLastCreated, setCopiedLastCreated] = useState(false);
    
    // Collapsible managers list
    const [managersExpanded, setManagersExpanded] = useState(true);
    
    // Sneed membership for beta access
    const { 
        isSneedMember, 
        sneedNeurons, 
        sneedVotingPower, 
        loading: loadingSneedVP 
    } = useSneedMembership();
    
    // Premium membership for discounted pricing
    const { isPremium, loading: loadingPremium } = usePremiumStatus(identity);
    
    // Admin check (for showing total managers)
    const [isAdmin, setIsAdmin] = useState(false);
    
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
    const [premiumFeeE8s, setPremiumFeeE8s] = useState(null); // Discounted fee for premium members
    const [userIcpBalance, setUserIcpBalance] = useState(null);
    const [paymentBalance, setPaymentBalance] = useState(null);
    const [conversionRate, setConversionRate] = useState(null);
    const [paymentSubaccount, setPaymentSubaccount] = useState(null);
    
    // Creation step: 'idle' | 'paying' | 'creating' | 'done'
    const [creationStep, setCreationStep] = useState('idle');
    const [progressMessage, setProgressMessage] = useState('');
    
    // Beta countdown state
    const [timeUntilPublic, setTimeUntilPublic] = useState(null);
    const [isBetaEnded, setIsBetaEnded] = useState(false);

    // Check admin status (for showing total managers)
    useEffect(() => {
        const checkAdmin = async () => {
            if (!isAuthenticated || !identity) {
                setIsAdmin(false);
                return;
            }
            try {
                const backendActor = createBackendActor(backendCanisterId, {
                    agentOptions: {
                        identity,
                        host: 'https://ic0.app'
                    }
                });
                const result = await backendActor.caller_is_admin();
                setIsAdmin(result);
            } catch (err) {
                console.error('Error checking admin status:', err);
                setIsAdmin(false);
            }
        };
        checkAdmin();
    }, [isAuthenticated, identity]);
    
    // Check if beta has ended and update countdown
    useEffect(() => {
        const updateCountdown = () => {
            const now = new Date();
            const diff = BETA_END_DATE - now;
            
            if (diff <= 0) {
                setIsBetaEnded(true);
                setTimeUntilPublic(null);
            } else {
                setIsBetaEnded(false);
                const days = Math.floor(diff / (1000 * 60 * 60 * 24));
                const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
                const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
                const seconds = Math.floor((diff % (1000 * 60)) / 1000);
                setTimeUntilPublic({ days, hours, minutes, seconds });
            }
        };

        // Initial update
        updateCountdown();
        
        // Update every second
        const interval = setInterval(updateCountdown, 1000);
        
        return () => clearInterval(interval);
    }, []);

    // User has access if they're a Sneed member OR if beta has ended
    const hasAccess = isSneedMember || isBetaEnded;

    const myPrincipal = identity?.getPrincipal?.() || null;
    const myAccountId = useMemo(() => {
        if (!myPrincipal) return null;
        return computeAccountId(myPrincipal);
    }, [myPrincipal]);

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
            
            const [version, cyclesBalance, managerCount, config, premiumFee] = await Promise.all([
                factory.getCurrentVersion(),
                factory.getCyclesBalance(),
                factory.getManagerCount(),
                factory.getPaymentConfig(),
                factory.getPremiumCreationFee(),
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
            
            setPremiumFeeE8s(Number(premiumFee));
            
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
            
            // Fetch wallet entries and official versions in parallel
            const [walletEntries, officialVersions] = await Promise.all([
                factory.getMyWallet().catch(() => []),
                factory.getOfficialVersions(),
            ]);
            const canisterIds = (walletEntries || [])
                .filter(e => !e.appId || e.appId === '' || e.appId === 'sneed-icp-staking-bot')
                .map(e => e.canisterId);
            
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
            setError('Failed to load your ICP staking bots');
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

    // Calculate effective fee (premium discount if applicable)
    const effectiveFeeE8s = isPremium && premiumFeeE8s !== null 
        ? premiumFeeE8s 
        : (paymentConfig?.creationFeeE8s || 0);
    
    // Calculate discount percentage
    const discountPercent = paymentConfig && premiumFeeE8s !== null && paymentConfig.creationFeeE8s > 0
        ? Math.round((1 - premiumFeeE8s / paymentConfig.creationFeeE8s) * 100)
        : 0;

    return (
        <div className='page-container' style={{ background: theme.colors.primaryGradient, minHeight: '100vh' }}>
            <style>{customStyles}</style>
            <Header />
            
            {/* Hero Section */}
            <div style={{
                background: `linear-gradient(135deg, ${theme.colors.primaryBg} 0%, ${neuronPrimary}15 50%, ${neuronSecondary}10 100%)`,
                borderBottom: `1px solid ${theme.colors.border}`,
                padding: '2.5rem 1.5rem',
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
                    background: `radial-gradient(circle, ${neuronPrimary}20 0%, transparent 70%)`,
                    pointerEvents: 'none'
                }} />
                <div style={{
                    position: 'absolute',
                    bottom: '-30%',
                    left: '5%',
                    width: '300px',
                    height: '300px',
                    background: `radial-gradient(circle, ${neuronSecondary}15 0%, transparent 70%)`,
                    pointerEvents: 'none'
                }} />
                
                <div style={{ maxWidth: '900px', margin: '0 auto', position: 'relative', zIndex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '1.25rem', marginBottom: '1rem' }}>
                        <div className="neuron-float" style={{
                            width: '64px',
                            height: '64px',
                            borderRadius: '18px',
                            background: `linear-gradient(135deg, ${neuronPrimary}, ${neuronSecondary})`,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            boxShadow: `0 8px 32px ${neuronPrimary}50`,
                            fontSize: '2rem'
                        }}>
                            🧠
                        </div>
                        <div>
                            <h1 style={{
                                fontSize: '2rem',
                                fontWeight: '700',
                                color: theme.colors.primaryText,
                                margin: 0,
                                letterSpacing: '-0.5px'
                            }}>
                                ICP Staking Bot
                            </h1>
                            <p style={{
                                color: theme.colors.secondaryText,
                                fontSize: '1rem',
                                margin: '0.25rem 0 0 0'
                            }}>
                                Create dedicated canisters to manage your ICP NNS neurons
                            </p>
                        </div>
                    </div>
                    
                    <Link 
                        to="/help/icp-neuron-manager" 
                        style={{ 
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '6px',
                            color: neuronPrimary, 
                            fontSize: '0.9rem', 
                            textDecoration: 'none',
                            fontWeight: '500'
                        }}
                    >
                        Learn how it works <FaArrowRight size={11} />
                    </Link>
                </div>
            </div>

            {/* Main Content */}
            <main style={{ maxWidth: '900px', margin: '0 auto', padding: '1.5rem 1rem' }}>
                
                {/* Factory Stats */}
                {factoryInfo && (
                    <div className="neuron-fade-in" style={{
                        display: 'flex',
                        gap: '1rem',
                        marginBottom: '1.5rem',
                        flexWrap: 'wrap'
                    }}>
                        <div style={{
                            flex: '1 1 150px',
                            background: theme.colors.cardGradient,
                            borderRadius: '12px',
                            padding: '1rem 1.25rem',
                            border: `1px solid ${theme.colors.border}`,
                            boxShadow: theme.colors.cardShadow,
                            textAlign: 'center'
                        }}>
                            <div style={{ color: theme.colors.mutedText, fontSize: '0.75rem', marginBottom: '4px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Version</div>
                            <div style={{ color: theme.colors.primaryText, fontSize: '1.25rem', fontWeight: '700' }}>
                                v{factoryInfo.version}
                            </div>
                        </div>
                        {isAdmin && (
                            <div style={{
                                flex: '1 1 150px',
                                background: theme.colors.cardGradient,
                                borderRadius: '12px',
                                padding: '1rem 1.25rem',
                                border: `1px solid ${theme.colors.border}`,
                                boxShadow: theme.colors.cardShadow,
                                textAlign: 'center'
                            }}>
                                <div style={{ color: theme.colors.mutedText, fontSize: '0.75rem', marginBottom: '4px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Total Managers</div>
                                <div style={{ color: theme.colors.primaryText, fontSize: '1.25rem', fontWeight: '700' }}>
                                    {factoryInfo.managerCount}
                                </div>
                            </div>
                        )}
                        <div style={{
                            flex: '1 1 150px',
                            background: theme.colors.cardGradient,
                            borderRadius: '12px',
                            padding: '1rem 1.25rem',
                            border: `1px solid ${theme.colors.border}`,
                            boxShadow: theme.colors.cardShadow,
                            textAlign: 'center'
                        }}>
                            <div style={{ color: theme.colors.mutedText, fontSize: '0.75rem', marginBottom: '4px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Factory Cycles</div>
                            <div style={{ color: theme.colors.primaryText, fontSize: '1.25rem', fontWeight: '700' }}>
                                {(factoryInfo.cyclesBalance / 1_000_000_000_000).toFixed(2)}T
                            </div>
                        </div>
                    </div>
                )}

                {/* Not authenticated message */}
                {!isAuthenticated && (
                    <div className="neuron-card-animate" style={{
                        background: theme.colors.cardGradient,
                        borderRadius: '16px',
                        padding: '2rem',
                        border: `1px solid ${theme.colors.border}`,
                        boxShadow: theme.colors.cardShadow,
                        textAlign: 'center'
                    }}>
                        <FaWallet size={40} style={{ color: neuronPrimary, marginBottom: '1rem' }} />
                        <p style={{ color: theme.colors.secondaryText, marginBottom: '1.5rem', fontSize: '1rem' }}>
                            Please log in to create and manage your ICP staking bots.
                        </p>
                        <button 
                            style={{
                                background: `linear-gradient(135deg, ${neuronPrimary}, ${neuronSecondary})`,
                                color: '#fff',
                                border: 'none',
                                borderRadius: '10px',
                                padding: '0.85rem 2rem',
                                fontSize: '1rem',
                                fontWeight: '600',
                                cursor: 'pointer',
                                boxShadow: `0 4px 16px ${neuronPrimary}40`
                            }} 
                            onClick={login}
                        >
                            Login with Internet Identity
                        </button>
                    </div>
                )}

                {/* Sneed DAO Membership Gating */}
                {isAuthenticated && loadingSneedVP && !isBetaEnded && (
                    <SneedMemberGateLoading />
                )}

                {/* Gate message with countdown for non-members during beta */}
                {isAuthenticated && !loadingSneedVP && !hasAccess && (
                    <SneedMemberGateMessage 
                        gateType={GATE_TYPES.BETA}
                        featureName="The ICP Staking Bot"
                    >
                        {/* Countdown Timer - rendered inside gate message after "Coming Soon" */}
                        {timeUntilPublic && (
                            <div style={{ 
                                padding: '16px',
                                marginBottom: '20px',
                                background: `linear-gradient(135deg, ${neuronPrimary}10 0%, ${neuronPrimary}05 100%)`,
                                borderRadius: '10px',
                                border: `1px solid ${neuronPrimary}30`,
                                textAlign: 'center'
                            }}>
                                <div style={{ 
                                    color: theme.colors.mutedText, 
                                    fontSize: '12px', 
                                    marginBottom: '10px',
                                    fontWeight: '500',
                                    textTransform: 'uppercase',
                                    letterSpacing: '0.5px'
                                }}>
                                    ⏰ Opens to everyone in
                                </div>
                                <div style={{ 
                                    display: 'flex', 
                                    justifyContent: 'center', 
                                    alignItems: 'baseline',
                                    gap: '4px',
                                    flexWrap: 'wrap'
                                }}>
                                    <span style={{ 
                                        fontSize: '28px', 
                                        fontWeight: '700', 
                                        color: neuronPrimary,
                                        fontFamily: 'monospace'
                                    }}>
                                        {timeUntilPublic.days}
                                    </span>
                                    <span style={{ fontSize: '11px', color: theme.colors.mutedText, marginRight: '8px' }}>d</span>
                                    
                                    <span style={{ 
                                        fontSize: '28px', 
                                        fontWeight: '700', 
                                        color: neuronPrimary,
                                        fontFamily: 'monospace'
                                    }}>
                                        {String(timeUntilPublic.hours).padStart(2, '0')}
                                    </span>
                                    <span style={{ fontSize: '11px', color: theme.colors.mutedText, marginRight: '8px' }}>h</span>
                                    
                                    <span style={{ 
                                        fontSize: '28px', 
                                        fontWeight: '700', 
                                        color: neuronPrimary,
                                        fontFamily: 'monospace'
                                    }}>
                                        {String(timeUntilPublic.minutes).padStart(2, '0')}
                                    </span>
                                    <span style={{ fontSize: '11px', color: theme.colors.mutedText, marginRight: '8px' }}>m</span>
                                    
                                    <span style={{ 
                                        fontSize: '28px', 
                                        fontWeight: '700', 
                                        color: neuronPrimary,
                                        fontFamily: 'monospace'
                                    }}>
                                        {String(timeUntilPublic.seconds).padStart(2, '0')}
                                    </span>
                                    <span style={{ fontSize: '11px', color: theme.colors.mutedText }}>s</span>
                                </div>
                                <div style={{ 
                                    marginTop: '8px', 
                                    fontSize: '11px', 
                                    color: theme.colors.mutedText 
                                }}>
                                    📅 January 24th, 2026
                                </div>
                            </div>
                        )}
                    </SneedMemberGateMessage>
                )}

                {/* Sneed Member Badge - show during beta for members */}
                {isAuthenticated && !loadingSneedVP && isSneedMember && !isBetaEnded && (
                    <SneedMemberBadge 
                        sneedNeurons={sneedNeurons}
                        sneedVotingPower={sneedVotingPower}
                    />
                )}

                {/* Beta Warning Banner - only show during beta for members */}
                {isAuthenticated && !loadingSneedVP && isSneedMember && !isBetaEnded && (
                    <BetaWarningBanner featureName="The ICP Staking Bot" />
                )}

                {/* Create Manager Section - Show Wizard or Launch Button */}
                {isAuthenticated && hasAccess && (
                    <>
                        {showWizard ? (
                            <div className="neuron-card-animate" style={{
                                background: theme.colors.cardGradient,
                                borderRadius: '16px',
                                padding: '1.5rem',
                                border: `1px solid ${theme.colors.border}`,
                                boxShadow: theme.colors.cardShadow,
                                marginBottom: '1.5rem'
                            }}>
                                <CreateIcpNeuronWizard 
                                    onComplete={(canisterId) => {
                                        setLastCreatedCanisterId(canisterId);
                                        fetchMyManagers();
                                        fetchFactoryInfo();
                                    }}
                                    onCancel={() => setShowWizard(false)}
                                />
                            </div>
                        ) : (
                            <div className="neuron-card-animate" style={{
                                background: theme.colors.cardGradient,
                                borderRadius: '16px',
                                padding: '2rem',
                                border: `2px solid ${neuronPrimary}30`,
                                boxShadow: theme.colors.cardShadow,
                                marginBottom: '1.5rem',
                                textAlign: 'center'
                            }}>
                                <div style={{
                                    width: '56px',
                                    height: '56px',
                                    borderRadius: '14px',
                                    background: `linear-gradient(135deg, ${neuronPrimary}30, ${neuronPrimary}10)`,
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    margin: '0 auto 1rem'
                                }}>
                                    <FaPlus style={{ color: neuronPrimary, fontSize: '24px' }} />
                                </div>
                                <h3 style={{ color: theme.colors.primaryText, marginBottom: '0.75rem', fontSize: '1.2rem', fontWeight: '600' }}>
                                    Create New Staking Bot
                                </h3>
                                <p style={{ color: theme.colors.secondaryText, fontSize: '0.9rem', marginBottom: '1.5rem', maxWidth: '400px', margin: '0 auto 1.5rem' }}>
                                    Create a dedicated canister to manage your ICP neurons with full control.
                                </p>
                                <button
                                    style={{ 
                                        background: `linear-gradient(135deg, ${neuronPrimary}, ${neuronSecondary})`,
                                        color: '#fff',
                                        border: 'none',
                                        borderRadius: '10px',
                                        padding: '0.9rem 2rem',
                                        fontSize: '1rem',
                                        fontWeight: '600',
                                        cursor: 'pointer',
                                        display: 'inline-flex',
                                        alignItems: 'center',
                                        gap: '10px',
                                        boxShadow: `0 4px 16px ${neuronPrimary}40`
                                    }}
                                    onClick={() => setShowWizard(true)}
                                >
                                    <FaPlus size={14} />
                                    Create Staking Bot
                                </button>
                                
                                {/* Quick info */}
                                {paymentConfig && (
                                    <div style={{ marginTop: '1.25rem', color: theme.colors.mutedText, fontSize: '0.85rem' }}>
                                        Creation fee: <strong style={{ color: isPremium ? '#FFD700' : theme.colors.primaryText }}>
                                            {formatIcp(effectiveFeeE8s)} ICP
                                        </strong>
                                        {isPremium && discountPercent > 0 && (
                                            <span style={{
                                                marginLeft: '8px',
                                                background: 'linear-gradient(135deg, #FFD700, #FFA500)',
                                                color: '#1a1a2e',
                                                padding: '2px 8px',
                                                borderRadius: '10px',
                                                fontSize: '0.7rem',
                                                fontWeight: '700',
                                            }}>
                                                👑 {discountPercent}% OFF
                                            </span>
                                        )}
                                    </div>
                                )}
                            </div>
                        )}
                        
                        {/* Last Created Canister ID - shown prominently outside the wizard */}
                        {lastCreatedCanisterId && (
                            <div className="neuron-card-animate" style={{ 
                                background: `linear-gradient(135deg, ${theme.colors.success}10 0%, ${theme.colors.success}05 100%)`,
                                borderRadius: '16px',
                                padding: '1.25rem',
                                border: `2px solid ${theme.colors.success || '#22c55e'}`,
                                boxShadow: theme.colors.cardShadow,
                                marginBottom: '1.5rem'
                            }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '0.75rem' }}>
                                    <FaCheckCircle style={{ color: theme.colors.success || '#22c55e', fontSize: '20px' }} />
                                    <h3 style={{ color: theme.colors.primaryText, margin: 0, fontSize: '1rem', fontWeight: '600' }}>
                                        ✨ Staking Bot Created
                                    </h3>
                                </div>
                                <div style={{ color: theme.colors.secondaryText, fontSize: '0.85rem', marginBottom: '0.75rem' }}>
                                    Your new canister ID (save this for reference):
                                </div>
                                <div style={{ 
                                    display: 'flex', 
                                    alignItems: 'center', 
                                    gap: '10px',
                                    background: theme.colors.cardGradient,
                                    padding: '0.75rem',
                                    borderRadius: '10px',
                                    flexWrap: 'wrap',
                                    border: `1px solid ${theme.colors.border}`
                                }}>
                                    <code style={{ 
                                        flex: 1, 
                                        fontFamily: 'monospace', 
                                        fontSize: '0.9rem', 
                                        color: theme.colors.primaryText,
                                        wordBreak: 'break-all',
                                        minWidth: '200px',
                                    }}>
                                        {lastCreatedCanisterId}
                                    </code>
                                    <button
                                        onClick={() => {
                                            navigator.clipboard.writeText(lastCreatedCanisterId);
                                            setCopiedLastCreated(true);
                                            setTimeout(() => setCopiedLastCreated(false), 1500);
                                        }}
                                        style={{
                                            padding: '0.5rem 1rem',
                                            borderRadius: '8px',
                                            border: 'none',
                                            background: neuronPrimary,
                                            color: '#fff',
                                            fontWeight: '600',
                                            fontSize: '0.8rem',
                                            cursor: 'pointer',
                                        }}
                                    >
                                        {copiedLastCreated ? '✓ Copied!' : 'Copy'}
                                    </button>
                                    <Link
                                        to={`/icp_neuron_manager/${lastCreatedCanisterId}`}
                                        style={{
                                            padding: '0.5rem 1rem',
                                            borderRadius: '8px',
                                            background: theme.colors.success || '#22c55e',
                                            color: '#fff',
                                            fontWeight: '600',
                                            fontSize: '0.8rem',
                                            textDecoration: 'none',
                                            display: 'flex',
                                            alignItems: 'center',
                                            gap: '6px',
                                        }}
                                    >
                                        Open Manager <FaArrowRight size={10} />
                                    </Link>
                                </div>
                                <button
                                    onClick={() => setLastCreatedCanisterId(null)}
                                    style={{
                                        marginTop: '0.75rem',
                                        padding: '0.4rem 0.75rem',
                                        borderRadius: '6px',
                                        border: `1px solid ${theme.colors.border}`,
                                        background: 'transparent',
                                        color: theme.colors.mutedText,
                                        fontSize: '0.8rem',
                                        cursor: 'pointer',
                                    }}
                                >
                                    Dismiss
                                </button>
                            </div>
                        )}
                    </>
                )}

                {/* Success message */}
                {success && (
                    <div style={{ 
                        background: `${theme.colors.success || '#22c55e'}15`, 
                        border: `1px solid ${theme.colors.success || '#22c55e'}`,
                        color: theme.colors.success || '#22c55e',
                        padding: '1rem 1.25rem',
                        borderRadius: '12px',
                        marginBottom: '1.5rem',
                        whiteSpace: 'pre-line',
                        fontFamily: 'monospace',
                    }}>
                        {success}
                    </div>
                )}

                {/* Error message */}
                {error && (
                    <div style={{ 
                        background: `${theme.colors.error}15`, 
                        border: `1px solid ${theme.colors.error}`,
                        color: theme.colors.error,
                        padding: '1rem 1.25rem',
                        borderRadius: '12px',
                        marginBottom: '1.5rem',
                        textAlign: 'center'
                    }}>
                        {error}
                    </div>
                )}

                {/* My Managers List - Collapsible */}
                {isAuthenticated && (
                    <div style={{ marginBottom: '1.5rem' }}>
                        {/* Collapsible Header */}
                        <div 
                            onClick={() => setManagersExpanded(!managersExpanded)}
                            style={{ 
                                display: 'flex', 
                                alignItems: 'center', 
                                justifyContent: 'space-between',
                                cursor: 'pointer',
                                marginBottom: managersExpanded ? '1rem' : '0',
                                padding: '0.75rem 0',
                            }}
                        >
                            <h2 style={{ 
                                color: theme.colors.primaryText, 
                                margin: 0, 
                                display: 'flex', 
                                alignItems: 'center', 
                                gap: '10px',
                                fontSize: '1.15rem',
                                fontWeight: '600'
                            }}>
                                <FaBrain style={{ color: neuronPrimary }} />
                                Your Staking Bots {managers.length > 0 && (
                                    <span style={{
                                        background: `${neuronPrimary}20`,
                                        color: neuronPrimary,
                                        padding: '2px 10px',
                                        borderRadius: '12px',
                                        fontSize: '0.8rem',
                                        fontWeight: '600'
                                    }}>
                                        {managers.length}
                                    </span>
                                )}
                            </h2>
                            <div style={{ 
                                display: 'flex', 
                                alignItems: 'center', 
                                gap: '10px',
                                color: theme.colors.mutedText,
                            }}>
                                {!managersExpanded && managers.length > 0 && (
                                    <span style={{ fontSize: '0.8rem' }}>Click to expand</span>
                                )}
                                {managersExpanded ? <FaChevronUp /> : <FaChevronDown />}
                            </div>
                        </div>

                        {/* Collapsible Content */}
                        {managersExpanded && (
                            <>
                                {loading ? (
                                    <div style={{ 
                                        textAlign: 'center', 
                                        padding: '2.5rem', 
                                        color: theme.colors.secondaryText,
                                        background: theme.colors.cardGradient,
                                        borderRadius: '16px',
                                        border: `1px solid ${theme.colors.border}`
                                    }}>
                                        <FaSync className="spin" style={{ marginBottom: '0.75rem', fontSize: '1.5rem', color: neuronPrimary }} />
                                        <div>Loading your managers...</div>
                                    </div>
                                ) : managers.length === 0 ? (
                                    <div style={{
                                        background: theme.colors.cardGradient,
                                        borderRadius: '16px',
                                        padding: '2rem',
                                        border: `1px solid ${theme.colors.border}`,
                                        boxShadow: theme.colors.cardShadow,
                                        textAlign: 'center'
                                    }}>
                                        <p style={{ color: theme.colors.secondaryText, marginBottom: '0.5rem' }}>
                                            You haven't created any ICP staking bots yet.
                                        </p>
                                        <p style={{ color: theme.colors.mutedText, fontSize: '0.85rem' }}>
                                            Use the form above to create your first ICP staking bot!
                                        </p>
                                    </div>
                                ) : (
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                                        {managers.map((manager, index) => {
                                            const canisterIdText = manager.canisterId.toText();
                                            const displayInfo = getPrincipalDisplayInfoFromContext(canisterIdText, principalNames, principalNicknames);
                                            return (
                                                <div 
                                                    key={canisterIdText} 
                                                    className="neuron-card-animate"
                                                    style={{
                                                        background: theme.colors.cardGradient,
                                                        borderRadius: '14px',
                                                        border: `1px solid ${theme.colors.border}`,
                                                        boxShadow: theme.colors.cardShadow,
                                                        overflow: 'hidden',
                                                        animationDelay: `${index * 0.05}s`
                                                    }}
                                                >
                                                    {/* Card Header */}
                                                    <div style={{
                                                        padding: '1rem 1.25rem',
                                                        background: `linear-gradient(90deg, ${neuronPrimary}08 0%, transparent 100%)`,
                                                        borderBottom: `1px solid ${theme.colors.border}`,
                                                        display: 'flex',
                                                        alignItems: 'center',
                                                        justifyContent: 'space-between',
                                                        flexWrap: 'wrap',
                                                        gap: '0.75rem'
                                                    }}>
                                                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: '250px', flex: 1 }}>
                                                            <div style={{
                                                                width: '32px',
                                                                height: '32px',
                                                                borderRadius: '8px',
                                                                background: `linear-gradient(135deg, ${neuronPrimary}30, ${neuronPrimary}10)`,
                                                                display: 'flex',
                                                                alignItems: 'center',
                                                                justifyContent: 'center',
                                                                flexShrink: 0
                                                            }}>
                                                                <FaBrain style={{ color: neuronPrimary, fontSize: '14px' }} />
                                                            </div>
                                                            <PrincipalDisplay
                                                                principal={canisterIdText}
                                                                displayInfo={displayInfo}
                                                                showCopyButton={true}
                                                                isAuthenticated={isAuthenticated}
                                                                noLink={true}
                                                            />
                                                        </div>
                                                        <Link 
                                                            to={`/icp_neuron_manager/${canisterIdText}`}
                                                            style={{
                                                                background: `linear-gradient(135deg, ${neuronPrimary}, ${neuronSecondary})`,
                                                                color: '#fff',
                                                                padding: '0.5rem 1rem',
                                                                borderRadius: '8px',
                                                                textDecoration: 'none',
                                                                fontSize: '0.85rem',
                                                                fontWeight: '600',
                                                                display: 'flex',
                                                                alignItems: 'center',
                                                                gap: '6px',
                                                                flexShrink: 0
                                                            }}
                                                        >
                                                            Manage <FaArrowRight size={10} />
                                                        </Link>
                                                    </div>
                                                    
                                                    {/* Card Body - Stats */}
                                                    <div style={{ 
                                                        padding: '0.75rem 1.25rem',
                                                        display: 'flex',
                                                        alignItems: 'center',
                                                        justifyContent: 'space-between',
                                                        flexWrap: 'wrap',
                                                        gap: '0.75rem'
                                                    }}>
                                                        <div style={{ display: 'flex', alignItems: 'center', gap: '1.25rem', flexWrap: 'wrap' }}>
                                                            <div>
                                                                <span style={{ color: theme.colors.mutedText, fontSize: '0.75rem' }}>Neurons: </span>
                                                                {(() => {
                                                                    const count = neuronCounts[manager.canisterId.toText()];
                                                                    if (count === undefined || count === null) {
                                                                        return <span style={{ color: theme.colors.mutedText }}>...</span>;
                                                                    } else if (count === 0) {
                                                                        return <span style={{ color: theme.colors.warning || '#f59e0b', fontWeight: '600' }}>None yet</span>;
                                                                    } else {
                                                                        return <span style={{ color: theme.colors.success || '#22c55e', fontWeight: '600' }}>{count}</span>;
                                                                    }
                                                                })()}
                                                            </div>
                                                            {managerCycles[canisterIdText] !== undefined && managerCycles[canisterIdText] !== null && (
                                                                <div 
                                                                    style={{ 
                                                                        color: getCyclesColor(managerCycles[canisterIdText], cycleSettings), 
                                                                        fontSize: '0.8rem', 
                                                                        display: 'flex',
                                                                        alignItems: 'center',
                                                                        gap: '4px',
                                                                    }}
                                                                    title={`${managerCycles[canisterIdText].toLocaleString()} cycles`}
                                                                >
                                                                    ⚡ {formatCyclesCompact(managerCycles[canisterIdText])}
                                                                </div>
                                                            )}
                                                        </div>
                                                        {managerVersions[canisterIdText] && (
                                                            <span 
                                                                style={{ 
                                                                    color: isVersionOutdated(managerVersions[canisterIdText]) ? '#f59e0b' : theme.colors.mutedText, 
                                                                    fontSize: '0.75rem', 
                                                                    display: 'flex',
                                                                    alignItems: 'center',
                                                                    gap: '4px',
                                                                    background: isVersionOutdated(managerVersions[canisterIdText]) ? '#f59e0b15' : 'transparent',
                                                                    padding: isVersionOutdated(managerVersions[canisterIdText]) ? '2px 8px' : '0',
                                                                    borderRadius: '6px'
                                                                }}
                                                                title={isVersionOutdated(managerVersions[canisterIdText]) 
                                                                    ? `Newer version available: v${Number(latestOfficialVersion.major)}.${Number(latestOfficialVersion.minor)}.${Number(latestOfficialVersion.patch)}`
                                                                    : undefined
                                                                }
                                                            >
                                                                {isVersionOutdated(managerVersions[canisterIdText]) && '⚠️ '}
                                                                v{Number(managerVersions[canisterIdText].major)}.{Number(managerVersions[canisterIdText].minor)}.{Number(managerVersions[canisterIdText].patch)}
                                                            </span>
                                                        )}
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                )}

                                {managers.length > 0 && (
                                    <div style={{ textAlign: 'center', marginTop: '1rem' }}>
                                        <button 
                                            style={{
                                                background: 'transparent',
                                                color: theme.colors.secondaryText,
                                                border: `1px solid ${theme.colors.border}`,
                                                borderRadius: '8px',
                                                padding: '0.5rem 1rem',
                                                fontSize: '0.85rem',
                                                cursor: 'pointer',
                                                display: 'inline-flex',
                                                alignItems: 'center',
                                                gap: '6px'
                                            }}
                                            onClick={fetchMyManagers}
                                            disabled={loading}
                                        >
                                            <FaSync size={11} /> Refresh List
                                        </button>
                                    </div>
                                )}
                            </>
                        )}
                    </div>
                )}

                {/* How It Works Section */}
                <div className="neuron-card-animate" style={{
                    background: theme.colors.cardGradient,
                    borderRadius: '16px',
                    padding: '1.5rem',
                    border: `1px solid ${theme.colors.border}`,
                    boxShadow: theme.colors.cardShadow,
                    marginBottom: '1.5rem'
                }}>
                    <h3 style={{ 
                        color: theme.colors.primaryText, 
                        marginBottom: '1rem',
                        fontSize: '1.1rem',
                        fontWeight: '600',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px'
                    }}>
                        <FaCog style={{ color: neuronPrimary }} />
                        How It Works
                    </h3>
                    <ol style={{ 
                        color: theme.colors.secondaryText, 
                        lineHeight: '1.8', 
                        paddingLeft: '1.25rem',
                        margin: 0,
                        fontSize: '0.9rem'
                    }}>
                        <li><strong style={{ color: theme.colors.primaryText }}>Pay the Creation Fee:</strong> Send ICP to cover the cost of creating your dedicated canister.</li>
                        <li><strong style={{ color: theme.colors.primaryText }}>Create a Manager:</strong> Each manager is a dedicated canister that can control multiple ICP neurons.</li>
                        <li><strong style={{ color: theme.colors.primaryText }}>Stake Neurons:</strong> Use the manager to stake ICP directly from your wallet and create NNS neurons.</li>
                        <li><strong style={{ color: theme.colors.primaryText }}>Manage Your Neurons:</strong> Vote, set dissolve delay, manage maturity, and more.</li>
                        <li><strong style={{ color: theme.colors.primaryText }}>Transfer Ownership:</strong> Transfer neuron ownership by transferring control of the canister.</li>
                    </ol>
                </div>
                
                {/* Safety Info */}
                <div className="neuron-card-animate" style={{
                    background: `linear-gradient(135deg, ${theme.colors.success}08 0%, ${theme.colors.success}03 100%)`,
                    borderRadius: '14px',
                    padding: '1.25rem',
                    border: `1px solid ${theme.colors.success}25`,
                    marginBottom: '1.5rem',
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: '1rem'
                }}>
                    <div style={{
                        width: '36px',
                        height: '36px',
                        borderRadius: '10px',
                        background: `${theme.colors.success}20`,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        flexShrink: 0
                    }}>
                        <FaShieldAlt style={{ color: theme.colors.success, fontSize: '16px' }} />
                    </div>
                    <div>
                        <h4 style={{ color: theme.colors.primaryText, marginBottom: '0.5rem', fontSize: '0.95rem', fontWeight: '600' }}>
                            Your Neurons Are Always Safe
                        </h4>
                        <p style={{ color: theme.colors.secondaryText, fontSize: '0.85rem', lineHeight: '1.6', marginBottom: '0.75rem' }}>
                            <strong>What if my canister runs out of cycles?</strong> Your neurons are stored on the NNS governance 
                            system, not in your canister. Even if your canister freezes or is deleted, your neurons remain safe, 
                            you stay the controller, and you can always top up cycles and reinstall the code.
                        </p>
                        <Link 
                            to="/help/icp-neuron-manager#cycles-depletion" 
                            style={{ 
                                color: theme.colors.success, 
                                fontSize: '0.8rem',
                                textDecoration: 'none',
                                fontWeight: '600',
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '4px'
                            }}
                        >
                            Learn more about cycles and safety <FaExternalLinkAlt size={9} />
                        </Link>
                    </div>
                </div>
                
                {/* Access Points Info */}
                <div className="neuron-card-animate" style={{
                    background: theme.colors.cardGradient,
                    borderRadius: '14px',
                    padding: '1.25rem',
                    border: `1px solid ${theme.colors.border}`,
                    boxShadow: theme.colors.cardShadow
                }}>
                    <h4 style={{ 
                        color: theme.colors.primaryText, 
                        marginBottom: '0.75rem', 
                        fontSize: '0.95rem',
                        fontWeight: '600',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px'
                    }}>
                        📍 Where to Find Your Managers
                    </h4>
                    <p style={{ color: theme.colors.secondaryText, fontSize: '0.85rem', lineHeight: '1.6', marginBottom: '0.75rem' }}>
                        Your ICP staking bots are accessible from multiple places:
                    </p>
                    <ul style={{ 
                        color: theme.colors.secondaryText, 
                        lineHeight: '1.8', 
                        paddingLeft: '1.25rem', 
                        margin: 0,
                        fontSize: '0.85rem'
                    }}>
                        <li>
                            <Link to="/wallet" style={{ color: neuronPrimary, fontWeight: '500' }}>Sneed Wallet</Link> – Quick access to your managers and neurons alongside your token balances
                        </li>
                        <li>
                            <Link to="/apps" style={{ color: neuronPrimary, fontWeight: '500' }}>Apps Page</Link> – Track all your canisters, monitor cycles, and organize them into groups
                        </li>
                        <li>
                            <span style={{ color: theme.colors.primaryText }}>This page</span> – View and manage all your ICP Staking Bots
                        </li>
                    </ul>
                </div>
            </main>
        </div>
    );
}

export default CreateIcpNeuron;
