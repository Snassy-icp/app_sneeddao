import React from 'react';
import { useNavigate } from 'react-router-dom';
import './Ticker.css';

const Ticker = ({ text = '', onTipClick, onReplyClick }) => {
  const navigate = useNavigate();
  
  if (!text) return null;

  const handleClick = (e, clickedPart) => {
    e.preventDefault();
    
    // Check if clicked part contains tip notification
    if (clickedPart.includes('💰 You have') && clickedPart.includes('new tip')) {
      if (onTipClick) {
        onTipClick();
      } else {
        navigate('/tips');
      }
    }
    // Check if clicked part contains reply notification
    else if (clickedPart.includes('💬 You have') && clickedPart.includes('new repl')) {
      if (onReplyClick) {
        onReplyClick();
      } else {
        navigate('/posts');
      }
    }
  };

  const renderTickerText = (textContent) => {
    // Split by bullet points and make notifications clickable
    const parts = textContent.split('  •  ');
    return parts.map((part, index) => {
      const isTipNotification = part.includes('💰 You have') && part.includes('new tip');
      const isReplyNotification = part.includes('💬 You have') && part.includes('new repl');
      const isNotification = isTipNotification || isReplyNotification;
      
      return (
        <React.Fragment key={index}>
          {index > 0 && <span className="ticker-separator">  •  </span>}
          <span 
            className={`ticker-part ${isNotification ? 'ticker-notification' : ''}`}
            onClick={isNotification ? (e) => handleClick(e, part) : undefined}
            style={{
              cursor: isNotification ? 'pointer' : 'default',
              textDecoration: isNotification ? 'underline' : 'none'
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