import React, { useState, useEffect } from 'react';
import { createActor as createIcpSwapActor } from 'external/icp_swap';
import './AddSwapCanisterModal.css';
import { Principal } from "@dfinity/principal";

function AddSwapCanisterModal({ show, onClose, onSubmit }) {
  const [swapCanisterId, setSwapCanisterId] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [errorText, setErrorText] = useState('');

  useEffect(() => {
    if (show) {
        setErrorText('');
    }
  }, [show]);

  const handleSubmit = async () => {
    setErrorText('');

    if (swapCanisterId == "") {
      setErrorText("Please enter an ICPSwap swap pool canister id first!");
      return;
    }
    try {
      var p = Principal.fromText(swapCanisterId);
    } catch {
      setErrorText("Invalid canister id! Please enter a valid ICPSwap swap pool canister id.");
      return;
    }
    try {
      const swapActor = createIcpSwapActor(swapCanisterId);
      const swap_meta = await swapActor.metadata();
    } catch {
      setErrorText("Invalid ICPSwap swap pool canister id! Please enter a valid ICPSwap swap pool canister id.");
      return;
    }

    try {
      setIsLoading(true);
      setErrorText("");
      await onSubmit(swapCanisterId);
    } catch (error) {
      setErrorText("Error adding swap pool canister: " + error);
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
        <h2>Add Swap Pool Canister</h2>
        <label>
          ICPSwap Swap Pool Canister Id:
          <input 
            type="text" 
            value={swapCanisterId}
            onChange={(e) => setSwapCanisterId(e.target.value)}
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

export default AddSwapCanisterModal;