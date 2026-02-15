/**
 * TradingBot — Management page for a Sneed Trading Bot canister.
 *
 * Route: /trading_bot/:canisterId
 *
 * Uses the reusable BotManagementPanel for Info, Botkeys, Chores framework, and Log tabs.
 * The per-chore configuration panels are custom to the trading bot.
 */
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useParams } from 'react-router-dom';
import { Principal } from '@dfinity/principal';
import Header from '../components/Header';
import BotManagementPanel from '../components/BotManagementPanel';
import TokenSelector from '../components/TokenSelector';
import { useTheme } from '../contexts/ThemeContext';
import { useAuth } from '../AuthContext';
// Trading bot Candid declarations — aligned with staking bot API for shared BotManagementPanel.
import { createActor as createBotActor } from 'external/sneed_trading_bot';
import { createActor as createLedgerActor } from 'external/icrc1_ledger';
import { FaChartLine, FaPlus, FaTrash, FaEdit, FaSave, FaTimes } from 'react-icons/fa';

// Trading bot accent colors — green/teal for trading
const ACCENT = '#10b981';
const ACCENT_SECONDARY = '#34d399';

// Trading Bot app ID (registered in the Sneedapp factory)
const APP_ID = 'sneed-trading-bot';

// Permission labels for the trading bot
const PERMISSION_LABELS = {
    'FullPermissions': 'Full Permissions',
    'ManagePermissions': 'Manage Permissions',
    'ViewChores': 'View Chores',
    'ViewLogs': 'Read Logs',
    'ManageLogs': 'Manage Logs',
    'ViewPortfolio': 'View Portfolio',
    'ManageSubaccounts': 'Manage Subaccounts',
    'ManageTrades': 'Manage Trades',
    'ManageRebalancer': 'Manage Rebalancer',
    'ManageTradeChore': 'Manage Trade Chore',
    'ManageRebalanceChore': 'Manage Rebalance Chore',
    'ManageMoveFundsChore': 'Manage Move Funds Chore',
    'ManageTokenRegistry': 'Manage Token Registry',
    'ManageDexSettings': 'Manage DEX Settings',
    'WithdrawFunds': 'Withdraw Funds',
    'ConfigureDistribution': 'Configure Distribution',
    'ManageDistributeFunds': 'Manage Distribute Funds',
};

const PERMISSION_DESCRIPTIONS = {
    'FullPermissions': 'Grants all permissions, including any added in future versions',
    'ManagePermissions': 'Add/remove botkey principals and manage their permissions',
    'ViewChores': 'View bot chore statuses, configurations, and settings',
    'ViewLogs': 'Read bot log entries and view log configuration',
    'ManageLogs': 'Set log level, max entries, and clear logs',
    'ViewPortfolio': 'View balances, subaccounts, and portfolio state',
    'ManageSubaccounts': 'Create, rename, and delete named subaccounts',
    'ManageTrades': 'Configure trade chore actions (add/edit/remove trades)',
    'ManageRebalancer': 'Configure rebalancer targets and parameters',
    'ManageTradeChore': 'Start/stop/pause/resume/trigger trade chores',
    'ManageRebalanceChore': 'Start/stop/pause/resume/trigger rebalance chore',
    'ManageMoveFundsChore': 'Start/stop/pause/resume/trigger move funds chores',
    'ManageTokenRegistry': 'Add/remove supported tokens from the registry',
    'ManageDexSettings': 'Configure DEX parameters (slippage, enabled DEXes)',
    'WithdrawFunds': 'Send tokens from the bot to external accounts',
    'ConfigureDistribution': 'Add, edit, and remove distribution lists',
    'ManageDistributeFunds': 'Start/stop/pause/resume/trigger distribute-funds chore',
};

// Chore types that support multiple instances
const MULTI_INSTANCE_CHORE_TYPES = ['trade', 'move-funds', 'distribute-funds', 'rebalance'];

// ============================================
// ACTION TYPE CONSTANTS
// ============================================
const ACTION_TYPE_TRADE = 0;
const ACTION_TYPE_DEPOSIT = 1;
const ACTION_TYPE_WITHDRAW = 2;
const ACTION_TYPE_SEND = 3;

const ACTION_TYPE_LABELS = {
    [ACTION_TYPE_TRADE]: 'Trade (Swap)',
    [ACTION_TYPE_DEPOSIT]: 'Deposit',
    [ACTION_TYPE_WITHDRAW]: 'Withdraw',
    [ACTION_TYPE_SEND]: 'Send',
};

// ============================================
// HELPER: Shorten principal for display
// ============================================
const shortPrincipal = (p) => {
    const s = typeof p === 'string' ? p : p?.toText?.() || String(p);
    return s.length > 20 ? s.slice(0, 8) + '...' + s.slice(-6) : s;
};

// ============================================
// TOKEN METADATA CACHE — shared across panels
// ============================================
// Global in-memory cache: canisterId -> { symbol, name, decimals, fee }
const _tokenMetaCache = new Map();

/** Resolve a canister principal to token metadata. Uses cache, falls back to ICRC-1 metadata call. */
async function resolveTokenMeta(canisterId, identity) {
    const key = typeof canisterId === 'string' ? canisterId : canisterId?.toText?.() || String(canisterId);
    if (_tokenMetaCache.has(key)) return _tokenMetaCache.get(key);
    try {
        const actor = createLedgerActor(key, { agentOptions: { identity } });
        const metadata = await actor.icrc1_metadata();
        const info = { symbol: 'TOKEN', name: 'Unknown', decimals: 8, fee: 0n };
        for (const [k, v] of metadata) {
            if (k === 'icrc1:symbol' && 'Text' in v) info.symbol = v.Text;
            else if (k === 'icrc1:name' && 'Text' in v) info.name = v.Text;
            else if (k === 'icrc1:decimals' && 'Nat' in v) info.decimals = Number(v.Nat);
            else if (k === 'icrc1:fee' && 'Nat' in v) info.fee = v.Nat;
        }
        _tokenMetaCache.set(key, info);
        return info;
    } catch {
        const fallback = { symbol: key.slice(0, 5) + '...', name: key, decimals: 8, fee: 0n };
        _tokenMetaCache.set(key, fallback);
        return fallback;
    }
}

/** Store metadata from TokenSelector's onSelectToken callback into the cache. */
function cacheTokenMeta(tokenData) {
    if (!tokenData?.ledger_id) return;
    _tokenMetaCache.set(tokenData.ledger_id, {
        symbol: tokenData.symbol || 'TOKEN',
        name: tokenData.name || 'Unknown',
        decimals: tokenData.decimals ?? 8,
        fee: tokenData.fee ?? 0n,
    });
}

/**
 * Hook that resolves an array of canister IDs to metadata, returning a map.
 * Updates as each token resolves.
 */
function useTokenMetadata(canisterIds, identity) {
    const [meta, setMeta] = useState(() => {
        const m = {};
        for (const id of canisterIds) {
            const key = typeof id === 'string' ? id : id?.toText?.() || String(id);
            if (_tokenMetaCache.has(key)) m[key] = _tokenMetaCache.get(key);
        }
        return m;
    });
    const prevIdsRef = useRef('');

    useEffect(() => {
        const ids = canisterIds.map(id => typeof id === 'string' ? id : id?.toText?.() || String(id));
        const key = ids.sort().join(',');
        if (key === prevIdsRef.current) return;
        prevIdsRef.current = key;

        let mounted = true;
        const missing = ids.filter(id => !_tokenMetaCache.has(id));
        if (missing.length === 0) {
            // All cached
            const m = {};
            for (const id of ids) m[id] = _tokenMetaCache.get(id);
            setMeta(m);
            return;
        }
        // Resolve missing in parallel
        (async () => {
            await Promise.all(missing.map(id => resolveTokenMeta(id, identity)));
            if (!mounted) return;
            const m = {};
            for (const id of ids) m[id] = _tokenMetaCache.get(id) || { symbol: shortPrincipal(id), name: id, decimals: 8, fee: 0n };
            setMeta(m);
        })();
        return () => { mounted = false; };
    }, [canisterIds, identity]);

    return meta;
}

/** Format a raw amount (bigint/number) into human-readable token units. */
const formatTokenAmount = (raw, decimals) => {
    const n = Number(raw);
    if (n === 0) return '0';
    return (n / Math.pow(10, decimals)).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: decimals });
};

/** Parse a human-readable token amount to raw units (string). */
const parseTokenAmount = (humanStr, decimals) => {
    const n = parseFloat(humanStr);
    if (isNaN(n) || n < 0) return '0';
    return Math.round(n * Math.pow(10, decimals)).toString();
};

// ============================================
// REUSABLE: Action List Panel (for Trade and Move Funds chores)
// ============================================
function ActionListPanel({ instanceId, getReadyBotActor, theme, accentColor, cardStyle, inputStyle, buttonStyle, secondaryButtonStyle, fetchFn, addFn, updateFn, removeFn, allowedTypes, title, description }) {
    const { identity } = useAuth();
    const [actions, setActions] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [success, setSuccess] = useState('');
    const [saving, setSaving] = useState(false);

    // Form mode: null = list view, 'add' = adding new, { id: N } = editing action N
    const [formMode, setFormMode] = useState(null);
    const [showConditions, setShowConditions] = useState(false);

    // Form fields (shared between add and edit modes)
    const [fActionType, setFActionType] = useState(allowedTypes[0]);
    const [fInputToken, setFInputToken] = useState('');
    const [fOutputToken, setFOutputToken] = useState('');
    const [fMinAmount, setFMinAmount] = useState('');
    const [fMaxAmount, setFMaxAmount] = useState('');
    const [fEnabled, setFEnabled] = useState(true);
    const [fMinBalance, setFMinBalance] = useState('');
    const [fMaxBalance, setFMaxBalance] = useState('');
    const [fMinPrice, setFMinPrice] = useState('');
    const [fMaxPrice, setFMaxPrice] = useState('');
    const [fMaxPriceImpactBps, setFMaxPriceImpactBps] = useState('');
    const [fMaxSlippageBps, setFMaxSlippageBps] = useState('');
    const [fDestOwner, setFDestOwner] = useState('');
    // Price direction toggle: 'output_per_input' means "SNEED per ICP", 'input_per_output' means "ICP per SNEED"
    const [fPriceDirection, setFPriceDirection] = useState('output_per_input');

    // Collect all unique token principals from actions for metadata resolution
    const actionTokenIds = React.useMemo(() => {
        const ids = new Set();
        for (const a of actions) {
            const inp = typeof a.inputToken === 'string' ? a.inputToken : a.inputToken?.toText?.() || String(a.inputToken);
            ids.add(inp);
            if (a.outputToken?.length > 0) {
                const out = typeof a.outputToken[0] === 'string' ? a.outputToken[0] : a.outputToken[0]?.toText?.() || String(a.outputToken[0]);
                ids.add(out);
            }
        }
        if (fInputToken) ids.add(fInputToken);
        if (fOutputToken) ids.add(fOutputToken);
        return [...ids];
    }, [actions, fInputToken, fOutputToken]);
    const tokenMeta = useTokenMetadata(actionTokenIds, identity);

    const getSymbol = (principal) => {
        const key = typeof principal === 'string' ? principal : principal?.toText?.() || String(principal);
        return tokenMeta[key]?.symbol || shortPrincipal(key);
    };
    const getDecimals = (principal) => {
        const key = typeof principal === 'string' ? principal : principal?.toText?.() || String(principal);
        return tokenMeta[key]?.decimals ?? 8;
    };

    // Price conversion helpers.
    // Backend stores spotPriceE8s = humanOutputPerInput * 10^outputDecimals
    // direction: 'output_per_input' (native) or 'input_per_output' (inverse)
    const e8sToHumanPrice = (e8sVal, outputDec, direction) => {
        if (!e8sVal || e8sVal === 0n) return '';
        const raw = typeof e8sVal === 'bigint' ? e8sVal : BigInt(e8sVal);
        const divisor = 10 ** outputDec;
        const nativePrice = Number(raw) / divisor;
        if (direction === 'input_per_output') {
            return nativePrice > 0 ? (1 / nativePrice) : 0;
        }
        return nativePrice;
    };
    const humanPriceToE8s = (humanVal, outputDec, direction) => {
        if (!humanVal || humanVal === '' || Number(humanVal) === 0) return null;
        const num = Number(humanVal);
        const multiplier = 10 ** outputDec;
        if (direction === 'input_per_output') {
            // inverse: native = 1 / human
            return BigInt(Math.round((1 / num) * multiplier));
        }
        return BigInt(Math.round(num * multiplier));
    };
    // Label helpers for price direction
    const inputSym = fInputToken ? getSymbol(fInputToken) : 'Input';
    const outputSym = fOutputToken ? getSymbol(fOutputToken) : 'Output';
    const priceLabel = fPriceDirection === 'output_per_input'
        ? `${outputSym} per ${inputSym}`
        : `${inputSym} per ${outputSym}`;
    const outputDec = fOutputToken ? getDecimals(fOutputToken) : 8;

    const loadActions = useCallback(async () => {
        try {
            const bot = await getReadyBotActor();
            if (!bot) return;
            const result = await bot[fetchFn](instanceId);
            setActions(result);
        } catch (err) {
            setError('Failed to load actions: ' + err.message);
        } finally {
            setLoading(false);
        }
    }, [getReadyBotActor, instanceId, fetchFn]);

    useEffect(() => { loadActions(); }, [loadActions]);

    // Helper: extract optional Candid value
    const optVal = (arr) => arr?.length > 0 ? arr[0] : null;

    const principalToStr = (p) => typeof p === 'string' ? p : p?.toText?.() || String(p);

    const resetForm = () => {
        setFActionType(allowedTypes[0]); setFInputToken(''); setFOutputToken('');
        setFMinAmount(''); setFMaxAmount(''); setFEnabled(true);
        setFMinBalance(''); setFMaxBalance(''); setFMinPrice(''); setFMaxPrice('');
        setFMaxPriceImpactBps(''); setFMaxSlippageBps(''); setFDestOwner('');
        setFPriceDirection('output_per_input');
        setShowConditions(false);
    };

    const openAddForm = () => {
        resetForm();
        setFormMode('add');
        setError(''); setSuccess('');
    };

    const openEditForm = (action) => {
        const inputStr = principalToStr(action.inputToken);
        const inputDec = getDecimals(inputStr);
        setFActionType(Number(action.actionType));
        setFInputToken(inputStr);
        setFOutputToken(optVal(action.outputToken) ? principalToStr(optVal(action.outputToken)) : '');
        setFMinAmount(Number(action.minAmount) ? formatTokenAmount(action.minAmount, inputDec) : '');
        setFMaxAmount(Number(action.maxAmount) ? formatTokenAmount(action.maxAmount, inputDec) : '');
        setFEnabled(action.enabled);
        setFMinBalance(optVal(action.minBalance) != null ? formatTokenAmount(optVal(action.minBalance), inputDec) : '');
        setFMaxBalance(optVal(action.maxBalance) != null ? formatTokenAmount(optVal(action.maxBalance), inputDec) : '');
        // Convert e8s prices to human-readable (default direction: output per input)
        const outDec = getDecimals(optVal(action.outputToken) ? principalToStr(optVal(action.outputToken)) : '');
        setFPriceDirection('output_per_input');
        setFMinPrice(optVal(action.minPrice) != null ? String(e8sToHumanPrice(optVal(action.minPrice), outDec, 'output_per_input')) : '');
        setFMaxPrice(optVal(action.maxPrice) != null ? String(e8sToHumanPrice(optVal(action.maxPrice), outDec, 'output_per_input')) : '');
        setFMaxPriceImpactBps(optVal(action.maxPriceImpactBps) != null ? String(Number(optVal(action.maxPriceImpactBps))) : '');
        setFMaxSlippageBps(optVal(action.maxSlippageBps) != null ? String(Number(optVal(action.maxSlippageBps))) : '');
        setFDestOwner(optVal(action.destinationOwner) ? principalToStr(optVal(action.destinationOwner)) : '');
        // Auto-expand conditions if any condition fields are set
        const hasConditions = optVal(action.minBalance) != null || optVal(action.maxBalance) != null ||
            optVal(action.minPrice) != null || optVal(action.maxPrice) != null ||
            optVal(action.maxPriceImpactBps) != null || optVal(action.maxSlippageBps) != null;
        setShowConditions(hasConditions);
        setFormMode({ id: Number(action.id) });
        setError(''); setSuccess('');
    };

    const closeForm = () => {
        setFormMode(null);
        resetForm();
    };

    /** Build an ActionConfigInput from the current form state */
    const buildConfig = () => {
        const inputDecimals = getDecimals(fInputToken);
        return {
            actionType: BigInt(fActionType),
            enabled: fEnabled,
            inputToken: Principal.fromText(fInputToken),
            outputToken: fActionType === ACTION_TYPE_TRADE && fOutputToken ? [Principal.fromText(fOutputToken)] : [],
            minAmount: fMinAmount ? BigInt(parseTokenAmount(fMinAmount, inputDecimals)) : BigInt(0),
            maxAmount: fMaxAmount ? BigInt(parseTokenAmount(fMaxAmount, inputDecimals)) : BigInt(0),
            preferredDex: [],
            sourceSubaccount: [],
            targetSubaccount: [],
            destinationOwner: fDestOwner.trim() ? [Principal.fromText(fDestOwner.trim())] : [],
            destinationSubaccount: [],
            minBalance: fMinBalance ? [BigInt(parseTokenAmount(fMinBalance, inputDecimals))] : [],
            maxBalance: fMaxBalance ? [BigInt(parseTokenAmount(fMaxBalance, inputDecimals))] : [],
            balanceDenominationToken: [],
            minPrice: (() => { const v = humanPriceToE8s(fMinPrice, outputDec, fPriceDirection); return v != null ? [v] : []; })(),
            maxPrice: (() => { const v = humanPriceToE8s(fMaxPrice, outputDec, fPriceDirection); return v != null ? [v] : []; })(),
            priceDenominationToken: [],
            maxPriceImpactBps: fMaxPriceImpactBps ? [BigInt(fMaxPriceImpactBps)] : [],
            maxSlippageBps: fMaxSlippageBps ? [BigInt(fMaxSlippageBps)] : [],
            minFrequencySeconds: [],
            maxFrequencySeconds: [],
            tradeSizeDenominationToken: [],
        };
    };

    const handleSave = async () => {
        if (!fInputToken) { setError('Input token is required.'); return; }
        if (fActionType === ACTION_TYPE_TRADE && !fOutputToken) { setError('Output token is required for trades.'); return; }
        setSaving(true); setError(''); setSuccess('');
        try {
            const bot = await getReadyBotActor();
            const config = buildConfig();
            if (formMode === 'add') {
                await bot[addFn](instanceId, config);
                setSuccess('Action added.');
            } else {
                await bot[updateFn](instanceId, BigInt(formMode.id), config);
                setSuccess('Action updated.');
            }
            closeForm();
            await loadActions();
        } catch (err) { setError(`Failed to ${formMode === 'add' ? 'add' : 'update'} action: ` + err.message); }
        finally { setSaving(false); }
    };

    const handleRemove = async (actionId) => {
        setSaving(true); setError(''); setSuccess('');
        try {
            const bot = await getReadyBotActor();
            await bot[removeFn](instanceId, BigInt(actionId));
            setSuccess('Action removed.');
            if (formMode && formMode.id === actionId) closeForm();
            await loadActions();
        } catch (err) { setError('Failed to remove: ' + err.message); }
        finally { setSaving(false); }
    };

    const handleToggle = async (action) => {
        setSaving(true); setError(''); setSuccess('');
        try {
            const bot = await getReadyBotActor();
            const updated = {
                actionType: action.actionType,
                enabled: !action.enabled,
                inputToken: action.inputToken,
                outputToken: action.outputToken?.length > 0 ? action.outputToken : [],
                minAmount: action.minAmount,
                maxAmount: action.maxAmount,
                preferredDex: action.preferredDex?.length > 0 ? action.preferredDex : [],
                sourceSubaccount: action.sourceSubaccount?.length > 0 ? action.sourceSubaccount : [],
                targetSubaccount: action.targetSubaccount?.length > 0 ? action.targetSubaccount : [],
                destinationOwner: action.destinationOwner?.length > 0 ? action.destinationOwner : [],
                destinationSubaccount: action.destinationSubaccount?.length > 0 ? action.destinationSubaccount : [],
                minBalance: action.minBalance?.length > 0 ? action.minBalance : [],
                maxBalance: action.maxBalance?.length > 0 ? action.maxBalance : [],
                balanceDenominationToken: action.balanceDenominationToken?.length > 0 ? action.balanceDenominationToken : [],
                minPrice: action.minPrice?.length > 0 ? action.minPrice : [],
                maxPrice: action.maxPrice?.length > 0 ? action.maxPrice : [],
                priceDenominationToken: action.priceDenominationToken?.length > 0 ? action.priceDenominationToken : [],
                maxPriceImpactBps: action.maxPriceImpactBps?.length > 0 ? action.maxPriceImpactBps : [],
                maxSlippageBps: action.maxSlippageBps?.length > 0 ? action.maxSlippageBps : [],
                minFrequencySeconds: action.minFrequencySeconds?.length > 0 ? action.minFrequencySeconds : [],
                maxFrequencySeconds: action.maxFrequencySeconds?.length > 0 ? action.maxFrequencySeconds : [],
                tradeSizeDenominationToken: action.tradeSizeDenominationToken?.length > 0 ? action.tradeSizeDenominationToken : [],
            };
            await bot[updateFn](instanceId, action.id, updated);
            setSuccess(`Action ${action.enabled ? 'disabled' : 'enabled'}.`);
            await loadActions();
        } catch (err) { setError('Failed to toggle: ' + err.message); }
        finally { setSaving(false); }
    };

    const labelStyle = { fontSize: '0.75rem', color: theme.colors.secondaryText, display: 'block', marginBottom: '4px' };

    /** Shared form JSX (used for both add and edit) */
    const renderForm = () => {
        const isEditing = formMode !== 'add';
        const tokenSymLabel = fInputToken && tokenMeta[fInputToken] ? ` (${tokenMeta[fInputToken].symbol})` : '';
        return (
            <div style={{ padding: '14px', background: `${accentColor}06`, borderRadius: '8px', border: `1px solid ${accentColor}20`, marginTop: '10px' }}>
                {isEditing && (
                    <div style={{ fontSize: '0.8rem', fontWeight: '600', color: theme.colors.primaryText, marginBottom: '10px' }}>
                        Editing Action #{formMode.id}
                    </div>
                )}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '10px' }}>
                    <div>
                        <label style={labelStyle}>Type</label>
                        <select value={fActionType} onChange={(e) => setFActionType(Number(e.target.value))} style={{ ...inputStyle, width: '100%', appearance: 'auto' }}>
                            {allowedTypes.map(t => <option key={t} value={t}>{ACTION_TYPE_LABELS[t]}</option>)}
                        </select>
                    </div>
                    <div>
                        <label style={labelStyle}>Input Token</label>
                        <TokenSelector
                            value={fInputToken}
                            onChange={setFInputToken}
                            onSelectToken={cacheTokenMeta}
                            allowCustom={true}
                            placeholder="Select input token..."
                        />
                    </div>
                    {fActionType === ACTION_TYPE_TRADE && (
                        <div>
                            <label style={labelStyle}>Output Token</label>
                            <TokenSelector
                                value={fOutputToken}
                                onChange={setFOutputToken}
                                onSelectToken={cacheTokenMeta}
                                allowCustom={true}
                                placeholder="Select output token..."
                            />
                        </div>
                    )}
                    <div>
                        <label style={labelStyle}>Min Amount{tokenSymLabel}</label>
                        <input value={fMinAmount} onChange={(e) => setFMinAmount(e.target.value)} style={{ ...inputStyle, width: '100%' }} type="text" inputMode="decimal" placeholder="0.0" />
                    </div>
                    <div>
                        <label style={labelStyle}>Max Amount{tokenSymLabel}</label>
                        <input value={fMaxAmount} onChange={(e) => setFMaxAmount(e.target.value)} style={{ ...inputStyle, width: '100%' }} type="text" inputMode="decimal" placeholder="0.0" />
                    </div>
                    {(fActionType === ACTION_TYPE_SEND || fActionType === ACTION_TYPE_WITHDRAW || fActionType === ACTION_TYPE_DEPOSIT) && (
                        <div>
                            <label style={labelStyle}>Destination Owner (principal)</label>
                            <input value={fDestOwner} onChange={(e) => setFDestOwner(e.target.value)} style={{ ...inputStyle, width: '100%' }} placeholder="Principal ID" />
                        </div>
                    )}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', paddingTop: '20px' }}>
                        <input type="checkbox" checked={fEnabled} onChange={(e) => setFEnabled(e.target.checked)} id={`action-enabled-${instanceId}-${formMode === 'add' ? 'new' : formMode.id}`} />
                        <label htmlFor={`action-enabled-${instanceId}-${formMode === 'add' ? 'new' : formMode.id}`} style={{ fontSize: '0.8rem', color: theme.colors.secondaryText }}>Enabled</label>
                    </div>
                </div>

                {/* Conditions toggle */}
                <div style={{ marginTop: '12px', borderTop: `1px solid ${theme.colors.border}`, paddingTop: '10px' }}>
                    <button
                        onClick={() => setShowConditions(!showConditions)}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '0.8rem', fontWeight: '500', color: accentColor, padding: 0, display: 'flex', alignItems: 'center', gap: '4px' }}
                    >
                        {showConditions ? '▾' : '▸'} Conditions (optional)
                    </button>
                    {showConditions && (
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '10px', marginTop: '10px' }}>
                            <div>
                                <label style={labelStyle}>Min Input Balance{tokenSymLabel}</label>
                                <input value={fMinBalance} onChange={(e) => setFMinBalance(e.target.value)} style={{ ...inputStyle, width: '100%' }} type="text" inputMode="decimal" placeholder="Only run if balance ≥" />
                            </div>
                            <div>
                                <label style={labelStyle}>Max Input Balance{tokenSymLabel}</label>
                                <input value={fMaxBalance} onChange={(e) => setFMaxBalance(e.target.value)} style={{ ...inputStyle, width: '100%' }} type="text" inputMode="decimal" placeholder="Only run if balance ≤" />
                            </div>
                            {fActionType === ACTION_TYPE_TRADE && fOutputToken && (
                                <div style={{ gridColumn: '1 / -1', display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                                    <label style={{ ...labelStyle, margin: 0 }}>Price direction:</label>
                                    <button
                                        type="button"
                                        onClick={() => {
                                            const newDir = fPriceDirection === 'output_per_input' ? 'input_per_output' : 'output_per_input';
                                            // Invert and swap: old min → new max, old max → new min
                                            const oldMin = fMinPrice ? Number(fMinPrice) : null;
                                            const oldMax = fMaxPrice ? Number(fMaxPrice) : null;
                                            setFMinPrice(oldMax && oldMax > 0 ? String(1 / oldMax) : '');
                                            setFMaxPrice(oldMin && oldMin > 0 ? String(1 / oldMin) : '');
                                            setFPriceDirection(newDir);
                                        }}
                                        style={{
                                            ...secondaryButtonStyle,
                                            fontSize: '0.7rem',
                                            padding: '2px 8px',
                                            fontWeight: fPriceDirection ? '600' : '400',
                                        }}
                                    >
                                        ⇆ {priceLabel}
                                    </button>
                                </div>
                            )}
                            <div>
                                <label style={labelStyle}>Min Price ({priceLabel})</label>
                                <input value={fMinPrice} onChange={(e) => setFMinPrice(e.target.value)} style={{ ...inputStyle, width: '100%' }} type="text" inputMode="decimal" placeholder={`Skip if price below`} />
                            </div>
                            <div>
                                <label style={labelStyle}>Max Price ({priceLabel})</label>
                                <input value={fMaxPrice} onChange={(e) => setFMaxPrice(e.target.value)} style={{ ...inputStyle, width: '100%' }} type="text" inputMode="decimal" placeholder={`Skip if price above`} />
                            </div>
                            <div>
                                <label style={labelStyle}>Max Price Impact (bps)</label>
                                <input value={fMaxPriceImpactBps} onChange={(e) => setFMaxPriceImpactBps(e.target.value)} style={{ ...inputStyle, width: '100%' }} type="text" inputMode="numeric" placeholder="e.g. 100 = 1%" />
                            </div>
                            <div>
                                <label style={labelStyle}>Max Slippage (bps)</label>
                                <input value={fMaxSlippageBps} onChange={(e) => setFMaxSlippageBps(e.target.value)} style={{ ...inputStyle, width: '100%' }} type="text" inputMode="numeric" placeholder="e.g. 50 = 0.5%" />
                            </div>
                        </div>
                    )}
                </div>

                <div style={{ display: 'flex', gap: '8px', marginTop: '12px' }}>
                    <button onClick={handleSave} disabled={saving} style={{ ...buttonStyle, background: `linear-gradient(135deg, ${accentColor}, ${accentColor}cc)`, color: '#fff', border: 'none', opacity: saving ? 0.6 : 1 }}>
                        {isEditing ? <><FaSave style={{ marginRight: '4px', fontSize: '0.7rem' }} /> Save Changes</> : <><FaPlus style={{ marginRight: '4px', fontSize: '0.7rem' }} /> Add Action</>}
                    </button>
                    <button onClick={closeForm} style={{ ...secondaryButtonStyle }}>Cancel</button>
                </div>
            </div>
        );
    };

    return (
        <div style={cardStyle}>
            <h3 style={{ color: theme.colors.primaryText, margin: '0 0 12px 0', fontSize: '0.95rem', fontWeight: '600' }}>{title}</h3>
            <p style={{ margin: '0 0 12px 0', fontSize: '0.85rem', color: theme.colors.secondaryText, lineHeight: '1.5' }}>{description}</p>

            {error && <div style={{ padding: '8px 12px', background: '#ef444415', border: '1px solid #ef444430', borderRadius: '8px', color: '#ef4444', fontSize: '0.8rem', marginBottom: '10px' }}>{error}</div>}
            {success && <div style={{ padding: '8px 12px', background: '#22c55e15', border: '1px solid #22c55e30', borderRadius: '8px', color: '#22c55e', fontSize: '0.8rem', marginBottom: '10px' }}>{success}</div>}

            {loading ? (
                <div style={{ textAlign: 'center', padding: '16px', color: theme.colors.secondaryText, fontSize: '0.85rem' }}>Loading actions...</div>
            ) : (
                <>
                    {actions.length === 0 && !formMode && (
                        <div style={{ textAlign: 'center', padding: '16px', color: theme.colors.mutedText, fontSize: '0.85rem', background: theme.colors.primaryBg, borderRadius: '8px', border: `1px solid ${theme.colors.border}` }}>
                            No actions configured yet.
                        </div>
                    )}

                    {actions.map((action) => {
                        const inputSym = getSymbol(action.inputToken);
                        const inputDec = getDecimals(action.inputToken);
                        const isBeingEdited = formMode && formMode !== 'add' && formMode.id === Number(action.id);
                        return (
                            <div key={Number(action.id)}>
                                <div style={{
                                    padding: '12px', marginBottom: isBeingEdited ? '0' : '8px',
                                    background: theme.colors.primaryBg, borderRadius: isBeingEdited ? '8px 8px 0 0' : '8px',
                                    border: `1px solid ${isBeingEdited ? accentColor + '40' : action.enabled ? accentColor + '30' : theme.colors.border}`,
                                    borderBottom: isBeingEdited ? 'none' : undefined,
                                    opacity: action.enabled ? 1 : 0.6,
                                }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
                                        <div>
                                            <span style={{ fontSize: '0.8rem', fontWeight: '600', color: theme.colors.primaryText }}>
                                                #{Number(action.id)} — {ACTION_TYPE_LABELS[Number(action.actionType)] || `Type ${Number(action.actionType)}`}
                                            </span>
                                            <span style={{ marginLeft: '8px', fontSize: '0.7rem', padding: '2px 6px', borderRadius: '4px', background: action.enabled ? '#22c55e20' : '#6b728020', color: action.enabled ? '#22c55e' : '#6b7280' }}>
                                                {action.enabled ? 'Enabled' : 'Disabled'}
                                            </span>
                                        </div>
                                        <div style={{ display: 'flex', gap: '6px' }}>
                                            {!isBeingEdited && (
                                                <button onClick={() => openEditForm(action)} disabled={saving || (formMode && formMode !== 'add')}
                                                    style={{ ...secondaryButtonStyle, fontSize: '0.7rem', padding: '3px 8px' }}
                                                ><FaEdit style={{ fontSize: '0.6rem', marginRight: '3px' }} />Edit</button>
                                            )}
                                            <button onClick={() => handleToggle(action)} disabled={saving}
                                                style={{ ...secondaryButtonStyle, fontSize: '0.7rem', padding: '3px 8px' }}
                                            >{action.enabled ? 'Disable' : 'Enable'}</button>
                                            <button onClick={() => handleRemove(Number(action.id))} disabled={saving}
                                                style={{ ...secondaryButtonStyle, fontSize: '0.7rem', padding: '3px 8px', color: '#ef4444', borderColor: '#ef444440' }}
                                            ><FaTrash style={{ fontSize: '0.6rem' }} /></button>
                                        </div>
                                    </div>
                                    {!isBeingEdited && (
                                        <div style={{ marginTop: '8px', display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '6px', fontSize: '0.75rem', color: theme.colors.secondaryText }}>
                                            <div><strong>Input:</strong> {inputSym}</div>
                                            {action.outputToken?.length > 0 && <div><strong>Output:</strong> {getSymbol(action.outputToken[0])}</div>}
                                            <div><strong>Min:</strong> {formatTokenAmount(action.minAmount, inputDec)} {inputSym}</div>
                                            <div><strong>Max:</strong> {formatTokenAmount(action.maxAmount, inputDec)} {inputSym}</div>
                                            {optVal(action.destinationOwner) && <div><strong>Dest:</strong> {shortPrincipal(optVal(action.destinationOwner))}</div>}
                                            {optVal(action.minBalance) != null && <div><strong>Min Bal:</strong> {formatTokenAmount(optVal(action.minBalance), inputDec)} {inputSym}</div>}
                                            {optVal(action.maxBalance) != null && <div><strong>Max Bal:</strong> {formatTokenAmount(optVal(action.maxBalance), inputDec)} {inputSym}</div>}
                                            {optVal(action.minPrice) != null && (() => {
                                                const outKey = action.outputToken?.length > 0 ? (typeof action.outputToken[0] === 'string' ? action.outputToken[0] : action.outputToken[0]?.toText?.() || String(action.outputToken[0])) : '';
                                                const outD = getDecimals(outKey);
                                                const outS = outKey ? getSymbol(outKey) : 'Output';
                                                const hp = e8sToHumanPrice(optVal(action.minPrice), outD, 'output_per_input');
                                                return <div><strong>Min Price:</strong> {typeof hp === 'number' ? hp.toLocaleString(undefined, { maximumSignificantDigits: 6 }) : hp} {outS}/{inputSym}</div>;
                                            })()}
                                            {optVal(action.maxPrice) != null && (() => {
                                                const outKey = action.outputToken?.length > 0 ? (typeof action.outputToken[0] === 'string' ? action.outputToken[0] : action.outputToken[0]?.toText?.() || String(action.outputToken[0])) : '';
                                                const outD = getDecimals(outKey);
                                                const outS = outKey ? getSymbol(outKey) : 'Output';
                                                const hp = e8sToHumanPrice(optVal(action.maxPrice), outD, 'output_per_input');
                                                return <div><strong>Max Price:</strong> {typeof hp === 'number' ? hp.toLocaleString(undefined, { maximumSignificantDigits: 6 }) : hp} {outS}/{inputSym}</div>;
                                            })()}
                                            {optVal(action.maxPriceImpactBps) != null && <div><strong>Max Impact:</strong> {Number(optVal(action.maxPriceImpactBps))} bps</div>}
                                            {optVal(action.maxSlippageBps) != null && <div><strong>Max Slippage:</strong> {Number(optVal(action.maxSlippageBps))} bps</div>}
                                            {action.lastExecutedAt?.length > 0 && (
                                                <div><strong>Last run:</strong> {new Date(Number(action.lastExecutedAt[0]) / 1_000_000).toLocaleString()}</div>
                                            )}
                                        </div>
                                    )}
                                </div>
                                {/* Inline edit form directly below the action card */}
                                {isBeingEdited && renderForm()}
                            </div>
                        );
                    })}

                    {/* Add Action Form (at bottom) */}
                    {formMode === 'add' && renderForm()}

                    {/* Add button (only when not in any form mode) */}
                    {!formMode && (
                        <button onClick={openAddForm} style={{ ...secondaryButtonStyle, marginTop: '10px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                            <FaPlus style={{ fontSize: '0.7rem' }} /> Add Action
                        </button>
                    )}
                </>
            )}
        </div>
    );
}

// ============================================
// REBALANCER CONFIG PANEL
// ============================================
function RebalancerConfigPanel({ instanceId, getReadyBotActor, theme, accentColor, cardStyle, inputStyle, buttonStyle, secondaryButtonStyle }) {
    const { identity } = useAuth();
    const [settings, setSettings] = useState(null);
    const [targets, setTargets] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [success, setSuccess] = useState('');
    const [saving, setSaving] = useState(false);
    const [portfolioStatus, setPortfolioStatus] = useState(null);
    const [loadingPortfolio, setLoadingPortfolio] = useState(false);

    // Edit state for targets
    const [editingTargets, setEditingTargets] = useState(null); // null = not editing, array = editing

    // Resolve token metadata for all target tokens + denomination token
    const allTokenIds = React.useMemo(() => {
        const ids = new Set();
        for (const t of targets) {
            const key = typeof t.token === 'string' ? t.token : t.token?.toText?.() || String(t.token);
            ids.add(key);
        }
        if (settings?.denominationToken) {
            const key = typeof settings.denominationToken === 'string' ? settings.denominationToken : settings.denominationToken?.toText?.() || String(settings.denominationToken);
            ids.add(key);
        }
        return [...ids];
    }, [targets, settings]);
    const tokenMeta = useTokenMetadata(allTokenIds, identity);

    const getTokenLabel = (principal) => {
        const key = typeof principal === 'string' ? principal : principal?.toText?.() || String(principal);
        const m = tokenMeta[key];
        return m ? `${m.symbol} (${m.name})` : shortPrincipal(key);
    };
    const getSymbol = (principal) => {
        const key = typeof principal === 'string' ? principal : principal?.toText?.() || String(principal);
        return tokenMeta[key]?.symbol || shortPrincipal(key);
    };

    // Denomination token metadata (for decimal-aware trade size editing)
    const denomKey = settings?.denominationToken
        ? (typeof settings.denominationToken === 'string' ? settings.denominationToken : settings.denominationToken?.toText?.() || String(settings.denominationToken))
        : null;
    const denomMeta = denomKey ? tokenMeta[denomKey] : null;
    const denomDecimals = denomMeta?.decimals ?? 8;
    const denomSymbol = denomMeta?.symbol || 'tokens';

    const loadData = useCallback(async () => {
        try {
            const bot = await getReadyBotActor();
            if (!bot) return;
            const [s, t] = await Promise.all([
                bot.getRebalanceSettings(instanceId),
                bot.getRebalanceTargets(instanceId),
            ]);
            setSettings(s);
            setTargets(t);
        } catch (err) {
            setError('Failed to load rebalancer config: ' + err.message);
        } finally {
            setLoading(false);
        }
    }, [getReadyBotActor, instanceId]);

    useEffect(() => { loadData(); }, [loadData]);

    const loadPortfolio = async () => {
        setLoadingPortfolio(true); setError('');
        try {
            const bot = await getReadyBotActor();
            const status = await bot.getPortfolioStatus(instanceId);
            setPortfolioStatus(status);
        } catch (err) { setError('Failed to load portfolio: ' + err.message); }
        finally { setLoadingPortfolio(false); }
    };

    const handleSaveTargets = async () => {
        if (!editingTargets) return;
        const totalBps = editingTargets.reduce((sum, t) => sum + (parseInt(t.targetBps) || 0), 0);
        if (totalBps !== 10000) { setError(`Target allocations must total 100% (10000 bps). Current total: ${totalBps} bps (${(totalBps / 100).toFixed(1)}%).`); return; }
        // Validate all tokens are set
        for (const t of editingTargets) {
            if (!t.token) { setError('All tokens must be selected.'); return; }
        }
        setSaving(true); setError(''); setSuccess('');
        try {
            const bot = await getReadyBotActor();
            const formatted = editingTargets.map(t => ({
                token: Principal.fromText(t.token),
                targetBps: BigInt(t.targetBps),
            }));
            await bot.setRebalanceTargets(instanceId, formatted);
            setSuccess('Rebalance targets updated.');
            setEditingTargets(null);
            await loadData();
        } catch (err) { setError('Failed to save targets: ' + err.message); }
        finally { setSaving(false); }
    };

    const handleSaveSetting = async (setter, value) => {
        setSaving(true); setError(''); setSuccess('');
        try {
            const bot = await getReadyBotActor();
            await bot[setter](instanceId, value);
            setSuccess('Setting updated.');
            await loadData();
        } catch (err) { setError('Failed to update: ' + err.message); }
        finally { setSaving(false); }
    };

    return (
        <div style={cardStyle}>
            <h3 style={{ color: theme.colors.primaryText, margin: '0 0 12px 0', fontSize: '0.95rem', fontWeight: '600' }}>Rebalancer Configuration</h3>
            <p style={{ margin: '0 0 12px 0', fontSize: '0.85rem', color: theme.colors.secondaryText, lineHeight: '1.5' }}>
                Set target portfolio allocations. The rebalancer identifies over/underweight tokens
                and trades to bring the portfolio back to target.
            </p>

            {error && <div style={{ padding: '8px 12px', background: '#ef444415', border: '1px solid #ef444430', borderRadius: '8px', color: '#ef4444', fontSize: '0.8rem', marginBottom: '10px' }}>{error}</div>}
            {success && <div style={{ padding: '8px 12px', background: '#22c55e15', border: '1px solid #22c55e30', borderRadius: '8px', color: '#22c55e', fontSize: '0.8rem', marginBottom: '10px' }}>{success}</div>}

            {loading ? (
                <div style={{ textAlign: 'center', padding: '16px', color: theme.colors.secondaryText, fontSize: '0.85rem' }}>Loading rebalancer config...</div>
            ) : (
                <>
                    {/* Settings */}
                    {settings && (
                        <div style={{ marginBottom: '16px' }}>
                            <h4 style={{ color: theme.colors.primaryText, margin: '0 0 8px 0', fontSize: '0.85rem', fontWeight: '600' }}>Parameters</h4>
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '8px' }}>
                                <div style={{ padding: '10px', background: theme.colors.primaryBg, borderRadius: '8px', border: `1px solid ${theme.colors.border}` }}>
                                    <div style={{ fontSize: '0.7rem', color: theme.colors.secondaryText, marginBottom: '4px' }}>Denomination Token</div>
                                    <div style={{ fontSize: '0.8rem', color: theme.colors.primaryText, fontWeight: '500' }}>{getTokenLabel(settings.denominationToken)}</div>
                                    <div style={{ marginTop: '6px' }}>
                                        <TokenSelector
                                            value={denomKey || ''}
                                            onChange={(v) => { if (v) handleSaveSetting('setRebalanceDenominationToken', Principal.fromText(v)); }}
                                            onSelectToken={cacheTokenMeta}
                                            allowCustom={true}
                                            placeholder="Change denomination token..."
                                            style={{ fontSize: '0.75rem' }}
                                        />
                                    </div>
                                </div>
                                <div style={{ padding: '10px', background: theme.colors.primaryBg, borderRadius: '8px', border: `1px solid ${theme.colors.border}` }}>
                                    <div style={{ fontSize: '0.7rem', color: theme.colors.secondaryText, marginBottom: '4px' }}>Max Trade Size</div>
                                    <div style={{ fontSize: '0.8rem', color: theme.colors.primaryText }}>{formatTokenAmount(settings.maxTradeSize, denomDecimals)} {denomSymbol}</div>
                                    <div style={{ display: 'flex', gap: '4px', marginTop: '4px' }}>
                                        <input type="text" inputMode="decimal" id={`rebal-max-trade-${instanceId}`} defaultValue={formatTokenAmount(settings.maxTradeSize, denomDecimals)} style={{ ...inputStyle, width: '100px', fontSize: '0.7rem' }} />
                                        <button onClick={() => { const v = document.getElementById(`rebal-max-trade-${instanceId}`)?.value; if (v) handleSaveSetting('setRebalanceMaxTradeSize', BigInt(parseTokenAmount(v, denomDecimals))); }} disabled={saving} style={{ ...secondaryButtonStyle, fontSize: '0.65rem', padding: '2px 6px' }}>Set</button>
                                    </div>
                                </div>
                                <div style={{ padding: '10px', background: theme.colors.primaryBg, borderRadius: '8px', border: `1px solid ${theme.colors.border}` }}>
                                    <div style={{ fontSize: '0.7rem', color: theme.colors.secondaryText, marginBottom: '4px' }}>Min Trade Size</div>
                                    <div style={{ fontSize: '0.8rem', color: theme.colors.primaryText }}>{formatTokenAmount(settings.minTradeSize, denomDecimals)} {denomSymbol}</div>
                                    <div style={{ display: 'flex', gap: '4px', marginTop: '4px' }}>
                                        <input type="text" inputMode="decimal" id={`rebal-min-trade-${instanceId}`} defaultValue={formatTokenAmount(settings.minTradeSize, denomDecimals)} style={{ ...inputStyle, width: '100px', fontSize: '0.7rem' }} />
                                        <button onClick={() => { const v = document.getElementById(`rebal-min-trade-${instanceId}`)?.value; if (v) handleSaveSetting('setRebalanceMinTradeSize', BigInt(parseTokenAmount(v, denomDecimals))); }} disabled={saving} style={{ ...secondaryButtonStyle, fontSize: '0.65rem', padding: '2px 6px' }}>Set</button>
                                    </div>
                                </div>
                                <div style={{ padding: '10px', background: theme.colors.primaryBg, borderRadius: '8px', border: `1px solid ${theme.colors.border}` }}>
                                    <div style={{ fontSize: '0.7rem', color: theme.colors.secondaryText, marginBottom: '4px' }}>Threshold (bps)</div>
                                    <div style={{ fontSize: '0.8rem', color: theme.colors.primaryText }}>{Number(settings.thresholdBps)} bps ({(Number(settings.thresholdBps) / 100).toFixed(1)}%)</div>
                                    <div style={{ display: 'flex', gap: '4px', marginTop: '4px' }}>
                                        <input type="text" inputMode="numeric" id={`rebal-threshold-${instanceId}`} defaultValue={Number(settings.thresholdBps)} style={{ ...inputStyle, width: '60px', fontSize: '0.7rem' }} />
                                        <button onClick={() => { const v = document.getElementById(`rebal-threshold-${instanceId}`)?.value; if (v) handleSaveSetting('setRebalanceThresholdBps', BigInt(v)); }} disabled={saving} style={{ ...secondaryButtonStyle, fontSize: '0.65rem', padding: '2px 6px' }}>Set</button>
                                    </div>
                                </div>
                                <div style={{ padding: '10px', background: theme.colors.primaryBg, borderRadius: '8px', border: `1px solid ${theme.colors.border}` }}>
                                    <div style={{ fontSize: '0.7rem', color: theme.colors.secondaryText, marginBottom: '4px' }}>Max Price Impact (bps)</div>
                                    <div style={{ fontSize: '0.8rem', color: theme.colors.primaryText }}>{Number(settings.maxPriceImpactBps)} bps</div>
                                    <div style={{ display: 'flex', gap: '4px', marginTop: '4px' }}>
                                        <input type="text" inputMode="numeric" id={`rebal-impact-${instanceId}`} defaultValue={Number(settings.maxPriceImpactBps)} style={{ ...inputStyle, width: '60px', fontSize: '0.7rem' }} />
                                        <button onClick={() => { const v = document.getElementById(`rebal-impact-${instanceId}`)?.value; if (v) handleSaveSetting('setRebalanceMaxPriceImpactBps', BigInt(v)); }} disabled={saving} style={{ ...secondaryButtonStyle, fontSize: '0.65rem', padding: '2px 6px' }}>Set</button>
                                    </div>
                                </div>
                                <div style={{ padding: '10px', background: theme.colors.primaryBg, borderRadius: '8px', border: `1px solid ${theme.colors.border}` }}>
                                    <div style={{ fontSize: '0.7rem', color: theme.colors.secondaryText, marginBottom: '4px' }}>Max Slippage (bps)</div>
                                    <div style={{ fontSize: '0.8rem', color: theme.colors.primaryText }}>{Number(settings.maxSlippageBps)} bps</div>
                                    <div style={{ display: 'flex', gap: '4px', marginTop: '4px' }}>
                                        <input type="text" inputMode="numeric" id={`rebal-slippage-${instanceId}`} defaultValue={Number(settings.maxSlippageBps)} style={{ ...inputStyle, width: '60px', fontSize: '0.7rem' }} />
                                        <button onClick={() => { const v = document.getElementById(`rebal-slippage-${instanceId}`)?.value; if (v) handleSaveSetting('setRebalanceMaxSlippageBps', BigInt(v)); }} disabled={saving} style={{ ...secondaryButtonStyle, fontSize: '0.65rem', padding: '2px 6px' }}>Set</button>
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Targets */}
                    <div style={{ marginBottom: '16px' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                            <h4 style={{ color: theme.colors.primaryText, margin: 0, fontSize: '0.85rem', fontWeight: '600' }}>
                                Target Allocations ({targets.length} token{targets.length !== 1 ? 's' : ''})
                            </h4>
                            {editingTargets === null ? (
                                <button onClick={() => setEditingTargets(targets.map(t => ({ token: t.token.toText ? t.token.toText() : String(t.token), targetBps: Number(t.targetBps).toString() })))} style={{ ...secondaryButtonStyle, fontSize: '0.7rem', padding: '3px 8px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                                    <FaEdit style={{ fontSize: '0.65rem' }} /> Edit
                                </button>
                            ) : (
                                <div style={{ display: 'flex', gap: '6px' }}>
                                    <button onClick={handleSaveTargets} disabled={saving} style={{ ...buttonStyle, fontSize: '0.7rem', padding: '3px 8px', background: `linear-gradient(135deg, ${accentColor}, ${accentColor}cc)`, color: '#fff', border: 'none', display: 'flex', alignItems: 'center', gap: '4px' }}>
                                        <FaSave style={{ fontSize: '0.6rem' }} /> Save
                                    </button>
                                    <button onClick={() => setEditingTargets(null)} style={{ ...secondaryButtonStyle, fontSize: '0.7rem', padding: '3px 8px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                                        <FaTimes style={{ fontSize: '0.6rem' }} /> Cancel
                                    </button>
                                </div>
                            )}
                        </div>

                        {editingTargets === null ? (
                            targets.length === 0 ? (
                                <div style={{ textAlign: 'center', padding: '16px', color: theme.colors.mutedText, fontSize: '0.85rem', background: theme.colors.primaryBg, borderRadius: '8px', border: `1px solid ${theme.colors.border}` }}>
                                    No rebalance targets set. Click Edit to add tokens.
                                </div>
                            ) : (
                                <div style={{ display: 'grid', gap: '6px' }}>
                                    {targets.map((t, i) => (
                                        <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 12px', background: theme.colors.primaryBg, borderRadius: '8px', border: `1px solid ${theme.colors.border}` }}>
                                            <span style={{ fontSize: '0.8rem', color: theme.colors.primaryText, fontWeight: '500' }}>{getTokenLabel(t.token)}</span>
                                            <span style={{ fontSize: '0.85rem', fontWeight: '600', color: accentColor }}>{(Number(t.targetBps) / 100).toFixed(1)}%</span>
                                        </div>
                                    ))}
                                    <div style={{ textAlign: 'right', fontSize: '0.75rem', color: theme.colors.secondaryText }}>
                                        Total: {(targets.reduce((s, t) => s + Number(t.targetBps), 0) / 100).toFixed(1)}%
                                    </div>
                                </div>
                            )
                        ) : (
                            <div>
                                {editingTargets.map((t, i) => (
                                    <div key={i} style={{ display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '8px' }}>
                                        <div style={{ flex: 1 }}>
                                            <TokenSelector
                                                value={t.token}
                                                onChange={(v) => { const arr = [...editingTargets]; arr[i] = { ...arr[i], token: v }; setEditingTargets(arr); }}
                                                onSelectToken={cacheTokenMeta}
                                                allowCustom={true}
                                                placeholder="Select token..."
                                            />
                                        </div>
                                        <input value={t.targetBps} onChange={(e) => { const arr = [...editingTargets]; arr[i] = { ...arr[i], targetBps: e.target.value }; setEditingTargets(arr); }} style={{ ...inputStyle, width: '70px', fontSize: '0.75rem' }} type="text" inputMode="numeric" />
                                        <span style={{ fontSize: '0.7rem', color: theme.colors.secondaryText, minWidth: '30px' }}>bps</span>
                                        <button onClick={() => setEditingTargets(editingTargets.filter((_, j) => j !== i))} style={{ ...secondaryButtonStyle, fontSize: '0.65rem', padding: '2px 6px', color: '#ef4444', borderColor: '#ef444440' }}>
                                            <FaTrash style={{ fontSize: '0.6rem' }} />
                                        </button>
                                    </div>
                                ))}
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '6px' }}>
                                    <button onClick={() => setEditingTargets([...editingTargets, { token: '', targetBps: '0' }])} style={{ ...secondaryButtonStyle, fontSize: '0.7rem', padding: '3px 8px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                                        <FaPlus style={{ fontSize: '0.6rem' }} /> Add Token
                                    </button>
                                    <span style={{ fontSize: '0.75rem', color: editingTargets.reduce((s, t) => s + (parseInt(t.targetBps) || 0), 0) === 10000 ? '#22c55e' : '#f59e0b' }}>
                                        Total: {(editingTargets.reduce((s, t) => s + (parseInt(t.targetBps) || 0), 0) / 100).toFixed(1)}% {editingTargets.reduce((s, t) => s + (parseInt(t.targetBps) || 0), 0) === 10000 ? '' : '(must be 100%)'}
                                    </span>
                                </div>
                            </div>
                        )}
                    </div>

                    {/* Portfolio Status */}
                    <div>
                        <button onClick={loadPortfolio} disabled={loadingPortfolio} style={{ ...secondaryButtonStyle, fontSize: '0.8rem', marginBottom: '8px' }}>
                            {loadingPortfolio ? 'Loading...' : portfolioStatus ? 'Refresh Portfolio Status' : 'View Portfolio Status'}
                        </button>
                        {portfolioStatus && (
                            <div style={{ background: theme.colors.primaryBg, borderRadius: '8px', border: `1px solid ${theme.colors.border}`, overflow: 'hidden' }}>
                                <div style={{ padding: '8px 12px', fontSize: '0.75rem', color: theme.colors.secondaryText, borderBottom: `1px solid ${theme.colors.border}` }}>
                                    Total value: <strong style={{ color: theme.colors.primaryText }}>{formatTokenAmount(portfolioStatus.totalValueInDenomination, denomDecimals)} {denomSymbol}</strong>
                                </div>
                                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.75rem' }}>
                                    <thead>
                                        <tr style={{ background: `${accentColor}08` }}>
                                            <th style={{ padding: '6px 10px', textAlign: 'left', color: theme.colors.secondaryText, fontWeight: '500' }}>Token</th>
                                            <th style={{ padding: '6px 10px', textAlign: 'right', color: theme.colors.secondaryText, fontWeight: '500' }}>Current</th>
                                            <th style={{ padding: '6px 10px', textAlign: 'right', color: theme.colors.secondaryText, fontWeight: '500' }}>Target</th>
                                            <th style={{ padding: '6px 10px', textAlign: 'right', color: theme.colors.secondaryText, fontWeight: '500' }}>Deviation</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {portfolioStatus.tokens.map((tok, i) => (
                                            <tr key={i} style={{ borderTop: `1px solid ${theme.colors.border}` }}>
                                                <td style={{ padding: '6px 10px', color: theme.colors.primaryText }}>{tok.symbol || getSymbol(tok.token)}</td>
                                                <td style={{ padding: '6px 10px', textAlign: 'right', color: theme.colors.primaryText }}>{(Number(tok.currentBps) / 100).toFixed(1)}%</td>
                                                <td style={{ padding: '6px 10px', textAlign: 'right', color: theme.colors.primaryText }}>{(Number(tok.targetBps) / 100).toFixed(1)}%</td>
                                                <td style={{ padding: '6px 10px', textAlign: 'right', fontWeight: '500', color: Number(tok.deviationBps) > 0 ? '#ef4444' : Number(tok.deviationBps) < 0 ? '#3b82f6' : theme.colors.secondaryText }}>
                                                    {Number(tok.deviationBps) > 0 ? '+' : ''}{(Number(tok.deviationBps) / 100).toFixed(1)}%
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        )}
                    </div>
                </>
            )}
        </div>
    );
}

// ============================================
// DISTRIBUTION CONFIG PANEL
// ============================================
function DistributionConfigPanel({ instanceId, getReadyBotActor, theme, accentColor, cardStyle, inputStyle, buttonStyle, secondaryButtonStyle }) {
    const { identity } = useAuth();
    const [lists, setLists] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [success, setSuccess] = useState('');
    const [saving, setSaving] = useState(false);
    const [adding, setAdding] = useState(false);
    const [expandedList, setExpandedList] = useState(null);

    // New list form
    const [newName, setNewName] = useState('');
    const [newLedger, setNewLedger] = useState('');
    const [newThreshold, setNewThreshold] = useState('0');
    const [newMaxDist, setNewMaxDist] = useState('0');

    const loadLists = useCallback(async () => {
        try {
            const bot = await getReadyBotActor();
            if (!bot) return;
            const result = await bot.getDistributionLists(instanceId);
            setLists(result);
        } catch (err) { setError('Failed to load distribution lists: ' + err.message); }
        finally { setLoading(false); }
    }, [getReadyBotActor, instanceId]);

    useEffect(() => { loadLists(); }, [loadLists]);

    const handleAdd = async () => {
        if (!newName.trim()) { setError('Name is required.'); return; }
        if (!newLedger.trim()) { setError('Token ledger canister ID is required.'); return; }
        setSaving(true); setError(''); setSuccess('');
        try {
            const bot = await getReadyBotActor();
            await bot.addDistributionList(instanceId, {
                name: newName.trim(),
                sourceSubaccount: [],
                tokenLedgerCanisterId: Principal.fromText(newLedger.trim()),
                thresholdAmount: BigInt(newThreshold || 0),
                maxDistributionAmount: BigInt(newMaxDist || 0),
                targets: [],
            });
            setSuccess('Distribution list added.');
            setAdding(false); setNewName(''); setNewLedger(''); setNewThreshold('0'); setNewMaxDist('0');
            await loadLists();
        } catch (err) { setError('Failed to add: ' + err.message); }
        finally { setSaving(false); }
    };

    const handleRemove = async (id) => {
        setSaving(true); setError(''); setSuccess('');
        try {
            const bot = await getReadyBotActor();
            await bot.removeDistributionList(instanceId, BigInt(id));
            setSuccess('Distribution list removed.');
            await loadLists();
        } catch (err) { setError('Failed to remove: ' + err.message); }
        finally { setSaving(false); }
    };

    // Resolve token metadata for ledger tokens in distribution lists
    const distTokenIds = React.useMemo(() => {
        return lists.map(l => {
            const key = typeof l.tokenLedgerCanisterId === 'string' ? l.tokenLedgerCanisterId : l.tokenLedgerCanisterId?.toText?.() || String(l.tokenLedgerCanisterId);
            return key;
        });
    }, [lists]);
    const distTokenMeta = useTokenMetadata(distTokenIds, identity);
    const getDistTokenSymbol = (principal) => {
        const key = typeof principal === 'string' ? principal : principal?.toText?.() || String(principal);
        return distTokenMeta[key]?.symbol || shortPrincipal(key);
    };

    return (
        <div style={cardStyle}>
            <h3 style={{ color: theme.colors.primaryText, margin: '0 0 12px 0', fontSize: '0.95rem', fontWeight: '600' }}>Distribution Lists</h3>
            <p style={{ margin: '0 0 12px 0', fontSize: '0.85rem', color: theme.colors.secondaryText, lineHeight: '1.5' }}>
                Configure percentage-based distribution lists to automatically split and send funds to multiple recipients.
            </p>

            {error && <div style={{ padding: '8px 12px', background: '#ef444415', border: '1px solid #ef444430', borderRadius: '8px', color: '#ef4444', fontSize: '0.8rem', marginBottom: '10px' }}>{error}</div>}
            {success && <div style={{ padding: '8px 12px', background: '#22c55e15', border: '1px solid #22c55e30', borderRadius: '8px', color: '#22c55e', fontSize: '0.8rem', marginBottom: '10px' }}>{success}</div>}

            {loading ? (
                <div style={{ textAlign: 'center', padding: '16px', color: theme.colors.secondaryText, fontSize: '0.85rem' }}>Loading distribution lists...</div>
            ) : (
                <>
                    {lists.length === 0 && !adding && (
                        <div style={{ textAlign: 'center', padding: '16px', color: theme.colors.mutedText, fontSize: '0.85rem', background: theme.colors.primaryBg, borderRadius: '8px', border: `1px solid ${theme.colors.border}` }}>
                            No distribution lists configured yet.
                        </div>
                    )}

                    {lists.map((list) => (
                        <div key={Number(list.id)} style={{
                            padding: '12px', marginBottom: '8px',
                            background: theme.colors.primaryBg, borderRadius: '8px',
                            border: `1px solid ${theme.colors.border}`,
                        }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
                                <div>
                                    <span style={{ fontSize: '0.85rem', fontWeight: '600', color: theme.colors.primaryText }}>{list.name}</span>
                                    <span style={{ marginLeft: '8px', fontSize: '0.7rem', color: theme.colors.secondaryText }}>#{Number(list.id)}</span>
                                </div>
                                <div style={{ display: 'flex', gap: '6px' }}>
                                    <button onClick={() => setExpandedList(expandedList === Number(list.id) ? null : Number(list.id))}
                                        style={{ ...secondaryButtonStyle, fontSize: '0.7rem', padding: '3px 8px' }}>
                                        {expandedList === Number(list.id) ? 'Collapse' : 'Details'}
                                    </button>
                                    <button onClick={() => handleRemove(Number(list.id))} disabled={saving}
                                        style={{ ...secondaryButtonStyle, fontSize: '0.7rem', padding: '3px 8px', color: '#ef4444', borderColor: '#ef444440' }}>
                                        <FaTrash style={{ fontSize: '0.6rem' }} />
                                    </button>
                                </div>
                            </div>
                            <div style={{ marginTop: '6px', fontSize: '0.75rem', color: theme.colors.secondaryText, display: 'flex', gap: '16px', flexWrap: 'wrap' }}>
                                <span>Token: {getDistTokenSymbol(list.tokenLedgerCanisterId)}</span>
                                <span>Threshold: {Number(list.thresholdAmount).toLocaleString()}</span>
                                <span>Max: {Number(list.maxDistributionAmount).toLocaleString()}</span>
                                <span>Targets: {list.targets.length}</span>
                            </div>
                            {expandedList === Number(list.id) && list.targets.length > 0 && (
                                <div style={{ marginTop: '8px', paddingTop: '8px', borderTop: `1px solid ${theme.colors.border}` }}>
                                    {list.targets.map((target, i) => (
                                        <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', fontSize: '0.75rem' }}>
                                            <span style={{ color: theme.colors.primaryText, fontFamily: 'monospace' }}>
                                                {shortPrincipal(target.account.owner)}
                                            </span>
                                            <span style={{ color: accentColor, fontWeight: '500' }}>
                                                {target.basisPoints?.length > 0 ? `${(Number(target.basisPoints[0]) / 100).toFixed(1)}%` : 'Auto-split'}
                                            </span>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    ))}

                    {/* Add Distribution List Form */}
                    {adding ? (
                        <div style={{ padding: '14px', background: `${accentColor}06`, borderRadius: '8px', border: `1px solid ${accentColor}20`, marginTop: '10px' }}>
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '10px' }}>
                                <div>
                                    <label style={{ fontSize: '0.75rem', color: theme.colors.secondaryText, display: 'block', marginBottom: '4px' }}>Name</label>
                                    <input value={newName} onChange={(e) => setNewName(e.target.value)} style={{ ...inputStyle, width: '100%' }} placeholder="e.g. Revenue Share" />
                                </div>
                                <div>
                                    <label style={{ fontSize: '0.75rem', color: theme.colors.secondaryText, display: 'block', marginBottom: '4px' }}>Token Ledger</label>
                                    <TokenSelector
                                        value={newLedger}
                                        onChange={setNewLedger}
                                        onSelectToken={cacheTokenMeta}
                                        allowCustom={true}
                                        placeholder="Select token..."
                                    />
                                </div>
                                <div>
                                    <label style={{ fontSize: '0.75rem', color: theme.colors.secondaryText, display: 'block', marginBottom: '4px' }}>Threshold Amount</label>
                                    <input value={newThreshold} onChange={(e) => setNewThreshold(e.target.value)} style={{ ...inputStyle, width: '100%' }} type="text" inputMode="numeric" />
                                </div>
                                <div>
                                    <label style={{ fontSize: '0.75rem', color: theme.colors.secondaryText, display: 'block', marginBottom: '4px' }}>Max Distribution Amount</label>
                                    <input value={newMaxDist} onChange={(e) => setNewMaxDist(e.target.value)} style={{ ...inputStyle, width: '100%' }} type="text" inputMode="numeric" />
                                </div>
                            </div>
                            <div style={{ display: 'flex', gap: '8px', marginTop: '12px' }}>
                                <button onClick={handleAdd} disabled={saving} style={{ ...buttonStyle, background: `linear-gradient(135deg, ${accentColor}, ${accentColor}cc)`, color: '#fff', border: 'none', opacity: saving ? 0.6 : 1 }}>
                                    <FaPlus style={{ marginRight: '4px', fontSize: '0.7rem' }} /> Add List
                                </button>
                                <button onClick={() => setAdding(false)} style={{ ...secondaryButtonStyle }}>Cancel</button>
                            </div>
                        </div>
                    ) : (
                        <button onClick={() => { setAdding(true); setError(''); setSuccess(''); }} style={{ ...secondaryButtonStyle, marginTop: '10px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                            <FaPlus style={{ fontSize: '0.7rem' }} /> Add Distribution List
                        </button>
                    )}
                </>
            )}
        </div>
    );
}

// ============================================
// ACTION_TYPE_LABELS lookup for trade log
// ============================================
const TRADE_STATUS_LABELS = { Success: 'Success', Failed: 'Failed', Skipped: 'Skipped' };
const TRADE_STATUS_COLORS = { Success: '#22c55e', Failed: '#ef4444', Skipped: '#f59e0b' };
const DEX_LABELS = { 0: 'ICPSwap', 1: 'KongSwap' };

// ============================================
// Trade Log Viewer
// ============================================
function TradeLogViewer({ getReadyBotActor, theme, accentColor }) {
    const { identity } = useAuth();
    const [entries, setEntries] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [stats, setStats] = useState(null);
    const [query, setQuery] = useState({ startId: [], limit: [50], choreId: [], choreTypeId: [], actionType: [], inputToken: [], outputToken: [], status: [], fromTime: [], toTime: [] });
    const [hasMore, setHasMore] = useState(false);
    const [filterStatus, setFilterStatus] = useState('');
    const [filterChoreType, setFilterChoreType] = useState('');
    const [expandedId, setExpandedId] = useState(null);
    // Cache of snapshots keyed by tradeLogId: { before: snapshot|null, after: snapshot|null }
    const [snapCache, setSnapCache] = useState({});
    const [snapLoading, setSnapLoading] = useState({});

    // Collect token IDs from entries for metadata resolution
    const entryTokenIds = React.useMemo(() => {
        const ids = new Set();
        for (const e of entries) {
            ids.add(typeof e.inputToken === 'string' ? e.inputToken : e.inputToken?.toText?.() || String(e.inputToken));
            if (e.outputToken?.length > 0) {
                ids.add(typeof e.outputToken[0] === 'string' ? e.outputToken[0] : e.outputToken[0]?.toText?.() || String(e.outputToken[0]));
            }
        }
        return [...ids];
    }, [entries]);
    const tokenMeta = useTokenMetadata(entryTokenIds, identity);

    const getSym = (p) => {
        const key = typeof p === 'string' ? p : p?.toText?.() || String(p);
        return tokenMeta[key]?.symbol || shortPrincipal(key);
    };
    const getDec = (p) => {
        const key = typeof p === 'string' ? p : p?.toText?.() || String(p);
        return tokenMeta[key]?.decimals ?? 8;
    };

    const loadData = useCallback(async (q) => {
        try {
            const bot = await getReadyBotActor();
            if (!bot) return;
            const [result, st] = await Promise.all([
                bot.getTradeLog(q || query),
                bot.getTradeLogStats(),
            ]);
            setEntries(result.entries);
            setHasMore(result.hasMore);
            setStats(st);
        } catch (err) {
            setError('Failed to load trade log: ' + err.message);
        } finally {
            setLoading(false);
        }
    }, [getReadyBotActor, query]);

    useEffect(() => { loadData(); }, [loadData]);

    // Fetch snapshots for a trade log entry when expanded
    const loadSnapshots = useCallback(async (tradeLogId, choreId, timestamp) => {
        if (snapCache[tradeLogId] || snapLoading[tradeLogId]) return;
        setSnapLoading(prev => ({ ...prev, [tradeLogId]: true }));
        try {
            const bot = await getReadyBotActor();
            if (!bot) return;
            // Fetch after-snapshot linked by tradeLogId, and also all snapshots
            // in a time window around the trade to find the before-snapshot
            const timeWindow = 120_000_000_000; // 2 minutes in nanoseconds
            const ts = BigInt(timestamp);
            const result = await bot.getPortfolioSnapshots({
                startId: [], limit: [20], tradeLogId: [],
                phase: [], fromTime: [ts - BigInt(timeWindow)], toTime: [ts + BigInt(timeWindow)],
            });
            // Find after-snapshot (linked by tradeLogId)
            let afterSnap = null;
            let beforeSnap = null;
            for (const snap of result.entries) {
                const snapTradeLogId = snap.tradeLogId?.length > 0 ? Number(snap.tradeLogId[0]) : null;
                const phaseKey = Object.keys(snap.phase || {})[0] || '';
                if (snapTradeLogId === tradeLogId && phaseKey === 'After') {
                    afterSnap = snap;
                }
                // Before-snapshot: same choreId, phase=Before, just before the trade
                if (phaseKey === 'Before' && !beforeSnap) {
                    const snapChoreId = snap.choreId?.length > 0 ? snap.choreId[0] : null;
                    const snapChoreStr = typeof snapChoreId === 'string' ? snapChoreId : snapChoreId?.toText?.() || String(snapChoreId);
                    if (snapChoreStr === choreId && Number(snap.timestamp) <= Number(timestamp)) {
                        beforeSnap = snap;
                    }
                }
            }
            // If we didn't find the before via time window, take the closest Before snapshot
            if (!beforeSnap) {
                const befores = result.entries
                    .filter(s => Object.keys(s.phase || {})[0] === 'Before' && Number(s.timestamp) <= Number(timestamp))
                    .sort((a, b) => Number(b.timestamp) - Number(a.timestamp));
                if (befores.length > 0) beforeSnap = befores[0];
            }
            setSnapCache(prev => ({ ...prev, [tradeLogId]: { before: beforeSnap, after: afterSnap } }));
        } catch (err) {
            console.error('Failed to load snapshots for trade', tradeLogId, err);
        } finally {
            setSnapLoading(prev => ({ ...prev, [tradeLogId]: false }));
        }
    }, [getReadyBotActor, snapCache, snapLoading]);

    const applyFilters = () => {
        const q = {
            startId: [], limit: [50],
            choreId: [], choreTypeId: filterChoreType ? [filterChoreType] : [],
            actionType: [], inputToken: [], outputToken: [],
            status: filterStatus ? [{ [filterStatus]: null }] : [],
            fromTime: [], toTime: [],
        };
        setQuery(q);
        setLoading(true);
        setSnapCache({});
        loadData(q);
    };

    const cardStyle = {
        background: theme.colors.cardGradient,
        borderRadius: '12px',
        border: `1px solid ${theme.colors.border}`,
        padding: '16px',
    };
    const inputStyle = {
        background: theme.colors.inputBg,
        border: `1px solid ${theme.colors.border}`,
        borderRadius: '8px',
        padding: '6px 10px',
        color: theme.colors.primaryText,
        fontSize: '0.8rem',
    };

    const optVal = (arr) => arr?.length > 0 ? arr[0] : null;

    // Render a compact snapshot comparison for a trade entry
    const renderSnapshotDiff = (tradeId) => {
        const cached = snapCache[tradeId];
        if (!cached) return snapLoading[tradeId] ? <div style={{ fontSize: '0.72rem', color: theme.colors.mutedText, padding: '6px 0' }}>Loading snapshots...</div> : null;
        const { before, after } = cached;
        if (!before && !after) return <div style={{ fontSize: '0.72rem', color: theme.colors.mutedText, padding: '6px 0' }}>No snapshots available for this trade.</div>;

        // Build a merged token list from both snapshots
        const tokenMap = new Map();
        const addTokens = (snap, key) => {
            if (!snap?.tokens) return;
            for (const t of snap.tokens) {
                const tid = typeof t.token === 'string' ? t.token : t.token?.toText?.() || String(t.token);
                if (!tokenMap.has(tid)) tokenMap.set(tid, { symbol: t.symbol, decimals: Number(t.decimals) });
                tokenMap.get(tid)[key] = t;
            }
        };
        addTokens(before, 'before');
        addTokens(after, 'after');

        return (
            <div style={{ marginTop: '8px', borderTop: `1px solid ${theme.colors.border}`, paddingTop: '8px' }}>
                <div style={{ fontSize: '0.72rem', fontWeight: '600', color: theme.colors.secondaryText, marginBottom: '4px' }}>Portfolio Snapshot</div>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.72rem' }}>
                    <thead>
                        <tr style={{ color: theme.colors.mutedText, textAlign: 'left' }}>
                            <th style={{ padding: '2px 6px' }}>Token</th>
                            <th style={{ padding: '2px 6px', textAlign: 'right' }}>Before</th>
                            <th style={{ padding: '2px 6px', textAlign: 'right' }}>After</th>
                            <th style={{ padding: '2px 6px', textAlign: 'right' }}>Change</th>
                        </tr>
                    </thead>
                    <tbody>
                        {[...tokenMap.entries()].map(([tid, info]) => {
                            const dec = info.decimals;
                            const bBal = info.before?.balance != null ? Number(info.before.balance) : null;
                            const aBal = info.after?.balance != null ? Number(info.after.balance) : null;
                            const diff = (bBal != null && aBal != null) ? aBal - bBal : null;
                            const diffColor = diff > 0 ? '#22c55e' : diff < 0 ? '#ef4444' : theme.colors.secondaryText;
                            const diffPrefix = diff > 0 ? '+' : '';
                            return (
                                <tr key={tid} style={{ borderTop: `1px solid ${theme.colors.border}10` }}>
                                    <td style={{ padding: '3px 6px', color: theme.colors.primaryText, fontWeight: '500' }}>{info.symbol}</td>
                                    <td style={{ padding: '3px 6px', textAlign: 'right', color: theme.colors.secondaryText }}>
                                        {bBal != null ? formatTokenAmount(bBal, dec) : '—'}
                                    </td>
                                    <td style={{ padding: '3px 6px', textAlign: 'right', color: theme.colors.secondaryText }}>
                                        {aBal != null ? formatTokenAmount(aBal, dec) : '—'}
                                    </td>
                                    <td style={{ padding: '3px 6px', textAlign: 'right', color: diffColor, fontWeight: diff ? '600' : '400' }}>
                                        {diff != null ? `${diffPrefix}${formatTokenAmount(Math.abs(diff), dec)}` : '—'}
                                    </td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>
        );
    };

    return (
        <div style={cardStyle}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px', flexWrap: 'wrap', gap: '8px' }}>
                <h3 style={{ color: theme.colors.primaryText, margin: 0, fontSize: '0.95rem', fontWeight: '600' }}>Trade Log</h3>
                {stats && <span style={{ fontSize: '0.75rem', color: theme.colors.secondaryText }}>{Number(stats.totalEntries)} entries</span>}
            </div>

            {/* Filters */}
            <div style={{ display: 'flex', gap: '8px', marginBottom: '12px', flexWrap: 'wrap', alignItems: 'center' }}>
                <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)} style={{ ...inputStyle, appearance: 'auto', minWidth: '100px' }}>
                    <option value="">All statuses</option>
                    <option value="Success">Success</option>
                    <option value="Failed">Failed</option>
                    <option value="Skipped">Skipped</option>
                </select>
                <select value={filterChoreType} onChange={(e) => setFilterChoreType(e.target.value)} style={{ ...inputStyle, appearance: 'auto', minWidth: '120px' }}>
                    <option value="">All chore types</option>
                    <option value="trade">Trade</option>
                    <option value="rebalance">Rebalance</option>
                    <option value="move-funds">Move Funds</option>
                    <option value="distribute-funds">Distribute</option>
                </select>
                <button onClick={applyFilters} style={{ ...inputStyle, cursor: 'pointer', background: `${accentColor}15`, border: `1px solid ${accentColor}30`, color: accentColor, fontWeight: '500' }}>Filter</button>
            </div>

            {error && <div style={{ padding: '8px 12px', background: '#ef444415', border: '1px solid #ef444430', borderRadius: '8px', color: '#ef4444', fontSize: '0.8rem', marginBottom: '10px' }}>{error}</div>}

            {loading ? (
                <div style={{ textAlign: 'center', padding: '20px', color: theme.colors.secondaryText, fontSize: '0.85rem' }}>Loading trade log...</div>
            ) : entries.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '20px', color: theme.colors.mutedText, fontSize: '0.85rem', background: theme.colors.primaryBg, borderRadius: '8px', border: `1px solid ${theme.colors.border}` }}>
                    No trade log entries yet. Entries are recorded when chores execute trades.
                </div>
            ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    {entries.map((e) => {
                        const statusKey = Object.keys(e.status || {})[0] || 'Failed';
                        const inputDec = getDec(e.inputToken);
                        const outputDec = e.outputToken?.length > 0 ? getDec(e.outputToken[0]) : 8;
                        const isSwap = Number(e.actionType) === 0;
                        const isExpanded = expandedId === Number(e.id);
                        // Format price as human-readable output/input
                        const priceE8s = optVal(e.priceE8s);
                        const humanPrice = priceE8s != null && outputDec != null ? (Number(priceE8s) / (10 ** outputDec)) : null;
                        const outSym = e.outputToken?.length > 0 ? getSym(e.outputToken[0]) : '';
                        const inSym = getSym(e.inputToken);
                        return (
                            <div key={Number(e.id)} style={{
                                padding: '10px 12px', background: theme.colors.primaryBg, borderRadius: '8px',
                                border: `1px solid ${isExpanded ? accentColor + '40' : theme.colors.border}`, fontSize: '0.78rem',
                            }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px', flexWrap: 'wrap', gap: '4px',
                                    cursor: isSwap ? 'pointer' : 'default' }}
                                    onClick={() => {
                                        if (!isSwap) return;
                                        const newId = isExpanded ? null : Number(e.id);
                                        setExpandedId(newId);
                                        if (newId != null) {
                                            loadSnapshots(Number(e.id), optVal(e.choreId) ? (typeof optVal(e.choreId) === 'string' ? optVal(e.choreId) : optVal(e.choreId)?.toText?.() || '') : '', e.timestamp);
                                        }
                                    }}
                                >
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                        <span style={{ fontWeight: '600', color: theme.colors.primaryText }}>#{Number(e.id)}</span>
                                        <span style={{ padding: '1px 6px', borderRadius: '4px', fontSize: '0.7rem', fontWeight: '600',
                                            background: (TRADE_STATUS_COLORS[statusKey] || '#6b7280') + '20',
                                            color: TRADE_STATUS_COLORS[statusKey] || '#6b7280',
                                        }}>{TRADE_STATUS_LABELS[statusKey] || statusKey}</span>
                                        <span style={{ color: theme.colors.mutedText }}>{ACTION_TYPE_LABELS[Number(e.actionType)] || `Type ${Number(e.actionType)}`}</span>
                                        {isSwap && <span style={{ color: theme.colors.mutedText, fontSize: '0.7rem' }}>{isExpanded ? '▾' : '▸'}</span>}
                                    </div>
                                    <span style={{ color: theme.colors.mutedText, fontSize: '0.7rem' }}>{new Date(Number(e.timestamp) / 1_000_000).toLocaleString()}</span>
                                </div>
                                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: '4px', color: theme.colors.secondaryText }}>
                                    <div><strong>In:</strong> {formatTokenAmount(e.inputAmount, inputDec)} {inSym}</div>
                                    {e.outputToken?.length > 0 && <div><strong>Out:</strong> {optVal(e.outputAmount) != null ? formatTokenAmount(optVal(e.outputAmount), outputDec) : '—'} {outSym}</div>}
                                    {humanPrice != null && <div><strong>Price:</strong> {humanPrice.toLocaleString(undefined, { maximumSignificantDigits: 6 })} {outSym}/{inSym}</div>}
                                    {optVal(e.dexId) != null && <div><strong>DEX:</strong> {DEX_LABELS[Number(optVal(e.dexId))] || `DEX ${Number(optVal(e.dexId))}`}</div>}
                                    {optVal(e.priceImpactBps) != null && <div><strong>Impact:</strong> {Number(optVal(e.priceImpactBps))} bps</div>}
                                    {optVal(e.choreId) && <div><strong>Chore:</strong> {optVal(e.choreId)}</div>}
                                    {optVal(e.actionId) != null && <div><strong>Action:</strong> #{Number(optVal(e.actionId))}</div>}
                                    {optVal(e.errorMessage) && <div style={{ color: '#ef4444', gridColumn: '1 / -1' }}><strong>Error:</strong> {optVal(e.errorMessage)}</div>}
                                </div>
                                {isExpanded && renderSnapshotDiff(Number(e.id))}
                            </div>
                        );
                    })}
                    {hasMore && (
                        <button onClick={() => {
                            const lastId = entries[entries.length - 1]?.id;
                            const nextQ = { ...query, startId: lastId != null ? [Number(lastId) + 1] : [] };
                            setQuery(nextQ); setLoading(true); loadData(nextQ);
                        }} style={{ ...inputStyle, cursor: 'pointer', textAlign: 'center', marginTop: '4px', background: `${accentColor}10`, color: accentColor, fontWeight: '500', border: `1px solid ${accentColor}30` }}>Load More...</button>
                    )}
                </div>
            )}
        </div>
    );
}

// ============================================
// Portfolio Snapshot Viewer
// ============================================
function PortfolioSnapshotViewer({ getReadyBotActor, theme, accentColor }) {
    const [snapshots, setSnapshots] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [stats, setStats] = useState(null);
    const [hasMore, setHasMore] = useState(false);
    const [expandedId, setExpandedId] = useState(null);

    const loadData = useCallback(async () => {
        try {
            const bot = await getReadyBotActor();
            if (!bot) return;
            const [result, st] = await Promise.all([
                bot.getPortfolioSnapshots({ startId: [], limit: [20], tradeLogId: [], phase: [], fromTime: [], toTime: [] }),
                bot.getPortfolioSnapshotStats(),
            ]);
            setSnapshots(result.entries);
            setHasMore(result.hasMore);
            setStats(st);
        } catch (err) {
            setError('Failed to load portfolio snapshots: ' + err.message);
        } finally {
            setLoading(false);
        }
    }, [getReadyBotActor]);

    useEffect(() => { loadData(); }, [loadData]);

    const optVal = (arr) => arr?.length > 0 ? arr[0] : null;

    const cardStyle = {
        background: theme.colors.cardGradient,
        borderRadius: '12px',
        border: `1px solid ${theme.colors.border}`,
        padding: '16px',
    };

    return (
        <div style={cardStyle}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                <h3 style={{ color: theme.colors.primaryText, margin: 0, fontSize: '0.95rem', fontWeight: '600' }}>Portfolio Snapshots</h3>
                {stats && <span style={{ fontSize: '0.75rem', color: theme.colors.secondaryText }}>{Number(stats.totalEntries)} snapshots</span>}
            </div>

            {error && <div style={{ padding: '8px 12px', background: '#ef444415', border: '1px solid #ef444430', borderRadius: '8px', color: '#ef4444', fontSize: '0.8rem', marginBottom: '10px' }}>{error}</div>}

            {loading ? (
                <div style={{ textAlign: 'center', padding: '20px', color: theme.colors.secondaryText, fontSize: '0.85rem' }}>Loading snapshots...</div>
            ) : snapshots.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '20px', color: theme.colors.mutedText, fontSize: '0.85rem', background: theme.colors.primaryBg, borderRadius: '8px', border: `1px solid ${theme.colors.border}` }}>
                    No portfolio snapshots yet. Snapshots are taken before and after trades.
                </div>
            ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    {snapshots.map((snap) => {
                        const phaseKey = Object.keys(snap.phase || {})[0] || '';
                        const isExpanded = expandedId === Number(snap.id);
                        return (
                            <div key={Number(snap.id)} style={{
                                padding: '10px 12px', background: theme.colors.primaryBg, borderRadius: '8px',
                                border: `1px solid ${theme.colors.border}`, fontSize: '0.78rem',
                            }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer' }}
                                    onClick={() => setExpandedId(isExpanded ? null : Number(snap.id))}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                        <span style={{ fontWeight: '600', color: theme.colors.primaryText }}>#{Number(snap.id)}</span>
                                        <span style={{ padding: '1px 6px', borderRadius: '4px', fontSize: '0.7rem', fontWeight: '600',
                                            background: phaseKey === 'Before' ? '#3b82f620' : '#22c55e20',
                                            color: phaseKey === 'Before' ? '#3b82f6' : '#22c55e',
                                        }}>{phaseKey}</span>
                                        <span style={{ color: theme.colors.secondaryText }}>{snap.trigger}</span>
                                    </div>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                        {optVal(snap.totalValueIcpE8s) != null && <span style={{ color: theme.colors.secondaryText }}>{formatTokenAmount(optVal(snap.totalValueIcpE8s), 8)} ICP</span>}
                                        <span style={{ color: theme.colors.mutedText, fontSize: '0.7rem' }}>{new Date(Number(snap.timestamp) / 1_000_000).toLocaleString()}</span>
                                        <span style={{ color: theme.colors.mutedText }}>{isExpanded ? '▾' : '▸'}</span>
                                    </div>
                                </div>
                                {isExpanded && snap.tokens?.length > 0 && (
                                    <div style={{ marginTop: '8px', borderTop: `1px solid ${theme.colors.border}`, paddingTop: '8px' }}>
                                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.75rem' }}>
                                            <thead>
                                                <tr style={{ color: theme.colors.mutedText, textAlign: 'left' }}>
                                                    <th style={{ padding: '2px 8px' }}>Token</th>
                                                    <th style={{ padding: '2px 8px', textAlign: 'right' }}>Balance</th>
                                                    <th style={{ padding: '2px 8px', textAlign: 'right' }}>ICP Price</th>
                                                    <th style={{ padding: '2px 8px', textAlign: 'right' }}>USD Price</th>
                                                    <th style={{ padding: '2px 8px', textAlign: 'right' }}>ICP Value</th>
                                                    <th style={{ padding: '2px 8px', textAlign: 'right' }}>USD Value</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {snap.tokens.map((tok, i) => (
                                                    <tr key={i} style={{ color: theme.colors.secondaryText, borderTop: `1px solid ${theme.colors.border}08` }}>
                                                        <td style={{ padding: '3px 8px', fontWeight: '500' }}>{tok.symbol || shortPrincipal(tok.token)}</td>
                                                        <td style={{ padding: '3px 8px', textAlign: 'right' }}>{formatTokenAmount(tok.balance, tok.decimals)}</td>
                                                        <td style={{ padding: '3px 8px', textAlign: 'right' }}>{optVal(tok.priceIcpE8s) != null ? formatTokenAmount(optVal(tok.priceIcpE8s), 8) : '—'}</td>
                                                        <td style={{ padding: '3px 8px', textAlign: 'right' }}>{optVal(tok.priceUsdE8s) != null ? formatTokenAmount(optVal(tok.priceUsdE8s), 8) : '—'}</td>
                                                        <td style={{ padding: '3px 8px', textAlign: 'right' }}>{optVal(tok.valueIcpE8s) != null ? formatTokenAmount(optVal(tok.valueIcpE8s), 8) : '—'}</td>
                                                        <td style={{ padding: '3px 8px', textAlign: 'right' }}>{optVal(tok.valueUsdE8s) != null ? formatTokenAmount(optVal(tok.valueUsdE8s), 8) : '—'}</td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                )}
                            </div>
                        );
                    })}
                    {hasMore && (
                        <div style={{ textAlign: 'center', padding: '8px', color: theme.colors.mutedText, fontSize: '0.78rem' }}>
                            More snapshots available (pagination coming soon)
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}

// ============================================
// Logging Settings Panel
// ============================================
function LoggingSettingsPanel({ getReadyBotActor, theme, accentColor, choreStatuses }) {
    const [settings, setSettings] = useState(null);
    const [overrides, setOverrides] = useState([]);
    const [metaStaleness, setMetaStaleness] = useState(null);
    const [metaInput, setMetaInput] = useState('');
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [success, setSuccess] = useState('');
    const [saving, setSaving] = useState(false);

    const loadData = useCallback(async () => {
        try {
            const bot = await getReadyBotActor();
            if (!bot) return;
            const [s, o, ms] = await Promise.all([
                bot.getLoggingSettings(),
                bot.getChoreLoggingOverrides(),
                bot.getMetadataStaleness ? bot.getMetadataStaleness() : Promise.resolve(3600n),
            ]);
            setSettings(s);
            setOverrides(o);
            const staleSec = Number(ms);
            setMetaStaleness(staleSec);
            setMetaInput(String(staleSec));
        } catch (err) {
            setError('Failed to load settings: ' + err.message);
        } finally {
            setLoading(false);
        }
    }, [getReadyBotActor]);

    useEffect(() => { loadData(); }, [loadData]);

    const handleToggleMaster = async (field) => {
        if (!settings) return;
        setSaving(true); setError(''); setSuccess('');
        try {
            const bot = await getReadyBotActor();
            const updated = { ...settings, [field]: !settings[field] };
            await bot.setLoggingSettings(updated);
            setSettings(updated);
            setSuccess(`${field === 'tradeLogEnabled' ? 'Trade' : 'Portfolio'} logging ${!settings[field] ? 'enabled' : 'disabled'}.`);
            setTimeout(() => setSuccess(''), 3000);
        } catch (err) { setError('Failed to update: ' + err.message); }
        finally { setSaving(false); }
    };

    const handleChoreOverride = async (choreId, field, value) => {
        setSaving(true); setError(''); setSuccess('');
        try {
            const bot = await getReadyBotActor();
            // Find existing override for this chore
            const existing = overrides.find(([id]) => id === choreId);
            const current = existing ? existing[1] : { tradeLogEnabled: [], portfolioLogEnabled: [] };
            const updated = { ...current, [field]: value === null ? [] : [value] };
            await bot.setChoreLoggingOverride(choreId, updated);
            setSuccess(`Override updated for ${choreId}.`);
            setTimeout(() => setSuccess(''), 3000);
            await loadData();
        } catch (err) { setError('Failed to set override: ' + err.message); }
        finally { setSaving(false); }
    };

    const handleSaveStaleness = async () => {
        const val = parseInt(metaInput, 10);
        if (isNaN(val) || val < 0) { setError('Staleness must be a non-negative number of seconds.'); return; }
        setSaving(true); setError(''); setSuccess('');
        try {
            const bot = await getReadyBotActor();
            await bot.setMetadataStaleness(BigInt(val));
            setMetaStaleness(val);
            setSuccess('Metadata staleness updated to ' + val + 's.');
            setTimeout(() => setSuccess(''), 3000);
        } catch (err) { setError('Failed to update staleness: ' + err.message); }
        finally { setSaving(false); }
    };

    const cardStyle = {
        background: theme.colors.cardGradient,
        borderRadius: '12px',
        border: `1px solid ${theme.colors.border}`,
        padding: '16px',
    };

    const optVal = (arr) => arr?.length > 0 ? arr[0] : null;

    const toggleBtnStyle = (isOn) => ({
        padding: '4px 12px', borderRadius: '6px', cursor: 'pointer', fontSize: '0.78rem', fontWeight: '500',
        border: `1px solid ${isOn ? '#22c55e40' : '#ef444440'}`,
        background: isOn ? '#22c55e15' : '#ef444415',
        color: isOn ? '#22c55e' : '#ef4444',
        opacity: saving ? 0.6 : 1,
    });

    const formatDuration = (secs) => {
        if (secs >= 86400) return `${(secs / 86400).toFixed(1)} days`;
        if (secs >= 3600) return `${(secs / 3600).toFixed(1)} hours`;
        if (secs >= 60) return `${(secs / 60).toFixed(0)} min`;
        return `${secs}s`;
    };

    return (
        <div style={cardStyle}>
            <h3 style={{ color: theme.colors.primaryText, margin: '0 0 12px 0', fontSize: '0.95rem', fontWeight: '600' }}>Bot &amp; Logging Settings</h3>

            {/* Metadata Staleness Setting */}
            <div style={{ padding: '12px', background: theme.colors.primaryBg, borderRadius: '8px', border: `1px solid ${theme.colors.border}`, marginBottom: '16px' }}>
                <div style={{ fontSize: '0.82rem', fontWeight: '600', color: theme.colors.primaryText, marginBottom: '4px' }}>Token Metadata Staleness</div>
                <p style={{ margin: '0 0 8px 0', fontSize: '0.75rem', color: theme.colors.mutedText, lineHeight: '1.4' }}>
                    How old cached token metadata (symbol, decimals, fees) can be before it's re-fetched at the start of each chore run. Lower values mean fresher data but more network calls.
                </p>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <input
                        type="number" min="0" step="60"
                        value={metaInput}
                        onChange={(e) => setMetaInput(e.target.value)}
                        disabled={saving || loading}
                        style={{ width: '100px', padding: '4px 8px', fontSize: '0.8rem', background: theme.colors.inputBg, border: `1px solid ${theme.colors.border}`, borderRadius: '6px', color: theme.colors.primaryText }}
                    />
                    <span style={{ fontSize: '0.78rem', color: theme.colors.secondaryText }}>seconds</span>
                    {metaStaleness != null && <span style={{ fontSize: '0.72rem', color: theme.colors.mutedText }}>({formatDuration(metaStaleness)})</span>}
                    <button
                        disabled={saving || metaInput === String(metaStaleness)}
                        onClick={handleSaveStaleness}
                        style={{
                            padding: '4px 12px', borderRadius: '6px', cursor: 'pointer', fontSize: '0.78rem', fontWeight: '500',
                            border: `1px solid ${accentColor}40`, background: `${accentColor}15`, color: accentColor,
                            opacity: saving || metaInput === String(metaStaleness) ? 0.5 : 1,
                        }}
                    >Save</button>
                </div>
            </div>

            <h4 style={{ color: theme.colors.primaryText, margin: '0 0 8px 0', fontSize: '0.88rem', fontWeight: '600' }}>Logging</h4>
            <p style={{ margin: '0 0 12px 0', fontSize: '0.82rem', color: theme.colors.secondaryText, lineHeight: '1.5' }}>
                Control what gets logged. Master toggles apply globally. Per-chore overrides let you enable or disable logging for specific chores.
            </p>

            {error && <div style={{ padding: '8px 12px', background: '#ef444415', border: '1px solid #ef444430', borderRadius: '8px', color: '#ef4444', fontSize: '0.8rem', marginBottom: '10px' }}>{error}</div>}
            {success && <div style={{ padding: '8px 12px', background: '#22c55e15', border: '1px solid #22c55e30', borderRadius: '8px', color: '#22c55e', fontSize: '0.8rem', marginBottom: '10px' }}>{success}</div>}

            {loading ? (
                <div style={{ textAlign: 'center', padding: '20px', color: theme.colors.secondaryText, fontSize: '0.85rem' }}>Loading settings...</div>
            ) : settings && (
                <>
                    {/* Master settings */}
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '16px' }}>
                        <div style={{ padding: '12px', background: theme.colors.primaryBg, borderRadius: '8px', border: `1px solid ${theme.colors.border}` }}>
                            <div style={{ fontSize: '0.82rem', fontWeight: '600', color: theme.colors.primaryText, marginBottom: '6px' }}>Trade Log</div>
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                                <span style={{ fontSize: '0.78rem', color: theme.colors.secondaryText }}>Max entries: {Number(settings.maxTradeLogEntries).toLocaleString()}</span>
                                <button disabled={saving} onClick={() => handleToggleMaster('tradeLogEnabled')} style={toggleBtnStyle(settings.tradeLogEnabled)}>
                                    {settings.tradeLogEnabled ? 'ON' : 'OFF'}
                                </button>
                            </div>
                        </div>
                        <div style={{ padding: '12px', background: theme.colors.primaryBg, borderRadius: '8px', border: `1px solid ${theme.colors.border}` }}>
                            <div style={{ fontSize: '0.82rem', fontWeight: '600', color: theme.colors.primaryText, marginBottom: '6px' }}>Portfolio Snapshots</div>
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                                <span style={{ fontSize: '0.78rem', color: theme.colors.secondaryText }}>Max entries: {Number(settings.maxPortfolioLogEntries).toLocaleString()}</span>
                                <button disabled={saving} onClick={() => handleToggleMaster('portfolioLogEnabled')} style={toggleBtnStyle(settings.portfolioLogEnabled)}>
                                    {settings.portfolioLogEnabled ? 'ON' : 'OFF'}
                                </button>
                            </div>
                        </div>
                    </div>

                    {/* Per-chore overrides */}
                    {choreStatuses && choreStatuses.length > 0 && (
                        <div>
                            <div style={{ fontSize: '0.82rem', fontWeight: '600', color: theme.colors.primaryText, marginBottom: '8px' }}>Per-Chore Overrides</div>
                            <div style={{ fontSize: '0.75rem', color: theme.colors.mutedText, marginBottom: '8px' }}>
                                "Use Master" means the chore follows the master toggle above.
                            </div>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                                {choreStatuses.map((chore) => {
                                    const override = overrides.find(([id]) => id === chore.choreId);
                                    const tradeOvr = override ? optVal(override[1].tradeLogEnabled) : null;
                                    const portfolioOvr = override ? optVal(override[1].portfolioLogEnabled) : null;
                                    return (
                                        <div key={chore.choreId} style={{
                                            padding: '8px 12px', background: theme.colors.primaryBg, borderRadius: '8px',
                                            border: `1px solid ${theme.colors.border}`, fontSize: '0.78rem',
                                            display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '6px',
                                        }}>
                                            <span style={{ fontWeight: '500', color: theme.colors.primaryText, minWidth: '150px' }}>{chore.instanceLabel || chore.choreId}</span>
                                            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                                                <span style={{ color: theme.colors.mutedText, fontSize: '0.7rem' }}>Trade:</span>
                                                <select value={tradeOvr === null ? '' : tradeOvr ? 'on' : 'off'} disabled={saving}
                                                    onChange={(e) => handleChoreOverride(chore.choreId, 'tradeLogEnabled', e.target.value === '' ? null : e.target.value === 'on')}
                                                    style={{ fontSize: '0.72rem', padding: '2px 4px', background: theme.colors.inputBg, border: `1px solid ${theme.colors.border}`, borderRadius: '4px', color: theme.colors.primaryText, appearance: 'auto' }}
                                                >
                                                    <option value="">Use Master</option>
                                                    <option value="on">ON</option>
                                                    <option value="off">OFF</option>
                                                </select>
                                                <span style={{ color: theme.colors.mutedText, fontSize: '0.7rem', marginLeft: '6px' }}>Portfolio:</span>
                                                <select value={portfolioOvr === null ? '' : portfolioOvr ? 'on' : 'off'} disabled={saving}
                                                    onChange={(e) => handleChoreOverride(chore.choreId, 'portfolioLogEnabled', e.target.value === '' ? null : e.target.value === 'on')}
                                                    style={{ fontSize: '0.72rem', padding: '2px 4px', background: theme.colors.inputBg, border: `1px solid ${theme.colors.border}`, borderRadius: '4px', color: theme.colors.primaryText, appearance: 'auto' }}
                                                >
                                                    <option value="">Use Master</option>
                                                    <option value="on">ON</option>
                                                    <option value="off">OFF</option>
                                                </select>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    )}
                </>
            )}
        </div>
    );
}

// ============================================
// Trading Bot Logs Section (combines trade log, portfolio snapshots, logging settings)
// ============================================
function TradingBotLogs({ canisterId, createBotActorFn, theme, accentColor, identity }) {
    const [activeTab, setActiveTab] = useState('trade');
    const [choreStatuses, setChoreStatuses] = useState([]);
    const agentRef = useRef(null);
    const actorRef = useRef(null);

    const getReadyBotActor = useCallback(async () => {
        if (actorRef.current) return actorRef.current;
        const { HttpAgent } = await import('@dfinity/agent');
        const isLocal = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
        const host = isLocal ? 'http://localhost:4943' : 'https://ic0.app';
        const agent = HttpAgent.createSync({ identity, host });
        if (isLocal) await agent.fetchRootKey();
        agentRef.current = agent;
        const actor = createBotActorFn(canisterId, { agent });
        actorRef.current = actor;
        return actor;
    }, [canisterId, identity, createBotActorFn]);

    // Load chore statuses for the logging settings per-chore overrides
    useEffect(() => {
        (async () => {
            try {
                const bot = await getReadyBotActor();
                if (bot?.getChoreStatuses) {
                    const statuses = await bot.getChoreStatuses();
                    setChoreStatuses(statuses);
                }
            } catch (_) {}
        })();
    }, [getReadyBotActor]);

    const tabStyle = (active) => ({
        padding: '6px 16px', cursor: 'pointer', fontSize: '0.82rem', fontWeight: '500',
        borderBottom: `2px solid ${active ? accentColor : 'transparent'}`,
        color: active ? accentColor : theme.colors.secondaryText,
        background: 'none', border: 'none', borderRadius: 0,
    });

    return (
        <div style={{ marginTop: '16px' }}>
            {/* Tab bar */}
            <div style={{ display: 'flex', gap: '4px', marginBottom: '12px', borderBottom: `1px solid ${theme.colors.border}`, paddingBottom: '0' }}>
                <button onClick={() => setActiveTab('trade')} style={tabStyle(activeTab === 'trade')}>Trade Log</button>
                <button onClick={() => setActiveTab('snapshots')} style={tabStyle(activeTab === 'snapshots')}>Portfolio Snapshots</button>
                <button onClick={() => setActiveTab('settings')} style={tabStyle(activeTab === 'settings')}>Logging Settings</button>
            </div>

            {activeTab === 'trade' && <TradeLogViewer getReadyBotActor={getReadyBotActor} theme={theme} accentColor={accentColor} />}
            {activeTab === 'snapshots' && <PortfolioSnapshotViewer getReadyBotActor={getReadyBotActor} theme={theme} accentColor={accentColor} />}
            {activeTab === 'settings' && <LoggingSettingsPanel getReadyBotActor={getReadyBotActor} theme={theme} accentColor={accentColor} choreStatuses={choreStatuses} />}
        </div>
    );
}

// ============================================
// Custom chore configuration renderer (dispatches to real components)
// ============================================
function renderTradingBotChoreConfig({ chore, config, choreTypeId, instanceId, getReadyBotActor, theme, accentColor, cardStyle, inputStyle, buttonStyle, secondaryButtonStyle }) {
    switch (choreTypeId) {
        case 'trade':
            return (
                <ActionListPanel
                    key={instanceId}
                    instanceId={instanceId}
                    getReadyBotActor={getReadyBotActor}
                    theme={theme}
                    accentColor={accentColor}
                    cardStyle={cardStyle}
                    inputStyle={inputStyle}
                    buttonStyle={buttonStyle}
                    secondaryButtonStyle={secondaryButtonStyle}
                    fetchFn="getTradeActions"
                    addFn="addTradeAction"
                    updateFn="updateTradeAction"
                    removeFn="removeTradeAction"
                    allowedTypes={[ACTION_TYPE_TRADE, ACTION_TYPE_DEPOSIT, ACTION_TYPE_WITHDRAW, ACTION_TYPE_SEND]}
                    title="Trade Actions"
                    description="Configure token swaps, deposits, withdrawals, and sends that execute when this chore fires. Each action can have conditions (balance thresholds, price ranges) and frequency limits."
                />
            );

        case 'rebalance':
            return (
                <RebalancerConfigPanel
                    key={instanceId}
                    instanceId={instanceId}
                    getReadyBotActor={getReadyBotActor}
                    theme={theme}
                    accentColor={accentColor}
                    cardStyle={cardStyle}
                    inputStyle={inputStyle}
                    buttonStyle={buttonStyle}
                    secondaryButtonStyle={secondaryButtonStyle}
                />
            );

        case 'move-funds':
            return (
                <ActionListPanel
                    key={instanceId}
                    instanceId={instanceId}
                    getReadyBotActor={getReadyBotActor}
                    theme={theme}
                    accentColor={accentColor}
                    cardStyle={cardStyle}
                    inputStyle={inputStyle}
                    buttonStyle={buttonStyle}
                    secondaryButtonStyle={secondaryButtonStyle}
                    fetchFn="getMoveFundsActions"
                    addFn="addMoveFundsAction"
                    updateFn="updateMoveFundsAction"
                    removeFn="removeMoveFundsAction"
                    allowedTypes={[ACTION_TYPE_DEPOSIT, ACTION_TYPE_WITHDRAW, ACTION_TYPE_SEND]}
                    title="Move Funds Actions"
                    description="Schedule deposit, withdraw, and send operations between subaccounts and external addresses."
                />
            );

        case 'distribute-funds':
            return (
                <DistributionConfigPanel
                    key={instanceId}
                    instanceId={instanceId}
                    getReadyBotActor={getReadyBotActor}
                    theme={theme}
                    accentColor={accentColor}
                    cardStyle={cardStyle}
                    inputStyle={inputStyle}
                    buttonStyle={buttonStyle}
                    secondaryButtonStyle={secondaryButtonStyle}
                />
            );

        default:
            return null;
    }
}

export default function TradingBot() {
    const { canisterId } = useParams();
    const { theme } = useTheme();
    const { isAuthenticated, identity } = useAuth();

    if (!canisterId) {
        return (
            <div style={{ minHeight: '100vh', background: theme.colors.primaryBg }}>
                <Header />
                <div style={{ maxWidth: 900, margin: '0 auto', padding: '40px 16px', textAlign: 'center' }}>
                    <div style={{ fontSize: '3rem', marginBottom: '16px' }}>📊</div>
                    <h1 style={{ color: theme.colors.primaryText, fontSize: '1.5rem', marginBottom: '8px' }}>
                        Trading Bot
                    </h1>
                    <p style={{ color: theme.colors.secondaryText, fontSize: '0.95rem' }}>
                        No canister ID provided. Navigate to a specific trading bot from your wallet or the Sneedapp page.
                    </p>
                </div>
            </div>
        );
    }

    return (
        <div style={{ minHeight: '100vh', background: theme.colors.primaryBg }}>
            <Header />
            <div style={{ maxWidth: 900, margin: '0 auto', padding: '20px 16px 60px' }}>
                {/* Page header */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '20px' }}>
                    <div style={{
                        width: '44px', height: '44px', borderRadius: '12px',
                        background: `linear-gradient(135deg, ${ACCENT}30, ${ACCENT}10)`,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}>
                        <FaChartLine style={{ color: ACCENT, fontSize: '20px' }} />
                    </div>
                    <div>
                        <h1 style={{ color: theme.colors.primaryText, fontSize: '1.3rem', margin: 0, fontWeight: '700' }}>
                            Sneed Trading Bot
                        </h1>
                        <div style={{ color: theme.colors.secondaryText, fontSize: '0.8rem', fontFamily: 'monospace' }}>
                            {canisterId}
                        </div>
                    </div>
                </div>

                {/* Authentication check */}
                {!isAuthenticated ? (
                    <div style={{
                        background: theme.colors.cardGradient,
                        borderRadius: '12px',
                        border: `1px solid ${theme.colors.border}`,
                        padding: '2rem',
                        textAlign: 'center',
                    }}>
                        <div style={{ fontSize: '2rem', marginBottom: '12px' }}>🔐</div>
                        <h3 style={{ color: theme.colors.primaryText, margin: '0 0 8px 0' }}>Authentication Required</h3>
                        <p style={{ color: theme.colors.secondaryText, fontSize: '0.9rem', margin: 0 }}>
                            Please log in with Internet Identity to manage this trading bot.
                        </p>
                    </div>
                ) : (
                    <>
                        <BotManagementPanel
                            canisterId={canisterId}
                            createBotActor={createBotActor}
                            accentColor={ACCENT}
                            accentColorSecondary={ACCENT_SECONDARY}
                            botName="Trading Bot"
                            botIcon={<FaChartLine style={{ color: ACCENT, fontSize: '16px' }} />}
                            appId={APP_ID}
                            permissionLabels={PERMISSION_LABELS}
                            permissionDescriptions={PERMISSION_DESCRIPTIONS}
                            multiInstanceChoreTypes={MULTI_INSTANCE_CHORE_TYPES}
                            renderChoreConfig={renderTradingBotChoreConfig}
                            identity={identity}
                            isAuthenticated={isAuthenticated}
                        />
                        <TradingBotLogs
                            canisterId={canisterId}
                            createBotActorFn={createBotActor}
                            theme={theme}
                            accentColor={ACCENT}
                            identity={identity}
                        />
                    </>
                )}
            </div>
        </div>
    );
}
