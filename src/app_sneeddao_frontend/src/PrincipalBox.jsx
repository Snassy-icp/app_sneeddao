import React, { useState, useRef } from 'react';
import './PrincipalBox.css';

function PrincipalBox({ principalText, onLogout }) {
    const [showPopup, setShowPopup] = useState(false);
    const [copyFeedback, setCopyFeedback] = useState('');
    const principalRef = useRef(null);

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

    return (
      <div className="principal-box-container">
          <button className="principal-button" onClick={() => setShowPopup(true)}>
              {truncateString(principalText, 15, "...", 3, 3)}
          </button>
          {showPopup && (
              <div className="principal-popup">
                  <h3>Your Principal ID</h3>
                  <div className="principal-display">
                      <textarea
                          ref={principalRef}
                          value={principalText}
                          readOnly
                          className="principal-input"
                          rows={3}
                      />
                  </div>
                  <div className="copy-feedback-container">
                        <p className="copy-feedback">{copyFeedback || '\u00A0'}</p>
                  </div>
                  <div className="principal-copy-button-group">
                    <button onClick={handleCopy}>Copy</button>
                    <button onClick={onLogout}>Log Out</button>
                    <button onClick={() => setShowPopup(false)}>Close</button>
                  </div>
              </div>
          )}
      </div>
  );
}

export default PrincipalBox;