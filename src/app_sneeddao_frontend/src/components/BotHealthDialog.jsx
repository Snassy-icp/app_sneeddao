import React, { useCallback, useEffect, useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { FaTimes, FaRobot, FaExclamationTriangle, FaExclamationCircle, FaCheckDouble, FaSpinner, FaChevronDown, FaChevronRight, FaExternalLinkAlt } from 'react-icons/fa';
import BotIcon from './BotIcon';
import { useTheme } from '../contexts/ThemeContext';
import { useNaming } from '../NamingContext';
import { useWalletOptional } from '../contexts/WalletContext';
import { PrincipalDisplay } from '../utils/PrincipalUtils';
import { LAMP_WARN, LAMP_ERROR, LAMP_COLORS, LAMP_LABELS } from './ChoreStatusLamp';
import { HttpAgent, Actor } from '@dfinity/agent';
import { Principal } from '@dfinity/principal';
import { useAuth } from '../AuthContext';
import { botLogIdlFactory } from '../utils/botLogIdl';

const HARDCODED_LABELS = {
    'sneed-trading-bot': 'Trading Bot',
    'sneed-icp-staking-bot': 'ICP Staking Bot',
    'icp-staking-bot': 'ICP Staking Bot',
};

const HARDCODED_URLS = {
    'sneed-trading-bot': { manage: '/trading_bot/CANISTER_ID', view: '/trading_bot/CANISTER_ID' },
    'sneed-icp-staking-bot': { manage: '/icp_neuron_manager/CANISTER_ID', view: '/icp_neuron_manager/CANISTER_ID' },
    'icp-staking-bot': { manage: '/icp_neuron_manager/CANISTER_ID', view: '/icp_neuron_manager/CANISTER_ID' },
};

const HARDCODED_TAB_PARAMS = {
    'sneed-trading-bot': { chores: '?tab=chores', log: '?tab=log', default: '' },
    'sneed-icp-staking-bot': { chores: '?tab=chores', log: '?tab=log', default: '' },
    'icp-staking-bot': { chores: '?tab=chores', log: '?tab=log', default: '' },
};

const LOG_LEVEL_COLORS = { Error: '#ef4444', Warning: '#f59e0b', Info: '#3b82f6', Debug: '#8b5cf6', Trace: '#6b7280' };

function buildBotUrl(canisterId, appId, tab, appInfoMap) {
    const cid = typeof canisterId === 'string' ? canisterId : canisterId.toString();
    
    const appInfo = appInfoMap?.[appId];
    if (appInfo?.manageUrl?.[0]) {
        let url = appInfo.manageUrl[0].replace(/CANISTER_ID/g, cid);
        const tabParams = HARDCODED_TAB_PARAMS[appId];
        if (tabParams && tab && tabParams[tab]) url += tabParams[tab];
        return url;
    }

    const hardcoded = HARDCODED_URLS[appId];
    if (hardcoded) {
        let url = hardcoded.manage.replace(/CANISTER_ID/g, cid);
        const tabParams = HARDCODED_TAB_PARAMS[appId];
        if (tabParams && tab && tabParams[tab]) url += tabParams[tab];
        return url;
    }

    return `/canister?id=${cid}`;
}

function getBotLabel(appId, appInfoMap) {
    const appInfo = appInfoMap?.[appId];
    if (appInfo?.name) return appInfo.name;
    return HARDCODED_LABELS[appId] || 'Bot';
}

function getBotType(appId) {
    if (appId === 'sneed-icp-staking-bot' || appId === 'icp-staking-bot') return 'staking';
    if (appId === 'sneed-trading-bot') return 'trading';
    return null;
}

/**
 * Unified dialog for bot health: chore issues + unseen log alerts with full log entries.
 */
export default function BotHealthDialog({ isOpen, onClose, unhealthyManagers = [], botsWithAlerts = [] }) {
    const { theme } = useTheme();
    const navigate = useNavigate();
    const { getPrincipalDisplayName } = useNaming();
    const { identity } = useAuth();
    const walletContext = useWalletOptional();
    const refreshBotLogAlerts = walletContext?.refreshBotLogAlerts;
    const appInfoMap = walletContext?.appInfoMap || {};
    const allBotEntries = walletContext?.allBotEntries || [];

    const [botLogEntries, setBotLogEntries] = useState({});
    const [loadingLogs, setLoadingLogs] = useState(false);
    const fetchedRef = useRef(false);
    const [collapsedBots, setCollapsedBots] = useState({});

    const toggleCollapse = useCallback((canisterId) => {
        setCollapsedBots(prev => ({ ...prev, [canisterId]: !prev[canisterId] }));
    }, []);

    // Build a canisterId -> resolvedAppId lookup from allBotEntries as fallback
    const appIdFallback = React.useMemo(() => {
        const map = {};
        for (const entry of allBotEntries) {
            const cid = entry.canisterId.toString();
            if (entry.resolvedAppId) map[cid] = entry.resolvedAppId;
        }
        return map;
    }, [allBotEntries]);

    useEffect(() => {
        if (!isOpen || !identity || botsWithAlerts.length === 0 || fetchedRef.current) return;
        fetchedRef.current = true;
        setLoadingLogs(true);

        (async () => {
            const host = process.env.DFX_NETWORK === 'ic' || process.env.DFX_NETWORK === 'staging'
                ? 'https://ic0.app' : 'http://localhost:4943';
            const agent = new HttpAgent({ identity, host });
            if (process.env.DFX_NETWORK !== 'ic' && process.env.DFX_NETWORK !== 'staging') {
                await agent.fetchRootKey().catch(() => {});
            }
            const results = {};
            await Promise.allSettled(botsWithAlerts.map(async (bot) => {
                try {
                    const cid = bot.canisterId;
                    const lastSeen = parseInt(localStorage.getItem(`lastSeenLogId:${cid}`) || '0', 10);
                    const actor = Actor.createActor(botLogIdlFactory, { agent, canisterId: cid });
                    const res = await actor.getLogs({
                        minLevel: [{ Warning: null }],
                        source: [],
                        caller: [],
                        fromTime: [],
                        toTime: [],
                        startId: lastSeen > 0 ? [BigInt(lastSeen + 1)] : [],
                        limit: [BigInt(50)],
                    });
                    results[cid] = (res.entries || []).filter(e => {
                        const lvl = Object.keys(e.level)[0];
                        return lvl === 'Error' || lvl === 'Warning';
                    });
                } catch (_) {}
            }));
            setBotLogEntries(results);
            setLoadingLogs(false);
        })();
    }, [isOpen, identity, botsWithAlerts]);

    useEffect(() => {
        if (!isOpen) {
            fetchedRef.current = false;
            setBotLogEntries({});
            setCollapsedBots({});
        }
    }, [isOpen]);

    const markSeenForBot = useCallback(async (canisterId, highestId) => {
        const key = `lastSeenLogId:${canisterId}`;
        const current = parseInt(localStorage.getItem(key) || '0', 10);
        const newId = Math.max(current, highestId);
        localStorage.setItem(key, String(newId));
        try {
            const host = process.env.DFX_NETWORK === 'ic' || process.env.DFX_NETWORK === 'staging'
                ? 'https://ic0.app' : 'http://localhost:4943';
            const { createActor: createBackendActor, canisterId: backendCanisterId } = await import('declarations/app_sneeddao_backend');
            const backendActor = createBackendActor(backendCanisterId, { agentOptions: { identity, host } });
            await backendActor.mark_logs_seen(Principal.fromText(canisterId), BigInt(newId));
        } catch (_) {}
        if (refreshBotLogAlerts) refreshBotLogAlerts();
    }, [identity, refreshBotLogAlerts]);

    const markAllLogsSeen = useCallback(async () => {
        for (const bot of botsWithAlerts) {
            const highestId = Math.max(bot.highestErrorId || 0, bot.highestWarningId || 0, (bot.nextId || 1) - 1);
            await markSeenForBot(bot.canisterId, highestId);
        }
    }, [botsWithAlerts, markSeenForBot]);

    const navigateToBot = (canisterId, appId, tab) => {
        onClose();
        navigate(buildBotUrl(canisterId, appId, tab, appInfoMap));
    };

    if (!isOpen) return null;

    // --- Merge bots from both sources, with appId fallback ---
    const botMap = new Map();
    for (const m of unhealthyManagers) {
        const cid = m.canisterId;
        const existing = botMap.get(cid) || { appId: m.appId || appIdFallback[cid] || '' };
        existing.choreIssue = m;
        botMap.set(cid, existing);
    }
    for (const a of botsWithAlerts) {
        const cid = a.canisterId;
        const existing = botMap.get(cid) || { appId: a.appId || appIdFallback[cid] || '' };
        existing.logAlert = a;
        if (!existing.appId) existing.appId = a.appId || appIdFallback[cid] || '';
        botMap.set(cid, existing);
    }
    const mergedBots = [...botMap.entries()].map(([canisterId, data]) => ({ canisterId, ...data }));

    const totalChoreErrors = unhealthyManagers.filter(m => m.lamp === LAMP_ERROR).length;
    const totalChoreWarns = unhealthyManagers.filter(m => m.lamp === LAMP_WARN).length;
    const totalLogErrors = botsWithAlerts.reduce((s, b) => s + (b.unseenErrorCount || 0), 0);
    const totalLogWarnings = botsWithAlerts.reduce((s, b) => s + (b.unseenWarningCount || 0), 0);
    const hasAnyError = totalChoreErrors > 0 || totalLogErrors > 0;
    const headerColor = hasAnyError ? '#ef4444' : '#f59e0b';

    return (
        <div
            style={{
                position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
                backgroundColor: 'rgba(0,0,0,0.6)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                zIndex: 10000, padding: '20px',
            }}
            onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
        >
            <div
                style={{
                    backgroundColor: theme.colors.primaryBg,
                    borderRadius: '16px',
                    border: `1px solid ${theme.colors.border}`,
                    maxWidth: '680px', width: '100%', maxHeight: '85vh',
                    display: 'flex', flexDirection: 'column',
                    boxShadow: '0 20px 60px rgba(0,0,0,0.3)',
                }}
                onClick={(e) => e.stopPropagation()}
            >
                {/* Header */}
                <div style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    padding: '16px 20px', borderBottom: `1px solid ${theme.colors.border}`,
                }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <FaExclamationTriangle size={16} style={{ color: headerColor }} />
                        <span style={{ fontSize: '16px', fontWeight: '700', color: theme.colors.primaryText }}>
                            Bot Health
                        </span>
                    </div>
                    <button onClick={onClose} style={{
                        background: 'none', border: 'none', cursor: 'pointer',
                        padding: '4px', color: theme.colors.mutedText, display: 'flex',
                    }}>
                        <FaTimes size={16} />
                    </button>
                </div>

                {/* Body */}
                <div style={{ padding: '16px 20px', overflowY: 'auto', flex: 1 }}>
                    {mergedBots.length === 0 ? (
                        <div style={{ textAlign: 'center', color: theme.colors.mutedText, padding: '20px' }}>
                            All bots are healthy.
                        </div>
                    ) : (
                        <>
                            {/* Summary line */}
                            <div style={{
                                display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap',
                                marginBottom: '14px', fontSize: '12px', color: theme.colors.mutedText,
                            }}>
                                <span>{mergedBots.length} bot{mergedBots.length !== 1 ? 's' : ''} need{mergedBots.length === 1 ? 's' : ''} attention</span>
                                {totalChoreErrors > 0 && (
                                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '3px', color: LAMP_COLORS.error, fontWeight: '600' }}>
                                        <FaExclamationCircle size={9} /> {totalChoreErrors} chore error{totalChoreErrors !== 1 ? 's' : ''}
                                    </span>
                                )}
                                {totalChoreWarns > 0 && (
                                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '3px', color: LAMP_COLORS.warn, fontWeight: '600' }}>
                                        <FaExclamationTriangle size={9} /> {totalChoreWarns} chore warning{totalChoreWarns !== 1 ? 's' : ''}
                                    </span>
                                )}
                                {totalLogErrors > 0 && (
                                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '3px', color: '#ef4444', fontWeight: '600' }}>
                                        <FaExclamationCircle size={9} /> {totalLogErrors} log error{totalLogErrors !== 1 ? 's' : ''}
                                    </span>
                                )}
                                {totalLogWarnings > 0 && (
                                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '3px', color: '#f59e0b', fontWeight: '600' }}>
                                        <FaExclamationTriangle size={9} /> {totalLogWarnings} log warning{totalLogWarnings !== 1 ? 's' : ''}
                                    </span>
                                )}
                            </div>

                            {/* Per-bot sections */}
                            {mergedBots.map(({ canisterId, appId, choreIssue, logAlert }) => {
                                const hasChoreError = choreIssue?.lamp === LAMP_ERROR;
                                const hasLogErrors = (logAlert?.unseenErrorCount || 0) > 0;
                                const rowHasError = hasChoreError || hasLogErrors;
                                const rowColor = rowHasError ? '#ef4444' : '#f59e0b';
                                const displayInfo = getPrincipalDisplayName ? getPrincipalDisplayName(canisterId) : null;
                                const botTypeLabel = getBotLabel(appId, appInfoMap);
                                const botType = getBotType(appId);
                                const choreLabel = choreIssue ? (LAMP_LABELS[choreIssue.lamp] || 'Issue') : null;
                                const choreLampColor = choreIssue ? (LAMP_COLORS[choreIssue.lamp] || LAMP_COLORS.warn) : null;
                                const logHighestId = logAlert
                                    ? Math.max(logAlert.highestErrorId || 0, logAlert.highestWarningId || 0, (logAlert.nextId || 1) - 1)
                                    : 0;
                                const entries = botLogEntries[canisterId] || [];
                                const isCollapsed = !!collapsedBots[canisterId];

                                return (
                                    <div
                                        key={canisterId}
                                        style={{
                                            borderRadius: '10px', marginBottom: '8px',
                                            background: rowHasError ? '#ef444408' : '#f59e0b08',
                                            border: `1px solid ${rowColor}25`,
                                        }}
                                    >
                                        {/* Bot identity row — clickable to collapse/expand */}
                                        <div
                                            style={{
                                                display: 'flex', alignItems: 'center', gap: '10px',
                                                padding: '12px', cursor: 'pointer', userSelect: 'none',
                                            }}
                                            onClick={() => toggleCollapse(canisterId)}
                                        >
                                            <span style={{ color: theme.colors.mutedText, flexShrink: 0, display: 'flex', alignItems: 'center' }}>
                                                {isCollapsed ? <FaChevronRight size={10} /> : <FaChevronDown size={10} />}
                                            </span>
                                            <span style={{
                                                display: 'inline-block', width: '10px', height: '10px',
                                                borderRadius: '50%', backgroundColor: rowColor,
                                                boxShadow: `0 0 5px ${rowColor}80`, flexShrink: 0,
                                            }} />
                                            <div style={{ flex: 1, minWidth: 0 }}>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                                    {botType ? (
                                                        <BotIcon type={botType} size={12} color={rowColor} />
                                                    ) : (
                                                        <FaRobot size={12} style={{ color: rowColor, flexShrink: 0 }} />
                                                    )}
                                                    <PrincipalDisplay
                                                        principal={canisterId}
                                                        displayInfo={displayInfo}
                                                        showCopyButton={false}
                                                        isAuthenticated={true}
                                                        noLink={true}
                                                        style={{ fontSize: '13px', fontWeight: '500', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                                                    />
                                                    <span style={{ fontSize: '10px', color: theme.colors.mutedText, fontWeight: '400' }}>({botTypeLabel})</span>
                                                </div>
                                            </div>
                                            {/* Actions */}
                                            <div style={{ display: 'flex', gap: '4px', flexShrink: 0 }} onClick={(e) => e.stopPropagation()}>
                                                <button
                                                    onClick={() => navigateToBot(canisterId, appId, 'log')}
                                                    title="View bot log"
                                                    style={{
                                                        background: 'none', border: `1px solid ${theme.colors.border}`,
                                                        borderRadius: '5px', padding: '2px 8px', cursor: 'pointer',
                                                        color: theme.colors.secondaryText, fontSize: '10px',
                                                        display: 'flex', alignItems: 'center', gap: '3px',
                                                    }}
                                                >
                                                    <FaExternalLinkAlt size={7} /> Log
                                                </button>
                                                {logAlert && (
                                                    <button
                                                        onClick={() => markSeenForBot(canisterId, logHighestId)}
                                                        title="Mark log alerts as seen"
                                                        style={{
                                                            background: 'none', border: `1px solid ${theme.colors.border}`,
                                                            borderRadius: '5px', padding: '2px 8px', cursor: 'pointer',
                                                            color: theme.colors.secondaryText, fontSize: '10px',
                                                            display: 'flex', alignItems: 'center', gap: '3px',
                                                        }}
                                                    >
                                                        <FaCheckDouble size={8} /> Seen
                                                    </button>
                                                )}
                                            </div>
                                        </div>

                                        {/* Collapsible content */}
                                        {!isCollapsed && (
                                            <div style={{ padding: '0 12px 12px' }}>
                                                {/* Chore issue */}
                                                {choreIssue && (
                                                    <div
                                                        style={{
                                                            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                                                            padding: '6px 10px', borderRadius: '6px', marginBottom: '4px',
                                                            background: `${choreLampColor}12`, cursor: 'pointer',
                                                            border: `1px solid ${choreLampColor}15`,
                                                        }}
                                                        onClick={() => navigateToBot(canisterId, appId, 'chores')}
                                                        onMouseEnter={(e) => { e.currentTarget.style.background = `${choreLampColor}22`; }}
                                                        onMouseLeave={(e) => { e.currentTarget.style.background = `${choreLampColor}12`; }}
                                                    >
                                                        <span style={{ fontSize: '11px', color: choreLampColor, fontWeight: '600', display: 'flex', alignItems: 'center', gap: '5px' }}>
                                                            {hasChoreError ? <FaExclamationCircle size={9} /> : <FaExclamationTriangle size={9} />}
                                                            Chore: {choreLabel}
                                                        </span>
                                                        <span style={{ color: theme.colors.mutedText, fontSize: '11px' }}>View chores ›</span>
                                                    </div>
                                                )}

                                                {/* Log entries */}
                                                {logAlert && (
                                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
                                                        {loadingLogs && entries.length === 0 && (
                                                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '8px 10px', fontSize: '11px', color: theme.colors.mutedText }}>
                                                                <FaSpinner size={10} className="fa-spin" style={{ animation: 'spin 1s linear infinite' }} />
                                                                Loading log entries...
                                                            </div>
                                                        )}
                                                        {entries.slice().reverse().map(entry => {
                                                            const levelKey = Object.keys(entry.level)[0];
                                                            const levelColor = LOG_LEVEL_COLORS[levelKey] || '#6b7280';
                                                            const ts = new Date(Number(entry.timestamp) / 1_000_000);
                                                            const timeStr = ts.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' });

                                                            const tagPills = entry.tags
                                                                .filter(([k]) => k !== 'source' && k !== 'level')
                                                                .map(([k, v], i) => (
                                                                    <span key={i} style={{
                                                                        padding: '1px 5px', borderRadius: '3px', fontSize: '0.65rem',
                                                                        background: `${theme.colors.border}60`, color: theme.colors.secondaryText,
                                                                        wordBreak: 'break-word', overflowWrap: 'anywhere',
                                                                        maxWidth: '100%',
                                                                    }}>
                                                                        <span style={{ opacity: 0.6 }}>{k}:</span> {v}
                                                                    </span>
                                                                ));

                                                            return (
                                                                <div
                                                                    key={Number(entry.id)}
                                                                    style={{
                                                                        padding: '6px 10px', borderRadius: '6px',
                                                                        borderLeft: `3px solid ${levelColor}`,
                                                                        background: `${levelColor}08`,
                                                                        cursor: 'pointer',
                                                                    }}
                                                                    onClick={() => navigateToBot(canisterId, appId, 'log')}
                                                                    onMouseEnter={(e) => { e.currentTarget.style.background = `${levelColor}14`; }}
                                                                    onMouseLeave={(e) => { e.currentTarget.style.background = `${levelColor}08`; }}
                                                                >
                                                                    {/* Entry header line */}
                                                                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                                                                        <span style={{
                                                                            padding: '0px 5px', borderRadius: '3px', fontSize: '0.65rem',
                                                                            fontWeight: '700', background: `${levelColor}22`, color: levelColor,
                                                                            minWidth: '38px', textAlign: 'center',
                                                                        }}>
                                                                            {levelKey.toUpperCase()}
                                                                        </span>
                                                                        <span style={{
                                                                            padding: '0px 5px', borderRadius: '3px', fontSize: '0.65rem',
                                                                            background: `${theme.colors.border}40`, color: theme.colors.secondaryText,
                                                                        }}>
                                                                            {entry.source}
                                                                        </span>
                                                                        <span style={{ fontSize: '0.75rem', color: theme.colors.primaryText, flex: 1, lineHeight: '1.3', wordBreak: 'break-word', overflowWrap: 'anywhere', minWidth: 0 }}>
                                                                            {entry.message}
                                                                        </span>
                                                                        <span style={{ fontSize: '0.6rem', color: theme.colors.mutedText, whiteSpace: 'nowrap', flexShrink: 0 }}>
                                                                            {timeStr}
                                                                        </span>
                                                                        <span style={{ fontSize: '0.55rem', color: theme.colors.mutedText, opacity: 0.5 }}>
                                                                            #{Number(entry.id)}
                                                                        </span>
                                                                    </div>
                                                                    {/* Tags */}
                                                                    {tagPills.length > 0 && (
                                                                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '3px', marginTop: '3px', marginLeft: '44px' }}>
                                                                            {tagPills}
                                                                        </div>
                                                                    )}
                                                                </div>
                                                            );
                                                        })}
                                                        {!loadingLogs && entries.length === 0 && (logAlert.unseenErrorCount > 0 || logAlert.unseenWarningCount > 0) && (
                                                            <div
                                                                style={{
                                                                    padding: '6px 10px', borderRadius: '6px', fontSize: '11px',
                                                                    color: theme.colors.mutedText, cursor: 'pointer',
                                                                    background: `${rowColor}08`,
                                                                }}
                                                                onClick={() => navigateToBot(canisterId, appId, 'log')}
                                                            >
                                                                {(logAlert.unseenErrorCount || 0) > 0 && <span style={{ color: '#ef4444', fontWeight: '500' }}>{logAlert.unseenErrorCount} unseen error{logAlert.unseenErrorCount !== 1 ? 's' : ''} </span>}
                                                                {(logAlert.unseenWarningCount || 0) > 0 && <span style={{ color: '#f59e0b', fontWeight: '500' }}>{logAlert.unseenWarningCount} unseen warning{logAlert.unseenWarningCount !== 1 ? 's' : ''} </span>}
                                                                — <span style={{ textDecoration: 'underline' }}>view in log</span>
                                                            </div>
                                                        )}
                                                    </div>
                                                )}
                                            </div>
                                        )}
                                    </div>
                                );
                            })}
                        </>
                    )}
                </div>

                {/* Footer */}
                <div style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    padding: '12px 20px', borderTop: `1px solid ${theme.colors.border}`,
                }}>
                    {botsWithAlerts.length > 0 && (
                        <button
                            onClick={markAllLogsSeen}
                            style={{
                                padding: '8px 16px', borderRadius: '8px',
                                border: `1px solid ${theme.colors.border}`,
                                backgroundColor: 'transparent', color: theme.colors.primaryText,
                                fontSize: '13px', cursor: 'pointer', fontWeight: '500',
                                display: 'flex', alignItems: 'center', gap: '6px',
                            }}
                        >
                            <FaCheckDouble size={12} /> Mark all logs seen
                        </button>
                    )}
                    <button
                        onClick={onClose}
                        style={{
                            padding: '8px 16px', borderRadius: '8px',
                            border: `1px solid ${theme.colors.border}`,
                            backgroundColor: 'transparent', color: theme.colors.primaryText,
                            fontSize: '13px', cursor: 'pointer', fontWeight: '500', marginLeft: 'auto',
                        }}
                    >
                        Close
                    </button>
                </div>
            </div>
        </div>
    );
}
