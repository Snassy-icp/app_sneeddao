import React from 'react';
import { useNavigate } from 'react-router-dom';
import { FaTimes, FaRobot, FaExclamationTriangle, FaExclamationCircle } from 'react-icons/fa';
import { useTheme } from '../contexts/ThemeContext';
import { useNaming } from '../NamingContext';
import { PrincipalDisplay } from '../utils/PrincipalUtils';
import { LAMP_WARN, LAMP_ERROR, LAMP_COLORS, LAMP_LABELS } from './ChoreStatusLamp';

/**
 * Dialog listing ICP Staking Bots with unhealthy chore lamps (warn or error).
 * Clicking a bot navigates to its chores tab.
 *
 * Props:
 *   isOpen: boolean
 *   onClose: () => void
 *   unhealthyManagers: Array<{ canisterId: string, lamp: string }>
 */
export default function BotChoreHealthDialog({ isOpen, onClose, unhealthyManagers = [] }) {
    const { theme } = useTheme();
    const navigate = useNavigate();
    const { getPrincipalDisplayName } = useNaming();

    if (!isOpen) return null;

    const errorCount = unhealthyManagers.filter(m => m.lamp === LAMP_ERROR).length;
    const warnCount = unhealthyManagers.filter(m => m.lamp === LAMP_WARN).length;

    const handleBotClick = (canisterId) => {
        onClose();
        navigate(`/icp_neuron_manager/${canisterId}?tab=chores`);
    };

    return (
        <div
            style={{
                position: 'fixed',
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                backgroundColor: 'rgba(0,0,0,0.6)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                zIndex: 10000,
                padding: '20px',
            }}
            onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
        >
            <div
                style={{
                    backgroundColor: theme.colors.primaryBg,
                    borderRadius: '16px',
                    border: `1px solid ${theme.colors.border}`,
                    maxWidth: '520px',
                    width: '100%',
                    maxHeight: '80vh',
                    display: 'flex',
                    flexDirection: 'column',
                    boxShadow: '0 20px 60px rgba(0,0,0,0.3)',
                }}
                onClick={(e) => e.stopPropagation()}
            >
                {/* Header */}
                <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '16px 20px',
                    borderBottom: `1px solid ${theme.colors.border}`,
                }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <FaExclamationTriangle size={16} style={{ color: errorCount > 0 ? LAMP_COLORS.error : LAMP_COLORS.warn }} />
                        <span style={{ fontSize: '16px', fontWeight: '700', color: theme.colors.primaryText }}>
                            Bot Chore Health
                        </span>
                    </div>
                    <button
                        onClick={onClose}
                        style={{
                            background: 'none',
                            border: 'none',
                            cursor: 'pointer',
                            padding: '4px',
                            color: theme.colors.mutedText,
                            display: 'flex',
                        }}
                    >
                        <FaTimes size={16} />
                    </button>
                </div>

                {/* Body */}
                <div style={{ padding: '16px 20px', overflowY: 'auto', flex: 1 }}>
                    {unhealthyManagers.length === 0 ? (
                        <div style={{ textAlign: 'center', color: theme.colors.mutedText, padding: '20px' }}>
                            All bot chores are healthy.
                        </div>
                    ) : (
                        <>
                            <div style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: '12px',
                                marginBottom: '12px',
                                fontSize: '12px',
                                color: theme.colors.mutedText,
                            }}>
                                <span>
                                    {unhealthyManagers.length} bot{unhealthyManagers.length !== 1 ? 's' : ''} need{unhealthyManagers.length === 1 ? 's' : ''} attention
                                </span>
                                {errorCount > 0 && (
                                    <span style={{
                                        display: 'inline-flex',
                                        alignItems: 'center',
                                        gap: '4px',
                                        color: LAMP_COLORS.error,
                                        fontWeight: '600',
                                    }}>
                                        <FaExclamationCircle size={10} />
                                        {errorCount} error{errorCount !== 1 ? 's' : ''}
                                    </span>
                                )}
                                {warnCount > 0 && (
                                    <span style={{
                                        display: 'inline-flex',
                                        alignItems: 'center',
                                        gap: '4px',
                                        color: LAMP_COLORS.warn,
                                        fontWeight: '600',
                                    }}>
                                        <FaExclamationTriangle size={10} />
                                        {warnCount} warning{warnCount !== 1 ? 's' : ''}
                                    </span>
                                )}
                            </div>

                            {unhealthyManagers.map(({ canisterId, lamp }) => {
                                const isError = lamp === LAMP_ERROR;
                                const lampColor = LAMP_COLORS[lamp] || LAMP_COLORS.warn;
                                const lampLabel = LAMP_LABELS[lamp] || 'Unknown';
                                const displayInfo = getPrincipalDisplayName ? getPrincipalDisplayName(canisterId) : null;

                                return (
                                    <div
                                        key={canisterId}
                                        style={{
                                            display: 'flex',
                                            alignItems: 'center',
                                            gap: '10px',
                                            padding: '10px 12px',
                                            borderRadius: '10px',
                                            marginBottom: '6px',
                                            background: isError
                                                ? `${LAMP_COLORS.error}10`
                                                : `${LAMP_COLORS.warn}10`,
                                            border: `1px solid ${lampColor}30`,
                                            cursor: 'pointer',
                                            transition: 'all 0.15s ease',
                                        }}
                                        onClick={() => handleBotClick(canisterId)}
                                        onMouseEnter={(e) => {
                                            e.currentTarget.style.transform = 'translateY(-1px)';
                                            e.currentTarget.style.boxShadow = `0 4px 12px ${lampColor}20`;
                                        }}
                                        onMouseLeave={(e) => {
                                            e.currentTarget.style.transform = 'translateY(0)';
                                            e.currentTarget.style.boxShadow = 'none';
                                        }}
                                    >
                                        {/* Status lamp */}
                                        <span
                                            style={{
                                                display: 'inline-block',
                                                width: '10px',
                                                height: '10px',
                                                borderRadius: '50%',
                                                backgroundColor: lampColor,
                                                boxShadow: `0 0 5px ${lampColor}80`,
                                                flexShrink: 0,
                                            }}
                                        />

                                        {/* Bot info */}
                                        <div style={{ flex: 1, minWidth: 0 }}>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                                <FaRobot size={12} style={{ color: lampColor, flexShrink: 0 }} />
                                                <PrincipalDisplay
                                                    principal={canisterId}
                                                    displayInfo={displayInfo}
                                                    showCopyButton={false}
                                                    isAuthenticated={true}
                                                    noLink={true}
                                                    style={{
                                                        fontSize: '13px',
                                                        fontWeight: '500',
                                                        overflow: 'hidden',
                                                        textOverflow: 'ellipsis',
                                                        whiteSpace: 'nowrap',
                                                    }}
                                                />
                                            </div>
                                            <div style={{
                                                fontSize: '11px',
                                                color: lampColor,
                                                fontWeight: '500',
                                                marginTop: '2px',
                                            }}>
                                                {lampLabel}
                                            </div>
                                        </div>

                                        {/* Arrow indicator */}
                                        <span style={{
                                            color: theme.colors.mutedText,
                                            fontSize: '14px',
                                            flexShrink: 0,
                                        }}>
                                            ›
                                        </span>
                                    </div>
                                );
                            })}
                        </>
                    )}
                </div>

                {/* Footer */}
                <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'flex-end',
                    padding: '12px 20px',
                    borderTop: `1px solid ${theme.colors.border}`,
                }}>
                    <button
                        onClick={onClose}
                        style={{
                            padding: '8px 16px',
                            borderRadius: '8px',
                            border: `1px solid ${theme.colors.border}`,
                            backgroundColor: 'transparent',
                            color: theme.colors.primaryText,
                            fontSize: '13px',
                            cursor: 'pointer',
                            fontWeight: '500',
                        }}
                    >
                        Close
                    </button>
                </div>
            </div>
        </div>
    );
}
