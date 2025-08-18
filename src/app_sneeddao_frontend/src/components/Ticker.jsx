import React from 'react';
import { useNavigate } from 'react-router-dom';
import './Ticker.css';

const Ticker = ({ text = '', onTipClick }) => {
  const navigate = useNavigate();
  
  if (!text) return null;

  const handleClick = (e) => {
    // Check if clicked text contains tip notification
    if (text.includes('💰 You have') && text.includes('new tip')) {
      e.preventDefault();
      if (onTipClick) {
        onTipClick();
      } else {
        navigate('/tips');
      }
    }
  };

  const renderTickerText = (textContent) => {
    // Split by bullet points and make tip notifications clickable
    const parts = textContent.split('  •  ');
    return parts.map((part, index) => {
      const isTipNotification = part.includes('💰 You have') && part.includes('new tip');
      
      return (
        <React.Fragment key={index}>
          {index > 0 && <span className="ticker-separator">  •  </span>}
          <span 
            className={`ticker-part ${isTipNotification ? 'ticker-tip-notification' : ''}`}
            onClick={isTipNotification ? handleClick : undefined}
            style={{
              cursor: isTipNotification ? 'pointer' : 'default',
              textDecoration: isTipNotification ? 'underline' : 'none'
            }}
          >
            {part}
          </span>
        </React.Fragment>
      );
    });
  };

  return (
    <div className="scroll-container">
      <div data-first className="scroll">
        <span className="ticker-text">{renderTickerText(text)}</span>
      </div>
      <div className="scroll">
        <span className="ticker-text">{renderTickerText(text)}</span>
      </div>
      <div data-last className="scroll">
        <span className="ticker-text">{renderTickerText(text)}</span>
      </div>
      <div className="fade" />
    </div>
  );
};

export default Ticker;