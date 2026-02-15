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
 *       props: { chore, config, choreId, choreTypeId, instanceId, botActor,
 *                savingChore, setSavingChore, choreError, setChoreError, choreSuccess, setChoreSuccess,
 *                loadChoreData, theme, accentColor, cardStyle, inputStyle, buttonStyle, secondaryButtonStyle }
 *   identity           – Current user identity (from useAuth)
 *   isAuthenticated    – Boolean
 */
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { HttpAgent, Actor } from '@dfinity/agent';
import { Principal } from '@dfinity/principal';
import { createActor as createFactoryActor, canisterId as factoryCanisterId } from 'declarations/sneedapp';
import { useTheme } from '../contexts/ThemeContext';
import { useNaming } from '../NamingContext';
import { PrincipalDisplay, getPrincipalDisplayInfoFromContext } from '../utils/PrincipalUtils';
import PrincipalInput from './PrincipalInput';
import { getNeuronManagerSettings, getCyclesColor } from '../utils/NeuronManagerSettings';
import { FaRobot, FaChevronUp, FaChevronDown, FaShieldAlt } from 'react-icons/fa';
import StatusLamp, {
    LAMP_OFF, LAMP_OK, LAMP_ACTIVE, LAMP_WARN, LAMP_ERROR,
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

    // ==========================================
    // HELPERS
    // ==========================================
    const getAgent = useCallback(() => {
        const host = process.env.DFX_NETWORK === 'ic' || process.env.DFX_NETWORK === 'staging'
            ? 'https://icp0.io' : 'http://localhost:4943';
        return new HttpAgent({ identity, host });
    }, [identity]);

    const getBotActor = useCallback(() => {
        if (!canisterId || !identity) return null;
        const agent = getAgent();
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
            const bot = getBotActor();
            if (!bot) return;
            if (process.env.DFX_NETWORK !== 'ic' && process.env.DFX_NETWORK !== 'staging') {
                const agent = getAgent();
                await agent.fetchRootKey();
            }
            const version = await bot.getVersion();
            setBotVersion(`${Number(version.major)}.${Number(version.minor)}.${Number(version.patch)}`);
        } catch {
            // Old bots may not have getVersion
        }
    }, [canisterId, identity, getBotActor, getAgent]);

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
            const bot = getBotActor();
            if (!bot) return;
            if (process.env.DFX_NETWORK !== 'ic' && process.env.DFX_NETWORK !== 'staging') {
                const agent = getAgent();
                await agent.fetchRootKey();
            }
            const perms = await bot.callerPermissions();
            setUserPermissions(new Set(perms.map(p => Object.keys(p)[0])));
        } catch {
            setUserPermissions(new Set());
        }
    }, [canisterId, identity, getBotActor, getAgent]);

    // Load botkey permissions
    const loadHotkeyPermissions = useCallback(async () => {
        if (!canisterId || !identity) return;
        setLoadingPermissions(true);
        setPermissionError('');
        try {
            const bot = getBotActor();
            if (!bot) return;
            if (process.env.DFX_NETWORK !== 'ic' && process.env.DFX_NETWORK !== 'staging') {
                const agent = getAgent();
                await agent.fetchRootKey();
            }
            const [types, principals] = await Promise.all([
                bot.listPermissionTypes(),
                bot.getHotkeyPermissions(),
            ]);
            setPermissionTypes(types);
            setHotkeyPrincipals(principals);
            setBotkeysSupported(true);
        } catch (err) {
            if (err.message?.includes('has no query') || err.message?.includes('is not a function')) {
                setBotkeysSupported(false);
            } else {
                setPermissionError('Failed to load permissions: ' + err.message);
            }
        } finally {
            setLoadingPermissions(false);
        }
    }, [canisterId, identity, getBotActor, getAgent]);

    // Load chore data
    const loadChoreData = useCallback(async (silent) => {
        if (!canisterId || !identity) return;
        if (!silent) { setLoadingChores(true); setChoreError(''); }
        try {
            const bot = getBotActor();
            if (!bot) return;
            if (process.env.DFX_NETWORK !== 'ic' && process.env.DFX_NETWORK !== 'staging') {
                const agent = getAgent();
                await agent.fetchRootKey();
            }
            const [statuses, configs] = await Promise.all([
                bot.getChoreStatuses(),
                bot.getChoreConfigs ? bot.getChoreConfigs() : Promise.resolve([]),
            ]);
            setChoreStatuses(statuses);
            setChoreConfigs(configs);
            // Set initial active tab
            if (!choreActiveTab && statuses.length > 0) {
                setChoreActiveTab(statuses[0].choreTypeId || statuses[0].choreId);
            }
        } catch (err) {
            if (!silent) setChoreError('Failed to load chore data: ' + err.message);
        } finally {
            if (!silent) setLoadingChores(false);
        }
    }, [canisterId, identity, getBotActor, getAgent, choreActiveTab]);

    // Load log data
    const loadLogData = useCallback(async (filterOverride, silent) => {
        if (!canisterId || !identity) return;
        if (!silent) setLoadingLogs(true);
        setLogError('');
        try {
            const bot = getBotActor();
            if (!bot) return;
            if (process.env.DFX_NETWORK !== 'ic' && process.env.DFX_NETWORK !== 'staging') {
                const agent = getAgent();
                await agent.fetchRootKey();
            }
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
    }, [canisterId, identity, getBotActor, getAgent, logFilter]);

    // ==========================================
    // EFFECTS
    // ==========================================
    useEffect(() => {
        if (isAuthenticated && identity && canisterId) {
            loadCanisterStatus();
            loadBotVersion();
            loadOfficialVersions();
            fetchUserPermissions();
        }
    }, [isAuthenticated, identity, canisterId, loadCanisterStatus, loadBotVersion, loadOfficialVersions, fetchUserPermissions]);

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

    // Chore tick for imminent countdowns
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
        return () => { if (choreTickRef.current) { clearInterval(choreTickRef.current); choreTickRef.current = null; } };
    }, [choreStatuses]);

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
            const bot = getBotActor();
            if (process.env.DFX_NETWORK !== 'ic' && process.env.DFX_NETWORK !== 'staging') {
                const agent = getAgent(); await agent.fetchRootKey();
            }
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
            const bot = getBotActor();
            if (process.env.DFX_NETWORK !== 'ic' && process.env.DFX_NETWORK !== 'staging') {
                const agent = getAgent(); await agent.fetchRootKey();
            }
            const principal = Principal.fromText(principalText);
            if (toAdd.length > 0) await bot.addHotkeyPermissions(principal, toAdd);
            if (toRemove.length > 0) await bot.removeHotkeyPermissions(principal, toRemove);
            setPermissionSuccess('Permissions updated');
            setEditingPrincipal(null);
            await loadHotkeyPermissions();
        } catch (err) { setPermissionError(err.message); }
        finally { setSavingPermissions(false); }
    };

    const handleRemoveHotkeyPrincipal = async (principalText) => {
        setSavingPermissions(true); setPermissionError('');
        try {
            const bot = getBotActor();
            if (process.env.DFX_NETWORK !== 'ic' && process.env.DFX_NETWORK !== 'staging') {
                const agent = getAgent(); await agent.fetchRootKey();
            }
            const result = await bot.removeHotkey(Principal.fromText(principalText));
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
            const bot = getBotActor();
            if (process.env.DFX_NETWORK !== 'ic' && process.env.DFX_NETWORK !== 'staging') {
                const agent = getAgent(); await agent.fetchRootKey();
            }
            await actionFn(bot);
            await loadChoreData(true);
        } catch (err) { setChoreError(err.message); }
        finally { setSavingChore(false); }
    };

    // ==========================================
    // RENDER
    // ==========================================
    if (!canisterId) return null;

    const IconComponent = botIcon || <FaRobot style={{ color: accent, fontSize: '16px' }} />;

    return (
        <div style={{ marginBottom: '1.25rem' }}>
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
                                <StatusLamp key={chore.choreId} state={getChoreSummaryLamp(chore)} size={8}
                                    label={getSummaryLabel(getChoreSummaryLamp(chore), chore.choreName)} />
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
                        <button style={tabStyle(activeTab === 'permissions')} onClick={() => setActiveTab('permissions')}>Botkeys</button>
                        {(hasPermission('ViewChores') || canManageAnyChore()) && (
                            <button style={{ ...tabStyle(activeTab === 'chores'), display: 'inline-flex', alignItems: 'center', gap: '6px' }} onClick={() => setActiveTab('chores')}>
                                {choreStatuses.length > 0 && (
                                    <StatusLamp state={getAllChoresSummaryLamp(choreStatuses)} size={8}
                                        label={getSummaryLabel(getAllChoresSummaryLamp(choreStatuses), 'Chores')} />
                                )}
                                Chores
                            </button>
                        )}
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
                                    {choreStatuses.length > 0 && (() => {
                                        const choreTypeMap = {};
                                        const choreTypeOrder = [];
                                        choreStatuses.forEach(chore => {
                                            const tid = chore.choreTypeId || chore.choreId;
                                            if (!choreTypeMap[tid]) { choreTypeMap[tid] = { typeId: tid, typeName: chore.choreName, instances: [] }; choreTypeOrder.push(tid); }
                                            choreTypeMap[tid].instances.push(chore);
                                        });
                                        const activeTypeId = choreTypeMap[choreActiveTab] ? choreActiveTab : choreTypeOrder[0];
                                        const activeType = choreTypeMap[activeTypeId];
                                        const instances = activeType?.instances || [];
                                        const activeInstanceId = choreActiveInstance && instances.find(i => i.choreId === choreActiveInstance) ? choreActiveInstance : instances[0]?.choreId;
                                        const activeChore = instances.find(i => i.choreId === activeInstanceId);
                                        const hasMultiple = instances.length > 1;

                                        return (
                                            <>
                                                {/* Type tabs */}
                                                <div style={{ display: 'flex', flexWrap: 'wrap', marginBottom: hasMultiple ? '0' : '12px', gap: '0' }}>
                                                    {choreTypeOrder.map(tid => {
                                                        const type = choreTypeMap[tid];
                                                        const worst = type.instances.reduce((w, i) => {
                                                            const l = getChoreSummaryLamp(i);
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

                                                {/* Instance sub-tabs */}
                                                {hasMultiple && (
                                                    <div style={{ display: 'flex', flexWrap: 'wrap', marginBottom: '12px', gap: '0', paddingLeft: '8px', borderLeft: `2px solid ${accent}30` }}>
                                                        {instances.map(inst => (
                                                            <button key={inst.choreId} style={{ ...tabStyle(activeInstanceId === inst.choreId), fontSize: '0.75rem', padding: '0.35rem 0.7rem', display: 'inline-flex', alignItems: 'center', gap: '5px' }}
                                                                onClick={() => setChoreActiveInstance(inst.choreId)}>
                                                                <StatusLamp state={getChoreSummaryLamp(inst)} size={7} />
                                                                {inst.instanceLabel || inst.choreName}
                                                            </button>
                                                        ))}
                                                        <button style={{ ...tabStyle(false), fontSize: '0.75rem', padding: '0.35rem 0.7rem', color: accent, fontWeight: '700' }}
                                                            onClick={() => { setCreatingInstance(true); setNewInstanceLabel(''); }} title="Add another instance">+</button>
                                                    </div>
                                                )}

                                                {/* Add instance for single-instance multi-capable types */}
                                                {!hasMultiple && multiInstanceChoreTypes.includes(activeTypeId) && (
                                                    <div style={{ marginBottom: '8px' }}>
                                                        <button style={{ ...buttonStyle, fontSize: '0.75rem', background: `${accent}10`, color: accent, border: `1px solid ${accent}25`, padding: '4px 10px' }}
                                                            onClick={() => { setCreatingInstance(true); setNewInstanceLabel(''); }}>
                                                            + Add another {activeType?.typeName}
                                                        </button>
                                                    </div>
                                                )}

                                                {/* Create instance dialog */}
                                                {creatingInstance && (
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

                                                {/* Active chore panel */}
                                                {activeChore && (() => {
                                                    const chore = activeChore;
                                                    const configEntry = choreConfigs.find(([id]) => id === chore.choreId);
                                                    const config = configEntry ? configEntry[1] : null;
                                                    const intervalSeconds = config ? Number(config.intervalSeconds) : 0;
                                                    const maxIntervalSeconds = config?.maxIntervalSeconds?.[0] != null ? Number(config.maxIntervalSeconds[0]) : null;
                                                    const fmtInt = (s) => { if (s <= 0) return '0'; if (s < 3600) return `${Math.round(s / 60)} min`; if (s < 86400) { const h = s / 3600; return Number.isInteger(h) ? `${h} hr` : `${h.toFixed(1)} hr`; } const d = s / 86400; return Number.isInteger(d) ? `${d} days` : `${d.toFixed(1)} days`; };
                                                    const schedulerLamp = getSchedulerLampState(chore);
                                                    const conductorLamp = getConductorLampState(chore);
                                                    const taskLamp = getTaskLampState(chore);
                                                    const isEnabled = chore.enabled;
                                                    const isPaused = chore.paused;
                                                    const isStopped = !isEnabled;
                                                    const fmtTime = (nsOpt) => { if (!nsOpt || nsOpt.length === 0) return '—'; const ms = Number(nsOpt[0]) / 1_000_000; return ms <= 0 ? '—' : new Date(ms).toLocaleString(); };

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
                                                                    <div style={{ padding: '10px', background: theme.colors.primaryBg, borderRadius: '8px', border: `1px solid ${theme.colors.border}` }}>
                                                                        <div style={{ fontSize: '0.75rem', color: theme.colors.secondaryText, marginBottom: '4px' }}>State</div>
                                                                        <div style={{ fontSize: '0.9rem', fontWeight: '600', color: isStopped ? theme.colors.secondaryText : isPaused ? '#f59e0b' : '#22c55e' }}>
                                                                            {isStopped ? 'Stopped' : isPaused ? 'Paused' : 'Running'}
                                                                        </div>
                                                                    </div>
                                                                    {[['Scheduler', schedulerLamp], ['Conductor', conductorLamp], ['Task', taskLamp]].map(([name, lamp]) => (
                                                                        <div key={name} style={{ padding: '10px', background: theme.colors.primaryBg, borderRadius: '8px', border: `1px solid ${theme.colors.border}` }}>
                                                                            <div style={{ fontSize: '0.75rem', color: theme.colors.secondaryText, marginBottom: '4px' }}>{name}</div>
                                                                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                                                                <StatusLamp state={lamp.state} size={10} label={lamp.label} />
                                                                                <span style={{ fontSize: '0.9rem', color: LAMP_COLORS[lamp.state], fontWeight: '500' }}>{lamp.label}</span>
                                                                            </div>
                                                                        </div>
                                                                    ))}
                                                                    <div style={{ padding: '10px', background: theme.colors.primaryBg, borderRadius: '8px', border: `1px solid ${theme.colors.border}` }}>
                                                                        <div style={{ fontSize: '0.75rem', color: theme.colors.secondaryText, marginBottom: '4px' }}>Interval</div>
                                                                        <div style={{ fontSize: '0.9rem', color: theme.colors.primaryText, fontWeight: '500' }}>
                                                                            {maxIntervalSeconds && maxIntervalSeconds > intervalSeconds ? `${fmtInt(intervalSeconds)}–${fmtInt(maxIntervalSeconds)}` : fmtInt(intervalSeconds)}
                                                                        </div>
                                                                    </div>
                                                                    <div style={{ padding: '10px', background: theme.colors.primaryBg, borderRadius: '8px', border: `1px solid ${theme.colors.border}` }}>
                                                                        <div style={{ fontSize: '0.75rem', color: theme.colors.secondaryText, marginBottom: '4px' }}>Next Run</div>
                                                                        <div style={{ fontSize: '0.85rem', color: theme.colors.primaryText, fontWeight: '500' }}>{fmtTime(chore.nextScheduledRunAt)}</div>
                                                                    </div>
                                                                </div>
                                                            </div>

                                                            {/* Controls */}
                                                            <div style={cardStyle}>
                                                                <h3 style={{ color: theme.colors.primaryText, margin: '0 0 12px 0', fontSize: '0.95rem', fontWeight: '600' }}>Controls</h3>
                                                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                                                                    {isStopped ? (
                                                                        <button onClick={() => choreAction(bot => bot.startChore(chore.choreId))} disabled={savingChore}
                                                                            style={{ ...buttonStyle, background: '#22c55e', opacity: savingChore ? 0.7 : 1 }}>▶ Start</button>
                                                                    ) : (
                                                                        <button onClick={() => choreAction(bot => bot.stopChore(chore.choreId))} disabled={savingChore}
                                                                            style={{ ...buttonStyle, background: '#ef4444', opacity: savingChore ? 0.7 : 1 }}>⏹ Stop</button>
                                                                    )}
                                                                    {isEnabled && !isPaused && (
                                                                        <button onClick={() => choreAction(bot => bot.pauseChore(chore.choreId))} disabled={savingChore}
                                                                            style={{ ...buttonStyle, background: '#f59e0b', opacity: savingChore ? 0.7 : 1 }}>⏸ Pause</button>
                                                                    )}
                                                                    {isEnabled && isPaused && (
                                                                        <button onClick={() => choreAction(bot => bot.resumeChore(chore.choreId))} disabled={savingChore}
                                                                            style={{ ...buttonStyle, background: '#22c55e', opacity: savingChore ? 0.7 : 1 }}>▶ Resume</button>
                                                                    )}
                                                                    {isEnabled && (
                                                                        <button onClick={() => choreAction(bot => bot.triggerChore(chore.choreId))} disabled={savingChore}
                                                                            style={{ ...secondaryButtonStyle, opacity: savingChore ? 0.7 : 1 }}>⚡ Trigger Now</button>
                                                                    )}
                                                                </div>

                                                                {/* Interval setting */}
                                                                <div style={{ marginTop: '16px' }}>
                                                                    <label style={{ color: theme.colors.mutedText, fontSize: '11px', display: 'block', marginBottom: '4px' }}>Set Interval (seconds)</label>
                                                                    <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                                                                        <input type="number" defaultValue={intervalSeconds} id={`interval-input-${chore.choreId}`}
                                                                            style={{ ...inputStyle, maxWidth: '120px' }} min="1" />
                                                                        <button onClick={() => {
                                                                            const val = parseInt(document.getElementById(`interval-input-${chore.choreId}`).value);
                                                                            if (val > 0) choreAction(bot => bot.setChoreInterval(chore.choreId, BigInt(val)));
                                                                        }} disabled={savingChore} style={{ ...secondaryButtonStyle, fontSize: '0.8rem', padding: '0.4rem 0.8rem' }}>Set</button>
                                                                    </div>
                                                                </div>
                                                            </div>

                                                            {/* Custom chore config (render prop) */}
                                                            {renderChoreConfig && renderChoreConfig({
                                                                chore, config, choreId: chore.choreId,
                                                                choreTypeId: chore.choreTypeId || chore.choreId,
                                                                instanceId: chore.choreId,
                                                                botActor: getBotActor(),
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

                                    {choreStatuses.length === 0 && (
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
                                                                try { const bot = getBotActor(); await bot.setLogLevel({ [e.target.value]: null }); setLogSuccess(`Log level set to ${e.target.value}`); setTimeout(() => setLogSuccess(''), 3000); loadLogData(undefined, true); }
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
                                                            try { const bot = getBotActor(); await bot.clearLogs(); setLogSuccess('Logs cleared'); setTimeout(() => setLogSuccess(''), 3000); loadLogData(); }
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
                                                    return (
                                                        <div key={Number(entry.id)} style={{ display: 'flex', flexDirection: 'column', gap: '2px', padding: '8px 12px', background: theme.colors.cardBackground || theme.colors.background, borderLeft: `3px solid ${levelColor}`, borderRadius: '4px', fontSize: '0.8rem' }}>
                                                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                                                                <span style={{ padding: '1px 6px', borderRadius: '4px', fontSize: '0.7rem', fontWeight: '600', background: `${levelColor}20`, color: levelColor, minWidth: '48px', textAlign: 'center' }}>{levelKey.toUpperCase()}</span>
                                                                <span style={{ padding: '1px 6px', borderRadius: '4px', fontSize: '0.7rem', background: `${accent}15`, color: accent }}>{entry.source}</span>
                                                                <span style={{ color: theme.colors.primaryText, flex: 1 }}>{entry.message}</span>
                                                                <span style={{ color: theme.colors.mutedText, fontSize: '0.7rem', whiteSpace: 'nowrap' }}>{timeStr}</span>
                                                                <span style={{ color: theme.colors.mutedText, fontSize: '0.65rem', opacity: 0.6 }}>#{Number(entry.id)}</span>
                                                            </div>
                                                            {entry.tags.length > 0 && (
                                                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginLeft: '56px' }}>
                                                                    {entry.tags.map(([k, v], i) => (
                                                                        <span key={i} style={{ padding: '1px 6px', borderRadius: '4px', fontSize: '0.7rem', background: `${theme.colors.border}60`, color: theme.colors.secondaryText }}>
                                                                            <span style={{ opacity: 0.7 }}>{k}:</span> {v}
                                                                        </span>
                                                                    ))}
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
                                            {!isFirstPage && (
                                                <button onClick={() => { const nf = { ...logFilter, startId: [] }; setLogFilter(nf); loadLogData(nf); }}
                                                    style={{ padding: '6px 14px', borderRadius: '8px', border: `1px solid ${theme.colors.border}`, background: 'transparent', color: theme.colors.primaryText, fontSize: '0.8rem', cursor: 'pointer' }}>
                                                    « Newest
                                                </button>
                                            )}
                                            {logHasMore && logEntries.length > 0 && (
                                                <button onClick={() => {
                                                    const lastEntry = logEntries[logEntries.length - 1];
                                                    const nf = { ...logFilter, startId: [BigInt(Number(lastEntry.id) + 1)] };
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
