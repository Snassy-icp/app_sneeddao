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
    const [adding, setAdding] = useState(false);
    const [showConditions, setShowConditions] = useState(false);

    // New action form state
    const [newActionType, setNewActionType] = useState(allowedTypes[0]);
    const [newInputToken, setNewInputToken] = useState('');
    const [newOutputToken, setNewOutputToken] = useState('');
    const [newMinAmount, setNewMinAmount] = useState('');
    const [newMaxAmount, setNewMaxAmount] = useState('');
    const [newEnabled, setNewEnabled] = useState(true);
    // Condition fields
    const [newMinBalance, setNewMinBalance] = useState('');
    const [newMaxBalance, setNewMaxBalance] = useState('');
    const [newMinPrice, setNewMinPrice] = useState('');
    const [newMaxPrice, setNewMaxPrice] = useState('');
    const [newMaxPriceImpactBps, setNewMaxPriceImpactBps] = useState('');
    const [newMaxSlippageBps, setNewMaxSlippageBps] = useState('');
    // Destination fields (for Send/Withdraw/Deposit)
    const [newDestOwner, setNewDestOwner] = useState('');

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
        // Also include the currently selected input token for decimal info
        if (newInputToken) ids.add(newInputToken);
        return [...ids];
    }, [actions, newInputToken]);
    const tokenMeta = useTokenMetadata(actionTokenIds, identity);

    const getSymbol = (principal) => {
        const key = typeof principal === 'string' ? principal : principal?.toText?.() || String(principal);
        return tokenMeta[key]?.symbol || shortPrincipal(key);
    };
    const getDecimals = (principal) => {
        const key = typeof principal === 'string' ? principal : principal?.toText?.() || String(principal);
        return tokenMeta[key]?.decimals ?? 8;
    };

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

    const resetForm = () => {
        setNewInputToken(''); setNewOutputToken(''); setNewMinAmount(''); setNewMaxAmount('');
        setNewMinBalance(''); setNewMaxBalance(''); setNewMinPrice(''); setNewMaxPrice('');
        setNewMaxPriceImpactBps(''); setNewMaxSlippageBps(''); setNewDestOwner('');
        setShowConditions(false); setNewEnabled(true);
    };

    const handleAdd = async () => {
        if (!newInputToken) { setError('Input token is required.'); return; }
        if (newActionType === ACTION_TYPE_TRADE && !newOutputToken) { setError('Output token is required for trades.'); return; }
        setSaving(true); setError(''); setSuccess('');
        try {
            const bot = await getReadyBotActor();
            const inputDecimals = getDecimals(newInputToken);
            const config = {
                actionType: BigInt(newActionType),
                enabled: newEnabled,
                inputToken: Principal.fromText(newInputToken),
                outputToken: newActionType === ACTION_TYPE_TRADE && newOutputToken ? [Principal.fromText(newOutputToken)] : [],
                minAmount: newMinAmount ? BigInt(parseTokenAmount(newMinAmount, inputDecimals)) : BigInt(0),
                maxAmount: newMaxAmount ? BigInt(parseTokenAmount(newMaxAmount, inputDecimals)) : BigInt(0),
                preferredDex: [],
                sourceSubaccount: [],
                targetSubaccount: [],
                destinationOwner: newDestOwner.trim() ? [Principal.fromText(newDestOwner.trim())] : [],
                destinationSubaccount: [],
                minBalance: newMinBalance ? [BigInt(parseTokenAmount(newMinBalance, inputDecimals))] : [],
                maxBalance: newMaxBalance ? [BigInt(parseTokenAmount(newMaxBalance, inputDecimals))] : [],
                balanceDenominationToken: [],
                minPrice: newMinPrice ? [BigInt(newMinPrice)] : [],
                maxPrice: newMaxPrice ? [BigInt(newMaxPrice)] : [],
                priceDenominationToken: [],
                maxPriceImpactBps: newMaxPriceImpactBps ? [BigInt(newMaxPriceImpactBps)] : [],
                maxSlippageBps: newMaxSlippageBps ? [BigInt(newMaxSlippageBps)] : [],
                minFrequencySeconds: [],
                maxFrequencySeconds: [],
                tradeSizeDenominationToken: [],
            };
            await bot[addFn](instanceId, config);
            setSuccess('Action added.');
            setAdding(false);
            resetForm();
            await loadActions();
        } catch (err) { setError('Failed to add action: ' + err.message); }
        finally { setSaving(false); }
    };

    const handleRemove = async (actionId) => {
        setSaving(true); setError(''); setSuccess('');
        try {
            const bot = await getReadyBotActor();
            await bot[removeFn](instanceId, BigInt(actionId));
            setSuccess('Action removed.');
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

    // Helper to format an opt value (Candid optional = array of 0 or 1)
    const optVal = (arr) => arr?.length > 0 ? arr[0] : null;

    const labelStyle = { fontSize: '0.75rem', color: theme.colors.secondaryText, display: 'block', marginBottom: '4px' };

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
                    {actions.length === 0 && !adding && (
                        <div style={{ textAlign: 'center', padding: '16px', color: theme.colors.mutedText, fontSize: '0.85rem', background: theme.colors.primaryBg, borderRadius: '8px', border: `1px solid ${theme.colors.border}` }}>
                            No actions configured yet.
                        </div>
                    )}

                    {actions.map((action) => {
                        const inputSym = getSymbol(action.inputToken);
                        const inputDec = getDecimals(action.inputToken);
                        return (
                            <div key={Number(action.id)} style={{
                                padding: '12px', marginBottom: '8px',
                                background: theme.colors.primaryBg, borderRadius: '8px',
                                border: `1px solid ${action.enabled ? accentColor + '30' : theme.colors.border}`,
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
                                        <button onClick={() => handleToggle(action)} disabled={saving}
                                            style={{ ...secondaryButtonStyle, fontSize: '0.7rem', padding: '3px 8px' }}
                                        >{action.enabled ? 'Disable' : 'Enable'}</button>
                                        <button onClick={() => handleRemove(Number(action.id))} disabled={saving}
                                            style={{ ...secondaryButtonStyle, fontSize: '0.7rem', padding: '3px 8px', color: '#ef4444', borderColor: '#ef444440' }}
                                        ><FaTrash style={{ fontSize: '0.6rem' }} /></button>
                                    </div>
                                </div>
                                <div style={{ marginTop: '8px', display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '6px', fontSize: '0.75rem', color: theme.colors.secondaryText }}>
                                    <div><strong>Input:</strong> {inputSym}</div>
                                    {action.outputToken?.length > 0 && <div><strong>Output:</strong> {getSymbol(action.outputToken[0])}</div>}
                                    <div><strong>Min:</strong> {formatTokenAmount(action.minAmount, inputDec)} {inputSym}</div>
                                    <div><strong>Max:</strong> {formatTokenAmount(action.maxAmount, inputDec)} {inputSym}</div>
                                    {optVal(action.destinationOwner) && <div><strong>Dest:</strong> {shortPrincipal(optVal(action.destinationOwner))}</div>}
                                    {optVal(action.minBalance) != null && <div><strong>Min Bal:</strong> {formatTokenAmount(optVal(action.minBalance), inputDec)} {inputSym}</div>}
                                    {optVal(action.maxBalance) != null && <div><strong>Max Bal:</strong> {formatTokenAmount(optVal(action.maxBalance), inputDec)} {inputSym}</div>}
                                    {optVal(action.minPrice) != null && <div><strong>Min Price:</strong> {Number(optVal(action.minPrice)).toLocaleString()}</div>}
                                    {optVal(action.maxPrice) != null && <div><strong>Max Price:</strong> {Number(optVal(action.maxPrice)).toLocaleString()}</div>}
                                    {optVal(action.maxPriceImpactBps) != null && <div><strong>Max Impact:</strong> {Number(optVal(action.maxPriceImpactBps))} bps</div>}
                                    {optVal(action.maxSlippageBps) != null && <div><strong>Max Slippage:</strong> {Number(optVal(action.maxSlippageBps))} bps</div>}
                                    {action.lastExecutedAt?.length > 0 && (
                                        <div><strong>Last run:</strong> {new Date(Number(action.lastExecutedAt[0]) / 1_000_000).toLocaleString()}</div>
                                    )}
                                </div>
                            </div>
                        );
                    })}

                    {/* Add Action Form */}
                    {adding ? (
                        <div style={{ padding: '14px', background: `${accentColor}06`, borderRadius: '8px', border: `1px solid ${accentColor}20`, marginTop: '10px' }}>
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '10px' }}>
                                <div>
                                    <label style={labelStyle}>Type</label>
                                    <select value={newActionType} onChange={(e) => setNewActionType(Number(e.target.value))} style={{ ...inputStyle, width: '100%', appearance: 'auto' }}>
                                        {allowedTypes.map(t => <option key={t} value={t}>{ACTION_TYPE_LABELS[t]}</option>)}
                                    </select>
                                </div>
                                <div>
                                    <label style={labelStyle}>Input Token</label>
                                    <TokenSelector
                                        value={newInputToken}
                                        onChange={setNewInputToken}
                                        onSelectToken={cacheTokenMeta}
                                        allowCustom={true}
                                        placeholder="Select input token..."
                                    />
                                </div>
                                {newActionType === ACTION_TYPE_TRADE && (
                                    <div>
                                        <label style={labelStyle}>Output Token</label>
                                        <TokenSelector
                                            value={newOutputToken}
                                            onChange={setNewOutputToken}
                                            onSelectToken={cacheTokenMeta}
                                            allowCustom={true}
                                            placeholder="Select output token..."
                                        />
                                    </div>
                                )}
                                <div>
                                    <label style={labelStyle}>Min Amount{newInputToken && tokenMeta[newInputToken] ? ` (${tokenMeta[newInputToken].symbol})` : ''}</label>
                                    <input value={newMinAmount} onChange={(e) => setNewMinAmount(e.target.value)} style={{ ...inputStyle, width: '100%' }} type="text" inputMode="decimal" placeholder="0.0" />
                                </div>
                                <div>
                                    <label style={labelStyle}>Max Amount{newInputToken && tokenMeta[newInputToken] ? ` (${tokenMeta[newInputToken].symbol})` : ''}</label>
                                    <input value={newMaxAmount} onChange={(e) => setNewMaxAmount(e.target.value)} style={{ ...inputStyle, width: '100%' }} type="text" inputMode="decimal" placeholder="0.0" />
                                </div>
                                {/* Destination owner for Send/Withdraw/Deposit */}
                                {(newActionType === ACTION_TYPE_SEND || newActionType === ACTION_TYPE_WITHDRAW || newActionType === ACTION_TYPE_DEPOSIT) && (
                                    <div>
                                        <label style={labelStyle}>Destination Owner (principal)</label>
                                        <input value={newDestOwner} onChange={(e) => setNewDestOwner(e.target.value)} style={{ ...inputStyle, width: '100%' }} placeholder="Principal ID" />
                                    </div>
                                )}
                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', paddingTop: '20px' }}>
                                    <input type="checkbox" checked={newEnabled} onChange={(e) => setNewEnabled(e.target.checked)} id={`new-action-enabled-${instanceId}`} />
                                    <label htmlFor={`new-action-enabled-${instanceId}`} style={{ fontSize: '0.8rem', color: theme.colors.secondaryText }}>Enabled</label>
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
                                            <label style={labelStyle}>Min Input Balance{newInputToken && tokenMeta[newInputToken] ? ` (${tokenMeta[newInputToken].symbol})` : ''}</label>
                                            <input value={newMinBalance} onChange={(e) => setNewMinBalance(e.target.value)} style={{ ...inputStyle, width: '100%' }} type="text" inputMode="decimal" placeholder="Only run if balance ≥" />
                                        </div>
                                        <div>
                                            <label style={labelStyle}>Max Input Balance{newInputToken && tokenMeta[newInputToken] ? ` (${tokenMeta[newInputToken].symbol})` : ''}</label>
                                            <input value={newMaxBalance} onChange={(e) => setNewMaxBalance(e.target.value)} style={{ ...inputStyle, width: '100%' }} type="text" inputMode="decimal" placeholder="Only run if balance ≤" />
                                        </div>
                                        <div>
                                            <label style={labelStyle}>Min Price (raw)</label>
                                            <input value={newMinPrice} onChange={(e) => setNewMinPrice(e.target.value)} style={{ ...inputStyle, width: '100%' }} type="text" inputMode="numeric" placeholder="Skip if price below" />
                                        </div>
                                        <div>
                                            <label style={labelStyle}>Max Price (raw)</label>
                                            <input value={newMaxPrice} onChange={(e) => setNewMaxPrice(e.target.value)} style={{ ...inputStyle, width: '100%' }} type="text" inputMode="numeric" placeholder="Skip if price above" />
                                        </div>
                                        <div>
                                            <label style={labelStyle}>Max Price Impact (bps)</label>
                                            <input value={newMaxPriceImpactBps} onChange={(e) => setNewMaxPriceImpactBps(e.target.value)} style={{ ...inputStyle, width: '100%' }} type="text" inputMode="numeric" placeholder="e.g. 100 = 1%" />
                                        </div>
                                        <div>
                                            <label style={labelStyle}>Max Slippage (bps)</label>
                                            <input value={newMaxSlippageBps} onChange={(e) => setNewMaxSlippageBps(e.target.value)} style={{ ...inputStyle, width: '100%' }} type="text" inputMode="numeric" placeholder="e.g. 50 = 0.5%" />
                                        </div>
                                    </div>
                                )}
                            </div>

                            <div style={{ display: 'flex', gap: '8px', marginTop: '12px' }}>
                                <button onClick={handleAdd} disabled={saving} style={{ ...buttonStyle, background: `linear-gradient(135deg, ${accentColor}, ${accentColor}cc)`, color: '#fff', border: 'none', opacity: saving ? 0.6 : 1 }}>
                                    <FaPlus style={{ marginRight: '4px', fontSize: '0.7rem' }} /> Add Action
                                </button>
                                <button onClick={() => { setAdding(false); resetForm(); }} style={{ ...secondaryButtonStyle }}>Cancel</button>
                            </div>
                        </div>
                    ) : (
                        <button onClick={() => { setAdding(true); setError(''); setSuccess(''); }} style={{ ...secondaryButtonStyle, marginTop: '10px', display: 'flex', alignItems: 'center', gap: '6px' }}>
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
                )}
            </div>
        </div>
    );
}
