import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { FaCopy, FaCheck, FaWallet, FaPaperPlane, FaKey, FaIdCard, FaExternalLinkAlt, FaSync, FaCoins, FaWater, FaLock, FaBug, FaTimes, FaBrain, FaBox, FaCrown, FaMicrochip, FaChevronDown, FaExchangeAlt, FaChartLine } from 'react-icons/fa';
import { createActor as createBackendActor, canisterId as backendCanisterId } from 'declarations/app_sneeddao_backend';
import { Principal } from '@dfinity/principal';
import { principalToSubAccount } from '@dfinity/utils';
import { useAuth } from './AuthContext';
import { useTheme } from './contexts/ThemeContext';
import { useNaming } from './NamingContext';
import { useWalletOptional } from './contexts/WalletContext';
import { useWalletLayout } from './contexts/WalletLayoutContext';
import { computeAccountId, PrincipalDisplay, getPrincipalDisplayInfoFromContext, isSnsCanisterType, getCanisterTypeIcon } from './utils/PrincipalUtils';
import { formatAmount } from './utils/StringUtils';
import { get_available, get_available_backend } from './utils/TokenUtils';
import { normalizeId } from './hooks/useNeuronsCache';
import { createActor as createLedgerActor } from 'external/icrc1_ledger';
import { createActor as createSneedLockActor, canisterId as sneedLockCanisterId } from 'declarations/sneed_lock';
import { createActor as createFactoryActor, canisterId as factoryCanisterId } from 'declarations/sneedapp';
import { createActor as createManagerActor } from 'declarations/sneed_icp_neuron_manager';
import { HttpAgent, Actor } from '@dfinity/agent';
import { uint8ArrayToHex } from './utils/NeuronUtils';
import { getCanisterInfo } from './utils/BackendUtils';
import SendTokenModal from './SendTokenModal';
import SendLiquidityPositionModal from './SendLiquidityPositionModal';
import StatusLamp, { getAllChoresSummaryLamp, getSummaryLabel } from './components/ChoreStatusLamp';
import UpgradeBotsDialog from './components/UpgradeBotsDialog';
import TopUpCyclesDialog from './components/TopUpCyclesDialog';

// Management canister constants
const MANAGEMENT_CANISTER_ID = 'aaaaa-aa';
const managementCanisterIdlFactory = ({ IDL }) => {
    return IDL.Service({
        canister_status: IDL.Func(
            [IDL.Record({ canister_id: IDL.Principal })],
            [IDL.Record({
                status: IDL.Variant({ running: IDL.Null, stopping: IDL.Null, stopped: IDL.Null }),
                memory_size: IDL.Nat,
                cycles: IDL.Nat,
                settings: IDL.Record({
                    freezing_threshold: IDL.Nat,
                    controllers: IDL.Vec(IDL.Principal),
                    memory_allocation: IDL.Nat,
                    compute_allocation: IDL.Nat,
                }),
                module_hash: IDL.Opt(IDL.Vec(IDL.Nat8)),
            })],
            [] // Must be update call (not query) — management canister doesn't support queries
        ),
    });
};
import TokenCardModal from './components/TokenCardModal';
import PositionCardModal from './components/PositionCardModal';
import DappCardModal from './components/DappCardModal';
import TransferCanisterModal from './components/TransferCanisterModal';
import LockModal from './LockModal';
import { usePremiumStatus } from './hooks/usePremiumStatus';
import './PrincipalBox.css';

function PrincipalBox({ principalText, onLogout, compact = false }) {
    const [showPopup, setShowPopup] = useState(false);
    const [copyFeedback, setCopyFeedback] = useState('');
    const [copied, setCopied] = useState(false);
    const [showAccountId, setShowAccountId] = useState(false);
    const [showSendModal, setShowSendModal] = useState(false);
    const [selectedToken, setSelectedToken] = useState(null);
    const [showTokenDetailModal, setShowTokenDetailModal] = useState(false);
    const [detailToken, setDetailToken] = useState(null);
    const [showLockModal, setShowLockModal] = useState(false);
    const [lockToken, setLockToken] = useState(null);
    const [isRefreshingToken, setIsRefreshingToken] = useState(false);
    const [upgradeDialogOpen, setUpgradeDialogOpen] = useState(false);
    const [topUpDialogOpen, setTopUpDialogOpen] = useState(false);
    const [tokenLocks, setTokenLocks] = useState([]);
    const [lockDetailsLoading, setLockDetailsLoading] = useState({});
    const [hideDust, setHideDust] = useState(() => {
        try {
            const saved = localStorage.getItem('hideDust_Wallet');
            return saved !== null ? JSON.parse(saved) : false;
        } catch {
            return false;
        }
    });
    const [walletTab, setWalletTab] = useState('tokens'); // 'tokens', 'positions' (Liquidity), or 'dapps' (Apps)
    const [showPositionDetailModal, setShowPositionDetailModal] = useState(false);
    const [detailPosition, setDetailPosition] = useState(null);
    const [detailPositionDetails, setDetailPositionDetails] = useState(null);
    const [isRefreshingPosition, setIsRefreshingPosition] = useState(false);
    const [showSendLiquidityPositionModal, setShowSendLiquidityPositionModal] = useState(false);
    const [selectedLiquidityPosition, setSelectedLiquidityPosition] = useState(null);
    const [showDappDetailModal, setShowDappDetailModal] = useState(false);
    const [detailDapp, setDetailDapp] = useState(null); // { canisterId, isNeuronManager, ... }
    const [isRefreshingDapp, setIsRefreshingDapp] = useState(false);
    const [showTransferCanisterModal, setShowTransferCanisterModal] = useState(false);
    const [transferCanisterId, setTransferCanisterId] = useState(null);
    const [transferIsNeuronManager, setTransferIsNeuronManager] = useState(false);
    const [isAdmin, setIsAdmin] = useState(false);
    const [showDebugReportModal, setShowDebugReportModal] = useState(false);
    const [debugReportCopied, setDebugReportCopied] = useState(false);
    const popupRef = useRef(null);
    const { login, identity } = useAuth();
    const { theme } = useTheme();
    const { getPrincipalDisplayName, principalCanisterTypes } = useNaming();
    const walletContext = useWalletOptional();
    const walletLayoutCtx = useWalletLayout();
    const navigate = useNavigate();
    const { isPremium } = usePremiumStatus(identity);
    
    // Get wallet tokens from context
    const walletTokens = walletContext?.walletTokens || [];
    const walletLoading = walletContext?.walletLoading || false;
    const hasFetchedInitial = walletContext?.hasFetchedInitial || false;
    const cacheCheckComplete = walletContext?.cacheCheckComplete || false;
    const sendToken = walletContext?.sendToken;
    const isTokenSns = walletContext?.isTokenSns;
    const refreshWallet = walletContext?.refreshWallet;
    const contextRefreshingTokens = walletContext?.refreshingTokens || new Map();
    const [isRefreshingWallet, setIsRefreshingWallet] = useState(false);
    
    // Get liquidity positions from context
    const liquidityPositions = walletContext?.liquidityPositions || [];
    const positionsLoading = walletContext?.positionsLoading || false;
    const hasFetchedPositions = walletContext?.hasFetchedPositions || false;
    
    // Get neuron managers from context
    const neuronManagers = walletContext?.neuronManagers || [];
    const managerNeurons = walletContext?.managerNeurons || {};
    const managerNeuronsTotal = walletContext?.managerNeuronsTotal || 0;
    const managerChoreStatuses = walletContext?.managerChoreStatuses || {};
    const neuronManagersLoading = walletContext?.neuronManagersLoading || false;
    const hasFetchedManagers = walletContext?.hasFetchedManagers || false;
    const outdatedManagers = walletContext?.outdatedManagers || [];
    const latestOfficialVersion = walletContext?.latestOfficialVersion;
    const fetchManagerNeuronsData = walletContext?.fetchManagerNeuronsData;
    const lowCyclesCanisters = walletContext?.lowCyclesCanisters || [];
    const contextSetNeuronManagerCycles = walletContext?.setNeuronManagerCycles;
    const contextSetTrackedCanisterCycles = walletContext?.setTrackedCanisterCycles;
    
    // Get tracked canisters from context
    const trackedCanisters = walletContext?.trackedCanisters || [];
    const trackedCanistersLoading = walletContext?.trackedCanistersLoading || false;
    const hasFetchedTrackedCanisters = walletContext?.hasFetchedTrackedCanisters || false;
    
    // Stable serialised key for trackedCanisters — prevents re-firing the
    // fetchCanisterStatus effect when the array reference changes but the
    // content is identical (e.g. cache-restore followed by fresh-fetch).
    const trackedCanistersKey = useMemo(
        () => trackedCanisters.join(','),
        [trackedCanisters]
    );
    
    // Neuron manager detection state for tracked canisters
    const [officialVersions, setOfficialVersions] = useState([]);
    const fetchCanisterStatusIdRef = useRef(0); // dedup guard for fetchCanisterStatus
    const [trackedCanisterStatus, setTrackedCanisterStatus] = useState({}); // canisterId -> { cycles, memory, moduleHash }
    const [detectedNeuronManagers, setDetectedNeuronManagers] = useState({}); // canisterId -> { version, neuronCount, cycles, memory, isController, isValid }
    
    // Get shared controller status from context (same data as /wallet page)
    const neuronManagerIsController = walletContext?.neuronManagerIsController || {};
    const trackedCanisterIsController = walletContext?.trackedCanisterIsController || {};
    
    // All bot entries from sneedapp (with appId) - for bot type icon detection
    const allBotEntries = walletContext?.allBotEntries || [];

    // Build canisterId → appId map for quick lookup (detect trading bots etc.)
    const botAppIdMap = useMemo(() => {
        const map = {};
        for (const entry of allBotEntries) {
            const cid = typeof entry.canisterId === 'string' ? entry.canisterId : entry.canisterId?.toString?.() || '';
            if (cid && entry.appId) map[cid] = entry.appId;
        }
        return map;
    }, [allBotEntries]);

    // Get shared ICP price from context (ensures same value as Wallet page)
    const icpPrice = walletContext?.icpPrice;

    // Sync tracked canister cycles to context for low-cycles notifications
    useEffect(() => {
        if (contextSetTrackedCanisterCycles && Object.keys(trackedCanisterStatus).length > 0) {
            const cyclesMap = {};
            for (const [cid, status] of Object.entries(trackedCanisterStatus)) {
                if (status.cycles !== null && status.cycles !== undefined) {
                    cyclesMap[cid] = status.cycles;
                }
            }
            if (Object.keys(cyclesMap).length > 0) {
                contextSetTrackedCanisterCycles(prev => ({ ...(prev || {}), ...cyclesMap }));
            }
        }
    }, [trackedCanisterStatus, contextSetTrackedCanisterCycles]);
    
    // Sync hideDust with localStorage and listen for changes from other components
    useEffect(() => {
        localStorage.setItem('hideDust_Wallet', JSON.stringify(hideDust));
    }, [hideDust]);

    useEffect(() => {
        const handleStorageChange = (e) => {
            if (e.key === 'hideDust_Wallet') {
                try {
                    setHideDust(JSON.parse(e.newValue));
                } catch {
                    // ignore
                }
            }
        };
        window.addEventListener('storage', handleStorageChange);
        return () => window.removeEventListener('storage', handleStorageChange);
    }, []);

    // Check admin status for debug features
    useEffect(() => {
        const checkAdmin = async () => {
            if (!identity) {
                setIsAdmin(false);
                return;
            }
            try {
                const backendActor = createBackendActor(backendCanisterId, {
                    agentOptions: { identity }
                });
                const result = await backendActor.caller_is_admin();
                setIsAdmin(result);
            } catch (err) {
                console.warn('Error checking admin status:', err);
                setIsAdmin(false);
            }
        };
        checkAdmin();
    }, [identity]);

    // Fetch official versions for neuron manager detection
    useEffect(() => {
        const fetchOfficialVersions = async () => {
            if (!identity) return;
            
            try {
                const host = process.env.DFX_NETWORK === 'ic' || process.env.DFX_NETWORK === 'staging' 
                    ? 'https://ic0.app' 
                    : 'http://localhost:4943';
                const agent = new HttpAgent({ identity, host });
                if (process.env.DFX_NETWORK !== 'ic' && process.env.DFX_NETWORK !== 'staging') {
                    await agent.fetchRootKey();
                }
                
                const factory = createFactoryActor(factoryCanisterId, { agent });
                const fetchedOfficialVersions = await factory.getOfficialVersions();
                setOfficialVersions(fetchedOfficialVersions || []);
            } catch (err) {
                console.warn('[QuickWallet] Error fetching official versions:', err);
            }
        };
        
        fetchOfficialVersions();
    }, [identity]);

    // Fetch canister status (cycles, memory, moduleHash) for tracked canisters.
    // LAZY: only runs when the quick-wallet popup is open, avoiding expensive
    // management-canister update calls on every page load.
    // SEQUENTIAL: processes one canister at a time to avoid flooding the browser
    // with concurrent HTTP connections (each update call = 1 POST + many read_state polls).
    useEffect(() => {
        if (!showPopup || !identity || trackedCanisters.length === 0) return;

        const currentFetchId = ++fetchCanisterStatusIdRef.current;

        const fetchCanisterStatus = async () => {
            try {
                const host = process.env.DFX_NETWORK === 'ic' || process.env.DFX_NETWORK === 'staging' 
                    ? 'https://ic0.app' 
                    : 'http://localhost:4943';
                const agent = new HttpAgent({ identity, host });
                if (process.env.DFX_NETWORK !== 'ic' && process.env.DFX_NETWORK !== 'staging') {
                    await agent.fetchRootKey();
                }
                
                if (currentFetchId !== fetchCanisterStatusIdRef.current) return; // superseded
                
                const statusMap = {};
                // Process canisters ONE AT A TIME to avoid flooding browser connections
                for (const canisterId of trackedCanisters) {
                    if (currentFetchId !== fetchCanisterStatusIdRef.current) return; // superseded
                    
                    let cycles = null;
                    let memory = null;
                    let isController = false;
                    let moduleHash = null;
                    
                    try {
                        const canisterIdPrincipal = Principal.fromText(canisterId);
                        const mgmtActor = Actor.createActor(managementCanisterIdlFactory, {
                            agent,
                            canisterId: MANAGEMENT_CANISTER_ID,
                            callTransform: (methodName, args, callConfig) => ({
                                ...callConfig,
                                effectiveCanisterId: canisterIdPrincipal,
                            }),
                        });
                        const status = await mgmtActor.canister_status({ canister_id: canisterIdPrincipal });
                        cycles = Number(status.cycles);
                        memory = Number(status.memory_size);
                        moduleHash = status.module_hash[0] ? uint8ArrayToHex(status.module_hash[0]) : null;
                        isController = true;
                    } catch (err) {
                        // Not a controller - try backend fallback for module_hash
                        try {
                            const result = await getCanisterInfo(identity, canisterId);
                            if (result && 'ok' in result) {
                                moduleHash = result.ok.module_hash[0] ? uint8ArrayToHex(result.ok.module_hash[0]) : null;
                            }
                        } catch (fallbackErr) {
                            // Ignore fallback errors
                        }
                    }
                    
                    statusMap[canisterId] = { cycles, memory, isController, moduleHash };
                }
                if (currentFetchId !== fetchCanisterStatusIdRef.current) return; // superseded
                setTrackedCanisterStatus(statusMap);
            } catch (err) {
                if (currentFetchId !== fetchCanisterStatusIdRef.current) return;
                console.warn('[QuickWallet] Error fetching canister status:', err);
            }
        };
        
        fetchCanisterStatus();
    }, [showPopup, identity, trackedCanistersKey]); // eslint-disable-line react-hooks/exhaustive-deps

    // Check if a module hash matches any known neuron manager version
    const isKnownNeuronManagerHash = useCallback((moduleHash) => {
        if (!moduleHash || officialVersions.length === 0) return null;
        const hashLower = moduleHash.toLowerCase();
        return officialVersions.find(v => v.wasmHash.toLowerCase() === hashLower) || null;
    }, [officialVersions]);

    // Fetch neuron manager info for a detected canister
    const fetchDetectedManagerInfo = useCallback(async (canisterId, existingStatus) => {
        if (!identity) return;
        
        try {
            const host = process.env.DFX_NETWORK === 'ic' || process.env.DFX_NETWORK === 'staging' 
                ? 'https://ic0.app' 
                : 'http://localhost:4943';
            const agent = new HttpAgent({ identity, host });
            if (process.env.DFX_NETWORK !== 'ic' && process.env.DFX_NETWORK !== 'staging') {
                await agent.fetchRootKey();
            }
            
            const managerActor = createManagerActor(canisterId, { agent });
            const [version, neuronIds] = await Promise.all([
                managerActor.getVersion(),
                managerActor.getNeuronIds(),
            ]);
            
            setDetectedNeuronManagers(prev => ({
                ...prev,
                [canisterId]: {
                    version,
                    neuronCount: neuronIds?.length || 0,
                    cycles: existingStatus?.cycles,
                    memory: existingStatus?.memory,
                    isController: existingStatus?.isController,
                    isValid: true,
                }
            }));
        } catch (err) {
            // Mark as detected but invalid
            setDetectedNeuronManagers(prev => ({
                ...prev,
                [canisterId]: {
                    version: null,
                    neuronCount: 0,
                    cycles: existingStatus?.cycles,
                    memory: existingStatus?.memory,
                    isController: existingStatus?.isController,
                    isValid: false,
                }
            }));
        }
    }, [identity]);

    // Detect neuron managers from tracked canisters based on module hash
    useEffect(() => {
        if (officialVersions.length === 0) return;
        
        for (const [canisterId, status] of Object.entries(trackedCanisterStatus)) {
            if (!status?.moduleHash) continue;
            if (detectedNeuronManagers[canisterId]) continue; // Already detected
            
            const matchedVersion = isKnownNeuronManagerHash(status.moduleHash);
            if (matchedVersion) {
                fetchDetectedManagerInfo(canisterId, status);
            }
        }
    }, [officialVersions, trackedCanisterStatus, detectedNeuronManagers, isKnownNeuronManagerHash, fetchDetectedManagerInfo]);

    // Helper to format cycles compactly
    const formatCyclesCompact = useCallback((cycles) => {
        if (cycles === null || cycles === undefined) return null;
        if (cycles >= 1e12) return `${(cycles / 1e12).toFixed(1)}T`;
        if (cycles >= 1e9) return `${(cycles / 1e9).toFixed(1)}B`;
        if (cycles >= 1e6) return `${(cycles / 1e6).toFixed(1)}M`;
        return cycles.toLocaleString();
    }, []);

    // Helper to format memory compactly
    const formatMemoryCompact = useCallback((bytes) => {
        if (bytes === null || bytes === undefined) return null;
        if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)}GB`;
        if (bytes >= 1e6) return `${(bytes / 1e6).toFixed(1)}MB`;
        if (bytes >= 1e3) return `${(bytes / 1e3).toFixed(1)}KB`;
        return `${bytes}B`;
    }, []);

    // Filter tokens based on hideDust setting, sorted by wallet layout
    const tokensWithBalance = useMemo(() => {
        // Debug: Check for duplicates in source array (using normalized principal comparison with fallback)
        const principalCounts = {};
        walletTokens.forEach(t => {
            const normalizedId = normalizeId(t.principal) || normalizeId(t.ledger_canister_id);
            principalCounts[normalizedId] = (principalCounts[normalizedId] || 0) + 1;
        });
        const duplicatePrincipals = Object.entries(principalCounts).filter(([, count]) => count > 1);
        if (duplicatePrincipals.length > 0) {
            console.error('%c🚨 [TOKENS] DUPLICATES in walletTokens!', 'background: #e74c3c; color: white; font-size: 14px;', duplicatePrincipals);
        }
        
        // Sort by layout order first
        const sorted = walletLayoutCtx?.sortByLayout
            ? walletLayoutCtx.sortByLayout('tokens', walletTokens, t => normalizeId(t.principal) || normalizeId(t.ledger_canister_id))
            : walletTokens;
        
        return sorted.filter(token => {
            const available = BigInt(token.available || token.balance || 0n);
            const locked = BigInt(token.locked || 0n);
            const staked = BigInt(token.staked || 0n);
            const maturity = BigInt(token.maturity || 0n);
            const rewards = BigInt(token.rewards || 0n);
            // Include neuron stake and maturity for SNS tokens (progressively loaded)
            const neuronStake = BigInt(token.neuronStake || 0n);
            const neuronMaturity = BigInt(token.neuronMaturity || 0n);
            const totalBalance = available + locked + staked + maturity + rewards + neuronStake + neuronMaturity;
            
            // Always filter out zero balance
            if (totalBalance === 0n) return false;
            
            // If hideDust is enabled, filter by USD value
            if (hideDust && token.conversion_rate) {
                const balanceNum = Number(totalBalance) / (10 ** (token.decimals || 8));
                const usdValue = balanceNum * token.conversion_rate;
                return usdValue >= 0.01;
            }
            
            return true;
        });
    }, [walletTokens, hideDust, walletLayoutCtx?.sortByLayout]);
    
    // Flatten positions for display in compact wallet (sorted by layout)
    const flattenedPositions = useMemo(() => {
        // Sort liquidity positions by wallet layout order first
        const sortedLPs = walletLayoutCtx?.sortByLayout
            ? walletLayoutCtx.sortByLayout('positions', liquidityPositions, lp => normalizeId(lp.swapCanisterId))
            : liquidityPositions;
        const positions = [];
        for (const lp of sortedLPs) {
            if (lp.positions && lp.positions.length > 0) {
                for (const positionDetails of lp.positions) {
                    positions.push({
                        position: lp,
                        positionDetails
                    });
                }
            }
        }
        return positions;
    }, [liquidityPositions, walletLayoutCtx?.sortByLayout]);

    // Calculate total positions USD value
    const totalPositionsUSD = useMemo(() => {
        let total = 0;
        let hasAnyValue = false;
        
        for (const { position, positionDetails } of flattenedPositions) {
            // Ensure decimals are numbers
            const decimals0 = Number(position.token0Decimals || 8);
            const decimals1 = Number(position.token1Decimals || 8);
            
            // Calculate liquidity value
            if (positionDetails.amount0 !== undefined && positionDetails.amount1 !== undefined) {
                const amount0 = Number(positionDetails.amount0) / Math.pow(10, decimals0);
                const amount1 = Number(positionDetails.amount1) / Math.pow(10, decimals1);
                
                if (position.token0_conversion_rate) {
                    total += amount0 * Number(position.token0_conversion_rate);
                    hasAnyValue = true;
                }
                if (position.token1_conversion_rate) {
                    total += amount1 * Number(position.token1_conversion_rate);
                    hasAnyValue = true;
                }
            }
            
            // Add unclaimed fees
            if (positionDetails.tokensOwed0 !== undefined && positionDetails.tokensOwed1 !== undefined) {
                const fees0 = Number(positionDetails.tokensOwed0) / Math.pow(10, decimals0);
                const fees1 = Number(positionDetails.tokensOwed1) / Math.pow(10, decimals1);
                
                if (position.token0_conversion_rate) {
                    total += fees0 * Number(position.token0_conversion_rate);
                }
                if (position.token1_conversion_rate) {
                    total += fees1 * Number(position.token1_conversion_rate);
                }
            }
        }
        
        return hasAnyValue ? total : null;
    }, [flattenedPositions]);

    // Calculate total tokens USD value
    const totalTokensUSD = useMemo(() => {
        let total = 0;
        let hasAnyValue = false;
        
        for (const token of tokensWithBalance) {
            const available = BigInt(token.available || token.balance || 0n);
            const locked = BigInt(token.locked || 0n);
            const staked = BigInt(token.staked || 0n);
            const maturity = BigInt(token.maturity || 0n);
            const rewards = BigInt(token.rewards || 0n);
            const neuronStake = BigInt(token.neuronStake || 0n);
            const neuronMaturity = BigInt(token.neuronMaturity || 0n);
            const totalBalance = available + locked + staked + maturity + rewards + neuronStake + neuronMaturity;
            
            const balanceNum = Number(totalBalance) / Math.pow(10, Number(token.decimals || 8));
            const usdValue = token.conversion_rate ? balanceNum * Number(token.conversion_rate) : null;
            
            if (usdValue !== null) {
                total += usdValue;
                hasAnyValue = true;
            }
        }
        
        return hasAnyValue ? total : null;
    }, [tokensWithBalance]);
    
    // Calculate managers USD value (ICP neurons total * ICP price from context)
    const totalManagersUSD = useMemo(() => {
        if (!managerNeuronsTotal || !icpPrice) return null;
        return managerNeuronsTotal * icpPrice;
    }, [managerNeuronsTotal, icpPrice]);
    
    // Calculate grand total (tokens + positions + managers)
    const grandTotalUSD = useMemo(() => {
        const tokens = totalTokensUSD || 0;
        const positions = totalPositionsUSD || 0;
        const managers = totalManagersUSD || 0;
        const total = tokens + positions + managers;
        return total > 0 ? total : null;
    }, [totalTokensUSD, totalPositionsUSD, totalManagersUSD]);

    // Generate debug report for quick wallet totals
    const generateQuickWalletDebugReport = useCallback(() => {
        const timestamp = new Date().toISOString();
        const lines = [];
        
        lines.push('='.repeat(60));
        lines.push('QUICK WALLET DEBUG REPORT');
        lines.push(`Generated: ${timestamp}`);
        lines.push('='.repeat(60));
        lines.push('');
        
        // Summary - calculated values
        lines.push('--- SUMMARY (Calculated) ---');
        lines.push(`Tokens Total (calculated): $${(totalTokensUSD || 0).toFixed(2)}`);
        lines.push(`Positions Total (calculated): $${(totalPositionsUSD || 0).toFixed(2)}`);
        lines.push(`Managers Total (calculated): $${(totalManagersUSD || 0).toFixed(2)}`);
        lines.push(`Grand Total (calculated): $${(grandTotalUSD || 0).toFixed(2)}`);
        lines.push('');
        
        // Token details
        lines.push('--- TOKEN DETAILS ---');
        lines.push(`Tokens count: ${walletTokens.length}`);
        lines.push(`Tokens with balance: ${tokensWithBalance.length}`);
        lines.push('');
        
        for (const token of tokensWithBalance) {
            const ledgerId = token.ledger_canister_id?.toString?.() || token.ledger_canister_id?.toText?.() || token.ledger_canister_id || token.principal;
            const decimals = Number(token.decimals || 8);
            const divisor = Math.pow(10, decimals);
            const rate = Number(token.conversion_rate || 0);
            
            const available = Number(token.available || token.balance || 0n);
            const locked = Number(token.locked || 0n);
            const neuronStake = Number(token.neuronStake || 0n);
            const neuronMaturity = Number(token.neuronMaturity || 0n);
            
            const availableUSD = (available / divisor) * rate;
            const lockedUSD = (locked / divisor) * rate;
            const neuronStakeUSD = (neuronStake / divisor) * rate;
            const neuronMaturityUSD = (neuronMaturity / divisor) * rate;
            const tokenTotal = availableUSD + lockedUSD + neuronStakeUSD + neuronMaturityUSD;
            
            lines.push(`${token.symbol} (${ledgerId})`);
            lines.push(`  Decimals: ${decimals}, Rate: ${rate}`);
            lines.push(`  Available: ${(available / divisor).toFixed(8)} = $${availableUSD.toFixed(2)}`);
            lines.push(`  Locked: ${(locked / divisor).toFixed(8)} = $${lockedUSD.toFixed(2)}`);
            if (neuronStake > 0) lines.push(`  NeuronStake: ${(neuronStake / divisor).toFixed(8)} = $${neuronStakeUSD.toFixed(2)}`);
            if (neuronMaturity > 0) lines.push(`  NeuronMaturity: ${(neuronMaturity / divisor).toFixed(8)} = $${neuronMaturityUSD.toFixed(2)}`);
            lines.push(`  Token Total: $${tokenTotal.toFixed(2)}`);
            lines.push(`  Has neuronsLoaded: ${token.neuronsLoaded || false}`);
            lines.push('');
        }
        
        // LP Positions details
        lines.push('--- LP POSITION DETAILS ---');
        lines.push(`Positions count: ${flattenedPositions.length}`);
        lines.push('');
        
        for (const { position, positionDetails } of flattenedPositions) {
            const decimals0 = Number(position.token0Decimals || 8);
            const decimals1 = Number(position.token1Decimals || 8);
            const amount0 = positionDetails.amount0 !== undefined 
                ? Number(positionDetails.amount0) / Math.pow(10, decimals0) 
                : 0;
            const amount1 = positionDetails.amount1 !== undefined 
                ? Number(positionDetails.amount1) / Math.pow(10, decimals1) 
                : 0;
            const fees0 = positionDetails.tokensOwed0 !== undefined 
                ? Number(positionDetails.tokensOwed0) / Math.pow(10, decimals0) 
                : 0;
            const fees1 = positionDetails.tokensOwed1 !== undefined 
                ? Number(positionDetails.tokensOwed1) / Math.pow(10, decimals1) 
                : 0;
            
            const liq0USD = position.token0_conversion_rate ? amount0 * Number(position.token0_conversion_rate) : 0;
            const liq1USD = position.token1_conversion_rate ? amount1 * Number(position.token1_conversion_rate) : 0;
            const fee0USD = position.token0_conversion_rate ? fees0 * Number(position.token0_conversion_rate) : 0;
            const fee1USD = position.token1_conversion_rate ? fees1 * Number(position.token1_conversion_rate) : 0;
            
            lines.push(`${position.token0Symbol}/${position.token1Symbol} #${positionDetails.positionId}`);
            lines.push(`  Swap: ${position.swapCanisterId}`);
            lines.push(`  Token0 Rate: ${position.token0_conversion_rate}, Token1 Rate: ${position.token1_conversion_rate}`);
            lines.push(`  Token0 Liquidity: ${amount0.toFixed(8)} = $${liq0USD.toFixed(2)}, Fees: ${fees0.toFixed(8)} = $${fee0USD.toFixed(2)}`);
            lines.push(`  Token1 Liquidity: ${amount1.toFixed(8)} = $${liq1USD.toFixed(2)}, Fees: ${fees1.toFixed(8)} = $${fee1USD.toFixed(2)}`);
            lines.push(`  Position Total: $${(liq0USD + liq1USD + fee0USD + fee1USD).toFixed(2)}`);
            lines.push('');
        }
        
        // Neuron Managers details
        lines.push('--- NEURON MANAGERS DETAILS ---');
        lines.push(`Managers count: ${neuronManagers.length}`);
        lines.push(`ICP Price: $${icpPrice}`);
        lines.push(`Total Manager ICP: ${managerNeuronsTotal.toFixed(8)}`);
        lines.push(`Total Manager USD: $${(totalManagersUSD || 0).toFixed(2)}`);
        lines.push('');
        
        for (const manager of neuronManagers) {
            const canisterIdStr = manager.canisterId?.toString?.() || manager.canisterId?.toText?.() || manager.canisterId;
            const neuronsData = managerNeurons[canisterIdStr];
            const neurons = neuronsData?.neurons || [];
            
            let managerIcpTotal = 0;
            neurons.forEach(neuron => {
                if (neuron.info) {
                    managerIcpTotal += Number(neuron.info.stake_e8s || 0) / 1e8;
                }
                if (neuron.full) {
                    managerIcpTotal += Number(neuron.full.maturity_e8s_equivalent || 0) / 1e8;
                    if (neuron.full.staked_maturity_e8s_equivalent?.[0]) {
                        managerIcpTotal += Number(neuron.full.staked_maturity_e8s_equivalent[0]) / 1e8;
                    }
                }
            });
            
            const managerUsdValue = icpPrice ? managerIcpTotal * icpPrice : 0;
            
            lines.push(`Manager: ${canisterIdStr}`);
            lines.push(`  Neurons: ${neurons.length}`);
            lines.push(`  ICP Total: ${managerIcpTotal.toFixed(8)}`);
            lines.push(`  USD Value: $${managerUsdValue.toFixed(2)}`);
            lines.push('');
        }
        
        lines.push('='.repeat(60));
        lines.push('END REPORT');
        lines.push('='.repeat(60));
        
        return lines.join('\n');
    }, [walletTokens, tokensWithBalance, flattenedPositions, neuronManagers, managerNeurons, managerNeuronsTotal, icpPrice, totalTokensUSD, totalPositionsUSD, totalManagersUSD, grandTotalUSD]);
    
    // Open send modal for a token
    const openSendModal = (token, e) => {
        if (e) e.stopPropagation();
        setSelectedToken(token);
        setShowSendModal(true);
    };
    
    // Handle send token
    const handleSendToken = async (token, recipient, amount, subaccount = [], accountId = undefined) => {
        if (sendToken) {
            await sendToken(token, recipient, amount, subaccount, accountId);
        }
    };
    
    // Handle send from token detail modal
    const handleOpenSendFromDetail = (token) => {
        setShowTokenDetailModal(false);
        setSelectedToken(token);
        setShowSendModal(true);
    };
    
    // Handle lock from token detail modal - open lock modal
    const handleOpenLockFromDetail = (token) => {
        setShowTokenDetailModal(false);
        // Normalize token for LockModal - ensure all required fields exist
        const normalizedToken = {
            ...token,
            // Ensure BigInt fields have proper defaults
            balance: BigInt(token.balance || token.available || 0n),
            available: BigInt(token.available || token.balance || 0n),
            available_backend: BigInt(token.available_backend || 0n),
            locked: BigInt(token.locked || 0n),
            fee: BigInt(token.fee || 10000n),
            decimals: token.decimals ?? 8,
            // Ensure ledger_canister_id is preserved properly
            ledger_canister_id: token.ledger_canister_id || 
                (token.principal ? Principal.fromText(token.principal) : null),
        };
        setLockToken(normalizedToken);
        setShowLockModal(true);
    };
    
    // Handle when a lock is added - performs the actual locking operation
    const handleAddLock = useCallback(async (token, amount, expiry, onProgress) => {
        try {
            // Get the ledger principal - token should be normalized by handleOpenLockFromDetail
            let ledgerPrincipal = token.ledger_canister_id;
            
            // If it's a string (shouldn't be after normalization, but just in case)
            if (typeof ledgerPrincipal === 'string') {
                ledgerPrincipal = Principal.fromText(ledgerPrincipal);
            } else if (!ledgerPrincipal && token.principal) {
                ledgerPrincipal = Principal.fromText(token.principal);
            }
            
            if (!ledgerPrincipal) {
                throw new Error('Token ledger canister ID not found');
            }
            
            const ledgerActor = createLedgerActor(ledgerPrincipal, { agentOptions: { identity } });
            const decimals = await ledgerActor.icrc1_decimals();
            
            // Convert to BigInt safely - handle decimal inputs
            const amountFloat = parseFloat(amount);
            const scaledAmount = amountFloat * (10 ** decimals);
            const bigIntAmount = BigInt(Math.floor(scaledAmount));
            
            // Get backend balance - use 0n if not available (compact wallet may not have this)
            let available_balance_backend = 0n;
            try {
                if (token.balance_backend !== undefined) {
                    available_balance_backend = get_available_backend(token);
                } else {
                    available_balance_backend = BigInt(token.available_backend || 0n);
                }
            } catch (e) {
                // Token may not have balance_backend, treat as 0
                available_balance_backend = 0n;
            }
            
            const bigIntAmountSendToBackend = bigIntAmount - available_balance_backend;

            if (bigIntAmountSendToBackend > 0n) {
                // Report progress: depositing
                if (onProgress) onProgress('depositing');
                
                const principal_subaccount = principalToSubAccount(identity.getPrincipal());
                const recipientPrincipal = Principal.fromText(sneedLockCanisterId);
                await ledgerActor.icrc1_transfer({
                    to: { owner: recipientPrincipal, subaccount: [principal_subaccount] },
                    fee: [],
                    memo: [],
                    from_subaccount: [],
                    created_at_time: [],
                    amount: bigIntAmountSendToBackend
                });
            }

            // Report progress: locking
            if (onProgress) onProgress('locking');

            const sneedLockActor = createSneedLockActor(sneedLockCanisterId, {
                agentOptions: { identity }
            });

            const result = await sneedLockActor.create_lock(
                bigIntAmount,
                ledgerPrincipal,
                BigInt(expiry) * (10n ** 6n)
            );

            console.log('create_lock result:', result);

            // Refresh wallet data after successful lock
            if (walletContext?.refreshWallet) {
                walletContext.refreshWallet();
            }

            // Ensure we return a valid result object
            // LockModal expects either { Ok: ... } or { Err: ... }
            if (result === undefined || result === null) {
                // If result is undefined, assume success (lock was created)
                return { Ok: true };
            }

            return result;
        } catch (error) {
            console.error('Error in handleAddLock:', error);
            throw error;
        }
    }, [identity, walletContext]);

    // Fetch locks for a specific token
    const fetchLocksForToken = useCallback(async (token) => {
        if (!identity || !token) return;
        
        const ledgerId = token.principal || token.ledger_canister_id?.toString?.();
        if (!ledgerId) return;
        
        setLockDetailsLoading(prev => ({ ...prev, [ledgerId]: true }));
        
        try {
            const sneedLockActor = createSneedLockActor(sneedLockCanisterId, { agentOptions: { identity } });
            
            // Clear expired locks first
            if (await sneedLockActor.has_expired_locks()) {
                await sneedLockActor.clear_expired_locks();
            }
            
            const locks_from_backend = await sneedLockActor.get_token_locks();
            
            const tokenLocksList = [];
            for (const lock of locks_from_backend) {
                const lockLedgerId = lock[1]?.toText?.() || lock[1]?.toString?.();
                if (lockLedgerId === ledgerId) {
                    const readableDateFromHugeInt = new Date(Number(lock[3] / (10n ** 6n)));
                    tokenLocksList.push({
                        lock_id: lock[0],
                        amount: lock[2],
                        expiry: readableDateFromHugeInt
                    });
                }
            }
            
            setTokenLocks(tokenLocksList);
        } catch (error) {
            console.error('Error fetching locks:', error);
            setTokenLocks([]);
        } finally {
            setLockDetailsLoading(prev => ({ ...prev, [ledgerId]: false }));
        }
    }, [identity]);

    // Open token detail modal
    const openTokenDetailModal = useCallback((token) => {
        setDetailToken(token);
        setTokenLocks([]); // Reset locks
        setShowTokenDetailModal(true);
        setShowPopup(false); // Close the popup when opening the modal
        // Fetch locks for this token
        fetchLocksForToken(token);
    }, [fetchLocksForToken]);

    // Open position detail modal
    const openPositionDetailModal = useCallback((position, positionDetails) => {
        setDetailPosition(position);
        setDetailPositionDetails(positionDetails);
        setShowPositionDetailModal(true);
        setShowPopup(false); // Close the popup when opening the modal
    }, []);

    // Open dapp detail modal
    const openDappDetailModal = useCallback((dappInfo) => {
        setDetailDapp(dappInfo);
        setShowDappDetailModal(true);
        setShowPopup(false); // Close the popup when opening the modal
    }, []);

    // Handle refresh dapp in detail modal
    const handleRefreshDapp = useCallback(async (canisterId) => {
        if (!identity || !canisterId) {
            console.warn('[QuickWallet] handleRefreshDapp: missing identity or canisterId', { identity: !!identity, canisterId });
            return;
        }
        
        setIsRefreshingDapp(true);
        try {
            const host = process.env.DFX_NETWORK === 'ic' || process.env.DFX_NETWORK === 'staging' 
                ? 'https://ic0.app' 
                : 'http://localhost:4943';
            const agent = new HttpAgent({ identity, host });
            if (process.env.DFX_NETWORK !== 'ic' && process.env.DFX_NETWORK !== 'staging') {
                await agent.fetchRootKey();
            }
            
            let cycles = null;
            let memory = null;
            let isController = null; // null means "unknown/unchanged"
            let moduleHash = null;
            
            try {
                const canisterIdPrincipal = Principal.fromText(canisterId);
                const mgmtActor = Actor.createActor(managementCanisterIdlFactory, {
                    agent,
                    canisterId: MANAGEMENT_CANISTER_ID,
                    callTransform: (methodName, args, callConfig) => ({
                        ...callConfig,
                        effectiveCanisterId: canisterIdPrincipal,
                    }),
                });
                const status = await mgmtActor.canister_status({ canister_id: canisterIdPrincipal });
                cycles = Number(status.cycles);
                memory = Number(status.memory_size);
                moduleHash = status.module_hash[0] ? uint8ArrayToHex(status.module_hash[0]) : null;
                isController = true; // Success means we are a controller
            } catch (err) {
                // canister_status failed - could be network error or not a controller
                // Don't assume not a controller - preserve previous value
                console.log('[QuickWallet] canister_status failed:', canisterId, err.message || err);
                // Try backend fallback for module_hash
                try {
                    const result = await getCanisterInfo(identity, canisterId);
                    if (result && 'ok' in result) {
                        moduleHash = result.ok.module_hash[0] ? uint8ArrayToHex(result.ok.module_hash[0]) : null;
                    }
                } catch (fallbackErr) {
                    // Ignore
                }
            }
            
            // Update local status - preserve previous isController if we couldn't determine it
            setTrackedCanisterStatus(prev => ({
                ...prev,
                [canisterId]: { 
                    cycles: cycles ?? prev?.[canisterId]?.cycles, 
                    memory: memory ?? prev?.[canisterId]?.memory, 
                    isController: isController ?? prev?.[canisterId]?.isController, 
                    moduleHash: moduleHash ?? prev?.[canisterId]?.moduleHash 
                }
            }));
            
            // Update modal with new data - preserve previous values if new ones are null
            setDetailDapp(prev => {
                if (!prev) return null;
                return {
                    ...prev,
                    cycles: cycles ?? prev.cycles,
                    memory: memory ?? prev.memory,
                    isController: isController ?? prev.isController,
                };
            });
            
        } catch (err) {
            console.error('[QuickWallet] handleRefreshDapp error:', err);
        } finally {
            setIsRefreshingDapp(false);
        }
    }, [identity]);

    // Handle chore actions from DappCardModal
    const handleChoreAction = useCallback(async (canisterId, choreId, action) => {
        if (!identity) return;
        try {
            const host = process.env.DFX_NETWORK === 'ic' || process.env.DFX_NETWORK === 'staging'
                ? 'https://ic0.app'
                : 'http://localhost:4943';
            const agent = new HttpAgent({ identity, host });
            if (process.env.DFX_NETWORK !== 'ic' && process.env.DFX_NETWORK !== 'staging') {
                await agent.fetchRootKey();
            }
            const manager = createManagerActor(canisterId, { agent });

            switch (action) {
                case 'start': await manager.startChore(choreId); break;
                case 'stop': await manager.stopChore(choreId); break;
                case 'pause': await manager.pauseChore(choreId); break;
                case 'resume': await manager.resumeChore(choreId); break;
                case 'trigger': await manager.triggerChore(choreId); break;
                default: break;
            }

            // Refresh chore statuses via WalletContext
            if (fetchManagerNeuronsData) {
                await fetchManagerNeuronsData(canisterId);
            }
        } catch (err) {
            console.error(`[QuickWallet] Chore action ${action} failed for ${choreId}:`, err);
        }
    }, [identity, fetchManagerNeuronsData]);

    // Handle send canister (opens transfer modal)
    const handleSendCanister = useCallback((canisterId, isNeuronManager = false) => {
        // Close dapp detail modal first
        setShowDappDetailModal(false);
        setDetailDapp(null);
        // Open transfer canister modal
        setTransferCanisterId(canisterId);
        setTransferIsNeuronManager(isNeuronManager);
        setShowTransferCanisterModal(true);
    }, []);

    // Handle transfer complete
    const handleTransferCanisterComplete = useCallback((canisterId, recipientPrincipal) => {
        // Refresh wallet data after transfer
        if (walletContext?.refreshWallet) {
            walletContext.refreshWallet();
        }
    }, [walletContext]);

    // Handle open send liquidity position modal from detail modal
    const handleOpenSendLiquidityPositionFromDetail = useCallback((position) => {
        // Close the detail modal first
        setShowPositionDetailModal(false);
        setDetailPosition(null);
        setDetailPositionDetails(null);
        // Open the send modal
        setSelectedLiquidityPosition(position);
        setShowSendLiquidityPositionModal(true);
    }, []);

    // Handle sending liquidity position
    const handleSendLiquidityPosition = useCallback(async (positionId, recipientPrincipal) => {
        if (!walletContext?.sendLiquidityPosition) {
            console.error('sendLiquidityPosition function not available');
            return;
        }
        
        try {
            await walletContext.sendLiquidityPosition(positionId, recipientPrincipal);
            setShowSendLiquidityPositionModal(false);
            setSelectedLiquidityPosition(null);
            // Refresh wallet data
            if (walletContext?.refreshWallet) {
                walletContext.refreshWallet();
            }
        } catch (error) {
            console.error('Error sending liquidity position:', error);
            throw error;
        }
    }, [walletContext]);

    // Handle refresh position in detail modal
    const handleRefreshPosition = useCallback(async () => {
        if (!walletContext?.refreshWallet) return;
        
        setIsRefreshingPosition(true);
        try {
            await walletContext.refreshWallet();
        } catch (error) {
            console.error('Error refreshing position:', error);
        } finally {
            setIsRefreshingPosition(false);
        }
    }, [walletContext]);

    // Fast batch balance refresh for quick wallet - fetches liquid balances first
    const refreshQuickWalletBalancesFirst = useCallback(async () => {
        if (!walletTokens || walletTokens.length === 0 || !identity) return;
        const setRefreshingTokensFn = walletContext?.setRefreshingTokens;
        const updateWalletTokensFn = walletContext?.updateWalletTokens;
        if (!setRefreshingTokensFn) return;

        // Mark all tokens as refreshing balance (strong pulse)
        const balanceMap = new Map();
        for (const t of walletTokens) {
            const lid = normalizeId(t.principal) || normalizeId(t.ledger_canister_id);
            if (lid) balanceMap.set(lid, 'balance');
        }
        setRefreshingTokensFn(balanceMap);

        try {
            // Fetch all liquid balances in parallel
            const results = await Promise.all(walletTokens.map(async (t) => {
                const lid = normalizeId(t.principal) || normalizeId(t.ledger_canister_id);
                if (!lid) return null;
                try {
                    const ledgerPrincipal = t.ledger_canister_id instanceof Principal
                        ? t.ledger_canister_id
                        : Principal.fromText(lid);
                    const ledgerActor = createLedgerActor(ledgerPrincipal, { agentOptions: { identity } });
                    const freshBalance = await ledgerActor.icrc1_balance_of({ owner: identity.getPrincipal(), subaccount: [] });
                    return { lid, freshBalance };
                } catch {
                    return null;
                }
            }));

            // Build updated tokens array
            const balanceByLedger = {};
            for (const r of results) {
                if (r) balanceByLedger[r.lid] = r.freshBalance;
            }
            if (updateWalletTokensFn) {
                const updatedTokens = walletTokens.map(t => {
                    const lid = normalizeId(t.principal) || normalizeId(t.ledger_canister_id);
                    if (lid && balanceByLedger[lid] !== undefined) {
                        const updated = { ...t, balance: balanceByLedger[lid] };
                        updated.available = get_available(updated);
                        return updated;
                    }
                    return t;
                });
                updateWalletTokensFn(updatedTokens);
            }

            // Switch all to phase 2 (subtle pulse)
            const fullMap = new Map();
            for (const t of walletTokens) {
                const lid = normalizeId(t.principal) || normalizeId(t.ledger_canister_id);
                if (lid) fullMap.set(lid, 'full');
            }
            setRefreshingTokensFn(fullMap);
        } catch (error) {
            console.error('Error in quick wallet fast balance refresh:', error);
        }
    }, [walletTokens, identity, walletContext]);

    // Handle refresh token in detail modal
    const handleRefreshToken = useCallback(async (token) => {
        if (!walletContext?.refreshWallet) return;
        const setRefreshingTokensFn = walletContext?.setRefreshingTokens;
        const lid = normalizeId(token.principal) || normalizeId(token.ledger_canister_id);
        
        setIsRefreshingToken(true);
        // Phase 1: fast balance fetch
        if (setRefreshingTokensFn && lid) {
            setRefreshingTokensFn(prev => new Map(prev).set(lid, 'balance'));
        }
        try {
            // Quick: fetch the liquid balance first
            if (lid && identity) {
                try {
                    const ledgerPrincipal = token.ledger_canister_id instanceof Principal
                        ? token.ledger_canister_id
                        : Principal.fromText(lid);
                    const ledgerActor = createLedgerActor(ledgerPrincipal, { agentOptions: { identity } });
                    const freshBalance = await ledgerActor.icrc1_balance_of({ owner: identity.getPrincipal(), subaccount: [] });
                    // Update token in context
                    if (walletContext?.updateWalletTokens) {
                        const updatedTokens = walletTokens.map(t => {
                            const tLid = normalizeId(t.principal) || normalizeId(t.ledger_canister_id);
                            if (tLid === lid) {
                                const updated = { ...t, balance: freshBalance };
                                updated.available = get_available(updated);
                                return updated;
                            }
                            return t;
                        });
                        walletContext.updateWalletTokens(updatedTokens);
                    }
                } catch {}
            }
            // Phase 2: switch to subtle pulse
            if (setRefreshingTokensFn && lid) {
                setRefreshingTokensFn(prev => new Map(prev).set(lid, 'full'));
            }
            // Full refresh and locks
            await Promise.all([
                walletContext.refreshWallet(),
                fetchLocksForToken(token)
            ]);
        } catch (error) {
            console.error('Error refreshing token:', error);
        } finally {
            setIsRefreshingToken(false);
            if (setRefreshingTokensFn && lid) {
                setRefreshingTokensFn(prev => {
                    const next = new Map(prev);
                    next.delete(lid);
                    return next;
                });
            }
        }
    }, [walletContext, walletTokens, identity, fetchLocksForToken]);

    // Keep detailToken in sync with walletTokens
    useEffect(() => {
        if (detailToken && walletTokens.length > 0) {
            const detailPrincipal = normalizeId(detailToken.principal) || normalizeId(detailToken.ledger_canister_id);
            const updatedToken = walletTokens.find(t => 
                normalizeId(t.principal) === detailPrincipal
            );
            if (updatedToken && updatedToken !== detailToken) {
                setDetailToken(updatedToken);
            }
        }
    }, [walletTokens, detailToken]);

    // Keep detailPosition and detailPositionDetails in sync with liquidityPositions
    useEffect(() => {
        if (detailPosition && detailPositionDetails && liquidityPositions.length > 0) {
            const swapId = detailPosition.swapCanisterId?.toString?.() || detailPosition.swapCanisterId;
            const posId = detailPositionDetails.positionId;
            
            for (const lp of liquidityPositions) {
                const lpSwapId = lp.swapCanisterId?.toString?.() || lp.swapCanisterId;
                if (lpSwapId === swapId && lp.positions) {
                    const updatedDetails = lp.positions.find(p => p.positionId === posId);
                    if (updatedDetails) {
                        if (lp !== detailPosition) {
                            setDetailPosition(lp);
                        }
                        if (updatedDetails !== detailPositionDetails) {
                            setDetailPositionDetails(updatedDetails);
                        }
                        break;
                    }
                }
            }
        }
    }, [liquidityPositions, detailPosition, detailPositionDetails]);

    // Add click outside handler
    useEffect(() => {
        const handleClickOutside = (event) => {
            if (popupRef.current && !popupRef.current.contains(event.target)) {
                setShowPopup(false);
            }
        };

        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    const truncateString = (
      fullStr,
      strLen = 28,
      separator = "...",
      frontChars = 6,
      backChars = 6) => {
      if (fullStr.length <= strLen) return fullStr;
  
      return fullStr.substr(0, frontChars) +
        separator +
        fullStr.substr(fullStr.length - backChars);
    }

    // Get user's display name
    const userDisplayName = identity ? getPrincipalDisplayName(identity.getPrincipal()) : null;
    const userName = userDisplayName?.name;
    
    // Compute account ID for the user's principal
    const accountId = useMemo(() => {
        if (!identity) return null;
        return computeAccountId(identity.getPrincipal());
    }, [identity]);
    
    // Track which value was copied (principal or accountId)
    const [copiedType, setCopiedType] = useState(null);

    const handleCopy = async (text, type = 'principal') => {
        try {
            await navigator.clipboard.writeText(text);
            setCopied(true);
            setCopiedType(type);
            setCopyFeedback(type === 'accountId' ? 'Account ID copied!' : 'Principal copied!');
            
            // Reset after 2 seconds
            setTimeout(() => {
                setCopied(false);
                setCopiedType(null);
                setCopyFeedback('');
            }, 2000);
        } catch (err) {
            // Fallback for older browsers
            const textArea = document.createElement('textarea');
            textArea.value = text;
            document.body.appendChild(textArea);
            textArea.select();
            try {
                document.execCommand('copy');
                setCopied(true);
                setCopiedType(type);
                setCopyFeedback(type === 'accountId' ? 'Account ID copied!' : 'Principal copied!');
                setTimeout(() => {
                    setCopied(false);
                    setCopiedType(null);
                    setCopyFeedback('');
                }, 2000);
            } catch (fallbackErr) {
                setCopyFeedback('Failed to copy');
                setTimeout(() => setCopyFeedback(''), 2000);
            }
            document.body.removeChild(textArea);
        }
    };

    // If not logged in, show login button
    if (principalText === "Not logged in.") {
        return (
            <button className="principal-button" onClick={login}>
                Login
            </button>
        );
    }

    return (
      <>
      <div className="principal-box-container" ref={popupRef} style={{ position: 'relative' }}>
          <button 
              className={compact ? "principal-button-compact" : "principal-button"} 
              onClick={() => setShowPopup(!showPopup)}
              title={compact ? `Logged in as: ${truncateString(principalText, 15, "...", 3, 3)}` : undefined}
              style={compact ? {
                  background: 'none',
                  border: 'none',
                  color: theme.colors.primaryText,
                  cursor: 'pointer',
                  padding: '8px',
                  borderRadius: '4px',
                  display: 'flex',
                  alignItems: 'center',
                  fontSize: '18px'
              } : undefined}
          >
              {compact ? <FaWallet size={18} /> : truncateString(principalText, 15, "...", 3, 3)}
          </button>
          {showPopup && (
              <div 
                  className="principal-popup"
                  onMouseDown={(e) => e.stopPropagation()}
                  style={{
                      position: 'absolute',
                      top: '100%',
                      right: '0',
                      backgroundColor: theme.colors.secondaryBg,
                      border: `1px solid ${theme.colors.border}`,
                      borderRadius: '16px',
                      padding: '0',
                      zIndex: 1000,
                      minWidth: '300px',
                      maxWidth: '340px',
                      width: 'calc(100vw - 32px)',
                      boxShadow: '0 12px 40px rgba(0, 0, 0, 0.4)',
                      overflow: 'hidden'
                  }}
              >
                  {/* Header Banner with Gradient */}
                  <div style={{
                      background: 'linear-gradient(135deg, #10b981 0%, #059669 50%, #047857 100%)',
                      padding: '16px 20px',
                      position: 'relative',
                      overflow: 'hidden'
                  }}>
                      {/* Decorative pattern */}
                      <div style={{
                          position: 'absolute',
                          inset: 0,
                          opacity: 0.1,
                          backgroundImage: 'radial-gradient(circle at 20% 50%, white 1px, transparent 1px), radial-gradient(circle at 80% 50%, white 1px, transparent 1px)',
                          backgroundSize: '30px 30px',
                          pointerEvents: 'none'
                      }} />
                      
                      {/* User Info */}
                      <div style={{ position: 'relative', zIndex: 1 }}>
                          {userName ? (
                              <button
                                  onClick={() => {
                                      navigate('/me');
                                      setShowPopup(false);
                                  }}
                                  style={{
                                      background: 'none',
                                      border: 'none',
                                      padding: 0,
                                      color: 'white',
                                      fontSize: '1.1rem',
                                      fontWeight: '600',
                                      cursor: 'pointer',
                                      display: 'flex',
                                      alignItems: 'center',
                                      gap: '8px',
                                      textShadow: '0 2px 8px rgba(0,0,0,0.2)'
                                  }}
                              >
                                  {userName}
                                  <FaExternalLinkAlt size={10} style={{ opacity: 0.7 }} />
                              </button>
                          ) : (
                              <button
                                  onClick={() => {
                                      navigate('/me');
                                      setShowPopup(false);
                                  }}
                                  style={{
                                      background: 'rgba(255,255,255,0.2)',
                                      border: 'none',
                                      padding: '6px 12px',
                                      borderRadius: '6px',
                                      color: 'white',
                                      fontSize: '0.85rem',
                                      fontWeight: '500',
                                      cursor: 'pointer',
                                      display: 'flex',
                                      alignItems: 'center',
                                      gap: '6px'
                                  }}
                              >
                                  Set up profile
                                  <FaExternalLinkAlt size={9} />
                              </button>
                          )}
                      </div>
                  </div>

                  {/* Identity Cards Section */}
                  <div style={{ padding: '12px 16px' }}>
                      {/* Principal / Account ID Card (toggleable) */}
                      <div 
                          onClick={() => handleCopy(
                              showAccountId && accountId ? accountId : principalText,
                              showAccountId && accountId ? 'accountId' : 'principal'
                          )}
                          style={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: '12px',
                              padding: '12px',
                              background: theme.colors.primaryBg,
                              borderRadius: '10px',
                              cursor: 'pointer',
                              marginBottom: '8px',
                              transition: 'all 0.2s ease',
                              border: `1px solid ${copied ? '#10b981' : 'transparent'}`
                          }}
                          onMouseOver={(e) => {
                              if (!copied) {
                                  e.currentTarget.style.borderColor = theme.colors.border;
                              }
                          }}
                          onMouseOut={(e) => {
                              if (!copied) {
                                  e.currentTarget.style.borderColor = 'transparent';
                              }
                          }}
                      >
                          <div style={{
                              width: '36px',
                              height: '36px',
                              borderRadius: '8px',
                              background: showAccountId && accountId
                                  ? 'linear-gradient(135deg, #3b82f630, #1d4ed820)'
                                  : 'linear-gradient(135deg, #10b98130, #05966920)',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              flexShrink: 0,
                              transition: 'background 0.2s ease'
                          }}>
                              {showAccountId && accountId 
                                  ? <FaIdCard size={14} color="#3b82f6" />
                                  : <FaKey size={14} color="#10b981" />
                              }
                          </div>
                          <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ 
                                  color: theme.colors.mutedText, 
                                  fontSize: '10px', 
                                  textTransform: 'uppercase',
                                  letterSpacing: '0.5px',
                                  marginBottom: '2px',
                                  display: 'flex',
                                  alignItems: 'center',
                                  gap: '6px'
                              }}>
                                  {showAccountId && accountId ? (
                                      <>
                                          Account ID
                                          <span style={{
                                              background: '#3b82f620',
                                              color: '#3b82f6',
                                              fontSize: '8px',
                                              padding: '2px 5px',
                                              borderRadius: '4px',
                                              fontWeight: '600',
                                              textTransform: 'none'
                                          }}>
                                              CEX
                                          </span>
                                      </>
                                  ) : 'Principal ID'}
                              </div>
                              <div style={{
                                  color: theme.colors.primaryText,
                                  fontSize: showAccountId && accountId ? '11px' : '12px',
                                  fontFamily: 'monospace',
                                  fontWeight: '500'
                              }}>
                                  {showAccountId && accountId
                                      ? truncateString(accountId, 22, "...", 8, 8)
                                      : truncateString(principalText, 22, "...", 8, 8)
                                  }
                              </div>
                          </div>
                          <div style={{
                              color: copied ? '#10b981' : theme.colors.mutedText,
                              transition: 'color 0.2s ease'
                          }}>
                              {copied ? <FaCheck size={14} /> : <FaCopy size={14} />}
                          </div>
                      </div>

                      {/* Toggle link between principal / account ID */}
                      {accountId && (
                          <button
                              onClick={(e) => {
                                  e.stopPropagation();
                                  setShowAccountId(!showAccountId);
                              }}
                              style={{
                                  background: 'none',
                                  border: 'none',
                                  color: theme.colors.mutedText,
                                  fontSize: '10px',
                                  cursor: 'pointer',
                                  padding: '0 0 6px 0',
                                  display: 'flex',
                                  alignItems: 'center',
                                  gap: '4px',
                                  transition: 'color 0.2s ease'
                              }}
                              onMouseOver={(e) => e.currentTarget.style.color = theme.colors.accent}
                              onMouseOut={(e) => e.currentTarget.style.color = theme.colors.mutedText}
                          >
                              <FaExchangeAlt size={8} />
                              {showAccountId ? 'Show principal' : 'Show account ID'}
                          </button>
                      )}
                      
                      {/* Copy feedback toast */}
                      {copyFeedback && (
                          <div style={{
                              background: '#10b981',
                              color: 'white',
                              fontSize: '12px',
                              fontWeight: '500',
                              padding: '8px 12px',
                              borderRadius: '6px',
                              textAlign: 'center',
                              marginBottom: '12px',
                              animation: 'fadeIn 0.2s ease'
                          }}>
                              {copyFeedback}
                          </div>
                      )}
                  </div>
                  
                  {/* Divider */}
                  <div style={{ 
                      height: '1px', 
                      background: theme.colors.border,
                      margin: '0 16px'
                  }} />
                  
                  {/* Wallet Section - now in the padding area */}
                  <div style={{ padding: '12px 16px' }}>
                      
                      {/* Grand Total */}
                      {grandTotalUSD !== null && (
                          <div style={{
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'space-between',
                              marginBottom: '12px',
                              padding: '10px 12px',
                              background: `linear-gradient(135deg, ${theme.colors.accent}15, ${theme.colors.accent}05)`,
                              borderRadius: '8px',
                              border: `1px solid ${theme.colors.accent}30`
                          }}>
                              <span style={{
                                  color: theme.colors.mutedText,
                                  fontSize: '11px',
                                  fontWeight: '500'
                              }}>
                                  <FaWallet size={10} style={{ marginRight: '6px' }} />
                                  Total Balance
                              </span>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                  <span style={{
                                      color: '#10b981',
                                      fontSize: '16px',
                                      fontWeight: '700'
                                  }}>
                                      ${grandTotalUSD.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                  </span>
                                  {/* Admin debug report button */}
                                  {isAdmin && (
                                      <button
                                          onClick={(e) => {
                                              e.stopPropagation();
                                              setShowDebugReportModal(true);
                                          }}
                                          style={{
                                              background: 'transparent',
                                              border: `1px solid ${theme.colors.border}`,
                                              borderRadius: '4px',
                                              padding: '3px 5px',
                                              cursor: 'pointer',
                                              color: theme.colors.mutedText,
                                              display: 'flex',
                                              alignItems: 'center'
                                          }}
                                          title="Debug Report"
                                      >
                                          <FaBug size={9} />
                                      </button>
                                  )}
                              </div>
                          </div>
                      )}

                  {/* Wallet Tabs */}
                      <div style={{ 
                          display: 'flex', 
                          gap: '4px', 
                          marginBottom: '8px'
                      }}>
                          <button
                              onClick={() => setWalletTab('tokens')}
                              style={{
                                  display: 'flex',
                                  alignItems: 'center',
                                  gap: '4px',
                                  padding: '5px 10px',
                                  background: walletTab === 'tokens' ? `${theme.colors.accent}20` : 'transparent',
                                  border: `1px solid ${walletTab === 'tokens' ? theme.colors.accent : theme.colors.border}`,
                                  borderRadius: '6px',
                                  cursor: 'pointer',
                                  color: walletTab === 'tokens' ? theme.colors.accent : theme.colors.mutedText,
                                  fontSize: '11px',
                                  fontWeight: walletTab === 'tokens' ? '600' : '500',
                                  transition: 'all 0.2s ease'
                              }}
                          >
                              <FaCoins size={10} />
                              Tokens
                          </button>
                          <button
                              onClick={() => setWalletTab('positions')}
                              style={{
                                  display: 'flex',
                                  alignItems: 'center',
                                  gap: '4px',
                                  padding: '5px 10px',
                                  background: walletTab === 'positions' ? `${theme.colors.accent}20` : 'transparent',
                                  border: `1px solid ${walletTab === 'positions' ? theme.colors.accent : theme.colors.border}`,
                                  borderRadius: '6px',
                                  cursor: 'pointer',
                                  color: walletTab === 'positions' ? theme.colors.accent : theme.colors.mutedText,
                                  fontSize: '11px',
                                  fontWeight: walletTab === 'positions' ? '600' : '500',
                                  transition: 'all 0.2s ease'
                              }}
                          >
                              <FaWater size={10} />
                              Liquidity
                          </button>
                          <button
                              onClick={() => setWalletTab('dapps')}
                              style={{
                                  display: 'flex',
                                  alignItems: 'center',
                                  gap: '4px',
                                  padding: '5px 10px',
                                  background: walletTab === 'dapps' ? `${theme.colors.accent}20` : 'transparent',
                                  border: `1px solid ${walletTab === 'dapps' ? theme.colors.accent : theme.colors.border}`,
                                  borderRadius: '6px',
                                  cursor: 'pointer',
                                  color: walletTab === 'dapps' ? theme.colors.accent : theme.colors.mutedText,
                                  fontSize: '11px',
                                  fontWeight: walletTab === 'dapps' ? '600' : '500',
                                  transition: 'all 0.2s ease'
                              }}
                          >
                              <FaBox size={10} />
                              Apps
                          </button>
                      </div>

                      {/* Tokens Tab Header */}
                      {walletTab === 'tokens' && (
                      <div 
                          style={{ 
                              color: theme.colors.mutedText, 
                              fontSize: '10px', 
                              textTransform: 'uppercase',
                              letterSpacing: '0.5px',
                              marginBottom: '8px',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'space-between'
                          }}
                      >
                          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                              <FaWallet size={10} />
                              Wallet
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                              <label 
                                  style={{ 
                                      display: 'flex', 
                                      alignItems: 'center', 
                                      gap: '4px',
                                      cursor: 'pointer',
                                      fontSize: '9px',
                                      textTransform: 'none',
                                      letterSpacing: 'normal',
                                      color: hideDust ? theme.colors.accent : theme.colors.mutedText
                                  }}
                                  title="Hide tokens worth less than $0.01"
                              >
                                  <input
                                      type="checkbox"
                                      checked={hideDust}
                                      onChange={(e) => setHideDust(e.target.checked)}
                                      style={{ 
                                          width: '12px', 
                                          height: '12px',
                                          cursor: 'pointer',
                                          accentColor: theme.colors.accent
                                      }}
                                  />
                                  Hide dust
                              </label>
                              {totalTokensUSD !== null && (
                                  <span style={{ 
                                      color: '#10b981',
                                      fontSize: '12px',
                                      fontWeight: '600',
                                      textTransform: 'none',
                                      letterSpacing: 'normal'
                                  }}>
                                      ${totalTokensUSD.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                  </span>
                              )}
                              {refreshWallet && (
                                  <button
                                      onClick={async (e) => {
                                          e.stopPropagation();
                                          setIsRefreshingWallet(true);
                                          try {
                                              // Phase 1: Fast balance refresh for all existing tokens
                                              await refreshQuickWalletBalancesFirst();
                                              // Phase 2: Full refresh
                                              await refreshWallet();
                                          } finally {
                                              setIsRefreshingWallet(false);
                                              if (walletContext?.setRefreshingTokens) walletContext.setRefreshingTokens(new Map());
                                          }
                                      }}
                                      disabled={isRefreshingWallet || walletLoading}
                                      style={{
                                          background: 'none',
                                          border: 'none',
                                          cursor: (isRefreshingWallet || walletLoading) ? 'default' : 'pointer',
                                          padding: '2px',
                                          display: 'flex',
                                          alignItems: 'center',
                                          color: theme.colors.mutedText,
                                          opacity: (isRefreshingWallet || walletLoading) ? 0.5 : 1,
                                          transition: 'color 0.2s ease'
                                      }}
                                      onMouseEnter={(e) => !(isRefreshingWallet || walletLoading) && (e.currentTarget.style.color = theme.colors.primaryText)}
                                      onMouseLeave={(e) => !(isRefreshingWallet || walletLoading) && (e.currentTarget.style.color = theme.colors.mutedText)}
                                      title="Refresh wallet"
                                  >
                                      <FaSync size={10} style={{ animation: (isRefreshingWallet || walletLoading) ? 'spin 1s linear infinite' : 'none' }} />
                                  </button>
                              )}
                          </div>
                      </div>
                      )}

                      {/* Tokens Tab Content */}
                      {walletTab === 'tokens' && (
                      <>
                      <div 
                          className="compact-wallet-container"
                          style={{
                              backgroundColor: theme.colors.primaryBg,
                              borderRadius: '8px',
                              maxHeight: '200px',
                              overflowY: 'auto',
                              overflowX: 'hidden'
                          }}
                      >
                          {/* Show loading until we're CERTAIN we have finished loading
                               Only show "no tokens" messages when:
                               - Cache check is complete (we've checked for cached data)
                               - Initial fetch has completed
                               - Not currently loading
                           */}
                          {(!cacheCheckComplete || walletLoading || !hasFetchedInitial) && tokensWithBalance.length === 0 ? (
                              <div style={{ 
                                  padding: '12px', 
                                  textAlign: 'center',
                                  color: theme.colors.mutedText,
                                  fontSize: '12px'
                              }}>
                                  Loading...
                              </div>
                          ) : tokensWithBalance.length === 0 ? (
                              <div 
                                  style={{ 
                                      padding: '12px', 
                                      textAlign: 'center',
                                      color: theme.colors.mutedText,
                                      fontSize: '12px',
                                      cursor: 'pointer'
                                  }}
                                  onClick={() => {
                                      navigate('/wallet');
                                      setShowPopup(false);
                                  }}
                              >
                                  {walletTokens.length > 0 
                                      ? 'All tokens hidden by dust filter.' 
                                      : 'No tokens with balance. Visit wallet to add tokens.'}
                              </div>
                          ) : (
                              tokensWithBalance.map((token, index) => {
                                  // Use normalizeId for the key to ensure consistent keys
                                  // between cached tokens (might be serialized objects) and network tokens (Principal objects)
                                  const ledgerId = normalizeId(token.principal) || normalizeId(token.ledger_canister_id);
                                  // Calculate total balance (available + locked + staked + maturity + rewards + neurons)
                                  const available = BigInt(token.available || token.balance || 0n);
                                  const locked = BigInt(token.locked || 0n);
                                  const staked = BigInt(token.staked || 0n);
                                  const maturity = BigInt(token.maturity || 0n);
                                  const rewards = BigInt(token.rewards || 0n);
                                  // Include neuron stake and maturity for SNS tokens (progressively loaded)
                                  const neuronStake = BigInt(token.neuronStake || 0n);
                                  const neuronMaturity = BigInt(token.neuronMaturity || 0n);
                                  const totalBalance = available + locked + staked + maturity + rewards + neuronStake + neuronMaturity;
                                  
                                  // Calculate USD value
                                  const balanceNum = Number(totalBalance) / (10 ** (token.decimals || 8));
                                  const usdValue = token.conversion_rate ? balanceNum * token.conversion_rate : token.usdValue;
                                  const tokenRefreshPhase = contextRefreshingTokens.get(ledgerId) || null;
                                  const quickWalletRefreshClass = tokenRefreshPhase === 'balance' ? 'refreshing-balance' : tokenRefreshPhase === 'full' ? 'refreshing-full' : '';
                                  
                                  return (
                                      <div 
                                          key={ledgerId || index}
                                          className={`compact-wallet-token ${quickWalletRefreshClass}`}
                                          onClick={() => openTokenDetailModal(token)}
                                          style={{
                                              display: 'flex',
                                              alignItems: 'center',
                                              padding: '8px 12px',
                                              borderBottom: index < tokensWithBalance.length - 1 ? `1px solid ${theme.colors.border}` : 'none',
                                              gap: '10px',
                                              cursor: 'pointer',
                                              minWidth: 0,
                                              maxWidth: '100%',
                                              boxSizing: 'border-box'
                                          }}
                                      >
                                          {/* Token Logo */}
                                          <div style={{ 
                                              width: '28px', 
                                              height: '28px', 
                                              flexShrink: 0,
                                              display: 'flex',
                                              alignItems: 'center',
                                              justifyContent: 'center',
                                              position: 'relative',
                                          }}>
                                              {token.logo ? (
                                                  <img 
                                                      src={token.logo}
                                                      alt={token.symbol}
                                                      style={{
                                                          width: '28px',
                                                          height: '28px',
                                                          borderRadius: '50%',
                                                          objectFit: 'cover'
                                                      }}
                                                      onError={(e) => {
                                                          e.target.style.display = 'none';
                                                          e.target.nextSibling.style.display = 'flex';
                                                      }}
                                                  />
                                              ) : null}
                                              <div 
                                                  style={{
                                                      width: '28px',
                                                      height: '28px',
                                                      borderRadius: '50%',
                                                      backgroundColor: theme.colors.accent,
                                                      display: token.logo ? 'none' : 'flex',
                                                      alignItems: 'center',
                                                      justifyContent: 'center',
                                                      fontSize: '11px',
                                                      fontWeight: 'bold',
                                                      color: theme.colors.primaryText
                                                  }}
                                              >
                                                  {token.symbol?.charAt(0) || '?'}
                                              </div>
                                              {isTokenSns && isTokenSns(token.ledger_canister_id) && (
                                                  <span style={{
                                                      position: 'absolute',
                                                      bottom: -2,
                                                      left: '50%',
                                                      transform: 'translateX(-50%)',
                                                      background: 'linear-gradient(135deg, #8b5cf6, #a78bfa)',
                                                      color: '#fff',
                                                      padding: '0px 3px',
                                                      borderRadius: '4px',
                                                      fontSize: '0.4rem',
                                                      fontWeight: '700',
                                                      letterSpacing: '0.5px',
                                                      lineHeight: '1.2',
                                                      whiteSpace: 'nowrap',
                                                      zIndex: 1,
                                                  }}>SNS</span>
                                              )}
                                          </div>
                                          
                                          {/* Balance, Symbol and USD Value */}
                                          <div style={{ 
                                              flex: 1, 
                                              minWidth: 0,
                                              display: 'flex',
                                              flexDirection: 'column',
                                              gap: '2px'
                                          }}>
                                              <div style={{
                                                  display: 'flex',
                                                  alignItems: 'center',
                                                  gap: '4px'
                                              }}>
                                                  <span style={{ 
                                                      color: theme.colors.primaryText,
                                                      fontSize: '13px',
                                                      fontWeight: '500',
                                                      overflow: 'hidden',
                                                      textOverflow: 'ellipsis',
                                                      whiteSpace: 'nowrap'
                                                  }}>
                                                      {formatAmount(totalBalance, token.decimals || 8)}
                                                  </span>
                                                  <span style={{ 
                                                      color: theme.colors.mutedText,
                                                      fontSize: '12px',
                                                      flexShrink: 0
                                                  }}>
                                                      {token.symbol}
                                                  </span>
                                              </div>
                                              {/* USD Value - shows loading indicator or value */}
                                              <span style={{ 
                                                  color: theme.colors.mutedText,
                                                  fontSize: '11px',
                                                  opacity: 0.8
                                              }}>
                                                  {usdValue !== null && usdValue !== undefined 
                                                      ? `$${usdValue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                                                      : <span style={{ opacity: 0.5 }}>...</span>
                                                  }
                                              </span>
                                          </div>
                                          
                                          {/* Send Button */}
                                          <button
                                              onClick={(e) => openSendModal(token, e)}
                                              style={{
                                                  background: 'none',
                                                  border: 'none',
                                                  padding: '4px 8px',
                                                  cursor: 'pointer',
                                                  color: theme.colors.accent,
                                                  fontSize: '11px',
                                                  display: 'flex',
                                                  alignItems: 'center',
                                                  gap: '4px',
                                                  borderRadius: '4px',
                                                  transition: 'background-color 0.15s ease',
                                                  flexShrink: 0
                                              }}
                                              onMouseOver={(e) => e.currentTarget.style.backgroundColor = `${theme.colors.accent}20`}
                                              onMouseOut={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                                              title={`Send ${token.symbol}`}
                                          >
                                              <FaPaperPlane size={10} />
                                              <span>Send</span>
                                          </button>
                                      </div>
                                  );
                              })
                          )}
                          {/* Show subtle loading indicator while more tokens are loading */}
                          {(!cacheCheckComplete || walletLoading || !hasFetchedInitial) && tokensWithBalance.length > 0 && (
                              <div style={{ 
                                  padding: '6px 12px',
                                  textAlign: 'center',
                                  color: theme.colors.mutedText,
                                  fontSize: '10px',
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                  gap: '6px',
                                  borderTop: `1px solid ${theme.colors.border}`,
                                  opacity: 0.7
                              }}>
                                  <FaSync size={8} style={{ animation: 'spin 1s linear infinite' }} />
                                  Loading more tokens...
                              </div>
                          )}
                      </div>
                      {tokensWithBalance.length > 0 && (
                          <button
                              onClick={() => {
                                  navigate('/wallet');
                                  setShowPopup(false);
                              }}
                              style={{
                                  width: '100%',
                                  marginTop: '8px',
                                  padding: '10px',
                                  backgroundColor: 'transparent',
                                  border: `1px solid ${theme.colors.border}`,
                                  borderRadius: '8px',
                                  color: theme.colors.accent,
                                  fontSize: '12px',
                                  fontWeight: '500',
                                  cursor: 'pointer',
                                  transition: 'all 0.2s ease',
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                  gap: '6px'
                              }}
                              onMouseOver={(e) => {
                                  e.target.style.backgroundColor = theme.colors.primaryBg;
                                  e.target.style.borderColor = theme.colors.accent;
                              }}
                              onMouseOut={(e) => {
                                  e.target.style.backgroundColor = 'transparent';
                                  e.target.style.borderColor = theme.colors.border;
                              }}
                          >
                              <FaWallet size={11} />
                              View Full Wallet
                          </button>
                      )}
                      </>
                      )}

                      {/* Liquidity Tab Header */}
                      {walletTab === 'positions' && (
                      <div 
                          style={{ 
                              color: theme.colors.mutedText, 
                              fontSize: '10px', 
                              textTransform: 'uppercase',
                              letterSpacing: '0.5px',
                              marginBottom: '8px',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'space-between'
                          }}
                      >
                          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                              <FaWater size={10} />
                              Liquidity
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                              {totalPositionsUSD !== null && (
                                  <span style={{ 
                                      color: '#10b981',
                                      fontSize: '12px',
                                      fontWeight: '600',
                                      textTransform: 'none',
                                      letterSpacing: 'normal'
                                  }}>
                                      ${totalPositionsUSD.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                  </span>
                              )}
                              {refreshWallet && (
                                  <button
                                      onClick={async (e) => {
                                          e.stopPropagation();
                                          setIsRefreshingWallet(true);
                                          try {
                                              await refreshWallet();
                                          } finally {
                                              setIsRefreshingWallet(false);
                                          }
                                      }}
                                      disabled={isRefreshingWallet || positionsLoading}
                                      style={{
                                          background: 'none',
                                          border: 'none',
                                          cursor: (isRefreshingWallet || positionsLoading) ? 'default' : 'pointer',
                                          padding: '2px',
                                          display: 'flex',
                                          alignItems: 'center',
                                          color: theme.colors.mutedText,
                                          opacity: (isRefreshingWallet || positionsLoading) ? 0.5 : 1,
                                          transition: 'color 0.2s ease'
                                      }}
                                      onMouseEnter={(e) => !(isRefreshingWallet || positionsLoading) && (e.currentTarget.style.color = theme.colors.primaryText)}
                                      onMouseLeave={(e) => !(isRefreshingWallet || positionsLoading) && (e.currentTarget.style.color = theme.colors.mutedText)}
                                      title="Refresh positions"
                                  >
                                      <FaSync size={10} style={{ animation: (isRefreshingWallet || positionsLoading) ? 'spin 1s linear infinite' : 'none' }} />
                                  </button>
                              )}
                          </div>
                      </div>
                      )}

                      {/* Liquidity Tab Content */}
                      {walletTab === 'positions' && (
                      <>
                      <div 
                          className="compact-wallet-container"
                          style={{
                              backgroundColor: theme.colors.primaryBg,
                              borderRadius: '8px',
                              maxHeight: '200px',
                              overflowY: 'auto',
                              overflowX: 'hidden'
                          }}
                      >
                          {positionsLoading && flattenedPositions.length === 0 ? (
                              <div style={{ 
                                  padding: '12px', 
                                  textAlign: 'center',
                                  color: theme.colors.mutedText,
                                  fontSize: '12px'
                              }}>
                                  Loading...
                              </div>
                          ) : flattenedPositions.length === 0 ? (
                              <div 
                                  style={{ 
                                      padding: '16px', 
                                      textAlign: 'center',
                                      color: theme.colors.mutedText,
                                      fontSize: '12px'
                                  }}
                              >
                                  <FaWater size={20} style={{ marginBottom: '8px', opacity: 0.5 }} />
                                  <div>No liquidity positions yet</div>
                                  <div style={{ fontSize: '11px', marginTop: '4px', opacity: 0.7 }}>
                                      Visit wallet to add positions
                                  </div>
                              </div>
                          ) : (
                              flattenedPositions.map(({ position, positionDetails }, index) => {
                                  // Calculate position value - ensure all values are Numbers
                                  const decimals0 = Number(position.token0Decimals || 8);
                                  const decimals1 = Number(position.token1Decimals || 8);
                                  const amount0 = positionDetails.amount0 !== undefined 
                                      ? Number(positionDetails.amount0) / Math.pow(10, decimals0) 
                                      : 0;
                                  const amount1 = positionDetails.amount1 !== undefined 
                                      ? Number(positionDetails.amount1) / Math.pow(10, decimals1) 
                                      : 0;
                                  const fees0 = positionDetails.tokensOwed0 !== undefined 
                                      ? Number(positionDetails.tokensOwed0) / Math.pow(10, decimals0) 
                                      : 0;
                                  const fees1 = positionDetails.tokensOwed1 !== undefined 
                                      ? Number(positionDetails.tokensOwed1) / Math.pow(10, decimals1) 
                                      : 0;
                                  
                                  let liquidityUSD = 0;
                                  let feesUSD = 0;
                                  let hasValue = false;
                                  
                                  if (position.token0_conversion_rate) {
                                      liquidityUSD += amount0 * Number(position.token0_conversion_rate);
                                      feesUSD += fees0 * Number(position.token0_conversion_rate);
                                      hasValue = true;
                                  }
                                  if (position.token1_conversion_rate) {
                                      liquidityUSD += amount1 * Number(position.token1_conversion_rate);
                                      feesUSD += fees1 * Number(position.token1_conversion_rate);
                                      hasValue = true;
                                  }
                                  
                                  const totalUSD = liquidityUSD + feesUSD;
                                  const isLocked = positionDetails.lockInfo && positionDetails.lockInfo.expiry;
                                  
                                  return (
                                      <div 
                                          key={`${position.swapCanisterId}-${positionDetails.positionId || index}`}
                                          className="compact-wallet-token"
                                          onClick={() => openPositionDetailModal(position, positionDetails)}
                                          style={{
                                              display: 'flex',
                                              alignItems: 'center',
                                              padding: '8px 12px',
                                              borderBottom: index < flattenedPositions.length - 1 ? `1px solid ${theme.colors.border}` : 'none',
                                              gap: '10px',
                                              cursor: 'pointer',
                                              minWidth: 0,
                                              maxWidth: '100%',
                                              boxSizing: 'border-box'
                                          }}
                                      >
                                          {/* Token Pair Logos */}
                                          <div style={{ 
                                              display: 'flex',
                                              alignItems: 'center',
                                              flexShrink: 0,
                                              position: 'relative',
                                              width: '38px',
                                              height: '28px'
                                          }}>
                                              {position.token0Logo ? (
                                                  <img 
                                                      src={position.token0Logo}
                                                      alt={position.token0Symbol}
                                                      style={{
                                                          width: '24px',
                                                          height: '24px',
                                                          borderRadius: '50%',
                                                          objectFit: 'cover',
                                                          position: 'absolute',
                                                          left: 0,
                                                          zIndex: 2,
                                                          border: `2px solid ${theme.colors.primaryBg}`
                                                      }}
                                                      onError={(e) => {
                                                          e.target.style.display = 'none';
                                                      }}
                                                  />
                                              ) : (
                                                  <div 
                                                      style={{
                                                          width: '24px',
                                                          height: '24px',
                                                          borderRadius: '50%',
                                                          backgroundColor: theme.colors.accent,
                                                          display: 'flex',
                                                          alignItems: 'center',
                                                          justifyContent: 'center',
                                                          fontSize: '10px',
                                                          fontWeight: 'bold',
                                                          color: theme.colors.primaryText,
                                                          position: 'absolute',
                                                          left: 0,
                                                          zIndex: 2,
                                                          border: `2px solid ${theme.colors.primaryBg}`
                                                      }}
                                                  >
                                                      {position.token0Symbol?.charAt(0) || '?'}
                                                  </div>
                                              )}
                                              {position.token1Logo ? (
                                                  <img 
                                                      src={position.token1Logo}
                                                      alt={position.token1Symbol}
                                                      style={{
                                                          width: '24px',
                                                          height: '24px',
                                                          borderRadius: '50%',
                                                          objectFit: 'cover',
                                                          position: 'absolute',
                                                          left: '14px',
                                                          zIndex: 1,
                                                          border: `2px solid ${theme.colors.primaryBg}`
                                                      }}
                                                      onError={(e) => {
                                                          e.target.style.display = 'none';
                                                      }}
                                                  />
                                              ) : (
                                                  <div 
                                                      style={{
                                                          width: '24px',
                                                          height: '24px',
                                                          borderRadius: '50%',
                                                          backgroundColor: theme.colors.border,
                                                          display: 'flex',
                                                          alignItems: 'center',
                                                          justifyContent: 'center',
                                                          fontSize: '10px',
                                                          fontWeight: 'bold',
                                                          color: theme.colors.primaryText,
                                                          position: 'absolute',
                                                          left: '14px',
                                                          zIndex: 1,
                                                          border: `2px solid ${theme.colors.primaryBg}`
                                                      }}
                                                  >
                                                      {position.token1Symbol?.charAt(0) || '?'}
                                                  </div>
                                              )}
                                          </div>
                                          
                                          {/* Position Info */}
                                          <div style={{ 
                                              flex: 1, 
                                              minWidth: 0,
                                              display: 'flex',
                                              flexDirection: 'column',
                                              gap: '2px'
                                          }}>
                                              <div style={{
                                                  display: 'flex',
                                                  alignItems: 'center',
                                                  gap: '6px'
                                              }}>
                                                  <span style={{ 
                                                      color: theme.colors.primaryText,
                                                      fontSize: '13px',
                                                      fontWeight: '500',
                                                      overflow: 'hidden',
                                                      textOverflow: 'ellipsis',
                                                      whiteSpace: 'nowrap'
                                                  }}>
                                                      {position.token0Symbol}/{position.token1Symbol}
                                                  </span>
                                                  {isLocked && (
                                                      <FaLock size={10} style={{ color: theme.colors.accent }} />
                                                  )}
                                              </div>
                                              <span style={{ 
                                                  color: theme.colors.mutedText,
                                                  fontSize: '11px',
                                                  opacity: 0.8
                                              }}>
                                                  {hasValue 
                                                      ? `$${totalUSD.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                                                      : position.loading ? '...' : 'N/A'
                                                  }
                                                  {feesUSD > 0.01 && (
                                                      <span style={{ color: theme.colors.success, marginLeft: '4px' }}>
                                                          +${feesUSD.toFixed(2)}
                                                      </span>
                                                  )}
                                              </span>
                                          </div>
                                          
                                          {/* Send Button */}
                                          <button
                                              onClick={(e) => {
                                                  e.stopPropagation();
                                                  // Map positionId to id for SendLiquidityPositionModal compatibility
                                                  handleOpenSendLiquidityPositionFromDetail({ 
                                                      ...position, 
                                                      ...positionDetails,
                                                      id: positionDetails.positionId
                                                  });
                                              }}
                                              style={{
                                                  background: 'none',
                                                  border: 'none',
                                                  padding: '4px 8px',
                                                  cursor: 'pointer',
                                                  color: theme.colors.accent,
                                                  fontSize: '11px',
                                                  display: 'flex',
                                                  alignItems: 'center',
                                                  gap: '4px',
                                                  borderRadius: '4px',
                                                  transition: 'background-color 0.15s ease',
                                                  flexShrink: 0
                                              }}
                                              onMouseOver={(e) => e.currentTarget.style.backgroundColor = `${theme.colors.accent}20`}
                                              onMouseOut={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                                              title="Send position"
                                          >
                                              <FaPaperPlane size={10} />
                                              <span>Send</span>
                                          </button>
                                      </div>
                                  );
                              })
                          )}
                          {/* Show subtle loading indicator while more positions are loading */}
                          {(positionsLoading || !hasFetchedPositions) && flattenedPositions.length > 0 && (
                              <div style={{ 
                                  padding: '6px 12px',
                                  textAlign: 'center',
                                  color: theme.colors.mutedText,
                                  fontSize: '10px',
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                  gap: '6px',
                                  borderTop: `1px solid ${theme.colors.border}`,
                                  opacity: 0.7
                              }}>
                                  <FaSync size={8} style={{ animation: 'spin 1s linear infinite' }} />
                                  Loading more positions...
                              </div>
                          )}
                      </div>
                      {flattenedPositions.length > 0 && (
                          <button
                              onClick={() => {
                                  navigate('/wallet');
                                  setShowPopup(false);
                              }}
                              style={{
                                  width: '100%',
                                  marginTop: '8px',
                                  padding: '10px',
                                  backgroundColor: 'transparent',
                                  border: `1px solid ${theme.colors.border}`,
                                  borderRadius: '8px',
                                  color: theme.colors.accent,
                                  fontSize: '12px',
                                  fontWeight: '500',
                                  cursor: 'pointer',
                                  transition: 'all 0.2s ease',
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                  gap: '6px'
                              }}
                              onMouseOver={(e) => {
                                  e.target.style.backgroundColor = theme.colors.primaryBg;
                                  e.target.style.borderColor = theme.colors.accent;
                              }}
                              onMouseOut={(e) => {
                                  e.target.style.backgroundColor = 'transparent';
                                  e.target.style.borderColor = theme.colors.border;
                              }}
                          >
                              <FaWater size={11} />
                              View All Liquidity
                          </button>
                      )}
                      </>
                      )}

                      {/* Apps Tab Header */}
                      {walletTab === 'dapps' && (
                      <div 
                          style={{ 
                              color: theme.colors.mutedText, 
                              fontSize: '10px', 
                              textTransform: 'uppercase',
                              letterSpacing: '0.5px',
                              marginBottom: '8px',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'space-between'
                          }}
                      >
                          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                              <FaBox size={10} />
                              Apps
                              {(neuronManagers.length + trackedCanisters.length) > 0 && (
                                  <span style={{ 
                                      color: theme.colors.accent,
                                      fontWeight: '600'
                                  }}>
                                      ({neuronManagers.length + trackedCanisters.length})
                                  </span>
                              )}
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                              {totalManagersUSD !== null && totalManagersUSD > 0 && (
                                  <span style={{ 
                                      color: '#10b981',
                                      fontSize: '12px',
                                      fontWeight: '600',
                                      textTransform: 'none',
                                      letterSpacing: 'normal'
                                  }}>
                                      ${totalManagersUSD.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                  </span>
                              )}
                              {walletContext?.refreshNeuronManagers && (
                                  <button
                                      onClick={async (e) => {
                                          e.stopPropagation();
                                          setIsRefreshingWallet(true);
                                          try {
                                              await walletContext.refreshNeuronManagers();
                                              // Also refresh tracked canisters status
                                              if (trackedCanisters.length > 0 && identity) {
                                                  // Re-fetch tracked canister status
                                                  const statusMap = {};
                                                  const host = process.env.DFX_NETWORK === 'ic' || process.env.DFX_NETWORK === 'staging' 
                                                      ? 'https://ic0.app' 
                                                      : 'http://localhost:4943';
                                                  const agent = new HttpAgent({ identity, host });
                                                  if (process.env.DFX_NETWORK !== 'ic' && process.env.DFX_NETWORK !== 'staging') {
                                                      await agent.fetchRootKey();
                                                  }
                                                  await Promise.allSettled(trackedCanisters.map(async (canisterId) => {
                                                      let cycles = null;
                                                      let memory = null;
                                                      let isController = false;
                                                      let moduleHash = null;
                                                      try {
                                                          const canisterIdPrincipal = Principal.fromText(canisterId);
                                                          const mgmtActor = Actor.createActor(managementCanisterIdlFactory, {
                                                              agent,
                                                              canisterId: MANAGEMENT_CANISTER_ID,
                                                              callTransform: (methodName, args, callConfig) => ({
                                                                  ...callConfig,
                                                                  effectiveCanisterId: canisterIdPrincipal,
                                                              }),
                                                          });
                                                          const status = await mgmtActor.canister_status({ canister_id: canisterIdPrincipal });
                                                          cycles = Number(status.cycles);
                                                          memory = Number(status.memory_size);
                                                          isController = true;
                                                          if (status.module_hash?.[0]) {
                                                              moduleHash = uint8ArrayToHex(status.module_hash[0]);
                                                          }
                                                      } catch (e) {
                                                          // Try backend fallback
                                                          try {
                                                              const info = await getCanisterInfo(canisterId);
                                                              if (info?.module_hash) {
                                                                  moduleHash = info.module_hash;
                                                              }
                                                          } catch {}
                                                      }
                                                      statusMap[canisterId] = { cycles, memory, isController, moduleHash };
                                                  }));
                                                  setTrackedCanisterStatus(statusMap);
                                              }
                                          } catch (error) {
                                              console.error('Error refreshing apps:', error);
                                          } finally {
                                              setIsRefreshingWallet(false);
                                          }
                                      }}
                                      disabled={isRefreshingWallet}
                                      style={{
                                          background: 'none',
                                          border: 'none',
                                          cursor: isRefreshingWallet ? 'default' : 'pointer',
                                          padding: '4px',
                                          display: 'flex',
                                          alignItems: 'center',
                                          color: theme.colors.mutedText,
                                          transition: 'color 0.2s ease',
                                          opacity: isRefreshingWallet ? 0.6 : 1
                                      }}
                                      onMouseEnter={(e) => !isRefreshingWallet && (e.currentTarget.style.color = theme.colors.primaryText)}
                                      onMouseLeave={(e) => !isRefreshingWallet && (e.currentTarget.style.color = theme.colors.mutedText)}
                                      title="Refresh apps data"
                                  >
                                      <FaSync size={10} style={{ animation: isRefreshingWallet ? 'spin 1s linear infinite' : 'none' }} />
                                  </button>
                              )}
                          </div>
                      </div>
                      )}

                      {/* Apps Tab Content - Compact list like tokens */}
                      {walletTab === 'dapps' && (
                      <>
                      <div 
                          className="compact-wallet-container"
                          style={{
                              backgroundColor: theme.colors.primaryBg,
                              borderRadius: '8px',
                              maxHeight: '200px',
                              overflowY: 'auto',
                              overflowX: 'hidden'
                          }}
                      >
                          {/* Loading state */}
                          {(neuronManagersLoading && neuronManagers.length === 0 && trackedCanistersLoading && trackedCanisters.length === 0) ? (
                              <div style={{ 
                                  padding: '12px', 
                                  textAlign: 'center',
                                  color: theme.colors.mutedText,
                                  fontSize: '12px'
                              }}>
                                  Loading apps...
                              </div>
                          ) : (neuronManagers.length === 0 && trackedCanisters.length === 0) ? (
                              <div 
                                  style={{ 
                                      padding: '12px', 
                                      textAlign: 'center',
                                      color: theme.colors.mutedText,
                                      fontSize: '12px',
                                      cursor: 'pointer'
                                  }}
                                  onClick={() => {
                                      navigate('/wallet');
                                      setShowPopup(false);
                                  }}
                              >
                                  No apps found. Visit wallet to add.
                              </div>
                          ) : (
                              <>
                              {/* Outdated bots message */}
                              {outdatedManagers.length > 0 && latestOfficialVersion && (
                                  <div
                                      onClick={(e) => { e.stopPropagation(); setUpgradeDialogOpen(true); }}
                                      style={{
                                          display: 'flex',
                                          alignItems: 'center',
                                          gap: '8px',
                                          padding: '8px 12px',
                                          background: 'linear-gradient(135deg, rgba(139, 92, 246, 0.1), rgba(139, 92, 246, 0.05))',
                                          border: '1px solid rgba(139, 92, 246, 0.2)',
                                          borderRadius: '8px',
                                          margin: '0 0 4px 0',
                                          cursor: 'pointer',
                                          fontSize: '11px',
                                          color: theme.colors.primaryText,
                                      }}
                                  >
                                      <FaBrain size={11} style={{ color: '#f59e0b', flexShrink: 0 }} />
                                      <span style={{ flex: 1 }}>
                                          <strong>{outdatedManagers.length}</strong> bot{outdatedManagers.length !== 1 ? 's' : ''} outdated
                                      </span>
                                      <span style={{
                                          padding: '2px 8px',
                                          borderRadius: '4px',
                                          backgroundColor: '#8b5cf6',
                                          color: '#fff',
                                          fontSize: '10px',
                                          fontWeight: '600',
                                          flexShrink: 0,
                                      }}>
                                          Upgrade
                                      </span>
                                  </div>
                              )}
                              {/* Low cycles message */}
                              {lowCyclesCanisters.length > 0 && (
                                  <div
                                      onClick={(e) => { e.stopPropagation(); setTopUpDialogOpen(true); }}
                                      style={{
                                          display: 'flex',
                                          alignItems: 'center',
                                          gap: '8px',
                                          padding: '8px 12px',
                                          background: 'linear-gradient(135deg, rgba(239, 68, 68, 0.1), rgba(239, 68, 68, 0.05))',
                                          border: '1px solid rgba(239, 68, 68, 0.2)',
                                          borderRadius: '8px',
                                          margin: '0 0 4px 0',
                                          cursor: 'pointer',
                                          fontSize: '11px',
                                          color: theme.colors.primaryText,
                                      }}
                                  >
                                      <span style={{ fontSize: '11px', color: '#ef4444', flexShrink: 0 }}>⚡</span>
                                      <span style={{ flex: 1 }}>
                                          <strong>{lowCyclesCanisters.length}</strong> canister{lowCyclesCanisters.length !== 1 ? 's' : ''} low on cycles
                                      </span>
                                      <span style={{
                                          padding: '2px 8px',
                                          borderRadius: '4px',
                                          backgroundColor: '#ef4444',
                                          color: '#fff',
                                          fontSize: '10px',
                                          fontWeight: '600',
                                          flexShrink: 0,
                                      }}>
                                          Top Up
                                      </span>
                                  </div>
                              )}
                              {/* Neuron Managers first (sorted by layout) */}
                              {(walletLayoutCtx?.sortByLayout
                                  ? walletLayoutCtx.sortByLayout('sneedapp', neuronManagers, m => {
                                      if (!m.canisterId) return '';
                                      return typeof m.canisterId === 'string' ? m.canisterId : (typeof m.canisterId.toText === 'function' ? m.canisterId.toText() : String(m.canisterId));
                                  })
                                  : neuronManagers
                              ).map((manager, index) => {
                                  // Safely convert canisterId to string - handle Principal objects and plain objects
                                  let canisterIdStr = '';
                                  if (manager.canisterId) {
                                      if (typeof manager.canisterId === 'string') {
                                          canisterIdStr = manager.canisterId;
                                      } else if (typeof manager.canisterId.toText === 'function') {
                                          canisterIdStr = manager.canisterId.toText();
                                      } else if (typeof manager.canisterId.toString === 'function') {
                                          const str = manager.canisterId.toString();
                                          // Check if toString returned a valid principal string (not [object Object])
                                          canisterIdStr = str.includes('-') ? str : '';
                                      }
                                  }
                                  // Skip rendering if we couldn't get a valid canister ID
                                  if (!canisterIdStr) return null;
                                  const neuronsData = managerNeurons[canisterIdStr];
                                  const neurons = neuronsData?.neurons || [];
                                  const isLoading = neuronsData?.loading;
                                  
                                  // Get display name for canister
                                  const displayInfo = getPrincipalDisplayName(canisterIdStr);
                                  const displayName = displayInfo?.name || `${canisterIdStr.slice(0, 5)}...${canisterIdStr.slice(-5)}`;
                                  
                                  // Calculate ICP value for this manager
                                  let managerIcpTotal = 0;
                                  neurons.forEach(neuron => {
                                      if (neuron.info) {
                                          managerIcpTotal += Number(neuron.info.stake_e8s || 0) / 1e8;
                                      }
                                      if (neuron.full) {
                                          managerIcpTotal += Number(neuron.full.maturity_e8s_equivalent || 0) / 1e8;
                                          if (neuron.full.staked_maturity_e8s_equivalent?.[0]) {
                                              managerIcpTotal += Number(neuron.full.staked_maturity_e8s_equivalent[0]) / 1e8;
                                          }
                                      }
                                  });
                                  
                                  const managerUsdValue = icpPrice ? managerIcpTotal * icpPrice : null;
                                  const totalItems = neuronManagers.length + trackedCanisters.length;
                                  
                                  return (
                                      <div 
                                          key={`manager-${index}`}
                                          className="compact-wallet-token"
                                          onClick={() => openDappDetailModal({
                                              canisterId: canisterIdStr,
                                              isNeuronManager: true,
                                              neuronManagerVersion: manager.version,
                                              neuronCount: neurons.length,
                                              cycles: null, // Will be fetched on modal open via auto-refresh
                                              memory: null,
                                              isController: neuronManagerIsController[canisterIdStr] ?? true, // Default to true like Wallet.jsx
                                          })}
                                          style={{
                                              display: 'flex',
                                              alignItems: 'center',
                                              padding: '8px 12px',
                                              borderBottom: (index < neuronManagers.length - 1 || trackedCanisters.length > 0) ? `1px solid ${theme.colors.border}` : 'none',
                                              gap: '10px',
                                              cursor: 'pointer',
                                              minWidth: 0,
                                              maxWidth: '100%',
                                              boxSizing: 'border-box'
                                          }}
                                      >
                                          {/* Icon with crown indicator */}
                                          <div style={{ 
                                              width: '28px', 
                                              height: '28px', 
                                              flexShrink: 0,
                                              display: 'flex',
                                              alignItems: 'center',
                                              justifyContent: 'center',
                                              position: 'relative'
                                          }}>
                                              <div 
                                                  style={{
                                                      width: '28px',
                                                      height: '28px',
                                                      borderRadius: '50%',
                                                      backgroundColor: `${theme.colors.accent}20`,
                                                      display: 'flex',
                                                      alignItems: 'center',
                                                      justifyContent: 'center'
                                                  }}
                                              >
                                                  <FaBrain size={14} style={{ color: theme.colors.accent }} />
                                              </div>
                                              {/* Crown only if user is a controller */}
                                              {neuronManagerIsController[canisterIdStr] && (
                                                  <FaCrown 
                                                      size={8} 
                                                      style={{ 
                                                          position: 'absolute',
                                                          top: '-2px',
                                                          right: '-2px',
                                                          color: '#f59e0b'
                                                      }} 
                                                  />
                                              )}
                                          </div>
                                          
                                          {/* Info */}
                                          <div style={{ 
                                              flex: 1, 
                                              minWidth: 0,
                                              display: 'flex',
                                              flexDirection: 'column',
                                              gap: '2px'
                                          }}>
                                              <div style={{
                                                  display: 'flex',
                                                  alignItems: 'center',
                                                  gap: '4px',
                                                  minWidth: 0,
                                              }}>
                                                  <PrincipalDisplay
                                                      principal={canisterIdStr}
                                                      showCopyButton={false}
                                                      isAuthenticated={!!identity}
                                                      noLink={true}
                                                      style={{ 
                                                          fontSize: '13px',
                                                          fontWeight: '500',
                                                          overflow: 'hidden',
                                                          textOverflow: 'ellipsis',
                                                          whiteSpace: 'nowrap',
                                                          minWidth: 0,
                                                          flex: 1,
                                                      }}
                                                      showSendMessage={false}
                                                      showViewProfile={false}
                                                  />
                                                  <span style={{ 
                                                      color: theme.colors.mutedText,
                                                      fontSize: '11px',
                                                      flexShrink: 0
                                                  }}>
                                                      {neurons.length}n
                                                  </span>
                                                  {/* Chore status lamp */}
                                                  {managerChoreStatuses[canisterIdStr] && managerChoreStatuses[canisterIdStr].length > 0 && (() => {
                                                      const overallState = getAllChoresSummaryLamp(managerChoreStatuses[canisterIdStr]);
                                                      const overallLabel = getSummaryLabel(overallState, 'Chores');
                                                      return <StatusLamp state={overallState} size={7} label={overallLabel} />;
                                                  })()}
                                              </div>
                                              {/* USD Value */}
                                              <span style={{ 
                                                  color: theme.colors.mutedText,
                                                  fontSize: '11px'
                                              }}>
                                                  {isLoading 
                                                      ? 'Loading...'
                                                      : managerUsdValue !== null 
                                                          ? `$${managerUsdValue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                                                          : `${managerIcpTotal.toFixed(2)} ICP`
                                                  }
                                              </span>
                                          </div>
                                          
                                          {/* Send Button - only show if controller */}
                                          {neuronManagerIsController[canisterIdStr] && (
                                              <button
                                                  onClick={(e) => {
                                                      e.stopPropagation();
                                                      handleSendCanister(canisterIdStr, true);
                                                  }}
                                                  style={{
                                                      background: 'none',
                                                      border: 'none',
                                                      padding: '4px 8px',
                                                      cursor: 'pointer',
                                                      color: theme.colors.accent,
                                                      fontSize: '11px',
                                                      display: 'flex',
                                                      alignItems: 'center',
                                                      gap: '4px',
                                                      borderRadius: '4px',
                                                      transition: 'background-color 0.15s ease',
                                                      flexShrink: 0
                                                  }}
                                                  onMouseOver={(e) => e.currentTarget.style.backgroundColor = `${theme.colors.accent}20`}
                                                  onMouseOut={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                                                  title="Transfer control"
                                              >
                                                  <FaPaperPlane size={10} />
                                                  <span>Send</span>
                                              </button>
                                          )}
                                      </div>
                                  );
                              })}
                              
                              {/* Tracked Canisters after - with progressive detection (sorted by layout) */}
                              {(walletLayoutCtx?.sortByLayout
                                  ? walletLayoutCtx.sortByLayout('apps', trackedCanisters, c => typeof c === 'string' ? c : c.toString())
                                  : trackedCanisters
                              ).map((canisterId, index) => {
                                  const status = trackedCanisterStatus[canisterId];
                                  const detectedManager = detectedNeuronManagers[canisterId];
                                  const isNeuronManager = detectedManager?.isValid;
                                  const appId = botAppIdMap[canisterId] || '';
                                  const isTradingBot = appId === 'sneed-trading-bot';
                                  const isKnownBot = isNeuronManager || isTradingBot;
                                  // Use shared controller status from context
                                  const isController = trackedCanisterIsController[canisterId];
                                  const cycles = status?.cycles;
                                  const memory = status?.memory;
                                  
                                  // Get display name for canister
                                  const displayInfo = getPrincipalDisplayName(canisterId);
                                  const displayName = displayInfo?.name || `${canisterId.slice(0, 5)}...${canisterId.slice(-5)}`;
                                  
                                  return (
                                      <div 
                                          key={`canister-${index}`}
                                          className="compact-wallet-token"
                                          onClick={() => openDappDetailModal({
                                              canisterId,
                                              isNeuronManager,
                                              isTradingBot,
                                              appId,
                                              neuronManagerVersion: detectedManager?.version || null,
                                              neuronCount: detectedManager?.neuronCount || 0,
                                              cycles,
                                              memory,
                                              isController,
                                          })}
                                          style={{
                                              display: 'flex',
                                              alignItems: 'center',
                                              padding: '8px 12px',
                                              borderBottom: index < trackedCanisters.length - 1 ? `1px solid ${theme.colors.border}` : 'none',
                                              gap: '10px',
                                              cursor: 'pointer',
                                              minWidth: 0,
                                              maxWidth: '100%',
                                              boxSizing: 'border-box'
                                          }}
                                      >
                                          {/* Icon with crown indicator for controlled canisters */}
                                          <div style={{ 
                                              width: '28px', 
                                              height: '28px', 
                                              flexShrink: 0,
                                              display: 'flex',
                                              alignItems: 'center',
                                              justifyContent: 'center',
                                              position: 'relative'
                                          }}>
                                              <div 
                                                  style={{
                                                      width: '28px',
                                                      height: '28px',
                                                      borderRadius: '50%',
                                                      backgroundColor: isKnownBot 
                                                          ? `${theme.colors.accent}20` 
                                                          : `${theme.colors.mutedText}20`,
                                                      display: 'flex',
                                                      alignItems: 'center',
                                                      justifyContent: 'center'
                                                  }}
                                              >
                                                  {isTradingBot ? (
                                                      <FaChartLine size={13} style={{ color: '#10b981' }} />
                                                  ) : isNeuronManager ? (
                                                      <FaBrain size={14} style={{ color: theme.colors.accent }} />
                                                  ) : (
                                                      <FaBox size={12} style={{ color: theme.colors.mutedText }} />
                                                  )}
                                              </div>
                                              {/* Crown for controlled canisters */}
                                              {isController && (
                                                  <FaCrown 
                                                      size={8} 
                                                      style={{ 
                                                          position: 'absolute',
                                                          top: '-2px',
                                                          right: '-2px',
                                                          color: '#f59e0b'
                                                      }} 
                                                  />
                                              )}
                                          </div>
                                          
                                          {/* Info */}
                                          <div style={{ 
                                              flex: 1, 
                                              minWidth: 0,
                                              display: 'flex',
                                              flexDirection: 'column',
                                              gap: '2px'
                                          }}>
                                              <div style={{
                                                  display: 'flex',
                                                  alignItems: 'center',
                                                  gap: '4px',
                                                  minWidth: 0,
                                              }}>
                                                  <PrincipalDisplay
                                                      principal={canisterId}
                                                      showCopyButton={false}
                                                      isAuthenticated={!!identity}
                                                      noLink={true}
                                                      style={{ 
                                                          fontSize: '13px',
                                                          fontWeight: '500',
                                                          overflow: 'hidden',
                                                          textOverflow: 'ellipsis',
                                                          whiteSpace: 'nowrap',
                                                          minWidth: 0,
                                                          flex: 1,
                                                      }}
                                                      showSendMessage={false}
                                                      showViewProfile={false}
                                                  />
                                                  {isNeuronManager && detectedManager?.neuronCount > 0 && (
                                                      <span style={{ 
                                                          color: theme.colors.mutedText,
                                                          fontSize: '11px',
                                                          flexShrink: 0
                                                      }}>
                                                          {detectedManager.neuronCount}n
                                                      </span>
                                                  )}
                                              </div>
                                              {/* Cycles and Memory info */}
                                              <span style={{ 
                                                  color: theme.colors.mutedText,
                                                  fontSize: '11px',
                                                  display: 'flex',
                                                  alignItems: 'center',
                                                  gap: '6px'
                                              }}>
                                                  {cycles !== null && cycles !== undefined ? (
                                                      <span style={{ display: 'flex', alignItems: 'center', gap: '2px' }}>
                                                          <FaCoins size={8} />
                                                          {formatCyclesCompact(cycles)}
                                                      </span>
                                                  ) : null}
                                                  {memory !== null && memory !== undefined ? (
                                                      <span style={{ display: 'flex', alignItems: 'center', gap: '2px' }}>
                                                          <FaMicrochip size={8} />
                                                          {formatMemoryCompact(memory)}
                                                      </span>
                                                  ) : null}
                                                  {cycles === null && memory === null && (
                                                      <span>{isTradingBot ? 'Trading Bot' : isNeuronManager ? 'Staking Bot' : 'App'}</span>
                                                  )}
                                              </span>
                                          </div>
                                          
                                          {/* Send Button - only show if controller */}
                                          {isController && (
                                              <button
                                                  onClick={(e) => {
                                                      e.stopPropagation();
                                                      handleSendCanister(canisterId, isNeuronManager);
                                                  }}
                                                  style={{
                                                      background: 'none',
                                                      border: 'none',
                                                      padding: '4px 8px',
                                                      cursor: 'pointer',
                                                      color: theme.colors.accent,
                                                      fontSize: '11px',
                                                      display: 'flex',
                                                      alignItems: 'center',
                                                      gap: '4px',
                                                      borderRadius: '4px',
                                                      transition: 'background-color 0.15s ease',
                                                      flexShrink: 0
                                                  }}
                                                  onMouseOver={(e) => e.currentTarget.style.backgroundColor = `${theme.colors.accent}20`}
                                                  onMouseOut={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                                                  title="Transfer control"
                                              >
                                                  <FaPaperPlane size={10} />
                                                  <span>Send</span>
                                              </button>
                                          )}
                                      </div>
                                  );
                              })}
                              </>
                          )}
                          {/* Show subtle loading indicator while more apps are loading */}
                          {((neuronManagersLoading || !hasFetchedManagers) && neuronManagers.length > 0) || 
                           ((trackedCanistersLoading || !hasFetchedTrackedCanisters) && trackedCanisters.length > 0) ? (
                              <div style={{ 
                                  padding: '6px 12px',
                                  textAlign: 'center',
                                  color: theme.colors.mutedText,
                                  fontSize: '10px',
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                  gap: '6px',
                                  borderTop: `1px solid ${theme.colors.border}`,
                                  opacity: 0.7
                              }}>
                                  <FaSync size={8} style={{ animation: 'spin 1s linear infinite' }} />
                                  Loading...
                              </div>
                          ) : null}
                      </div>
                      {(neuronManagers.length > 0 || trackedCanisters.length > 0) && (
                          <button
                              onClick={() => {
                                  navigate('/wallet');
                                  setShowPopup(false);
                              }}
                              style={{
                                  width: '100%',
                                  marginTop: '8px',
                                  padding: '10px',
                                  backgroundColor: 'transparent',
                                  border: `1px solid ${theme.colors.border}`,
                                  borderRadius: '8px',
                                  color: theme.colors.accent,
                                  fontSize: '12px',
                                  fontWeight: '500',
                                  cursor: 'pointer',
                                  transition: 'all 0.2s ease',
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                  gap: '6px'
                              }}
                              onMouseOver={(e) => {
                                  e.target.style.backgroundColor = theme.colors.primaryBg;
                                  e.target.style.borderColor = theme.colors.accent;
                              }}
                              onMouseOut={(e) => {
                                  e.target.style.backgroundColor = 'transparent';
                                  e.target.style.borderColor = theme.colors.border;
                              }}
                          >
                              <FaBox size={11} />
                              View All Apps
                          </button>
                      )}
                      </>
                      )}
                  </div>

                  {/* Log Out Button */}
                  <div style={{ padding: '0 16px 16px' }}>
                      <button 
                          onClick={onLogout}
                          style={{
                              width: '100%',
                              padding: '12px',
                              background: 'linear-gradient(135deg, #ef4444, #dc2626)',
                              color: 'white',
                              border: 'none',
                              borderRadius: '10px',
                              fontSize: '14px',
                              fontWeight: '600',
                              cursor: 'pointer',
                              transition: 'all 0.2s ease',
                              boxShadow: '0 4px 12px rgba(239, 68, 68, 0.3)'
                          }}
                          onMouseOver={(e) => {
                              e.target.style.transform = 'translateY(-1px)';
                              e.target.style.boxShadow = '0 6px 16px rgba(239, 68, 68, 0.4)';
                          }}
                          onMouseOut={(e) => {
                              e.target.style.transform = 'translateY(0)';
                              e.target.style.boxShadow = '0 4px 12px rgba(239, 68, 68, 0.3)';
                          }}
                      >
                          Log Out
                      </button>
                  </div>
              </div>
          )}
          
      </div>
      
      {/* Send Token Modal - rendered outside the popup container to avoid event interference */}
      <SendTokenModal
          show={showSendModal}
          onClose={() => {
              setShowSendModal(false);
              setSelectedToken(null);
          }}
          onSend={handleSendToken}
          token={selectedToken}
      />
      
      {/* Token Detail Modal */}
      <TokenCardModal
          show={showTokenDetailModal}
          onClose={() => {
              setShowTokenDetailModal(false);
              setDetailToken(null);
              setTokenLocks([]);
          }}
          token={detailToken}
          openSendModal={handleOpenSendFromDetail}
          openLockModal={handleOpenLockFromDetail}
          hideButtons={false}
          isSnsToken={detailToken && isTokenSns ? isTokenSns(detailToken.ledger_canister_id) : false}
          handleRefreshToken={handleRefreshToken}
          refreshPhase={detailToken ? (contextRefreshingTokens.get(normalizeId(detailToken.ledger_canister_id) || normalizeId(detailToken.principal)) || null) : null}
          isRefreshing={isRefreshingToken}
          locks={tokenLocks}
          lockDetailsLoading={lockDetailsLoading}
      />
      
      {/* Lock Modal */}
      <LockModal
          show={showLockModal}
          onClose={() => {
              setShowLockModal(false);
              setLockToken(null);
          }}
          token={lockToken}
          locks={{}}
          onAddLock={handleAddLock}
          identity={identity}
          isPremium={isPremium}
      />
      
      {/* Position Detail Modal */}
      <PositionCardModal
          show={showPositionDetailModal}
          onClose={() => {
              setShowPositionDetailModal(false);
              setDetailPosition(null);
              setDetailPositionDetails(null);
          }}
          position={detailPosition}
          positionDetails={detailPositionDetails}
          handleRefreshPosition={handleRefreshPosition}
          isRefreshing={isRefreshingPosition}
          swapCanisterBalance0={detailPosition?.swapCanisterBalance0}
          swapCanisterBalance1={detailPosition?.swapCanisterBalance1}
          token0Fee={detailPosition?.token0Fee}
          token1Fee={detailPosition?.token1Fee}
          openSendLiquidityPositionModal={(position) => handleOpenSendLiquidityPositionFromDetail(position || detailPosition)}
      />
      
      <SendLiquidityPositionModal
          show={showSendLiquidityPositionModal}
          onClose={() => {
              setShowSendLiquidityPositionModal(false);
              setSelectedLiquidityPosition(null);
          }}
          onSend={handleSendLiquidityPosition}
          liquidityPosition={selectedLiquidityPosition}
      />
      
      {/* Dapp Detail Modal */}
      <DappCardModal
          show={showDappDetailModal}
          onClose={() => {
              setShowDappDetailModal(false);
              setDetailDapp(null);
          }}
          canisterId={detailDapp?.canisterId}
          cycles={detailDapp?.cycles}
          memory={detailDapp?.memory}
          isController={detailDapp?.isController}
          isNeuronManager={detailDapp?.isNeuronManager}
          isTradingBot={detailDapp?.isTradingBot || false}
          appId={detailDapp?.appId || ''}
          neuronManagerVersion={detailDapp?.neuronManagerVersion}
          neuronCount={detailDapp?.neuronCount}
          handleRefresh={handleRefreshDapp}
          isRefreshing={isRefreshingDapp}
          choreStatuses={detailDapp?.canisterId ? (managerChoreStatuses[detailDapp.canisterId] || []) : []}
          onChoreAction={handleChoreAction}
          handleSend={(canisterId) => handleSendCanister(canisterId, detailDapp?.isNeuronManager)}
      />
      
      <TransferCanisterModal
          show={showTransferCanisterModal}
          onClose={() => {
              setShowTransferCanisterModal(false);
              setTransferCanisterId(null);
          }}
          canisterId={transferCanisterId}
          identity={identity}
          onTransferComplete={handleTransferCanisterComplete}
          isNeuronManager={transferIsNeuronManager}
      />
      
      {/* Debug Report Modal (Admin only) */}
      {showDebugReportModal && (
          <div style={{
              position: 'fixed',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              backgroundColor: 'rgba(0,0,0,0.7)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              zIndex: 10001,
              padding: '20px'
          }} onClick={() => setShowDebugReportModal(false)}>
              <div style={{
                  background: theme.colors.primaryBg,
                  borderRadius: '12px',
                  padding: '20px',
                  maxWidth: '800px',
                  maxHeight: '80vh',
                  width: '100%',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '12px'
              }} onClick={(e) => e.stopPropagation()}>
                  <div style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      borderBottom: `1px solid ${theme.colors.border}`,
                      paddingBottom: '12px'
                  }}>
                      <h3 style={{ 
                          margin: 0, 
                          color: theme.colors.primaryText,
                          display: 'flex',
                          alignItems: 'center',
                          gap: '8px',
                          fontSize: '1rem'
                      }}>
                          <FaBug /> Quick Wallet Debug Report
                      </h3>
                      <div style={{ display: 'flex', gap: '8px' }}>
                          <button
                              onClick={() => {
                                  navigator.clipboard.writeText(generateQuickWalletDebugReport());
                                  setDebugReportCopied(true);
                                  setTimeout(() => setDebugReportCopied(false), 2000);
                              }}
                              style={{
                                  background: debugReportCopied ? '#10b981' : theme.colors.accent,
                                  color: 'white',
                                  border: 'none',
                                  borderRadius: '6px',
                                  padding: '8px 12px',
                                  cursor: 'pointer',
                                  display: 'flex',
                                  alignItems: 'center',
                                  gap: '6px',
                                  fontSize: '0.85rem'
                              }}
                          >
                              {debugReportCopied ? <FaCheck /> : <FaCopy />}
                              {debugReportCopied ? 'Copied!' : 'Copy'}
                          </button>
                          <button
                              onClick={() => setShowDebugReportModal(false)}
                              style={{
                                  background: 'transparent',
                                  border: `1px solid ${theme.colors.border}`,
                                  borderRadius: '6px',
                                  padding: '8px 12px',
                                  cursor: 'pointer',
                                  color: theme.colors.primaryText,
                                  display: 'flex',
                                  alignItems: 'center',
                                  gap: '6px',
                                  fontSize: '0.85rem'
                              }}
                          >
                              <FaTimes /> Close
                          </button>
                      </div>
                  </div>
                  <pre style={{
                      flex: 1,
                      overflow: 'auto',
                      background: theme.colors.secondaryBg,
                      padding: '12px',
                      borderRadius: '6px',
                      fontSize: '0.7rem',
                      fontFamily: 'monospace',
                      color: theme.colors.primaryText,
                      whiteSpace: 'pre-wrap',
                      margin: 0
                  }}>
                      {generateQuickWalletDebugReport()}
                  </pre>
              </div>
          </div>
      )}

      {/* Upgrade Bots Dialog (from quick wallet) */}
      <UpgradeBotsDialog
          isOpen={upgradeDialogOpen}
          onClose={() => setUpgradeDialogOpen(false)}
          outdatedManagers={outdatedManagers}
          latestVersion={latestOfficialVersion}
          onUpgradeComplete={() => {
              window.dispatchEvent(new Event('neuronManagersRefresh'));
          }}
      />

      {/* Top Up Cycles Dialog (from quick wallet) */}
      <TopUpCyclesDialog
          isOpen={topUpDialogOpen}
          onClose={() => setTopUpDialogOpen(false)}
          lowCyclesCanisters={lowCyclesCanisters}
          onTopUpComplete={() => {
              window.dispatchEvent(new Event('neuronManagersRefresh'));
          }}
      />
  </>
  );
}

export default PrincipalBox;