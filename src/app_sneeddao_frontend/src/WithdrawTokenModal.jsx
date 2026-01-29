// WithdrawTokenModal.jsx
import React, { useState, useEffect } from 'react';
import ConfirmationModal from './ConfirmationModal';
import { formatAmount } from './utils/StringUtils';
import { useTheme } from './contexts/ThemeContext';

// Accent colors matching wallet page
const walletPrimary = '#10b981';
const walletSecondary = '#059669';
const withdrawColor = '#f59e0b';
const withdrawColorDark = '#d97706';

function WithdrawTokenModal({ show, onClose, onWithdraw, token }) {
  const { theme } = useTheme();
  const [amount, setAmount] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [errorText, setErrorText] = useState('');
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [confirmAction, setConfirmAction] = useState(null);
  const [confirmMessage, setConfirmMessage] = useState('');

  useEffect(() => {
    if (show) {
        setErrorText('');
        setAmount('');
    }
  }, [show]);

  const handleSetMax = () => {
    // Max is backend available balance minus 1 tx fee
    const max = token.available_backend - BigInt(token.fee);
    if (max < 0n) {
      setAmount('0');
    } else {
      setAmount(formatAmount(max, token.decimals));
    }
  };

  const handleWithdraw = async () => {
    setErrorText('');

    if (amount === "") {
      setErrorText("Please enter an amount first!");
      return;
    }

    const amountFloat = parseFloat(amount);
    if (isNaN(amountFloat) || amountFloat <= 0) {
      setErrorText("Invalid amount! Please enter a positive amount.");
      return;
    }
    
    const scaledAmount = amountFloat * (10 ** token.decimals);
    const bigIntAmount = BigInt(Math.floor(scaledAmount));
    const maxAllowed = BigInt(token.available_backend) - BigInt(token.fee);

    if (bigIntAmount > maxAllowed) {
      setErrorText(`Insufficient backend balance! Remember that withdrawing requires 1 transaction fee.`);
      return;
    }

    if (token.available_backend <= BigInt(token.fee)) {
      setErrorText(`Backend balance is too small to cover the transaction fee of ${formatAmount(token.fee, token.decimals)} ${token.symbol}.`);
      return;
    }

    setConfirmAction(() => async () => {
      try {
        setIsLoading(true);
        setErrorText('');
        await onWithdraw(token, amount);
        onClose();
      } catch (error) {
        console.error('ERROR in confirmation action:', error);
        setErrorText(`Error withdrawing tokens: ${error.message || error.toString()}`);
      } finally {
        setIsLoading(false);
      }
    });

    setConfirmMessage(`You are about to withdraw ${amount} ${token.symbol} from your deposited balance. This will cost ${formatAmount(token.fee, token.decimals)} ${token.symbol} in transaction fees.`);
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
      background: 'rgba(0, 0, 0, 0.75)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 1000,
      backdropFilter: 'blur(4px)'
    }}>
      <div style={{
        background: `linear-gradient(135deg, ${theme.colors.primaryBg} 0%, ${withdrawColor}08 100%)`,
        border: `1px solid ${theme.colors.border}`,
        boxShadow: `0 20px 60px rgba(0, 0, 0, 0.4), 0 0 40px ${withdrawColor}15`,
        borderRadius: '16px',
        padding: '0',
        width: '450px',
        maxWidth: '90vw',
        maxHeight: '90vh',
        overflow: 'hidden'
      }}>
        {/* Header */}
        <div style={{
          background: `linear-gradient(135deg, ${withdrawColor}, ${withdrawColorDark})`,
          padding: '1.25rem 1.5rem',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between'
        }}>
          <h2 style={{
            color: 'white',
            margin: 0,
            fontSize: '1.2rem',
            fontWeight: '600',
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem'
          }}>
            ↑ Withdraw {token.symbol}
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
              justifyContent: 'center'
            }}
          >
            ×
          </button>
        </div>
        
        <div style={{ padding: '1.5rem' }}>
          {/* Backend Balance Info */}
          <div style={{
            background: `linear-gradient(135deg, ${theme.colors.secondaryBg} 0%, ${withdrawColor}08 100%)`,
            borderRadius: '12px',
            padding: '1rem',
            marginBottom: '1.25rem',
            border: `1px solid ${withdrawColor}25`
          }}>
            <div style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              color: theme.colors.primaryText
            }}>
              <span style={{ color: theme.colors.mutedText, fontSize: '0.85rem' }}>Deposited Balance:</span>
              <span style={{ fontWeight: '600', color: withdrawColor }}>
                {formatAmount(token.available_backend, token.decimals)} {token.symbol}
              </span>
            </div>
          </div>

          <div style={{ marginBottom: '1.25rem' }}>
            <label style={{
              display: 'block',
              color: theme.colors.primaryText,
              marginBottom: '0.5rem',
              fontWeight: '500',
              fontSize: '0.9rem'
            }}>
              Amount to Withdraw
            </label>
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.75rem'
            }}>
              <input 
                type="number" 
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0.00"
                style={{
                  flex: '1',
                  padding: '0.875rem',
                  background: theme.colors.secondaryBg,
                  border: `1px solid ${theme.colors.border}`,
                  borderRadius: '10px',
                  color: theme.colors.primaryText,
                  fontSize: '1rem',
                  boxSizing: 'border-box',
                  outline: 'none'
                }}
              />
              <button 
                onClick={handleSetMax}
                style={{
                  background: `linear-gradient(135deg, ${withdrawColor}, ${withdrawColorDark})`,
                  color: 'white',
                  border: 'none',
                  borderRadius: '10px',
                  padding: '0.875rem 1rem',
                  cursor: 'pointer',
                  fontSize: '0.85rem',
                  fontWeight: '600',
                  transition: 'all 0.2s ease',
                  boxShadow: `0 2px 8px ${withdrawColor}40`
                }}
              >
                MAX
              </button>
            </div>
          </div>

          <div style={{ 
            marginBottom: '1.25rem',
            padding: '0.75rem 1rem',
            background: theme.colors.tertiaryBg,
            borderRadius: '8px',
            fontSize: '0.85rem',
            color: theme.colors.secondaryText
          }}>
            Transaction Fee: <span style={{ color: theme.colors.primaryText, fontWeight: '500' }}>
              {formatAmount(token.fee, token.decimals)} {token.symbol}
            </span>
          </div>

          {errorText && (
            <p style={{
              color: '#ef4444',
              marginBottom: '1.25rem',
              padding: '0.875rem',
              background: 'rgba(239, 68, 68, 0.1)',
              border: '1px solid rgba(239, 68, 68, 0.3)',
              borderRadius: '10px',
              fontSize: '0.85rem'
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
                border: `3px solid ${withdrawColor}30`,
                borderTop: `3px solid ${withdrawColor}`,
                borderRadius: '50%',
                animation: 'withdrawSpin 0.8s linear infinite'
              }}></div>
            </div>
          ) : (
            <div style={{
              display: 'flex',
              gap: '0.75rem'
            }}>
              <button 
                onClick={onClose} 
                disabled={isLoading}
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
                onClick={handleWithdraw} 
                disabled={isLoading}
                style={{
                  flex: '1',
                  background: `linear-gradient(135deg, ${withdrawColor}, ${withdrawColorDark})`,
                  color: 'white',
                  border: 'none',
                  borderRadius: '10px',
                  padding: '0.875rem 1.5rem',
                  cursor: 'pointer',
                  fontSize: '0.9rem',
                  fontWeight: '600',
                  transition: 'all 0.2s ease',
                  boxShadow: `0 4px 15px ${withdrawColor}40`
                }}
              >
                Withdraw
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
        doAwait={false}
      />
      
      <style>{`
        @keyframes withdrawSpin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}

export default WithdrawTokenModal;
