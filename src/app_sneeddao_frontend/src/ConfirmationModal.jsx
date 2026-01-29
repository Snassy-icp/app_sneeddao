import React, { useState, useEffect } from 'react';
import { useTheme } from './contexts/ThemeContext';

// Accent colors matching wallet page
const walletPrimary = '#10b981';
const walletSecondary = '#059669';

function ConfirmationModal({ show, onClose, onSubmit, message, doAwait }) {
  const { theme } = useTheme();
  const [isLoading, setIsLoading] = useState(false);
  const [errorText, setErrorText] = useState('');

  useEffect(() => {
    if (show) {
        setErrorText('');
    }
  }, [show]);

  const handleSubmit = async () => {
    setErrorText('');
    
    try {
      setIsLoading(true);
      setErrorText("");
      if (doAwait) {
        await onSubmit();
      } else {
        onSubmit();
      }
    } catch (error) {
      setErrorText("Error: " + error);
    }
    finally {
      setIsLoading(false);
      onClose();
    }
  };

  if (!show) {
    return null;
  }

  return (
    <div style={{
      position: 'fixed',
      top: 0,
      left: 0,
      width: '100%',
      height: '100%',
      background: 'rgba(0, 0, 0, 0.75)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 1001,
      backdropFilter: 'blur(4px)'
    }}>
      <div style={{
        background: `linear-gradient(135deg, ${theme.colors.primaryBg} 0%, ${walletPrimary}08 100%)`,
        border: `1px solid ${theme.colors.border}`,
        boxShadow: `0 20px 60px rgba(0, 0, 0, 0.4), 0 0 40px ${walletPrimary}15`,
        borderRadius: '16px',
        padding: '0',
        width: '420px',
        maxWidth: '90vw',
        maxHeight: '90vh',
        overflow: 'hidden'
      }}>
        {/* Header */}
        <div style={{
          background: `linear-gradient(135deg, #f59e0b, #d97706)`,
          padding: '1.25rem 1.5rem',
          display: 'flex',
          alignItems: 'center',
          gap: '0.75rem'
        }}>
          <span style={{ fontSize: '1.5rem' }}>⚠️</span>
          <h2 style={{
            color: 'white',
            margin: 0,
            fontSize: '1.2rem',
            fontWeight: '600'
          }}>
            Confirm Action
          </h2>
        </div>
        
        <div style={{ padding: '1.5rem' }}>
          <p style={{
            color: theme.colors.primaryText,
            marginBottom: '1.5rem',
            lineHeight: '1.6',
            fontSize: '0.95rem',
            textAlign: 'center'
          }}>
            {message}
          </p>

          {errorText && (
            <p style={{
              color: '#ef4444',
              marginBottom: '1.5rem',
              padding: '0.875rem',
              background: 'rgba(239, 68, 68, 0.1)',
              border: '1px solid rgba(239, 68, 68, 0.3)',
              borderRadius: '10px',
              fontSize: '0.85rem',
              textAlign: 'center'
            }}>
              {errorText}
            </p>
          )}

          {isLoading ? (
            <div style={{
              display: 'flex',
              justifyContent: 'center',
              padding: '1.5rem'
            }}>
              <div style={{
                width: '28px',
                height: '28px',
                border: `3px solid rgba(16, 185, 129, 0.2)`,
                borderTop: `3px solid ${walletPrimary}`,
                borderRadius: '50%',
                animation: 'confirmSpin 0.8s linear infinite'
              }}></div>
            </div>
          ) : (
            <div style={{
              display: 'flex',
              gap: '0.75rem'
            }}>
              <button 
                onClick={onClose}
                style={{
                  flex: '1',
                  background: theme.colors.secondaryBg,
                  color: theme.colors.primaryText,
                  border: `1px solid ${theme.colors.border}`,
                  borderRadius: '10px',
                  padding: '0.875rem 1.5rem',
                  cursor: 'pointer',
                  fontSize: '0.9rem',
                  fontWeight: '500',
                  transition: 'all 0.2s ease'
                }}
              >
                Cancel
              </button>
              <button 
                onClick={handleSubmit}
                style={{
                  flex: '1',
                  background: `linear-gradient(135deg, ${walletPrimary}, ${walletSecondary})`,
                  color: 'white',
                  border: 'none',
                  borderRadius: '10px',
                  padding: '0.875rem 1.5rem',
                  cursor: 'pointer',
                  fontSize: '0.9rem',
                  fontWeight: '600',
                  transition: 'all 0.2s ease',
                  boxShadow: `0 4px 15px ${walletPrimary}40`
                }}
              >
                Confirm
              </button>
            </div>
          )}
        </div>
      </div>
      
      <style>{`
        @keyframes confirmSpin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}

export default ConfirmationModal;
