import React, { useState, useEffect } from 'react';
import { createActor as createIcpSwapActor } from 'external/icp_swap';
import './AddSwapCanisterModal.css';
import { Principal } from "@dfinity/principal";
import { useTheme } from './contexts/ThemeContext';

function AddSwapCanisterModal({ show, onClose, onSubmit }) {
  const { theme } = useTheme();
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
          Add Swap Pool Canister
        </h2>
        
        <div style={{ marginBottom: '20px' }}>
          <label style={{
            display: 'block',
            color: theme.colors.primaryText,
            marginBottom: '8px',
            fontWeight: '500'
          }}>
            ICPSwap Swap Pool Canister Id:
          </label>
          <input 
            type="text" 
            value={swapCanisterId}
            onChange={(e) => setSwapCanisterId(e.target.value)}
            placeholder="Enter swap pool canister ID (e.g., xkbqi-2qaaa-aaaah-qbpqq-cai)"
            style={{
              width: '100%',
              padding: '12px',
              background: theme.colors.secondaryBg,
              border: `1px solid ${theme.colors.border}`,
              borderRadius: '8px',
              color: theme.colors.primaryText,
              fontSize: '0.9rem',
              boxSizing: 'border-box'
            }}
          />
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
              onClick={handleSubmit}
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
              Add Swap Pair
            </button>
            <button 
              onClick={onClose}
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
    </div>
  );
}

export default AddSwapCanisterModal;