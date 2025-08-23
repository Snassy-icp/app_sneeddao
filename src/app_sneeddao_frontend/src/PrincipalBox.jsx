import React, { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { FaCopy, FaCheck } from 'react-icons/fa';
import { useAuth } from './AuthContext';
import { useNaming } from './NamingContext';
import './PrincipalBox.css';

function PrincipalBox({ principalText, onLogout, compact = false }) {
    const [showPopup, setShowPopup] = useState(false);
    const [copyFeedback, setCopyFeedback] = useState('');
    const [copied, setCopied] = useState(false);
    const popupRef = useRef(null);
    const { login, identity } = useAuth();
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

    const handleCopy = async () => {
        try {
            await navigator.clipboard.writeText(principalText);
            setCopied(true);
            setCopyFeedback('Copied to clipboard!');
            
            // Reset after 2 seconds
            setTimeout(() => {
                setCopied(false);
                setCopyFeedback('');
            }, 2000);
        } catch (err) {
            // Fallback for older browsers
            const textArea = document.createElement('textarea');
            textArea.value = principalText;
            document.body.appendChild(textArea);
            textArea.select();
            try {
                document.execCommand('copy');
                setCopied(true);
                setCopyFeedback('Copied to clipboard!');
                setTimeout(() => {
                    setCopied(false);
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
      <div className="principal-box-container" style={{ position: 'relative' }}>
          <button 
              className={compact ? "principal-button-compact" : "principal-button"} 
              onClick={() => setShowPopup(true)}
              title={compact ? `Logged in as: ${truncateString(principalText, 15, "...", 3, 3)}` : undefined}
              style={compact ? {
                  background: 'none',
                  border: 'none',
                  color: '#fff',
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
                  ref={popupRef}
                  style={{
                      position: 'absolute',
                      top: '100%',
                      right: '0',
                      backgroundColor: '#2c2c2e',
                      border: '1px solid #48484a',
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
                      <div className="principal-id-container" onClick={handleCopy}>
                          <span className="principal-id-text">
                              {truncateString(principalText, 20, "...", 6, 6)}
                          </span>
                          <button
                              className={`copy-button ${copied ? 'copied' : ''}`}
                              onClick={(e) => {
                                  e.stopPropagation();
                                  handleCopy();
                              }}
                          >
                              {copied ? <FaCheck size={12} /> : <FaCopy size={12} />}
                          </button>
                      </div>
                      
                      {/* Copy feedback */}
                      {copyFeedback && (
                          <div className="copy-feedback">
                              {copyFeedback}
                          </div>
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
  );
}

export default PrincipalBox;