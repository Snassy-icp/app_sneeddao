import React, { useState, useRef, useEffect } from 'react';
import { useAuth } from './AuthContext';
import './PrincipalBox.css';

function PrincipalBox({ principalText, onLogout, compact = false }) {
    const [showPopup, setShowPopup] = useState(false);
    const [copyFeedback, setCopyFeedback] = useState('');
    const principalRef = useRef(null);
    const popupRef = useRef(null);
    const { login } = useAuth();

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
      frontChars = 17,
      backChars = 8) => {
      if (fullStr.length <= strLen) return fullStr;
  
      return fullStr.substr(0, frontChars) +
        separator +
        fullStr.substr(fullStr.length - backChars);
    }

    const handleCopy = () => {
      if (principalRef.current) {
          principalRef.current.select();
          principalRef.current.setSelectionRange(0, 99999); // For mobile devices
          
          try {
              document.execCommand('copy');
              setCopyFeedback('Copied!');
          } catch (err) {
              setCopyFeedback('Failed to copy. Please copy manually.');
          }

          // Clear selection
          window.getSelection().removeAllRanges();

          // Clear feedback after 2 seconds
          setTimeout(() => setCopyFeedback(''), 2000);
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
                      backgroundColor: '#1e1e2e',
                      border: '1px solid #3f3f5a',
                      borderRadius: '8px',
                      padding: '16px',
                      zIndex: 1000,
                      minWidth: '300px',
                      width: 'auto'
                  }}
              >
                  <h3 style={{ marginTop: 0, color: 'white', marginBottom: '16px' }}>Your Principal ID</h3>
                  <div style={{ marginBottom: '8px' }}>
                      <textarea
                          ref={principalRef}
                          value={principalText}
                          readOnly
                          style={{
                              width: '100%',
                              backgroundColor: 'transparent',
                              color: '#a0a0b8',
                              border: 'none',
                              padding: '6px 0',
                              fontFamily: 'monospace',
                              fontSize: '12px',
                              overflowWrap: 'break-word',
                              wordWrap: 'break-word',
                              wordBreak: 'break-all',
                              resize: 'none'
                          }}
                          rows={3}
                      />
                  </div>
                  <div style={{ height: '20px', marginBottom: '16px' }}>
                        <p style={{ 
                            color: '#4CAF50',
                            fontSize: '0.9em',
                            margin: 0,
                            lineHeight: '20px'
                        }}>
                            {copyFeedback || '\u00A0'}
                        </p>
                  </div>
                  <div style={{ 
                      display: 'flex', 
                      justifyContent: 'space-between' 
                  }}>
                    <button 
                        onClick={handleCopy}
                        style={{
                            backgroundColor: '#3f3f5a',
                            color: 'white',
                            border: 'none',
                            borderRadius: '4px',
                            padding: '6px 12px',
                            cursor: 'pointer',
                            flex: 1,
                            margin: '0 4px'
                        }}
                    >
                        Copy
                    </button>
                    <button 
                        onClick={onLogout}
                        style={{
                            backgroundColor: '#3f3f5a',
                            color: 'white',
                            border: 'none',
                            borderRadius: '4px',
                            padding: '6px 12px',
                            cursor: 'pointer',
                            flex: 1,
                            margin: '0 4px'
                        }}
                    >
                        Log Out
                    </button>
                    <button 
                        onClick={() => setShowPopup(false)}
                        style={{
                            backgroundColor: '#3f3f5a',
                            color: 'white',
                            border: 'none',
                            borderRadius: '4px',
                            padding: '6px 12px',
                            cursor: 'pointer',
                            flex: 1,
                            margin: '0 4px'
                        }}
                    >
                        Close
                    </button>
                  </div>
              </div>
          )}
      </div>
  );
}

export default PrincipalBox;