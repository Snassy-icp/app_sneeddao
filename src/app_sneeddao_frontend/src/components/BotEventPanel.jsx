/**
 * BotEventPanel — Self-contained event system management component.
 *
 * Provides two sub-tabs:
 *   - Source: manage outgoing event emission (listeners, event log, emission toggle)
 *   - Listener: manage incoming event subscriptions, reaction rules, and reaction log
 *
 * Works with any bot canister that implements the BotEventEngine interface.
 * Creates its own actor via botEventIdlFactory so it's independent of bot-specific IDLs.
 *
 * Props:
 *   canisterId            – Principal string of the bot canister
 *   identity              – Current user identity (from useAuth)
 *   theme                 – Theme object from ThemeContext
 *   accentColor           – Primary accent color string
 *   hasPermission         – (permKey: string) => boolean
 *   choreStatuses         – (optional) Array of chore status objects for chore dropdown
 *   tokenRegistryEntries  – (optional) Array of {ledger_id/ledgerCanisterId, symbol, decimals, fee} for TokenSelector subset
 */
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { HttpAgent, Actor } from '@dfinity/agent';
import { Principal } from '@dfinity/principal';
import { botEventIdlFactory } from '../utils/botEventIdl';
import { PrincipalDisplay, getPrincipalDisplayInfoFromContext } from '../utils/PrincipalUtils';
import { useNaming } from '../NamingContext';
import ConfirmDialog from './ConfirmDialog';
import TokenSelector from './TokenSelector';
import PrincipalInput from './PrincipalInput';
import { getTokenMetadataSync } from '../hooks/useTokenCache';
import { useWalletOptional } from '../contexts/WalletContext';

const CONDITION_OPS = [
    { id: 0, label: 'Equals' },
    { id: 1, label: 'Not Equals' },
    { id: 2, label: 'Contains' },
    { id: 3, label: 'Greater Than' },
    { id: 4, label: 'Less Than' },
];

const ACTION_PARAM_HINTS = {
    0:   [{ key: 'choreId', hint: 'Chore instance ID', required: true }],
    1:   [{ key: 'choreId', hint: 'Chore instance ID', required: true }],
    2:   [{ key: 'choreId', hint: 'Chore instance ID', required: true }],
    3:   [{ key: 'choreId', hint: 'Chore instance ID', required: true }],
    4:   [{ key: 'choreId', hint: 'Chore instance ID', required: true }],
    5:   [],
    100: [],
    101: [],
    102: [],
    103: [],
    104: [],
    105: [],
    106: [],
    200: [{ key: 'token', hint: 'Token ledger canister ID (principal)', required: true }],
    201: [{ key: 'token', hint: 'Token ledger canister ID (principal)', required: true }],
    202: [{ key: 'token', hint: 'Token ledger canister ID (principal)', required: true }],
    203: [{ key: 'token', hint: 'Token ledger canister ID (principal)', required: true }],
    204: [],
    205: [],
    206: [{ key: 'choreId', hint: 'Chore instance ID', required: true }, { key: 'token', hint: 'Token ledger canister ID', required: true }, { key: 'amount', hint: 'Amount in token units', required: true }],
    207: [{ key: 'choreId', hint: 'Chore instance ID', required: true }, { key: 'token', hint: 'Token ledger canister ID', required: true }, { key: 'amount', hint: 'Amount in token units', required: true }],
    208: [{ key: 'token', hint: 'Token ledger canister ID', required: true }, { key: 'to', hint: 'Destination account (principal or ICRC-1 account)', required: true }, { key: 'amount', hint: 'Amount in token units', required: true }],
};

const EVENT_DATA_KEYS = {
    // Base chore events
    0:   [{ key: 'choreId', hint: 'Chore instance ID' }],
    1:   [{ key: 'choreId', hint: 'Chore instance ID' }],
    2:   [{ key: 'choreId', hint: 'Chore instance ID' }],
    3:   [{ key: 'choreId', hint: 'Chore instance ID' }],
    4:   [{ key: 'choreId', hint: 'Chore instance ID' }],
    5:   [{ key: 'choreId', hint: 'Chore instance ID' }, { key: 'error', hint: 'Error message' }],
    6:   [{ key: 'choreId', hint: 'Chore instance ID' }],
    // Distribution events
    10:  [{ key: 'choreId', hint: 'Chore instance ID' }, { key: 'list', hint: 'Distribution list name' }, { key: 'amount', hint: 'Amount distributed' }, { key: 'targets', hint: 'Number of targets' }, { key: 'ledger', hint: 'Token ledger canister ID' }],
    11:  [{ key: 'choreId', hint: 'Chore instance ID' }, { key: 'list', hint: 'Distribution list name' }, { key: 'succeeded', hint: 'Successful transfers' }, { key: 'failed', hint: 'Failed transfers' }, { key: 'ledger', hint: 'Token ledger canister ID' }],
    // Staking bot events
    100: [{ key: 'neuronId', hint: 'Neuron ID' }],
    101: [{ key: 'neuronId', hint: 'Neuron ID' }],
    102: [{ key: 'neuronId', hint: 'Neuron ID' }],
    103: [{ key: 'neuronId', hint: 'Neuron ID' }],
    110: [{ key: 'neuronId', hint: 'Neuron ID' }],
    111: [{ key: 'neuronId', hint: 'Neuron ID' }],
    112: [{ key: 'neuronId', hint: 'Neuron ID' }, { key: 'delaySeconds', hint: 'New dissolve delay' }],
    120: [{ key: 'neuronId', hint: 'Neuron ID' }],
    121: [{ key: 'neuronId', hint: 'Neuron ID' }],
    122: [{ key: 'neuronId', hint: 'Neuron ID' }],
    123: [{ key: 'neuronId', hint: 'Neuron ID' }],
    130: [{ key: 'neuronId', hint: 'Neuron ID' }],
    131: [{ key: 'neuronId', hint: 'Neuron ID' }, { key: 'amount', hint: 'Amount (e8s)' }],
    140: [{ key: 'neuronId', hint: 'Neuron ID' }, { key: 'proposalId', hint: 'Proposal ID' }],
    141: [{ key: 'neuronId', hint: 'Neuron ID' }],
    150: [{ key: 'neuronId', hint: 'Neuron ID' }, { key: 'hotkey', hint: 'Hotkey principal' }],
    151: [{ key: 'neuronId', hint: 'Neuron ID' }, { key: 'hotkey', hint: 'Hotkey principal' }],
    160: [{ key: 'amount', hint: 'Amount (e8s)' }, { key: 'to', hint: 'Destination' }],
    161: [{ key: 'token', hint: 'Token canister ID' }, { key: 'amount', hint: 'Amount' }],
    // TradeExecuted
    200: [{ key: 'choreId', hint: 'Chore instance ID' }, { key: 'actionId', hint: 'Action ID' }, { key: 'inputToken', hint: 'Input token canister ID' }, { key: 'outputToken', hint: 'Output token canister ID' }, { key: 'inputAmount', hint: 'Input amount' }, { key: 'outputAmount', hint: 'Output amount' }],
    // TradeSkipped
    201: [{ key: 'choreId', hint: 'Chore instance ID' }, { key: 'actionId', hint: 'Action ID' }, { key: 'reason', hint: 'Skip reason' }],
    // TradeFailed
    202: [{ key: 'choreId', hint: 'Chore instance ID' }, { key: 'actionId', hint: 'Action ID' }, { key: 'inputToken', hint: 'Input token canister ID' }, { key: 'outputToken', hint: 'Output token canister ID' }, { key: 'error', hint: 'Error message' }],
    // CircuitBreakerTriggered / Enabled / Disabled
    210: [{ key: 'ruleId', hint: 'Circuit breaker rule ID' }, { key: 'ruleName', hint: 'Rule name' }, { key: 'actionsTaken', hint: 'Actions taken' }],
    211: [],
    212: [],
    // Token pause/freeze
    220: [{ key: 'token', hint: 'Token canister ID' }],
    221: [{ key: 'token', hint: 'Token canister ID' }],
    222: [{ key: 'token', hint: 'Token canister ID' }],
    223: [{ key: 'token', hint: 'Token canister ID' }],
    // RebalanceExecuted
    230: [{ key: 'choreId', hint: 'Chore instance ID' }, { key: 'inputToken', hint: 'Sell token canister ID' }, { key: 'outputToken', hint: 'Buy token canister ID' }, { key: 'inputAmount', hint: 'Input amount' }, { key: 'outputAmount', hint: 'Output amount' }],
    // RebalanceSkipped
    231: [{ key: 'choreId', hint: 'Chore instance ID' }, { key: 'reason', hint: 'Skip reason' }, { key: 'token', hint: 'Token (if applicable)' }],
    // PurseFunded
    240: [{ key: 'choreId', hint: 'Chore instance ID' }, { key: 'token', hint: 'Token canister ID' }, { key: 'amount', hint: 'Amount' }, { key: 'purseId', hint: 'Target purse ID' }],
    // PurseReclaimed
    241: [{ key: 'choreId', hint: 'Chore instance ID' }, { key: 'token', hint: 'Token canister ID' }, { key: 'amount', hint: 'Amount' }, { key: 'purseId', hint: 'Source purse ID' }],
    // SendExecuted
    242: [{ key: 'choreId', hint: 'Chore instance ID' }, { key: 'token', hint: 'Token canister ID' }, { key: 'amount', hint: 'Amount' }, { key: 'to', hint: 'Destination' }],
    // SendFailed
    243: [{ key: 'choreId', hint: 'Chore instance ID' }, { key: 'token', hint: 'Token canister ID' }, { key: 'amount', hint: 'Amount' }, { key: 'to', hint: 'Destination' }, { key: 'error', hint: 'Error message' }],
    // InflowDetected / OutflowDetected
    250: [{ key: 'token', hint: 'Token canister ID' }, { key: 'amount', hint: 'Amount' }],
    251: [{ key: 'token', hint: 'Token canister ID' }, { key: 'amount', hint: 'Amount' }],
    // OvercommitDetected
    252: [{ key: 'token', hint: 'Token canister ID' }, { key: 'onChainBalance', hint: 'On-chain balance' }, { key: 'allocatedTotal', hint: 'Total allocated to purses' }],
    // SnapshotTaken
    260: [{ key: 'snapshotId', hint: 'Snapshot ID' }, { key: 'trigger', hint: 'Trigger source' }, { key: 'choreId', hint: 'Chore instance ID (if applicable)' }],
    // CumulativeLimitReached
    270: [{ key: 'choreId', hint: 'Chore instance ID' }, { key: 'actionId', hint: 'Action ID' }, { key: 'limitType', hint: 'Limit type (input/output)' }, { key: 'current', hint: 'Current cumulative amount' }, { key: 'max', hint: 'Maximum allowed' }],
};

const opLabel = (id) => CONDITION_OPS.find(o => o.id === Number(id))?.label || `Op ${id}`;

function formatTimestamp(ns) {
    if (!ns) return '—';
    const ms = Number(ns) / 1_000_000;
    if (ms <= 0) return '—';
    const d = new Date(ms);
    return d.toLocaleString(undefined, {
        month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
}

function shortPrincipal(p) {
    const s = typeof p === 'string' ? p : p?.toText?.() || String(p);
    return s.length > 20 ? s.slice(0, 8) + '…' + s.slice(-6) : s;
}

export default function BotEventPanel({ canisterId, identity, theme, accentColor, hasPermission, choreStatuses, tokenRegistryEntries }) {
    const { principalNames, principalNicknames } = useNaming();
    const walletCtx = useWalletOptional();
    const knownBots = React.useMemo(() => {
        if (!walletCtx) return [];
        const { allBotEntries = [], appInfoMap = {} } = walletCtx;
        const seen = new Set();
        return allBotEntries
            .filter(e => {
                const cid = typeof e.canisterId === 'string' ? e.canisterId : e.canisterId?.toString?.() || '';
                if (!cid || seen.has(cid)) return false;
                seen.add(cid);
                return true;
            })
            .map(e => {
                const cid = typeof e.canisterId === 'string' ? e.canisterId : e.canisterId?.toString?.() || '';
                const appInfo = e.resolvedAppId ? appInfoMap[e.resolvedAppId] : null;
                return { canisterId: cid, appName: appInfo?.name || e.resolvedAppId || null };
            });
    }, [walletCtx]);
    const accent = accentColor;
    const canManage = hasPermission('ManageEvents');
    const canView = hasPermission('ViewEvents') || canManage;

    const [subTab, setSubTab] = useState('source');

    // ----- Actor -----
    const getActor = useCallback(async () => {
        if (!identity) throw new Error('Not authenticated');
        const agent = HttpAgent.createSync({ identity, host: 'https://icp-api.io' });
        return Actor.createActor(botEventIdlFactory, { agent, canisterId });
    }, [canisterId, identity]);

    // Cache of event type names per source bot canister ID: { [canisterId]: [{id, name}] }
    const sourceEventTypeCache = useRef({});
    const [reactionEventTypes, setReactionEventTypes] = useState([]);

    const fetchEventTypesForSource = useCallback(async (sourceBotId) => {
        if (!sourceBotId) { setReactionEventTypes([]); return; }
        const pid = typeof sourceBotId === 'string' ? sourceBotId : sourceBotId?.toText?.() || String(sourceBotId);
        if (sourceEventTypeCache.current[pid]) {
            setReactionEventTypes(sourceEventTypeCache.current[pid]);
            return;
        }
        try {
            const agent = HttpAgent.createSync({ identity, host: 'https://icp-api.io' });
            const sourceActor = Actor.createActor(botEventIdlFactory, { agent, canisterId: pid });
            const types = await sourceActor.getEventTypes();
            const mapped = types.map(([id, name]) => ({ id: Number(id), name }));
            sourceEventTypeCache.current[pid] = mapped;
            setReactionEventTypes(mapped);
        } catch {
            setReactionEventTypes([]);
        }
    }, [identity]);

    // ==========================================
    // SOURCE SIDE STATE
    // ==========================================
    const [eventTypes, setEventTypes] = useState([]);
    const [listeners, setListeners] = useState([]);
    const [emissionEnabled, setEmissionEnabled] = useState(null);
    const [eventLog, setEventLog] = useState([]);
    const [eventLogHasMore, setEventLogHasMore] = useState(false);
    const [eventLogTotal, setEventLogTotal] = useState(0);
    const [sourceLoading, setSourceLoading] = useState(false);
    const [sourceError, setSourceError] = useState('');
    const [sourceSuccess, setSourceSuccess] = useState('');
    const [togglingEmission, setTogglingEmission] = useState(false);
    const [removingListener, setRemovingListener] = useState(null);

    // ==========================================
    // LISTENER SIDE STATE
    // ==========================================
    const [subscriptions, setSubscriptions] = useState([]);
    const [reactions, setReactions] = useState([]);
    const [availableActions, setAvailableActions] = useState([]);
    const [reactionLog, setReactionLog] = useState([]);
    const [reactionLogHasMore, setReactionLogHasMore] = useState(false);
    const [reactionLogTotal, setReactionLogTotal] = useState(0);
    const [listenerLoading, setListenerLoading] = useState(false);
    const [listenerError, setListenerError] = useState('');
    const [listenerSuccess, setListenerSuccess] = useState('');

    // Add subscription form
    const [newSubBotId, setNewSubBotId] = useState('');
    const [addingSub, setAddingSub] = useState(false);
    const [sourceEventTypes, setSourceEventTypes] = useState(null); // fetched from source bot
    const [sourceEventTypesLoading, setSourceEventTypesLoading] = useState(false);
    const [selectedSourceEvents, setSelectedSourceEvents] = useState(new Set());

    // Add/edit reaction form
    const [showReactionForm, setShowReactionForm] = useState(false);
    const [editingReactionId, setEditingReactionId] = useState(null);
    const [reactionForm, setReactionForm] = useState({
        name: '', enabled: true, subscriptionId: '', eventTypeId: '',
        reactionActionId: '', actionParams: [], conditions: [], cooldownSeconds: '',
    });
    const [savingReaction, setSavingReaction] = useState(false);
    const [removingReaction, setRemovingReaction] = useState(null);
    const [removingSub, setRemovingSub] = useState(null);
    const [editingSubId, setEditingSubId] = useState(null);
    const [editSubEventTypes, setEditSubEventTypes] = useState(null);
    const [editSubAvailable, setEditSubAvailable] = useState(null);
    const [editSubLoading, setEditSubLoading] = useState(false);
    const [savingSub, setSavingSub] = useState(false);

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
        color: theme.colors.primaryText, fontSize: '0.85rem', outline: 'none',
        boxSizing: 'border-box',
    };
    const btnStyle = {
        padding: '0.4rem 1rem', borderRadius: '8px',
        background: accent, color: '#fff', border: 'none',
        fontSize: '0.82rem', fontWeight: '600', cursor: 'pointer',
    };
    const btnSecondary = {
        padding: '0.4rem 0.8rem', borderRadius: '8px',
        background: 'transparent', color: theme.colors.primaryText,
        border: `1px solid ${theme.colors.border}`,
        fontSize: '0.8rem', cursor: 'pointer',
    };
    const btnDanger = {
        ...btnSecondary, color: theme.colors.error || '#ef4444',
        borderColor: theme.colors.error || '#ef4444',
    };
    const subTabStyle = (active) => ({
        padding: '4px 14px', cursor: 'pointer', fontSize: '0.78rem', fontWeight: '500',
        borderBottom: `2px solid ${active ? accent : 'transparent'}`,
        color: active ? accent : theme.colors.secondaryText,
        background: 'none', border: 'none', borderRadius: 0,
    });
    const labelStyle = { fontSize: '0.72rem', color: theme.colors.secondaryText, marginBottom: '3px', display: 'block' };
    const cellStyle = { padding: '6px 8px', borderBottom: `1px solid ${theme.colors.border}`, fontSize: '0.78rem', color: theme.colors.primaryText };
    const headerCellStyle = { ...cellStyle, fontWeight: 600, color: theme.colors.secondaryText, fontSize: '0.72rem' };
    const sectionTitle = { fontSize: '0.88rem', fontWeight: 600, color: theme.colors.primaryText, marginBottom: '10px' };

    // ==========================================
    // DATA LOADING
    // ==========================================
    const loadSourceData = useCallback(async (silent = false) => {
        if (!canView) return;
        if (!silent) setSourceLoading(true);
        setSourceError('');
        try {
            const actor = await getActor();
            const [types, lsnrs, log] = await Promise.all([
                actor.getEventTypes(),
                actor.getEventListeners(),
                actor.getEventLog({ eventTypeId: [], fromTime: [], toTime: [], startId: [], limit: [BigInt(50)] }),
            ]);
            setEventTypes(types.map(([id, name]) => ({ id: Number(id), name })));
            setListeners(lsnrs);
            setEventLog(log.entries);
            setEventLogHasMore(log.hasMore);
            setEventLogTotal(Number(log.totalMatching));
        } catch (e) {
            if (!silent) setSourceError(e.message || String(e));
        } finally {
            if (!silent) setSourceLoading(false);
        }
    }, [canView, getActor]);

    const loadListenerData = useCallback(async (silent = false) => {
        if (!canView) return;
        if (!silent) setListenerLoading(true);
        setListenerError('');
        try {
            const actor = await getActor();
            const [subs, rcts, actions, rlog] = await Promise.all([
                actor.getEventSubscriptions(),
                actor.getEventReactions(),
                actor.getAvailableReactionActions(),
                actor.getEventReactionLog({ reactionRuleId: [], eventTypeId: [], fromTime: [], toTime: [], startId: [], limit: [BigInt(50)] }),
            ]);
            setSubscriptions(subs);
            setReactions(rcts);
            setAvailableActions(actions.map(([id, name]) => ({ id: Number(id), name })));
            setReactionLog(rlog.entries);
            setReactionLogHasMore(rlog.hasMore);
            setReactionLogTotal(Number(rlog.totalMatching));
        } catch (e) {
            if (!silent) setListenerError(e.message || String(e));
        } finally {
            if (!silent) setListenerLoading(false);
        }
    }, [canView, getActor]);

    useEffect(() => {
        if (subTab === 'source') loadSourceData();
        else loadListenerData();
    }, [subTab, loadSourceData, loadListenerData]);

    // ==========================================
    // SOURCE ACTIONS
    // ==========================================
    const toggleEmission = useCallback(async () => {
        setTogglingEmission(true);
        setSourceError('');
        try {
            const actor = await getActor();
            const newVal = !emissionEnabled;
            await actor.setEventEmissionEnabled(newVal);
            setEmissionEnabled(newVal);
            setSourceSuccess(`Event emission ${newVal ? 'enabled' : 'disabled'}`);
            setTimeout(() => setSourceSuccess(''), 3000);
        } catch (e) {
            setSourceError(e.message || String(e));
        } finally {
            setTogglingEmission(false);
        }
    }, [getActor, emissionEnabled]);

    const removeListener = useCallback(async (id) => {
        setRemovingListener(id);
        setSourceError('');
        try {
            const actor = await getActor();
            await actor.unregisterEventListener(BigInt(id));
            setSourceSuccess('Listener removed');
            setTimeout(() => setSourceSuccess(''), 3000);
            await loadSourceData(true);
        } catch (e) {
            setSourceError(e.message || String(e));
        } finally {
            setRemovingListener(null);
        }
    }, [getActor, loadSourceData]);

    // ==========================================
    // LISTENER ACTIONS
    // ==========================================
    const fetchSourceEventTypes = useCallback(async (botIdText) => {
        if (!botIdText.trim()) { setSourceEventTypes(null); return; }
        setSourceEventTypesLoading(true);
        setSourceEventTypes(null);
        setSelectedSourceEvents(new Set());
        try {
            Principal.fromText(botIdText.trim()); // validate
            const agent = HttpAgent.createSync({ identity, host: 'https://icp-api.io' });
            const sourceActor = Actor.createActor(botEventIdlFactory, { agent, canisterId: botIdText.trim() });
            const types = await sourceActor.getEventTypes();
            setSourceEventTypes(types.map(([id, name]) => ({ id: Number(id), name })));
        } catch (e) {
            setSourceEventTypes([]);
            setListenerError('Could not fetch event types from source bot: ' + (e.message || String(e)));
        } finally {
            setSourceEventTypesLoading(false);
        }
    }, [identity]);

    const toggleSourceEvent = (id) => {
        setSelectedSourceEvents(prev => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id); else next.add(id);
            return next;
        });
    };

    const addSubscription = useCallback(async () => {
        setAddingSub(true);
        setListenerError('');
        try {
            const principal = Principal.fromText(newSubBotId.trim());
            const ids = Array.from(selectedSourceEvents).map(n => BigInt(n));
            if (ids.length === 0) throw new Error('Select at least one event type');
            const actor = await getActor();
            const result = await actor.addEventSubscription(principal, ids);
            if ('Err' in result) throw new Error(result.Err);
            setNewSubBotId('');
            setSourceEventTypes(null);
            setSelectedSourceEvents(new Set());
            setListenerSuccess('Subscription added (ID: ' + Number(result.Ok) + ')');
            setTimeout(() => setListenerSuccess(''), 3000);
            await loadListenerData(true);
        } catch (e) {
            setListenerError(e.message || String(e));
        } finally {
            setAddingSub(false);
        }
    }, [getActor, newSubBotId, selectedSourceEvents, loadListenerData]);

    const removeSubscription = useCallback(async (id) => {
        setRemovingSub(id);
        setListenerError('');
        try {
            const actor = await getActor();
            await actor.removeEventSubscription(BigInt(id));
            setListenerSuccess('Subscription removed');
            setTimeout(() => setListenerSuccess(''), 3000);
            await loadListenerData(true);
        } catch (e) {
            setListenerError(e.message || String(e));
        } finally {
            setRemovingSub(null);
        }
    }, [getActor, loadListenerData]);

    const startEditSubscription = useCallback(async (sub) => {
        const subId = Number(sub.id);
        if (editingSubId === subId) { setEditingSubId(null); return; }
        setEditingSubId(subId);
        setEditSubEventTypes(new Set(sub.eventTypeIds.map(id => Number(id))));
        setEditSubAvailable(null);
        setEditSubLoading(true);
        try {
            const pid = typeof sub.sourceBotCanisterId === 'string' ? sub.sourceBotCanisterId : sub.sourceBotCanisterId?.toText?.() || String(sub.sourceBotCanisterId);
            if (sourceEventTypeCache.current[pid]) {
                setEditSubAvailable(sourceEventTypeCache.current[pid]);
            } else {
                const agent = HttpAgent.createSync({ identity, host: 'https://icp-api.io' });
                const sourceActor = Actor.createActor(botEventIdlFactory, { agent, canisterId: pid });
                const types = await sourceActor.getEventTypes();
                const mapped = types.map(([id, name]) => ({ id: Number(id), name }));
                sourceEventTypeCache.current[pid] = mapped;
                setEditSubAvailable(mapped);
            }
        } catch {
            setEditSubAvailable([]);
        } finally {
            setEditSubLoading(false);
        }
    }, [editingSubId, identity]);

    const saveSubscription = useCallback(async () => {
        if (editingSubId == null || !editSubEventTypes || editSubEventTypes.size === 0) return;
        setSavingSub(true);
        setListenerError('');
        try {
            const actor = await getActor();
            const ids = Array.from(editSubEventTypes).map(n => BigInt(n));
            const result = await actor.updateEventSubscription(BigInt(editingSubId), ids);
            if (result && 'Err' in result) throw new Error(result.Err);
            setListenerSuccess('Subscription updated');
            setTimeout(() => setListenerSuccess(''), 3000);
            setEditingSubId(null);
            await loadListenerData(true);
        } catch (e) {
            setListenerError(e.message || String(e));
        } finally {
            setSavingSub(false);
        }
    }, [getActor, editingSubId, editSubEventTypes, loadListenerData]);

    const getTokenDecimals = useCallback((tokenCanisterId) => {
        if (!tokenCanisterId) return 8;
        if (tokenRegistryEntries) {
            const entry = tokenRegistryEntries.find(t =>
                t.ledgerCanisterId === tokenCanisterId || t.canisterId === tokenCanisterId
            );
            if (entry && entry.decimals !== undefined) return Number(entry.decimals);
        }
        try {
            const meta = getTokenMetadataSync(tokenCanisterId);
            if (meta?.decimals !== undefined) return Number(meta.decimals);
        } catch {}
        return 8;
    }, [tokenRegistryEntries]);

    const getTokenSymbol = useCallback((tokenCanisterId) => {
        if (!tokenCanisterId) return null;
        if (tokenRegistryEntries) {
            const entry = tokenRegistryEntries.find(t =>
                t.ledgerCanisterId === tokenCanisterId || t.canisterId === tokenCanisterId
            );
            if (entry?.symbol) return entry.symbol;
        }
        try {
            const meta = getTokenMetadataSync(tokenCanisterId);
            if (meta?.symbol) return meta.symbol;
        } catch {}
        return null;
    }, [tokenRegistryEntries]);

    const openReactionForm = (rule = null) => {
        if (rule) {
            const subId = String(Number(rule.subscriptionId));
            const sub = subscriptions.find(s => Number(s.id) === Number(subId));
            if (sub) fetchEventTypesForSource(sub.sourceBotCanisterId);

            const params = rule.actionParams.map(([k, v]) => ({ key: k, value: v }));
            const tokenParam = params.find(p => p.key === 'token');
            if (tokenParam) {
                const decimals = getTokenDecimals(tokenParam.value);
                const amountParam = params.find(p => p.key === 'amount');
                if (amountParam && amountParam.value) {
                    try {
                        amountParam.value = String(Number(amountParam.value) / Math.pow(10, decimals));
                    } catch {}
                }
            }

            setEditingReactionId(Number(rule.id));
            setReactionForm({
                name: rule.name,
                enabled: rule.enabled,
                subscriptionId: subId,
                eventTypeId: String(Number(rule.eventTypeId)),
                reactionActionId: String(Number(rule.reactionActionId)),
                actionParams: params,
                conditions: rule.conditions.map(c => ({ dataKey: c.dataKey, operator: String(Number(c.operator)), value: c.value })),
                cooldownSeconds: rule.cooldownSeconds.length > 0 ? String(Number(rule.cooldownSeconds[0])) : '',
            });
        } else {
            setEditingReactionId(null);
            setReactionEventTypes([]);
            setReactionForm({
                name: '', enabled: true, subscriptionId: '', eventTypeId: '',
                reactionActionId: '', actionParams: [], conditions: [], cooldownSeconds: '',
            });
        }
        setShowReactionForm(true);
    };

    const saveReaction = useCallback(async () => {
        setSavingReaction(true);
        setListenerError('');
        try {
            const convertedParams = reactionForm.actionParams.map(p => {
                if (p.key === 'amount') {
                    const tokenParam = reactionForm.actionParams.find(pp => pp.key === 'token');
                    const decimals = getTokenDecimals(tokenParam?.value);
                    const humanVal = parseFloat(p.value);
                    if (!isNaN(humanVal)) {
                        const raw = Math.round(humanVal * Math.pow(10, decimals));
                        return [p.key, String(raw)];
                    }
                }
                return [p.key, p.value];
            });

            const input = {
                name: reactionForm.name,
                enabled: reactionForm.enabled,
                subscriptionId: BigInt(reactionForm.subscriptionId),
                eventTypeId: BigInt(reactionForm.eventTypeId),
                reactionActionId: BigInt(reactionForm.reactionActionId),
                actionParams: convertedParams,
                conditions: reactionForm.conditions.map(c => ({
                    dataKey: c.dataKey,
                    operator: BigInt(c.operator),
                    value: c.value,
                })),
                cooldownSeconds: reactionForm.cooldownSeconds ? [BigInt(reactionForm.cooldownSeconds)] : [],
            };
            const actor = await getActor();
            if (editingReactionId !== null) {
                await actor.updateEventReaction(BigInt(editingReactionId), input);
                setListenerSuccess('Reaction rule updated');
            } else {
                const id = await actor.addEventReaction(input);
                setListenerSuccess('Reaction rule added (ID: ' + Number(id) + ')');
            }
            setTimeout(() => setListenerSuccess(''), 3000);
            setShowReactionForm(false);
            await loadListenerData(true);
        } catch (e) {
            setListenerError(e.message || String(e));
        } finally {
            setSavingReaction(false);
        }
    }, [getActor, reactionForm, editingReactionId, loadListenerData, getTokenDecimals]);

    const removeReaction = useCallback(async (id) => {
        setRemovingReaction(id);
        setListenerError('');
        try {
            const actor = await getActor();
            await actor.removeEventReaction(BigInt(id));
            setListenerSuccess('Reaction rule removed');
            setTimeout(() => setListenerSuccess(''), 3000);
            await loadListenerData(true);
        } catch (e) {
            setListenerError(e.message || String(e));
        } finally {
            setRemovingReaction(null);
        }
    }, [getActor, loadListenerData]);

    const eventTypeName = (id) => {
        const et = eventTypes.find(t => t.id === Number(id));
        return et ? et.name : `Event #${id}`;
    };

    const actionName = (id) => {
        const a = availableActions.find(x => x.id === Number(id));
        return a ? a.name : `Action #${id}`;
    };

    const principalDisplay = (p) => {
        const text = typeof p === 'string' ? p : p?.toText?.() || String(p);
        return (
            <PrincipalDisplay
                principal={text}
                displayInfo={getPrincipalDisplayInfoFromContext(text, principalNames, principalNicknames)}
                showCopyButton={false} isAuthenticated={!!identity} />
        );
    };

    // ==========================================
    // RENDER
    // ==========================================
    if (!canView) {
        return (
            <div style={cardStyle}>
                <div style={{ color: theme.colors.mutedText, fontSize: '0.85rem', textAlign: 'center', padding: '20px' }}>
                    You need the <strong>ViewEvents</strong> or <strong>ManageEvents</strong> permission to access event settings.
                </div>
            </div>
        );
    }

    return (
        <div>
            {/* Sub-tabs */}
            <div style={{ display: 'flex', gap: '0', marginBottom: '14px', borderBottom: `1px solid ${theme.colors.border}` }}>
                <button style={subTabStyle(subTab === 'source')} onClick={() => setSubTab('source')}>Source (Outgoing)</button>
                <button style={subTabStyle(subTab === 'listener')} onClick={() => setSubTab('listener')}>Listener (Incoming)</button>
            </div>

            {/* ==================== SOURCE TAB ==================== */}
            {subTab === 'source' && (
                <div>
                    {sourceError && <div style={{ color: theme.colors.error || '#ef4444', fontSize: '0.82rem', marginBottom: '10px', padding: '8px 12px', background: 'rgba(239,68,68,0.08)', borderRadius: '8px' }}>{sourceError}</div>}
                    {sourceSuccess && <div style={{ color: theme.colors.success || '#22c55e', fontSize: '0.82rem', marginBottom: '10px', padding: '8px 12px', background: 'rgba(34,197,94,0.08)', borderRadius: '8px' }}>{sourceSuccess}</div>}

                    {/* Emission Toggle + Refresh */}
                    <div style={{ ...cardStyle, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                            <span style={{ fontSize: '0.82rem', color: theme.colors.primaryText }}>Event Emission</span>
                            {emissionEnabled !== null && (
                                <span style={{
                                    fontSize: '0.72rem', fontWeight: 600, padding: '2px 10px', borderRadius: '12px',
                                    background: emissionEnabled ? 'rgba(34,197,94,0.15)' : 'rgba(239,68,68,0.12)',
                                    color: emissionEnabled ? (theme.colors.success || '#22c55e') : (theme.colors.error || '#ef4444'),
                                }}>
                                    {emissionEnabled ? 'Enabled' : 'Disabled'}
                                </span>
                            )}
                        </div>
                        <div style={{ display: 'flex', gap: '8px' }}>
                            {canManage && (
                                <button style={btnSecondary} onClick={toggleEmission} disabled={togglingEmission}>
                                    {togglingEmission ? '...' : (emissionEnabled ? 'Disable' : 'Enable')}
                                </button>
                            )}
                            <button style={btnSecondary} onClick={() => loadSourceData()} disabled={sourceLoading}>
                                {sourceLoading ? 'Loading...' : 'Refresh'}
                            </button>
                        </div>
                    </div>

                    {/* Event Types */}
                    <div style={cardStyle}>
                        <div style={sectionTitle}>Event Types</div>
                        {eventTypes.length === 0 ? (
                            <div style={{ color: theme.colors.mutedText, fontSize: '0.8rem' }}>No event types registered.</div>
                        ) : (
                            <div style={{ overflowX: 'auto' }}>
                                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                                    <thead>
                                        <tr>
                                            <th style={headerCellStyle}>ID</th>
                                            <th style={{ ...headerCellStyle, textAlign: 'left' }}>Name</th>
                                            <th style={{ ...headerCellStyle, textAlign: 'left' }}>Data Keys</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {eventTypes.map(t => {
                                            const keys = EVENT_DATA_KEYS[t.id] || [];
                                            return (
                                                <tr key={t.id}>
                                                    <td style={{ ...cellStyle, fontFamily: 'monospace', width: '60px' }}>{t.id}</td>
                                                    <td style={cellStyle}>{t.name}</td>
                                                    <td style={cellStyle}>
                                                        {keys.length > 0 ? (
                                                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '3px' }}>
                                                                {keys.map(k => (
                                                                    <span key={k.key} title={k.hint} style={{
                                                                        fontSize: '0.68rem', padding: '1px 5px', borderRadius: '3px',
                                                                        background: `${accent}10`, border: `1px solid ${accent}25`,
                                                                        fontFamily: 'monospace', color: theme.colors.primaryText,
                                                                    }}>
                                                                        {k.key}
                                                                    </span>
                                                                ))}
                                                            </div>
                                                        ) : (
                                                            <span style={{ color: theme.colors.mutedText, fontSize: '0.68rem' }}>—</span>
                                                        )}
                                                    </td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            </div>
                        )}
                    </div>

                    {/* Listeners */}
                    <div style={cardStyle}>
                        <div style={sectionTitle}>Registered Listeners</div>
                        {listeners.length === 0 ? (
                            <div style={{ color: theme.colors.mutedText, fontSize: '0.8rem' }}>No listeners registered.</div>
                        ) : (
                            <div style={{ overflowX: 'auto' }}>
                                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                                    <thead>
                                        <tr>
                                            <th style={headerCellStyle}>ID</th>
                                            <th style={{ ...headerCellStyle, textAlign: 'left' }}>Listener</th>
                                            <th style={{ ...headerCellStyle, textAlign: 'left' }}>Event Types</th>
                                            <th style={headerCellStyle}>Registered</th>
                                            <th style={headerCellStyle}>Status</th>
                                            {canManage && <th style={headerCellStyle}></th>}
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {listeners.map(l => (
                                            <tr key={Number(l.id)}>
                                                <td style={{ ...cellStyle, fontFamily: 'monospace', width: '40px' }}>{Number(l.id)}</td>
                                                <td style={cellStyle}>{principalDisplay(l.listenerCanisterId)}</td>
                                                <td style={cellStyle}>
                                                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                                                        {l.eventTypeIds.map(id => (
                                                            <span key={Number(id)} style={{
                                                                fontSize: '0.7rem', padding: '1px 6px', borderRadius: '4px',
                                                                background: theme.colors.secondaryBg, border: `1px solid ${theme.colors.border}`,
                                                            }}>
                                                                {eventTypeName(Number(id))}
                                                            </span>
                                                        ))}
                                                    </div>
                                                </td>
                                                <td style={{ ...cellStyle, whiteSpace: 'nowrap' }}>{formatTimestamp(l.registeredAt)}</td>
                                                <td style={{ ...cellStyle, textAlign: 'center' }}>
                                                    <span style={{
                                                        fontSize: '0.7rem', fontWeight: 600, padding: '1px 8px', borderRadius: '10px',
                                                        background: l.enabled ? 'rgba(34,197,94,0.15)' : 'rgba(239,68,68,0.12)',
                                                        color: l.enabled ? (theme.colors.success || '#22c55e') : (theme.colors.error || '#ef4444'),
                                                    }}>
                                                        {l.enabled ? 'Active' : 'Disabled'}
                                                    </span>
                                                </td>
                                                {canManage && (
                                                    <td style={{ ...cellStyle, textAlign: 'center' }}>
                                                        <button style={btnDanger} onClick={() => removeListener(Number(l.id))}
                                                            disabled={removingListener === Number(l.id)}>
                                                            {removingListener === Number(l.id) ? '...' : 'Remove'}
                                                        </button>
                                                    </td>
                                                )}
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        )}
                    </div>

                    {/* Event Log */}
                    <div style={cardStyle}>
                        <div style={{ ...sectionTitle, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <span>Emitted Events Log</span>
                            {eventLogTotal > 0 && <span style={{ fontSize: '0.72rem', color: theme.colors.mutedText, fontWeight: 400 }}>{eventLogTotal} total</span>}
                        </div>
                        {eventLog.length === 0 ? (
                            <div style={{ color: theme.colors.mutedText, fontSize: '0.8rem' }}>No events emitted yet.</div>
                        ) : (
                            <div style={{ overflowX: 'auto' }}>
                                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                                    <thead>
                                        <tr>
                                            <th style={headerCellStyle}>ID</th>
                                            <th style={{ ...headerCellStyle, textAlign: 'left' }}>Event Type</th>
                                            <th style={headerCellStyle}>Time</th>
                                            <th style={{ ...headerCellStyle, textAlign: 'left' }}>Data</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {eventLog.map(e => (
                                            <tr key={Number(e.eventId)}>
                                                <td style={{ ...cellStyle, fontFamily: 'monospace', width: '50px' }}>{Number(e.eventId)}</td>
                                                <td style={cellStyle}>
                                                    <span style={{
                                                        fontSize: '0.72rem', padding: '1px 6px', borderRadius: '4px',
                                                        background: `${accent}18`, color: accent, fontWeight: 500,
                                                    }}>
                                                        {eventTypeName(Number(e.eventTypeId))}
                                                    </span>
                                                </td>
                                                <td style={{ ...cellStyle, whiteSpace: 'nowrap' }}>{formatTimestamp(e.timestamp)}</td>
                                                <td style={cellStyle}>
                                                    {e.data.length > 0 ? (
                                                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '3px' }}>
                                                            {e.data.map(([k, v], i) => (
                                                                <span key={i} style={{
                                                                    fontSize: '0.68rem', padding: '1px 5px', borderRadius: '3px',
                                                                    background: theme.colors.secondaryBg, border: `1px solid ${theme.colors.border}`,
                                                                    fontFamily: 'monospace',
                                                                }}>
                                                                    {k}={v.length > 30 ? v.slice(0, 27) + '…' : v}
                                                                </span>
                                                            ))}
                                                        </div>
                                                    ) : (
                                                        <span style={{ color: theme.colors.mutedText, fontSize: '0.72rem' }}>—</span>
                                                    )}
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                                {eventLogHasMore && (
                                    <div style={{ textAlign: 'center', padding: '8px', color: theme.colors.mutedText, fontSize: '0.75rem' }}>
                                        Showing latest {eventLog.length} of {eventLogTotal}
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* ==================== LISTENER TAB ==================== */}
            {subTab === 'listener' && (
                <div>
                    {listenerError && <div style={{ color: theme.colors.error || '#ef4444', fontSize: '0.82rem', marginBottom: '10px', padding: '8px 12px', background: 'rgba(239,68,68,0.08)', borderRadius: '8px' }}>{listenerError}</div>}
                    {listenerSuccess && <div style={{ color: theme.colors.success || '#22c55e', fontSize: '0.82rem', marginBottom: '10px', padding: '8px 12px', background: 'rgba(34,197,94,0.08)', borderRadius: '8px' }}>{listenerSuccess}</div>}

                    {/* Refresh */}
                    <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '10px' }}>
                        <button style={btnSecondary} onClick={() => loadListenerData()} disabled={listenerLoading}>
                            {listenerLoading ? 'Loading...' : 'Refresh'}
                        </button>
                    </div>

                    {/* Subscriptions */}
                    <div style={cardStyle}>
                        <div style={{ ...sectionTitle, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <span>Event Subscriptions</span>
                            <span style={{ fontSize: '0.72rem', color: theme.colors.mutedText, fontWeight: 400 }}>{subscriptions.length} subscription{subscriptions.length !== 1 ? 's' : ''}</span>
                        </div>
                        {subscriptions.length > 0 && (
                            <div style={{ overflowX: 'auto', marginBottom: canManage ? '14px' : 0 }}>
                                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                                    <thead>
                                        <tr>
                                            <th style={headerCellStyle}>ID</th>
                                            <th style={{ ...headerCellStyle, textAlign: 'left' }}>Source Bot</th>
                                            <th style={{ ...headerCellStyle, textAlign: 'left' }}>Event Types</th>
                                            <th style={headerCellStyle}>Reg. ID</th>
                                            <th style={headerCellStyle}>Status</th>
                                            {canManage && <th style={headerCellStyle}></th>}
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {subscriptions.map(s => {
                                            const sid = Number(s.id);
                                            const isEditing = editingSubId === sid;
                                            return (
                                                <React.Fragment key={sid}>
                                                    <tr>
                                                        <td style={{ ...cellStyle, fontFamily: 'monospace', width: '40px' }}>{sid}</td>
                                                        <td style={cellStyle}>{principalDisplay(s.sourceBotCanisterId)}</td>
                                                        <td style={cellStyle}>
                                                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                                                                {s.eventTypeIds.map(id => {
                                                                    const pid = typeof s.sourceBotCanisterId === 'string' ? s.sourceBotCanisterId : s.sourceBotCanisterId?.toText?.() || String(s.sourceBotCanisterId);
                                                                    const cached = sourceEventTypeCache.current[pid];
                                                                    const et = cached?.find(t => t.id === Number(id));
                                                                    return (
                                                                        <span key={Number(id)} style={{
                                                                            fontSize: '0.7rem', padding: '1px 6px', borderRadius: '4px',
                                                                            background: theme.colors.secondaryBg, border: `1px solid ${theme.colors.border}`,
                                                                        }}>
                                                                            {et ? et.name : `#${Number(id)}`}
                                                                        </span>
                                                                    );
                                                                })}
                                                            </div>
                                                        </td>
                                                        <td style={{ ...cellStyle, textAlign: 'center', fontFamily: 'monospace' }}>
                                                            {s.registrationId.length > 0 ? Number(s.registrationId[0]) : '—'}
                                                        </td>
                                                        <td style={{ ...cellStyle, textAlign: 'center' }}>
                                                            <span style={{
                                                                fontSize: '0.7rem', fontWeight: 600, padding: '1px 8px', borderRadius: '10px',
                                                                background: s.enabled ? 'rgba(34,197,94,0.15)' : 'rgba(239,68,68,0.12)',
                                                                color: s.enabled ? (theme.colors.success || '#22c55e') : (theme.colors.error || '#ef4444'),
                                                            }}>
                                                                {s.enabled ? 'Active' : 'Disabled'}
                                                            </span>
                                                        </td>
                                                        {canManage && (
                                                            <td style={{ ...cellStyle, textAlign: 'center' }}>
                                                                <div style={{ display: 'flex', gap: '6px', justifyContent: 'center' }}>
                                                                    <button style={btnSecondary} onClick={() => startEditSubscription(s)}>
                                                                        {isEditing ? 'Close' : 'Edit'}
                                                                    </button>
                                                                    <button style={btnDanger} onClick={() => removeSubscription(sid)}
                                                                        disabled={removingSub === sid}>
                                                                        {removingSub === sid ? '...' : 'Remove'}
                                                                    </button>
                                                                </div>
                                                            </td>
                                                        )}
                                                    </tr>
                                                    {isEditing && (
                                                        <tr>
                                                            <td colSpan={canManage ? 6 : 5} style={{ padding: '10px 14px', background: `${accent}06`, borderBottom: `1px solid ${theme.colors.border}` }}>
                                                                <div style={{ fontSize: '0.8rem', fontWeight: 600, color: theme.colors.primaryText, marginBottom: '8px' }}>
                                                                    Edit Subscribed Event Types
                                                                </div>
                                                                {editSubLoading && (
                                                                    <div style={{ color: theme.colors.mutedText, fontSize: '0.8rem', padding: '8px' }}>Loading event types...</div>
                                                                )}
                                                                {editSubAvailable && !editSubLoading && (
                                                                    <>
                                                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                                                                            <span style={{ fontSize: '0.75rem', color: theme.colors.mutedText }}>
                                                                                {editSubEventTypes?.size || 0} of {editSubAvailable.length} selected
                                                                            </span>
                                                                            <div style={{ display: 'flex', gap: '6px' }}>
                                                                                <button style={{ ...btnSecondary, fontSize: '0.7rem', padding: '2px 8px' }}
                                                                                    onClick={() => setEditSubEventTypes(new Set(editSubAvailable.map(t => t.id)))}>All</button>
                                                                                <button style={{ ...btnSecondary, fontSize: '0.7rem', padding: '2px 8px' }}
                                                                                    onClick={() => setEditSubEventTypes(new Set())}>None</button>
                                                                            </div>
                                                                        </div>
                                                                        <div style={{
                                                                            display: 'flex', flexWrap: 'wrap', gap: '4px',
                                                                            padding: '8px', background: theme.colors.secondaryBg, borderRadius: '8px',
                                                                            border: `1px solid ${theme.colors.border}`, maxHeight: '200px', overflowY: 'auto',
                                                                        }}>
                                                                            {editSubAvailable.map(t => {
                                                                                const checked = editSubEventTypes?.has(t.id);
                                                                                return (
                                                                                    <label key={t.id} style={{
                                                                                        display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer',
                                                                                        fontSize: '0.78rem', color: theme.colors.primaryText, padding: '4px 8px',
                                                                                        borderRadius: '4px', background: checked ? `${accent}15` : 'transparent',
                                                                                        border: `1px solid ${checked ? accent : 'transparent'}`,
                                                                                        minWidth: '140px',
                                                                                    }}>
                                                                                        <input type="checkbox" checked={checked}
                                                                                            onChange={() => {
                                                                                                const next = new Set(editSubEventTypes);
                                                                                                if (next.has(t.id)) next.delete(t.id); else next.add(t.id);
                                                                                                setEditSubEventTypes(next);
                                                                                            }} />
                                                                                        {t.name}
                                                                                    </label>
                                                                                );
                                                                            })}
                                                                        </div>
                                                                        <div style={{ display: 'flex', gap: '8px', marginTop: '10px', justifyContent: 'flex-end' }}>
                                                                            <button style={btnSecondary} onClick={() => setEditingSubId(null)}>Cancel</button>
                                                                            <button style={btnStyle} onClick={saveSubscription}
                                                                                disabled={savingSub || !editSubEventTypes || editSubEventTypes.size === 0}>
                                                                                {savingSub ? 'Saving...' : 'Save Changes'}
                                                                            </button>
                                                                        </div>
                                                                    </>
                                                                )}
                                                            </td>
                                                        </tr>
                                                    )}
                                                </React.Fragment>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            </div>
                        )}
                        {subscriptions.length === 0 && (
                            <div style={{ color: theme.colors.mutedText, fontSize: '0.8rem', marginBottom: canManage ? '14px' : 0 }}>
                                No subscriptions configured. Add one to start listening to events from another bot.
                            </div>
                        )}

                        {/* Add subscription form */}
                        {canManage && (
                            <div style={{ borderTop: `1px solid ${theme.colors.border}`, paddingTop: '12px' }}>
                                <div style={{ fontSize: '0.8rem', fontWeight: 600, color: theme.colors.primaryText, marginBottom: '10px' }}>Add Subscription</div>

                                {/* Source bot selection */}
                                <label style={labelStyle}>Source Bot</label>

                                {/* Quick-pick buttons */}
                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '8px' }}>
                                    <button style={{
                                        ...btnSecondary, fontSize: '0.78rem', padding: '5px 12px',
                                        display: 'inline-flex', alignItems: 'center', gap: '6px',
                                        ...(newSubBotId === canisterId ? { borderColor: accent, color: accent, background: `${accent}10` } : {}),
                                    }}
                                        onClick={() => { setNewSubBotId(canisterId); fetchSourceEventTypes(canisterId); }}>
                                        This bot (self)
                                    </button>
                                    {knownBots.filter(b => b.canisterId !== canisterId).map(bot => (
                                        <button key={bot.canisterId} style={{
                                            ...btnSecondary, fontSize: '0.78rem', padding: '5px 12px',
                                            display: 'inline-flex', alignItems: 'center', gap: '6px',
                                            ...(newSubBotId === bot.canisterId ? { borderColor: accent, color: accent, background: `${accent}10` } : {}),
                                        }}
                                            onClick={() => { setNewSubBotId(bot.canisterId); fetchSourceEventTypes(bot.canisterId); }}>
                                            <PrincipalDisplay
                                                principal={bot.canisterId}
                                                displayInfo={getPrincipalDisplayInfoFromContext(bot.canisterId, principalNames, principalNicknames)}
                                                showCopyButton={false}
                                                isAuthenticated={!!identity}
                                            />
                                        </button>
                                    ))}
                                </div>

                                {/* Manual entry via PrincipalInput */}
                                <div style={{ marginBottom: '8px' }}>
                                    <PrincipalInput
                                        value={newSubBotId === canisterId || knownBots.some(b => b.canisterId === newSubBotId) ? '' : newSubBotId}
                                        onChange={val => { setNewSubBotId(val); setSourceEventTypes(null); setSelectedSourceEvents(new Set()); }}
                                        onSelect={val => { setNewSubBotId(val); fetchSourceEventTypes(val); }}
                                        onBlur={() => {
                                            if (newSubBotId && newSubBotId !== canisterId && !sourceEventTypes) {
                                                try { Principal.fromText(newSubBotId.trim()); fetchSourceEventTypes(newSubBotId); } catch {}
                                            }
                                        }}
                                        placeholder="Or search / paste another bot's canister ID..."
                                        isAuthenticated={!!identity}
                                        defaultPrincipalType="canisters"
                                    />
                                </div>

                                {/* Show selected bot */}
                                {newSubBotId && newSubBotId !== canisterId && !knownBots.some(b => b.canisterId === newSubBotId) && (
                                    <div style={{
                                        display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px',
                                        fontSize: '0.78rem', padding: '6px 10px', borderRadius: '6px',
                                        background: `${accent}08`, border: `1px solid ${accent}25`,
                                    }}>
                                        <span style={{ color: theme.colors.secondaryText }}>Selected:</span>
                                        <PrincipalDisplay
                                            principal={newSubBotId}
                                            displayInfo={getPrincipalDisplayInfoFromContext(newSubBotId, principalNames, principalNicknames)}
                                            showCopyButton={false}
                                            isAuthenticated={!!identity}
                                        />
                                        <button style={{ ...btnSecondary, fontSize: '0.68rem', padding: '1px 6px', marginLeft: 'auto' }}
                                            onClick={() => { setNewSubBotId(''); setSourceEventTypes(null); setSelectedSourceEvents(new Set()); }}>
                                            Clear
                                        </button>
                                    </div>
                                )}

                                {/* Loading state */}
                                {sourceEventTypesLoading && (
                                    <div style={{ color: theme.colors.mutedText, fontSize: '0.8rem', padding: '12px', textAlign: 'center' }}>
                                        Fetching event types from source bot...
                                    </div>
                                )}

                                {/* Event type checklist */}
                                {sourceEventTypes !== null && !sourceEventTypesLoading && (
                                    <div style={{ marginBottom: '12px' }}>
                                        {sourceEventTypes.length === 0 ? (
                                            <div style={{ color: theme.colors.mutedText, fontSize: '0.8rem', padding: '12px', background: theme.colors.secondaryBg, borderRadius: '8px', textAlign: 'center' }}>
                                                No event types found. This bot may not support the event system or hasn't been upgraded yet.
                                            </div>
                                        ) : (
                                            <>
                                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                                                    <label style={{ ...labelStyle, marginBottom: 0 }}>
                                                        Select events to listen to
                                                        {selectedSourceEvents.size > 0 && (
                                                            <span style={{ marginLeft: '6px', color: accent, fontWeight: 600 }}>
                                                                ({selectedSourceEvents.size} selected)
                                                            </span>
                                                        )}
                                                    </label>
                                                    <div style={{ display: 'flex', gap: '6px' }}>
                                                        <button style={{ ...btnSecondary, fontSize: '0.7rem', padding: '2px 8px' }}
                                                            onClick={() => setSelectedSourceEvents(new Set(sourceEventTypes.map(t => t.id)))}>
                                                            All
                                                        </button>
                                                        <button style={{ ...btnSecondary, fontSize: '0.7rem', padding: '2px 8px' }}
                                                            onClick={() => setSelectedSourceEvents(new Set())}>
                                                            None
                                                        </button>
                                                    </div>
                                                </div>
                                                <div style={{
                                                    display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: '2px',
                                                    padding: '8px', background: theme.colors.secondaryBg, borderRadius: '8px',
                                                    border: `1px solid ${theme.colors.border}`, maxHeight: '220px', overflowY: 'auto',
                                                }}>
                                                    {sourceEventTypes.map(t => (
                                                        <label key={t.id} style={{
                                                            display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer',
                                                            fontSize: '0.8rem', color: theme.colors.primaryText, padding: '5px 8px',
                                                            borderRadius: '6px', transition: 'background 0.15s',
                                                            background: selectedSourceEvents.has(t.id) ? `${accent}12` : 'transparent',
                                                            border: selectedSourceEvents.has(t.id) ? `1px solid ${accent}40` : '1px solid transparent',
                                                        }}>
                                                            <input type="checkbox" checked={selectedSourceEvents.has(t.id)}
                                                                onChange={() => toggleSourceEvent(t.id)}
                                                                style={{ accentColor: accent }} />
                                                            <span style={{ flex: 1 }}>{t.name}</span>
                                                            <span style={{ fontFamily: 'monospace', fontSize: '0.68rem', color: theme.colors.mutedText }}>#{t.id}</span>
                                                        </label>
                                                    ))}
                                                </div>
                                            </>
                                        )}
                                    </div>
                                )}

                                {/* Subscribe button */}
                                {sourceEventTypes !== null && sourceEventTypes.length > 0 && (
                                    <button style={{ ...btnStyle, width: '100%', padding: '10px' }} onClick={addSubscription}
                                        disabled={addingSub || selectedSourceEvents.size === 0}>
                                        {addingSub ? 'Subscribing...' : `Subscribe to ${selectedSourceEvents.size} event${selectedSourceEvents.size !== 1 ? 's' : ''}`}
                                    </button>
                                )}
                            </div>
                        )}
                    </div>

                    {/* Reaction Rules */}
                    <div style={cardStyle}>
                        <div style={{ ...sectionTitle, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <span>Reaction Rules</span>
                            {canManage && (
                                <button style={btnStyle} onClick={() => openReactionForm()}>
                                    + Add Rule
                                </button>
                            )}
                        </div>
                        {reactions.length === 0 && !showReactionForm ? (
                            <div style={{ color: theme.colors.mutedText, fontSize: '0.8rem' }}>
                                No reaction rules configured. Add one to automatically react to incoming events.
                            </div>
                        ) : (
                            <>
                                {reactions.map(r => (
                                    <div key={Number(r.id)} style={{
                                        border: `1px solid ${theme.colors.border}`, borderRadius: '8px',
                                        padding: '12px', marginBottom: '8px',
                                        background: theme.colors.secondaryBg,
                                    }}>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '8px' }}>
                                            <div>
                                                <div style={{ fontWeight: 600, fontSize: '0.84rem', color: theme.colors.primaryText, display: 'flex', alignItems: 'center', gap: '8px' }}>
                                                    {r.name || `Rule #${Number(r.id)}`}
                                                    <span style={{
                                                        fontSize: '0.68rem', fontWeight: 600, padding: '1px 7px', borderRadius: '10px',
                                                        background: r.enabled ? 'rgba(34,197,94,0.15)' : 'rgba(239,68,68,0.12)',
                                                        color: r.enabled ? (theme.colors.success || '#22c55e') : (theme.colors.error || '#ef4444'),
                                                    }}>
                                                        {r.enabled ? 'ON' : 'OFF'}
                                                    </span>
                                                </div>
                                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px', marginTop: '6px', fontSize: '0.75rem', color: theme.colors.secondaryText }}>
                                                    <span>Sub #{Number(r.subscriptionId)}</span>
                                                    <span>Event: <strong style={{ color: accent }}>{eventTypeName(Number(r.eventTypeId))}</strong></span>
                                                    <span>Action: <strong>{actionName(Number(r.reactionActionId))}</strong></span>
                                                    {r.cooldownSeconds.length > 0 && <span>Cooldown: {Number(r.cooldownSeconds[0])}s</span>}
                                                    <span>Triggered: {Number(r.triggerCount)}×</span>
                                                    {r.lastTriggeredAt.length > 0 && <span>Last: {formatTimestamp(r.lastTriggeredAt[0])}</span>}
                                                </div>
                                                {r.conditions.length > 0 && (
                                                    <div style={{ marginTop: '4px', display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                                                        {r.conditions.map((c, i) => (
                                                            <span key={i} style={{
                                                                fontSize: '0.68rem', padding: '1px 6px', borderRadius: '4px',
                                                                background: theme.colors.primaryBg, border: `1px solid ${theme.colors.border}`,
                                                                fontFamily: 'monospace',
                                                            }}>
                                                                {c.dataKey} {opLabel(c.operator)} "{c.value}"
                                                            </span>
                                                        ))}
                                                    </div>
                                                )}
                                                {r.actionParams.length > 0 && (
                                                    <div style={{ marginTop: '4px', display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                                                        {r.actionParams.map(([k, v], i) => (
                                                            <span key={i} style={{
                                                                fontSize: '0.68rem', padding: '1px 5px', borderRadius: '3px',
                                                                background: `${accent}10`, border: `1px solid ${accent}30`,
                                                                fontFamily: 'monospace', color: theme.colors.primaryText,
                                                            }}>
                                                                {k}={v}
                                                            </span>
                                                        ))}
                                                    </div>
                                                )}
                                            </div>
                                            {canManage && (
                                                <div style={{ display: 'flex', gap: '6px', flexShrink: 0 }}>
                                                    <button style={btnSecondary} onClick={() => openReactionForm(r)}>Edit</button>
                                                    <button style={btnDanger} onClick={() => removeReaction(Number(r.id))}
                                                        disabled={removingReaction === Number(r.id)}>
                                                        {removingReaction === Number(r.id) ? '...' : 'Remove'}
                                                    </button>
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                ))}
                            </>
                        )}

                        {/* Reaction form (add/edit) */}
                        {showReactionForm && (
                            <div style={{
                                border: `2px solid ${accent}`, borderRadius: '10px',
                                padding: '16px', marginTop: '12px',
                                background: theme.colors.primaryBg,
                            }}>
                                <div style={{ fontWeight: 600, fontSize: '0.88rem', color: theme.colors.primaryText, marginBottom: '12px' }}>
                                    {editingReactionId !== null ? 'Edit Reaction Rule' : 'New Reaction Rule'}
                                </div>
                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginBottom: '10px' }}>
                                    <div>
                                        <label style={labelStyle}>Name</label>
                                        <input style={inputStyle} value={reactionForm.name}
                                            onChange={e => setReactionForm(f => ({ ...f, name: e.target.value }))}
                                            placeholder="e.g. Dissolve on CB trigger" />
                                    </div>
                                    <div>
                                        <label style={labelStyle}>Subscription</label>
                                        <select style={inputStyle} value={reactionForm.subscriptionId}
                                            onChange={e => {
                                                const subId = e.target.value;
                                                setReactionForm(f => ({ ...f, subscriptionId: subId, eventTypeId: '' }));
                                                if (subId) {
                                                    const sub = subscriptions.find(s => Number(s.id) === Number(subId));
                                                    if (sub) fetchEventTypesForSource(sub.sourceBotCanisterId);
                                                } else {
                                                    setReactionEventTypes([]);
                                                }
                                            }}>
                                            <option value="">Select subscription...</option>
                                            {subscriptions.map(s => (
                                                <option key={Number(s.id)} value={Number(s.id)}>
                                                    #{Number(s.id)} — {shortPrincipal(s.sourceBotCanisterId)}
                                                </option>
                                            ))}
                                        </select>
                                    </div>
                                    <div>
                                        <label style={labelStyle}>Event Type</label>
                                        {(() => {
                                            const selectedSub = reactionForm.subscriptionId
                                                ? subscriptions.find(s => Number(s.id) === Number(reactionForm.subscriptionId))
                                                : null;
                                            const subEventIds = selectedSub
                                                ? selectedSub.eventTypeIds.map(id => Number(id))
                                                : [];
                                            const filteredTypes = reactionEventTypes.filter(t => subEventIds.includes(t.id));
                                            return (
                                                <select style={inputStyle} value={reactionForm.eventTypeId}
                                                    onChange={e => setReactionForm(f => ({ ...f, eventTypeId: e.target.value }))}
                                                    disabled={!reactionForm.subscriptionId}>
                                                    <option value="">{reactionForm.subscriptionId ? 'Select event type...' : 'Select a subscription first'}</option>
                                                    {filteredTypes.map(t => (
                                                        <option key={t.id} value={t.id}>{t.name}</option>
                                                    ))}
                                                </select>
                                            );
                                        })()}
                                    </div>
                                    <div>
                                        <label style={labelStyle}>Reaction Action</label>
                                        <select style={inputStyle} value={reactionForm.reactionActionId}
                                            onChange={e => {
                                                const actionId = e.target.value;
                                                const hints = actionId !== '' ? (ACTION_PARAM_HINTS[Number(actionId)] || []) : [];
                                                setReactionForm(f => ({
                                                    ...f,
                                                    reactionActionId: actionId,
                                                    actionParams: hints.map(h => ({ key: h.key, value: '' })),
                                                }));
                                            }}>
                                            <option value="">Select action...</option>
                                            {availableActions.map(a => (
                                                <option key={a.id} value={a.id}>{a.name} (#{a.id})</option>
                                            ))}
                                        </select>
                                    </div>
                                    <div>
                                        <label style={labelStyle}>Cooldown (seconds, optional)</label>
                                        <input style={inputStyle} type="number" min="0" value={reactionForm.cooldownSeconds}
                                            onChange={e => setReactionForm(f => ({ ...f, cooldownSeconds: e.target.value }))}
                                            placeholder="e.g. 300" />
                                    </div>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', paddingTop: '18px' }}>
                                        <input type="checkbox" id="reaction-enabled" checked={reactionForm.enabled}
                                            onChange={e => setReactionForm(f => ({ ...f, enabled: e.target.checked }))} />
                                        <label htmlFor="reaction-enabled" style={{ fontSize: '0.82rem', color: theme.colors.primaryText, cursor: 'pointer' }}>Enabled</label>
                                    </div>
                                </div>

                                {/* Action Params */}
                                <div style={{ marginBottom: '10px' }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                                        <label style={{ ...labelStyle, marginBottom: 0 }}>Action Parameters</label>
                                        <button style={{ ...btnSecondary, fontSize: '0.72rem', padding: '2px 8px' }}
                                            onClick={() => setReactionForm(f => ({ ...f, actionParams: [...f.actionParams, { key: '', value: '' }] }))}>
                                            + Add
                                        </button>
                                    </div>
                                    {reactionForm.reactionActionId !== '' && reactionForm.actionParams.length === 0 && (ACTION_PARAM_HINTS[Number(reactionForm.reactionActionId)] || []).length === 0 && (
                                        <div style={{ fontSize: '0.75rem', color: theme.colors.mutedText, fontStyle: 'italic', padding: '6px 0' }}>
                                            No parameters needed for this action.
                                        </div>
                                    )}
                                    {reactionForm.actionParams.map((p, i) => {
                                        const hints = ACTION_PARAM_HINTS[Number(reactionForm.reactionActionId)] || [];
                                        const hint = hints.find(h => h.key === p.key);
                                        const isKnownParam = !!hint;
                                        const updateParamValue = (val) => {
                                            const params = [...reactionForm.actionParams];
                                            params[i] = { ...params[i], value: val };
                                            setReactionForm(f => ({ ...f, actionParams: params }));
                                        };

                                        let valueInput;
                                        if (p.key === 'choreId' && choreStatuses && choreStatuses.length > 0) {
                                            valueInput = (
                                                <select style={{ ...inputStyle, fontSize: '0.78rem' }} value={p.value}
                                                    onChange={e => updateParamValue(e.target.value)}>
                                                    <option value="">Select chore...</option>
                                                    {choreStatuses.map(cs => {
                                                        const cId = cs.choreId || cs.id || '';
                                                        const cName = cs.instanceLabel || cs.choreName || cs.name || cId;
                                                        return (
                                                            <option key={String(cId)} value={String(cId)}>
                                                                {cName} ({cId})
                                                            </option>
                                                        );
                                                    })}
                                                </select>
                                            );
                                        } else if (p.key === 'token') {
                                            valueInput = (
                                                <TokenSelector
                                                    value={p.value}
                                                    onChange={(canId) => updateParamValue(canId)}
                                                    tokenSubset={tokenRegistryEntries || undefined}
                                                />
                                            );
                                        } else if (p.key === 'amount') {
                                            const tokenParam = reactionForm.actionParams.find(pp => pp.key === 'token');
                                            const tokenSymbol = getTokenSymbol(tokenParam?.value);
                                            valueInput = (
                                                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flex: 1 }}>
                                                    <input style={{ ...inputStyle, fontSize: '0.78rem' }} type="number" step="any" min="0"
                                                        value={p.value}
                                                        placeholder="0.00"
                                                        onChange={e => updateParamValue(e.target.value)} />
                                                    {tokenSymbol && (
                                                        <span style={{ fontSize: '0.72rem', color: theme.colors.secondaryText, fontWeight: 600, whiteSpace: 'nowrap' }}>
                                                            {tokenSymbol}
                                                        </span>
                                                    )}
                                                </div>
                                            );
                                        } else if (p.key === 'to') {
                                            valueInput = (
                                                <PrincipalInput
                                                    value={p.value}
                                                    onChange={val => updateParamValue(val)}
                                                    placeholder="Destination account (principal or ICRC-1)"
                                                    isAuthenticated={!!identity}
                                                    showSubaccountOption={true}
                                                />
                                            );
                                        } else {
                                            valueInput = (
                                                <input style={{ ...inputStyle, fontSize: '0.78rem' }} value={p.value}
                                                    placeholder={hint ? hint.hint : 'Value'}
                                                    onChange={e => updateParamValue(e.target.value)} />
                                            );
                                        }

                                        return (
                                            <div key={i} style={{ marginBottom: '4px' }}>
                                                <div style={{ display: 'grid', gridTemplateColumns: isKnownParam ? 'auto 1fr auto' : '1fr 1fr auto', gap: '6px', alignItems: 'center' }}>
                                                    {isKnownParam ? (
                                                        <span style={{
                                                            fontSize: '0.75rem', fontWeight: 600, color: theme.colors.secondaryText,
                                                            fontFamily: 'monospace', padding: '0 4px', whiteSpace: 'nowrap',
                                                        }}>
                                                            {p.key}
                                                        </span>
                                                    ) : (
                                                        <input style={{ ...inputStyle, fontSize: '0.78rem' }} value={p.key} placeholder="Key"
                                                            onChange={e => {
                                                                const params = [...reactionForm.actionParams];
                                                                params[i] = { ...params[i], key: e.target.value };
                                                                setReactionForm(f => ({ ...f, actionParams: params }));
                                                            }} />
                                                    )}
                                                    {valueInput}
                                                    <button style={{ ...btnDanger, fontSize: '0.72rem', padding: '2px 8px' }}
                                                        onClick={() => setReactionForm(f => ({ ...f, actionParams: f.actionParams.filter((_, j) => j !== i) }))}>
                                                        ×
                                                    </button>
                                                </div>
                                                {hint && (
                                                    <div style={{ fontSize: '0.68rem', color: theme.colors.mutedText, marginTop: '1px', marginLeft: '2px' }}>
                                                        {hint.required ? 'Required' : 'Optional'} — {hint.hint}
                                                    </div>
                                                )}
                                            </div>
                                        );
                                    })}
                                </div>

                                {/* Event data key hints */}
                                {reactionForm.eventTypeId !== '' && (() => {
                                    const keys = EVENT_DATA_KEYS[Number(reactionForm.eventTypeId)];
                                    if (!keys) return null;
                                    if (keys.length === 0) return (
                                        <div style={{
                                            fontSize: '0.72rem', color: theme.colors.mutedText, fontStyle: 'italic',
                                            padding: '6px 10px', marginBottom: '10px',
                                            background: theme.colors.secondaryBg, borderRadius: '6px',
                                            border: `1px solid ${theme.colors.border}`,
                                        }}>
                                            This event type emits no data keys.
                                        </div>
                                    );
                                    return (
                                        <div style={{
                                            padding: '8px 10px', marginBottom: '10px',
                                            background: theme.colors.secondaryBg, borderRadius: '6px',
                                            border: `1px solid ${theme.colors.border}`,
                                        }}>
                                            <div style={{ fontSize: '0.7rem', color: theme.colors.secondaryText, marginBottom: '5px', fontWeight: 600 }}>
                                                Available data keys for conditions:
                                            </div>
                                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                                                {keys.map(k => (
                                                    <span key={k.key} title={k.hint} style={{
                                                        fontSize: '0.72rem', padding: '2px 8px', borderRadius: '4px',
                                                        background: `${accent}12`, border: `1px solid ${accent}30`,
                                                        fontFamily: 'monospace', color: theme.colors.primaryText,
                                                        cursor: 'default',
                                                    }}>
                                                        {k.key}
                                                    </span>
                                                ))}
                                            </div>
                                        </div>
                                    );
                                })()}

                                {/* Conditions */}
                                <div style={{ marginBottom: '14px' }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                                        <label style={{ ...labelStyle, marginBottom: 0 }}>Conditions (all must match)</label>
                                        <button style={{ ...btnSecondary, fontSize: '0.72rem', padding: '2px 8px', ...(reactionForm.eventTypeId === '' ? { opacity: 0.5, cursor: 'not-allowed' } : {}) }}
                                            disabled={reactionForm.eventTypeId === ''}
                                            title={reactionForm.eventTypeId === '' ? 'Select an event type first' : ''}
                                            onClick={() => setReactionForm(f => ({ ...f, conditions: [...f.conditions, { dataKey: '', operator: '0', value: '' }] }))}>
                                            + Add
                                        </button>
                                    </div>
                                    {reactionForm.conditions.map((c, i) => {
                                        const evtKeys = reactionForm.eventTypeId !== '' ? (EVENT_DATA_KEYS[Number(reactionForm.eventTypeId)] || []) : [];
                                        const useSelect = evtKeys.length > 0;
                                        return (
                                        <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr auto', gap: '6px', marginBottom: '4px' }}>
                                            {useSelect ? (
                                                <select style={{ ...inputStyle, fontSize: '0.78rem' }} value={c.dataKey}
                                                    onChange={e => {
                                                        const conds = [...reactionForm.conditions];
                                                        conds[i] = { ...conds[i], dataKey: e.target.value };
                                                        setReactionForm(f => ({ ...f, conditions: conds }));
                                                    }}>
                                                    <option value="">Select key...</option>
                                                    {evtKeys.map(k => (
                                                        <option key={k.key} value={k.key}>{k.key}</option>
                                                    ))}
                                                </select>
                                            ) : (
                                                <input style={{ ...inputStyle, fontSize: '0.78rem' }} value={c.dataKey} placeholder="Data key"
                                                    onChange={e => {
                                                        const conds = [...reactionForm.conditions];
                                                        conds[i] = { ...conds[i], dataKey: e.target.value };
                                                        setReactionForm(f => ({ ...f, conditions: conds }));
                                                    }} />
                                            )}
                                            <select style={{ ...inputStyle, fontSize: '0.78rem', width: 'auto' }} value={c.operator}
                                                onChange={e => {
                                                    const conds = [...reactionForm.conditions];
                                                    conds[i] = { ...conds[i], operator: e.target.value };
                                                    setReactionForm(f => ({ ...f, conditions: conds }));
                                                }}>
                                                {CONDITION_OPS.map(op => (
                                                    <option key={op.id} value={op.id}>{op.label}</option>
                                                ))}
                                            </select>
                                            {c.dataKey === 'choreId' && choreStatuses && choreStatuses.length > 0 ? (
                                                <select style={{ ...inputStyle, fontSize: '0.78rem' }} value={c.value}
                                                    onChange={e => {
                                                        const conds = [...reactionForm.conditions];
                                                        conds[i] = { ...conds[i], value: e.target.value };
                                                        setReactionForm(f => ({ ...f, conditions: conds }));
                                                    }}>
                                                    <option value="">Select chore...</option>
                                                    {choreStatuses.map(cs => {
                                                        const cId = cs.choreId || cs.id || '';
                                                        const cName = cs.instanceLabel || cs.choreName || cs.name || cId;
                                                        return <option key={cId} value={cId}>{cName} ({cId})</option>;
                                                    })}
                                                </select>
                                            ) : (
                                                <input style={{ ...inputStyle, fontSize: '0.78rem' }} value={c.value} placeholder="Value"
                                                    onChange={e => {
                                                        const conds = [...reactionForm.conditions];
                                                        conds[i] = { ...conds[i], value: e.target.value };
                                                        setReactionForm(f => ({ ...f, conditions: conds }));
                                                    }} />
                                            )}
                                            <button style={{ ...btnDanger, fontSize: '0.72rem', padding: '2px 8px' }}
                                                onClick={() => setReactionForm(f => ({ ...f, conditions: f.conditions.filter((_, j) => j !== i) }))}>
                                                ×
                                            </button>
                                        </div>
                                        );
                                    })}
                                </div>

                                <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
                                    <button style={btnSecondary} onClick={() => setShowReactionForm(false)}>Cancel</button>
                                    <button style={btnStyle} onClick={saveReaction} disabled={savingReaction || !reactionForm.name || !reactionForm.subscriptionId || !reactionForm.eventTypeId || !reactionForm.reactionActionId}>
                                        {savingReaction ? 'Saving...' : (editingReactionId !== null ? 'Update' : 'Add Rule')}
                                    </button>
                                </div>
                            </div>
                        )}
                    </div>

                    {/* Available Actions */}
                    <div style={cardStyle}>
                        <div style={sectionTitle}>Available Reaction Actions</div>
                        {availableActions.length === 0 ? (
                            <div style={{ color: theme.colors.mutedText, fontSize: '0.8rem' }}>No actions available.</div>
                        ) : (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                {availableActions.map(a => {
                                    const hints = ACTION_PARAM_HINTS[a.id] || [];
                                    return (
                                        <div key={a.id} style={{
                                            display: 'flex', alignItems: 'baseline', gap: '8px', flexWrap: 'wrap',
                                            fontSize: '0.75rem', padding: '4px 10px', borderRadius: '6px',
                                            background: theme.colors.secondaryBg, border: `1px solid ${theme.colors.border}`,
                                            color: theme.colors.primaryText,
                                        }}>
                                            <span><strong style={{ fontFamily: 'monospace' }}>#{a.id}</strong> {a.name}</span>
                                            {hints.length > 0 ? (
                                                <span style={{ fontSize: '0.68rem', color: theme.colors.mutedText }}>
                                                    params: {hints.map(h => h.key + (h.required ? '*' : '')).join(', ')}
                                                </span>
                                            ) : (
                                                <span style={{ fontSize: '0.68rem', color: theme.colors.mutedText, fontStyle: 'italic' }}>no params</span>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </div>

                    {/* Reaction Log */}
                    <div style={cardStyle}>
                        <div style={{ ...sectionTitle, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <span>Reaction Log</span>
                            {reactionLogTotal > 0 && <span style={{ fontSize: '0.72rem', color: theme.colors.mutedText, fontWeight: 400 }}>{reactionLogTotal} total</span>}
                        </div>
                        {reactionLog.length === 0 ? (
                            <div style={{ color: theme.colors.mutedText, fontSize: '0.8rem' }}>No reactions triggered yet.</div>
                        ) : (
                            <div style={{ overflowX: 'auto' }}>
                                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                                    <thead>
                                        <tr>
                                            <th style={headerCellStyle}>ID</th>
                                            <th style={{ ...headerCellStyle, textAlign: 'left' }}>Rule</th>
                                            <th style={{ ...headerCellStyle, textAlign: 'left' }}>Event</th>
                                            <th style={{ ...headerCellStyle, textAlign: 'left' }}>Action</th>
                                            <th style={headerCellStyle}>Source</th>
                                            <th style={headerCellStyle}>Time</th>
                                            <th style={headerCellStyle}>Result</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {reactionLog.map(r => (
                                            <tr key={Number(r.id)}>
                                                <td style={{ ...cellStyle, fontFamily: 'monospace', width: '40px' }}>{Number(r.id)}</td>
                                                <td style={cellStyle}>
                                                    <span style={{ fontWeight: 500 }}>{r.reactionRuleName || `Rule #${Number(r.reactionRuleId)}`}</span>
                                                </td>
                                                <td style={cellStyle}>
                                                    <span style={{
                                                        fontSize: '0.72rem', padding: '1px 6px', borderRadius: '4px',
                                                        background: `${accent}18`, color: accent, fontWeight: 500,
                                                    }}>
                                                        #{Number(r.eventTypeId)}
                                                    </span>
                                                    <span style={{ fontSize: '0.7rem', color: theme.colors.mutedText, marginLeft: '4px' }}>evt #{Number(r.eventId)}</span>
                                                </td>
                                                <td style={cellStyle}>
                                                    <span style={{ fontFamily: 'monospace', fontSize: '0.72rem' }}>{actionName(Number(r.reactionActionId))}</span>
                                                </td>
                                                <td style={{ ...cellStyle, maxWidth: '120px' }}>{principalDisplay(r.sourceCanisterId)}</td>
                                                <td style={{ ...cellStyle, whiteSpace: 'nowrap' }}>{formatTimestamp(r.timestamp)}</td>
                                                <td style={{ ...cellStyle, textAlign: 'center' }}>
                                                    {r.success ? (
                                                        <span style={{ color: theme.colors.success || '#22c55e', fontWeight: 600, fontSize: '0.75rem' }}>OK</span>
                                                    ) : (
                                                        <span title={r.error.length > 0 ? r.error[0] : ''} style={{ color: theme.colors.error || '#ef4444', fontWeight: 600, fontSize: '0.75rem', cursor: r.error.length > 0 ? 'help' : 'default' }}>
                                                            FAIL
                                                        </span>
                                                    )}
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                                {reactionLogHasMore && (
                                    <div style={{ textAlign: 'center', padding: '8px', color: theme.colors.mutedText, fontSize: '0.75rem' }}>
                                        Showing latest {reactionLog.length} of {reactionLogTotal}
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}
