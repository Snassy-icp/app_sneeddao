import React, { useState, useEffect } from 'react';
import { createActor as createIcpSwapActor } from 'external/icp_swap';
import { createActor as createSwapRunnerActor } from 'external/swaprunner_backend';
import './AddSwapCanisterModal.css';
import { Principal } from "@dfinity/principal";
import { useTheme } from './contexts/ThemeContext';
import { useAuth } from './AuthContext';
import TokenSelector from './components/TokenSelector';

const swapRunnerCanisterId = 'avbj7-eaaaa-aaaak-qb2sa-cai'; // SwapRunner canister ID

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

  // Look up swap pair when both tokens are selected
  const lookupSwapPair = async () => {
    if (!token0 || !token1) {
      return;
    }

    setLookingUpPair(true);
    setErrorText('');

    try {
      const swapRunnerActor = createSwapRunnerActor(swapRunnerCanisterId, {
        agentOptions: { identity }
      });

      // Get user's registered pools
      const userPools = await swapRunnerActor.get_user_pools();

      // Find a pool that matches the selected token pair
      const matchingPool = userPools.find(pool => {
        if (!pool.metadata || !pool.metadata[0]) return false;
        
        const metadata = pool.metadata[0];
        const poolToken0 = metadata.token0.address;
        const poolToken1 = metadata.token1.address;

        // Check if tokens match in either order
        return (
          (poolToken0 === token0 && poolToken1 === token1) ||
          (poolToken0 === token1 && poolToken1 === token0)
        );
      });

      if (matchingPool) {
        setSwapCanisterId(matchingPool.canisterId.toString());
        setErrorText('');
      } else {
        setSwapCanisterId('');
        setErrorText(`No swap pool found for this token pair. You may need to add the pool manually, or register it in SwapRunner first.`);
      }
    } catch (error) {
      console.error('Error looking up swap pair:', error);
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