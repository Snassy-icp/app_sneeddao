/**
 * BotManagementPanel — Reusable bot management component.
 *
 * Provides the shared "Bot" collapsible section with tabs: Info, Botkeys, Chores, Log.
 * Each bot page (ICP Staking Bot, Trading Bot, etc.) uses this and passes a render prop
 * for its custom per-chore configuration UI.
 *
 * Props:
 *   canisterId         – Principal string of the bot canister
 *   createBotActor     – (canisterId, { agent }) => actor — actor creation function
 *   accentColor        – Primary theme color (e.g., '#8b5cf6')
 *   accentColorSecondary – Secondary accent (optional, default derived)
 *   botName            – Display name (e.g., "ICP Staking Bot")
 *   botIcon            – React node for the icon (optional, default <FaRobot />)
 *   appId              – App ID for factory version lookups (optional)
 *   permissionLabels   – { key: label } map (optional overrides)
 *   permissionDescriptions – { key: description } map (optional overrides)
 *   multiInstanceChoreTypes – string[] of chore types supporting multi-instance
 *   renderChoreConfig  – (props) => ReactNode — custom per-chore configuration
 *       props: { chore, config, choreId, choreTypeId, instanceId, getReadyBotActor,
 *                savingChore, setSavingChore, choreError, setChoreError, choreSuccess, setChoreSuccess,
 *                loadChoreData, theme, accentColor, cardStyle, inputStyle, buttonStyle, secondaryButtonStyle }
 *   identity           – Current user identity (from useAuth)
 *   isAuthenticated    – Boolean
 */
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { HttpAgent, Actor } from '@dfinity/agent';
import { Principal } from '@dfinity/principal';
import { createActor as createFactoryActor, canisterId as factoryCanisterId } from 'declarations/sneedapp';
import { createActor as createLedgerActor } from 'external/icrc1_ledger';
import { createActor as createCmcActor, CMC_CANISTER_ID } from 'external/cmc';
import { useTheme } from '../contexts/ThemeContext';
import { useNaming } from '../NamingContext';
import { PrincipalDisplay, getPrincipalDisplayInfoFromContext } from '../utils/PrincipalUtils';
import PrincipalInput from './PrincipalInput';
import TokenSelector from './TokenSelector';
import { getNeuronManagerSettings, getCyclesColor } from '../utils/NeuronManagerSettings';
import { FaRobot, FaChevronUp, FaChevronDown, FaShieldAlt, FaGasPump, FaTrash } from 'react-icons/fa';
import TokenIcon from './TokenIcon';
import { getTokenMetadataSync, fetchAndCacheTokenMetadata } from '../hooks/useTokenCache';
import StatusLamp, {
    LAMP_OFF, LAMP_OK, LAMP_ACTIVE, LAMP_WARN, LAMP_ERROR, LAMP_CB,
    LAMP_COLORS, LAMP_LABELS, CHORE_DEADLINES,
    getSchedulerLampState, getConductorLampState, getTaskLampState,
    summarizeLampStates, getChoreSummaryLamp, getAllChoresSummaryLamp, getSummaryLabel
} from './ChoreStatusLamp';

// Management canister IDL (for cycles/controllers/module hash)
const managementCanisterIdlFactory = ({ IDL }) => {
    const definite_canister_settings = IDL.Record({
        'controllers': IDL.Vec(IDL.Principal),
        'freezing_threshold': IDL.Nat,
        'memory_allocation': IDL.Nat,
        'compute_allocation': IDL.Nat,
        'reserved_cycles_limit': IDL.Nat,
        'log_visibility': IDL.Variant({ 'controllers': IDL.Null, 'public': IDL.Null }),
        'wasm_memory_limit': IDL.Nat,
    });
    const canister_status_result = IDL.Record({
        'status': IDL.Variant({ 'running': IDL.Null, 'stopping': IDL.Null, 'stopped': IDL.Null }),
        'settings': definite_canister_settings,
        'module_hash': IDL.Opt(IDL.Vec(IDL.Nat8)),
        'memory_size': IDL.Nat,
        'cycles': IDL.Nat,
        'idle_cycles_burned_per_day': IDL.Nat,
        'query_stats': IDL.Record({
            'num_calls_total': IDL.Nat, 'num_instructions_total': IDL.Nat,
            'request_payload_bytes_total': IDL.Nat, 'response_payload_bytes_total': IDL.Nat,
        }),
        'reserved_cycles': IDL.Nat,
    });
    const canister_settings = IDL.Record({
        'controllers': IDL.Opt(IDL.Vec(IDL.Principal)),
        'compute_allocation': IDL.Opt(IDL.Nat),
        'memory_allocation': IDL.Opt(IDL.Nat),
        'freezing_threshold': IDL.Opt(IDL.Nat),
        'reserved_cycles_limit': IDL.Opt(IDL.Nat),
        'log_visibility': IDL.Opt(IDL.Variant({ 'controllers': IDL.Null, 'public': IDL.Null })),
        'wasm_memory_limit': IDL.Opt(IDL.Nat),
    });
    const install_code_mode = IDL.Variant({ 'install': IDL.Null, 'reinstall': IDL.Null, 'upgrade': IDL.Null });
    return IDL.Service({
        'canister_status': IDL.Func([IDL.Record({ 'canister_id': IDL.Principal })], [canister_status_result], []),
        'update_settings': IDL.Func([IDL.Record({ 'canister_id': IDL.Principal, 'settings': canister_settings })], [], []),
        'install_code': IDL.Func([IDL.Record({
            'mode': install_code_mode, 'canister_id': IDL.Principal,
            'wasm_module': IDL.Vec(IDL.Nat8), 'arg': IDL.Vec(IDL.Nat8),
        })], [], []),
    });
};

const MANAGEMENT_CANISTER_ID = Principal.fromText('aaaaa-aa');

function uint8ArrayToHex(arr) {
    return Array.from(arr).map(b => b.toString(16).padStart(2, '0')).join('');
}

function formatCycles(cycles) {
    const n = Number(cycles);
    if (n >= 1e12) return `${(n / 1e12).toFixed(2)}T`;
    if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
    if (n >= 1e6) return `${(n / 1e6).toFixed(0)}M`;
    return n.toLocaleString();
}

const ICP_LEDGER_CANISTER_ID = 'ryjl3-tyaaa-aaaaa-aaaba-cai';
const E8S = 100_000_000;
const ICP_FEE = 10_000; // 0.0001 ICP
const TOP_UP_MEMO = new Uint8Array([0x54, 0x50, 0x55, 0x50, 0x00, 0x00, 0x00, 0x00]);

function formatIcp(e8s) {
    if (e8s === null || e8s === undefined) return '...';
    const icp = e8s / E8S;
    if (icp >= 1000) return icp.toFixed(2);
    if (icp >= 1) return icp.toFixed(4);
    return icp.toFixed(8);
}

function principalToSubaccount(principal) {
    const bytes = principal.toUint8Array();
    const subaccount = new Uint8Array(32);
    subaccount[0] = bytes.length;
    subaccount.set(bytes, 1);
    return subaccount;
}

// ============================================
// LOG ENTRY ENHANCEMENT — token icons, formatted amounts, DEX names
// ============================================

const DEX_NAMES = { '0': 'ICPSwap', '1': 'KongSwap' };

/** Shorten a principal for fallback display. */
const shortPrincipal = (p) => {
    const s = String(p);
    return s.length > 20 ? s.slice(0, 8) + '…' + s.slice(-6) : s;
};

/** Format a raw amount (e8s etc.) to human-readable token units. */
const formatLogAmount = (raw, decimals = 8) => {
    const n = Number(raw);
    if (isNaN(n) || n === 0) return String(raw);
    const val = n / Math.pow(10, decimals);
    // Use up to 6 decimal places, but at least enough to show a non-zero value
    const maxFrac = Math.min(decimals, 8);
    return val.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: maxFrac });
};

/** Known tag keys whose values are token principal IDs. */
const TOKEN_TAG_KEYS = new Set(['inputToken', 'outputToken', 'token', 'ledger', 'ledgerId', 'tokenId', 'sellTokenId', 'buyTokenId', 'denomToken']);
/** Known tag keys whose values are raw token amounts. */
const AMOUNT_TAG_KEYS = new Set([
    'inputAmount', 'outputAmount', 'amount', 'fee', 'balance',
    // Rebalancer sell-side amounts (in sell token native units)
    'tradeSize', 'tradeSizeUnits', 'sellBalance', 'overshootCap', 'targetReachUnits',
    'effectiveTargetReach', 'maxAffordable', 'balanceDiv4', 'maxTradeUnits', 'minTradeUnits', 'resultTradeSize',
    // Rebalancer buy-side amounts
    'buyBalance', 'expectedOutput',
    // Denomination-valued amounts (default 8 decimals / ICP)
    'sellValue', 'buyValue', 'excessSellValue', 'deficitBuyValue', 'capDenomValue', 'totalValue',
    'tradeSizeDenom', 'maxTradeDenom', 'minTradeDenom',
    // Quote fields
    'cachedInputAmount', 'cachedExpectedOutput',
    // Price: spotPriceE8s uses input token decimals
    'spotPriceE8s',
]);
/** Map amount tag to its paired token tag to determine decimals. */
const AMOUNT_TO_TOKEN = {
    inputAmount: 'inputToken', outputAmount: 'outputToken', amount: 'token', fee: 'inputToken', balance: 'token',
    // Rebalancer sell-side → sellTokenId
    tradeSize: 'sellTokenId', tradeSizeUnits: 'sellTokenId', sellBalance: 'sellTokenId',
    overshootCap: 'sellTokenId', targetReachUnits: 'sellTokenId', effectiveTargetReach: 'sellTokenId',
    maxAffordable: 'sellTokenId', balanceDiv4: 'sellTokenId', maxTradeUnits: 'sellTokenId',
    minTradeUnits: 'sellTokenId', resultTradeSize: 'sellTokenId',
    // Rebalancer buy-side → buyTokenId
    buyBalance: 'buyTokenId', expectedOutput: 'buyTokenId',
    // Denomination-valued amounts → denomToken (fallback to 8 decimals)
    sellValue: 'denomToken', buyValue: 'denomToken',
    excessSellValue: 'denomToken', deficitBuyValue: 'denomToken', capDenomValue: 'denomToken', totalValue: 'denomToken',
    tradeSizeDenom: 'denomToken', maxTradeDenom: 'denomToken', minTradeDenom: 'denomToken',
    // Quote fields
    cachedInputAmount: 'inputToken', cachedExpectedOutput: 'outputToken',
    // spotPriceE8s uses input token decimals (price = humanPricePerToken * 10^tokenDecimals)
    spotPriceE8s: 'inputToken',
};
/** Tag keys whose values are in basis points — display as %. */
const BPS_TAG_KEYS = new Set([
    'priceImpactBps', 'maxImpactBps', 'maxSlippageBps', 'slippageBps',
    'sellDeviationBps', 'buyDeviationBps', 'combinedDeviationBps',
    'currentBps', 'targetBps', 'thresholdBps', 'deviationBps',
]);
/** Format bps value as percentage string. */
const formatBps = (v) => {
    const n = Number(v);
    if (isNaN(n)) return String(v);
    return (n / 100).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 }) + '%';
};

export default function BotManagementPanel({
    canisterId,
    createBotActor,
    accentColor = '#8b5cf6',
    accentColorSecondary,
    botName = 'Bot',
    botIcon,
    appId,
    permissionLabels: permLabelsProp = {},
    permissionDescriptions: permDescsProp = {},
    multiInstanceChoreTypes = [],
    renderChoreConfig,
    identity,
    isAuthenticated,
    extraInfoContent,
    cbEvents,
    preferredChoreTypeOrder,
}) {
    const { theme } = useTheme();
    const { principalNames, principalNicknames } = useNaming();
    const accent = accentColor;
    const accentSec = accentColorSecondary || accent;
    const cycleSettings = getNeuronManagerSettings();

    // ==========================================
    // STATE
    // ==========================================
    const [expanded, setExpanded] = useState(true);
    const [activeTab, setActiveTab] = useState('info');

    // Canister status
    const [canisterStatus, setCanisterStatus] = useState(null);
    const [controllers, setControllers] = useState([]);
    const [botVersion, setBotVersion] = useState('');

    // Official versions (from factory)
    const [officialVersions, setOfficialVersions] = useState([]);

    // Controller management
    const [newControllerInput, setNewControllerInput] = useState('');
    const [updatingControllers, setUpdatingControllers] = useState(false);
    const [confirmRemoveController, setConfirmRemoveController] = useState(null);
    const [controllerError, setControllerError] = useState('');

    // Upgrade
    const [upgrading, setUpgrading] = useState(false);
    const [upgradeMode, setUpgradeMode] = useState('');
    const [upgradeError, setUpgradeError] = useState('');
    const [upgradeSuccess, setUpgradeSuccess] = useState('');

    // Botkey permissions
    const [botkeysSupported, setBotkeysSupported] = useState(null);
    const [hotkeyPrincipals, setHotkeyPrincipals] = useState([]);
    const [permissionTypes, setPermissionTypes] = useState([]);
    const [loadingPermissions, setLoadingPermissions] = useState(false);
    const [permissionError, setPermissionError] = useState('');
    const [permissionSuccess, setPermissionSuccess] = useState('');
    const [savingPermissions, setSavingPermissions] = useState(false);
    const [newHotkeyPrincipal, setNewHotkeyPrincipal] = useState('');
    const [newHotkeyPermissions, setNewHotkeyPermissions] = useState({});
    const [editingPrincipal, setEditingPrincipal] = useState(null);
    const [editPermissions, setEditPermissions] = useState({});
    const [confirmRemoveHotkey, setConfirmRemoveHotkey] = useState(null);

    // User permissions
    const [userPermissions, setUserPermissions] = useState(null);

    // Chores
    const [choreStatuses, setChoreStatuses] = useState([]);
    const [choreConfigs, setChoreConfigs] = useState([]);
    const [choreTypes, setChoreTypes] = useState([]);
    const [loadingChores, setLoadingChores] = useState(false);
    const [choreError, setChoreError] = useState('');
    const [choreSuccess, setChoreSuccess] = useState('');
    const [savingChore, setSavingChore] = useState(false);
    const [choreActiveTab, setChoreActiveTab] = useState(null);
    const [choreActiveInstance, setChoreActiveInstance] = useState(null);
    const [choreTickNow, setChoreTickNow] = useState(Date.now());
    const choreTickRef = useRef(null);
    const [creatingInstance, setCreatingInstance] = useState(false);
    const [newInstanceLabel, setNewInstanceLabel] = useState('');
    const [renamingInstance, setRenamingInstance] = useState(null);
    const [renameLabel, setRenameLabel] = useState('');
    const [confirmingDelete, setConfirmingDelete] = useState(null); // choreId awaiting delete confirmation
    const chorePollingRef = useRef(null); // Interval ID for post-action status polling

    // Log
    const [logEntries, setLogEntries] = useState([]);
    const [logConfig, setLogConfig] = useState(null);
    const [loadingLogs, setLoadingLogs] = useState(false);
    const [logError, setLogError] = useState('');
    const [logSuccess, setLogSuccess] = useState('');
    const [logFilter, setLogFilter] = useState({
        minLevel: [], source: [], caller: [], fromTime: [], toTime: [], startId: [], limit: [50n],
    });
    const [logHasMore, setLogHasMore] = useState(false);
    const [logTotalMatching, setLogTotalMatching] = useState(0);
    const [savingLogConfig, setSavingLogConfig] = useState(false);
    const [logAutoRefresh, setLogAutoRefresh] = useState(false);
    const logAutoRefreshRef = useRef(null);
    const [logTokenMeta, setLogTokenMeta] = useState({}); // principal → { symbol, decimals, ... }
    const logTokenFetchedRef = useRef(new Set()); // Track already-fetched principals

    // Unseen log alerts
    const [logAlertSummary, setLogAlertSummary] = useState(null); // { unseenErrorCount, unseenWarningCount, highestErrorId, highestWarningId, nextId }
    const [markingLogsSeen, setMarkingLogsSeen] = useState(false);

    // Cycles top-up
    const [topUpAmount, setTopUpAmount] = useState('');
    const [conversionRate, setConversionRate] = useState(null);
    const [showTopUpSection, setShowTopUpSection] = useState(false);
    const [toppingUp, setToppingUp] = useState(false);
    const [topUpSuccessDialog, setTopUpSuccessDialog] = useState(null);
    const [userIcpBalance, setUserIcpBalance] = useState(null);
    const [topUpError, setTopUpError] = useState('');

    // Withdraw tokens
    const [withdrawAmount, setWithdrawAmount] = useState('');
    const [withdrawDestination, setWithdrawDestination] = useState('');
    const [withdrawTokenLedger, setWithdrawTokenLedger] = useState('ryjl3-tyaaa-aaaaa-aaaba-cai');
    const [withdrawTokenBalance, setWithdrawTokenBalance] = useState(null);
    const [withdrawTokenSymbol, setWithdrawTokenSymbol] = useState('ICP');
    const [withdrawTokenDecimals, setWithdrawTokenDecimals] = useState(8);
    const [withdrawTokenFee, setWithdrawTokenFee] = useState(10000);
    const [customLedgerInput, setCustomLedgerInput] = useState('');
    const [useCustomLedger, setUseCustomLedger] = useState(false);
    const [withdrawSectionExpanded, setWithdrawSectionExpanded] = useState(false);
    const [withdrawing, setWithdrawing] = useState(false);
    const [withdrawError, setWithdrawError] = useState('');
    const [withdrawSuccess, setWithdrawSuccess] = useState('');

    // ==========================================
    // HELPERS
    // ==========================================
    const getAgent = useCallback(() => {
        const host = process.env.DFX_NETWORK === 'ic' || process.env.DFX_NETWORK === 'staging'
            ? 'https://icp0.io' : 'http://localhost:4943';
        return new HttpAgent({ identity, host });
    }, [identity]);

    // Create a ready-to-use bot actor (with root key fetched for local dev)
    const getReadyBotActor = useCallback(async () => {
        if (!canisterId || !identity) return null;
        const agent = getAgent();
        if (process.env.DFX_NETWORK !== 'ic' && process.env.DFX_NETWORK !== 'staging') {
            await agent.fetchRootKey();
        }
        return createBotActor(canisterId, { agent });
    }, [canisterId, identity, createBotActor, getAgent]);

    const isController = identity && controllers.length > 0 &&
        controllers.some(c => c.toString() === identity.getPrincipal().toString());

    const hasPermission = useCallback((permKey) => {
        if (isController) return true;
        if (!userPermissions) return false;
        if (userPermissions.has('FullPermissions')) return true;
        return userPermissions.has(permKey);
    }, [isController, userPermissions]);

    const hasAnyPermission = isController || (userPermissions && userPermissions.size > 0);

    // Permission helpers
    const getPermissionKey = (perm) => Object.keys(perm)[0];
    const getPermissionLabel = (key) => permLabelsProp[key] || key.replace(/([A-Z])/g, ' $1').trim();
    const getPermissionDescription = (key) => permDescsProp[key] || '';

    // Can manage any chore?
    const canManageAnyChore = useCallback(() => {
        if (isController) return true;
        if (!userPermissions) return false;
        if (userPermissions.has('FullPermissions')) return true;
        // Check for any chore management permission
        for (const p of userPermissions) {
            if (p.startsWith('Manage') && (p.endsWith('Chore') || p.includes('Chore'))) return true;
        }
        return false;
    }, [isController, userPermissions]);

    // ==========================================
    // STYLES
    // ==========================================
    const cardStyle = {
        background: theme.colors.cardGradient,
        borderRadius: '12px',
        border: `1px solid ${theme.colors.border}`,
        padding: '16px',
        marginBottom: '12px',
        boxShadow: theme.colors.cardShadow,
    };
    const inputStyle = {
        width: '100%', padding: '0.5rem 0.75rem', borderRadius: '8px',
        border: `1px solid ${theme.colors.border}`,
        background: theme.colors.inputBg || theme.colors.secondaryBg,
        color: theme.colors.primaryText, fontSize: '0.9rem', outline: 'none',
        boxSizing: 'border-box',
    };
    const buttonStyle = {
        padding: '0.5rem 1.25rem', borderRadius: '8px',
        background: accent, color: '#fff', border: 'none',
        fontSize: '0.9rem', fontWeight: '600', cursor: 'pointer',
    };
    const secondaryButtonStyle = {
        padding: '0.5rem 1rem', borderRadius: '8px',
        background: 'transparent', color: theme.colors.primaryText,
        border: `1px solid ${theme.colors.border}`,
        fontSize: '0.85rem', cursor: 'pointer',
    };
    const tabStyle = (active) => ({
        padding: '0.5rem 1rem', borderRadius: '8px 8px 0 0', cursor: 'pointer',
        background: active ? theme.colors.secondaryBg : 'transparent',
        color: active ? accent : theme.colors.secondaryText,
        border: active ? `1px solid ${theme.colors.border}` : '1px solid transparent',
        borderBottom: active ? `2px solid ${accent}` : '2px solid transparent',
        fontWeight: active ? 600 : 400, fontSize: '0.85rem',
    });

    // ==========================================
    // DATA LOADING
    // ==========================================

    // Load canister status (cycles, memory, controllers, module hash)
    const loadCanisterStatus = useCallback(async () => {
        if (!canisterId || !identity) return;
        try {
            const agent = getAgent();
            if (process.env.DFX_NETWORK !== 'ic' && process.env.DFX_NETWORK !== 'staging') {
                await agent.fetchRootKey();
            }
            const mgmtActor = Actor.createActor(managementCanisterIdlFactory, {
                agent, canisterId: MANAGEMENT_CANISTER_ID,
                effectiveCanisterId: Principal.fromText(canisterId),
            });
            const result = await mgmtActor.canister_status({ canister_id: Principal.fromText(canisterId) });
            const statusKey = Object.keys(result.status)[0];
            const moduleHash = result.module_hash.length > 0 ? uint8ArrayToHex(result.module_hash[0]) : null;
            setCanisterStatus({
                status: statusKey, cycles: result.cycles, memorySize: Number(result.memory_size),
                moduleHash, idleCyclesBurned: result.idle_cycles_burned_per_day,
            });
            setControllers(result.settings.controllers);
        } catch (err) {
            // Non-controllers can't fetch status — that's OK
            console.warn('Could not fetch canister status:', err.message);
        }
    }, [canisterId, identity, getAgent]);

    // Load bot version
    const loadBotVersion = useCallback(async () => {
        if (!canisterId || !identity) return;
        try {
            const bot = await getReadyBotActor();
            if (!bot) return;
            const version = await bot.getVersion();
            setBotVersion(`${Number(version.major)}.${Number(version.minor)}.${Number(version.patch)}`);
        } catch {
            // Old bots may not have getVersion
        }
    }, [canisterId, identity, getReadyBotActor]);

    // Load official versions from factory (for version verification)
    const loadOfficialVersions = useCallback(async () => {
        if (!appId || !identity) return;
        try {
            const host = process.env.DFX_NETWORK === 'ic' || process.env.DFX_NETWORK === 'staging'
                ? 'https://icp0.io' : 'http://localhost:4943';
            const factory = createFactoryActor(factoryCanisterId, {
                agentOptions: { identity, host }
            });
            const versions = await factory.getAppVersions(appId);
            setOfficialVersions(versions);
        } catch { /* factory may not have this app */ }
    }, [appId, identity]);

    // Load user permissions
    const fetchUserPermissions = useCallback(async () => {
        if (!canisterId || !identity) return;
        try {
            const bot = await getReadyBotActor();
            if (!bot) return;
            const perms = await bot.callerPermissions();
            setUserPermissions(new Set(perms.map(p => Object.keys(p)[0])));
        } catch {
            setUserPermissions(new Set());
        }
    }, [canisterId, identity, getReadyBotActor]);

    // Load botkey permissions
    const loadHotkeyPermissions = useCallback(async () => {
        if (!canisterId || !identity) return;
        setLoadingPermissions(true);
        setPermissionError('');
        try {
            const bot = await getReadyBotActor();
            if (!bot) return;
            const [types, principals] = await Promise.all([
                bot.listPermissionTypes(),
                bot.listHotkeyPrincipals(),
            ]);
            setPermissionTypes(types);
            setHotkeyPrincipals(principals);
            setBotkeysSupported(true);
        } catch (err) {
            console.warn('loadHotkeyPermissions error:', err);
            if (err.message?.includes('has no query') || err.message?.includes('is not a function')) {
                setBotkeysSupported(false);
            } else {
                // Still mark as supported so the error message is visible in the UI
                setBotkeysSupported(true);
                setPermissionError('Failed to load permissions: ' + err.message);
            }
        } finally {
            setLoadingPermissions(false);
        }
    }, [canisterId, identity, getReadyBotActor]);

    // Load chore data
    const loadChoreData = useCallback(async (silent) => {
        if (!canisterId || !identity) return;
        if (!silent) { setLoadingChores(true); setChoreError(''); }
        try {
            const bot = await getReadyBotActor();
            if (!bot) return;
            const statuses = await bot.getChoreStatuses();
            // getChoreConfigs may not exist on all bot versions — gracefully fallback
            let configs = [];
            try {
                if (bot.getChoreConfigs) configs = await bot.getChoreConfigs();
            } catch { /* Method doesn't exist on this bot version — that's OK */ }
            // getChoreTypes may not exist on older bot versions — gracefully fallback
            let types = [];
            try {
                if (bot.getChoreTypes) types = await bot.getChoreTypes();
            } catch { /* Method doesn't exist on this bot version — that's OK */ }
            setChoreStatuses(statuses);
            setChoreConfigs(configs);
            setChoreTypes(types);
            // Set initial active tab — prefer types list, fallback to statuses
            if (!choreActiveTab) {
                if (types.length > 0) {
                    setChoreActiveTab(types[0].id);
                } else if (statuses.length > 0) {
                    setChoreActiveTab(statuses[0].choreTypeId || statuses[0].choreId);
                }
            }
        } catch (err) {
            if (!silent) setChoreError('Failed to load chore data: ' + err.message);
        } finally {
            if (!silent) setLoadingChores(false);
        }
    }, [canisterId, identity, getReadyBotActor, choreActiveTab]);

    /**
     * Start polling chore statuses after an action that triggers a run
     * (triggerChore, startChore, resumeChore, scheduleStartChore).
     * Polls every 2 seconds. Stops automatically after 120s or when
     * no conductor/task is running.
     */
    const startChorePolling = useCallback(() => {
        // Clear any existing polling
        if (chorePollingRef.current) clearInterval(chorePollingRef.current);
        let elapsed = 0;
        const POLL_INTERVAL = 2000;
        const MAX_POLL = 600_000; // 10 minutes — long enough for multi-step chore pipelines
        chorePollingRef.current = setInterval(async () => {
            elapsed += POLL_INTERVAL;
            if (elapsed > MAX_POLL) {
                clearInterval(chorePollingRef.current);
                chorePollingRef.current = null;
                return;
            }
            try {
                const bot = await getReadyBotActor();
                if (!bot) return;
                const statuses = await bot.getChoreStatuses();
                setChoreStatuses(statuses);
                // Stop polling when no chore is actively running
                const anyActive = statuses.some(s => {
                    const cond = s.conductorStatus && Object.keys(s.conductorStatus)[0];
                    const task = s.taskStatus && Object.keys(s.taskStatus)[0];
                    return cond === 'Running' || cond === 'Polling' || task === 'Running';
                });
                if (!anyActive && elapsed >= POLL_INTERVAL * 2) {
                    // Give it at least 2 polls before stopping (to catch the transition)
                    clearInterval(chorePollingRef.current);
                    chorePollingRef.current = null;
                }
            } catch { /* Silently ignore polling errors */ }
        }, POLL_INTERVAL);
    }, [getReadyBotActor]);

    // Cleanup polling on unmount
    useEffect(() => {
        return () => {
            if (chorePollingRef.current) clearInterval(chorePollingRef.current);
        };
    }, []);

    // Load log data
    const loadLogData = useCallback(async (filterOverride, silent) => {
        if (!canisterId || !identity) return;
        if (!silent) setLoadingLogs(true);
        setLogError('');
        try {
            const bot = await getReadyBotActor();
            if (!bot) return;
            const f = filterOverride || logFilter;
            const [result, config] = await Promise.all([
                bot.getLogs(f),
                bot.getLogConfig(),
            ]);
            setLogEntries(result.entries);
            setLogHasMore(result.hasMore);
            setLogTotalMatching(Number(result.totalMatching));
            setLogConfig(config);
        } catch (err) {
            if (!silent) setLogError('Failed to load logs: ' + err.message);
        } finally {
            if (!silent) setLoadingLogs(false);
        }
    }, [canisterId, identity, getReadyBotActor, logFilter]);

    // Fetch unseen log alert summary
    const refreshLogAlertSummary = useCallback(async () => {
        if (!canisterId || !identity) return;
        try {
            const bot = await getReadyBotActor();
            if (!bot?.getLogAlertSummary) return;
            // Merge localStorage and backend-stored lastSeen (use the higher)
            const lsKey = `lastSeenLogId:${canisterId}`;
            const localSeen = parseInt(localStorage.getItem(lsKey) || '0', 10);
            let backendSeen = 0;
            try {
                const host = process.env.DFX_NETWORK === 'ic' || process.env.DFX_NETWORK === 'staging'
                    ? 'https://ic0.app' : 'http://localhost:4943';
                const { createActor: createBackendActor, canisterId: backendCanisterId } = await import('declarations/app_sneeddao_backend');
                const backendActor = createBackendActor(backendCanisterId, { agentOptions: { identity, host } });
                backendSeen = Number(await backendActor.get_last_seen_log_id(Principal.fromText(canisterId)));
            } catch (_) {}
            const lastSeen = Math.max(localSeen, backendSeen);
            if (backendSeen > localSeen) localStorage.setItem(lsKey, String(backendSeen));
            const summary = await bot.getLogAlertSummary(BigInt(lastSeen));
            setLogAlertSummary({
                unseenErrorCount: Number(summary.unseenErrorCount),
                unseenWarningCount: Number(summary.unseenWarningCount),
                highestErrorId: Number(summary.highestErrorId),
                highestWarningId: Number(summary.highestWarningId),
                nextId: Number(summary.nextId),
            });
        } catch (_) { /* Bot may not support this yet */ }
    }, [canisterId, identity, getReadyBotActor]);

    // Mark logs as seen for this bot
    const handleMarkLogsSeen = useCallback(async () => {
        if (!logAlertSummary || !canisterId) return;
        setMarkingLogsSeen(true);
        const highestId = Math.max(logAlertSummary.highestErrorId, logAlertSummary.highestWarningId, logAlertSummary.nextId - 1);
        const lsKey = `lastSeenLogId:${canisterId}`;
        localStorage.setItem(lsKey, String(highestId));
        try {
            const host = process.env.DFX_NETWORK === 'ic' || process.env.DFX_NETWORK === 'staging'
                ? 'https://ic0.app' : 'http://localhost:4943';
            const { createActor: createBackendActor, canisterId: backendCanisterId } = await import('declarations/app_sneeddao_backend');
            const backendActor = createBackendActor(backendCanisterId, { agentOptions: { identity, host } });
            await backendActor.mark_logs_seen(Principal.fromText(canisterId), BigInt(highestId));
        } catch (_) {}
        setLogAlertSummary(null);
        setMarkingLogsSeen(false);
    }, [logAlertSummary, canisterId, identity]);

    // Refresh alert summary when log tab is active
    useEffect(() => {
        if (activeTab === 'log') refreshLogAlertSummary();
    }, [activeTab, refreshLogAlertSummary]);

    // Fetch ICP to cycles conversion rate from CMC
    const fetchConversionRate = useCallback(async () => {
        try {
            const host = 'https://ic0.app';
            const agent = HttpAgent.createSync({ host });
            const cmc = createCmcActor(CMC_CANISTER_ID, { agent });
            const response = await cmc.get_icp_xdr_conversion_rate();
            const xdrPerIcp = Number(response.data.xdr_permyriad_per_icp) / 10000;
            const cyclesPerIcp = xdrPerIcp * 1_000_000_000_000;
            setConversionRate({ xdrPerIcp, cyclesPerIcp, timestamp: Number(response.data.timestamp_seconds) });
        } catch (err) {
            console.error('Error fetching conversion rate:', err);
        }
    }, []);

    // Fetch user ICP balance
    const fetchUserBalance = useCallback(async (agentOverride) => {
        if (!identity) return;
        try {
            const agent = agentOverride || getAgent();
            if (!agentOverride && process.env.DFX_NETWORK !== 'ic' && process.env.DFX_NETWORK !== 'staging') {
                await agent.fetchRootKey();
            }
            const ledger = createLedgerActor(ICP_LEDGER_CANISTER_ID, { agent });
            const balance = await ledger.icrc1_balance_of({
                owner: identity.getPrincipal(),
                subaccount: [],
            });
            setUserIcpBalance(Number(balance));
        } catch (err) {
            console.error('Error fetching user ICP balance:', err);
        }
    }, [identity, getAgent]);

    // Fetch token balance for withdraw section
    const fetchWithdrawTokenBalance = useCallback(async (ledgerId) => {
        if (!ledgerId || !canisterId) return;
        try {
            const ledgerActor = createLedgerActor(ledgerId, { agentOptions: { identity } });
            const [balance, symbol, decimals, fee] = await Promise.all([
                ledgerActor.icrc1_balance_of({ owner: Principal.fromText(canisterId), subaccount: [] }),
                ledgerActor.icrc1_symbol(),
                ledgerActor.icrc1_decimals(),
                ledgerActor.icrc1_fee(),
            ]);
            setWithdrawTokenBalance(balance);
            setWithdrawTokenSymbol(symbol);
            setWithdrawTokenDecimals(decimals);
            setWithdrawTokenFee(Number(fee));
        } catch (err) {
            console.error('Error fetching token balance:', err);
            setWithdrawTokenBalance(null);
            setWithdrawTokenSymbol('Unknown');
            setWithdrawTokenDecimals(8);
            setWithdrawTokenFee(0);
        }
    }, [canisterId, identity]);

    // ==========================================
    // EFFECTS
    // ==========================================
    useEffect(() => {
        if (isAuthenticated && identity && canisterId) {
            loadCanisterStatus();
            loadBotVersion();
            loadOfficialVersions();
            fetchUserPermissions();
            fetchConversionRate();
            fetchUserBalance();
            loadChoreData();
        }
    }, [isAuthenticated, identity, canisterId, loadCanisterStatus, loadBotVersion, loadOfficialVersions, fetchUserPermissions, fetchConversionRate, fetchUserBalance, loadChoreData]);

    useEffect(() => {
        if (activeTab === 'permissions' && expanded) loadHotkeyPermissions();
    }, [activeTab, expanded, loadHotkeyPermissions]);

    useEffect(() => {
        if (activeTab === 'chores' && expanded) loadChoreData();
    }, [activeTab, expanded, loadChoreData]);

    useEffect(() => {
        if (activeTab === 'log' && expanded) loadLogData();
    }, [activeTab, expanded, loadLogData]);

    // Log auto-refresh
    useEffect(() => {
        if (logAutoRefreshRef.current) { clearInterval(logAutoRefreshRef.current); logAutoRefreshRef.current = null; }
        if (logAutoRefresh && activeTab === 'log') {
            logAutoRefreshRef.current = setInterval(() => loadLogData(undefined, true), 5000);
        }
        return () => { if (logAutoRefreshRef.current) clearInterval(logAutoRefreshRef.current); };
    }, [logAutoRefresh, activeTab, loadLogData]);

    // Auto-fetch token metadata for principals appearing in log entry tags
    useEffect(() => {
        if (activeTab !== 'log' || logEntries.length === 0) return;
        const principals = new Set();
        for (const entry of logEntries) {
            for (const [k, v] of entry.tags) {
                if (TOKEN_TAG_KEYS.has(k) && v && v.length > 10) principals.add(v);
            }
        }
        if (principals.size === 0) return;
        // Only fetch principals we haven't already fetched
        const toFetch = [...principals].filter(p => !logTokenFetchedRef.current.has(p));
        if (toFetch.length === 0) {
            // Still populate state from sync cache for any we know about
            const updates = {};
            for (const p of principals) {
                if (!logTokenMeta[p]) {
                    const cached = getTokenMetadataSync(p);
                    if (cached) updates[p] = cached;
                }
            }
            if (Object.keys(updates).length > 0) setLogTokenMeta(prev => ({ ...prev, ...updates }));
            return;
        }
        for (const p of toFetch) logTokenFetchedRef.current.add(p);
        (async () => {
            const results = {};
            await Promise.all(toFetch.map(async (p) => {
                try {
                    const meta = getTokenMetadataSync(p) || await fetchAndCacheTokenMetadata(p, identity);
                    if (meta) results[p] = meta;
                } catch { /* ignore */ }
            }));
            if (Object.keys(results).length > 0) setLogTokenMeta(prev => ({ ...prev, ...results }));
        })();
    }, [activeTab, logEntries, identity]); // eslint-disable-line react-hooks/exhaustive-deps

    // Chore tick for imminent countdowns + auto-refresh statuses while running
    const choreRunningRefreshRef = useRef(null);
    useEffect(() => {
        const IMMINENT_MS = 5 * 60 * 1000;
        const now = Date.now();
        const anyImminent = choreStatuses.some(c => {
            if (!c.enabled || !c.nextScheduledRunAt?.length) return false;
            const ms = Number(c.nextScheduledRunAt[0]) / 1_000_000;
            return (ms - now) > 0 && (ms - now) < IMMINENT_MS;
        });
        const anyRunning = choreStatuses.some(c => c.enabled && !('Idle' in c.conductorStatus));
        if (anyImminent || anyRunning) {
            if (!choreTickRef.current) choreTickRef.current = setInterval(() => setChoreTickNow(Date.now()), 1000);
        } else {
            if (choreTickRef.current) { clearInterval(choreTickRef.current); choreTickRef.current = null; }
        }
        // Auto-refresh statuses every 3s while any chore is actively running (no timeout limit)
        if (anyRunning) {
            if (!choreRunningRefreshRef.current) {
                choreRunningRefreshRef.current = setInterval(async () => {
                    try {
                        const bot = await getReadyBotActor();
                        if (bot) {
                            const statuses = await bot.getChoreStatuses();
                            setChoreStatuses(statuses);
                        }
                    } catch { /* Silently ignore */ }
                }, 3000);
            }
        } else {
            if (choreRunningRefreshRef.current) { clearInterval(choreRunningRefreshRef.current); choreRunningRefreshRef.current = null; }
        }
        return () => {
            if (choreTickRef.current) { clearInterval(choreTickRef.current); choreTickRef.current = null; }
            if (choreRunningRefreshRef.current) { clearInterval(choreRunningRefreshRef.current); choreRunningRefreshRef.current = null; }
        };
    }, [choreStatuses, getReadyBotActor]);

    // Fetch token balance when selected token changes (only when withdraw section expanded)
    useEffect(() => {
        if (!withdrawSectionExpanded) return;
        const ledgerId = useCustomLedger ? customLedgerInput : withdrawTokenLedger;
        if (ledgerId) fetchWithdrawTokenBalance(ledgerId);
    }, [withdrawTokenLedger, customLedgerInput, useCustomLedger, fetchWithdrawTokenBalance, withdrawSectionExpanded]);

    // ==========================================
    // VERSION MATCHING
    // ==========================================
    const matchedOfficialVersion = canisterStatus?.moduleHash && officialVersions.length > 0
        ? officialVersions.find(v => v.wasmHash === canisterStatus.moduleHash)
        : null;
    const latestOfficialVersion = officialVersions.length > 0
        ? officialVersions.reduce((best, v) => {
            if (!best) return v;
            if (Number(v.major) > Number(best.major)) return v;
            if (Number(v.major) === Number(best.major) && Number(v.minor) > Number(best.minor)) return v;
            if (Number(v.major) === Number(best.major) && Number(v.minor) === Number(best.minor) && Number(v.patch) > Number(best.patch)) return v;
            return best;
        }, null) : null;
    const nextAvailableVersion = matchedOfficialVersion && latestOfficialVersion
        && (Number(latestOfficialVersion.major) > Number(matchedOfficialVersion.major)
            || (Number(latestOfficialVersion.major) === Number(matchedOfficialVersion.major) && Number(latestOfficialVersion.minor) > Number(matchedOfficialVersion.minor))
            || (Number(latestOfficialVersion.major) === Number(matchedOfficialVersion.major) && Number(latestOfficialVersion.minor) === Number(matchedOfficialVersion.minor) && Number(latestOfficialVersion.patch) > Number(matchedOfficialVersion.patch)))
        ? latestOfficialVersion : null;

    // ==========================================
    // HANDLERS
    // ==========================================

    // Upgrade handler
    const handleUpgrade = async (version, mode) => {
        if (!version?.hasWasm) { setUpgradeError('No WASM blob available for this version'); return; }
        setUpgrading(true); setUpgradeMode(mode); setUpgradeError(''); setUpgradeSuccess('');
        try {
            const factory = createFactoryActor(factoryCanisterId, {
                agentOptions: { identity, host: process.env.DFX_NETWORK === 'ic' || process.env.DFX_NETWORK === 'staging' ? 'https://icp0.io' : 'http://localhost:4943' }
            });
            // Fetch WASM from factory (this is a simplified pattern — real impl may need chunked download)
            // For now we just use the install_code flow via management canister
            const agent = getAgent();
            if (process.env.DFX_NETWORK !== 'ic' && process.env.DFX_NETWORK !== 'staging') await agent.fetchRootKey();
            // The factory should provide a way to get the WASM blob; use upgrade endpoint if available
            // Fallback: fetch from wasmUrl if available
            if (version.wasmUrl?.length > 0) {
                const resp = await fetch(version.wasmUrl[0]);
                if (!resp.ok) throw new Error(`Download failed: ${resp.status}`);
                const wasmBytes = new Uint8Array(await resp.arrayBuffer());
                const mgmt = Actor.createActor(managementCanisterIdlFactory, {
                    agent, canisterId: MANAGEMENT_CANISTER_ID,
                    effectiveCanisterId: Principal.fromText(canisterId),
                });
                await mgmt.install_code({
                    mode: { [mode]: null },
                    canister_id: Principal.fromText(canisterId),
                    wasm_module: wasmBytes,
                    arg: [],
                });
                setUpgradeSuccess(`${mode === 'upgrade' ? 'Upgraded' : 'Reinstalled'} to v${Number(version.major)}.${Number(version.minor)}.${Number(version.patch)}`);
                await loadCanisterStatus();
                await loadBotVersion();
            } else {
                setUpgradeError('No WASM URL available for download');
            }
        } catch (err) {
            setUpgradeError(`${mode} failed: ${err.message}`);
        } finally { setUpgrading(false); }
    };

    // Controller management
    const handleAddController = async () => {
        if (!newControllerInput.trim()) return;
        setUpdatingControllers(true); setControllerError('');
        try {
            const agent = getAgent();
            if (process.env.DFX_NETWORK !== 'ic' && process.env.DFX_NETWORK !== 'staging') await agent.fetchRootKey();
            const mgmt = Actor.createActor(managementCanisterIdlFactory, {
                agent, canisterId: MANAGEMENT_CANISTER_ID,
                effectiveCanisterId: Principal.fromText(canisterId),
            });
            const newPrincipal = Principal.fromText(newControllerInput.trim());
            const newControllers = [...controllers, newPrincipal];
            await mgmt.update_settings({
                canister_id: Principal.fromText(canisterId),
                settings: {
                    controllers: [newControllers],
                    compute_allocation: [], memory_allocation: [],
                    freezing_threshold: [], reserved_cycles_limit: [],
                    log_visibility: [], wasm_memory_limit: [],
                },
            });
            setControllers(newControllers);
            setNewControllerInput('');
        } catch (err) { setControllerError(err.message); }
        finally { setUpdatingControllers(false); }
    };

    const handleRemoveController = async (controller) => {
        setUpdatingControllers(true); setControllerError('');
        try {
            const agent = getAgent();
            if (process.env.DFX_NETWORK !== 'ic' && process.env.DFX_NETWORK !== 'staging') await agent.fetchRootKey();
            const mgmt = Actor.createActor(managementCanisterIdlFactory, {
                agent, canisterId: MANAGEMENT_CANISTER_ID,
                effectiveCanisterId: Principal.fromText(canisterId),
            });
            const newControllers = controllers.filter(c => c.toString() !== controller.toString());
            await mgmt.update_settings({
                canister_id: Principal.fromText(canisterId),
                settings: {
                    controllers: [newControllers],
                    compute_allocation: [], memory_allocation: [],
                    freezing_threshold: [], reserved_cycles_limit: [],
                    log_visibility: [], wasm_memory_limit: [],
                },
            });
            setControllers(newControllers);
            setConfirmRemoveController(null);
        } catch (err) { setControllerError(err.message); }
        finally { setUpdatingControllers(false); }
    };

    // Botkey handlers
    const handleAddHotkeyPrincipal = async () => {
        const selectedPerms = Object.entries(newHotkeyPermissions).filter(([_, v]) => v).map(([k]) => ({ [k]: null }));
        if (!newHotkeyPrincipal.trim() || selectedPerms.length === 0) return;
        setSavingPermissions(true); setPermissionError('');
        try {
            const bot = await getReadyBotActor();
            const principal = Principal.fromText(newHotkeyPrincipal.trim());
            const result = await bot.addHotkeyPermissions(principal, selectedPerms);
            if ('Ok' in result) {
                setPermissionSuccess('Botkey added');
                setNewHotkeyPrincipal(''); setNewHotkeyPermissions({});
                await loadHotkeyPermissions();
            } else { setPermissionError('Failed: ' + JSON.stringify(result.Err || result)); }
        } catch (err) { setPermissionError(err.message); }
        finally { setSavingPermissions(false); }
    };

    const handleUpdateHotkeyPermissions = async (principalText) => {
        const current = hotkeyPrincipals.find(h => h.principal.toString() === principalText);
        if (!current) return;
        const currentKeys = new Set(current.permissions.map(p => getPermissionKey(p)));
        const editKeys = new Set(Object.entries(editPermissions).filter(([_, v]) => v).map(([k]) => k));
        const toAdd = [...editKeys].filter(k => !currentKeys.has(k)).map(k => ({ [k]: null }));
        const toRemove = [...currentKeys].filter(k => !editKeys.has(k)).map(k => ({ [k]: null }));
        if (toAdd.length === 0 && toRemove.length === 0) { setEditingPrincipal(null); return; }
        setSavingPermissions(true); setPermissionError('');
        try {
            const bot = await getReadyBotActor();
            const principal = Principal.fromText(principalText);
            if (toAdd.length > 0) {
                const addResult = await bot.addHotkeyPermissions(principal, toAdd);
                if (addResult && 'Err' in addResult) {
                    setPermissionError('Failed to add: ' + JSON.stringify(addResult.Err));
                    return;
                }
            }
            if (toRemove.length > 0) {
                const removeResult = await bot.removeHotkeyPermissions(principal, toRemove);
                if (removeResult && 'Err' in removeResult) {
                    setPermissionError('Failed to remove: ' + JSON.stringify(removeResult.Err));
                    return;
                }
            }
            setPermissionSuccess('Permissions updated');
            setEditingPrincipal(null);
            await loadHotkeyPermissions();
        } catch (err) { setPermissionError(err.message); }
        finally { setSavingPermissions(false); }
    };

    const handleRemoveHotkeyPrincipal = async (principalText) => {
        setSavingPermissions(true); setPermissionError('');
        try {
            const bot = await getReadyBotActor();
            const result = await bot.removeHotkeyPrincipal(Principal.fromText(principalText));
            if ('Ok' in result) {
                setPermissionSuccess('Botkey removed');
                setConfirmRemoveHotkey(null);
                await loadHotkeyPermissions();
            } else { setPermissionError('Failed: ' + JSON.stringify(result.Err || result)); }
        } catch (err) { setPermissionError(err.message); }
        finally { setSavingPermissions(false); }
    };

    // Chore control helpers
    const choreAction = async (actionFn) => {
        setSavingChore(true); setChoreError('');
        try {
            const bot = await getReadyBotActor();
            await actionFn(bot);
            await loadChoreData(true);
            // IC query replicas may serve stale data right after an update call;
            // schedule a safety re-fetch to pick up the committed state.
            setTimeout(() => loadChoreData(true), 1200);
        } catch (err) { setChoreError(err.message); }
        finally { setSavingChore(false); }
    };

    // Estimated cycles from ICP amount
    const estimatedCycles = () => {
        if (!topUpAmount || !conversionRate) return null;
        const icpAmount = parseFloat(topUpAmount);
        if (isNaN(icpAmount) || icpAmount <= 0) return null;
        return icpAmount * conversionRate.cyclesPerIcp;
    };

    // Handle cycles top-up
    const handleCyclesTopUp = async () => {
        if (!identity || !canisterId || !topUpAmount) return;
        const icpAmount = parseFloat(topUpAmount);
        if (isNaN(icpAmount) || icpAmount <= 0) { setTopUpError('Please enter a valid ICP amount'); return; }
        const amountE8s = BigInt(Math.floor(icpAmount * E8S));
        const totalNeeded = amountE8s + BigInt(ICP_FEE);
        if (userIcpBalance === null || BigInt(userIcpBalance) < totalNeeded) {
            setTopUpError(`Insufficient ICP balance. You have ${formatIcp(userIcpBalance)} ICP, need ${(Number(totalNeeded) / E8S).toFixed(4)} ICP (including fee)`);
            return;
        }
        setToppingUp(true); setTopUpError('');
        try {
            const host = process.env.DFX_NETWORK === 'ic' || process.env.DFX_NETWORK === 'staging' ? 'https://ic0.app' : 'http://localhost:4943';
            const agent = new HttpAgent({ identity, host });
            if (process.env.DFX_NETWORK !== 'ic' && process.env.DFX_NETWORK !== 'staging') await agent.fetchRootKey();
            const canisterPrincipal = Principal.fromText(canisterId);
            const cmcPrincipal = Principal.fromText(CMC_CANISTER_ID);
            // Step 1: Transfer ICP to CMC with canister's subaccount
            const ledger = createLedgerActor(ICP_LEDGER_CANISTER_ID, { agent });
            const subaccount = principalToSubaccount(canisterPrincipal);
            const transferResult = await ledger.icrc1_transfer({
                to: { owner: cmcPrincipal, subaccount: [subaccount] },
                amount: amountE8s,
                fee: [BigInt(ICP_FEE)],
                memo: [TOP_UP_MEMO],
                from_subaccount: [],
                created_at_time: [],
            });
            if ('Err' in transferResult) {
                const err = transferResult.Err;
                if ('InsufficientFunds' in err) throw new Error(`Insufficient funds: ${formatIcp(Number(err.InsufficientFunds.balance))} ICP available`);
                throw new Error(`Transfer failed: ${JSON.stringify(err)}`);
            }
            const blockIndex = transferResult.Ok;
            // Step 2: Notify CMC to mint cycles
            const cmcHost = process.env.DFX_NETWORK === 'ic' || process.env.DFX_NETWORK === 'staging' ? 'https://ic0.app' : host;
            const cmcAgent = HttpAgent.createSync({ host: cmcHost, identity });
            if (process.env.DFX_NETWORK !== 'ic' && process.env.DFX_NETWORK !== 'staging') await cmcAgent.fetchRootKey();
            const cmc = createCmcActor(CMC_CANISTER_ID, { agent: cmcAgent });
            const notifyResult = await cmc.notify_top_up({ block_index: blockIndex, canister_id: canisterPrincipal });
            if ('Err' in notifyResult) {
                const err = notifyResult.Err;
                if ('Refunded' in err) throw new Error(`Top-up refunded: ${err.Refunded.reason}`);
                else if ('InvalidTransaction' in err) throw new Error(`Invalid transaction: ${err.InvalidTransaction}`);
                else if ('Other' in err) throw new Error(`CMC error: ${err.Other.error_message}`);
                else if ('Processing' in err) throw new Error('Transaction is still being processed. Please try again in a moment.');
                throw new Error(`Unknown CMC error: ${JSON.stringify(err)}`);
            }
            const cyclesAdded = Number(notifyResult.Ok);
            setTopUpSuccessDialog({ cyclesAdded, icpSpent: icpAmount });
            setTopUpAmount('');
            setShowTopUpSection(false);
            loadCanisterStatus();
            fetchUserBalance(agent);
        } catch (err) {
            console.error('Cycles top-up error:', err);
            setTopUpError(`Top-up failed: ${err.message || 'Unknown error'}`);
        } finally { setToppingUp(false); }
    };

    // Handle withdraw token
    const handleWithdrawToken = async () => {
        if (!withdrawAmount || parseFloat(withdrawAmount) <= 0) { setWithdrawError('Please enter a valid amount'); return; }
        if (!withdrawDestination) { setWithdrawError('Please enter a destination principal'); return; }
        const ledgerId = useCustomLedger ? customLedgerInput : withdrawTokenLedger;
        if (!ledgerId) { setWithdrawError('Please select a token or enter a ledger principal'); return; }
        if (useCustomLedger) {
            try { Principal.fromText(customLedgerInput); }
            catch { setWithdrawError('Invalid ledger principal'); return; }
        }
        setWithdrawing(true); setWithdrawError(''); setWithdrawSuccess('');
        try {
            const bot = await getReadyBotActor();
            const amount = BigInt(Math.floor(parseFloat(withdrawAmount) * Math.pow(10, withdrawTokenDecimals)));
            const destination = { owner: Principal.fromText(withdrawDestination), subaccount: [] };
            let result;
            if (ledgerId === ICP_LEDGER_CANISTER_ID) {
                result = await bot.withdrawIcp(amount, destination);
            } else {
                result = await bot.withdrawToken(Principal.fromText(ledgerId), amount, destination);
            }
            if ('Ok' in result) {
                setWithdrawSuccess(`Withdrew ${withdrawAmount} ${withdrawTokenSymbol}! Block height: ${result.Ok.transfer_block_height.toString()}`);
                setWithdrawAmount('');
                fetchWithdrawTokenBalance(ledgerId);
            } else {
                setWithdrawError('Failed: ' + JSON.stringify(result.Err || result));
            }
        } catch (err) {
            console.error('Error withdrawing token:', err);
            setWithdrawError(`Withdraw failed: ${err.message || 'Unknown error'}`);
        } finally { setWithdrawing(false); }
    };

    // ==========================================
    // RENDER
    // ==========================================
    if (!canisterId) return null;

    const IconComponent = botIcon || <FaRobot style={{ color: accent, fontSize: '16px' }} />;

    return (
        <div style={{ marginBottom: '1.25rem' }}>
            {/* Top-Up Success Dialog */}
            {topUpSuccessDialog && (
                <div style={{
                    position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
                    backgroundColor: 'rgba(0,0,0,0.5)', zIndex: 9999,
                    display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px',
                }}>
                    <div style={{
                        backgroundColor: theme.colors.cardBackground || theme.colors.background,
                        borderRadius: '16px', padding: '32px', maxWidth: '400px', width: '100%',
                        border: `1px solid ${theme.colors.border}`, textAlign: 'center',
                        boxShadow: '0 20px 40px rgba(0,0,0,0.3)',
                    }}>
                        <div style={{ fontSize: '3rem', marginBottom: '16px' }}>⚡</div>
                        <h3 style={{ color: theme.colors.primaryText, margin: '0 0 8px 0', fontSize: '1.2rem' }}>Cycles Added!</h3>
                        <div style={{ marginBottom: '20px' }}>
                            <div style={{ marginBottom: '8px' }}>
                                <span style={{ color: theme.colors.mutedText, fontSize: '0.85rem' }}>Cycles received: </span>
                                <span style={{ color: theme.colors.success || '#22c55e', fontWeight: '700', fontSize: '0.95rem' }}>+{formatCycles(topUpSuccessDialog.cyclesAdded)}</span>
                            </div>
                            <div>
                                <span style={{ color: theme.colors.mutedText, fontSize: '0.85rem' }}>ICP spent: </span>
                                <span style={{ color: theme.colors.primaryText, fontWeight: '600', fontSize: '0.95rem' }}>{topUpSuccessDialog.icpSpent.toFixed(4)} ICP</span>
                            </div>
                        </div>
                        <button onClick={() => setTopUpSuccessDialog(null)} style={{ ...buttonStyle, width: '100%' }}>Close</button>
                    </div>
                </div>
            )}
            {/* Section Header */}
            <button
                onClick={() => setExpanded(!expanded)}
                style={{
                    width: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    padding: '1rem 1.25rem',
                    background: expanded ? `linear-gradient(90deg, ${accent}15 0%, transparent 100%)` : theme.colors.cardGradient,
                    border: `1px solid ${theme.colors.border}`,
                    borderRadius: expanded ? '14px 14px 0 0' : '14px',
                    cursor: 'pointer', color: theme.colors.primaryText,
                    transition: 'all 0.2s', boxShadow: theme.colors.cardShadow,
                }}
            >
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <div style={{
                        width: '36px', height: '36px', borderRadius: '10px',
                        background: `linear-gradient(135deg, ${accent}30, ${accent}10)`,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}>
                        {botIcon || <FaRobot style={{ color: accent, fontSize: '16px' }} />}
                    </div>
                    <span style={{ fontSize: '1.05rem', fontWeight: '600' }}>{botName}</span>
                    {canisterStatus && (
                        <span style={{
                            fontSize: '0.75rem',
                            color: getCyclesColor(canisterStatus.cycles, cycleSettings),
                            backgroundColor: `${getCyclesColor(canisterStatus.cycles, cycleSettings)}15`,
                            padding: '4px 10px', borderRadius: '8px', fontWeight: '600',
                            display: 'flex', alignItems: 'center', gap: '4px',
                        }}>
                            ⚡ {formatCycles(canisterStatus.cycles)}
                        </span>
                    )}
                    {choreStatuses.length > 0 && (
                        <span style={{
                            display: 'flex', alignItems: 'center', gap: '6px',
                            padding: '4px 10px', borderRadius: '8px',
                            background: `${theme.colors.border}30`,
                            fontSize: '0.7rem', color: theme.colors.secondaryText,
                        }}>
                            {choreStatuses.map(chore => (
                                <StatusLamp key={chore.choreId} state={getChoreSummaryLamp(chore, cbEvents)} size={8}
                                    label={getSummaryLabel(getChoreSummaryLamp(chore, cbEvents), chore.choreName)} />
                            ))}
                            <span style={{ marginLeft: '2px' }}>Chores</span>
                        </span>
                    )}
                </div>
                <span style={{
                    fontSize: '14px',
                    transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)',
                    transition: 'transform 0.2s ease', color: theme.colors.mutedText,
                }}>
                    {expanded ? <FaChevronUp /> : <FaChevronDown />}
                </span>
            </button>

            {/* Section Content */}
            {expanded && (
                <div style={{
                    border: `1px solid ${theme.colors.border}`, borderTop: 'none',
                    borderRadius: '0 0 12px 12px', overflow: 'hidden', padding: '20px',
                }}>
                    {/* Tabs */}
                    <div style={{ display: 'flex', flexWrap: 'wrap', marginBottom: '16px', gap: '0' }}>
                        <button style={tabStyle(activeTab === 'info')} onClick={() => setActiveTab('info')}>Info</button>
                        {(hasPermission('ViewChores') || canManageAnyChore()) && (
                            <button style={{ ...tabStyle(activeTab === 'chores'), display: 'inline-flex', alignItems: 'center', gap: '6px' }} onClick={() => setActiveTab('chores')}>
                                {choreStatuses.length > 0 && (
                                    <StatusLamp state={getAllChoresSummaryLamp(choreStatuses, cbEvents)} size={8}
                                        label={getSummaryLabel(getAllChoresSummaryLamp(choreStatuses, cbEvents), 'Chores')} />
                                )}
                                Chores
                            </button>
                        )}
                        <button style={tabStyle(activeTab === 'permissions')} onClick={() => setActiveTab('permissions')}>Botkeys</button>
                        {hasPermission('ViewLogs') && (
                            <button style={tabStyle(activeTab === 'log')} onClick={() => setActiveTab('log')}>Log</button>
                        )}
                    </div>

                    {/* ==================== INFO TAB ==================== */}
                    {activeTab === 'info' && (
                        <div>
                            <div style={cardStyle}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '20px' }}>
                                    <div>
                                        <div style={{ color: theme.colors.mutedText, fontSize: '12px' }}>Canister ID</div>
                                        <div style={{ color: theme.colors.primaryText, fontSize: '14px', marginTop: '4px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                                            <PrincipalDisplay principal={canisterId} displayInfo={getPrincipalDisplayInfoFromContext(canisterId, principalNames, principalNicknames)}
                                                showCopyButton={true} isAuthenticated={isAuthenticated} noLink={true} />
                                        </div>
                                    </div>
                                    {canisterStatus && (
                                        <div style={{ textAlign: 'right' }}>
                                            <div style={{ color: theme.colors.mutedText, fontSize: '12px' }}>Cycles</div>
                                            <div style={{ color: getCyclesColor(canisterStatus.cycles, cycleSettings), fontSize: '24px', fontWeight: '700', marginTop: '4px' }}>
                                                {formatCycles(canisterStatus.cycles)}
                                            </div>
                                        </div>
                                    )}
                                </div>
                                <div style={{ marginTop: '15px', display: 'flex', gap: '20px', flexWrap: 'wrap' }}>
                                    {botVersion && (
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                            <span style={{ color: theme.colors.mutedText, fontSize: '12px' }}>Version:</span>
                                            <span style={{ color: theme.colors.primaryText, fontSize: '12px' }}>{botVersion}</span>
                                            {matchedOfficialVersion && `${Number(matchedOfficialVersion.major)}.${Number(matchedOfficialVersion.minor)}.${Number(matchedOfficialVersion.patch)}` === botVersion && (
                                                <span title="Version verified" style={{ color: theme.colors.success || '#22c55e', fontSize: '14px' }}>✓</span>
                                            )}
                                        </div>
                                    )}
                                    {canisterStatus && (
                                        <div>
                                            <span style={{ color: theme.colors.mutedText, fontSize: '12px' }}>Status: </span>
                                            <span style={{ color: canisterStatus.status === 'running' ? (theme.colors.success || '#22c55e') : '#f59e0b', fontSize: '12px', textTransform: 'capitalize' }}>
                                                {canisterStatus.status}
                                            </span>
                                        </div>
                                    )}
                                    {canisterStatus?.memorySize !== undefined && (
                                        <div>
                                            <span style={{ color: theme.colors.mutedText, fontSize: '12px' }}>Memory: </span>
                                            <span style={{ color: theme.colors.primaryText, fontSize: '12px' }}>{(canisterStatus.memorySize / (1024 * 1024)).toFixed(2)} MB</span>
                                        </div>
                                    )}
                                </div>

                                {/* Module Hash */}
                                {canisterStatus && (
                                    <div style={{ marginTop: '15px' }}>
                                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '4px' }}>
                                            <span style={{ color: theme.colors.mutedText, fontSize: '12px' }}>Module Hash</span>
                                            {matchedOfficialVersion && (
                                                <span style={{ color: theme.colors.success || '#22c55e', fontSize: '11px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                                                    ✓ Official v{Number(matchedOfficialVersion.major)}.{Number(matchedOfficialVersion.minor)}.{Number(matchedOfficialVersion.patch)}
                                                </span>
                                            )}
                                        </div>
                                        <div style={{
                                            color: matchedOfficialVersion ? (theme.colors.success || '#22c55e') : theme.colors.primaryText,
                                            fontFamily: 'monospace', fontSize: '11px',
                                            background: theme.colors.tertiaryBg || theme.colors.secondaryBg,
                                            padding: '8px 10px', borderRadius: '4px', wordBreak: 'break-all',
                                            border: matchedOfficialVersion ? `1px solid ${theme.colors.success || '#22c55e'}30` : 'none',
                                        }}>
                                            {canisterStatus.moduleHash || <span style={{ color: theme.colors.mutedText, fontStyle: 'italic' }}>No module installed</span>}
                                        </div>

                                        {/* Upgrade Available */}
                                        {nextAvailableVersion && isController && (
                                            <div style={{ marginTop: '12px', padding: '12px', background: `${theme.colors.accent}15`, borderRadius: '6px', border: `1px solid ${theme.colors.accent}40` }}>
                                                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: '10px' }}>
                                                    <div>
                                                        <div style={{ color: theme.colors.accent, fontWeight: '600', fontSize: '13px', marginBottom: '2px' }}>🚀 Upgrade Available</div>
                                                        <div style={{ color: theme.colors.mutedText, fontSize: '12px' }}>
                                                            v{Number(nextAvailableVersion.major)}.{Number(nextAvailableVersion.minor)}.{Number(nextAvailableVersion.patch)} is available
                                                        </div>
                                                    </div>
                                                    <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                                                        <button onClick={() => handleUpgrade(nextAvailableVersion, 'upgrade')} disabled={upgrading}
                                                            style={{ ...buttonStyle, background: theme.colors.accent, opacity: upgrading ? 0.7 : 1 }}>
                                                            {upgrading && upgradeMode === 'upgrade' ? '⏳ Upgrading...' : '⬆️ Upgrade'}
                                                        </button>
                                                        <button onClick={() => { if (window.confirm('⚠️ Reinstall will WIPE ALL CANISTER STATE. Are you sure?')) handleUpgrade(nextAvailableVersion, 'reinstall'); }}
                                                            disabled={upgrading} style={{ ...secondaryButtonStyle, color: theme.colors.mutedText, opacity: upgrading ? 0.7 : 1 }}>
                                                            {upgrading && upgradeMode === 'reinstall' ? '⏳...' : '🔄 Reinstall'}
                                                        </button>
                                                    </div>
                                                </div>
                                                {upgradeError && <div style={{ marginTop: '10px', padding: '8px 10px', background: `${theme.colors.error || '#ef4444'}20`, borderRadius: '4px', color: theme.colors.error || '#ef4444', fontSize: '12px' }}>{upgradeError}</div>}
                                                {upgradeSuccess && <div style={{ marginTop: '10px', padding: '8px 10px', background: `${theme.colors.success || '#22c55e'}20`, borderRadius: '4px', color: theme.colors.success || '#22c55e', fontSize: '12px' }}>{upgradeSuccess}</div>}
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>

                            {/* Controllers */}
                            {controllers.length > 0 && (
                                <div style={cardStyle}>
                                    <div style={{ color: theme.colors.mutedText, fontSize: '12px', marginBottom: '8px' }}>Controllers ({controllers.length})</div>
                                    <div style={{ background: theme.colors.tertiaryBg || theme.colors.secondaryBg, padding: '10px', borderRadius: '6px' }}>
                                        {controllers.map((controller, index) => {
                                            const cStr = controller.toString();
                                            const isMe = identity && cStr === identity.getPrincipal().toString();
                                            const isConfirming = confirmRemoveController === cStr;
                                            return (
                                                <div key={index} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '6px 0', borderBottom: index < controllers.length - 1 ? `1px solid ${theme.colors.border}` : 'none' }}>
                                                    <div style={{ flex: 1, overflow: 'hidden', minWidth: 0 }}>
                                                        <PrincipalDisplay principal={cStr} displayInfo={getPrincipalDisplayInfoFromContext(cStr, principalNames, principalNicknames)} showCopyButton={true} isAuthenticated={isAuthenticated} />
                                                    </div>
                                                    {isMe && <span style={{ backgroundColor: `${accent}30`, color: accent, padding: '2px 6px', borderRadius: '4px', fontSize: '10px', fontWeight: '500' }}>YOU</span>}
                                                    {isController && (
                                                        isConfirming ? (
                                                            <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
                                                                <span style={{ color: theme.colors.error, fontSize: '10px' }}>{isMe ? '⚠️ Remove yourself?' : 'Confirm?'}</span>
                                                                <button onClick={() => handleRemoveController(controller)} disabled={updatingControllers}
                                                                    style={{ backgroundColor: theme.colors.error || '#ef4444', color: '#fff', border: 'none', borderRadius: '4px', padding: '2px 6px', cursor: 'pointer', fontSize: '10px' }}>
                                                                    {updatingControllers ? '...' : 'Yes'}
                                                                </button>
                                                                <button onClick={() => setConfirmRemoveController(null)} style={{ ...secondaryButtonStyle, padding: '2px 6px', fontSize: '10px' }}>No</button>
                                                            </div>
                                                        ) : (
                                                            <button onClick={() => setConfirmRemoveController(cStr)} disabled={updatingControllers}
                                                                style={{ backgroundColor: 'transparent', color: theme.colors.error || '#ef4444', border: `1px solid ${theme.colors.error || '#ef4444'}`, borderRadius: '4px', padding: '2px 6px', cursor: 'pointer', fontSize: '10px' }}>
                                                                Remove
                                                            </button>
                                                        )
                                                    )}
                                                </div>
                                            );
                                        })}
                                        {isController && (
                                            <div style={{ marginTop: '12px', paddingTop: '12px', borderTop: `1px solid ${theme.colors.border}` }}>
                                                <div style={{ color: theme.colors.mutedText, fontSize: '11px', marginBottom: '6px' }}>Add Controller</div>
                                                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'flex-start' }}>
                                                    <div style={{ flex: '1', minWidth: '180px' }}>
                                                        <PrincipalInput value={newControllerInput} onChange={setNewControllerInput} placeholder="Enter principal ID" defaultTab="private" defaultPrincipalType="both" disabled={updatingControllers} />
                                                    </div>
                                                    <button onClick={handleAddController} disabled={updatingControllers || !newControllerInput.trim()}
                                                        style={{ ...buttonStyle, background: theme.colors.success || '#22c55e', opacity: (updatingControllers || !newControllerInput.trim()) ? 0.7 : 1 }}>
                                                        {updatingControllers ? 'Adding...' : 'Add'}
                                                    </button>
                                                </div>
                                                {controllerError && <div style={{ color: theme.colors.error, fontSize: '11px', marginTop: '6px' }}>{controllerError}</div>}
                                            </div>
                                        )}
                                    </div>
                                </div>
                            )}

                            {/* Cycles Top-Up Card */}
                            <div style={cardStyle}>
                                <div style={{
                                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                                    marginBottom: showTopUpSection ? '1rem' : '0',
                                    flexWrap: 'wrap', gap: '0.75rem',
                                }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                                        <div style={{
                                            width: '40px', height: '40px', borderRadius: '10px',
                                            background: `linear-gradient(135deg, ${accent}25, ${accent}10)`,
                                            display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                                        }}>
                                            <FaGasPump style={{ color: accent, fontSize: '16px' }} />
                                        </div>
                                        <div>
                                            <h3 style={{ color: theme.colors.primaryText, margin: '0 0 2px 0', fontSize: '1rem', fontWeight: '600' }}>Top Up Cycles</h3>
                                            <p style={{ color: theme.colors.mutedText, fontSize: '0.8rem', margin: 0 }}>Convert ICP to cycles for this canister</p>
                                        </div>
                                    </div>
                                    <button onClick={() => setShowTopUpSection(!showTopUpSection)}
                                        style={{ ...(showTopUpSection ? secondaryButtonStyle : buttonStyle), padding: '0.5rem 1rem', fontSize: '0.85rem' }}>
                                        {showTopUpSection ? 'Cancel' : '⛽ Add Cycles'}
                                    </button>
                                </div>
                                {showTopUpSection && (
                                    <div>
                                        {/* User ICP Balance */}
                                        <div style={{
                                            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                                            marginBottom: '12px', padding: '10px 12px',
                                            backgroundColor: theme.colors.tertiaryBg || theme.colors.secondaryBg, borderRadius: '6px',
                                        }}>
                                            <span style={{ color: theme.colors.mutedText, fontSize: '13px' }}>Your ICP Balance:</span>
                                            <span style={{ color: theme.colors.primaryText, fontWeight: '600', fontSize: '14px' }}>{formatIcp(userIcpBalance)} ICP</span>
                                        </div>
                                        {/* Conversion Rate Info */}
                                        {conversionRate && (
                                            <div style={{ marginBottom: '12px', padding: '10px 12px', backgroundColor: `${accent}10`, borderRadius: '6px', fontSize: '12px', color: theme.colors.mutedText }}>
                                                <strong style={{ color: theme.colors.primaryText }}>Current Rate:</strong> 1 ICP ≈ {formatCycles(conversionRate.cyclesPerIcp)} cycles
                                            </div>
                                        )}
                                        {/* Amount Input */}
                                        <div style={{ marginBottom: '12px' }}>
                                            <label style={{ display: 'block', color: theme.colors.mutedText, fontSize: '12px', marginBottom: '6px' }}>Amount (ICP)</label>
                                            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                                                <input type="text" inputMode="decimal" value={topUpAmount} onChange={(e) => setTopUpAmount(e.target.value)}
                                                    placeholder="0.0" disabled={toppingUp} style={inputStyle} />
                                                <button onClick={() => {
                                                    if (userIcpBalance) {
                                                        const maxAmount = Math.max(0, (userIcpBalance - ICP_FEE * 2) / E8S);
                                                        setTopUpAmount(maxAmount.toFixed(4));
                                                    }
                                                }} disabled={toppingUp || !userIcpBalance}
                                                    style={{ ...secondaryButtonStyle, padding: '10px 12px' }}>MAX</button>
                                            </div>
                                        </div>
                                        {/* Estimated Cycles */}
                                        {estimatedCycles() && (
                                            <div style={{
                                                marginBottom: '16px', padding: '12px',
                                                backgroundColor: `${theme.colors.success || '#22c55e'}15`, borderRadius: '6px',
                                                border: `1px solid ${theme.colors.success || '#22c55e'}30`, textAlign: 'center',
                                            }}>
                                                <div style={{ color: theme.colors.mutedText, fontSize: '12px', marginBottom: '4px' }}>Estimated Cycles to Add</div>
                                                <div style={{ color: theme.colors.success || '#22c55e', fontSize: '20px', fontWeight: '700' }}>~{formatCycles(estimatedCycles())}</div>
                                            </div>
                                        )}
                                        {/* Error */}
                                        {topUpError && <div style={{ marginBottom: '12px', padding: '8px 12px', background: `${theme.colors.error || '#ef4444'}15`, borderRadius: '6px', color: theme.colors.error || '#ef4444', fontSize: '12px' }}>{topUpError}</div>}
                                        {/* Top Up Button */}
                                        <button onClick={handleCyclesTopUp} disabled={toppingUp || !topUpAmount || parseFloat(topUpAmount) <= 0}
                                            style={{
                                                ...buttonStyle, width: '100%',
                                                opacity: (toppingUp || !topUpAmount || parseFloat(topUpAmount) <= 0) ? 0.6 : 1,
                                                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px',
                                            }}>
                                            {toppingUp ? '⏳ Processing...' : (<><FaGasPump /> Top Up Canister</>)}
                                        </button>
                                        <p style={{ color: theme.colors.mutedText, fontSize: '11px', marginTop: '10px', marginBottom: 0, textAlign: 'center' }}>
                                            Converts ICP to cycles via the Cycles Minting Canister (CMC). A small ICP fee (0.0001) applies.
                                        </p>
                                    </div>
                                )}
                            </div>

                            {/* Withdraw Tokens Card - only for principals with WithdrawFunds permission */}
                            {hasPermission('WithdrawFunds') && (
                                <div style={cardStyle}>
                                    <button onClick={() => setWithdrawSectionExpanded(!withdrawSectionExpanded)}
                                        style={{
                                            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                                            width: '100%', background: 'transparent', border: 'none', padding: 0, cursor: 'pointer', textAlign: 'left',
                                        }}>
                                        <div>
                                            <h3 style={{ color: theme.colors.primaryText, margin: '0 0 5px 0' }}>💸 Withdraw Tokens</h3>
                                            <p style={{ color: theme.colors.mutedText, fontSize: '12px', margin: 0 }}>
                                                Withdraw ICP or any ICRC1 token from this canister
                                            </p>
                                        </div>
                                        <span style={{
                                            color: theme.colors.mutedText, fontSize: '18px',
                                            transform: withdrawSectionExpanded ? 'rotate(180deg)' : 'rotate(0deg)',
                                            transition: 'transform 0.2s ease',
                                        }}>▼</span>
                                    </button>
                                    {withdrawSectionExpanded && (
                                        <div style={{ marginTop: '15px' }}>
                                            {/* Token Selection */}
                                            <div style={{ marginBottom: '15px' }}>
                                                <label style={{ color: theme.colors.mutedText, fontSize: '11px', display: 'block', marginBottom: '6px' }}>Select Token</label>
                                                <div style={{ display: 'flex', gap: '10px', alignItems: 'center', marginBottom: '10px' }}>
                                                    <label style={{ display: 'flex', alignItems: 'center', gap: '6px', color: theme.colors.primaryText, fontSize: '13px', cursor: 'pointer' }}>
                                                        <input type="radio" checked={!useCustomLedger} onChange={() => { setUseCustomLedger(false); setWithdrawTokenLedger(ICP_LEDGER_CANISTER_ID); }} style={{ margin: 0 }} />
                                                        From list
                                                    </label>
                                                    <label style={{ display: 'flex', alignItems: 'center', gap: '6px', color: theme.colors.primaryText, fontSize: '13px', cursor: 'pointer' }}>
                                                        <input type="radio" checked={useCustomLedger} onChange={() => setUseCustomLedger(true)} style={{ margin: 0 }} />
                                                        Custom ledger
                                                    </label>
                                                </div>
                                                {!useCustomLedger ? (
                                                    <TokenSelector value={withdrawTokenLedger} onChange={(ledgerId) => setWithdrawTokenLedger(ledgerId)} placeholder="Select a token..." />
                                                ) : (
                                                    <input type="text" value={customLedgerInput} onChange={(e) => setCustomLedgerInput(e.target.value)}
                                                        style={inputStyle} placeholder="Enter ledger canister principal" />
                                                )}
                                            </div>
                                            {/* Token Balance */}
                                            <div style={{
                                                background: `${accent}10`, padding: '10px', borderRadius: '6px', marginBottom: '12px',
                                                fontSize: '12px', color: theme.colors.mutedText,
                                            }}>
                                                Available: <strong style={{ color: theme.colors.primaryText }}>
                                                    {withdrawTokenBalance !== null
                                                        ? `${(Number(withdrawTokenBalance) / Math.pow(10, withdrawTokenDecimals)).toFixed(withdrawTokenDecimals > 4 ? 4 : withdrawTokenDecimals)} ${withdrawTokenSymbol}`
                                                        : 'Loading...'}
                                                </strong>
                                            </div>
                                            {/* Amount and Destination */}
                                            <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'flex-end' }}>
                                                <div style={{ flex: 1, minWidth: '120px' }}>
                                                    <label style={{ color: theme.colors.mutedText, fontSize: '11px', display: 'block', marginBottom: '4px' }}>Amount ({withdrawTokenSymbol})</label>
                                                    <input type="text" inputMode="decimal" value={withdrawAmount} onChange={(e) => setWithdrawAmount(e.target.value)}
                                                        style={inputStyle} placeholder="Amount to withdraw" />
                                                </div>
                                                <div style={{ flex: 2, minWidth: '200px' }}>
                                                    <label style={{ color: theme.colors.mutedText, fontSize: '11px', display: 'block', marginBottom: '4px' }}>Destination Principal</label>
                                                    <input type="text" value={withdrawDestination} onChange={(e) => setWithdrawDestination(e.target.value)}
                                                        style={inputStyle} placeholder="Principal ID" />
                                                </div>
                                                <button onClick={handleWithdrawToken}
                                                    disabled={withdrawing || withdrawTokenBalance === null || withdrawTokenBalance === BigInt(0)}
                                                    style={{ ...buttonStyle, opacity: (withdrawing || withdrawTokenBalance === null || withdrawTokenBalance === BigInt(0)) ? 0.6 : 1 }}>
                                                    {withdrawing ? '⏳...' : '💸 Withdraw'}
                                                </button>
                                            </div>
                                            <p style={{ color: theme.colors.mutedText, fontSize: '11px', marginTop: '8px', marginBottom: 0 }}>
                                                Fee: {(withdrawTokenFee / Math.pow(10, withdrawTokenDecimals)).toFixed(withdrawTokenDecimals > 4 ? 4 : withdrawTokenDecimals)} {withdrawTokenSymbol}
                                            </p>
                                            {withdrawError && <div style={{ marginTop: '8px', padding: '8px 12px', background: `${theme.colors.error || '#ef4444'}15`, borderRadius: '6px', color: theme.colors.error || '#ef4444', fontSize: '12px' }}>{withdrawError}</div>}
                                            {withdrawSuccess && <div style={{ marginTop: '8px', padding: '8px 12px', background: `${theme.colors.success || '#22c55e'}15`, borderRadius: '6px', color: theme.colors.success || '#22c55e', fontSize: '12px' }}>✅ {withdrawSuccess}</div>}
                                        </div>
                                    )}
                                </div>
                            )}
                            {extraInfoContent}
                        </div>
                    )}

                    {/* ==================== BOTKEYS TAB ==================== */}
                    {activeTab === 'permissions' && (
                        <div>
                            <div style={{ padding: '12px 14px', backgroundColor: `${accent}08`, border: `1px solid ${accent}20`, borderRadius: '8px', marginBottom: '16px' }}>
                                <p style={{ color: theme.colors.secondaryText, fontSize: '13px', margin: '0 0 8px 0', lineHeight: '1.5' }}>
                                    <strong style={{ color: theme.colors.primaryText }}>Botkeys</strong> grant specific principals granular permissions to operate this bot canister without being a controller.
                                </p>
                            </div>

                            {loadingPermissions && botkeysSupported === null && (
                                <div style={{ textAlign: 'center', padding: '2rem', color: theme.colors.mutedText }}>Loading botkeys...</div>
                            )}
                            {botkeysSupported === false && (
                                <div style={{ ...cardStyle, textAlign: 'center', padding: '2rem 1.5rem' }}>
                                    <div style={{ fontSize: '2rem', marginBottom: '12px' }}>🔑</div>
                                    <h3 style={{ color: theme.colors.primaryText, margin: '0 0 8px 0' }}>Botkeys Not Available</h3>
                                    <p style={{ color: theme.colors.secondaryText, fontSize: '13px', margin: 0 }}>This bot does not support botkeys.</p>
                                </div>
                            )}
                            {botkeysSupported === true && (
                                <>
                                    {permissionError && <div style={{ padding: '10px 14px', backgroundColor: `${theme.colors.error || '#ef4444'}15`, border: `1px solid ${theme.colors.error || '#ef4444'}40`, borderRadius: '8px', color: theme.colors.error || '#ef4444', fontSize: '13px', marginBottom: '16px' }}>{permissionError}</div>}
                                    {permissionSuccess && <div style={{ padding: '10px 14px', backgroundColor: `${theme.colors.success || '#22c55e'}15`, border: `1px solid ${theme.colors.success || '#22c55e'}40`, borderRadius: '8px', color: theme.colors.success || '#22c55e', fontSize: '13px', marginBottom: '16px' }}>{permissionSuccess}</div>}

                                    {/* Current Botkeys */}
                                    <div style={cardStyle}>
                                        <h3 style={{ color: theme.colors.primaryText, margin: '0 0 12px 0', fontSize: '0.95rem', fontWeight: '600' }}>Botkey Principals ({hotkeyPrincipals.length})</h3>
                                        {hotkeyPrincipals.length === 0 ? (
                                            <div style={{ color: theme.colors.mutedText, fontSize: '13px', padding: '1.5rem', textAlign: 'center', background: theme.colors.tertiaryBg || theme.colors.secondaryBg, borderRadius: '8px' }}>
                                                No botkey principals configured.{hasPermission('ManagePermissions') ? ' Add one below.' : ''}
                                            </div>
                                        ) : (
                                            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                                                {hotkeyPrincipals.map((entry, idx) => {
                                                    const pStr = entry.principal.toString();
                                                    const permKeys = entry.permissions.map(p => getPermissionKey(p));
                                                    const isEditing = editingPrincipal === pStr;
                                                    const isConfirming = confirmRemoveHotkey === pStr;
                                                    return (
                                                        <div key={idx} style={{ background: theme.colors.tertiaryBg || theme.colors.secondaryBg, borderRadius: '8px', padding: '12px', border: `1px solid ${theme.colors.border}` }}>
                                                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: isEditing ? '12px' : '6px', flexWrap: 'wrap', gap: '8px' }}>
                                                                <div style={{ flex: 1, minWidth: '150px', overflow: 'hidden' }}>
                                                                    <PrincipalDisplay principal={pStr} displayInfo={getPrincipalDisplayInfoFromContext(pStr, principalNames, principalNicknames)} showCopyButton={true} isAuthenticated={isAuthenticated} />
                                                                </div>
                                                                {hasPermission('ManagePermissions') && (
                                                                    <div style={{ display: 'flex', gap: '6px', flexShrink: 0 }}>
                                                                        {!isEditing && (
                                                                            <button onClick={() => { setEditingPrincipal(pStr); const perms = {}; permKeys.forEach(k => { perms[k] = true; }); setEditPermissions(perms); }}
                                                                                style={{ ...secondaryButtonStyle, padding: '4px 10px', fontSize: '11px' }}>Edit</button>
                                                                        )}
                                                                        {isConfirming ? (
                                                                            <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
                                                                                <span style={{ color: theme.colors.error, fontSize: '11px' }}>Remove?</span>
                                                                                <button onClick={() => handleRemoveHotkeyPrincipal(pStr)} disabled={savingPermissions}
                                                                                    style={{ backgroundColor: theme.colors.error || '#ef4444', color: '#fff', border: 'none', borderRadius: '4px', padding: '3px 8px', fontSize: '11px', cursor: 'pointer' }}>
                                                                                    {savingPermissions ? '...' : 'Yes'}
                                                                                </button>
                                                                                <button onClick={() => setConfirmRemoveHotkey(null)} style={{ ...secondaryButtonStyle, padding: '3px 8px', fontSize: '11px' }}>No</button>
                                                                            </div>
                                                                        ) : (
                                                                            <button onClick={() => setConfirmRemoveHotkey(pStr)}
                                                                                style={{ backgroundColor: 'transparent', color: theme.colors.error || '#ef4444', border: `1px solid ${theme.colors.error || '#ef4444'}`, borderRadius: '4px', padding: '4px 10px', fontSize: '11px', cursor: 'pointer' }}>
                                                                                Remove
                                                                            </button>
                                                                        )}
                                                                    </div>
                                                                )}
                                                            </div>
                                                            {isEditing ? (
                                                                <div>
                                                                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '6px', marginBottom: '12px' }}>
                                                                        {permissionTypes.map(([id, perm]) => {
                                                                            const key = getPermissionKey(perm);
                                                                            return (
                                                                                <label key={Number(id)} style={{ display: 'flex', alignItems: 'flex-start', gap: '6px', cursor: 'pointer', padding: '4px 6px', borderRadius: '4px', fontSize: '12px', color: theme.colors.primaryText, background: editPermissions[key] ? `${accent}10` : 'transparent' }}>
                                                                                    <input type="checkbox" checked={!!editPermissions[key]} onChange={e => setEditPermissions(prev => ({ ...prev, [key]: e.target.checked }))} style={{ margin: '2px 0 0 0', flexShrink: 0 }} />
                                                                                    <span style={{ fontWeight: '500' }}>{getPermissionLabel(key)}</span>
                                                                                </label>
                                                                            );
                                                                        })}
                                                                    </div>
                                                                    <div style={{ display: 'flex', gap: '8px' }}>
                                                                        <button onClick={() => handleUpdateHotkeyPermissions(pStr)} disabled={savingPermissions}
                                                                            style={{ ...buttonStyle, padding: '6px 16px', fontSize: '12px', opacity: savingPermissions ? 0.7 : 1 }}>
                                                                            {savingPermissions ? 'Saving...' : 'Save'}
                                                                        </button>
                                                                        <button onClick={() => setEditingPrincipal(null)} style={{ ...secondaryButtonStyle, padding: '6px 16px', fontSize: '12px' }}>Cancel</button>
                                                                    </div>
                                                                </div>
                                                            ) : (
                                                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                                                                    {permKeys.map(key => (
                                                                        <span key={key} title={getPermissionDescription(key)} style={{ padding: '2px 8px', borderRadius: '4px', fontSize: '11px', fontWeight: '500', backgroundColor: `${accent}15`, color: accent, border: `1px solid ${accent}25` }}>
                                                                            {getPermissionLabel(key)}
                                                                        </span>
                                                                    ))}
                                                                </div>
                                                            )}
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        )}
                                    </div>

                                    {/* Add Botkey */}
                                    {hasPermission('ManagePermissions') && (
                                        <div style={cardStyle}>
                                            <h3 style={{ color: theme.colors.primaryText, margin: '0 0 12px 0', fontSize: '0.95rem', fontWeight: '600' }}>Add Botkey Principal</h3>
                                            <div style={{ marginBottom: '12px' }}>
                                                <label style={{ color: theme.colors.mutedText, fontSize: '11px', display: 'block', marginBottom: '4px' }}>Principal ID</label>
                                                <PrincipalInput value={newHotkeyPrincipal} onChange={setNewHotkeyPrincipal} placeholder="Enter principal ID or search by name" defaultTab="private" defaultPrincipalType="both" disabled={savingPermissions} />
                                            </div>
                                            <div style={{ marginBottom: '12px' }}>
                                                <label style={{ color: theme.colors.mutedText, fontSize: '11px', display: 'block', marginBottom: '8px' }}>Permissions</label>
                                                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '6px' }}>
                                                    {permissionTypes.map(([id, perm]) => {
                                                        const key = getPermissionKey(perm);
                                                        return (
                                                            <label key={Number(id)} style={{
                                                                display: 'flex', alignItems: 'flex-start', gap: '6px', cursor: 'pointer',
                                                                padding: '6px 8px', borderRadius: '6px', fontSize: '12px',
                                                                color: theme.colors.primaryText,
                                                                background: newHotkeyPermissions[key] ? `${accent}10` : theme.colors.tertiaryBg || theme.colors.secondaryBg,
                                                                border: `1px solid ${newHotkeyPermissions[key] ? accent + '30' : theme.colors.border}`,
                                                            }}>
                                                                <input type="checkbox" checked={!!newHotkeyPermissions[key]} onChange={e => setNewHotkeyPermissions(prev => ({ ...prev, [key]: e.target.checked }))} style={{ margin: '2px 0 0 0', flexShrink: 0 }} />
                                                                <span>
                                                                    <span style={{ fontWeight: '500', display: 'block' }}>{getPermissionLabel(key)}</span>
                                                                    {getPermissionDescription(key) && <span style={{ color: theme.colors.mutedText, fontSize: '11px' }}>{getPermissionDescription(key)}</span>}
                                                                </span>
                                                            </label>
                                                        );
                                                    })}
                                                </div>
                                            </div>
                                            <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                                                <button onClick={handleAddHotkeyPrincipal} disabled={savingPermissions || !newHotkeyPrincipal.trim()}
                                                    style={{ ...buttonStyle, opacity: (savingPermissions || !newHotkeyPrincipal.trim()) ? 0.6 : 1 }}>
                                                    {savingPermissions ? '⏳ Adding...' : 'Add Botkey Principal'}
                                                </button>
                                                <button onClick={() => { const all = {}; permissionTypes.forEach(([_, p]) => { all[getPermissionKey(p)] = true; }); setNewHotkeyPermissions(all); }}
                                                    style={{ ...secondaryButtonStyle, padding: '0.5rem 1rem', fontSize: '0.85rem' }}>Select All</button>
                                                <button onClick={() => setNewHotkeyPermissions({})}
                                                    style={{ ...secondaryButtonStyle, padding: '0.5rem 1rem', fontSize: '0.85rem' }}>Clear All</button>
                                            </div>
                                        </div>
                                    )}
                                </>
                            )}
                        </div>
                    )}

                    {/* ==================== CHORES TAB ==================== */}
                    {activeTab === 'chores' && (
                        <div>
                            {loadingChores ? (
                                <div style={{ textAlign: 'center', padding: '2rem', color: theme.colors.secondaryText }}>Loading chore data...</div>
                            ) : (
                                <>
                                    <div style={{ ...cardStyle, background: `linear-gradient(135deg, ${accent}08, ${accentSec}05)`, border: `1px solid ${accent}20` }}>
                                        <p style={{ margin: 0, fontSize: '0.85rem', color: theme.colors.secondaryText, lineHeight: '1.5' }}>
                                            Bot Chores are automated tasks that run on a schedule. Enable a chore and set its interval — the bot handles the rest.
                                        </p>
                                    </div>

                                    {choreError && <div style={{ ...cardStyle, background: `${theme.colors.error}15`, border: `1px solid ${theme.colors.error}30`, color: theme.colors.error, fontSize: '0.85rem' }}>{choreError}</div>}
                                    {choreSuccess && <div style={{ ...cardStyle, background: `${theme.colors.success || '#22c55e'}15`, border: `1px solid ${theme.colors.success || '#22c55e'}30`, color: theme.colors.success || '#22c55e', fontSize: '0.85rem' }}>{choreSuccess}</div>}

                                    {/* Schedule Overview */}
                                    {choreStatuses.length > 0 && (() => {
                                        const nowMs = choreTickNow;
                                        const upcoming = choreStatuses
                                            .filter(c => c.enabled && c.nextScheduledRunAt?.length > 0)
                                            .map(c => ({ ...c, _ms: Number(c.nextScheduledRunAt[0]) / 1_000_000, _isRunning: !('Idle' in c.conductorStatus) }))
                                            .sort((a, b) => a._isRunning !== b._isRunning ? (a._isRunning ? -1 : 1) : a._ms - b._ms);
                                        if (upcoming.length === 0) return null;
                                        const formatRel = (ms) => {
                                            const diff = ms - nowMs;
                                            if (diff < 0) return 'overdue';
                                            if (diff < 60_000) return `in ${Math.floor(diff / 1000)}s`;
                                            if (diff < 300_000) { const m = Math.floor(diff / 60000); const s = Math.floor((diff % 60000) / 1000); return `in ${m}m ${String(s).padStart(2, '0')}s`; }
                                            if (diff < 3600_000) return `in ${Math.round(diff / 60_000)} min`;
                                            if (diff < 86400_000) return `in ${Math.floor(diff / 3600_000)}h ${Math.round((diff % 3600_000) / 60_000)}m`;
                                            return `in ${Math.floor(diff / 86400_000)}d`;
                                        };
                                        const label = (c) => c.instanceLabel && c.instanceLabel !== c.choreName ? `${c.choreName} — ${c.instanceLabel}` : c.choreName;
                                        return (
                                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px 16px', padding: '10px 14px', marginBottom: '12px', background: theme.colors.primaryBg, borderRadius: '8px', border: `1px solid ${theme.colors.border}`, fontSize: '0.75rem', color: theme.colors.secondaryText, alignItems: 'center' }}>
                                                <span style={{ fontWeight: '600', color: theme.colors.primaryText, fontSize: '0.75rem', marginRight: '2px' }}>Schedule</span>
                                                {upcoming.map(c => {
                                                    const isPast = c._ms <= nowMs;
                                                    return (
                                                        <span key={c.choreId} style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', cursor: 'pointer', padding: '2px 0' }}
                                                            onClick={() => { setChoreActiveTab(c.choreTypeId || c.choreId); setChoreActiveInstance(c.choreId); }}>
                                                            <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: c._isRunning ? '#22c55e' : isPast ? '#ef4444' : '#3b82f6', flexShrink: 0, ...(c._isRunning ? { animation: 'pulse 1.5s ease-in-out infinite' } : {}) }} />
                                                            <span style={{ color: theme.colors.primaryText, fontWeight: '500' }}>{label(c)}</span>
                                                            <span style={{ color: c._isRunning ? '#22c55e' : isPast ? '#ef4444' : theme.colors.mutedText, fontStyle: c._isRunning ? 'italic' : 'normal' }}>
                                                                {c._isRunning ? 'running' : formatRel(c._ms)}
                                                            </span>
                                                        </span>
                                                    );
                                                })}
                                            </div>
                                        );
                                    })()}

                                    {/* Chore Type Tabs & Instances */}
                                    {(choreStatuses.length > 0 || choreTypes.length > 0) && (() => {
                                        const choreTypeMap = {};
                                        let choreTypeOrder = [];
                                        // Populate from choreTypes first (preserves registered order, includes zero-instance types)
                                        choreTypes.forEach(ct => {
                                            if (!choreTypeMap[ct.id]) {
                                                choreTypeMap[ct.id] = { typeId: ct.id, typeName: ct.name, description: ct.description, instances: [] };
                                                choreTypeOrder.push(ct.id);
                                            }
                                        });
                                        // Add instance data from choreStatuses
                                        choreStatuses.forEach(chore => {
                                            const tid = chore.choreTypeId || chore.choreId;
                                            if (!choreTypeMap[tid]) { choreTypeMap[tid] = { typeId: tid, typeName: chore.choreName, instances: [] }; choreTypeOrder.push(tid); }
                                            choreTypeMap[tid].instances.push(chore);
                                        });
                                        if (preferredChoreTypeOrder) {
                                            choreTypeOrder.sort((a, b) => {
                                                const ai = preferredChoreTypeOrder.indexOf(a);
                                                const bi = preferredChoreTypeOrder.indexOf(b);
                                                return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
                                            });
                                        }
                                        const activeTypeId = choreTypeMap[choreActiveTab] ? choreActiveTab : choreTypeOrder[0];
                                        const activeType = choreTypeMap[activeTypeId];
                                        const instances = activeType?.instances || [];
                                        const activeInstanceId = choreActiveInstance && instances.find(i => i.choreId === choreActiveInstance) ? choreActiveInstance : instances[0]?.choreId;
                                        const activeChore = instances.find(i => i.choreId === activeInstanceId);
                                        return (
                                            <>
                                                {/* Type tabs */}
                                                <div style={{ display: 'flex', flexWrap: 'wrap', marginBottom: instances.length > 0 ? '0' : '12px', gap: '0' }}>
                                                    {choreTypeOrder.map(tid => {
                                                        const type = choreTypeMap[tid];
                                                        const worst = type.instances.reduce((w, i) => {
                                                            const l = getChoreSummaryLamp(i, cbEvents);
                                                            const p = { error: 4, warn: 3, active: 2, ok: 1, off: 0 };
                                                            return (p[l] || 0) > (p[w] || 0) ? l : w;
                                                        }, 'off');
                                                        return (
                                                            <button key={tid} style={{ ...tabStyle(activeTypeId === tid), fontSize: '0.8rem', padding: '0.45rem 0.8rem', display: 'inline-flex', alignItems: 'center', gap: '6px' }}
                                                                onClick={() => { setChoreActiveTab(tid); setChoreActiveInstance(null); }}>
                                                                <StatusLamp state={worst} size={8} label={getSummaryLabel(worst, type.typeName)} />
                                                                {type.typeName}{type.instances.length > 1 ? ` (${type.instances.length})` : ''}
                                                            </button>
                                                        );
                                                    })}
                                                </div>

                                                {/* Instance sub-tabs (always shown when instances exist) */}
                                                {instances.length > 0 && (
                                                    <div style={{ display: 'flex', flexWrap: 'wrap', marginBottom: '12px', gap: '0', paddingLeft: '8px', borderLeft: `2px solid ${accent}30`, alignItems: 'center' }}>
                                                        {instances.map(inst => {
                                                            const isActive = activeInstanceId === inst.choreId;
                                                            const isRenaming = renamingInstance === inst.choreId;
                                                            return isRenaming ? (
                                                                <div key={inst.choreId} style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', padding: '0.2rem 0.5rem', background: `${accent}10`, borderRadius: '6px', border: `1px solid ${accent}30` }}>
                                                                    <input type="text" value={renameLabel} onChange={e => setRenameLabel(e.target.value)}
                                                                        style={{ ...inputStyle, fontSize: '0.72rem', padding: '2px 6px', width: '120px', minWidth: '80px' }}
                                                                        autoFocus onKeyDown={e => {
                                                                            if (e.key === 'Enter' && renameLabel.trim()) {
                                                                                choreAction(async (bot) => {
                                                                                    const ok = await bot.renameChoreInstance(inst.choreId, renameLabel.trim());
                                                                                    if (ok) { setChoreSuccess(`Renamed to "${renameLabel.trim()}"`); setRenamingInstance(null); }
                                                                                    else { setChoreError('Failed to rename.'); }
                                                                                });
                                                                            } else if (e.key === 'Escape') { setRenamingInstance(null); }
                                                                        }} />
                                                                    <button style={{ ...buttonStyle, fontSize: '0.6rem', padding: '1px 5px', background: accent, color: '#fff', border: 'none' }}
                                                                        disabled={!renameLabel.trim() || savingChore}
                                                                        onClick={() => choreAction(async (bot) => {
                                                                            const ok = await bot.renameChoreInstance(inst.choreId, renameLabel.trim());
                                                                            if (ok) { setChoreSuccess(`Renamed to "${renameLabel.trim()}"`); setRenamingInstance(null); }
                                                                            else { setChoreError('Failed to rename.'); }
                                                                        })}>OK</button>
                                                                    <button style={{ ...secondaryButtonStyle, fontSize: '0.6rem', padding: '1px 5px' }}
                                                                        onClick={() => setRenamingInstance(null)}>Cancel</button>
                                                                </div>
                                                            ) : (
                                                                <button key={inst.choreId} style={{ ...tabStyle(isActive), fontSize: '0.75rem', padding: '0.35rem 0.7rem', display: 'inline-flex', alignItems: 'center', gap: '5px' }}
                                                                    onClick={() => setChoreActiveInstance(inst.choreId)}
                                                                    onDoubleClick={() => { setRenamingInstance(inst.choreId); setRenameLabel(inst.instanceLabel || inst.choreName || ''); }}>
                                                                    <StatusLamp state={getChoreSummaryLamp(inst, cbEvents)} size={7} />
                                                                    {inst.instanceLabel || inst.choreName}
                                                                </button>
                                                            );
                                                        })}
                                                        {multiInstanceChoreTypes.includes(activeTypeId) && (
                                                            <button style={{ ...tabStyle(false), fontSize: '0.75rem', padding: '0.35rem 0.7rem', color: accent, fontWeight: '700' }}
                                                                onClick={() => { setCreatingInstance(true); setNewInstanceLabel(''); }} title="Add another instance">+</button>
                                                        )}
                                                    </div>
                                                )}

                                                {/* Create instance dialog (only when instances already exist — empty state card handles zero-instance case) */}
                                                {creatingInstance && instances.length > 0 && (
                                                    <div style={{ ...cardStyle, background: `${accent}08`, border: `1px solid ${accent}25`, marginBottom: '12px' }}>
                                                        <div style={{ fontSize: '0.85rem', fontWeight: '600', color: theme.colors.primaryText, marginBottom: '8px' }}>New {activeType?.typeName} Instance</div>
                                                        <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                                                            <input type="text" value={newInstanceLabel} onChange={e => setNewInstanceLabel(e.target.value)} placeholder="Instance name" style={{ ...inputStyle, flex: 1, minWidth: '180px' }} autoFocus />
                                                            <button style={{ ...buttonStyle, background: accent, color: '#fff', border: 'none', opacity: !newInstanceLabel.trim() || savingChore ? 0.5 : 1 }}
                                                                disabled={!newInstanceLabel.trim() || savingChore}
                                                                onClick={() => choreAction(async (bot) => {
                                                                    const instId = activeTypeId + '-' + Date.now().toString(36);
                                                                    const ok = await bot.createChoreInstance(activeTypeId, instId, newInstanceLabel.trim());
                                                                    if (ok) { setChoreSuccess(`Created "${newInstanceLabel.trim()}"`); setCreatingInstance(false); setChoreActiveInstance(instId); }
                                                                    else { setChoreError('Failed to create instance.'); }
                                                                })}>Create</button>
                                                            <button style={{ ...secondaryButtonStyle }} onClick={() => setCreatingInstance(false)}>Cancel</button>
                                                        </div>
                                                    </div>
                                                )}

                                                {/* Empty type — no instances yet, offer to create one */}
                                                {instances.length === 0 && activeType && (
                                                    <div style={cardStyle}>
                                                        <div style={{ textAlign: 'center', padding: '1.5rem 1rem' }}>
                                                            <div style={{ fontSize: '2rem', marginBottom: '12px' }}>📦</div>
                                                            <h3 style={{ color: theme.colors.primaryText, margin: '0 0 8px 0', fontSize: '1rem' }}>
                                                                No {activeType.typeName} instances yet
                                                            </h3>
                                                            <p style={{ color: theme.colors.secondaryText, fontSize: '0.85rem', margin: '0 0 16px 0', lineHeight: '1.5' }}>
                                                                {activeType.description || `Create your first ${activeType.typeName} instance to get started.`}
                                                            </p>
                                                            {!creatingInstance ? (
                                                                <button
                                                                    onClick={() => { setCreatingInstance(true); setNewInstanceLabel(''); }}
                                                                    style={{ ...buttonStyle, background: accent }}>
                                                                    + Create {activeType.typeName} Instance
                                                                </button>
                                                            ) : (
                                                                <div style={{ display: 'flex', gap: '8px', alignItems: 'center', justifyContent: 'center', flexWrap: 'wrap' }}>
                                                                    <input type="text" value={newInstanceLabel} onChange={e => setNewInstanceLabel(e.target.value)}
                                                                        placeholder="Instance name" style={{ ...inputStyle, maxWidth: '250px' }} autoFocus />
                                                                    <button style={{ ...buttonStyle, background: accent, opacity: !newInstanceLabel.trim() || savingChore ? 0.5 : 1 }}
                                                                        disabled={!newInstanceLabel.trim() || savingChore}
                                                                        onClick={() => choreAction(async (bot) => {
                                                                            const instId = activeTypeId + '-' + Date.now().toString(36);
                                                                            const ok = await bot.createChoreInstance(activeTypeId, instId, newInstanceLabel.trim());
                                                                            if (ok) { setChoreSuccess(`Created "${newInstanceLabel.trim()}"`); setCreatingInstance(false); setChoreActiveInstance(instId); }
                                                                            else { setChoreError('Failed to create instance.'); }
                                                                        })}>Create</button>
                                                                    <button style={secondaryButtonStyle} onClick={() => setCreatingInstance(false)}>Cancel</button>
                                                                </div>
                                                            )}
                                                        </div>
                                                    </div>
                                                )}

                                                {/* Active chore panel */}
                                                {activeChore && (() => {
                                                    const chore = activeChore;
                                                    const configEntry = choreConfigs.find(([id]) => id === chore.choreId);
                                                    const config = configEntry ? configEntry[1] : null;
                                                    const intervalSeconds = config ? Number(config.intervalSeconds) : 0;
                                                    const maxIntervalSeconds = config?.maxIntervalSeconds?.[0] != null ? Number(config.maxIntervalSeconds[0]) : null;
                                                    const fmtInt = (s) => { if (s <= 0) return '0'; if (s < 3600) return `${Math.round(s / 60)} min`; if (s < 86400) { const h = s / 3600; return Number.isInteger(h) ? `${h} hr` : `${h.toFixed(1)} hr`; } const d = s / 86400; return Number.isInteger(d) ? `${d} days` : `${d.toFixed(1)} days`; };
                                                    const schedulerLamp = getSchedulerLampState(chore, cbEvents);
                                                    const conductorLamp = getConductorLampState(chore);
                                                    const taskLamp = getTaskLampState(chore);
                                                    const isEnabled = chore.enabled;
                                                    const isPaused = chore.paused;
                                                    const isStopped = !isEnabled;
                                                    const isRunning = !('Idle' in chore.conductorStatus);
                                                    const fmtTime = (nsOpt) => { if (!nsOpt || nsOpt.length === 0) return '—'; const ms = Number(nsOpt[0]) / 1_000_000; return ms <= 0 ? '—' : new Date(ms).toLocaleString(); };

                                                    // bestUnit helper for interval display with unit selector
                                                    const bestUnit = (secs) => {
                                                        if (secs <= 0) return { value: 0, unit: 'minutes' };
                                                        if (secs % 86400 === 0 && secs >= 86400) return { value: secs / 86400, unit: 'days' };
                                                        if (secs % 3600 === 0 && secs >= 3600) return { value: secs / 3600, unit: 'hours' };
                                                        return { value: Math.round(secs / 60), unit: 'minutes' };
                                                    };
                                                    const currentBest = bestUnit(intervalSeconds);
                                                    const unitMultipliers = { minutes: 60, hours: 3600, days: 86400 };
                                                    const hasRange = maxIntervalSeconds != null && maxIntervalSeconds > intervalSeconds;

                                                    return (
                                                        <div key={chore.choreId}>
                                                            {/* Description */}
                                                            <div style={{ ...cardStyle, background: `linear-gradient(135deg, ${accent}06, ${accentSec}04)`, border: `1px solid ${accent}15` }}>
                                                                <p style={{ margin: 0, fontSize: '0.85rem', color: theme.colors.secondaryText, lineHeight: '1.5' }}>{chore.choreDescription}</p>
                                                            </div>

                                                            {/* Status */}
                                                            <div style={cardStyle}>
                                                                <h3 style={{ color: theme.colors.primaryText, margin: '0 0 12px 0', fontSize: '0.95rem', fontWeight: '600' }}>Status</h3>
                                                                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '10px' }}>
                                                                    <div style={{ padding: '10px', background: theme.colors.primaryBg, borderRadius: '8px', border: `1px solid ${theme.colors.border}`, minHeight: '52px' }}>
                                                                        <div style={{ fontSize: '0.75rem', color: theme.colors.secondaryText, marginBottom: '4px' }}>State</div>
                                                                        <div style={{ fontSize: '0.9rem', fontWeight: '600', color: isStopped ? theme.colors.secondaryText : isPaused ? '#f59e0b' : '#22c55e' }}>
                                                                            {isStopped ? 'Stopped' : isPaused ? 'Paused' : 'Running'}
                                                                        </div>
                                                                    </div>
                                                                    {[['Scheduler', schedulerLamp], ['Conductor', conductorLamp], ['Task', taskLamp]].map(([name, lamp]) => (
                                                                        <div key={name} style={{ padding: '10px', background: theme.colors.primaryBg, borderRadius: '8px', border: `1px solid ${theme.colors.border}`, minHeight: '52px' }}>
                                                                            <div style={{ fontSize: '0.75rem', color: theme.colors.secondaryText, marginBottom: '4px' }}>{name}</div>
                                                                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                                                                <StatusLamp state={lamp.state} size={10} label={lamp.label} />
                                                                                <span style={{ fontSize: '0.9rem', color: LAMP_COLORS[lamp.state], fontWeight: '500',
                                                                                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '100%' }}
                                                                                    title={lamp.label}>{lamp.label}</span>
                                                                            </div>
                                                                        </div>
                                                                    ))}
                                                                    <div style={{ padding: '10px', background: theme.colors.primaryBg, borderRadius: '8px', border: `1px solid ${theme.colors.border}` }}>
                                                                        <div style={{ fontSize: '0.75rem', color: theme.colors.secondaryText, marginBottom: '4px' }}>Interval</div>
                                                                        <div style={{ fontSize: '0.9rem', color: theme.colors.primaryText, fontWeight: '500' }}>
                                                                            {hasRange ? `${fmtInt(intervalSeconds)}–${fmtInt(maxIntervalSeconds)}` : fmtInt(intervalSeconds)}
                                                                        </div>
                                                                    </div>
                                                                    <div style={{ padding: '10px', background: theme.colors.primaryBg, borderRadius: '8px', border: `1px solid ${theme.colors.border}` }}>
                                                                        <div style={{ fontSize: '0.75rem', color: theme.colors.secondaryText, marginBottom: '4px' }}>Next Scheduled Run</div>
                                                                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                                                                            <div style={{ fontSize: '0.85rem', color: theme.colors.primaryText, fontWeight: '500' }}>{fmtTime(chore.nextScheduledRunAt)}</div>
                                                                            {chore.enabled && (
                                                                                <button
                                                                                    style={{ background: 'none', border: `1px solid ${theme.colors.border}`, borderRadius: '4px', fontSize: '0.65rem', color: theme.colors.secondaryText, cursor: 'pointer', padding: '2px 6px' }}
                                                                                    title="Set next scheduled run time"
                                                                                    onClick={() => {
                                                                                        const el = document.getElementById(`next-run-picker-${chore.choreId}`);
                                                                                        if (el) { el.style.display = el.style.display === 'none' ? 'flex' : 'none'; }
                                                                                    }}
                                                                                >Set</button>
                                                                            )}
                                                                        </div>
                                                                        {chore.enabled && (
                                                                            <div id={`next-run-picker-${chore.choreId}`} style={{ display: 'none', marginTop: '6px', gap: '6px', alignItems: 'center', flexWrap: 'wrap' }}>
                                                                                <input
                                                                                    type="datetime-local"
                                                                                    id={`next-run-input-${chore.choreId}`}
                                                                                    style={{ ...inputStyle, fontSize: '0.75rem', width: '200px' }}
                                                                                    defaultValue={(() => {
                                                                                        const ns = chore.nextScheduledRunAt?.length > 0 ? Number(chore.nextScheduledRunAt[0]) : Date.now() * 1_000_000;
                                                                                        const d = new Date(ns / 1_000_000);
                                                                                        const pad = (n) => String(n).padStart(2, '0');
                                                                                        return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
                                                                                    })()}
                                                                                />
                                                                                <button
                                                                                    style={{ ...buttonStyle, fontSize: '0.7rem', padding: '4px 10px', background: `${accent}10`, color: accent, border: `1px solid ${accent}25` }}
                                                                                    disabled={savingChore}
                                                                                    onClick={async () => {
                                                                                        const input = document.getElementById(`next-run-input-${chore.choreId}`);
                                                                                        if (!input?.value) return;
                                                                                        const tsNanos = BigInt(new Date(input.value).getTime()) * 1_000_000n;
                                                                                        setSavingChore(true);
                                                                                        setChoreError('');
                                                                                        try {
                                                                                            const bot = await getReadyBotActor();
                                                                                            await bot.setChoreNextRun(chore.choreId, tsNanos);
                                                                                            setChoreStatuses(prev => prev.map(s =>
                                                                                                s.choreId === chore.choreId
                                                                                                    ? { ...s, nextScheduledRunAt: [tsNanos] }
                                                                                                    : s
                                                                                            ));
                                                                                            setChoreSuccess('Next run time updated.');
                                                                                            const el = document.getElementById(`next-run-picker-${chore.choreId}`);
                                                                                            if (el) el.style.display = 'none';
                                                                                            await loadChoreData(true);
                                                                                        } catch (err) {
                                                                                            setChoreError('Failed to set next run: ' + err.message);
                                                                                        } finally {
                                                                                            setSavingChore(false);
                                                                                        }
                                                                                    }}
                                                                                >Save</button>
                                                                            </div>
                                                                        )}
                                                                    </div>
                                                                    <div style={{ padding: '10px', background: theme.colors.primaryBg, borderRadius: '8px', border: `1px solid ${theme.colors.border}` }}>
                                                                        <div style={{ fontSize: '0.75rem', color: theme.colors.secondaryText, marginBottom: '4px' }}>Last Completed</div>
                                                                        <div style={{ fontSize: '0.85rem', color: theme.colors.primaryText, fontWeight: '500' }}>{fmtTime(chore.lastCompletedRunAt)}</div>
                                                                    </div>
                                                                    <div style={{ padding: '10px', background: theme.colors.primaryBg, borderRadius: '8px', border: `1px solid ${theme.colors.border}` }}>
                                                                        <div style={{ fontSize: '0.75rem', color: theme.colors.secondaryText, marginBottom: '4px' }}>Runs (Success / Fail)</div>
                                                                        <div style={{ fontSize: '0.9rem', color: theme.colors.primaryText, fontWeight: '500' }}>
                                                                            {Number(chore.totalSuccessCount)} / {Number(chore.totalFailureCount)}
                                                                        </div>
                                                                    </div>
                                                                </div>

                                                                {/* Last error display */}
                                                                {chore.lastError && chore.lastError.length > 0 && (
                                                                    <div style={{
                                                                        marginTop: '10px', padding: '10px',
                                                                        background: `${theme.colors.error || '#ef4444'}10`,
                                                                        border: `1px solid ${theme.colors.error || '#ef4444'}25`,
                                                                        borderRadius: '8px', fontSize: '0.8rem',
                                                                        color: theme.colors.error || '#ef4444',
                                                                    }}>
                                                                        <strong>Last error:</strong> {chore.lastError[0]}
                                                                        {chore.lastErrorAt && chore.lastErrorAt.length > 0 && (
                                                                            <span style={{ opacity: 0.7 }}> ({fmtTime(chore.lastErrorAt)})</span>
                                                                        )}
                                                                    </div>
                                                                )}

                                                                {/* Current task info (when running) */}
                                                                {chore.currentTaskId && chore.currentTaskId.length > 0 && (
                                                                    <div style={{
                                                                        marginTop: '10px', padding: '10px',
                                                                        background: `${accent}10`,
                                                                        border: `1px solid ${accent}25`,
                                                                        borderRadius: '8px', fontSize: '0.8rem',
                                                                        color: theme.colors.primaryText,
                                                                    }}>
                                                                        <strong>Current task:</strong> {chore.currentTaskId[0]}
                                                                        {chore.taskStartedAt && chore.taskStartedAt.length > 0 && (
                                                                            <span style={{ opacity: 0.7 }}> (started {fmtTime(chore.taskStartedAt)})</span>
                                                                        )}
                                                                    </div>
                                                                )}
                                                            </div>

                                                            {/* Controls */}
                                                            <div style={cardStyle}>
                                                                <h3 style={{ color: theme.colors.primaryText, margin: '0 0 12px 0', fontSize: '0.95rem', fontWeight: '600' }}>Controls</h3>
                                                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginBottom: '16px' }}>
                                                                    {/* Start (split button with schedule-start dropdown) — shown when Stopped */}
                                                                    {isStopped && (
                                                                    <div style={{ display: 'inline-flex', position: 'relative' }}>
                                                                        <button
                                                                            style={{
                                                                                ...buttonStyle,
                                                                                background: `linear-gradient(135deg, ${accent}, ${accentSec})`,
                                                                                color: '#fff', border: 'none',
                                                                                borderRadius: '8px 0 0 8px',
                                                                                opacity: savingChore ? 0.6 : 1,
                                                                            }}
                                                                            disabled={savingChore}
                                                                            onClick={async () => {
                                                                                setSavingChore(true); setChoreError(''); setChoreSuccess('');
                                                                                try {
                                                                                    const bot = await getReadyBotActor();
                                                                                    await bot.startChore(chore.choreId);
                                                                                    setChoreSuccess('Chore started! Running now and scheduled for next interval.');
                                                                                    await loadChoreData(true);
                                                                                    startChorePolling();
                                                                                } catch (err) { setChoreError('Failed to start: ' + err.message); }
                                                                                finally { setSavingChore(false); }
                                                                            }}
                                                                        >Start</button>
                                                                        <button
                                                                            style={{
                                                                                ...buttonStyle,
                                                                                background: `linear-gradient(135deg, ${accent}, ${accentSec})`,
                                                                                color: '#fff', border: 'none',
                                                                                borderLeft: '1px solid rgba(255,255,255,0.3)',
                                                                                borderRadius: '0 8px 8px 0',
                                                                                padding: '0.4rem 0.45rem', minWidth: 'unset',
                                                                                opacity: savingChore ? 0.6 : 1,
                                                                            }}
                                                                            disabled={savingChore}
                                                                            title="Schedule start at a specific time"
                                                                            onClick={() => {
                                                                                const el = document.getElementById(`schedule-start-panel-${chore.choreId}`);
                                                                                if (el) el.style.display = el.style.display === 'none' ? 'flex' : 'none';
                                                                            }}
                                                                        >
                                                                            <span style={{ fontSize: '0.6rem' }}>&#9660;</span>
                                                                        </button>
                                                                    </div>
                                                                    )}

                                                                    {/* Pause — shown when Running (enabled, not paused) */}
                                                                    {isEnabled && !isPaused && (
                                                                    <button
                                                                        style={{ ...buttonStyle, background: '#f59e0b15', color: '#f59e0b', border: '1px solid #f59e0b40', opacity: savingChore ? 0.6 : 1 }}
                                                                        disabled={savingChore}
                                                                        onClick={async () => {
                                                                            setSavingChore(true); setChoreError(''); setChoreSuccess('');
                                                                            try {
                                                                                const bot = await getReadyBotActor();
                                                                                await bot.pauseChore(chore.choreId);
                                                                                setChoreSuccess('Chore paused. Schedule preserved — resume to continue.');
                                                                                await loadChoreData(true);
                                                                            } catch (err) { setChoreError('Failed to pause: ' + err.message); }
                                                                            finally { setSavingChore(false); }
                                                                        }}
                                                                    >Pause</button>
                                                                    )}

                                                                    {/* Resume — shown when Paused */}
                                                                    {isPaused && (
                                                                    <button
                                                                        style={{ ...buttonStyle, background: `linear-gradient(135deg, ${accent}, ${accentSec})`, color: '#fff', border: 'none', opacity: savingChore ? 0.6 : 1 }}
                                                                        disabled={savingChore}
                                                                        onClick={async () => {
                                                                            setSavingChore(true); setChoreError(''); setChoreSuccess('');
                                                                            try {
                                                                                const bot = await getReadyBotActor();
                                                                                await bot.resumeChore(chore.choreId);
                                                                                setChoreSuccess('Chore resumed! Schedule re-activated.');
                                                                                await loadChoreData(true);
                                                                                startChorePolling();
                                                                            } catch (err) { setChoreError('Failed to resume: ' + err.message); }
                                                                            finally { setSavingChore(false); }
                                                                        }}
                                                                    >Resume</button>
                                                                    )}

                                                                    {/* Stop — shown when Running or Paused */}
                                                                    {isEnabled && (
                                                                    <button
                                                                        style={{ ...buttonStyle, background: `${theme.colors.error || '#ef4444'}15`, color: theme.colors.error || '#ef4444', border: `1px solid ${theme.colors.error || '#ef4444'}30`, opacity: savingChore ? 0.6 : 1 }}
                                                                        disabled={savingChore}
                                                                        onClick={async () => {
                                                                            setSavingChore(true); setChoreError(''); setChoreSuccess('');
                                                                            try {
                                                                                const bot = await getReadyBotActor();
                                                                                await bot.stopChore(chore.choreId);
                                                                                setChoreSuccess('Chore stopped. Schedule cleared.');
                                                                                await loadChoreData(true);
                                                                            } catch (err) { setChoreError('Failed to stop: ' + err.message); }
                                                                            finally { setSavingChore(false); }
                                                                        }}
                                                                    >Stop</button>
                                                                    )}

                                                                    {/* Run Once (when stopped) / Run Now (when enabled+idle) */}
                                                                    {!isRunning && (
                                                                    <button
                                                                        style={{ ...buttonStyle, background: `${accent}15`, color: accent, border: `1px solid ${accent}30`, opacity: savingChore ? 0.6 : 1 }}
                                                                        disabled={savingChore}
                                                                        onClick={async () => {
                                                                            setSavingChore(true); setChoreError(''); setChoreSuccess('');
                                                                            try {
                                                                                const bot = await getReadyBotActor();
                                                                                await bot.triggerChore(chore.choreId);
                                                                                setChoreSuccess(isStopped
                                                                                    ? 'Chore triggered once. It will run without enabling the schedule.'
                                                                                    : 'Chore triggered manually. It will start running shortly.');
                                                                                await loadChoreData(true);
                                                                                startChorePolling();
                                                                            } catch (err) { setChoreError('Failed to trigger: ' + err.message); }
                                                                            finally { setSavingChore(false); }
                                                                        }}
                                                                    >{isStopped ? 'Run Once' : 'Run Now'}</button>
                                                                    )}

                                                                    {/* Delete — shown when Stopped, requires confirmation */}
                                                                    {isStopped && (
                                                                        confirmingDelete === chore.choreId ? (
                                                                            <div style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '4px 10px', background: '#ef444412', borderRadius: '8px', border: '1px solid #ef444430' }}>
                                                                                <span style={{ fontSize: '0.75rem', color: '#ef4444' }}>Delete this instance?</span>
                                                                                <button
                                                                                    style={{ ...buttonStyle, fontSize: '0.7rem', padding: '2px 8px', background: '#ef4444', color: '#fff', border: 'none' }}
                                                                                    disabled={savingChore}
                                                                                    onClick={async () => {
                                                                                        setSavingChore(true); setChoreError(''); setChoreSuccess('');
                                                                                        try {
                                                                                            const bot = await getReadyBotActor();
                                                                                            const ok = await bot.deleteChoreInstance(chore.choreId);
                                                                                            if (ok) {
                                                                                                setChoreSuccess(`Deleted "${chore.instanceLabel || chore.choreName}".`);
                                                                                                setChoreActiveInstance(null);
                                                                                            } else { setChoreError('Failed to delete instance.'); }
                                                                                            setConfirmingDelete(null);
                                                                                            await loadChoreData(true);
                                                                                        } catch (err) { setChoreError('Failed to delete: ' + err.message); }
                                                                                        finally { setSavingChore(false); }
                                                                                    }}
                                                                                >Confirm</button>
                                                                                <button style={{ ...secondaryButtonStyle, fontSize: '0.7rem', padding: '2px 8px' }}
                                                                                    onClick={() => setConfirmingDelete(null)}>Cancel</button>
                                                                            </div>
                                                                        ) : (
                                                                            <button
                                                                                style={{ ...buttonStyle, background: '#ef444410', color: '#ef4444', border: '1px solid #ef444425', opacity: savingChore ? 0.6 : 1, display: 'inline-flex', alignItems: 'center', gap: '4px' }}
                                                                                disabled={savingChore}
                                                                                onClick={() => setConfirmingDelete(chore.choreId)}
                                                                            ><FaTrash style={{ fontSize: '0.6rem' }} /> Delete</button>
                                                                        )
                                                                    )}
                                                                </div>

                                                                {/* Schedule Start panel — shown when user clicks dropdown arrow on Start button */}
                                                                {isStopped && (
                                                                <div id={`schedule-start-panel-${chore.choreId}`} style={{ display: 'none', marginTop: '8px', padding: '10px', background: `${accent}06`, border: `1px solid ${accent}20`, borderRadius: '8px', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                                                                    <span style={{ fontSize: '0.8rem', color: theme.colors.secondaryText, marginRight: '4px' }}>Schedule first run at:</span>
                                                                    <input
                                                                        type="datetime-local"
                                                                        id={`schedule-start-input-${chore.choreId}`}
                                                                        style={{ ...inputStyle, fontSize: '0.8rem', padding: '0.35rem 0.5rem', width: 'auto' }}
                                                                    />
                                                                    <button
                                                                        style={{ ...buttonStyle, background: `linear-gradient(135deg, ${accent}, ${accentSec})`, color: '#fff', border: 'none', fontSize: '0.8rem', opacity: savingChore ? 0.6 : 1 }}
                                                                        disabled={savingChore}
                                                                        onClick={async () => {
                                                                            const input = document.getElementById(`schedule-start-input-${chore.choreId}`);
                                                                            if (!input?.value) { setChoreError('Please select a date and time.'); return; }
                                                                            const selectedTime = new Date(input.value).getTime();
                                                                            if (selectedTime <= Date.now()) { setChoreError('Scheduled time must be in the future.'); return; }
                                                                            const tsNanos = BigInt(selectedTime) * 1_000_000n;
                                                                            setSavingChore(true); setChoreError(''); setChoreSuccess('');
                                                                            try {
                                                                                const bot = await getReadyBotActor();
                                                                                await bot.scheduleStartChore(chore.choreId, tsNanos);
                                                                                setChoreSuccess('Chore scheduled! First run at ' + new Date(selectedTime).toLocaleString());
                                                                                const el = document.getElementById(`schedule-start-panel-${chore.choreId}`);
                                                                                if (el) el.style.display = 'none';
                                                                                await loadChoreData(true);
                                                                                startChorePolling();
                                                                            } catch (err) { setChoreError('Failed to schedule start: ' + err.message); }
                                                                            finally { setSavingChore(false); }
                                                                        }}
                                                                    >Confirm</button>
                                                                    <button
                                                                        style={{ ...buttonStyle, background: 'transparent', color: theme.colors.secondaryText, border: `1px solid ${theme.colors.border}`, fontSize: '0.8rem' }}
                                                                        onClick={() => { const el = document.getElementById(`schedule-start-panel-${chore.choreId}`); if (el) el.style.display = 'none'; }}
                                                                    >Cancel</button>
                                                                </div>
                                                                )}

                                                                {/* Frequency / Interval Setting with unit selector */}
                                                                <div style={{ marginTop: '8px' }}>
                                                                    <label style={{ fontSize: '0.8rem', color: theme.colors.secondaryText, display: 'block', marginBottom: '6px' }}>
                                                                        Frequency:
                                                                    </label>
                                                                    <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                                                                        <span style={{ fontSize: '0.8rem', color: theme.colors.secondaryText }}>Every</span>
                                                                        <input
                                                                            type="text"
                                                                            inputMode="numeric"
                                                                            defaultValue={currentBest.value}
                                                                            style={{ ...inputStyle, width: '70px' }}
                                                                            id={`chore-interval-${chore.choreId}`}
                                                                        />
                                                                        <select
                                                                            id={`chore-interval-unit-${chore.choreId}`}
                                                                            defaultValue={currentBest.unit}
                                                                            style={{ ...inputStyle, width: 'auto', padding: '4px 8px', cursor: 'pointer', appearance: 'auto' }}
                                                                        >
                                                                            <option value="minutes">minutes</option>
                                                                            <option value="hours">hours</option>
                                                                            <option value="days">days</option>
                                                                        </select>
                                                                        <button
                                                                            style={{ ...buttonStyle, background: `${accent}10`, color: accent, border: `1px solid ${accent}25`, opacity: savingChore ? 0.6 : 1 }}
                                                                            disabled={savingChore}
                                                                            onClick={async () => {
                                                                                const valInput = document.getElementById(`chore-interval-${chore.choreId}`);
                                                                                const unitSelect = document.getElementById(`chore-interval-unit-${chore.choreId}`);
                                                                                const val = parseFloat(valInput?.value);
                                                                                const unit = unitSelect?.value || 'days';
                                                                                const multiplier = unitMultipliers[unit] || 86400;
                                                                                const totalSeconds = Math.round(val * multiplier);
                                                                                if (!val || val <= 0 || totalSeconds < 60) { setChoreError('Interval must be at least 1 minute.'); return; }
                                                                                if (totalSeconds > 365 * 86400) { setChoreError('Interval cannot exceed 365 days.'); return; }
                                                                                // Also handle the optional max interval if the range section is open
                                                                                const maxInput = document.getElementById(`chore-max-interval-${chore.choreId}`);
                                                                                const maxUnitSelect = document.getElementById(`chore-max-interval-unit-${chore.choreId}`);
                                                                                let maxSeconds = null;
                                                                                if (maxInput && maxUnitSelect) {
                                                                                    const maxVal = parseFloat(maxInput.value?.trim());
                                                                                    if (maxVal && maxVal > 0) {
                                                                                        const maxMult = unitMultipliers[maxUnitSelect.value] || 86400;
                                                                                        maxSeconds = Math.round(maxVal * maxMult);
                                                                                        if (maxSeconds <= totalSeconds) { setChoreError('Max interval must be greater than the base interval.'); return; }
                                                                                        if (maxSeconds > 365 * 86400) { setChoreError('Max interval cannot exceed 365 days.'); return; }
                                                                                    }
                                                                                }
                                                                                setSavingChore(true); setChoreError(''); setChoreSuccess('');
                                                                                try {
                                                                                    const bot = await getReadyBotActor();
                                                                                    await bot.setChoreInterval(chore.choreId, BigInt(totalSeconds));
                                                                                    await bot.setChoreMaxInterval(chore.choreId, maxSeconds !== null ? [BigInt(maxSeconds)] : []);
                                                                                    const msg = maxSeconds !== null
                                                                                        ? `Interval updated to ${fmtInt(totalSeconds)}–${fmtInt(maxSeconds)} (randomized).`
                                                                                        : `Interval updated to ${fmtInt(totalSeconds)}.`;
                                                                                    setChoreSuccess(msg);
                                                                                    await loadChoreData(true);
                                                                                } catch (err) { setChoreError('Failed to update interval: ' + err.message); }
                                                                                finally { setSavingChore(false); }
                                                                            }}
                                                                        >Save</button>
                                                                    </div>

                                                                    {/* Randomized range — collapsed by default, toggle to expand */}
                                                                    <div style={{ marginTop: '6px' }}>
                                                                        <button
                                                                            style={{
                                                                                background: 'none', border: 'none', padding: 0,
                                                                                fontSize: '0.7rem', color: theme.colors.mutedText,
                                                                                cursor: 'pointer', textDecoration: 'underline', textDecorationStyle: 'dotted',
                                                                            }}
                                                                            onClick={() => {
                                                                                const el = document.getElementById(`chore-range-panel-${chore.choreId}`);
                                                                                if (el) el.style.display = el.style.display === 'none' ? 'flex' : 'none';
                                                                            }}
                                                                        >
                                                                            {hasRange ? `Randomized range active (up to ${fmtInt(maxIntervalSeconds)}) — edit` : 'Randomize interval...'}
                                                                        </button>
                                                                        <div
                                                                            id={`chore-range-panel-${chore.choreId}`}
                                                                            style={{ display: hasRange ? 'flex' : 'none', marginTop: '6px', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}
                                                                        >
                                                                            <span style={{ fontSize: '0.75rem', color: theme.colors.secondaryText }}>Max:</span>
                                                                            <input
                                                                                type="text"
                                                                                inputMode="numeric"
                                                                                defaultValue={maxIntervalSeconds != null ? bestUnit(maxIntervalSeconds).value : ''}
                                                                                placeholder="none"
                                                                                style={{ ...inputStyle, width: '70px', fontSize: '0.8rem' }}
                                                                                id={`chore-max-interval-${chore.choreId}`}
                                                                                title="Optional max interval for randomized scheduling. Clear to use exact interval."
                                                                            />
                                                                            <select
                                                                                id={`chore-max-interval-unit-${chore.choreId}`}
                                                                                defaultValue={maxIntervalSeconds != null ? bestUnit(maxIntervalSeconds).unit : currentBest.unit}
                                                                                style={{ ...inputStyle, width: 'auto', padding: '4px 8px', fontSize: '0.8rem', cursor: 'pointer', appearance: 'auto' }}
                                                                            >
                                                                                <option value="minutes">minutes</option>
                                                                                <option value="hours">hours</option>
                                                                                <option value="days">days</option>
                                                                            </select>
                                                                            <span style={{ fontSize: '0.65rem', color: theme.colors.mutedText }}>(clear to disable)</span>
                                                                        </div>
                                                                    </div>
                                                                </div>
                                                            </div>

                                                            {/* Custom chore config (render prop) */}
                                                            {renderChoreConfig && renderChoreConfig({
                                                                chore, config, choreId: chore.choreId,
                                                                choreTypeId: chore.choreTypeId || chore.choreId,
                                                                instanceId: chore.choreId,
                                                                getReadyBotActor,
                                                                savingChore, setSavingChore,
                                                                choreError, setChoreError, choreSuccess, setChoreSuccess,
                                                                loadChoreData: () => loadChoreData(true),
                                                                theme, accentColor: accent, cardStyle, inputStyle, buttonStyle, secondaryButtonStyle,
                                                                getAgent, createBotActor, canisterId,
                                                            })}
                                                        </div>
                                                    );
                                                })()}
                                            </>
                                        );
                                    })()}

                                    {choreStatuses.length === 0 && choreTypes.length === 0 && (
                                        <div style={{ ...cardStyle, textAlign: 'center', color: theme.colors.secondaryText, fontSize: '0.85rem' }}>
                                            No chores configured for this bot.
                                        </div>
                                    )}
                                </>
                            )}
                        </div>
                    )}

                    {/* ==================== LOG TAB ==================== */}
                    {activeTab === 'log' && (() => {
                        const LOG_LEVELS = ['Error', 'Warning', 'Info', 'Debug', 'Trace'];
                        const LOG_LEVEL_COLORS = { Error: '#ef4444', Warning: '#f59e0b', Info: '#3b82f6', Debug: '#8b5cf6', Trace: '#6b7280' };
                        const LOG_LEVEL_ORDER = { Error: 1, Warning: 2, Info: 3, Debug: 4, Trace: 5 };
                        const selectedLevelKey = logFilter.minLevel.length > 0 ? Object.keys(logFilter.minLevel[0])[0] : null;
                        const selectedLevelNum = selectedLevelKey ? LOG_LEVEL_ORDER[selectedLevelKey] : null;
                        const pageSize = Number(logFilter.limit.length > 0 ? logFilter.limit[0] : 50n);
                        const isFirstPage = logFilter.startId.length === 0;

                        return (
                            <div>
                                {loadingLogs && !logEntries.length ? (
                                    <div style={{ textAlign: 'center', padding: '2rem', color: theme.colors.secondaryText }}>Loading log data...</div>
                                ) : (
                                    <>
                                        <div style={{ ...cardStyle, background: `linear-gradient(135deg, ${accent}08, ${accentSec}05)`, border: `1px solid ${accent}20` }}>
                                            <p style={{ margin: 0, fontSize: '0.85rem', color: theme.colors.secondaryText, lineHeight: '1.5' }}>
                                                Bot Log records all activity — API calls, chore actions, permission changes, and errors.
                                                {logConfig && <> Currently storing <strong>{Number(logConfig.entryCount).toLocaleString()}</strong> of {Number(logConfig.maxEntries).toLocaleString()} max entries at <strong>{Object.keys(logConfig.logLevel)[0]}</strong> write level.</>}
                                            </p>
                                        </div>

                                        {/* Unseen log alerts banner */}
                                        {logAlertSummary && (logAlertSummary.unseenErrorCount > 0 || logAlertSummary.unseenWarningCount > 0) && (() => {
                                            const alertColor = logAlertSummary.unseenErrorCount > 0 ? '#ef4444' : '#f59e0b';
                                            const filterLevel = logAlertSummary.unseenErrorCount > 0 ? 'Error' : 'Warning';
                                            return (
                                                <div style={{
                                                    ...cardStyle,
                                                    background: `linear-gradient(135deg, ${alertColor}18, ${alertColor}08)`,
                                                    border: `1px solid ${alertColor}30`,
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    justifyContent: 'space-between',
                                                    gap: '12px',
                                                }}>
                                                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.85rem', flex: 1 }}>
                                                        <span style={{ color: alertColor, fontSize: '1rem', fontWeight: '700' }}>!</span>
                                                        <span style={{ color: theme.colors.primaryText }}>
                                                            {logAlertSummary.unseenErrorCount > 0 && (
                                                                <strong style={{ color: '#ef4444' }}>{logAlertSummary.unseenErrorCount} unseen error{logAlertSummary.unseenErrorCount !== 1 ? 's' : ''}</strong>
                                                            )}
                                                            {logAlertSummary.unseenErrorCount > 0 && logAlertSummary.unseenWarningCount > 0 && ', '}
                                                            {logAlertSummary.unseenWarningCount > 0 && (
                                                                <strong style={{ color: '#f59e0b' }}>{logAlertSummary.unseenWarningCount} unseen warning{logAlertSummary.unseenWarningCount !== 1 ? 's' : ''}</strong>
                                                            )}
                                                        </span>
                                                    </div>
                                                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0 }}>
                                                        <button
                                                            onClick={() => {
                                                                const nf = { ...logFilter, minLevel: [{ [filterLevel]: null }], startId: [] };
                                                                setLogFilter(nf);
                                                                loadLogData(nf);
                                                            }}
                                                            style={{
                                                                padding: '4px 12px', borderRadius: '6px',
                                                                border: `1px solid ${alertColor}40`,
                                                                background: `${alertColor}15`,
                                                                color: alertColor, fontSize: '0.75rem',
                                                                cursor: 'pointer', fontWeight: '600', whiteSpace: 'nowrap',
                                                            }}
                                                        >
                                                            Show
                                                        </button>
                                                        <button
                                                            onClick={handleMarkLogsSeen}
                                                            disabled={markingLogsSeen}
                                                            style={{
                                                                padding: '4px 12px', borderRadius: '6px',
                                                                border: `1px solid ${theme.colors.border}`,
                                                                background: 'transparent',
                                                                color: theme.colors.primaryText, fontSize: '0.75rem',
                                                                cursor: 'pointer', fontWeight: '500', whiteSpace: 'nowrap',
                                                                opacity: markingLogsSeen ? 0.5 : 1,
                                                            }}
                                                        >
                                                            {markingLogsSeen ? 'Marking...' : 'Mark as seen'}
                                                        </button>
                                                    </div>
                                                </div>
                                            );
                                        })()}

                                        {logError && <div style={{ ...cardStyle, background: `${theme.colors.error}15`, border: `1px solid ${theme.colors.error}30`, color: theme.colors.error, fontSize: '0.85rem' }}>{logError}</div>}
                                        {logSuccess && <div style={{ ...cardStyle, background: `${theme.colors.success || '#22c55e'}15`, border: `1px solid ${theme.colors.success || '#22c55e'}30`, color: theme.colors.success || '#22c55e', fontSize: '0.85rem' }}>{logSuccess}</div>}

                                        {/* Toolbar */}
                                        <div style={{ ...cardStyle, padding: '0.75rem 1rem' }}>
                                            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '8px' }}>
                                                <span style={{ fontSize: '0.8rem', color: theme.colors.mutedText }}>Show:</span>
                                                {LOG_LEVELS.map(lvl => {
                                                    const lvlNum = LOG_LEVEL_ORDER[lvl];
                                                    const isIncluded = selectedLevelNum !== null && lvlNum <= selectedLevelNum;
                                                    const isThreshold = selectedLevelKey === lvl;
                                                    const color = LOG_LEVEL_COLORS[lvl];
                                                    return (
                                                        <button key={lvl} onClick={() => {
                                                            const nf = { ...logFilter, minLevel: isThreshold ? [] : [{ [lvl]: null }], startId: [] };
                                                            setLogFilter(nf); loadLogData(nf);
                                                        }}
                                                            style={{ padding: '2px 10px', borderRadius: '12px', border: `1px solid ${isIncluded ? color : theme.colors.border}`, background: isThreshold ? `${color}30` : isIncluded ? `${color}15` : 'transparent', color: isIncluded ? color : theme.colors.secondaryText, fontSize: '0.75rem', fontWeight: isIncluded ? '600' : '400', cursor: 'pointer', opacity: selectedLevelNum !== null && !isIncluded ? 0.4 : 1 }}>
                                                            {lvl}{isThreshold ? '+' : ''}
                                                        </button>
                                                    );
                                                })}
                                                <div style={{ width: '1px', height: '16px', background: theme.colors.border, margin: '0 4px' }} />
                                                <span style={{ fontSize: '0.8rem', color: theme.colors.mutedText }}>Source:</span>
                                                {['api', 'permissions', 'chore', 'system', 'log'].map(src => {
                                                    const isActive = logFilter.source.length > 0 && logFilter.source[0] === src;
                                                    return (
                                                        <button key={src} onClick={() => {
                                                            const nf = { ...logFilter, source: isActive ? [] : [src], startId: [] };
                                                            setLogFilter(nf); loadLogData(nf);
                                                        }}
                                                            style={{ padding: '2px 10px', borderRadius: '12px', border: `1px solid ${isActive ? accent : theme.colors.border}`, background: isActive ? `${accent}20` : 'transparent', color: isActive ? accent : theme.colors.secondaryText, fontSize: '0.75rem', fontWeight: isActive ? '600' : '400', cursor: 'pointer' }}>
                                                            {src}
                                                        </button>
                                                    );
                                                })}
                                            </div>
                                            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '8px', marginTop: '8px' }}>
                                                <button onClick={() => loadLogData()} disabled={loadingLogs}
                                                    style={{ padding: '4px 12px', borderRadius: '8px', border: `1px solid ${theme.colors.border}`, background: 'transparent', color: theme.colors.primaryText, fontSize: '0.8rem', cursor: 'pointer', opacity: loadingLogs ? 0.5 : 1 }}>
                                                    {loadingLogs ? 'Loading...' : 'Refresh'}
                                                </button>
                                                <label style={{ fontSize: '0.8rem', color: theme.colors.secondaryText, display: 'flex', alignItems: 'center', gap: '4px', cursor: 'pointer' }}>
                                                    <input type="checkbox" checked={logAutoRefresh} onChange={e => setLogAutoRefresh(e.target.checked)} style={{ cursor: 'pointer' }} />
                                                    Auto-refresh
                                                </label>
                                                <div style={{ width: '1px', height: '16px', background: theme.colors.border, margin: '0 2px' }} />
                                                <span style={{ fontSize: '0.8rem', color: theme.colors.mutedText }}>Per page:</span>
                                                <select value={pageSize} onChange={e => { const nf = { ...logFilter, limit: [BigInt(e.target.value)], startId: [] }; setLogFilter(nf); loadLogData(nf); }}
                                                    style={{ padding: '3px 6px', borderRadius: '6px', border: `1px solid ${theme.colors.border}`, background: theme.colors.cardBackground || theme.colors.background, color: theme.colors.primaryText, fontSize: '0.8rem', cursor: 'pointer' }}>
                                                    {[10, 25, 50, 100, 200].map(n => <option key={n} value={n}>{n}</option>)}
                                                </select>
                                                <div style={{ flex: 1 }} />
                                                {hasPermission('ManageLogs') && logConfig && (
                                                    <>
                                                        <span style={{ fontSize: '0.8rem', color: theme.colors.mutedText }}>Write level:</span>
                                                        <select value={Object.keys(logConfig.logLevel)[0]}
                                                            onChange={async (e) => {
                                                                setSavingLogConfig(true);
                                                                try { const newLevel = e.target.value; const bot = await getReadyBotActor(); await bot.setLogLevel({ [newLevel]: null }); setLogConfig(prev => prev ? { ...prev, logLevel: { [newLevel]: null } } : prev); setLogSuccess(`Log level set to ${newLevel}`); setTimeout(() => setLogSuccess(''), 3000); loadLogData(undefined, true); }
                                                                catch (err) { setLogError('Failed: ' + err.message); }
                                                                finally { setSavingLogConfig(false); }
                                                            }}
                                                            disabled={savingLogConfig}
                                                            style={{ padding: '3px 8px', borderRadius: '6px', border: `1px solid ${theme.colors.border}`, background: theme.colors.cardBackground || theme.colors.background, color: theme.colors.primaryText, fontSize: '0.8rem', cursor: 'pointer' }}>
                                                            {['Off', 'Error', 'Warning', 'Info', 'Debug', 'Trace'].map(l => <option key={l} value={l}>{l}</option>)}
                                                        </select>
                                                        <button onClick={async () => {
                                                            if (!window.confirm('Clear all log entries?')) return;
                                                            setSavingLogConfig(true);
                                                            try { const bot = await getReadyBotActor(); await bot.clearLogs(); setLogSuccess('Logs cleared'); setTimeout(() => setLogSuccess(''), 3000); loadLogData(); }
                                                            catch (err) { setLogError('Failed: ' + err.message); }
                                                            finally { setSavingLogConfig(false); }
                                                        }} disabled={savingLogConfig}
                                                            style={{ padding: '4px 12px', borderRadius: '8px', border: `1px solid ${theme.colors.error || '#ef4444'}40`, background: `${theme.colors.error || '#ef4444'}10`, color: theme.colors.error || '#ef4444', fontSize: '0.8rem', cursor: 'pointer' }}>
                                                            Clear Logs
                                                        </button>
                                                    </>
                                                )}
                                            </div>
                                        </div>

                                        {/* Log entries */}
                                        {logEntries.length > 0 ? (
                                            <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                                                {logEntries.slice().reverse().map(entry => {
                                                    const levelKey = Object.keys(entry.level)[0];
                                                    const levelColor = LOG_LEVEL_COLORS[levelKey] || '#6b7280';
                                                    const ts = new Date(Number(entry.timestamp) / 1_000_000);
                                                    const timeStr = ts.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' });

                                                    // Build a tag map for quick lookups
                                                    const tagMap = {};
                                                    for (const [k, v] of entry.tags) tagMap[k] = v;

                                                    // --- Enhanced message: replace raw amounts, DEX ids, bps, principals ---
                                                    let enhancedMsg = entry.message;
                                                    // Replace "dex N" / "DEX N" with DEX name (case insensitive)
                                                    enhancedMsg = enhancedMsg.replace(/\bdex (\d+)\b/gi, (_, id) => DEX_NAMES[id] || `DEX ${id}`);
                                                    // Replace " N bps" with "N%" in the message
                                                    enhancedMsg = enhancedMsg.replace(/\b(\d+) bps\b/g, (_, n) => formatBps(n));
                                                    // Replace raw amounts in the message with formatted versions
                                                    // Process all amount tags that have a paired token for formatting
                                                    for (const [amtKey, tokKey] of Object.entries(AMOUNT_TO_TOKEN)) {
                                                        const rawVal = tagMap[amtKey];
                                                        if (!rawVal || rawVal === '0') continue;
                                                        const tokId = tokKey ? tagMap[tokKey] : null;
                                                        const dec = tokId && logTokenMeta[tokId] ? logTokenMeta[tokId].decimals : 8;
                                                        const sym = tokId && logTokenMeta[tokId] ? logTokenMeta[tokId].symbol : '';
                                                        const formatted = formatLogAmount(rawVal, dec);
                                                        // Only replace if the raw value appears as a standalone number in the message
                                                        const re = new RegExp('\\b' + rawVal + '\\b');
                                                        if (re.test(enhancedMsg)) {
                                                            enhancedMsg = enhancedMsg.replace(re, formatted + (sym ? ` ${sym}` : ''));
                                                        }
                                                    }

                                                    // --- Smart tag rendering ---
                                                    const renderedTags = [];
                                                    const skipKeys = new Set(); // Tags already rendered in rich format

                                                    // Render token pair (inputToken → outputToken) as a single rich tag
                                                    if (tagMap.inputToken) {
                                                        const inId = tagMap.inputToken;
                                                        const outId = tagMap.outputToken;
                                                        const inMeta = logTokenMeta[inId];
                                                        const outMeta = outId ? logTokenMeta[outId] : null;
                                                        renderedTags.push(
                                                            <span key="token-pair" style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', padding: '1px 8px', borderRadius: '4px', fontSize: '0.7rem', background: `${accent}12`, color: theme.colors.primaryText }}>
                                                                <TokenIcon canisterId={inId} size={14} />
                                                                <span style={{ fontWeight: 600 }}>{inMeta?.symbol || shortPrincipal(inId)}</span>
                                                                {outId && <>
                                                                    <span style={{ color: theme.colors.mutedText, margin: '0 2px' }}>→</span>
                                                                    <TokenIcon canisterId={outId} size={14} />
                                                                    <span style={{ fontWeight: 600 }}>{outMeta?.symbol || shortPrincipal(outId)}</span>
                                                                </>}
                                                            </span>
                                                        );
                                                        skipKeys.add('inputToken');
                                                        if (outId) skipKeys.add('outputToken');
                                                    }

                                                    // Render amounts with formatting
                                                    if (tagMap.inputAmount) {
                                                        const inId = tagMap.inputToken;
                                                        const outId = tagMap.outputToken;
                                                        const inDec = logTokenMeta[inId]?.decimals ?? 8;
                                                        const inSym = logTokenMeta[inId]?.symbol || '';
                                                        const outDec = outId ? (logTokenMeta[outId]?.decimals ?? 8) : 8;
                                                        const outSym = outId ? (logTokenMeta[outId]?.symbol || '') : '';
                                                        renderedTags.push(
                                                            <span key="amounts" style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', padding: '1px 8px', borderRadius: '4px', fontSize: '0.7rem', background: `${theme.colors.border}60`, color: theme.colors.primaryText, fontFamily: 'monospace' }}>
                                                                {formatLogAmount(tagMap.inputAmount, inDec)}{inSym ? ` ${inSym}` : ''}
                                                                {tagMap.outputAmount && <>
                                                                    <span style={{ color: theme.colors.mutedText }}>→</span>
                                                                    {formatLogAmount(tagMap.outputAmount, outDec)}{outSym ? ` ${outSym}` : ''}
                                                                </>}
                                                            </span>
                                                        );
                                                        skipKeys.add('inputAmount');
                                                        skipKeys.add('outputAmount');
                                                    }

                                                    // Render dexId as DEX name
                                                    if (tagMap.dexId != null) {
                                                        const name = DEX_NAMES[tagMap.dexId];
                                                        renderedTags.push(
                                                            <span key="dex" style={{ padding: '1px 8px', borderRadius: '4px', fontSize: '0.7rem', background: `${theme.colors.border}60`, color: theme.colors.secondaryText }}>
                                                                {name || `DEX ${tagMap.dexId}`}
                                                            </span>
                                                        );
                                                        skipKeys.add('dexId');
                                                    }

                                                    // Render remaining tags as-is, but with token resolution for any token-like tags
                                                    entry.tags.forEach(([k, v], i) => {
                                                        if (skipKeys.has(k)) return;
                                                        // Token-type tags not already handled
                                                        if (TOKEN_TAG_KEYS.has(k) && v && v.length > 10) {
                                                            const meta = logTokenMeta[v];
                                                            renderedTags.push(
                                                                <span key={`t-${i}`} style={{ display: 'inline-flex', alignItems: 'center', gap: '3px', padding: '1px 6px', borderRadius: '4px', fontSize: '0.7rem', background: `${theme.colors.border}60`, color: theme.colors.secondaryText }}>
                                                                    <span style={{ opacity: 0.7 }}>{k}:</span>
                                                                    <TokenIcon canisterId={v} size={13} />
                                                                    <span>{meta?.symbol || shortPrincipal(v)}</span>
                                                                </span>
                                                            );
                                                        } else if (BPS_TAG_KEYS.has(k)) {
                                                            // Render bps as percentage
                                                            renderedTags.push(
                                                                <span key={`t-${i}`} style={{ padding: '1px 6px', borderRadius: '4px', fontSize: '0.7rem', background: `${theme.colors.border}60`, color: theme.colors.secondaryText, fontFamily: 'monospace' }}>
                                                                    <span style={{ opacity: 0.7 }}>{k.replace(/Bps$/, '')}:</span> {formatBps(v)}
                                                                </span>
                                                            );
                                                        } else if (AMOUNT_TAG_KEYS.has(k)) {
                                                            // Format amount using paired token decimals
                                                            const pairedKey = AMOUNT_TO_TOKEN[k];
                                                            const pairedId = pairedKey ? tagMap[pairedKey] : null;
                                                            const dec = pairedId && logTokenMeta[pairedId] ? logTokenMeta[pairedId].decimals : 8;
                                                            const sym = pairedId && logTokenMeta[pairedId] ? logTokenMeta[pairedId].symbol : '';
                                                            renderedTags.push(
                                                                <span key={`t-${i}`} style={{ padding: '1px 6px', borderRadius: '4px', fontSize: '0.7rem', background: `${theme.colors.border}60`, color: theme.colors.secondaryText, fontFamily: 'monospace' }}>
                                                                    <span style={{ opacity: 0.7 }}>{k}:</span> {formatLogAmount(v, dec)}{sym ? ` ${sym}` : ''}
                                                                </span>
                                                            );
                                                        } else if (k === 'dexId' || k === 'dex') {
                                                            // Already handled above in the dexId block, but catch stray variants
                                                            renderedTags.push(
                                                                <span key={`t-${i}`} style={{ padding: '1px 6px', borderRadius: '4px', fontSize: '0.7rem', background: `${theme.colors.border}60`, color: theme.colors.secondaryText }}>
                                                                    <span style={{ opacity: 0.7 }}>dex:</span> {DEX_NAMES[v] || `DEX ${v}`}
                                                                </span>
                                                            );
                                                        } else {
                                                            // Default: raw tag
                                                            renderedTags.push(
                                                                <span key={`t-${i}`} style={{ padding: '1px 6px', borderRadius: '4px', fontSize: '0.7rem', background: `${theme.colors.border}60`, color: theme.colors.secondaryText }}>
                                                                    <span style={{ opacity: 0.7 }}>{k}:</span> {v}
                                                                </span>
                                                            );
                                                        }
                                                    });

                                                    return (
                                                        <div key={Number(entry.id)} style={{ display: 'flex', flexDirection: 'column', gap: '2px', padding: '8px 12px', background: theme.colors.cardBackground || theme.colors.background, borderLeft: `3px solid ${levelColor}`, borderRadius: '4px', fontSize: '0.8rem' }}>
                                                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                                                                <span style={{ padding: '1px 6px', borderRadius: '4px', fontSize: '0.7rem', fontWeight: '600', background: `${levelColor}20`, color: levelColor, minWidth: '48px', textAlign: 'center' }}>{levelKey.toUpperCase()}</span>
                                                                <span style={{ padding: '1px 6px', borderRadius: '4px', fontSize: '0.7rem', background: `${accent}15`, color: accent }}>{entry.source}</span>
                                                                <span style={{ color: theme.colors.primaryText, flex: 1 }}>{enhancedMsg}</span>
                                                                <span style={{ color: theme.colors.mutedText, fontSize: '0.7rem', whiteSpace: 'nowrap' }}>{timeStr}</span>
                                                                <span style={{ color: theme.colors.mutedText, fontSize: '0.65rem', opacity: 0.6 }}>#{Number(entry.id)}</span>
                                                            </div>
                                                            {renderedTags.length > 0 && (
                                                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginLeft: '56px', alignItems: 'center' }}>
                                                                    {renderedTags}
                                                                </div>
                                                            )}
                                                            {entry.caller.length > 0 && (
                                                                <div style={{ marginLeft: '56px', fontSize: '0.7rem', color: theme.colors.mutedText }}>
                                                                    caller: <PrincipalDisplay principal={entry.caller[0].toString()} displayInfo={getPrincipalDisplayInfoFromContext(entry.caller[0].toString(), principalNames, principalNicknames)} showCopyButton={false} isAuthenticated={isAuthenticated} />
                                                                </div>
                                                            )}
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        ) : (
                                            <div style={{ ...cardStyle, textAlign: 'center', color: theme.colors.secondaryText, fontSize: '0.85rem' }}>
                                                No log entries found{selectedLevelKey || logFilter.source.length > 0 ? ' matching the current filters' : ''}.
                                            </div>
                                        )}

                                        {/* Pagination */}
                                        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '12px', marginTop: '10px', flexWrap: 'wrap' }}>
                                            {/* "Newest" — go back to the default newest page (only when navigated away) */}
                                            {!isFirstPage && (
                                                <button onClick={() => { const nf = { ...logFilter, startId: [] }; setLogFilter(nf); loadLogData(nf); }}
                                                    style={{ padding: '6px 14px', borderRadius: '8px', border: `1px solid ${theme.colors.border}`, background: 'transparent', color: theme.colors.primaryText, fontSize: '0.8rem', cursor: 'pointer' }}>
                                                    « Newest
                                                </button>
                                            )}
                                            {/* "Newer" — go forward (higher IDs) when on an older page */}
                                            {!isFirstPage && logEntries.length > 0 && (
                                                <button onClick={() => {
                                                    const lastEntry = logEntries[logEntries.length - 1];
                                                    const nf = { ...logFilter, startId: [BigInt(Number(lastEntry.id) + 1)] };
                                                    setLogFilter(nf); loadLogData(nf);
                                                }}
                                                    style={{ padding: '6px 14px', borderRadius: '8px', border: `1px solid ${theme.colors.border}`, background: 'transparent', color: theme.colors.primaryText, fontSize: '0.8rem', cursor: 'pointer' }}>
                                                    ‹ Newer
                                                </button>
                                            )}
                                            {/* "Older" — go backward (lower IDs) when there are older entries */}
                                            {logEntries.length > 0 && Number(logEntries[0].id) > 0 && (
                                                <button onClick={() => {
                                                    const firstEntry = logEntries[0];
                                                    const newStart = Math.max(0, Number(firstEntry.id) - pageSize);
                                                    const nf = { ...logFilter, startId: [BigInt(newStart)] };
                                                    setLogFilter(nf); loadLogData(nf);
                                                }}
                                                    style={{ padding: '6px 14px', borderRadius: '8px', border: `1px solid ${theme.colors.border}`, background: 'transparent', color: theme.colors.primaryText, fontSize: '0.8rem', cursor: 'pointer' }}>
                                                    Older »
                                                </button>
                                            )}
                                        </div>

                                        {logConfig && (
                                            <div style={{ textAlign: 'center', padding: '8px', fontSize: '0.7rem', color: theme.colors.mutedText }}>
                                                Showing {logEntries.length} of {logTotalMatching.toLocaleString()} matching · {Number(logConfig.entryCount).toLocaleString()} total stored · Max: {Number(logConfig.maxEntries).toLocaleString()}
                                            </div>
                                        )}
                                    </>
                                )}
                            </div>
                        );
                    })()}
                </div>
            )}
        </div>
    );
}
