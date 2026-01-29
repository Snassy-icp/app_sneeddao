// TransferTokenLockModal.jsx
import React, { useState, useEffect, useMemo } from 'react';
import { Principal } from "@dfinity/principal";
import ConfirmationModal from './ConfirmationModal';
import { useTheme } from './contexts/ThemeContext';
import PrincipalInput from './components/PrincipalInput';
import { formatAmount } from './utils/StringUtils';
import { dateToReadable } from './utils/DateUtils';
import { get_available_backend } from './utils/TokenUtils';

// Accent colors 
const walletPrimary = '#10b981';
const walletSecondary = '#059669';

function TransferTokenLockModal({ show, onClose, onTransfer, tokenLock, token }) {
  const { theme } = useTheme();
  const [recipient, setRecipient] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [errorText, setErrorText] = useState('');
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [confirmAction, setConfirmAction] = useState(null);
  const [confirmMessage, setConfirmMessage] = useState('');

  // Calculate if we need to send 1 or 2 tx fees
  const feeInfo = useMemo(() => {
    if (!token) return { feesRequired: 1, needsPreSend: false };
    
    const liquidBackend = get_available_backend(token);
    const needsPreSend = liquidBackend < BigInt(token.fee);
    
    return {
      feesRequired: needsPreSend ? 2 : 1,
      needsPreSend,
      liquidBackend,
      hasEnoughFrontend: BigInt(token.balance) >= BigInt(token.fee) * 2n
    };
  }, [token]);

  useEffect(() => {
    if (show) {
        setErrorText('');
        setRecipient('');
    }
  }, [show]);

  const handleTransfer = async () => {
    setErrorText('');

    if (recipient === "") {
      setErrorText("Please enter a recipient address first!");
      return;
    }
    
    try {
      var p = Principal.fromText(recipient);
    } catch {
      setErrorText("Invalid recipient address! Please enter a valid recipient address.");
      return;
    }

    // Check if user has enough liquid balance on frontend if pre-send is needed
    if (feeInfo.needsPreSend && !feeInfo.hasEnoughFrontend) {
      setErrorText(`Insufficient liquid balance on frontend! You need at least ${formatAmount(BigInt(token.fee) * 2n, token.decimals)} ${token.symbol} available (not locked) to complete this transfer (1 tx fee to send to backend, plus 1 tx fee to pay for that transaction).`);
      return;
    }

    setConfirmAction(() => async () => {   
      try {
        setIsLoading(true);
        setErrorText('');
        await onTransfer(tokenLock, recipient);
        // Only close on success
        setIsLoading(false);
        onClose();
      } catch (error) {
        console.error('Error transferring token lock:', error);
        setErrorText(`Error: ${error.message || error.toString()}`);
        setIsLoading(false);
      }
    });

    const lockAmount = formatAmount(tokenLock.amount, token.decimals);
    const feeAmount = formatAmount(BigInt(token.fee) * BigInt(feeInfo.feesRequired), token.decimals);
    const feeExplanation = feeInfo.needsPreSend 
      ? ` (including 1 tx fee to prepare your backend subaccount for the transfer)`
      : ` (drawn from your backend liquid balance)`;
    
    setConfirmMessage(`You are about to transfer ownership of lock #${tokenLock.lock_id} (${lockAmount} ${token.symbol}, expires ${dateToReadable(tokenLock.expiry)}) to ${recipient}. This will cost ${feeAmount} ${token.symbol} in transaction fees${feeExplanation}. The lock will remain active and ownership will be transferred to the recipient.`);
    setShowConfirmModal(true);
  };

  if (!show || !tokenLock || !token) {
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
            🔄 Transfer {token.symbol} Lock #{tokenLock.lock_id}
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
        
        {/* Lock Info */}
        <div style={{
          background: theme.colors.secondaryBg,
          borderRadius: '8px',
          padding: '16px',
          marginBottom: '20px',
          border: `1px solid ${theme.colors.border}`
        }}>
          <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            marginBottom: '8px',
            color: theme.colors.primaryText
          }}>
            <span style={{ color: theme.colors.mutedText }}>Amount:</span>
            <span style={{ fontWeight: '500' }}>{formatAmount(tokenLock.amount, token.decimals)} {token.symbol}</span>
          </div>
          <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            color: theme.colors.primaryText
          }}>
            <span style={{ color: theme.colors.mutedText }}>Expires:</span>
            <span style={{ fontWeight: '500' }}>{dateToReadable(tokenLock.expiry)}</span>
          </div>
        </div>

        {/* Fee Info Box */}
        <div style={{
          background: theme.colors.secondaryBg,
          borderRadius: '8px',
          padding: '16px',
          marginBottom: '16px',
          border: `1px solid ${theme.colors.border}`
        }}>
          <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            color: theme.colors.primaryText
          }}>
            <span style={{ color: theme.colors.mutedText }}>Transaction Fee:</span>
            <span style={{ fontWeight: '500' }}>
              {formatAmount(BigInt(token.fee) * BigInt(feeInfo.feesRequired), token.decimals)} {token.symbol}
              {feeInfo.needsPreSend && (
                <span style={{ 
                  fontSize: '0.85rem', 
                  color: theme.colors.mutedText, 
                  marginLeft: '4px' 
                }}>
                  (2 tx fees)
                </span>
              )}
            </span>
          </div>
          {feeInfo.needsPreSend && (
            <div style={{
              marginTop: '8px',
              fontSize: '0.85rem',
              color: theme.colors.secondaryText,
              lineHeight: '1.4'
            }}>
              Your backend subaccount needs at least 1 tx fee of liquid tokens. 
              1 tx fee will be sent from your wallet first.
            </div>
          )}
        </div>

        {/* Warning Box */}
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
            Only transfer locked tokens to Sneed Wallet principals that support Sneed Lock! 
            Transferring to incompatible wallets (exchanges, other wallet types) may result in permanent loss of access.
          </div>
        </div>

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
            <span style={{ color: theme.colors.mutedText, fontSize: '0.85rem' }}>Transferring...</span>
          </div>
        ) : (
          <div style={{
            display: 'flex',
            gap: '12px',
            marginTop: '20px'
          }}>
            <button 
              onClick={handleTransfer} 
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
              Transfer
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

export default TransferTokenLockModal;

