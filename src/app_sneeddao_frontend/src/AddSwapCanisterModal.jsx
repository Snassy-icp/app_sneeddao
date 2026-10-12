import React, { useState, useEffect, useCallback } from 'react';
import { useTheme } from './contexts/ThemeContext';
import SwapPoolPicker from './components/SwapPoolPicker';

// Accent colors
const walletPrimary = '#10b981';
const walletSecondary = '#059669';

function AddSwapCanisterModal({ show, onClose, onSubmit }) {
  const { theme } = useTheme();
  const [poolId, setPoolId] = useState('');
  const [poolStatus, setPoolStatus] = useState('idle'); // idle | resolving | ready | error
  const [isLoading, setIsLoading] = useState(false);
  const [errorText, setErrorText] = useState('');
  const [resetKey, setResetKey] = useState(0);

  useEffect(() => {
    if (show) {
        setErrorText('');
        setPoolId('');
        setPoolStatus('idle');
        setResetKey(k => k + 1);
    }
  }, [show]);

  const handlePoolChange = useCallback((id, _pool, status) => {
    setPoolId(id);
    setPoolStatus(status);
    setErrorText('');
  }, []);

  const handleSubmit = async () => {
    setErrorText('');
    if (!poolId) {
      setErrorText("Select both tokens of the pair, or enter the pool canister id manually.");
      return;
    }
    if (poolStatus === 'resolving') {
      setErrorText("Still checking the pool, one moment...");
      return;
    }
    if (poolStatus !== 'ready') {
      setErrorText("That canister is not an ICPSwap pool. Please check the id.");
      return;
    }
    setIsLoading(true);
    try {
      await onSubmit(poolId);
    } catch (error) {
      // Keep the dialog open so the user actually sees what went wrong.
      setIsLoading(false);
      setErrorText("Error adding swap pool canister: " + (error?.message || error));
      return;
    }
    setIsLoading(false);
    onClose();
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
      backgroundColor: 'rgba(0, 0, 0, 0.75)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 1000,
      padding: '20px',
      backdropFilter: 'blur(4px)'
    }}>
      <div style={{
        background: `linear-gradient(135deg, ${theme.colors.primaryBg} 0%, ${walletPrimary}08 100%)`,
        border: `1px solid ${theme.colors.border}`,
        boxShadow: `0 20px 60px rgba(0, 0, 0, 0.4), 0 0 40px ${walletPrimary}15`,
        borderRadius: '16px',
        padding: '0',
        width: '500px',
        maxWidth: '90vw',
        maxHeight: '90vh',
        display: 'flex',
        flexDirection: 'column',
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
            fontWeight: '600'
          }}>
            💱 Add Swap Pool Canister
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
              opacity: isLoading ? 0.5 : 1
            }}
          >
            ×
          </button>
        </div>

        {/* Content */}
        <div style={{ padding: '1.25rem', flex: 1, overflowY: 'auto' }}>

        <SwapPoolPicker onPoolChange={handlePoolChange} resetKey={resetKey} accentColor={theme.colors.accent} />

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
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '20px'
          }}>
            <div className="spinner" style={{
              width: '28px',
              height: '28px',
              border: `3px solid ${theme.colors.border}`,
              borderTop: `3px solid ${walletPrimary}`,
              borderRadius: '50%',
              animation: 'spin 1s linear infinite',
              marginBottom: '10px'
            }}></div>
            <span style={{ color: theme.colors.mutedText, fontSize: '0.85rem' }}>Adding...</span>
          </div>
        ) : (
          <div style={{
            display: 'flex',
            gap: '12px',
            marginTop: '20px'
          }}>
            <button 
              onClick={handleSubmit}
              disabled={poolStatus !== 'ready'}
              style={{
                flex: '2',
                opacity: poolStatus === 'ready' ? 1 : 0.6,
                background: `linear-gradient(135deg, ${walletPrimary}, ${walletSecondary})`,
                color: 'white',
                border: 'none',
                borderRadius: '10px',
                padding: '14px 24px',
                cursor: 'pointer',
                fontSize: '0.95rem',
                fontWeight: '600',
                boxShadow: `0 4px 12px ${walletPrimary}40`
              }}
            >
              Add Swap Pair
            </button>
            <button 
              onClick={onClose}
              style={{
                flex: '1',
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
    </div>
  );
}

export default AddSwapCanisterModal;