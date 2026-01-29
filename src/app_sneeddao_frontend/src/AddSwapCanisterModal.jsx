import React, { useState, useEffect } from 'react';
import { createActor as createIcpSwapActor } from 'external/icp_swap';
import { createActor as createIcpSwapFactoryActor, canisterId as factoryCanisterId } from 'declarations/icp_swap_factory';
import { Principal } from "@dfinity/principal";
import { useTheme } from './contexts/ThemeContext';
import { useAuth } from './AuthContext';
import TokenSelector from './components/TokenSelector';

const DEFAULT_FEE = BigInt(3000); // 0.3% fee tier (most common)

// Accent colors
const walletPrimary = '#10b981';
const walletSecondary = '#059669';

function AddSwapCanisterModal({ show, onClose, onSubmit }) {
  const { theme } = useTheme();
  const { identity } = useAuth();
  const [swapCanisterId, setSwapCanisterId] = useState('');
  const [token0, setToken0] = useState('');
  const [token1, setToken1] = useState('');
  const [useManualInput, setUseManualInput] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [errorText, setErrorText] = useState('');
  const [lookingUpPair, setLookingUpPair] = useState(false);

  useEffect(() => {
    if (show) {
        setErrorText('');
        setSwapCanisterId('');
        setToken0('');
        setToken1('');
        setUseManualInput(false);
    }
  }, [show]);

  // Sort tokens lexicographically (ICPSwap canonical order)
  const sortTokens = (tokenA, tokenB) => {
    return tokenA.toLowerCase() < tokenB.toLowerCase() 
      ? [tokenA, tokenB] 
      : [tokenB, tokenA];
  };

  // Look up swap pair using ICPSwap Factory
  const lookupSwapPair = async () => {
    if (!token0 || !token1) {
      return;
    }

    setLookingUpPair(true);
    setErrorText('');

    try {
      const factoryActor = createIcpSwapFactoryActor(factoryCanisterId, {
        agentOptions: { identity }
      });

      // Sort tokens in canonical order (CRITICAL for ICPSwap)
      const [sortedToken0, sortedToken1] = sortTokens(token0, token1);

      // Create token objects
      const token0Obj = { 
        address: sortedToken0, 
        standard: 'ICRC1' 
      };
      const token1Obj = { 
        address: sortedToken1, 
        standard: 'ICRC1' 
      };

      // Call factory to get pool
      const response = await factoryActor.getPool({
        token0: token0Obj,
        token1: token1Obj,
        fee: DEFAULT_FEE
      });

      if ('ok' in response) {
        const poolData = response.ok;
        setSwapCanisterId(poolData.canisterId.toString());
        setErrorText('');
      } else if ('err' in response) {
        setSwapCanisterId('');
        setErrorText(`No pool found for this token pair at 0.3% fee tier. The pool may not exist, or you can try entering the pool canister ID manually.`);
      }
    } catch (error) {
      console.error('Error looking up swap pair:', error);
      setSwapCanisterId('');
      setErrorText('Error looking up swap pair: ' + error.message);
    } finally {
      setLookingUpPair(false);
    }
  };

  // Auto-lookup when both tokens are selected
  useEffect(() => {
    if (!useManualInput && token0 && token1) {
      lookupSwapPair();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token0, token1, useManualInput]);

  const handleSubmit = async () => {
    setErrorText('');

    // Get the canister ID from either pair lookup or manual input
    const canisterId = useManualInput ? swapCanisterId : swapCanisterId;

    if (canisterId == "") {
      if (useManualInput) {
        setErrorText("Please enter an ICPSwap swap pool canister id first!");
      } else {
        setErrorText("Please select both tokens, or switch to manual input!");
      }
      return;
    }
    try {
      var p = Principal.fromText(canisterId);
    } catch {
      setErrorText("Invalid canister id! Please enter a valid ICPSwap swap pool canister id.");
      return;
    }
    try {
      const swapActor = createIcpSwapActor(canisterId);
      const swap_meta = await swapActor.metadata();
    } catch {
      setErrorText("Invalid ICPSwap swap pool canister id! Please enter a valid ICPSwap swap pool canister id.");
      return;
    }

    try {
      setIsLoading(true);
      setErrorText("");
      await onSubmit(canisterId);
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

        {/* Toggle between pair selection and manual input */}
        <div style={{ 
          marginBottom: '20px',
          display: 'flex',
          gap: '8px',
          padding: '4px',
          background: theme.colors.secondaryBg,
          borderRadius: '8px'
        }}>
          <button
            onClick={() => setUseManualInput(false)}
            style={{
              flex: 1,
              padding: '8px 16px',
              background: !useManualInput ? theme.colors.accent : 'transparent',
              color: !useManualInput ? theme.colors.primaryBg : theme.colors.mutedText,
              border: 'none',
              borderRadius: '6px',
              cursor: 'pointer',
              fontSize: '0.85rem',
              fontWeight: '500',
              transition: 'all 0.2s ease'
            }}
          >
            Select Token Pair
          </button>
          <button
            onClick={() => setUseManualInput(true)}
            style={{
              flex: 1,
              padding: '8px 16px',
              background: useManualInput ? theme.colors.accent : 'transparent',
              color: useManualInput ? theme.colors.primaryBg : theme.colors.mutedText,
              border: 'none',
              borderRadius: '6px',
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
        ) : (
          <>
            <div style={{ marginBottom: '16px' }}>
              <label style={{
                display: 'block',
                color: theme.colors.primaryText,
                marginBottom: '8px',
                fontWeight: '500'
              }}>
                First Token:
              </label>
              <TokenSelector
                value={token0}
                onChange={setToken0}
                placeholder="Select first token"
                excludeTokens={token1 ? [token1] : []}
              />
            </div>

            <div style={{ marginBottom: '16px' }}>
              <label style={{
                display: 'block',
                color: theme.colors.primaryText,
                marginBottom: '8px',
                fontWeight: '500'
              }}>
                Second Token:
              </label>
              <TokenSelector
                value={token1}
                onChange={setToken1}
                placeholder="Select second token"
                excludeTokens={token0 ? [token0] : []}
              />
            </div>

            {lookingUpPair && (
              <div style={{
                padding: '12px',
                background: `${theme.colors.accent}15`,
                border: `1px solid ${theme.colors.accent}30`,
                borderRadius: '8px',
                color: theme.colors.primaryText,
                fontSize: '0.9rem',
                marginBottom: '16px',
                display: 'flex',
                alignItems: 'center',
                gap: '12px'
              }}>
                <div className="spinner" style={{
                  width: '16px',
                  height: '16px',
                  border: `2px solid ${theme.colors.border}`,
                  borderTop: `2px solid ${theme.colors.accent}`,
                  borderRadius: '50%',
                  animation: 'spin 1s linear infinite'
                }}></div>
                Looking up swap pool...
              </div>
            )}

            {!lookingUpPair && swapCanisterId && token0 && token1 && (
              <div style={{
                padding: '12px',
                background: `${theme.colors.success}15`,
                border: `1px solid ${theme.colors.success}30`,
                borderRadius: '8px',
                marginBottom: '16px'
              }}>
                <div style={{ 
                  color: theme.colors.primaryText, 
                  fontSize: '0.85rem',
                  fontWeight: '500',
                  marginBottom: '4px'
                }}>
                  ✓ Pool Found
                </div>
                <div style={{ 
                  color: theme.colors.mutedText, 
                  fontSize: '0.8rem',
                  wordBreak: 'break-all'
                }}>
                  {swapCanisterId}
                </div>
              </div>
            )}
          </>
        )}

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
              style={{
                flex: '2',
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