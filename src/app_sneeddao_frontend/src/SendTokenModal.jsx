// SendTokenModal.jsx
import React, { useState, useEffect } from 'react';
import './SendTokenModal.css'; // Create this CSS file for styling
import { Principal } from "@dfinity/principal";
import ConfirmationModal from './ConfirmationModal';
import { formatAmount } from './utils/StringUtils';
import PrincipalInput from './components/PrincipalInput';
import { useTheme } from './contexts/ThemeContext';

function SendTokenModal({ show, onClose, onSend, token }) {
  const { theme } = useTheme();
  const [recipient, setRecipient] = useState('');
  const [amount, setAmount] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [errorText, setErrorText] = useState('');
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [confirmAction, setConfirmAction] = useState(null);
  const [confirmMessage, setConfirmMessage] = useState('');
  const [logoLoaded, setLogoLoaded] = useState(false);

  useEffect(() => {
    if (show) {
        setErrorText('');
    }
  }, [show]);

  useEffect(() => {
    if (!show) return;
    setLogoLoaded(false);
    if (token?.logo) {
      const img = new Image();
      img.onload = () => setLogoLoaded(true);
      img.onerror = () => setLogoLoaded(false);
      img.src = token.logo;
    }
  }, [show, token?.logo]);

  const handleSetMax = () => {
    // Check if we'll need to split the send between frontend and backend
    const willNeedSplit = token.available > token.balance;
    const feesNeeded = willNeedSplit ? 2n * token.fee : token.fee;
    
    console.log('MAX button calculation:', {
      tokenAvailable: token.available.toString(),
      tokenBalance: token.balance.toString(), 
      willNeedSplit,
      feesNeeded: feesNeeded.toString(),
      calculation: `${token.available.toString()} - ${feesNeeded.toString()}`
    });
    
    var max = token.available - feesNeeded;
    if (max < 0n) { max = 0n; }
    setAmount(formatAmount(max, token.decimals));
  };

  const handleSend = async () => {
    console.log('=== SendTokenModal.handleSend START ===');
    console.log('Input values:', { recipient, amount, tokenSymbol: token.symbol });
    
    setErrorText('');
    
    if (recipient == "") {
      console.log('ERROR: Empty recipient');
      setErrorText("Please enter a recipient address first!");
      return;
    }
    
    // PrincipalInput component ensures recipient is valid, so no need for additional validation
    console.log('Recipient Principal validation: SUCCESS (handled by PrincipalInput)');

    if (amount == "") {
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
      tokenAvailable: token.available.toString(),
      tokenFee: token.fee.toString()
    });

    // Check if we'll need to split the send and adjust max allowed accordingly
    const willNeedSplit = token.available > token.balance;
    const feesNeeded = willNeedSplit ? 2n * BigInt(token.fee) : BigInt(token.fee);
    const maxAllowed = BigInt(token.available) - feesNeeded;
    
    console.log('Balance validation:', {
      bigIntAmount: bigIntAmount.toString(),
      tokenAvailable: token.available.toString(),
      tokenBalance: token.balance.toString(),
      willNeedSplit,
      feesNeeded: feesNeeded.toString(),
      maxAllowed: maxAllowed.toString(),
      isExceeded: bigIntAmount > maxAllowed
    });

    if (bigIntAmount > maxAllowed) {
      console.log('ERROR: Insufficient balance');
      const feeMsg = willNeedSplit ? 
        "Remember that sending requires 2 transaction fees when splitting between wallets." :
        "Remember that sending requires 1 transaction fee.";
      setErrorText(`Insufficient available balance! ${feeMsg}`);
      return;
    }

    console.log('All validations passed, setting up confirmation');

    setConfirmAction(() => async () => {
      console.log('=== CONFIRMATION ACTION START ===');
      try {
        setIsLoading(true);
        setErrorText('');
        console.log('About to call onSend with:', { token: token.symbol, recipient, amount });
        await onSend(token, recipient, amount);
        console.log('onSend completed successfully');
        onClose();
        console.log('Modal closed');
      } catch (error) {
        console.error('ERROR in confirmation action:', error);
        setErrorText('Error sending tokens:', error);
      } finally {
        setIsLoading(false);
        console.log('=== CONFIRMATION ACTION END ===');
      }
    });

    setConfirmMessage(`You are about to send ${amount} ${token.symbol} to ${recipient}.`);
    setShowConfirmModal(true);
    console.log('=== SendTokenModal.handleSend END ===');
  };

  if (!show || !token) {
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
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '16px', marginBottom: '24px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            {token.logo && logoLoaded ? (
              <img
                src={token.logo}
                alt={`${token.symbol} logo`}
                style={{ width: '28px', height: '28px', borderRadius: '8px', objectFit: 'contain', background: theme.colors.tertiaryBg, border: `1px solid ${theme.colors.border}` }}
              />
            ) : (
              <div style={{ width: '28px', height: '28px', borderRadius: '8px', background: theme.colors.tertiaryBg, border: `1px solid ${theme.colors.border}` }} />
            )}
            <h2 style={{
              color: theme.colors.primaryText,
              margin: 0,
              fontSize: '1.5rem',
              fontWeight: '600'
            }}>
              Send {token.symbol}
            </h2>
          </div>

          <div style={{ textAlign: 'right' }}>
            <div style={{ color: theme.colors.mutedText, fontSize: '12px', marginBottom: '4px' }}>Available balance</div>
            <div style={{ color: theme.colors.primaryText, fontWeight: 700 }}>
              {formatAmount(token.available ?? token.balance ?? 0n, token.decimals)} {token.symbol}
            </div>
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
              maxWidth: 'none'
            }}
          />
        </div>

        <div style={{ marginBottom: '20px' }}>
          <label style={{
            display: 'block',
            color: theme.colors.primaryText,
            marginBottom: '8px',
            fontWeight: '500'
          }}>
            Amount:
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
            Fee: {formatAmount(token.fee, token.decimals)} {token.symbol}
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
          doAwait={false}
          />
    </div>
  );
}

export default SendTokenModal;
