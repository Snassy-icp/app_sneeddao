import React from 'react';
import { useTheme } from '../contexts/ThemeContext';
import { FaSync, FaSpinner } from 'react-icons/fa';

/**
 * Full-screen overlay shown during cache clear + page refresh.
 * Displays a message that we're clearing the cache and refreshing.
 */
export default function CacheRefreshDialog({ isOpen }) {
    const { theme } = useTheme();

    if (!isOpen) return null;

    return (
        <div
            style={{
                position: 'fixed',
                inset: 0,
                zIndex: 10000,
                background: theme.colors?.modalBg || 'rgba(0, 0, 0, 0.85)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexDirection: 'column',
                gap: '1.5rem',
                padding: '2rem',
            }}
        >
            <div
                style={{
                    background: theme.colors?.cardBg || 'rgba(255, 255, 255, 0.1)',
                    borderRadius: '16px',
                    padding: '2rem 2.5rem',
                    maxWidth: '420px',
                    textAlign: 'center',
                    border: `1px solid ${theme.colors?.border || 'rgba(255,255,255,0.2)'}`,
                    boxShadow: theme.colors?.cardShadow || '0 8px 32px rgba(0,0,0,0.5)',
                }}
            >
                <div style={{ marginBottom: '1rem' }}>
                    <FaSync
                        size={48}
                        style={{
                            color: theme.colors?.accent || '#4a90e2',
                            animation: 'spin 1s linear infinite',
                        }}
                    />
                </div>
                <h2
                    style={{
                        color: theme.colors?.primaryText || '#fff',
                        fontSize: '1.25rem',
                        fontWeight: 600,
                        marginBottom: '0.75rem',
                    }}
                >
                    Updating to latest version
                </h2>
                <p
                    style={{
                        color: theme.colors?.secondaryText || '#ccc',
                        fontSize: '0.95rem',
                        lineHeight: 1.5,
                    }}
                >
                    Clearing cache and refreshing to load the latest version of the website...
                </p>
                <div
                    style={{
                        marginTop: '1.25rem',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '0.5rem',
                        color: theme.colors?.mutedText || '#888',
                        fontSize: '0.85rem',
                    }}
                >
                    <FaSpinner
                        size={16}
                        style={{
                            animation: 'spin 1s linear infinite',
                            flexShrink: 0,
                        }}
                    />
                    <span>Please wait</span>
                </div>
            </div>
            <style>{`
                @keyframes spin {
                    from { transform: rotate(0deg); }
                    to { transform: rotate(360deg); }
                }
            `}</style>
        </div>
    );
}
