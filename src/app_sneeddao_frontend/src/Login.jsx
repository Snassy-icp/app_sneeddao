// Login.jsx
import React, { useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from './AuthContext';
import { useTheme } from './contexts/ThemeContext';
import './Login.css';
import Header from './components/Header';

function Login() {
  const { isAuthenticated, login, isLoggingIn, authError, clearAuthError } = useAuth();
  const { theme } = useTheme();
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    if (isAuthenticated) {
      // Only redirect to hub if we're on the root login page AND there's no 'from' parameter
      // If user is trying to access a specific page, let that page handle authentication
      if (location.pathname === '/') {
        const currentSearch = location.search;
        const urlParams = new URLSearchParams(currentSearch);
        const fromParam = urlParams.get('from');
        
        // If there's a 'from' parameter, redirect back to that page instead of /hub
        if (fromParam) {
          urlParams.delete('from'); // Remove the 'from' parameter
          const cleanSearch = urlParams.toString();
          const redirectPath = cleanSearch ? `${fromParam}?${cleanSearch}` : fromParam;
          navigate(redirectPath);
        } else {
          navigate(`/hub${currentSearch}`);
        }
      }
    }
  }, [isAuthenticated, navigate, location.search, location.pathname]);

  // Clear auth error when component mounts or unmounts
  useEffect(() => {
    return () => {
      if (clearAuthError) clearAuthError();
    };
  }, [clearAuthError]);

  async function handleLogin(event) {
    event.preventDefault();
    await login();
  }

  return (
    <div className='page-container'>
      <Header />
      <main className="login-container" style={{ background: theme.colors.primaryBg }}>
        <div className="login-card" style={{ 
          background: theme.colors.cardBg,
          borderColor: theme.colors.border
        }}>
          <div className="login-header">
            <img 
              src="/sneed_logo.png" 
              alt="Sneed Logo" 
              className="login-logo"
            />
            <h1 style={{ color: theme.colors.primaryText }}>Welcome to Sneed DAO</h1>
            <p style={{ color: theme.colors.mutedText }}>
              Sign in securely with Internet Identity
            </p>
          </div>

          <form onSubmit={handleLogin} className="login-form">
            <button 
              type="submit" 
              className="login-button-ii"
              disabled={isLoggingIn}
              style={{
                background: isLoggingIn ? theme.colors.mutedText : theme.colors.accent,
                cursor: isLoggingIn ? 'not-allowed' : 'pointer'
              }}
            >
              {isLoggingIn ? (
                <>
                  <span className="login-spinner"></span>
                  Connecting...
                </>
              ) : (
                <>
                  <svg className="ii-icon" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 3c1.66 0 3 1.34 3 3s-1.34 3-3 3-3-1.34-3-3 1.34-3 3-3zm0 14.2c-2.5 0-4.71-1.28-6-3.22.03-1.99 4-3.08 6-3.08 1.99 0 5.97 1.09 6 3.08-1.29 1.94-3.5 3.22-6 3.22z" fill="currentColor"/>
                  </svg>
                  Sign in with Internet Identity
                </>
              )}
            </button>
          </form>

          {authError && (
            <div className="login-error" style={{ color: theme.colors.error }}>
              <span>⚠️ {authError}</span>
              <button 
                onClick={clearAuthError}
                className="error-dismiss"
                style={{ color: theme.colors.mutedText }}
              >
                ✕
              </button>
            </div>
          )}

          <div className="login-features">
            <h3 style={{ color: theme.colors.primaryText }}>Internet Identity Features</h3>
            <ul style={{ color: theme.colors.mutedText }}>
              <li>🔐 <strong>Passkeys</strong> - Use Face ID, fingerprint, or device PIN</li>
              <li>🌐 <strong>Social Login</strong> - Sign in with Google, Apple, or Microsoft</li>
              <li>🛡️ <strong>Privacy First</strong> - Unique identity per app, no tracking</li>
              <li>⚡ <strong>No Passwords</strong> - Secure authentication without passwords</li>
            </ul>
          </div>

          <div className="login-info" style={{ color: theme.colors.mutedText }}>
            <p>
              Don't have an Internet Identity?{' '}
              <a 
                href="https://identity.ic0.app" 
                target="_blank" 
                rel="noopener noreferrer"
                style={{ color: theme.colors.accent }}
              >
                Create one here
              </a>
            </p>
          </div>
        </div>
      </main>
    </div>
  );
}

export default Login;