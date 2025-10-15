// WithdrawTokenModal.jsx
import React, { useState, useEffect } from 'react';
import ConfirmationModal from './ConfirmationModal';
import { formatAmount } from './utils/StringUtils';
import { useTheme } from './contexts/ThemeContext';

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
    console.log('=== WithdrawTokenModal.handleWithdraw START ===');
    console.log('Input values:', { amount, tokenSymbol: token.symbol });
    
    setErrorText('');

    if (amount === "") {
      console.log('ERROR: Empty amount');
      setErrorText("Please enter an amount first!");
      return;
    }

    // Convert to BigInt safely - handle decimal inputs from formatAmount
    const amountFloat = parseFloat(amount);
    console.log('Amount parsing:', { 
      originalAmount: amount, 
      amountFloat, 
      isNaN: isNaN(amountFloat),
      isPositive: amountFloat > 0 
    });
    
    if (isNaN(amountFloat) || amountFloat <= 0) {
      console.log('ERROR: Invalid amount after parsing');
      setErrorText("Invalid amount! Please enter a positive amount.");
      return;
    }
    
    const scaledAmount = amountFloat * (10 ** token.decimals);
    const bigIntAmount = BigInt(Math.floor(scaledAmount));
    
    console.log('BigInt conversion:', {
      decimals: token.decimals,
      scaledAmount,
      bigIntAmount: bigIntAmount.toString(),
      availableBackend: token.available_backend.toString(),
      tokenFee: token.fee.toString()
    });

    // Max allowed is backend balance minus 1 tx fee
    const maxAllowed = BigInt(token.available_backend) - BigInt(token.fee);
    
    console.log('Balance validation:', {
      bigIntAmount: bigIntAmount.toString(),
      availableBackend: token.available_backend.toString(),
      maxAllowed: maxAllowed.toString(),
      isExceeded: bigIntAmount > maxAllowed
    });

    if (bigIntAmount > maxAllowed) {
      console.log('ERROR: Insufficient backend balance');
      setErrorText(`Insufficient backend balance! Remember that withdrawing requires 1 transaction fee.`);
      return;
    }

    if (token.available_backend <= BigInt(token.fee)) {
      console.log('ERROR: Backend balance too small to cover fee');
      setErrorText(`Backend balance is too small to cover the transaction fee of ${formatAmount(token.fee, token.decimals)} ${token.symbol}.`);
      return;
    }

    console.log('All validations passed, setting up confirmation');

    setConfirmAction(() => async () => {
      console.log('=== CONFIRMATION ACTION START ===');
      try {
        setIsLoading(true);
        setErrorText('');
        console.log('About to call onWithdraw with:', { token: token.symbol, amount });
        await onWithdraw(token, amount);
        console.log('onWithdraw completed successfully');
        onClose();
        console.log('Modal closed');
      } catch (error) {
        console.error('ERROR in confirmation action:', error);
        setErrorText(`Error withdrawing tokens: ${error.message || error.toString()}`);
      } finally {
        setIsLoading(false);
        console.log('=== CONFIRMATION ACTION END ===');
      }
    });

    setConfirmMessage(`You are about to withdraw ${amount} ${token.symbol} from your deposited balance. This will cost ${formatAmount(token.fee, token.decimals)} ${token.symbol} in transaction fees.`);
    setShowConfirmModal(true);
    console.log('=== WithdrawTokenModal.handleWithdraw END ===');
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
          Withdraw {token.symbol} from Backend
        </h2>
        
        {/* Backend Balance Info */}
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
            color: theme.colors.primaryText
          }}>
            <span style={{ color: theme.colors.mutedText }}>Backend Balance:</span>
            <span style={{ fontWeight: '500' }}>{formatAmount(token.available_backend, token.decimals)} {token.symbol}</span>
          </div>
        </div>

        <div style={{ marginBottom: '20px' }}>
          <label style={{
            display: 'block',
            color: theme.colors.primaryText,
            marginBottom: '8px',
            fontWeight: '500'
          }}>
            Amount to Withdraw:
          </label>
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '10px'
          }}>
            <input 
              type="number" 
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.00"
              style={{
                flex: '1',
                padding: '12px',
                background: theme.colors.secondaryBg,
                border: `1px solid ${theme.colors.border}`,
                borderRadius: '8px',
                color: theme.colors.primaryText,
                fontSize: '0.9rem',
                boxSizing: 'border-box'
              }}
            />
            <button 
              onClick={handleSetMax}
              style={{
                background: theme.colors.accent,
                color: theme.colors.primaryBg,
                border: 'none',
                borderRadius: '8px',
                padding: '12px 16px',
                cursor: 'pointer',
                fontSize: '0.85rem',
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
              MAX
            </button>
          </div>
        </div>

        <div style={{ marginBottom: '20px' }}>
          <label style={{
            display: 'block',
            color: theme.colors.secondaryText,
            fontSize: '0.9rem'
          }}>
            Transaction Fee: {formatAmount(token.fee, token.decimals)} {token.symbol}
          </label>
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
              onClick={handleWithdraw} 
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
              Withdraw
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
          doAwait={false}
          />
    </div>
  );
}

export default WithdrawTokenModal;

