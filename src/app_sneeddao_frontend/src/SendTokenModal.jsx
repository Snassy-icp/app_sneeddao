// SendTokenModal.jsx
import React, { useState, useEffect, useMemo } from 'react';
import './SendTokenModal.css';
import { Principal } from "@dfinity/principal";
import { formatAmount } from './utils/StringUtils';
import { useTheme } from './contexts/ThemeContext';
import PrincipalInput from './components/PrincipalInput';
import { PrincipalDisplay } from './utils/PrincipalUtils';
import {
  parseAccount,
  parseExtendedAddress,
  resolveSubaccount,
  encodeExtendedAddress,
  bytesToHex,
  looksLikeExtendedAddress,
  isDefaultSubaccount,
  getSubaccountForTransfer
} from './utils/AccountParser';

// Wallet accent colors
const walletPrimary = '#10b981';
const walletSecondary = '#059669';

function SendTokenModal({ show, onClose, onSend, token }) {
  const { theme } = useTheme();
  const [recipient, setRecipient] = useState('');
  const [amount, setAmount] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [errorText, setErrorText] = useState('');
  const [logoLoaded, setLogoLoaded] = useState(false);

  // Subaccount state
  const [showSubaccountInput, setShowSubaccountInput] = useState(false);
  const [subaccountType, setSubaccountType] = useState('hex'); // 'hex' | 'bytes' | 'principal'
  const [subaccountValue, setSubaccountValue] = useState('');
  const [extendedAddressDetected, setExtendedAddressDetected] = useState(null);

  // Review screen state
  const [showReviewScreen, setShowReviewScreen] = useState(false);
  const [reviewData, setReviewData] = useState(null);
  const [showDetailsExpanded, setShowDetailsExpanded] = useState(false);

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
      setShowReviewScreen(false);
      setReviewData(null);
      setShowDetailsExpanded(false);
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

  const reviewPrincipalObj = useMemo(() => {
    const principalText = reviewData?.principal?.trim?.() || reviewData?.principal;
    if (!principalText) return null;
    try {
      return Principal.fromText(principalText);
    } catch {
      return null;
    }
  }, [reviewData]);

  const handleSetMax = () => {
    const willNeedSplit = token.available > token.balance;
    const feesNeeded = willNeedSplit ? 2n * token.fee : token.fee;

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

  // Convert extended address to explicit principal + subaccount
  const handleConvertToExplicit = () => {
    if (!extendedAddressDetected) return;

    const principalText = extendedAddressDetected?.principal?.toText?.();
    if (!principalText) {
      setErrorText('Invalid principal in extended address');
      return;
    }
    setRecipient(principalText);
    
    if (extendedAddressDetected.subaccount) {
      setShowSubaccountInput(true);
      setSubaccountType('hex');
      setSubaccountValue(bytesToHex(extendedAddressDetected.subaccount.resolved));
    }
    
    setExtendedAddressDetected(null);
  };

  const handleReview = async () => {
    setErrorText('');

    if (recipient == "") {
      setErrorText("Please enter a recipient address first!");
      return;
    }

    if (!parsedAccount || !parsedAccount.principal) {
      setErrorText("Invalid recipient address! Please enter a valid principal ID or extended address.");
      return;
    }

    if (showSubaccountInput && subaccountValue.trim() && !resolvedManualSubaccount) {
      setErrorText("Invalid subaccount format! Please check your input.");
      return;
    }

    if (amount == "") {
      setErrorText("Please enter an amount first!");
      return;
    }

    const amountFloat = parseFloat(amount);
    if (isNaN(amountFloat) || amountFloat <= 0) {
      setErrorText("Invalid amount! Please enter a positive amount.");
      return;
    }

    const scaledAmount = amountFloat * (10 ** token.decimals);
    const bigIntAmount = BigInt(Math.floor(scaledAmount));

    const willNeedSplit = token.available > token.balance;
    const feesNeeded = willNeedSplit ? 2n * BigInt(token.fee) : BigInt(token.fee);
    const maxAllowed = BigInt(token.available) - feesNeeded;

    if (bigIntAmount > maxAllowed) {
      const feeMsg = willNeedSplit ?
        "Remember that sending requires 2 transaction fees when splitting between wallets." :
        "Remember that sending requires 1 transaction fee.";
      setErrorText(`Insufficient available balance! ${feeMsg}`);
      return;
    }

    // Prepare review data
    const subaccountForTransfer = getSubaccountForTransfer(parsedAccount);
    const hasSubaccount = parsedAccount.subaccount && !isDefaultSubaccount(parsedAccount.subaccount.resolved);
    
    // Generate extended address string
    const extendedAddress = encodeExtendedAddress(parsedAccount);

    setReviewData({
      principal: parsedAccount.principal.toText(),
      subaccount: hasSubaccount ? bytesToHex(parsedAccount.subaccount.resolved) : null,
      extendedAddress: extendedAddress,
      amount: amount,
      amountBigInt: bigIntAmount,
      fee: token.fee,
      subaccountForTransfer
    });

    setShowReviewScreen(true);
  };

  const handleConfirmSend = async () => {
    if (!reviewData) return;

    try {
      setIsLoading(true);
      setErrorText('');
      await onSend(token, reviewData.principal, reviewData.amount, reviewData.subaccountForTransfer);
      onClose();
    } catch (error) {
      console.error('Error sending tokens:', error);
      setErrorText('Error sending tokens: ' + error.message);
      setShowReviewScreen(false);
    } finally {
      setIsLoading(false);
    }
  };

  if (!show || !token) {
    return null;
  }

  // Check if token is DIP20 (doesn't support subaccounts)
  const isDIP20 = token.standard === 'DIP20' || token.standard === 'dip20';

  // Compact copyable field component
  const CopyableRow = ({ label, value }) => (
    <div style={{
      display: 'flex',
      alignItems: 'flex-start',
      gap: '8px',
      padding: '8px 0',
      borderBottom: `1px solid ${theme.colors.border}20`
    }}>
      <span style={{
        color: theme.colors.mutedText,
        fontSize: '0.75rem',
        minWidth: '70px',
        flexShrink: 0
      }}>
        {label}
      </span>
      <span style={{
        flex: 1,
        fontFamily: 'monospace',
        fontSize: '0.75rem',
        color: theme.colors.primaryText,
        wordBreak: 'break-all',
        overflowWrap: 'anywhere'
      }}>
        {value}
      </span>
      <button
        onClick={() => navigator.clipboard.writeText(value)}
        style={{
          background: 'none',
          border: 'none',
          padding: '2px',
          cursor: 'pointer',
          color: theme.colors.mutedText,
          fontSize: '12px',
          flexShrink: 0
        }}
        title="Copy"
      >
        📋
      </button>
    </div>
  );

  // Review Screen
  if (showReviewScreen && reviewData) {
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
          width: '450px',
          maxWidth: '90vw',
          maxHeight: '90vh',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden'
        }}>
          {/* Header */}
          <div style={{
            background: `linear-gradient(135deg, ${walletPrimary}, ${walletSecondary})`,
            padding: '1rem 1.25rem',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <div style={{
                width: '36px',
                height: '36px',
                borderRadius: '10px',
                background: 'rgba(255, 255, 255, 0.2)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0
              }}>
                {token.logo && logoLoaded ? (
                  <img
                    src={token.logo}
                    alt={token.symbol}
                    style={{ width: '22px', height: '22px', borderRadius: '6px', objectFit: 'contain' }}
                  />
                ) : (
                  <span style={{ fontSize: '16px' }}>💸</span>
                )}
              </div>
              <div>
                <h2 style={{
                  color: 'white',
                  margin: 0,
                  fontSize: '1.1rem',
                  fontWeight: '600'
                }}>
                  Confirm Send
                </h2>
                <p style={{
                  color: 'rgba(255, 255, 255, 0.8)',
                  margin: 0,
                  fontSize: '0.75rem'
                }}>
                  Review before confirming
                </p>
              </div>
            </div>
            <button
              onClick={() => setShowReviewScreen(false)}
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
                opacity: isLoading ? 0.5 : 1,
                transition: 'all 0.2s ease'
              }}
            >
              ×
            </button>
          </div>

          <div style={{ padding: '1.25rem', overflowY: 'auto' }}>

          {/* Amount - Compact */}
          <div style={{
            textAlign: 'center',
            marginBottom: '16px',
            padding: '16px',
            background: `linear-gradient(135deg, ${walletPrimary}15 0%, ${walletSecondary}08 100%)`,
            borderRadius: '12px',
            border: `1px solid ${walletPrimary}30`
          }}>
            <div style={{
              fontSize: '1.6rem',
              fontWeight: '700',
              color: theme.colors.primaryText,
              marginBottom: '2px'
            }}>
              {reviewData.amount} <span style={{ color: walletPrimary }}>{token.symbol}</span>
            </div>
            <div style={{
              color: theme.colors.mutedText,
              fontSize: '0.75rem'
            }}>
              + {formatAmount(reviewData.fee, token.decimals)} {token.symbol} fee
            </div>
          </div>

          {/* Recipient Summary */}
          <div style={{
            background: theme.colors.secondaryBg,
            borderRadius: '8px',
            padding: '12px',
            marginBottom: '12px'
          }}>
            <div style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: '8px'
            }}>
              <span style={{ color: theme.colors.mutedText, fontSize: '0.75rem', fontWeight: '600', textTransform: 'uppercase' }}>
                To
              </span>
              {reviewData.subaccount && (
                <span style={{
                  background: `${theme.colors.warning}20`,
                  color: theme.colors.warning,
                  fontSize: '0.65rem',
                  padding: '2px 6px',
                  borderRadius: '4px',
                  fontWeight: '600'
                }}>
                  + SUBACCOUNT
                </span>
              )}
            </div>
            
            {/* Principal with PrincipalDisplay */}
            <div style={{
              background: theme.colors.tertiaryBg,
              padding: '10px 12px',
              borderRadius: '6px',
              marginBottom: '8px'
            }}>
              {reviewPrincipalObj ? (
                <PrincipalDisplay
                  principal={reviewPrincipalObj}
                  showCopyButton={true}
                  noLink={true}
                  style={{ fontSize: '0.85rem' }}
                />
              ) : (
                <div style={{ color: theme.colors.mutedText, fontSize: '0.85rem' }}>
                  {reviewData.principal}
                </div>
              )}
            </div>

            {/* Expandable Details */}
            <button
              onClick={() => setShowDetailsExpanded(!showDetailsExpanded)}
              style={{
                width: '100%',
                background: 'none',
                border: 'none',
                color: theme.colors.accent,
                cursor: 'pointer',
                fontSize: '0.75rem',
                padding: '4px 0',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '4px'
              }}
            >
              <span style={{ 
                transform: showDetailsExpanded ? 'rotate(90deg)' : 'rotate(0)', 
                transition: 'transform 0.2s',
                display: 'inline-block'
              }}>▶</span>
              {showDetailsExpanded ? 'Hide details' : 'Show full details'}
            </button>

            {showDetailsExpanded && (
              <div style={{
                marginTop: '8px',
                padding: '8px',
                background: theme.colors.tertiaryBg,
                borderRadius: '6px'
              }}>
                <CopyableRow label="Principal" value={reviewData.principal} />
                {reviewData.subaccount && (
                  <CopyableRow label="Subaccount" value={reviewData.subaccount} />
                )}
                {reviewData.extendedAddress && (
                  <CopyableRow label="Extended" value={reviewData.extendedAddress} />
                )}
              </div>
            )}
          </div>

          {/* Warning for subaccount - compact */}
          {reviewData.subaccount && (
            <div style={{
              padding: '10px 12px',
              background: `${theme.colors.warning}15`,
              border: `1px solid ${theme.colors.warning}40`,
              borderRadius: '6px',
              marginBottom: '16px',
              display: 'flex',
              alignItems: 'flex-start',
              gap: '8px'
            }}>
              <span style={{ fontSize: '14px' }}>⚠️</span>
              <div style={{ fontSize: '0.75rem', color: theme.colors.warning, lineHeight: 1.4 }}>
                <strong>Subaccount transfer.</strong> Verify the recipient controls this subaccount.
              </div>
            </div>
          )}

          {/* Error display */}
          {errorText && (
            <div style={{
              padding: '10px',
              background: `${theme.colors.error}15`,
              border: `1px solid ${theme.colors.error}30`,
              borderRadius: '6px',
              marginBottom: '16px',
              color: theme.colors.error,
              fontSize: '0.8rem'
            }}>
              {errorText}
            </div>
          )}

          {/* Action Buttons - Compact */}
          {isLoading ? (
            <div style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              padding: '16px'
            }}>
              <div style={{
                width: '32px',
                height: '32px',
                border: `3px solid ${theme.colors.border}`,
                borderTop: `3px solid ${theme.colors.accent}`,
                borderRadius: '50%',
                animation: 'spin 1s linear infinite',
                marginBottom: '8px'
              }}></div>
              <div style={{ color: theme.colors.mutedText, fontSize: '0.85rem' }}>Sending...</div>
            </div>
          ) : (
            <div style={{ display: 'flex', gap: '10px' }}>
              <button
                onClick={() => setShowReviewScreen(false)}
                style={{
                  flex: 1,
                  padding: '12px 16px',
                  background: theme.colors.secondaryBg,
                  color: theme.colors.primaryText,
                  border: `1px solid ${theme.colors.border}`,
                  borderRadius: '10px',
                  cursor: 'pointer',
                  fontSize: '0.9rem',
                  fontWeight: '500',
                  transition: 'all 0.2s ease'
                }}
              >
                ← Back
              </button>
              <button
                onClick={handleConfirmSend}
                style={{
                  flex: 2,
                  padding: '12px 16px',
                  background: `linear-gradient(135deg, ${walletPrimary}, ${walletSecondary})`,
                  color: 'white',
                  border: 'none',
                  borderRadius: '10px',
                  cursor: 'pointer',
                  fontSize: '0.9rem',
                  fontWeight: '600',
                  transition: 'all 0.2s ease',
                  boxShadow: `0 4px 12px ${walletPrimary}40`
                }}
              >
                Confirm & Send
              </button>
            </div>
          )}
          </div>
        </div>
      </div>
    );
  }

  // Main Form Screen
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
        width: '520px',
        maxWidth: '90vw',
        maxHeight: '90vh',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden'
      }}>
        {/* Header */}
        <div style={{
          background: `linear-gradient(135deg, ${walletPrimary}, ${walletSecondary})`,
          padding: '1rem 1.25rem',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div style={{
              width: '36px',
              height: '36px',
              borderRadius: '10px',
              background: 'rgba(255, 255, 255, 0.2)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0
            }}>
              {token.logo && logoLoaded ? (
                <img
                  src={token.logo}
                  alt={`${token.symbol} logo`}
                  style={{ width: '22px', height: '22px', borderRadius: '6px', objectFit: 'contain' }}
                />
              ) : (
                <span style={{ fontSize: '16px' }}>💸</span>
              )}
            </div>
            <h2 style={{
              color: 'white',
              margin: 0,
              fontSize: '1.2rem',
              fontWeight: '600'
            }}>
              Send {token.symbol}
            </h2>
          </div>
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
              opacity: isLoading ? 0.5 : 1,
              transition: 'all 0.2s ease'
            }}
          >
            ×
          </button>
        </div>

        {/* Content */}
        <div style={{ padding: '1.25rem', flex: 1, overflowY: 'auto' }}>
          {/* Balance Info */}
          <div style={{
            background: `linear-gradient(135deg, ${walletPrimary}12 0%, ${walletSecondary}08 100%)`,
            border: `1px solid ${walletPrimary}25`,
            borderRadius: '12px',
            padding: '12px 16px',
            marginBottom: '20px',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center'
          }}>
            <span style={{ color: theme.colors.mutedText, fontSize: '0.85rem' }}>Available balance</span>
            <span style={{ color: walletPrimary, fontWeight: '700', fontSize: '1rem' }}>
              {formatAmount(token.available ?? token.balance ?? 0n, token.decimals)} {token.symbol}
            </span>
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
          <PrincipalInput
            value={recipient}
            onChange={setRecipient}
            placeholder="Enter principal ID, name, or extended address"
            style={{
              width: '100%',
              maxWidth: 'none'
            }}
            inputStyle={{
              padding: '12px',
              fontSize: '0.9rem'
            }}
          />

          {/* Extended address detection feedback */}
          {extendedAddressDetected && (
            <div style={{
              marginTop: '8px',
              padding: '12px',
              background: `${theme.colors.success}15`,
              border: `1px solid ${theme.colors.success}40`,
              borderRadius: '8px',
              fontSize: '0.85rem'
            }}>
              <div style={{ color: theme.colors.success, fontWeight: '600', marginBottom: '10px' }}>
                ✓ Extended address format detected
              </div>
              
              {/* Principal with copy button */}
              <div style={{ marginBottom: '8px' }}>
                <div style={{ color: theme.colors.secondaryText, marginBottom: '4px', fontWeight: '500' }}>
                  Principal:
                </div>
                <div style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: '8px',
                  background: theme.colors.tertiaryBg,
                  padding: '8px 10px',
                  borderRadius: '6px',
                  border: `1px solid ${theme.colors.border}`
                }}>
                  <span style={{
                    flex: 1,
                    fontFamily: 'monospace',
                    fontSize: '0.8rem',
                    color: theme.colors.primaryText,
                    wordBreak: 'break-all',
                    overflowWrap: 'anywhere'
                  }}>
                    {extendedAddressDetected.principal.toText()}
                  </span>
                  <button
                    onClick={() => navigator.clipboard.writeText(extendedAddressDetected.principal.toText())}
                    style={{
                      background: 'none',
                      border: 'none',
                      padding: '2px',
                      cursor: 'pointer',
                      color: theme.colors.mutedText,
                      fontSize: '14px',
                      flexShrink: 0
                    }}
                    title="Copy principal"
                  >
                    📋
                  </button>
                </div>
              </div>
              
              {/* Subaccount with copy button */}
              {extendedAddressDetected.subaccount && (
                <div style={{ marginBottom: '12px' }}>
                  <div style={{ color: theme.colors.secondaryText, marginBottom: '4px', fontWeight: '500' }}>
                    Subaccount:
                  </div>
                  <div style={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: '8px',
                    background: theme.colors.tertiaryBg,
                    padding: '8px 10px',
                    borderRadius: '6px',
                    border: `1px solid ${theme.colors.border}`
                  }}>
                    <span style={{
                      flex: 1,
                      fontFamily: 'monospace',
                      fontSize: '0.8rem',
                      color: theme.colors.primaryText,
                      wordBreak: 'break-all',
                      overflowWrap: 'anywhere'
                    }}>
                      {bytesToHex(extendedAddressDetected.subaccount.resolved)}
                    </span>
                    <button
                      onClick={() => navigator.clipboard.writeText(bytesToHex(extendedAddressDetected.subaccount.resolved))}
                      style={{
                        background: 'none',
                        border: 'none',
                        padding: '2px',
                        cursor: 'pointer',
                        color: theme.colors.mutedText,
                        fontSize: '14px',
                        flexShrink: 0
                      }}
                      title="Copy subaccount"
                    >
                      📋
                    </button>
                  </div>
                </div>
              )}

              {/* Convert to explicit button */}
              <button
                onClick={handleConvertToExplicit}
                style={{
                  width: '100%',
                  padding: '8px 12px',
                  background: theme.colors.tertiaryBg,
                  color: theme.colors.accent,
                  border: `1px solid ${theme.colors.accent}50`,
                  borderRadius: '6px',
                  cursor: 'pointer',
                  fontSize: '0.8rem',
                  fontWeight: '500',
                  transition: 'all 0.2s ease'
                }}
                onMouseEnter={(e) => {
                  e.target.style.background = `${theme.colors.accent}20`;
                }}
                onMouseLeave={(e) => {
                  e.target.style.background = theme.colors.tertiaryBg;
                }}
              >
                Use Explicit Principal + Subaccount
              </button>
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
              {!showSubaccountInput && resolvedManualSubaccount && (
                <span style={{
                  background: `${theme.colors.warning}20`,
                  color: theme.colors.warning,
                  fontSize: '0.7rem',
                  padding: '2px 6px',
                  borderRadius: '4px',
                  fontWeight: '600',
                  marginLeft: '4px'
                }}>
                  SET
                </span>
              )}
            </button>

            {/* Collapsed subaccount indicator */}
            {!showSubaccountInput && resolvedManualSubaccount && (
              <div style={{
                marginTop: '8px',
                padding: '10px 12px',
                background: `${theme.colors.warning}10`,
                border: `1px solid ${theme.colors.warning}30`,
                borderRadius: '6px',
                display: 'flex',
                alignItems: 'flex-start',
                gap: '8px'
              }}>
                <span style={{ fontSize: '14px' }}>📍</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ 
                    color: theme.colors.warning, 
                    fontSize: '0.75rem', 
                    fontWeight: '600',
                    marginBottom: '4px'
                  }}>
                    Sending to subaccount:
                  </div>
                  <div style={{
                    fontFamily: 'monospace',
                    fontSize: '0.7rem',
                    color: theme.colors.secondaryText,
                    wordBreak: 'break-all',
                    overflowWrap: 'anywhere'
                  }}>
                    {bytesToHex(resolvedManualSubaccount.resolved).slice(0, 32)}...
                  </div>
                </div>
                <button
                  onClick={() => setShowSubaccountInput(true)}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: theme.colors.accent,
                    cursor: 'pointer',
                    fontSize: '0.7rem',
                    padding: '2px 4px',
                    flexShrink: 0
                  }}
                >
                  Edit
                </button>
              </div>
            )}

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
                    <div style={{ color: theme.colors.success, marginBottom: '6px', fontWeight: '600' }}>
                      ✓ Valid subaccount
                    </div>
                    <div style={{ color: theme.colors.secondaryText, marginBottom: '4px', fontWeight: '500' }}>
                      Resolved (hex):
                    </div>
                    <div style={{
                      display: 'flex',
                      alignItems: 'flex-start',
                      gap: '8px',
                      background: theme.colors.tertiaryBg,
                      padding: '8px 10px',
                      borderRadius: '6px',
                      border: `1px solid ${theme.colors.border}`
                    }}>
                      <span style={{
                        flex: 1,
                        fontFamily: 'monospace',
                        fontSize: '0.75rem',
                        color: theme.colors.primaryText,
                        wordBreak: 'break-all',
                        overflowWrap: 'anywhere'
                      }}>
                        {bytesToHex(resolvedManualSubaccount.resolved)}
                      </span>
                      <button
                        onClick={() => navigator.clipboard.writeText(bytesToHex(resolvedManualSubaccount.resolved))}
                        style={{
                          background: 'none',
                          border: 'none',
                          padding: '2px',
                          cursor: 'pointer',
                          color: theme.colors.mutedText,
                          fontSize: '14px',
                          flexShrink: 0
                        }}
                        title="Copy subaccount hex"
                      >
                        📋
                      </button>
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
              type="text"
              inputMode="decimal"
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
                background: `linear-gradient(135deg, ${walletPrimary}, ${walletSecondary})`,
                color: 'white',
                border: 'none',
                borderRadius: '10px',
                padding: '12px 16px',
                cursor: 'pointer',
                fontSize: '0.85rem',
                fontWeight: '600',
                transition: 'all 0.2s ease'
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
            <span style={{ color: theme.colors.mutedText, fontSize: '0.85rem' }}>Processing...</span>
          </div>
        ) : (
          <div style={{
            display: 'flex',
            gap: '12px',
            marginTop: '20px'
          }}>
            <button
              onClick={handleReview}
              disabled={isLoading}
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
                transition: 'all 0.2s ease',
                boxShadow: `0 4px 12px ${walletPrimary}40`
              }}
            >
              Review Transaction
            </button>
            <button
              onClick={onClose}
              disabled={isLoading}
              style={{
                flex: '1',
                background: theme.colors.secondaryBg,
                color: theme.colors.primaryText,
                border: `1px solid ${theme.colors.border}`,
                borderRadius: '10px',
                padding: '14px 24px',
                cursor: 'pointer',
                fontSize: '0.95rem',
                fontWeight: '500',
                transition: 'all 0.2s ease'
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

export default SendTokenModal;
