import React, { useState, useRef, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { FaCopy, FaCheck, FaWallet, FaPaperPlane } from 'react-icons/fa';
import { useAuth } from './AuthContext';
import { useTheme } from './contexts/ThemeContext';
import { useNaming } from './NamingContext';
import { useWalletOptional } from './contexts/WalletContext';
import { computeAccountId } from './utils/PrincipalUtils';
import { formatAmount } from './utils/StringUtils';
import SendTokenModal from './SendTokenModal';
import './PrincipalBox.css';

function PrincipalBox({ principalText, onLogout, compact = false }) {
    const [showPopup, setShowPopup] = useState(false);
    const [copyFeedback, setCopyFeedback] = useState('');
    const [copied, setCopied] = useState(false);
    const [showSendModal, setShowSendModal] = useState(false);
    const [selectedToken, setSelectedToken] = useState(null);
    const popupRef = useRef(null);
    const { login, identity } = useAuth();
    const { theme } = useTheme();
    const { getPrincipalDisplayName } = useNaming();
    const walletContext = useWalletOptional();
    const navigate = useNavigate();
    
    // Get wallet tokens from context
    const walletTokens = walletContext?.walletTokens || [];
    const walletLoading = walletContext?.walletLoading || false;
    const sendToken = walletContext?.sendToken;
    
    // Filter tokens to only show those with balance > 0
    const tokensWithBalance = useMemo(() => {
        return walletTokens.filter(token => {
            const available = BigInt(token.available || token.balance || 0n);
            const locked = BigInt(token.locked || 0n);
            const staked = BigInt(token.staked || 0n);
            const maturity = BigInt(token.maturity || 0n);
            const rewards = BigInt(token.rewards || 0n);
            const totalBalance = available + locked + staked + maturity + rewards;
            return totalBalance > 0n;
        });
    }, [walletTokens]);
    
    // Open send modal for a token
    const openSendModal = (token, e) => {
        e.stopPropagation();
        setSelectedToken(token);
        setShowSendModal(true);
    };
    
    // Handle send token
    const handleSendToken = async (token, recipient, amount, subaccount = []) => {
        if (sendToken) {
            await sendToken(token, recipient, amount, subaccount);
        }
    };

    // Add click outside handler
    useEffect(() => {
        const handleClickOutside = (event) => {
            if (popupRef.current && !popupRef.current.contains(event.target)) {
                setShowPopup(false);
            }
        };

        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    const truncateString = (
      fullStr,
      strLen = 28,
      separator = "...",
      frontChars = 6,
      backChars = 6) => {
      if (fullStr.length <= strLen) return fullStr;
  
      return fullStr.substr(0, frontChars) +
        separator +
        fullStr.substr(fullStr.length - backChars);
    }

    // Get user's display name
    const userDisplayName = identity ? getPrincipalDisplayName(identity.getPrincipal()) : null;
    const userName = userDisplayName?.name;
    
    // Compute account ID for the user's principal
    const accountId = useMemo(() => {
        if (!identity) return null;
        return computeAccountId(identity.getPrincipal());
    }, [identity]);
    
    // Track which value was copied (principal or accountId)
    const [copiedType, setCopiedType] = useState(null);

    const handleCopy = async (text, type = 'principal') => {
        try {
            await navigator.clipboard.writeText(text);
            setCopied(true);
            setCopiedType(type);
            setCopyFeedback(type === 'accountId' ? 'Account ID copied!' : 'Principal copied!');
            
            // Reset after 2 seconds
            setTimeout(() => {
                setCopied(false);
                setCopiedType(null);
                setCopyFeedback('');
            }, 2000);
        } catch (err) {
            // Fallback for older browsers
            const textArea = document.createElement('textarea');
            textArea.value = text;
            document.body.appendChild(textArea);
            textArea.select();
            try {
                document.execCommand('copy');
                setCopied(true);
                setCopiedType(type);
                setCopyFeedback(type === 'accountId' ? 'Account ID copied!' : 'Principal copied!');
                setTimeout(() => {
                    setCopied(false);
                    setCopiedType(null);
                    setCopyFeedback('');
                }, 2000);
            } catch (fallbackErr) {
                setCopyFeedback('Failed to copy');
                setTimeout(() => setCopyFeedback(''), 2000);
            }
            document.body.removeChild(textArea);
        }
    };

    // If not logged in, show login button
    if (principalText === "Not logged in.") {
        return (
            <button className="principal-button" onClick={login}>
                Login
            </button>
        );
    }

    return (
      <>
      <div className="principal-box-container" ref={popupRef} style={{ position: 'relative' }}>
          <button 
              className={compact ? "principal-button-compact" : "principal-button"} 
              onClick={() => setShowPopup(!showPopup)}
              title={compact ? `Logged in as: ${truncateString(principalText, 15, "...", 3, 3)}` : undefined}
              style={compact ? {
                  background: 'none',
                  border: 'none',
                  color: theme.colors.primaryText,
                  cursor: 'pointer',
                  padding: '8px',
                  borderRadius: '4px',
                  display: 'flex',
                  alignItems: 'center',
                  fontSize: '18px'
              } : undefined}
          >
              {compact ? '👤' : truncateString(principalText, 15, "...", 3, 3)}
          </button>
          {showPopup && (
              <div 
                  className="principal-popup"
                  onMouseDown={(e) => e.stopPropagation()}
                  style={{
                      position: 'absolute',
                      top: '100%',
                      right: '0',
                      backgroundColor: theme.colors.secondaryBg,
                      border: `1px solid ${theme.colors.border}`,
                      borderRadius: '12px',
                      padding: '16px',
                      zIndex: 1000,
                      minWidth: '280px',
                      maxWidth: '320px',
                      width: 'calc(100vw - 32px)',
                      boxShadow: '0 8px 32px rgba(0, 0, 0, 0.3)'
                  }}
              >
                  {/* User Name Section */}
                  {userName && (
                      <div style={{ marginBottom: '12px' }}>
                          <button
                              className="user-name-link"
                              onClick={() => {
                                  navigate('/me');
                                  setShowPopup(false);
                              }}
                          >
                              {userName}
                          </button>
                      </div>
                  )}
                  
                  {/* Principal ID Section */}
                  <div style={{ marginBottom: '12px' }}>
                      <div style={{ 
                          color: theme.colors.mutedText, 
                          fontSize: '10px', 
                          textTransform: 'uppercase',
                          letterSpacing: '0.5px',
                          marginBottom: '4px'
                      }}>
                          Principal ID
                      </div>
                      <div className="principal-id-container" onClick={() => handleCopy(principalText, 'principal')}>
                          <span className="principal-id-text">
                              {truncateString(principalText, 20, "...", 6, 6)}
                          </span>
                          <button
                              className={`copy-button ${copied && copiedType === 'principal' ? 'copied' : ''}`}
                              onClick={(e) => {
                                  e.stopPropagation();
                                  handleCopy(principalText, 'principal');
                              }}
                          >
                              {copied && copiedType === 'principal' ? <FaCheck size={12} /> : <FaCopy size={12} />}
                          </button>
                      </div>
                  </div>
                  
                  {/* Account ID Section */}
                  {accountId && (
                      <div style={{ marginBottom: '12px' }}>
                          <div style={{ 
                              color: theme.colors.mutedText, 
                              fontSize: '10px', 
                              textTransform: 'uppercase',
                              letterSpacing: '0.5px',
                              marginBottom: '4px',
                              display: 'flex',
                              alignItems: 'center',
                              gap: '6px'
                          }}>
                              Account ID 
                              <span style={{ 
                                  color: theme.colors.accent, 
                                  fontSize: '9px',
                                  fontWeight: 'normal',
                                  textTransform: 'none'
                              }}>
                                  (for CEX)
                              </span>
                          </div>
                          <div 
                              className="principal-id-container" 
                              onClick={() => handleCopy(accountId, 'accountId')}
                              style={{ cursor: 'pointer' }}
                          >
                              <span className="principal-id-text" style={{ fontSize: '11px' }}>
                                  {truncateString(accountId, 20, "...", 8, 8)}
                              </span>
                              <button
                                  className={`copy-button ${copied && copiedType === 'accountId' ? 'copied' : ''}`}
                                  onClick={(e) => {
                                      e.stopPropagation();
                                      handleCopy(accountId, 'accountId');
                                  }}
                              >
                                  {copied && copiedType === 'accountId' ? <FaCheck size={12} /> : <FaCopy size={12} />}
                              </button>
                          </div>
                      </div>
                  )}
                      
                  {/* Copy feedback */}
                  {copyFeedback && (
                      <div className="copy-feedback">
                          {copyFeedback}
                      </div>
                  )}

                  {/* Compact Wallet Section */}
                  <div style={{ marginBottom: '12px' }}>
                      <div 
                          style={{ 
                              color: theme.colors.mutedText, 
                              fontSize: '10px', 
                              textTransform: 'uppercase',
                              letterSpacing: '0.5px',
                              marginBottom: '4px',
                              display: 'flex',
                              alignItems: 'center',
                              gap: '6px'
                          }}
                      >
                          <FaWallet size={10} />
                          Wallet
                      </div>
                      <div 
                          className="compact-wallet-container"
                          style={{
                              backgroundColor: theme.colors.primaryBg,
                              borderRadius: '8px',
                              maxHeight: '200px',
                              overflowY: 'auto'
                          }}
                      >
                          {walletLoading ? (
                              <div style={{ 
                                  padding: '12px', 
                                  textAlign: 'center',
                                  color: theme.colors.mutedText,
                                  fontSize: '12px'
                              }}>
                                  Loading...
                              </div>
                          ) : tokensWithBalance.length === 0 ? (
                              <div 
                                  style={{ 
                                      padding: '12px', 
                                      textAlign: 'center',
                                      color: theme.colors.mutedText,
                                      fontSize: '12px',
                                      cursor: 'pointer'
                                  }}
                                  onClick={() => {
                                      navigate('/wallet');
                                      setShowPopup(false);
                                  }}
                              >
                                  No tokens with balance. Visit wallet to add tokens.
                              </div>
                          ) : (
                              tokensWithBalance.map((token, index) => {
                                  const ledgerId = token.ledger_canister_id?.toString?.() || token.ledger_canister_id?.toText?.() || token.ledger_canister_id;
                                  // Calculate total balance (available + locked + staked + maturity + rewards)
                                  const available = BigInt(token.available || token.balance || 0n);
                                  const locked = BigInt(token.locked || 0n);
                                  const staked = BigInt(token.staked || 0n);
                                  const maturity = BigInt(token.maturity || 0n);
                                  const rewards = BigInt(token.rewards || 0n);
                                  const totalBalance = available + locked + staked + maturity + rewards;
                                  
                                  return (
                                      <div 
                                          key={ledgerId || index}
                                          className="compact-wallet-token"
                                          style={{
                                              display: 'flex',
                                              alignItems: 'center',
                                              padding: '8px 12px',
                                              borderBottom: index < tokensWithBalance.length - 1 ? `1px solid ${theme.colors.border}` : 'none',
                                              gap: '10px'
                                          }}
                                      >
                                          {/* Token Logo */}
                                          <div style={{ 
                                              width: '24px', 
                                              height: '24px', 
                                              flexShrink: 0,
                                              display: 'flex',
                                              alignItems: 'center',
                                              justifyContent: 'center'
                                          }}>
                                              {token.logo ? (
                                                  <img 
                                                      src={token.logo}
                                                      alt={token.symbol}
                                                      style={{
                                                          width: '24px',
                                                          height: '24px',
                                                          borderRadius: '50%',
                                                          objectFit: 'cover'
                                                      }}
                                                      onError={(e) => {
                                                          e.target.style.display = 'none';
                                                          e.target.nextSibling.style.display = 'flex';
                                                      }}
                                                  />
                                              ) : null}
                                              <div 
                                                  style={{
                                                      width: '24px',
                                                      height: '24px',
                                                      borderRadius: '50%',
                                                      backgroundColor: theme.colors.accent,
                                                      display: token.logo ? 'none' : 'flex',
                                                      alignItems: 'center',
                                                      justifyContent: 'center',
                                                      fontSize: '10px',
                                                      fontWeight: 'bold',
                                                      color: theme.colors.primaryText
                                                  }}
                                              >
                                                  {token.symbol?.charAt(0) || '?'}
                                              </div>
                                          </div>
                                          
                                          {/* Balance and Symbol (together on the left) */}
                                          <div style={{ 
                                              flex: 1, 
                                              minWidth: 0,
                                              display: 'flex',
                                              alignItems: 'center',
                                              gap: '4px'
                                          }}>
                                              <span style={{ 
                                                  color: theme.colors.primaryText,
                                                  fontSize: '13px',
                                                  fontWeight: '500',
                                                  overflow: 'hidden',
                                                  textOverflow: 'ellipsis',
                                                  whiteSpace: 'nowrap'
                                              }}>
                                                  {formatAmount(totalBalance, token.decimals || 8)}
                                              </span>
                                              <span style={{ 
                                                  color: theme.colors.mutedText,
                                                  fontSize: '12px',
                                                  flexShrink: 0
                                              }}>
                                                  {token.symbol}
                                              </span>
                                          </div>
                                          
                                          {/* Send Button */}
                                          <button
                                              onClick={(e) => openSendModal(token, e)}
                                              style={{
                                                  background: 'none',
                                                  border: 'none',
                                                  padding: '4px 8px',
                                                  cursor: 'pointer',
                                                  color: theme.colors.accent,
                                                  fontSize: '11px',
                                                  display: 'flex',
                                                  alignItems: 'center',
                                                  gap: '4px',
                                                  borderRadius: '4px',
                                                  transition: 'background-color 0.15s ease'
                                              }}
                                              onMouseOver={(e) => e.currentTarget.style.backgroundColor = `${theme.colors.accent}20`}
                                              onMouseOut={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                                              title={`Send ${token.symbol}`}
                                          >
                                              <FaPaperPlane size={10} />
                                              <span>Send</span>
                                          </button>
                                      </div>
                                  );
                              })
                          )}
                      </div>
                      {tokensWithBalance.length > 0 && (
                          <button
                              onClick={() => {
                                  navigate('/wallet');
                                  setShowPopup(false);
                              }}
                              style={{
                                  width: '100%',
                                  marginTop: '8px',
                                  padding: '8px',
                                  backgroundColor: 'transparent',
                                  border: `1px solid ${theme.colors.border}`,
                                  borderRadius: '6px',
                                  color: theme.colors.accent,
                                  fontSize: '12px',
                                  cursor: 'pointer',
                                  transition: 'background-color 0.2s ease'
                              }}
                              onMouseOver={(e) => e.target.style.backgroundColor = theme.colors.primaryBg}
                              onMouseOut={(e) => e.target.style.backgroundColor = 'transparent'}
                          >
                              View Full Wallet
                          </button>
                      )}
                  </div>

                  {/* Action Buttons */}
                  <div className="action-buttons">
                      {!userName && (
                          <button
                              className="me-button"
                              onClick={() => {
                                  navigate('/me');
                                  setShowPopup(false);
                              }}
                          >
                              Me
                          </button>
                      )}
                      
                      <button 
                          className="logout-button"
                          onClick={onLogout}
                      >
                          Log Out
                      </button>
                  </div>
              </div>
          )}
          
      </div>
      
      {/* Send Token Modal - rendered outside the popup container to avoid event interference */}
      <SendTokenModal
          show={showSendModal}
          onClose={() => {
              setShowSendModal(false);
              setSelectedToken(null);
          }}
          onSend={handleSendToken}
          token={selectedToken}
      />
  </>
  );
}

export default PrincipalBox;