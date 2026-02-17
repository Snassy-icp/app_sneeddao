import React, { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { FaTimes, FaRobot, FaExclamationTriangle, FaExclamationCircle, FaCheckDouble } from 'react-icons/fa';
import { useTheme } from '../contexts/ThemeContext';
import { useNaming } from '../NamingContext';
import { useWalletOptional } from '../contexts/WalletContext';
import { PrincipalDisplay } from '../utils/PrincipalUtils';
import { LAMP_WARN, LAMP_ERROR, LAMP_COLORS, LAMP_LABELS } from './ChoreStatusLamp';
import { HttpAgent, Actor } from '@dfinity/agent';
import { useAuth } from '../AuthContext';
import { botLogIdlFactory } from '../utils/botLogIdl';

const APP_LABELS = {
    'sneed-trading-bot': 'Trading Bot',
    'icp-staking-bot': 'ICP Staking Bot',
    '': 'Bot',
};

/**
 * Unified dialog for bot health: chore issues + unseen log alerts.
 * Groups both into a single per-bot row where applicable.
 *
 * Props:
 *   isOpen: boolean
 *   onClose: () => void
 *   unhealthyManagers: Array<{ canisterId, lamp, appId? }>
 *   botsWithAlerts: Array<{ canisterId, appId, unseenErrorCount, unseenWarningCount, highestErrorId, highestWarningId, nextId }>
 */
export default function BotHealthDialog({ isOpen, onClose, unhealthyManagers = [], botsWithAlerts = [] }) {
    const { theme } = useTheme();
    const navigate = useNavigate();
    const { getPrincipalDisplayName } = useNaming();
    const { identity } = useAuth();
    const walletContext = useWalletOptional();
    const refreshBotLogAlerts = walletContext?.refreshBotLogAlerts;

    // --- Mark log alerts as seen ---
    const markSeenForBot = useCallback(async (canisterId, highestId) => {
        const key = `lastSeenLogId:${canisterId}`;
        const current = parseInt(localStorage.getItem(key) || '0', 10);
        const newId = Math.max(current, highestId);
        localStorage.setItem(key, String(newId));
        try {
            const host = process.env.DFX_NETWORK === 'ic' || process.env.DFX_NETWORK === 'staging'
                ? 'https://ic0.app' : 'http://localhost:4943';
            const agent = new HttpAgent({ identity, host });
            if (process.env.DFX_NETWORK !== 'ic' && process.env.DFX_NETWORK !== 'staging') {
                await agent.fetchRootKey();
            }
            const actor = Actor.createActor(botLogIdlFactory, { agent, canisterId });
            await actor.markLogsSeen(BigInt(newId));
        } catch (_) {}
        if (refreshBotLogAlerts) refreshBotLogAlerts();
    }, [identity, refreshBotLogAlerts]);

    const markAllLogsSeen = useCallback(async () => {
        for (const bot of botsWithAlerts) {
            const highestId = Math.max(bot.highestErrorId || 0, bot.highestWarningId || 0, (bot.nextId || 1) - 1);
            await markSeenForBot(bot.canisterId, highestId);
        }
    }, [botsWithAlerts, markSeenForBot]);

    // --- Navigation ---
    const navigateToBot = (canisterId, appId, tab) => {
        onClose();
        if (appId === 'sneed-trading-bot') {
            navigate(`/trading_bot/${canisterId}?tab=${tab}`);
        } else {
            navigate(`/icp_neuron_manager/${canisterId}?tab=${tab}`);
        }
    };

    if (!isOpen) return null;

    // --- Merge bots from both sources into a unified per-canister view ---
    const botMap = new Map(); // canisterId -> { choreIssue, logAlert, appId }

    for (const m of unhealthyManagers) {
        const cid = m.canisterId;
        const existing = botMap.get(cid) || { appId: m.appId || '' };
        existing.choreIssue = m;
        botMap.set(cid, existing);
    }
    for (const a of botsWithAlerts) {
        const cid = a.canisterId;
        const existing = botMap.get(cid) || { appId: a.appId || '' };
        existing.logAlert = a;
        if (!existing.appId && a.appId) existing.appId = a.appId;
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
                    maxWidth: '560px', width: '100%', maxHeight: '80vh',
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
                                marginBottom: '12px', fontSize: '12px', color: theme.colors.mutedText,
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

                            {/* Per-bot rows */}
                            {mergedBots.map(({ canisterId, appId, choreIssue, logAlert }) => {
                                const hasChoreError = choreIssue?.lamp === LAMP_ERROR;
                                const hasLogErrors = (logAlert?.unseenErrorCount || 0) > 0;
                                const rowHasError = hasChoreError || hasLogErrors;
                                const rowColor = rowHasError ? '#ef4444' : '#f59e0b';
                                const displayInfo = getPrincipalDisplayName ? getPrincipalDisplayName(canisterId) : null;
                                const botTypeLabel = APP_LABELS[appId] || APP_LABELS[''];

                                const choreLabel = choreIssue
                                    ? (LAMP_LABELS[choreIssue.lamp] || 'Issue')
                                    : null;
                                const choreLampColor = choreIssue
                                    ? (LAMP_COLORS[choreIssue.lamp] || LAMP_COLORS.warn)
                                    : null;

                                const logHighestId = logAlert
                                    ? Math.max(logAlert.highestErrorId || 0, logAlert.highestWarningId || 0, (logAlert.nextId || 1) - 1)
                                    : 0;

                                return (
                                    <div
                                        key={canisterId}
                                        style={{
                                            padding: '10px 12px', borderRadius: '10px', marginBottom: '6px',
                                            background: rowHasError ? '#ef444410' : '#f59e0b10',
                                            border: `1px solid ${rowColor}30`,
                                            transition: 'all 0.15s ease',
                                        }}
                                    >
                                        {/* Top line: bot identity + type */}
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                                            <span style={{
                                                display: 'inline-block', width: '10px', height: '10px',
                                                borderRadius: '50%', backgroundColor: rowColor,
                                                boxShadow: `0 0 5px ${rowColor}80`, flexShrink: 0,
                                            }} />
                                            <div style={{ flex: 1, minWidth: 0 }}>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                                    <FaRobot size={12} style={{ color: rowColor, flexShrink: 0 }} />
                                                    <PrincipalDisplay
                                                        principal={canisterId}
                                                        displayInfo={displayInfo}
                                                        showCopyButton={false}
                                                        isAuthenticated={true}
                                                        noLink={true}
                                                        style={{ fontSize: '13px', fontWeight: '500', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                                                    />
                                                </div>
                                                <div style={{ fontSize: '11px', color: theme.colors.mutedText, marginTop: '2px' }}>
                                                    {botTypeLabel}
                                                </div>
                                            </div>
                                        </div>

                                        {/* Issue lines */}
                                        <div style={{ marginTop: '6px', marginLeft: '20px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                            {/* Chore issue */}
                                            {choreIssue && (
                                                <div
                                                    style={{
                                                        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                                                        padding: '4px 8px', borderRadius: '6px',
                                                        background: `${choreLampColor}10`, cursor: 'pointer',
                                                    }}
                                                    onClick={() => navigateToBot(canisterId, appId, 'chores')}
                                                    onMouseEnter={(e) => { e.currentTarget.style.background = `${choreLampColor}20`; }}
                                                    onMouseLeave={(e) => { e.currentTarget.style.background = `${choreLampColor}10`; }}
                                                >
                                                    <span style={{ fontSize: '11px', color: choreLampColor, fontWeight: '500', display: 'flex', alignItems: 'center', gap: '4px' }}>
                                                        {hasChoreError ? <FaExclamationCircle size={9} /> : <FaExclamationTriangle size={9} />}
                                                        Chore: {choreLabel}
                                                    </span>
                                                    <span style={{ color: theme.colors.mutedText, fontSize: '12px' }}>›</span>
                                                </div>
                                            )}

                                            {/* Log alert */}
                                            {logAlert && (
                                                <div
                                                    style={{
                                                        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                                                        padding: '4px 8px', borderRadius: '6px',
                                                        background: `${rowColor}10`, cursor: 'pointer',
                                                    }}
                                                    onClick={() => navigateToBot(canisterId, appId, 'log')}
                                                    onMouseEnter={(e) => { e.currentTarget.style.background = `${rowColor}20`; }}
                                                    onMouseLeave={(e) => { e.currentTarget.style.background = `${rowColor}10`; }}
                                                >
                                                    <span style={{ fontSize: '11px', color: theme.colors.primaryText, display: 'flex', alignItems: 'center', gap: '6px' }}>
                                                        {hasLogErrors
                                                            ? <><FaExclamationCircle size={9} style={{ color: '#ef4444' }} /><span style={{ color: '#ef4444', fontWeight: '500' }}>{logAlert.unseenErrorCount} error{logAlert.unseenErrorCount !== 1 ? 's' : ''}</span></>
                                                            : null
                                                        }
                                                        {(logAlert.unseenWarningCount || 0) > 0 && (
                                                            <><FaExclamationTriangle size={9} style={{ color: '#f59e0b' }} /><span style={{ color: '#f59e0b', fontWeight: '500' }}>{logAlert.unseenWarningCount} warning{logAlert.unseenWarningCount !== 1 ? 's' : ''}</span></>
                                                        )}
                                                    </span>
                                                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                                        <button
                                                            onClick={(e) => { e.stopPropagation(); markSeenForBot(canisterId, logHighestId); }}
                                                            title="Mark as seen"
                                                            style={{
                                                                background: 'none', border: `1px solid ${theme.colors.border}`,
                                                                borderRadius: '5px', padding: '2px 6px', cursor: 'pointer',
                                                                color: theme.colors.secondaryText, fontSize: '10px',
                                                                display: 'flex', alignItems: 'center', gap: '3px', flexShrink: 0,
                                                            }}
                                                        >
                                                            <FaCheckDouble size={8} /> Seen
                                                        </button>
                                                        <span style={{ color: theme.colors.mutedText, fontSize: '12px' }}>›</span>
                                                    </div>
                                                </div>
                                            )}
                                        </div>
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
