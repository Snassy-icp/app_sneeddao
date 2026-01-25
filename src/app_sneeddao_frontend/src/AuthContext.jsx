// AuthContext.jsx
import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { AuthClient } from '@dfinity/auth-client';

const AuthContext = createContext();

// Internet Identity 2.0 configuration
const II_CONFIG = {
  // Use the mainnet Internet Identity canister
  identityProvider: process.env.DFX_NETWORK === 'ic' || process.env.DFX_NETWORK === 'staging'
    ? 'https://identity.ic0.app'
    : 'http://rdmx6-jaaaa-aaaaa-aaadq-cai.localhost:4943',
  
  // 7-day session duration (in nanoseconds)
  maxTimeToLive: BigInt(7 * 24 * 60 * 60 * 1000 * 1000 * 1000),
  
  // Window opener features for a better popup experience
  windowOpenerFeatures: 
    `left=${Math.floor(window.screen.width / 2 - 250)},` +
    `top=${Math.floor(window.screen.height / 2 - 350)},` +
    `toolbar=0,location=0,menubar=0,width=500,height=700`,
};

// Optional: Set derivationOrigin for alternative origins (production custom domains)
// This ensures users get the same principal regardless of which domain they use
const getDerivationOrigin = () => {
  // If you have a custom domain, set the canonical origin here
  // Example: return 'https://sneeddao.com';
  // For now, we don't use derivationOrigin (users get different principals per domain)
  return undefined;
};

export function AuthProvider({ children }) {
  const [identity, setIdentity] = useState(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [authClient, setAuthClient] = useState(null);
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [authError, setAuthError] = useState(null);

  useEffect(() => {
    initAuthClient();
  }, []);

  async function initAuthClient() {
    try {
      const client = await AuthClient.create({
        idleOptions: {
          // Disable idle timeout - we handle session management differently
          disableIdle: true,
          disableDefaultIdleCallback: true
        },
        // Key storage options (uses IndexedDB by default in browsers)
        keyType: 'Ed25519', // Use Ed25519 keys for better compatibility
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

  // Memoized login function to prevent unnecessary re-renders
  const login = useCallback(async () => {
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
        identityProvider: II_CONFIG.identityProvider,
        maxTimeToLive: II_CONFIG.maxTimeToLive,
        windowOpenerFeatures: II_CONFIG.windowOpenerFeatures,
        derivationOrigin: getDerivationOrigin(),
        onSuccess: () => {
          const id = authClient.getIdentity();
          setIdentity(id);
          setIsAuthenticated(true);
          setIsLoggingIn(false);
        },
        onError: (error) => {
          console.error('Internet Identity login error:', error);
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
      logout, 
      isLoggingIn,
      authError,
      clearAuthError,
      authClient
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}