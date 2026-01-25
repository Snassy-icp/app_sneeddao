// Login.jsx - Login page that shows the login modal
import React, { useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from './AuthContext';
import { useTheme } from './contexts/ThemeContext';
import Header from './components/Header';

function Login() {
  const { isAuthenticated, login, showLoginModal } = useAuth();
  const { theme } = useTheme();
  const navigate = useNavigate();
  const location = useLocation();

  // Open the login modal when this page loads (if not already authenticated)
  useEffect(() => {
    if (!isAuthenticated && !showLoginModal) {
      login();
    }
  }, [isAuthenticated, showLoginModal, login]);

  // Redirect after successful authentication
  useEffect(() => {
    if (isAuthenticated) {
      const currentSearch = location.search;
      const urlParams = new URLSearchParams(currentSearch);
      const fromParam = urlParams.get('from');
      
      if (fromParam) {
        urlParams.delete('from');
        const cleanSearch = urlParams.toString();
        const redirectPath = cleanSearch ? `${fromParam}?${cleanSearch}` : fromParam;
        navigate(redirectPath);
      } else {
        navigate(`/hub${currentSearch}`);
      }
    }
  }, [isAuthenticated, navigate, location.search]);

  return (
    <div className='page-container' style={{ background: theme.colors.primaryBg, minHeight: '100vh' }}>
      <Header />
      <main style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '40px 20px',
      }}>
        <div style={{
          textAlign: 'center',
          color: theme.colors.mutedText,
        }}>
          <img 
            src="/sneed_logo.png" 
            alt="Sneed Logo" 
            style={{
              width: '80px',
              height: '80px',
              borderRadius: '50%',
              marginBottom: '24px',
              opacity: 0.8,
            }}
          />
          <p style={{ fontSize: '1.1rem' }}>
            {isAuthenticated ? 'Redirecting...' : 'Please sign in to continue'}
          </p>
          {!showLoginModal && !isAuthenticated && (
            <button
              onClick={login}
              style={{
                marginTop: '20px',
                padding: '12px 24px',
                background: theme.colors.accent,
                color: 'white',
                border: 'none',
                borderRadius: '8px',
                fontSize: '1rem',
                cursor: 'pointer',
              }}
            >
              Open Sign In
            </button>
          )}
        </div>
      </main>
    </div>
  );
}

export default Login;