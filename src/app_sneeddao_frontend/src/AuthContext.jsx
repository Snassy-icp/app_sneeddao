// AuthContext.jsx
import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { AuthClient } from '@dfinity/auth-client';

const AuthContext = createContext();

// Check if we're on mainnet or local
const isMainnet = process.env.DFX_NETWORK === 'ic' || process.env.DFX_NETWORK === 'staging';

// Identity Provider configurations
const IDENTITY_PROVIDERS = {
  // Internet Identity 1.0 (Classic)
  II1: {
    name: 'Internet Identity 1.0',
    url: isMainnet 
      ? 'https://identity.ic0.app'
      : 'http://rdmx6-jaaaa-aaaaa-aaadq-cai.localhost:4943',
  },
  // Internet Identity 2.0 (New - id.ai)
  II2: {
    name: 'Internet Identity 2.0',
    url: 'https://id.ai',
  },
};

// Session duration: 7 days in nanoseconds
const MAX_TIME_TO_LIVE = BigInt(7 * 24 * 60 * 60 * 1000 * 1000 * 1000);

// Window opener features for a better popup experience
const getWindowFeatures = () => 
  `left=${Math.floor(window.screen.width / 2 - 250)},` +
  `top=${Math.floor(window.screen.height / 2 - 350)},` +
  `toolbar=0,location=0,menubar=0,width=500,height=700`;

export function AuthProvider({ children }) {
  const [identity, setIdentity] = useState(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [authClient, setAuthClient] = useState(null);
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [authError, setAuthError] = useState(null);
  const [showLoginModal, setShowLoginModal] = useState(false);

  useEffect(() => {
    initAuthClient();
  }, []);

  async function initAuthClient() {
    try {
      const client = await AuthClient.create({
        idleOptions: {
          disableIdle: true,
          disableDefaultIdleCallback: true
        },
        keyType: 'Ed25519',
      });
      setAuthClient(client);

      const isAuth = await client.isAuthenticated();
      if (isAuth) {
        const id = client.getIdentity();
        setIdentity(id);
        setIsAuthenticated(true);
      }
    } catch (error) {
      console.error('Failed to initialize auth client:', error);
      setAuthError('Failed to initialize authentication');
    }
  }

  // Generic login function that shows the modal
  const login = useCallback(() => {
    setShowLoginModal(true);
  }, []);

  // Close the login modal
  const closeLoginModal = useCallback(() => {
    setShowLoginModal(false);
    setAuthError(null);
  }, []);

  // Login with Internet Identity 1.0 (Classic - identity.ic0.app)
  const loginWithII1 = useCallback(async () => {
    if (!authClient) {
      console.warn('Auth client not initialized yet');
      return;
    }
    
    if (isLoggingIn) {
      console.warn('Login already in progress');
      return;
    }

    setIsLoggingIn(true);
    setAuthError(null);

    try {
      await authClient.login({
        identityProvider: IDENTITY_PROVIDERS.II1.url,
        maxTimeToLive: MAX_TIME_TO_LIVE,
        windowOpenerFeatures: getWindowFeatures(),
        onSuccess: () => {
          const id = authClient.getIdentity();
          setIdentity(id);
          setIsAuthenticated(true);
          setIsLoggingIn(false);
          setShowLoginModal(false);
        },
        onError: (error) => {
          console.error('Internet Identity 1.0 login error:', error);
          setAuthError(error?.message || 'Login failed');
          setIsLoggingIn(false);
        },
      });
    } catch (error) {
      console.error('Login error:', error);
      setAuthError(error?.message || 'Login failed');
      setIsLoggingIn(false);
    }
  }, [authClient, isLoggingIn]);

  // Login with Internet Identity 2.0 (New - id.ai)
  const loginWithII2 = useCallback(async () => {
    if (!authClient) {
      console.warn('Auth client not initialized yet');
      return;
    }
    
    if (isLoggingIn) {
      console.warn('Login already in progress');
      return;
    }

    setIsLoggingIn(true);
    setAuthError(null);

    try {
      await authClient.login({
        identityProvider: IDENTITY_PROVIDERS.II2.url,
        maxTimeToLive: MAX_TIME_TO_LIVE,
        windowOpenerFeatures: getWindowFeatures(),
        onSuccess: () => {
          const id = authClient.getIdentity();
          setIdentity(id);
          setIsAuthenticated(true);
          setIsLoggingIn(false);
          setShowLoginModal(false);
        },
        onError: (error) => {
          console.error('Internet Identity 2.0 login error:', error);
          setAuthError(error?.message || 'Login failed');
          setIsLoggingIn(false);
        },
      });
    } catch (error) {
      console.error('Internet Identity 2.0 login error:', error);
      setAuthError(error?.message || 'Login failed');
      setIsLoggingIn(false);
    }
  }, [authClient, isLoggingIn]);

  // Memoized logout function
  const logout = useCallback(async () => {
    if (authClient) {
      try {
        await authClient.logout();
        setIdentity(null);
        setIsAuthenticated(false);
        setAuthError(null);
      } catch (error) {
        console.error('Logout error:', error);
      }
    }
  }, [authClient]);

  // Clear any authentication errors
  const clearAuthError = useCallback(() => {
    setAuthError(null);
  }, []);

  return (
    <AuthContext.Provider value={{ 
      identity, 
      isAuthenticated, 
      login,
      loginWithII1,
      loginWithII2,
      logout, 
      isLoggingIn,
      authError,
      clearAuthError,
      authClient,
      showLoginModal,
      closeLoginModal,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}