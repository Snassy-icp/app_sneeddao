import React, { useCallback, useState } from 'react';
import { useAuth } from '../AuthContext';
import LoginModal from './LoginModal';
import PwaNavBar, { shouldShowPwaNav } from './PwaNavBar';
import './Layout.css';

const Layout = ({ children }) => {
  const { showLoginModal, closeLoginModal } = useAuth();
  // Installed app only (no browser chrome there): our own Back / Forward / Refresh.
  const [showPwaNav] = useState(shouldShowPwaNav);
  // Bumped by the in-app Refresh on pages that don't listen for it: remounts the page so it fetches
  // again, keeping the app's login, contexts and scroll position.
  const [pageKey, setPageKey] = useState(0);
  const remountPage = useCallback(() => {
    const y = window.scrollY;
    setPageKey((k) => k + 1);
    requestAnimationFrame(() => requestAnimationFrame(() => window.scrollTo(0, y)));
  }, []);

  return (
    <div className="app-layout">
      <div className="app-content">
        <React.Fragment key={pageKey}>{children}</React.Fragment>
        {showPwaNav && <div className="pwa-nav-spacer" aria-hidden="true" />}
      </div>
      {showPwaNav && <PwaNavBar onRemountPage={remountPage} />}
      <LoginModal isOpen={showLoginModal} onClose={closeLoginModal} />
    </div>
  );
};

export default Layout;
