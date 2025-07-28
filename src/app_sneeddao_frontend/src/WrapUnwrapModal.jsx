// WrapUnwrapModal.jsx
import React, { useState, useEffect } from 'react';
import './SendTokenModal.css'; // Reuse the same CSS styling
import ConfirmationModal from './ConfirmationModal';
import { formatAmount } from './utils/StringUtils';

// Constants for GLDT and sGLDT canister IDs
const GLDT_CANISTER_ID = '6c7su-kiaaa-aaaar-qaira-cai';
const SGLDT_CANISTER_ID = 'i2s4q-syaaa-aaaan-qz4sq-cai';

function WrapUnwrapModal({ show, onClose, onWrap, onUnwrap, token, gldtToken }) {
  const [amount, setAmount] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [errorText, setErrorText] = useState('');
  const [showConfirmModal, setShowConfirmModal] = useState(false);  
  const [confirmAction, setConfirmAction] = useState(null);
  const [confirmMessage, setConfirmMessage] = useState('');

  const isWrapMode = token?.ledger_canister_id === GLDT_CANISTER_ID;
  const isUnwrapMode = token?.ledger_canister_id === SGLDT_CANISTER_ID;

  useEffect(() => {
    if (show) {
        setErrorText('');
        setAmount('');
    }
  }, [show]);

  const handleSetMax = () => {
    if (isWrapMode) {
      // For wrap: max = entire GLDT balance
      setAmount(formatAmount(token.available, token.decimals));
    } else if (isUnwrapMode) {
      // For unwrap: max = full sGLDT balance (no tx fee for burning)
      setAmount(formatAmount(token.available, token.decimals));
    }
  };

  const calculateExpectedResult = () => {
    if (!amount || !gldtToken) return '';
    
    const bigIntAmount = BigInt(amount * (10 ** token.decimals));
    
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
    
    return '';
  };

  const handleOperation = async () => {
    setErrorText('');
    
    if (amount === "") {
      setErrorText("Please enter an amount first!");
      return;
    }

    const bigIntAmount = BigInt(amount * (10 ** token.decimals));
    if (bigIntAmount <= 0n) {
      setErrorText("Invalid amount! Please enter a positive amount.");
      return;
    }

    if (isWrapMode) {
      // Validate wrap amount
      if (bigIntAmount > token.available) {
        setErrorText("Insufficient available balance!");
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
      // Validate unwrap amount
      if (bigIntAmount > token.available) {
        setErrorText("Insufficient available balance!");
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
    <div className="modal-backdrop">
      <div className="modal-content">
        <h2>{description}</h2>
        <label>
          Amount:
          <div className="amount-input-container">
            <input 
              type="number" 
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
            <button className="max-button" onClick={handleSetMax}>MAX</button>
          </div>
        </label>
        
        {isWrapMode && (
          <div className="fee-info">
            <p><strong>Wrapping Process:</strong></p>
            <p>• Approve call: {formatAmount(token.fee, token.decimals)} {token.symbol} fee</p>
            <p>• Transfer call: {formatAmount(token.fee, token.decimals)} {token.symbol} fee</p>
            <p>• Total Cost: {formatAmount(2n * token.fee, token.decimals)} {token.symbol} (all tx fees)</p>
          </div>
        )}
        
        {isUnwrapMode && gldtToken && (
          <div className="fee-info">
            <p><strong>Unwrapping Process:</strong></p>
            <p>• Transaction Fee: {formatAmount(gldtToken.fee, gldtToken.decimals)} GLDT</p>
            <p>• Unwrapping Fee: {formatAmount(2n * gldtToken.fee, gldtToken.decimals)} GLDT</p>
            <p>• Total Cost: {formatAmount(3n * gldtToken.fee, gldtToken.decimals)} GLDT</p>
          </div>
        )}
        
        {amount && gldtToken && (
          <div className="expected-result">
            <p><strong>{calculateExpectedResult()}</strong></p>
          </div>
        )}
        
        {errorText && <p className="error-text">{errorText}</p>}
        {isLoading ? (
            <div className="spinner"></div>
          ) : (
            <div className="button-group">
              <button onClick={handleOperation} disabled={isLoading}>{operationType}</button>
              <button className="cancel-button" onClick={onClose} disabled={isLoading}>Cancel</button>
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

export default WrapUnwrapModal; 