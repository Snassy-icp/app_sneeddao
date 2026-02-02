import React, { useState, useRef, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { FaCopy, FaCheck, FaWallet, FaPaperPlane, FaKey, FaIdCard, FaExternalLinkAlt } from 'react-icons/fa';
import { useAuth } from './AuthContext';
import { useTheme } from './contexts/ThemeContext';
import { useNaming } from './NamingContext';
import { useWalletOptional } from './contexts/WalletContext';
import { computeAccountId } from './utils/PrincipalUtils';
import { formatAmount } from './utils/StringUtils';
import SendTokenModal from './SendTokenModal';
import TokenCardModal from './components/TokenCardModal';
import LockModal from './LockModal';
import { usePremiumStatus } from './hooks/usePremiumStatus';
import './PrincipalBox.css';

function PrincipalBox({ principalText, onLogout, compact = false }) {
    const [showPopup, setShowPopup] = useState(false);
    const [copyFeedback, setCopyFeedback] = useState('');
    const [copied, setCopied] = useState(false);
    const [showSendModal, setShowSendModal] = useState(false);
    const [selectedToken, setSelectedToken] = useState(null);
    const [showTokenDetailModal, setShowTokenDetailModal] = useState(false);
    const [detailToken, setDetailToken] = useState(null);
    const [showLockModal, setShowLockModal] = useState(false);
    const [lockToken, setLockToken] = useState(null);
    const popupRef = useRef(null);
    const { login, identity } = useAuth();
    const { theme } = useTheme();
    const { getPrincipalDisplayName } = useNaming();
    const walletContext = useWalletOptional();
    const navigate = useNavigate();
    const { isPremium } = usePremiumStatus(identity);
    
    // Get wallet tokens from context
    const walletTokens = walletContext?.walletTokens || [];
    const walletLoading = walletContext?.walletLoading || false;
    const sendToken = walletContext?.sendToken;
    const isTokenSns = walletContext?.isTokenSns;
    
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
        if (e) e.stopPropagation();
        setSelectedToken(token);
        setShowSendModal(true);
    };
    
    // Handle send token
    const handleSendToken = async (token, recipient, amount, subaccount = []) => {
        if (sendToken) {
            await sendToken(token, recipient, amount, subaccount);
        }
    };
    
    // Open token detail modal
    const openTokenDetailModal = (token) => {
        setDetailToken(token);
        setShowTokenDetailModal(true);
        setShowPopup(false); // Close the popup when opening the modal
    };
    
    // Handle send from token detail modal
    const handleOpenSendFromDetail = (token) => {
        setShowTokenDetailModal(false);
        setSelectedToken(token);
        setShowSendModal(true);
    };
    
    // Handle lock from token detail modal - open lock modal
    const handleOpenLockFromDetail = (token) => {
        setShowTokenDetailModal(false);
        setLockToken(token);
        setShowLockModal(true);
    };
    
    // Handle when a lock is added - refresh wallet data
    const handleAddLock = () => {
        if (walletContext?.refreshWallet) {
            walletContext.refreshWallet();
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
              {compact ? <FaWallet size={18} /> : truncateString(principalText, 15, "...", 3, 3)}
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
                      borderRadius: '16px',
                      padding: '0',
                      zIndex: 1000,
                      minWidth: '300px',
                      maxWidth: '340px',
                      width: 'calc(100vw - 32px)',
                      boxShadow: '0 12px 40px rgba(0, 0, 0, 0.4)',
                      overflow: 'hidden'
                  }}
              >
                  {/* Header Banner with Gradient */}
                  <div style={{
                      background: 'linear-gradient(135deg, #10b981 0%, #059669 50%, #047857 100%)',
                      padding: '16px 20px',
                      position: 'relative',
                      overflow: 'hidden'
                  }}>
                      {/* Decorative pattern */}
                      <div style={{
                          position: 'absolute',
                          inset: 0,
                          opacity: 0.1,
                          backgroundImage: 'radial-gradient(circle at 20% 50%, white 1px, transparent 1px), radial-gradient(circle at 80% 50%, white 1px, transparent 1px)',
                          backgroundSize: '30px 30px',
                          pointerEvents: 'none'
                      }} />
                      
                      {/* User Info */}
                      <div style={{ position: 'relative', zIndex: 1 }}>
                          {userName ? (
                              <button
                                  onClick={() => {
                                      navigate('/me');
                                      setShowPopup(false);
                                  }}
                                  style={{
                                      background: 'none',
                                      border: 'none',
                                      padding: 0,
                                      color: 'white',
                                      fontSize: '1.1rem',
                                      fontWeight: '600',
                                      cursor: 'pointer',
                                      display: 'flex',
                                      alignItems: 'center',
                                      gap: '8px',
                                      textShadow: '0 2px 8px rgba(0,0,0,0.2)'
                                  }}
                              >
                                  {userName}
                                  <FaExternalLinkAlt size={10} style={{ opacity: 0.7 }} />
                              </button>
                          ) : (
                              <button
                                  onClick={() => {
                                      navigate('/me');
                                      setShowPopup(false);
                                  }}
                                  style={{
                                      background: 'rgba(255,255,255,0.2)',
                                      border: 'none',
                                      padding: '6px 12px',
                                      borderRadius: '6px',
                                      color: 'white',
                                      fontSize: '0.85rem',
                                      fontWeight: '500',
                                      cursor: 'pointer',
                                      display: 'flex',
                                      alignItems: 'center',
                                      gap: '6px'
                                  }}
                              >
                                  Set up profile
                                  <FaExternalLinkAlt size={9} />
                              </button>
                          )}
                      </div>
                  </div>

                  {/* Identity Cards Section */}
                  <div style={{ padding: '12px 16px' }}>
                      {/* Principal ID Card */}
                      <div 
                          onClick={() => handleCopy(principalText, 'principal')}
                          style={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: '12px',
                              padding: '12px',
                              background: theme.colors.primaryBg,
                              borderRadius: '10px',
                              cursor: 'pointer',
                              marginBottom: '8px',
                              transition: 'all 0.2s ease',
                              border: `1px solid ${copied && copiedType === 'principal' ? '#10b981' : 'transparent'}`
                          }}
                          onMouseOver={(e) => {
                              if (!(copied && copiedType === 'principal')) {
                                  e.currentTarget.style.borderColor = theme.colors.border;
                              }
                          }}
                          onMouseOut={(e) => {
                              if (!(copied && copiedType === 'principal')) {
                                  e.currentTarget.style.borderColor = 'transparent';
                              }
                          }}
                      >
                          <div style={{
                              width: '36px',
                              height: '36px',
                              borderRadius: '8px',
                              background: 'linear-gradient(135deg, #10b98130, #05966920)',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              flexShrink: 0
                          }}>
                              <FaKey size={14} color="#10b981" />
                          </div>
                          <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ 
                                  color: theme.colors.mutedText, 
                                  fontSize: '10px', 
                                  textTransform: 'uppercase',
                                  letterSpacing: '0.5px',
                                  marginBottom: '2px'
                              }}>
                                  Principal ID
                              </div>
                              <div style={{
                                  color: theme.colors.primaryText,
                                  fontSize: '12px',
                                  fontFamily: 'monospace',
                                  fontWeight: '500'
                              }}>
                                  {truncateString(principalText, 22, "...", 8, 8)}
                              </div>
                          </div>
                          <div style={{
                              color: copied && copiedType === 'principal' ? '#10b981' : theme.colors.mutedText,
                              transition: 'color 0.2s ease'
                          }}>
                              {copied && copiedType === 'principal' ? <FaCheck size={14} /> : <FaCopy size={14} />}
                          </div>
                      </div>
                      
                      {/* Account ID Card */}
                      {accountId && (
                          <div 
                              onClick={() => handleCopy(accountId, 'accountId')}
                              style={{
                                  display: 'flex',
                                  alignItems: 'center',
                                  gap: '12px',
                                  padding: '12px',
                                  background: theme.colors.primaryBg,
                                  borderRadius: '10px',
                                  cursor: 'pointer',
                                  marginBottom: '12px',
                                  transition: 'all 0.2s ease',
                                  border: `1px solid ${copied && copiedType === 'accountId' ? '#10b981' : 'transparent'}`
                              }}
                              onMouseOver={(e) => {
                                  if (!(copied && copiedType === 'accountId')) {
                                      e.currentTarget.style.borderColor = theme.colors.border;
                                  }
                              }}
                              onMouseOut={(e) => {
                                  if (!(copied && copiedType === 'accountId')) {
                                      e.currentTarget.style.borderColor = 'transparent';
                                  }
                              }}
                          >
                              <div style={{
                                  width: '36px',
                                  height: '36px',
                                  borderRadius: '8px',
                                  background: 'linear-gradient(135deg, #3b82f630, #1d4ed820)',
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                  flexShrink: 0
                              }}>
                                  <FaIdCard size={14} color="#3b82f6" />
                              </div>
                              <div style={{ flex: 1, minWidth: 0 }}>
                                  <div style={{ 
                                      color: theme.colors.mutedText, 
                                      fontSize: '10px', 
                                      textTransform: 'uppercase',
                                      letterSpacing: '0.5px',
                                      marginBottom: '2px',
                                      display: 'flex',
                                      alignItems: 'center',
                                      gap: '6px'
                                  }}>
                                      Account ID
                                      <span style={{
                                          background: '#3b82f620',
                                          color: '#3b82f6',
                                          fontSize: '8px',
                                          padding: '2px 5px',
                                          borderRadius: '4px',
                                          fontWeight: '600',
                                          textTransform: 'none'
                                      }}>
                                          CEX
                                      </span>
                                  </div>
                                  <div style={{
                                      color: theme.colors.primaryText,
                                      fontSize: '11px',
                                      fontFamily: 'monospace',
                                      fontWeight: '500'
                                  }}>
                                      {truncateString(accountId, 22, "...", 8, 8)}
                                  </div>
                              </div>
                              <div style={{
                                  color: copied && copiedType === 'accountId' ? '#10b981' : theme.colors.mutedText,
                                  transition: 'color 0.2s ease'
                              }}>
                                  {copied && copiedType === 'accountId' ? <FaCheck size={14} /> : <FaCopy size={14} />}
                              </div>
                          </div>
                      )}
                      
                      {/* Copy feedback toast */}
                      {copyFeedback && (
                          <div style={{
                              background: '#10b981',
                              color: 'white',
                              fontSize: '12px',
                              fontWeight: '500',
                              padding: '8px 12px',
                              borderRadius: '6px',
                              textAlign: 'center',
                              marginBottom: '12px',
                              animation: 'fadeIn 0.2s ease'
                          }}>
                              {copyFeedback}
                          </div>
                      )}
                  </div>
                  
                  {/* Divider */}
                  <div style={{ 
                      height: '1px', 
                      background: theme.colors.border,
                      margin: '0 16px'
                  }} />
                  
                  {/* Wallet Section - now in the padding area */}
                  <div style={{ padding: '12px 16px' }}>

                  {/* Compact Wallet Section */}
                      <div 
                          style={{ 
                              color: theme.colors.mutedText, 
                              fontSize: '10px', 
                              textTransform: 'uppercase',
                              letterSpacing: '0.5px',
                              marginBottom: '8px',
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
                                  
                                  // Calculate USD value
                                  const balanceNum = Number(totalBalance) / (10 ** (token.decimals || 8));
                                  const usdValue = token.conversion_rate ? balanceNum * token.conversion_rate : token.usdValue;
                                  
                                  return (
                                      <div 
                                          key={ledgerId || index}
                                          className="compact-wallet-token"
                                          onClick={() => openTokenDetailModal(token)}
                                          style={{
                                              display: 'flex',
                                              alignItems: 'center',
                                              padding: '8px 12px',
                                              borderBottom: index < tokensWithBalance.length - 1 ? `1px solid ${theme.colors.border}` : 'none',
                                              gap: '10px',
                                              cursor: 'pointer'
                                          }}
                                      >
                                          {/* Token Logo */}
                                          <div style={{ 
                                              width: '28px', 
                                              height: '28px', 
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
                                                          width: '28px',
                                                          height: '28px',
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
                                                      width: '28px',
                                                      height: '28px',
                                                      borderRadius: '50%',
                                                      backgroundColor: theme.colors.accent,
                                                      display: token.logo ? 'none' : 'flex',
                                                      alignItems: 'center',
                                                      justifyContent: 'center',
                                                      fontSize: '11px',
                                                      fontWeight: 'bold',
                                                      color: theme.colors.primaryText
                                                  }}
                                              >
                                                  {token.symbol?.charAt(0) || '?'}
                                              </div>
                                          </div>
                                          
                                          {/* Balance, Symbol and USD Value */}
                                          <div style={{ 
                                              flex: 1, 
                                              minWidth: 0,
                                              display: 'flex',
                                              flexDirection: 'column',
                                              gap: '2px'
                                          }}>
                                              <div style={{
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
                                              {/* USD Value - shows loading indicator or value */}
                                              <span style={{ 
                                                  color: theme.colors.mutedText,
                                                  fontSize: '11px',
                                                  opacity: 0.8
                                              }}>
                                                  {usdValue !== null && usdValue !== undefined 
                                                      ? `$${usdValue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                                                      : <span style={{ opacity: 0.5 }}>...</span>
                                                  }
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
                                  padding: '10px',
                                  backgroundColor: 'transparent',
                                  border: `1px solid ${theme.colors.border}`,
                                  borderRadius: '8px',
                                  color: theme.colors.accent,
                                  fontSize: '12px',
                                  fontWeight: '500',
                                  cursor: 'pointer',
                                  transition: 'all 0.2s ease',
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                  gap: '6px'
                              }}
                              onMouseOver={(e) => {
                                  e.target.style.backgroundColor = theme.colors.primaryBg;
                                  e.target.style.borderColor = theme.colors.accent;
                              }}
                              onMouseOut={(e) => {
                                  e.target.style.backgroundColor = 'transparent';
                                  e.target.style.borderColor = theme.colors.border;
                              }}
                          >
                              <FaWallet size={11} />
                              View Full Wallet
                          </button>
                      )}
                  </div>

                  {/* Log Out Button */}
                  <div style={{ padding: '0 16px 16px' }}>
                      <button 
                          onClick={onLogout}
                          style={{
                              width: '100%',
                              padding: '12px',
                              background: 'linear-gradient(135deg, #ef4444, #dc2626)',
                              color: 'white',
                              border: 'none',
                              borderRadius: '10px',
                              fontSize: '14px',
                              fontWeight: '600',
                              cursor: 'pointer',
                              transition: 'all 0.2s ease',
                              boxShadow: '0 4px 12px rgba(239, 68, 68, 0.3)'
                          }}
                          onMouseOver={(e) => {
                              e.target.style.transform = 'translateY(-1px)';
                              e.target.style.boxShadow = '0 6px 16px rgba(239, 68, 68, 0.4)';
                          }}
                          onMouseOut={(e) => {
                              e.target.style.transform = 'translateY(0)';
                              e.target.style.boxShadow = '0 4px 12px rgba(239, 68, 68, 0.3)';
                          }}
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
      
      {/* Token Detail Modal */}
      <TokenCardModal
          show={showTokenDetailModal}
          onClose={() => {
              setShowTokenDetailModal(false);
              setDetailToken(null);
          }}
          token={detailToken}
          openSendModal={handleOpenSendFromDetail}
          openLockModal={handleOpenLockFromDetail}
          hideButtons={false}
          isSnsToken={detailToken && isTokenSns ? isTokenSns(detailToken.ledger_canister_id) : false}
      />
      
      {/* Lock Modal */}
      <LockModal
          show={showLockModal}
          onClose={() => {
              setShowLockModal(false);
              setLockToken(null);
          }}
          token={lockToken}
          locks={{}}
          onAddLock={handleAddLock}
          identity={identity}
          isPremium={isPremium}
      />
  </>
  );
}

export default PrincipalBox;