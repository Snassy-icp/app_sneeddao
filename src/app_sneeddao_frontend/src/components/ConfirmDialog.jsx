import React from 'react';
import { createPortal } from 'react-dom';
import { useTheme } from '../contexts/ThemeContext';
import { FaExclamationTriangle, FaCheckCircle, FaInfoCircle, FaTimesCircle, FaTimes } from 'react-icons/fa';

/**
 * A beautiful, reusable dialog component for alerts and confirmations.
 * 
 * Props:
 * - isOpen: boolean - Whether the dialog is visible
 * - onClose: function - Called when dialog is closed (Cancel/X button or backdrop click)
 * - onConfirm: function - Called when confirm button is clicked (optional, makes it a confirm dialog)
 * - title: string - Dialog title
 * - message: string | ReactNode - Main message content
 * - type: 'warning' | 'error' | 'success' | 'info' - Determines icon and color scheme
 * - confirmText: string - Text for confirm button (default: "Confirm")
 * - cancelText: string - Text for cancel button (default: "Cancel")
 * - confirmVariant: 'danger' | 'primary' | 'success' - Confirm button style
 * - showCancel: boolean - Whether to show cancel button (default: true if onConfirm provided)
 */
const ConfirmDialog = ({ 
    isOpen, 
    onClose, 
    onConfirm,
    title = 'Confirm Action',
    message = 'Are you sure you want to proceed?',
    type = 'warning',
    confirmText = 'Confirm',
    cancelText = 'Cancel',
    confirmVariant = 'primary',
    showCancel = true
}) => {
    const { theme } = useTheme();

    if (!isOpen) return null;

    // Type-based styling
    const typeConfig = {
        warning: {
            icon: <FaExclamationTriangle size={28} />,
            color: '#f59e0b',
            bgGradient: 'linear-gradient(135deg, #f59e0b15, #f59e0b08)'
        },
        error: {
            icon: <FaTimesCircle size={28} />,
            color: '#ef4444',
            bgGradient: 'linear-gradient(135deg, #ef444415, #ef444408)'
        },
        success: {
            icon: <FaCheckCircle size={28} />,
            color: '#10b981',
            bgGradient: 'linear-gradient(135deg, #10b98115, #10b98108)'
        },
        info: {
            icon: <FaInfoCircle size={28} />,
            color: '#3b82f6',
            bgGradient: 'linear-gradient(135deg, #3b82f615, #3b82f608)'
        }
    };

    const config = typeConfig[type] || typeConfig.warning;

    // Confirm button variant styling
    const variantStyles = {
        danger: {
            background: 'linear-gradient(135deg, #ef4444, #dc2626)',
            hoverBg: '#dc2626'
        },
        primary: {
            background: `linear-gradient(135deg, ${theme.colors.accent}, ${theme.colors.accentDark || theme.colors.accent})`,
            hoverBg: theme.colors.accentDark || theme.colors.accent
        },
        success: {
            background: 'linear-gradient(135deg, #10b981, #059669)',
            hoverBg: '#059669'
        }
    };

    const confirmStyle = variantStyles[confirmVariant] || variantStyles.primary;

    const handleBackdropClick = (e) => {
        if (e.target === e.currentTarget) {
            onClose();
        }
    };

    return createPortal(
        <div 
            onClick={handleBackdropClick}
            style={{
                position: 'fixed',
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                background: 'rgba(0, 0, 0, 0.6)',
                backdropFilter: 'blur(4px)',
                display: 'flex',
                justifyContent: 'center',
                alignItems: 'center',
                zIndex: 100000,
                animation: 'fadeIn 0.2s ease-out'
            }}
        >
            <style>{`
                @keyframes fadeIn {
                    from { opacity: 0; }
                    to { opacity: 1; }
                }
                @keyframes slideUp {
                    from { opacity: 0; transform: translateY(20px) scale(0.95); }
                    to { opacity: 1; transform: translateY(0) scale(1); }
                }
                @keyframes pulse {
                    0%, 100% { transform: scale(1); }
                    50% { transform: scale(1.05); }
                }
            `}</style>
            
            <div style={{
                background: theme.colors.secondaryBg,
                border: `1px solid ${theme.colors.border}`,
                boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)',
                borderRadius: '16px',
                padding: '0',
                width: '90%',
                maxWidth: '420px',
                overflow: 'hidden',
                animation: 'slideUp 0.3s ease-out'
            }}>
                {/* Header with icon */}
                <div style={{
                    background: config.bgGradient,
                    borderBottom: `1px solid ${config.color}30`,
                    padding: '1.5rem',
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: '1rem'
                }}>
                    <div style={{
                        width: '48px',
                        height: '48px',
                        borderRadius: '12px',
                        background: `${config.color}20`,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        color: config.color,
                        flexShrink: 0
                    }}>
                        {config.icon}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                        <h3 style={{ 
                            color: theme.colors.primaryText, 
                            margin: '0 0 0.25rem 0',
                            fontSize: '1.1rem',
                            fontWeight: '600',
                            lineHeight: '1.3'
                        }}>
                            {title}
                        </h3>
                        <div style={{
                            color: theme.colors.secondaryText,
                            fontSize: '0.9rem',
                            lineHeight: '1.5'
                        }}>
                            {message}
                        </div>
                    </div>
                    <button
                        onClick={onClose}
                        style={{
                            background: 'none',
                            border: 'none',
                            color: theme.colors.mutedText,
                            cursor: 'pointer',
                            padding: '4px',
                            borderRadius: '6px',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            transition: 'all 0.2s ease'
                        }}
                        onMouseEnter={(e) => {
                            e.target.style.background = theme.colors.primaryBg;
                            e.target.style.color = theme.colors.primaryText;
                        }}
                        onMouseLeave={(e) => {
                            e.target.style.background = 'none';
                            e.target.style.color = theme.colors.mutedText;
                        }}
                    >
                        <FaTimes size={16} />
                    </button>
                </div>

                {/* Actions */}
                <div style={{
                    padding: '1rem 1.5rem',
                    display: 'flex',
                    justifyContent: 'flex-end',
                    gap: '0.75rem',
                    background: theme.colors.primaryBg
                }}>
                    {showCancel && (
                        <button
                            onClick={onClose}
                            style={{
                                background: 'transparent',
                                border: `1px solid ${theme.colors.border}`,
                                color: theme.colors.secondaryText,
                                borderRadius: '8px',
                                padding: '0.6rem 1.25rem',
                                cursor: 'pointer',
                                fontSize: '0.9rem',
                                fontWeight: '500',
                                transition: 'all 0.2s ease'
                            }}
                            onMouseEnter={(e) => {
                                e.target.style.background = theme.colors.secondaryBg;
                                e.target.style.borderColor = theme.colors.mutedText;
                            }}
                            onMouseLeave={(e) => {
                                e.target.style.background = 'transparent';
                                e.target.style.borderColor = theme.colors.border;
                            }}
                        >
                            {cancelText}
                        </button>
                    )}
                    <button
                        onClick={() => {
                            if (onConfirm) {
                                onConfirm();
                            }
                            onClose();
                        }}
                        style={{
                            background: confirmStyle.background,
                            border: 'none',
                            color: 'white',
                            borderRadius: '8px',
                            padding: '0.6rem 1.25rem',
                            cursor: 'pointer',
                            fontSize: '0.9rem',
                            fontWeight: '600',
                            transition: 'all 0.2s ease',
                            boxShadow: '0 2px 8px rgba(0, 0, 0, 0.2)'
                        }}
                        onMouseEnter={(e) => {
                            e.target.style.transform = 'translateY(-1px)';
                            e.target.style.boxShadow = '0 4px 12px rgba(0, 0, 0, 0.3)';
                        }}
                        onMouseLeave={(e) => {
                            e.target.style.transform = 'translateY(0)';
                            e.target.style.boxShadow = '0 2px 8px rgba(0, 0, 0, 0.2)';
                        }}
                    >
                        {confirmText}
                    </button>
                </div>
            </div>
        </div>,
        document.body
    );
};

export default ConfirmDialog;
