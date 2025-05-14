import React from 'react';
import './Ticker.css';

const Ticker = ({ text = '' }) => {
  if (!text) return null;

  return (
    <div className="scroll-container">
      <div data-first className="scroll">
        <span className="ticker-text">{text}</span>
      </div>
      <div className="scroll">
        <span className="ticker-text">{text}</span>
      </div>
      <div data-last className="scroll">
        <span className="ticker-text">{text}</span>
      </div>
      <div className="fade" />
    </div>
  );
};

export default Ticker; 