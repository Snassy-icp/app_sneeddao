import React, { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { FaTimes, FaSync, FaBrain, FaBox, FaCrown, FaExternalLinkAlt, FaTrash, FaCoins, FaMicrochip } from 'react-icons/fa';
import { useTheme } from '../contexts/ThemeContext';
import { useNaming } from '../NamingContext';

/**
 * Modal wrapper for displaying a Dapp card (Canister or Neuron Manager)
 * Used in the PrincipalBox compact wallet to show full dapp details
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
    neuronManagerVersion = null,
    neuronCount = 0,
    // Optional handlers
    handleRefresh,
    handleRemove,
    isRefreshing = false,
    isRemoving = false,
}) => {
    const { theme } = useTheme();
    const { getPrincipalDisplayName } = useNaming();
    const navigate = useNavigate();

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

    if (!show || !canisterId) return null;

    const accentColor = isNeuronManager ? '#8b5cf6' : theme.colors.accent;

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
                    maxWidth: '400px',
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
                        }}>
                            {isNeuronManager ? (
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
                                {isNeuronManager ? 'ICP Neuron Manager' : 'Canister'}
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
                        gridTemplateColumns: isNeuronManager ? 'repeat(3, 1fr)' : 'repeat(2, 1fr)',
                        gap: '12px',
                        marginBottom: '20px',
                    }}>
                        {/* Neuron Manager specific: Version & Neurons */}
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
                                    🧠 {neuronCount}
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
            `}</style>
        </div>
    );
};

export default DappCardModal;
