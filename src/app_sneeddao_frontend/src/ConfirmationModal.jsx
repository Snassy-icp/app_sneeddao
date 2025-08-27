import React, { useState, useEffect } from 'react';
import { useTheme } from './contexts/ThemeContext';

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
      background: theme.colors.modalBg,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 1001 // Higher than main modals to appear on top
    }}>
      <div style={{
        background: theme.colors.cardGradient,
        border: `1px solid ${theme.colors.border}`,
        boxShadow: theme.colors.cardShadow,
        borderRadius: '16px',
        padding: '32px',
        width: '400px',
        maxWidth: '90vw',
        maxHeight: '90vh',
        overflow: 'auto'
      }}>
        <h2 style={{
          color: theme.colors.primaryText,
          marginTop: '0',
          marginBottom: '16px',
          fontSize: '1.3rem',
          fontWeight: '600',
          textAlign: 'center'
        }}>
          Are you sure?
        </h2>
        
        <p style={{
          color: theme.colors.secondaryText,
          marginBottom: '20px',
          lineHeight: '1.5',
          fontSize: '0.95rem',
          textAlign: 'center'
        }}>
          {message}
        </p>

        {errorText && (
          <p style={{
            color: theme.colors.error,
            marginBottom: '20px',
            padding: '12px',
            background: `${theme.colors.error}15`,
            border: `1px solid ${theme.colors.error}30`,
            borderRadius: '8px',
            fontSize: '0.9rem',
            textAlign: 'center'
          }}>
            {errorText}
          </p>
        )}

        {isLoading ? (
          <div style={{
            display: 'flex',
            justifyContent: 'center',
            padding: '20px'
          }}>
            <div className="spinner" style={{
              width: '24px',
              height: '24px',
              border: `3px solid ${theme.colors.border}`,
              borderTop: `3px solid ${theme.colors.accent}`,
              borderRadius: '50%',
              animation: 'spin 1s linear infinite'
            }}></div>
          </div>
        ) : (
          <div style={{
            display: 'flex',
            gap: '12px',
            marginTop: '24px'
          }}>
            <button 
              onClick={handleSubmit}
              style={{
                flex: '1',
                background: theme.colors.accent,
                color: theme.colors.primaryBg,
                border: 'none',
                borderRadius: '8px',
                padding: '12px 24px',
                cursor: 'pointer',
                fontSize: '0.95rem',
                fontWeight: '600',
                transition: 'all 0.2s ease'
              }}
              onMouseEnter={(e) => {
                e.target.style.background = theme.colors.accentHover;
              }}
              onMouseLeave={(e) => {
                e.target.style.background = theme.colors.accent;
              }}
            >
              Confirm
            </button>
            <button 
              onClick={onClose}
              style={{
                flex: '1',
                background: theme.colors.secondaryBg,
                color: theme.colors.mutedText,
                border: `1px solid ${theme.colors.border}`,
                borderRadius: '8px',
                padding: '12px 24px',
                cursor: 'pointer',
                fontSize: '0.95rem',
                fontWeight: '500',
                transition: 'all 0.2s ease'
              }}
              onMouseEnter={(e) => {
                e.target.style.background = theme.colors.tertiaryBg;
                e.target.style.color = theme.colors.primaryText;
              }}
              onMouseLeave={(e) => {
                e.target.style.background = theme.colors.secondaryBg;
                e.target.style.color = theme.colors.mutedText;
              }}
            >
              Cancel
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export default ConfirmationModal;