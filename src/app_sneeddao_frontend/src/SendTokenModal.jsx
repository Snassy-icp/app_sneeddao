// SendTokenModal.jsx
import React, { useState, useEffect } from 'react';
import './SendTokenModal.css'; // Create this CSS file for styling
import { Principal } from "@dfinity/principal";
import ConfirmationModal from './ConfirmationModal';
import { formatAmount } from './utils/StringUtils';

function SendTokenModal({ show, onClose, onSend, token }) {
  const [recipient, setRecipient] = useState('');
  const [amount, setAmount] = useState('');
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
    
    try {
      var p = Principal.fromText(recipient);
      console.log('Recipient Principal validation: SUCCESS');
    } catch {
      console.log('ERROR: Invalid recipient address');
      setErrorText("Invalid recipient address! Please enter a valid recipient address.");
      return;
    }

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

  if (!show) {
    return null;
  }

  return (
    <div className="modal-backdrop">
      <div className="modal-content">
        <h2>Send {token.symbol} Token</h2>
        <label>
          Recipient Address:
          <input 
            type="text" 
            value={recipient}
            onChange={(e) => setRecipient(e.target.value)}
          />
        </label>
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
        <label>
          Fee: {formatAmount(token.fee, token.decimals)} {token.symbol}
        </label>
        {errorText && <p className="error-text">{errorText}</p>}
        {isLoading ? (
            <div className="spinner"></div>
          ) : (
            <div className="button-group">
              <button onClick={handleSend} disabled={isLoading}>Send</button>
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

export default SendTokenModal;
