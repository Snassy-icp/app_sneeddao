// WrapUnwrapModal.jsx
import React, { useState, useEffect } from 'react';
import ConfirmationModal from './ConfirmationModal';
import { formatAmount } from './utils/StringUtils';
import { useTheme } from './contexts/ThemeContext';

// Constants for GLDT and sGLDT canister IDs
const GLDT_CANISTER_ID = '6c7su-kiaaa-aaaar-qaira-cai';
const SGLDT_CANISTER_ID = 'i2s4q-syaaa-aaaan-qz4sq-cai';

// Accent colors 
const wrapPrimary = '#8b5cf6'; // Purple for wrap/unwrap
const wrapSecondary = '#7c3aed';

function WrapUnwrapModal({ show, onClose, onWrap, onUnwrap, token, gldtToken }) {
  const { theme } = useTheme();
  const [amount, setAmount] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [errorText, setErrorText] = useState('');
  const [showConfirmModal, setShowConfirmModal] = useState(false);  
  const [confirmAction, setConfirmAction] = useState(null);
  const [confirmMessage, setConfirmMessage] = useState('');

  const tokenLedgerId = token?.ledger_canister_id?.toText?.() || token?.ledger_canister_id?.toString?.() || token?.principal;
  const isWrapMode = tokenLedgerId === GLDT_CANISTER_ID;
  const isUnwrapMode = tokenLedgerId === SGLDT_CANISTER_ID;
  
  /*console.log('WrapUnwrapModal mode detection:', {
    token_symbol: token?.symbol,
    ledger_id: token?.ledger_canister_id?.toText(),
    GLDT_CANISTER_ID,
    SGLDT_CANISTER_ID,
    isWrapMode,
    isUnwrapMode,
    gldtToken: gldtToken ? `${gldtToken.symbol} (${gldtToken.ledger_canister_id?.toText()})` : 'not found'
  });*/

  useEffect(() => {
    if (show) {
        setErrorText('');
        setAmount('');
    }
  }, [show]);

  const handleSetMax = () => {
    if (isWrapMode) {
      // For wrap: max = entire frontend GLDT balance only
      setAmount(formatAmount(token.balance, token.decimals));
    } else if (isUnwrapMode) {
      // For unwrap: max = full frontend sGLDT balance only (no tx fee for burning)
      setAmount(formatAmount(token.balance, token.decimals));
    }
  };

  const calculateExpectedResult = () => {
    if (!amount || !gldtToken) return '';
    
    try {
      // Convert to BigInt safely - handle decimal inputs by multiplying first then flooring
      const amountFloat = parseFloat(amount);
      if (isNaN(amountFloat)) return '';
      
      const scaledAmount = amountFloat * (10 ** token.decimals);
      const bigIntAmount = BigInt(Math.floor(scaledAmount));
      
      if (isWrapMode) {
        // Wrapping: costs 2 GLDT tx fees total, gets back (amount - 2 tx fees) sGLDT
        const gldtFee = gldtToken.fee;
        const totalCost = 2n * gldtFee; // 2 GLDT tx fees
        const expectedSGLDT = bigIntAmount - totalCost;
        return `Expected result: ${formatAmount(expectedSGLDT > 0n ? expectedSGLDT : 0n, token.decimals)} sGLDT (costs ${formatAmount(totalCost, gldtToken.decimals)} GLDT in fees)`;
      } else if (isUnwrapMode) {
        // Unwrapping: costs 0.1 GLDT tx fee + 0.2 GLDT unwrapping fee = 0.3 GLDT total
        const gldtFee = gldtToken.fee;
        const txFee = gldtFee; // 1 GLDT tx fee
        const unwrapFee = 2n * gldtFee; // 2 GLDT unwrapping fee
        const totalCost = txFee + unwrapFee; // 3 GLDT total
        const expectedGLDT = bigIntAmount - totalCost;
        return `Expected result: ${formatAmount(expectedGLDT > 0n ? expectedGLDT : 0n, gldtToken.decimals)} GLDT (costs ${formatAmount(totalCost, gldtToken.decimals)} GLDT in fees)`;
      }
    } catch (error) {
      console.error('Error calculating expected result:', error);
      return 'Error calculating expected result';
    }
    
    return '';
  };

  const handleOperation = async () => {
    setErrorText('');
    
    if (amount === "") {
      setErrorText("Please enter an amount first!");
      return;
    }

    // Convert to BigInt safely - handle decimal inputs
    const amountFloat = parseFloat(amount);
    if (isNaN(amountFloat) || amountFloat <= 0) {
      setErrorText("Invalid amount! Please enter a positive amount.");
      return;
    }
    
    const scaledAmount = amountFloat * (10 ** token.decimals);
    const bigIntAmount = BigInt(Math.floor(scaledAmount));

    if (!gldtToken) {
      setErrorText("GLDT token not found. Please add GLDT to your wallet first.");
      return;
    }

    // Check minimum amounts
    if (isWrapMode) {
      // Minimum wrap: 0.7 GLDT
      const minWrapAmount = BigInt(Math.floor(0.7 * (10 ** token.decimals))); // 0.7 GLDT
      if (bigIntAmount < minWrapAmount) {
        setErrorText("Minimum wrap amount is 0.7 GLDT.");
        return;
      }
    } else if (isUnwrapMode) {
      // Minimum unwrap: 0.4 sGLDT  
      const minUnwrapAmount = BigInt(Math.floor(0.4 * (10 ** token.decimals))); // 0.4 sGLDT
      if (bigIntAmount < minUnwrapAmount) {
        setErrorText("Minimum unwrap amount is 0.4 sGLDT.");
        return;
      }
    }

    if (isWrapMode) {
      // Validate wrap amount against frontend balance only
      if (bigIntAmount > token.balance) {
        setErrorText("Insufficient frontend balance!");
        return;
      }
      // Check if amount is large enough to cover fees
      const gldtFee = gldtToken.fee;
      const totalCost = 2n * gldtFee;
      if (bigIntAmount <= totalCost) {
        setErrorText(`Amount too small! Must be larger than ${formatAmount(totalCost, gldtToken.decimals)} GLDT to cover transaction fees.`);
        return;
      }
    } else if (isUnwrapMode) {
      // Validate unwrap amount against frontend balance only
      if (bigIntAmount > token.balance) {
        setErrorText("Insufficient frontend balance!");
        return;
      }
      // Check if amount is large enough to cover fees (for unwrap, need to have enough to pay the fees)
      const gldtFee = gldtToken.fee;
      const totalCost = 3n * gldtFee; // 1 tx fee + 2 unwrapping fee
      if (bigIntAmount <= totalCost) {
        setErrorText(`Amount too small! Must be larger than ${formatAmount(totalCost, gldtToken.decimals)} GLDT equivalent to cover transaction fees.`);
        return;
      }
    }

    const operationType = isWrapMode ? 'wrap' : 'unwrap';
    const resultTokenSymbol = isWrapMode ? 'sGLDT' : 'GLDT';
    
    setConfirmAction(() => async () => {
      try {
        setIsLoading(true);
        setErrorText('');
        
        if (isWrapMode) {
          await onWrap(token, amount);
        } else if (isUnwrapMode) {
          await onUnwrap(token, amount);
        }
        
        onClose();
      } catch (error) {
        setErrorText(`Error ${operationType}ping tokens: ${error.message || error}`);
      } finally {
        setIsLoading(false);
      }
    });

    setConfirmMessage(`You are about to ${operationType} ${amount} ${token.symbol}. ${calculateExpectedResult()}`);
    setShowConfirmModal(true);
  };

  if (!show) {
    return null;
  }

  const operationType = isWrapMode ? 'Wrap' : 'Unwrap';
  const description = isWrapMode 
    ? `${operationType} ${token.symbol} to sGLDT`
    : `${operationType} ${token.symbol} to GLDT`;

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
        background: `linear-gradient(135deg, ${theme.colors.primaryBg} 0%, ${wrapPrimary}08 100%)`,
        border: `1px solid ${theme.colors.border}`,
        boxShadow: `0 20px 60px rgba(0, 0, 0, 0.4), 0 0 40px ${wrapPrimary}15`,
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
          background: `linear-gradient(135deg, ${wrapPrimary}, ${wrapSecondary})`,
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
            🔄 {description}
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
              opacity: isLoading ? 0.5 : 1,
              transition: 'all 0.2s ease'
            }}
          >
            ×
          </button>
        </div>

        {/* Content */}
        <div style={{ padding: '1.25rem', flex: 1, overflowY: 'auto' }}>
          {/* Amount Input */}
          <div style={{ marginBottom: '20px' }}>
            <label style={{
              display: 'block',
              color: theme.colors.primaryText,
              marginBottom: '8px',
              fontWeight: '500',
              fontSize: '0.9rem'
            }}>
              Amount:
            </label>
            <div style={{ display: 'flex', gap: '10px' }}>
              <input 
                type="text" 
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                style={{
                  flex: 1,
                  padding: '12px',
                  background: theme.colors.secondaryBg,
                  border: `1px solid ${theme.colors.border}`,
                  borderRadius: '10px',
                  color: theme.colors.primaryText,
                  fontSize: '0.9rem',
                  boxSizing: 'border-box'
                }}
              />
              <button 
                onClick={handleSetMax}
                style={{
                  background: `linear-gradient(135deg, ${wrapPrimary}, ${wrapSecondary})`,
                  color: 'white',
                  border: 'none',
                  borderRadius: '10px',
                  padding: '12px 16px',
                  cursor: 'pointer',
                  fontSize: '0.85rem',
                  fontWeight: '600'
                }}
              >
                MAX
              </button>
            </div>
          </div>
          
          {/* Fee Info */}
          {isWrapMode && (
            <div style={{
              background: `${wrapPrimary}10`,
              border: `1px solid ${wrapPrimary}25`,
              borderRadius: '12px',
              padding: '14px 16px',
              marginBottom: '16px',
              fontSize: '0.85rem'
            }}>
              <p style={{ color: theme.colors.primaryText, fontWeight: '600', margin: '0 0 8px 0' }}>Wrapping Process:</p>
              <p style={{ color: theme.colors.secondaryText, margin: '4px 0' }}>• Approve call: {formatAmount(token.fee, token.decimals)} {token.symbol} fee</p>
              <p style={{ color: theme.colors.secondaryText, margin: '4px 0' }}>• Transfer call: {formatAmount(token.fee, token.decimals)} {token.symbol} fee</p>
              <p style={{ color: wrapPrimary, margin: '8px 0 0 0', fontWeight: '600' }}>• Total Cost: {formatAmount(2n * token.fee, token.decimals)} {token.symbol}</p>
            </div>
          )}
          
          {isUnwrapMode && gldtToken && (
            <div style={{
              background: `${wrapPrimary}10`,
              border: `1px solid ${wrapPrimary}25`,
              borderRadius: '12px',
              padding: '14px 16px',
              marginBottom: '16px',
              fontSize: '0.85rem'
            }}>
              <p style={{ color: theme.colors.primaryText, fontWeight: '600', margin: '0 0 8px 0' }}>Unwrapping Process:</p>
              <p style={{ color: theme.colors.secondaryText, margin: '4px 0' }}>• Transaction Fee: {formatAmount(gldtToken.fee, gldtToken.decimals)} GLDT</p>
              <p style={{ color: theme.colors.secondaryText, margin: '4px 0' }}>• Unwrapping Fee: {formatAmount(2n * gldtToken.fee, gldtToken.decimals)} GLDT</p>
              <p style={{ color: wrapPrimary, margin: '8px 0 0 0', fontWeight: '600' }}>• Total Cost: {formatAmount(3n * gldtToken.fee, gldtToken.decimals)} GLDT</p>
            </div>
          )}
          
          {/* Expected Result */}
          {amount && gldtToken && (
            <div style={{
              background: `linear-gradient(135deg, ${wrapPrimary}15 0%, ${wrapSecondary}10 100%)`,
              border: `1px solid ${wrapPrimary}30`,
              borderRadius: '12px',
              padding: '14px 16px',
              marginBottom: '16px'
            }}>
              <p style={{ color: wrapPrimary, fontWeight: '600', margin: 0, fontSize: '0.9rem' }}>
                {calculateExpectedResult()}
              </p>
            </div>
          )}
          
          {/* Error */}
          {errorText && (
            <div style={{
              background: `${theme.colors.error}15`,
              border: `1px solid ${theme.colors.error}30`,
              borderRadius: '10px',
              padding: '12px',
              marginBottom: '16px',
              color: theme.colors.error,
              fontSize: '0.85rem'
            }}>
              {errorText}
            </div>
          )}

          {/* Buttons */}
          {isLoading ? (
            <div style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '20px'
            }}>
              <div style={{
                width: '28px',
                height: '28px',
                border: `3px solid ${theme.colors.border}`,
                borderTop: `3px solid ${wrapPrimary}`,
                borderRadius: '50%',
                animation: 'spin 1s linear infinite',
                marginBottom: '10px'
              }}></div>
              <span style={{ color: theme.colors.mutedText, fontSize: '0.85rem' }}>Processing...</span>
            </div>
          ) : (
            <div style={{ display: 'flex', gap: '12px', marginTop: '20px' }}>
              <button 
                onClick={handleOperation} 
                disabled={isLoading}
                style={{
                  flex: 2,
                  background: `linear-gradient(135deg, ${wrapPrimary}, ${wrapSecondary})`,
                  color: 'white',
                  border: 'none',
                  borderRadius: '10px',
                  padding: '14px 24px',
                  cursor: 'pointer',
                  fontSize: '0.95rem',
                  fontWeight: '600',
                  boxShadow: `0 4px 12px ${wrapPrimary}40`
                }}
              >
                {operationType}
              </button>
              <button 
                onClick={onClose} 
                disabled={isLoading}
                style={{
                  flex: 1,
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
          doAwait={false}
          />
    </div>
  );
}

export default WrapUnwrapModal; 