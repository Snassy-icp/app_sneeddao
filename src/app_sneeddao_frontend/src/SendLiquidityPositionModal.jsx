// SendLiquidityPositionModal.jsx
import React, { useState, useEffect } from 'react';
import { Principal } from "@dfinity/principal";
import ConfirmationModal from './ConfirmationModal';
import { useTheme } from './contexts/ThemeContext';
import PrincipalInput from './components/PrincipalInput';

// Accent colors
const walletPrimary = '#10b981';
const walletSecondary = '#059669';

function SendLiquidityPositionModal({ show, onClose, onSend, liquidityPosition }) {
  const { theme } = useTheme();
  const [recipient, setRecipient] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [errorText, setErrorText] = useState('');
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [confirmAction, setConfirmAction] = useState(null);
  const [confirmMessage, setConfirmMessage] = useState('');
  
  const isBackendTransfer = liquidityPosition?.isBackendTransfer || false;

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
        // Only close on success
        setIsLoading(false);
        onClose();
      } catch (error) {
        console.error('Error transferring position:', error);
        setErrorText(`Error: ${error.message || error.toString()}`);
        setIsLoading(false);
      }
    });

    const action = isBackendTransfer ? 'transfer ownership of' : 'send';
    const explanation = isBackendTransfer 
      ? ' This will transfer backend ownership while keeping the position locked.' 
      : '';
    setConfirmMessage(`You are about to ${action} position #${liquidityPosition.id.toString()} of ${liquidityPosition.symbols} to ${recipient}.${explanation}`);
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
      backgroundColor: 'rgba(0, 0, 0, 0.75)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 1000,
      padding: '20px',
      backdropFilter: 'blur(4px)'
    }}>
      <div style={{
        background: `linear-gradient(135deg, ${theme.colors.primaryBg} 0%, ${walletPrimary}08 100%)`,
        border: `1px solid ${theme.colors.border}`,
        boxShadow: `0 20px 60px rgba(0, 0, 0, 0.4), 0 0 40px ${walletPrimary}15`,
        borderRadius: '16px',
        padding: '0',
        width: '480px',
        maxWidth: '90vw',
        maxHeight: '90vh',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden'
      }}>
        {/* Header */}
        <div style={{
          background: `linear-gradient(135deg, ${walletPrimary}, ${walletSecondary})`,
          padding: '1.25rem 1.5rem',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between'
        }}>
          <h2 style={{
            color: 'white',
            margin: 0,
            fontSize: '1.1rem',
            fontWeight: '600'
          }}>
            {isBackendTransfer ? '🔄 Transfer' : '📤 Send'} {liquidityPosition.symbols} Position #{liquidityPosition.id.toString()}
          </h2>
          <button
            onClick={onClose}
            disabled={isLoading}
            style={{
              background: 'rgba(255, 255, 255, 0.2)',
              border: 'none',
              fontSize: '1.25rem',
              cursor: isLoading ? 'not-allowed' : 'pointer',
              color: 'white',
              width: '32px',
              height: '32px',
              borderRadius: '8px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              opacity: isLoading ? 0.5 : 1
            }}
          >
            ×
          </button>
        </div>

        {/* Content */}
        <div style={{ padding: '1.25rem', flex: 1, overflowY: 'auto' }}>
        
        {/* Warning Box for Locked Positions */}
        {isBackendTransfer && (
          <div style={{
            background: `${theme.colors.warning || '#FF9800'}15`,
            border: `1px solid ${theme.colors.warning || '#FF9800'}50`,
            borderRadius: '8px',
            padding: '14px',
            marginBottom: '20px'
          }}>
            <div style={{
              color: theme.colors.warning || '#FF9800',
              fontWeight: '600',
              fontSize: '0.95rem',
              marginBottom: '6px'
            }}>
              ⚠️ Wallet Compatibility Warning
            </div>
            <div style={{
              color: theme.colors.secondaryText,
              fontSize: '0.85rem',
              lineHeight: '1.5'
            }}>
              Only transfer locked positions to Sneed Wallet principals that support Sneed Lock! 
              Transferring to incompatible wallets (exchanges, other wallet types) may result in permanent loss of access.
            </div>
          </div>
        )}
        
        <div style={{ marginBottom: '20px' }}>
          <label style={{
            display: 'block',
            color: theme.colors.primaryText,
            marginBottom: '8px',
            fontWeight: '500'
          }}>
            Recipient Address:
          </label>
          <PrincipalInput
            value={recipient}
            onChange={setRecipient}
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
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '20px'
          }}>
            <div className="spinner" style={{
              width: '28px',
              height: '28px',
              border: `3px solid ${theme.colors.border}`,
              borderTop: `3px solid ${walletPrimary}`,
              borderRadius: '50%',
              animation: 'spin 1s linear infinite',
              marginBottom: '10px'
            }}></div>
            <span style={{ color: theme.colors.mutedText, fontSize: '0.85rem' }}>Processing...</span>
          </div>
        ) : (
          <div style={{
            display: 'flex',
            gap: '12px',
            marginTop: '20px'
          }}>
            <button 
              onClick={handleSend} 
              disabled={isLoading}
              style={{
                flex: '2',
                background: `linear-gradient(135deg, ${walletPrimary}, ${walletSecondary})`,
                color: 'white',
                border: 'none',
                borderRadius: '10px',
                padding: '14px 24px',
                cursor: 'pointer',
                fontSize: '0.95rem',
                fontWeight: '600',
                boxShadow: `0 4px 12px ${walletPrimary}40`
              }}
            >
              {isBackendTransfer ? 'Transfer' : 'Send'}
            </button>
            <button 
              onClick={onClose} 
              disabled={isLoading}
              style={{
                flex: '1',
                background: theme.colors.secondaryBg,
                color: theme.colors.primaryText,
                border: `1px solid ${theme.colors.border}`,
                borderRadius: '10px',
                padding: '14px 24px',
                cursor: 'pointer',
                fontSize: '0.95rem',
                fontWeight: '500'
              }}
            >
              Cancel
            </button>
          </div>
        )}
        </div>
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
