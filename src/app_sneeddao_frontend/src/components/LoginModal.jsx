// LoginModal.jsx - Login method selection modal
import React from 'react';
import { useTheme } from '../contexts/ThemeContext';
import { useAuth } from '../AuthContext';

function LoginModal({ isOpen, onClose }) {
    const { theme } = useTheme();
    const { loginWithII1, loginWithII2, isLoggingIn, authError, clearAuthError } = useAuth();

    if (!isOpen) return null;

    const handleII1Login = async () => {
        await loginWithII1();
        // Don't close modal here - let the auth success handler do it
    };

    const handleII2Login = async () => {
        await loginWithII2();
        // Don't close modal here - let the auth success handler do it
    };

    const handleBackdropClick = (e) => {
        if (e.target === e.currentTarget) {
            onClose();
        }
    };

    return (
        <div 
            className="login-modal-backdrop"
            onClick={handleBackdropClick}
            style={{
                position: 'fixed',
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                backgroundColor: 'rgba(0, 0, 0, 0.7)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                zIndex: 10000,
                backdropFilter: 'blur(4px)',
            }}
        >
            <div 
                className="login-modal"
                style={{
                    background: theme.colors.cardBg,
                    borderRadius: '16px',
                    border: `1px solid ${theme.colors.border}`,
                    padding: '32px',
                    maxWidth: '420px',
                    width: '90%',
                    boxShadow: '0 20px 60px rgba(0, 0, 0, 0.5)',
                    position: 'relative',
                }}
            >
                {/* Close button */}
                <button
                    onClick={onClose}
                    style={{
                        position: 'absolute',
                        top: '16px',
                        right: '16px',
                        background: 'none',
                        border: 'none',
                        color: theme.colors.mutedText,
                        fontSize: '24px',
                        cursor: 'pointer',
                        padding: '4px',
                        lineHeight: 1,
                    }}
                >
                    ×
                </button>

                {/* Header */}
                <div style={{ textAlign: 'center', marginBottom: '28px' }}>
                    <img 
                        src="/sneed_logo.png" 
                        alt="Sneed Logo" 
                        style={{
                            width: '64px',
                            height: '64px',
                            borderRadius: '50%',
                            marginBottom: '16px',
                            boxShadow: '0 4px 20px rgba(52, 152, 219, 0.3)',
                        }}
                    />
                    <h2 style={{ 
                        color: theme.colors.primaryText, 
                        margin: '0 0 8px 0',
                        fontSize: '1.5rem',
                        fontWeight: '600'
                    }}>
                        Sign In to Sneed DAO
                    </h2>
                    <p style={{ 
                        color: theme.colors.mutedText, 
                        margin: 0,
                        fontSize: '0.9rem'
                    }}>
                        Choose your preferred sign-in method
                    </p>
                </div>

                {/* Error display */}
                {authError && (
                    <div style={{
                        padding: '12px 16px',
                        background: 'rgba(255, 82, 82, 0.1)',
                        border: '1px solid rgba(255, 82, 82, 0.3)',
                        borderRadius: '8px',
                        marginBottom: '20px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        color: theme.colors.error || '#ff5252',
                        fontSize: '0.9rem',
                    }}>
                        <span>⚠️ {authError}</span>
                        <button 
                            onClick={clearAuthError}
                            style={{
                                background: 'none',
                                border: 'none',
                                color: theme.colors.mutedText,
                                cursor: 'pointer',
                                padding: '4px',
                            }}
                        >
                            ✕
                        </button>
                    </div>
                )}

                {/* Login Options */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                    
                    {/* Internet Identity 1.0 (Classic) */}
                    <button
                        onClick={handleII1Login}
                        disabled={isLoggingIn}
                        style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '16px',
                            padding: '16px 20px',
                            background: 'linear-gradient(135deg, #29ABE2 0%, #1E90FF 100%)',
                            border: 'none',
                            borderRadius: '12px',
                            cursor: isLoggingIn ? 'not-allowed' : 'pointer',
                            opacity: isLoggingIn ? 0.7 : 1,
                            transition: 'all 0.2s ease',
                            boxShadow: '0 4px 15px rgba(41, 171, 226, 0.3)',
                        }}
                        onMouseEnter={(e) => {
                            if (!isLoggingIn) {
                                e.currentTarget.style.transform = 'translateY(-2px)';
                                e.currentTarget.style.boxShadow = '0 6px 20px rgba(41, 171, 226, 0.4)';
                            }
                        }}
                        onMouseLeave={(e) => {
                            e.currentTarget.style.transform = 'translateY(0)';
                            e.currentTarget.style.boxShadow = '0 4px 15px rgba(41, 171, 226, 0.3)';
                        }}
                    >
                        <div style={{
                            width: '48px',
                            height: '48px',
                            background: 'rgba(255,255,255,0.2)',
                            borderRadius: '10px',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                        }}>
                            <svg width="28" height="28" viewBox="0 0 24 24" fill="white">
                                <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 3c1.66 0 3 1.34 3 3s-1.34 3-3 3-3-1.34-3-3 1.34-3 3-3zm0 14.2c-2.5 0-4.71-1.28-6-3.22.03-1.99 4-3.08 6-3.08 1.99 0 5.97 1.09 6 3.08-1.29 1.94-3.5 3.22-6 3.22z"/>
                            </svg>
                        </div>
                        <div style={{ flex: 1, textAlign: 'left' }}>
                            <div style={{ 
                                color: 'white', 
                                fontWeight: '600', 
                                fontSize: '1.1rem',
                                marginBottom: '4px'
                            }}>
                                Internet Identity 1.0
                            </div>
                            <div style={{ 
                                color: 'rgba(255,255,255,0.8)', 
                                fontSize: '0.8rem' 
                            }}>
                                identity.ic0.app • Classic passkeys
                            </div>
                        </div>
                        {isLoggingIn && (
                            <div style={{
                                width: '20px',
                                height: '20px',
                                border: '2px solid rgba(255,255,255,0.3)',
                                borderTopColor: 'white',
                                borderRadius: '50%',
                                animation: 'spin 0.8s linear infinite',
                            }} />
                        )}
                    </button>

                    {/* Internet Identity 2.0 (New - id.ai) */}
                    <button
                        onClick={handleII2Login}
                        disabled={isLoggingIn}
                        style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '16px',
                            padding: '16px 20px',
                            background: 'linear-gradient(135deg, #7B68EE 0%, #9370DB 100%)',
                            border: 'none',
                            borderRadius: '12px',
                            cursor: isLoggingIn ? 'not-allowed' : 'pointer',
                            opacity: isLoggingIn ? 0.7 : 1,
                            transition: 'all 0.2s ease',
                            boxShadow: '0 4px 15px rgba(123, 104, 238, 0.3)',
                        }}
                        onMouseEnter={(e) => {
                            if (!isLoggingIn) {
                                e.currentTarget.style.transform = 'translateY(-2px)';
                                e.currentTarget.style.boxShadow = '0 6px 20px rgba(123, 104, 238, 0.4)';
                            }
                        }}
                        onMouseLeave={(e) => {
                            e.currentTarget.style.transform = 'translateY(0)';
                            e.currentTarget.style.boxShadow = '0 4px 15px rgba(123, 104, 238, 0.3)';
                        }}
                    >
                        <div style={{
                            width: '48px',
                            height: '48px',
                            background: 'rgba(255,255,255,0.2)',
                            borderRadius: '10px',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                        }}>
                            <svg width="28" height="28" viewBox="0 0 24 24" fill="white">
                                <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/>
                            </svg>
                        </div>
                        <div style={{ flex: 1, textAlign: 'left' }}>
                            <div style={{ 
                                color: 'white', 
                                fontWeight: '600', 
                                fontSize: '1.1rem',
                                marginBottom: '4px'
                            }}>
                                Internet Identity 2.0
                            </div>
                            <div style={{ 
                                color: 'rgba(255,255,255,0.8)', 
                                fontSize: '0.8rem' 
                            }}>
                                id.ai • New interface
                            </div>
                        </div>
                        {isLoggingIn && (
                            <div style={{
                                width: '20px',
                                height: '20px',
                                border: '2px solid rgba(255,255,255,0.3)',
                                borderTopColor: 'white',
                                borderRadius: '50%',
                                animation: 'spin 0.8s linear infinite',
                            }} />
                        )}
                    </button>
                </div>

                {/* Info */}
                <div style={{
                    marginTop: '24px',
                    padding: '16px',
                    background: `${theme.colors.primaryBg}`,
                    borderRadius: '10px',
                    fontSize: '0.85rem',
                    color: theme.colors.mutedText,
                }}>
                    <p style={{ margin: '0 0 8px 0' }}>
                        <strong style={{ color: theme.colors.primaryText }}>Internet Identity 1.0</strong> — The classic Internet Identity interface at identity.ic0.app. Use your existing II anchors and device passkeys.
                    </p>
                    <p style={{ margin: 0 }}>
                        <strong style={{ color: theme.colors.primaryText }}>Internet Identity 2.0</strong> — The new Internet Identity interface at id.ai with an improved experience.
                    </p>
                </div>

                {/* Create account links */}
                <div style={{
                    marginTop: '20px',
                    textAlign: 'center',
                    fontSize: '0.85rem',
                    color: theme.colors.mutedText,
                }}>
                    <p style={{ margin: '0 0 8px 0' }}>Don't have an Internet Identity?</p>
                    <div style={{ display: 'flex', justifyContent: 'center', gap: '16px' }}>
                        <a 
                            href="https://identity.ic0.app"
                            target="_blank"
                            rel="noopener noreferrer"
                            style={{ color: theme.colors.accent, textDecoration: 'none' }}
                        >
                            Create on II 1.0 →
                        </a>
                        <a 
                            href="https://id.ai"
                            target="_blank"
                            rel="noopener noreferrer"
                            style={{ color: '#9370DB', textDecoration: 'none' }}
                        >
                            Create on II 2.0 →
                        </a>
                    </div>
                </div>
            </div>

            <style>{`
                @keyframes spin {
                    to { transform: rotate(360deg); }
                }
            `}</style>
        </div>
    );
}

export default LoginModal;
