import React, { useState, useEffect } from 'react';
import { createActor as createLedgerActor } from 'external/icrc1_ledger';
import './AddLedgerCanisterModal.css';
import { Principal } from "@dfinity/principal";

function AddLedgerCanisterModal({ show, onClose, onSubmit }) {
  const [ledgerCanisterId, setLedgerCanisterId] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [errorText, setErrorText] = useState('');

  useEffect(() => {
    if (show) {
        setErrorText('');
    }
  }, [show]);

  const handleSubmit = async () => {
    setErrorText('');

    if (ledgerCanisterId == "") {
      setErrorText("Please enter a ledger canister id first!");
      return;
    }
    try {
      var p = Principal.fromText(ledgerCanisterId);
    } catch {
      setErrorText("Invalid canister id! Please enter a valid ledger canister id.");
      return;
    }
    try {
      const ledgerActor = createLedgerActor(ledgerCanisterId);
      const metadata = await ledgerActor.icrc1_metadata();
    } catch {
      setErrorText("Invalid ICRC1 ledger canister id! Please enter a valid ICRC1 ledger canister id.");
      return;
    }

    try {
      setIsLoading(true);
      setErrorText("");
      await onSubmit(ledgerCanisterId);
    } catch (error) {
      setErrorText("Error adding ledger canister: " + error);
    }
    finally {
      setIsLoading(false);
      onClose();
    }
  };

  if (!show) {
    return null;
  }

  return (
    <div className="modal-backdrop">
      <div className="modal-content">
        <h2>Add Token Ledger Canister</h2>
        <label>
          ICRC1 Token Ledger Canister Id:
          <input 
            type="text" 
            value={ledgerCanisterId}
            onChange={
              (e) => {
                setLedgerCanisterId(e.target.value);
              }
            }
          />
        </label>
        {errorText && <p className="error-text">{errorText}</p>}
        {isLoading ? (
            <div>
                <br />
                <div className="spinner"></div>
            </div>
        ) : (
          <div className="button-group">
            <button onClick={handleSubmit}>Submit</button>
            <button onClick={onClose}>Cancel</button>
          </div>
        )}
      </div>
    </div>
  );
}

export default AddLedgerCanisterModal;