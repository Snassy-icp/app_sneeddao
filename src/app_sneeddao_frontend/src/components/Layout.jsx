import React from 'react';
import { useAuth } from '../AuthContext';
import LoginModal from './LoginModal';
import './Layout.css';

const Layout = ({ children }) => {
  const { showLoginModal, closeLoginModal } = useAuth();

  return (
    <div className="app-layout">
      <div className="app-content">
        {children}
      </div>
      <LoginModal isOpen={showLoginModal} onClose={closeLoginModal} />
    </div>
  );
};

export default Layout; 