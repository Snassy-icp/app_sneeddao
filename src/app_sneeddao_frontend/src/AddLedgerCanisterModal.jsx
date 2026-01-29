import React, { useState, useEffect } from 'react';
import { createActor as createLedgerActor } from 'external/icrc1_ledger';
import './AddLedgerCanisterModal.css';
import { Principal } from "@dfinity/principal";
import { useTheme } from './contexts/ThemeContext';
import TokenSelector from './components/TokenSelector';

// Accent colors matching wallet page
const walletPrimary = '#10b981';
const walletSecondary = '#059669';

function AddLedgerCanisterModal({ show, onClose, onSubmit }) {
  const { theme } = useTheme();
  const [ledgerCanisterId, setLedgerCanisterId] = useState('');
  const [selectedFromDropdown, setSelectedFromDropdown] = useState('');
  const [useManualInput, setUseManualInput] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [errorText, setErrorText] = useState('');

  useEffect(() => {
    if (show) {
        setErrorText('');
        setLedgerCanisterId('');
        setSelectedFromDropdown('');
        setUseManualInput(false);
    }
  }, [show]);

  const handleSubmit = async () => {
    setErrorText('');

    // Get the canister ID from either dropdown or manual input
    const canisterId = useManualInput ? ledgerCanisterId : selectedFromDropdown;

    if (canisterId == "") {
      setErrorText("Please select or enter a ledger canister id first!");
      return;
    }
    try {
      var p = Principal.fromText(canisterId);
    } catch {
      setErrorText("Invalid canister id! Please enter a valid ledger canister id.");
      return;
    }
    try {
      const ledgerActor = createLedgerActor(canisterId);
      const metadata = await ledgerActor.icrc1_metadata();
    } catch {
      setErrorText("Invalid ICRC1 ledger canister id! Please enter a valid ICRC1 ledger canister id.");
      return;
    }

    try {
      setIsLoading(true);
      setErrorText("");
      await onSubmit(canisterId);
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
    <div style={{
      position: 'fixed',
      top: 0,
      left: 0,
      width: '100%',
      height: '100%',
      background: 'rgba(0, 0, 0, 0.75)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 1000,
      backdropFilter: 'blur(4px)'
    }}>
      <div style={{
        background: `linear-gradient(135deg, ${theme.colors.primaryBg} 0%, ${walletPrimary}08 100%)`,
        border: `1px solid ${theme.colors.border}`,
        boxShadow: `0 20px 60px rgba(0, 0, 0, 0.4), 0 0 40px ${walletPrimary}15`,
        borderRadius: '16px',
        padding: '0',
        width: '480px',
        maxWidth: '90vw',
        maxHeight: '90vh',
        overflow: 'hidden'
      }}>
        {/* Header */}
        <div style={{
          background: `linear-gradient(135deg, ${walletPrimary}, ${walletSecondary})`,
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
            + Add Token
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
              justifyContent: 'center'
            }}
          >
            ×
          </button>
        </div>

        <div style={{ padding: '1.5rem' }}>
          {/* Toggle between dropdown and manual input */}
          <div style={{ 
            marginBottom: '1.25rem',
            display: 'flex',
            gap: '0.5rem',
            padding: '0.25rem',
            background: theme.colors.secondaryBg,
            borderRadius: '10px'
          }}>
            <button
              onClick={() => setUseManualInput(false)}
              style={{
                flex: 1,
                padding: '0.625rem 1rem',
                background: !useManualInput ? `linear-gradient(135deg, ${walletPrimary}, ${walletSecondary})` : 'transparent',
                color: !useManualInput ? 'white' : theme.colors.mutedText,
                border: 'none',
                borderRadius: '8px',
                cursor: 'pointer',
                fontSize: '0.85rem',
                fontWeight: '500',
                transition: 'all 0.2s ease'
              }}
            >
              Select from List
            </button>
            <button
              onClick={() => setUseManualInput(true)}
              style={{
                flex: 1,
                padding: '0.625rem 1rem',
                background: useManualInput ? `linear-gradient(135deg, ${walletPrimary}, ${walletSecondary})` : 'transparent',
                color: useManualInput ? 'white' : theme.colors.mutedText,
                border: 'none',
                borderRadius: '8px',
                cursor: 'pointer',
                fontSize: '0.85rem',
                fontWeight: '500',
                transition: 'all 0.2s ease'
              }}
            >
              Enter Manually
            </button>
          </div>
          
          {useManualInput ? (
            <div style={{ marginBottom: '1.25rem' }}>
              <label style={{
                display: 'block',
                color: theme.colors.primaryText,
                marginBottom: '0.5rem',
                fontWeight: '500',
                fontSize: '0.9rem'
              }}>
                ICRC1 Token Ledger Canister ID
              </label>
              <input 
                type="text" 
                value={ledgerCanisterId}
                onChange={(e) => {
                  setLedgerCanisterId(e.target.value);
                }}
                placeholder="Enter canister ID (e.g., rdmx6-jaaaa-aaaah-qcaiq-cai)"
                style={{
                  width: '100%',
                  padding: '0.875rem',
                  background: theme.colors.secondaryBg,
                  border: `1px solid ${theme.colors.border}`,
                  borderRadius: '10px',
                  color: theme.colors.primaryText,
                  fontSize: '0.9rem',
                  boxSizing: 'border-box',
                  outline: 'none'
                }}
              />
            </div>
          ) : (
            <div style={{ marginBottom: '1.25rem' }}>
              <label style={{
                display: 'block',
                color: theme.colors.primaryText,
                marginBottom: '0.5rem',
                fontWeight: '500',
                fontSize: '0.9rem'
              }}>
                Select Token
              </label>
              <TokenSelector
                value={selectedFromDropdown}
                onChange={setSelectedFromDropdown}
                placeholder="Choose a token from the list"
              />
            </div>
          )}

          {errorText && (
            <p style={{
              color: '#ef4444',
              marginBottom: '1.25rem',
              padding: '0.875rem',
              background: 'rgba(239, 68, 68, 0.1)',
              border: '1px solid rgba(239, 68, 68, 0.3)',
              borderRadius: '10px',
              fontSize: '0.85rem'
            }}>
              {errorText}
            </p>
          )}

          {isLoading ? (
            <div style={{
              display: 'flex',
              justifyContent: 'center',
              padding: '1.5rem'
            }}>
              <div style={{
                width: '28px',
                height: '28px',
                border: `3px solid ${walletPrimary}30`,
                borderTop: `3px solid ${walletPrimary}`,
                borderRadius: '50%',
                animation: 'addTokenSpin 0.8s linear infinite'
              }}></div>
            </div>
          ) : (
            <div style={{
              display: 'flex',
              gap: '0.75rem'
            }}>
              <button 
                onClick={onClose}
                style={{
                  flex: '1',
                  background: theme.colors.secondaryBg,
                  color: theme.colors.primaryText,
                  border: `1px solid ${theme.colors.border}`,
                  borderRadius: '10px',
                  padding: '0.875rem 1.5rem',
                  cursor: 'pointer',
                  fontSize: '0.9rem',
                  fontWeight: '500',
                  transition: 'all 0.2s ease'
                }}
              >
                Cancel
              </button>
              <button 
                onClick={handleSubmit}
                style={{
                  flex: '1',
                  background: `linear-gradient(135deg, ${walletPrimary}, ${walletSecondary})`,
                  color: 'white',
                  border: 'none',
                  borderRadius: '10px',
                  padding: '0.875rem 1.5rem',
                  cursor: 'pointer',
                  fontSize: '0.9rem',
                  fontWeight: '600',
                  transition: 'all 0.2s ease',
                  boxShadow: `0 4px 15px ${walletPrimary}40`
                }}
              >
                Add Token
              </button>
            </div>
          )}
        </div>
      </div>
      
      <style>{`
        @keyframes addTokenSpin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}

export default AddLedgerCanisterModal;
