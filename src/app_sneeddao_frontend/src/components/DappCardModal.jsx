import React, { useEffect, useState, useRef } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { FaTimes, FaSync, FaBrain, FaBox, FaCrown, FaExternalLinkAlt, FaTrash, FaCoins, FaMicrochip, FaChevronDown, FaChevronRight, FaLock, FaHourglassHalf, FaCheck, FaQuestionCircle, FaSeedling, FaPaperPlane, FaArrowRight, FaChartLine } from 'react-icons/fa';
import { useTheme } from '../contexts/ThemeContext';
import { useNaming } from '../NamingContext';
import StatusLamp, {
    LAMP_COLORS,
    getSchedulerLampState, getConductorLampState, getTaskLampState,
    getChoreSummaryLamp, getAllChoresSummaryLamp, getSummaryLabel
} from './ChoreStatusLamp';

const CHORE_NAMES = {
    confirm_following: 'Confirm Following',
    auto_refresh_stake: 'Auto-Refresh Stake',
    collect_maturity: 'Collect Maturity',
    distribution: 'Distribution',
};

/**
 * Modal wrapper for displaying a Dapp card (Canister or Neuron Manager)
 * Used in the PrincipalBox compact wallet and Wallet page to show full dapp details
 */
const DappCardModal = ({ 
    show, 
    onClose, 
    canisterId,
    // Canister status info
    cycles = null,
    memory = null,
    isController = false,
    // Neuron manager specific info (if detected as neuron manager)
    isNeuronManager = false,
    isTradingBot = false,
    appId = '',
    neuronManagerVersion = null,
    neuronCount = 0,
    // Neurons data for neuron managers
    neuronsData = null, // { loading, neurons, error }
    // Chore data for neuron managers
    choreStatuses = [], // Array of chore status objects
    onChoreAction = null, // (canisterId, choreId, action) => Promise
    // Optional handlers
    handleRefresh,
    handleRemove,
    handleSend, // Opens the transfer/send modal
    isRefreshing = false,
    isRemoving = false,
}) => {
    const { theme } = useTheme();
    const { getPrincipalDisplayName } = useNaming();
    const navigate = useNavigate();
    
    // State for expanded neurons
    const [expandedNeurons, setExpandedNeurons] = useState({});
    const [showNeuronsList, setShowNeuronsList] = useState(true);
    const [activeTab, setActiveTab] = useState('info');
    const [choreActionLoading, setChoreActionLoading] = useState({});

    // Reset tab when modal closes
    useEffect(() => {
        if (!show) setActiveTab('info');
    }, [show]);

    // Handle chore actions
    const handleChoreActionLocal = async (choreId, action) => {
        if (!onChoreAction) return;
        const key = `${canisterId}_${choreId}`;
        setChoreActionLoading(prev => ({ ...prev, [key]: true }));
        try {
            await onChoreAction(canisterId, choreId, action);
        } finally {
            setChoreActionLoading(prev => ({ ...prev, [key]: false }));
        }
    };

    // Format next run time
    const formatNextRun = (chore) => {
        if (!chore.scheduler || !chore.scheduler.nextRunTime || chore.scheduler.nextRunTime.length === 0) return null;
        const nextNs = Number(chore.scheduler.nextRunTime[0]);
        if (nextNs === 0) return null;
        const nextMs = nextNs / 1_000_000;
        const now = Date.now();
        const diff = nextMs - now;
        if (diff < 0) return 'overdue';
        if (diff < 60000) return `in ${Math.round(diff / 1000)}s`;
        if (diff < 3600000) return `in ${Math.round(diff / 60000)}m`;
        if (diff < 86400000) return `in ${(diff / 3600000).toFixed(1)}h`;
        return `in ${(diff / 86400000).toFixed(1)}d`;
    };

    // Get display name for canister
    const displayInfo = getPrincipalDisplayName(canisterId);
    const displayName = displayInfo?.name || `${canisterId?.slice(0, 10)}...${canisterId?.slice(-5)}`;

    // Handle escape key to close
    useEffect(() => {
        const handleEscape = (e) => {
            if (e.key === 'Escape' && show) {
                onClose();
            }
        };
        
        if (show) {
            document.addEventListener('keydown', handleEscape);
            document.body.style.overflow = 'hidden';
        }
        
        return () => {
            document.removeEventListener('keydown', handleEscape);
            document.body.style.overflow = '';
        };
    }, [show, onClose]);

    // Auto-refresh if cycles/memory are missing when modal opens
    const hasTriggeredAutoRefresh = useRef(false);
    const lastHandleRefresh = useRef(null);
    
    useEffect(() => {
        // Reset if handleRefresh function changed (e.g., identity became available)
        if (handleRefresh !== lastHandleRefresh.current) {
            hasTriggeredAutoRefresh.current = false;
            lastHandleRefresh.current = handleRefresh;
        }
        
        if (show && canisterId && handleRefresh && !isRefreshing) {
            // Only auto-refresh once per modal open if data is missing
            if ((cycles === null || memory === null) && !hasTriggeredAutoRefresh.current) {
                console.log('[DappCardModal] Auto-refreshing for canister:', canisterId, { cycles, memory });
                hasTriggeredAutoRefresh.current = true;
                handleRefresh(canisterId);
            }
        }
        // Reset the auto-refresh flag when modal closes
        if (!show) {
            hasTriggeredAutoRefresh.current = false;
        }
    }, [show, canisterId, cycles, memory, handleRefresh, isRefreshing]);

    // Format cycles compactly
    const formatCyclesCompact = (c) => {
        if (c === null || c === undefined) return null;
        if (c >= 1e12) return `${(c / 1e12).toFixed(1)}T`;
        if (c >= 1e9) return `${(c / 1e9).toFixed(1)}B`;
        if (c >= 1e6) return `${(c / 1e6).toFixed(1)}M`;
        return c.toLocaleString();
    };

    // Format memory compactly
    const formatMemoryCompact = (bytes) => {
        if (bytes === null || bytes === undefined) return null;
        if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(2)} GB`;
        if (bytes >= 1e6) return `${(bytes / 1e6).toFixed(1)} MB`;
        if (bytes >= 1e3) return `${(bytes / 1e3).toFixed(0)} KB`;
        return `${bytes} B`;
    };

    // Get cycles color based on amount
    const getCyclesColor = (c) => {
        if (c === null || c === undefined) return theme.colors.mutedText;
        if (c < 500_000_000_000) return '#ef4444'; // Red - critical
        if (c < 1_000_000_000_000) return '#f59e0b'; // Orange - warning
        return '#10b981'; // Green - healthy
    };

    // Format duration (for dissolve delay, age)
    const formatDuration = (seconds) => {
        if (!seconds || seconds === 0) return '0d';
        const days = Math.floor(seconds / 86400);
        const years = Math.floor(days / 365);
        const months = Math.floor((days % 365) / 30);
        const remainingDays = days % 30;
        
        if (years > 0) return `${years}y ${months}m`;
        if (months > 0) return `${months}m ${remainingDays}d`;
        return `${days}d`;
    };

    if (!show || !canisterId) return null;

    const accentColor = isNeuronManager ? '#8b5cf6' : isTradingBot ? '#10b981' : theme.colors.accent;
    const neurons = neuronsData?.neurons || [];
    const neuronsLoading = neuronsData?.loading;
    const neuronsError = neuronsData?.error;

    // Calculate totals from neurons
    let totalStake = 0;
    let totalMaturity = 0;
    neurons.forEach(neuron => {
        if (neuron.info) totalStake += Number(neuron.info.stake_e8s || 0) / 1e8;
        if (neuron.full) {
            totalMaturity += Number(neuron.full.maturity_e8s_equivalent || 0) / 1e8;
            if (neuron.full.staked_maturity_e8s_equivalent?.[0]) {
                totalMaturity += Number(neuron.full.staked_maturity_e8s_equivalent[0]) / 1e8;
            }
        }
    });

    return (
        <div 
            onClick={(e) => {
                if (e.target === e.currentTarget) onClose();
            }}
            style={{
                position: 'fixed',
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                backgroundColor: 'rgba(0, 0, 0, 0.7)',
                backdropFilter: 'blur(4px)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                zIndex: 10000,
                padding: '16px',
                animation: 'fadeIn 0.2s ease'
            }}
        >
            <div 
                onClick={(e) => e.stopPropagation()}
                style={{
                    position: 'relative',
                    width: '100%',
                    maxWidth: '500px',
                    maxHeight: '90vh',
                    overflowY: 'auto',
                    backgroundColor: theme.colors.primaryBg,
                    borderRadius: '16px',
                    border: `1px solid ${theme.colors.border}`,
                    boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)',
                    animation: 'slideUp 0.3s ease'
                }}
            >
                {/* Header */}
                <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '16px 20px',
                    borderBottom: `1px solid ${theme.colors.border}`,
                    position: 'sticky',
                    top: 0,
                    backgroundColor: theme.colors.primaryBg,
                    zIndex: 1,
                }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                        {/* Icon */}
                        <div style={{
                            width: '48px',
                            height: '48px',
                            borderRadius: '50%',
                            backgroundColor: `${accentColor}20`,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            position: 'relative',
                            flexShrink: 0,
                        }}>
                            {isTradingBot ? (
                                <FaChartLine size={22} style={{ color: accentColor }} />
                            ) : isNeuronManager ? (
                                <FaBrain size={24} style={{ color: accentColor }} />
                            ) : (
                                <FaBox size={20} style={{ color: theme.colors.mutedText }} />
                            )}
                            {isController && (
                                <FaCrown 
                                    size={12} 
                                    style={{ 
                                        position: 'absolute',
                                        top: '-2px',
                                        right: '-2px',
                                        color: '#f59e0b'
                                    }} 
                                    title="You are a controller"
                                />
                            )}
                        </div>
                        <div>
                            <div style={{
                                color: theme.colors.primaryText,
                                fontWeight: '600',
                                fontSize: '16px',
                            }}>
                                {displayName}
                            </div>
                            <div style={{
                                color: accentColor,
                                fontSize: '12px',
                                fontWeight: '500',
                            }}>
                                {isTradingBot ? 'Trading Bot' : isNeuronManager ? 'ICP Staking Bot' : 'App'}
                            </div>
                        </div>
                    </div>
                    
                    {/* Close & Refresh buttons */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        {handleRefresh && (
                            <button
                                onClick={() => handleRefresh(canisterId)}
                                disabled={isRefreshing}
                                style={{
                                    background: 'none',
                                    border: 'none',
                                    cursor: isRefreshing ? 'default' : 'pointer',
                                    padding: '8px',
                                    display: 'flex',
                                    alignItems: 'center',
                                    color: theme.colors.mutedText,
                                    opacity: isRefreshing ? 0.6 : 1,
                                    transition: 'color 0.2s ease',
                                }}
                                title="Refresh"
                            >
                                <FaSync size={14} style={{ animation: isRefreshing ? 'spin 1s linear infinite' : 'none' }} />
                            </button>
                        )}
                        <button
                            onClick={onClose}
                            style={{
                                background: 'none',
                                border: 'none',
                                cursor: 'pointer',
                                padding: '8px',
                                display: 'flex',
                                alignItems: 'center',
                                color: theme.colors.mutedText,
                                transition: 'color 0.2s ease',
                            }}
                        >
                            <FaTimes size={18} />
                        </button>
                    </div>
                </div>

                {/* Content */}
                <div style={{ padding: '20px' }}>
                    {/* Tabs - only show if we have chore data */}
                    {isNeuronManager && choreStatuses.length > 0 && (
                        <div style={{
                            display: 'flex',
                            borderBottom: `1px solid ${theme.colors.border}`,
                            marginBottom: '16px',
                            gap: '0',
                        }}>
                            {[
                                { id: 'info', label: 'Info' },
                                { id: 'chores', label: 'Chores', lamp: getAllChoresSummaryLamp(choreStatuses) },
                            ].map(tab => (
                                <button
                                    key={tab.id}
                                    onClick={() => setActiveTab(tab.id)}
                                    style={{
                                        background: 'none',
                                        border: 'none',
                                        borderBottom: activeTab === tab.id ? `2px solid ${accentColor}` : '2px solid transparent',
                                        color: activeTab === tab.id ? accentColor : theme.colors.mutedText,
                                        padding: '8px 16px',
                                        fontSize: '13px',
                                        fontWeight: activeTab === tab.id ? '600' : '400',
                                        cursor: 'pointer',
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: '6px',
                                        transition: 'all 0.15s ease',
                                    }}
                                >
                                    {tab.lamp !== undefined && <StatusLamp state={tab.lamp} size={8} />}
                                    {tab.label}
                                </button>
                            ))}
                        </div>
                    )}

                    {/* Chores Tab Content */}
                    {activeTab === 'chores' && choreStatuses.length > 0 && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                            {choreStatuses.map((chore, idx) => {
                                const choreId = chore.choreId || `chore_${idx}`;
                                const choreName = CHORE_NAMES[choreId] || choreId;
                                const summaryLamp = getChoreSummaryLamp(chore);
                                const loadingKey = `${canisterId}_${choreId}`;
                                const isLoading = choreActionLoading[loadingKey];
                                const isRunning = chore.conductor && chore.conductor.status && 
                                    (Object.keys(chore.conductor.status)[0] === 'running' || Object.keys(chore.conductor.status)[0] === 'waiting');
                                const isPaused = chore.config && chore.config.paused;
                                const isEnabled = chore.config && chore.config.enabled;
                                const nextRun = formatNextRun(chore);

                                return (
                                    <div key={choreId} style={{
                                        padding: '12px 14px',
                                        borderRadius: '10px',
                                        backgroundColor: theme.colors.secondaryBg,
                                        border: `1px solid ${theme.colors.border}`,
                                    }}>
                                        {/* Chore header */}
                                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', marginBottom: '10px' }}>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                                <StatusLamp state={summaryLamp} size={10} />
                                                <span style={{ fontWeight: '600', fontSize: '14px', color: theme.colors.primaryText }}>{choreName}</span>
                                            </div>
                                            {nextRun && (
                                                <span style={{ 
                                                    fontSize: '11px', 
                                                    color: nextRun === 'overdue' ? '#ef4444' : theme.colors.mutedText,
                                                    fontWeight: nextRun === 'overdue' ? '600' : '400',
                                                }}>
                                                    Next: {nextRun}
                                                </span>
                                            )}
                                        </div>

                                        {/* Lamp row */}
                                        <div style={{ display: 'flex', gap: '14px', marginBottom: '10px', flexWrap: 'wrap' }}>
                                            {[
                                                { label: 'Scheduler', state: getSchedulerLampState(chore) },
                                                { label: 'Conductor', state: getConductorLampState(chore) },
                                                { label: 'Task', state: getTaskLampState(chore) },
                                            ].map(lamp => (
                                                <div key={lamp.label} style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                                                    <StatusLamp state={lamp.state} size={8} />
                                                    <span style={{ fontSize: '11px', color: theme.colors.mutedText }}>{lamp.label}</span>
                                                </div>
                                            ))}
                                        </div>

                                        {/* Action buttons */}
                                        {onChoreAction && (
                                            <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                                                {!isEnabled ? (
                                                    <button
                                                        onClick={() => handleChoreActionLocal(choreId, 'start')}
                                                        disabled={isLoading}
                                                        style={{
                                                            padding: '5px 12px', borderRadius: '5px', border: 'none',
                                                            backgroundColor: '#22c55e', color: '#fff', fontSize: '11px',
                                                            fontWeight: '600', cursor: isLoading ? 'not-allowed' : 'pointer',
                                                            opacity: isLoading ? 0.6 : 1,
                                                        }}
                                                    >
                                                        {isLoading ? '...' : '▶ Start'}
                                                    </button>
                                                ) : (
                                                    <>
                                                        {isPaused ? (
                                                            <button
                                                                onClick={() => handleChoreActionLocal(choreId, 'resume')}
                                                                disabled={isLoading}
                                                                style={{
                                                                    padding: '5px 12px', borderRadius: '5px', border: 'none',
                                                                    backgroundColor: '#3b82f6', color: '#fff', fontSize: '11px',
                                                                    fontWeight: '600', cursor: isLoading ? 'not-allowed' : 'pointer',
                                                                    opacity: isLoading ? 0.6 : 1,
                                                                }}
                                                            >
                                                                {isLoading ? '...' : '▶ Resume'}
                                                            </button>
                                                        ) : (
                                                            <button
                                                                onClick={() => handleChoreActionLocal(choreId, 'pause')}
                                                                disabled={isLoading}
                                                                style={{
                                                                    padding: '5px 12px', borderRadius: '5px', border: 'none',
                                                                    backgroundColor: '#f59e0b', color: '#fff', fontSize: '11px',
                                                                    fontWeight: '600', cursor: isLoading ? 'not-allowed' : 'pointer',
                                                                    opacity: isLoading ? 0.6 : 1,
                                                                }}
                                                            >
                                                                {isLoading ? '...' : '⏸ Pause'}
                                                            </button>
                                                        )}
                                                        <button
                                                            onClick={() => handleChoreActionLocal(choreId, 'stop')}
                                                            disabled={isLoading}
                                                            style={{
                                                                padding: '5px 12px', borderRadius: '5px', border: 'none',
                                                                backgroundColor: '#ef4444', color: '#fff', fontSize: '11px',
                                                                fontWeight: '600', cursor: isLoading ? 'not-allowed' : 'pointer',
                                                                opacity: isLoading ? 0.6 : 1,
                                                            }}
                                                        >
                                                            {isLoading ? '...' : '⏹ Stop'}
                                                        </button>
                                                        {!isPaused && (
                                                            <button
                                                                onClick={() => handleChoreActionLocal(choreId, 'trigger')}
                                                                disabled={isLoading || isRunning}
                                                                style={{
                                                                    padding: '5px 12px', borderRadius: '5px',
                                                                    border: `1px solid ${theme.colors.border}`,
                                                                    backgroundColor: 'transparent', color: theme.colors.primaryText, fontSize: '11px',
                                                                    fontWeight: '600', cursor: (isLoading || isRunning) ? 'not-allowed' : 'pointer',
                                                                    opacity: (isLoading || isRunning) ? 0.6 : 1,
                                                                }}
                                                            >
                                                                {isLoading ? '...' : '⚡ Run Now'}
                                                            </button>
                                                        )}
                                                    </>
                                                )}
                                            </div>
                                        )}
                                    </div>
                                );
                            })}

                            {/* Link to full chore management */}
                            <Link
                                to={`/icp_neuron_manager/${canisterId}?tab=chores`}
                                onClick={() => onClose()}
                                style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    gap: '6px',
                                    padding: '10px',
                                    color: accentColor,
                                    fontSize: '13px',
                                    fontWeight: '600',
                                    textDecoration: 'none',
                                    borderRadius: '8px',
                                    border: `1px solid ${accentColor}20`,
                                    transition: 'all 0.15s ease',
                                }}
                            >
                                Full Chore Management <FaArrowRight size={10} />
                            </Link>
                        </div>
                    )}

                    {/* Info Tab Content */}
                    {activeTab === 'info' && (
                    <>
                    {/* Canister ID */}
                    <div style={{
                        backgroundColor: theme.colors.secondaryBg,
                        borderRadius: '10px',
                        padding: '12px 16px',
                        marginBottom: '16px',
                    }}>
                        <div style={{
                            color: theme.colors.mutedText,
                            fontSize: '11px',
                            textTransform: 'uppercase',
                            letterSpacing: '0.5px',
                            marginBottom: '4px',
                        }}>
                            Canister ID
                        </div>
                        <div style={{
                            color: theme.colors.primaryText,
                            fontSize: '13px',
                            fontFamily: 'monospace',
                            wordBreak: 'break-all',
                        }}>
                            {canisterId}
                        </div>
                    </div>

                    {/* Stats Grid */}
                    <div style={{
                        display: 'grid',
                        gridTemplateColumns: 'repeat(2, 1fr)',
                        gap: '12px',
                        marginBottom: '16px',
                    }}>
                        {/* Neuron Manager specific: Version */}
                        {isNeuronManager && neuronManagerVersion && (
                            <div style={{
                                backgroundColor: theme.colors.secondaryBg,
                                borderRadius: '10px',
                                padding: '12px',
                                textAlign: 'center',
                            }}>
                                <div style={{
                                    color: theme.colors.mutedText,
                                    fontSize: '10px',
                                    textTransform: 'uppercase',
                                    marginBottom: '4px',
                                }}>
                                    Version
                                </div>
                                <div style={{
                                    color: accentColor,
                                    fontSize: '14px',
                                    fontWeight: '600',
                                }}>
                                    v{Number(neuronManagerVersion.major)}.{Number(neuronManagerVersion.minor)}.{Number(neuronManagerVersion.patch)}
                                </div>
                            </div>
                        )}
                        
                        {/* Neurons count */}
                        {isNeuronManager && (
                            <div style={{
                                backgroundColor: theme.colors.secondaryBg,
                                borderRadius: '10px',
                                padding: '12px',
                                textAlign: 'center',
                            }}>
                                <div style={{
                                    color: theme.colors.mutedText,
                                    fontSize: '10px',
                                    textTransform: 'uppercase',
                                    marginBottom: '4px',
                                }}>
                                    Neurons
                                </div>
                                <div style={{
                                    color: neuronCount > 0 ? accentColor : theme.colors.mutedText,
                                    fontSize: '14px',
                                    fontWeight: '600',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    gap: '4px',
                                }}>
                                    <FaBrain size={12} /> {neuronCount}
                                </div>
                            </div>
                        )}

                        {/* Cycles */}
                        <div style={{
                            backgroundColor: theme.colors.secondaryBg,
                            borderRadius: '10px',
                            padding: '12px',
                            textAlign: 'center',
                        }}>
                            <div style={{
                                color: theme.colors.mutedText,
                                fontSize: '10px',
                                textTransform: 'uppercase',
                                marginBottom: '4px',
                            }}>
                                Cycles
                            </div>
                            <div style={{
                                color: cycles !== null ? getCyclesColor(cycles) : theme.colors.mutedText,
                                fontSize: '14px',
                                fontWeight: '600',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                gap: '4px',
                            }}>
                                <FaCoins size={12} />
                                {cycles !== null ? formatCyclesCompact(cycles) : 'N/A'}
                            </div>
                        </div>

                        {/* Memory */}
                        <div style={{
                            backgroundColor: theme.colors.secondaryBg,
                            borderRadius: '10px',
                            padding: '12px',
                            textAlign: 'center',
                        }}>
                            <div style={{
                                color: theme.colors.mutedText,
                                fontSize: '10px',
                                textTransform: 'uppercase',
                                marginBottom: '4px',
                            }}>
                                Memory
                            </div>
                            <div style={{
                                color: theme.colors.primaryText,
                                fontSize: '14px',
                                fontWeight: '600',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                gap: '4px',
                            }}>
                                <FaMicrochip size={12} />
                                {memory !== null ? formatMemoryCompact(memory) : 'N/A'}
                            </div>
                        </div>
                    </div>

                    {/* ICP Totals for neuron managers */}
                    {isNeuronManager && neurons.length > 0 && (
                        <div style={{
                            display: 'grid',
                            gridTemplateColumns: 'repeat(2, 1fr)',
                            gap: '12px',
                            marginBottom: '16px',
                        }}>
                            <div style={{
                                backgroundColor: theme.colors.secondaryBg,
                                borderRadius: '10px',
                                padding: '12px',
                                textAlign: 'center',
                            }}>
                                <div style={{
                                    color: theme.colors.mutedText,
                                    fontSize: '10px',
                                    textTransform: 'uppercase',
                                    marginBottom: '4px',
                                }}>
                                    Staked ICP
                                </div>
                                <div style={{
                                    color: theme.colors.primaryText,
                                    fontSize: '14px',
                                    fontWeight: '600',
                                }}>
                                    {totalStake.toFixed(4)} ICP
                                </div>
                            </div>
                            <div style={{
                                backgroundColor: theme.colors.secondaryBg,
                                borderRadius: '10px',
                                padding: '12px',
                                textAlign: 'center',
                            }}>
                                <div style={{
                                    color: theme.colors.mutedText,
                                    fontSize: '10px',
                                    textTransform: 'uppercase',
                                    marginBottom: '4px',
                                }}>
                                    Maturity
                                </div>
                                <div style={{
                                    color: totalMaturity > 0 ? '#10b981' : theme.colors.mutedText,
                                    fontSize: '14px',
                                    fontWeight: '600',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    gap: '4px',
                                }}>
                                    <FaSeedling size={12} /> {totalMaturity.toFixed(4)} ICP
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Neurons List for neuron managers */}
                    {isNeuronManager && neuronsData && (
                        <div style={{
                            marginBottom: '16px',
                        }}>
                            <div 
                                onClick={() => setShowNeuronsList(!showNeuronsList)}
                                style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '8px',
                                    cursor: 'pointer',
                                    padding: '8px 0',
                                    color: theme.colors.primaryText,
                                    fontWeight: '500',
                                    fontSize: '14px',
                                }}
                            >
                                {showNeuronsList ? <FaChevronDown size={12} /> : <FaChevronRight size={12} />}
                                <FaBrain size={14} style={{ color: accentColor }} />
                                Neurons ({neurons.length})
                            </div>
                            
                            {showNeuronsList && (
                                <div style={{
                                    backgroundColor: theme.colors.secondaryBg,
                                    borderRadius: '10px',
                                    padding: '8px',
                                    maxHeight: '300px',
                                    overflowY: 'auto',
                                }}>
                                    {neuronsLoading ? (
                                        <div style={{ 
                                            textAlign: 'center', 
                                            padding: '20px',
                                            color: theme.colors.mutedText,
                                            fontSize: '13px',
                                        }}>
                                            Loading neurons...
                                        </div>
                                    ) : neuronsError ? (
                                        <div style={{ 
                                            textAlign: 'center', 
                                            padding: '20px',
                                            color: theme.colors.warning || '#f59e0b',
                                            fontSize: '13px',
                                        }}>
                                            Unable to load neurons
                                        </div>
                                    ) : neurons.length === 0 ? (
                                        <div style={{ 
                                            textAlign: 'center', 
                                            padding: '20px',
                                            color: theme.colors.mutedText,
                                            fontSize: '13px',
                                        }}>
                                            No neurons found
                                        </div>
                                    ) : (
                                        neurons.map((neuron, index) => {
                                            const stake = neuron.info ? Number(neuron.info.stake_e8s || 0) / 1e8 : 0;
                                            const maturity = neuron.full ? Number(neuron.full.maturity_e8s_equivalent || 0) / 1e8 : 0;
                                            const stakedMaturity = neuron.full?.staked_maturity_e8s_equivalent?.[0] 
                                                ? Number(neuron.full.staked_maturity_e8s_equivalent[0]) / 1e8 
                                                : 0;
                                            const stateNum = neuron.info?.state;
                                            const stateLabel = stateNum === 1 ? 'Locked' 
                                                : stateNum === 2 ? 'Dissolving' 
                                                : stateNum === 3 ? 'Dissolved' 
                                                : 'Unknown';
                                            const stateColor = stateNum === 1 ? '#22c55e'
                                                : stateNum === 2 ? '#f59e0b'
                                                : stateNum === 3 ? '#3b82f6'
                                                : theme.colors.mutedText;
                                            const stateIcon = stateNum === 1 ? <FaLock size={10} /> 
                                                : stateNum === 2 ? <FaHourglassHalf size={10} /> 
                                                : stateNum === 3 ? <FaCheck size={10} /> 
                                                : <FaQuestionCircle size={10} />;
                                            const neuronIdStr = neuron.id?.id?.toString() || neuron.id?.toString() || `neuron-${index}`;
                                            const isExpanded = expandedNeurons[neuronIdStr];
                                            const dissolveDelay = neuron.info?.dissolve_delay_seconds ? Number(neuron.info.dissolve_delay_seconds) : 0;
                                            const age = neuron.info?.age_seconds ? Number(neuron.info.age_seconds) : 0;

                                            return (
                                                <div 
                                                    key={neuronIdStr}
                                                    style={{
                                                        backgroundColor: theme.colors.primaryBg,
                                                        borderRadius: '8px',
                                                        marginBottom: index < neurons.length - 1 ? '8px' : 0,
                                                        overflow: 'hidden',
                                                    }}
                                                >
                                                    <div 
                                                        onClick={() => setExpandedNeurons(prev => ({ ...prev, [neuronIdStr]: !prev[neuronIdStr] }))}
                                                        style={{
                                                            display: 'flex',
                                                            alignItems: 'center',
                                                            justifyContent: 'space-between',
                                                            padding: '10px 12px',
                                                            cursor: 'pointer',
                                                        }}
                                                    >
                                                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                                            {isExpanded ? <FaChevronDown size={10} /> : <FaChevronRight size={10} />}
                                                            <span style={{ color: stateColor, display: 'flex', alignItems: 'center' }}>
                                                                {stateIcon}
                                                            </span>
                                                            <span style={{ 
                                                                color: theme.colors.primaryText, 
                                                                fontSize: '13px',
                                                                fontFamily: 'monospace',
                                                            }}>
                                                                {neuronIdStr.length > 16 ? `${neuronIdStr.slice(0, 8)}...${neuronIdStr.slice(-6)}` : neuronIdStr}
                                                            </span>
                                                        </div>
                                                        <span style={{ 
                                                            color: theme.colors.primaryText, 
                                                            fontSize: '13px',
                                                            fontWeight: '500',
                                                        }}>
                                                            {stake.toFixed(4)} ICP
                                                        </span>
                                                    </div>
                                                    
                                                    {isExpanded && (
                                                        <div style={{
                                                            padding: '0 12px 12px 12px',
                                                            display: 'grid',
                                                            gridTemplateColumns: 'repeat(2, 1fr)',
                                                            gap: '8px',
                                                            fontSize: '12px',
                                                        }}>
                                                            <div>
                                                                <span style={{ color: theme.colors.mutedText }}>State: </span>
                                                                <span style={{ color: stateColor }}>{stateLabel}</span>
                                                            </div>
                                                            <div>
                                                                <span style={{ color: theme.colors.mutedText }}>Dissolve: </span>
                                                                <span style={{ color: theme.colors.primaryText }}>{formatDuration(dissolveDelay)}</span>
                                                            </div>
                                                            <div>
                                                                <span style={{ color: theme.colors.mutedText }}>Maturity: </span>
                                                                <span style={{ color: maturity > 0 ? '#10b981' : theme.colors.mutedText }}>{maturity.toFixed(4)}</span>
                                                            </div>
                                                            <div>
                                                                <span style={{ color: theme.colors.mutedText }}>Age: </span>
                                                                <span style={{ color: theme.colors.primaryText }}>{formatDuration(age)}</span>
                                                            </div>
                                                            {stakedMaturity > 0 && (
                                                                <div style={{ gridColumn: 'span 2' }}>
                                                                    <span style={{ color: theme.colors.mutedText }}>Staked Maturity: </span>
                                                                    <span style={{ color: '#10b981' }}>{stakedMaturity.toFixed(4)}</span>
                                                                </div>
                                                            )}
                                                        </div>
                                                    )}
                                                </div>
                                            );
                                        })
                                    )}
                                </div>
                            )}
                        </div>
                    )}

                    {/* Controller Status */}
                    <div style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px',
                        marginBottom: '20px',
                        padding: '10px 14px',
                        backgroundColor: isController ? '#f59e0b15' : theme.colors.secondaryBg,
                        borderRadius: '8px',
                        border: isController ? '1px solid #f59e0b30' : `1px solid ${theme.colors.border}`,
                    }}>
                        <FaCrown size={14} style={{ color: isController ? '#f59e0b' : theme.colors.mutedText }} />
                        <span style={{
                            color: isController ? '#f59e0b' : theme.colors.mutedText,
                            fontSize: '13px',
                            fontWeight: '500',
                        }}>
                            {isController ? 'You are a controller' : 'Not a controller'}
                        </span>
                    </div>

                    {/* Action Buttons */}
                    <div style={{
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '10px',
                    }}>
                        {/* Send button - for controllers */}
                        {isController && handleSend && (
                            <button
                                onClick={() => {
                                    handleSend(canisterId);
                                    onClose();
                                }}
                                style={{
                                    width: '100%',
                                    padding: '12px 16px',
                                    backgroundColor: theme.colors.accent,
                                    color: '#fff',
                                    border: 'none',
                                    borderRadius: '10px',
                                    fontSize: '14px',
                                    fontWeight: '600',
                                    cursor: 'pointer',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    gap: '8px',
                                    transition: 'all 0.2s ease',
                                }}
                            >
                                <FaPaperPlane size={12} />
                                Send
                            </button>
                        )}

                        {/* Primary action: Manage Neurons (for neuron managers) */}
                        {isNeuronManager && (
                            <button
                                onClick={() => {
                                    onClose();
                                    navigate(`/icp_neuron_manager/${canisterId}`);
                                }}
                                style={{
                                    width: '100%',
                                    padding: '12px 16px',
                                    backgroundColor: accentColor,
                                    color: '#fff',
                                    border: 'none',
                                    borderRadius: '10px',
                                    fontSize: '14px',
                                    fontWeight: '600',
                                    cursor: 'pointer',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    gap: '8px',
                                    transition: 'all 0.2s ease',
                                }}
                            >
                                <FaBrain size={14} />
                                Manage Neurons
                            </button>
                        )}

                        {/* Primary action: Manage Trading Bot */}
                        {isTradingBot && (
                            <button
                                onClick={() => {
                                    onClose();
                                    navigate(`/trading_bot/${canisterId}`);
                                }}
                                style={{
                                    width: '100%',
                                    padding: '12px 16px',
                                    backgroundColor: accentColor,
                                    color: '#fff',
                                    border: 'none',
                                    borderRadius: '10px',
                                    fontSize: '14px',
                                    fontWeight: '600',
                                    cursor: 'pointer',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    gap: '8px',
                                    transition: 'all 0.2s ease',
                                }}
                            >
                                <FaChartLine size={14} />
                                Manage Trading Bot
                            </button>
                        )}

                        {/* View Details */}
                        <button
                            onClick={() => {
                                onClose();
                                navigate(`/canister?id=${canisterId}`);
                            }}
                            style={{
                                width: '100%',
                                padding: '12px 16px',
                                backgroundColor: isNeuronManager ? theme.colors.secondaryBg : theme.colors.accent,
                                color: isNeuronManager ? theme.colors.primaryText : '#fff',
                                border: isNeuronManager ? `1px solid ${theme.colors.border}` : 'none',
                                borderRadius: '10px',
                                fontSize: '14px',
                                fontWeight: '600',
                                cursor: 'pointer',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                gap: '8px',
                                transition: 'all 0.2s ease',
                            }}
                        >
                            <FaExternalLinkAlt size={12} />
                            View Details
                        </button>

                        {/* Remove - only show if handler provided */}
                        {handleRemove && (
                            <button
                                onClick={() => {
                                    handleRemove(canisterId);
                                    onClose();
                                }}
                                disabled={isRemoving}
                                style={{
                                    width: '100%',
                                    padding: '12px 16px',
                                    backgroundColor: 'transparent',
                                    color: '#ef4444',
                                    border: '1px solid #ef444430',
                                    borderRadius: '10px',
                                    fontSize: '14px',
                                    fontWeight: '500',
                                    cursor: isRemoving ? 'not-allowed' : 'pointer',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    gap: '8px',
                                    opacity: isRemoving ? 0.6 : 1,
                                    transition: 'all 0.2s ease',
                                }}
                            >
                                <FaTrash size={12} />
                                {isRemoving ? 'Removing...' : 'Remove from Wallet'}
                            </button>
                        )}
                    </div>
                    </>
                    )}
                </div>
            </div>

            <style>{`
                @keyframes fadeIn {
                    from { opacity: 0; }
                    to { opacity: 1; }
                }
                @keyframes slideUp {
                    from { 
                        opacity: 0;
                        transform: translateY(20px);
                    }
                    to { 
                        opacity: 1;
                        transform: translateY(0);
                    }
                }
                @keyframes spin {
                    from { transform: rotate(0deg); }
                    to { transform: rotate(360deg); }
                }
                @keyframes lampPulse {
                    0%, 100% { opacity: 1; }
                    50% { opacity: 0.5; }
                }
            `}</style>
        </div>
    );
};

export default DappCardModal;
