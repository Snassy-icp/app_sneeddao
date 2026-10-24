// AuthContext.jsx
import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { AuthClient, IdbStorage, KEY_STORAGE_DELEGATION } from '@dfinity/auth-client';
import { DelegationChain } from '@dfinity/identity';
import { completePairing as storePairing } from './utils/pairing';
import { getDelegationExpiryMs, isIdentityExpired, onAuthExpired, reportIfAuthExpired } from './utils/authExpiry';

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
  // The login ran out while the app was open (or since the last visit): AuthClient checks the
  // delegation only at load, so we watch its expiry and show SessionExpiredBanner until the next login.
  const [sessionExpired, setSessionExpired] = useState(false);
  const expiringRef = useRef(false);

  useEffect(() => {
    initAuthClient();
  }, []);

  async function initAuthClient() {
    try {
      // AuthClient.create silently deletes an expired stored delegation, so look at it first.
      let storedExpired = false;
      try {
        const stored = await new IdbStorage().get(KEY_STORAGE_DELEGATION);
        if (typeof stored === 'string' && stored) storedExpired = isIdentityExpired(DelegationChain.fromJSON(stored));
      } catch {
        // no stored login, or not readable: nothing to report
      }
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
        setSessionExpired(false);
      } else if (storedExpired) {
        setSessionExpired(true);
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
          setSessionExpired(false);
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
          setSessionExpired(false);
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

  // The session has expired: log out the usual way, so every page reacts as to a real logout, and
  // keep the banner up until the next login.
  const expireSession = useCallback(async () => {
    if (expiringRef.current) return;
    expiringRef.current = true;
    setSessionExpired(true);
    setShowLoginModal(false);
    try {
      await logout();
    } finally {
      expiringRef.current = false;
    }
  }, [logout]);

  const sessionRef = useRef({ identity: null, isAuthenticated: false, expireSession });
  sessionRef.current = { identity, isAuthenticated, expireSession };

  /// For write actions (sends, transfers): true when the login is still valid. When it has run
  /// out, logs out, shows the banner and returns false, so the action can stop before it fails.
  const ensureSession = useCallback(() => {
    const { identity: id, isAuthenticated: auth, expireSession: expire } = sessionRef.current;
    if (!auth || !id) return false;
    if (isIdentityExpired(id)) {
      expire();
      return false;
    }
    return true;
  }, []);

  // Watch the delegation's expiry: a timer for the moment itself, and a re-check on focus and when
  // the tab becomes visible again (timers sleep in background tabs and on phones).
  useEffect(() => {
    if (!isAuthenticated || !identity) return undefined;
    const expiryMs = getDelegationExpiryMs(identity);
    if (expiryMs === null) return undefined;
    let timer = null;
    const check = () => {
      if (isIdentityExpired(identity)) {
        sessionRef.current.expireSession();
        return;
      }
      // setTimeout holds at most 2^31-1 ms (~24.8 days); re-arm until the expiry is reached
      clearTimeout(timer);
      timer = setTimeout(check, Math.min(Math.max(expiryMs - Date.now(), 0) + 1000, 2147483647));
    };
    const onVisible = () => { if (document.visibilityState === 'visible') check(); };
    check();
    window.addEventListener('focus', check);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('focus', check);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [identity, isAuthenticated]);

  // A call the replica refused because the delegation expired (its clock can be ahead of ours):
  // reported by pages through reportIfAuthExpired, or left unhandled.
  useEffect(() => {
    const off = onAuthExpired(() => {
      if (sessionRef.current.isAuthenticated) sessionRef.current.expireSession();
    });
    const onRejection = (e) => { reportIfAuthExpired(e?.reason); };
    window.addEventListener('unhandledrejection', onRejection);
    return () => {
      off();
      window.removeEventListener('unhandledrejection', onRejection);
    };
  }, []);

  // "Pair this app" (utils/pairing.js): store the approval pasted from a logged-in browser, then
  // load it the way a normal login is loaded.
  const completePairing = useCallback(async (text) => {
    await storePairing(text);
    await initAuthClient();
    setShowLoginModal(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
      completePairing,
      logout, 
      isLoggingIn,
      authError,
      clearAuthError,
      authClient,
      showLoginModal,
      closeLoginModal,
      sessionExpired,
      ensureSession,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}