import React, { useEffect, useRef, useState } from 'react';
import './Ticker.css';

const Ticker = ({ text }) => {
  const containerRef = useRef(null);
  const [numCopies, setNumCopies] = useState(1);
  
  useEffect(() => {
    const updateNumCopies = () => {
      if (!containerRef.current) return;
      
      // Calculate how many copies we need to fill the screen width plus one extra
      // to ensure smooth continuous scrolling
      const containerWidth = containerRef.current.offsetWidth;
      const singleTextWidth = text.length * 10; // Assuming 10px per character with monospace font
      const copiesNeeded = Math.ceil(containerWidth / singleTextWidth) + 1;
      
      setNumCopies(copiesNeeded);
    };

    // Update on mount and when window resizes
    updateNumCopies();
    window.addEventListener('resize', updateNumCopies);
    
    return () => window.removeEventListener('resize', updateNumCopies);
  }, [text]);

  return (
    <div className="ticker-container" ref={containerRef}>
      <div className="ticker-content">
        {Array(numCopies).fill(text).map((text, index) => (
          <span key={index} className="ticker-text">{text}</span>
        ))}
      </div>
    </div>
  );
};

export default Ticker; 