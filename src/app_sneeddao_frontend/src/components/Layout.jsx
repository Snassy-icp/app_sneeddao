import React from 'react';
import './Layout.css';

const Layout = ({ children }) => {
  return (
    <div className="app-layout">
      <div className="app-content">
        {children}
      </div>
    </div>
  );
};

export default Layout; 