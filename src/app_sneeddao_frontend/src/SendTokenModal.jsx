// SendTokenModal.jsx
import React, { useState, useEffect, useMemo } from 'react';
import './SendTokenModal.css';
import { Principal } from "@dfinity/principal";
import ConfirmationModal from './ConfirmationModal';
import { formatAmount } from './utils/StringUtils';
import { useTheme } from './contexts/ThemeContext';
import {
  parseAccount,
  parseExtendedAddress,
  resolveSubaccount,
  encodeExtendedAddress,
  bytesToHex,
  formatSubaccountForDisplay,
  looksLikeExtendedAddress,
  isDefaultSubaccount,
  getSubaccountForTransfer
} from './utils/AccountParser';

function SendTokenModal({ show, onClose, onSend, token }) {
  const { theme } = useTheme();
  const [recipient, setRecipient] = useState('');
  const [amount, setAmount] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [errorText, setErrorText] = useState('');
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [confirmAction, setConfirmAction] = useState(null);
  const [confirmMessage, setConfirmMessage] = useState('');
  const [logoLoaded, setLogoLoaded] = useState(false);

  // Subaccount state
  const [showSubaccountInput, setShowSubaccountInput] = useState(false);
  const [subaccountType, setSubaccountType] = useState('hex'); // 'hex' | 'bytes' | 'principal'
  const [subaccountValue, setSubaccountValue] = useState('');
  const [extendedAddressDetected, setExtendedAddressDetected] = useState(null);

  useEffect(() => {
    if (show) {
      setErrorText('');
    }
  }, [show]);

  useEffect(() => {
    if (!show) return;
    setLogoLoaded(false);
    if (token?.logo) {
      const img = new Image();
      img.onload = () => setLogoLoaded(true);
      img.onerror = () => setLogoLoaded(false);
      img.src = token.logo;
    }
  }, [show, token?.logo]);

  // Reset state when modal is closed
  useEffect(() => {
    if (!show) {
      setRecipient('');
      setAmount('');
      setShowSubaccountInput(false);
      setSubaccountType('hex');
      setSubaccountValue('');
      setExtendedAddressDetected(null);
      setErrorText('');
    }
  }, [show]);

  // Auto-detect extended address format when recipient changes
  useEffect(() => {
    if (!recipient) {
      setExtendedAddressDetected(null);
      return;
    }

    if (looksLikeExtendedAddress(recipient)) {
      const parsed = parseExtendedAddress(recipient);
      if (parsed) {
        setExtendedAddressDetected(parsed);
        // Hide manual subaccount input when extended address is detected
        setShowSubaccountInput(false);
        setSubaccountValue('');
      } else {
        setExtendedAddressDetected(null);
      }
    } else {
      setExtendedAddressDetected(null);
    }
  }, [recipient]);

  // Parse and validate the current account
  const parsedAccount = useMemo(() => {
    if (!recipient) return null;

    // If extended address was detected, use that
    if (extendedAddressDetected) {
      return extendedAddressDetected;
    }

    // Otherwise parse with manual subaccount if provided
    const subaccountInput = showSubaccountInput && subaccountValue.trim()
      ? { type: subaccountType, value: subaccountValue }
      : null;

    return parseAccount(recipient, subaccountInput);
  }, [recipient, extendedAddressDetected, showSubaccountInput, subaccountType, subaccountValue]);

  // Resolve the manual subaccount for preview
  const resolvedManualSubaccount = useMemo(() => {
    if (!showSubaccountInput || !subaccountValue.trim()) {
      return null;
    }
    return resolveSubaccount({ type: subaccountType, value: subaccountValue });
  }, [showSubaccountInput, subaccountType, subaccountValue]);

  const handleSetMax = () => {
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

  const handleConvertToExtendedAddress = () => {
    if (!parsedAccount || !parsedAccount.principal) {
      setErrorText('Please enter a valid principal first');
      return;
    }

    const extendedAddress = encodeExtendedAddress(parsedAccount);
    if (extendedAddress) {
      setRecipient(extendedAddress);
      setShowSubaccountInput(false);
      setSubaccountValue('');
    } else {
      setErrorText('Failed to encode extended address');
    }
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

    // Validate the parsed account
    if (!parsedAccount || !parsedAccount.principal) {
      console.log('ERROR: Invalid recipient');
      setErrorText("Invalid recipient address! Please enter a valid principal ID or extended address.");
      return;
    }

    // Validate manual subaccount if entered
    if (showSubaccountInput && subaccountValue.trim() && !resolvedManualSubaccount) {
      console.log('ERROR: Invalid subaccount');
      setErrorText("Invalid subaccount format! Please check your input.");
      return;
    }

    console.log('Recipient validation: SUCCESS');
    console.log('Parsed account:', {
      principal: parsedAccount.principal.toText(),
      hasSubaccount: !!parsedAccount.subaccount,
      subaccountHex: parsedAccount.subaccount ? bytesToHex(parsedAccount.subaccount.resolved) : null
    });

    if (amount == "") {
      console.log('ERROR: Empty amount');
      setErrorText("Please enter an amount first!");
      return;
    }

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

    // Get subaccount for transfer
    const subaccountForTransfer = getSubaccountForTransfer(parsedAccount);

    setConfirmAction(() => async () => {
      console.log('=== CONFIRMATION ACTION START ===');
      try {
        setIsLoading(true);
        setErrorText('');
        console.log('About to call onSend with:', {
          token: token.symbol,
          principal: parsedAccount.principal.toText(),
          amount,
          subaccount: subaccountForTransfer.length > 0 ? bytesToHex(new Uint8Array(subaccountForTransfer[0])) : 'none'
        });
        await onSend(token, parsedAccount.principal.toText(), amount, subaccountForTransfer);
        console.log('onSend completed successfully');
        onClose();
        console.log('Modal closed');
      } catch (error) {
        console.error('ERROR in confirmation action:', error);
        setErrorText('Error sending tokens: ' + error.message);
      } finally {
        setIsLoading(false);
        console.log('=== CONFIRMATION ACTION END ===');
      }
    });

    // Build confirmation message
    let confirmMsg = `You are about to send ${amount} ${token.symbol} to ${parsedAccount.principal.toText()}`;
    if (parsedAccount.subaccount && !isDefaultSubaccount(parsedAccount.subaccount.resolved)) {
      confirmMsg += `\n\nWith subaccount: ${formatSubaccountForDisplay(parsedAccount.subaccount.resolved, 32)}`;
    }

    setConfirmMessage(confirmMsg);
    setShowConfirmModal(true);
    console.log('=== SendTokenModal.handleSend END ===');
  };

  if (!show || !token) {
    return null;
  }

  // Check if token is DIP20 (doesn't support subaccounts)
  const isDIP20 = token.standard === 'DIP20' || token.standard === 'dip20';

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
        width: '500px',
        maxWidth: '90vw',
        maxHeight: '90vh',
        overflow: 'auto'
      }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '16px', marginBottom: '24px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            {token.logo && logoLoaded ? (
              <img
                src={token.logo}
                alt={`${token.symbol} logo`}
                style={{ width: '28px', height: '28px', borderRadius: '8px', objectFit: 'contain', background: theme.colors.tertiaryBg, border: `1px solid ${theme.colors.border}` }}
              />
            ) : (
              <div style={{ width: '28px', height: '28px', borderRadius: '8px', background: theme.colors.tertiaryBg, border: `1px solid ${theme.colors.border}` }} />
            )}
            <h2 style={{
              color: theme.colors.primaryText,
              margin: 0,
              fontSize: '1.5rem',
              fontWeight: '600'
            }}>
              Send {token.symbol}
            </h2>
          </div>

          <div style={{ textAlign: 'right' }}>
            <div style={{ color: theme.colors.mutedText, fontSize: '12px', marginBottom: '4px' }}>Available balance</div>
            <div style={{ color: theme.colors.primaryText, fontWeight: 700 }}>
              {formatAmount(token.available ?? token.balance ?? 0n, token.decimals)} {token.symbol}
            </div>
          </div>
        </div>

        <div style={{ marginBottom: '20px' }}>
          <label style={{
            display: 'block',
            color: theme.colors.primaryText,
            marginBottom: '8px',
            fontWeight: '500'
          }}>
            Recipient Address:
          </label>
          <input
            type="text"
            value={recipient}
            onChange={(e) => setRecipient(e.target.value)}
            placeholder="Enter principal ID or extended address"
            style={{
              width: '100%',
              padding: '12px',
              background: theme.colors.secondaryBg,
              border: `1px solid ${parsedAccount ? theme.colors.success : theme.colors.border}`,
              borderRadius: '8px',
              color: theme.colors.primaryText,
              fontSize: '0.9rem',
              boxSizing: 'border-box',
              transition: 'border-color 0.2s ease'
            }}
          />

          {/* Extended address detection feedback */}
          {extendedAddressDetected && (
            <div style={{
              marginTop: '8px',
              padding: '10px 12px',
              background: `${theme.colors.success}15`,
              border: `1px solid ${theme.colors.success}40`,
              borderRadius: '8px',
              fontSize: '0.85rem'
            }}>
              <div style={{ color: theme.colors.success, fontWeight: '600', marginBottom: '6px' }}>
                ✓ Extended address format detected
              </div>
              <div style={{ color: theme.colors.secondaryText }}>
                <strong>Principal:</strong> {extendedAddressDetected.principal.toText().slice(0, 20)}...
              </div>
              {extendedAddressDetected.subaccount && (
                <div style={{ color: theme.colors.secondaryText, marginTop: '4px' }}>
                  <strong>Subaccount:</strong> {formatSubaccountForDisplay(extendedAddressDetected.subaccount.resolved, 24)}
                </div>
              )}
            </div>
          )}

          {/* Valid principal indicator (when not extended address) */}
          {parsedAccount && !extendedAddressDetected && (
            <div style={{
              marginTop: '8px',
              fontSize: '0.85rem',
              color: theme.colors.success
            }}>
              ✓ Valid principal ID
            </div>
          )}
        </div>

        {/* Advanced subaccount section */}
        {!extendedAddressDetected && !isDIP20 && (
          <div style={{ marginBottom: '20px' }}>
            <button
              onClick={() => setShowSubaccountInput(!showSubaccountInput)}
              style={{
                background: 'transparent',
                border: 'none',
                color: theme.colors.accent,
                cursor: 'pointer',
                fontSize: '0.85rem',
                padding: 0,
                display: 'flex',
                alignItems: 'center',
                gap: '6px'
              }}
            >
              <span style={{ transform: showSubaccountInput ? 'rotate(90deg)' : 'rotate(0)', transition: 'transform 0.2s' }}>▶</span>
              Advanced: Send To Subaccount
            </button>

            {showSubaccountInput && (
              <div style={{
                marginTop: '12px',
                padding: '16px',
                background: theme.colors.secondaryBg,
                borderRadius: '8px',
                border: `1px solid ${theme.colors.border}`
              }}>
                <div style={{ marginBottom: '12px' }}>
                  <label style={{
                    display: 'block',
                    color: theme.colors.secondaryText,
                    marginBottom: '6px',
                    fontSize: '0.85rem'
                  }}>
                    Subaccount Format:
                  </label>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    {[
                      { value: 'hex', label: 'Hex String' },
                      { value: 'bytes', label: 'Byte Array' },
                      { value: 'principal', label: 'Principal ID' }
                    ].map(option => (
                      <button
                        key={option.value}
                        onClick={() => {
                          setSubaccountType(option.value);
                          setSubaccountValue('');
                        }}
                        style={{
                          flex: 1,
                          padding: '8px 12px',
                          background: subaccountType === option.value ? theme.colors.accent : theme.colors.tertiaryBg,
                          color: subaccountType === option.value ? theme.colors.primaryBg : theme.colors.secondaryText,
                          border: `1px solid ${subaccountType === option.value ? theme.colors.accent : theme.colors.border}`,
                          borderRadius: '6px',
                          cursor: 'pointer',
                          fontSize: '0.8rem',
                          fontWeight: subaccountType === option.value ? '600' : '400',
                          transition: 'all 0.2s ease'
                        }}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div style={{ marginBottom: '12px' }}>
                  <label style={{
                    display: 'block',
                    color: theme.colors.secondaryText,
                    marginBottom: '6px',
                    fontSize: '0.85rem'
                  }}>
                    {subaccountType === 'hex' && 'Hex String (e.g., 0A1B2C3D... or 0x0A1B2C3D...):'}
                    {subaccountType === 'bytes' && 'Byte Array (comma-separated, e.g., 1, 2, 3, 4):'}
                    {subaccountType === 'principal' && 'Principal ID to convert to subaccount:'}
                  </label>
                  <input
                    type="text"
                    value={subaccountValue}
                    onChange={(e) => setSubaccountValue(e.target.value)}
                    placeholder={
                      subaccountType === 'hex' ? '0A1B2C3D4E5F...' :
                        subaccountType === 'bytes' ? '1, 2, 3, 4, 5...' :
                          'aaaaa-aa'
                    }
                    style={{
                      width: '100%',
                      padding: '10px',
                      background: theme.colors.tertiaryBg,
                      border: `1px solid ${resolvedManualSubaccount ? theme.colors.success : theme.colors.border}`,
                      borderRadius: '6px',
                      color: theme.colors.primaryText,
                      fontSize: '0.85rem',
                      fontFamily: 'monospace',
                      boxSizing: 'border-box'
                    }}
                  />
                </div>

                {/* Subaccount preview */}
                {resolvedManualSubaccount && (
                  <div style={{
                    padding: '10px',
                    background: `${theme.colors.success}10`,
                    border: `1px solid ${theme.colors.success}30`,
                    borderRadius: '6px',
                    fontSize: '0.8rem'
                  }}>
                    <div style={{ color: theme.colors.success, marginBottom: '4px', fontWeight: '600' }}>
                      ✓ Valid subaccount
                    </div>
                    <div style={{ color: theme.colors.secondaryText, fontFamily: 'monospace', wordBreak: 'break-all' }}>
                      <strong>Resolved (hex):</strong> {bytesToHex(resolvedManualSubaccount.resolved)}
                    </div>
                  </div>
                )}

                {/* Invalid subaccount warning */}
                {subaccountValue.trim() && !resolvedManualSubaccount && (
                  <div style={{
                    padding: '10px',
                    background: `${theme.colors.error}10`,
                    border: `1px solid ${theme.colors.error}30`,
                    borderRadius: '6px',
                    fontSize: '0.8rem',
                    color: theme.colors.error
                  }}>
                    ✗ Invalid subaccount format
                  </div>
                )}

                {/* Convert to extended address button */}
                {parsedAccount && (
                  <button
                    onClick={handleConvertToExtendedAddress}
                    style={{
                      marginTop: '12px',
                      width: '100%',
                      padding: '10px',
                      background: theme.colors.tertiaryBg,
                      color: theme.colors.accent,
                      border: `1px solid ${theme.colors.accent}`,
                      borderRadius: '6px',
                      cursor: 'pointer',
                      fontSize: '0.85rem',
                      fontWeight: '500'
                    }}
                  >
                    Convert to Extended Address String
                  </button>
                )}
              </div>
            )}
          </div>
        )}

        {/* DIP20 warning */}
        {isDIP20 && (
          <div style={{
            marginBottom: '20px',
            padding: '12px',
            background: `${theme.colors.warning}15`,
            border: `1px solid ${theme.colors.warning}30`,
            borderRadius: '8px',
            fontSize: '0.85rem',
            color: theme.colors.warning
          }}>
            ⚠️ This token uses the DIP20 standard which does not support subaccounts.
          </div>
        )}

        <div style={{ marginBottom: '20px' }}>
          <label style={{
            display: 'block',
            color: theme.colors.primaryText,
            marginBottom: '8px',
            fontWeight: '500'
          }}>
            Amount:
          </label>
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '10px'
          }}>
            <input
              type="number"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              style={{
                flex: '1',
                padding: '12px',
                background: theme.colors.secondaryBg,
                border: `1px solid ${theme.colors.border}`,
                borderRadius: '8px',
                color: theme.colors.primaryText,
                fontSize: '0.9rem',
                boxSizing: 'border-box'
              }}
            />
            <button
              onClick={handleSetMax}
              style={{
                background: theme.colors.accent,
                color: theme.colors.primaryBg,
                border: 'none',
                borderRadius: '8px',
                padding: '12px 16px',
                cursor: 'pointer',
                fontSize: '0.85rem',
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
              MAX
            </button>
          </div>
        </div>

        <div style={{ marginBottom: '20px' }}>
          <label style={{
            display: 'block',
            color: theme.colors.secondaryText,
            fontSize: '0.9rem'
          }}>
            Fee: {formatAmount(token.fee, token.decimals)} {token.symbol}
          </label>
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
              onClick={handleSend}
              disabled={isLoading}
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
              Send
            </button>
            <button
              onClick={onClose}
              disabled={isLoading}
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
