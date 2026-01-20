import React from 'react';
import { useTheme } from '../contexts/ThemeContext';

/**
 * InfoModal - A simple modal for displaying informational messages
 * 
 * Props:
 * - show: boolean - whether to show the modal
 * - onClose: function - called when the user clicks OK or closes the modal
 * - title: string - optional title for the modal (default: "Information")
 * - message: string - the message to display
 * - type: 'info' | 'success' | 'error' | 'warning' - affects the styling (default: 'info')
 */
function InfoModal({ show, onClose, title, message, type = 'info' }) {
    const { theme } = useTheme();

    if (!show) {
        return null;
    }

    // Get colors based on type
    const getTypeColors = () => {
        switch (type) {
            case 'success':
                return {
                    iconBg: `${theme.colors.success}20`,
                    iconColor: theme.colors.success,
                    icon: '✓',
                    buttonBg: theme.colors.success
                };
            case 'error':
                return {
                    iconBg: `${theme.colors.error}20`,
                    iconColor: theme.colors.error,
                    icon: '✕',
                    buttonBg: theme.colors.error
                };
            case 'warning':
                return {
                    iconBg: `${theme.colors.warning || '#f59e0b'}20`,
                    iconColor: theme.colors.warning || '#f59e0b',
                    icon: '⚠',
                    buttonBg: theme.colors.warning || '#f59e0b'
                };
            default: // info
                return {
                    iconBg: `${theme.colors.accent}20`,
                    iconColor: theme.colors.accent,
                    icon: 'ℹ',
                    buttonBg: theme.colors.accent
                };
        }
    };

    const typeColors = getTypeColors();

    const defaultTitles = {
        info: 'Information',
        success: 'Success',
        error: 'Error',
        warning: 'Warning'
    };

    return (
        <div style={{
            position: 'fixed',
            top: 0,
            left: 0,
            width: '100%',
            height: '100%',
            background: theme.colors.modalBg,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 10001
        }}>
            <div style={{
                background: theme.colors.cardGradient,
                border: `1px solid ${theme.colors.border}`,
                boxShadow: theme.colors.cardShadow,
                borderRadius: '16px',
                padding: '32px',
                width: '420px',
                maxWidth: '90vw',
                maxHeight: '90vh',
                overflow: 'auto'
            }}>
                {/* Icon */}
                <div style={{
                    display: 'flex',
                    justifyContent: 'center',
                    marginBottom: '16px'
                }}>
                    <div style={{
                        width: '56px',
                        height: '56px',
                        borderRadius: '50%',
                        background: typeColors.iconBg,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: '24px',
                        color: typeColors.iconColor,
                        fontWeight: 'bold'
                    }}>
                        {typeColors.icon}
                    </div>
                </div>

                {/* Title */}
                <h2 style={{
                    color: theme.colors.primaryText,
                    marginTop: '0',
                    marginBottom: '12px',
                    fontSize: '1.3rem',
                    fontWeight: '600',
                    textAlign: 'center'
                }}>
                    {title || defaultTitles[type]}
                </h2>
                
                {/* Message */}
                <p style={{
                    color: theme.colors.secondaryText,
                    marginBottom: '24px',
                    lineHeight: '1.6',
                    fontSize: '0.95rem',
                    textAlign: 'center',
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-word'
                }}>
                    {message}
                </p>

                {/* OK Button */}
                <button 
                    onClick={onClose}
                    style={{
                        width: '100%',
                        background: typeColors.buttonBg,
                        color: theme.colors.primaryBg,
                        border: 'none',
                        borderRadius: '8px',
                        padding: '14px 24px',
                        cursor: 'pointer',
                        fontSize: '1rem',
                        fontWeight: '600',
                        transition: 'all 0.2s ease'
                    }}
                    onMouseEnter={(e) => {
                        e.target.style.opacity = '0.9';
                    }}
                    onMouseLeave={(e) => {
                        e.target.style.opacity = '1';
                    }}
                >
                    OK
                </button>
            </div>
        </div>
    );
}

export default InfoModal;

