// SendLiquidityPositionModal.jsx
import React, { useState, useEffect } from 'react';
import './SendLiquidityPositionModal.css'; // Create this CSS file for styling
import { Principal } from "@dfinity/principal";
import ConfirmationModal from './ConfirmationModal';

function SendLiquidityPositionModal({ show, onClose, onSend, liquidityPosition }) {
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
    <div className="modal-backdrop">
      <div className="modal-content">
        <h2>Send {liquidityPosition.symbols} Position # {liquidityPosition.id.toString()}</h2>
        <label>
          Recipient Address:
          <input 
            type="text" 
            value={recipient}
            onChange={(e) => setRecipient(e.target.value)}
          />
        </label>
        {errorText && <p className="error-text">{errorText}</p>}
        {isLoading ? (
            <div className="spinner"></div>
          ) : (
            <div className="button-group">
              <button onClick={handleSend} disabled={isLoading}>Send</button>
              <button onClick={onClose} disabled={isLoading}>Cancel</button>
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
