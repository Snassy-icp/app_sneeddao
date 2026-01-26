import React, { useState, useRef, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { FaCopy, FaCheck } from 'react-icons/fa';
import { useAuth } from './AuthContext';
import { useTheme } from './contexts/ThemeContext';
import { useNaming } from './NamingContext';
import { computeAccountId } from './utils/PrincipalUtils';
import ThemeToggle from './components/ThemeToggle';
import './PrincipalBox.css';

function PrincipalBox({ principalText, onLogout, compact = false }) {
    const [showPopup, setShowPopup] = useState(false);
    const [copyFeedback, setCopyFeedback] = useState('');
    const [copied, setCopied] = useState(false);
    const popupRef = useRef(null);
    const { login, identity } = useAuth();
    const { theme } = useTheme();
    const { getPrincipalDisplayName } = useNaming();
    const navigate = useNavigate();

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
                      boxShadow: '0 8px 32px rgba(0, 0, 0, 0.3)',
                      '@media (max-width: 480px)': {
                          right: '-16px',
                          width: 'calc(100vw - 64px)'
                      }
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

                  {/* Theme Toggle */}
                  <div style={{ 
                      marginBottom: '12px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '8px 0',
                      borderTop: `1px solid ${theme.colors.border}`,
                      borderBottom: `1px solid ${theme.colors.border}`
                  }}>
                      <span style={{ 
                          color: theme.colors.mutedText, 
                          fontSize: '12px'
                      }}>
                          Theme
                      </span>
                      <ThemeToggle size="small" />
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
  );
}

export default PrincipalBox;