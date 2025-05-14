import React from 'react';
import { Outlet } from 'react-router-dom';
import Ticker from './Ticker';
import './Layout.css';

const Layout = ({ children }) => {
  const tickerText = "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. ";
  
  return (
    <div className="app-layout">
      <Ticker text={tickerText} />
      <div className="app-content">
        {children}
      </div>
    </div>
  );
};

export default Layout; 