import React, { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { FaTimes, FaRobot, FaExclamationTriangle, FaExclamationCircle, FaCheckDouble } from 'react-icons/fa';
import { useTheme } from '../contexts/ThemeContext';
import { useNaming } from '../NamingContext';
import { useWalletOptional } from '../contexts/WalletContext';
import { PrincipalDisplay } from '../utils/PrincipalUtils';
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
    'sneed-trading-bot': '/trading_bot/CANISTER_ID?tab=log',
    'sneed-icp-staking-bot': '/icp_neuron_manager/CANISTER_ID?tab=log',
    'icp-staking-bot': '/icp_neuron_manager/CANISTER_ID?tab=log',
};

/**
 * Dialog listing bots with unseen log errors/warnings.
 * Supports "Mark as seen" per-bot and for all bots.
 */
export default function BotLogAlertDialog({ isOpen, onClose, botsWithAlerts = [] }) {
    const { theme } = useTheme();
    const navigate = useNavigate();
    const { getPrincipalDisplayName } = useNaming();
    const { identity } = useAuth();
    const walletContext = useWalletOptional();
    const refreshBotLogAlerts = walletContext?.refreshBotLogAlerts;

    const markSeenForBot = useCallback(async (canisterId, highestId) => {
        // Update localStorage
        const key = `lastSeenLogId:${canisterId}`;
        const current = parseInt(localStorage.getItem(key) || '0', 10);
        const newId = Math.max(current, highestId);
        localStorage.setItem(key, String(newId));
        // Fire-and-forget update to backend canister
        try {
            const host = process.env.DFX_NETWORK === 'ic' || process.env.DFX_NETWORK === 'staging'
                ? 'https://ic0.app' : 'http://localhost:4943';
            const { createActor: createBackendActor, canisterId: backendCanisterId } = await import('declarations/app_sneeddao_backend');
            const backendActor = createBackendActor(backendCanisterId, { agentOptions: { identity, host } });
            await backendActor.mark_logs_seen(Principal.fromText(canisterId), BigInt(newId));
        } catch (_) { /* best effort */ }
        // Refresh alerts
        if (refreshBotLogAlerts) refreshBotLogAlerts();
    }, [identity, refreshBotLogAlerts]);

    const markAllSeen = useCallback(async () => {
        for (const bot of botsWithAlerts) {
            const highestId = Math.max(bot.highestErrorId || 0, bot.highestWarningId || 0, (bot.nextId || 1) - 1);
            await markSeenForBot(bot.canisterId, highestId);
        }
    }, [botsWithAlerts, markSeenForBot]);

    const handleBotClick = (canisterId, appId) => {
        onClose();
        const cid = typeof canisterId === 'string' ? canisterId : canisterId.toString();
        const hardcoded = HARDCODED_URLS[appId];
        if (hardcoded) {
            navigate(hardcoded.replace(/CANISTER_ID/g, cid));
            return;
        }
        navigate(`/canister?id=${cid}`);
    };

    if (!isOpen) return null;

    const totalErrors = botsWithAlerts.reduce((s, b) => s + (b.unseenErrorCount || 0), 0);
    const totalWarnings = botsWithAlerts.reduce((s, b) => s + (b.unseenWarningCount || 0), 0);

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
                    maxWidth: '520px', width: '100%', maxHeight: '80vh',
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
                        <FaExclamationTriangle size={16} style={{ color: totalErrors > 0 ? '#ef4444' : '#f59e0b' }} />
                        <span style={{ fontSize: '16px', fontWeight: '700', color: theme.colors.primaryText }}>
                            Bot Log Alerts
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
                    {botsWithAlerts.length === 0 ? (
                        <div style={{ textAlign: 'center', color: theme.colors.mutedText, padding: '20px' }}>
                            No unseen log alerts.
                        </div>
                    ) : (
                        <>
                            <div style={{
                                display: 'flex', alignItems: 'center', gap: '12px',
                                marginBottom: '12px', fontSize: '12px', color: theme.colors.mutedText,
                            }}>
                                <span>
                                    {botsWithAlerts.length} bot{botsWithAlerts.length !== 1 ? 's' : ''} with unseen alerts
                                </span>
                                {totalErrors > 0 && (
                                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', color: '#ef4444', fontWeight: '600' }}>
                                        <FaExclamationCircle size={10} />
                                        {totalErrors} error{totalErrors !== 1 ? 's' : ''}
                                    </span>
                                )}
                                {totalWarnings > 0 && (
                                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', color: '#f59e0b', fontWeight: '600' }}>
                                        <FaExclamationTriangle size={10} />
                                        {totalWarnings} warning{totalWarnings !== 1 ? 's' : ''}
                                    </span>
                                )}
                            </div>

                            {botsWithAlerts.map((bot) => {
                                const hasErrors = (bot.unseenErrorCount || 0) > 0;
                                const color = hasErrors ? '#ef4444' : '#f59e0b';
                                const displayInfo = getPrincipalDisplayName ? getPrincipalDisplayName(bot.canisterId) : null;
                                const appLabel = HARDCODED_LABELS[bot.appId] || 'Bot';
                                const highestId = Math.max(bot.highestErrorId || 0, bot.highestWarningId || 0, (bot.nextId || 1) - 1);

                                return (
                                    <div
                                        key={bot.canisterId}
                                        style={{
                                            display: 'flex', alignItems: 'center', gap: '10px',
                                            padding: '10px 12px', borderRadius: '10px', marginBottom: '6px',
                                            background: hasErrors ? '#ef444410' : '#f59e0b10',
                                            border: `1px solid ${color}30`,
                                            cursor: 'pointer', transition: 'all 0.15s ease',
                                        }}
                                        onClick={() => handleBotClick(bot.canisterId, bot.appId)}
                                        onMouseEnter={(e) => { e.currentTarget.style.transform = 'translateY(-1px)'; e.currentTarget.style.boxShadow = `0 4px 12px ${color}20`; }}
                                        onMouseLeave={(e) => { e.currentTarget.style.transform = 'translateY(0)'; e.currentTarget.style.boxShadow = 'none'; }}
                                    >
                                        <span style={{
                                            display: 'inline-block', width: '10px', height: '10px',
                                            borderRadius: '50%', backgroundColor: color,
                                            boxShadow: `0 0 5px ${color}80`, flexShrink: 0,
                                        }} />
                                        <div style={{ flex: 1, minWidth: 0 }}>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                                <FaRobot size={12} style={{ color, flexShrink: 0 }} />
                                                <PrincipalDisplay
                                                    principal={bot.canisterId}
                                                    displayInfo={displayInfo}
                                                    showCopyButton={false}
                                                    isAuthenticated={true}
                                                    noLink={true}
                                                    style={{ fontSize: '13px', fontWeight: '500', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                                                />
                                            </div>
                                            <div style={{ fontSize: '11px', color: theme.colors.mutedText, marginTop: '2px', display: 'flex', gap: '8px' }}>
                                                <span>{appLabel}</span>
                                                {(bot.unseenErrorCount || 0) > 0 && <span style={{ color: '#ef4444', fontWeight: '500' }}>{bot.unseenErrorCount} error{bot.unseenErrorCount !== 1 ? 's' : ''}</span>}
                                                {(bot.unseenWarningCount || 0) > 0 && <span style={{ color: '#f59e0b', fontWeight: '500' }}>{bot.unseenWarningCount} warning{bot.unseenWarningCount !== 1 ? 's' : ''}</span>}
                                            </div>
                                        </div>
                                        <button
                                            onClick={(e) => { e.stopPropagation(); markSeenForBot(bot.canisterId, highestId); }}
                                            title="Mark as seen"
                                            style={{
                                                background: 'none', border: `1px solid ${theme.colors.border}`,
                                                borderRadius: '6px', padding: '4px 8px', cursor: 'pointer',
                                                color: theme.colors.secondaryText, fontSize: '11px',
                                                display: 'flex', alignItems: 'center', gap: '4px', flexShrink: 0,
                                            }}
                                        >
                                            <FaCheckDouble size={10} /> Seen
                                        </button>
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
                            onClick={markAllSeen}
                            style={{
                                padding: '8px 16px', borderRadius: '8px',
                                border: `1px solid ${theme.colors.border}`,
                                backgroundColor: 'transparent', color: theme.colors.primaryText,
                                fontSize: '13px', cursor: 'pointer', fontWeight: '500',
                                display: 'flex', alignItems: 'center', gap: '6px',
                            }}
                        >
                            <FaCheckDouble size={12} /> Mark all as seen
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
