// AuthContext.jsx
import React, { createContext, useContext, useState, useEffect } from 'react';
import { AuthClient } from '@dfinity/auth-client';

const AuthContext = createContext();

export function AuthProvider({ children }) {
  const [identity, setIdentity] = useState(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [authClient, setAuthClient] = useState(null);

  useEffect(() => {
    initAuthClient();
  }, []);

  async function initAuthClient() {
    const client = await AuthClient.create({
      idleOptions: {
        disableIdle: true,
        disableDefaultIdleCallback: true
      },
    });
    setAuthClient(client);

    const isAuthenticated = await client.isAuthenticated();
    if (isAuthenticated) {
      const identity = client.getIdentity();
      setIdentity(identity);
      setIsAuthenticated(true);
    }
  }

  async function login() {
    if (authClient) {
      await authClient.login({
        maxTimeToLive: BigInt(7 * 24 * 60 * 60 * 1000 * 1000 * 1000), // 7 days
        identityProvider: 'https://identity.ic0.app/#authorize',
        onSuccess: () => {
          const identity = authClient.getIdentity();
          setIdentity(identity);
          setIsAuthenticated(true);
        },
      });
    }
  }

  async function logout() {
    if (authClient) {
      await authClient.logout();
      setIdentity(null);
      setIsAuthenticated(false);
    }
  }

  return (
    <AuthContext.Provider value={{ identity, isAuthenticated, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}