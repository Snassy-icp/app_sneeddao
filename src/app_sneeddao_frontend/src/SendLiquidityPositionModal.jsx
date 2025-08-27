// SendLiquidityPositionModal.jsx
import React, { useState, useEffect } from 'react';
import './SendLiquidityPositionModal.css'; // Create this CSS file for styling
import { Principal } from "@dfinity/principal";
import ConfirmationModal from './ConfirmationModal';
import { useTheme } from './contexts/ThemeContext';

function SendLiquidityPositionModal({ show, onClose, onSend, liquidityPosition }) {
  const { theme } = useTheme();
  const [recipient, setRecipient] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [errorText, setErrorText] = useState('');
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [confirmAction, setConfirmAction] = useState(null);
  const [confirmMessage, setConfirmMessage] = useState('');

  useEffect(() => {
    if (show) {
        setErrorText('');
    }
  }, [show]);

  const handleSend = async () => {
    setErrorText('');

    if (recipient == "") {
      setErrorText("Please enter a recipient address first!");
      return;
    }
    
    try {
      var p = Principal.fromText(recipient);
    } catch {
      setErrorText("Invalid recipient address! Please enter a valid recipient address.");
      return;
    }

    setConfirmAction(() => async () => {   
      try {
        setIsLoading(true);
        setErrorText('');
        await onSend(liquidityPosition, recipient);
      } catch (error) {
        setErrorText('Error sending liquidity position:', error);
      } finally {
        setIsLoading(false);
        onClose();
      }
    });

    setConfirmMessage(`You are about to send position #${liquidityPosition.id.toString()} of ${liquidityPosition.symbols} to ${recipient}.`);
    setShowConfirmModal(true);
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
      zIndex: 1000
    }}>
      <div style={{
        background: theme.colors.cardGradient,
        border: `1px solid ${theme.colors.border}`,
        boxShadow: theme.colors.cardShadow,
        borderRadius: '16px',
        padding: '32px',
        width: '450px',
        maxWidth: '90vw',
        maxHeight: '90vh',
        overflow: 'auto'
      }}>
        <h2 style={{
          color: theme.colors.primaryText,
          marginTop: '0',
          marginBottom: '24px',
          fontSize: '1.5rem',
          fontWeight: '600'
        }}>
          Send {liquidityPosition.symbols} Position #{liquidityPosition.id.toString()}
        </h2>
        
        <div style={{ marginBottom: '20px' }}>
          <label style={{
            display: 'block',
            color: theme.colors.primaryText,
            marginBottom: '8px',
            fontWeight: '500'
          }}>
            Recipient Address:
          </label>
          <input 
            type="text" 
            value={recipient}
            onChange={(e) => setRecipient(e.target.value)}
            placeholder="Enter recipient principal"
            style={{
              width: '100%',
              padding: '12px',
              background: theme.colors.secondaryBg,
              border: `1px solid ${theme.colors.border}`,
              borderRadius: '8px',
              color: theme.colors.primaryText,
              fontSize: '0.9rem',
              boxSizing: 'border-box'
            }}
          />
        </div>

        {errorText && (
          <p style={{
            color: theme.colors.error,
            marginBottom: '20px',
            padding: '12px',
            background: `${theme.colors.error}15`,
            border: `1px solid ${theme.colors.error}30`,
            borderRadius: '8px',
            fontSize: '0.9rem'
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
              onClick={handleSend} 
              disabled={isLoading}
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
              Send
            </button>
            <button 
              onClick={onClose} 
              disabled={isLoading}
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
      <ConfirmationModal
        show={showConfirmModal}
        onClose={() => setShowConfirmModal(false)}
        onSubmit={confirmAction}
        message={confirmMessage}
      />
    </div>
  );
}

export default SendLiquidityPositionModal;
