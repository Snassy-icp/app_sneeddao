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
    var max = token.available - token.fee;
    if (max < 0n) { max = 0n; }
    setAmount(formatAmount(max, token.decimals));
  };

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

    if (amount == "") {
      setErrorText("Please enter an amount first!");
      return;
    }

    const bigIntAmount = BigInt(amount * (10 ** token.decimals));
    if (bigIntAmount <= 0n) {
      setErrorText("Invalid amount! Please enter a positive amount.");
      return;
    }

    if (bigIntAmount > BigInt(token.available) - BigInt(token.fee)) {
      setErrorText("Insufficient available balance! Please enter an amount less than or equal to your available balance.");
      return;
    }

    setConfirmAction(() => async () => {
      try {
        setIsLoading(true);
        setErrorText('');
        await onSend(token, recipient, amount);
        onClose();
      } catch (error) {
        setErrorText('Error sending tokens:', error);
      } finally {
        setIsLoading(false);
      }
    });

    setConfirmMessage(`You are about to send ${amount} ${token.symbol} to ${recipient}.`);
    setShowConfirmModal(true);
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
