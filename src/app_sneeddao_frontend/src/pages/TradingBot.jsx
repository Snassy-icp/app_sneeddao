/**
 * TradingBot — Management page for a Sneed Trading Bot canister.
 *
 * Route: /trading_bot/:canisterId
 *
 * Uses the reusable BotManagementPanel for Info, Botkeys, Chores framework, and Log tabs.
 * The per-chore configuration panels are custom to the trading bot.
 */
import React, { useState, useEffect, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import { Principal } from '@dfinity/principal';
import Header from '../components/Header';
import BotManagementPanel from '../components/BotManagementPanel';
import { useTheme } from '../contexts/ThemeContext';
import { useAuth } from '../AuthContext';
// Trading bot Candid declarations — aligned with staking bot API for shared BotManagementPanel.
import { createActor as createBotActor } from 'external/sneed_trading_bot';
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
// REUSABLE: Action List Panel (for Trade and Move Funds chores)
// ============================================
function ActionListPanel({ instanceId, getReadyBotActor, theme, accentColor, cardStyle, inputStyle, buttonStyle, secondaryButtonStyle, fetchFn, addFn, updateFn, removeFn, allowedTypes, title, description }) {
    const [actions, setActions] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [success, setSuccess] = useState('');
    const [saving, setSaving] = useState(false);
    const [adding, setAdding] = useState(false);

    // New action form state
    const [newActionType, setNewActionType] = useState(allowedTypes[0]);
    const [newInputToken, setNewInputToken] = useState('');
    const [newOutputToken, setNewOutputToken] = useState('');
    const [newMinAmount, setNewMinAmount] = useState('0');
    const [newMaxAmount, setNewMaxAmount] = useState('0');
    const [newEnabled, setNewEnabled] = useState(true);

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

    const handleAdd = async () => {
        if (!newInputToken.trim()) { setError('Input token is required.'); return; }
        if (newActionType === ACTION_TYPE_TRADE && !newOutputToken.trim()) { setError('Output token is required for trades.'); return; }
        setSaving(true); setError(''); setSuccess('');
        try {
            const bot = await getReadyBotActor();
            const config = {
                actionType: BigInt(newActionType),
                enabled: newEnabled,
                inputToken: Principal.fromText(newInputToken.trim()),
                outputToken: newActionType === ACTION_TYPE_TRADE && newOutputToken.trim() ? [Principal.fromText(newOutputToken.trim())] : [],
                minAmount: BigInt(newMinAmount || 0),
                maxAmount: BigInt(newMaxAmount || 0),
                preferredDex: [],
                sourceSubaccount: [],
                targetSubaccount: [],
                destinationOwner: [],
                destinationSubaccount: [],
                minBalance: [],
                maxBalance: [],
                balanceDenominationToken: [],
                minPrice: [],
                maxPrice: [],
                priceDenominationToken: [],
                maxPriceImpactBps: [],
                maxSlippageBps: [],
                minFrequencySeconds: [],
                maxFrequencySeconds: [],
                tradeSizeDenominationToken: [],
            };
            await bot[addFn](instanceId, config);
            setSuccess('Action added.');
            setAdding(false);
            setNewInputToken(''); setNewOutputToken(''); setNewMinAmount('0'); setNewMaxAmount('0');
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

                    {actions.map((action) => (
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
                                <div><strong>Input:</strong> {shortPrincipal(action.inputToken)}</div>
                                {action.outputToken?.length > 0 && <div><strong>Output:</strong> {shortPrincipal(action.outputToken[0])}</div>}
                                <div><strong>Min:</strong> {Number(action.minAmount).toLocaleString()}</div>
                                <div><strong>Max:</strong> {Number(action.maxAmount).toLocaleString()}</div>
                                {action.lastExecutedAt?.length > 0 && (
                                    <div><strong>Last run:</strong> {new Date(Number(action.lastExecutedAt[0]) / 1_000_000).toLocaleString()}</div>
                                )}
                            </div>
                        </div>
                    ))}

                    {/* Add Action Form */}
                    {adding ? (
                        <div style={{ padding: '14px', background: `${accentColor}06`, borderRadius: '8px', border: `1px solid ${accentColor}20`, marginTop: '10px' }}>
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '10px' }}>
                                <div>
                                    <label style={{ fontSize: '0.75rem', color: theme.colors.secondaryText, display: 'block', marginBottom: '4px' }}>Type</label>
                                    <select value={newActionType} onChange={(e) => setNewActionType(Number(e.target.value))} style={{ ...inputStyle, width: '100%', appearance: 'auto' }}>
                                        {allowedTypes.map(t => <option key={t} value={t}>{ACTION_TYPE_LABELS[t]}</option>)}
                                    </select>
                                </div>
                                <div>
                                    <label style={{ fontSize: '0.75rem', color: theme.colors.secondaryText, display: 'block', marginBottom: '4px' }}>Input Token (canister ID)</label>
                                    <input value={newInputToken} onChange={(e) => setNewInputToken(e.target.value)} style={{ ...inputStyle, width: '100%' }} placeholder="ryjl3-tyaaa-aaaaa-aaaba-cai" />
                                </div>
                                {newActionType === ACTION_TYPE_TRADE && (
                                    <div>
                                        <label style={{ fontSize: '0.75rem', color: theme.colors.secondaryText, display: 'block', marginBottom: '4px' }}>Output Token (canister ID)</label>
                                        <input value={newOutputToken} onChange={(e) => setNewOutputToken(e.target.value)} style={{ ...inputStyle, width: '100%' }} placeholder="mxzaz-hqaaa-aaaar-qaada-cai" />
                                    </div>
                                )}
                                <div>
                                    <label style={{ fontSize: '0.75rem', color: theme.colors.secondaryText, display: 'block', marginBottom: '4px' }}>Min Amount</label>
                                    <input value={newMinAmount} onChange={(e) => setNewMinAmount(e.target.value)} style={{ ...inputStyle, width: '100%' }} type="text" inputMode="numeric" />
                                </div>
                                <div>
                                    <label style={{ fontSize: '0.75rem', color: theme.colors.secondaryText, display: 'block', marginBottom: '4px' }}>Max Amount</label>
                                    <input value={newMaxAmount} onChange={(e) => setNewMaxAmount(e.target.value)} style={{ ...inputStyle, width: '100%' }} type="text" inputMode="numeric" />
                                </div>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', paddingTop: '20px' }}>
                                    <input type="checkbox" checked={newEnabled} onChange={(e) => setNewEnabled(e.target.checked)} id="new-action-enabled" />
                                    <label htmlFor="new-action-enabled" style={{ fontSize: '0.8rem', color: theme.colors.secondaryText }}>Enabled</label>
                                </div>
                            </div>
                            <div style={{ display: 'flex', gap: '8px', marginTop: '12px' }}>
                                <button onClick={handleAdd} disabled={saving} style={{ ...buttonStyle, background: `linear-gradient(135deg, ${accentColor}, ${accentColor}cc)`, color: '#fff', border: 'none', opacity: saving ? 0.6 : 1 }}>
                                    <FaPlus style={{ marginRight: '4px', fontSize: '0.7rem' }} /> Add Action
                                </button>
                                <button onClick={() => setAdding(false)} style={{ ...secondaryButtonStyle }}>Cancel</button>
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
                                    <div style={{ fontSize: '0.8rem', color: theme.colors.primaryText, fontFamily: 'monospace', wordBreak: 'break-all' }}>{shortPrincipal(settings.denominationToken)}</div>
                                </div>
                                <div style={{ padding: '10px', background: theme.colors.primaryBg, borderRadius: '8px', border: `1px solid ${theme.colors.border}` }}>
                                    <div style={{ fontSize: '0.7rem', color: theme.colors.secondaryText, marginBottom: '4px' }}>Max Trade Size</div>
                                    <div style={{ fontSize: '0.8rem', color: theme.colors.primaryText }}>{Number(settings.maxTradeSize).toLocaleString()}</div>
                                    <div style={{ display: 'flex', gap: '4px', marginTop: '4px' }}>
                                        <input type="text" inputMode="numeric" id={`rebal-max-trade-${instanceId}`} defaultValue={Number(settings.maxTradeSize)} style={{ ...inputStyle, width: '80px', fontSize: '0.7rem' }} />
                                        <button onClick={() => { const v = document.getElementById(`rebal-max-trade-${instanceId}`)?.value; if (v) handleSaveSetting('setRebalanceMaxTradeSize', BigInt(v)); }} disabled={saving} style={{ ...secondaryButtonStyle, fontSize: '0.65rem', padding: '2px 6px' }}>Set</button>
                                    </div>
                                </div>
                                <div style={{ padding: '10px', background: theme.colors.primaryBg, borderRadius: '8px', border: `1px solid ${theme.colors.border}` }}>
                                    <div style={{ fontSize: '0.7rem', color: theme.colors.secondaryText, marginBottom: '4px' }}>Min Trade Size</div>
                                    <div style={{ fontSize: '0.8rem', color: theme.colors.primaryText }}>{Number(settings.minTradeSize).toLocaleString()}</div>
                                    <div style={{ display: 'flex', gap: '4px', marginTop: '4px' }}>
                                        <input type="text" inputMode="numeric" id={`rebal-min-trade-${instanceId}`} defaultValue={Number(settings.minTradeSize)} style={{ ...inputStyle, width: '80px', fontSize: '0.7rem' }} />
                                        <button onClick={() => { const v = document.getElementById(`rebal-min-trade-${instanceId}`)?.value; if (v) handleSaveSetting('setRebalanceMinTradeSize', BigInt(v)); }} disabled={saving} style={{ ...secondaryButtonStyle, fontSize: '0.65rem', padding: '2px 6px' }}>Set</button>
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
                                            <span style={{ fontSize: '0.8rem', color: theme.colors.primaryText, fontFamily: 'monospace' }}>{shortPrincipal(t.token)}</span>
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
                                    <div key={i} style={{ display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '6px' }}>
                                        <input value={t.token} onChange={(e) => { const arr = [...editingTargets]; arr[i] = { ...arr[i], token: e.target.value }; setEditingTargets(arr); }} style={{ ...inputStyle, flex: 1, fontSize: '0.75rem' }} placeholder="Token canister ID" />
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
                                    Total value: <strong style={{ color: theme.colors.primaryText }}>{Number(portfolioStatus.totalValueInDenomination).toLocaleString()}</strong> (denomination units)
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
                                                <td style={{ padding: '6px 10px', color: theme.colors.primaryText }}>{tok.symbol || shortPrincipal(tok.token)}</td>
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
                                <span>Ledger: {shortPrincipal(list.tokenLedgerCanisterId)}</span>
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
                                    <label style={{ fontSize: '0.75rem', color: theme.colors.secondaryText, display: 'block', marginBottom: '4px' }}>Token Ledger (canister ID)</label>
                                    <input value={newLedger} onChange={(e) => setNewLedger(e.target.value)} style={{ ...inputStyle, width: '100%' }} placeholder="ryjl3-tyaaa-aaaaa-aaaba-cai" />
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
                    allowedTypes={[ACTION_TYPE_TRADE]}
                    title="Trade Actions"
                    description="Configure token swaps that execute when this chore fires. Each action can have conditions (balance thresholds, price ranges) and frequency limits."
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
